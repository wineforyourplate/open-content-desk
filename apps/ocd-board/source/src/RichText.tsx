import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react'
import {
  Node,
  mergeAttributes,
  type Editor,
  type JSONContent,
} from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import {
  Bold as BoldIcon,
  Code,
  Heading1,
  Heading2,
  ImagePlus,
  Italic as ItalicIcon,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Table2,
  Upload,
} from 'lucide-react'
import { lemmaClient } from './lemma-client'
import { newId, str, type Rec } from './lib'

type ToolButtonProps = {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

type DocumentMedia = {
  kind: 'image' | 'video'
  path: string
  alt: string
}

export type DocumentEditorHandle = {
  focus: () => void
  /** Notion-style "uploading…" placeholder — insert before the upload starts, then resolve or fail it once it settles. */
  insertPlaceholder: (placeholderId: string, label: string) => void
  resolvePlaceholder: (placeholderId: string, media: DocumentMedia) => Promise<void>
  failPlaceholder: (placeholderId: string) => void
  insertBlocks: (blocks: Rec[]) => Promise<void>
  commit: () => void
}

function ToolButton({ label, active, disabled, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`tiptap-tool${active ? ' on' : ''}`}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function editLink(editor: Editor) {
  const previous = String(editor.getAttributes('link')['href'] || '')
  const href = window.prompt('Link URL:', previous)
  if (href == null) return
  if (!href.trim()) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
}

const DocumentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-path'),
        renderHTML: (attributes) => attributes.path ? { 'data-path': attributes.path } : {},
      },
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => attributes.blockId ? { 'data-block-id': attributes.blockId } : {},
      },
    }
  },
}).configure({
  HTMLAttributes: { class: 'bear-media bear-image' },
  resize: {
    enabled: true,
    directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    minWidth: 140,
    minHeight: 80,
    alwaysPreserveAspectRatio: true,
  },
})

const DocumentVideo = Node.create({
  name: 'documentVideo',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      path: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-path'),
        renderHTML: (attributes) => attributes.path ? { 'data-path': attributes.path } : {},
      },
      blockId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attributes) => attributes.blockId ? { 'data-block-id': attributes.blockId } : {},
      },
      alt: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'video[data-document-video]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      mergeAttributes(HTMLAttributes, {
        class: 'bear-media bear-video',
        controls: 'true',
        'data-document-video': 'true',
      }),
    ]
  },
})

/**
 * Inline "uploading…" placeholder, Notion-style — inserted the instant a file
 * is picked (before the upload even starts) so there's always visible feedback,
 * then swapped for the real image/video by `resolvePlaceholder`, or flipped to
 * an error state by `failPlaceholder` if the upload fails. Never persisted:
 * `documentToBlocks` skips this node entirely, since it holds no real content.
 */
const MediaPlaceholder = Node.create({
  name: 'mediaPlaceholder',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      placeholderId: { default: null },
      label: { default: '' },
      status: { default: 'uploading' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-media-placeholder]' }]
  },
  renderHTML({ HTMLAttributes }) {
    const failed = HTMLAttributes.status === 'error'
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'bear-media-placeholder',
        'data-media-placeholder': 'true',
        'data-status': HTMLAttributes.status || 'uploading',
      }),
      ['span', { class: 'bear-media-placeholder-spinner' }],
      ['span', { class: 'bear-media-placeholder-label' }, failed
        ? `Couldn’t upload “${HTMLAttributes.label}” — select and delete to try again`
        : `Uploading “${HTMLAttributes.label}”…`],
    ]
  },
})

/** Locates a live mediaPlaceholder node by id — null once it's been resolved, failed-and-cleared, or wiped by a background resync. */
function findPlaceholderPos(editor: Editor, placeholderId: string): number | null {
  let found: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found != null) return false
    if (node.type.name === 'mediaPlaceholder' && node.attrs.placeholderId === placeholderId) {
      found = pos
      return false
    }
    return true
  })
  return found
}

