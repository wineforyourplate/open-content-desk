import { useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { CalendarPlus, Check, Copy, ExternalLink, MoreHorizontal, Share2, Trash2 } from 'lucide-react'
import { useDeleteRecord } from 'lemma-sdk/react'
import { lemmaClient } from './lemma-client'
import { Rec, str } from './lib'
import { emptyPlace, shareUrlForPlace } from './location'
import { ScheduleDialog } from './ScheduleDialog'

function postShareUrl(postId: string): string {
  return shareUrlForPlace(emptyPlace({ postId }))
}

export function PostActions({
  post,
  posts,
  reload,
  variant = 'footer',
}: {
  post: Rec
  posts: Rec[]
  reload: () => void
  variant?: 'footer' | 'overlay' | 'card'
}) {
  const [shareOpen, setShareOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const postId = str(post, 'id')
  const scheduled = !!str(post, 'scheduled_at')
  const { remove, isSubmitting: deleting } = useDeleteRecord({
    client: lemmaClient,
    tableName: 'posts',
    recordId: postId,
  })

  function contain(event: MouseEvent) {
    event.stopPropagation()
  }

  async function copyLink(event: MouseEvent<HTMLButtonElement>) {
    contain(event)
    await navigator.clipboard.writeText(postShareUrl(postId))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function shareToWhatsApp(event: MouseEvent<HTMLButtonElement>) {
    contain(event)
    const message = `${str(post, 'title') || 'Content idea'}\n${postShareUrl(postId)}`
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
  }

  async function deletePost(event: MouseEvent<HTMLButtonElement>) {
    contain(event)
    const title = str(post, 'title') || 'Untitled'
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return
    const removed = await remove()
    if (removed) {
      setMoreOpen(false)
      reload()
    }
  }

  return (
    <>
      <span className={`post-actions post-actions-${variant}`} onClick={contain}>
        <span className="share-control">
          <button
            type="button"
            className={`card-action ${shareOpen ? 'on' : ''}`}
            title="Share"
            aria-expanded={shareOpen}
            onClick={(event) => {
              contain(event)
              setMoreOpen(false)
              setShareOpen((open) => !open)
            }}
          >
            <Share2 size={13} />
            <span>Share</span>
          </button>
          {shareOpen ? (
            <span className="share-menu">
              <button type="button" onClick={(event) => void copyLink(event)}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied link' : 'Copy link'}
              </button>
              <button type="button" onClick={shareToWhatsApp}>
                <ExternalLink size={14} />
                Share on WhatsApp
              </button>
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className={`card-action primary ${scheduled ? 'scheduled' : ''}`}
          title={scheduled ? 'Update calendar schedule' : 'Add to calendar'}
          onClick={(event) => {
            contain(event)
            setShareOpen(false)
            setMoreOpen(false)
            setScheduleOpen(true)
          }}
        >
          <CalendarPlus size={13} />
          <span>{scheduled ? 'Scheduled' : 'Calendar'}</span>
        </button>
        <span className="more-control">
          <button
            type="button"
            className={`card-action icon-only ${moreOpen ? 'on' : ''}`}
            title="More options"
            aria-label="More options"
            aria-expanded={moreOpen}
            onClick={(event) => {
              contain(event)
              setShareOpen(false)
              setMoreOpen((open) => !open)
            }}
          >
            <MoreHorizontal size={15} />
          </button>
          {moreOpen ? (
            <span className="more-menu">
              <button type="button" className="danger" disabled={deleting} onClick={(event) => void deletePost(event)}>
                <Trash2 size={14} />
                {deleting ? 'Deleting…' : 'Delete post'}
              </button>
            </span>
          ) : null}
        </span>
      </span>
      {scheduleOpen ? createPortal(
        <ScheduleDialog
          posts={posts}
          fixedPostId={postId}
          onClose={() => setScheduleOpen(false)}
          reload={reload}
        />,
        document.body,
      ) : null}
    </>
  )
}
