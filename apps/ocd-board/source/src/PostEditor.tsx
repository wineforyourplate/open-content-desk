import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  useRecord, useUpdateRecord, useDeleteRecord, useUploadFile, useAgentTask,
} from 'lemma-sdk/react'
import {
  X, Trash2, ImagePlus, Sparkles, Wand2, ShieldCheck, MessageSquare,
  ArrowUp, Check, Loader2, Eye, Pencil, Film, Plus, ArrowLeft,
  ArrowRight, Files, CopyPlus, UsersRound,
} from 'lucide-react'
import { lemmaClient } from './lemma-client'
import {
  Rec, str, STAGES, STAGE_LABEL, Stage, parseBlocks, flattenBlocks,
  parseLabels, newId, useImageUrl, useFileUrl, mdToBlocks, parseJsonLoose, VOICES,
  importFile, uniqueFileName,
} from './lib'
import { formatSpec, formatContract } from './formats'
import { TitleArea } from './editors/TitleArea'
import { DocumentEditor, ReadMarkdown, type DocumentEditorHandle } from './RichText'
import {
  ORIGINAL_VERSION_ID, createPostVersion, parsePostVersions, platformsOf, isTargetPlatform,
  type PostVersion, type VersionPlatform,
} from './versions'
import { writePostNote } from './notes'
import { syncSharedCopies } from './commonsSync'
import { PlatformIcon } from './platforms'
import { ShareToCommonsDialog } from './ShareToCommons'
import { FormatPicker, parseContentFormats } from './contentFormats'
import { SubstagePicker, substageOptions } from './substages'

const VIDEO_RE = /\.(mp4|mov|webm|m4v|avi)$/i

type UploadedMedia = { kind: 'image' | 'video'; path: string; alt: string }

const NOTE_LOADING_MOMENTS = [
  { emojis: ['🛋️', '🍕', '🚪'], quote: '“Pivot!”', source: 'Friends' },
  { emojis: ['🍩', '📺', '💛'], quote: '“D’oh!”', source: 'The Simpsons' },
  { emojis: ['🕶️', '🤖', '🚪'], quote: '“I’ll be back.”', source: 'The Terminator' },
  { emojis: ['🧇', '🚲', '🔦'], quote: '“Friends don’t lie.”', source: 'Stranger Things' },
  { emojis: ['🤠', '🚀', '✨'], quote: '“To infinity and beyond!”', source: 'Toy Story' },
  { emojis: ['🦖', '🚙', '🌴'], quote: '“Life finds a way.”', source: 'Jurassic Park' },
] as const

