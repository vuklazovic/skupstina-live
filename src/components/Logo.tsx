/** Znak: mala sala od tačkica (jedna crvena: onaj koji sada govori) + „skupština”. */
const ROWS = [
  { r: 5, n: 4 },
  { r: 9, n: 6 },
  { r: 13, n: 8 },
]

const DOTS = ROWS.flatMap(({ r, n }, ri) =>
  Array.from({ length: n }, (_, k) => {
    const a = Math.PI - (Math.PI * k) / (n - 1)
    return { x: 16 + r * Math.cos(a), y: 16 - r * Math.sin(a), ri, k }
  }),
)

/** text: false = samo znak */
export function Logo({ text = true }: { text?: boolean } = {}) {
  return (
    <span className="logo2">
      <svg viewBox="0 0 32 18" width="38" height="21" aria-hidden>
        {DOTS.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={1.55}
            fill={d.ri === 1 && d.k === 3 ? '#ff4d6d' : '#e9edf4'}
            opacity={d.ri === 1 && d.k === 3 ? 1 : 0.6 + d.ri * 0.17}
          />
        ))}
      </svg>
      {text && <span className="logo2-t">skupština</span>}
    </span>
  )
}
