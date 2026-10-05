import { useEffect, useState, type ReactNode } from 'react'
import { Settings as SettingsIcon, Loader2, Save } from 'lucide-react'
import { useLiveRecords, useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str } from './lib'

function obj(v: unknown): Rec {
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return {} } }
  return (v && typeof v === 'object') ? (v as Rec) : {}
}
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : (typeof v === 'string' && v ? [v] : []))
const lines = (a: string[]) => a.join('\n')
const toArr = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

export function Settings() {
  const q = useLiveRecords({ client: lemmaClient, tableName: 'context_profile' })
  const rows = q.records as Rec[]
  const active = rows.find((r) => str(r, 'status') === 'active') || rows[0]
  const id = active ? str(active, 'id') : null
  const { update } = useUpdateRecord({ client: lemmaClient, tableName: 'context_profile', recordId: id })

  const [voice, setVoice] = useState('')
  const [audience, setAudience] = useState('')
  const [topics, setTopics] = useState('')
  const [avoid, setAvoid] = useState('')
  const [positioning, setPositioning] = useState('')
  const [allowed, setAllowed] = useState('')
  const [proof, setProof] = useState('')
  const [blocked, setBlocked] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (loaded || !active) return
    const f = obj(active['founder_json']); const p = obj(active['product_json'])
    setVoice(str(f, 'voice')); setAudience(str(f, 'audience')); setTopics(lines(arr(f['topics']))); setAvoid(lines(arr(f['avoid'])))
    setPositioning(str(p, 'positioning') || str(p, 'name')); setAllowed(lines(arr(p['allowed_claims']))); setProof(lines(arr(p['proof_points']))); setBlocked(lines(arr(p['blocked_claims'])))
    setLoaded(true)
  }, [active, loaded])

  async function save() {
    if (!id) return
    setSaving(true)
    try {
      await update({
        founder_json: { voice, audience, topics: toArr(topics), avoid: toArr(avoid) },
        product_json: { positioning, allowed_claims: toArr(allowed), proof_points: toArr(proof), blocked_claims: toArr(blocked) },
      })
      setSaved(true); setTimeout(() => setSaved(false), 1600); void q.refresh()
    } finally { setSaving(false) }
  }

  return (
    <div className="main">
      <div className="topbar">
        <div className="tabs"><span className="tab active"><SettingsIcon size={14} /> Settings</span></div>
        <div className="tools">
          <button className={`cta prod-save${saved ? ' saved' : ''}`} onClick={save} disabled={saving || !id}>
            {saved ? 'Saved' : saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
      <div className="scroll">
        <div className="screen-hint">Brand context every draft is grounded in — Rocky uses only what you allow here.</div>
        {!active ? <div className="loading"><Loader2 size={16} className="spin" /> Loading…</div> : (
          <div className="settings-doc">
            <h3 className="settings-h">Brand &amp; voice</h3>
            <Field label="Voice"><input className="settings-in" value={voice} onChange={(e) => setVoice(e.target.value)} /></Field>
            <Field label="Audience"><input className="settings-in" value={audience} onChange={(e) => setAudience(e.target.value)} /></Field>
            <Field label="Topics (one per line)"><textarea className="settings-ta" value={topics} onChange={(e) => setTopics(e.target.value)} /></Field>
            <Field label="Avoid (one per line)"><textarea className="settings-ta" value={avoid} onChange={(e) => setAvoid(e.target.value)} /></Field>
            <h3 className="settings-h">Product &amp; claims</h3>
            <Field label="Positioning"><textarea className="settings-ta" value={positioning} onChange={(e) => setPositioning(e.target.value)} /></Field>
            <Field label="Allowed claims (one per line)"><textarea className="settings-ta" value={allowed} onChange={(e) => setAllowed(e.target.value)} /></Field>
            <Field label="Proof points (one per line)"><textarea className="settings-ta" value={proof} onChange={(e) => setProof(e.target.value)} /></Field>
            <Field label="Blocked claims — never say these"><textarea className="settings-ta" value={blocked} onChange={(e) => setBlocked(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="settings-field"><div className="rlabel">{label}</div>{children}</div>
}
