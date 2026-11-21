import { memo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ListInfo } from '../types'
import { VB, type Seat } from '../geometry'

type Props = {
  seats: Seat[]
  lists: ListInfo[]
  activeMpId: string | null
  chairActive: boolean
  interjectMpId: string | null
  spokenIds: Set<string>
  highlightList: string | null
  /** istakni samo ove poslanike (npr. „Tvoj poslanik”); ostali se priguše */
  highlightIds?: Set<string> | null
  /** minuti govora po poslaniku za ovaj dan: ko je više govorio ima veće i svetlije sedište */
  talk?: Map<string, number>
  selectedMpId: string | null
  onSeat: (mpId: string) => void
  onChair: () => void
  chairName: string
}

/** Položaj reflektora (iznad i iza sale, van kadra). */
const LAMP = { x: VB.cx + 60, y: -320 }
const MOTES = Array.from({ length: 14 }, (_, i) => ({
  x: ((i * 37) % 60) - 30,
  f: 0.25 + ((i * 53) % 70) / 100,
  r: 0.8 + ((i * 7) % 5) * 0.35,
  d: 5 + ((i * 11) % 7),
  delay: -((i * 1.7) % 9),
}))

function seatPath(s: Seat) {
  // sedište okrenuto ka govornici (centru)
  const deg = 90 - (s.angle * 180) / Math.PI
  return `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${deg.toFixed(1)})`
}

