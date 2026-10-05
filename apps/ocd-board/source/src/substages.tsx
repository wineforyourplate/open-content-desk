// Production substages — the step *inside* `refining`, and the step depends on
// the format. A reel is scripted, then recorded, then edited. A written piece
// (blog, post, carousel) is written, then designed. Stored on `posts.substage`
// (TEXT, closed vocabulary picked from chips — never typed), and snapshotted
// onto `commons_notes.substage` on share so a Commons board shows the same step.
import type { ContentFormat } from './contentFormats'

export const SUBSTAGE_ORDER = ['script', 'record', 'edit', 'write', 'design'] as const
export type Substage = (typeof SUBSTAGE_ORDER)[number]

export const SUBSTAGE_LABEL: Record<Substage, string> = {
  script: 'Script', record: 'Record', edit: 'Edit', write: 'Write', design: 'Design',
}

/** One-line gloss for tooltips. */
export const SUBSTAGE_HINT: Record<Substage, string> = {
  script: 'Writing the script',
  record: 'To be recorded',
  edit: 'In edit',
  write: 'Writing the draft',
  design: 'Design and layout',
}

const VIDEO: Substage[] = ['script', 'record', 'edit']
const WRITTEN: Substage[] = ['write', 'design']

export function isSubstage(value: string): value is Substage {
  return (SUBSTAGE_ORDER as readonly string[]).includes(value)
}

export function substageLabel(value: string): string {
  return isSubstage(value) ? SUBSTAGE_LABEL[value] : value
}

/**
 * The substeps a piece actually goes through, given its content format.
 * Reel → script/record/edit. Blog, post, carousel → write/design. A mixed piece
 * gets both sets; with no format picked yet, everything is offered so the step
 * can be set before the format is.
 */
export function substageOptions(formats: ContentFormat[]): Substage[] {
  const video = formats.includes('reel')
  const written = formats.some((f) => f === 'blog' || f === 'post' || f === 'carousel')
  if (video && written) return [...VIDEO, ...WRITTEN]
  if (video) return VIDEO
  if (written) return WRITTEN
  return [...SUBSTAGE_ORDER]
}

/** 1-based position of `value` within its own step list; 0 when unset or foreign. */
export function substagePosition(value: string, options: Substage[]): number {
  const index = options.indexOf(value as Substage)
  return index < 0 ? 0 : index + 1
}

/** Click-to-toggle steps — the same "no spelling" rule as content-format chips. */
export function SubstagePicker({
  value, options, onChange, disabled,
}: {
  value: string
  options: Substage[]
  onChange: (next: string) => void
  disabled?: boolean
}) {
  return (
    <div className="substage-picks" role="group" aria-label="Production substage">
      {options.map((key, index) => {
        const on = value === key
        return (
          <button
            key={key}
            type="button"
            className={`substage-pick${on ? ' on' : ''}`}
            aria-pressed={on}
            disabled={disabled}
            title={SUBSTAGE_HINT[key]}
            onClick={() => onChange(on ? '' : key)}
          >
            <span className="substage-step">{index + 1}</span>
            {SUBSTAGE_LABEL[key]}
          </button>
        )
      })}
      {value ? (
        <button type="button" className="substage-clear" onClick={() => onChange('')} title="Clear substage">
          Clear
        </button>
      ) : null}
    </div>
  )
}

/** Read-only chip for cards, readers, and Commons. */
export function SubstageChip({ value, options }: { value: string; options?: Substage[] }) {
  if (!isSubstage(value)) return null
  const position = options ? substagePosition(value, options) : 0
  return (
    <span className="substage-chip">
      {position ? <span className="substage-chip-step">{position}</span> : null}
      {SUBSTAGE_LABEL[value]}
    </span>
  )
}
