// One markdown file per post at /notes/<id>.md: frontmatter, the original
// document, then one `## …` section per platform version. This is the pod's
// human-readable + RAG-searchable mirror of a post.
//
// `functions/save_post/code.py` writes the SAME shape server-side when an agent
// saves. Change one, change the other.

import { lemmaClient } from './lemma-client'
import { Rec, str, flattenBlocks } from './lib'
import { parsePostVersions, versionPlatforms, isTargetPlatform, type PostVersion } from './versions'
import { parseContentFormats } from './contentFormats'

const NOTES_DIR = '/notes'

type NoteContext = { product?: string; campaign?: string }

const quote = (value: string) => JSON.stringify(value || '')

function versionBody(version: PostVersion): string {
  return (version.body_md || flattenBlocks(version.blocks) || '').trim()
}

/** Sectioned markdown for one post, versions included. */
export function buildPostNote(post: Rec, context: NoteContext = {}): string {
  const versions = parsePostVersions(post['versions'])
  const title = str(post, 'title') || 'Untitled'

  const frontmatter = [
    '---',
    `title: ${quote(title)}`,
    `stage: ${str(post, 'stage') || 'spark'}`,
    `product: ${quote(context.product || '')}`,
    `campaign: ${quote(context.campaign || '')}`,
    `source: ${str(post, 'channel') || 'desk'}`,
    `format: ${str(post, 'format_type')}`,
    `content_formats: [${parseContentFormats(post['content_formats'], post['tags']).join(', ')}]`,
    // Flat list so a grep/RAG hit on "platforms: [... reddit ...]" is enough to
    // tell which platform versions exist without parsing the whole note.
    `platforms: [${versionPlatforms(post).join(', ')}]`,
    `version_count: ${versions.length}`,
    `updated: ${str(post, 'updated_at')}`,
    '---',
  ].join('\n')

  const chunks: string[] = [`# ${title}`]
  const body = (str(post, 'body_md') || '').trim()
  if (body) chunks.push(body)

  for (const version of versions) {
    const platform = isTargetPlatform(version.platform) ? version.platform : ''
    const meta = [platform, version.format_type].filter(Boolean).join(' · ')
    // Post bodies contain their own `#`/`##` headings, so a heading alone can't
    // mark a boundary. The rule is the visual break; the HTML comment is the
    // unambiguous machine-readable one (invisible when rendered).
    chunks.push('---')
    chunks.push(`<!-- ocd:version platform="${platform}" name="${(version.name || '').replace(/"/g, "'")}" -->`)
    chunks.push(`## ${version.name || 'Untitled version'}${meta ? ` (${meta})` : ''}`)
    if (version.title && version.title !== title) chunks.push(`**${version.title}**`)
    chunks.push(versionBody(version) || '_Empty version._')
  }

  return `${frontmatter}\n\n${chunks.join('\n\n')}\n`
}

/**
 * Mirror a post to /notes/<id>.md. Overwrites in place via files.update, falling
 * back to upload the first time the note doesn't exist yet.
 *
 * Best-effort by contract: the caller has already persisted the record, so a
 * failure here must never surface as a failed save.
 */
export async function writePostNote(post: Rec, context: NoteContext = {}): Promise<void> {
  const id = str(post, 'id')
  if (!id) return
  const name = `${id}.md`
  const file = new File([buildPostNote(post, context)], name, { type: 'text/markdown' })
  try {
    await lemmaClient.files.update(`${NOTES_DIR}/${name}`, { file, searchEnabled: true })
  } catch {
    await lemmaClient.files.upload(file, { directoryPath: NOTES_DIR, name, searchEnabled: true })
  }
}
