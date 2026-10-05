// Keeping a shared Commons note in step with its private original — sharing to
// Commons is meant to feel like sharing a Google Doc link, not handing over a
// one-time copy. Whenever a post that's already shared is saved, this pushes the
// fresh content into every commons_notes row that points at it, so viewers
// always see the current version instead of whatever it looked like when it was
// first shared.

import { lemmaClient } from './lemma-client'
import { Rec, str, flattenBlocks, parseBlocks } from './lib'
import { ORIGINAL_VERSION_ID, parsePostVersions } from './versions'
import { postPayload, campaignSnapshot } from './shareCampaign'
import { parseContentFormats, type ContentFormat } from './contentFormats'

/**
 * One sync at a time per post (or campaign).
 *
 * Every sync here is read-then-write — "is there a row for this post yet? no,
 * create one" — so two saves close together both read "no" and both create,
 * leaving the same post on the board twice. That is not hypothetical: two
 * duplicate rows 0.4s apart came out of a single edit while testing, because a
 * title commit and a document commit each kick off their own sync.
 *
 * Chaining per key means the second sync reads the row the first one wrote. A
 * failed run must not wedge the queue, so the stored tail always swallows.
 */
const syncQueues = new Map<string, Promise<unknown>>()
function queued<T>(key: string, run: () => Promise<T>): Promise<T> {
  const next = (syncQueues.get(key) ?? Promise.resolve()).then(run, run)
  syncQueues.set(key, next.then(() => {}, () => {}))
  return next
}

/**
 * The content one Commons share needs, given which version it targets —
 * `ORIGINAL_VERSION_ID` means "all versions" (the switcher), a specific id means
 * just that platform variant. Shared by the manual share flow (Commons.tsx
 * `sharePersonalNote`) and the auto-sync below, so there's one definition of
 * what a "snapshot" contains.
 */
export function buildNoteSnapshot(post: Rec, versionId: string): {
  title: string; body_md: string; blocks: Rec[]; versions: Rec[]; content_formats: ContentFormat[]
  substage: string
} {
  const allVersions = parsePostVersions(post['versions'])
  const shareAll = versionId === ORIGINAL_VERSION_ID
  const version = shareAll ? null : allVersions.find((item) => item.id === versionId)
  const blocks = version ? version.blocks : parseBlocks(post['blocks'])
  return {
    title: version?.title || str(post, 'title') || 'Untitled',
    body_md: version?.body_md || flattenBlocks(blocks) || str(post, 'body_md'),
    blocks,
    versions: shareAll ? allVersions : [],
    content_formats: parseContentFormats(post['content_formats'], post['tags']),
    // The refining step travels with the share, like content_formats does.
    substage: str(post, 'substage'),
  }
}

/**
 * Push `post`'s current content into every active commons_notes row that
 * shares it, on whatever board(s) it lives on. `commons_notes` is RLS-off, so
 * the author's own client can update rows on boards they don't own.
 * Best-effort: a sync failure must never surface as a failed post save — same
 * contract as `writePostNote` in notes.ts, which this runs alongside.
 */
export async function syncSharedCopies(post: Rec): Promise<void> {
  const postId = str(post, 'id')
  if (!postId) return
  return queued(`post:${postId}`, () => runSharedCopies(post, postId))
}

async function runSharedCopies(post: Rec, postId: string): Promise<void> {
  // Undefined (not []) unless the fetch actually succeeded — an empty array is a
  // meaningful "this post is shared nowhere", and passing a failed fetch as one
  // would let membership sync create duplicate rows.
  let rows: Rec[] | undefined
  try {
    rows = await activeSharesOfPost(postId)
    await Promise.all(rows.map((row) => lemmaClient.records.update(
      'commons_notes',
      str(row, 'id'),
      buildNoteSnapshot(post, str(row, 'source_version_id') || ORIGINAL_VERSION_ID),
    )))
  } catch { /* best-effort — a private edit must never fail because Commons sync failed */ }
  // Hand the rows over so membership doesn't re-run the same query on every save.
  // The INNER runner: we already hold this post's slot in the queue.
  await runCampaignMembership(post, postId, rows)
}

/**
 * The campaign twin of `syncSharedCopies`: push the private campaign's own
 * brief into every board it's shared to. Without this the campaign document
 * itself stayed the copy it was at share time even though its posts had gone
 * live — half a Google Doc, and the half people read first.
 */
export async function syncSharedCampaign(campaign: Rec): Promise<void> {
  const campaignId = str(campaign, 'id')
  if (!campaignId) return
  return queued(`campaign:${campaignId}`, () => runSharedCampaign(campaign, campaignId))
}

