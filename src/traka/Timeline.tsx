import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmtTc, initials, isChair, zoomOf, type Clock, type TSpeech, type Traka } from './types'
import { voteTally } from './VoteCard'

type Props = {
  data: Traka
  clock: Clock
  cur: number
  playing: boolean
  onSeek: (g: number) => void
  onToggle: () => void
  /** klik na glasanje: indeks u data.votes */
  onVote: (i: number) => void
  vote: number | null
  /** zum pri otvaranju dana (px po sekundi); bez toga je ceo dan na ekranu */
  startPps?: number
  /** tačke dnevnog reda (traka iznad govora) */
  agenda?: { n: number; title: string; at: number }[]
  /** ključ govornika koji se prati: ostali govori su izbledeli, a ↑/↓ idu samo po njegovim */
  follow?: string | null
  onUnfollow?: () => void
}

const MAX_PPS = 240
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

/** talasni oblik govora: svaka reč je jedan „talas” (dužina reči → visina), kao zvučni zapis u montaži */
function wavePath(sp: TSpeech) {
  let d = ''
  let seed = sp.id * 9301
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  sp.lines.forEach((ln, li) => {
    const next = sp.lines[li + 1]
    const lend = next ? next.t[0] / 10 : sp.dur
    ln.t.forEach((t10, k) => {
      const x = t10 / 10
      const e = k < ln.t.length - 1 ? ln.t[k + 1] / 10 : lend
      const w = Math.max(0.08, Math.min(e - x, 0.9) * 0.82)
      const len = ln.w[k].replace(/[^\p{L}\p{N}]/gu, '').length
      const a = Math.min(0.97, 0.22 + Math.min(1, len / 9) * 0.6 + rnd() * 0.18)
      d += `M${x.toFixed(2)} ${(1 - a).toFixed(3)}h${w.toFixed(2)}v${(2 * a).toFixed(3)}h${(-w).toFixed(2)}z`
    })
  })
  return { d, w: Math.max(1, sp.dur) }
}

