import { motion } from 'motion/react'
import { useEffect } from 'react'
import type { ListInfo, Mp } from '../types'
import type { Turn } from '../turns'
import { Portrait } from './Portrait'
import type { NewsItem } from './NewsPanel'

export type SpeakerDay = { sessionId: string; label: string; date: string; turns: Turn[] }

type Props = {
  name: string
  sub: string
  color: string
  mp?: Mp
  list?: ListInfo
  /** sažetak svih govora (oba dana); bez njega se prikazuje sažetak jedinog govora */
  rezime?: string
  days: SpeakerDay[]
  auto: Set<string>
  /** vesti u kojima se pominje */
  news?: NewsItem[]
  onPlay: (sessionId: string, turnId: number, all: boolean) => void
  onDossier?: () => void
  onClose: () => void
}

/** podaci sa sajta Skupštine ponekad ponove naziv dva puta („X X”) */
const dedupe = (t?: string) => {
  const v = (t ?? '').trim()
  // „X X” ili „X / X” (velika i mala slova se ponekad razlikuju)
  const m = v.match(/^(.+?)\s*(?:\/\s*)?\1$/i)
  return m ? m[1].trim() : v
}
const minOf = (t: Turn) => (t.vdur != null ? t.vdur / 60 : t.dur)
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : m >= 1 ? `${Math.round(m)} min` : '<1 min')
const dur = (t: Turn) => {
  const s = Math.round(t.vdur ?? t.dur * 60)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`
}

/** Govornik: ukupno koliko je govorio, sažetak svih govora i svi govori po danima (svaki se može pustiti). */
export function SpeakerPanel(p: Props) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [p])
  const all = p.days.flatMap((d) => d.turns)
  const total = all.reduce((a, t) => a + minOf(t), 0)
  const words = all.reduce((a, t) => a + t.words, 0)
  const single = all.length === 1 ? all[0].summaries.map((s) => s.text).join(' ') : undefined
  const firstDay = p.days.find((d) => d.turns.length)

  return (
    <motion.div className="dossier-backdrop spk-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={p.onClose}>
      <motion.div
        className="spk"
        role="dialog"
        aria-modal="true"
        aria-label={`Govornik: ${p.name}`}
        style={{ ['--c' as string]: p.color }}
        initial={{ y: 24, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 16, scale: 0.98, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="spk-x" onClick={p.onClose} aria-label="Zatvori">
          ×
        </button>
        <header className="spk-head">
          <span className="spk-photo">
            <Portrait mp={p.mp} name={p.name} color={p.color} size={160} />
          </span>
          <div>
            <div className="eyebrow">Narodni poslanik · 15. saziv{p.sub === 'Predsedavajući' ? ' · predsedavajući' : ''}</div>
            <h2>
              {p.mp?.title && <small>{p.mp.title} </small>}
              {p.name}
            </h2>
            <span className="spk-sub">{p.list?.full ?? p.sub}</span>
          </div>
        </header>
        <div className="spk-body">
        <div className="spk-main">
        {all.length === 0 && (
          <p className="spk-none">Na ovoj sednici još nema govora. Kada se javi za reč, ovde će biti svi govori sa snimkom.</p>
        )}
        {all.length > 0 && (
        <dl className="spk-stats">
          <div>
            <dt>Ukupno</dt>
            <dd>{fmt(total)}</dd>
          </div>
          <div>
            <dt>Nastupa</dt>
            <dd>{all.length}</dd>
          </div>
          <div>
            <dt>Reči</dt>
            <dd>{words.toLocaleString('sr-Latn-RS')}</dd>
          </div>
        </dl>
        )}
        {firstDay && (
          <button className="spk-all" onClick={() => p.onPlay(firstDay.sessionId, firstDay.turns[0].id, true)}>
            ▶ Pusti sve redom
          </button>
        )}
        {(p.rezime || single) && (
          <section className="spk-sum">
            <h3>Ukratko o svim nastupima</h3>
            <p>{p.rezime ?? single}</p>
          </section>
        )}
        {p.days
          .filter((d) => d.turns.length)
          .map((d) => (
            <section key={d.sessionId} className="spk-day">
              <div className="spk-dh">
                <h3>
                  {d.label} <span>· {d.turns.length} {d.turns.length === 1 ? 'nastup' : 'nastupa'} · {fmt(d.turns.reduce((a, t) => a + minOf(t), 0))}</span>
                </h3>
                {d.turns.length > 1 && (
                  <button className="spk-dall" onClick={() => p.onPlay(d.sessionId, d.turns[0].id, true)}>
                    ▶ Pusti sve
                  </button>
                )}
              </div>
              {p.auto.has(d.sessionId) && <p className="spk-auto">Tekst ovog dana je automatski transkript snimka.</p>}
              <ol>
                {d.turns.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => p.onPlay(d.sessionId, t.id, false)}>
                      <span className="spk-t mono">
                        {t.clock}
                        <i>{dur(t)}</i>
                      </span>
                      <span className="spk-s">{t.summaries[0]?.text ?? t.paragraphs[0]?.slice(0, 160)}</span>
                      <span className="spk-play" aria-hidden>
                        ▶
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        {p.news && p.news.length > 0 && (
          <section className="spk-news">
            <h3 className="spk-sum-h">U medijima</h3>
            <ul>
              {p.news.slice(0, 8).map((n) => (
                <li key={n.id}>
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    <b>
                      {n.source} · {new Date(n.date).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short' })}
                    </b>
                    <span>{n.title} ↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>
        {p.mp && (
          <aside className="spk-info">
            <h3>Službeni podaci</h3>
            <dl>
              {(
                [
                  ['Izborna lista', dedupe(p.mp.listFull)],
                  ['Poslanička grupa', p.mp.group],
                  ['Predložila stranka', p.mp.party],
                  ['Zanimanje', p.mp.profession],
                  ['Godina rođenja', p.mp.born],
                  ['Prebivalište', p.mp.residence?.split(/\s+(?=Poslani|www\.|https?:|[a-z0-9-]+\.(?:com|rs|net|org)\b)/i)[0]],
                  ['Mandat potvrđen', p.mp.confirmed?.replace(/\.$/, '')],
                ] as [string, string | undefined | null][]
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {p.mp.bio && (
              <div className="spk-bio">
                <p>{p.mp.bio}</p>
                {p.mp.bioUrl && (
                  <a href={p.mp.bioUrl} target="_blank" rel="noreferrer">
                    Izvor: Wikipedija ↗
                  </a>
                )}
              </div>
            )}
            <a className="spk-ext" href={p.mp.url} target="_blank" rel="noreferrer">
              Profil na sajtu Narodne skupštine ↗
            </a>
            {p.mp.photo && p.mp.photoCredit && (
              <a className="spk-credit" href={p.mp.photoCredit.url} target="_blank" rel="noreferrer">
                Foto: {p.mp.photoCredit.text}
              </a>
            )}
          </aside>
        )}
        </div>
      </motion.div>
    </motion.div>
  )
}
