import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { track } from '../analytics'
import { onUdarci, setUdarciAfter, type Udarci } from './udarci'

/**
 * Čekić i srce preko prenosa (/uzivo).
 * - Čekić: klik udara po ekranu, staklo puca (pukotine iz tačke, krhotine padaju, ispod ostaje crno), samo kod onoga ko udara.
 * - Srce: na mestu klika iskoči srce sa malim srcima oko njega.
 * - Zastava: na mestu klika se podigne zastava Srbije i zavijori.
 * Klikovi se broje u pregledaču i na 5 s idu na server kao jedan paket (POST /api/chat {hits: {cekic, srce}}, najviše 10 svakog);
 * server samo sabira po sekundi. Svi gledaoci (zbirovi stižu uz chat, GET /api/chat?posle=…&udarci=<sekunda>, na 5 s, samo dok je strana vidljiva) u donjem
 * levom uglu vide čekiće i srca kako lete naviše, kao reakcije na TikTok live: najviše 2 ikonice po sekundi zbira,
 * pa ugao „ključa” kad je gužva, a telefon nikad ne crta stotine ikonica.
 * Sve je nacrtano u SVG-u i animirano Web Animations API-jem; zvuk je sintetisan (WebAudio), bez fajlova.
 */

type Hit = { id: number; x: number; y: number; t: number; own: boolean; seed: number; born: number }
const MAX_OWN = 60
export type Tool = 'off' | 'cekic' | 'srce' | 'zastava'
type Kind = 'cekic' | 'srce' | 'zastava'
const POLL = 5000 // isti ritam kao chat, čiji zahtev donosi zbirove (./udarci.ts)
const MAX_FLOATS = 18
const clientKey = () => {
  try {
    return localStorage.getItem('skupstina-klijent') ?? ''
  } catch {
    return ''
  }
}


// isti udarac izgleda isto kod svih (seme iz id-a i položaja)
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

type Seg = { d: string; w: number; o: number; at: number } // at: udaljenost od centra (za redosled širenja)
type Cell = { d: string; cx: number; cy: number; falls: boolean; o: number }
type Crack = { hole: string; cells: Cell[]; segs: Seg[]; r: number }

