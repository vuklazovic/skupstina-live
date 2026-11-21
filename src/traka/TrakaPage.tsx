import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { NewsPanel, type NewsItem } from '../components/NewsPanel'
import { ContactPanel, type ReportAbout } from '../components/ContactPanel'
import type { ListInfo, Mp } from '../types'
import { Studio } from './Studio'
import type { Traka } from './types'
import App from '../App'
import { Landing } from './Landing'
import { Logo } from '../components/Logo'
import { LivePage } from '../live/LivePage'
import './traka.css'

type Day = { id: string; title: string; date: string; status: string }

const params = () => new URLSearchParams(window.location.search)

/** šta je otvoreno: početna (sala), traka jednog dana ili prenos uživo; čita se iz adrese */
type View = { kind: 'home' } | { kind: 'sala' } | { kind: 'day'; id: string } | { kind: 'live' }
const viewFromUrl = (): View => {
  const q = params()
  // prenos uživo ima svoju adresu (/uzivo); ?uzivo je stari oblik iz razvojne verzije
  if (window.location.pathname.replace(/\/+$/, '') === '/uzivo' || q.has('uzivo')) return { kind: 'live' }
  if (q.has('sala')) return { kind: 'sala' }
  const d = q.get('dan')
  // stari linkovi: ?dan=2 je drugi dan prve sednice
  return d ? { kind: 'day', id: /^\d+$/.test(d) ? `s15-01-d${d}` : d } : { kind: 'home' }
}

/**
 * Glavna verzija sajta (skupstina.live/, i stare adrese /dev i /traka): početna sa svim glasanjima, sala, svaki dan kao
 * montažna traka sa snimkom i tekstom, vesti iz medija i prenos uživo. Prethodna verzija je na /staro (main.tsx).
 */
