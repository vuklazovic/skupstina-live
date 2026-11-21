import { useCallback, useEffect, useRef, useState } from 'react'
import { track } from '../analytics'

/**
 * Mini igra „Zmijica” preko prenosa (/uzivo): snimak i zvuk teku ispod.
 * Strelice ili WASD, na telefonu prevlačenje prstom; razmak ili dodir = pauza. Najbolji rezultat se pamti u pregledaču.
 * Zmija skuplja sendviče; posle svakog sendviča je duža i malo brža. Prenos se vidi ispod, bez zatamnjenja.
 */

const COLS = 32
const ROWS = 18
const BEST_KEY = 'skupstina-zmijica-rekord'
type P = { x: number; y: number }
type Dir = 'u' | 'd' | 'l' | 'r'
const DIRS: Record<Dir, P> = { u: { x: 0, y: -1 }, d: { x: 0, y: 1 }, l: { x: -1, y: 0 }, r: { x: 1, y: 0 } }
const OPP: Record<Dir, Dir> = { u: 'd', d: 'u', l: 'r', r: 'l' }

const readBest = () => {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

// 1 sendvič, 2 sendviča, 5 sendviča, 21 sendvič
const sendv = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'sendvič' : 'sendviča')

function freeCell(snake: P[]): P {
  for (let i = 0; i < 500; i++) {
    const p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }
    if (!snake.some((s) => s.x === p.x && s.y === p.y)) return p
  }
  return { x: 0, y: 0 }
}

