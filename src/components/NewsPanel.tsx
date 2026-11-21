import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { Mp, SpeechRef } from '../types'
import { Portrait } from './Portrait'

export type NewsItem = {
  id: string
  source: string
  url: string
  title: string
  date: string
  time?: string | null
  summary: string
  topics: string[]
  mps: string[] // id-jevi poslanika
  /** naša vest iz podataka sednice (bez spoljnog linka) i govor na koji se odnosi */
  own?: boolean
  ref?: SpeechRef | null
}

type Props = {
  items: NewsItem[]
  mpById: Map<string, Mp>
  colorOf: (mp: Mp) => string
  onMp: (id: string) => void
  onOpenRef: (ref: SpeechRef) => void
  onClose: () => void
}

const fmtDay = (d: string) => new Date(d).toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long' })

/** Vesti i mediji: šta su mediji pisali o Skupštini (naslov, izvor, naš kratak sažetak, link na izvorni članak). */
export function NewsPanel({ items, mpById, colorOf, onMp, onOpenRef, onClose }: Props) {
  const [source, setSource] = useState<string | null>(null)
  const [topic, setTopic] = useState<string | null>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const sources = useMemo(() => {
    const c = new Map<string, number>()
    items.forEach((n) => c.set(n.source, (c.get(n.source) ?? 0) + 1))
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [items])
  const topics = useMemo(() => {
    const c = new Map<string, number>()
    items.forEach((n) => n.topics.forEach((t) => c.set(t, (c.get(t) ?? 0) + 1)))
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [items])
  const shown = items.filter((n) => (!source || n.source === source) && (!topic || n.topics.includes(topic)))
  const byDay = useMemo(() => {
    const m = new Map<string, NewsItem[]>()
    shown.forEach((n) => m.set(n.date, [...(m.get(n.date) ?? []), n]))
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [shown])

  return (
    <motion.div className="dossier-backdrop spk-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="news"
        role="dialog"
        aria-modal="true"
        aria-label="Vesti i mediji"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="spk-x" onClick={onClose} aria-label="Zatvori">
          ×
        </button>
        <header className="news-head">
          <div className="eyebrow">Mediji o Skupštini</div>
          <h2>Vesti</h2>
          <p>
            {items.length} tekstova iz {sources.length} medija. Naslov vodi na izvorni članak; sažetak je naš, kratak i neutralan.
          </p>
        </header>
        <div className="news-filters">
          <div className="nf-row" role="group" aria-label="Izvor">
            <button className={!source ? 'on' : ''} onClick={() => setSource(null)}>
              Svi mediji
            </button>
            {sources.map(([s, n]) => (
              <button key={s} className={source === s ? 'on' : ''} onClick={() => setSource(source === s ? null : s)}>
                {s} <span className="mono">{n}</span>
              </button>
            ))}
          </div>
          {topics.length > 1 && (
            <div className="nf-row" role="group" aria-label="Tema">
              {topics.map(([t, n]) => (
                <button key={t} className={`tp ${topic === t ? 'on' : ''}`} onClick={() => setTopic(topic === t ? null : t)}>
                  #{t} <span className="mono">{n}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {byDay.map(([day, list]) => (
          <section key={day} className="news-day">
            <h3>{fmtDay(day)}</h3>
            <ul>
              {list.map((n) => (
                <li key={n.id} className={`news-card ${n.own ? 'own' : ''}`}>
                  <div className="nc-meta">
                    <b>{n.source}</b>
                    {n.own && <em>iz zapisnika</em>}
                    {n.time && <span className="mono">{n.time}</span>}
                  </div>
                  {n.own ? (
                    n.ref ? (
                      <button className="nc-title" onClick={() => onOpenRef(n.ref!)}>
                        {n.title}
                      </button>
                    ) : (
                      <span className="nc-title">{n.title}</span>
                    )
                  ) : (
                    <a className="nc-title" href={n.url} target="_blank" rel="noopener noreferrer">
                      {n.title}
                    </a>
                  )}
                  <p className="nc-sum">{n.summary}</p>
                  <div className="nc-foot">
                    {n.mps.length > 0 && (
                      <span className="nc-mps">
                        {n.mps.slice(0, 5).map((id) => {
                          const mp = mpById.get(id)
                          return mp ? (
                            <button key={id} onClick={() => onMp(id)} title={mp.name}>
                              <Portrait mp={mp} name={mp.name} color={colorOf(mp)} size={24} />
                            </button>
                          ) : null
                        })}
                      </span>
                    )}
                    {n.own ? (
                      n.ref && (
                        <button className="nc-link" onClick={() => onOpenRef(n.ref!)}>
                          Pogledaj govor ▶
                        </button>
                      )
                    ) : (
                      <a className="nc-link" href={n.url} target="_blank" rel="noopener noreferrer">
                        Pročitaj na {n.source} ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {shown.length === 0 && <p className="spk-none">Nema vesti za ovaj izbor.</p>}
      </motion.div>
    </motion.div>
  )
}
