import { Logo } from '../components/Logo'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ListInfo, Mp, Session } from '../types'
import { Portrait } from '../components/Portrait'
import { LiveChat } from './LiveChat'
import { SubwayOverlay } from './SubwayOverlay'
import { FlagSvg, HammerLayer, HammerSvg, HeartSvg, type Tool } from './HammerLayer'
import { SnakeGame, SnakeIcon } from './SnakeGame'
import { useMuted } from '../muted'
import { track, trackView } from '../analytics'
import { MrezeRed } from '../components/Mreze'

/**
 * skupstina.live/uzivo: prenos u sredini, levo statistika dana i utišavanje poslanika, desno chat i broj gledalaca.
 * Ko govori: scripts/screen_speaker.py čita natpis sa slike prenosa (data/live/now.json, provera na 5 s).
 * Utišani poslanik: plejer se sam utiša dok on govori. Sa kašnjenjem od 30 s ili 1 min utišavanje kreće na vreme.
 */

const CHANNEL = 'UCghngrfQwzJ4aaPZ-UgNIZQ' // YouTube kanal Narodne skupštine
const NOW_POLL = 10000 // ko govori; na 10 s i samo dok je strana vidljiva (stotine gledalaca odjednom)
const DAY_POLL = 30000

type Who = { mp_id: string | null; name: string | null; list: string | null; since: number; at?: number; chair?: boolean; pause?: boolean }
type NowDoc = { updated: string; at: number; v: string | null; now: Who | null; timer: number | null; viewers: number | null; recent: Who[] }
type LiveDoc = { days: { id: string; title: string; status: string; updated: string; speeches: number }[] }

type YTP = {
  mute: () => void
  unMute: () => void
  isMuted: () => boolean
  getPlayerState: () => number
  getCurrentTime: () => number
  seekTo: (s: number, a: boolean) => void
  playVideo: () => void
  destroy: () => void
}
type YTNS = { Player: new (el: HTMLElement, o: Record<string, unknown>) => YTP }
let api: Promise<YTNS> | null = null
function loadYT(): Promise<YTNS> {
  const w = window as unknown as { YT?: YTNS & { Player?: unknown }; onYouTubeIframeAPIReady?: () => void }
  if (w.YT?.Player) return Promise.resolve(w.YT)
  if (!api)
    api = new Promise((res) => {
      const prev = w.onYouTubeIframeAPIReady
      w.onYouTubeIframeAPIReady = () => {
        prev?.()
        res(w.YT!)
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  return api
}

const getJson = <T,>(u: string): Promise<T | null> =>
  // no-cache: pregledač pita server sa ETag-om, pa nepromenjen fajl dođe kao kratak 304
  fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)
const nf = (n: number) => n.toLocaleString('sr-Latn-RS')
const hm = (sec: number) => {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
const ago = (sec: number) => (sec < 60 ? `${Math.max(0, Math.round(sec))} s` : `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`)
/** izbor koji se pamti u pregledaču (prikaz statistike, chata, reakcija…) */
function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => {
    try {
      const x = localStorage.getItem(key)
      return x == null ? initial : x === '1'
    } catch {
      return initial
    }
  })
  const set = (n: boolean) => {
    setV(n)
    try {
      localStorage.setItem(key, n ? '1' : '0')
    } catch {
      /* bez pamćenja */
    }
  }
  return [v, set]
}
/** kratak zvuk kad utišani poslanik završi (WebAudio, bez fajla) */
function ding() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ac = new AC()
    const t = ac.currentTime
    ;[880, 1320].forEach((f, i) => {
      const o = ac.createOscillator()
      const g = ac.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + i * 0.16)
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5)
      o.connect(g).connect(ac.destination)
      o.start(t + i * 0.16)
      o.stop(t + i * 0.16 + 0.55)
    })
    setTimeout(() => void ac.close().catch(() => {}), 1500)
  } catch {
    /* bez zvuka */
  }
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj').toLowerCase()

