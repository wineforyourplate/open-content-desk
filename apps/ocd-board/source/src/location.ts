const BOARD_STAGES = ['spark', 'refining', 'ready', 'live'] as const
type BoardStage = (typeof BOARD_STAGES)[number]

/**
 * Path routing for OCD. The Lemma app host already serves index.html for
 * unknown paths, so these URLs survive a refresh. Query-string leftovers from
 * the previous `?post=` / `?commons=` scheme still parse, then get rewritten
 * to the canonical path.
 *
 *   /                              Board (kanban)
 *   /board/spark                   Board focused on a stage
 *   /campaigns                     Campaigns list
 *   /campaigns/:id                 Campaign editor
 *   /campaigns/:cid/posts/:pid     Post stacked on a campaign
 *   /posts/:id                     Post overlay (board underneath)
 *   /commons                       Commons index
 *   /commons/:boardId              A Commons board
 *   /commons/:boardId/notes/:id    Shared note or campaign
 *   /milo                          Milo
 *   /products /calendar /skills /settings /profile
 */
export type RouteKey =
  | 'board'
  | 'campaigns'
  | 'commons'
  | 'chat'
  | 'products'
  | 'calendar'
  | 'skills'
  | 'settings'
  | 'profile'

export type BoardView = 'kanban' | BoardStage

export type AppPlace = {
  route: RouteKey
  boardView: BoardView
  postId: string | null
  campaignId: string | null
  commonsBoardId: string | null
  commonsNoteId: string | null
}

const ROUTES = new Set<string>([
  'board', 'campaigns', 'commons', 'chat', 'products', 'calendar', 'skills', 'settings', 'profile',
])
const STAGE_SET = new Set<string>(BOARD_STAGES)
const COMMONS_QUERY_KEYS = [
  'commons', 'commons_name', 'commons_description', 'commons_inviter',
  'commons_role', 'commons_emoji', 'commons_members', 'commons_notes',
  'commons_welcome', 'commons_celebrate', 'commons_preview', 'commons_note',
  'invite_preview',
]

function basePrefix(): string {
  const raw = (import.meta.env.BASE_URL || '/').trim()
  if (!raw || raw === '/') return ''
  return raw.replace(/\/+$/, '')
}

function withBase(path: string): string {
  const base = basePrefix()
  if (!base) return path || '/'
  if (path === '/') return `${base}/`
  return `${base}${path}`
}

function stripBase(pathname: string): string {
  const base = basePrefix()
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) {
    return pathname.slice(base.length) || '/'
  }
  return pathname
}

function pathPartsFrom(pathname: string): string[] {
  return stripBase(pathname).split('/').filter(Boolean).map((part) => {
    try { return decodeURIComponent(part) } catch { return part }
  })
}

function isRouteKey(value: string): value is RouteKey {
  return ROUTES.has(value)
}

export function emptyPlace(overrides: Partial<AppPlace> = {}): AppPlace {
  return {
    route: 'board',
    boardView: 'kanban',
    postId: null,
    campaignId: null,
    commonsBoardId: null,
    commonsNoteId: null,
    ...overrides,
  }
}

export function placesEqual(a: AppPlace, b: AppPlace): boolean {
  return a.route === b.route
    && a.boardView === b.boardView
    && a.postId === b.postId
    && a.campaignId === b.campaignId
    && a.commonsBoardId === b.commonsBoardId
    && a.commonsNoteId === b.commonsNoteId
}

export function placePath(place: AppPlace): string {
  if (place.postId && place.campaignId) {
    return `/campaigns/${encodeURIComponent(place.campaignId)}/posts/${encodeURIComponent(place.postId)}`
  }
  if (place.postId) return `/posts/${encodeURIComponent(place.postId)}`
  if (place.route === 'board') {
    return place.boardView !== 'kanban' ? `/board/${place.boardView}` : '/'
  }
  if (place.route === 'campaigns') {
    return place.campaignId ? `/campaigns/${encodeURIComponent(place.campaignId)}` : '/campaigns'
  }
  if (place.route === 'commons') {
    if (place.commonsBoardId && place.commonsNoteId) {
      return `/commons/${encodeURIComponent(place.commonsBoardId)}/notes/${encodeURIComponent(place.commonsNoteId)}`
    }
    if (place.commonsBoardId) return `/commons/${encodeURIComponent(place.commonsBoardId)}`
    return '/commons'
  }
  if (place.route === 'chat') return '/milo'
  return `/${place.route}`
}

export function parsePlaceFrom(pathname: string, search = ''): AppPlace {
  const parts = pathPartsFrom(pathname)
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const queryPost = params.get('post')
  const queryCommons = params.get('commons')
  const queryNote = params.get('commons_note')
  const head = parts[0] || ''

  if (head === 'posts' && parts[1]) {
    return emptyPlace({ postId: parts[1] })
  }

  if (head === 'board') {
    const view = parts[1] && STAGE_SET.has(parts[1]) ? (parts[1] as BoardStage) : 'kanban'
    return emptyPlace({ route: 'board', boardView: view, postId: queryPost })
  }

  if (head === 'campaigns') {
    const campaignId = parts[1] ? parts[1] : null
    let postId: string | null = null
    if (parts[2] === 'posts' && parts[3]) postId = parts[3]
    if (!postId && queryPost) postId = queryPost
    return emptyPlace({ route: 'campaigns', campaignId, postId })
  }

  if (head === 'commons') {
    const commonsBoardId = parts[1] || queryCommons || null
    let commonsNoteId: string | null = null
    if (parts[2] === 'notes' && parts[3]) commonsNoteId = parts[3]
    else if (queryNote) commonsNoteId = queryNote
    return emptyPlace({ route: 'commons', commonsBoardId, commonsNoteId })
  }

  if (head === 'milo' || head === 'chat') {
    return emptyPlace({ route: 'chat' })
  }

  if (isRouteKey(head)) {
    return emptyPlace({ route: head, postId: queryPost })
  }

  // Bare `/` (or an unknown path). Honor the old query-string deep links.
  if (queryCommons) {
    return emptyPlace({ route: 'commons', commonsBoardId: queryCommons, commonsNoteId: queryNote })
  }
  if (queryPost) return emptyPlace({ postId: queryPost })
  return emptyPlace()
}

export function parsePlace(): AppPlace {
  return parsePlaceFrom(window.location.pathname, window.location.search)
}

export function writePlace(place: AppPlace, opts?: { replace?: boolean }): void {
  const url = new URL(window.location.href)
  url.pathname = withBase(placePath(place))
  url.hash = ''
  url.searchParams.delete('post')
  url.searchParams.delete('commons_note')
  if (place.route !== 'commons') {
    for (const key of COMMONS_QUERY_KEYS) url.searchParams.delete(key)
  }
  const next = `${url.pathname}${url.search}${url.hash}`
  const now = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next === now) return
  if (opts?.replace) window.history.replaceState({}, '', next)
  else window.history.pushState({}, '', next)
}

export function absoluteUrl(path: string): string {
  return `${window.location.origin}${withBase(path)}`
}

export function shareUrlForPlace(place: AppPlace): string {
  return absoluteUrl(placePath(place))
}