export function SnakeGame({ onClose }: { onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<'ready' | 'play' | 'pause' | 'over'>('ready')
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(readBest)
  const g = useRef({ snake: [] as P[], dir: 'r' as Dir, queue: [] as Dir[], food: { x: 0, y: 0 }, step: 120, acc: 0, last: 0, grow: 0, eaten: 0 })
  const phaseRef = useRef(phase)
  phaseRef.current = phase

  const reset = useCallback(() => {
    const mid = { x: Math.floor(COLS / 3), y: Math.floor(ROWS / 2) }
    const snake = [mid, { x: mid.x - 1, y: mid.y }, { x: mid.x - 2, y: mid.y }]
    g.current = { snake, dir: 'r', queue: [], food: freeCell(snake), step: 120, acc: 0, last: 0, grow: 0, eaten: 0 }
    setScore(0)
  }, [])

  const start = useCallback(() => {
    if (phaseRef.current === 'over' || phaseRef.current === 'ready') reset()
    setPhase('play')
    track('zmijica-start')
  }, [reset])

  const turn = useCallback(
    (d: Dir) => {
      if (phaseRef.current !== 'play') {
        if (phaseRef.current !== 'pause') start()
        else setPhase('play')
      }
      const q = g.current.queue
      const lastDir = q.length ? q[q.length - 1] : g.current.dir
      if (d !== lastDir && d !== OPP[lastDir] && q.length < 3) q.push(d)
    },
    [start],
  )

  // tastatura: strelice i WASD, razmak = pauza, Esc = zatvori
  useEffect(() => {
    const map: Record<string, Dir> = { ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r', w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r' }
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (map[e.key]) {
        e.preventDefault()
        turn(map[e.key])
      } else if (e.key === ' ') {
        e.preventDefault()
        setPhase((p) => (p === 'play' ? 'pause' : p === 'pause' ? 'play' : p))
        if (phaseRef.current === 'ready' || phaseRef.current === 'over') start()
      } else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [turn, start, onClose])

  // prevlačenje prstom
  useEffect(() => {
    const el = box.current
    if (!el) return
    let sx = 0
    let sy = 0
    const down = (e: TouchEvent) => {
      sx = e.touches[0].clientX
      sy = e.touches[0].clientY
    }
    const up = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx
      const dy = e.changedTouches[0].clientY - sy
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return
      e.preventDefault()
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : dy > 0 ? 'd' : 'u')
    }
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchend', up, { passive: false })
    return () => {
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchend', up)
    }
  }, [turn])

  // petlja: korak igre na `step` ms, crtanje na svaki kadar
  useEffect(() => {
    let raf = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      const c = canvas.current
      if (!c) return
      const W = c.clientWidth
      const H = c.clientHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== Math.round(W * dpr)) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
      }
      const s = g.current
      if (phaseRef.current === 'play') {
        if (!s.last) s.last = t
        s.acc += t - s.last
        s.last = t
        while (s.acc >= s.step) {
          s.acc -= s.step
          if (s.queue.length) s.dir = s.queue.shift()!
          const d = DIRS[s.dir]
          const head = { x: (s.snake[0].x + d.x + COLS) % COLS, y: (s.snake[0].y + d.y + ROWS) % ROWS }
          const body = s.grow > 0 ? s.snake : s.snake.slice(0, -1)
          if (body.some((p) => p.x === head.x && p.y === head.y)) {
            setPhase('over')
            const sc = s.eaten
            setBest((b) => {
              const nb = Math.max(b, sc)
              try {
                localStorage.setItem(BEST_KEY, String(nb))
              } catch {
                /* bez pamćenja */
              }
              return nb
            })
            track('zmijica-kraj', { poeni: sc })
            break
          }
          s.snake = [head, ...body]
          if (s.grow > 0) s.grow--
          if (head.x === s.food.x && head.y === s.food.y) {
            s.eaten++
            s.grow += 2
            s.step = Math.max(55, s.step - 4)
            s.food = freeCell(s.snake)
            setScore(s.eaten)
          }
        }
      } else s.last = 0

      const ctx = c.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const cw = W / COLS
      const ch = H / ROWS
      // mreža (jedva vidljiva, da prenos ostane čist)
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'
      ctx.lineWidth = 1
      for (let x = 1; x < COLS; x++) {
        ctx.beginPath()
        ctx.moveTo(x * cw, 0)
        ctx.lineTo(x * cw, H)
        ctx.stroke()
      }
      for (let y = 1; y < ROWS; y++) {
        ctx.beginPath()
        ctx.moveTo(0, y * ch)
        ctx.lineTo(W, y * ch)
        ctx.stroke()
      }
      // sendvič (hrana), blago poskakuje
      const f = s.food
      const bob = Math.sin(t / 200) * 0.06
      const u = Math.min(cw, ch) * 1.4
      const fx = (f.x + 0.5) * cw - u / 2
      const fy = (f.y + 0.5 + bob) * ch - u / 2
      ctx.save()
      ctx.translate(fx, fy)
      ctx.shadowColor = 'rgba(0,0,0,.55)'
      ctx.shadowBlur = 4
      ctx.shadowOffsetY = 1.5
      const slab = (y: number, h: number, color: string, r: number, inset = 0) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(u * (0.06 + inset), u * y, u * (0.88 - inset * 2), u * h, u * r)
        ctx.fill()
      }
      slab(0.62, 0.2, '#d9a35a', 0.08) // donja kriška
      ctx.shadowColor = 'transparent'
      slab(0.55, 0.1, '#e23b2e', 0.05, 0.04) // paradajz
      slab(0.47, 0.1, '#f2c230', 0.03, 0.02) // sir
      // zelena salata, talasasta
      ctx.fillStyle = '#5bbf3a'
      ctx.beginPath()
      ctx.moveTo(u * 0.04, u * 0.47)
      for (let i = 0; i <= 6; i++) ctx.quadraticCurveTo(u * (0.04 + (i + 0.5) * 0.153), u * (i % 2 ? 0.38 : 0.52), u * (0.04 + (i + 1) * 0.153), u * 0.45)
      ctx.lineTo(u * 0.96, u * 0.5)
      ctx.lineTo(u * 0.04, u * 0.5)
      ctx.fill()
      // gornja kriška, zaobljena, sa susamom
      ctx.fillStyle = '#e9b66a'
      ctx.beginPath()
      ctx.moveTo(u * 0.06, u * 0.44)
      ctx.quadraticCurveTo(u * 0.06, u * 0.12, u * 0.5, u * 0.12)
      ctx.quadraticCurveTo(u * 0.94, u * 0.12, u * 0.94, u * 0.44)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#fff6df'
      for (const [sx, sy] of [[0.3, 0.27], [0.5, 0.2], [0.68, 0.28], [0.42, 0.34], [0.6, 0.36]]) {
        ctx.beginPath()
        ctx.ellipse(u * sx, u * sy, u * 0.035, u * 0.02, 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      // zmija: telo od zlatne ka tamnijoj, glava sa očima
      const n = s.snake.length
      s.snake.forEach((p, i) => {
        const k = i / Math.max(1, n - 1)
        ctx.fillStyle = `rgb(${Math.round(255 - 80 * k)},${Math.round(197 - 90 * k)},${Math.round(107 - 70 * k)})`
        ctx.strokeStyle = 'rgba(11,15,23,.85)'
        ctx.lineWidth = 1.5
        const pad = i === 0 ? 0.06 : 0.12
        const x = (p.x + pad) * cw
        const y = (p.y + pad) * ch
        const w = cw * (1 - pad * 2)
        const h = ch * (1 - pad * 2)
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, Math.min(w, h) * 0.35)
        ctx.fill()
        ctx.stroke()
      })
      if (n) {
        const hd = s.snake[0]
        const d = DIRS[s.dir]
        const cx = (hd.x + 0.5) * cw
        const cy = (hd.y + 0.5) * ch
        const ox = d.y !== 0 ? cw * 0.2 : 0
        const oy = d.x !== 0 ? ch * 0.2 : 0
        ctx.fillStyle = '#0b0f17'
        for (const sgn of [-1, 1]) {
          ctx.beginPath()
          ctx.arc(cx + ox * sgn + d.x * cw * 0.15, cy + oy * sgn + d.y * ch * 0.15, Math.min(cw, ch) * 0.1, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    reset()
  }, [reset])

  return (
    <div className="sn" ref={box} onPointerDown={(e) => e.stopPropagation()}>
      <canvas ref={canvas} className="sn-canvas" />
      <div className="sn-top">
        <span className="sn-score">
          <b>{score}</b> {sendv(score)} · rekord <b>{Math.max(best, score)}</b>
        </span>
        <button type="button" className="sn-close" onClick={onClose} aria-label="Zatvori igru">
          Zatvori
        </button>
      </div>
      {phase !== 'play' && (
        <button type="button" className="sn-overlay" onClick={() => (phase === 'pause' ? setPhase('play') : start())}>
          <b>{phase === 'over' ? `Kraj: ${score} ${sendv(score)}` : phase === 'pause' ? 'Pauza' : 'Zmijica'}</b>
          <span>{phase === 'pause' ? 'Klikni ili razmak za nastavak' : phase === 'over' ? 'Klikni za novu igru' : 'Strelice ili WASD, na telefonu prevuci prstom. Skupljaj sendviče.'}</span>
          <em>{phase === 'over' ? 'Igraj ponovo' : phase === 'pause' ? 'Nastavi' : 'Počni'}</em>
        </button>
      )}
      {phase === 'play' && (
        <button type="button" className="sn-pause" onClick={() => setPhase('pause')} aria-label="Pauza">
          ❚❚
        </button>
      )}
    </div>
  )
}

export function SnakeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M4 18c0-3 3-3 5-3s5 0 5-3-3-3-5-3-4-1-4-3 2-3 5-3h6" fill="none" stroke="#ffc56b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19.5" cy="3.2" r="1.9" fill="#ffc56b" />
      <circle cx="20" cy="2.8" r=".55" fill="#0b0f17" />
    </svg>
  )
}
