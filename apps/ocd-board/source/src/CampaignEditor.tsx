// Opening a campaign uses the SAME full-screen chrome as the Board's PostEditor
// (.editor-overlay / .editor-top / .editor-body / .editor-main / .editor-doc) —
// never a side drawer. Reusing those classes is also what makes it scroll:
// .editor-body is the flex clip and .editor-main owns overflow-y.
//
// GOTCHA: campaigns store their title in `name`; posts store it in `title`.
// Everything copied from PostEditor must swap the field.

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useUpdateRecord, useDeleteRecord, useCreateRecord, useUploadFile } from 'lemma-sdk/react'
import {
  ArrowLeft, Check, Trash2, Eye, Pencil, Plus, X, Loader2,
  FileText, Link2, Target, PanelRight, PanelRightClose, ExternalLink, UsersRound,
} from 'lucide-react'
import { lemmaClient } from './lemma-client'
import { Rec, str, parseBlocks, flattenBlocks, newId, importFile, uniqueFileName, StagePill, isNarrowScreen } from './lib'
import { TitleArea } from './editors/TitleArea'
import { DocumentEditor, type DocumentEditorHandle } from './RichText'
import { ReadView } from './PostEditor'
import { FormatChips, FormatPicker, parseContentFormats } from './contentFormats'
import { SubstageChip, substageOptions } from './substages'
import { ShareCampaignDialog } from './ShareToCommons'
import {
  CAMPAIGN_STAGES, CAMPAIGN_STAGE_LABEL, CAMPAIGN_TYPES, CAMPAIGN_TYPE_LABEL,
  CampaignMetaChips, campaignStage, campaignType, campaignDocs, campaignFormats, type CampaignDoc,
} from './campaignMeta'
import { CAMPAIGN_ICONS, campaignInitials } from './campaignArt'
import { syncCampaignMembership, syncSharedCampaign } from './commonsSync'
import { CampaignRailSection, CampaignPostRow } from './campaignRail'

