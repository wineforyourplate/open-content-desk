import type { LucideIcon } from 'lucide-react'
import { Twitter, MessageCircle, Newspaper, GalleryHorizontal, Hash } from 'lucide-react'
import { Rec, str, newId, mdToBlocks, parseJsonLoose } from './lib'

// ── Block types (extends the existing {id,type,...} idea) ────────────────────
//   text   {id,type:'text',  text}
//   image  {id,type:'image', image_path, alt}
//   video  {id,type:'video', video_path, alt}
//   tweet  {id,type:'tweet', text, media?: {kind:'image'|'video', path, alt}}
// Reddit uses post.title for the title + text/media blocks for the body.

export type FormatKey =
  | 'x_thread' | 'reddit_text' | 'reddit_media'
  | 'newsletter' | 'carousel' | 'thread'

export type EditorKind = 'thread' | 'reddit' | 'block'

/** What a parser or seeder yields: body blocks plus an optional post title (Reddit). */
export interface ParsedContent { blocks: Rec[]; title?: string }

export interface FormatSpec {
  key: FormatKey
  label: string
  platform: string
  icon: LucideIcon
  /** Small identity color for this format — the Board card's type dot. */
  accent: string
  editor: EditorKind
  /** Reddit media variant: show a single image/video slot above the body. */
  redditMedia?: boolean
  /** Per-unit character limit (advisory, e.g. 280 per tweet). */
  charLimit?: number
  /** Blank content for a fresh rendition. */
  makeEmpty: () => ParsedContent
  /** Seed content from an idea's plain text (non-destructive prefill). */
  seed: (text: string) => ParsedContent
  /** Parse the Writer agent's output into content; null if unusable. */
  parseAgent: (out: string) => ParsedContent | null
}

const emptyText = (text = ''): Rec => ({ id: newId(), type: 'text', text })
const emptyTweet = (text = ''): Rec => ({ id: newId(), type: 'tweet', text })

/** First non-empty line → title; the remainder → body. */
function splitTitleBody(text: string): { title: string; body: string } {
  const lines = (text || '').trim().split('\n')
  const title = (lines.shift() || '').replace(/^#+\s*/, '').trim().slice(0, 300)
  const body = lines.join('\n').trim()
  return { title, body: body || (title ? '' : text.trim()) }
}

/** Split plain text into tweet-sized chunks (by paragraph; advisory, not hard-clamped). */
function textToTweets(text: string): Rec[] {
  const parts = (text || '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
  return parts.length ? parts.map((t) => emptyTweet(t)) : [emptyTweet()]
}

/** Extract all `"<key>": "<value>"` string values from (possibly truncated/malformed) JSON. */
function jsonStringValues(text: string, key: string): string[] {
  const re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g')
  const values: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text || '')) !== null) {
    try { values.push(JSON.parse('"' + m[1] + '"')) } catch { values.push(m[1]) }
  }
  return values
}

/** Output contract appended to a Writer draft/convert prompt so the app can parse the result. */
export function formatContract(format: string | undefined | null): string {
  const spec = formatSpec(format)
  if (spec?.editor === 'thread')
    return 'Return ONLY a JSON array of tweet objects like [{"text":"…","image":"…"}]. Each "text" is under 280 characters, no numbering. "image" is OPTIONAL — include a short described image suggestion for a tweet only when an image genuinely helps. No prose, no code fences.'
  if (spec?.editor === 'reddit')
    return 'Return ONLY a JSON object {"title":"…","body_md":"…"}. Title under 300 chars; body in markdown. No prose, no code fences.'
  return 'Return ONLY the finished draft as plain markdown — no preamble, no commentary, no JSON.'
}

/** Parse the Writer's thread output → tweet blocks. Prefers JSON `[{text,image}]`, salvages partial JSON, then markdown. */
export function parseThread(out: string): Rec[] {
  const j = parseJsonLoose(out)
  if (Array.isArray(j)) {
    const blocks = j
      .map((t) => (typeof t === 'string' ? { text: t, image: '' } : { text: str(t as Rec, 'text'), image: str(t as Rec, 'image') }))
      .filter((o) => o.text.trim())
      .map((o) => {
        const b: Rec = { id: newId(), type: 'tweet', text: o.text.trim() }
        if (o.image && o.image.trim()) b['image_prompt'] = o.image.trim()
        return b
      })
    if (blocks.length) return blocks
  }
  // Salvage tweets from truncated/malformed JSON (e.g. a cut-off array missing its ]).
  const salvaged = jsonStringValues(out, 'text').map((s) => s.trim()).filter(Boolean)
  if (salvaged.length) return salvaged.map((t) => emptyTweet(t))
  // Fallback: numbered / blank-line separated markdown.
  const parts = (out || '')
    .split(/\n{2,}|\n(?=\s*\d+[\.\)]\s)/)
    .map((s) => s.replace(/^\s*\d+[\.\)]\s*/, '').trim())
    .filter(Boolean)
  return parts.length ? parts.map((t) => emptyTweet(t)) : [emptyTweet()]
}

