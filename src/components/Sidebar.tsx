import { useEffect, useRef } from 'react'
import type { Mp, Session } from '../types'
import { Portrait } from './Portrait'
import type { NewsItem } from './NewsPanel'
import type { Turn } from '../turns'
import { fmtHM } from '../geometry'

type Props = {
  session: Session
  speeches: Turn[]
  currentId: number | null
  nameOf: (key: string) => string
  colorOf: (key: string) => string
  /** poslanik iza oznake govornika (za sliku u krugu) */
  mpOf: (key: string) => Mp | undefined
  onOpen: (u: Turn, source: string) => void
  onStart: () => void
  onAbout?: () => void
  /** najnovije vesti (prve tri) i otvaranje svih */
  news?: NewsItem[]
  onNews?: () => void
  onContact?: () => void
  startLabel: string
}

// vertikalni tok: 1 minut govora = 5 px visine
const PX_PER_MIN = 5
const MIN_H = 34

const fmtDur = (s?: number) => (s == null ? '' : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`)

/** Desna traka: dugme za praćenje sednice i tok sednice (svi govori redom). Govornici se biraju u sali. */
export function Sidebar({ session, speeches, currentId, nameOf, colorOf, mpOf, onOpen, onStart, onAbout, onContact, news, onNews, startLabel }: Props) {
  const list = useRef<HTMLOListElement>(null)
  const shown = speeches

  useEffect(() => {
    list.current?.querySelector('.tl-row.on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentId])

  // pauze između govora (za razdelnike u toku sednice)
  const pauseBefore = (e: Turn, prev?: Turn) => (prev ? session.pauses.find((p) => prev.t < p.to && e.t >= p.from) : undefined)

  return (
    <aside className="sidebar" aria-label="Govornici i tok sednice">
      <div className="sb-start">
        <button className="enter-btn" onClick={onStart}>
          ▶ {startLabel}
        </button>
        <span>Govori se otvaraju redom, iz sedišta govornika.</span>
      </div>
      {news && news.length > 0 && onNews && (
        <section className="sb-news">
          <div className="sb-h">
            <span className="eyebrow">Najnovije vesti</span>
            <button className="sb-clear" onClick={onNews}>
              Sve vesti ({news.length}) →
            </button>
          </div>
          <ul>
            {news.slice(0, 3).map((n) => (
              <li key={n.id}>
                <button onClick={onNews}>
                  <b>
                    {n.source} · {n.time ?? n.date.slice(5).split('-').reverse().join('.')}
                  </b>
                  <span>{n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="sb-timeline">
        <div className="sb-h">
          <span className="eyebrow">Tok sednice</span>
          <span className="mono sb-count">{shown.length} nastupa</span>
        </div>
        <div className="tl-scale mono" aria-hidden>
          <span>visina = trajanje</span>
          <i style={{ height: 10 * PX_PER_MIN }} />
          <span>10 min</span>
        </div>
        <ol ref={list}>
          {shown.map((e, i) => {
            const pz = pauseBefore(e, shown[i - 1])
            const d = e.vdur ?? e.dur * 60
            // visina linearno prati trajanje; najkraći govori dobijaju najmanju visinu da bi mogli da se kliknu
            const h = Math.max(MIN_H, (d / 60) * PX_PER_MIN)
            return (
              <li key={e.id}>
                {pz && (
                  <div className="tlp-pause mono">
                    pauza {fmtHM(pz.from)}–{fmtHM(pz.to)}
                  </div>
                )}
                <button
                  className={`tl-row ${e.id === currentId ? 'on' : ''} ${h > 54 ? 'tall' : ''}`}
                  style={{ ['--c' as string]: colorOf(e.speaker), height: h }}
                  onClick={() => onOpen(e, 'tok')}
                  title={`${nameOf(e.speaker)} · ${e.clock} · ${fmtDur(d)}`}
                >
                  <span className="tl-line">
                    {/* slika govornika u krugu, kao u četu */}
                    <span className="tl-av">
                      <Portrait mp={mpOf(e.speaker)} name={nameOf(e.speaker)} color={colorOf(e.speaker)} size={26} />
                    </span>
                    <span className="mono tl-time">{e.clock}</span>
                    <span className="tl-name">
                      {nameOf(e.speaker)}
                      {e.parts.length > 1 && <span className="tl-parts mono"> · {e.parts.length} dela</span>}
                    </span>
                    <span className="mono tl-dur">{fmtDur(d)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </section>
      <footer className="sb-foot">
        <span>Skupština live · nezavisan, nestranački projekat. Nije zvanični sajt Narodne skupštine.</span>
        {onAbout && (
          <button onClick={onAbout}>Kako radimo →</button>
        )}
        {onContact && <button onClick={onContact}>Kontakt →</button>}
      </footer>
    </aside>
  )
}
