// The right-rail "section of rows" chrome shared by the private CampaignEditor
// (Files + Posts, both editable) and a shared campaign's read-only Commons
// reader (Posts only). Restyling a row or a section head here lands in both
// places — that's the point: the two screens show the campaign's linked posts
// through the SAME component, not two hand-rolled lists that can drift apart.
//
// Capability, not a role flag: pass `onRemove` to a row and it gets a remove
// button; omit it and the row is read-only. Same idea one level up — Commons
// never renders a Files section at all, because a shared campaign snapshot
// doesn't carry doc_paths, not because of a `readOnly` switch here.

import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function CampaignRailSection({
  title, count, headerAction, empty, children,
}: {
  title: string
  count: number
  headerAction?: ReactNode
  empty: string
  children: ReactNode
}) {
  return (
    <section className="rail-sec">
      <div className="rail-sec-head">
        <span className="rail-sec-title">{title}{count ? <em>{count}</em> : null}</span>
        {headerAction}
      </div>
      {count ? <ul className="rail-list">{children}</ul> : <p className="rail-empty">{empty}</p>}
    </section>
  )
}

export function CampaignPostRow({
  id, title, meta, rowClassName, onOpen, onRemove,
}: {
  id: string
  title: string
  meta: ReactNode
  rowClassName?: string
  onOpen: () => void
  onRemove?: () => void
}) {
  return (
    <li className={`rail-item rail-post${rowClassName ? ` ${rowClassName}` : ''}`} key={id}>
      <button className="rail-post-open" onClick={onOpen}>
        <span className="rail-post-name">{title}</span>
        <span className="rail-post-meta">{meta}</span>
      </button>
      {onRemove ? (
        <span className="rail-item-actions">
          <button className="danger" title="Remove from campaign" onClick={onRemove}><X size={13} /></button>
        </span>
      ) : null}
    </li>
  )
}
