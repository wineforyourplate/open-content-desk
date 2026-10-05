import { useEffect, useState } from 'react'
import { Sparkles, Plus, Loader2, Save, FileText } from 'lucide-react'
import { lemmaClient } from './lemma-client'
import { Rec, str } from './lib'

type GuideFile = { name: string; path: string }
const prettyName = (fn: string) =>
  fn.replace(/^skill_/, '').replace(/\.md$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

async function readText(path: string): Promise<string> {
  try { const b = await lemmaClient.files.download(path); return await (b as Blob).text() } catch { return '' }
}

export function Skills() {
  const [files, setFiles] = useState<GuideFile[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<GuideFile | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingDoc, setLoadingDoc] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const res = (await lemmaClient.files.list({ directoryPath: '/guides' })) as Rec
      const items = (Array.isArray(res) ? res : (res['items'] as Rec[]) || []) as Rec[]
      setFiles(items.map((i) => ({ name: str(i, 'name'), path: str(i, 'path') })).filter((g) => g.name.endsWith('.md')))
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  async function open(g: GuideFile) {
    setSel(g); setLoadingDoc(true); setDirty(false)
    setContent(await readText(g.path))
    setLoadingDoc(false)
  }
  async function save() {
    if (!sel) return
    setSaving(true)
    try {
      const file = new File([content], sel.name, { type: 'text/markdown' })
      await lemmaClient.files.upload(file, { directoryPath: '/guides', name: sel.name, searchEnabled: true })
      setDirty(false)
    } finally { setSaving(false) }
  }
  async function create() {
    const name = window.prompt('New skill name (e.g. "LinkedIn Post"):')
    if (!name) return
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const fn = `skill_${slug}.md`
    const starter = `# ${name} Skill\n\nVoice: describe the tone here.\n\nStructure:\n1. …\n2. …\n\nOutput contract: (how the Writer should return this format)\n\nWhat to avoid: …\n`
    await lemmaClient.files.upload(new File([starter], fn, { type: 'text/markdown' }), { directoryPath: '/guides', name: fn, searchEnabled: true })
    await refresh()
    void open({ name: fn, path: `/guides/${fn}` })
  }

  return (
    <div className="main">
      <div className="topbar">
        <div className="tabs"><span className="tab active"><Sparkles size={14} /> Skills</span></div>
        <div className="tools"><button className="cta" onClick={create}><Plus size={15} /> New skill</button></div>
      </div>
      <div className="scroll">
        <div className="screen-hint">Skills are the style guides the Writer loads when drafting each format — edit them to tune voice &amp; structure.</div>
        <div className="prod-layout">
          <div className="prod-list">
            {loading ? <div className="loading"><Loader2 size={16} className="spin" /> Loading…</div> :
              files.length ? files.map((g) => (
                <button key={g.path} className={`prod-row ${sel?.path === g.path ? 'on' : ''}`} onClick={() => open(g)}>
                  <FileText size={15} /> <span className="prod-name">{prettyName(g.name)}</span>
                </button>
              )) : <div className="empty" style={{ border: 'none', background: 'none' }}>No skills yet — create one.</div>}
          </div>
          <div className="prod-detail">
            {!sel ? <div className="muted" style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>Select a skill to edit its guide.</div> :
              loadingDoc ? <div className="loading"><Loader2 size={16} className="spin" /> Loading…</div> :
              <>
                <div className="prod-head">
                  <div className="camp-title-input" style={{ fontWeight: 700 }}>{prettyName(sel.name)}</div>
                  <button className="cta prod-save" onClick={save} disabled={saving || !dirty}>
                    {saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Save size={14} /> Save</>}
                  </button>
                </div>
                <textarea className="prod-ctx" style={{ minHeight: 380 }} value={content}
                  onChange={(e) => { setContent(e.target.value); setDirty(true) }} />
              </>}
          </div>
        </div>
      </div>
    </div>
  )
}
