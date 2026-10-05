import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { UsersRound, X, Check, Copy, Loader2, LockKeyhole, ArrowRight, Target, Files } from 'lucide-react'
import { useCreateRecord, useCurrentUser, useLiveRecords, useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str, flattenBlocks } from './lib'
import { ORIGINAL_VERSION_ID, isTargetPlatform, type PostVersion, type VersionPlatform } from './versions'
import { PlatformIcon } from './platforms'
import { shareCampaignToBoard } from './shareCampaign'
import { boardMarkText } from './boardIcons'
import { buildNoteShareUrl } from './Commons'

type ResolvedVersion = { title: string; blocks: Rec[] }

/**
 * Boards the signed-in user may add to: owner, or a member whose role isn't
 * viewer. Shared by both share dialogs so the two can never disagree about
 * where you're allowed to post.
 */
function useContributableBoards() {
  const { user } = useCurrentUser({ client: lemmaClient })
  const boardsQuery = useLiveRecords({ client: lemmaClient, tableName: 'commons_boards' })
  const membersQuery = useLiveRecords({ client: lemmaClient, tableName: 'commons_members' })

  const userId = str(user as unknown as Rec, 'id')
  const userEmail = str(user as unknown as Rec, 'email').toLowerCase()
  const boards = boardsQuery.records as Rec[]
  const members = membersQuery.records as Rec[]

  const contributable = useMemo(() => {
    const mine = members.filter((m) => str(m, 'status') !== 'revoked'
      && (str(m, 'member_user_id') === userId || str(m, 'email').toLowerCase() === userEmail))
    const roleByBoard = new Map(mine.map((m) => [str(m, 'board_id'), str(m, 'role')]))
    return boards.filter((b) => {
      if (str(b, 'status') === 'archived') return false
      if (str(b, 'owner_user_id') === userId) return true
      const role = roleByBoard.get(str(b, 'id'))
      return !!role && role !== 'viewer'
    })
  }, [boards, members, userId, userEmail])

  return { contributable, userId, loading: boardsQuery.isLoading || membersQuery.isLoading }
}

/**
 * The review link for whatever was just shared. Sharing to Commons is only half
 * the job — the point is usually "send this to someone", so the success state
 * hands over the deep link rather than making you go find it in Commons.
 */
function ShareDoneLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked — the visible link is the fallback */ }
  }
  return (
    <div className="share-commons-link">
      <span className="share-commons-link-label">Review link</span>
      <div className="commons-share-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button className="ghost" onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="share-commons-link-note">
        <LockKeyhole size={13} /> Opens for anyone on this Commons. They always see your latest edits.
      </p>
    </div>
  )
}

/** Shared chrome so the campaign dialog and the note dialog stay identical. */
function ShareShell({
  title, icon, done, doneUrl, loading, contributable, error, busy, busyLabel, onClose, onShare, children,
}: {
  title: string
  icon: React.ReactNode
  done: React.ReactNode | null
  /** Deep link to the thing just shared, shown with the success message. */
  doneUrl?: string
  loading: boolean
  contributable: Rec[]
  error: string
  busy: boolean
  busyLabel: string
  onClose: () => void
  onShare: () => void
  children: React.ReactNode
}) {
  return createPortal(
    <div className="commons-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="commons-modal share-commons-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{icon} {title}</h2>
          <button className="x-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {done ? (
          <>
            {/* One <span>, not bare text nodes: .share-commons-done is a flex row,
                so each stray text node would become its own flex item and the
                sentence would break apart mid-phrase. */}
            <div className="commons-modal-body">
              <div className="share-commons-done"><Check size={18} /><span>{done}</span></div>
              {doneUrl ? <ShareDoneLink url={doneUrl} /> : null}
            </div>
            <footer><button className="cta" onClick={onClose}>Done</button></footer>
          </>
        ) : loading ? (
          <div className="commons-modal-body">
            <div className="share-commons-loading"><Loader2 size={16} className="spin" /> Loading your Commons…</div>
          </div>
        ) : !contributable.length ? (
          <>
            <div className="commons-modal-body">
              <div className="share-commons-empty">
                <UsersRound size={22} />
                <p>You’re not in a Commons you can add to yet. Open <strong>Commons</strong> from the sidebar to create one or join your team.</p>
              </div>
            </div>
            <footer><button className="ghost" onClick={onClose}>Close</button></footer>
          </>
        ) : (
          <>
            <div className="commons-modal-body">
              {children}
              {error ? <div className="share-commons-error">{error}</div> : null}
            </div>
            <footer>
              <button className="ghost" onClick={onClose}>Cancel</button>
              <button className="cta" disabled={busy} onClick={onShare}>
                {busy ? busyLabel : 'Share to Commons'} <ArrowRight size={15} />
              </button>
            </footer>
          </>
        )}
      </section>
    </div>,
    document.body,
  )
}

