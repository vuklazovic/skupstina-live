import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { Mp } from '../types'
import type { View, ZoomStore } from '../useZoom'

type Face = { id: string; x: number; y: number; size: number; chair?: boolean }
type Box = { x: number; y: number; w: number; h: number }
/** sedišta izmerena bez zuma (koordinate pozornice) */
type Base = { w: number; h: number; seats: (Box & { id: string })[]; chair: Box | null }
type Props = {
  mps: Mp[]
  colorOf: (mp: Mp) => string
  /** minuti govora: ko je govorio ima veće lice i obod u boji */
  talk: Map<string, number>
  dimIds?: Set<string> | null
  activeId?: string | null
  stageRef: RefObject<HTMLElement | null>
  deps: unknown[]
  /** zum sale: bez zuma samo oni koji su govorili i poznata lica, posle zuma svi u kadru */
  zoom: ZoomStore
  /** poznata lica (vođe grupa, raniji mandat, biografija…): vide se i bez zuma */
  notable: Set<string>
  /** predsedavajući: lice iznad predsedništva */
  chair?: { mpId: string; minutes: number } | null
  /** pretraga: vide se samo ovi poslanici, sa većim licem i imenom */
  focus?: Set<string> | null
  onChair?: () => void
  onPick: (id: string) => void
}

/** dok se sala prevlači, lica se crtaju i ovoliko piksela van kadra */
const PAD = 72

const initials = (n: string) =>
  n
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')

/**
 * Lica poslanika iznad njihovih sedišta. Sala je nagnuta (3D), pa lica stoje uspravno u ravni ekrana,
 * kao ljudi koji sede za klupama: dalji redovi su manji, a ko je govorio je veći.
 */
