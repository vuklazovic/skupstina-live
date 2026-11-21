import { memo, useEffect, useMemo, useRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { InterjectionEvent, Session, Speaker, SpeechEvent } from '../types'
import { fmtHM } from '../geometry'

export type Utterance = SpeechEvent | InterjectionEvent
export const FLOOR_KEY = '__sala__' // upadice bez imena ("Narodni poslanik: …")

export function utterances(session: Session): Utterance[] {
  return session.events.filter((e): e is Utterance => e.type === 'speech' || e.type === 'interjection')
}
export const keyOf = (u: Utterance) => u.speaker ?? FLOOR_KEY
export const wordsOf = (u: Utterance) => (u.type === 'speech' ? u.words : u.text.split(/\s+/).length)

type Props = {
  session: Session
  lanes: { key: string; name: string; sub: string; color: string; mp?: unknown }[]
  speakerByKey: Map<string, Speaker>
  selectedId: number | null
  selectedKey: string | null
  onSelect: (u: Utterance) => void
}

type Col = { kind: 'u'; u: Utterance; w: number } | { kind: 'pause'; from: number; to: number }

/** Jedna vremenska traka: svako javljanje je kockica u boji govornika, dužina srazmerna broju reči. */
export const Board = memo(function Board({ session, lanes, selectedId, selectedKey, onSelect }: Props) {
  const reduce = useReducedMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const laneIdx = useMemo(() => new Map(lanes.map((l, i) => [l.key, i])), [lanes])

  const cols = useMemo(() => {
    const out: Col[] = []
    const us = utterances(session)
    us.forEach((u, i) => {
      const prev = us[i - 1]
      if (prev) {
        const pz = session.pauses.find((p) => prev.t < p.to && u.t >= p.from)
        if (pz) out.push({ kind: 'pause', from: pz.from, to: pz.to })
      }
      // širina je srazmerna broju izgovorenih reči
      out.push({ kind: 'u', u, w: wordsOf(u) })
    })
    return out
  }, [session])

  // oznake vremena: prvo javljanje posle svakog punog sata i posle pauze
  const marks = useMemo(() => {
    const m = new Map<number, string>()
    let lastHour = -1
    cols.forEach((c, i) => {
      if (c.kind !== 'u') return
      const h = Math.floor(c.u.t / 60)
      if (h !== lastHour || (i > 0 && cols[i - 1].kind === 'pause')) {
        m.set(i, fmtHM(c.u.t))
        lastHour = h
      }
    })
    return m
  }, [cols])

  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('.blk.sel')
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest', inline: 'center' })
  }, [selectedId, reduce])

  // 1 px na 10 izgovorenih reči (najmanje 6 px), pa je dužina kockice stvarno srazmerna govoru
  const PX_PER_WORD = 0.1
  const template = cols.map((c) => (c.kind === 'pause' ? '28px' : `${Math.max(6, Math.round(c.w * PX_PER_WORD))}px`)).join(' ')

  const laneByKey = useMemo(() => new Map(lanes.map((l) => [l.key, l])), [lanes])

  return (
    <div className="board-wrap">
      <div
        className="board"
        ref={scroller}
        onWheel={(e) => {
          const el = scroller.current
          if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY
        }}
      >
        <div className="board-grid" style={{ gridTemplateColumns: template, gridTemplateRows: '20px 36px' }}>
          {cols.map((c, i) => {
            const col = i + 1
            if (c.kind === 'pause')
              return (
                <div key={`p${i}`} className="pause-col" style={{ gridColumn: col, gridRow: 2 }} title={`Pauza ${fmtHM(c.from)}–${fmtHM(c.to)}`}>
                  <span>pauza</span>
                </div>
              )
            const u = c.u
            const k = keyOf(u)
            const l = laneByKey.get(k) ?? lanes[lanes.length - 1]
            const sel = u.id === selectedId
            // ulazak: prvo se pojave kockice predsedavajućeg, pa ostalih govornika
            const delay = reduce ? 0 : (laneIdx.get(k) === 0 ? 0.3 : 0.9) + (i / cols.length) * 0.8
            return (
              <motion.button
                key={u.id}
                className={`blk ${u.type} ${sel ? 'sel' : ''} ${selectedKey === k ? 'mine' : ''} ${selectedKey && selectedKey !== k ? 'other' : ''}`}
                style={{ gridColumn: col, gridRow: 2, ['--c' as string]: l.color }}
                initial={reduce ? false : { opacity: 0, scaleY: 0.2 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ delay, duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
                onClick={() => onSelect(u)}
                aria-label={`${l.name}, ${u.clock}, ${u.type === 'speech' ? `${u.words} reči` : 'dobacivanje'}`}
                aria-pressed={sel}
                title={`${l.name} · ${u.clock}\n${u.type === 'speech' ? (u.summary ?? u.paragraphs[0]).split('. ')[0] : `„${u.text}”`}`}
              />
            )
          })}
          {[...marks].map(([i, label]) => (
            <div key={`m${i}`} className="mark mono" style={{ gridColumn: i + 1, gridRow: 1 }}>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
