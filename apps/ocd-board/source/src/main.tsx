import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGuard, useCurrentUser, useLiveRecords, useCreateRecord, useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str, importFile, flattenBlocks } from './lib'
import { Sidebar, Board, type BoardView } from './Board'
import { Campaigns } from './Campaigns'
import { CampaignEditor } from './CampaignEditor'
import { PostEditor } from './PostEditor'
import { Milo } from './Milo'
import { ProductsManager } from './Products'
import { Skills } from './Skills'
import { Settings } from './Settings'
import { Profile } from './Profile'
import { Calendar } from './Calendar'
import { Commons, CommonsInviteGate, commonsInviteFromUrl } from './Commons'
import { parsePlace, writePlace, type AppPlace, type RouteKey } from './location'
import './styles.css'

const queryClient = new QueryClient()

function App() {
  const [route, setRoute] = useState<RouteKey>(() => parsePlace().route)
  const [boardView, setBoardView] = useState<BoardView>(() => parsePlace().boardView)
  const [openPostId, setOpenPostId] = useState<string | null>(() => parsePlace().postId)
  const [openCampaignId, setOpenCampaignId] = useState<string | null>(() => parsePlace().campaignId)
  const [dropping, setDropping] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('ocd:sidebar-collapsed') === 'true')

  const { user } = useCurrentUser({ client: lemmaClient })
  const postsQuery = useLiveRecords({ client: lemmaClient, tableName: 'posts' })
  const campaignsQuery = useLiveRecords({ client: lemmaClient, tableName: 'campaigns' })
  const productsQuery = useLiveRecords({ client: lemmaClient, tableName: 'products' })
  const { create: createPost, isSubmitting: creatingPost } = useCreateRecord({ client: lemmaClient, tableName: 'posts' })
  const { create: createCampaign, isSubmitting: creatingCampaign } = useCreateRecord({ client: lemmaClient, tableName: 'campaigns' })
  const { update: updatePostRecord } = useUpdateRecord({ client: lemmaClient, tableName: 'posts' })
  const { update: updateCampaignRecord } = useUpdateRecord({ client: lemmaClient, tableName: 'campaigns' })

  const posts = postsQuery.records as Rec[]
  const campaigns = campaignsQuery.records as Rec[]
  const products = productsQuery.records as Rec[]
  const boardCounts = {
    spark: posts.filter((p) => str(p, 'stage') === 'spark').length,
    refining: posts.filter((p) => str(p, 'stage') === 'refining').length,
    ready: posts.filter((p) => str(p, 'stage') === 'ready').length,
    live: posts.filter((p) => str(p, 'stage') === 'live').length,
  }
  const reloadBoard = () => { void postsQuery.refresh(); void campaignsQuery.refresh(); void productsQuery.refresh() }

  function applyPlace(place: AppPlace) {
    setRoute(place.route)
    setBoardView(place.boardView)
    setOpenPostId(place.postId)
    setOpenCampaignId(place.campaignId)
  }

  function go(patch: Partial<AppPlace>, opts?: { replace?: boolean }) {
    const next: AppPlace = {
      route: patch.route ?? route,
      boardView: patch.boardView ?? boardView,
      postId: patch.postId === undefined ? openPostId : patch.postId,
      campaignId: patch.campaignId === undefined ? openCampaignId : patch.campaignId,
      commonsBoardId: patch.commonsBoardId === undefined ? parsePlace().commonsBoardId : patch.commonsBoardId,
      commonsNoteId: patch.commonsNoteId === undefined ? parsePlace().commonsNoteId : patch.commonsNoteId,
    }
    if (next.route !== 'campaigns') next.campaignId = null
    if (next.route !== 'commons') {
      next.commonsBoardId = null
      next.commonsNoteId = null
    }
    writePlace(next, opts)
    if (next.route === route) {
      applyPlace(next)
      return
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> }
    }
    if (!reducedMotion && doc.startViewTransition) {
      doc.startViewTransition(() => {
        flushSync(() => applyPlace(next))
      })
      return
    }
    applyPlace(next)
  }

  // Deliberately does NOT clear openCampaignId: PostEditor renders after
  // CampaignEditor and both are .editor-overlay, so the post stacks on top and
  // closing it returns you to the campaign you opened it from.
  const openPost = (id: string) => go({ postId: id })
  const closePost = () => go({ postId: null })

  useEffect(() => {
    writePlace(parsePlace(), { replace: true })
    const syncFromHistory = () => applyPlace(parsePlace())
    window.addEventListener('popstate', syncFromHistory)
    return () => window.removeEventListener('popstate', syncFromHistory)
  }, [])

  const navigate = (nextRoute: string) => {
    const routeKey = nextRoute as RouteKey
    if (routeKey === 'campaigns') {
      go({ route: 'campaigns', campaignId: null, postId: null, commonsBoardId: null, commonsNoteId: null })
      return
    }
    if (routeKey === 'commons') {
      if (route === 'commons') return
      const last = localStorage.getItem('ocd:active-commons')
      go({
        route: 'commons',
        postId: null,
        campaignId: null,
        commonsBoardId: last || null,
        commonsNoteId: null,
      })
      return
    }
    go({
      route: routeKey,
      postId: null,
      campaignId: null,
      commonsBoardId: null,
      commonsNoteId: null,
    })
  }

  async function newPost() {
    const rec = await createPost({ title: 'Untitled', stage: 'spark', channel: 'desk', blocks: [], body_md: '' })
    if (rec) go({ route: 'board', postId: str(rec as Rec, 'id'), campaignId: null })
    reloadBoard()
  }

  async function newCampaign() {
    const rec = await createCampaign({ name: 'Untitled campaign', stage: 'ideation', campaign_type: 'content' })
    if (rec) go({ route: 'campaigns', campaignId: str(rec as Rec, 'id'), postId: null })
    reloadBoard()
  }

  async function handleDropPostFiles(files: File[]) {
    setDropping(true)
    try {
      for (const file of files) {
        const title = file.name.replace(/\.[^.]+$/, '')
        const rec = await createPost({ title, stage: 'spark', channel: 'desk', blocks: [], body_md: '' })
        if (!rec) continue
        const id = str(rec as Rec, 'id')
        try {
          const { blocks } = await importFile(file, `/me/posts/${id}`)
          await updatePostRecord({ blocks, body_md: flattenBlocks(blocks) }, { recordId: id })
        } catch { /* import failed — post still created */ }
        go({ route: 'board', postId: id, campaignId: null })
        reloadBoard()
      }
    } finally {
      setDropping(false)
    }
  }

  /** Dropping a brief onto Campaigns both attaches the file and seeds the campaign document with its text. */
  async function handleDropCampaignFiles(files: File[]) {
    setDropping(true)
    try {
      for (const file of files) {
        const name = file.name.replace(/\.[^.]+$/, '')
        const rec = await createCampaign({ name, stage: 'ideation', campaign_type: 'content' })
        if (!rec) continue
        const id = str(rec as Rec, 'id')
        try {
          const { path, blocks } = await importFile(file, `/me/campaigns/${id}`)
          await updateCampaignRecord(
            { doc_paths: [{ name: file.name, path }], blocks, body_md: flattenBlocks(blocks) },
            { recordId: id },
          )
        } catch { /* import failed — campaign still created */ }
        go({ route: 'campaigns', campaignId: id, postId: null })
        reloadBoard()
      }
    } finally {
      setDropping(false)
    }
  }

  return (
    <div className={`shell${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      <Sidebar
        route={route}
        onRoute={navigate}
        email={user?.email || ''}
        boardView={boardView}
        boardCounts={boardCounts}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((value) => {
          const next = !value
          localStorage.setItem('ocd:sidebar-collapsed', String(next))
          return next
        })}
        onBoardView={(view) => go({
          route: 'board',
          boardView: view,
          postId: null,
          campaignId: null,
          commonsBoardId: null,
          commonsNoteId: null,
        })}
      />
      <div className="route-view" key={route}>
        {route === 'board' ? (
          <Board
            posts={posts} campaigns={campaigns} products={products} view={boardView}
            onOpenPost={openPost}
            onNewPost={newPost} creating={creatingPost} loading={postsQuery.isLoading}
            onDropFiles={handleDropPostFiles} dropping={dropping}
            reload={reloadBoard}
          />
        ) : route === 'campaigns' ? (
          <Campaigns
            campaigns={campaigns} posts={posts}
            onOpenCampaign={(id) => go({ route: 'campaigns', campaignId: id })}
            onNewCampaign={newCampaign} creating={creatingCampaign}
            loading={campaignsQuery.isLoading}
            onDropFiles={handleDropCampaignFiles} dropping={dropping}
          />
        ) : route === 'chat' ? (
          <Milo />
        ) : route === 'commons' ? (
          <Commons posts={posts} />
        ) : route === 'products' ? (
          <ProductsManager />
        ) : route === 'calendar' ? (
          <Calendar posts={posts} onOpenPost={openPost} reload={reloadBoard} />
        ) : route === 'skills' ? (
          <Skills />
        ) : route === 'settings' ? (
          <Settings />
        ) : route === 'profile' ? (
          <Profile />
        ) : (
          <div className="main">
            <div className="topbar"><div className="tabs"><span className="tab active" style={{ textTransform: 'capitalize' }}>{route}</span></div></div>
            <div className="scroll"><div className="coming">{route} — coming next.</div></div>
          </div>
        )}
      </div>

      {openCampaignId ? (
        <CampaignEditor
          key={openCampaignId}
          campaign={campaigns.find((c) => str(c, 'id') === openCampaignId) || {}}
          posts={posts} onOpenPost={openPost} onClose={() => go({ route: 'campaigns', campaignId: null, postId: null })}
          reload={reloadBoard}
        />
      ) : null}
      {openPostId ? (
        <PostEditor
          key={openPostId} postId={openPostId} campaigns={campaigns} products={products}
          onClose={closePost} reloadBoard={reloadBoard}
        />
      ) : null}
    </div>
  )
}

/**
 * Take the browser tab icon back from the app host.
 *
 * When deployed, the Lemma shell injects its OWN auto-generated icons into
 * <head> at serve time — `/.lemma/icon-32.png` and friends, a letter tile made
 * from the app name (ours renders as a stray "O"). Declaring ours in index.html
 * isn't enough: theirs carries an exact `sizes="32x32"`, which browsers prefer
 * over an unsized link no matter what order the two appear in. Removing their
 * links is the only reliable way to leave ours standing. Local dev never sees
 * these, so this is a no-op there.
 */
function claimFavicon() {
  document.head
    .querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel~="apple-touch-icon"]')
    .forEach((link) => { if (new URL(link.href, location.href).pathname.startsWith('/.lemma/')) link.remove() })
}
claimFavicon()

const commonsInvite = commonsInviteFromUrl()
const commonsGatePreview = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('invite_preview') : null

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {commonsInvite && (commonsGatePreview === 'signin' || commonsGatePreview === 'access') ? (
        <CommonsInviteGate
          invite={commonsInvite}
          mode={commonsGatePreview}
          userEmail={commonsGatePreview === 'access' ? 'teammate@studio.co' : undefined}
          primaryLabel={commonsGatePreview === 'access' ? 'Request access' : `Join ${commonsInvite.name}`}
          onPrimary={() => undefined}
          onSwitchAccount={commonsGatePreview === 'access' ? () => undefined : undefined}
        />
      ) : <AuthGuard
        client={lemmaClient}
        appName="OCD"
        // Without this the sign-in card falls back to `initials(appName)` — a bare
        // "O" on a purple tile, the same auto-generated mark the host uses for the
        // favicon. `appIcon` is the SDK's supported override for it.
        appIcon={<img src="/smile.png" alt="" />}
        appDescription="Your private content desk, with Commons for deliberate sharing."
        loadingFallback={<div className="loading" style={{ padding: 40 }}>Checking access…</div>}
        unauthenticatedFallback={commonsInvite ? ({ signIn }) => (
          <CommonsInviteGate
            invite={commonsInvite}
            mode="signin"
            primaryLabel={`Join ${commonsInvite.name}`}
            onPrimary={signIn}
          />
        ) : undefined}
        accessRequestFallback={commonsInvite ? ({ status, user, isRequestingAccess, isCheckingAccess, requestAccess, refresh, switchAccount }) => (
          <CommonsInviteGate
            invite={commonsInvite}
            mode="access"
            userEmail={user?.email}
            busy={isRequestingAccess || isCheckingAccess}
            primaryLabel={status === 'pending' ? 'Check access again' : 'Request access'}
            onPrimary={status === 'pending' ? refresh : requestAccess}
            onSwitchAccount={switchAccount}
          />
        ) : undefined}
      >
        <App />
      </AuthGuard>}
    </QueryClientProvider>
  </React.StrictMode>,
)