/** noStats: bez statistike dana (strana /traka) */
export function LivePage({ embedded = false, onContact, noStats = false }: { embedded?: boolean; onContact?: () => void; noStats?: boolean }) {
  const [mps, setMps] = useState<Mp[]>([])
  const [lists, setLists] = useState<ListInfo[]>([])
  const [nowDoc, setNowDoc] = useState<NowDoc | null>(null)
  const [day, setDay] = useState<Session | null>(null)
  const [pastDays, setPastDays] = useState<Session[]>([])
  const [dayMeta, setDayMeta] = useState<LiveDoc['days'][0] | null>(null)
  const [clock, setClock] = useState(() => Date.now() / 1000)
  const [delay, setDelay] = useState(0)
  const [q, setQ] = useState('')
  const [muted, toggle, setAll] = useMuted()
  // čekić preko prenosa (HammerLayer)
  const [tool, setTool] = useState<Tool>('off')
  const [snake, setSnake] = useState(false)
  // šta gledalac želi na ekranu (pamti se): statistika levo, chat desno, reakcije drugih preko videa, zvuk kad utišani završi
  const [showStatsPref, setShowStats] = usePref('skupstina-uzivo-statistika', true)
  const showStats = showStatsPref && !noStats
  const [showChat, setShowChat] = usePref('skupstina-uzivo-chat', true)
  const [showFloats, setShowFloats] = usePref('skupstina-uzivo-reakcije', true)
  const [dingOn, setDingOn] = usePref('skupstina-uzivo-zvono', false)
  const [openLast, setOpenLast] = useState<number | null>(null)
  const videoBox = useRef<HTMLDivElement>(null)
  // ceo ekran kao na Twitch-u: snimak i chat zajedno (položeno: chat desno, uspravno: ispod snimka). Pravi ceo ekran
  // gde pregledač dozvoljava (Android, računar); na iPhone-u, koji ga dozvoljava samo za <video>, strana preko celog prozora.
  const rootEl = useRef<HTMLDivElement>(null)
  const [fs, setFs] = useState(false)
  const [fsChat, setFsChat] = useState(true)
  const enterFs = () => {
    setFs(true)
    track('uzivo-ceo-ekran')
    const el = rootEl.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null
    try {
      if (el?.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
      else el?.webkitRequestFullscreen?.()
    } catch {
      /* ostaje ceo prozor */
    }
  }
  const exitFs = () => {
    setFs(false)
    const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else if (d.webkitFullscreenElement) d.webkitExitFullscreen?.()
  }
  // telefon okrenut položeno: odmah snimak preko celog ekrana sa chatom (kao Twitch); uspravno se vraća obična strana.
  // Ko izađe dok je telefon položen, ostaje van celog ekrana dok ga ponovo ne okrene.
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)')
    const on = () => setFs(mq.matches)
    if (mq.matches) setFs(true)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    if (!fs) return
    // izlaz dugmetom „nazad” na Androidu ili Esc u pravom celom ekranu; Esc i u celom prozoru
    const d = document as Document & { webkitFullscreenElement?: Element }
    let was = false
    const onChange = () => {
      const now = !!(document.fullscreenElement || d.webkitFullscreenElement)
      if (was && !now) setFs(false)
      was = now
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) setFs(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [fs])
  const [autoMuted, setAutoMuted] = useState(false)
  const [needSound, setNeedSound] = useState(false)
  const mutedNowRef = useRef(false)
  const playerEl = useRef<HTMLDivElement>(null)
  const player = useRef<YTP | null>(null)
  const playerFor = useRef<string | null>(null)

  useEffect(() => {
    const prev = document.title
    document.title = 'Uživo · Skupština live'
    trackView('/uzivo', 'Uživo')
    getJson<Mp[]>('/data/mps.json').then((x) => x && setMps(x))
    getJson<ListInfo[]>('/data/lists.json').then((x) => x && setLists(x))
    // objavljeni dani: za listu poslanika poređanu po minutima govora
    getJson<{ id: string; status: string }[]>('/data/sessions.json').then(async (ds) => {
      const ss = await Promise.all((ds ?? []).filter((d) => d.status === 'ready').map((d) => getJson<Session>(`/data/session-${d.id}.json`)))
      setPastDays(ss.filter((x): x is Session => !!x))
    })
    return () => {
      document.title = prev
    }
  }, [])

  // ko govori: često; dan (govori sa sažecima): na 30 s
  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (document.hidden) return
      const n = await getJson<NowDoc>('/data/live/now.json')
      if (alive && n) setNowDoc(n)
    }
    const tickDay = async () => {
      if (document.hidden) return
      const l = await getJson<LiveDoc>('/data/live/live.json')
      const d = l?.days?.[l.days.length - 1]
      if (!alive || !d) return
      setDayMeta(d)
      const s = await getJson<Session>(`/data/live/session-${d.id}.json`)
      if (alive && s) setDay(s)
    }
    void tick()
    void tickDay()
    const a = setInterval(tick, NOW_POLL)
    const b = setInterval(tickDay, DAY_POLL)
    const c = setInterval(() => setClock(Date.now() / 1000), 1000)
    const vis = () => {
      if (document.hidden) return
      void tick()
      void tickDay()
    }
    document.addEventListener('visibilitychange', vis)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', vis)
      clearInterval(a)
      clearInterval(b)
      clearInterval(c)
    }
  }, [])

  const mpById = useMemo(() => new Map(mps.map((m) => [m.id, m])), [mps])
  const listByKey = useMemo(() => new Map(lists.map((l) => [l.key, l])), [lists])

  // ko govori u trenutku koji gledalac vidi (sa izabranim kašnjenjem)
  const who: Who | null = useMemo(() => {
    // van prenosa (now.json star preko 10 min) niko ne govori: bez poslednjeg govornika od juče
    if (!nowDoc || clock - nowDoc.at > 600) return null
    const T = clock - delay
    const hist = [...(nowDoc.recent ?? [])].sort((a, b) => (a.at ?? a.since) - (b.at ?? b.since))
    let w: Who | null = null
    for (const h of hist) if ((h.at ?? h.since) <= T) w = h
    return w
  }, [nowDoc, clock, delay])
  const stale = nowDoc ? clock - nowDoc.at > 90 : true
  // broj sa YouTube-a samo dok now.json stiže (posle prenosa ostaje poslednja vrednost, ne prikazujemo je)
  const ytViewers = nowDoc && !stale ? nowDoc.viewers : null
  // van prenosa (now.json se ne osvežava 10 min): preko YouTube okvira dugme ka naslovnoj sa svim govorima
  const offAir = nowDoc != null && clock - nowDoc.at > 600
  const whoMp = who?.mp_id ? mpById.get(who.mp_id) : undefined
  const whoList = who?.list ? listByKey.get(who.list) : undefined
  const isMutedNow = !!(who?.mp_id && muted.has(who.mp_id))
  // Subway Surfers preko jedne strane prenosa dok govori utišani poslanik (izbor se pamti u pregledaču)
  const [subway, setSubwayState] = useState<'off' | 'left' | 'right'>(() => {
    try {
      const v = localStorage.getItem('skupstina-subway')
      return v === 'left' || v === 'right' ? v : 'off'
    } catch {
      return 'off'
    }
  })
  const setSubway = (v: 'off' | 'left' | 'right') => {
    setSubwayState(v)
    try {
      localStorage.setItem('skupstina-subway', v)
    } catch {
      /* bez pamćenja */
    }
    track('uzivo-subway', { izbor: v })
  }
  mutedNowRef.current = isMutedNow
  const dingRef = useRef(dingOn)
  dingRef.current = dingOn
  const soundOn = () => {
    const p = player.current
    if (!p) return
    try {
      if (!isMutedNow) p.unMute()
      p.playVideo()
      setNeedSound(false)
      track('uzivo-zvuk')
    } catch {
      /* nije spreman */
    }
  }
  // prvi klik ili taster bilo gde na strani pušta zvuk (pregledač tada dozvoljava)
  useEffect(() => {
    if (!needSound) return
    const f = () => soundOn()
    window.addEventListener('pointerdown', f, { once: true })
    window.addEventListener('keydown', f, { once: true })
    return () => {
      window.removeEventListener('pointerdown', f)
      window.removeEventListener('keydown', f)
    }
  })

  // plejer: video iz now.json, inače prenos uživo kanala
  const vid = nowDoc?.v ?? null
  useEffect(() => {
    const key = vid ?? 'kanal'
    if (!playerEl.current || playerFor.current === key) return
    playerFor.current = key
    let cancelled = false
    if (!vid) {
      // video još nije poznat: ugrađeni prenos uživo kanala (bez automatskog utišavanja)
      player.current?.destroy()
      player.current = null
      const f = document.createElement('iframe')
      f.src = `https://www.youtube.com/embed/live_stream?channel=${CHANNEL}&autoplay=1&playsinline=1&fs=0`
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
      f.title = 'Prenos uživo'
      playerEl.current.replaceChildren(f)
      return
    }
    loadYT().then((YT) => {
      if (cancelled || !playerEl.current) return
      player.current?.destroy()
      const host = document.createElement('div')
      playerEl.current.replaceChildren(host)
      player.current = new YT.Player(host, {
        width: '100%',
        height: '100%',
        videoId: vid,
        // fs: 0 — YouTube-ov ceo ekran pokazuje samo snimak; naš (dugme „Ceo ekran”) pokazuje i chat
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 0 },
        events: {
          // kreće utišan (to pregledač uvek dozvoli), pa odmah pokušamo sa zvukom;
          // ako pregledač zaustavi video jer nije bilo klika, vraćamo bez zvuka i nudimo dugme „Uključi zvuk”
          onReady: () => {
            const p = player.current
            if (!p) return
            try {
              p.playVideo()
              if (!mutedNowRef.current) p.unMute()
            } catch {
              /* nije spreman */
            }
            setTimeout(() => {
              try {
                const st = p.getPlayerState()
                if (st !== 1 && st !== 3) {
                  p.mute()
                  p.playVideo()
                  setNeedSound(true)
                } else setNeedSound(p.isMuted() && !mutedNowRef.current)
              } catch {
                /* nije spreman */
              }
            }, 1500)
          },
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [vid])

  // utišavanje: samo kad smo mi utišali, vraćamo zvuk (ne diramo ono što je gledalac sam uradio)
  useEffect(() => {
    const p = player.current
    if (!p) return
    try {
      if (isMutedNow && !autoMuted) {
        p.mute()
        setAutoMuted(true)
        track('uzivo-utisano', { govornik: who?.name ?? '' })
      } else if (!isMutedNow && autoMuted) {
        p.unMute()
        setAutoMuted(false)
        if (dingRef.current) ding()
      }
    } catch {
      /* plejer još nije spreman */
    }
  }, [isMutedNow, autoMuted, who?.name])

  const changeDelay = (d: number) => {
    const p = player.current
    try {
      if (p) {
        p.seekTo(Math.max(0, p.getCurrentTime() - (d - delay)), true)
        p.playVideo()
      }
    } catch {
      /* plejer bez premotavanja: ostaje kako jeste */
    }
    setDelay(d)
    track('uzivo-kasnjenje', { sekundi: d })
  }

  // statistika dana (iz istog fajla kao sala)
  const stats = useMemo(() => {
    if (!day) return null
    const sp = new Map(day.speakers.map((s) => [s.key, s]))
    const rows = day.events.filter((e) => e.type === 'speech').map((e) => {
      const s = sp.get(e.speaker)
      const mp = s?.mp_id ? mpById.get(s.mp_id) : undefined
      return { e, name: s?.name ?? e.speaker, chair: !!s?.role, mp, sec: e.vdur ?? e.dur * 60 }
    })
    const nc = rows.filter((r) => !r.chair)
    const by = new Map<string, number>()
    for (const r of nc) if (r.mp) by.set(r.mp.list, (by.get(r.mp.list) ?? 0) + r.sec)
    const tot = nc.reduce((a, r) => a + r.sec, 0) || 1
    const per = new Map<string, { name: string; mp?: Mp; sec: number; n: number }>()
    for (const r of nc) {
      const k = r.mp?.id ?? r.name
      const p = per.get(k) ?? { name: r.name, mp: r.mp, sec: 0, n: 0 }
      p.sec += r.sec
      p.n += 1
      per.set(k, p)
    }
    return {
      n: rows.length,
      sec: rows.reduce((a, r) => a + r.sec, 0),
      words: rows.reduce((a, r) => a + (r.e.words ?? 0), 0),
      mpsSpoke: new Set(nc.filter((r) => r.mp).map((r) => r.mp!.id)).size,
      share: lists.map((l) => ({ l, v: (by.get(l.key) ?? 0) / tot })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v),
      top: [...per.values()].sort((a, b) => b.sec - a.sec).slice(0, 6),
      last: rows.slice(-6).reverse(),
    }
  }, [day, mpById, lists])

  // minuti govora po poslaniku: svi dani zajedno i danas (računa se i predsedavanje)
  const minutes = useMemo(() => {
    const total = new Map<string, number>()
    const today = new Map<string, number>()
    const add = (s: Session, m: Map<string, number>) => {
      const sp = new Map(s.speakers.map((x) => [x.key, x]))
      for (const e of s.events) {
        if (e.type !== 'speech') continue
        const w = sp.get(e.speaker)
        if (!w?.mp_id) continue
        m.set(w.mp_id, (m.get(w.mp_id) ?? 0) + (e.vdur ?? e.dur * 60) / 60)
      }
    }
    const seen = new Set<string>()
    for (const s of pastDays) if (!seen.has(s.id)) (seen.add(s.id), add(s, total))
    if (day && !seen.has(day.id)) {
      add(day, total)
      add(day, today)
    }
    return { total, today }
  }, [pastDays, day])
  const ranked = useMemo(() => {
    const f = fold(q.trim())
    return mps
      .filter((m) => !f || fold(m.name).includes(f))
      .map((m) => ({ m, min: minutes.total.get(m.id) ?? 0, today: minutes.today.get(m.id) ?? 0 }))
      .sort((a, b) => b.min - a.min || a.m.name.localeCompare(b.m.name, 'sr'))
  }, [mps, q, minutes])

  // utišavanje cele liste jednim klikom (isto za svaku listu); drugi klik vraća zvuk celoj listi
  const byList = useMemo(() => lists.map((l) => ({ l, ids: mps.filter((m) => m.list === l.key).map((m) => m.id) })).filter((x) => x.ids.length > 0), [lists, mps])
  const toggleList = (ids: string[], name: string) => {
    const all = ids.every((id) => muted.has(id))
    const n = new Set(muted)
    for (const id of ids) {
      if (all) n.delete(id)
      else n.add(id)
    }
    setAll(n)
    track('uzivo-utisaj-listu', { lista: name, utisana: !all })
  }
  // adresa dana u sali: ?dan=3 za prvu sednicu (stari linkovi), inače ceo id
  const dayNo = dayMeta ? (dayMeta.id.startsWith('s15-01-') ? dayMeta.id.match(/-d(\d+)$/)?.[1] : dayMeta.id) : undefined

  return (
    <div ref={rootEl} className={`lv ${embedded ? 'embedded' : ''} ${fs ? 'fs' : ''} ${fs && !fsChat ? 'fs-nochat' : ''}`}>
      {!embedded && <header className="lv-top">
        <a className="brand" href="/" title="Skupština live">
          <Logo />
        </a>
        <span className="lv-onair"><i aria-hidden />uživo</span>
        <span className="lv-title">{dayMeta?.title ?? 'Narodna skupština'}</span>
        <span className="lv-grow" />
        {ytViewers != null && (
          <span className="lv-viewers" title="Koliko ljudi trenutno gleda prenos na YouTube-u (osvežava se na minut)">
            <b>{nf(ytViewers)}</b> gleda
          </span>
        )}
      </header>}

      <main className={`lv-grid ${showStats ? '' : 'no-left'} ${showChat ? '' : 'no-right'}`}>
        <aside className="lv-left" hidden={!showStats}>
          <div className="lv-head"><b>Statistika dana</b></div>
          {stats ? (
              <div className="lv-stat">
                <div className="lv-tiles">
                  <div><b>{hm(stats.sec)}</b><span>vreme govora</span></div>
                  <div><b>{stats.n}</b><span>izlaganja</span></div>
                  <div><b>{stats.mpsSpoke}</b><span>poslanika govorilo</span></div>
                  <div><b>{nf(stats.words)}</b><span>reči</span></div>
                </div>
                <h4>Vreme govora po listama</h4>
                <div className="lv-bar" aria-hidden>
                  {stats.share.map((x) => <i key={x.l.key} style={{ flexGrow: x.v, background: x.l.color }} />)}
                </div>
                <ul className="lv-legend">
                  {stats.share.slice(0, 5).map((x) => (
                    <li key={x.l.key}><i style={{ background: x.l.color }} />{x.l.name}<span className="mono">{Math.round(x.v * 100)}%</span></li>
                  ))}
                </ul>
                <h4>Najduže za govornicom danas</h4>
                <ol className="lv-top5">
                  {stats.top.map((p) => (
                    <li key={p.name}>
                      <span style={{ ['--c' as string]: p.mp ? listByKey.get(p.mp.list)?.color : '#8E98AB' }}>{p.name}</span>
                      <span className="mono">{hm(p.sec)} · {p.n}×</span>
                    </li>
                  ))}
                </ol>
                <h4>Poslednji govori</h4>
                <ul className="lv-last">
                  {stats.last.map((r) => (
                    <li key={r.e.id} className={openLast === r.e.id ? 'open' : ''}>
                      <button type="button" className="lv-last-btn" aria-expanded={openLast === r.e.id} onClick={() => setOpenLast(openLast === r.e.id ? null : r.e.id)} title="Prikaži ceo sažetak">
                        <span className="mono">{r.e.clock}</span> {r.name}
                        {r.e.summary && <small>{r.e.summary}</small>}
                      </button>
                      {openLast === r.e.id && dayNo && <a className="lv-last-go" href={`/?dan=${dayNo}&govor=${r.e.id}`}>Ceo govor sa snimkom →</a>}
                    </li>
                  ))}
                </ul>
                {dayNo && <a className="lv-more" href={`/?dan=${dayNo}`}>Svi govori dana sa sažecima i transkriptom →</a>}
                <p className="lv-note">Govori stižu 2–3 min posle kraja izlaganja. Transkript je automatski (Whisper) i može imati greške.</p>
              </div>
            ) : (
              <p className="lv-note">Statistika se pojavljuje posle prvog završenog govora.</p>
          )}
        </aside>

        <section className="lv-center">
          <div className="lv-video" ref={videoBox}>
            <div ref={playerEl} className="lv-player" />
            <HammerLayer tool={snake ? 'off' : tool} host={videoBox} floats={showFloats} />
            {snake && <SnakeGame onClose={() => setSnake(false)} />}
            {subway !== 'off' && <SubwayOverlay active={isMutedNow} side={subway} />}
            {isMutedNow && <div className="lv-muted-badge">Utišano: govori {who?.name}</div>}
            {needSound && !isMutedNow && !offAir && (
              <button className="lv-sound" onClick={soundOn}>🔊 Uključi zvuk</button>
            )}
            {fs && who?.name && !offAir && (
              <div className="lv-fs-who" style={{ ['--c' as string]: whoList?.color ?? '#8E98AB' }}>
                <i aria-hidden />
                <b>{whoMp?.name ?? who.name}</b>
                {isMutedNow && <em>utišan</em>}
              </div>
            )}
            {fs ? (
              <div className="lv-fsbar">
                <button type="button" className={fsChat ? 'on' : ''} aria-pressed={fsChat} onClick={() => setFsChat(!fsChat)} title={fsChat ? 'Sakrij chat (veći snimak)' : 'Prikaži chat'}>
                  Chat
                </button>
                <button type="button" onClick={exitFs} aria-label="Izađi iz celog ekrana" title="Izađi iz celog ekrana (Esc)">
                  <FsIcon out />
                </button>
              </div>
            ) : (
              <button type="button" className="lv-fs-btn" onClick={enterFs} aria-label="Ceo ekran sa chatom" title="Ceo ekran sa chatom">
                <FsIcon />
              </button>
            )}
          </div>
          {/* traka ispod videa: igračke (ne stoje više preko kontrola snimka) i šta se prikazuje */}
          <div className={`lv-tools ${snake ? 'snake-on' : ''}`}>
            <div className="hm-tools" role="group" aria-label="Čekić, srce, zastava ili igra">
              <button type="button" className={`hm-toggle ${tool === 'cekic' ? 'on' : ''}`} onClick={() => setTool(tool === 'cekic' ? 'off' : 'cekic')} aria-pressed={tool === 'cekic'} title={tool === 'cekic' ? 'Spusti čekić (vrati kontrole snimka)' : 'Uzmi čekić i udaraj po prenosu'}>
                <HammerSvg size={22} />
                <span>{tool === 'cekic' ? 'Spusti čekić' : 'Čekić'}</span>
              </button>
              <button type="button" className={`hm-toggle heart ${tool === 'srce' ? 'on' : ''}`} onClick={() => setTool(tool === 'srce' ? 'off' : 'srce')} aria-pressed={tool === 'srce'} title={tool === 'srce' ? 'Spusti srce (vrati kontrole snimka)' : 'Šalji srca klikom po prenosu'}>
                <HeartSvg size={18} />
                <span>{tool === 'srce' ? 'Spusti srce' : 'Srce'}</span>
              </button>
              <button type="button" className={`hm-toggle flag ${tool === 'zastava' ? 'on' : ''}`} onClick={() => setTool(tool === 'zastava' ? 'off' : 'zastava')} aria-pressed={tool === 'zastava'} title={tool === 'zastava' ? 'Spusti zastavu (vrati kontrole snimka)' : 'Podiži zastave klikom po prenosu'}>
                <FlagSvg size={20} />
                <span>{tool === 'zastava' ? 'Spusti zastavu' : 'Zastava'}</span>
              </button>
              <button type="button" className={`hm-toggle snake ${snake ? 'on' : ''}`} onClick={() => { setTool('off'); setSnake((v) => !v) }} aria-pressed={snake} title={snake ? 'Zatvori igru' : 'Igraj Zmijicu preko prenosa'}>
                <SnakeIcon size={20} />
                <span>{snake ? 'Zatvori igru' : 'Zmijica'}</span>
              </button>
            </div>
            <span className="lv-grow" />
            <div className="lv-view" role="group" aria-label="Prikaz">
              <button type="button" className={showFloats ? 'on' : ''} aria-pressed={showFloats} onClick={() => { setShowFloats(!showFloats); track('uzivo-prikaz', { sta: 'reakcije', ukljuceno: !showFloats }) }} title="Čekići, srca i zastave drugih gledalaca u uglu videa">Reakcije</button>
              {!noStats && <button type="button" className={showStats ? 'on' : ''} aria-pressed={showStats} onClick={() => { setShowStats(!showStats); track('uzivo-prikaz', { sta: 'statistika', ukljuceno: !showStats }) }} title="Statistika dana (levo); bez nje je video veći">Statistika</button>}
              <button type="button" className={showChat ? 'on' : ''} aria-pressed={showChat} onClick={() => { setShowChat(!showChat); track('uzivo-prikaz', { sta: 'chat', ukljuceno: !showChat }) }} title="Chat (desno); bez njega je video veći">Chat</button>
            </div>
          </div>
          <div className="lv-now" style={{ ['--c' as string]: whoList?.color ?? '#8E98AB' }}>
            {who?.mp_id && whoMp ? (
              <>
                <Portrait mp={whoMp} name={whoMp.name} color={whoList?.color ?? '#8E98AB'} size={52} />
                <div className="lv-now-txt">
                  <span className="eyebrow">Sada govori{who.chair ? ' · predsedavajući' : ''}</span>
                  <b>{whoMp.name}</b>
                  <span>{whoList?.name ?? whoMp.listFull} · {ago(clock - delay - who.since)}</span>
                </div>
                <div className="lv-now-btns">
                  <button className={`lv-mute-btn ${isMutedNow ? 'off' : ''}`} onClick={() => toggle(whoMp.id)}>
                    {isMutedNow ? 'Uključi zvuk za njega' : 'Utišaj ovog poslanika'}
                  </button>
                  {isMutedNow && (
                    <button className={`lv-mute-btn lv-subway-btn ${subway !== 'off' ? 'on' : ''}`} onClick={() => setSubway(subway === 'off' ? 'right' : 'off')}>
                      {subway === 'off' ? '🎮 Uključi Subway Surfers' : 'Isključi Subway Surfers'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="lv-now-txt">
                <span className="eyebrow">{offAir ? 'Van prenosa' : who?.pause && !stale ? `Pauza · od ${new Date(who.since * 1000).toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' })}` : 'Sada govori'}</span>
                <b>{offAir ? 'Prenos trenutno nije u toku' : who?.pause && !stale ? 'Pauza u sednici' : stale ? 'Prenos još nije počeo ili je pauza' : who?.chair ? 'Predsedavajući' : 'Govornik bez natpisa'}</b>
                <span>{offAir ? 'Kad sednica počne, prenos i ime govornika se ovde pojavljuju sami, bez osvežavanja strane.' : who?.pause && !stale ? 'Kad neko dobije reč, ovde se odmah vidi ko govori.' : 'Ime se čita sa natpisa na prenosu Skupštine; kad natpisa nema, govori predsedavajući.'}</span>
              </div>
            )}
          </div>
          <div className="lv-mute">
            <div className="lv-mute-top">
              <b>Utišaj poslanike{muted.size > 0 && <em> · {muted.size} utišano</em>}</b>
              <div className="lv-delay">
                <span>Video:</span>
                {[0, 10, 30, 60].map((d) => (
                  <button key={d} className={delay === d ? 'on' : ''} onClick={() => changeDelay(d)}>{d === 0 ? 'uživo' : `kasni ${d} s`}</button>
                ))}
              </div>
            </div>
            <p className={`lv-hint ${delay === 0 && muted.size > 0 ? 'warn' : ''}`}>
              {delay
                ? `Video kasni ${delay} s, pa se utišani poslanik utiša od prve reči.`
                : 'Ako želiš da utišavanje radi od prve reči, pusti video da kasni 10, 30 ili 60 s. Uživo se utiša tek nekoliko sekundi pošto počne da govori.'}
              {' '}Poslanici su poređani po tome koliko su minuta govorili na svim danima. Izbor se pamti samo u ovom pregledaču.
            </p>
            <div className="lv-lists" role="group" aria-label="Utišaj celu listu">
              <span>Cela lista:</span>
              {byList.map(({ l, ids }) => {
                const n = ids.filter((id) => muted.has(id)).length
                return (
                  <button key={l.key} type="button" className={n === ids.length ? 'off' : ''} style={{ ['--c' as string]: l.color }} aria-pressed={n === ids.length} onClick={() => toggleList(ids, l.name)} title={n === ids.length ? `Vrati zvuk listi ${l.name}` : `Utišaj sve poslanike liste ${l.name} (${ids.length})`}>
                    <i aria-hidden />{l.name} <small className="mono">{n ? `${n}/${ids.length}` : ids.length}</small>
                  </button>
                )
              })}
              <label className="lv-ding" title="Kratak zvuk kad utišani poslanik završi i zvuk prenosa se vrati">
                <input type="checkbox" checked={dingOn} onChange={(e) => { setDingOn(e.target.checked); if (e.target.checked) ding(); track('uzivo-zvono', { ukljuceno: e.target.checked }) }} />
                Zvono kad utišani završi
              </label>
            </div>
            <div className="lv-mute-head">
              <input type="search" placeholder="Pronađi poslanika" value={q} onChange={(e) => setQ(e.target.value)} />
              {muted.size > 0 && <button onClick={() => setAll(new Set())}>Poništi ({muted.size})</button>}
            </div>
            <div className="lv-mute-list">
              {ranked.map(({ m, min, today }) => (
                <button key={m.id} className={`lv-mp ${muted.has(m.id) ? 'off' : ''}`} style={{ ['--c' as string]: listByKey.get(m.list)?.color ?? '#8E98AB' }} onClick={() => {
                  toggle(m.id)
                  track('uzivo-utisaj', { poslanik: m.name, utisan: !muted.has(m.id) })
                }} aria-pressed={muted.has(m.id)} title={`${listByKey.get(m.list)?.name ?? m.listFull}: ${Math.round(min)} min govora ukupno${today >= 0.5 ? `, danas ${Math.round(today)} min` : ''}`}>
                  <span>{m.name}</span>
                  <small className="mono">{min >= 0.5 ? `${Math.round(min)} min` : '–'}{today >= 0.5 && <b> · danas {Math.round(today)}</b>}</small>
                  <em>{muted.has(m.id) ? 'utišan' : 'utišaj'}</em>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="lv-right" hidden={fs ? !fsChat : !showChat}>
          <LiveChat ytViewers={ytViewers} />
          <MrezeRed gde="uzivo" />
          {onContact && (
            <div className="lv-contact">
              <button onClick={() => {
                track('uzivo-kontakt')
                onContact()
              }}>Kontakt</button>
            </div>
          )}
        </aside>
      </main>
    </div>
  )
}

/** četiri ugla: ulaz u ceo ekran; okrenuti uglovi: izlaz */
function FsIcon({ out = false }: { out?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {out ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </svg>
  )
}