export const Hemicycle = memo(function Hemicycle(p: Props) {
  const [hover, setHover] = useState<{ s: Seat; x: number; y: number } | null>(null)
  const color = (k?: string) => p.lists.find((l) => l.key === k)?.color ?? '#888'
  const maxTalk = Math.max(1, ...(p.talk ? [...p.talk.values()] : [1]))
  const active = p.seats.find((s) => s.mp?.id === p.activeMpId)
  const live = !!active || p.chairActive
  const focus = active ? { x: active.x, y: active.y } : p.chairActive ? { x: VB.cx, y: VB.cy + 6 } : null
  // reflektor ostaje na poslednjoj meti dok se gasi, pa se "okreće" ka sledećoj
  const lastFocus = useRef({ x: VB.cx, y: VB.cy - 200 })
  if (focus) lastFocus.current = focus
  const aim = lastFocus.current
  const dx = aim.x - LAMP.x
  const dy = aim.y - LAMP.y
  const len = Math.hypot(dx, dy)
  const deg = (Math.atan2(-dx, dy) * 180) / Math.PI

  return (
    <div className="hemi">
      <svg viewBox={`0 0 ${VB.w} ${VB.h + 40}`} className={`hemi-svg ${live ? 'is-live' : ''}`} role="img" aria-label="Raspored mesta u Velikoj sali">
        <defs>
          <radialGradient id="floor" cx="50%" cy="92%" r="75%">
            <stop offset="0" stopColor="#24324a" stopOpacity="0.95" />
            <stop offset="0.55" stopColor="#141c2b" stopOpacity="0.7" />
            <stop offset="1" stopColor="#0b0f17" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffe3b0" stopOpacity="0.5" />
            <stop offset="0.25" stopColor="#ffd28a" stopOpacity="0.12" />
            <stop offset="0.8" stopColor="#ffc56b" stopOpacity="0.16" />
            <stop offset="1" stopColor="#ffd28a" stopOpacity="0.42" />
          </linearGradient>
          <linearGradient id="beam-core" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff4dc" stopOpacity="0.55" />
            <stop offset="0.5" stopColor="#fff4dc" stopOpacity="0.08" />
            <stop offset="1" stopColor="#fff4dc" stopOpacity="0.3" />
          </linearGradient>
          <radialGradient id="pool">
            <stop offset="0" stopColor="#fff3d6" stopOpacity="0.95" />
            <stop offset="0.3" stopColor="#ffc56b" stopOpacity="0.45" />
            <stop offset="0.65" stopColor="#ff9f3d" stopOpacity="0.1" />
            <stop offset="1" stopColor="#ff9f3d" stopOpacity="0" />
          </radialGradient>
          <filter id="haze" x="-60%" y="-5%" width="220%" height="110%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="haze-soft" x="-60%" y="-5%" width="220%" height="110%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        <ellipse cx={VB.cx} cy={VB.cy - 120} rx={560} ry={480} fill="url(#floor)" />
        {/* stepenasti prstenovi poda */}
        {Array.from({ length: 11 }, (_, i) => 150 + i * 34.5).map((r) => (
          <path
            key={r}
            d={`M ${VB.cx - r} ${VB.cy} A ${r} ${r} 0 0 1 ${VB.cx + r} ${VB.cy}`}
            className="ring"
          />
        ))}
        {/* prolazi */}
        {[0.72, 1.57, 2.42].map((a) => (
          <line
            key={a}
            x1={VB.cx + 160 * Math.cos(a)}
            y1={VB.cy - 160 * Math.sin(a)}
            x2={VB.cx + 500 * Math.cos(a)}
            y2={VB.cy - 500 * Math.sin(a)}
            className="aisle"
          />
        ))}

        {/* bazen svetla na podu, ispod mesta */}
        <g className={`pool ${focus ? 'on' : ''}`} style={{ transform: `translate(${aim.x}px, ${aim.y}px)` }} aria-hidden>
          <circle key={`${aim.x}-${aim.y}`} r={92} fill="url(#pool)" className="pool-glow" />
        </g>

        {/* predsedništvo i govornica */}
        <g
          data-chair=""
          className={`presidium ${p.chairActive ? 'on' : ''}`}
          onClick={p.onChair}
          tabIndex={0}
          role="button"
          aria-label={`Predsedavajući: ${p.chairName}`}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && p.onChair()}
        >
          <rect x={VB.cx - 150} y={VB.cy + 6} width={300} height={30} rx={4} className="bench" />
          {[-120, -80, -40, 0, 40, 80, 120].map((dx) => (
            <rect key={dx} x={VB.cx + dx - 11} y={VB.cy + 12} width={22} height={14} rx={3} className={dx === 0 ? 'chair-seat' : 'helper-seat'} />
          ))}
          <path d={`M ${VB.cx - 40} ${VB.cy - 22} h 80 l -10 22 h -60 z`} className="rostrum" />
          <text x={VB.cx} y={VB.cy + 58} className="presidium-label">
            PREDSEDNIŠTVO
          </text>
        </g>

        {/* mesta */}
        <g className="seats">
          {/* ko je govorio crta se poslednji (iznad suseda), da uvećano sedište ne bude pokriveno */}
          {[...p.seats].sort((a, b) => (p.talk?.get(a.mp?.id ?? '') ?? 0) - (p.talk?.get(b.mp?.id ?? '') ?? 0)).map((s) => {
            const id = s.mp?.id
            const mins = (id && p.talk?.get(id)) || 0
            // veličina raste sa korenom minuta: najduži govornik 3×, kratko javljanje ~1,2×
            const k = mins > 0 ? 1.15 + 1.85 * Math.sqrt(mins / maxTalk) : 1
            const isActive = id && id === p.activeMpId
            const isInter = id && id === p.interjectMpId
            const dim = (p.highlightList && s.list !== p.highlightList) || (p.highlightIds && !(id && p.highlightIds.has(id)))
            const cls = [
              'seat',
              isActive && 'active',
              isInter && 'inter',
              id && p.spokenIds.has(id) && 'spoke',
              id && id === p.selectedMpId && 'selected',
              dim && 'dim',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <g
                key={s.idx}
                data-mp={id}
                transform={`${seatPath(s)} scale(${k.toFixed(2)})`}
                className={cls}
                style={{ ['--c' as string]: color(s.list), ['--row' as string]: s.row, ['--i' as string]: s.idx, ['--heat' as string]: mins > 0 ? Math.sqrt(mins / maxTalk).toFixed(2) : 0 }}
                onMouseMove={(e) => setHover({ s, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                onClick={() => id && p.onSeat(id)}
                tabIndex={id ? 0 : -1}
                role="button"
                aria-label={s.mp ? `${s.mp.name}, ${s.mp.listFull}` : 'Prazno mesto'}
                onKeyDown={(e) => id && (e.key === 'Enter' || e.key === ' ') && p.onSeat(id)}
              >
                <rect x={-8} y={-6} width={16} height={12} rx={3.2} className="cushion" />
                <rect x={-8} y={4} width={16} height={3} rx={1.5} className="back" />
                {isActive && <circle r={16} className="halo" />}
                {isActive && <circle r={16} className="halo halo-2" />}
                {isInter && <circle r={13} className="inter-ring" />}
              </g>
            )
          })}
        </g>

        {/* reflektor: volumetrijski snop koji se okreće ka govorniku */}
        <g className={`spot ${focus ? 'on' : ''}`} style={{ transform: `translate(${LAMP.x}px, ${LAMP.y}px) rotate(${deg}deg)` }} aria-hidden>
          <g className="spot-len" style={{ transform: `scale(1, ${(len / 1000).toFixed(4)})` }}>
            <polygon points="-34,0 34,0 150,1000 -150,1000" fill="url(#beam)" filter="url(#haze)" />
            <polygon points="-12,0 12,0 58,1000 -58,1000" fill="url(#beam-core)" filter="url(#haze-soft)" />
          </g>
          {MOTES.map((m, i) => (
            <circle
              key={i}
              className="mote"
              cx={m.x * (0.4 + m.f)}
              cy={len * m.f}
              r={m.r}
              style={{ animationDuration: `${m.d}s`, animationDelay: `${m.delay}s` }}
            />
          ))}
        </g>
      </svg>
      {/* oblačić ide direktno u <body>: sala je u 3D transformaciji, pa bi fiksna pozicija unutar nje bila pomerena */}
      {hover?.s.mp &&
        createPortal(
          <div className="seat-tip" style={{ left: hover.x, top: hover.y }}>
            <strong>{hover.s.mp.name}</strong>
            <span style={{ color: color(hover.s.list) }}>{p.lists.find((l) => l.key === hover.s.list)?.name}</span>
          </div>,
          document.body,
        )}
    </div>
  )
})
