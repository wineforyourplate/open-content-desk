// Sharing a campaign to a Commons board writes N+1 rows into `commons_notes`:
// one `kind:'campaign'` row holding the brief, plus one ordinary note row per
// linked post carrying `campaign_group_id` back to it. Children are hidden from
// the board grid and surface inside the campaign instead.
//
// The private campaign and its posts never move, but the shared rows are LIVE,
// not frozen: `commonsSync.ts` pushes later edits into them (the brief via
// `syncSharedCampaign`, each post via `syncSharedCopies`, and link/unlink via
// `syncCampaignMembership`), so there is no "re-share to refresh" step.

import { Rec, str, flattenBlocks, parseBlocks, parseTags } from './lib'
import { parsePostVersions, ORIGINAL_VERSION_ID } from './versions'
import { campaignStage, campaignType, campaignFormats } from './campaignMeta'
import { parseContentFormats } from './contentFormats'

export type CommonsWriter = {
  create: (data: Rec) => Promise<unknown>
  update: (data: Rec, options: { recordId: string }) => Promise<unknown>
}

/** Rows already on this board, used for dedupe. Pass the unfiltered live records. */
function activeOn(notes: Rec[], boardId: string): Rec[] {
  return notes.filter((n) => str(n, 'board_id') === boardId && str(n, 'status') !== 'archived')
}

export function postPayload(post: Rec, boardId: string, userId: string, groupId: string): Rec {
  const blocks = parseBlocks(post['blocks'])
  return {
    board_id: boardId,
    kind: 'note',
    title: str(post, 'title') || 'Untitled',
    body_md: flattenBlocks(blocks) || str(post, 'body_md'),
    blocks,
    tags: parseTags(post['tags']),
    content_formats: parseContentFormats(post['content_formats'], post['tags']),
    substage: str(post, 'substage'),
    // Campaign children always carry every version — the point is to hand the
    // team the whole post, not one cut of it.
    versions: parsePostVersions(post['versions']),
    created_by: userId,
    updated_by: userId,
    origin: 'personal_copy',
    source_post_id: str(post, 'id'),
    source_version_id: ORIGINAL_VERSION_ID,
    campaign_group_id: groupId,
    status: 'active',
  }
}

/**
 * The content half of a shared campaign row — everything that follows the
 * private brief as it's edited. Kept apart from the identity half (board,
 * sharer, origin, source id) so the live sync in `commonsSync.ts` can refresh a
 * share without touching who shared it or where. One definition, so the manual
 * share and the auto-sync can never drift apart.
 */
export function campaignSnapshot(campaign: Rec): Rec {
  const blocks = parseBlocks(campaign['blocks'])
  return {
    title: str(campaign, 'name') || 'Untitled campaign',
    body_md: flattenBlocks(blocks) || str(campaign, 'body_md'),
    blocks,
    tags: parseTags(campaign['tags']),
    content_formats: campaignFormats(campaign),
    campaign_stage: campaignStage(campaign),
    campaign_type: campaignType(campaign),
    campaign_emoji: str(campaign, 'emoji'),
  }
}

/** `groupId` is the `commons_notes` row the campaign landed in — the review link's target. */
export type ShareCampaignResult = { wasUpdate: boolean; postCount: number; groupId: string }

/**
 * Create or refresh a campaign share on one board.
 *
 * Re-sharing is a full resync, not an append: posts still linked are refreshed,
 * posts newly linked are added, and children whose post has since been unlinked
 * are archived. Without that, a campaign shared early would drift permanently
 * out of step with the board it lives on.
 *
 * A post already shared standalone on the same board is *adopted* into the
 * campaign rather than duplicated — the board's promise is one card per post,
 * and (board, source_post_id) stays the dedupe key.
 */
export async function shareCampaignToBoard({
  campaign, posts, boardId, userId, notes, writer,
}: {
  campaign: Rec
  posts: Rec[]
  boardId: string
  userId: string
  notes: Rec[]
  writer: CommonsWriter
}): Promise<ShareCampaignResult> {
  const campaignId = str(campaign, 'id')
  const onBoard = activeOn(notes, boardId)

  const campaignPayload: Rec = {
    board_id: boardId,
    kind: 'campaign',
    versions: [],
    created_by: userId,
    updated_by: userId,
    origin: 'personal_copy',
    source_campaign_id: campaignId,
    status: 'active',
    ...campaignSnapshot(campaign),
  }

  // One shared campaign per (board, source campaign) — re-share refreshes it.
  const existingCampaign = onBoard.find((n) => str(n, 'kind') === 'campaign'
    && str(n, 'source_campaign_id') === campaignId)

  let groupId: string
  if (existingCampaign) {
    groupId = str(existingCampaign, 'id')
    await writer.update(campaignPayload, { recordId: groupId })
  } else {
    const created = await writer.create(campaignPayload)
    groupId = str(created as Rec, 'id')
    if (!groupId) throw new Error('Could not create the campaign in this Commons.')
  }

  const linked = posts.filter((p) => str(p, 'campaign_id') === campaignId)
  const linkedIds = new Set(linked.map((p) => str(p, 'id')))

  for (const post of linked) {
    const payload = postPayload(post, boardId, userId, groupId)
    const existing = onBoard.find((n) => str(n, 'source_post_id') === str(post, 'id')
      && str(n, 'kind') !== 'campaign')
    if (existing) await writer.update(payload, { recordId: str(existing, 'id') })
    else await writer.create(payload)
  }

  // Posts unlinked from the campaign since the last share stop being shared with
  // it. Soft-archive, consistent with how a shared note is removed.
  const orphans = onBoard.filter((n) => str(n, 'campaign_group_id') === groupId
    && !linkedIds.has(str(n, 'source_post_id')))
  for (const orphan of orphans) {
    await writer.update({ status: 'archived', updated_by: userId }, { recordId: str(orphan, 'id') })
  }

  return { wasUpdate: !!existingCampaign, postCount: linked.length, groupId }
}
