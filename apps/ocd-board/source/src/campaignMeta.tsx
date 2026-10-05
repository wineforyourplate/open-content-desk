// Shared campaign vocabulary + the shims that let rows written before the
// 2026-08-06 redesign keep working. Read stage/type/docs through the helpers
// here — never `str(campaign, 'stage')` directly, or legacy rows read as blank.
//
// NOTE the filename: this cannot be `campaigns.tsx`, because macOS's default
// filesystem is case-insensitive and that collides with the `Campaigns.tsx`
// screen. Same reason `platforms.tsx` has no `Platforms.tsx` counterpart.

import { Rec, str } from './lib'
import { FormatChips, parseContentFormats, type ContentFormat } from './contentFormats'

export const CAMPAIGN_STAGES = ['ideation', 'production', 'live'] as const
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number]

export const CAMPAIGN_STAGE_LABEL: Record<CampaignStage, string> = {
  ideation: 'Ideation', production: 'Production', live: 'Live',
}

export const CAMPAIGN_TYPES = ['content', 'outbound_email'] as const
export type CampaignType = (typeof CAMPAIGN_TYPES)[number]

export const CAMPAIGN_TYPE_LABEL: Record<CampaignType, string> = {
  content: 'Content', outbound_email: 'Outbound email',
}

/**
 * Legacy `status` values, mapped onto the stages that replaced them.
 * `wrapped -> live` is lossy: the owner's three stages have no "finished"
 * bucket. Don't invent a fourth one without asking.
 */
const LEGACY_STATUS_STAGE: Record<string, CampaignStage> = {
  planning: 'ideation', active: 'production', wrapped: 'live',
}

export function isCampaignStage(value: string): value is CampaignStage {
  return CAMPAIGN_STAGES.includes(value as CampaignStage)
}
export function isCampaignType(value: string): value is CampaignType {
  return CAMPAIGN_TYPES.includes(value as CampaignType)
}

/** Stage of a campaign, tolerating rows written before `stage` existed. */
export function campaignStage(campaign: Rec): CampaignStage {
  const stage = str(campaign, 'stage')
  if (isCampaignStage(stage)) return stage
  return LEGACY_STATUS_STAGE[str(campaign, 'status')] || 'ideation'
}

/**
 * A Commons campaign snapshot lives on `commons_notes` (`title`,
 * `campaign_stage`, `campaign_emoji`). CampaignCard and campaignStage() read
 * the private-campaign field names (`name`, `stage`, `emoji`). Map once here
 * so the shared card never has to know about two schemas.
 *
 * `commons_notes.status` is `active`/`archived` — without this remap,
 * `active` would be read as the legacy campaign stage "production".
 */
export function campaignFromCommonsNote(note: Rec): Rec {
  const stage = str(note, 'campaign_stage')
  return {
    ...note,
    name: str(note, 'title') || 'Untitled campaign',
    emoji: str(note, 'campaign_emoji'),
    stage: isCampaignStage(stage) ? stage : '',
    status: '',
  }
}

export function campaignType(campaign: Rec): CampaignType {
  const type = str(campaign, 'campaign_type')
  return isCampaignType(type) ? type : 'content'
}

export type CampaignDoc = { name: string; path: string }

/**
 * Attached files, with the legacy single `brief_path` folded in at the front so
 * older campaigns don't appear to have lost their brief. Any doc change
 * persists the merged list to `doc_paths` and nulls `brief_path` — see
 * CampaignEditor.persistDocs — so the fold-in happens at most once.
 */
export function campaignDocs(campaign: Rec): CampaignDoc[] {
  let raw = campaign['doc_paths']
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { raw = [] } }
  const docs = Array.isArray(raw) ? (raw as CampaignDoc[]).filter((d) => d && d.path) : []
  const legacy = str(campaign, 'brief_path')
  if (legacy && !docs.some((d) => d.path === legacy)) {
    return [{ name: legacy.split('/').pop() || 'brief', path: legacy }, ...docs]
  }
  return docs
}

/** Stage tag. Borrows the post-stage palette so campaigns read as the same system. */
export function CampaignStagePill({ stage }: { stage: CampaignStage }) {
  return <span className={`camp-stage-pill camp-stage-${stage}`}>{CAMPAIGN_STAGE_LABEL[stage]}</span>
}

export function CampaignTypeChip({ type }: { type: CampaignType }) {
  return <span className={`camp-type-chip camp-type-${type}`}>{CAMPAIGN_TYPE_LABEL[type]}</span>
}

/** Formats stored on a campaign row, with leftover tags folded in. */
export function campaignFormats(campaign: Rec): ContentFormat[] {
  return parseContentFormats(campaign['content_formats'], campaign['tags'])
}

/**
 * Stage + type + formats, in that order — the reader-header metadata row used
 * by BOTH the private CampaignEditor and a shared campaign's Commons reader, so
 * a restyle here lands in both without touching either screen. Stage/type are
 * optional because a Commons snapshot's raw string may predate one of them
 * (see LEGACY_STATUS_STAGE) — callers pass `undefined` for anything unvalidated
 * rather than guessing, and the chip is simply omitted.
 */
export function CampaignMetaChips({
  stage, type, formats,
}: {
  stage?: CampaignStage
  type?: CampaignType
  formats: ContentFormat[]
}) {
  return (
    <div className="camp-meta-row">
      {stage ? <CampaignStagePill stage={stage} /> : null}
      {type ? <CampaignTypeChip type={type} /> : null}
      <FormatChips formats={formats} />
    </div>
  )
}
