import { useRef, useState, type ChangeEvent } from 'react'
import { useLiveRecords, useCreateRecord, useUpdateRecord, useDeleteRecord, useUploadFile } from 'lemma-sdk/react'
import { Plus, Package, Trash2, Loader2, FileText, Upload, X, Check } from 'lucide-react'
import { lemmaClient } from './lemma-client'
import { Rec, str } from './lib'

type Doc = { name: string; path: string }
function parseDocs(v: unknown): Doc[] {
  let x = v
  if (typeof x === 'string') { try { x = JSON.parse(x) } catch { return [] } }
  return Array.isArray(x) ? (x as Doc[]).filter((d) => d && d.path) : []
}

function ProductDetail({ product, onChanged }: { product: Rec; onChanged: () => void }) {
  const id = str(product, 'id')
  const { update } = useUpdateRecord({ client: lemmaClient, tableName: 'products', recordId: id })
  const { remove } = useDeleteRecord({ client: lemmaClient, tableName: 'products', recordId: id })
  const { upload } = useUploadFile({ client: lemmaClient })
  const [name, setName] = useState(str(product, 'name'))
  const [emoji, setEmoji] = useState(str(product, 'emoji'))
  const [ctx, setCtx] = useState(str(product, 'context_md'))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const status = str(product, 'status') || 'active'
  const docs = parseDocs(product['doc_paths'])
  const dirty = name !== str(product, 'name') || emoji !== str(product, 'emoji') || ctx !== str(product, 'context_md')

  async function save() {
    setSaving(true)
    try { await update({ name, emoji, context_md: ctx }); setSaved(true); setTimeout(() => setSaved(false), 1600); onChanged() }
    finally { setSaving(false) }
  }
  async function onPickDocs(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      const next = [...docs]
      for (const f of files) {
        const res = await upload(f, { directoryPath: `/product-docs/${id}`, name: f.name, searchEnabled: true })
        const path = res ? str(res as Rec, 'path') : ''
        if (path) next.push({ name: f.name, path })
      }
      await update({ doc_paths: next })
      onChanged()
    } finally { setUploading(false) }
  }
  async function removeDoc(path: string) {
    await update({ doc_paths: docs.filter((d) => d.path !== path) })
    try { await lemmaClient.files.delete(path) } catch { /* file may already be gone */ }
    onChanged()
  }
  async function viewDoc(path: string) {
    try { const r = await lemmaClient.files.getUrl(path); const url = r ? str(r as Rec, 'url') : ''; if (url) window.open(url, '_blank') } catch { /* noop */ }
  }

  return (
    <div className="prod-detail">
      <div className="prod-head">
        <input className="emoji-input" value={emoji} placeholder="📦" maxLength={2} onChange={(e) => setEmoji(e.target.value)} />
        <input className="camp-title-input" value={name} placeholder="Product name" onChange={(e) => setName(e.target.value)} />
        <div className="pills" style={{ gap: 4 }}>
          {(['active', 'archived'] as const).map((s) => (
            <button key={s} className={`pick ${status === s ? 'on' : ''}`} style={{ fontSize: 11 }} onClick={() => update({ status: s }).then(onChanged)}>{s}</button>
          ))}
        </div>
        <button className={`cta prod-save${saved ? ' saved' : ''}`} onClick={save} disabled={saving || (!dirty && !saved)}>
          {saved ? <><Check size={14} /> Saved</> : saving ? <><Loader2 size={14} className="spin" /> Saving…</> : 'Save'}
        </button>
        <button className="icon-danger" title="Delete product" onClick={async () => { if (confirm('Delete this product?')) { await remove(); onChanged() } }}><Trash2 size={15} /></button>
      </div>

      <div className="rlabel" style={{ marginTop: 16 }}>Context for the Writer (markdown)</div>
      <textarea className="prod-ctx" value={ctx} placeholder="What is this product? Positioning, who it's for, key facts the Writer should know…" onChange={(e) => setCtx(e.target.value)} />

      <div className="prod-docs-head">
        <span className="rlabel">Context docs</span>
        <button className="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={13} className="spin" /> : <Upload size={13} />} {uploading ? 'Uploading…' : 'Add markdown'}
        </button>
        <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown" multiple style={{ display: 'none' }} onChange={onPickDocs} />
      </div>
      {docs.length ? (
        <div className="prod-docs">
          {docs.map((d) => (
            <div className="prod-doc" key={d.path}>
              <FileText size={14} /> <span className="prod-doc-name">{d.name}</span>
              <button className="prod-doc-btn" onClick={() => viewDoc(d.path)}>View</button>
              <button className="prod-doc-btn danger" onClick={() => removeDoc(d.path)} aria-label="remove doc"><X size={13} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>No docs yet. Upload one or more markdown files — the Writer reads them all when this product is tagged.</div>
      )}
    </div>
  )
}

export function ProductsManager() {
  const query = useLiveRecords({ client: lemmaClient, tableName: 'products' })
  const { create, isSubmitting } = useCreateRecord({ client: lemmaClient, tableName: 'products' })
  const products = query.records as Rec[]
  const [selId, setSelId] = useState<string | null>(null)

  const selected = products.find((p) => str(p, 'id') === selId) || null

  async function addProduct() {
    const rec = await create({ name: 'Untitled product', status: 'active' })
    if (rec) setSelId(str(rec as Rec, 'id'))
    void query.refresh()
  }

  return (
    <div className="main">
      <div className="topbar">
        <div className="tabs"><span className="tab active"><Package size={14} /> Products</span></div>
        <div className="tools">
          <button className="cta" onClick={addProduct} disabled={isSubmitting}>
            <Plus size={15} /> {isSubmitting ? 'Adding…' : 'New product'}
          </button>
        </div>
      </div>
      <div className="scroll">
        {query.isLoading ? (
          <div className="loading"><Loader2 size={16} className="spin" /> Loading products…</div>
        ) : (
          <div className="prod-layout">
            <div className="prod-list">
              {products.length ? products.map((p) => (
                <button key={str(p, 'id')} className={`prod-row ${selId === str(p, 'id') ? 'on' : ''}`} onClick={() => setSelId(str(p, 'id'))}>
                  <span>{str(p, 'emoji') || '📦'}</span>
                  <span className="prod-name">{str(p, 'name')}</span>
                  {str(p, 'status') === 'archived' ? <span className="muted" style={{ fontSize: 11 }}>archived</span> : null}
                </button>
              )) : <div className="empty" style={{ border: 'none', background: 'none' }}>No products yet. Add one to give the Writer context.</div>}
            </div>
            {selected ? <ProductDetail key={selId!} product={selected} onChanged={() => query.refresh()} /> : (
              <div className="prod-detail muted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Select or add a product.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
