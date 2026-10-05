import { useState } from 'react'
import { Tag, X } from 'lucide-react'

/** Free-form tag strip. Shared by the post and campaign props popovers. */
export function InlineTags({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="meta-tags">
      <Tag size={13} className="meta-tag-icon" />
      {tags.map((t) => (
        <span key={t} className="tag-chip">{t}<button onClick={() => onChange(tags.filter((x) => x !== t))} aria-label="remove tag"><X size={11} /></button></span>
      ))}
      <input className="tag-in" value={v} placeholder="+ tag"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onChange([...new Set([...tags, v.trim()])]); setV('') } }} />
    </div>
  )
}
