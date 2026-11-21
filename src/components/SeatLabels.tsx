import { useEffect, useState, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import type { ZoomStore } from '../useZoom'

export type SeatLabel = { key: string; mpId: string | null; chair?: boolean; name: string; minutes: number; color: string }
type Placed = SeatLabel & { x: number; y: number }

type Props = {
  items: SeatLabel[]
  stageRef: RefObject<HTMLElement | null>
  /** promena koja pomera salu (dan, otvoren govor) – tada se položaji mere ponovo */
  deps: unknown[]
  /** zum sale: pri svakom pomeraju imena se mere ponovo, posle lica */
  zoom: ZoomStore
  onPick: (key: string) => void
}

/**
 * Imena najdužih govornika iznad njihovih sedišta. Sala je u 3D nagibu, pa se položaj sedišta meri
 * u prozoru (getBoundingClientRect) i oznaka stoji iznad, u ravni ekrana, da bude čitljiva.
 */
export function SeatLabels({ items, stageRef, deps, zoom, onPick }: Props) {
  const [placed, setPlaced] = useState<Placed[]>([])
  useEffect(() => {
    const measure = () => {
      const st = stageRef.current?.getBoundingClientRect()
      if (!st) return
      const out: Placed[] = []
      items.forEach((it) => {
        // ako je iznad sedišta lice, ime ide iznad lica
        const face = document.querySelector(`[data-face="${it.chair ? 'chair' : it.mpId}"]`)
        const el = face ?? (it.chair ? document.querySelector('[data-chair]') : it.mpId ? document.querySelector(`[data-mp="${it.mpId}"]`) : null)
        const r = el?.getBoundingClientRect()
        if (!r || r.width === 0) return
        let x = r.left + r.width / 2 - st.left
        let y = r.top - st.top
        // oznake koje bi se preklopile podižemo jednu iznad druge
        for (let guard = 0; guard < 6; guard++) {
          const hit = out.find((o) => Math.abs(o.x - x) < 110 && Math.abs(o.y - y) < 24)
          if (!hit) break
          y = hit.y - 26
        }
        out.push({ ...it, x, y })
      })
      setPlaced(out)
    }
    measure()
    // sala ulazi animacijom (~2,2 s), pa merimo i posle nje
    const t1 = setTimeout(measure, 700)
    const t2 = setTimeout(measure, 2400)
    window.addEventListener('resize', measure)
    // u istom kadru kad i sala i lica, da imena ne kasne
    const off = zoom.subscribe(() => flushSync(measure), true)
    return () => {
      off()
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, stageRef, zoom, ...deps])

  return (
    <div className="seat-labels" aria-hidden={false}>
      {placed.map((p) => (
        <button
          key={p.key}
          className="seat-label"
          style={{ left: p.x, top: p.y, ['--c' as string]: p.color }}
          onClick={() => onPick(p.key)}
          title={`${p.name}: ${Math.round(p.minutes)} min govora`}
        >
          {p.name} <b>{Math.round(p.minutes)}′</b>
        </button>
      ))}
    </div>
  )
}
