import type { ReactNode } from 'react'
import { FileText, Files } from 'lucide-react'
import { Rec, str } from './lib'
import { plainText } from './markdown'
import {
  CampaignStagePill, CampaignTypeChip, campaignStage, campaignType, campaignFormats,
} from './campaignMeta'
import { FormatChips } from './contentFormats'

/**
 * One campaign card for `/campaigns` and for a Commons board's Campaigns tab.
 * Same chrome in both places: stage strip, title, snippet, format chips.
 */
export function CampaignCard({
  campaign, postCount, docCount, onOpen, who,
}: {
  campaign: Rec
  postCount: number
  docCount?: number
  onOpen: () => void
  /** Commons-only: who shared it, and when. */
  who?: ReactNode
}) {
  const stage = campaignStage(campaign)
  const name = str(campaign, 'name') || 'Untitled campaign'
  const emoji = str(campaign, 'emoji')
  const formats = campaignFormats(campaign)
  return (
    <article className={`camp-card camp-card-${stage}`}>
      <span className="camp-card-strip" aria-hidden="true" />
      <button className="camp-card-hit" onClick={onOpen} aria-label={`Open ${name}`}>
        <span className="camp-card-kicker">
          {emoji ? <span className="camp-card-mark" aria-hidden="true">{emoji}</span> : null}
          <CampaignStagePill stage={stage} />
          {campaignType(campaign) === 'outbound_email' ? <CampaignTypeChip type={campaignType(campaign)} /> : null}
        </span>
        <span className="camp-card-title">{name}</span>
        <span className="camp-card-snippet">{plainText(str(campaign, 'body_md')) || 'No brief yet.'}</span>
        {formats.length ? <FormatChips formats={formats} /> : (
          <span className="camp-card-formats-empty">No formats yet</span>
        )}
        <span className="camp-card-foot">
          {who ? <span className="camp-card-who">{who}</span> : null}
          <span className="camp-card-counts">
            {docCount != null ? (
              <span title={`${docCount} file${docCount === 1 ? '' : 's'}`}><FileText size={12} /> {docCount}</span>
            ) : null}
            <span title={`${postCount} post${postCount === 1 ? '' : 's'}`}><Files size={12} /> {postCount}</span>
          </span>
        </span>
      </button>
    </article>
  )
}
