import { memo, useRef, useState } from 'react'
import { VB, type Seat } from '../geometry'
import type { ListInfo } from '../types'
import { fmtTc, zoomOf } from './types'

export type SeatVote = { color?: string; label: string; unk?: boolean; at?: number }

type Props = {
  seats: Seat[]
  lists: ListInfo[]
  /** poslanik koji sada govori (svetli) */
  speakerMp: string | null
  /** govori predsedavajući (svetli govornica) */
  chairOn: boolean
  chairName?: string
  /** prozivka: glas svakog poslanika do sada (id → boja i opis); null = obična sala */
  votes: Map<string, SeatVote> | null
  /** poslanik koji je upravo glasao */
  latestMp?: string | null
  onSeat?: (mpId: string, at?: number) => void
}

/**
 * Sala (250 mesta, kao na naslovnoj): sedište govornika svetli, a u prozivci se sedišta boje
 * kako ko glasa. Prelaz mišem: ko je i kako je glasao.
 */
export const Hall = memo(function Hall({ seats, lists, speakerMp, chairOn, chairName, votes, latestMp, onSeat }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ s: Seat; x: number; y: number } | null>(null)
  const color = (k?: string) => lists.find((l) => l.key === k)?.color ?? '#888'
  const listName = (k?: string) => lists.find((l) => l.key === k)?.name ?? ''
  const active = seats.find((s) => s.mp?.id === speakerMp)

  const hover = (s: Seat, e: React.MouseEvent) => {
    const r = wrap.current?.getBoundingClientRect()
    if (!r) return
    const k = zoomOf(wrap.current!)
    setTip({ s, x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k })
  }
  const tv = tip?.s.mp ? votes?.get(tip.s.mp.id) : undefined

  return (
    <div className={`hall${votes ? ' voting' : ''}`} ref={wrap} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${VB.w} ${VB.h + 30}`} role="img" aria-label="Sala: 250 mesta">
        <defs>
          <radialGradient id="hall-floor" cx="50%" cy="95%" r="80%">
            <stop offset="0" stopColor="#2a3550" stopOpacity="0.9" />
            <stop offset="1" stopColor="#0b0f17" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={VB.cx} cy={VB.cy} rx="520" ry="520" fill="url(#hall-floor)" />
        {seats.map((s) => {
          const id = s.mp?.id
          const v = id && votes ? votes.get(id) : undefined
          const isSpeaker = !votes && id === speakerMp
          const fill = votes ? (v ? (v.unk ? 'url(#hall-unk)' : v.color) : 'none') : color(s.list)
          return (
            <circle
              key={s.idx}
              cx={s.x}
              cy={s.y}
              r={isSpeaker ? 15 : 11}
              className={`hs${isSpeaker ? ' spk' : ''}${votes && !v ? ' empty' : ''}${id && id === latestMp ? ' now' : ''}${v && !v.unk ? ' lit' : ''}`}
              style={{ fill, stroke: votes && !v ? 'rgba(255,255,255,.18)' : undefined, ['--c' as string]: color(s.list) }}
              onMouseMove={(e) => hover(s, e)}
              onClick={() => id && onSeat?.(id, v?.at)}
            />
          )
        })}
        <pattern id="hall-unk" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="rgba(255,255,255,.08)" />
          <rect width="2.5" height="6" fill="rgba(255,255,255,.4)" />
        </pattern>
        {/* govornica / predsedavajući */}
        <g className={`hall-chair${chairOn && !votes ? ' on' : ''}`}>
          <rect x={VB.cx - 70} y={VB.cy + 2} width="140" height="22" rx="6" />
          <text x={VB.cx} y={VB.cy + 18} textAnchor="middle">
            {chairOn && chairName ? chairName : 'predsedništvo'}
          </text>
        </g>
        {active && !votes && <circle cx={active.x} cy={active.y} r="26" className="hall-ring" />}
      </svg>
      {tip?.s.mp && (
        <div className="vc-tip hall-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="vc-tip-who">
            {tip.s.mp.photo ? <img src={`/${tip.s.mp.photo}`} alt="" /> : <span className="ph" />}
            <span>
              <b>{tip.s.mp.name}</b>
              <small>{listName(tip.s.list)}</small>
            </span>
          </div>
          {votes ? (
            <>
              <div className="vc-tip-vote">
                <i style={{ background: tv?.color ?? 'transparent' }} className={tv?.color && !tv.unk ? '' : 'unk'} />
                {tv ? tv.label : 'još nije prozvan'}
              </div>
              {tv?.at != null && <div className="vc-tip-at mono">glasao u {fmtTc(tv.at)} · klik pušta snimak</div>}
            </>
          ) : (
            <div className="vc-tip-at">{tip.s.mp.id === speakerMp ? 'sada govori' : tip.s.mp.party ?? ''}</div>
          )}
        </div>
      )}
    </div>
  )
})
