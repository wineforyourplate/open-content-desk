import { Rec, newId, parseBlocks, str } from './lib'

export const ORIGINAL_VERSION_ID = 'original'

export type VersionPlatform = 'twitter' | 'reddit' | 'instagram' | 'custom'

/** Publishing platforms a version can target. `custom` is deliberately excluded — it has no destination. */
export const TARGET_PLATFORMS = ['twitter', 'reddit', 'instagram'] as const
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number]

export function isTargetPlatform(value: string | undefined): value is TargetPlatform {
  return !!value && TARGET_PLATFORMS.includes(value as TargetPlatform)
}

export type PostVersion = {
  id: string
  name: string
  platform?: VersionPlatform
  format_type?: string
  title?: string
  blocks: Rec[]
  body_md?: string
  created_at?: string
  updated_at?: string
}

const PLATFORM_NAMES: Record<VersionPlatform, string> = {
  twitter: 'X version',
  reddit: 'Reddit version',
  instagram: 'Instagram version',
  custom: 'New version',
}

const PLATFORM_FORMAT: Partial<Record<VersionPlatform, string>> = {
  twitter: 'x_thread',
  reddit: 'reddit_text',
}

export function parsePostVersions(value: unknown): PostVersion[] {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { parsed = [] }
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((item): item is Rec => !!item && typeof item === 'object')
    .map((item) => ({
      id: str(item, 'id') || newId(),
      name: str(item, 'name') || 'Untitled version',
      platform: (str(item, 'platform') || undefined) as VersionPlatform | undefined,
      format_type: str(item, 'format_type') || undefined,
      title: str(item, 'title') || undefined,
      blocks: parseBlocks(item['blocks']),
      body_md: str(item, 'body_md') || undefined,
      created_at: str(item, 'created_at') || undefined,
      updated_at: str(item, 'updated_at') || undefined,
    }))
}

export function createPostVersion(platform: VersionPlatform, title: string, blocks: Rec[]): PostVersion {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name: PLATFORM_NAMES[platform],
    platform,
    format_type: PLATFORM_FORMAT[platform],
    title,
    blocks,
    created_at: now,
    updated_at: now,
  }
}

export function scheduledVersionName(post: Rec): string {
  const id = str(post, 'scheduled_version_id') || ORIGINAL_VERSION_ID
  if (id === ORIGINAL_VERSION_ID) return 'Original'
  return parsePostVersions(post['versions']).find((version) => version.id === id)?.name || 'Original'
}

export function versionOptions(post: Rec): { id: string; name: string; platform?: VersionPlatform }[] {
  return [
    { id: ORIGINAL_VERSION_ID, name: 'Original' },
    ...parsePostVersions(post['versions']).map(({ id, name, platform }) => ({ id, name, platform })),
  ]
}

/** Platforms this post already holds a version for, in stable display order. */
export function versionPlatforms(post: Rec): TargetPlatform[] {
  return platformsOf(parsePostVersions(post['versions']))
}

export function platformsOf(versions: PostVersion[]): TargetPlatform[] {
  const seen = new Set<string>(versions.map((version) => version.platform || '').filter(isTargetPlatform))
  return TARGET_PLATFORMS.filter((platform) => seen.has(platform))
}

/** Versions with no publishing destination (the "Custom" ones), which may repeat freely. */
export function customVersionCount(post: Rec): number {
  return parsePostVersions(post['versions']).filter((version) => !isTargetPlatform(version.platform)).length
}