/** Parse the Writer's Reddit output → {title, body blocks}. Prefers JSON `{title, body_md}`. */
export function parseReddit(out: string): ParsedContent {
  const j = parseJsonLoose(out)
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const o = j as Rec
    const title = str(o, 'title')
    const body = str(o, 'body_md') || str(o, 'body')
    if (title || body) return { title, blocks: body ? [emptyText(body)] : [emptyText()] }
  }
  // Salvage title/body from truncated/malformed JSON.
  const titles = jsonStringValues(out, 'title')
  const bodies = jsonStringValues(out, 'body_md').concat(jsonStringValues(out, 'body'))
  if (titles.length || bodies.length) {
    return { title: titles[0] || '', blocks: [emptyText(bodies[0] || '')] }
  }
  // Fallback: first line as title, rest as body.
  const { title, body } = splitTitleBody(out || '')
  return { title, blocks: body ? [emptyText(body)] : [emptyText()] }
}

export const FORMAT_SPECS: Record<FormatKey, FormatSpec> = {
  x_thread: {
    key: 'x_thread', label: 'X Thread', platform: 'X', icon: Twitter, accent: '#3d6ee0',
    editor: 'thread', charLimit: 280,
    makeEmpty: () => ({ blocks: [emptyTweet()] }),
    seed: (text) => ({ blocks: textToTweets(text) }),
    parseAgent: (out) => ({ blocks: parseThread(out) }),
  },
  reddit_text: {
    key: 'reddit_text', label: 'Reddit Post', platform: 'Reddit', icon: MessageCircle, accent: '#e0632f',
    editor: 'reddit',
    makeEmpty: () => ({ title: '', blocks: [emptyText()] }),
    seed: (text) => { const { title, body } = splitTitleBody(text); return { title, blocks: [emptyText(body)] } },
    parseAgent: (out) => parseReddit(out),
  },
  reddit_media: {
    key: 'reddit_media', label: 'Reddit Media', platform: 'Reddit', icon: MessageCircle, accent: '#e0632f',
    editor: 'reddit', redditMedia: true,
    makeEmpty: () => ({ title: '', blocks: [emptyText()] }),
    seed: (text) => { const { title, body } = splitTitleBody(text); return { title, blocks: [emptyText(body)] } },
    parseAgent: (out) => parseReddit(out),
  },
  newsletter: {
    key: 'newsletter', label: 'Newsletter', platform: 'Email', icon: Newspaper, accent: '#7c5cff',
    editor: 'block',
    makeEmpty: () => ({ blocks: [emptyText()] }),
    seed: (text) => ({ blocks: mdToBlocks(text) }),
    parseAgent: (out) => ({ blocks: mdToBlocks(out) }),
  },
  carousel: {
    key: 'carousel', label: 'Carousel', platform: 'Social', icon: GalleryHorizontal, accent: '#e0508f',
    editor: 'block',
    makeEmpty: () => ({ blocks: [emptyText()] }),
    seed: (text) => ({ blocks: mdToBlocks(text) }),
    parseAgent: (out) => ({ blocks: mdToBlocks(out) }),
  },
  thread: {
    key: 'thread', label: 'Thread', platform: 'Social', icon: Hash, accent: '#3aa14a',
    editor: 'block',
    makeEmpty: () => ({ blocks: [emptyText()] }),
    seed: (text) => ({ blocks: mdToBlocks(text) }),
    parseAgent: (out) => ({ blocks: mdToBlocks(out) }),
  },
}

/** Formats offered when creating a new version (native ones first). */
export const VERSION_FORMATS: FormatKey[] = ['x_thread', 'reddit_text', 'reddit_media']

export function formatSpec(key: string | undefined | null): FormatSpec | null {
  if (!key) return null
  return FORMAT_SPECS[key as FormatKey] || null
}