export const SeatFaces = memo(function SeatFaces({ mps, colorOf, talk, dimIds, activeId, stageRef, deps, zoom, notable, chair, onChair, focus, onPick }: Props) {
  const [state, setState] = useState<{ faces: Face[]; z: number }>({ faces: [], z: 1 })
  const { faces } = state
  const maxTalk = Math.max(1, chair?.minutes ?? 0, ...talk.values())
  const showAt1 = (id: string) => (talk.get(id) ?? 0) > 0 || notable.has(id)
  /** glava raste sa minutima: kratko javljanje ~1,3×, najduži govornik ~3× osnovne veličine */
  const grow = (mins: number) => (mins > 0 ? 1.3 + 1.7 * Math.sqrt(mins / maxTalk) : 1)
  // Sedišta se mere jednom (ne u svakom kadru zuma): zum je čisto pomeranje i uvećanje sloja, pa se položaj
  // na ekranu računa iz izmerenog: ekran = pomak + zum × osnova.
  const base = useRef<Base>({ w: 0, h: 0, seats: [], chair: null })
  const measureBase = () => {
    const st = stageRef.current?.getBoundingClientRect()
    if (!st) return
    const v = zoom.get()
    const un = (r: DOMRect): Box => ({ x: (r.left - st.left - v.x) / v.z, y: (r.top - st.top - v.y) / v.z, w: r.width / v.z, h: r.height / v.z })
    const seats: Base['seats'] = []
    document.querySelectorAll<SVGGElement>('.seats [data-mp]').forEach((el) => {
      const r = el.querySelector('.cushion')?.getBoundingClientRect()
      if (r && r.width > 0) seats.push({ id: el.dataset.mp!, ...un(r) })
    })
    const cr = document.querySelector('[data-chair]')?.getBoundingClientRect()
    base.current = { w: st.width, h: st.height, seats, chair: cr && cr.width ? un(cr) : null }
  }
  /** pad: koliko van kadra se lica još crtaju (dok se sala prevlači, da ne iskaču na ivici) */
  const compute = (v: View, pad = 0): Face[] => {
    const b = base.current
    // bez zuma: svi koji su govorili ovog dana i poznata lica; od zuma 1,6× sva lica u vidnom delu sale
    const all = v.z >= 1.6
    const out: Face[] = []
    const bases: number[] = []
    for (const s of b.seats) {
      const id = s.id
      if (focus ? !focus.has(id) : !all && !showAt1(id)) continue
      if (chair && id === chair.mpId) continue // predsedavajući je u predsedništvu, ne u svojoj klupi
      const w = s.w * v.z
      const h = s.h * v.z
      const mins = talk.get(id) ?? 0
      // veličina prati veličinu sedišta na ekranu (perspektiva), a ne raste dvaput za govornike
      const unit = Math.max(w, h) / (mins > 0 ? 1.15 + 1.85 * Math.sqrt(mins / maxTalk) : 1)
      bases.push(unit)
      // pri jakom zumu lica ne rastu u nedogled
      let size = Math.min(mins > 0 ? 110 : 54, Math.round(Math.max(12, unit * 1.3) * grow(mins)))
      if (focus) size = Math.min(120, Math.max(40, Math.round(size * 1.7))) // pronađeni su veći
      const x = v.x + s.x * v.z + w / 2
      const y = v.y + s.y * v.z + h * 0.35
      if (x < -pad || y - size < -pad || x > b.w + pad || y > b.h + 20 + pad) continue // van kadra (ne viri ispod zaglavlja)
      out.push({ id, x, y, size })
    }
    // predsedavajući iznad predsedništva
    if (chair && b.chair && (!focus || focus.has(chair.mpId))) {
      // ista mera kao za klupe (prednji redovi), da veličina glave poredi minute pošteno
      const unit = bases.length ? [...bases].sort((a, c) => a - c)[Math.floor(bases.length * 0.8)] : 14
      const size = Math.min(110, Math.round(Math.max(12, unit * 1.3) * grow(chair.minutes)))
      out.push({ id: chair.mpId, x: v.x + (b.chair.x + b.chair.w / 2) * v.z, y: v.y + (b.chair.y + b.chair.h * 0.3) * v.z, size, chair: true })
    }
    // dalji (viši na ekranu) prvi, da bliži redovi stoje ispred
    out.sort((a, c) => a.y - c.y)
    return out
  }
  // animacija pojavljivanja samo prve 3 s (ulazak sale), ne pri svakom zumu
  const [intro, setIntro] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 3000)
    return () => clearTimeout(t)
  }, [])
  const computeRef = useRef(compute)
  computeRef.current = compute
  // Zum: lica se računaju i crtaju u istom kadru kad i sala (flushSync), da ne kasne za sedištima.
  // Prevlačenje (isti zum): ceo sloj lica se samo pomera (bez novog crtanja), a lica se računaju ponovo tek
  // kad pomak pređe PAD ili kad sala stane.
  const wrap = useRef<HTMLDivElement>(null)
  const drawn = useRef({ z: 1, x: 0, y: 0, pad: 0 })
  const draw = (v: View, pad: number, sync: boolean) => {
    drawn.current = { ...v, pad }
    if (wrap.current) wrap.current.style.transform = ''
    const next = { faces: computeRef.current(v, pad), z: v.z }
    if (sync) flushSync(() => setState(next))
    else setState(next)
  }
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    let idle = 0
    const off = zoom.subscribe((v) => {
      const d = drawn.current
      const dx = v.x - d.x
      const dy = v.y - d.y
      if (v.z === d.z && d.pad > 0 && Math.abs(dx) < PAD && Math.abs(dy) < PAD) {
        if (wrap.current) wrap.current.style.transform = `translate(${dx}px, ${dy}px)`
      } else drawRef.current(v, PAD, true)
      clearTimeout(idle)
      idle = window.setTimeout(() => drawRef.current(zoom.get(), 0, false), 180)
    })
    return () => {
      clearTimeout(idle)
      off()
    }
  }, [zoom])
  useEffect(() => {
    const measure = () => {
      measureBase()
      drawRef.current(zoom.get(), 0, false)
      requestAnimationFrame(zoom.poke) // imena iznad lica mere se kad se lica nacrtaju
    }
    measure()
    // sala ulazi animacijom (~2,2 s), pa merimo i posle nje
    const t1 = setTimeout(measure, 700)
    const t2 = setTimeout(measure, 2400)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageRef, focus, zoom, ...deps]) // talk se menja samo sa danom, koji je u deps

  const byId = new Map(mps.map((m) => [m.id, m]))
  return (
    <div className={`seat-faces${intro ? ' faces-intro' : ''}`} ref={wrap}>
      {faces.map((f) => {
        const mp = byId.get(f.id)
        if (!mp) return null
        const spoke = (talk.get(f.id) ?? 0) > 0 || (!!f.chair && (chair?.minutes ?? 0) > 0)
        return (
          <button
            key={f.chair ? 'chair' : f.id}
            data-face={f.chair ? 'chair' : f.id}
            className={`face ${spoke ? 'spoke' : ''} ${f.chair ? 'chair' : ''} ${dimIds && !dimIds.has(f.id) ? 'dim' : ''} ${activeId === f.id ? 'active' : ''}`}
            style={{ left: f.x, top: f.y, width: f.size, height: f.size, ['--c' as string]: colorOf(mp), fontSize: Math.max(6, f.size * 0.36) }}
            onClick={() => (f.chair && onChair ? onChair() : onPick(f.id))}
            title={f.chair ? `${mp.name}, predsedavajući: ${Math.round(chair!.minutes)} min` : spoke ? `${mp.name}: ${Math.round(talk.get(f.id)!)} min govora` : mp.name}
            aria-label={mp.name}
          >
            {mp.photo ? <img src={mp.photo} alt="" decoding="async" draggable={false} /> : <span>{initials(mp.name)}</span>}
            {/* pri jačem zumu ispod lica i prezime */}
            {(focus || (state.z >= 2.4 && f.size >= 34)) && <em className="face-name">{focus ? mp.name : mp.name.split(' ').slice(1).join(' ')}</em>}
          </button>
        )
      })}
    </div>
  )
})
