import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createPortal } from 'react-dom'
import type { ListInfo, Mp, Session, SessionMeta } from './types'
import { StatsPanel } from './components/StatsPanel'
import { buildTurns, type Turn } from './turns'
import { assignSeats, buildSeats } from './geometry'
import { Hemicycle } from './components/Hemicycle'
import { FLOOR_KEY, keyOf, utterances } from './components/Board'
import { Dossier } from './components/Dossier'
import type { SpeechRef } from './types'
import { Guide, GUIDE_KEY } from './components/Guide'
import { StoryIntro } from './components/StoryIntro'
import { useMuted } from './muted'
import { LivePage } from './live/LivePage'
import { Logo } from './components/Logo'
import { Sidebar } from './components/Sidebar'
import { SpeakerPanel, type SpeakerDay } from './components/SpeakerPanel'
import { SeatLabels, type SeatLabel } from './components/SeatLabels'
import { SeatFaces } from './components/SeatFaces'
import { useZoom } from './useZoom'
import { applyScript, savedScript, saveScript, type Script } from './script'
import { NewsPanel, type NewsItem } from './components/NewsPanel'
import { AboutPanel } from './components/AboutPanel'
import { ContactPanel, type ReportAbout } from './components/ContactPanel'
import { SpeechModal, type Origin } from './components/SpeechModal'
import { Theater } from './components/Theater'
import { Assistant } from './assistant/Assistant'
import { Portrait } from './components/Portrait'
import { track, trackView } from './analytics'
import { watchVersion } from './version'

watchVersion()

const CHAIR_COLOR = '#FFC56B'
// boje lista podešene za taman "noćni prenos" (podaci ostaju netaknuti)
const LIST_COLORS: Record<string, string> = {
  studenti: '#62B0FF',
  avus: '#F07B4F',
  svm: '#A6D98C',
  albanci: '#F58BB0',
  spp: '#B9A2FF',
  sda: '#5ED6DA',
  ljajic: '#F4D36E',
}
/** stara verzija sajta živi na /staro (glavna verzija je traka/TrakaPage); odatle se i vraća posle prenosa uživo */
const OLD_HOME = window.location.pathname.replace(/\/+$/, '') === '/staro'

/** id dana iz adrese: ?dan=2 (dan prve sednice, stari linkovi) ili ?dan=s15-02-d1 (bilo koja sednica); bez njega poslednji dan */
const FIRST_SITTING = 's15-01'
const dayFromUrl = () => {
  const d = new URLSearchParams(window.location.search).get('dan')
  if (!d) return null
  if (/^\d+$/.test(d)) return `${FIRST_SITTING}-d${d}`
  return /^s\d+-\d+-d\d+$/.test(d) ? d : null
}
const dayNo = (id: string) => id.match(/-d(\d+)$/)?.[1] ?? ''
/** sednica kojoj dan pripada („s15-01”) */
const sittingOf = (id: string) => id.replace(/-d\d+$/, '')
const dayParam = (id: string) => (sittingOf(id) === FIRST_SITTING ? dayNo(id) : id)
/** natpis dana: „Dan 3” dok su svi dani iz iste sednice; kad ih ima iz više sednica, datum („19. nov”) */
const dayLabel = (d: { id: string; date: string }, all: { id: string }[]) =>
  all.every((x) => sittingOf(x.id) === sittingOf(d.id))
    ? `Dan ${dayNo(d.id)}`
    : new Date(d.date).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short' }).replace(/\.$/, '')
