import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Turn } from '../turns'
import { YtPlayer } from './YtPlayer'

type Props = {
  speech: Turn
  name: string
  color: string
  index: number
  total: number
  prev?: Turn
  next?: Turn
  nameOf: (key: string) => string
  colorOf: (key: string) => string
  from?: number
  report: (t: number, playing: boolean) => void
  onPrev: () => void
  onNext: () => void
  onExit: () => void
}

/**
 * Snimak preko celog ekrana. Sloj ostaje isti dok se šeta po govorima (strelice, ← →, prevlačenje prstom),
 * pa pregledač ne izlazi iz režima celog ekrana; menja se samo plejer unutra.
 */
export function Theater(p: Props) {
  const u = p.speech
  const touch = useRef<{ x: number; y: number } | null>(null)

  return createPortal(
    <div
      className="theater"
      role="dialog"
      aria-label={`Ceo ekran: ${p.name}, ${u.clock}`}
      style={{ ['--c' as string]: p.color }}
      onTouchStart={(e) => {
        const t = e.touches[0]
        touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null
      }}
      onTouchEnd={(e) => {
        const s = touch.current
        touch.current = null
        if (!s) return
        const t = e.changedTouches[0]
        const dx = t.clientX - s.x
        const dy = t.clientY - s.y
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        if (dx < 0 && p.next) p.onNext()
        if (dx > 0 && p.prev) p.onPrev()
      }}
    >
      <header className="th-top">
        <i className="th-dot" />
        <div className="th-who">
          <strong>{p.name}</strong>
          <span className="mono">
            {u.clock} · {p.index + 1} / {p.total}
          </span>
        </div>
        <button className="th-close" onClick={p.onExit} aria-label="Izađi iz celog ekrana">
          ×
        </button>
      </header>

      <div className="th-stage">
        {u.yt ? (
          <YtPlayer
            key={u.id}
            videoId={u.yt.v}
            start={u.yt.s}
            end={u.vdur ? u.yt.s + u.vdur + 2 : undefined}
            autoplay
            from={p.from}
            report={p.report}
            title={`Snimak: ${p.name}, ${u.clock}`}
            onNext={p.next ? p.onNext : undefined}
            onFull={p.onExit}
            fullActive
          />
        ) : (
          <div className="th-none mono">Za ovaj govor nema snimka.</div>
        )}
      </div>

      {p.prev && (
        <button className="th-arrow th-prev" onClick={p.onPrev} style={{ ['--c' as string]: p.colorOf(p.prev.speaker) }} aria-label={`Prethodni govor: ${p.nameOf(p.prev.speaker)}`}>
          <span className="th-chev" aria-hidden>‹</span>
          <span className="th-peek">
            <i />
            {p.nameOf(p.prev.speaker)}
            <span className="mono">{p.prev.clock}</span>
          </span>
        </button>
      )}
      {p.next && (
        <button className="th-arrow th-next" onClick={p.onNext} style={{ ['--c' as string]: p.colorOf(p.next.speaker) }} aria-label={`Sledeći govor: ${p.nameOf(p.next.speaker)}`}>
          <span className="th-peek">
            <i />
            {p.nameOf(p.next.speaker)}
            <span className="mono">{p.next.clock}</span>
          </span>
          <span className="th-chev" aria-hidden>›</span>
        </button>
      )}
    </div>,
    document.body,
  )
}
