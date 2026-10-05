import { useMemo, useState } from 'react'
import { Check, Clock3, X } from 'lucide-react'
import { useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str } from './lib'
import { formatSpec } from './formats'
import {
  PLATFORMS, PLATFORM_LABEL, PlatformIcon, platformsFor, type Platform,
} from './platforms'
import { ORIGINAL_VERSION_ID, versionOptions } from './versions'

function dateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function timeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function nextHalfHour(date: Date): Date {
  const rounded = new Date(date)
  rounded.setSeconds(0, 0)
  const minutes = rounded.getMinutes()
  if (minutes !== 0 && minutes !== 30) rounded.setMinutes(minutes < 30 ? 30 : 60)
  return rounded
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 ? 30 : 0
  const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const label = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
  return { value, label }
})

export function ScheduleDialog({
  posts,
  fixedPostId,
  initialDate = new Date(),
  onClose,
  reload,
}: {
  posts: Rec[]
  fixedPostId?: string
  initialDate?: Date
  onClose: () => void
  reload: () => void
}) {
  const { update } = useUpdateRecord({ client: lemmaClient, tableName: 'posts' })
  const candidates = useMemo(
    () => posts.filter((post) => str(post, 'title') && (!str(post, 'scheduled_at') || str(post, 'id') === fixedPostId)),
    [fixedPostId, posts],
  )
  const initialPostId = fixedPostId || str(candidates[0], 'id')
  const initialPost = posts.find((post) => str(post, 'id') === initialPostId)
  const existingDate = initialPost && str(initialPost, 'scheduled_at')
    ? new Date(str(initialPost, 'scheduled_at'))
    : initialDate
  const normalizedDate = nextHalfHour(existingDate)

  const [selectedPostId, setSelectedPostId] = useState(initialPostId)
  const [selectedVersionId, setSelectedVersionId] = useState(
    initialPost ? (str(initialPost, 'scheduled_version_id') || ORIGINAL_VERSION_ID) : ORIGINAL_VERSION_ID,
  )
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(
    initialPost && str(initialPost, 'scheduled_at') ? platformsFor(initialPost) : [],
  )
  const [date, setDate] = useState(dateInputValue(normalizedDate))
  const [time, setTime] = useState(timeInputValue(normalizedDate))
  const [saving, setSaving] = useState(false)
  const selectedPost = posts.find((post) => str(post, 'id') === selectedPostId)
  const selectedVersionOptions = selectedPost ? versionOptions(selectedPost) : []

  function togglePlatform(platform: Platform) {
    setSelectedPlatforms((current) => (
      current.includes(platform)
        ? current.filter((item) => item !== platform)
        : [...current, platform]
    ))
  }

  function chooseVersion(id: string) {
    setSelectedVersionId(id)
    const platform = selectedVersionOptions.find((version) => version.id === id)?.platform
    if (platform && platform !== 'custom') setSelectedPlatforms([platform])
  }

  async function schedule() {
    if (!selectedPostId || !date || !time || !selectedPlatforms.length) return
    const [year, month, day] = date.split('-').map(Number)
    const [hour, minute] = time.split(':').map(Number)
    const scheduledAt = new Date(year, month - 1, day, hour, minute, 0)

    setSaving(true)
    try {
      await update(
        {
          scheduled_at: scheduledAt.toISOString(),
          platforms: selectedPlatforms,
          platform: selectedPlatforms[0],
          scheduled_version_id: selectedVersionId || ORIGINAL_VERSION_ID,
        },
        { recordId: selectedPostId },
      )
      reload()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="schedule-scrim" onClick={onClose}>
      <section
        className="schedule-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="calendar-kicker">Content calendar</span>
            <h2 id="schedule-title">{initialPost && str(initialPost, 'scheduled_at') ? 'Update schedule' : 'Add to calendar'}</h2>
          </div>
          <button className="x-btn" onClick={onClose} title="Close"><X size={18} /></button>
        </header>

        {fixedPostId ? (
          <div className="schedule-selected-post">
            <span>Content</span>
            <strong>{str(initialPost, 'title') || 'Untitled'}</strong>
          </div>
        ) : (
          <label className="schedule-field">
            <span>Content</span>
            <select value={selectedPostId} onChange={(event) => {
              setSelectedPostId(event.target.value)
              setSelectedPlatforms([])
              setSelectedVersionId(ORIGINAL_VERSION_ID)
            }}>
              {!candidates.length ? <option value="">No unscheduled content</option> : null}
              {candidates.map((post) => {
                const format = formatSpec(str(post, 'format_type'))
                return (
                  <option value={str(post, 'id')} key={str(post, 'id')}>
                    {str(post, 'title') || 'Untitled'}{format ? ` · ${format.label}` : ''}
                  </option>
                )
              })}
            </select>
          </label>
        )}

        <label className="schedule-field">
          <span>Version</span>
          <select value={selectedVersionId} onChange={(event) => chooseVersion(event.target.value)}>
            {selectedVersionOptions.map((version) => (
              <option value={version.id} key={version.id}>{version.name}</option>
            ))}
          </select>
          <small className="schedule-field-hint">This is the copy that will be used for the calendar entry.</small>
        </label>

        <fieldset className="schedule-platforms">
          <legend>Publish to <span>Select one or more</span></legend>
          <div>
            {PLATFORMS.map((platform) => {
              const selected = selectedPlatforms.includes(platform)
              return (
                <button
                  type="button"
                  className={selected ? 'on' : ''}
                  aria-pressed={selected}
                  key={platform}
                  onClick={() => togglePlatform(platform)}
                >
                  <PlatformIcon platform={platform} size={22} label={false} />
                  <span>{PLATFORM_LABEL[platform]}</span>
                  {selected ? <Check className="schedule-platform-check" size={14} /> : null}
                </button>
              )
            })}
          </div>
          {!selectedPlatforms.length ? <p>Choose at least one platform to continue.</p> : null}
        </fieldset>

        <div className="schedule-date-row">
          <label className="schedule-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="schedule-field">
            <span>Time</span>
            <span className="schedule-time-input">
              <Clock3 size={15} />
              <select value={time} onChange={(event) => setTime(event.target.value)}>
                {TIME_OPTIONS.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </span>
          </label>
        </div>

        <footer>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button
            className="cta"
            onClick={() => void schedule()}
            disabled={!selectedPostId || !date || !time || !selectedPlatforms.length || saving}
          >
            {saving ? 'Saving…' : initialPost && str(initialPost, 'scheduled_at') ? 'Update schedule' : 'Add to calendar'}
          </button>
        </footer>
      </section>
    </div>
  )
}
