// Member avatars, rendered locally with DiceBear — no network call, no external
// asset. The core library is MIT; every style below is CC0 (no attribution),
// verified against dicebear.com/licenses.
//
// Two halves:
//  · Default  — seeded from the member's user id, so everyone has a distinct
//    avatar with NOTHING stored. Costs no row and no schema.
//  · Custom   — a row in `member_profiles` overrides style and/or seed. That
//    table is RLS-off/POD so members can see each other's choices.

import { useMemo } from 'react'
import { createAvatar } from '@dicebear/core'
import {
  notionists, lorelei, openPeeps, thumbs, shapes, glass, pixelArt, identicon,
} from '@dicebear/collection'
import { useLiveRecords } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str } from './lib'

const STYLES = { notionists, lorelei, openPeeps, thumbs, shapes, glass, pixelArt, identicon }
export type AvatarStyle = keyof typeof STYLES
export const AVATAR_STYLES = Object.keys(STYLES) as AvatarStyle[]
export const DEFAULT_AVATAR_STYLE: AvatarStyle = 'notionists'

export const AVATAR_STYLE_LABEL: Record<AvatarStyle, string> = {
  notionists: 'Notion', lorelei: 'Lorelei', openPeeps: 'Peeps', thumbs: 'Thumbs',
  shapes: 'Shapes', glass: 'Glass', pixelArt: 'Pixel', identicon: 'Identicon',
}

// Warm background ramp so avatars sit in the app's cream palette rather than
// punching a white hole in it.
const BACKGROUNDS = ['f2e8d5', 'e9e4f7', 'fde2e4', 'dff1e7', 'e2eefc', 'fae7c8']

const cache = new Map<string, string>()

// Every style declares its own Options type, so a union of styles is not
// assignable to one Style<Options>. Only `seed`, `radius` and `backgroundColor`
// are used here and those are core options shared by all styles, so the call is
// safe — the cast is contained to this one line.
const render = createAvatar as unknown as (
  style: (typeof STYLES)[AvatarStyle],
  options: { seed: string; radius: number; backgroundColor: string[] },
) => { toDataUri: () => string }

/** Data URI for a member's avatar. Memoised — these render in long lists. */
export function avatarUri(seed: string, style: AvatarStyle = DEFAULT_AVATAR_STYLE): string {
  const safeStyle: AvatarStyle = style in STYLES ? style : DEFAULT_AVATAR_STYLE
  const key = `${safeStyle}|${seed}`
  const hit = cache.get(key)
  if (hit) return hit
  const uri = render(STYLES[safeStyle], {
    seed: seed || 'anonymous',
    radius: 50,
    backgroundColor: BACKGROUNDS,
  }).toDataUri()
  cache.set(key, uri)
  return uri
}

export function Avatar({
  seed, style, label, size = 24, className,
}: {
  seed: string
  style?: AvatarStyle
  label?: string
  size?: number
  className?: string
}) {
  const uri = useMemo(() => avatarUri(seed, style), [seed, style])
  return (
    <img
      className={`member-avatar${className ? ` ${className}` : ''}`}
      src={uri}
      width={size}
      height={size}
      alt={label ? `${label}’s avatar` : ''}
      aria-hidden={label ? undefined : true}
      title={label}
    />
  )
}

export type ResolvedAvatar = { seed: string; style: AvatarStyle }

/**
 * Loads everyone's saved avatar choices once and resolves a member to a seed +
 * style. Falls back to the deterministic default when there's no stored row —
 * which is the common case.
 */
export function useAvatars() {
  const profiles = useLiveRecords({ client: lemmaClient, tableName: 'member_profiles' })
  const rows = (profiles.records || []) as Rec[]

  const byUser = useMemo(() => {
    const map = new Map<string, Rec>()
    for (const row of rows) {
      const uid = str(row, 'member_user_id')
      const email = str(row, 'email').toLowerCase()
      if (uid) map.set(uid, row)
      if (email) map.set(email, row)
    }
    return map
  }, [rows])

  function resolve(userId: string, email?: string): ResolvedAvatar {
    const row = byUser.get(userId) || (email ? byUser.get(email.toLowerCase()) : undefined)
    const fallbackSeed = userId || (email || '').toLowerCase() || 'anonymous'
    if (!row) return { seed: fallbackSeed, style: DEFAULT_AVATAR_STYLE }
    const style = str(row, 'avatar_style') as AvatarStyle
    return {
      seed: str(row, 'avatar_seed') || fallbackSeed,
      style: style in STYLES ? style : DEFAULT_AVATAR_STYLE,
    }
  }

  return { resolve, rows, refresh: profiles.refresh, isLoading: profiles.isLoading }
}

/** Convenience: a member's avatar resolved through saved profiles. */
export function MemberAvatar({
  userId, email, label, size = 24, resolve, className,
}: {
  userId: string
  email?: string
  label?: string
  size?: number
  resolve: (userId: string, email?: string) => ResolvedAvatar
  className?: string
}) {
  const { seed, style } = resolve(userId, email)
  return <Avatar seed={seed} style={style} label={label} size={size} className={className} />
}

export function AvatarPicker({
  seed, style, onPickStyle, onReroll,
}: {
  seed: string
  style: AvatarStyle
  onPickStyle: (style: AvatarStyle) => void
  onReroll: () => void
}) {
  return (
    <div className="avatar-picker">
      <div className="avatar-picker-grid" role="radiogroup" aria-label="Avatar style">
        {AVATAR_STYLES.map((key) => (
          <button
            key={key} type="button" role="radio" aria-checked={style === key}
            className={style === key ? 'on' : ''}
            onClick={() => onPickStyle(key)}
            title={AVATAR_STYLE_LABEL[key]}
          >
            <Avatar seed={seed} style={key} size={44} />
            <span>{AVATAR_STYLE_LABEL[key]}</span>
          </button>
        ))}
      </div>
      <button type="button" className="ghost avatar-reroll" onClick={onReroll}>Shuffle this look</button>
    </div>
  )
}
