import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ListInfo, Mp, Session, Speaker } from '../types'
import type { Turn } from '../turns'
import { Portrait } from './Portrait'
import { YtPlayer } from './YtPlayer'
import { track } from '../analytics'

export type Origin = { dx: number; dy: number } // pomeraj sedišta od centra kartice (px)

type Props = {
  session: Session
  speech: Turn
  origin: Origin
  index: number
  total: number
  prev?: Turn
  next?: Turn
  speaker?: Speaker
  mp?: Mp
  list?: ListInfo
  color: string
  nameOf: (key: string) => string
  colorOf: (key: string) => string
  speakerStats: { min: number; words: number; count: number; nth: number }
  autoplay: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onOpenMp: (id: string) => void
  /** prijava greške u ovom govoru (samo kad kontakt forma radi) */
  onReportError?: () => void
  /** snimak je trenutno preko celog ekrana (ovde se onda ne pušta) */
  theater: boolean
  onTheater: () => void
  /** položaj snimka posle izlaska iz celog ekrana */
  resume?: { t: number; playing: boolean }
  report: (t: number, playing: boolean) => void
}

const fmtSec = (t: number) => {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(Math.round(t % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
const SHORT = 40

/** Govor u velikom prozoru koji izlazi iz sedišta govornika i vraća se u njega. */
export function SpeechModal(p: Props) {
  const reduce = useReducedMotion()
  const [full, setFull] = useState(false)
  const [copied, setCopied] = useState(false)
  const textBox = useRef<HTMLDivElement>(null)
  const u = p.speech
  const name = p.nameOf(u.speaker)
  const isShort = u.words <= SHORT
  const part = u.yt ? p.session.video?.find((x) => x.url.includes(u.yt!.v))?.title ?? 'snimak' : null
  const where = p.speaker?.role ? 'sa mesta predsedavajućeg' : p.list ? `iz klupa: ${p.list.name}` : 'iz sale'

  useEffect(() => {
    setFull(isShort)
    textBox.current?.scrollTo({ top: 0 })
  }, [u.id, isShort])

  const fly = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { x: p.origin.dx, y: p.origin.dy, scale: 0.03, opacity: 0, borderRadius: 200 },
        animate: { x: 0, y: 0, scale: 1, opacity: 1, borderRadius: 6 },
        exit: { x: p.origin.dx, y: p.origin.dy, scale: 0.03, opacity: 0, borderRadius: 200 },
      }

  return (
    <motion.article
      className="speech-modal"
      role="dialog"
      aria-modal="false"
      aria-label={`${name}, ${u.clock}`}
      style={{ ['--c' as string]: p.color }}
      {...fly}
      transition={{ duration: reduce ? 0.2 : 0.55, ease: [0.2, 0.75, 0.15, 1] }}
    >
      <button className="sm-close" onClick={p.onClose} aria-label="Zatvori i vrati se u salu">
        ×
      </button>

      <div className="sm-grid">
        <div className="sm-left">
          {u.yt ? (
            <>
              {p.theater ? (
                <div className="player yt th-placeholder mono">Snimak je na celom ekranu</div>
              ) : (
                <YtPlayer
                  key={u.id}
                  videoId={u.yt.v}
                  start={u.yt.s}
                  end={u.vdur ? u.yt.s + u.vdur + 2 : undefined}
                  autoplay={p.resume ? p.resume.playing : p.autoplay}
                  from={p.resume?.t}
                  report={p.report}
                  title={`Snimak: ${name}, ${u.clock}`}
                  onNext={p.next ? p.onNext : undefined}
                  onFull={p.onTheater}
                />
              )}
              <div className="player-meta mono">
                <span>
                  {part} · {fmtSec(u.yt.s)}
                  {u.vdur ? `–${fmtSec(u.yt.s + u.vdur)}` : ''}
                  {u.yt.q === 'priblizno' ? ' (približno)' : ''}
                </span>
                <span>sa YouTube kanala Narodne skupštine</span>
              </div>
            </>
          ) : (
            <div className="top-player none mono">Za ovaj govor nema snimka.</div>
          )}

          <dl className="sm-facts">
            <div>
              <dt>Kada</dt>
              <dd>{u.clock}</dd>
            </div>
            <div>
              <dt>Koliko</dt>
              <dd>{u.vdur != null ? fmtSec(u.vdur) : `~${Math.max(1, Math.round(u.dur))} min`}</dd>
            </div>
            <div>
              <dt>Reči</dt>
              <dd>{u.words.toLocaleString('sr-Latn-RS')}</dd>
            </div>
            <div>
              <dt>Gde</dt>
              <dd className="sm-where">{where}</dd>
            </div>
          </dl>
        </div>

        <div className="sm-right">
          <header className="sm-head">
            <Portrait mp={p.mp} name={name} color={p.color} size={64} />
            <div className="sm-who">
              {p.speaker?.role && <div className="eyebrow">{p.speaker.role}</div>}
              <h2>{name}</h2>
              {p.list && <div className="sp-list">{p.list.full}</div>}
              <div className="sm-tally mono">
                {p.speakerStats.nth}. nastup od {p.speakerStats.count} · ukupno {Math.max(1, Math.round(p.speakerStats.min))} min
                {p.mp && (
                  <button className="link-btn inline" onClick={() => p.onOpenMp(p.mp!.id)}>
                    Dosije →
                  </button>
                )}
              </div>
            </div>
          </header>

          <div className="sm-text" ref={textBox}>
            {!isShort && (
              <>
                <div className="eyebrow summary-label">Ukratko</div>
                {u.summaries.length <= 1 ? (
                  <p className="summary">{u.summaries[0]?.text ?? u.paragraphs[0]}</p>
                ) : (
                  <ol className="summary-parts">
                    {u.summaries.map((x) => (
                      <li key={x.clock + x.text.slice(0, 12)}>
                        <span className="mono">{x.clock}</span>
                        <p className="summary">{x.text}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
            <div className="sm-actions">
              {!isShort && (
                <button className={`act ${full ? 'on' : ''}`} onClick={() => {
                    if (!full) track('transkript-otvoren', { govornik: name })
                    setFull((f) => !f)
                  }}
                  aria-expanded={full}
                >
                  {full ? 'Sakrij transkript' : `Ceo transkript (${u.words.toLocaleString('sr-Latn-RS')} reči)`}
                </button>
              )}
              <button
                className="act ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(`${name} (${p.session.date}, ${u.clock}):\n\n${u.paragraphs.join('\n\n')}`)
                  track('tekst-kopiran', { govornik: name })
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1600)
                }}
              >
                {copied ? 'Kopirano' : 'Kopiraj tekst'}
              </button>
              {p.onReportError && (
                <button className="act ghost" onClick={p.onReportError} title="Pogrešan govornik, vreme, reč, sažetak ili snimak">
                  Prijavi grešku
                </button>
              )}
            </div>
            <AnimatePresence initial={false}>
              {full && (
                <motion.div
                  className="ut-text"
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={reduce ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  {p.session.auto && (
                    <p className="auto-note">
                      Automatski transkript snimka. Zvanične stenografske beleške za ovaj dan još nisu objavljene, pa su moguće greške u rečima i imenima.
                    </p>
                  )}
                  {u.segments.map((x, j) =>
                    x.kind === 'p' ? (
                      <p key={j}>{x.text}</p>
                    ) : (
                      <p key={j} className="seg-inter">
                        ({x.label}: {x.text})
                      </p>
                    ),
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <nav className="sm-nav" aria-label="Kretanje kroz govore">
        {p.prev ? (
          <button className="sm-prev" onClick={p.onPrev} style={{ ['--c' as string]: p.colorOf(p.prev.speaker) }}>
            <span className="nav-label">← Prethodni govor</span>
            <span className="nav-who">
              <i />
              {p.nameOf(p.prev.speaker)} <span className="mono">{p.prev.clock}</span>
            </span>
          </button>
        ) : (
          <span />
        )}
        <span className="sm-pos mono">
          {p.index + 1} / {p.total}
        </span>
        {p.next ? (
          <button className="sm-next" onClick={p.onNext} style={{ ['--c' as string]: p.colorOf(p.next.speaker) }}>
            <span className="nav-label">Sledeći govor →</span>
            <span className="nav-who">
              <i />
              {p.nameOf(p.next.speaker)} <span className="mono">{p.next.clock}</span>
            </span>
          </button>
        ) : (
          <span className="sm-end mono">Kraj prvog dana</span>
        )}
      </nav>
    </motion.article>
  )
}