export function PostEditor({
  postId, campaigns, products, onClose, reloadBoard,
}: {
  postId: string; campaigns: Rec[]; products: Rec[]
  onClose: () => void; reloadBoard: () => void
}) {
  const { record, isLoading, error, refresh } = useRecord({ client: lemmaClient, tableName: 'posts', recordId: postId })
  const { update } = useUpdateRecord({ client: lemmaClient, tableName: 'posts', recordId: postId })
  const { remove } = useDeleteRecord({ client: lemmaClient, tableName: 'posts', recordId: postId })
  const { upload } = useUploadFile({ client: lemmaClient })
  const task = useAgentTask({ client: lemmaClient, agentName: 'writer' })

  const [blocks, setBlocks] = useState<Rec[]>([])
  const [originalBlocks, setOriginalBlocks] = useState<Rec[]>([])
  const [originalTitle, setOriginalTitle] = useState('')
  const [versions, setVersions] = useState<PostVersion[]>([])
  const [activeVersionId, setActiveVersionId] = useState(ORIGINAL_VERSION_ID)
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [mode, setMode] = useState<'read' | 'edit'>('edit')
  const [aiOpen, setAiOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [steer, setSteer] = useState('')
  const [selPerspective, setSelPerspective] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [editorDragOver, setEditorDragOver] = useState(false)
  const [loadingMoment] = useState(() => NOTE_LOADING_MOMENTS[Math.floor(Math.random() * NOTE_LOADING_MOMENTS.length)])
  const fileInput = useRef<HTMLInputElement>(null)
  const docFileInput = useRef<HTMLInputElement>(null)
  const documentEditor = useRef<DocumentEditorHandle>(null)
  const editorDragCounter = useRef(0)
  // The post as it now stands on the server, from this editor's point of view.
  // `record` is only re-fetched on an explicit refresh, so straight after a save
  // it still describes the PREVIOUS state — and every mirror we write from it
  // (the /notes file, the Commons live copies) carries the WHOLE document, not
  // just the field that changed. Building those from `record` therefore pushes
  // stale content over fresh: a title save re-uploads the blocks as they were
  // when the editor opened, and the next block save puts the old title back.
  // Folding each write in here as it happens keeps every sync whole-document.
  const savedPost = useRef<Rec>({})

  const post = record || {}
  const stage = str(post, 'stage') || 'spark'
  const formats = parseContentFormats(post['content_formats'], post['tags'])
  const substage = str(post, 'substage')
  const perspectives = parseBlocks(post['perspectives'])
  const labels = parseLabels(post['claim_check_result'])
  const activeVersion = versions.find((version) => version.id === activeVersionId)
  const format = activeVersion?.format_type || str(post, 'format_type')
  const spec = formatSpec(format)
  const isOriginal = activeVersionId === ORIGINAL_VERSION_ID
  const voice = str(post, 'voice') || 'Clear Operator'
  const skill = str(post, 'applied_skill') || format || 'thread'
  const product = products.find((p) => str(p, 'id') === str(post, 'product_id'))
  const campaign = campaigns.find((c) => str(c, 'id') === str(post, 'campaign_id'))
  const productCtx = product ? str(product, 'context_md') : ''
  const ideaText = () => flattenBlocks(blocks) || title || str(post, 'body_md') || str(post, 'title')
  // Platforms already taken — one version per platform, so these are offered as "go to" not "add".
  const usedPlatforms = platformsOf(versions)

  // Seed editable state from the record once it loads (parent remounts per postId).
  useEffect(() => {
    if (!loaded && record && str(record, 'id') === postId) {
      const bl = parseBlocks(record['blocks'])
      const initialBlocks = bl.length ? bl : (str(record, 'body_md') ? [{ id: newId(), type: 'text', text: str(record, 'body_md') }] : [])
      setBlocks(initialBlocks)
      setOriginalBlocks(initialBlocks)
      setTitle(str(record, 'title'))
      setOriginalTitle(str(record, 'title'))
      setVersions(parsePostVersions(record['versions']))
      savedPost.current = { ...(record as Rec) }
      setLoaded(true)
    }
  }, [record, postId, loaded])

  // Agent generates → app persists. When a Writer task finishes, parse its output for
  // the target format and write the result ourselves.
  useEffect(() => {
    if (!pending || !task.isDone) return
    const a = (task.outputText || '').trim(), b = (task.streamingText || '').trim()
    const out = a.length >= b.length ? a : b
    let cancelled = false
    ;(async () => {
      try {
        if (pending === 'draft' || pending === 'rewrite') {
          const parsed = spec ? spec.parseAgent(out) : { blocks: mdToBlocks(out) }
          if (parsed && parsed.blocks.length) {
            await persistGenerated(parsed.blocks, parsed.title, pending === 'draft')
          }
        } else if (pending === 'perspectives') {
          const arr = parseJsonLoose(out)
          if (Array.isArray(arr)) await save({ perspectives: arr })
        } else if (pending === 'claimcheck') {
          const arr = parseJsonLoose(out)
          if (arr) await save({ claim_check_result: arr })
        }
        if (!cancelled) { await refresh(); reloadBoard() }
      } finally {
        if (!cancelled) { setPending(null); task.reset() }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, task.isDone])

  /**
   * Persist `data` and remember it as the post's current state. Every write goes
   * through here so `savedPost` stays a complete picture of the saved document —
   * that's what the mirrors below are built from.
   */
  async function save(data: Rec) {
    savedPost.current = { ...savedPost.current, ...data }
    await update(data)
  }
  /**
   * Mirror the post — original *and* every version — to /notes/<id>.md, AND push
   * the fresh content into any Commons boards it's already shared to. Called
   * after the record is already persisted, so a failure in either is swallowed:
   * a stale note/Commons copy must never look like a failed save. This is what
   * makes a Commons share behave like a live Google Doc link instead of a
   * one-time copy — no separate "re-share to refresh" step.
   */
  async function syncNote(overrides: Rec = {}) {
    const merged = { ...savedPost.current, updated_at: new Date().toISOString(), ...overrides }
    try {
      await writePostNote(
        merged,
        { product: product ? str(product, 'name') : '', campaign: campaign ? str(campaign, 'name') : '' },
      )
    } catch { /* best-effort mirror */ }
    await syncSharedCopies(merged)
  }
  async function patch(data: Rec) {
    await save(data)
    await syncNote(data)
    await refresh()
    reloadBoard()
  }
  async function persistBlocks(next: Rec[]) {
    setBlocks(next)
    if (isOriginal) {
      setOriginalBlocks(next)
      const data = { blocks: next, body_md: flattenBlocks(next) }
      await save(data)
      await syncNote(data)
    } else {
      const nextVersions = versions.map((version) => version.id === activeVersionId
        ? { ...version, blocks: next, body_md: flattenBlocks(next), updated_at: new Date().toISOString() }
        : version)
      setVersions(nextVersions)
      await save({ versions: nextVersions })
      await syncNote({ versions: nextVersions })
    }
    reloadBoard()
  }
  async function commitTitle() {
    if (isOriginal) {
      setOriginalTitle(title)
      await save({ title })
      await syncNote({ title })
    } else {
      const nextVersions = versions.map((version) => version.id === activeVersionId
        ? { ...version, title, updated_at: new Date().toISOString() }
        : version)
      setVersions(nextVersions)
      await save({ versions: nextVersions })
      await syncNote({ versions: nextVersions })
    }
    reloadBoard()
  }
  async function persistGenerated(nextBlocks: Rec[], nextTitle: string | undefined, isDraft: boolean) {
    setBlocks(nextBlocks)
    if (nextTitle != null) setTitle(nextTitle)
    const meta: Rec = {
      voice,
      applied_skill: skill,
      ...(isDraft ? { stage: 'refining' } : {}),
    }
    if (isOriginal) {
      setOriginalBlocks(nextBlocks)
      if (nextTitle != null) setOriginalTitle(nextTitle)
      const data = {
        ...meta,
        blocks: nextBlocks,
        body_md: flattenBlocks(nextBlocks),
        ...(nextTitle != null ? { title: nextTitle } : {}),
      }
      await save(data)
      await syncNote(data)
      return
    }
    const nextVersions = versions.map((version) => version.id === activeVersionId
      ? {
          ...version,
          blocks: nextBlocks,
          body_md: flattenBlocks(nextBlocks),
          ...(nextTitle != null ? { title: nextTitle } : {}),
          updated_at: new Date().toISOString(),
        }
      : version)
    setVersions(nextVersions)
    await save({ ...meta, versions: nextVersions })
    await syncNote({ ...meta, versions: nextVersions })
  }
  // Freshest content for any version id — live editor state for whatever tab is
  // open, stored state otherwise. Used when snapshotting a version into Commons.
  function resolveVersionContent(id: string): { title: string; blocks: Rec[] } {
    if (id === activeVersionId) return { title, blocks }
    if (id === ORIGINAL_VERSION_ID) return { title: originalTitle, blocks: originalBlocks }
    const version = versions.find((item) => item.id === id)
    return { title: version?.title || originalTitle, blocks: version?.blocks || [] }
  }
  function selectVersion(id: string) {
    if (busy || id === activeVersionId) return
    if (id === ORIGINAL_VERSION_ID) {
      setBlocks(originalBlocks)
      setTitle(originalTitle)
      setActiveVersionId(id)
      return
    }
    const version = versions.find((item) => item.id === id)
    if (!version) return
    setBlocks(version.blocks.length ? version.blocks : (version.body_md ? [{ id: newId(), type: 'text', text: version.body_md }] : []))
    setTitle(version.title || originalTitle)
    setActiveVersionId(id)
  }
  async function addVersion(platform: VersionPlatform) {
    setVersionMenuOpen(false)
    // One version per platform: if it already exists, just go there.
    if (isTargetPlatform(platform)) {
      const existing = versions.find((version) => version.platform === platform)
      if (existing) { selectVersion(existing.id); return }
    }
    // Always branch from the Original, never from whichever tab happens to be
    // open — otherwise adding Reddit after editing X would inherit the X text.
    const copiedBlocks = originalBlocks.map((block) => ({ ...block, id: newId() }))
    const nextVersion = createPostVersion(platform, originalTitle, copiedBlocks)
    const nextVersions = [...versions, { ...nextVersion, body_md: flattenBlocks(copiedBlocks) }]
    setVersions(nextVersions)
    await save({ versions: nextVersions })
    await syncNote({ versions: nextVersions })
    setActiveVersionId(nextVersion.id)
    setBlocks(nextVersion.blocks)
    setTitle(nextVersion.title || originalTitle)
    reloadBoard()
  }
  async function renameActiveVersion(name: string) {
    const nextVersions = versions.map((version) => version.id === activeVersionId
      ? { ...version, name: name.trim() || 'Untitled version', updated_at: new Date().toISOString() }
      : version)
    setVersions(nextVersions)
    await save({ versions: nextVersions })
    await syncNote({ versions: nextVersions })
    reloadBoard()
  }
  async function removeActiveVersion() {
    const version = versions.find((item) => item.id === activeVersionId)
    if (!version || !window.confirm(`Delete “${version.name}”? The original note stays intact.`)) return
    const nextVersions = versions.filter((item) => item.id !== activeVersionId)
    setVersions(nextVersions)
    const data = {
      versions: nextVersions,
      ...(str(post, 'scheduled_version_id') === activeVersionId ? { scheduled_version_id: ORIGINAL_VERSION_ID } : {}),
    }
    await save(data)
    await syncNote(data)
    setActiveVersionId(ORIGINAL_VERSION_ID)
    setBlocks(originalBlocks)
    setTitle(originalTitle)
    reloadBoard()
  }
  async function setSubstage(next: string) {
    // Substage is the step *inside* refining. Clearing writes null, not ''.
    await patch({ substage: next || null })
  }
  async function setStage(next: Stage) {
    if (next === 'live') {
      const url = window.prompt('Paste the published post URL (where it went live):', str(post, 'published_url'))
      if (url == null) return
      await patch({ stage: 'live', published_url: url })
    } else {
      await patch({ stage: next })
    }
  }
  async function uploadMedia(file: File): Promise<UploadedMedia | null> {
    const res = await upload(file, { directoryPath: `/me/posts/${postId}`, name: uniqueFileName(file.name) })
    const path = res ? str(res as Rec, 'path') : ''
    if (!path) return null
    return { kind: VIDEO_RE.test(file.name) ? 'video' : 'image', path, alt: file.name }
  }
  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Show an "uploading…" placeholder the instant a file is picked — the
    // upload can take a moment, and silently doing nothing until it lands
    // reads as broken (that's the whole complaint this fixes).
    const placeholderId = newId()
    documentEditor.current?.insertPlaceholder(placeholderId, file.name)
    try {
      const media = await uploadMedia(file)
      if (media) await documentEditor.current?.resolvePlaceholder(placeholderId, media)
      else documentEditor.current?.failPlaceholder(placeholderId)
    } catch {
      documentEditor.current?.failPlaceholder(placeholderId)
    }
  }

  async function onPickDoc(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    try {
      const { blocks: newBlocks } = await importFile(file, `/me/posts/${postId}`)
      await documentEditor.current?.insertBlocks(newBlocks)
    } finally {
      setImporting(false)
    }
  }

  function handleEditorDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    editorDragCounter.current++
    setEditorDragOver(true)
  }
  function handleEditorDragLeave() {
    editorDragCounter.current--
    if (editorDragCounter.current === 0) setEditorDragOver(false)
  }
  function handleEditorDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault() }
  async function handleEditorDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    editorDragCounter.current = 0
    setEditorDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    setImporting(true)
    try {
      const imported: Rec[] = []
      for (const file of files) {
        const { blocks: newBlocks } = await importFile(file, `/me/posts/${postId}`)
        imported.push(...newBlocks)
      }
      await documentEditor.current?.insertBlocks(imported)
    } finally {
      setImporting(false)
    }
  }

  const productLine = product
    ? `\nProduct: "${str(product, 'name')}".${productCtx ? `\nContext: ${productCtx}` : ''}\nAlso read any markdown reference docs in /product-docs/${str(post, 'product_id')}/ and ground in them.\n`
    : ''

  function runDraft() {
    setPending('draft')
    void task.run(`You are drafting a ${spec?.label || format}. First load the ${skill} skill guide from /guides and the ${voice} voice guide from /voices, and ground everything in our active context_profile — use only its allowed claims and proof points, and respect its blocked claims.${productLine}${selPerspective ? ` Use a "${selPerspective}" angle.` : ''} The source idea is: "${ideaText()}". ${formatContract(format)}`)
  }
  function runPerspectives() {
    setPending('perspectives')
    void task.run(`For this idea: "${ideaText()}", propose 3-4 distinct, publishable content angles grounded in our active context_profile.${productLine} Return ONLY a JSON array; each item an object with keys "label", "description", "why_it_fits". No prose, no code fences.`)
  }
  function runClaim() {
    setPending('claimcheck')
    void task.run(`Claim-check this draft against our active context_profile (allowed claims, proof points, blocked claims). Draft: "${ideaText()}". Return ONLY a JSON array; each item an object with keys "claim", "label" (one of supported, weak, unsupported), and "reason". No prose, no code fences.`)
  }
  function runRewrite(instruction: string) {
    setPending('rewrite')
    void task.run(`Rewrite this ${spec?.label || format} per the instruction, keeping the ${voice} voice and grounding in our active context_profile.${productLine} Instruction: "${instruction}". Current draft: "${ideaText()}". ${formatContract(format)}`)
  }
  const busy = task.isRunning || pending != null
  const hasIdea = ideaText().trim().length > 0
  const readOnly = mode === 'read'

  function renderBody() {
    if (readOnly) {
      return (
        <article className="reader-article">
          <header className="reader-header">
            <h1 className="read-title">{title || 'Untitled'}</h1>
          </header>
          <ReadView blocks={blocks} />
        </article>
      )
    }
    return (
      <>
        <TitleArea className="title-input" value={title} placeholder="Untitled"
          onChange={setTitle} onCommit={commitTitle} />
        <DocumentEditor
          ref={documentEditor}
          blocks={blocks}
          onCommit={persistBlocks}
          importing={importing}
          onPickMedia={() => fileInput.current?.click()}
          onPickFile={() => docFileInput.current?.click()}
        />
        <input ref={fileInput} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={onPickImage} />
        <input ref={docFileInput} type="file" style={{ display: 'none' }} onChange={onPickDoc} />
      </>
    )
  }

  if (!loaded) {
    return (
      <div className="editor-overlay note-loading-screen">
        <button className="note-loading-close" onClick={onClose} aria-label="Back to board"><ArrowLeft size={18} /></button>
        {error && !isLoading ? (
          <div className="note-load-error" role="alert">
            <span className="note-load-error-emoji" aria-hidden="true">🎬</span>
            <h2>This note missed its cue.</h2>
            <p>{error.message || 'Something interrupted the load.'}</p>
            <div>
              <button className="ghost" onClick={onClose}>Close</button>
              <button className="cta" onClick={() => void refresh()}>Try again</button>
            </div>
          </div>
        ) : (
          <div className="note-loader" role="status" aria-live="polite" aria-label="Opening note">
            <div className="note-loader-emojis" aria-hidden="true">
              {loadingMoment.emojis.map((emoji, index) => <span key={`${emoji}-${index}`}>{emoji}</span>)}
            </div>
            <span className="note-loader-kicker">Opening note</span>
            <blockquote>{loadingMoment.quote}</blockquote>
            <cite>— {loadingMoment.source}</cite>
            <span className="note-loader-progress" aria-hidden="true"><i /><i /><i /></span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="editor-overlay">
      <div className="editor-top">
        <div className="crumb">
          <button className="editor-back" onClick={onClose} title="Back to board"><ArrowLeft size={19} /></button>
          <span className="editor-note-name">{isOriginal ? (title || 'Untitled') : (originalTitle || 'Untitled')}</span>
        </div>
        <div className="stepper">
          {STAGES.map((s, i) => (
            <span key={s} className="step-wrap">
              <button className={`step ${stage === s ? 'cur' : ''} ${STAGES.indexOf(stage as Stage) > i ? 'done' : ''}`} onClick={() => setStage(s)}>
                {STAGES.indexOf(stage as Stage) > i ? <Check size={12} /> : null} {STAGE_LABEL[s]}
              </button>
              {i < STAGES.length - 1 ? <span className="step-sep">›</span> : null}
            </span>
          ))}
        </div>
        <div className="top-right">
          <div className="view-toggle">
            <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}><Eye size={14} /> Read</button>
            <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}><Pencil size={14} /> Edit</button>
          </div>
          <button
            className="commons-share-btn"
            title="Share a snapshot to a Commons board"
            onClick={() => { documentEditor.current?.commit(); setShareOpen(true) }}
          >
            <UsersRound size={14} /> <span>Share</span>
          </button>
          {/* The label has to be an ELEMENT, not a bare text node: the narrow-screen
              rule that collapses this to an icon hides non-first-svg children, and a
              text node can't be selected — it stayed put and wrapped to three lines
              inside a 34px button, spilling off the right edge of a phone. */}
          <button className={`refine-btn ${aiOpen ? 'on' : ''}`} onClick={() => setAiOpen((o) => !o)}>
            <Sparkles size={14} /> <span>Refine with AI</span>
            <ArrowRight size={15} className="refine-arrow" />
          </button>
          <button className="icon-danger" title="Delete" onClick={async () => { if (confirm('Delete this post?')) { await remove(); reloadBoard(); onClose() } }}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {stage === 'refining' ? (
        <div className="substage-bar">
          <span className="substage-bar-label">Step</span>
          <SubstagePicker
            value={substage}
            options={substageOptions(formats)}
            onChange={(next) => void setSubstage(next)}
            disabled={busy}
          />
        </div>
      ) : null}

      <div className="editor-body">
        <div
          className={`editor-main${editorDragOver ? ' editor-drop-active' : ''}`}
          onDragEnter={handleEditorDragEnter}
          onDragLeave={handleEditorDragLeave}
          onDragOver={handleEditorDragOver}
          onDrop={handleEditorDrop}
        >
          <div className="version-switcher" aria-label="Document versions">
            <span className="version-switcher-label">Versions</span>
            <div className="version-tabs">
              <button
                className={activeVersionId === ORIGINAL_VERSION_ID ? 'on' : ''}
                disabled={busy}
                onClick={() => selectVersion(ORIGINAL_VERSION_ID)}
              >Original</button>
              {versions.map((version) => (
                <button
                  className={activeVersionId === version.id ? 'on' : ''}
                  disabled={busy}
                  key={version.id}
                  onClick={() => selectVersion(version.id)}
                >
                  {isTargetPlatform(version.platform)
                    ? <PlatformIcon platform={version.platform} size={13} label={false} />
                    : null}
                  {version.name}
                </button>
              ))}
            </div>
            <div className="version-add-wrap">
              <button className="version-add" disabled={busy} onClick={() => setVersionMenuOpen((open) => !open)}>
                <Plus size={14} /> Add version
              </button>
              {versionMenuOpen ? (
                <div className="version-add-menu">
                  {([
                    ['twitter', 'X / Twitter'],
                    ['reddit', 'Reddit'],
                    ['instagram', 'Instagram'],
                    ['custom', 'Custom'],
                  ] as [VersionPlatform, string][]).map(([key, label]) => {
                    const taken = isTargetPlatform(key) && usedPlatforms.includes(key)
                    return (
                      <button key={key} className={taken ? 'taken' : ''} onClick={() => void addVersion(key)}>
                        {isTargetPlatform(key)
                          ? <PlatformIcon platform={key} size={15} label={false} />
                          : <CopyPlus size={14} />}
                        {label}
                        {taken ? <span className="version-add-taken">Added</span> : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {!isOriginal && activeVersion ? (
            <div className="version-detailbar">
              <label>
                <span>Version name</span>
                <input
                  value={activeVersion.name}
                  onChange={(event) => setVersions((current) => current.map((version) => version.id === activeVersionId ? { ...version, name: event.target.value } : version))}
                  onBlur={(event) => void renameActiveVersion(event.target.value)}
                />
              </label>
              <span>{activeVersion.platform && activeVersion.platform !== 'custom' ? activeVersion.platform : 'No platform lock-in'}</span>
              <button className="version-delete" onClick={() => void removeActiveVersion()}><Trash2 size={14} /> Delete version</button>
            </div>
          ) : null}

          <div className="editor-doc">
            {renderBody()}
          </div>
        </div>

        {aiOpen ? (
          <div className="ai-panel">
            <div className="ai-head">
              <span><Sparkles size={15} /> Refine with AI</span>
              <button className="x-btn" onClick={() => setAiOpen(false)}><X size={16} /></button>
            </div>
            <div className="ai-scroll">
              <div className="rail-group">
                <div className="rlabel">Tone / Voice</div>
                <div className="pills">
                  {VOICES.map((o) => <button key={o} className={`pick ${voice === o ? 'on' : ''}`} onClick={() => patch({ voice: o })}>{o}</button>)}
                </div>
              </div>

              {perspectives.length ? (
                <div className="rail-group">
                  <div className="rlabel">Angle</div>
                  {perspectives.map((p, i) => (
                    <button key={i} className={`persp ${selPerspective === str(p, 'label') ? 'on' : ''}`} onClick={() => setSelPerspective(str(p, 'label'))}>
                      <b>{str(p, 'label')}</b><span>{str(p, 'description')}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {labels.length ? (
                <div className="rail-group">
                  <div className="rlabel">Claim check</div>
                  {labels.map((l, i) => (
                    <div className={`claim claim-${str(l, 'label')}`} key={i}><b>{str(l, 'label')}</b> {str(l, 'reason') || str(l, 'claim')}</div>
                  ))}
                </div>
              ) : null}

              {!perspectives.length && !labels.length ? (
                <div className="ai-empty">Pick a tone, then ask Writer to draft or rewrite this {spec?.label.toLowerCase() || 'version'}.</div>
              ) : null}
            </div>

            <div className="ai-foot">
              {busy ? (
                <div className="rocky-msg"><Loader2 size={14} className="spin" /> {task.activity || 'Writer is working…'} <span className="ai-stream">{(task.streamingText || '').slice(-90)}</span></div>
              ) : (
                <div className="rocky-actions">
                  <button onClick={runPerspectives} disabled={!hasIdea}><Sparkles size={14} /> Perspectives</button>
                  <button onClick={runDraft} disabled={!hasIdea}><Wand2 size={14} /> Draft</button>
                  <button onClick={runClaim} disabled={!hasIdea}><ShieldCheck size={14} /> Claim-check</button>
                </div>
              )}
              <div className="rocky-in">
                <MessageSquare size={15} />
                <input value={steer} placeholder="Ask Writer to rewrite…" disabled={busy}
                  onChange={(e) => setSteer(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && steer.trim()) { const s = steer.trim(); setSteer(''); runRewrite(s) } }} />
                <button className="send" disabled={busy || !steer.trim()} onClick={() => { const s = steer.trim(); setSteer(''); runRewrite(s) }}><ArrowUp size={15} /></button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <NoteProps post={post} products={products} campaigns={campaigns} formats={formats} onPatch={patch} />

      {shareOpen ? (
        <ShareToCommonsDialog
          postId={postId}
          tags={[]}
          formats={formats}
          substage={substage}
          versions={versions}
          defaultVersionId={activeVersionId}
          resolveVersion={resolveVersionContent}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** Product / Campaign / Formats as a floating bottom-left control, off the vertical flow. */
function NoteProps({
  post, products, campaigns, formats, onPatch,
}: {
  post: Rec; products: Rec[]; campaigns: Rec[]; formats: ReturnType<typeof parseContentFormats>
  onPatch: (data: Rec) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const product = products.find((p) => str(p, 'id') === str(post, 'product_id'))
  const campaign = campaigns.find((c) => str(c, 'id') === str(post, 'campaign_id'))
  const count = (product ? 1 : 0) + (campaign ? 1 : 0) + formats.length
  return (
    <div className="note-props">
      {open ? <div className="note-props-scrim" onClick={() => setOpen(false)} /> : null}
      {open ? (
        <div className="note-props-pop" role="dialog" aria-label="Note details">
          <div className="note-props-head"><span className="format-chip idea"><Files size={13} /> Note</span></div>
          <label className="note-props-ctl"><span>Product</span>
            <select value={str(post, 'product_id')} onChange={(e) => onPatch({ product_id: e.target.value || null })}>
              <option value="">—</option>
              {products.filter((p) => str(p, 'status') !== 'archived').map((p) => <option key={str(p, 'id')} value={str(p, 'id')}>{str(p, 'name')}</option>)}
            </select>
          </label>
          <label className="note-props-ctl"><span>Campaign</span>
            <select value={str(post, 'campaign_id')} onChange={(e) => onPatch({ campaign_id: e.target.value || null })}>
              <option value="">—</option>
              {campaigns.map((c) => <option key={str(c, 'id')} value={str(c, 'id')}>{str(c, 'name')}</option>)}
            </select>
          </label>
          <div className="note-props-ctl col"><span>Format</span>
            <FormatPicker selected={formats} onChange={(next) => onPatch({ content_formats: next })} />
          </div>
        </div>
      ) : null}
      <button
        className={`note-props-fab ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Note details — product, campaign, format"
        aria-expanded={open}
      >
        <span className="note-props-emoji" aria-hidden="true">🗂️</span>
        {count ? <span className="note-props-badge">{count}</span> : null}
      </button>
    </div>
  )
}

export function ReadImage({ path, alt }: { path: string; alt: string }) {
  const url = useImageUrl(path)
  return url ? <img className="read-img" src={url} alt={alt} /> : <div className="img-ph"><ImagePlus size={18} /> {alt || 'image'}</div>
}

export function ReadVideo({ path, alt }: { path: string; alt: string }) {
  const url = useFileUrl(path)
  return url ? <video className="read-img" src={url} controls /> : <div className="img-ph"><Film size={18} /> {alt || 'video'}</div>
}

export function ReadView({ blocks }: { blocks: Rec[] }) {
  if (!blocks.length) return <div className="read-empty">Nothing here yet — switch to Edit to start writing.</div>
  return (
    <div className="read-doc">
      {blocks.map((b, i) => b['type'] === 'image' ? (
        <ReadImage key={str(b, 'id') || i} path={str(b, 'image_path')} alt={str(b, 'alt')} />
      ) : b['type'] === 'video' ? (
        <ReadVideo key={str(b, 'id') || i} path={str(b, 'video_path')} alt={str(b, 'alt')} />
      ) : (
        <ReadMarkdown key={str(b, 'id') || i} value={str(b, 'text')} />
      ))}
    </div>
  )
}