const P = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`

/**
 * Lom oko (0,0) kao na pravom staklu: nazubljena rupa, „paukova mreža” gustih prstenova oko nje,
 * zrakaste pukotine koje se tanje ka spolja (sa granama), presijavanje između pukotina.
 * Neke krhotine iz unutrašnjih prstenova ispadaju i ispod njih ostaje crno.
 */
function makeCrack(seed: number, scale: number): Crack {
  const r = rng(seed)
  const n = 7 + Math.floor(r() * 5)
  const ang = Array.from({ length: n }, (_, i) => ((i + 0.15 + r() * 0.7) / n) * Math.PI * 2)
  const pt = (a: number, d: number) => [Math.cos(a) * d, Math.sin(a) * d] as [number, number]
  const rh = (13 + r() * 9) * scale
  const levels = [rh, rh * 1.9, rh * 3.2, rh * 5.1]
  const grid = levels.map((lr) => ang.map((a) => pt(a + (r() - 0.5) * 0.12, lr * (0.82 + r() * 0.36))))
  // rupa: između tačaka unutrašnjeg prstena po jedan zubac
  let hole = ''
  ang.forEach((a, i) => {
    const b = i + 1 < n ? ang[i + 1] : ang[0] + Math.PI * 2
    const [x0, y0] = grid[0][i]
    const mid = pt((a + b) / 2, rh * (0.55 + r() * 0.75))
    hole += `${i ? 'L' : 'M'}${P(x0, y0)}L${P(mid[0], mid[1])}`
  })
  hole += 'Z'
  // ćelije između prstenova i zraka
  const cells: Cell[] = []
  for (let k = 0; k < levels.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const q = [grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]]
      const cx = q.reduce((s2, p) => s2 + p[0], 0) / 4
      const cy = q.reduce((s2, p) => s2 + p[1], 0) / 4
      const falls = r() < (k === 0 ? 0.85 : k === 1 ? 0.35 : 0.05)
      cells.push({ d: 'M' + q.map((p) => P(p[0], p[1])).join('L') + 'Z', cx, cy, falls, o: 0.02 + r() * (k === 0 ? 0.16 : 0.08) })
    }
  }
  const segs: Seg[] = []
  const line = (a: [number, number], b: [number, number], w: number, o: number, bend = 0.12) => {
    const mx = (a[0] + b[0]) / 2 + (r() - 0.5) * Math.hypot(b[0] - a[0], b[1] - a[1]) * bend
    const my = (a[1] + b[1]) / 2 + (r() - 0.5) * Math.hypot(b[0] - a[0], b[1] - a[1]) * bend
    segs.push({ d: `M${P(a[0], a[1])}L${P(mx, my)}L${P(b[0], b[1])}`, w, o, at: Math.hypot(a[0], a[1]) })
  }
  // paukova mreža: lukovi između zraka, ređi što su dalje
  for (let k = 1; k < levels.length; k++) {
    for (let i = 0; i < n; i++) if (r() < [0, 0.95, 0.7, 0.45][k]) line(grid[k][i], grid[k][(i + 1) % n], 1.1 - k * 0.18, 0.85 - k * 0.12, 0.25)
  }
  // zraci: kroz prstenove, pa izlomljeno ka spolja, sve tanji
  ang.forEach((a0, i) => {
    for (let k = 0; k < levels.length - 1; k++) line(grid[k][i], grid[k + 1][i], 1.6, 0.95, 0.08)
    let a = a0
    let d = levels[levels.length - 1]
    let cur = grid[levels.length - 1][i]
    const len = d + (45 + r() * 150) * scale
    while (d < len) {
      a += (r() - 0.5) * 0.3
      d += (9 + r() * 18) * scale
      const nx = pt(a, d)
      const f = 1 - (d - levels[3]) / (len - levels[3])
      line(cur, nx, 0.4 + 1.1 * f, 0.3 + 0.6 * f, 0.05)
      cur = nx
      if (r() < 0.14) {
        let ba = a + (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.45)
        let bd = d
        let bc = cur
        const bl = d + (14 + r() * 40) * scale
        while (bd < bl) {
          ba += (r() - 0.5) * 0.3
          bd += (7 + r() * 11) * scale
          const bn = pt(ba, bd)
          line(bc, bn, 0.5, 0.45, 0.05)
          bc = bn
        }
      }
    }
  })
  return { hole, cells, segs, r: levels[1] }
}

/** zvuk: tup udarac + lom stakla (šum kroz visoki filter) + nekoliko kratkih „zveckanja” */
let audio: AudioContext | null = null
function crashSound() {
  try {
    audio ??= new AudioContext()
    const ac = audio
    const t = ac.currentTime
    const out = ac.createGain()
    out.gain.value = 0.55
    out.connect(ac.destination)
    // udarac
    const o = ac.createOscillator()
    const og = ac.createGain()
    o.frequency.setValueAtTime(140, t)
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18)
    og.gain.setValueAtTime(0.9, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    o.connect(og).connect(out)
    o.start(t)
    o.stop(t + 0.25)
    // lom: beli šum
    const len = Math.floor(ac.sampleRate * 0.45)
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2)
    const ns = ac.createBufferSource()
    ns.buffer = buf
    const hp = ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2400
    const ng = ac.createGain()
    ng.gain.value = 0.5
    ns.connect(hp).connect(ng).connect(out)
    ns.start(t + 0.01)
    // zveckanje krhotina
    for (let i = 0; i < 6; i++) {
      const p = ac.createOscillator()
      const pg = ac.createGain()
      const st = t + 0.05 + Math.random() * 0.35
      p.type = 'sine'
      p.frequency.value = 3000 + Math.random() * 4000
      pg.gain.setValueAtTime(0.0001, st)
      pg.gain.exponentialRampToValueAtTime(0.12, st + 0.005)
      pg.gain.exponentialRampToValueAtTime(0.0001, st + 0.12)
      p.connect(pg).connect(out)
      p.start(st)
      p.stop(st + 0.14)
    }
  } catch {
    /* bez zvuka */
  }
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Impact({ hit, w, h, onShake }: { hit: Hit; w: number; h: number; onShake: (strong: boolean) => void }) {
  const scale = Math.max(0.6, Math.min(1.3, w / 900))
  const c = useMemo(() => makeCrack(hit.seed, scale), [hit.seed, scale])
  const g = useRef<SVGGElement>(null)
  useEffect(() => {
    const el = g.current
    if (!el) return
    const calm = reduced()
    const delay = hit.own ? 120 : 0 // čekić prvo zamahne
    const t = setTimeout(() => {
      onShake(hit.own)
      el.style.visibility = 'visible'
      const flash = el.querySelector<SVGCircleElement>('.hm-flash')
      flash?.animate([{ opacity: 0.95, transform: 'scale(0.2)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 260, easing: 'ease-out', fill: 'forwards' })
      el.querySelectorAll<SVGPathElement>('.hm-line').forEach((p) => {
        const L = p.getTotalLength()
        p.style.strokeDasharray = `${L + 1}`
        const at = Number(p.dataset.at) || 0
        p.animate([{ strokeDashoffset: L + 1 }, { strokeDashoffset: 0 }], { duration: calm ? 1 : 60, delay: calm ? 0 : Math.min(260, at * 1.1), easing: 'linear', fill: 'both' })
      })
      el.querySelectorAll<SVGPathElement>('.hm-ring').forEach((p) => {
        p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: calm ? 1 : 220, delay: calm ? 0 : 90, fill: 'both' })
      })
      el.querySelectorAll<SVGGElement>('.hm-shard').forEach((s) => {
        const dx = Number(s.dataset.dx)
        const dy = Number(s.dataset.dy)
        const rot = (Math.random() - 0.5) * 260
        const fall = h * (0.5 + Math.random() * 0.6)
        s.animate(
          calm
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
                { transform: `translate(${dx * 0.35}px,${dy * 0.35 - 12}px) rotate(${rot * 0.2}deg)`, opacity: 1, offset: 0.18 },
                { transform: `translate(${dx * 1.2}px,${fall}px) rotate(${rot}deg)`, opacity: 0 },
              ],
          { duration: calm ? 300 : 900 + Math.random() * 500, easing: 'cubic-bezier(.4,0,.9,.6)', fill: 'forwards', delay: Math.random() * 60 },
        )
      })
    }, delay)
    return () => clearTimeout(t)
  }, [hit.own, h, onShake])

  const under = c.cells.filter((x) => x.falls).map((x) => x.d).join('') + c.hole
  return (
    <g ref={g} transform={`translate(${(hit.x * w).toFixed(1)},${(hit.y * h).toFixed(1)})`} style={{ visibility: 'hidden' }} >
      {/* presijavanje stakla između pukotina */}
      {c.cells.map((x, i) => !x.falls && <path key={'f' + i} className="hm-ring" d={x.d} fill={`rgba(225,235,250,${x.o.toFixed(3)})`} />)}
      {/* ispod ispalih krhotina i rupe ostaje crno */}
      <path d={under} fill="#030405" />
      <path d={c.hole} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth={0.7} />
      {c.segs.map((x, i) => (
        <path key={'s' + i} className="hm-line" data-at={x.at.toFixed(0)} d={x.d} fill="none" stroke="rgba(0,0,0,.5)" strokeWidth={x.w + 1.6} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {c.segs.map((x, i) => (
        <path key={'l' + i} className="hm-line" data-at={x.at.toFixed(0)} d={x.d} fill="none" stroke={`rgba(240,245,255,${x.o.toFixed(2)})`} strokeWidth={x.w} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {c.cells.map(
        (x, i) =>
          x.falls && (
            <g key={'k' + i} className="hm-shard" data-dx={x.cx} data-dy={x.cy} style={{ transformBox: 'fill-box', transformOrigin: 'center' }}>
              <path d={x.d} fill="url(#hm-glass)" stroke="rgba(255,255,255,.75)" strokeWidth={0.7} />
            </g>
          ),
      )}
      <circle className="hm-flash" r={c.r * 2.2} fill="url(#hm-flash)" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
    </g>
  )
}

/** floats=false: bez ikonica koje lete u uglu (gledalac ih je isključio); svoje udarce i dalje vidi */
export function HammerLayer({ tool, host, floats: showFloats = true }: { tool: Tool; host: React.RefObject<HTMLDivElement | null>; floats?: boolean }) {
  const on = tool !== 'off'
  const [hits, setHits] = useState<Hit[]>([])
  // srca na mestu klika (samo kod onoga ko klikće)
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number; kind: 'srce' | 'zastava' }[]>([])
  // ikonice koje lete u donjem levom uglu (svi klikovi, i tuđi i moji)
  const [floats, setFloats] = useState<{ id: string; kind: Kind; x: number; sw: number; s: number }[]>([])
  const last = useRef(-1) // poslednja viđena sekunda zbira
  const ownN = useRef(0)
  const pending = useRef({ cekic: 0, srce: 0, zastava: 0 }) // klikovi koji čekaju sledeći paket
  const addFloat = useCallback((kind: Kind, key: string) => {
    setFloats((o) => (o.length >= MAX_FLOATS ? o : [...o, { id: key, kind, x: 8 + Math.random() * 54, sw: (Math.random() - 0.5) * 50, s: 0.8 + Math.random() * 0.45 }]))
  }, [])

  // tuđi klikovi: stižu u paketu, puštaju se u ritmu u kom su zadati
  useEffect(() => {
    let alive = true
    // zbirovi stižu uz chat (LiveChat), bez posebnog zahteva
    const take = (d: Udarci) => {
      try {
        if (!alive) return
        if (last.current < 0) {
          last.current = d.now // pri otvaranju strane: samo od sada
          setUdarciAfter(d.now)
          return
        }
        const fresh = d.counts.filter((c) => c.s > last.current)
        last.current = Math.max(last.current, d.now)
        setUdarciAfter(last.current)
        if (!fresh.length) return
        const s0 = fresh[0].s
        let n = 0
        for (const c of fresh) {
          // po sekundi najviše 2 ikonice, vrsta po odnosu srca i čekića
          const z = c.zastava ?? 0
          const total = c.cekic + c.srce + z
          const show = Math.min(2, total)
          for (let i = 0; i < show; i++) {
            const pick = Math.random() * total
            const kind: Kind = pick < c.srce ? 'srce' : pick < c.srce + z ? 'zastava' : 'cekic'
            const delay = Math.min(POLL - 200, (c.s - s0) * 1000 + i * 450 + Math.random() * 200)
            const key = `r${c.s}-${i}-${n++}`
            setTimeout(() => alive && addFloat(kind, key), delay)
          }
        }
      } catch {
        /* sledeći put */
      }
    }
    const off = onUdarci(take)
    // moji klikovi: jedan paket na 5 s
    const flush = () => {
      const p = pending.current
      if (!p.cekic && !p.srce && !p.zastava) return
      pending.current = { cekic: 0, srce: 0, zastava: 0 }
      fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hits: p, k: clientKey() }) }).catch(() => {})
    }
    const iv = setInterval(flush, POLL)
    return () => {
      alive = false
      off()
      clearInterval(iv)
      flush()
    }
  }, [addFloat])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [swing, setSwing] = useState<{ x: number; y: number; k: number } | null>(null)
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = layer.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const shake = useCallback(
    (strong: boolean) => {
      const el = host.current
      if (!el || reduced()) return
      const a = strong ? 7 : 3
      el.animate(
        [
          { transform: 'translate(0,0)' },
          { transform: `translate(${-a}px,${a * 0.6}px)` },
          { transform: `translate(${a * 0.8}px,${-a * 0.5}px)` },
          { transform: `translate(${-a * 0.4}px,${a * 0.3}px)` },
          { transform: 'translate(0,0)' },
        ],
        { duration: strong ? 260 : 180, easing: 'ease-out' },
      )
    },
    [host],
  )

  const strike = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = layer.current
    if (!el) return
    const b = el.getBoundingClientRect()
    const x = (e.clientX - b.left) / b.width
    const y = (e.clientY - b.top) / b.height
    const kind: Kind = tool === 'off' ? 'cekic' : tool
    const key = 'm' + Date.now() + Math.random()
    if (ownN.current++ % 2 === 0) addFloat(kind, key)
    pending.current[kind] = Math.min(10, pending.current[kind] + 1)
    if (kind !== 'cekic') {
      const id = Date.now() + Math.random()
      setHearts((o) => [...o, { id, x, y, kind }].slice(-30))
      setTimeout(() => setHearts((o) => o.filter((z) => z.id !== id)), kind === 'zastava' ? 1700 : 1200)
      track(`uzivo-${kind}`)
      return
    }
    const tmp = -Date.now()
    setSwing({ x, y, k: Date.now() })
    crashSound()
    setHits((o) => {
      const next = [...o, { id: tmp, x, y, t: Date.now(), own: true, seed: Math.floor(Math.random() * 1e9), born: Date.now() }]
      const own = next.filter((z) => z.own)
      const drop = new Set(own.slice(0, Math.max(0, own.length - MAX_OWN)))
      return next.filter((z) => !drop.has(z))
    })
    track('uzivo-cekic')
  }

  const ownCount = hits.filter((h) => h.own).length
  const swingPx = swing && size.w ? { left: swing.x * size.w, top: swing.y * size.h } : null

  return (
    <>
      <div ref={layer} className={`hm-layer ${on ? 'on' : ''} ${tool === 'srce' ? 'heart' : tool === 'zastava' ? 'flag' : ''}`} onPointerDown={on ? strike : undefined} aria-hidden={!on}>
        <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}>
          <defs>
            <linearGradient id="hm-glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,.38)" />
              <stop offset=".5" stopColor="rgba(190,210,230,.16)" />
              <stop offset="1" stopColor="rgba(255,255,255,.3)" />
            </linearGradient>
            <radialGradient id="hm-flash">
              <stop offset="0" stopColor="rgba(255,255,255,.95)" />
              <stop offset=".4" stopColor="rgba(255,240,210,.5)" />
              <stop offset="1" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
          </defs>
          {size.w > 0 && hits.map((h) => <Impact key={h.id} hit={h} w={size.w} h={size.h} onShake={shake} />)}
        </svg>
        {size.w > 0 &&
          hearts.map((h) => (
            h.kind === 'zastava' ? (
              <span key={h.id} className="hm-flag" style={{ left: h.x * size.w, top: h.y * size.h }}>
                <FlagSvg size={86} wave />
              </span>
            ) : (
            <span key={h.id} className="hm-heart" style={{ left: h.x * size.w, top: h.y * size.h }}>
              <HeartSvg size={64} />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <i key={i} style={{ ['--a' as string]: `${i * 60 + Math.round(Math.random() * 30)}deg` }}>
                  <HeartSvg size={16} />
                </i>
              ))}
            </span>
            )
          ))}
        {swingPx && (
          <div key={swing!.k} className="hm-hammer" style={{ left: swingPx.left, top: swingPx.top }} onAnimationEnd={() => setSwing(null)}>
            <HammerSvg />
          </div>
        )}
      </div>
      <div className="hm-floats" aria-hidden hidden={!showFloats}>
        {floats.map((f) => (
          <span
            key={f.id}
            className="hm-float"
            style={{ left: `${f.x.toFixed(1)}px`, ['--sw' as string]: `${f.sw.toFixed(0)}px`, ['--s' as string]: f.s.toFixed(2) }}
            onAnimationEnd={() => setFloats((o) => o.filter((z) => z.id !== f.id))}
          >
            {f.kind === 'srce' ? <HeartSvg size={34} /> : f.kind === 'zastava' ? <FlagSvg size={40} /> : <HammerSvg size={40} />}
          </span>
        ))}
      </div>
      {tool === 'cekic' && ownCount > 0 && (
        <button type="button" className="hm-fix" onClick={() => setHits((o) => o.filter((h) => !h.own))}>
          Popravi ekran
        </button>
      )}
    </>
  )
}

export function HammerSvg({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="27" y="22" width="7" height="40" rx="3" fill="#8a5a2b" stroke="#3b2410" strokeWidth="1.5" transform="rotate(-38 30 42)" />
      <rect x="6" y="8" width="38" height="16" rx="3" fill="#c9ced6" stroke="#2b3039" strokeWidth="1.8" transform="rotate(-38 25 16)" />
      <rect x="6" y="8" width="8" height="16" rx="2" fill="#9aa1ab" transform="rotate(-38 25 16)" />
    </svg>
  )
}

export function HeartSvg({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="hm-heart-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6b7d" />
          <stop offset="1" stopColor="#e0243b" />
        </linearGradient>
      </defs>
      <path d="M16 28.5C10 24 3 18.6 3 11.6 3 7.4 6.2 4.5 9.9 4.5c2.6 0 4.7 1.4 6.1 3.6 1.4-2.2 3.5-3.6 6.1-3.6 3.7 0 6.9 2.9 6.9 7.1 0 7-7 12.4-13 16.9z" fill="url(#hm-heart-g)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 9.2c.8-1.4 2.2-2 3.4-1.8" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/** zastava Srbije (crvena, plava, bela) na koplju; wave: vijori se */
export function FlagSvg({ size = 40, wave = false }: { size?: number; wave?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={wave ? 'hm-flag-svg wave' : 'hm-flag-svg'}>
      <rect x="6" y="4" width="2.6" height="42" rx="1.3" fill="#c9a24a" stroke="#5a4310" strokeWidth=".8" />
      <circle cx="7.3" cy="4" r="2.4" fill="#e7c766" stroke="#5a4310" strokeWidth=".8" />
      <g className="hm-cloth">
        <clipPath id="hm-flag-clip">
          <path d="M8.6 7c6-2.4 11 2.4 17 0s10-2.4 16 0v21c-6-2.4-10-2.4-16 0s-11 2.4-17 0z" />
        </clipPath>
        <g clipPath="url(#hm-flag-clip)">
          <rect x="8" y="2" width="36" height="11" fill="#C6363C" />
          <rect x="8" y="13" width="36" height="8.5" fill="#0C4076" />
          <rect x="8" y="21.5" width="36" height="10" fill="#fff" />
        </g>
        <path d="M8.6 7c6-2.4 11 2.4 17 0s10-2.4 16 0v21c-6-2.4-10-2.4-16 0s-11 2.4-17 0z" fill="none" stroke="rgba(0,0,0,.35)" strokeWidth=".8" />
        <path d="M14 8.5c2.5.6 5 .6 7.5-.4M28 8c2.5-.9 5-.9 7.5-.2" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1" strokeLinecap="round" />
      </g>
    </svg>
  )
}
