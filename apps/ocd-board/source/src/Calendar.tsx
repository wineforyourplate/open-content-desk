import { useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useUpdateRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str } from './lib'
import {
  PLATFORMS, PLATFORM_LABEL, PlatformIcon, platformsFor, type Platform,
} from './platforms'
import { ScheduleDialog } from './ScheduleDialog'
import { scheduledVersionName } from './versions'

const HOURS = Array.from({ length: 13 }, (_, index) => index + 8)
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function startOfWeek(date: Date): Date {
  const copy = new Date(date)
  const day = copy.getDay()
  copy.setHours(0, 0, 0, 0)
  copy.setDate(copy.getDate() - (day === 0 ? 6 : day - 1))
  return copy
}

function addDays(date: Date, amount: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + amount)
  return copy
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function dateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function hourLabel(hour: number): string {
  if (hour === 12) return '12 PM'
  if (hour > 12) return `${hour - 12} PM`
  return `${hour} AM`
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function Calendar({
  posts, onOpenPost, reload,
}: {
  posts: Rec[]
  onOpenPost: (id: string) => void
  reload: () => void
}) {
  const { update } = useUpdateRecord({ client: lemmaClient, tableName: 'posts' })
  const [today] = useState(() => new Date())
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))
  const [filter, setFilter] = useState<'all' | Platform>('all')
  const [composer, setComposer] = useState<Date | null>(null)

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const scheduled = posts.filter((post) => {
    if (!str(post, 'scheduled_at')) return false
    return filter === 'all' || platformsFor(post).includes(filter)
  })

  const weekEnd = days[6]
  const showingToday = days.some((day) => sameDay(day, today))
  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? `${weekStart.toLocaleDateString([], { month: 'long' })} ${weekStart.getDate()}–${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
    : `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
  const periodTitle = showingToday
    ? today.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : weekLabel

  function eventsAt(day: Date, hour: number): Rec[] {
    return scheduled.filter((post) => {
      const date = new Date(str(post, 'scheduled_at'))
      return sameDay(date, day) && date.getHours() === hour
    })
  }

  function openComposer(day = today, hour = 10) {
    const date = new Date(day)
    date.setHours(hour, 0, 0, 0)
    setComposer(date)
  }

  async function unschedule(id: string) {
    await update({ scheduled_at: null, platforms: null, platform: null, scheduled_version_id: null }, { recordId: id })
    reload()
  }

  return (
    <div className="main calendar-page">
      <div className="topbar">
        <div className="tabs">
          <span className="tab active"><CalendarDays size={14} /> Content calendar</span>
        </div>
        <button className="cta" onClick={() => openComposer()}>
          <Plus size={15} /> Schedule content
        </button>
      </div>

      <div className="calendar-toolbar">
        <div className="calendar-period">
          <span className="calendar-kicker">{showingToday ? 'Today' : 'Content plan'}</span>
          <h1>{periodTitle}</h1>
          {showingToday ? <p>{weekLabel}</p> : null}
        </div>
        <div className="calendar-toolbar-actions">
          <div className="calendar-nav">
            <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))} title="Previous week"><ChevronLeft size={16} /></button>
            <button className="ghost" onClick={() => setWeekStart(startOfWeek(today))}>Today</button>
            <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))} title="Next week"><ChevronRight size={16} /></button>
          </div>
          <div className="calendar-platform-filters" aria-label="Filter by platform">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
            {PLATFORMS.map((platform) => (
              <button
                className={filter === platform ? 'on' : ''}
                key={platform}
                onClick={() => setFilter(platform)}
                title={PLATFORM_LABEL[platform]}
              >
                <PlatformIcon platform={platform} size={16} label={false} />
                <span>{PLATFORM_LABEL[platform]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="calendar-scroll">
        <div className="calendar-week">
          <div className="calendar-week-head">
            <div className="calendar-time-head">Local time</div>
            {days.map((day, index) => (
              <div className={`calendar-day-head ${sameDay(day, today) ? 'today' : ''}`} key={dateInputValue(day)}>
                <span>{WEEKDAYS[index]}</span>
                <strong>{day.getDate()}</strong>
              </div>
            ))}
          </div>

          <div className="calendar-time-grid">
            {HOURS.map((hour) => (
              <div className="calendar-hour-row" key={hour}>
                <div className="calendar-time-label">{hourLabel(hour)}</div>
                {days.map((day) => {
                  const events = eventsAt(day, hour)
                  return (
                    <div
                      className={`calendar-slot ${sameDay(day, today) ? 'today' : ''}`}
                      key={`${dateInputValue(day)}-${hour}`}
                      onClick={() => openComposer(day, hour)}
                    >
                      {events.map((post) => {
                        const platforms = platformsFor(post)
                        const platform = platforms[0]
                        const scheduledAt = new Date(str(post, 'scheduled_at'))
                        return (
                          <button
                            className={`calendar-event calendar-event-${platform}`}
                            key={str(post, 'id')}
                            onClick={(event) => {
                              event.stopPropagation()
                              onOpenPost(str(post, 'id'))
                            }}
                          >
                            <span className="calendar-event-top">
                              <span className="calendar-event-platforms">
                                {platforms.map((item) => (
                                  <PlatformIcon platform={item} size={20} label={false} key={item} />
                                ))}
                              </span>
                              <span>{platforms.map((item) => PLATFORM_LABEL[item]).join(' · ')}</span>
                              <span className="calendar-event-time">{timeLabel(scheduledAt)}</span>
                            </span>
                            <strong>{str(post, 'title') || 'Untitled'}</strong>
                            <span className="calendar-event-stage">{scheduledVersionName(post)} · {str(post, 'stage')}</span>
                            <span
                              className="calendar-event-remove"
                              role="button"
                              title="Remove from calendar"
                              onClick={(event) => {
                                event.stopPropagation()
                                void unschedule(str(post, 'id'))
                              }}
                            >
                              <X size={11} />
                            </span>
                          </button>
                        )
                      })}
                      {!events.length ? <span className="calendar-slot-add"><Plus size={12} /></span> : null}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {composer ? (
        <ScheduleDialog
          posts={posts}
          initialDate={composer}
          onClose={() => setComposer(null)}
          reload={reload}
        />
      ) : null}
    </div>
  )
}
