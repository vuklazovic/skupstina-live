import { useEffect, useMemo, useRef, useState } from 'react'
import { assignSeats, buildSeats, VB } from '../geometry'
import type { ListInfo, Mp } from '../types'
import type { PDay, PVote } from './Landing'
import { VCOL } from './VoteCard'
import { fmtTc } from './types'

type Slide = { v: PVote; day: PDay; n: number }

const KIND: Record<string, string> = { glasanje: 'Elektronsko glasanje', prozivka: 'Glasanje prozivkom', konstatacija: 'Odluka bez glasanja' }

const voteColor = (v: PVote, key: string) =>
  v.options?.find((o) => o.key === key)?.color ?? (key === 'uz' ? VCOL.uz : key === 'ne' ? VCOL.ne : key === 'od' ? '#363d4b' : '#5b6170')
const voteLabel = (v: PVote, key: string) => {
  const o = v.options?.find((x) => x.key === key)
  if (o) return `glasa za: ${o.short ?? o.label}`
  return key === 'od' ? 'nije glasao / nije bio u sali' : key === 'uz' ? 'uzdržan' : key === 'ne' ? 'ne učestvuje' : 'nije u zapisu'
}

/**
 * Sva glasanja do sada, jedno za drugim (prevlačenje, strelice, tačkice; samo se menja dok ga posetilac ne dirne).
 * Prozivka: sedišta se pale redom kojim su poslanici prozivani, u boji kandidata za koga su glasali.
 * Elektronsko: 250 kockica po ishodu (pojedinačni glasovi nisu objavljeni).
 */
