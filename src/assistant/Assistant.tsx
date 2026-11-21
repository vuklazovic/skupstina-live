import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Turn } from '../turns'
import {
  ask,
  DEFAULT_MODEL,
  KeyError,
  loadUserKey,
  MODEL_SUGGESTIONS,
  RateLimited,
  saveUserKey,
  ServerUnavailable,
  type ChatMsg,
  type UserKey,
} from './client'
import { track } from '../analytics'

type Props = {
  open: boolean
  onToggle: () => void
  sessionId: string
  /** predložena pitanja za ovaj dan (bez njih se koriste opšta) */
  suggested?: string[]
  turnById: (id: number) => Turn | undefined
  nameOf: (key: string) => string
  colorOf: (key: string) => string
  onOpenTurn: (t: Turn) => void
  /** fioka je potpuno zatvorena (posle animacije) - tek tada sme da se promeni raspored stranice */
  onClosed: () => void
}

const DEFAULT_SUGGESTED = [
  'Šta se ukratko desilo prvog dana?',
  'Ko su kandidati za predsednika Skupštine i ko ih je predložio?',
  'Pusti mi govor u kome je predložen Aleksandar Čupić.',
]

type Notice = 'server' | 'rate' | { error: string } | null

/** Leva fioka: razgovor o sednici, sa izvorima koji otvaraju govor iz sedišta. */
export function Assistant(p: Props) {
  const reduce = useReducedMotion()
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [userKey, setUserKey] = useState<UserKey | null>(() => loadUserKey())
  const [settings, setSettings] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const SUGGESTED = p.suggested?.length ? p.suggested : DEFAULT_SUGGESTED
  // drugi dan = nov razgovor (izvori [[ID]] važe samo za dan na koji se odnose)
  useEffect(() => {
    abort.current?.abort()
    setMsgs([])
    setNotice(null)
    setBusy(false)
  }, [p.sessionId])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
  }, [msgs, notice, reduce])
  useEffect(() => {
    if (p.open) setTimeout(() => input.current?.focus(), 250)
  }, [p.open])

  async function send(text: string) {
    const q = text.trim().slice(0, 1500)
    if (!q || busy) return
    const history: ChatMsg[] = [...msgs, { role: 'user', content: q }]
    track('asistent-pitanje', { predlozeno: SUGGESTED.includes(q), sopstveni_kljuc: !!userKey, redni_broj: msgs.length / 2 + 1 })
    setMsgs([...history, { role: 'assistant', content: '' }])
    setDraft('')
    setNotice(null)
    setBusy(true)
    const ctrl = new AbortController()
    abort.current = ctrl
    let answer = ''
    try {
      await ask({
        sessionId: p.sessionId,
        messages: history,
        userKey,
        signal: ctrl.signal,
        onText: (t) => {
          answer += t
          setMsgs([...history, { role: 'assistant', content: answer }])
        },
      })
      // asistent može da zatraži otvaranje govora: [[otvori:ID]]
      const m = answer.match(/\[\[otvori:(\d+)\]\]/)
      const t = m ? p.turnById(Number(m[1])) : undefined
      if (t) p.onOpenTurn(t)
      if (!answer.trim()) setMsgs([...history, { role: 'assistant', content: 'Nisam dobio odgovor. Pokušaj ponovo.' }])
    } catch (e) {
      setMsgs(answer ? [...history, { role: 'assistant', content: answer }] : history)
      if (e instanceof ServerUnavailable) {
        setNotice('server')
        track('asistent-bez-servera')
      }
      else if (e instanceof RateLimited) setNotice('rate')
      else if (e instanceof KeyError) setNotice({ error: e.message })
      else if (!ctrl.signal.aborted) setNotice({ error: 'Veza sa modelom je prekinuta. Pokušaj ponovo.' })
    } finally {
      setBusy(false)
    }
  }

  const retryLast = () => {
    const last = [...msgs].reverse().find((m) => m.role === 'user')
    if (!last) return
    setMsgs(msgs.slice(0, msgs.lastIndexOf(last)))
    void send(last.content)
  }

  /** Red teksta: **podebljano** i [[ID]] kao dugme za otvaranje govora. */
  const inline = (s: string, k: string): ReactNode[] =>
      s
        .replace(/\[\[otvori:\d+\]\]/g, '')
        .split(/(\[\[?\d+\]\]?|\*\*[^*]+\*\*)/g)
        .map((part, i) => {
          // izvor: [[ID]] ili, ako model tako napiše, [ID]
          const c = part.match(/^\[\[?(\d+)\]\]?$/)
          if (c) {
            const t = p.turnById(Number(c[1]))
            if (!t) return <Fragment key={k + i}>{part}</Fragment>
            return (
              <button key={k + i} className="cite" style={{ ['--c' as string]: p.colorOf(t.speaker) }} onClick={() => p.onOpenTurn(t)} title="Otvori govor">
                <i />
                {p.nameOf(t.speaker).split(' ').slice(-1)[0]} · {t.clock}
              </button>
            )
          }
          const b = part.match(/^\*\*([^*]+)\*\*$/)
          if (b) return <strong key={k + i}>{b[1]}</strong>
          return <Fragment key={k + i}>{part}</Fragment>
        })

  /** Tekst odgovora: pasusi i liste (oznake ::: se uklanjaju ako ih model ipak napiše). */
  function render(text: string) {
    return paragraphs(text.replace(/^:::\w*\s*$/gm, ''), 'r-')
  }

  function paragraphs(text: string, kp: string) {
    const blocks = text.replace(/^#+\s*/gm, '').split(/\n{2,}/).filter((b) => b.trim())
    return blocks.map((blk, bj) => {
      const bi = kp + bj
      const lines = blk.split('\n').filter((l) => l.trim())
      if (lines.length && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)))
        return (
          <ul key={bi}>
            {lines.map((l, li) => (
              <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), `${bi}-${li}-`)}</li>
            ))}
          </ul>
        )
      return <p key={bi}>{lines.flatMap((l, li) => (li ? [<br key={`br${li}`} />, ...inline(l, `${bi}-${li}-`)] : inline(l, `${bi}-${li}-`)))}</p>
    })
  }

  return (
    <>
      <button
        className={`asst-toggle ${p.open ? 'on' : ''}`}
        onClick={() => {
          if (!p.open) track('asistent-otvoren')
          p.onToggle()
        }}
        aria-expanded={p.open}
        aria-controls="asistent"
        title={p.open ? 'Zatvori AI asistenta' : 'Otvori AI asistenta'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        <span>AI asistent</span>
      </button>

      <AnimatePresence onExitComplete={p.onClosed}>
        {p.open && (
          <motion.aside
            id="asistent"
            className="asst"
            aria-label="AI asistent"
            initial={reduce ? { opacity: 0 } : { x: '-104%' }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '-104%' }}
            transition={{ duration: 0.4, ease: [0.2, 0.75, 0.15, 1] }}
          >
            <header className="asst-head">
              <div>
                <h2>AI asistent</h2>
                <span className="mono">
                  Pitaj o sednici · odgovara samo iz zapisnika · {userKey ? `tvoj ključ · ${userKey.model}` : 'naš ključ'}
                </span>
              </div>
              <button
                className="asst-new"
                onClick={() => {
                  abort.current?.abort()
                  setMsgs([])
                  setDraft('')
                  setNotice(null)
                  setBusy(false)
                  setTimeout(() => input.current?.focus(), 50)
                }}
                disabled={!msgs.length && !draft}
                title="Obriši razgovor i počni novi"
              >
                + Nova sesija
              </button>
              <button className="asst-icon" onClick={() => setSettings((s) => !s)} aria-expanded={settings} title="Sopstveni OpenRouter ključ i model">
                ⚙
              </button>
              <button className="asst-icon" onClick={p.onToggle} aria-label="Zatvori">
                ×
              </button>
            </header>

            {settings && (
              <KeyForm
                userKey={userKey}
                onSave={(v) => {
                  saveUserKey(v)
                  setUserKey(v)
                  setSettings(false)
                  if (v) track('asistent-kljuc-sacuvan', { model: v.model })
                  setNotice(null)
                }}
              />
            )}

            <div className="asst-list" ref={list}>
              {msgs.length === 0 && (
                <div className="asst-empty">
                  <p>Pitaj šta te zanima o sednici. Svaki odgovor ima izvore: klik na izvor otvara taj govor sa snimkom.</p>
                  {!userKey && (
                    <div className="asst-ask-key">
                      <p>
                        <strong>Mala molba:</strong> asistent radi na naš račun i krediti su ograničeni. Ako imaš OpenRouter nalog, molimo te da
                        uneseš svoj ključ, tako da asistent ostane dostupan i drugima. Jedno pitanje košta manje od jednog centa.
                      </p>
                      <button className="link-btn inline" onClick={() => setSettings(true)}>
                        Unesi svoj OpenRouter ključ →
                      </button>
                    </div>
                  )}
                  <div className="asst-sugg">
                    {SUGGESTED.map((s) => (
                      <button key={s} onClick={() => void send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.role === 'user' ? m.content : m.content ? render(m.content) : <span className="typing" aria-label="Piše odgovor"><i /><i /><i /></span>}
                </div>
              ))}

              {notice === 'server' && (
                <div className="asst-notice">
                  <strong>Zbog velikog saobraćaja, trenutno je moguće koristiti asistenta samo sa sopstvenim OpenRouter ključem.</strong>
                  <ol>
                    <li>
                      Napravi nalog na <a href="https://openrouter.ai" target="_blank" rel="noreferrer">openrouter.ai</a>.
                    </li>
                    <li>U podešavanjima naloga, pod „Credits”, dodaj malo kredita (jedno pitanje košta delić centa).</li>
                    <li>Pod „Keys” napravi novi ključ i kopiraj ga.</li>
                    <li>Nalepi ključ ispod. Čuva se samo u tvom browseru i šalje se direktno OpenRouteru.</li>
                  </ol>
                  <KeyForm
                    userKey={userKey}
                    onSave={(v) => {
                      saveUserKey(v)
                      setUserKey(v)
                      setNotice(null)
                      if (v) track('asistent-kljuc-sacuvan', { model: v.model })
                    }}
                    onSavedRetry={retryLast}
                  />
                </div>
              )}
              {notice === 'rate' && (
                <div className="asst-notice">
                  Previše pitanja za kratko vreme. Sačekaj minut, ili koristi sopstveni OpenRouter ključ (⚙ gore desno).
                </div>
              )}
              {notice && typeof notice === 'object' && (
                <div className="asst-notice err">
                  {notice.error}{' '}
                  <button className="link-btn inline" onClick={() => setSettings(true)}>
                    Podešavanja ključa
                  </button>
                </div>
              )}
            </div>

            <form
              className="asst-input"
              onSubmit={(e) => {
                e.preventDefault()
                void send(draft)
              }}
            >
              <textarea
                ref={input}
                value={draft}
                maxLength={1500}
                rows={2}
                placeholder="Npr. Šta je Jovanov rekao o opoziciji?"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(draft)
                  }
                }}
              />
              {busy ? (
                <button type="button" className="asst-send stop" onClick={() => abort.current?.abort()}>
                  Zaustavi
                </button>
              ) : (
                <button type="submit" className="asst-send" disabled={!draft.trim()}>
                  Pošalji
                </button>
              )}
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}

function KeyForm({ userKey, onSave, onSavedRetry }: { userKey: UserKey | null; onSave: (v: UserKey | null) => void; onSavedRetry?: () => void }) {
  const [key, setKey] = useState(userKey?.key ?? '')
  const [model, setModel] = useState(userKey?.model ?? DEFAULT_MODEL)
  return (
    <form
      className="key-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!key.trim().startsWith('sk-or-')) return
        onSave({ key: key.trim(), model: model.trim() || DEFAULT_MODEL })
        onSavedRetry?.()
      }}
    >
      <label>
        <span>Tvoj OpenRouter ključ</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" spellCheck={false} />
      </label>
      {key && !key.trim().startsWith('sk-or-') && <small className="kf-err">OpenRouter ključ počinje sa „sk-or-”.</small>}
      <label>
        <span>Model</span>
        <input list="or-models" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        <datalist id="or-models">
          {MODEL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <small>Bilo koji model sa openrouter.ai/models. Podrazumevano: {DEFAULT_MODEL}.</small>
      <div className="kf-actions">
        <button type="submit" className="asst-send" disabled={!key.trim().startsWith('sk-or-')}>
          Sačuvaj ključ
        </button>
        {userKey && (
          <button
            type="button"
            className="link-btn inline"
            onClick={() => {
              setKey('')
              onSave(null)
            }}
          >
            Ukloni ključ
          </button>
        )}
      </div>
    </form>
  )
}
