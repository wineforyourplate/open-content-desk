import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { TitleArea } from './editors/TitleArea'
import { DocumentEditor, type DocumentEditorHandle } from './RichText'
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Copy, Eye, FileText, Layers3, LockKeyhole, Loader2, Mail,
  PanelRight, PanelRightClose, Pencil, PenLine, Plus, Search, Share2, ShieldCheck, Target, Trash2,
  UserPlus, UsersRound, X,
} from 'lucide-react'
import { useCreateRecord, useCurrentUser, useLiveRecords, useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { flattenBlocks, isNarrowScreen, mdToBlocks, parseBlocks, parseTags, type Rec, str } from './lib'
import { plainText } from './markdown'
import { ORIGINAL_VERSION_ID, parsePostVersions, isTargetPlatform } from './versions'
import { buildNoteSnapshot } from './commonsSync'
import { PlatformIcon, VersionChips } from './platforms'
import { ReadMarkdown } from './RichText'
import { RisoArt } from './RisoArt'
import { writePostNote } from './notes'
import { Avatar, MemberAvatar, useAvatars, type ResolvedAvatar } from './avatars'
import {
  CampaignMetaChips, campaignFromCommonsNote, isCampaignStage, isCampaignType,
} from './campaignMeta'
import { CampaignCard } from './campaignCard'
import { CampaignRailSection, CampaignPostRow } from './campaignRail'
import { FormatChips, parseContentFormats } from './contentFormats'
import { SubstageChip, SubstagePicker, substageOptions } from './substages'
import { BOARD_ICON_FALLBACK, BOARD_ICONS, accentForIcon } from './boardIcons'
import { parsePlace, writePlace, emptyPlace, shareUrlForPlace, absoluteUrl } from './location'

export type CommonsInviteDescriptor = {
  boardId: string
  name: string
  description: string
  inviter: string
  role: CommonsRole
  emoji: string
  members: number
  notes: number
}

type CommonsRole = 'owner' | 'editor' | 'contributor' | 'viewer'
type Dialog = 'create-board' | 'add-note' | 'invite' | null

const ROLE_COPY: Record<CommonsRole, string> = {
  owner: 'Manage the Commons, members, and notes',
  editor: 'Add, edit, and organize shared notes',
  contributor: 'Add notes and build on the team’s thinking',
  viewer: 'Read everything shared in this Commons',
}

const DEMO_BOARDS: Rec[] = [
  { id: 'demo-growth', name: 'Growth room', description: 'Useful angles, campaign sparks, and customer language worth keeping.', emoji: '↗', accent: '#5a4ff3', owner_user_id: 'demo-me', status: 'active' },
  { id: 'demo-launch', name: 'Launch crew', description: 'The working wall for our August launch.', emoji: '✦', accent: '#e55f45', owner_user_id: 'demo-other', status: 'active' },
]
const DEMO_MEMBERS: Rec[] = [
  { id: 'm1', board_id: 'demo-growth', member_user_id: 'demo-me', email: 'you@studio.co', display_name: 'You', role: 'owner', status: 'active' },
  { id: 'm2', board_id: 'demo-growth', member_user_id: 'demo-jules', email: 'jules@studio.co', display_name: 'Jules', role: 'contributor', status: 'active' },
  { id: 'm3', board_id: 'demo-growth', member_user_id: 'demo-noor', email: 'noor@studio.co', display_name: 'Noor', role: 'editor', status: 'active' },
  { id: 'm4', board_id: 'demo-launch', member_user_id: 'demo-me', email: 'you@studio.co', display_name: 'You', role: 'contributor', status: 'active' },
]
const DEMO_NOTES: Rec[] = [
  { id: 'n1', board_id: 'demo-growth', title: 'The activation metric we are missing', body_md: 'Users are not asking for more templates. They are asking for a faster first useful result.', created_by: 'demo-jules', origin: 'direct', status: 'active', created_at: '2026-08-01T08:20:00Z' },
  { id: 'n2', board_id: 'demo-growth', title: 'Customer phrase: “my working memory”', body_md: 'Keep this exact language for the next homepage pass. It explains the product better than “content workspace.”', created_by: 'demo-noor', origin: 'direct', status: 'active', created_at: '2026-08-01T07:05:00Z' },
  { id: 'n3', board_id: 'demo-growth', title: 'Founder story — the messy middle', body_md: 'Copied from my Board so the team can shape the launch angle together.', created_by: 'demo-me', origin: 'personal_copy', source_post_id: 'private-demo', status: 'active', created_at: '2026-07-31T14:00:00Z' },
]

/** Boards this browser has already greeted the user for, so the party fires once. */
const GREETED_KEY = 'ocd:commons-greeted'
function readGreeted(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GREETED_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch { return [] }
}
function markGreeted(boardId: string) {
  try {
    localStorage.setItem(GREETED_KEY, JSON.stringify([...new Set([...readGreeted(), boardId])].slice(-60)))
  } catch { /* private mode — greeting just repeats */ }
}

function positiveInt(value: string | null) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(999, Math.round(parsed))) : 0
}

function safeRole(value: string | null): CommonsRole {
  return value === 'owner' || value === 'editor' || value === 'viewer' ? value : 'contributor'
}

export function commonsInviteFromUrl(): CommonsInviteDescriptor | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const boardId = params.get('commons') || parsePlace().commonsBoardId || ''
  if (!boardId) return null
  return {
    boardId,
    name: params.get('commons_name') || 'A shared Commons',
    description: params.get('commons_description') || 'A focused place for your team to collect and build on useful notes.',
    inviter: params.get('commons_inviter') || 'A teammate',
    role: safeRole(params.get('commons_role')),
    emoji: (params.get('commons_emoji') || '✦').slice(0, 4),
    members: positiveInt(params.get('commons_members')),
    notes: positiveInt(params.get('commons_notes')),
  }
}

function buildInviteUrl(board: Rec, inviter: string, role: CommonsRole, members: number, notes: number) {
  const boardId = str(board, 'id')
  const url = new URL(absoluteUrl(`/commons/${encodeURIComponent(boardId)}`))
  url.searchParams.set('commons', boardId)
  url.searchParams.set('commons_name', str(board, 'name'))
  url.searchParams.set('commons_description', str(board, 'description'))
  url.searchParams.set('commons_inviter', inviter)
  url.searchParams.set('commons_role', role)
  url.searchParams.set('commons_emoji', str(board, 'emoji') || '✦')
  url.searchParams.set('commons_members', String(members))
  url.searchParams.set('commons_notes', String(notes))
  url.searchParams.set('commons_welcome', '1')
  return url.toString()
}

/**
 * A direct link to one shared note or campaign — the fix for "I shared this to
 * Commons but there's no URL for it." The path is enough for a member; a
 * signed-out visitor still lands on the invite gate because the board id is in
 * the path. Invite-celebration params are omitted: this is "here's the thing,"
 * not "come join."
 */
export function buildNoteShareUrl(boardId: string, noteId: string): string {
  return shareUrlForPlace(emptyPlace({
    route: 'commons',
    commonsBoardId: boardId,
    commonsNoteId: noteId,
  }))
}

/**
 * A direct link to a Commons board. Members land on it. Signed-out visitors
 * hit the invite gate because the board id is in the path. Board identity
 * rides as query params so that gate can name the room without a table fetch.
 */
export function buildBoardShareUrl(board: Rec): string {
  const boardId = str(board, 'id')
  const url = new URL(shareUrlForPlace(emptyPlace({
    route: 'commons',
    commonsBoardId: boardId,
  })))
  const name = str(board, 'name')
  const description = str(board, 'description')
  const emoji = str(board, 'emoji')
  if (name) url.searchParams.set('commons_name', name)
  if (description) url.searchParams.set('commons_description', description)
  if (emoji) url.searchParams.set('commons_emoji', emoji)
  return url.toString()
}

/**
 * Board identity icons. `commons_boards.emoji` holds either a literal emoji or
 * one of these keys; a key renders /commons/<key>.png and falls back to the
 * emoji if that file isn't there yet, so art can be dropped in without a code change.
 */

function BoardIconPicker({ value, onPick }: { value: string; onPick: (icon: string) => void }) {
  return (
    <div className="board-icon-picker" role="radiogroup" aria-label="Board icon">
      {BOARD_ICONS.map((key) => (
        <button
          key={key} type="button" role="radio" aria-checked={value === key} title={key}
          className={value === key ? 'on' : ''}
          style={{ ['--pick-accent' as string]: accentForIcon(key) }}
          onClick={() => onPick(key)}
        >
          <BoardIcon icon={key} size={26} />
        </button>
      ))}
    </div>
  )
}