/** koliko poslednjih dana stoji kao dugme; stariji idu u padajući spisak, da zaglavlje ne raste sa svakim danom */
const DAY_TABS = 3
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** JSON sa ponovnim pokušajima: kratak prekid veze ili deploy (server se vraća za par sekundi) ne sme da obori stranu */
async function getJson<T>(url: string, init?: RequestInit, tries = 4): Promise<T> {
  let err: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, init)
      if (!r.ok) throw new Error(`${url}: ${r.status}`)
      return (await r.json()) as T
    } catch (e) {
      err = e
      if (i < tries - 1) await sleep(700 * 2 ** i)
    }
  }
  throw err
}
/** dan u toku se čita iz data/live/ (server ga dopunjuje bez novog deploya), objavljeni dani iz data/ */
const isLiveDay = (d?: SessionMeta) => d?.status === 'live' || d?.status === 'ended'
const sessionUrl = (d: SessionMeta) => (isLiveDay(d) ? `data/live/session-${d.id}.json` : `data/session-${d.id}.json`)
const LIVE_POLL_MS = 30_000
/** „10.42” danas, inače „18. nov. u 21.03” */
const fmtUpdated = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hm = d.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? `u ${hm}` : `${d.toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'short' })} u ${hm}`
}
/** spisak dana uživo; nema ga kada ništa nije u toku (404) */
const fetchLive = (): Promise<SessionMeta[]> =>
  fetch('data/live/live.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { days: [] }))
    .then((x: { days?: SessionMeta[] }) => x.days ?? [])
    .catch(() => [])

/** posetilac je stigao sa Google pretrage (sajt ili Google aplikacija na Androidu) */
const fromGoogle = () => {
  try {
    return /^(https?:\/\/([a-z0-9-]+\.)*google\.[a-z.]+|android-app:\/\/com\.google\.android\.googlequicksearchbox)(\/|$)/i.test(document.referrer)
  } catch {
    return false
  }
}

/** traka: App kao početna strana stranice /traka — govor se ne otvara u prozoru, nego na traci tog dana */
type AppProps = { traka?: { openSpeech: (sessionId: string, turnId: number) => void } }

export default function App({ traka }: AppProps = {}) {
  const [mps, setMps] = useState<Mp[] | null>(null)
  const [lists, setLists] = useState<ListInfo[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [days, setDays] = useState<SessionMeta[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  // prenos je u toku (live.json ima dan sa statusom „live”), i pre prvog gotovog govora: dugme „Uživo” u zaglavlju
  const [liveNow, setLiveNow] = useState(false)
  // svi dani (za uvod, koji prikazuje zbir); učitavaju se uz izabrani dan
  const [allSessions, setAllSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reduce = useReducedMotion()
  // Lica i imena se mere prema sedištima, pa se crtaju tek kad se ulazna animacija sale zaista završi (0 = sala
  // još ulazi). Inače se pojave na pogrešnom mestu i skaču dok se sala spušta, a u pozadinskom tabu tu i ostanu.
  const [hallSettled, setHallSettled] = useState(0)
  const screen = 'hall' as 'story' | 'hall'
  // priča sa statistikom preko sale pri svakom ulasku (sala se učitava ispod)
  // /uzivo: prenos uživo u istom sistemu (zaglavlje sa danima ostaje); priča sa statistikom se tada preskače
  const isLivePath = () => window.location.pathname.replace(/\/+$/, '') === '/uzivo'
  const [liveOpen, setLiveOpenState] = useState(isLivePath)
  // bez uvodne priče: sajt se otvara pravo na salu
  const [story, setStory] = useState(false)
  const [current, setCurrent] = useState<{ id: number; origin: Origin; autoplay: boolean } | null>(null)
  // snimak preko celog ekrana; pos pamti gde je stao snimak, da prozor i ceo ekran nastave jedan od drugog
  const [theater, setTheater] = useState(false)
  const pos = useRef<{ id: number; t: number; playing: boolean } | null>(null)
  const [dossier, setDossier] = useState<string | null>(null)
  const [hlList, setHlList] = useState<string | null>(null)
  // „Tvoj poslanik”: istaknuti poslanici iz izabranog mesta
  const [cityHl, setCityHl] = useState<{ city: string; ids: Set<string> } | null>(null)
  const [rezimei, setRezimei] = useState<Record<string, string>>({})
  // pismo: latinica (podrazumevano) ili ćirilica za ceo sajt
  const [script, setScript] = useState<Script>(savedScript)
  useEffect(() => applyScript(script), [script])
  const toggleScript = () =>
    setScript((s) => {
      const n: Script = s === 'lat' ? 'cyr' : 'lat'
      saveScript(n)
      track('pismo', { pismo: n })
      return n
    })
  // natpis na dugmetu je uvek u pismu na koje se prelazi
  // vesti iz medija o Skupštini (data/vesti.json), otvaraju se preko celog ekrana
  const [news, setNews] = useState<NewsItem[]>([])
  const [newsOpen, setNewsOpen] = useState(false)

  const [aboutOpen, setAboutOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  // statistika i prenos sklanjaju salu; kad se vrati, ulazi iznova
  useEffect(() => {
    if (statsOpen || liveOpen) setHallSettled(0)
  }, [statsOpen, liveOpen])
  const hallIn = hallSettled > 0 || !!reduce
  const setLiveOpen = useCallback((on: boolean) => {
    setLiveOpenState(on)
    const url = new URL(window.location.href)
    // izlazak iz prenosa: stara verzija se vraća na /staro; ko je došao pravo na /uzivo ide na glavnu (novu) verziju
    if (!on && !OLD_HOME && !traka) return window.location.assign('/')
    const path = on ? '/uzivo' : OLD_HOME ? '/staro' : '/'
    if (url.pathname !== path) {
      url.pathname = path
      window.history.pushState(null, '', url)
    }
  }, [traka])
  useEffect(() => {
    const f = () => setLiveOpenState(isLivePath())
    window.addEventListener('popstate', f)
    return () => window.removeEventListener('popstate', f)
  }, [])
  // kontakt: forma postoji samo kad server može da pošalje poruku
  const [contactOn, setContactOn] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  // prijava greške u jednom govoru (ista forma, uz poruku ide i koji je govor)
  const [reportAbout, setReportAbout] = useState<ReportAbout | undefined>()
  useEffect(() => {
    fetch('/api/kontakt')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d: { enabled?: boolean }) => setContactOn(!!d.enabled))
      .catch(() => {})
  }, [])
  const openContact = () => {
    setAboutOpen(false)
    setReportAbout(undefined)
    setContactOpen(true)
    trackView('/kontakt', 'Kontakt')
  }
  useEffect(() => {
    fetch('data/vesti.json')
      .then((r) => (r.ok ? r.json() : []))
      .then(setNews)
      .catch(() => {})
  }, [])
  const openNews = () => {
    setNewsOpen(true)
    trackView('/vesti', 'Vesti')
  }
  // lica poslanika iznad sedišta (probno; pamti se izbor)
  const [faces, setFaces] = useState(() => {
    try {
      return localStorage.getItem('skupstina-lica') !== '0'
    } catch {
      return true
    }
  })
  const toggleFaces = () =>
    setFaces((f) => {
      try {
        localStorage.setItem('skupstina-lica', f ? '0' : '1')
      } catch {
        /* bez pamćenja */
      }
      track('lica', { ukljuceno: !f })
      return !f
    })
  useEffect(() => {
    fetch('data/govornici.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then(setRezimei)
      .catch(() => {})
  }, [])
  // govor koji treba otvoriti kad se učita njegov dan (iz uvoda)
  const [pendingOpen, setPendingOpen] = useState<{ ref: SpeechRef; source: string } | null>(null)
  // govor iz adrese (?govor=57), pročitan pre nego što se adresa prvi put promeni
  const linkedSpeech = useRef<number | null>(
    (() => {
      const g = new URLSearchParams(window.location.search).get('govor')
      return g && /^\d+$/.test(g) ? Number(g) : null
    })(),
  )
  const [guide, setGuide] = useState(false)
  const [asstOpen, setAsstOpen] = useState(false)
  // panel govornika (svi govori oba dana) i red puštanja: „Pusti sve” ide kroz govore samo tog govornika
  const [panelKey, setPanelKey] = useState<string | null>(null)
  const [queueKey, setQueueKey] = useState<string | null>(null)
  // raspored sa levom kolonom ostaje dok se fioka ne zatvori do kraja, da se stranica ne izmeša tokom animacije
  const [asstLayout, setAsstLayout] = useState(false)
  const stageRef = useRef<HTMLElement>(null)
  const { zoom, zoomed, zoomBy, reset: resetZoom, layerRef } = useZoom(stageRef)
  // uputstvo za zum dok posetilac prvi put ne zumira (pamti se)
  const [zoomTip, setZoomTip] = useState(() => {
    try {
      return localStorage.getItem('skupstina-zum') !== '1'
    } catch {
      return true
    }
  })
  useEffect(() => {
    if (zoomed && zoomTip) {
      setZoomTip(false)
      track('zum-prvi')
      try {
        localStorage.setItem('skupstina-zum', '1')
      } catch {
        /* bez pamćenja */
      }
    }
  }, [zoomed, zoomTip])
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)')
    const on = () => setMobile(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // na telefonu, dok je otvoren govor ili asistent, stranica ispod se ne pomera
  const overlayOpen = mobile && (current !== null || asstOpen || panelKey !== null || newsOpen || aboutOpen || contactOpen)
  useEffect(() => {
    document.body.style.overflow = overlayOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [overlayOpen])

  useEffect(() => {
    let stop = false
    const load = async () => {
      // dok ne uspe: posetilac vidi poruku, a strana se sama učita čim veza ili server prorade
      for (let attempt = 0; !stop; attempt++) {
        try {
          const [m, l, d, lv] = await Promise.all([
            getJson<Mp[]>('data/mps.json'),
            getJson<ListInfo[]>('data/lists.json'),
            getJson<SessionMeta[]>('data/sessions.json', { cache: 'no-cache' }),
            fetchLive(),
          ])
          if (stop) return
          setError(null)
          setMps(m)
          // u novoj verziji (sala unutar TrakaPage) boje lista su iste kao na traci i u glasanjima
          setLists(traka ? l : l.map((x) => ({ ...x, color: LIST_COLORS[x.key] ?? x.color })))
          // objavljen dan ima prednost nad istim danom uživo (kada stenogram stigne, live fajlovi se ignorišu)
          const pub = d.filter((x) => x.status === 'ready')
          // dan uživo se pojavljuje kada ima prvi gotov govor
          const ready = [...pub, ...lv.filter((x) => isLiveDay(x) && (x.speeches ?? 1) > 0 && !pub.some((p) => p.id === x.id))].sort((x, y) => x.date.localeCompare(y.date))
          setDays(ready)
          setLiveNow(lv.some((x) => x.status === 'live'))
          // dolazak sa Google pretrage na naslovnu dok je sednica u toku: odmah prenos uživo (/uzivo)
          if (fromGoogle() && window.location.pathname.replace(/\/+$/, '') === '' && !dayFromUrl() && ready.some((x) => x.status === 'live')) {
            const url = new URL(window.location.href)
            url.pathname = '/uzivo'
            window.history.replaceState(null, '', url)
            setLiveOpenState(true)
            setStory(false)
            track('uzivo-otvoreno', { izvor: 'google' })
          }
          const want = dayFromUrl()
          const sid = ready.find((x) => x.id === want)?.id ?? ready[ready.length - 1]?.id ?? null
          setSessionId(sid)
          // link na jedan govor (?dan=3&govor=57): otvara se čim se dan učita
          if (sid && linkedSpeech.current != null) setPendingOpen({ ref: { session: sid, id: linkedSpeech.current }, source: 'link' })
          // svi dani (statistika, panel govornika): dan koji se ne učita se preskače, ostali ostaju
          void Promise.allSettled(ready.map((x) => getJson<Session>(sessionUrl(x), isLiveDay(x) ? { cache: 'no-cache' } : undefined))).then((rs) => {
            if (!stop) setAllSessions(rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])))
          })
          return
        } catch {
          if (stop) return
          setError('Sajt se trenutno ne učitava (slaba veza ili kratko održavanje). Pokušavam ponovo…')
          await sleep(Math.min(8000, 2500 + attempt * 1500))
        }
      }
    }
    void load()
    return () => {
      stop = true
    }
  }, [])
  const daysRef = useRef(days)
  daysRef.current = days
  // otvorena strana sama sazna da je sednica počela (ili da je stigao novi dan): na minut, bez osvežavanja strane
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return
      const lv = await fetchLive()
      setLiveNow(lv.some((x) => x.status === 'live'))
      const fresh = lv.filter((x) => isLiveDay(x) && (x.speeches ?? 1) > 0 && !daysRef.current.some((d) => d.id === x.id))
      if (fresh.length) setDays((ds) => [...ds, ...fresh.filter((x) => !ds.some((d) => d.id === x.id))].sort((a, b) => a.date.localeCompare(b.date)))
      for (const x of fresh) {
        getJson<Session>(sessionUrl(x), { cache: 'no-cache' }, 2)
          .then((ns) => setAllSessions((all) => (all && !all.some((a) => a.id === ns.id) ? [...all, ns] : all)))
          .catch(() => {})
      }
    }
    const t = setInterval(tick, 60_000)
    const vis = () => void (!document.hidden && tick())
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  const dayMeta = days.find((x) => x.id === sessionId)
  const dayIsLive = dayMeta?.status === 'live'
  useEffect(() => {
    if (!sessionId || !dayMeta) return
    let live = true
    getJson<Session>(sessionUrl(dayMeta), isLiveDay(dayMeta) ? { cache: 'no-cache' } : undefined, 6)
      .then((s) => {
        if (!live) return
        setError(null)
        setSession(s)
      })
      .catch(() => live && setError('Podaci ovog dana se trenutno ne učitavaju. Proveri vezu pa osveži stranicu.'))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, dayMeta?.status])
  // dan u toku: na 30 s proveri ima li novih govora; nova verzija zamenjuje staru bez osvežavanja stranice
  useEffect(() => {
    if (!dayIsLive || !sessionId) return
    let stop = false
    const tick = async () => {
      if (document.hidden) return
      const lv = await fetchLive()
      const me = lv.find((x) => x.id === sessionId)
      if (stop || !me) return
      setDays((ds) => ds.map((x) => (x.id === me.id ? { ...x, ...me } : x)))
      try {
        const s: Session = await fetch(`data/live/session-${sessionId}.json`, { cache: 'no-cache' }).then((r) => r.json())
        if (stop) return
        setSession((old) => (old && old.id === s.id && old.live?.updated === s.live?.updated ? old : s))
        setAllSessions((all) => all && all.map((x) => (x.id === s.id ? s : x)))
      } catch {
        /* sledeći pokušaj za 30 s */
      }
    }
    const t = setInterval(tick, LIVE_POLL_MS)
    const vis = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', vis)
    return () => {
      stop = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [dayIsLive, sessionId])
  /** prelazak na drugi dan: zatvori sve otvoreno i upiši dan u adresu (da se link može podeliti) */
  const switchDay = useCallback((id: string) => {
    setCurrent(null)
    setDossier(null)
    setSessionId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('dan', dayParam(id))
    window.history.replaceState(null, '', url)
    track('dan-promenjen', { dan: dayParam(id) })
  }, [])

  // sajt se otvara pravo na salu; uputstvo samo pri prvom ulasku (localStorage može biti nedostupan).
  // Ulazak u salu je Umamijev automatski pregled „/”; ovde se ne beleži još jedan.
  useEffect(() => {
    if (story) return
    let seen = false
    try {
      seen = localStorage.getItem(GUIDE_KEY) === '1'
    } catch {
      /* bez pamćenja */
    }
    // na telefonu nema uputstva sa označavanjem delova ekrana (delovi su jedan ispod drugog)
    if (!seen && window.innerWidth > 760) setTimeout(() => setGuide(true), 1600)
  }, [story])
  const closeGuide = useCallback(() => {
    setGuide(false)
    try {
      localStorage.setItem(GUIDE_KEY, '1')
    } catch {
      /* bez pamćenja */
    }
  }, [])

  const mpById = useMemo(() => new Map((mps ?? []).map((m) => [m.id, m])), [mps])
  // pretraga poslanika po imenu i prezimenu (bez obzira na kvačice i redosled reči)
  const [query, setQuery] = useState('')
  const found = useMemo(() => {
    const fold = (t: string) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'dj').toLowerCase()
    const words = fold(query).split(/\s+/).filter(Boolean)
    if (!words.length || !mps) return null
    const hits = mps.filter((m) => {
      const n = fold(m.name).split(/[\s-]+/)
      return words.every((w) => n.some((p) => p.startsWith(w)))
    })
    return { ids: new Set(hits.map((m) => m.id)), list: hits }
  }, [query, mps])
  const listByKey = useMemo(() => new Map(lists.map((l) => [l.key, l])), [lists])
  const speakerByKey = useMemo(() => new Map((session?.speakers ?? []).map((s) => [s.key, s])), [session])
  const seats = useMemo(() => (mps && lists.length ? assignSeats(buildSeats(mps.length), mps, lists) : []), [mps, lists])
  const all = useMemo(() => (session ? utterances(session) : []), [session])
  // nastupi: uzastopni govori istog govornika spojeni u jedan
  const speeches = useMemo(() => (session ? buildTurns(session) : []), [session])

  const listOf = useCallback((mp?: Mp) => (mp ? listByKey.get(mp.list) : undefined), [listByKey])
  const nameOf = useCallback((key: string) => (key === FLOOR_KEY ? 'Iz sale' : speakerByKey.get(key)?.name ?? key), [speakerByKey])

  // redosled govornika: predsedavajući prvi, pa ostali po prvom javljanju; svako dobija svoju boju
  const order = useMemo(() => {
    const o: string[] = []
    all.forEach((u) => {
      const k = keyOf(u)
      if (!o.includes(k)) o.push(k)
    })
    const rank = (k: string) => (speakerByKey.get(k)?.role ? -1 : k === FLOOR_KEY ? 1 : 0)
    return [...o].sort((a, b) => rank(a) - rank(b) || o.indexOf(a) - o.indexOf(b))
  }, [all, speakerByKey])
  // boja govornika = boja njegove liste (stranke); predsedavajući zlatno, ostalo sivo
  const partyColor = useCallback(
    (sp?: Session['speakers'][number]) => {
      if (!sp) return '#8E98AB'
      if (sp.role) return CHAIR_COLOR
      const mp = sp.mp_id ? mpById.get(sp.mp_id) : undefined
      return listOf(mp)?.color ?? '#8E98AB'
    },
    [mpById, listOf],
  )
  const speakerColor = useMemo(() => {
    const m = new Map<string, string>()
    order.forEach((k) => m.set(k, k === FLOOR_KEY ? '#8E98AB' : partyColor(speakerByKey.get(k))))
    return m
  }, [order, speakerByKey, partyColor])
  const colorOf = useCallback((key: string) => speakerColor.get(key) ?? '#888', [speakerColor])

  const lanes = useMemo(
    () =>
      order.map((k) => {
        const sp = speakerByKey.get(k)
        const mp = sp?.mp_id ? mpById.get(sp.mp_id) : undefined
        return { key: k, name: nameOf(k), sub: k === FLOOR_KEY ? 'bez imena' : sp?.role ?? listOf(mp)?.name ?? '', color: colorOf(k), mp }
      }),
    [order, speakerByKey, mpById, nameOf, listOf, colorOf],
  )
  // govornici svih dana (za uvod): ime, poslanik i boja, istim pravilom kao u sali
  const storyLanes = useMemo(() => {
    const src = allSessions?.length ? allSessions : session ? [session] : []
    const sp = new Map<string, Session['speakers'][number]>()
    src.forEach((x) => x.speakers.forEach((k) => sp.has(k.key) || sp.set(k.key, k)))
    return [...sp.values()].map((k) => {
      const mp = k.mp_id ? mpById.get(k.mp_id) : undefined
      return { key: k.key, name: k.name, sub: k.role ?? listOf(mp)?.name ?? '', color: partyColor(k), mp }
    })
  }, [allSessions, session, mpById, listOf, partyColor])
  // govornici za desnu traku, po izmerenom trajanju
  const speakerRows = useMemo(
    () =>
      lanes
        .filter((l) => l.key !== FLOOR_KEY && speeches.some((e) => e.speaker === l.key))
        .map((l) => ({ ...l, min: speeches.filter((e) => e.speaker === l.key).reduce((a, e) => a + (e.vdur != null ? e.vdur / 60 : e.dur), 0) }))
        .sort((a, b) => b.min - a.min),
    [lanes, speeches],
  )

  const idx = current ? speeches.findIndex((e) => e.id === current.id) : -1
  const speech = idx >= 0 ? speeches[idx] : undefined
  const curSpeaker = speech ? speakerByKey.get(speech.speaker) : undefined
  const chairActive = !!curSpeaker?.role
  const activeMpId = curSpeaker && !curSpeaker.role ? curSpeaker.mp_id : null
  const spokenIds = useMemo(() => new Set(session?.speakers.filter((s) => !s.role && s.mp_id).map((s) => s.mp_id!) ?? []), [session])

  /** Pomeraj sedišta govornika od centra prozora govora (za animaciju iz sedišta). */
  const originOf = useCallback(
    (e: Turn): Origin => {
      const sp = speakerByKey.get(e.speaker)
      const el = sp?.role ? document.querySelector('[data-chair]') : sp?.mp_id ? document.querySelector(`[data-mp="${sp.mp_id}"]`) : null
      const stage = stageRef.current?.getBoundingClientRect()
      if (!el || !stage) return { dx: 0, dy: 200 }
      const r = el.getBoundingClientRect()
      return { dx: r.left + r.width / 2 - (stage.left + stage.width / 2), dy: r.top + r.height / 2 - (stage.top + stage.height / 2) }
    },
    [speakerByKey],
  )
  /** izvor: odakle je govor otvoren (za analitiku): sediste, tok, govornici, pocetak, sledeci, prethodni, asistent, dosije */
  const open = useCallback(
    (e: Turn, source = 'tok', autoplay = true) => {
      if (traka && session) {
        track('govor-otvoren', { govornik: nameOf(e.speaker), vreme: e.clock, izvor: `traka-${source}` })
        traka.openSpeech(session.id, e.id)
        return
      }
      setCurrent({ id: e.id, origin: originOf(e), autoplay })
      const name = nameOf(e.speaker)
      trackView(`/govor/${e.id}`, `${name} · ${e.clock}`)
      track('govor-otvoren', { govornik: name, vreme: e.clock, izvor: source })
    },
    [originOf, nameOf, traka, session],
  )
  // govor iz uvoda: kad je njegov dan učitan, otvori nastup koji ga sadrži
  useEffect(() => {
    if (!pendingOpen || !session || session.id !== pendingOpen.ref.session || screen !== 'hall') return
    const t = speeches.find((x) => x.parts.some((p) => p.id === pendingOpen.ref.id))
    setPendingOpen(null)
    if (t) setTimeout(() => open(t, pendingOpen.source), 400) // posle ulaska u salu, da sedište postoji
  }, [pendingOpen, session, speeches, screen, open])

  // u redu „Pusti sve” sledeći/prethodni su govori istog govornika
  // utišani poslanici (strana /uzivo): sledeći/prethodni ih preskaču, osim govora koji je sada otvoren
  const [muted] = useMuted()
  const nav = useMemo(() => {
    const base = queueKey ? speeches.filter((e) => e.speaker === queueKey) : speeches
    if (!muted.size) return base
    return base.filter((e) => {
      const id = speakerByKey.get(e.speaker)?.mp_id
      return !id || !muted.has(id) || e.id === current?.id
    })
  }, [queueKey, speeches, muted, speakerByKey, current?.id])
  const navIdx = current ? nav.findIndex((e) => e.id === current.id) : -1
  const theaterRef = useRef(theater)
  theaterRef.current = theater
  const enterTheater = useCallback(() => {
    setTheater(true)
    track('ceo-ekran')
    // ceo ekran traži se odmah iz klika; sloj je position:fixed, pa radi i gde pregledač ne dozvoljava (iPhone)
    const d = document.documentElement
    d.requestFullscreen?.({ navigationUI: 'hide' }).then(
      () => (window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation?.lock?.('landscape').catch(() => {}),
      () => {},
    )
  }, [])
  const exitTheater = useCallback(() => {
    setTheater(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])
  useEffect(() => {
    const f = () => {
      if (!document.fullscreenElement && theaterRef.current) setTheater(false)
    }
    document.addEventListener('fullscreenchange', f)
    return () => document.removeEventListener('fullscreenchange', f)
  }, [])
  // zatvoren govor = nema više celog ekrana
  useEffect(() => {
    if (!current && theaterRef.current) exitTheater()
  }, [current, exitTheater])
  // otvoren govor je u adresi (?govor=57), pa se link na njega može podeliti; zatvaranjem nestaje
  const hadSpeech = useRef(false)
  useEffect(() => {
    if (!current && !hadSpeech.current) return
    hadSpeech.current = true
    const url = new URL(window.location.href)
    if (current) {
      url.searchParams.set('govor', String(current.id))
      if (sessionId && !url.searchParams.get('dan')) url.searchParams.set('dan', dayParam(sessionId))
    } else url.searchParams.delete('govor')
    if (url.href !== window.location.href) window.history.replaceState(null, '', url)
  }, [current, sessionId])
  const report = useCallback((t: number, playing: boolean) => {
    if (current) pos.current = { id: current.id, t, playing }
  }, [current])

  const go = useCallback(
    (dir: 1 | -1, source?: string) => {
      const n = nav[(navIdx < 0 ? (dir === 1 ? -1 : nav.length) : navIdx) + dir]
      if (n) open(n, source ?? (queueKey ? 'red-govornika' : dir === 1 ? 'sledeci' : 'prethodni'))
    },
    [nav, navIdx, open, queueKey],
  )

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input,textarea') || dossier || guide || contactOpen || screen !== 'hall') return
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'Escape') {
        if (theaterRef.current) exitTheater()
        else setCurrent(null)
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [go, dossier, guide, contactOpen, screen, exitTheater])

  if (error && (!session || !mps))
    return (
      <div className="fatal" role="alert">
        <div>
          <p>{error}</p>
          <button className="fatal-btn" onClick={() => window.location.reload()}>Osveži stranicu</button>
        </div>
      </div>
    )
  // uvod: priča sa statistikom; isti položaj u oba prikaza, pa se ne pokreće iznova kad sala stigne
  const intro = story && <StoryIntro onDone={() => setStory(false)} />
  if (!session || !mps || session.id !== sessionId) return <>{intro}<div className="fatal">Učitavam salu…</div></>

  // zaglavlje: poslednjih DAY_TABS dana kao dugmad, stariji u padajućem spisku
  const tabDays = days.length > DAY_TABS + 1 ? days.slice(-DAY_TABS) : days
  const olderDays = days.length > DAY_TABS + 1 ? days.slice(0, -DAY_TABS) : []
  const pickDay = (id: string) => {
    setStatsOpen(false)
    setLiveOpen(false)
    if (id === session.id) return
    setQueueKey(null)
    switchDay(id)
  }
  const chair = session.speakers.find((s) => s.role)
  const dossierMp = dossier ? mpById.get(dossier) : undefined
  const dossierSpeaker = dossierMp ? session.speakers.find((s) => s.mp_id === dossierMp.id) : undefined
  // tačka dnevnog reda u trenutku govora (agendaMarks: od kog minuta dana počinje koja tačka)
  const marks = session.agendaMarks?.length ? session.agendaMarks : [{ t: 0, item: (session.progress?.agendaItem ?? 1) - 1 }]
  // otvoren govor: tačka u tom trenutku; inače tačka do koje je dan stigao (progress), a ne ona kojom je počeo
  const agendaIdx = speech
    ? [...marks].reverse().find((m) => speech.t >= m.t)?.item ?? marks[0].item
    : Math.min(session.agenda.length, session.progress?.agendaItem ?? marks[marks.length - 1].item + 1) - 1
  const [titleMain, titleDay] = session.title.split(' · ')
  const spMine = speech ? speeches.filter((e) => e.speaker === speech.speaker) : []
  const curMp = curSpeaker?.mp_id ? mpById.get(curSpeaker.mp_id) : undefined

  // minuti po poslaniku ovog dana (bez predsedavajućeg, on sedi u predsedništvu): veličina sedišta
  const talk = new Map<string, number>()
  speakerRows.forEach((r) => {
    const sp = speakerByKey.get(r.key)
    if (sp?.mp_id && !sp.role) talk.set(sp.mp_id, (talk.get(sp.mp_id) ?? 0) + r.min)
  })
  // imena iznad sedišta: najduži govornici dana (predsedavajući iznad predsedništva)
  const seatLabels: SeatLabel[] = speakerRows.slice(0, mobile ? 6 : 10).map((r) => {
    const sp = speakerByKey.get(r.key)
    return { key: r.key, mpId: sp?.mp_id ?? null, chair: !!sp?.role, name: r.name.split(' ').slice(-1)[0], minutes: r.min, color: r.color }
  })
  // panel govornika: njegovi nastupi u svakom danu
  const panel = (() => {
    if (!panelKey) return null
    const src = allSessions?.length ? allSessions : [session]
    // „mp:<id>”: poslanik koji nije govorio (samo službeni podaci)
    const onlyMp = panelKey.startsWith('mp:') ? mpById.get(panelKey.slice(3)) : undefined
    const lane = onlyMp
      ? { key: panelKey, name: onlyMp.name, sub: listOf(onlyMp)?.name ?? '', color: listOf(onlyMp)?.color ?? '#9AA6A2', mp: onlyMp }
      : storyLanes.find((l) => l.key === panelKey) ?? lanes.find((l) => l.key === panelKey)
    const days: SpeakerDay[] = src.map((x) => ({
      sessionId: x.id,
      date: x.date,
      label: `${dayLabel(x, src)} · ${new Date(x.date).toLocaleDateString('sr-Latn-RS', { weekday: 'short', day: 'numeric', month: 'short' })}`,
      turns: (x.id === session.id ? speeches : buildTurns(x)).filter((t) => t.speaker === panelKey),
    }))
    return { lane, days, auto: new Set(src.filter((x) => x.auto).map((x) => x.id)) }
  })()

  // ko je govorio (bilo kog dana): panel sa svim govorima; ostali: dosije
  const seatClick = (id: string) => {
    const sp = (allSessions ?? [session]).flatMap((x) => x.speakers).find((s) => s.mp_id === id && !s.role)
    if (sp) {
      setPanelKey(sp.key)
      track('govornik-otvoren', { govornik: sp.name, izvor: 'sediste' })
    } else setPanelKey(`mp:${id}`)
  }
  const listIds = hlList ? new Set(mps.filter((m) => m.list === hlList).map((m) => m.id)) : null
  // poznata lica (vide se i bez zuma): vođe i zamenici grupa, raniji mandat, lista nosi njihovo ime,
  // jedini/prvi sa male liste, biografija na Wikipediji. Tako je svaka lista predstavljena.
  const seatsOf = new Map(lists.map((l) => [l.key, l.seats]))
  const notable = new Set(
    mps
      .filter((m) => {
        const surname = m.name.split(' ').slice(-1)[0]
        return (
          !!m.bio ||
          !!m.prior ||
          /\(predsednik|\(zamenik/.test(m.group ?? '') ||
          (surname.length > 3 && m.listFull.includes(surname)) ||
          (seatsOf.get(m.list) ?? 99) <= 2
        )
      })
      .map((m) => m.id),
  )
  const chairSp = session.speakers.find((s) => s.role)
  const chairFace = chairSp?.mp_id ? { mpId: chairSp.mp_id, minutes: speakerRows.find((r) => r.key === chairSp.key)?.min ?? 0 } : null

  const speechLayer = (
    <>
    <AnimatePresence mode="wait">
      {speech && current && (
        <SpeechModal
          key={speech.id}
          session={session}
          speech={speech}
          origin={current.origin}
          index={idx}
          total={speeches.length}
          prev={nav[navIdx - 1]}
          next={nav[navIdx + 1]}
          speaker={curSpeaker}
          mp={curMp}
          list={listOf(curMp)}
          color={colorOf(speech.speaker)}
          nameOf={nameOf}
          colorOf={colorOf}
          speakerStats={{
            nth: spMine.findIndex((e) => e.id === speech.id) + 1,
            count: spMine.length,
            min: spMine.reduce((a, e) => a + (e.vdur != null ? e.vdur / 60 : e.dur), 0),
            words: spMine.reduce((a, e) => a + e.words, 0),
          }}
          autoplay={current.autoplay}
          theater={theater}
          onTheater={enterTheater}
          resume={pos.current?.id === speech.id ? pos.current : undefined}
          report={report}
          onReportError={
            contactOn
              ? () => {
                  setReportAbout({ ref: `${session.id} #${speech.id}`, label: `${nameOf(speech.speaker)}, ${session.date.split('-').reverse().map(Number).join('. ')}. u ${speech.clock}` })
                  setContactOpen(true)
                  trackView('/prijava-greske', 'Prijava greške')
                }
              : undefined
          }
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          onClose={() => {
            setCurrent(null)
            setQueueKey(null)
          }}
          onOpenMp={(id) => {
            setCurrent(null)
            setQueueKey(null)
            seatClick(id)
          }}
        />
      )}
    </AnimatePresence>
    {theater && speech && current && (
      <Theater
        speech={speech}
        name={nameOf(speech.speaker)}
        color={colorOf(speech.speaker)}
        index={navIdx}
        total={nav.length}
        prev={nav[navIdx - 1]}
        next={nav[navIdx + 1]}
        nameOf={nameOf}
        colorOf={colorOf}
        from={pos.current?.id === speech.id ? pos.current.t : undefined}
        report={report}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onExit={exitTheater}
      />
    )}
    </>
  )

  return (
    <>{intro}
    <div className={`app hall2 ${traka ? 'traka-home' : ''} ${asstOpen || asstLayout ? 'asst-open' : ''} ${statsOpen ? 'stats-view' : ''} ${liveOpen ? 'live-view' : ''}`}>
      {!liveOpen && !traka && <Assistant
        open={asstOpen}
        onToggle={() => {
          if (!asstOpen) setAsstLayout(true)
          setAsstOpen((o) => !o)
        }}
        onClosed={() => setAsstLayout(false)}
        sessionId={session.id}
        suggested={session.suggested}
        turnById={(id) => speeches.find((t) => t.parts.some((x) => x.id === id))}
        nameOf={nameOf}
        colorOf={colorOf}
        onOpenTurn={(t) => {
          // na telefonu je asistent preko celog ekrana, pa se skloni da se govor vidi
          if (mobile) setAsstOpen(false)
          open(t, 'asistent')
        }}
      />}
      <header className="top">
        <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Skupština live">
          <Logo />
        </button>
        <div className="session-title">
          <div className="eyebrow">
            15. saziv · {new Date(session.date).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <h1>
            {titleMain}
            {titleDay && <span className="title-day"> — {titleDay}</span>}
          </h1>
        </div>
        <div className="day-col">
        <div className="day-switch" role="tablist" aria-label="Dan sednice">
          {olderDays.length > 0 && (
            <select
              className={`day-older ${olderDays.some((d) => d.id === session.id) && !statsOpen && !liveOpen ? 'on' : ''}`}
              aria-label="Raniji dani"
              value={olderDays.some((d) => d.id === session.id) && !statsOpen && !liveOpen ? session.id : ''}
              onChange={(e) => e.target.value && pickDay(e.target.value)}
            >
              <option value="">Raniji dani</option>
              {olderDays.map((d) => (
                <option key={d.id} value={d.id}>
                  {dayLabel(d, days)} · {new Date(d.date).toLocaleDateString('sr-Latn-RS', { weekday: 'short', day: 'numeric', month: 'short' })}
                </option>
              ))}
            </select>
          )}
          {tabDays.map((d) => (
            <button key={d.id} role="tab" aria-selected={d.id === session.id && !statsOpen && !liveOpen} className={d.id === session.id && !statsOpen && !liveOpen ? 'on' : ''} title={d.title} onClick={() => pickDay(d.id)}>
              {dayLabel(d, days)}
            </button>
          ))}
          {(liveNow || days.some((d) => d.status === 'live')) && (
            <a className={`uzivo-btn ${liveOpen ? 'on' : ''}`} role="tab" aria-selected={liveOpen} href="/uzivo" title="Prenos uživo: video, ko sada govori, chat i statistika dana" onClick={(e) => {
              e.preventDefault()
              setStatsOpen(false)
              setCurrent(null)
              // zaglavlje prati dan koji je u toku
              const ld = days.find((d) => d.status === 'live')
              if (ld && ld.id !== session.id) {
                setQueueKey(null)
                switchDay(ld.id)
              }
              setLiveOpen(true)
              track('uzivo-otvoreno', { izvor: 'zaglavlje' })
            }}>
              <i aria-hidden />Uživo
            </a>
          )}
          <button role="tab" aria-selected={statsOpen} className={statsOpen ? 'on' : ''} onClick={() => {
            setLiveOpen(false)
            setStatsOpen(true)
            trackView('/statistika', 'Statistika')
          }}>
            Statistika
          </button>
        </div>
        <div className="updated" title={session.live ? 'Sednica je u toku: novi govori se dodaju čim govornik završi (provera na 30 s)' : 'Kada su podaci za ovaj dan poslednji put izmenjeni'}>
          {session.live?.status === 'live' ? (
            <>
              <span className="onair-dot" aria-hidden />
              {session.live.pause ? 'Pauza' : session.live.now ? <>Govori: <b>{session.live.now.speaker === 'NN' ? 'nepoznat govornik' : session.live.now.speaker}</b> od {session.live.now.since}</> : 'U toku'}
              <span className="updated-at"> · ažurirano {fmtUpdated(session.live.updated)}</span>
            </>
          ) : (
            dayMeta?.updated && <span className="updated-at">Ažurirano {fmtUpdated(dayMeta.updated)}</span>
          )}
        </div>
        </div>
        {news.length > 0 && (
          <button className="news-btn" onClick={openNews}>
            Vesti <b>{news.length}</b>
          </button>
        )}
        <button className="news-btn about-btn" onClick={() => {
            setAboutOpen(true)
            trackView('/kako-radimo', 'Kako radimo')
          }}>
          Kako radimo
        </button>
        <button className="help-btn" onClick={() => setGuide(true)}>
          Kako se koristi?
        </button>
        <div className="agenda" title="Tačka dnevnog reda">
          <span className="eyebrow">Tačka {agendaIdx + 1} od {session.agenda.length}</span>
          <span>{session.agenda[agendaIdx]}</span>
        </div>
              <button className="script-btn" data-lat onClick={toggleScript} title="Ćirilica / latinica" aria-label={script === 'lat' ? 'Prebaci na ćirilicu' : 'Prebaci na latinicu'}>
          {script === 'lat' ? 'Ћ' : 'L'}
        </button>
      </header>

      {liveOpen ? (
        <section className="live-area"><LivePage embedded onContact={contactOn ? openContact : undefined} /></section>
      ) : (<>
      <main className={`stage ${statsOpen ? 'stats-on' : ''}`} ref={stageRef}>
        {statsOpen ? (
          allSessions ? (
            <StatsPanel
              page
              sessions={allSessions}
              days={days}
              mps={mps}
              lists={lists}
              chairColor={CHAIR_COLOR}
              onClose={() => setStatsOpen(false)}
              onSpeech={(sid, id) => {
                setStatsOpen(false)
                if (sid !== session.id) switchDay(sid)
                setPendingOpen({ ref: { session: sid, id }, source: 'statistika' })
              }}
            />
          ) : (
            <div className="stats-page stats-loading">Učitavam statistiku…</div>
          )
        ) : (
        <>
        {/* sloj sale: zum i pomeranje; lica i imena su van zuma (uspravni), ali u istom sloju zbog prevlačenja */}
        <div className={`hall-layer ${zoomed ? 'zoomed' : ''}`} ref={layerRef}>
        <div className="zoomer">
        <motion.div
          className="camera"
          initial={reduce ? false : { rotateX: 8, scale: 1.35, y: -40, opacity: 0 }}
          animate={{ rotateX: 46, scale: 1, y: 0, opacity: current ? 0.45 : 1 }}
          transition={{ duration: 1.1, ease: [0.2, 0.7, 0.1, 1], opacity: { duration: 0.4 } }}
          onAnimationComplete={() => setHallSettled((n) => n + 1)}
        >
          <Hemicycle
            seats={seats}
            lists={lists}
            activeMpId={activeMpId ?? null}
            chairActive={chairActive}
            interjectMpId={null}
            spokenIds={spokenIds}
            highlightList={hlList}
            highlightIds={cityHl?.ids ?? null}
            talk={talk}
            selectedMpId={dossier}
            onSeat={seatClick}
            onChair={() => chair && setPanelKey(chair.key)}
            chairName={chair?.name ?? ''}
          />
        </motion.div>
        </div>

        {faces && hallIn && (
          <SeatFaces
            mps={mps}
            colorOf={(m) => listOf(m)?.color ?? '#9AA6A2'}
            talk={talk}
            dimIds={found?.ids ?? cityHl?.ids ?? listIds}
            focus={found?.ids ?? null}
            activeId={activeMpId ?? null}
            stageRef={stageRef}
            deps={[session.id, mobile, asstLayout, !!current, hallSettled]}
            zoom={zoom}
            notable={notable}
            chair={chairFace}
            onChair={() => chairSp && setPanelKey(chairSp.key)}
            onPick={seatClick}
          />
        )}
        <button className={`faces-toggle ${faces ? 'on' : ''}`} onClick={toggleFaces} aria-pressed={faces}>
          {faces ? 'Sakrij lica' : 'Prikaži lica'}
        </button>
        {!current && !found && hallIn && (
          <SeatLabels
            items={seatLabels}
            stageRef={stageRef}
            deps={[session.id, mobile, asstLayout, hallSettled]}
            zoom={zoom}
            onPick={(key) => {
              setPanelKey(key)
              track('govornik-otvoren', { govornik: nameOf(key), izvor: 'oznaka' })
            }}
          />
        )}
        </div>
        {zoomTip && !current && (
          <button className="zoom-tip" onClick={() => zoomBy(1.8)}>
            <b>🔍 Zumiraj salu</b>
            {mobile ? <span>dva prsta ili +</span> : <span>Točkić miša ili +, pa prevuci da se pomeraš · izbliza se vide lica svih poslanika</span>}
          </button>
        )}
        <div className={`zoom-ctl ${zoomTip ? 'hint' : ''}`} role="group" aria-label="Zum sale">
          <button onClick={() => zoomBy(1.5)} aria-label="Približi">+</button>
          <button onClick={() => zoomBy(1 / 1.5)} aria-label="Udalji" disabled={!zoomed}>−</button>
          {zoomed && (
            <button onClick={resetZoom} aria-label="Cela sala" title="Cela sala">⟲</button>
          )}
        </div>
        {!current && (
          <div className="hall-search" role="search">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
                if (e.key === 'Enter' && found?.list[0]) {
                  seatClick(found.list[0].id)
                  track('pretraga', { izbor: found.list[0].name })
                }
              }}
              placeholder="Pronađi poslanika: ime i prezime"
              aria-label="Pronađi poslanika po imenu i prezimenu"
            />
            {query && (
              <button className="hs-x" onClick={() => setQuery('')} aria-label="Obriši pretragu">
                ×
              </button>
            )}
            {found && (
              <ul className="hs-res">
                {found.list.length === 0 && <li className="hs-none">Nema poslanika sa tim imenom.</li>}
                {found.list.slice(0, 6).map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => {
                        seatClick(m.id)
                        track('pretraga', { izbor: m.name })
                      }}
                    >
                      <Portrait mp={m} name={m.name} color={listOf(m)?.color ?? '#9AA6A2'} size={28} />
                      <span>
                        <b>{m.name}</b>
                        <i>{listOf(m)?.name}</i>
                      </span>
                    </button>
                  </li>
                ))}
                {found.list.length > 6 && <li className="hs-more">još {found.list.length - 6} u sali</li>}
              </ul>
            )}
          </div>
        )}
        {cityHl && (
          <div className="city-chip">
            <span>
              Iz mesta <b>{cityHl.city}</b>: {cityHl.ids.size} · govorilo ovog dana: {[...cityHl.ids].filter((id) => spokenIds.has(id)).length}
            </span>
            <button onClick={() => setCityHl(null)} aria-label="Ukloni isticanje">
              ✕
            </button>
          </div>
        )}

        <div className="legend" role="list" aria-label="Izborne liste">
          {lists.map((l) => (
            <button
              key={l.key}
              role="listitem"
              className={`lg ${hlList === l.key ? 'on' : ''} ${hlList && hlList !== l.key ? 'off' : ''}`}
              onClick={() => setHlList(hlList === l.key ? null : l.key)}
              style={{ ['--c' as string]: l.color }}
            >
              <i />
              <span>{l.name}</span>
              <b className="mono">{l.seats}</b>
            </button>
          ))}
        </div>

        </>
        )}

        {/* na računaru prozor stoji u sali; na telefonu ide u <body> da zauzme ceo ekran (sala ne pušta fiksne elemente napolje) */}
        {mobile ? createPortal(speechLayer, document.body) : speechLayer}
      </main>

      {/* telefon: stalna donja traka sa glavnim radnjama (na /traka je nema: govori se otvaraju na traci) */}
      {!traka && <nav className="mobile-bar" aria-label="Glavne radnje">
        <button className="mb-start" onClick={() => (speech ? go(1) : speeches[0] && open(speeches[0], 'pocetak'))}>
          ▶ {speech ? 'Sledeći govor' : 'Prati sednicu'}
        </button>
        {news.length > 0 && (
          <button className="mb-news" onClick={openNews}>
            Vesti
          </button>
        )}
        <button
          className="mb-ai"
          onClick={() => {
            if (!asstOpen) {
              setAsstLayout(true)
              track('asistent-otvoren')
            }
            setAsstOpen((o) => !o)
          }}
          aria-expanded={asstOpen}
        >
          AI asistent
        </button>
      </nav>}

      {!traka && <Sidebar
        session={session}
        speeches={speeches}
        currentId={speech?.id ?? null}
        nameOf={nameOf}
        colorOf={colorOf}
        mpOf={(key) => { const id = speakerByKey.get(key)?.mp_id; return id ? mpById.get(id) : undefined }}
        onOpen={(e, src) => open(e, src)}
        onAbout={() => {
          setAboutOpen(true)
          trackView('/kako-radimo', 'Kako radimo')
        }}
        onContact={contactOn ? openContact : undefined}
        onStart={() => (speech ? go(1) : speeches[0] && open(speeches[0], 'pocetak'))}
        startLabel={speech ? 'Sledeći govor' : 'Prati sednicu od početka'}
      />}
      </>)}

      {guide && !traka && <Guide onClose={closeGuide} />}

      <AnimatePresence>{aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} onContact={contactOn ? openContact : undefined} />}</AnimatePresence>
      <AnimatePresence>{contactOpen && <ContactPanel about={reportAbout} onClose={() => setContactOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {newsOpen && (
          <NewsPanel
            items={news}
            mpById={mpById}
            colorOf={(m) => listOf(m)?.color ?? '#9AA6A2'}
            onMp={(id) => {
              setNewsOpen(false)
              seatClick(id)
            }}
            onOpenRef={(ref) => {
              setNewsOpen(false)
              track('vest-govor')
              if (ref.session !== session.id) switchDay(ref.session)
              setPendingOpen({ ref, source: 'vesti' })
            }}
            onClose={() => setNewsOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {panel && panelKey && (
          <SpeakerPanel
            key={panelKey}
            name={panel.lane?.name ?? nameOf(panelKey)}
            sub={panel.lane?.sub ?? ''}
            color={panel.lane?.color ?? colorOf(panelKey)}
            mp={panel.lane?.mp}
            list={listOf(panel.lane?.mp)}
            rezime={rezimei[panelKey]}
            days={panel.days}
            auto={panel.auto}
            onClose={() => setPanelKey(null)}
            onPlay={(sid, turnId, all) => {
              track('govornik-pusti', { govornik: nameOf(panelKey), sve: all })
              setQueueKey(all ? panelKey : null)
              setPanelKey(null)
              if (traka) {
                traka.openSpeech(sid, turnId)
                return
              }
              if (sid !== session.id) {
                switchDay(sid)
                setPendingOpen({ ref: { session: sid, id: turnId }, source: 'govornik' })
              } else {
                const t = speeches.find((x) => x.id === turnId)
                if (t) open(t, 'govornik')
              }
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {dossierMp && (
          <Dossier
            mp={dossierMp}
            list={listOf(dossierMp)}
            session={session}
            speakerKey={dossierSpeaker?.key}
            isChair={!!dossierSpeaker?.role}
            onClose={() => setDossier(null)}
            onSeek={(t) => {
              const e = speeches.find((x) => x.t === t)
              if (e) open(e, 'dosije')
            }}
          />
        )}
      </AnimatePresence>
    </div>
    </>
  )
}
