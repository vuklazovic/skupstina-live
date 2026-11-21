import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { track } from '../analytics'
import { MEJL } from './Mreze'

/** Na šta se odnosi prijava greške: jedan govor ili (bez `label`) stranica sajta. */
export type ReportAbout = { ref: string; label?: string }

/**
 * Kontakt: poruka ide uredništvu preko servera; ispod je i javna adresa uredništva (MEJL) za one koji radije pišu iz svoje pošte.
 * Sa `about` je to prijava greške u jednom govoru (uz poruku ide i dan + id govora).
 */
export function ContactPanel({ onClose, about }: { onClose: () => void; about?: ReportAbout }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('') // zamka za botove (skriveno polje)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | { error: string }>('idle')
  useEffect(() => {
    // Escape zatvara samo ovaj prozor, ne i govor ispod njega
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (message.trim().length < 5) return setState({ error: 'Napišite poruku (bar nekoliko reči).' })
    setState('sending')
    const r = await fetch('/api/kontakt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message, website, ...(about ? { ref: about.ref } : {}) }),
    }).catch(() => null)
    if (r?.ok) {
      setState('sent')
      track(about ? 'greska-prijavljena' : 'kontakt-poslat', about ? { govor: about.ref } : undefined)
      return
    }
    const err = r ? ((await r.json().catch(() => ({}))) as { error?: string }).error : 'net'
    setState({
      error:
        err === 'rate_limited'
          ? 'Poslali ste već nekoliko poruka; pokušajte ponovo za sat vremena.'
          : err === 'email'
            ? 'Proverite mejl adresu za odgovor.'
            : 'Poruka nije poslata. Pokušajte ponovo malo kasnije.',
    })
  }

  return (
    <motion.div className="dossier-backdrop spk-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="news contact"
        role="dialog"
        aria-modal="true"
        aria-label={about ? 'Prijava greške' : 'Kontakt'}
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
          <div className="eyebrow">Skupština live</div>
          <h2>{about ? 'Prijavi grešku' : 'Kontakt'}</h2>
          {about && !about.label ? (
            <p>Nešto ne radi ili nije tačno? Napišite šta ste radili i šta se desilo; uz poruku ide samo adresa stranice.</p>
          ) : about ? (
            <p>
              Govor: <strong>{about.label}</strong>. Napišite šta nije tačno: govornik, vreme, reč u transkriptu, sažetak ili snimak.
            </p>
          ) : (
            <p>Primedba, ispravka, predlog ili saradnja: poruka stiže direktno uredništvu.</p>
          )}
          <p className="ct-mejl">
            Možete i mejlom: <a href={`mailto:${MEJL}`} onClick={() => track('kontakt-mejl')}>{MEJL}</a>
          </p>
        </header>
        {state === 'sent' ? (
          <p className="ct-ok">
            {about ? 'Hvala, prijava je poslata. Proverićemo govor i ispraviti grešku.' : 'Hvala, poruka je poslata.'} Ako ste ostavili mejl,
            odgovorićemo na njega.
          </p>
        ) : (
          <form className="ct-form" onSubmit={send}>
            <label>
              <span>Ime (nije obavezno)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" />
            </label>
            <label>
              <span>Vaš mejl, ako želite odgovor (nije obavezno)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" />
            </label>
            <label>
              <span>{about ? 'Šta nije tačno' : 'Poruka'}</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={4000}
                rows={6}
                required
                autoFocus={!!about}
                placeholder={about && !about.label ? 'Npr. na telefonu se snimak ne pušta posle klika na govor.' : about ? 'Npr. ne govori Petar Petrović nego Marko Marković.' : undefined}
              />
            </label>
            <label className="ct-trap" aria-hidden="true">
              Ne popunjavati
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            {typeof state === 'object' && <p className="ct-err">{state.error}</p>}
            <div className="ct-actions">
              <button type="submit" disabled={state === 'sending'}>
                {state === 'sending' ? 'Šaljem…' : about ? 'Pošalji prijavu' : 'Pošalji poruku'}
              </button>
              <span>Vaš mejl koristimo samo da bismo odgovorili.</span>
            </div>
          </form>
        )}
      </motion.div>
    </motion.div>
  )
}