export const Timeline = memo(function Timeline({ data, clock, cur, playing, onSeek, onToggle, onVote, vote, startPps, agenda, follow, onUnfollow }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const tcRef = useRef<HTMLSpanElement>(null)
  const laneT = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const [left, setLeft] = useState(0)
  const fit = Math.max(0.01, (width - 24) / data.total)
  const [pps, setPps] = useState<number | null>(startPps ?? null) // null = cela traka na ekranu
  const z = pps ?? fit
  const zRef = useRef(z)
  zRef.current = z
  const anchor = useRef<{ t: number; x: number } | null>(null)
  // traka uvek prati glavu; posle ručnog pomeranja čeka 4 s pa se vraća na nju
  const userAt = useRef(0)
  const setFollow = (on: boolean) => {
    userAt.current = on ? 0 : Date.now()
  }
  const programmatic = useRef(0)

  // širina vidljivog dela
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // novi dan: cela traka
  useEffect(() => {
    setPps(startPps ?? null)
    setFollow(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // zum oko tačke (kursor ili glava)
  const zoomTo = (next: number, x?: number) => {
    const el = scroller.current
    if (!el) return
    const nz = Math.max(fit, Math.min(MAX_PPS, next))
    const ax = x ?? Math.max(0, Math.min(el.clientWidth, clock.t * zRef.current - el.scrollLeft))
    anchor.current = { t: (el.scrollLeft + ax) / zRef.current, x: ax }
    setPps(nz <= fit * 1.001 ? null : nz)
  }
  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (!el || !a) return
    anchor.current = null
    programmatic.current = Date.now()
    el.scrollLeft = a.t * z - a.x
    setLeft(el.scrollLeft)
  }, [z])

  // Ctrl/⌘ + točkić (ili štipanje na touchpadu) = zum; običan točkić = levo-desno
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomTo(zRef.current * Math.exp(-e.deltaY * 0.012), (e.clientX - r.left) / zoomOf(el))
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
      setFollow(false)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit])

  // glava (playhead) i vreme: direktno u DOM; praćenje glave dok snimak ide
  useEffect(
    () =>
      clock.on((t) => {
        const x = t * zRef.current
        if (head.current) head.current.style.transform = `translateX(${x}px)`
        if (tcRef.current) tcRef.current.textContent = fmtTc(t)
        // reč koja se upravo čuje na traci titlova
        const lane = laneT.current
        if (lane) {
          const prev = lane.querySelector('.tkt-word.on')
          let hit: Element | null = null
          for (const el of lane.children) {
            const a = Number((el as HTMLElement).dataset.a)
            const e = Number((el as HTMLElement).dataset.e)
            if (t >= a && t < e) {
              hit = el
              break
            }
          }
          if (prev !== hit) {
            prev?.classList.remove('on')
            hit?.classList.add('on')
          }
        }
        const el = scroller.current
        if (el && Date.now() - userAt.current > 4000) {
          const rel = x - el.scrollLeft
          if (rel < 0 || rel > el.clientWidth * 0.82) {
            programmatic.current = Date.now()
            el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25)
          }
        }
      }),
    [clock, z],
  )

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    setLeft(el.scrollLeft)
    // posetilac sam pomera traku (klizač): traka prestaje da prati glavu
    if (Date.now() - programmatic.current > 250 && !drag.current && playing) setFollow(false)
  }

  // pomeranje glave: klik ili prevlačenje po lenjiru/trakama
  const drag = useRef(false)
  const tAt = (clientX: number) => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    return ((clientX - r.left) / zoomOf(el) + el.scrollLeft) / zRef.current
  }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
        drag.current = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    onSeek(tAt(e.clientX))
  }
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return
    onSeek(tAt(e.clientX))
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    if (e.clientX > r.right - 30) el.scrollLeft += 18
    if (e.clientX < r.left + 30) el.scrollLeft -= 18
  }
  const up = () => {
    drag.current = false
  }

  const waves = useMemo(() => new Map(data.speeches.map((s) => [s.id, wavePath(s)])), [data])

  // vidljivi opseg (sa rezervom)
  const t0 = left / z - 30 / z - 5
  const t1 = (left + width) / z + 30 / z + 5
  const vis = (a: number, d: number) => a + d >= t0 && a <= t1

  // lenjir
  const step = STEPS.find((s) => s * z >= 92) ?? 7200
  const ticks: number[] = []
  for (let t = Math.max(0, Math.floor(t0 / step) * step); t <= Math.min(data.total, t1); t += step) ticks.push(t)
  const minor = step / 5

  // reči / rečenice na traci titlova
  const mode: 'words' | 'lines' | 'none' = z >= 45 ? 'words' : z >= 1.6 ? 'lines' : 'none'
  const caps = useMemo(() => {
    if (mode === 'none') return []
    const out: { key: string; at: number; end: number; text: string; sp: number }[] = []
    for (const s of data.speeches) {
      if (!vis(s.at, s.dur)) continue
      s.lines.forEach((ln, li) => {
        const next = s.lines[li + 1]
        const lend = s.at + (next ? next.t[0] / 10 : s.dur)
        if (mode === 'lines') {
          const a = s.at + ln.t[0] / 10
          if (vis(a, lend - a)) out.push({ key: `${s.id}-${li}`, at: a, end: lend, text: ln.w.join(' '), sp: s.id })
        } else {
          ln.w.forEach((w, k) => {
            const a = s.at + ln.t[k] / 10
            const e = k < ln.w.length - 1 ? s.at + ln.t[k + 1] / 10 : lend
            if (vis(a, e - a)) out.push({ key: `${s.id}-${li}-${k}`, at: a, end: e, text: w, sp: s.id })
          })
        }
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, Math.floor(t0 / 20), Math.floor(t1 / 20)])

  const clip = (s: TSpeech, chair: boolean) => {
    const p = data.people[s.who]
    const w = Math.max(2, s.dur * z)
    const wv = waves.get(s.id)!
    const isCur = data.speeches[cur]?.id === s.id
    // slika i ime ostaju vidljivi kad je početak klipa levo van ekrana (kao u programima za montažu)
    const off = Math.max(0, Math.min(w - (chair ? 120 : 220), left - s.at * z))
    const stick = off > 0 ? { transform: `translateX(${off}px)` } : undefined
    return (
      <div
        key={s.id}
        className={`tkt-clip${chair ? ' chair' : ''}${isCur ? ' cur' : ''}${w < 40 ? ' tiny' : ''}${follow && s.who !== follow ? ' dim' : ''}`}
        style={{ left: s.at * z, width: w, ['--c' as string]: p?.color ?? '#8e98ab' }}
        title={`${p?.name ?? s.who}${p?.party ? ' · ' + p.party : ''}\n${s.clock} · ${fmtTc(s.dur, false)}${s.summary ? '\n\n' + s.summary : ''}`}
      >
        {!chair && w >= 24 && (
          <div className="tkt-clip-photo" style={{ ...stick, ...(p?.photo ? { backgroundImage: `url(/${p.photo})` } : {}) }}>
            {!p?.photo && <span>{initials(p?.name ?? s.who)}</span>}
          </div>
        )}
        {!chair && <svg className="tkt-wave" viewBox={`0 0 ${wv.w} 2`} preserveAspectRatio="none" aria-hidden>
          <path d={wv.d} />
        </svg>}
        {w >= (chair ? 70 : 56) && (
          <div className="tkt-clip-txt" style={{ left: chair ? 10 : 'min(78px, 46%)', ...stick }}>
            <b>{p?.name ?? s.who}</b>
            {!chair && w >= 120 && <span>{p?.party ?? p?.list ?? ''}</span>}
          </div>
        )}
        {s.q === 'procena' && w >= 90 && !chair && <i className="tkt-est" title="Vreme reči je procena (nema transkripta snimka)">≈</i>}
      </div>
    )
  }

  const people = data.people
  const speakers = data.speeches.filter((s) => !isChair(people[s.who]))
  const chairs = data.speeches.filter((s) => isChair(people[s.who]))
  const curSp = data.speeches[cur]

  const prevNext = (d: 1 | -1) => {
    const t = clock.t
    const list = follow ? data.speeches.filter((s) => s.who === follow && s.dur >= 15) : data.speeches
    if (!list.length) return
    if (d > 0) {
      const n = list.find((s) => s.at > t + 0.5)
      if (n) onSeek(n.at)
    } else {
      const i = list.findIndex((s) => s.at > t - 2) // trenutni ili sledeći
      const back = list[Math.max(0, (i < 0 ? list.length : i) - 1)]
      if (back) onSeek(t - back.at > 3 || i < 1 ? back.at : list[Math.max(0, i - 2)].at)
    }
    setFollow(true)
  }

  // tastatura: ↑/↓ prethodni/sledeći govor, +/- zum
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea')) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        prevNext(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        prevNext(-1)
      } else if (e.key === '+' || e.key === '=') zoomTo(zRef.current * 1.6)
      else if (e.key === '-') zoomTo(zRef.current / 1.6)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const zoomVal = Math.log(z / fit) / Math.log(MAX_PPS / fit)

  return (
    <section className="tkt" aria-label="Traka sednice">
      <div className="tkt-bar">
        <div className="tkt-left">
            <span className="tkt-tc mono">
            <span ref={tcRef}>0:00:00</span>
            <span className="dim"> / {fmtTc(data.total)}</span>
          </span>
        <div className="tkt-legend" aria-label="Legenda">
          <span><i className="lg-speech" />govor</span>
          <span><i className="lg-chair" />predsedava</span>
          <span><i className="lg-vote" />glasanje</span>
          <span><i className="lg-point" />kvorum / odluka</span>
          <span><i className="lg-inter" />dobacivanje</span>
          <span className="dim">boja = lista</span>
        </div>
        </div>
        <div className="tkt-transport">
          <button className="tkt-btn" onClick={() => prevNext(-1)} title="Prethodni govor (↑)" aria-label="Prethodni govor">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 5h2v14H6zM20 5v14L9 12z" fill="currentColor" /></svg>
          </button>
          <button className="tkt-btn play" onClick={onToggle} title="Pusti / pauziraj (razmak)" aria-label={playing ? 'Pauziraj' : 'Pusti'}>
            {playing ? (
              <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" /></svg>
            )}
          </button>
          <button className="tkt-btn" onClick={() => prevNext(1)} title="Sledeći govor (↓)" aria-label="Sledeći govor">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="M16 5h2v14h-2zM4 5v14l11-7z" fill="currentColor" /></svg>
          </button>
        </div>
        <div className="tkt-right">
            {follow && (
              <button className="tkt-follow" onClick={onUnfollow} title="Prekini praćenje govornika">
                Pratiš: {people[follow]?.name ?? follow}
                <span aria-hidden>×</span>
              </button>
            )}
            {curSp && (
              <span className="tkt-now">
                <span className="dot" style={{ background: people[curSp.who]?.color ?? 'var(--ink-dim)' }} />
                {people[curSp.who]?.name ?? curSp.who}
                <span className="dim"> · u sali od {curSp.clock}</span>
              </span>
            )}
        <div className="tkt-zoom">

          <button className="tkt-btn sm" onClick={() => zoomTo(zRef.current / 1.6)} aria-label="Udalji">−</button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(Math.max(0, Math.min(1, zoomVal)) * 1000)}
            onChange={(e) => zoomTo(fit * Math.pow(MAX_PPS / fit, Number(e.target.value) / 1000))}
            aria-label="Zum trake"
            style={{ ['--p' as string]: `${Math.max(0, Math.min(1, zoomVal)) * 100}%` }}
          />
          <button className="tkt-btn sm" onClick={() => zoomTo(zRef.current * 1.6)} aria-label="Približi">+</button>
          <button className="tkt-chip" onClick={() => setPps(null)} title="Ceo dan na ekranu">Ceo dan</button>
        </div>
        </div>
      </div>

      <div className="tkt-body">
        <div className="tkt-scroll" ref={scroller} onScroll={onScroll} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="tkt-canvas" style={{ width: Math.max(width, data.total * z + 24) }}>
            <div className="tkt-ruler">
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * z }}>
                  <span className="mono">{fmtTc(t)}</span>
                  {[1, 2, 3, 4].map((m) => (
                    <i key={m} style={{ left: m * minor * z }} />
                  ))}
                </div>
              ))}
            </div>

            {agenda && agenda.length > 0 && (
              <div className="tkt-agenda" aria-label="Tačke dnevnog reda">
                {agenda.map((a, i) => {
                  const end = agenda[i + 1]?.at ?? data.total
                  const w = (end - a.at) * z
                  // naslov ostaje vidljiv kad je početak tačke levo van ekrana
                  const off = Math.max(0, Math.min(w - 60, left - a.at * z))
                  return (
                    <div key={a.n} className="tkt-ag" style={{ left: a.at * z, width: Math.max(2, w - 2) }} title={`Tačka ${a.n}: ${a.title}`}>
                      <span style={off > 0 ? { transform: `translateX(${off}px)` } : undefined}>
                        <b>Tačka {a.n}</b>
                        {a.title}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* jedna traka: oblik kaže šta se dešava, boja kojoj listi pripada */}
            <div className="tkt-track">
              {/* granica delova snimka (Deo I, II… na YouTube-u) */}
              {data.parts.map((p) => (
                <span key={p.v} className="tkt-cut" style={{ left: p.at * z }} title={`${p.title} snimka na YouTube-u`}>
                  <em>{p.title}</em>
                </span>
              ))}
              {speakers.filter((s) => vis(s.at, s.dur)).map((s) => clip(s, false))}
              {chairs.filter((s) => vis(s.at, s.dur)).map((s) => clip(s, true))}

              {(data.votes ?? []).map((v, i) => {
                const point = v.kind === 'kvorum' || v.kind === 'konstatacija'
                const w = point ? 20 : Math.max(20, (v.end - v.at) * z)
                if (!vis(v.at - 20 / z, v.end - v.at + 40 / z)) return null
                const tally = voteTally(v)
                const tot = tally.reduce((a, x) => a + x.n, 0) || 1
                return (
                  <button
                    key={i}
                    className={`tkt-vote k-${v.kind}${vote === i ? ' on' : ''}${w < 90 ? ' slim' : ''}${point ? ' point' : ''}`}
                    style={{ left: point ? v.at * z - 10 : v.at * z, width: w }}
                    title={`${v.title}${v.outcome ? '\n' + v.outcome : ''}`}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      onVote(i)
                    }}
                  >
                    <span className="tkt-vote-ic" aria-hidden>
                      {v.kind === 'kvorum' ? 'K' : v.kind === 'konstatacija' ? '§' : (
                        <svg viewBox="0 0 16 16" width="11" height="11"><path d="M3 7l3.2 3L13 3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                    </span>
                    {!point && w >= 90 && <span className="tkt-vote-t">{v.title}</span>}
                    {!point && tally.length > 0 && (
                      <span className="tkt-vote-bar">
                        {tally.map((x) => (
                          <i key={x.label} style={{ background: x.c, width: `${(x.n / tot) * 100}%` }} />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}

              {data.inter
                .filter((x) => vis(x.at, 1))
                .map((x, i) => (
                  <button
                    key={i}
                    className="tkt-mark"
                    style={{ left: x.at * z }}
                    title={`Dobacivanje · ${x.who ?? ''}: ${x.text}`}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      onSeek(x.at)
                    }}
                  />
                ))}

              <div className={`tkt-caps mode-${mode}`} ref={laneT}>
                {caps.map((c) => (
                  <span
                    key={c.key}
                    className={mode === 'words' ? 'tkt-word' : 'tkt-line'}
                    data-a={mode === 'words' ? c.at : undefined}
                    data-e={mode === 'words' ? c.end : undefined}
                    style={{ left: c.at * z, width: Math.max(2, (c.end - c.at) * z - 2) }}
                    onPointerDown={(e) => {
                      if (mode !== 'words') return
                      e.stopPropagation()
                      onSeek(c.at)
                    }}
                    title={mode === 'words' ? `${c.text} · ${fmtTc(c.at)}` : undefined}
                  >
                    {c.text}
                  </span>
                ))}
              </div>
            </div>

            <div className="tkt-head-line" ref={head} aria-hidden>
              <i />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
})
