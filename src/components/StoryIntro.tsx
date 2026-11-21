import { useEffect, useRef, useState } from 'react'
import { track } from '../analytics'

type Scene = { id: string; label: string; start: number; end: number }

/**
 * Uvod kao priča: video (HyperFrames, video/prica) sa kadrom za svaki dan i jednim za sve dane zajedno.
 * Trake na vrhu pokazuju kadrove; dodir levo/desno ide na prethodni/sledeći kadar, držanje pauzira.
 * Uvek bez zvuka, a „Preskoči” je uvek tu. Sala se učitava ispod.
 */
export function StoryIntro({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [t, setT] = useState(0)
  const [paused, setPaused] = useState(false)
  const [vertical] = useState(() => window.matchMedia('(orientation: portrait)').matches)
  const done = useRef(false)
  const hold = useRef<{ timer: number; long: boolean } | null>(null)

  const finish = (skipped: boolean) => {
    if (done.current) return
    done.current = true
    track('uvod-prica', { preskoceno: skipped, sekundi: Math.round(ref.current?.currentTime ?? 0) })
    onDone()
  }
  const sceneAt = (x: number) => Math.max(0, scenes.findIndex((s) => x >= s.start && x < s.end))
  const jump = (dir: 1 | -1) => {
    const v = ref.current
    if (!v || !scenes.length) return
    const i = sceneAt(v.currentTime)
    // nazad: ako je kadar tek počeo, na prethodni; inače na početak ovog
    const target = dir > 0 ? i + 1 : v.currentTime - scenes[i].start < 1.2 ? i - 1 : i
    if (target >= scenes.length) return finish(false)
    v.currentTime = scenes[Math.max(0, target)].start + 0.01
    setT(v.currentTime)
    if (v.paused) void v.play()
    track('uvod-prica-kadar', { smer: dir > 0 ? 'napred' : 'nazad' })
  }

  useEffect(() => {
    fetch('video/prica.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((m: { scenes: Scene[] }) => setScenes(m.scenes))
      .catch(() => finish(true))
    // ako video ne može da krene (npr. štednja podataka), posle kratkog čekanja ulazimo u salu
    const tm = setTimeout(() => ref.current && ref.current.currentTime === 0 && ref.current.paused && finish(true), 6000)
    return () => clearTimeout(tm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') finish(true)
      else if (e.key === 'ArrowRight') jump(1)
      else if (e.key === 'ArrowLeft') jump(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        const v = ref.current
        if (v) v.paused ? void v.play() : v.pause()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // glatko punjenje trake (timeupdate stiže samo ~4 puta u sekundi)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (ref.current) setT(ref.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const down = () => {
    hold.current = {
      long: false,
      timer: window.setTimeout(() => {
        if (hold.current) hold.current.long = true
        ref.current?.pause()
      }, 220),
    }
  }
  const up = (e: React.PointerEvent) => {
    const h = hold.current
    hold.current = null
    if (!h) return
    clearTimeout(h.timer)
    if (h.long) {
      void ref.current?.play()
      return
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    jump(e.clientX - r.left < r.width / 3 ? -1 : 1)
  }

  return (
    <div className="vintro sintro" role="dialog" aria-label="Uvod: statistika sednice">
      <div className={`vi-frame ${vertical ? 'v' : 'h'}`}>
        <video
          ref={ref}
          src={vertical ? 'video/prica-v.mp4' : 'video/prica.mp4'}
          autoPlay
          muted
          playsInline
          preload="auto"
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => finish(false)}
          onError={() => finish(true)}
        />
        <div className="si-bars" aria-hidden>
          {scenes.map((s) => {
            const p = Math.min(1, Math.max(0, (t - s.start) / (s.end - s.start)))
            return (
              <div key={s.id} className="si-seg">
                <i style={{ transform: `scaleX(${p})` }} />
                <span>{s.label}</span>
              </div>
            )
          })}
        </div>
        <div
          className="si-tap"
          onPointerDown={down}
          onPointerUp={up}
          onPointerLeave={() => {
            if (hold.current?.long) void ref.current?.play()
            if (hold.current) clearTimeout(hold.current.timer)
            hold.current = null
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {paused && <div className="si-paused" aria-hidden>❚❚</div>}
      </div>
      <div className="vi-ctl">
        <button className="vi-skip" onClick={() => finish(true)}>
          Preskoči →
        </button>
      </div>
      <p className="si-hint">Dodir desno: sledeće · levo: nazad · drži: pauza</p>
    </div>
  )
}
