import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useCurrentUser, useCreateRecord, useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str, newId } from './lib'
import { Avatar, AvatarPicker, useAvatars, type AvatarStyle } from './avatars'

export function Profile() {
  const { user } = useCurrentUser({ client: lemmaClient })
  const [profile, setProfile] = useState<Rec | null>(null)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [mobile, setMobile] = useState('')
  const [tg, setTg] = useState('')
  const [country, setCountry] = useState('')
  const [tz, setTz] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void (async () => {
      try { setProfile((await lemmaClient.users.getProfile()) as Rec) } catch { /* fall back to useCurrentUser */ }
    })()
  }, [])
  useEffect(() => {
    const p = profile || (user as Rec | undefined)
    if (loaded || !p) return
    setFirst(str(p, 'first_name')); setLast(str(p, 'last_name')); setMobile(str(p, 'mobile_number'))
    setTg(str(p, 'telegram_username')); setCountry(str(p, 'country')); setTz(str(p, 'timezone'))
    setLoaded(true)
  }, [profile, user, loaded])

  const base = profile || (user as Rec | undefined) || {}
  const email = str(base, 'email')
  const userId = str(base, 'id')

  // Avatar: no stored row means the deterministic default, so this works before
  // anyone has ever saved a choice.
  const avatars = useAvatars()
  const { create: createAvatarRow } = useCreateRecord({ client: lemmaClient, tableName: 'member_profiles' })
  const { update: updateAvatarRow } = useUpdateRecord({ client: lemmaClient, tableName: 'member_profiles' })
  const myRow = avatars.rows.find((row) => str(row, 'member_user_id') === userId
    || str(row, 'email').toLowerCase() === email.toLowerCase())
  const resolved = avatars.resolve(userId, email)

  async function saveAvatar(next: { style?: AvatarStyle; seed?: string }) {
    if (!userId) return
    const data = {
      member_user_id: userId,
      email: email.toLowerCase(),
      avatar_style: next.style ?? resolved.style,
      avatar_seed: next.seed ?? (resolved.seed === userId ? '' : resolved.seed),
    }
    if (myRow) await updateAvatarRow(data, { recordId: str(myRow, 'id') })
    else await createAvatarRow(data)
    await avatars.refresh()
  }

  async function save() {
    setSaving(true)
    try {
      await lemmaClient.users.upsertProfile({
        first_name: first, last_name: last, mobile_number: mobile,
        telegram_username: tg || null, country: country || null, timezone: tz || null,
      } as Rec)
      setSaved(true); setTimeout(() => setSaved(false), 1600)
    } finally { setSaving(false) }
  }

  return (
    <div className="main">
      <div className="topbar">
        <div className="tabs"><span className="tab active">Profile</span></div>
        <div className="tools">
          <button className={`cta prod-save${saved ? ' saved' : ''}`} onClick={save} disabled={saving}>
            {saved ? 'Saved' : saving ? <><Loader2 size={14} className="spin" /> Saving…</> : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>
      <div className="scroll">
        <div className="profile-doc">
          <div className="profile-avatar">
            <Avatar seed={resolved.seed} style={resolved.style} size={92} />
          </div>
          <div className="profile-name">{[first, last].filter(Boolean).join(' ') || 'Your name'}</div>
          <div className="profile-email">{email}</div>
          <div className="profile-avatar-edit">
            <div className="rlabel">Your avatar</div>
            <AvatarPicker
              seed={resolved.seed}
              style={resolved.style}
              onPickStyle={(style) => void saveAvatar({ style })}
              onReroll={() => void saveAvatar({ seed: newId() })}
            />
          </div>
          <div className="profile-grid">
            <PField label="First name"><input className="settings-in" value={first} onChange={(e) => setFirst(e.target.value)} /></PField>
            <PField label="Last name"><input className="settings-in" value={last} onChange={(e) => setLast(e.target.value)} /></PField>
            <PField label="Mobile"><input className="settings-in" value={mobile} onChange={(e) => setMobile(e.target.value)} /></PField>
            <PField label="Telegram username"><input className="settings-in" value={tg} placeholder="@handle" onChange={(e) => setTg(e.target.value)} /></PField>
            <PField label="Country"><input className="settings-in" value={country} onChange={(e) => setCountry(e.target.value)} /></PField>
            <PField label="Timezone"><input className="settings-in" value={tz} placeholder="e.g. Asia/Kolkata" onChange={(e) => setTz(e.target.value)} /></PField>
          </div>
        </div>
      </div>
    </div>
  )
}

function PField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="pfield"><div className="rlabel">{label}</div>{children}</div>
}
