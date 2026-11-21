import type { ListInfo, Mp } from './types'

export const VB = { w: 1000, h: 600, cx: 500, cy: 540 }

export type Seat = { idx: number; x: number; y: number; angle: number; row: number; mp?: Mp; list?: string }

/** Polukružni raspored mesta: redovi od unutrašnjeg ka spoljnom, popunjavanje lista po uglu (s leva na desno). */
export function buildSeats(total: number, rows = 10, r0 = 170, r1 = 480): Seat[] {
  const radii = Array.from({ length: rows }, (_, i) => r0 + ((r1 - r0) * i) / (rows - 1))
  const sum = radii.reduce((a, b) => a + b, 0)
  const perRow = radii.map((r) => Math.floor((total * r) / sum))
  let left = total - perRow.reduce((a, b) => a + b, 0)
  for (let i = rows - 1; left > 0; i = (i - 1 + rows) % rows, left--) perRow[i]++
  const seats: Seat[] = []
  radii.forEach((r, row) => {
    const n = perRow[row]
    const pad = 0.06 // ostavi prolaze sa strana
    for (let k = 0; k < n; k++) {
      const a = Math.PI - pad - ((Math.PI - 2 * pad) * (n === 1 ? 0.5 : k / (n - 1)))
      seats.push({ idx: 0, x: VB.cx + r * Math.cos(a), y: VB.cy - r * Math.sin(a), angle: a, row })
    }
  })
  seats.sort((a, b) => b.angle - a.angle || a.row - b.row)
  seats.forEach((s, i) => (s.idx = i))
  return seats
}

export function assignSeats(seats: Seat[], mps: Mp[], lists: ListInfo[]): Seat[] {
  const order = lists.map((l) => l.key)
  const sorted = [...mps].sort(
    (a, b) => order.indexOf(a.list) - order.indexOf(b.list) || a.name.localeCompare(b.name, 'sr'),
  )
  // unutar klina liste: poređaj po redu da bi imena išla od prvog reda ka poslednjem
  let i = 0
  for (const l of lists) {
    const chunk = seats.slice(i, i + l.seats).sort((a, b) => a.row - b.row || b.angle - a.angle)
    const members = sorted.filter((m) => m.list === l.key)
    chunk.forEach((s, j) => {
      s.mp = members[j]
      s.list = l.key
    })
    i += l.seats
  }
  return seats
}

export const fmtClock = (m: number) => {
  const h = Math.floor(m / 60)
  const mm = Math.floor(m % 60)
  const ss = Math.floor((m * 60) % 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
export const fmtHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`