export function CampaignEditor({
  campaign, posts, onOpenPost, onClose, reload,
}: {
  campaign: Rec
  posts: Rec[]
  onOpenPost: (id: string) => void
  onClose: () => void
  reload: () => void
}) {
  const id = str(campaign, 'id')

  // All hooks before any early return (React rules).
  const { update } = useUpdateRecord({ client: lemmaClient, tableName: 'campaigns', recordId: id || null })
  const { remove } = useDeleteRecord({ client: lemmaClient, tableName: 'campaigns', recordId: id || null })
  const { upload } = useUploadFile({ client: lemmaClient })
  const { create: createPost, isSubmitting: creatingPost } = useCreateRecord({ client: lemmaClient, tableName: 'posts' })
  const { update: updatePost } = useUpdateRecord({ client: lemmaClient, tableName: 'posts' })

  const [blocks, setBlocks] = useState<Rec[]>([])
  const [name, setName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<'read' | 'edit'>('edit')
  const [uploading, setUploading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editorDragOver, setEditorDragOver] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // On a phone the rail can't sit beside the document, so it starts closed there
  // regardless of the saved desktop preference — the top-bar toggle brings it in.
  const [railOpen, setRailOpen] = useState(() => !isNarrowScreen() && localStorage.getItem('ocd:campaign-rail') !== 'false')
  const [shareOpen, setShareOpen] = useState(false)
  const documentEditor = useRef<DocumentEditorHandle>(null)
  const editorDragCounter = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const mediaRef = useRef<HTMLInputElement>(null)
  // The campaign as it now stands on the server — see `save()` below.
  const savedCampaign = useRef<Rec>({})

  const stage = campaignStage(campaign)
  const type = campaignType(campaign)
  const formats = campaignFormats(campaign)
  const docs = campaignDocs(campaign)
  const mine = posts.filter((p) => str(p, 'campaign_id') === id)
  const unassigned = posts.filter((p) => !str(p, 'campaign_id'))

  // Seed editable state once. The guard is what stops a live-query refresh from
  // stomping in-progress typing; the parent keys on the campaign id to reset.
  useEffect(() => {
    if (loaded || !id) return
    const parsed = parseBlocks(campaign['blocks'])
    setBlocks(parsed.length
      ? parsed
      : (str(campaign, 'body_md') ? [{ id: newId(), type: 'text', text: str(campaign, 'body_md') }] : []))
    setName(str(campaign, 'name'))
    savedCampaign.current = { ...campaign }
    setLoaded(true)
  }, [campaign, id, loaded])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && mode === 'read') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, mode])

  /**
   * Persist `data`, remember it as the campaign's current state, and push the
   * result into every Commons board this campaign is shared to.
   *
   * The `savedCampaign` ref exists for the same reason PostEditor's does: the
   * `campaign` prop only catches up on the parent's next reload, and a Commons
   * row is rewritten WHOLE, so syncing from the prop pushes stale content over
   * fresh — a title save re-uploading the brief as it was when the editor
   * opened, and the next brief save putting the old title back.
   */
  async function save(data: Rec) {
    savedCampaign.current = { ...savedCampaign.current, ...data }
    await update(data)
    await syncSharedCampaign(savedCampaign.current)
  }
  async function patch(data: Rec) {
    await save(data)
    reload()
  }
  async function persistBlocks(next: Rec[]) {
    setBlocks(next)
    await save({ blocks: next, body_md: flattenBlocks(next) })
    reload()
  }
  async function commitTitle() {
    await save({ name })   // campaigns use `name`, not `title`
    reload()
  }
  /**
   * Writing doc_paths also retires the legacy single brief_path — campaignDocs()
   * has already folded it into `next`, so clearing it prevents a duplicate row.
   */
  async function persistDocs(next: CampaignDoc[]) {
    await save({ doc_paths: next, ...(str(campaign, 'brief_path') ? { brief_path: null } : {}) })
    reload()
  }

  async function onPickDocs(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      const next = [...docs]
      for (const file of files) {
        const res = await upload(file, { directoryPath: `/me/campaigns/${id}`, name: uniqueFileName(file.name), searchEnabled: true })
        const path = res ? str(res as Rec, 'path') : ''
        if (path) next.push({ name: file.name, path })
      }
      await persistDocs(next)
    } finally { setUploading(false) }
  }
  async function removeDoc(path: string) {
    await persistDocs(docs.filter((d) => d.path !== path))
    try { await lemmaClient.files.delete(path) } catch { /* file may already be gone */ }
  }
  async function viewDoc(path: string) {
    try {
      const r = await lemmaClient.files.getUrl(path)
      const url = r ? str(r as Rec, 'url') : ''
      if (url) window.open(url, '_blank')
    } catch { /* noop */ }
  }
  async function onPickMedia(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    // Show an "uploading…" placeholder the instant a file is picked — same
    // reasoning as PostEditor.tsx's onPickImage, which this mirrors.
    const placeholderId = newId()
    documentEditor.current?.insertPlaceholder(placeholderId, file.name)
    try {
      const res = await upload(file, { directoryPath: `/me/campaigns/${id}`, name: uniqueFileName(file.name) })
      const path = res ? str(res as Rec, 'path') : ''
      if (!path) { documentEditor.current?.failPlaceholder(placeholderId); return }
      await documentEditor.current?.resolvePlaceholder(placeholderId, {
        kind: /\.(mp4|mov|webm|m4v|avi)$/i.test(file.name) ? 'video' : 'image',
        path,
        alt: file.name,
      })
    } catch {
      documentEditor.current?.failPlaceholder(placeholderId)
    }
  }

  function handleEditorDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    editorDragCounter.current++
    setEditorDragOver(true)
  }
  function handleEditorDragLeave() {
    editorDragCounter.current--
    if (editorDragCounter.current === 0) setEditorDragOver(false)
  }
  function handleEditorDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault() }
  /** Dropping inlines the file's text AND keeps the original attached — without
   *  the second half a dropped PDF is stored but never listed. */
  async function handleEditorDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    editorDragCounter.current = 0
    setEditorDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    setImporting(true)
    try {
      const imported: Rec[] = []
      const nextDocs = [...docs]
      for (const file of files) {
        const { blocks: newBlocks, path } = await importFile(file, `/me/campaigns/${id}`)
        imported.push(...newBlocks)
        if (path) nextDocs.push({ name: file.name, path })
      }
      await documentEditor.current?.insertBlocks(imported)
      await persistDocs(nextDocs)
    } finally { setImporting(false) }
  }

  async function handleNewPost() {
    const rec = await createPost({
      title: 'Untitled', stage: 'spark', channel: 'desk',
      campaign_id: id, blocks: [], body_md: '',
    })
    // Deliberately no membership sync here: a brand-new post is an empty
    // "Untitled", and pushing that to everyone's campaign rail the instant the
    // button is pressed is noise. Its first real save creates the child row.
    if (rec) onOpenPost(str(rec as Rec, 'id'))
    reload()
  }
  /**
   * Linking/unlinking changes what a SHARED campaign contains, so Commons has
   * to hear about it — this path doesn't go through PostEditor's `syncNote`,
   * which is where every other post change picks membership sync up.
   */
  async function syncMembership(postId: string, campaignId: string | null) {
    const post = posts.find((p) => str(p, 'id') === postId)
    if (!post) return
    await syncCampaignMembership({ ...post, campaign_id: campaignId })
  }
  async function attachPost(postId: string) {
    setPickerOpen(false)
    await updatePost({ campaign_id: id }, { recordId: postId })
    await syncMembership(postId, id)
    reload()
  }
  async function detachPost(postId: string) {
    await updatePost({ campaign_id: null }, { recordId: postId })
    await syncMembership(postId, null)
    reload()
  }
  async function handleDelete() {
    if (!confirm('Delete this campaign? Posts in it are kept and simply unlinked.')) return
    // Unlink first: posts.campaign_id is a FK, and deleting a still-referenced
    // campaign can be rejected by the server.
    for (const p of mine) {
      try { await updatePost({ campaign_id: null }, { recordId: str(p, 'id') }) } catch { /* best effort */ }
    }
    await remove()
    reload()
    onClose()
  }

  if (!id) {
    return (
      <div className="editor-overlay">
        <div className="loading" style={{ padding: 40 }}>Loading campaign…</div>
      </div>
    )
  }

  const stageIndex = CAMPAIGN_STAGES.indexOf(stage)
  const readOnly = mode === 'read'

  return (
    <div className="editor-overlay campaign-overlay">
      <div className="editor-top">
        <div className="crumb">
          <button className="editor-back" onClick={onClose} title="Back to campaigns"><ArrowLeft size={19} /></button>
          <span className="editor-note-name">{name || 'Untitled campaign'}</span>
        </div>
        <div className="stepper">
          {CAMPAIGN_STAGES.map((s, i) => (
            <span key={s} className="step-wrap">
              <button
                className={`step ${stage === s ? 'cur' : ''} ${stageIndex > i ? 'done' : ''}`}
                onClick={() => void patch({ stage: s })}
              >
                {stageIndex > i ? <Check size={12} /> : null} {CAMPAIGN_STAGE_LABEL[s]}
              </button>
              {i < CAMPAIGN_STAGES.length - 1 ? <span className="step-sep">›</span> : null}
            </span>
          ))}
        </div>
        <div className="top-right">
          <div className="view-toggle">
            <button className={readOnly ? 'on' : ''} onClick={() => setMode('read')}><Eye size={14} /> Read</button>
            <button className={!readOnly ? 'on' : ''} onClick={() => setMode('edit')}><Pencil size={14} /> Edit</button>
          </div>
          <button
            className="commons-share-btn"
            title="Share this campaign and its posts to a Commons board"
            onClick={() => { documentEditor.current?.commit(); setShareOpen(true) }}
          >
            <UsersRound size={14} /> <span>Share</span>
          </button>
          <button
            className={`rail-toggle${railOpen ? ' on' : ''}`}
            title={railOpen ? 'Hide files & posts' : 'Show files & posts'}
            aria-expanded={railOpen}
            onClick={() => setRailOpen((open) => {
              const next = !open
              localStorage.setItem('ocd:campaign-rail', String(next))
              return next
            })}
          >
            {railOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
            {!railOpen && (docs.length + mine.length) ? <span className="rail-toggle-count">{docs.length + mine.length}</span> : null}
          </button>
          <button className="icon-danger" title="Delete campaign" onClick={handleDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="editor-body">
        <div
          className={`editor-main${editorDragOver ? ' editor-drop-active' : ''}`}
          onDragEnter={handleEditorDragEnter}
          onDragLeave={handleEditorDragLeave}
          onDragOver={handleEditorDragOver}
          onDrop={handleEditorDrop}
        >
          <div className="editor-doc">
            {readOnly ? (
              <article className="reader-article">
                <header className="reader-header">
                  <h1 className="read-title">{name || 'Untitled campaign'}</h1>
                  <CampaignMetaChips stage={stage} type={type} formats={formats} />
                </header>
                <ReadView blocks={blocks} />
              </article>
            ) : (
              <>
                <TitleArea className="title-input" value={name} placeholder="Untitled campaign"
                  onChange={setName} onCommit={commitTitle} />
                <DocumentEditor
                  ref={documentEditor}
                  blocks={blocks}
                  onCommit={persistBlocks}
                  importing={importing}
                  onPickMedia={() => mediaRef.current?.click()}
                  onPickFile={() => fileRef.current?.click()}
                />
              </>
            )}
          </div>
        </div>

        {railOpen ? (
          <aside className="campaign-rail" aria-label="Campaign files and posts">
            <div className="campaign-rail-scroll">
              <CampaignRailSection
                title="Files"
                count={docs.length}
                empty="Briefs, decks, references. Add them here or drop them onto the document."
                headerAction={
                  <button className="rail-sec-btn" onClick={() => fileRef.current?.click()} disabled={uploading} title="Add files">
                    {uploading ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                  </button>
                }
              >
                {docs.map((d) => (
                  <li className="rail-item rail-file" key={d.path}>
                    <FileText size={14} className="rail-item-icon" />
                    <span className="rail-item-name" title={d.name}>{d.name}</span>
                    <span className="rail-item-actions">
                      <button onClick={() => viewDoc(d.path)} title="Open file"><ExternalLink size={13} /></button>
                      <button className="danger" onClick={() => removeDoc(d.path)} title="Remove file"><X size={13} /></button>
                    </span>
                  </li>
                ))}
              </CampaignRailSection>

              <CampaignRailSection
                title="Posts"
                count={mine.length}
                empty="Nothing linked yet. Start a post here, or pull in one you've already written."
                headerAction={
                  <div className="rail-sec-actions">
                    <div className="camp-picker-wrap">
                      <button className="rail-sec-btn" onClick={() => setPickerOpen((o) => !o)} title="Link an existing post">
                        <Link2 size={14} />
                      </button>
                      {pickerOpen ? (
                        <>
                          <div className="camp-picker-scrim" onClick={() => setPickerOpen(false)} />
                          <div className="camp-picker" role="dialog" aria-label="Link an existing post">
                            {unassigned.length ? unassigned.map((p) => (
                              <button key={str(p, 'id')} onClick={() => void attachPost(str(p, 'id'))}>
                                <span className="camp-picker-name">{str(p, 'title') || 'Untitled'}</span>
                                <StagePill stage={str(p, 'stage')} />
                              </button>
                            )) : (
                              <div className="camp-picker-empty">Every post already belongs to a campaign.</div>
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                    <button className="rail-sec-btn" onClick={handleNewPost} disabled={creatingPost} title="New post in this campaign">
                      {creatingPost ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                    </button>
                  </div>
                }
              >
                {mine.map((p) => (
                  <CampaignPostRow
                    key={str(p, 'id')}
                    id={str(p, 'id')}
                    title={str(p, 'title') || 'Untitled'}
                    rowClassName={`stage-${str(p, 'stage')}`}
                    meta={<>
                      <StagePill stage={str(p, 'stage')} />
                      <FormatChips formats={parseContentFormats(p['content_formats'], p['tags'])} />
                      <SubstageChip value={str(p, 'substage')} options={substageOptions(parseContentFormats(p['content_formats'], p['tags']))} />
                    </>}
                    onOpen={() => onOpenPost(str(p, 'id'))}
                    onRemove={() => void detachPost(str(p, 'id'))}
                  />
                ))}
              </CampaignRailSection>
            </div>
          </aside>
        ) : null}
      </div>

      {/* Kept outside the rail: the document's own "Import file" control targets fileRef,
          so both inputs must exist even when the rail is collapsed. */}
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={onPickDocs} />
      <input ref={mediaRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={onPickMedia} />

      {shareOpen ? (
        <ShareCampaignDialog campaign={campaign} posts={posts} onClose={() => setShareOpen(false)} />
      ) : null}

      <CampaignProps
        campaign={campaign} type={type} formats={formats}
        onPatch={patch}
      />
    </div>
  )
}

/** Type / icon / formats as a floating bottom-left control, mirroring the post editor's NoteProps. */
function CampaignProps({
  campaign, type, formats, onPatch,
}: {
  campaign: Rec
  type: string
  formats: ReturnType<typeof campaignFormats>
  onPatch: (data: Rec) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [emoji, setEmoji] = useState(str(campaign, 'emoji'))
  const count = formats.length + (emoji ? 1 : 0)
  return (
    <div className="note-props">
      {open ? <div className="note-props-scrim" onClick={() => setOpen(false)} /> : null}
      {open ? (
        <div className="note-props-pop" role="dialog" aria-label="Campaign details">
          <div className="note-props-head"><span className="format-chip idea"><Target size={13} /> Campaign</span></div>
          <div className="note-props-ctl col"><span>Type</span>
            <div className="pills" style={{ gap: 4 }}>
              {CAMPAIGN_TYPES.map((t) => (
                <button
                  key={t}
                  className={`pick ${type === t ? 'on' : ''}`}
                  style={{ fontSize: 11, padding: '3px 9px' }}
                  onClick={() => onPatch({ campaign_type: t })}
                >
                  {CAMPAIGN_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="note-props-ctl col"><span>Includes</span>
            <FormatPicker selected={formats} onChange={(next) => onPatch({ content_formats: next })} />
          </div>
          <div className="note-props-ctl col"><span>Icon</span>
            <div className="camp-icon-grid">
              <button
                className={`camp-icon-pick auto${emoji ? '' : ' on'}`}
                onClick={() => { setEmoji(''); onPatch({ emoji: '' }) }}
                title="Auto — the campaign's initials over its own colour"
              >
                {campaignInitials(str(campaign, 'name'))}
              </button>
              {CAMPAIGN_ICONS.map((icon) => (
                <button
                  key={icon}
                  className={`camp-icon-pick${emoji === icon ? ' on' : ''}`}
                  onClick={() => { setEmoji(icon); onPatch({ emoji: icon }) }}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <button
        className={`note-props-fab ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Campaign details — type, formats, icon"
        aria-expanded={open}
      >
        <span className="note-props-emoji" aria-hidden="true">{emoji || '🎯'}</span>
        {count ? <span className="note-props-badge">{count}</span> : null}
      </button>
    </div>
  )
}
