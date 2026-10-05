// Closed vocabulary for the *kind of piece* a campaign includes or a post is.
// Distinct from `formats.ts` / posts.format_type, which is the platform-native
// rendition (X Thread, Reddit Post, …). You pick these by tapping a chip —
// never by typing, which is why they replaced free-text tags.
import type { LucideIcon } from 'lucide-react'
import { Clapperboard, GalleryHorizontal, Image, Newspaper } from 'lucide-react'
import { parseTags } from './lib'

export const CONTENT_FORMATS = ['carousel', 'reel', 'post', 'blog'] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

export interface ContentFormatSpec {
  key: ContentFormat
  label: string
  short: string
  icon: LucideIcon
  accent: string
}

export const CONTENT_FORMAT_SPEC: Record<ContentFormat, ContentFormatSpec> = {
  carousel: { key: 'carousel', label: 'Carousel', short: 'Carousel', icon: GalleryHorizontal, accent: '#e0508f' },
  reel: { key: 'reel', label: 'Video reel', short: 'Reel', icon: Clapperboard, accent: '#e8641c' },
  post: { key: 'post', label: 'Post', short: 'Post', icon: Image, accent: '#3d6ee0' },
  blog: { key: 'blog', label: 'Blog article', short: 'Blog', icon: Newspaper, accent: '#7c5cff' },
}

/** Map leftover free-text tags onto the closed list so old rows still display. */
const TAG_ALIASES: Record<string, ContentFormat> = {
  carousel: 'carousel', carousels: 'carousel',
  reel: 'reel', reels: 'reel', 'video reel': 'reel', video_reel: 'reel', video: 'reel',
  post: 'post', posts: 'post', 'social post': 'post',
  blog: 'blog', article: 'blog', 'blog article': 'blog', blog_article: 'blog',
}

export function isContentFormat(value: string): value is ContentFormat {
  return (CONTENT_FORMATS as readonly string[]).includes(value)
}

function uniqueFormats(keys: ContentFormat[]): ContentFormat[] {
  const seen = new Set<ContentFormat>()
  const out: ContentFormat[] = []
  for (const key of keys) {
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/**
 * Read `content_formats` (JSON string array). If that column is empty, fold in
 * any legacy `tags` that match a known alias so a row tagged "reel" still
 * lights the Video reel chip.
 */
export function parseContentFormats(value: unknown, fallbackTags?: unknown): ContentFormat[] {
  const fromColumn = parseTags(value)
    .map((item) => item.trim().toLowerCase())
    .filter(isContentFormat)
  if (fromColumn.length) return uniqueFormats(fromColumn)
  if (fallbackTags == null) return []
  const fromTags: ContentFormat[] = []
  for (const raw of parseTags(fallbackTags)) {
    const mapped = TAG_ALIASES[raw.trim().toLowerCase()]
    if (mapped) fromTags.push(mapped)
  }
  return uniqueFormats(fromTags)
}

export function toggleContentFormat(
  current: ContentFormat[],
  key: ContentFormat,
  multiple = true,
): ContentFormat[] {
  const on = current.includes(key)
  if (!multiple) return on ? [] : [key]
  return on ? current.filter((item) => item !== key) : [...current, key]
}

/** Click-to-toggle chips. No text field — the point is no spelling. */
export function FormatPicker({
  selected,
  onChange,
  multiple = true,
}: {
  selected: ContentFormat[]
  onChange: (next: ContentFormat[]) => void
  multiple?: boolean
}) {
  return (
    <div className="format-picks" role="group" aria-label="Content formats">
      {CONTENT_FORMATS.map((key) => {
        const spec = CONTENT_FORMAT_SPEC[key]
        const Icon = spec.icon
        const on = selected.includes(key)
        return (
          <button
            key={key}
            type="button"
            className={`format-pick format-pick-${key}${on ? ' on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(toggleContentFormat(selected, key, multiple))}
          >
            <Icon size={13} />
            {spec.label}
          </button>
        )
      })}
    </div>
  )
}

/** Read-only chips for cards, reader headers, and rails. */
export function FormatChips({ formats }: { formats: ContentFormat[] }) {
  if (!formats.length) return null
  return (
    <span className="fmt-chips">
      {formats.map((key) => {
        const spec = CONTENT_FORMAT_SPEC[key]
        const Icon = spec.icon
        return (
          <span key={key} className={`fmt-chip fmt-chip-${key}`}>
            <Icon size={11} />
            {spec.short}
          </span>
        )
      })}
    </span>
  )
}