export function VoteCarousel({ days, openDay }: { days: PDay[]; openDay: (id: string, extra?: Record<string, string>) => void }) {
  const [mps, setMps] = useState<Mp[]>([])
  const [lists, setLists] = useState<ListInfo[]>([])
  useEffect(() => {
    Promise.all([fetch('/data/mps.json').then((r) => r.json()), fetch('/data/lists.json').then((r) => r.json())])
      .then(([m, l]) => {
        setMps(m)
        setLists(l)
      })
      .catch(() => {})
  }, [])
  const seats = useMemo(() => (mps.length && lists.length ? assignSeats(buildSeats(250), mps, lists) : []), [mps, lists])
  const listColor = useMemo(() => new Map(lists.map((l) => [l.key, l.color])), [lists])
  const mpName = useMemo(() => new Map(mps.map((m) => [m.id, m.name])), [mps])

  const slides: Slide[] = useMemo(
    () => days.flatMap((d, i) => d.votes.filter((v) => v.kind !== 'kvorum').map((v) => ({ v, day: d, n: i + 1 }))),
    [days],
  )

  const track = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(0)
  const [auto, setAuto] = useState(true)
  const go = (i: number) => {
    const el = track.current
    if (!el) return
    const k = (i + slides.length) % slides.length
    el.scrollTo({ left: k * el.clientWidth, behavior: 'smooth' })
  }
  const onScroll = () => {
    const el = track.current
    if (el) setCur(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
  }
  // samo listanje dok posetilac ne dirne karusel
  useEffect(() => {
    if (!auto || slides.length < 2) return
    const id = window.setTimeout(() => go(cur + 1), 9000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, cur, slides.length])
  const stop = () => setAuto(false)

  if (!slides.length) return <div className="vcar vcar-empty" />

  return (
    <div className="vcar" onPointerDown={stop} onWheel={stop} onKeyDown={stop}>
      <div className="vcar-head">
        <span className="eyebrow">Sva glasanja do sada</span>
        <span className="vcar-count mono">
          {cur + 1} / {slides.length}
        </span>
      </div>
      <div className="vcar-track" ref={track} onScroll={onScroll}>
        {slides.map((s, i) => (
          <article key={i} className={`vcar-slide${i === cur ? ' on' : ''}`} aria-hidden={i !== cur}>
            <div className="vcar-meta mono">
              <span>
                Dan {s.n} · {fmtTc(s.v.at)}
              </span>
              <span className={`vcar-kind k-${s.v.kind}`}>{KIND[s.v.kind] ?? s.v.kind}</span>
            </div>
            <h3>{s.v.headline ?? s.v.title}</h3>
            {s.v.outcome && <p className="vcar-q">{s.v.outcome}</p>}

            {/* vizuelno: sala (prozivka, odluka) ili 250 kockica (elektronsko) */}
            {i === cur || Math.abs(i - cur) === 1 ? (
              s.v.result ? (
                <div className={`vcar-units${i === cur ? ' play' : ''}`} key={`u${i}-${i === cur}`}>
                  {(['za', 'protiv', 'uzdrzano', 'nije'] as const).flatMap((k) =>
                    Array.from({ length: s.v.result![k] }, (_, j) => (
                      <i key={`${k}${j}`} style={{ background: VCOL[k], animationDelay: `${(((j * 37 + k.length * 13) % 250) / 250) * 1.8}s` }} />
                    )),
                  )}
                  {Array.from({ length: Math.max(0, 250 - s.v.result.prisutno) }, (_, j) => (
                    <i key={`x${j}`} className="empty" />
                  ))}
                </div>
              ) : (
                <svg className={`vcar-hall${i === cur ? ' play' : ''}`} viewBox={`0 40 ${VB.w} ${VB.h - 30}`} key={`h${i}-${i === cur}`}>
                  {(() => {
                    const rank = new Map((s.v.roll ?? []).map(([mp], k) => [mp, k]))
                    const vote = new Map(s.v.roll ?? [])
                    return seats.map((st) => {
                      const id = st.mp?.id ?? ''
                      const key = vote.get(id)
                      const fill = s.v.roll ? (key ? voteColor(s.v, key) : '#2a303c') : s.v.kind === 'konstatacija' ? listColor.get(st.list ?? '') ?? '#888' : '#2a303c'
                      const r = rank.get(id) ?? (st.idx * 7) % 250
                      return (
                        <circle key={st.idx} cx={st.x} cy={st.y} r="12" style={{ fill, animationDelay: `${(r / 250) * 2.4}s` }}>
                          <title>{`${mpName.get(id) ?? ''}${key ? ': ' + voteLabel(s.v, key) : ''}`}</title>
                        </circle>
                      )
                    })
                  })()}
                </svg>
              )
            ) : (
              <div className="vcar-ph" />
            )}

            <div className="vcar-nums">
              {s.v.result ? (
                <>
                  <span style={{ ['--c' as string]: VCOL.za }}><b>{s.v.result.za}</b>za</span>
                  <span style={{ ['--c' as string]: VCOL.protiv }}><b>{s.v.result.protiv}</b>protiv</span>
                  <span style={{ ['--c' as string]: VCOL.uzdrzano }}><b>{s.v.result.uzdrzano}</b>uzdržano</span>
                  <span style={{ ['--c' as string]: VCOL.nije }}><b>{s.v.result.nije}</b>nije glasalo</span>
                </>
              ) : s.v.options ? (
                s.v.options.map((o) => (
                  <span key={o.key} style={{ ['--c' as string]: o.color ?? '#fff' }}>
                    <b>{o.n}</b>
                    {o.short ?? o.label}
                  </span>
                ))
              ) : (
                <span style={{ ['--c' as string]: VCOL.za }}><b>250</b>mandata potvrđeno</span>
              )}
            </div>
            {s.v.roll && (
              <div className="vcar-legend">
                {s.v.options?.map((o) => (
                  <span key={o.key}>
                    <i style={{ background: o.color }} />
                    {(o.short ?? o.label).replace(/\s*\(.*\)$/, '')}
                  </span>
                ))}
                <span><i style={{ background: '#363d4b' }} />nije glasao / nije bio u sali</span>
                {s.v.roll.some(([, k]) => k === 'ne') && <span><i style={{ background: VCOL.ne }} />ne učestvuje</span>}
                {s.v.roll.some(([, k]) => k === 'uz') && <span><i style={{ background: VCOL.uz }} />uzdržan</span>}
              </div>
            )}
            <div className="vcar-foot">
              <button className="ld-cta sm primary" onClick={() => openDay(s.day.id, { t: String(Math.floor(s.v.at)) })}>
                ▶ Pogledaj na traci
              </button>
              {s.v.roll && <span className="vcar-hint">Pređi mišem preko sedišta: ko je kako glasao</span>}
              {s.v.result && <span className="vcar-hint">Elektronsko: objavljen je samo zbir</span>}
            </div>
          </article>
        ))}
      </div>
      <div className="vcar-nav">
        <button className="vcar-arrow" onClick={() => (stop(), go(cur - 1))} aria-label="Prethodno glasanje">
          ←
        </button>
        <div className="vcar-dots">
          {slides.map((_, i) => (
            <button key={i} className={i === cur ? 'on' : ''} onClick={() => (stop(), go(i))} aria-label={`Glasanje ${i + 1}`} />
          ))}
        </div>
        <button className="vcar-arrow" onClick={() => (stop(), go(cur + 1))} aria-label="Sledeće glasanje">
          →
        </button>
      </div>
    </div>
  )
}
