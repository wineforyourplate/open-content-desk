import { useEffect, useState, useRef, type DragEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Plus, Target, Upload, Loader2, type LucideIcon } from 'lucide-react'
import { Rec, str } from './lib'
import {
  CAMPAIGN_STAGES, CAMPAIGN_STAGE_LABEL, CAMPAIGN_TYPES, CAMPAIGN_TYPE_LABEL,
  campaignStage, campaignType, campaignDocs, campaignFormats,
  type CampaignStage, type CampaignType,
} from './campaignMeta'
import { CampaignCard } from './campaignCard'
import {
  CONTENT_FORMATS, CONTENT_FORMAT_SPEC, type ContentFormat,
} from './contentFormats'

type StageFilter = CampaignStage | 'all'
type TypeFilter = CampaignType | 'all'
type FormatFilter = ContentFormat | 'all'
type DropKey = 'type' | 'format'

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
  icon?: LucideIcon
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

export function Campaigns({
  campaigns, posts, onOpenCampaign, onNewCampaign, creating, loading, onDropFiles, dropping,
}: {
  campaigns: Rec[]; posts: Rec[]
  onOpenCampaign: (id: string) => void
  onNewCampaign: () => void
  creating: boolean
  loading: boolean
  onDropFiles: (files: File[]) => void
  dropping: boolean
}) {
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all')
  const [openDrop, setOpenDrop] = useState<DropKey | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)

  useEffect(() => {
    if (!openDrop) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenDrop(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openDrop])

  function matches(campaign: Rec, stage: StageFilter, type: TypeFilter, format: FormatFilter) {
    if (stage !== 'all' && campaignStage(campaign) !== stage) return false
    if (type !== 'all' && campaignType(campaign) !== type) return false
    if (format !== 'all' && !campaignFormats(campaign).includes(format)) return false
    return true
  }

  // Each filter's counts read from the set the OTHER filters have already
  // narrowed, so a chip's number always matches what clicking it will show.
  const visible = campaigns.filter((c) => matches(c, stageFilter, typeFilter, formatFilter))
  const filterActive = stageFilter !== 'all' || typeFilter !== 'all' || formatFilter !== 'all'

  const postCount = (id: string) => posts.filter((p) => str(p, 'campaign_id') === id).length

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
  const stageSet = campaigns.filter((c) => matches(c, 'all', typeFilter, formatFilter))
  const typeSet = campaigns.filter((c) => matches(c, stageFilter, 'all', formatFilter))
  const formatSet = campaigns.filter((c) => matches(c, stageFilter, typeFilter, 'all'))

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
        <div className="tabs"><span className="tab active"><Target size={14} /> Campaigns</span></div>
        <div className="tools">
          <button className="cta" onClick={onNewCampaign} disabled={creating}>
            <Plus size={15} /> {creating ? 'Creating…' : 'New campaign'}
          </button>
        </div>
      </div>

      <div className="scroll">
        {loading ? (
          <div className="loading"><Loader2 size={16} className="spin" /> Loading campaigns…</div>
        ) : campaigns.length ? (
          <>
            <div className="camp-filters">
              <div className="camp-seg" role="group" aria-label="Filter by stage">
                <button className={`camp-seg-btn${stageFilter === 'all' ? ' on' : ''}`} onClick={() => setStageFilter('all')}>
                  All <span className="camp-seg-count">{stageSet.length}</span>
                </button>
                {CAMPAIGN_STAGES.map((stage) => (
                  <button
                    key={stage}
                    className={`camp-seg-btn camp-filter-${stage}${stageFilter === stage ? ' on' : ''}`}
                    onClick={() => setStageFilter(stage)}
                  >
                    <span className="camp-filter-dot" />
                    {CAMPAIGN_STAGE_LABEL[stage]}
                    <span className="camp-seg-count">{stageSet.filter((c) => campaignStage(c) === stage).length}</span>
                  </button>
                ))}
              </div>
              <div className="camp-filter-drops">
                <FilterDropdown
                  label="Filter by type"
                  valueLabel={typeFilter === 'all' ? 'Type' : CAMPAIGN_TYPE_LABEL[typeFilter]}
                  active={typeFilter !== 'all'}
                  open={openDrop === 'type'}
                  onToggle={() => setOpenDrop((current) => current === 'type' ? null : 'type')}
                  onClose={() => setOpenDrop(null)}
                >
                  <DropOption selected={typeFilter === 'all'} onPick={() => { setTypeFilter('all'); setOpenDrop(null) }} count={typeSet.length}>
                    All types
                  </DropOption>
                  {CAMPAIGN_TYPES.map((type) => (
                    <DropOption
                      key={type}
                      selected={typeFilter === type}
                      onPick={() => { setTypeFilter(type); setOpenDrop(null) }}
                      count={typeSet.filter((c) => campaignType(c) === type).length}
                    >
                      {CAMPAIGN_TYPE_LABEL[type]}
                    </DropOption>
                  ))}
                </FilterDropdown>
                <FilterDropdown
                  label="Filter by format"
                  valueLabel={formatFilter === 'all' ? 'Format' : CONTENT_FORMAT_SPEC[formatFilter].short}
                  active={formatFilter !== 'all'}
                  open={openDrop === 'format'}
                  onToggle={() => setOpenDrop((current) => current === 'format' ? null : 'format')}
                  onClose={() => setOpenDrop(null)}
                >
                  <DropOption selected={formatFilter === 'all'} onPick={() => { setFormatFilter('all'); setOpenDrop(null) }} count={formatSet.length}>
                    All formats
                  </DropOption>
                  {CONTENT_FORMATS.map((key) => {
                    const spec = CONTENT_FORMAT_SPEC[key]
                    return (
                      <DropOption
                        key={key}
                        selected={formatFilter === key}
                        onPick={() => { setFormatFilter(key); setOpenDrop(null) }}
                        icon={spec.icon}
                        count={formatSet.filter((c) => campaignFormats(c).includes(key)).length}
                      >
                        {spec.label}
                      </DropOption>
                    )
                  })}
                </FilterDropdown>
              </div>
            </div>

            {visible.length ? (
              <div className="camp-grid">
                {visible.map((c) => (
                  <CampaignCard
                    key={str(c, 'id')}
                    campaign={c}
                    postCount={postCount(str(c, 'id'))}
                    docCount={campaignDocs(c).length}
                    onOpen={() => onOpenCampaign(str(c, 'id'))}
                  />
                ))}
              </div>
            ) : (
              <div className="focused-stage-empty">
                No {stageFilter === 'all' ? '' : `${CAMPAIGN_STAGE_LABEL[stageFilter]} `}
                {formatFilter === 'all' ? '' : `${CONTENT_FORMAT_SPEC[formatFilter].label.toLowerCase()} `}
                {typeFilter === 'all' ? 'campaigns' : `${CAMPAIGN_TYPE_LABEL[typeFilter].toLowerCase()} campaigns`} here.
                {filterActive ? (
                  <button className="ghost" onClick={() => { setStageFilter('all'); setTypeFilter('all'); setFormatFilter('all') }}>Clear filters</button>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            No campaigns yet.
            <button className="ghost" onClick={onNewCampaign} style={{ alignSelf: 'center' }}>
              <Plus size={14} /> Create your first campaign
            </button>
          </div>
        )}
      </div>

      {showOverlay && (
        <div className="drop-overlay">
          <div className="drop-message">
            {dropping
              ? <><Loader2 size={22} className="spin" /> Importing…</>
              : <><Upload size={22} /> Drop to create a campaign</>
            }
          </div>
        </div>
      )}
    </div>
  )
}