function editorExtensions(placeholder: string, withMedia = false, resizableTables = true) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      },
      underline: false,
    }),
    Markdown.configure({
      markedOptions: {
        gfm: true,
        breaks: false,
      },
    }),
    Placeholder.configure({ placeholder }),
    TableKit.configure({
      table: {
        resizable: resizableTables,
        renderWrapper: true,
        cellMinWidth: resizableTables ? 20 : 140,
        allowTableNodeSelection: true,
        HTMLAttributes: { class: 'bear-table' },
      },
    }),
    ...(withMedia ? [DocumentImage, DocumentVideo, MediaPlaceholder] : []),
  ]
}

function pipeCells(line: string): string[] {
  let value = line.trim()
  if (value.startsWith('|')) value = value.slice(1)
  if (value.endsWith('|')) value = value.slice(0, -1)
  return value.split('|').map((cell) => cell.trim())
}

function isMarkdownTableRow(line: string): boolean {
  return line.includes('|') && pipeCells(line).length >= 2
}

function isMarkdownTableDivider(line: string): boolean {
  if (!isMarkdownTableRow(line)) return false
  return pipeCells(line).every((cell) => /^:?-{3,}:?$/.test(cell))
}

/**
 * Tiptap's normal rich-text paste turns each clipboard line into a paragraph.
 * Older saves therefore contain blank lines between a table header, divider,
 * and rows. Joining only a validated GFM table sequence repairs those saves
 * without changing ordinary paragraphs that happen to contain a pipe.
 */
function normalizeLooseMarkdownTables(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let index = 0

  while (index < lines.length) {
    const header = lines[index]
    if (!isMarkdownTableRow(header) || isMarkdownTableDivider(header)) {
      output.push(header)
      index++
      continue
    }

    let dividerIndex = index + 1
    while (dividerIndex < lines.length && !lines[dividerIndex].trim()) dividerIndex++
    if (dividerIndex >= lines.length || !isMarkdownTableDivider(lines[dividerIndex])) {
      output.push(header)
      index++
      continue
    }

    const columnCount = pipeCells(header).length
    if (pipeCells(lines[dividerIndex]).length !== columnCount) {
      output.push(header)
      index++
      continue
    }

    const tableLines = [header.trim(), lines[dividerIndex].trim()]
    let cursor = dividerIndex + 1
    while (cursor < lines.length) {
      let rowIndex = cursor
      while (rowIndex < lines.length && !lines[rowIndex].trim()) rowIndex++
      if (
        rowIndex >= lines.length ||
        !isMarkdownTableRow(lines[rowIndex]) ||
        pipeCells(lines[rowIndex]).length !== columnCount
      ) break
      tableLines.push(lines[rowIndex].trim())
      cursor = rowIndex + 1
    }

    output.push(tableLines.join('\n'))
    index = cursor
  }

  return output.join('\n')
}

