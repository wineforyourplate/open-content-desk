import xLogo from 'simple-icons/icons/x.svg'
import redditLogo from 'simple-icons/icons/reddit.svg'
import instagramLogo from 'simple-icons/icons/instagram.svg'
import { Rec, str } from './lib'
import { formatSpec } from './formats'
import { versionPlatforms, customVersionCount } from './versions'

export const PLATFORMS = ['twitter', 'reddit', 'instagram'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABEL: Record<Platform, string> = {
  twitter: 'X / Twitter',
  reddit: 'Reddit',
  instagram: 'Instagram',
}

const PLATFORM_LOGO: Record<Platform, string> = {
  twitter: xLogo,
  reddit: redditLogo,
  instagram: instagramLogo,
}

export function isPlatform(value: string): value is Platform {
  return PLATFORMS.includes(value as Platform)
}

/** All selected destinations, including records created before multi-platform scheduling. */
export function platformsFor(post: Rec): Platform[] {
  let value = post['platforms']
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = [] }
  }
  if (Array.isArray(value)) {
    const platforms = value.map(String).filter(isPlatform)
    if (platforms.length) return [...new Set(platforms)]
  }
  return [platformFor(post)]
}

/** Explicit scheduling platform, with a fallback for posts created before the field existed. */
export function platformFor(post: Rec): Platform {
  const explicit = str(post, 'platform')
  if (isPlatform(explicit)) return explicit

  const format = formatSpec(str(post, 'format_type'))
  if (format?.platform === 'Reddit') return 'reddit'
  if (format?.platform === 'X') return 'twitter'
  return 'instagram'
}

/**
 * Which platform versions a post holds, as icons — replaces the old opaque
 * "3 versions" count so the board is scannable without opening anything.
 */
export function VersionChips({ post }: { post: Rec }) {
  const platforms = versionPlatforms(post)
  const custom = customVersionCount(post)
  if (!platforms.length && !custom) return null
  return (
    <span className="version-chips" title={`${platforms.map((p) => PLATFORM_LABEL[p]).join(', ')}${custom ? `${platforms.length ? ', ' : ''}${custom} custom` : ''}`}>
      {platforms.map((platform) => <PlatformIcon key={platform} platform={platform} size={14} label={false} />)}
      {custom ? <span className="version-chips-more">+{custom}</span> : null}
    </span>
  )
}

export function PlatformIcon({
  platform,
  size = 16,
  label = true,
}: {
  platform: Platform
  size?: number
  label?: boolean
}) {
  return (
    <span
      className={`platform-icon platform-icon-${platform}`}
      style={{ width: size, height: size }}
      title={label ? PLATFORM_LABEL[platform] : undefined}
      aria-label={label ? PLATFORM_LABEL[platform] : undefined}
      aria-hidden={label ? undefined : true}
    >
      <img src={PLATFORM_LOGO[platform]} alt="" />
    </span>
  )
}
