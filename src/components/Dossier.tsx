import { motion } from 'motion/react'
import { useEffect } from 'react'
import type { ListInfo, Mp, Session, SpeechEvent } from '../types'
import { Portrait } from './Portrait'

type Props = {
  mp: Mp
  list?: ListInfo
  session: Session
  speakerKey?: string
  isChair: boolean
  onClose: () => void
  onSeek: (t: number) => void
}

export function Dossier({ mp, list, session, speakerKey, isChair, onClose, onSeek }: Props) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const speeches = session.events.filter((e): e is SpeechEvent => e.type === 'speech' && e.speaker === speakerKey)
  const words = speeches.reduce((a, e) => a + e.words, 0)
  const color = list?.color ?? '#ccc'
  const facts: [string, string | undefined | null][] = [
    ['Izborna lista', mp.listFull],
    ['Poslanička grupa', mp.group],
    ['Predložila stranka', mp.party],
    ['Zanimanje', mp.profession],
    ['Godina rođenja', mp.born],
    ['Prebivalište', mp.residence],
    ['Mandat potvrđen', mp.confirmed?.replace(/\.$/, '')],
  ]
  return (
    <motion.div className="dossier-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dossier"
        role="dialog"
        aria-modal="true"
        aria-label={`Dosije: ${mp.name}`}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{ ['--c' as string]: color }}
      >
        <button className="close" onClick={onClose} aria-label="Zatvori dosije" autoFocus>
          ×
        </button>
        <div className="eyebrow">Narodni poslanik · 15. saziv{isChair ? ' · predsedavajući' : ''}</div>
        <div className="dossier-head">
          <Portrait mp={mp} name={mp.name} color={color} size={120} />
          <div>
            <h2>
              {mp.title && <small>{mp.title} </small>}
              {mp.name}
            </h2>
            <div className="sp-list" style={{ color }}>
              {list?.full}
            </div>
          </div>
        </div>
        <dl className="facts">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
        {mp.bio && (
          <div className="bio">
            <p>{mp.bio}</p>
            <a href={mp.bioUrl} target="_blank" rel="noreferrer" className="mono">
              Izvor: Wikipedija ↗
            </a>
          </div>
        )}
        <h3 className="d-sub">
          Na ovoj sednici <span className="mono">{speeches.length ? `${speeches.length} izlaganja · ${words} reči` : 'nije govorio/la'}</span>
        </h3>
        {speeches.length > 0 && (
          <ol className="d-speeches">
            {speeches.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => {
                    onSeek(e.t)
                    onClose()
                  }}
                >
                  <span className="mono">{e.clock}</span>
                  <span>{e.paragraphs[0].slice(0, 160)}…</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        <a className="link-btn" href={mp.url} target="_blank" rel="noreferrer">
          Profil na sajtu Narodne skupštine ↗
        </a>
      </motion.div>
    </motion.div>
  )
}
