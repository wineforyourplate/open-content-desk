// Per-campaign card art. Campaigns almost never get a hand-picked emoji, so
// every card used to render the same 🎯 on the same flat stage-tinted band and
// the grid read as one repeated icon. The mark here is derived from the
// campaign id, so identity is free: distinct duotone + geometry per campaign,
// with the name's initials standing in until someone picks an icon.
//
// Deliberately deeper and more saturated than Board's `.idea-art` pastels — the
// same visual language (gradient + orbs + sweep + grain), one octave down, so
// a campaign never gets mistaken for a post card.

import type { CSSProperties } from 'react'

const CAMPAIGN_PALETTES = [
  ['#f06445', '#f7b267', '#c2354f'],
  ['#5a4ff3', '#9a8bff', '#2f27a8'],
  ['#0e8a76', '#7dcfb6', '#0b5f6b'],
  ['#8b3fa8', '#ef7bb0', '#4f2578'],
  ['#1979b8', '#6fc2e8', '#12457f'],
  ['#e8641c', '#ffc46b', '#b0353f'],
  ['#3f8f4a', '#c3d96a', '#1f6242'],
  ['#4a5673', '#f0a3a3', '#2a3149'],
] as const

/** Emoji offered by the campaign icon picker. Anything else can still be typed. */
export const CAMPAIGN_ICONS = ['🎯', '🚀', '📣', '🎬', '✉️', '🧪', '🔥', '💡', '📈', '🎁', '🏆', '🌱'] as const

type ArtStyle = CSSProperties & {
  '--art-a': string
  '--art-b': string
  '--art-c': string
  '--art-turn': string
  '--art-shift': string
}

function hash(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  return Math.abs(h)
}

function artStyle(seed: string): ArtStyle {
  const h = hash(seed || 'campaign')
  const palette = CAMPAIGN_PALETTES[h % CAMPAIGN_PALETTES.length]
  return {
    '--art-a': palette[0],
    '--art-b': palette[1],
    '--art-c': palette[2],
    '--art-turn': `${(h % 46) - 23}deg`,
    '--art-shift': `${(h >> 4) % 34}%`,
  }
}

/** Up to two initials from the campaign name, used when no emoji is set. */
export function campaignInitials(name: string): string {
  const words = name.trim().split(/[\s\-–—_/]+/).filter(Boolean)
  const letters = words
    .map((w) => (w.match(/[\p{L}\p{N}]/u) || [''])[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
  return letters.toUpperCase() || '✳'
}

/**
 * The card's art header. `emoji` wins when set; otherwise the name's initials
 * carry the identity, so a campaign is never blank and never generic.
 */
export function CampaignArt({ seed, emoji, name }: { seed: string; emoji: string; name: string }) {
  return (
    <span className="camp-art" style={artStyle(seed)}>
      <span className="camp-art-orb one" aria-hidden="true" />
      <span className="camp-art-orb two" aria-hidden="true" />
      <span className="camp-art-sweep" aria-hidden="true" />
      <span className={`camp-art-mark${emoji ? ' emoji' : ''}`} aria-hidden="true">
        {emoji || campaignInitials(name)}
      </span>
    </span>
  )
}
