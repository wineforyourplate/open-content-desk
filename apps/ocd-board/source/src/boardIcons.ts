// A Commons board's `emoji` column holds EITHER a literal emoji or an icon key
// (`gem`, `rocket`, …). `BoardIcon` in Commons.tsx renders a key as artwork from
// /public/commons/<key>.png with an emoji fallback; this module holds the
// vocabulary itself so plain-text contexts can resolve a key without importing
// the whole Commons screen.

export const BOARD_ICON_FALLBACK: Record<string, string> = {
  rocket: '🚀', campfire: '🔥', lightbulb: '💡', megaphone: '📣',
  target: '🎯', gem: '💎', plane: '✈️', coffee: '☕', popper: '🎉',
}

/** Pickable board identities. Each carries an accent that themes the whole board. */
export const BOARD_ICONS = ['rocket', 'campfire', 'lightbulb', 'megaphone', 'target', 'gem', 'plane', 'coffee'] as const

const BOARD_ICON_ACCENT: Record<string, string> = {
  rocket: '#d6452e', campfire: '#d8741a', lightbulb: '#b5860f', megaphone: '#5a4ff3',
  target: '#c2185b', gem: '#0e8a76', plane: '#2f8f3f', coffee: '#8a5a3c',
}

export const accentForIcon = (icon: string) => BOARD_ICON_ACCENT[icon] || '#5a4ff3'

/**
 * The board's mark as TEXT. Use wherever an image can't go — `<option>` labels,
 * `confirm()` strings — or the raw key leaks to the user ("gem Lemma content lab").
 */
export function boardMarkText(emoji: string): string {
  return BOARD_ICON_FALLBACK[emoji] || emoji || '✦'
}
