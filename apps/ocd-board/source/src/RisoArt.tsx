// Editorial / risograph card art — a deterministic geometric motif per note.
// Overlapping shapes in a limited two-ink palette with a `multiply` blend for
// the characteristic riso overprint. Pure inline SVG, no external assets.

const RISO_PALETTES: [string, string][] = [
  ['#2f4bff', '#ff5a5f'],
  ['#0e8a76', '#ffb02e'],
  ['#6a3fd0', '#ef4d92'],
  ['#e5533d', '#1f7ae0'],
  ['#3aa14a', '#9b46b8'],
  ['#f0821f', '#2f3aa8'],
  ['#d81b60', '#00897b'],
  ['#1e88e5', '#f4511e'],
]

function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Small deterministic PRNG so the same note always renders the same motif. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function RisoArt({ seed, className }: { seed: string; className?: string }) {
  const h = hashSeed(seed || 'note')
  const rand = mulberry32(h)
  const [inkA, inkB] = RISO_PALETTES[h % RISO_PALETTES.length]
  const r = (min: number, max: number) => min + rand() * (max - min)

  const blobA = { cx: r(24, 120), cy: r(48, 150), rad: r(50, 82) }
  const blobB = { cx: r(190, 300), cy: r(10, 80), rad: r(38, 66) }
  const ring = { cx: r(205, 300), cy: r(112, 176), rad: r(28, 50) }
  const tri = { x: r(96, 210), y: r(86, 156), s: r(38, 66), rot: r(0, 360) }

  return (
    <svg
      className={className}
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-hidden="true"
    >
      <rect width="320" height="180" fill="var(--riso-paper)" />
      <g style={{ mixBlendMode: 'multiply' }}>
        <circle cx={blobA.cx} cy={blobA.cy} r={blobA.rad} fill={inkA} opacity="0.86" />
        <circle cx={blobB.cx} cy={blobB.cy} r={blobB.rad} fill={inkB} opacity="0.82" />
        <circle cx={ring.cx} cy={ring.cy} r={ring.rad} fill="none" stroke={inkA} strokeWidth="7" opacity="0.8" />
        <g transform={`rotate(${tri.rot} ${tri.x} ${tri.y})`}>
          <path
            d={`M ${tri.x} ${tri.y - tri.s} L ${tri.x + tri.s} ${tri.y + tri.s} L ${tri.x - tri.s} ${tri.y + tri.s} Z`}
            fill={inkB}
            opacity="0.68"
          />
        </g>
      </g>
    </svg>
  )
}
