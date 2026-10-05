import { useEffect, useState } from 'react'
import { Send, Mail, Zap } from 'lucide-react'
import { lemmaClient } from './lemma-client'

export type Rec = Record<string, unknown>
export const str = (r: Rec | null | undefined, k: string) => (r && r[k] != null ? String(r[k]) : '')

export const STAGES = ['spark', 'refining', 'ready', 'live'] as const
export type Stage = (typeof STAGES)[number]
export const STAGE_LABEL: Record<Stage, string> = {
  spark: 'Spark', refining: 'Refining', ready: 'Ready', live: 'Live',
}
export const FORMATS = ['newsletter', 'carousel', 'thread'] as const
export const VOICES = ['Clear Operator', 'Contrarian Essayist', 'First Principles'] as const

export function parseBlocks(value: unknown): Rec[] {
  let v = value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  return Array.isArray(v) ? (v as Rec[]) : []
}
export function flattenBlocks(blocks: Rec[]): string {
  return blocks
    .filter((b) => b['type'] === 'text' || b['type'] === 'tweet' || b['type'] === 'title')
    .map((b) => str(b, 'text'))
    .filter(Boolean)
    .join('\n\n')
    .trim()
}
export function parseTags(value: unknown): string[] {
  let v = value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  return Array.isArray(v) ? (v as unknown[]).map(String) : []
}
export function parseLabels(value: unknown): Rec[] {
  let v = value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  if (Array.isArray(v)) return v as Rec[]
  if (v && typeof v === 'object' && Array.isArray((v as Rec)['labels'])) return (v as { labels: Rec[] }).labels
  return []
}
/**
 * True on phone-width screens. Used to decide whether a side panel may open
 * BESIDE the document: at 375px a 300px rail leaves a ~125px gutter that breaks
 * the title mid-word, so those panels start closed there and open as an overlay
 * instead. Matches the `max-width: 560px` breakpoint the editor CSS uses.
 */
export function isNarrowScreen(): boolean {
  if (typeof window === 'undefined') return false
  // A hidden or not-yet-laid-out tab reports width 0, and `max-width: 560px`
  // matches that happily — which would silently collapse the rail for a desktop
  // user whose tab mounted in the background. No real phone reports 0, so an
  // unknown width means "assume there's room".
  const width = window.innerWidth
  return width > 0 && width <= 560
}

export function newId(): string {
  try { return crypto.randomUUID() } catch { return 'b-' + Math.abs(Date.now() + Math.floor(Math.random() * 1e6)) }
}

/**
 * A collision-proof storage filename that still shows the original name in the
 * path. `files.upload` 409s if the exact path already exists, which happens
 * easily with the original name alone — re-picking the same screenshot, a
 * camera-roll export, or an AI image generator that reuses one filename.
 */
export function uniqueFileName(name: string): string {
  return `${newId().slice(0, 8)}-${name}`
}

/** Split markdown the agent returns into editor text blocks (one per paragraph/slide). */
export function mdToBlocks(text: string): Rec[] {
  return (text || '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ id: newId(), type: 'text', text: t }))
}

/** Parse JSON the agent returns even when wrapped in prose or ```json fences. */
export function parseJsonLoose(text: string): unknown {
  let t = (text || '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const a = t.indexOf('['), o = t.indexOf('{')
  if (a >= 0 && (o < 0 || a < o)) t = t.slice(a, t.lastIndexOf(']') + 1)
  else if (o >= 0) t = t.slice(o, t.lastIndexOf('}') + 1)
  try { return JSON.parse(t) } catch { return null }
}

export function ChannelIcon({ channel, size = 13 }: { channel: string; size?: number }) {
  if (channel === 'telegram') return <Send size={size} />
  if (channel === 'email') return <Mail size={size} />
  return <Zap size={size} />
}

export function StagePill({ stage }: { stage: string }) {
  const label = STAGE_LABEL[stage as Stage] || stage
  return (
    <span className="stage-pill" style={{ background: `var(--${stage}-bg)`, color: `var(--${stage}-ink)` }}>{label}</span>
  )
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif)$/i
const VIDEO_RE = /\.(mp4|mov|webm|m4v|avi)$/i
const TEXT_RE  = /\.(md|markdown|txt|csv|json)$/i

/**
 * Upload a file to Lemma storage and extract its content as editor blocks.
 * Images → one image block. Text/markdown/json → blocks directly from file.text().
 * Everything else (pdf, docx, etc.) → converted to markdown via files.children.markdown.
 * Always returns the stored path (used for brief_path on campaigns).
 */
export async function importFile(
  file: File, directoryPath: string,
): Promise<{ blocks: Rec[]; path: string; isImage: boolean }> {
  const res = await lemmaClient.files.upload(file, { directoryPath, name: uniqueFileName(file.name), searchEnabled: true })
  const path = str(res as Rec, 'path')
  if (IMAGE_RE.test(file.name)) {
    return { blocks: [{ id: newId(), type: 'image', image_path: path, alt: file.name }], path, isImage: true }
  }
  if (VIDEO_RE.test(file.name)) {
    return { blocks: [{ id: newId(), type: 'video', video_path: path, alt: file.name }], path, isImage: false }
  }
  let text = ''
  try {
    if (TEXT_RE.test(file.name)) text = await file.text()
    else text = await (await lemmaClient.files.children.markdown(path)).text()
  } catch { text = '' }
  const blocks = text.trim()
    ? mdToBlocks(text)
    : [{ id: newId(), type: 'text', text: `Imported **${file.name}** — file saved to storage.` }]
  return { blocks, path, isImage: false }
}

/** Fetch a short-lived displayable URL for any stored file path (image, video, etc.). */
export function useFileUrl(path: string | undefined): string | null {
  return useImageUrl(path)
}

/** Fetch a short-lived displayable URL for a stored file path. */
export function useImageUrl(path: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (!path) { setUrl(null); return }
    lemmaClient.files
      .getUrl(path)
      .then((r) => { if (alive) setUrl(r.url) })
      .catch(() => { if (alive) setUrl(null) })
    return () => { alive = false }
  }, [path])
  return url
}