async function runSharedCampaign(campaign: Rec, campaignId: string): Promise<void> {
  try {
    const rows = await activeSharesOfCampaign(campaignId)
    await Promise.all(rows.map((row) => lemmaClient.records.update(
      'commons_notes',
      str(row, 'id'),
      campaignSnapshot(campaign),
    )))
  } catch { /* best-effort — a private edit must never fail because Commons sync failed */ }
}

/** Every active `commons_notes` row that mirrors this post, across all boards. */
async function activeSharesOfPost(postId: string): Promise<Rec[]> {
  const { items } = await lemmaClient.records.list('commons_notes', {
    filters: [
      { field: 'source_post_id', op: 'eq', value: postId },
      { field: 'status', op: 'eq', value: 'active' },
    ],
    limit: 200,
  })
  return (items || []) as Rec[]
}

/** Every active `kind:'campaign'` row that mirrors this campaign, across all boards. */
async function activeSharesOfCampaign(campaignId: string): Promise<Rec[]> {
  const { items } = await lemmaClient.records.list('commons_notes', {
    filters: [
      { field: 'source_campaign_id', op: 'eq', value: campaignId },
      { field: 'status', op: 'eq', value: 'active' },
    ],
    limit: 200,
  })
  return (items || []) as Rec[]
}

/**
 * Keep a shared campaign's POST LIST live, not just each post's content.
 *
 * `syncSharedCopies` only refreshes rows that already point at a post, so
 * before this existed, sharing a campaign froze its membership at share time:
 * an article written and linked afterwards never appeared for the team until
 * someone manually re-shared the campaign. That broke the promise the campaign
 * share makes ("this campaign, and the posts in it").
 *
 * So on every post save — and on link/unlink from the campaign editor — this
 * reconciles membership: a post linked to a campaign that's shared somewhere
 * gains a child row on that board; a post that has left the campaign has its
 * child rows archived. Content sync above handles the rest.
 *
 * Standalone shares (no `campaign_group_id`) are never touched — those are
 * independent of any campaign and stay put.
 */
export async function syncCampaignMembership(post: Rec, knownShares?: Rec[]): Promise<void> {
  const postId = str(post, 'id')
  if (!postId) return
  return queued(`post:${postId}`, () => runCampaignMembership(post, postId, knownShares))
}

async function runCampaignMembership(post: Rec, postId: string, knownShares?: Rec[]): Promise<void> {
  try {
    const campaignId = str(post, 'campaign_id')
    const mine = knownShares ?? await activeSharesOfPost(postId)

    // Boards where this post's campaign is itself shared.
    const sharedCampaigns = campaignId ? await activeSharesOfCampaign(campaignId) : []

    for (const campaignRow of sharedCampaigns) {
      const boardId = str(campaignRow, 'board_id')
      const groupId = str(campaignRow, 'id')
      const onBoard = mine.filter((row) => str(row, 'board_id') === boardId)
      const [existing, ...extras] = onBoard
      if (existing) {
        // Already on this board as a standalone share — adopt it into the
        // campaign rather than creating a duplicate, matching the
        // (board, source_post_id) dedupe rule shareCampaignToBoard uses.
        if (str(existing, 'campaign_group_id') !== groupId) {
          await lemmaClient.records.update('commons_notes', str(existing, 'id'), { campaign_group_id: groupId })
        }
        // Heal a board that already has this post twice, from a save that
        // raced before `queued` above existed. One card per post is the rule;
        // archive (never delete) so nothing a member wrote is destroyed.
        for (const extra of extras) {
          await lemmaClient.records.update('commons_notes', str(extra, 'id'), { status: 'archived' })
        }
        continue
      }
      // Attributed to whoever shared the campaign — they're the one who put
      // this board's copy there, and the post rides along with that decision.
      const sharer = str(campaignRow, 'created_by')
      await lemmaClient.records.create('commons_notes', postPayload(post, boardId, sharer, groupId))
    }

    // Left the campaign (relinked or unlinked): retire the child rows it had.
    const liveGroupIds = new Set(sharedCampaigns.map((row) => str(row, 'id')))
    for (const row of mine) {
      const groupId = str(row, 'campaign_group_id')
      if (groupId && !liveGroupIds.has(groupId)) {
        await lemmaClient.records.update('commons_notes', str(row, 'id'), { status: 'archived' })
      }
    }
  } catch { /* best-effort — never fail a save over Commons bookkeeping */ }
}