export function BoardIcon({ icon, size = 40 }: { icon: string; size?: number }) {
  const key = (icon || '').trim()
  const known = Object.prototype.hasOwnProperty.call(BOARD_ICON_FALLBACK, key)
  const [failed, setFailed] = useState(false)
  if (!known || failed) {
    return <span className="board-icon board-icon-glyph" style={{ fontSize: size * 0.78, lineHeight: 1 }}>{known ? BOARD_ICON_FALLBACK[key] : (key || '✦')}</span>
  }
  return (
    <img
      className="board-icon"
      src={`/commons/${key}.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  )
}

const CONFETTI_INKS = ['#f06445', '#5a4ff3', '#f7b267', '#3aa14a', '#ef4d92', '#4cc9f0']

/** Pure-CSS confetti burst — no dependency, and inert under prefers-reduced-motion. */
function Confetti({ count = 46 }: { count?: number }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.45,
    duration: 2.5 + Math.random() * 1.9,
    spin: (Math.random() > 0.5 ? 1 : -1) * (240 + Math.random() * 620),
    drift: (Math.random() - 0.5) * 180,
    ink: CONFETTI_INKS[i % CONFETTI_INKS.length],
    round: Math.random() > 0.66,
  })), [count])
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`confetti-bit${p.round ? ' round' : ''}`}
          style={{
            left: `${p.left}%`,
            background: p.ink,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--drift' as string]: `${p.drift}px`,
            ['--spin' as string]: `${p.spin}deg`,
          }}
        />
      ))}
    </div>
  )
}

function ordinal(n: number): string {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
}

/** The arrival beat: confetti, the board's mark, and where you've landed. */
function JoinCelebration({
  board, memberCount, onClose,
}: { board: Rec; memberCount: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const name = str(board, 'name') || 'this Commons'
  const others = Math.max(0, memberCount - 1)
  return (
    <div className="commons-celebrate" role="dialog" aria-modal="true" aria-label={`Welcome to ${name}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <Confetti />
      <section className="commons-celebrate-card">
        <span className="commons-celebrate-mark"><BoardIcon icon="popper" size={78} /></span>
        <span className="commons-celebrate-kicker">You’re in</span>
        <h1>{name}</h1>
        <p className="commons-celebrate-line">
          <span className="commons-celebrate-chip"><BoardIcon icon={str(board, 'emoji') || '✦'} size={18} /> {name}</span>
          {memberCount > 0 ? (
            <span>You’re the <strong>{ordinal(memberCount)}</strong> member{others ? <> — say hi to the other {others}.</> : <> here. Room to grow.</>}</span>
          ) : null}
        </p>
        <button className="cta commons-celebrate-go" onClick={onClose}>Take a look around <ArrowRight size={16} /></button>
      </section>
    </div>
  )
}

/** First-run orientation inside the board, after the celebration is dismissed. */
function WelcomeCard({
  board, members, noteCount, canContribute, canInvite, onAddNote, onInvite, onDismiss,
}: {
  board: Rec; members: Rec[]; noteCount: number
  canContribute: boolean; canInvite: boolean
  onAddNote: () => void; onInvite: () => void; onDismiss: () => void
}) {
  return (
    <section className="commons-welcome">
      <button className="commons-welcome-x" onClick={onDismiss} aria-label="Dismiss welcome"><X size={15} /></button>
      <div className="commons-welcome-head">
        <span className="commons-welcome-mark"><BoardIcon icon={str(board, 'emoji') || '✦'} size={44} /></span>
        <div>
          <span className="commons-welcome-kicker">Welcome to</span>
          <h2>{str(board, 'name')}</h2>
          <p>{str(board, 'description') || 'A focused shared board.'}</p>
        </div>
      </div>
      <div className="commons-welcome-actions">
        <div className="commons-welcome-tile">
          <BookOpen size={17} />
          <b>{noteCount} shared {noteCount === 1 ? 'note' : 'notes'}</b>
          <span>{noteCount ? 'Have a read before you add.' : 'Nothing here yet — be first.'}</span>
        </div>
        {canContribute ? (
          <button className="commons-welcome-tile is-action" onClick={onAddNote}>
            <PenLine size={17} />
            <b>Add your first note</b>
            <span>Write one, or copy from your Board.</span>
          </button>
        ) : null}
        {canInvite ? (
          <button className="commons-welcome-tile is-action" onClick={onInvite}>
            <UserPlus size={17} />
            <b>Bring someone in</b>
            <span>{members.length} {members.length === 1 ? 'person' : 'people'} here so far.</span>
          </button>
        ) : (
          <div className="commons-welcome-tile">
            <UsersRound size={17} />
            <b>Who’s here</b>
            <span>{members.slice(0, 3).map((m) => memberLabel(m)).join(', ') || 'Just you for now.'}</span>
          </div>
        )}
      </div>
      <div className="commons-welcome-trust"><LockKeyhole size={14} /> Your personal Board stays private. Only what you copy here is shared.</div>
    </section>
  )
}

function memberLabel(member: Rec) {
  return str(member, 'display_name') || str(member, 'email').split('@')[0] || 'Member'
}

function initials(value: string) {
  const bits = value.trim().split(/\s+/).filter(Boolean)
  if (!bits.length) return '?'
  return `${bits[0]?.[0] || ''}${bits.length > 1 ? bits[bits.length - 1]?.[0] || '' : ''}`.toUpperCase()
}

function formatRelative(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 'Recently'
  const minutes = Math.max(1, Math.round((Date.now() - time) / 60000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function CommonsInviteGate({
  invite, mode, onPrimary, primaryLabel, busy = false, userEmail, onSwitchAccount,
}: {
  invite: CommonsInviteDescriptor
  mode: 'signin' | 'access'
  onPrimary: () => void | Promise<unknown>
  primaryLabel: string
  busy?: boolean
  userEmail?: string | null
  onSwitchAccount?: () => void | Promise<unknown>
}) {
  return (
    <main className="commons-gate">
      <div className="commons-gate-brand"><img src="/ocd-folder.png" alt="" aria-hidden="true" /><span>OCD</span><i />Commons</div>
      <section className="commons-gate-stage">
        <div className="commons-invite-copy">
          <div className="commons-kicker"><span>{invite.emoji}</span> Invitation to Commons</div>
          <h1>{invite.inviter} invited you to <em>{invite.name}</em></h1>
          <p className="commons-invite-purpose">{invite.description}</p>
          <div className="commons-trust-card">
            <ShieldCheck size={20} />
            <div><strong>Your private Board stays private.</strong><span>Only notes someone deliberately copies into Commons become visible here.</span></div>
          </div>
        </div>

        <div className="commons-invite-preview" aria-label="Commons invitation preview">
          <div className="commons-preview-window">
            <header>
              <span className="commons-preview-mark">{invite.emoji}</span>
              <div><strong>{invite.name}</strong><small>{invite.members || 'A few'} members · {invite.notes || 'New'} notes</small></div>
              <span className="commons-role-pill">{invite.role}</span>
            </header>
            <div className="commons-preview-lines">
              <span><FileText size={15} /><i /></span>
              <span><FileText size={15} /><i /></span>
              <span><FileText size={15} /><i /></span>
            </div>
            <div className="commons-preview-lock"><LockKeyhole size={15} /> Notes appear after you join</div>
          </div>
          <div className="commons-invite-action">
            <span className="commons-invite-role"><Check size={15} /> Join as {invite.role}</span>
            <p>{ROLE_COPY[invite.role]}.</p>
            {userEmail ? <div className="commons-signed-identity"><span>{initials(userEmail)}</span><div><small>Continuing as</small><strong>{userEmail}</strong></div></div> : null}
            <button className="commons-join" disabled={busy} onClick={() => void onPrimary()}>
              {busy ? 'Checking…' : primaryLabel} <ArrowRight size={17} />
            </button>
            {mode === 'signin' ? <small>Secure sign-in and access are handled by Lemma.</small> : null}
            {mode === 'access' && onSwitchAccount ? <button className="commons-switch" onClick={() => void onSwitchAccount()}>Use a different account</button> : null}
          </div>
        </div>
      </section>
    </main>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="commons-modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="commons-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="x-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        {children}
      </section>
    </div>
  )
}

/**
 * Opens as soon as Share is clicked — copies the link immediately (best-effort;
 * clipboard-write can be denied by the browser, e.g. inside an embedded preview)
 * and shows the URL either way so there's always a manual fallback via select+copy.
 */
function ShareLinkModal({
  label, url, onClose, privacy,
}: {
  label: string
  url: string
  onClose: () => void
  privacy?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => undefined)
  }, [url])
  async function copyAgain() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch { /* clipboard blocked — the visible link is the fallback */ }
  }
  return (
    <Modal title="Share link" onClose={onClose}>
      <div className="commons-modal-body">
        <p className="commons-share-copy">{copied ? <><Check size={14} /> Link copied — paste it anywhere.</> : `Copy this link to share “${label}.”`}</p>
        <div className="commons-share-row">
          <input readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          <button className="ghost" onClick={() => void copyAgain()}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div className="commons-privacy-note"><LockKeyhole size={15} /> {privacy || 'Only people already in this Commons can open it.'}</div>
      </div>
      <footer><button className="cta" onClick={onClose}>Done</button></footer>
    </Modal>
  )
}

export function Commons({ posts }: { posts: Rec[] }) {
  const preview = new URLSearchParams(window.location.search).get('commons_preview') === '1'
  const invite = commonsInviteFromUrl()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [previewBoards, setPreviewBoards] = useState<Rec[]>(DEMO_BOARDS)
  const [previewMembers, setPreviewMembers] = useState<Rec[]>(DEMO_MEMBERS)
  const [previewNotes, setPreviewNotes] = useState<Rec[]>(DEMO_NOTES)
  // '' means the index (grid of boards); a board id means you've entered it.
  // Deliberately NOT falling back to visibleBoards[0] below — an empty id is a
  // real state (the index), not "no selection yet".
  const [enteredId, setEnteredId] = useState(() => parsePlace().commonsBoardId || invite?.boardId || '')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [selectedNote, setSelectedNote] = useState<Rec | null>(null)
  // A note id riding on the URL (from a copied share link), consumed once that
  // note shows up in the live `notes` query — cleared as soon as it's opened so
  // it doesn't re-trigger after the viewer picks something else.
  const [pendingNoteId, setPendingNoteId] = useState(() => parsePlace().commonsNoteId || '')
  const [celebrateId, setCelebrateId] = useState('')
  const [welcomeId, setWelcomeId] = useState('')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'notes' | 'campaigns'>('notes')
  const [search, setSearch] = useState('')
  const [feedback, setFeedback] = useState('')
  const [boardShareOpen, setBoardShareOpen] = useState(false)
  // ?commons_welcome=1 rides on invite links; ?commons_celebrate=1 replays the
  // greeting for design review without needing a second account.
  const greetParams = new URLSearchParams(window.location.search)
  const welcomeParam = greetParams.get('commons_welcome') === '1'
  const celebrateParam = greetParams.get('commons_celebrate') === '1'

  const { user } = useCurrentUser({ client: lemmaClient })
  const { resolve: resolveAvatar } = useAvatars()
  const boardsQuery = useLiveRecords({ client: lemmaClient, tableName: 'commons_boards', enabled: !preview })
  const membersQuery = useLiveRecords({ client: lemmaClient, tableName: 'commons_members', enabled: !preview })
  const notesQuery = useLiveRecords({ client: lemmaClient, tableName: 'commons_notes', enabled: !preview })
  const { create: createBoardRecord, isSubmitting: creatingBoard } = useCreateRecord({ client: lemmaClient, tableName: 'commons_boards', enabled: !preview })
  const { create: createMemberRecord } = useCreateRecord({ client: lemmaClient, tableName: 'commons_members', enabled: !preview })
  const { create: createNoteRecord, isSubmitting: creatingNote } = useCreateRecord({ client: lemmaClient, tableName: 'commons_notes', enabled: !preview })
  const { update: updateMemberRecord } = useUpdateRecord({ client: lemmaClient, tableName: 'commons_members', enabled: !preview })
  const { update: updateBoardRecord } = useUpdateRecord({ client: lemmaClient, tableName: 'commons_boards', enabled: !preview })
  const { update: updateNoteRecord } = useUpdateRecord({ client: lemmaClient, tableName: 'commons_notes', enabled: !preview })

  const boards = preview ? previewBoards : boardsQuery.records as Rec[]
  const members = preview ? previewMembers : membersQuery.records as Rec[]
  const notes = preview ? previewNotes : notesQuery.records as Rec[]
  const userId = preview ? 'demo-me' : str(user as unknown as Rec, 'id')
  const userEmail = preview ? 'you@studio.co' : str(user as unknown as Rec, 'email').toLowerCase()
  const userName = preview ? 'You' : [str(user as unknown as Rec, 'first_name'), str(user as unknown as Rec, 'last_name')].filter(Boolean).join(' ') || userEmail.split('@')[0]

  const myMemberships = useMemo(() => members.filter((member) => {
    if (str(member, 'status') === 'revoked') return false
    return str(member, 'member_user_id') === userId || str(member, 'email').toLowerCase() === userEmail
  }), [members, userEmail, userId])
  const myBoardIds = useMemo(() => new Set(myMemberships.map((member) => str(member, 'board_id'))), [myMemberships])
  const visibleBoards = boards.filter((board) => str(board, 'status') !== 'archived' && (myBoardIds.has(str(board, 'id')) || str(board, 'owner_user_id') === userId))
  const activeBoard = visibleBoards.find((board) => str(board, 'id') === enteredId) || null
  const activeId = str(activeBoard, 'id')
  const ownerId = str(activeBoard, 'owner_user_id')
  const activeMembers = members.filter((member) => str(member, 'board_id') === activeId && str(member, 'status') !== 'revoked')
  const activeMembership = myMemberships.find((member) => str(member, 'board_id') === activeId)
  const currentRole = (str(activeMembership, 'role') || (str(activeBoard, 'owner_user_id') === userId ? 'owner' : 'viewer')) as CommonsRole
  const canContribute = currentRole !== 'viewer'
  const canInvite = currentRole === 'owner' || currentRole === 'editor'
  const boardNotes = notes.filter((note) => str(note, 'board_id') === activeId && str(note, 'status') !== 'archived')
  // Posts shared as part of a campaign live INSIDE that campaign's card, not
  // loose in the grid — otherwise sharing one campaign floods the board with N
  // extra cards and buries everything else.
  const topLevelNotes = boardNotes.filter((note) => !str(note, 'campaign_group_id'))
  const activeNotes = topLevelNotes
    .filter((note) => `${str(note, 'title')} ${str(note, 'body_md')}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => str(b, 'created_at').localeCompare(str(a, 'created_at')))
  const postsInCampaign = (campaignNoteId: string) => boardNotes
    .filter((note) => str(note, 'campaign_group_id') === campaignNoteId)
    .sort((a, b) => str(a, 'created_at').localeCompare(str(b, 'created_at')))
  // Campaigns and notes are different objects wearing the same card shape — kept
  // as separate tabs (not a mixed grid) so a campaign is findable at a glance.
  // Tab badges use the UNFILTERED counts so they don't jump around as you type
  // a search; the grid itself uses the search-filtered, tab-picked list below.
  const allCampaigns = topLevelNotes.filter((note) => str(note, 'kind') === 'campaign')
  const allPlainNotes = topLevelNotes.filter((note) => str(note, 'kind') !== 'campaign')
  const boardCampaigns = activeNotes.filter((note) => str(note, 'kind') === 'campaign')
  const boardPlainNotes = activeNotes.filter((note) => str(note, 'kind') !== 'campaign')
  const tabNotes = activeTab === 'campaigns' ? boardCampaigns : boardPlainNotes

  function renderNoteCard(note: Rec) {
    const creator = members.find((member) => str(member, 'member_user_id') === str(note, 'created_by') && str(member, 'board_id') === activeId)
    const snippet = plainText(str(note, 'body_md'))
    const isCampaign = str(note, 'kind') === 'campaign'
    if (isCampaign) {
      const inside = postsInCampaign(str(note, 'id'))
      return (
        <CampaignCard
          key={str(note, 'id')}
          campaign={campaignFromCommonsNote(note)}
          postCount={inside.length}
          onOpen={() => openCommonsNote(note)}
          who={(
            <>
              <MemberAvatar
                userId={str(note, 'created_by')}
                email={str(creator || {}, 'email')}
                size={22}
                resolve={resolveAvatar}
                className="commons-note-author"
              />
              <span>{memberLabel(creator || {})}</span>
              <time>{formatRelative(str(note, 'created_at'))}</time>
            </>
          )}
        />
      )
    }
    return <button className="commons-note-card" key={str(note, 'id')} onClick={() => openCommonsNote(note)}>
      <span className="commons-note-art">
        <RisoArt seed={str(note, 'id') || str(note, 'title')} className="commons-note-art-svg" />
      </span>
      <span className="commons-note-body">
        <span className="commons-note-origin">
          {str(note, 'origin') === 'personal_copy' ? <><Copy size={12} /> copied from a personal Board</> : <><FileText size={12} /> shared note</>}
        </span>
        <strong>{str(note, 'title') || 'Untitled'}</strong>
        <p>{snippet || 'No body yet.'}</p>
        <span className="commons-note-chips">
          <VersionChips post={note} />
        </span>
        <footer>
          <MemberAvatar
            userId={str(note, 'created_by')}
            email={str(creator || {}, 'email')}
            size={22}
            resolve={resolveAvatar}
            className="commons-note-author"
          />
          <span>{memberLabel(creator || {})}</span>
          <time>{formatRelative(str(note, 'created_at'))}</time>
        </footer>
      </span>
    </button>
  }

  const claimed = useRef(new Set<string>())
  useEffect(() => {
    if (preview || !userId || !userEmail) return
    const pending = members.filter((member) => str(member, 'status') === 'invited' && str(member, 'email').toLowerCase() === userEmail && !claimed.current.has(str(member, 'id')))
    if (!pending.length) return
    pending.forEach((member) => claimed.current.add(str(member, 'id')))
    void Promise.all(pending.map((member) => updateMemberRecord({
      member_user_id: userId, display_name: userName, status: 'active', joined_at: new Date().toISOString(),
    }, { recordId: str(member, 'id') }))).then(() => void membersQuery.refresh())
  }, [members, membersQuery, preview, updateMemberRecord, userEmail, userId, userName])

  useEffect(() => {
    if (!activeId) return
    localStorage.setItem('ocd:active-commons', activeId)
  }, [activeId])

  // Default to whichever tab actually has something in it, so arriving at a
  // campaigns-only board doesn't land on an empty Notes tab.
  useEffect(() => {
    if (!activeId) return
    setActiveTab(allPlainNotes.length === 0 && allCampaigns.length > 0 ? 'campaigns' : 'notes')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  function syncCommonsPlace(boardId: string, noteId: string | null) {
    writePlace(emptyPlace({
      route: 'commons',
      commonsBoardId: boardId || null,
      commonsNoteId: noteId,
    }))
  }

  function enterBoard(id: string) {
    setEnteredId(id)
    setSwitcherOpen(false)
    setSelectedNote(null)
    syncCommonsPlace(id, null)
  }
  function exitToIndex() {
    setEnteredId('')
    setSelectedNote(null)
    localStorage.removeItem('ocd:active-commons')
    syncCommonsPlace('', null)
  }

  function openCommonsNote(note: Rec) {
    setSelectedNote(note)
    const boardId = enteredId || str(activeBoard, 'id')
    if (boardId) syncCommonsPlace(boardId, str(note, 'id') || null)
  }

  // Keep an open note in step with the live record after an edit or a re-share,
  // otherwise the reader keeps rendering the snapshot it opened with.
  useEffect(() => {
    if (!selectedNote) return
    const fresh = notes.find((note) => str(note, 'id') === str(selectedNote, 'id'))
    if (fresh && fresh !== selectedNote) setSelectedNote(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes])

  // A copied note/campaign link lands here as `/commons/:board/notes/:id` (or
  // the older `?commons_note=`). Open it as soon as that record shows up in the
  // live query — it may not be there on the first render while notes are loading.
  useEffect(() => {
    if (!pendingNoteId || preview) return
    const match = notes.find((note) => str(note, 'id') === pendingNoteId && str(note, 'status') !== 'archived')
    if (match) {
      setSelectedNote(match)
      setPendingNoteId('')
    }
  }, [notes, pendingNoteId, preview])

  function closeSelectedNote() {
    setSelectedNote(null)
    if (enteredId) syncCommonsPlace(enteredId, null)
    else writePlace(emptyPlace({ route: 'commons' }))
  }

  useEffect(() => {
    const sync = () => {
      const place = parsePlace()
      if (place.route !== 'commons') return
      setEnteredId(place.commonsBoardId || '')
      if (place.commonsNoteId) setPendingNoteId(place.commonsNoteId)
      else setSelectedNote(null)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  // Greet on arrival at a board you've joined — driven by membership, not by URL
  // params, so it also fires for people added straight to the pod/org (who never
  // click an invite link). Once per board per browser.
  useEffect(() => {
    if (!activeId || !userId || !activeBoard) return
    const forced = celebrateParam || welcomeParam
    if (!forced) {
      if (readGreeted().includes(activeId)) return
      // You made this board — no party for your own housewarming.
      if (str(activeBoard, 'owner_user_id') === userId) { markGreeted(activeId); return }
    }
    markGreeted(activeId)
    setCelebrateId(activeId)
    setWelcomeId(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, userId, ownerId, celebrateParam, welcomeParam])

  function clearGreetingParams() {
    const url = new URL(window.location.href)
    url.searchParams.delete('commons_welcome')
    url.searchParams.delete('commons_celebrate')
    window.history.replaceState({}, '', url)
  }
  function dismissCelebration() {
    setCelebrateId('')
    clearGreetingParams()
  }
  function dismissWelcome() {
    setWelcomeId('')
    clearGreetingParams()
  }

  /**
   * Save an edit to a shared note. The Commons copy always updates (commons_notes
   * is a shared, RLS-off table). The private origin is ALSO updated — but only
   * when the editor is the person who shared it, because `posts` is RLS-on:
   * another member cannot see or write someone else's post, and pod functions are
   * delegated rather than elevated, so there is no server-side escape hatch.
   * Returns whether the origin was synced, so the UI can say so honestly.
   */
  async function saveSharedNote(note: Rec, next: { title: string; blocks: Rec[] }): Promise<boolean> {
    const noteId = str(note, 'id')
    if (!noteId) return false
    const body = flattenBlocks(next.blocks)
    if (preview) {
      setPreviewNotes((value) => value.map((n) => str(n, 'id') === noteId ? { ...n, title: next.title, blocks: next.blocks, body_md: body } : n))
      return false
    }
    await updateNoteRecord({ title: next.title, blocks: next.blocks, body_md: body, updated_by: userId }, { recordId: noteId })
    await notesQuery.refresh()

    const sourcePostId = str(note, 'source_post_id')
    const mine = !!userId && str(note, 'created_by') === userId
    if (!sourcePostId || !mine) return false
    try {
      const versionId = str(note, 'source_version_id')
      const raw = (await lemmaClient.records.get('posts', sourcePostId)) as Rec
      const post = (raw && raw['data'] ? raw['data'] : raw) as Rec
      const patch: Rec = (!versionId || versionId === ORIGINAL_VERSION_ID)
        ? { title: next.title, blocks: next.blocks, body_md: body }
        // The share was a single platform version — write back into that entry.
        : {
            versions: parsePostVersions(post['versions']).map((version) => version.id === versionId
              ? { ...version, title: next.title, blocks: next.blocks, body_md: body, updated_at: new Date().toISOString() }
              : version),
          }
      await lemmaClient.records.update('posts', sourcePostId, patch)
      // Keep the /notes/<id>.md RAG mirror in step with the post we just changed.
      try {
        const merged = { ...post, ...patch, id: sourcePostId }
        const name = async (table: string, id: string) => {
          if (!id) return ''
          const row = (await lemmaClient.records.get(table, id)) as Rec
          return str((row && row['data'] ? row['data'] : row) as Rec, 'name')
        }
        await writePostNote(merged, {
          product: await name('products', str(post, 'product_id')),
          campaign: await name('campaigns', str(post, 'campaign_id')),
        })
      } catch { /* mirror is best-effort */ }
      return true
    } catch {
      return false // origin not writable (not yours) — the Commons copy still saved
    }
  }

  /**
   * Move a shared piece's production step from Commons. The shared row always
   * updates so the whole board sees it; the private post is written too, but
   * only when the editor is the person who shared it — `posts` is RLS-on, so
   * another member cannot write someone else's row. Same rule as `saveSharedNote`
   * above, and the same reason: without the write-through the next private save
   * would push the post's old step straight back over this one.
   */
  async function saveSharedSubstage(note: Rec, next: string) {
    const noteId = str(note, 'id')
    if (!noteId) return
    const value = next || null
    if (preview) {
      setPreviewNotes((items) => items.map((n) => str(n, 'id') === noteId ? { ...n, substage: value } : n))
      return
    }
    await updateNoteRecord({ substage: value, updated_by: userId }, { recordId: noteId })
    await notesQuery.refresh()
    const sourcePostId = str(note, 'source_post_id')
    const mine = !!userId && str(note, 'created_by') === userId
    if (!sourcePostId || !mine) return
    try { await lemmaClient.records.update('posts', sourcePostId, { substage: value }) }
    catch { /* origin not writable — the shared copy still moved */ }
  }

  /**
   * Remove a shared note. Soft delete via `status: 'archived'` — the column the
   * schema already provides and `activeNotes` already filters on — so a note can
   * be recovered if someone removes the wrong one. The private original is a
   * separate record and is never touched.
   */
  async function removeSharedNote(note: Rec) {
    const noteId = str(note, 'id')
    if (!noteId) return
    const label = str(note, 'title') || 'Untitled'
    if (!window.confirm(`Remove “${label}” from ${str(activeBoard, 'name')}?\n\nIt disappears for everyone on this board. Any private original in someone's own Board is untouched.`)) return
    if (preview) setPreviewNotes((value) => value.filter((n) => str(n, 'id') !== noteId))
    else {
      await updateNoteRecord({ status: 'archived', updated_by: userId }, { recordId: noteId })
      await notesQuery.refresh()
    }
    closeSelectedNote()
    setFeedback(`Removed “${label}” from ${str(activeBoard, 'name')}.`)
  }

  /**
   * Remove a shared campaign AND the posts shared with it — leaving the children
   * behind would strand them: they're filtered out of the grid, so they'd exist
   * on the board with nothing to open them from. Soft delete throughout.
   */
  async function removeSharedCampaign(campaignNote: Rec) {
    const noteId = str(campaignNote, 'id')
    if (!noteId) return
    const label = str(campaignNote, 'title') || 'Untitled campaign'
    const children = postsInCampaign(noteId)
    const tail = children.length
      ? `\n\nThe ${children.length} ${children.length === 1 ? 'post shared with it is' : 'posts shared with it are'} removed too.`
      : ''
    if (!window.confirm(`Remove “${label}” from ${str(activeBoard, 'name')}?${tail}\n\nIt disappears for everyone on this board. Your private campaign and posts are untouched.`)) return
    if (preview) {
      setPreviewNotes((value) => value.filter((n) => str(n, 'id') !== noteId && str(n, 'campaign_group_id') !== noteId))
    } else {
      for (const child of children) {
        await updateNoteRecord({ status: 'archived', updated_by: userId }, { recordId: str(child, 'id') })
      }
      await updateNoteRecord({ status: 'archived', updated_by: userId }, { recordId: noteId })
      await notesQuery.refresh()
    }
    closeSelectedNote()
    setFeedback(`Removed “${label}” from ${str(activeBoard, 'name')}.`)
  }

  async function changeBoardIcon(icon: string) {
    setIconPickerOpen(false)
    if (!activeId) return
    const accent = accentForIcon(icon)
    if (preview) {
      setPreviewBoards((value) => value.map((b) => str(b, 'id') === activeId ? { ...b, emoji: icon, accent } : b))
      return
    }
    await updateBoardRecord({ emoji: icon, accent }, { recordId: activeId })
    await boardsQuery.refresh()
  }

  async function createBoard(name: string, description: string, icon: string) {
    if (!name.trim() || !userId) return
    const accent = accentForIcon(icon)
    if (preview) {
      const id = `demo-${Date.now()}`
      setPreviewBoards((value) => [...value, { id, name: name.trim(), description: description.trim(), emoji: icon, accent, owner_user_id: userId, status: 'active' }])
      setPreviewMembers((value) => [...value, { id: `member-${id}`, board_id: id, member_user_id: userId, email: userEmail, display_name: userName, role: 'owner', status: 'active', invited_by: userId }])
      enterBoard(id)
      setDialog(null)
      return
    }
    const created = await createBoardRecord({ name: name.trim(), description: description.trim(), emoji: icon, accent, owner_user_id: userId, status: 'active' })
    if (!created) return
    const boardId = str(created as Rec, 'id')
    await createMemberRecord({ board_id: boardId, member_user_id: userId, email: userEmail, display_name: userName, role: 'owner', status: 'active', invited_by: userId, joined_at: new Date().toISOString() })
    await Promise.all([boardsQuery.refresh(), membersQuery.refresh()])
    enterBoard(boardId)
    setDialog(null)
  }

  async function addDirectNote(title: string, body: string) {
    if (!activeBoard || !title.trim() || !canContribute) return
    const payload = { board_id: activeId, title: title.trim(), body_md: body.trim(), blocks: mdToBlocks(body.trim()), created_by: userId, updated_by: userId, origin: 'direct', status: 'active' }
    if (preview) setPreviewNotes((value) => [{ id: `note-${Date.now()}`, created_at: new Date().toISOString(), ...payload }, ...value])
    else { await createNoteRecord(payload); await notesQuery.refresh() }
    setDialog(null)
    setFeedback(`Added to ${str(activeBoard, 'name')}.`)
  }

  async function sharePersonalNote(postId: string, versionId: string) {
    const post = posts.find((item) => str(item, 'id') === postId)
    if (!post || !activeBoard || !canContribute) return
    // 'original' means share ALL versions: the note carries the full versions
    // array so Commons can show the same switcher as the Board. A specific id
    // shares just that one variant. buildNoteSnapshot is the SAME function the
    // auto-sync-on-save path uses, so a manual (re-)share and a live update
    // always produce identical content.
    const payload = {
      board_id: activeId,
      ...buildNoteSnapshot(post, versionId),
      tags: parseTags(post['tags']),
      created_by: userId,
      updated_by: userId,
      origin: 'personal_copy',
      source_post_id: postId,
      source_version_id: versionId,
      status: 'active',
    }
    // One shared note per post per board: re-sharing refreshes the snapshot in
    // place instead of stacking duplicates.
    const existing = notes.find((note) => str(note, 'board_id') === activeId
      && str(note, 'source_post_id') === postId
      && str(note, 'status') !== 'archived')
    if (preview) {
      setPreviewNotes((value) => existing
        ? value.map((n) => str(n, 'id') === str(existing, 'id') ? { ...n, ...payload } : n)
        : [{ id: `note-${Date.now()}`, created_at: new Date().toISOString(), ...payload }, ...value])
    } else if (existing) {
      await updateNoteRecord(payload, { recordId: str(existing, 'id') })
      await notesQuery.refresh()
    } else {
      await createNoteRecord(payload)
      await notesQuery.refresh()
    }
    setDialog(null)
    setFeedback(existing
      ? `Updated in ${str(activeBoard, 'name')} — it was already shared here.`
      : `Copied to ${str(activeBoard, 'name')}. Your original is still private.`)
  }

  async function inviteMember(emailInput: string, role: CommonsRole) {
    const email = emailInput.trim().toLowerCase()
    if (!activeBoard || !email || !canInvite) return
    if (activeMembers.some((member) => str(member, 'email').toLowerCase() === email && str(member, 'status') !== 'revoked')) {
      setFeedback(`${email} is already in ${str(activeBoard, 'name')}.`)
      return
    }
    const link = buildInviteUrl(activeBoard, userName || userEmail, role, activeMembers.length + 1, activeNotes.length)
    if (preview) {
      setPreviewMembers((value) => [...value, { id: `member-${Date.now()}`, board_id: activeId, email, display_name: email.split('@')[0], role, status: 'invited', invited_by: userId }])
      await navigator.clipboard?.writeText(link)
      setDialog(null)
      setFeedback(`Invite ready for ${email}. Context link copied.`)
      return
    }

    try {
      const podId = lemmaClient.podId
      if (!podId) throw new Error('Pod context is missing.')
      let invitedUserId = ''
      let status = 'invited'
      let nativeInvitationId = ''
      try {
        const existing = await lemmaClient.podMembers.lookupByEmail(podId, email)
        invitedUserId = existing.user_id
        status = 'active'
      } catch {
        const pod = await lemmaClient.pods.get(podId)
        const orgMembers = await lemmaClient.organizations.members.list(pod.organization_id, { limit: 200 })
        const orgMember = orgMembers.items.find((member) => member.user?.email?.toLowerCase() === email)
        const podRole = role === 'viewer' ? 'POD_VIEWER' : 'POD_USER'
        if (orgMember) {
          const added = await lemmaClient.podMembers.add(podId, { organization_member_id: orgMember.id, roles: [podRole] })
          invitedUserId = added.user_id
          status = 'active'
        } else {
          const payload = { email, role: 'ORG_MEMBER', pod_id: podId, pod_role: podRole, redirect_uri: link } as Parameters<typeof lemmaClient.organizations.invitations.invite>[1]
          const nativeInvite = await lemmaClient.organizations.invitations.invite(pod.organization_id, payload)
          nativeInvitationId = nativeInvite.id
        }
      }
      await createMemberRecord({ board_id: activeId, member_user_id: invitedUserId || undefined, email, display_name: email.split('@')[0], role, status, invited_by: userId, native_invitation_id: nativeInvitationId || undefined, joined_at: status === 'active' ? new Date().toISOString() : undefined })
      await membersQuery.refresh()
      await navigator.clipboard?.writeText(link)
      setDialog(null)
      setFeedback(status === 'active' ? `${email} joined ${str(activeBoard, 'name')}. Context link copied.` : `Invite sent to ${email}. Context link copied.`)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not send this invite. A pod admin may need to invite them.')
    }
  }

  const setupError = !preview && (boardsQuery.error || membersQuery.error || notesQuery.error)
  const busy = !preview && (boardsQuery.isLoading || membersQuery.isLoading || notesQuery.isLoading)
  const accent = /^#[0-9a-f]{6}$/i.test(str(activeBoard, 'accent')) ? str(activeBoard, 'accent') : '#5a4ff3'
  const pageStyle = { '--commons-accent': accent } as CSSProperties

  // Per-board summaries for the index grid and the header's board switcher —
  // both need "how much is in here" without entering the board first.
  function boardNoteCount(boardId: string) {
    return notes.filter((note) => str(note, 'board_id') === boardId && str(note, 'status') !== 'archived'
      && !str(note, 'campaign_group_id') && str(note, 'kind') !== 'campaign').length
  }
  function boardCampaignCount(boardId: string) {
    return notes.filter((note) => str(note, 'board_id') === boardId && str(note, 'status') !== 'archived' && str(note, 'kind') === 'campaign').length
  }
  function boardMembersOf(boardId: string) {
    return members.filter((member) => str(member, 'board_id') === boardId && str(member, 'status') !== 'revoked')
  }
  function boardLastActivity(boardId: string) {
    const stamps = notes.filter((note) => str(note, 'board_id') === boardId && str(note, 'status') !== 'archived')
      .map((note) => str(note, 'created_at')).filter(Boolean).sort()
    return stamps[stamps.length - 1] || ''
  }

  return (
    <div className="main commons-page" style={pageStyle}>
      <header className="topbar commons-topbar">
        {activeBoard ? (
          <div className="commons-crumb">
            <button className="commons-back" onClick={exitToIndex} title="All Commons boards" aria-label="All Commons boards"><ArrowLeft size={17} /></button>
            <div className="commons-board-switch">
              <button className="commons-board-switch-trigger" onClick={() => setSwitcherOpen((open) => !open)} aria-expanded={switcherOpen}>
                <BoardIcon icon={str(activeBoard, 'emoji') || '✦'} size={20} />
                <strong>{str(activeBoard, 'name')}</strong>
                <ChevronDown size={14} />
              </button>
              {switcherOpen ? (
                <>
                  <span className="board-icon-scrim" onClick={() => setSwitcherOpen(false)} />
                  <div className="commons-switch-pop" role="menu" aria-label="Switch Commons board">
                    {visibleBoards.map((board) => {
                      const id = str(board, 'id')
                      const noteCount = boardNoteCount(id)
                      const campaignCount = boardCampaignCount(id)
                      return (
                        <button key={id} className={`commons-switch-item${id === activeId ? ' on' : ''}`} onClick={() => enterBoard(id)}>
                          <BoardIcon icon={str(board, 'emoji') || '✦'} size={22} />
                          <span>
                            <strong>{str(board, 'name')}</strong>
                            <small>
                              {campaignCount ? `${campaignCount} ${campaignCount === 1 ? 'campaign' : 'campaigns'} · ` : ''}
                              {noteCount} {noteCount === 1 ? 'note' : 'notes'}
                            </small>
                          </span>
                        </button>
                      )
                    })}
                    <button className="commons-switch-item commons-switch-create" onClick={() => { setSwitcherOpen(false); setDialog('create-board') }}>
                      <Plus size={16} /> Create a Commons
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="commons-title"><UsersRound size={18} /><strong>Commons</strong><span>shared on purpose</span></div>
        )}
        <button className="ghost" onClick={() => setDialog('create-board')}><Plus size={15} /> New Commons</button>
      </header>

      {feedback ? <div className="commons-feedback"><Check size={15} />{feedback}<button onClick={() => setFeedback('')}><X size={14} /></button></div> : null}
      <section className="commons-canvas">
        {busy ? <div className="commons-loading"><i /><i /><i /></div> : setupError ? (
          <div className="commons-empty"><span className="commons-empty-mark">✦</span><h2>Commons is ready in the app</h2><p>Import the three Commons tables to connect this screen to the pod.</p></div>
        ) : !activeBoard ? (
          enteredId ? (
            <div className="commons-empty"><span className="commons-empty-mark">✦</span><h2>This board isn’t available</h2><p>You may have lost access, or it’s been archived.</p><button className="cta" onClick={exitToIndex}><ArrowLeft size={15} /> Back to Commons</button></div>
          ) : visibleBoards.length ? (
            <div className="commons-index">
              <div className="commons-index-grid">
                {visibleBoards.map((board) => {
                  const id = str(board, 'id')
                  const noteCount = boardNoteCount(id)
                  const campaignCount = boardCampaignCount(id)
                  const boardMembers = boardMembersOf(id)
                  const last = boardLastActivity(id)
                  return (
                    <button key={id} className="commons-index-card" onClick={() => enterBoard(id)}>
                      <span className="commons-index-mark"><BoardIcon icon={str(board, 'emoji') || '✦'} size={34} /></span>
                      <span className="commons-index-body">
                        <strong>{str(board, 'name')}</strong>
                        <p>{str(board, 'description') || 'A focused shared board.'}</p>
                      </span>
                      <span className="commons-index-foot">
                        <span className="commons-index-avatars" aria-label={`${boardMembers.length} members`}>
                          {boardMembers.slice(0, 4).map((member) => (
                            <MemberAvatar
                              key={str(member, 'id')}
                              userId={str(member, 'member_user_id')}
                              email={str(member, 'email')}
                              label={memberLabel(member)}
                              size={23}
                              resolve={resolveAvatar}
                            />
                          ))}
                          {boardMembers.length > 4 ? <span className="commons-index-avatars-more">+{boardMembers.length - 4}</span> : null}
                        </span>
                        <span className="commons-index-counts">
                          {campaignCount ? <span><Target size={11} /> {campaignCount}</span> : null}
                          <span><FileText size={11} /> {noteCount}</span>
                          {last ? <time>{formatRelative(last)}</time> : null}
                        </span>
                      </span>
                    </button>
                  )
                })}
                <button className="commons-index-card commons-index-create" onClick={() => setDialog('create-board')}>
                  <Plus size={22} />
                  <strong>Create a Commons</strong>
                  <span>Start a new shared board for the team.</span>
                </button>
              </div>
              <div className="commons-index-trust"><LockKeyhole size={14} /><span>Personal Board notes stay private until you copy them here.</span></div>
            </div>
          ) : (
            <div className="commons-empty"><span className="commons-empty-mark">✦</span><h2>Make a place for shared thinking</h2><p>A Commons can be the team’s one shared board—or one of several focused rooms.</p><button className="cta" onClick={() => setDialog('create-board')}><Plus size={15} /> Create your first Commons</button></div>
          )
        ) : (
            <>
              {welcomeId === activeId ? (
                <WelcomeCard
                  board={activeBoard}
                  members={activeMembers}
                  noteCount={activeNotes.length}
                  canContribute={canContribute}
                  canInvite={canInvite}
                  onAddNote={() => { dismissWelcome(); setDialog('add-note') }}
                  onInvite={() => { dismissWelcome(); setDialog('invite') }}
                  onDismiss={dismissWelcome}
                />
              ) : null}
              <div className="commons-board-head">
                <div className="commons-board-heading"><span className="commons-board-mark">
                  {canInvite ? (
                    <>
                      <button className="commons-board-mark-btn" onClick={() => setIconPickerOpen((open) => !open)} title="Change board icon" aria-label="Change board icon">
                        <BoardIcon icon={str(activeBoard, 'emoji') || '✦'} size={30} />
                      </button>
                      {iconPickerOpen ? (
                        <>
                          <span className="board-icon-scrim" onClick={() => setIconPickerOpen(false)} />
                          <span className="board-icon-pop">
                            <BoardIconPicker value={str(activeBoard, 'emoji')} onPick={(icon) => void changeBoardIcon(icon)} />
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : <BoardIcon icon={str(activeBoard, 'emoji') || '✦'} size={30} />}
                </span><div><h1>{str(activeBoard, 'name')}</h1><p>{str(activeBoard, 'description') || 'A focused shared board.'}</p></div></div>
                <div className="commons-board-actions">
                  <div className="commons-avatars" aria-label={`${activeMembers.length} members`}>
                    {activeMembers.slice(0, 4).map((member) => (
                      <span key={str(member, 'id')} title={memberLabel(member)}>
                        <MemberAvatar
                          userId={str(member, 'member_user_id')}
                          email={str(member, 'email')}
                          label={memberLabel(member)}
                          size={26}
                          resolve={resolveAvatar}
                        />
                      </span>
                    ))}
                    {activeMembers.length > 4 ? <span>+{activeMembers.length - 4}</span> : null}
                  </div>
                  {canInvite ? <button className="ghost" onClick={() => setDialog('invite')}><UserPlus size={15} /> Invite</button> : null}
                  <button className="ghost" onClick={() => setBoardShareOpen(true)}><Share2 size={15} /> Share</button>
                  {canContribute ? <button className="cta" onClick={() => setDialog('add-note')}><Plus size={15} /> Add note</button> : null}
                </div>
              </div>
              <div className="commons-toolbar">
                {/* Campaigns and notes are different objects — tabs keep a
                    campaign findable. Campaign cards reuse /campaigns' card. */}
                <div className="camp-seg" role="tablist" aria-label="Commons content type">
                  <button type="button" role="tab" aria-selected={activeTab === 'notes'} className={`camp-seg-btn${activeTab === 'notes' ? ' on' : ''}`} onClick={() => setActiveTab('notes')}>
                    <FileText size={13} /> Notes <span className="camp-seg-count">{allPlainNotes.length}</span>
                  </button>
                  <button type="button" role="tab" aria-selected={activeTab === 'campaigns'} className={`camp-seg-btn${activeTab === 'campaigns' ? ' on' : ''}`} onClick={() => setActiveTab('campaigns')}>
                    <Target size={13} /> Campaigns <span className="camp-seg-count">{allCampaigns.length}</span>
                  </button>
                </div>
                <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${activeTab}`} /></label>
              </div>
              {tabNotes.length ? (
                <div className={activeTab === 'campaigns' ? 'camp-grid commons-camp-grid' : 'commons-note-grid'}>{tabNotes.map((note) => renderNoteCard(note))}</div>
              ) : search.trim() ? (
                <div className="commons-notes-empty"><Search size={22} /><h3>No matches for “{search}”</h3><p>Try a different search, or clear it to see everything shared here.</p><button className="ghost" onClick={() => setSearch('')}>Clear search</button></div>
              ) : activeTab === 'campaigns' ? (
                <div className="commons-notes-empty"><Target size={24} /><h3>No campaigns shared here yet</h3><p>Share one from a campaign’s own editor — its linked posts come with it.</p></div>
              ) : (
                <div className="commons-notes-empty"><Layers3 size={24} /><h3>Start with one useful thought</h3><p>Add a note here or deliberately copy one from your personal Board.</p>{canContribute ? <button className="ghost" onClick={() => setDialog('add-note')}><Plus size={15} /> Add the first note</button> : null}</div>
              )}
            </>
          )}
      </section>

      {celebrateId === activeId && activeBoard ? (
        <JoinCelebration board={activeBoard} memberCount={activeMembers.length} onClose={dismissCelebration} />
      ) : null}

      {dialog === 'create-board' ? <CreateBoardModal busy={creatingBoard} onClose={() => setDialog(null)} onCreate={createBoard} /> : null}
      {dialog === 'add-note' && activeBoard ? <AddNoteModal posts={posts} busy={creatingNote} boardName={str(activeBoard, 'name')} onClose={() => setDialog(null)} onDirect={addDirectNote} onShare={sharePersonalNote} /> : null}
      {dialog === 'invite' && activeBoard ? (
        <InviteModal
          boardName={str(activeBoard, 'name')}
          alreadyIn={activeMembers.map((member) => str(member, 'email'))}
          onClose={() => setDialog(null)}
          onInvite={inviteMember}
        />
      ) : null}
      {boardShareOpen && activeBoard ? (
        <ShareLinkModal
          label={str(activeBoard, 'name') || 'this Commons'}
          url={buildBoardShareUrl(activeBoard)}
          privacy="Members of this Commons land here. Invite someone new if they aren’t on it yet."
          onClose={() => setBoardShareOpen(false)}
        />
      ) : null}
      {selectedNote && str(selectedNote, 'kind') === 'campaign' ? (
        <CommonsCampaignOverlay
          campaign={selectedNote}
          board={activeBoard || {}}
          posts={postsInCampaign(str(selectedNote, 'id'))}
          authorName={memberLabel(members.find((member) => str(member, 'member_user_id') === str(selectedNote, 'created_by') && str(member, 'board_id') === activeId) || {})}
          when={formatRelative(str(selectedNote, 'created_at'))}
          canDelete={(!!userId && str(selectedNote, 'created_by') === userId) || canInvite}
          onOpenPost={(note) => openCommonsNote(note)}
          onDelete={removeSharedCampaign}
          onClose={closeSelectedNote}
        />
      ) : selectedNote ? (
        <CommonsNoteOverlay
          note={selectedNote}
          board={activeBoard || {}}
          authorName={memberLabel(members.find((member) => str(member, 'member_user_id') === str(selectedNote, 'created_by') && str(member, 'board_id') === activeId) || {})}
          authorAvatar={resolveAvatar(str(selectedNote, 'created_by'))}
          when={formatRelative(str(selectedNote, 'created_at'))}
          canEdit={canContribute}
          isOriginAuthor={!!userId && str(selectedNote, 'created_by') === userId && !!str(selectedNote, 'source_post_id')}
          userId={userId}
          canDelete={(!!userId && str(selectedNote, 'created_by') === userId) || canInvite}
          onSave={saveSharedNote}
          onSubstage={saveSharedSubstage}
          onDelete={removeSharedNote}
          onClose={closeSelectedNote}
        />
      ) : null}
    </div>
  )
}

/**
 * Opening a shared note uses the SAME full-screen chrome as the Board's PostEditor
 * (.editor-overlay / .editor-top / .editor-body / .editor-main / .editor-doc) —
 * not a side drawer. Reusing those classes is also what makes it scroll:
 * .editor-body is the flex clip and .editor-main owns overflow-y.
 * Opens in read mode; shared notes are snapshots, so there is no edit mode yet.
 */
function CommonsNoteOverlay({
  note, board, authorName, authorAvatar, when, canEdit, isOriginAuthor, canDelete, onSave, onSubstage, onDelete, onClose,
}: {
  note: Rec; board: Rec; authorName: string; authorAvatar: ResolvedAvatar; when: string
  canEdit: boolean; isOriginAuthor: boolean; userId: string; canDelete: boolean
  onSave: (note: Rec, next: { title: string; blocks: Rec[] }) => Promise<boolean>
  onSubstage: (note: Rec, next: string) => Promise<void>
  onDelete: (note: Rec) => void | Promise<void>
  onClose: () => void
}) {
  const versions = parsePostVersions(note['versions'])
  const [activeId, setActiveId] = useState(ORIGINAL_VERSION_ID)
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBlocks, setDraftBlocks] = useState<Rec[]>([])
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const editorRef = useRef<DocumentEditorHandle>(null)

  const active = versions.find((version) => version.id === activeId)
  const title = active?.title || str(note, 'title') || 'Untitled'
  const body = active ? (active.body_md || flattenBlocks(active.blocks)) : str(note, 'body_md')
  const isCopy = str(note, 'origin') === 'personal_copy'
  // Only the top-level share is editable; a single-version snapshot edits its own entry.
  const editable = canEdit && activeId === ORIGINAL_VERSION_ID

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && mode === 'read') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mode])

  function startEditing() {
    const blocks = parseBlocks(note['blocks'])
    setDraftBlocks(blocks.length ? blocks : mdToBlocks(str(note, 'body_md')))
    setDraftTitle(str(note, 'title'))
    setMode('edit')
    setSavedNote('')
  }
  async function commit(blocks: Rec[]) {
    setDraftBlocks(blocks)
    setSaving(true)
    try {
      const syncedOrigin = await onSave(note, { title: draftTitle || str(note, 'title'), blocks })
      setSavedNote(syncedOrigin
        ? 'Saved — your private original updated too.'
        : isOriginAuthor ? 'Saved to Commons.' : 'Saved to Commons (the author’s private original is untouched).')
      window.setTimeout(() => setSavedNote(''), 4000)
    } finally { setSaving(false) }
  }

  return (
    <div className="editor-overlay commons-note-overlay">
      <div className="editor-top">
        <div className="crumb">
          <button className="editor-back" onClick={onClose} title="Back to Commons"><ArrowLeft size={19} /></button>
          <span className="editor-note-name">{str(note, 'title') || 'Untitled'}</span>
        </div>
        <div className="commons-note-where">
          <BoardIcon icon={str(board, 'emoji') || '✦'} size={17} />
          <span>{str(board, 'name')}</span>
        </div>
        <div className="top-right">
          {savedNote ? <span className="commons-note-saved"><Check size={13} /> {savedNote}</span> : null}
          <button className="icon-btn" title="Share this note" aria-label="Share this note" onClick={() => setShareOpen(true)}>
            <Share2 size={16} />
          </button>
          {editable ? (
            <div className="view-toggle">
              <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}><Eye size={14} /> Read</button>
              <button className={mode === 'edit' ? 'on' : ''} onClick={startEditing} disabled={saving}><Pencil size={14} /> Edit</button>
            </div>
          ) : (
            <span className="commons-note-readonly"><Eye size={14} /> {canEdit ? 'Versions are read-only' : 'Read-only'}</span>
          )}
          {canDelete ? (
            <button className="icon-danger" title="Remove from this Commons" aria-label="Remove from this Commons" onClick={() => void onDelete(note)}>
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-main">
          {versions.length ? (
            <div className="version-switcher" aria-label="Shared versions">
              <span className="version-switcher-label">Versions</span>
              <div className="version-tabs">
                <button className={activeId === ORIGINAL_VERSION_ID ? 'on' : ''} onClick={() => setActiveId(ORIGINAL_VERSION_ID)}>Original</button>
                {versions.map((version) => (
                  <button key={version.id} className={activeId === version.id ? 'on' : ''} onClick={() => setActiveId(version.id)}>
                    {isTargetPlatform(version.platform) ? <PlatformIcon platform={version.platform} size={13} label={false} /> : null}
                    {version.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="editor-doc">
            {mode === 'edit' ? (
              <>
                <div className="commons-edit-banner">
                  {isOriginAuthor
                    ? <><Pencil size={13} /> You shared this — saving also updates your private original.</>
                    : <><LockKeyhole size={13} /> Edits stay on the shared copy. The author’s private original is untouched.</>}
                </div>
                <TitleArea className="title-input" value={draftTitle} placeholder="Untitled"
                  onChange={setDraftTitle} onCommit={() => editorRef.current?.commit()} />
                <DocumentEditor
                  ref={editorRef}
                  blocks={draftBlocks}
                  onCommit={commit}
                  onPickMedia={() => undefined}
                  onPickFile={() => undefined}
                />
              </>
            ) : (
              <article className="reader-article">
                <header className="reader-header">
                  <div className="commons-reader-meta">
                    <span className="commons-note-origin">{isCopy ? <><Copy size={12} /> live copy from a personal Board</> : <><FileText size={12} /> shared note</>}</span>
                    <span className="commons-reader-by">
                      <Avatar seed={authorAvatar.seed} style={authorAvatar.style} size={22} className="commons-note-author" />
                      {authorName}
                    </span>
                    <time>{when}</time>
                  </div>
                  <h1 className="read-title">{title}</h1>
                  <FormatChips formats={parseContentFormats(note['content_formats'], note['tags'])} />
                  {/* The person who shared a piece can move its step from here;
                      anyone else reads it as a snapshot chip. Same origin rule
                      the edit banner already explains. */}
                  {isOriginAuthor ? (
                    <div className="reader-substage">
                      <span className="reader-substage-label">Step</span>
                      <SubstagePicker
                        value={str(note, 'substage')}
                        options={substageOptions(parseContentFormats(note['content_formats'], note['tags']))}
                        onChange={(next) => void onSubstage(note, next)}
                      />
                    </div>
                  ) : (
                    <SubstageChip value={str(note, 'substage')} options={substageOptions(parseContentFormats(note['content_formats'], note['tags']))} />
                  )}
                </header>
                <div className="read-doc"><ReadMarkdown value={body || '_No content yet._'} /></div>
              </article>
            )}
          </div>
        </div>
      </div>
      {shareOpen ? <ShareLinkModal label={title} url={buildNoteShareUrl(str(board, 'id'), str(note, 'id'))} onClose={() => setShareOpen(false)} /> : null}
    </div>
  )
}

/**
 * A shared campaign opens in the SAME chrome as a shared note and the Board's
 * own campaign editor — brief in the document column, its shared posts in the
 * right rail. Clicking one there swaps the overlay to that post's reader.
 * Read-only: editing a shared campaign is not wired (see CommonsNoteOverlay for
 * why cross-user write-back can't work).
 */
function CommonsCampaignOverlay({
  campaign, board, posts, authorName, when, canDelete, onOpenPost, onDelete, onClose,
}: {
  campaign: Rec; board: Rec; posts: Rec[]; authorName: string; when: string
  canDelete: boolean
  onOpenPost: (note: Rec) => void
  onDelete: (campaign: Rec) => void | Promise<void>
  onClose: () => void
}) {
  // Same as CampaignEditor: no room beside the document on a phone.
  const [railOpen, setRailOpen] = useState(() => !isNarrowScreen())
  const [shareOpen, setShareOpen] = useState(false)
  const body = str(campaign, 'body_md')
  const stage = str(campaign, 'campaign_stage')
  const type = str(campaign, 'campaign_type')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="editor-overlay commons-note-overlay">
      <div className="editor-top">
        <div className="crumb">
          <button className="editor-back" onClick={onClose} title="Back to Commons"><ArrowLeft size={19} /></button>
          <span className="editor-note-name">{str(campaign, 'title') || 'Untitled campaign'}</span>
        </div>
        <div className="commons-note-where">
          <BoardIcon icon={str(board, 'emoji') || '✦'} size={17} />
          <span>{str(board, 'name')}</span>
        </div>
        <div className="top-right">
          <span className="commons-note-readonly"><Eye size={14} /> Read-only</span>
          <button className="icon-btn" title="Share this campaign" aria-label="Share this campaign" onClick={() => setShareOpen(true)}>
            <Share2 size={16} />
          </button>
          <button
            className={`rail-toggle${railOpen ? ' on' : ''}`}
            title={railOpen ? 'Hide posts' : 'Show posts'}
            onClick={() => setRailOpen((open) => !open)}
          >
            {railOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
            {!railOpen && posts.length ? <span className="rail-toggle-count">{posts.length}</span> : null}
          </button>
          {canDelete ? (
            <button className="icon-danger" title="Remove from this Commons" aria-label="Remove from this Commons" onClick={() => void onDelete(campaign)}>
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="editor-body">
        <div className="editor-main">
          <div className="editor-doc">
            <article className="reader-article">
              <header className="reader-header">
                <div className="commons-reader-meta">
                  <span className="commons-note-origin"><Target size={12} /> shared campaign</span>
                  <span className="commons-reader-by">{authorName}</span>
                  <time>{when}</time>
                </div>
                <h1 className="read-title">{str(campaign, 'title') || 'Untitled campaign'}</h1>
                <CampaignMetaChips stage={isCampaignStage(stage) ? stage : undefined} type={isCampaignType(type) ? type : undefined} formats={parseContentFormats(campaign['content_formats'], campaign['tags'])} />
              </header>
              <div className="read-doc"><ReadMarkdown value={body || '_No brief yet._'} /></div>
            </article>
          </div>
        </div>

        {railOpen ? (
          <aside className="campaign-rail" aria-label="Posts shared with this campaign">
            <div className="campaign-rail-scroll">
              <CampaignRailSection
                title="Posts"
                count={posts.length}
                empty="No posts in this campaign yet. Ones the author links show up here."
              >
                {posts.map((note) => (
                  <CampaignPostRow
                    key={str(note, 'id')}
                    id={str(note, 'id')}
                    title={str(note, 'title') || 'Untitled'}
                    meta={<>
                      <SubstageChip value={str(note, 'substage')} options={substageOptions(parseContentFormats(note['content_formats'], note['tags']))} />
                      <VersionChips post={note} />
                    </>}
                    onOpen={() => onOpenPost(note)}
                  />
                ))}
              </CampaignRailSection>
            </div>
          </aside>
        ) : null}
      </div>
      {shareOpen ? <ShareLinkModal label={str(campaign, 'title') || 'Untitled campaign'} url={buildNoteShareUrl(str(board, 'id'), str(campaign, 'id'))} onClose={() => setShareOpen(false)} /> : null}
    </div>
  )
}

function CreateBoardModal({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (name: string, description: string, icon: string) => void | Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string>('rocket')
  return (
    <Modal title="Create a Commons" onClose={onClose}>
      <div className="commons-modal-body" style={{ ['--commons-accent' as string]: accentForIcon(icon) }}>
        <label><span>Name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Growth room" /></label>
        <div className="commons-modal-field">
          <span>Icon</span>
          <BoardIconPicker value={icon} onPick={setIcon} />
        </div>
        <label><span>What belongs here?</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Useful angles, campaign sparks, and customer language worth keeping." /></label>
        <div className="commons-privacy-note"><LockKeyhole size={15} /> This creates a shared space. Your existing Board stays private.</div>
      </div>
      <footer>
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button className="cta" disabled={!name.trim() || busy} onClick={() => void onCreate(name, description, icon)}>{busy ? 'Creating…' : 'Create Commons'}</button>
      </footer>
    </Modal>
  )
}

function AddNoteModal({ posts, boardName, busy, onClose, onDirect, onShare }: { posts: Rec[]; boardName: string; busy: boolean; onClose: () => void; onDirect: (title: string, body: string) => void | Promise<void>; onShare: (postId: string, versionId: string) => void | Promise<void> }) {
  const [mode, setMode] = useState<'direct' | 'personal'>('direct')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [postId, setPostId] = useState('')
  const [versionId, setVersionId] = useState(ORIGINAL_VERSION_ID)
  const selected = posts.find((post) => str(post, 'id') === postId)
  const versions = selected ? parsePostVersions(selected['versions']) : []
  return <Modal title={`Add to ${boardName}`} onClose={onClose}><div className="commons-modal-tabs"><button className={mode === 'direct' ? 'active' : ''} onClick={() => setMode('direct')}>New shared note</button><button className={mode === 'personal' ? 'active' : ''} onClick={() => setMode('personal')}>Copy from my Board</button></div><div className="commons-modal-body">{mode === 'direct' ? <><label><span>Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A useful thought" /></label><label><span>Note</span><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Give the team enough context to build on it…" /></label></> : <><label><span>Personal note</span><select value={postId} onChange={(event) => { setPostId(event.target.value); setVersionId(ORIGINAL_VERSION_ID) }}><option value="">Select from your private Board…</option>{posts.map((post) => <option key={str(post, 'id')} value={str(post, 'id')}>{str(post, 'title') || 'Untitled'}</option>)}</select></label>{selected && versions.length ? <label><span>What to copy</span><select value={versionId} onChange={(event) => setVersionId(event.target.value)}><option value={ORIGINAL_VERSION_ID}>All versions</option>{versions.map((version) => <option key={version.id} value={version.id}>Just the {version.name}</option>)}</select></label> : null}<div className="commons-privacy-note"><Copy size={15} /> This is a live copy — edits you make in your Board update it automatically. It never leaves your Board.</div></>}</div><footer><button className="ghost" onClick={onClose}>Cancel</button><button className="cta" disabled={busy || (mode === 'direct' ? !title.trim() : !postId)} onClick={() => void (mode === 'direct' ? onDirect(title, body) : onShare(postId, versionId))}>{busy ? 'Adding…' : mode === 'direct' ? 'Add shared note' : 'Copy to Commons'}</button></footer></Modal>
}

type PodPerson = { email: string; name: string; inPod: boolean }

/**
 * Invite by picking a teammate. Everyone already in the pod or org is one click
 * away — typing an email is only needed for someone outside the org entirely.
 */
function InviteModal({
  boardName, alreadyIn, onClose, onInvite,
}: {
  boardName: string
  alreadyIn: string[]
  onClose: () => void
  onInvite: (email: string, role: CommonsRole) => void | Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CommonsRole>('contributor')
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState<PodPerson[] | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const podId = lemmaClient.podId
        if (!podId) { if (alive) setPeople([]); return }
        const pod = await lemmaClient.pods.get(podId)
        const org = await lemmaClient.organizations.members.list(pod.organization_id, { limit: 200 })
        const rows: PodPerson[] = []
        for (const member of (org.items || [])) {
          const memberEmail = (member.user?.email || '').toLowerCase()
          if (!memberEmail) continue
          let inPod = false
          try { await lemmaClient.podMembers.lookupByEmail(podId, memberEmail); inPod = true } catch { inPod = false }
          rows.push({
            email: memberEmail,
            name: [member.user?.first_name, member.user?.last_name].filter(Boolean).join(' ') || memberEmail.split('@')[0],
            inPod,
          })
        }
        if (alive) setPeople(rows)
      } catch { if (alive) setPeople([]) }
    })()
    return () => { alive = false }
  }, [])

  const taken = new Set(alreadyIn.map((value) => value.toLowerCase()))
  const pickable = (people || []).filter((person) => !taken.has(person.email))
  const valid = /^\S+@\S+\.\S+$/.test(email)

  async function invite(target: string) {
    setBusy(true)
    try { await onInvite(target, role) } finally { setBusy(false) }
  }

  return (
    <Modal title={`Invite to ${boardName}`} onClose={onClose}>
      <div className="commons-modal-body">
        <label><span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value as CommonsRole)}>
            <option value="editor">Editor — add, edit, invite</option>
            <option value="contributor">Contributor — add and discuss</option>
            <option value="viewer">Viewer — read only</option>
          </select>
        </label>

        <div className="commons-modal-field">
          <span>Your team</span>
          {people === null ? (
            <div className="invite-people-loading"><Loader2 size={15} className="spin" /> Finding teammates…</div>
          ) : pickable.length ? (
            <div className="invite-people">
              {pickable.map((person) => (
                <button key={person.email} className="invite-person" disabled={busy} onClick={() => void invite(person.email)}>
                  <span className="invite-person-mark"><Avatar seed={person.email} size={30} /></span>
                  <span className="invite-person-id">
                    <strong>{person.name}</strong>
                    <small>{person.email}</small>
                  </span>
                  <span className={`invite-person-tag${person.inPod ? ' in' : ''}`}>{person.inPod ? 'in this pod' : 'in your org'}</span>
                  <UserPlus size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="invite-people-empty">Everyone in your org is already on this board.</div>
          )}
        </div>

        <label><span>Or invite by email</span>
          <div className="commons-email-field">
            <Mail size={16} />
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="someone@outside.com" />
          </div>
        </label>
        <div className="commons-privacy-note"><ShieldCheck size={15} /> They join this Commons; nobody gains access to your personal Board.</div>
      </div>
      <footer>
        <button className="ghost" onClick={onClose}>Cancel</button>
        <button className="cta" disabled={!valid || busy} onClick={() => void invite(email)}>{busy ? 'Inviting…' : 'Send invite'}</button>
      </footer>
    </Modal>
  )
}
