import { useEffect, useState, useRef, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import {
  LayoutGrid, CalendarDays, Sparkles, Settings as SettingsIcon, Plus,
  Filter, X, Target, UserCircle2, Upload, Loader2, Package,
  Bot, PanelLeftClose, PanelLeftOpen, UsersRound, Check, ChevronDown,
} from 'lucide-react'
import { Rec, str, STAGES, STAGE_LABEL, Stage, ChannelIcon } from './lib'
import { formatSpec } from './formats'
import {
  FormatChips, parseContentFormats, CONTENT_FORMATS, CONTENT_FORMAT_SPEC,
  type ContentFormat,
} from './contentFormats'
import { plainText } from './markdown'
import { SubstageChip, SUBSTAGE_LABEL, substageOptions } from './substages'
import { PostActions } from './PostActions'
import { versionPlatforms, TARGET_PLATFORMS, type TargetPlatform } from './versions'
import { PlatformIcon, VersionChips, PLATFORM_LABEL } from './platforms'

export type BoardView = 'kanban' | Stage

/**
 * Narrow the board to posts by which platform versions they hold.
 * `has` + [twitter, reddit] → posts carrying both. `missing` + [reddit] → posts
 * still needing a Reddit cut. Empty selection means no filtering.
 */
export type VersionFilter = { mode: 'has' | 'missing'; platforms: TargetPlatform[] }
export type FormatFilter = ContentFormat | 'all'

export function matchesVersionFilter(post: Rec, filter: VersionFilter): boolean {
  if (!filter.platforms.length) return true
  const have = versionPlatforms(post)
  return filter.mode === 'has'
    ? filter.platforms.every((platform) => have.includes(platform))
    : filter.platforms.every((platform) => !have.includes(platform))
}

export function postFormats(post: Rec): ContentFormat[] {
  return parseContentFormats(post['content_formats'], post['tags'])
}

export function matchesFormatFilter(post: Rec, format: FormatFilter): boolean {
  if (format === 'all') return true
  return postFormats(post).includes(format)
}

function FilterDropdown({
  label, valueLabel, active, open, onToggle, onClose, children,
}: {
  label: string
  valueLabel: string
  active: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="camp-drop">
      {open ? <div className="filter-scrim" onClick={onClose} /> : null}
      <button
        type="button"
        className={`camp-drop-btn${active ? ' on' : ''}${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
      >
        <span>{valueLabel}</span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="camp-drop-menu" role="listbox" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

function DropOption({
  selected, onPick, icon: Icon, children, count,
}: {
  selected: boolean
  onPick: () => void
  icon?: typeof CONTENT_FORMAT_SPEC[ContentFormat]['icon']
  children: ReactNode
  count?: number
}) {
  return (
    <button type="button" role="option" aria-selected={selected} className={selected ? 'on' : ''} onClick={onPick}>
      {Icon ? <Icon size={14} /> : null}
      <span>{children}</span>
      {count != null ? <span className="camp-seg-count">{count}</span> : null}
      {selected ? <Check className="camp-drop-check" size={13} /> : null}
    </button>
  )
}

function VersionFilterMenu({
  filter, onChange, onClose,
}: { filter: VersionFilter; onChange: (next: VersionFilter) => void; onClose: () => void }) {
  const toggle = (platform: TargetPlatform) => onChange({
    ...filter,
    platforms: filter.platforms.includes(platform)
      ? filter.platforms.filter((item) => item !== platform)
      : [...filter.platforms, platform],
  })
  const names = filter.platforms.map((platform) => PLATFORM_LABEL[platform]).join(' + ')
  return (
    <>
      <div className="filter-scrim" onClick={onClose} />
      <div className="filter-menu" role="dialog" aria-label="Filter by platform version">
        <div className="filter-head">
          <span>Platform versions</span>
          <button className="x-btn" onClick={onClose} aria-label="Close filter"><X size={14} /></button>
        </div>
        <div className="filter-modes">
          {(['has', 'missing'] as const).map((mode) => (
            <button key={mode} className={filter.mode === mode ? 'on' : ''} onClick={() => onChange({ ...filter, mode })}>
              {mode === 'has' ? 'Has' : 'Missing'}
            </button>
          ))}
        </div>
        <div className="filter-platforms">
          {TARGET_PLATFORMS.map((platform) => {
            const on = filter.platforms.includes(platform)
            return (
              <button key={platform} className={on ? 'on' : ''} onClick={() => toggle(platform)} aria-pressed={on}>
                <PlatformIcon platform={platform} size={16} label={false} />
                <span className="filter-platform-name">{PLATFORM_LABEL[platform]}</span>
                {on ? <Check size={14} /> : null}
              </button>
            )
          })}
        </div>
        <p className="filter-hint">
          {filter.platforms.length
            ? `Showing posts ${filter.mode === 'has' ? 'with' : 'without'} ${names} ${filter.platforms.length > 1 ? 'versions' : 'version'}.`
            : 'Pick one or more platforms. Choosing several narrows to posts matching all of them.'}
        </p>
        <button className="filter-clear" disabled={!filter.platforms.length} onClick={() => onChange({ ...filter, platforms: [] })}>
          Clear filter
        </button>
      </div>
    </>
  )
}

export function Sidebar({
  route, onRoute, email, boardView, onBoardView, boardCounts, collapsed, onToggle,
}: {
  route: string
  onRoute: (r: string) => void
  email: string
  boardView: BoardView
  onBoardView: (view: BoardView) => void
  boardCounts: Record<Stage, number>
  collapsed: boolean
  onToggle: () => void
}) {
  const nav = [
    { key: 'board', label: 'Board', icon: <LayoutGrid size={17} /> },
    { key: 'campaigns', label: 'Campaigns', icon: <Target size={17} /> },
    { key: 'commons', label: 'Commons', icon: <UsersRound size={17} /> },
    { key: 'chat', label: 'Milo', icon: <Bot size={17} /> },
    { key: 'products', label: 'Products', icon: <Package size={17} /> },
    { key: 'calendar', label: 'Calendar', icon: <CalendarDays size={17} /> },
    { key: 'skills', label: 'Skills', icon: <Sparkles size={17} /> },
    { key: 'settings', label: 'Settings', icon: <SettingsIcon size={17} /> },
  ]
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-head">
        <div className="brand"><img src="/ocd-folder.png" alt="" aria-hidden="true" /><span>OCD</span></div>
        <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      {nav.map((n) => n.key === 'board' ? (
        <div className="nav-group" key={n.key}>
          <button
            className={`nav-item ${route === n.key ? 'active' : ''}`}
            title={n.label}
            onClick={() => onBoardView('kanban')}
          >
            {n.icon} <span className="nav-label">{n.label}</span>
          </button>
          <div className="nav-subitems" aria-label="Board views">
            {STAGES.map((stage) => (
              <button
                className={`nav-subitem nav-subitem-${stage} ${route === 'board' && boardView === stage ? 'on' : ''}`}
                key={stage}
                onClick={() => onBoardView(stage)}
              >
                <span className="subnav-dot" />
                <span>{STAGE_LABEL[stage]}</span>
                <span className="subnav-count">{boardCounts[stage]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button key={n.key} title={n.label} className={`nav-item ${route === n.key ? 'active' : ''}`} onClick={() => onRoute(n.key)}>
          {n.icon} <span className="nav-label">{n.label}</span>
        </button>
      ))}
      <div className="nav-spacer" />
      <button className={`nav-item ${route === 'profile' ? 'active' : ''}`} title={email || 'You'} onClick={() => onRoute('profile')}><UserCircle2 size={17} /> <span className="nav-label">{email || 'You'}</span></button>
    </aside>
  )
}

function PostCard({
  post, posts, campaign, product, onOpen, reload,
}: {
  post: Rec
  posts: Rec[]
  campaign?: string
  product?: Rec
  onOpen: () => void
  reload: () => void
}) {
  const stage = str(post, 'stage')
  const spec = formatSpec(str(post, 'format_type'))
  const Icon = spec?.icon
  const formats = postFormats(post)
  const substage = str(post, 'substage')
  return (
    <article className={`card tint-${stage}`}>
      <button className="card-open" onClick={onOpen}>
        <span className="card-title">{str(post, 'title') || 'Untitled'}</span>
        <span className="card-snippet">{plainText(str(post, 'body_md')) || 'No content yet.'}</span>
      </button>
      <div className="card-foot">
        <span className="card-details">
          <span className="card-chips">
            <FormatChips formats={formats} />
            {substage ? <SubstageChip value={substage} options={substageOptions(formats)} /> : null}
            {spec && Icon ? <span className="mini-pill fmt"><Icon size={11} /> {spec.label}</span> : null}
            <VersionChips post={post} />
            {product ? <span className="mini-pill prod"><Package size={10} /> {str(product, 'name')}</span> : null}
          </span>
          <span className="card-meta">
            <ChannelIcon channel={str(post, 'channel')} />
            {campaign ? <span>{campaign}</span> : null}
          </span>
        </span>
        <PostActions post={post} posts={posts} reload={reload} variant="footer" />
      </div>
    </article>
  )
}

const ART_PALETTES = [
  ['#f7b267', '#f79d65', '#7dcfb6'],
  ['#8377d1', '#b8b8ff', '#ffd6e0'],
  ['#1d5b79', '#468b97', '#efc7a8'],
  ['#f2cc8f', '#81b29a', '#3d405b'],
  ['#ff8fab', '#fb6f92', '#ffe5ec'],
  ['#6d597a', '#b56576', '#e56b6f'],
  ['#4361ee', '#4cc9f0', '#f72585'],
  ['#cdb4db', '#ffc8dd', '#a2d2ff'],
] as const

type ArtStyle = CSSProperties & {
  '--art-a': string
  '--art-b': string
  '--art-c': string
  '--art-turn': string
}

function artStyle(seed: string): ArtStyle {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  const palette = ART_PALETTES[Math.abs(hash) % ART_PALETTES.length]
  return {
    '--art-a': palette[0],
    '--art-b': palette[1],
    '--art-c': palette[2],
    '--art-turn': `${Math.abs(hash % 110) - 55}deg`,
  }
}

/** Compact "Aug 28"-style date, matching the footer's scheduled-date format. */
function formatCardDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Editorial card — near-white surface, a thin top accent strip (the post's own
 * deterministic `artStyle` gradient, reused from the old full-illustration
 * treatment but confined to a sliver instead of a 100px block), title-first
 * hierarchy. Colour is an accent, not the point: see the redesign brief for
 * why the old large gradient illustrations were replaced.
 */
function VisualIdeaCard({
  post, posts, campaign, product, onOpen, reload,
}: {
  post: Rec
  posts: Rec[]
  campaign?: string
  product?: Rec
  onOpen: () => void
  reload: () => void
}) {
  const spec = formatSpec(str(post, 'format_type'))
  const formats = postFormats(post)
  const id = str(post, 'id')
  const title = str(post, 'title') || 'Untitled'
  const substage = str(post, 'substage')
  const saved = formatCardDate(str(post, 'created_at'))
  const scheduled = formatCardDate(str(post, 'scheduled_at'))
  const hasVersions = versionPlatforms(post).length > 0
  const typeLabel = formats.length
    ? formats.map((key) => CONTENT_FORMAT_SPEC[key].short).join(' · ')
    : spec ? spec.label : 'Note'
  const typeAccent = formats.length ? CONTENT_FORMAT_SPEC[formats[0]].accent : spec?.accent

  return (
    <article className="idea-card" style={artStyle(id || title)}>
      <span className="idea-card-strip" aria-hidden="true" />
      <div className="idea-card-head">
        <span className="idea-card-type">
          <span className="idea-card-dot" style={{ background: typeAccent }} />
          {typeLabel}
        </span>
        <span className="idea-card-head-right">
          {saved ? <span className="idea-card-saved" title={`Captured ${saved}`}>{saved}</span> : null}
          <PostActions post={post} posts={posts} reload={reload} variant="card" />
        </span>
      </div>
      <button className="idea-card-copy" onClick={onOpen} aria-label={`Open ${title}`}>
        <span className="idea-card-title">{title}</span>
        <span className="idea-card-snippet">{plainText(str(post, 'body_md')) || 'No content yet.'}</span>
      </button>
      <span className="idea-card-foot">
        <span className="idea-card-foot-left">
          {substage ? <SubstageChip value={substage} options={substageOptions(formats)} /> : null}
          {campaign ? <><Target size={11} /> <span>{campaign}</span></>
            : product ? <><Package size={11} /> <span>{str(product, 'name')}</span></>
            : hasVersions ? <VersionChips post={post} /> : null}
        </span>
        {scheduled ? <span className="idea-card-scheduled">{scheduled}</span> : null}
      </span>
    </article>
  )
}

export function Board({
  posts, campaigns, products, view, onOpenPost, onNewPost, creating, loading,
  onDropFiles, dropping, reload,
}: {
  posts: Rec[]; campaigns: Rec[]; products: Rec[]
  view: BoardView
  onOpenPost: (id: string) => void; onNewPost: () => void
  creating: boolean; loading: boolean
  onDropFiles: (files: File[]) => void; dropping: boolean
  reload: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState<VersionFilter>({ mode: 'has', platforms: [] })
  const [filterOpen, setFilterOpen] = useState(false)
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all')
  const [formatOpen, setFormatOpen] = useState(false)
  const [subFilter, setSubFilter] = useState<string>('all')
  const dragCounter = useRef(0)

  const versionActive = filter.platforms.length > 0
  const formatActive = formatFilter !== 'all'
  const filterActive = versionActive || formatActive
  // Every board view reads from the filtered set, so column counts always match
  // the cards actually on screen. Format and platform filters persist across
  // stage subtabs the same way.
  // Two levels: format/platform scope everything, then the substage narrows the
  // focused stage further (only meaningful inside refining, so it never touches
  // the kanban). Counts for the step tabs read the un-narrowed set on purpose.
  const scopedPosts = posts.filter((p) => matchesVersionFilter(p, filter) && matchesFormatFilter(p, formatFilter))
  const substageActive = view !== 'kanban' && subFilter !== 'all'
  const visiblePosts = substageActive ? scopedPosts.filter((p) => str(p, 'substage') === subFilter) : scopedPosts
  const scopedByStage = view === 'kanban' ? scopedPosts : scopedPosts.filter((p) => str(p, 'stage') === view)
  // With no format filter chosen we can't know the piece type, so offer every step.
  const subOptions = substageOptions(formatFilter === 'all' ? [] : [formatFilter])
  const subCount = (key: string) => scopedByStage.filter((p) => str(p, 'substage') === key).length
  const formatPool = view === 'kanban'
    ? posts.filter((p) => matchesVersionFilter(p, filter))
    : posts.filter((p) => str(p, 'stage') === view && matchesVersionFilter(p, filter))

  // A step from a previous stage/format would silently hide everything here.
  useEffect(() => { setSubFilter('all') }, [view, formatFilter])

  useEffect(() => {
    if (!formatOpen && !filterOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFormatOpen(false)
        setFilterOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [formatOpen, filterOpen])

  const campaignName = (id: string) => {
    const c = campaigns.find((c) => str(c, 'id') === id)
    return c ? str(c, 'name') : undefined
  }
  const productFor = (id: string) => products.find((p) => str(p, 'id') === id)
  const countByStage = (s: string) => visiblePosts.filter((p) => str(p, 'stage') === s).length
  const postsByStage = (s: Stage) => visiblePosts.filter((p) => str(p, 'stage') === s)

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current++
    setDragOver(true)
  }
  function handleDragLeave() {
    dragCounter.current--
    if (dragCounter.current === 0) setDragOver(false)
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault() }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onDropFiles(files)
  }

  const showOverlay = dragOver || dropping

  return (
    <div
      className="main"
      style={{ position: 'relative' }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="topbar">
        <div className="tabs"><span className="tab active">Posts</span></div>
        <div className="tools">
          <FilterDropdown
            label="Filter by format"
            valueLabel={formatFilter === 'all' ? 'Format' : CONTENT_FORMAT_SPEC[formatFilter].short}
            active={formatActive}
            open={formatOpen}
            onToggle={() => { setFilterOpen(false); setFormatOpen((open) => !open) }}
            onClose={() => setFormatOpen(false)}
          >
            <DropOption
              selected={formatFilter === 'all'}
              onPick={() => { setFormatFilter('all'); setFormatOpen(false) }}
              count={formatPool.length}
            >
              All formats
            </DropOption>
            {CONTENT_FORMATS.map((key) => {
              const spec = CONTENT_FORMAT_SPEC[key]
              return (
                <DropOption
                  key={key}
                  selected={formatFilter === key}
                  onPick={() => { setFormatFilter(key); setFormatOpen(false) }}
                  icon={spec.icon}
                  count={formatPool.filter((p) => postFormats(p).includes(key)).length}
                >
                  {spec.label}
                </DropOption>
              )
            })}
          </FilterDropdown>
          <div className="filter-wrap">
            <button
              className={`icon-btn${versionActive ? ' on' : ''}`}
              title="Filter by platform version"
              onClick={() => { setFormatOpen(false); setFilterOpen((open) => !open) }}
            >
              <Filter size={16} />
              {versionActive ? <span className="filter-count">{filter.platforms.length}</span> : null}
            </button>
            {filterOpen ? (
              <VersionFilterMenu filter={filter} onChange={setFilter} onClose={() => setFilterOpen(false)} />
            ) : null}
          </div>
          <button className="cta" onClick={onNewPost} disabled={creating}>
            <Plus size={15} /> {creating ? 'Creating…' : 'New post'}
          </button>
        </div>
      </div>

      <div className="scroll board-scroll">
        {loading ? (
            <div className="loading">Loading posts…</div>
          ) : view === 'kanban' ? (
            <div className="board-grid">
              {STAGES.map((s) => {
                const stagePosts = postsByStage(s)
                return (
                  <section key={s} className={`board-column board-column-${s}`}>
                    <div className="board-column-head">
                      <span className="board-column-title">
                        <span className="board-stage-dot" />
                        {STAGE_LABEL[s]}
                      </span>
                      <span className="board-column-count">{countByStage(s)}</span>
                    </div>
                    <div className="board-column-cards">
                      {stagePosts.map((p) => (
                        <PostCard
                          key={str(p, 'id')} post={p} posts={posts}
                          campaign={campaignName(str(p, 'campaign_id')) || undefined}
                          product={productFor(str(p, 'product_id'))}
                          onOpen={() => onOpenPost(str(p, 'id'))}
                          reload={reload}
                        />
                      ))}
                      {!stagePosts.length ? (
                        <div className="board-column-empty">Nothing here yet.</div>
                      ) : null}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <section className={`focused-stage focused-stage-${view}`} key={view}>
              <header className="focused-stage-head">
                <div>
                  <h1><span className="focused-stage-dot" /> {STAGE_LABEL[view]}</h1>
                </div>
                <span className="focused-stage-summary">
                  {countByStage(view)} {countByStage(view) === 1 ? 'post' : 'posts'} in this stage
                  {formatActive ? (
                    <button className="focused-stage-filter" onClick={() => setFormatFilter('all')} title="Clear format filter">
                      {CONTENT_FORMAT_SPEC[formatFilter].short}
                      <X size={12} />
                    </button>
                  ) : null}
                  {versionActive ? (
                    <button className="focused-stage-filter" onClick={() => setFilter({ ...filter, platforms: [] })}>
                      {filter.mode === 'has' ? 'with' : 'without'}
                      {filter.platforms.map((platform) => (
                        <PlatformIcon key={platform} platform={platform} size={14} label={false} />
                      ))}
                      <X size={12} />
                    </button>
                  ) : null}
                </span>
              </header>
              {view === 'refining' ? (
                <div className="substage-tabs" role="group" aria-label="Filter by production step">
                  <button
                    type="button"
                    className={`substage-tab${subFilter === 'all' ? ' on' : ''}`}
                    onClick={() => setSubFilter('all')}
                  >
                    All steps
                    <span className="substage-tab-count">{scopedByStage.length}</span>
                  </button>
                  {subOptions.map((key, index) => (
                    <button
                      key={key}
                      type="button"
                      className={`substage-tab${subFilter === key ? ' on' : ''}`}
                      onClick={() => setSubFilter(key)}
                    >
                      <span className="substage-tab-step">{index + 1}</span>
                      {SUBSTAGE_LABEL[key]}
                      <span className="substage-tab-count">{subCount(key)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {postsByStage(view).length ? (
                <div className="idea-art-grid">
                  {postsByStage(view).map((p) => (
                    <VisualIdeaCard
                      key={str(p, 'id')}
                      post={p}
                      posts={posts}
                      campaign={campaignName(str(p, 'campaign_id')) || undefined}
                      product={productFor(str(p, 'product_id'))}
                      onOpen={() => onOpenPost(str(p, 'id'))}
                      reload={reload}
                    />
                  ))}
                </div>
              ) : (
                <div className="focused-stage-empty">
                  <span className="focused-stage-dot" />
                  {filterActive ? (
                    <>
                      {versionActive
                        ? <>
                            No {STAGE_LABEL[view]}
                            {formatActive ? ` ${CONTENT_FORMAT_SPEC[formatFilter].label.toLowerCase()}` : ''}
                            {' '}post {filter.mode === 'has' ? 'has' : 'is missing'}{' '}
                            {filter.platforms.map((platform) => PLATFORM_LABEL[platform]).join(' + ')}{' '}
                            {filter.platforms.length > 1 ? 'versions' : 'a version'}.
                          </>
                        : <>No {STAGE_LABEL[view]} {formatActive ? `${CONTENT_FORMAT_SPEC[formatFilter].label.toLowerCase()} ` : ''}posts here.</>}
                      <button
                        className="ghost"
                        onClick={() => { setFilter({ ...filter, platforms: [] }); setFormatFilter('all') }}
                      >
                        Clear {versionActive && formatActive ? 'filters' : 'filter'}
                      </button>
                    </>
                  ) : `Nothing in ${STAGE_LABEL[view]} yet.`}
                </div>
              )}
            </section>
          )}
      </div>

      {showOverlay && (
        <div className="drop-overlay">
          <div className="drop-message">
            {dropping
              ? <><Loader2 size={22} className="spin" /> Importing…</>
              : <><Upload size={22} /> Drop to create a post</>
            }
          </div>
        </div>
      )}
    </div>
  )
}