function FormatBubble({
  editor, onPickMedia, onPickFile, importing,
}: {
  editor: Editor
  /** Only passed by the full DocumentEditor — the compact RichText field has nowhere to upload media to. */
  onPickMedia?: () => void
  onPickFile?: () => void
  importing?: boolean
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') || false,
      italic: current?.isActive('italic') || false,
      strike: current?.isActive('strike') || false,
      code: current?.isActive('code') || false,
      h1: current?.isActive('heading', { level: 1 }) || false,
      h2: current?.isActive('heading', { level: 2 }) || false,
      bulletList: current?.isActive('bulletList') || false,
      orderedList: current?.isActive('orderedList') || false,
      blockquote: current?.isActive('blockquote') || false,
      link: current?.isActive('link') || false,
    }),
  })
  // Whether inserts (image/table/file) belong in this tray at all — only the
  // full document editor has somewhere for them to go.
  const hasInserts = !!(onPickMedia || onPickFile)

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formatBubble"
      options={{ placement: 'top', offset: 8 }}
      shouldShow={({ editor: current, view, state, from, to }) => {
        if (!view.hasFocus() || current.isActive('image') || current.isActive('documentVideo')) return false
        if (from !== to) return true // a real text selection — always show
        if (!hasInserts) return false // compact field: no inserts, so a bare cursor has nothing to show
        // Bare cursor: only show on a genuinely EMPTY line. Showing it on every
        // cursor position (e.g. mid-sentence while typing) floats the tray over
        // whatever's above it, including the title — this is what a bare cursor
        // anywhere used to do and it was reported as unusable for typing.
        const parent = state.doc.resolve(from).parent
        return parent.isTextblock && parent.content.size === 0
      }}
      className="bear-bubble"
      onMouseDown={(event) => event.preventDefault()}
    >
      <ToolButton label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <BoldIcon size={15} />
      </ToolButton>
      <ToolButton label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <ItalicIcon size={15} />
      </ToolButton>
      <ToolButton label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={15} />
      </ToolButton>
      <ToolButton label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code size={15} />
      </ToolButton>
      <span className="bear-bubble-sep" />
      <ToolButton label="Heading 1" active={state.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 size={16} />
      </ToolButton>
      <ToolButton label="Heading 2" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={16} />
      </ToolButton>
      <ToolButton label="Bullet list" active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={16} />
      </ToolButton>
      <ToolButton label="Numbered list" active={state.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={16} />
      </ToolButton>
      <ToolButton label="Blockquote" active={state.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={15} />
      </ToolButton>
      <ToolButton label="Add or edit link" active={state.link} onClick={() => editLink(editor)}>
        <Link2 size={15} />
      </ToolButton>
      {hasInserts ? (
        <>
          <span className="bear-bubble-sep" />
          {onPickMedia ? (
            <ToolButton label="Image / video" onClick={onPickMedia}>
              <ImagePlus size={15} />
            </ToolButton>
          ) : null}
          <ToolButton label="Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            <Table2 size={15} />
          </ToolButton>
          {onPickFile ? (
            <ToolButton label={importing ? 'Importing…' : 'Import file'} disabled={importing} onClick={onPickFile}>
              <Upload size={15} />
            </ToolButton>
          ) : null}
        </>
      ) : null}
    </BubbleMenu>
  )
}

function TableBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      options={{ placement: 'bottom', offset: 8 }}
      shouldShow={({ editor: current, from, to }) => from === to && current.isActive('table')}
      className="bear-table-bubble"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</button>
      <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</button>
      <span />
      <button type="button" className="danger" onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
      <button type="button" className="danger" onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
    </BubbleMenu>
  )
}

function textNodesToBlock(editor: Editor, nodes: JSONContent[], id?: string): Rec | null {
  if (!nodes.length) return null
  const text = editor.markdown!.serialize({ type: 'doc', content: nodes }).trim()
  return text ? { id: id || newId(), type: 'text', text } : null
}

async function displayUrl(path: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(path)
  if (cached) return cached
  try {
    const result = await lemmaClient.files.getUrl(path)
    cache.set(path, result.url)
    return result.url
  } catch {
    return ''
  }
}

async function blocksToNodes(
  editor: Editor,
  blocks: Rec[],
  cache: Map<string, string>,
): Promise<JSONContent[]> {
  const nodes: JSONContent[] = []
  for (const block of blocks) {
    const type = str(block, 'type')
    if (type === 'image' || type === 'video') {
      const path = str(block, type === 'image' ? 'image_path' : 'video_path')
      const src = path ? await displayUrl(path, cache) : ''
      if (path) {
        nodes.push({
          type: type === 'image' ? 'image' : 'documentVideo',
          attrs: {
            src,
            path,
            alt: str(block, 'alt'),
            blockId: str(block, 'id') || newId(),
          },
        })
      }
      continue
    }
    const parsed = editor.markdown!.parse(normalizeLooseMarkdownTables(str(block, 'text')))
    if (parsed.content?.length) nodes.push(...parsed.content)
  }
  return nodes
}

