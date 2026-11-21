import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmtTc, lastAtOrBefore, zoomOf, type Clock, type TSpeech } from './types'

type Props = {
  sp: TSpeech
  clock: Clock
  /** klik na reč: vreme na traci */
  onSeek: (g: number) => void
  /** redni brojevi reči koje se ističu (reči glasanja) */
  marks?: Set<number>
  /** označen deo teksta → „Podeli citat”: redni brojevi prve i poslednje reči */
  onQuote?: (from: number, to: number) => void
}

/**
 * Govor kao „lyrics”: red po rečenicu, trenutni red je pun, reč koja se upravo izgovara
 * se popunjava sleva nadesno. Klik na reč pušta snimak od tog trenutka.
 */
export const Lyrics = memo(function Lyrics({ sp, clock, onSeek, marks, onQuote }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const wrapEl = useRef<HTMLDivElement>(null)
  // označen tekst: dugme „Podeli citat” iznad oznake
  const [pick, setPick] = useState<{ a: number; b: number; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!onQuote) return
    const read = () => {
      const sel = window.getSelection()
      const b = box.current
      const w = wrapEl.current
      if (!sel || sel.isCollapsed || !sel.rangeCount || !b || !w) return setPick(null)
      const word = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>('.w[data-i]')
      const a = word(sel.anchorNode)
      const f = word(sel.focusNode)
      if (!a || !f || !b.contains(a) || !b.contains(f)) return setPick(null)
      const i = [Number(a.dataset.i), Number(f.dataset.i)].sort((x, y) => x - y)
      const r = sel.getRangeAt(0).getBoundingClientRect()
      const wr = w.getBoundingClientRect()
      const z = zoomOf(w)
      setPick({ a: i[0], b: i[1], x: (r.left + r.width / 2 - wr.left) / z, y: Math.max(40, (r.top - wr.top) / z) })
    }
    let t = 0
    const later = () => {
      clearTimeout(t)
      t = window.setTimeout(read, 120)
    }
    document.addEventListener('selectionchange', later)
    return () => {
      clearTimeout(t)
      document.removeEventListener('selectionchange', later)
    }
  }, [onQuote])
  const lineEls = useRef<(HTMLParagraphElement | null)[]>([])
  const [active, setActive] = useState(-1)
  const activeRef = useRef(-1)
  const [follow, setFollow] = useState(true)
  const followRef = useRef(true)
  followRef.current = follow
  const userScroll = useRef(0)

  // početak svakog reda na traci + kraj svake reči
  const lines = useMemo(
    () =>
      sp.lines.map((ln, li) => {
        const next = sp.lines[li + 1]
        const lineEnd = next ? sp.at + next.t[0] / 10 : sp.at + sp.dur
        const starts = ln.t.map((x) => sp.at + x / 10)
        const ends = starts.map((s, k) => Math.min(k < starts.length - 1 ? starts[k + 1] : lineEnd, s + 1.4))
        const base = sp.lines.slice(0, li).reduce((a, x) => a + x.w.length, 0)
        return { ...ln, start: starts[0], starts, ends, base }
      }),
    [sp],
  )

  // novi govor: na vrh, prati ponovo
  useLayoutEffect(() => {
    activeRef.current = -1
    setActive(-1)
    setFollow(true)
    box.current?.scrollTo({ top: 0 })
  }, [sp])

  // sat → trenutni red (React) + popunjavanje reči (direktno u DOM, svaki frejm)
  useEffect(() => {
    return clock.on((t) => {
      const li = t < sp.at ? -1 : lastAtOrBefore(lines, t, (x) => x.start)
      if (li !== activeRef.current) {
        // prethodni red ostaje pun
        const prev = lineEls.current[activeRef.current]
        prev?.querySelectorAll<HTMLElement>('.w').forEach((w) => w.style.removeProperty('--f'))
        activeRef.current = li
        setActive(li)
      }
      const el = lineEls.current[li]
      if (!el || li < 0) return
      const ln = lines[li]
      const ws = el.children
      for (let k = 0; k < ln.starts.length; k++) {
        const s = ln.starts[k]
        const e = ln.ends[k]
        const f = t <= s ? 0 : t >= e ? 1 : (t - s) / Math.max(0.05, e - s)
        const w = ws[k] as HTMLElement | undefined
        if (w) w.style.setProperty('--f', `${(f * 100).toFixed(1)}%`)
      }
    })
  }, [clock, lines, sp])

  // trenutni red se drži na trećini visine (osim kad posetilac sam skroluje)
  useEffect(() => {
    if (!follow || active < 0) return
    const el = lineEls.current[active]
    const b = box.current
    if (!el || !b) return
    const top = el.offsetTop - b.clientHeight * 0.32
    // daleki skok (premotavanje, otvaranje usred govora) odmah, susedni red glatko
    b.scrollTo({ top, behavior: Math.abs(top - b.scrollTop) > b.clientHeight * 1.5 ? 'auto' : 'smooth' })
  }, [active, follow])

  // posle 8 s bez skrolovanja lyrics se vraćaju na red koji se čuje
  useEffect(() => {
    if (follow) return
    const id = window.setInterval(() => {
      if (Date.now() - userScroll.current > 8000) setFollow(true)
    }, 1000)
    return () => clearInterval(id)
  }, [follow])

  const onWheel = () => {
    userScroll.current = Date.now()
    if (followRef.current) setFollow(false)
  }

  const cls = (li: number) => (li < active ? 'ln ln-past' : li === active ? 'ln ln-now' : li === active + 1 ? 'ln ln-next' : 'ln')

  return (
    <div className="ly-wrap" ref={wrapEl}>
      <div className="ly" ref={box} onWheel={onWheel} onTouchMove={onWheel}>
        <div className="ly-pad-top" />
        {lines.map((ln, li) => (
          <p
            key={li}
            ref={(el) => {
              lineEls.current[li] = el
            }}
            className={`${cls(li)}${ln.p ? ' par' : ''}`}
            style={{ ['--d' as string]: Math.min(4, Math.abs(li - active)) }}
          >
            {ln.w.map((w, k) => (
              <span
                key={k}
                className={marks?.has(ln.base + k) ? 'w mk' : 'w'}
                data-tc={fmtTc(ln.starts[k] - sp.at, false)}
                data-i={ln.base + k}
                onClick={() => {
                  setFollow(true)
                  onSeek(ln.starts[k])
                }}
              >
                {w}{' '}
              </span>
            ))}
          </p>
        ))}
        <div className="ly-pad-bot" />
      </div>
      {pick && onQuote && (
        <button
          className="ly-share"
          style={{ left: pick.x, top: pick.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onQuote(pick.a, pick.b)
            window.getSelection()?.removeAllRanges()
            setPick(null)
          }}
        >
          ❝ Podeli citat
        </button>
      )}
      {!follow && (
        <button className="ly-back" onClick={() => setFollow(true)}>
          ↓ Vrati na red koji se čuje
        </button>
      )}
    </div>
  )
})