export default function TrakaPage() {
  const [days, setDays] = useState<Day[]>([])
  const [view, setView] = useState<View>(viewFromUrl)

  useEffect(() => {
    fetch('/data/sessions.json')
      .then((r) => r.json())
      .then((all: Day[]) => setDays(all.filter((d) => d.status === 'ready' || d.status === 'ended')))
      .catch(() => {})
    const f = () => setView(viewFromUrl())
    window.addEventListener('popstate', f)
    return () => window.removeEventListener('popstate', f)
  }, [])

  // Sala čeka četiri fajla, od kojih je dan sednice najveći. Čim pokazivač ili prst krene ka dugmetu „Sala”,
  // fajlovi se traže unapred, pa ih sala posle klika čita iz keša pregledača.
  const warmed = useRef(false)
  const warmSala = useCallback(() => {
    if (warmed.current) return
    warmed.current = true
    const last = days[days.length - 1]
    for (const u of ['/data/mps.json', '/data/lists.json', last && last.status === 'ready' ? `/data/session-${last.id}.json` : '']) {
      if (u) fetch(u).catch(() => {})
    }
  }, [days])
  const warm = { onPointerEnter: warmSala, onTouchStart: warmSala, onFocus: warmSala }

  const go = useCallback((v: View, extra?: Record<string, string>) => {
    const u = new URL(window.location.href)
    u.search = ''
    // prenos je na /uzivo, sve ostalo na početnoj adresi (stare adrese /dev i /traka ostaju kakve jesu)
    const base = u.pathname.replace(/\/+$/, '')
    if (v.kind === 'live') u.pathname = '/uzivo'
    else if (base === '/uzivo') u.pathname = '/'
    if (v.kind === 'day') u.searchParams.set('dan', v.id)
    if (v.kind === 'sala') u.searchParams.set('sala', '')
    for (const [k, val] of Object.entries(extra ?? {})) u.searchParams.set(k, val)
    window.history.pushState(null, '', u)
    setView(v)
    window.scrollTo(0, 0)
  }, [])

  // sa početne: govor se otvara na traci svog dana
  const traka = useMemo(() => ({ openSpeech: (sid: string, turnId: number) => go({ kind: 'day', id: sid }, { govor: String(turnId) }) }), [go])

  // vesti iz medija o Skupštini (isti prozor kao u staroj verziji); poslanici i liste trebaju za lica i boje
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsOpen, setNewsOpen] = useState(() => params().has('vesti'))
  // kontakt i prijava greške (isti prozor kao u prethodnoj verziji); about bez label = greška na stranici
  const [contact, setContact] = useState<{ about?: ReportAbout } | null>(null)
  const [mps, setMps] = useState<Mp[]>([])
  const [lists, setLists] = useState<ListInfo[]>([])
  useEffect(() => {
    fetch('/data/vesti.json')
      .then((r) => (r.ok ? r.json() : []))
      .then(setNews)
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!newsOpen || mps.length) return
    Promise.all([fetch('/data/mps.json').then((r) => r.json()), fetch('/data/lists.json').then((r) => r.json())])
      .then(([m, l]: [Mp[], ListInfo[]]) => {
        setMps(m)
        setLists(l)
      })
      .catch(() => {})
  }, [newsOpen, mps.length])
  const mpById = useMemo(() => new Map(mps.map((m) => [m.id, m])), [mps])
  const closeNews = useCallback(() => setNewsOpen(false), [])

  const dayId = view.kind === 'day' ? view.id : null
  // na telefonu se meni strana lista vodoravno: otvorena strana (npr. „Uživo” na kraju) mora da bude na vidiku
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current
    const on = nav?.querySelector<HTMLElement>('button.on')
    if (!nav || !on || nav.scrollWidth <= nav.clientWidth) return
    const l = on.offsetLeft - nav.offsetLeft
    if (l < nav.scrollLeft + 12 || l + on.offsetWidth > nav.scrollLeft + nav.clientWidth - 24)
      nav.scrollTo({ left: l - (nav.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' })
  }, [view, days.length, newsOpen])
  return (
    <div className="tka-root">
      <header className="tka-top">
        <a className="tka-brand" href="/" onClick={(e) => (e.preventDefault(), go({ kind: 'home' }))}>
          <Logo />
        </a>
        <nav className="tka-days" aria-label="Strana" ref={navRef}>
          <button className={view.kind === 'home' ? 'on' : ''} onClick={() => go({ kind: 'home' })}>
            Početna
          </button>
          <button className={view.kind === 'sala' ? 'on' : ''} onClick={() => go({ kind: 'sala' })} {...warm}>
            Sala
          </button>
          {days.map((d, i) => (
            <button key={d.id} className={d.id === dayId ? 'on' : ''} onClick={() => go({ kind: 'day', id: d.id })} title={d.title}>
              Dan {i + 1}
              <span className="mono">{d.date.slice(8, 10)}.{d.date.slice(5, 7)}.</span>
            </button>
          ))}
          <button className={`tka-live-tab${view.kind === 'live' ? ' on' : ''}`} onClick={() => go({ kind: 'live' })}>
            <i aria-hidden />
            Uživo
          </button>
          {news.length > 0 && (
            <button className={newsOpen ? 'on' : ''} onClick={() => setNewsOpen(true)} title="Šta su mediji pisali o Skupštini">
              Vesti
              <span className="mono">{news.length}</span>
            </button>
          )}
        </nav>
        <span className="tka-links">
          <button
            className="tka-bug"
            onClick={() => setContact({ about: { ref: `stranica ${window.location.pathname}${window.location.search}` } })}
            title="Nešto ne radi ili nije tačno? Javite nam."
          >
            Prijavi grešku
          </button>
          <button className="tka-old" onClick={() => setContact({})}>
            Kontakt
          </button>
        </span>
        {view.kind === 'day' && (
          <span className="tka-help" title="Razmak: pusti/pauziraj · ←/→: 5 s · ↑/↓: govor · +/−: zum · Ctrl/⌘ + točkić: zum · f: ceo ekran · t: titl">
            <kbd>razmak</kbd> <kbd>←</kbd>
            <kbd>→</kbd> <kbd>↑</kbd>
            <kbd>↓</kbd> <kbd>+</kbd>
            <kbd>−</kbd>
          </span>
        )}
      </header>
      {view.kind === 'home' && (
        <Landing
          openDay={(id, extra) => go({ kind: 'day', id }, extra)}
          openSala={() => go({ kind: 'sala' })}
          warmSala={warmSala}
          openLive={() => go({ kind: 'live' })}
          openSpeech={traka.openSpeech}
        />
      )}
      {view.kind === 'sala' && (
        <div className="tka-sala">
          {/* ista pozadina kao na početnoj */}
          <div className="tka-bg home" aria-hidden>
            <div className="tka-bg-blob a" style={{ ['--c' as string]: '#8FC3E6' }} />
            <div className="tka-bg-blob b" style={{ ['--c' as string]: '#D9963F' }} />
            <div className="tka-bg-grain" />
          </div>
          <App traka={traka} />
        </div>
      )}
      {view.kind === 'live' && (
        <section className="tka-live live-area">
          <LivePage embedded />
        </section>
      )}
      <AnimatePresence>{contact && <ContactPanel about={contact.about} onClose={() => setContact(null)} />}</AnimatePresence>
      <AnimatePresence>
        {newsOpen && (
          <NewsPanel
            items={news}
            mpById={mpById}
            colorOf={(m) => lists.find((l) => l.key === m.list)?.color ?? '#9AA6A2'}
            onMp={() => {
              setNewsOpen(false)
              go({ kind: 'sala' })
            }}
            onOpenRef={(ref) => {
              setNewsOpen(false)
              traka.openSpeech(ref.session, ref.id)
            }}
            onClose={closeNews}
          />
        )}
      </AnimatePresence>
      {view.kind === 'day' && <DayView key={view.id} id={view.id} days={days} openDay={(id, extra) => go({ kind: 'day', id }, extra)} />}
    </div>
  )
}

/** traka jednog dana: učitaj podatke, pa studio */
function DayView({ id, days, openDay }: { id: string; days: Day[]; openDay: (id: string, extra?: Record<string, string>) => void }) {
  const [data, setData] = useState<Traka | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let off = false
    fetch(`/data/traka-${id}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Traka) => !off && setData(d))
      .catch(() => !off && setErr(true))
    return () => {
      off = true
    }
  }, [id])
  if (err) return <div className="tka-empty">Traka za ovaj dan još nije spremna.</div>
  if (!data) return <div className="tka-empty"><span className="tka-spin" /> Učitavam traku…</div>
  return <Studio data={data} days={days} openDay={openDay} />
}