function documentToBlocks(editor: Editor): Rec[] {
  const nodes = editor.getJSON().content || []
  const result: Rec[] = []
  let textNodes: JSONContent[] = []
  let firstTextId: string | undefined

  const flushText = () => {
    const block = textNodesToBlock(editor, textNodes, firstTextId)
    if (block) result.push(block)
    textNodes = []
    firstTextId = undefined
  }

  for (const node of nodes) {
    // Transient upload UI, never real content — must never end up in a saved
    // block, whether resolved to a real image already or still mid-upload.
    if (node.type === 'mediaPlaceholder') continue
    const path = String(node.attrs?.path || '')
    if ((node.type === 'image' || node.type === 'documentVideo') && path) {
      flushText()
      result.push(node.type === 'image'
        ? {
            id: String(node.attrs?.blockId || newId()),
            type: 'image',
            image_path: path,
            alt: String(node.attrs?.alt || ''),
          }
        : {
            id: String(node.attrs?.blockId || newId()),
            type: 'video',
            video_path: path,
            alt: String(node.attrs?.alt || ''),
          })
    } else {
      textNodes.push(node)
    }
  }
  flushText()
  return result
}

export const DocumentEditor = forwardRef<DocumentEditorHandle, {
  blocks: Rec[]
  onCommit: (blocks: Rec[]) => void | Promise<void>
  onPickMedia: () => void
  onPickFile: () => void
  importing?: boolean
}>(
  function DocumentEditor({
    blocks,
    onCommit,
    onPickMedia,
    onPickFile,
    importing,
  }, ref) {
    const savedSignature = useRef('')
    const inputSignature = JSON.stringify(blocks)
    const onCommitRef = useRef(onCommit)
    const urlCache = useRef(new Map<string, string>())
    const loadingSignature = useRef('')
    onCommitRef.current = onCommit

    const commitDocument = (editor: Editor) => {
      const next = documentToBlocks(editor)
      const nextSignature = JSON.stringify(next)
      if (nextSignature === savedSignature.current) return
      savedSignature.current = nextSignature
      void onCommitRef.current(next)
    }

    const editor = useEditor({
      extensions: editorExtensions('Start writing…', true),
      content: '',
      editorProps: {
        attributes: {
          class: 'tiptap rich bear-content',
          'aria-label': 'Document editor',
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault()
            if (editor) editLink(editor)
            return true
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            if (editor) commitDocument(editor)
            return true
          }
          return false
        },
        handlePaste: (_view, event) => {
          const clipboard = event.clipboardData
          const raw = clipboard?.getData('text/plain') || ''
          if (!raw.trim()) return false
          const normalized = normalizeLooseMarkdownTables(raw)
          const parsed = editor?.markdown?.parse(normalized)
          if (!parsed?.content?.some((node) => node.type === 'table')) return false
          event.preventDefault()
          editor.chain().focus().insertContent(parsed.content).run()
          return true
        },
      },
      onBlur: ({ editor: current }) => commitDocument(current),
    })

    useEffect(() => {
      if (!editor || loadingSignature.current === inputSignature) return
      if (editor.isFocused && savedSignature.current && savedSignature.current !== inputSignature) return
      let active = true
      void blocksToNodes(editor, blocks, urlCache.current).then((nodes) => {
        if (!active) return
        editor.commands.setContent({ type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] }, { emitUpdate: false })
        loadingSignature.current = inputSignature
        savedSignature.current = inputSignature
      })
      return () => { active = false }
    }, [blocks, editor, inputSignature])

    useImperativeHandle(ref, () => ({
      focus() {
        editor?.commands.focus('end')
      },
      insertPlaceholder(placeholderId, label) {
        if (!editor) return
        // Passing both nodes to ONE insertContent call, not two chained calls —
        // chaining `.insertContent(a).insertContent(b)` silently drops `a` when
        // the cursor sits in an otherwise-empty paragraph (confirmed by testing:
        // .run() still reports success, but the node never lands in the doc).
        // One array call sidesteps whatever position-tracking that split relies on.
        editor.chain().focus().insertContent([
          { type: 'mediaPlaceholder', attrs: { placeholderId, label, status: 'uploading' } },
          { type: 'paragraph' },
        ]).run()
      },
      async resolvePlaceholder(placeholderId, media) {
        if (!editor) return
        const src = await displayUrl(media.path, urlCache.current)
        const imageNode = {
          type: media.kind === 'image' ? 'image' : 'documentVideo',
          attrs: { src, path: media.path, alt: media.alt, blockId: newId() },
        }
        const pos = findPlaceholderPos(editor, placeholderId)
        if (pos == null) {
          // The placeholder is gone (e.g. a background save mid-upload resynced
          // the doc from persisted blocks, which never include placeholders) —
          // still land the upload rather than silently drop it.
          editor.chain().focus('end').insertContent([imageNode, { type: 'paragraph' }]).run()
        } else {
          editor.chain().focus().command(({ tr }) => {
            tr.replaceWith(pos, pos + 1, editor.schema.nodeFromJSON(imageNode))
            return true
          }).run()
        }
        commitDocument(editor)
      },
      failPlaceholder(placeholderId) {
        if (!editor) return
        const pos = findPlaceholderPos(editor, placeholderId)
        if (pos == null) return
        editor.chain().command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { ...tr.doc.nodeAt(pos)?.attrs, status: 'error' })
          return true
        }).run()
        window.setTimeout(() => {
          if (!editor || editor.isDestroyed) return
          const stillThere = findPlaceholderPos(editor, placeholderId)
          if (stillThere == null) return
          editor.chain().command(({ tr }) => {
            tr.delete(stillThere, stillThere + 1)
            return true
          }).run()
        }, 3500)
      },
      async insertBlocks(nextBlocks) {
        if (!editor) return
        const nodes = await blocksToNodes(editor, nextBlocks, urlCache.current)
        if (!nodes.length) return
        editor.chain().focus().insertContent(nodes).run()
        commitDocument(editor)
      },
      commit() {
        if (editor) commitDocument(editor)
      },
    }), [editor])

    if (!editor) return <div className="bear-content tiptap-loading">Start writing…</div>

    return (
      <div className="bear-editor" onClick={() => editor.commands.focus()}>
        <FormatBubble editor={editor} onPickMedia={onPickMedia} onPickFile={onPickFile} importing={importing} />
        <TableBubble editor={editor} />
        <EditorContent editor={editor} />
      </div>
    )
  },
)