/**
 * Share a campaign — its brief AND every post linked to it — into a Commons
 * board. Delegates the N+1 write to `shareCampaignToBoard` so Commons and the
 * campaign editor share one implementation.
 */
export function ShareCampaignDialog({
  campaign, posts, onClose,
}: {
  campaign: Rec
  posts: Rec[]
  onClose: () => void
}) {
  const { contributable, userId, loading } = useContributableBoards()
  const notesQuery = useLiveRecords({ client: lemmaClient, tableName: 'commons_notes' })
  const { create } = useCreateRecord({ client: lemmaClient, tableName: 'commons_notes' })
  const { update } = useUpdateRecord({ client: lemmaClient, tableName: 'commons_notes' })

  const [boardId, setBoardId] = useState('')
  const [done, setDone] = useState<{ board: string; wasUpdate: boolean; count: number } | null>(null)
  const [doneUrl, setDoneUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selectedBoardId = boardId || (contributable[0] ? str(contributable[0], 'id') : '')
  const linked = posts.filter((p) => str(p, 'campaign_id') === str(campaign, 'id'))

  async function share() {
    const board = contributable.find((b) => str(b, 'id') === selectedBoardId)
    if (!board || !userId) return
    setError('')
    setBusy(true)
    try {
      const result = await shareCampaignToBoard({
        campaign,
        posts,
        boardId: str(board, 'id'),
        userId,
        notes: notesQuery.records as Rec[],
        writer: { create, update },
      })
      await notesQuery.refresh()
      setDone({ board: str(board, 'name'), wasUpdate: result.wasUpdate, count: result.postCount })
      setDoneUrl(result.groupId ? buildNoteShareUrl(str(board, 'id'), result.groupId) : '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share this campaign to Commons.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ShareShell
      title="Share campaign to Commons"
      icon={<Target size={18} />}
      loading={loading}
      contributable={contributable}
      error={error}
      doneUrl={doneUrl}
      busy={busy}
      busyLabel="Sharing…"
      onClose={onClose}
      onShare={() => void share()}
      done={done ? (
        done.wasUpdate
          ? <>Already live in <strong>{done.board}</strong> — the campaign and its {done.count} {done.count === 1 ? 'post' : 'posts'} are shared there and stay up to date on their own.</>
          : <>Copied to <strong>{done.board}</strong> with {done.count} {done.count === 1 ? 'post' : 'posts'}. Your private campaign stays in your Board.</>
      ) : null}
    >
      <label>
        <span>Commons</span>
        <select value={selectedBoardId} onChange={(e) => setBoardId(e.target.value)}>
          {contributable.map((b) => (
            <option key={str(b, 'id')} value={str(b, 'id')}>{`${boardMarkText(str(b, 'emoji'))} ${str(b, 'name')}`}</option>
          ))}
        </select>
      </label>
      <div className="share-campaign-summary">
        <span className="share-campaign-line"><Target size={14} /> <strong>{str(campaign, 'name') || 'Untitled campaign'}</strong></span>
        <span className="share-campaign-line">
          <Files size={14} />
          {linked.length
            ? <>{linked.length} linked {linked.length === 1 ? 'post goes' : 'posts go'} with it</>
            : <>No posts linked yet — just the brief goes over</>}
        </span>
        {linked.length ? (
          <ul className="share-campaign-posts">
            {linked.slice(0, 6).map((p) => <li key={str(p, 'id')}>{str(p, 'title') || 'Untitled'}</li>)}
            {linked.length > 6 ? <li className="more">+{linked.length - 6} more</li> : null}
          </ul>
        ) : null}
      </div>
      <div className="commons-privacy-note">
        <LockKeyhole size={15} /> This is a live copy — edits to the brief, and posts you add or remove later, update it automatically. Your campaign and its files never leave your Board.
      </div>
    </ShareShell>
  )
}

/**
 * Copy the current note (or one of its platform versions) into a Commons board.
 * Writes a `commons_notes` record with the SAME payload shape as
 * Commons.tsx `sharePersonalNote` (origin `personal_copy`, source ids kept) — the
 * private original never moves. Membership/role rules mirror `canContribute` there.
 */
export function ShareToCommonsDialog({
  postId, tags, formats = [], substage = '', versions, defaultVersionId, resolveVersion, onClose,
}: {
  postId: string
  tags: string[]
  formats?: string[]
  substage?: string
  versions: PostVersion[]
  defaultVersionId: string
  resolveVersion: (versionId: string) => ResolvedVersion
  onClose: () => void
}) {
  const { contributable, userId, loading } = useContributableBoards()
  const notesQuery = useLiveRecords({ client: lemmaClient, tableName: 'commons_notes' })
  const { create, isSubmitting } = useCreateRecord({ client: lemmaClient, tableName: 'commons_notes' })
  const { update: updateNote, isSubmitting: updating } = useUpdateRecord({ client: lemmaClient, tableName: 'commons_notes' })

  const [boardId, setBoardId] = useState('')
  const [versionId, setVersionId] = useState(defaultVersionId)
  const [doneBoard, setDoneBoard] = useState('')
  const [doneUrl, setDoneUrl] = useState('')
  const [wasUpdate, setWasUpdate] = useState(false)
  const [error, setError] = useState('')

  const versionPicks = useMemo(() => [
    { id: ORIGINAL_VERSION_ID, name: 'All versions', platform: undefined as VersionPlatform | undefined },
    ...versions.map((v) => ({ id: v.id, name: `Just the ${v.name}`, platform: v.platform })),
  ], [versions])

  const selectedBoardId = boardId || (contributable[0] ? str(contributable[0], 'id') : '')
  const activePick = versionPicks.find((v) => v.id === versionId)

  async function share() {
    const board = contributable.find((b) => str(b, 'id') === selectedBoardId)
    if (!board || !userId) return
    const resolved = resolveVersion(versionId)
    // 'original' = share ALL versions: carry the full array so Commons shows the
    // same version switcher. A specific id shares just that variant.
    const shareAll = versionId === ORIGINAL_VERSION_ID
    setError('')
    // One shared note per post per board — re-sharing refreshes it in place.
    const existing = (notesQuery.records as Rec[]).find((note) => str(note, 'board_id') === str(board, 'id')
      && str(note, 'source_post_id') === postId
      && str(note, 'status') !== 'archived')
    try {
      const payload = {
        board_id: str(board, 'id'),
        title: resolved.title || 'Untitled',
        body_md: flattenBlocks(resolved.blocks),
        blocks: resolved.blocks,
        tags,
        content_formats: formats,
        substage: substage || null,
        versions: shareAll ? versions : [],
        created_by: userId,
        updated_by: userId,
        origin: 'personal_copy',
        source_post_id: postId,
        source_version_id: versionId,
        status: 'active',
      }
      // Keep the row id either way — it's what the review link points at.
      let noteId = str(existing, 'id')
      if (existing) await updateNote(payload, { recordId: noteId })
      else noteId = str((await create(payload)) as Rec, 'id')
      await notesQuery.refresh()
      setDoneBoard(str(board, 'name'))
      setDoneUrl(noteId ? buildNoteShareUrl(str(board, 'id'), noteId) : '')
      setWasUpdate(!!existing)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share to Commons.')
    }
  }

  return (
    <ShareShell
      title="Share to Commons"
      icon={<UsersRound size={18} />}
      loading={loading}
      contributable={contributable}
      error={error}
      doneUrl={doneUrl}
      busy={isSubmitting || updating}
      busyLabel="Sharing…"
      onClose={onClose}
      onShare={() => void share()}
      done={doneBoard ? (
        wasUpdate
          ? <>Updated in <strong>{doneBoard}</strong> — it was already shared there, so the same note was refreshed.</>
          : <>Copied to <strong>{doneBoard}</strong>. Your private note stays in your Board.</>
      ) : null}
    >
      <label>
        <span>Commons</span>
        <select value={selectedBoardId} onChange={(e) => setBoardId(e.target.value)}>
          {contributable.map((b) => (
            <option key={str(b, 'id')} value={str(b, 'id')}>{`${boardMarkText(str(b, 'emoji'))} ${str(b, 'name')}`}</option>
          ))}
        </select>
      </label>
      {versionPicks.length > 1 ? (
        <label>
          <span>Version to share</span>
          <div className="share-commons-version">
            {isTargetPlatform(activePick?.platform) ? <PlatformIcon platform={activePick.platform} size={16} label={false} /> : null}
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              {versionPicks.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </label>
      ) : null}
      <div className="commons-privacy-note">
        <LockKeyhole size={15} /> This is a live copy — edits you make in your Board update it automatically. It never leaves your Board.
      </div>
    </ShareShell>
  )
}