/**
 * Compact Tiptap-backed Markdown field used by format-specific editors.
 * Formatting appears only while text is selected.
 */
export function RichText({
  value,
  onCommit,
  placeholder,
  autoFocus,
}: {
  value: string
  onCommit: (md: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const savedValue = useRef(value)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const editor = useEditor({
    extensions: editorExtensions(placeholder || 'Write…'),
    content: value || '',
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'tiptap rich compact-rich',
        'aria-label': placeholder || 'Markdown editor',
      },
    },
    onBlur: ({ editor: current }) => {
      const markdown = current.getMarkdown().trim()
      if (markdown === savedValue.current) return
      savedValue.current = markdown
      onCommitRef.current(markdown)
    },
  })

  useEffect(() => {
    if (!editor) return
    if (!editor.isFocused && editor.getMarkdown().trim() !== value) {
      editor.commands.setContent(value || '', { contentType: 'markdown', emitUpdate: false })
    }
    savedValue.current = value
  }, [editor, value])

  useEffect(() => {
    if (editor && autoFocus) editor.commands.focus('end')
  }, [autoFocus, editor])

  if (!editor) return <div className="rich tiptap-loading">{placeholder || 'Write…'}</div>

  return (
    <div className="compact-editor">
      <FormatBubble editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}

/** The same Markdown schema as the editor, presented as a calm read-only article. */
export function ReadMarkdown({ value }: { value: string }) {
  const normalized = normalizeLooseMarkdownTables(value)
  const editor = useEditor({
    extensions: editorExtensions('', false, false),
    content: normalized,
    contentType: 'markdown',
    editable: false,
    editorProps: {
      attributes: {
        class: 'reader-prose',
        'aria-label': 'Article content',
      },
    },
  })

  useEffect(() => {
    if (!editor || editor.getMarkdown().trim() === normalized.trim()) return
    editor.commands.setContent(normalized, { contentType: 'markdown', emitUpdate: false })
  }, [editor, normalized])

  if (!editor) return null
  return <EditorContent editor={editor} />
}
