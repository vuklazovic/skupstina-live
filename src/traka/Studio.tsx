import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lyrics } from './Lyrics'
import { Timeline } from './Timeline'
import { usePlayer } from './usePlayer'
import { VoteCard } from './VoteCard'
import { HallCard, WhoCard } from './Rail'
import { assignSeats, buildSeats } from '../geometry'
import type { ListInfo, Mp } from '../types'
import { Clock, fmtTc, initials, isChair, lastAtOrBefore, type Traka, type TSpeech } from './types'
import { dayShare, personShare, speechQuote, QuotesSheet, ShareSheet, type Share } from './Podeli'
import './studio.css'

/** prikazi preko snimka u celom ekranu, svaki se posebno pali i gasi */
type FsBox = 'stat' | 'sala' | 'tekst' | 'red'
const FS_BOXES: [FsBox, string][] = [
  ['stat', 'Statistika'],
  ['sala', 'Sala'],
  ['tekst', 'Tekst'],
  ['red', 'Naredni'],
]

const params = () => new URLSearchParams(window.location.search)

/** traka-govornici.json: svi govori jednog govornika po danima: [id govora, početak na traci, trajanje, sat u sali, kratak sažetak] */
type WhoIndex = Record<string, { name: string; sec: number; days: Record<string, [number, number, number, string, string][]> }>
/** govori kraći od ovoga („Hvala.”, „Reč ima…”) se ne računaju kad se prati jedan govornik */
const MIN_FOLLOW = 15

/**
 * Titl preko snimka: govor isečen na komade od najviše dva reda (do ~84 znaka, prelom na kraju rečenice kad može);
 * reči koje su već izgovorene su bele, ostale blede, kao u tekstu govora.
 */
function Subs({ sp, clock }: { sp: TSpeech; clock: Clock }) {
  const chunks = useMemo(() => {
    const out: { w: string[]; t: number[] }[] = []
    let buf: { w: string; t: number }[] = []
    let len = 0
    // rečenice se skupljaju dok ne bude dovoljno za titl, pa se dele na jednake komade (bez kratkih repova)
    const flush = () => {
      const n = Math.ceil(len / 84)
      const per = len / n
      let cur: { w: string[]; t: number[] } = { w: [], t: [] }
      let cl = 0
      buf.forEach((x, i) => {
        cur.w.push(x.w)
        cur.t.push(x.t)
        cl += x.w.length + 1
        if (cl >= per - 4 && i < buf.length - 1 && cl + buf[i + 1].w.length > per + 6) {
          out.push(cur)
          cur = { w: [], t: [] }
          cl = 0
        }
      })
      if (cur.w.length) out.push(cur)
      buf = []
      len = 0
    }
    for (const ln of sp.lines) {
      ln.w.forEach((w, k) => {
        buf.push({ w, t: sp.at + ln.t[k] / 10 })
        len += w.length + 1
      })
      if (len >= 42) flush()
    }
    if (buf.length) flush()
    return out
  }, [sp])
  const [pos, setPos] = useState({ c: -1, n: 0 })
  useEffect(
    () =>
      clock.on((t) => {
        const c = lastAtOrBefore(chunks, t + 0.05, (x) => x.t[0])
        let n = 0
        if (c >= 0) while (n < chunks[c].t.length && chunks[c].t[n] <= t + 0.05) n++
        setPos((p) => (p.c === c && p.n === n ? p : { c, n }))
      }),
    [clock, chunks],
  )
  const ch = chunks[pos.c]
  if (!ch) return null
  return (
    <p className="pb-subs" aria-live="off">
      <span>
        {ch.w.map((w, k) => (
          <span key={k} className={k < pos.n ? 'on' : undefined}>
            {w}{' '}
          </span>
        ))}
      </span>
    </p>
  )
}

/** statistika dana: ko je najduže govorio i koliko vremena je imala koja lista */
function DayStats({ data, onPick, onShare, onQuotes }: { data: Traka; onPick: (who: string) => void; onShare: () => void; onQuotes: () => void }) {
  const d = useMemo(() => {
    const byWho = new Map<string, { dur: number; n: number; first: number }>()
    const byList = new Map<string, { dur: number; color: string }>()
    let talk = 0
    for (const s of data.speeches) {
      const p = data.people[s.who]
      if (isChair(p)) continue
      talk += s.dur
      const w = byWho.get(s.who) ?? { dur: 0, n: 0, first: s.at }
      w.dur += s.dur
      w.n++
      byWho.set(s.who, w)
      const key = p?.list ?? 'Ostali'
      const l = byList.get(key) ?? { dur: 0, color: p?.color ?? '#8e98ab' }
      l.dur += s.dur
      byList.set(key, l)
    }
    return {
      talk: talk || 1,
      top: [...byWho.entries()].sort((x, y) => y[1].dur - x[1].dur).slice(0, 4),
      lists: [...byList.entries()].sort((x, y) => y[1].dur - x[1].dur),
    }
  }, [data])
  const max = d.top[0]?.[1].dur || 1
  return (
    <section className="rc pb-stats">
      <header>
        <span className="eyebrow">Statistika dana</span>
        <span className="rc-sub mono">{fmtTc(d.talk).replace(/:\d\d$/, '')} h govora</span>
      </header>
      <div className="pod-st-acts">
        <button className="pod-mini" onClick={onQuotes} title="Izdvojene rečenice ovog dana, kao slika za deljenje">
          ❝ Citati dana
        </button>
        <button className="pod-mini" onClick={onShare} title="Statistika dana kao slika za deljenje">
          ↗ Podeli statistiku
        </button>
      </div>
      <h3>Najduže su govorili</h3>
      {d.top.map(([who, v]) => {
        const p = data.people[who]
        return (
          <button key={who} className="pb-st-who" onClick={() => onPick(who)} style={{ ['--c' as string]: p?.color ?? '#8e98ab' }} title="Prati sve govore ovog govornika">
            <span className="rc-q-ph">{p?.photo ? <img src={`/${p.photo}`} alt="" /> : initials(p?.name ?? who)}</span>
            <span className="pb-st-t">
              <b>{p?.name ?? who}</b>
              <small className="mono">
                {fmtTc(v.dur)} · {v.n}×
              </small>
              <em style={{ width: `${(v.dur / max) * 100}%` }} />
            </span>
          </button>
        )
      })}
      <p className="pb-st-hint">Klik na ime ili na sedište u sali: prati sve govore tog govornika.</p>
      <h3>Vreme po listama</h3>
      <div className="pb-st-bar">
        {d.lists.map(([k, v]) => (
          <i key={k} style={{ background: v.color, width: `${(v.dur / d.talk) * 100}%` }} title={`${k}: ${fmtTc(v.dur)}`} />
        ))}
      </div>
      <div className="pb-st-lists">
        {d.lists.map(([k, v]) => (
          <span key={k}>
            <i style={{ background: v.color }} />
            <span>{k}</span>
            <b>{Math.round((v.dur / d.talk) * 100)} %</b>
          </span>
        ))}
      </div>
    </section>
  )
}

/**
 * Jedan dan: levo statistika dana (ili glasanje koje traje, ili govornik koji se prati) i sala, u sredini snimak sa titlom,
 * desno tekst govora, dole traka. openDay otvara drugi dan (govor praćenog govornika iz drugog dana).
 */
export function Studio({ data, days, openDay }: { data: Traka; days: { id: string; date: string }[]; openDay: (id: string, extra?: Record<string, string>) => void }) {
  const [t0] = useState(() => {
    const g = Number(params().get('govor'))
    const gs = g ? data.speeches.find((x) => x.id === g) : undefined
    return Math.max(0, Math.min(data.total - 1, gs?.at ?? (Number(params().get('t')) || data.speeches[0]?.at || 0)))
  })
  const clock = useMemo(() => {
    const c = new Clock()
    c.t = t0
    return c
  }, [t0])
  const { host, playing, seek, toggle, muted, toggleMute } = usePlayer(data.parts, clock, t0)
  // dolazak sa prethodnog dana dok se prati govornik (?pusti=1): snimak kreće sam čim plejer bude spreman
  const [autoStart, setAutoStart] = useState(() => params().get('pusti') === '1')
  useEffect(() => {
    if (!autoStart) return
    if (playing) return setAutoStart(false)
    let n = 0
    const iv = window.setInterval(() => {
      if (++n > 20) return setAutoStart(false)
      seek(t0, true)
    }, 500)
    return () => clearInterval(iv)
  }, [autoStart, playing, seek, t0])
  const [cur, setCur] = useState(() => Math.max(0, lastAtOrBefore(data.speeches, t0, (s) => s.at)))
  const curRef = useRef(cur)

  useEffect(
    () =>
      clock.on((t) => {
        const i = Math.max(0, lastAtOrBefore(data.speeches, t + 0.05, (s) => s.at))
        if (i !== curRef.current) {
          curRef.current = i
          setCur(i)
        }
      }),
    [clock, data],
  )

  // praćenje jednog govornika: njegovi govori su istaknuti na traci, a snimak posle svakog preskače na njegov sledeći
  const [follow, setFollow] = useState<string | null>(() => {
    const k = params().get('prati')
    return k && data.people[k] ? k : null
  })
  const [autoSkip, setAutoSkip] = useState(true)
  const mine = useMemo(() => (follow ? data.speeches.filter((s) => s.who === follow && s.dur >= MIN_FOLLOW) : []), [data, follow])
  // svi govori po danima (traka-govornici.json): za spisak ostalih dana i za prelazak na sledeći dan
  const [index, setIndex] = useState<WhoIndex | null>(null)
  useEffect(() => {
    if (index) return
    let off = false
    fetch('/data/traka-govornici.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((x: WhoIndex | null) => !off && setIndex(x))
      .catch(() => {})
    return () => {
      off = true
    }
  }, [index])
  /** prvi sledeći dan u kome govornik ima govor (i taj prvi govor) */
  const nextDayOf = useCallback(
    (who: string | null | undefined) => {
      if (!who || !index?.[who]) return null
      const here = days.findIndex((d) => d.id === data.id)
      for (const d of days.slice(here + 1)) {
        const list = index[who].days[d.id]
        if (list?.length) return { id: d.id, date: d.date, first: list[0][0], n: list.length, clock: list[0][3], dur: list[0][2], sum: list[0][4] }
      }
      return null
    },
    [index, days, data],
  )
  const nextDay = useMemo(() => nextDayOf(follow), [nextDayOf, follow])

  // vreme u adresi (za deljenje), kad se zaustavi ili premota
  useEffect(() => {
    if (playing) return
    const u = new URL(window.location.href)
    u.searchParams.set('t', String(Math.floor(clock.t)))
    u.searchParams.delete('govor')
    u.searchParams.delete('pusti')
    if (follow) u.searchParams.set('prati', follow)
    else u.searchParams.delete('prati')
    history.replaceState(null, '', u)
  }, [playing, cur, clock, follow])

  // glasanje se otvara kad glava uđe u njega, ili ga posetilac zakači klikom
  const votes = useMemo(() => data.votes ?? [], [data])
  const [autoVote, setAutoVote] = useState<number | null>(null)
  const [pinVote, setPinVote] = useState<number | null>(null)
  const [closed, setClosed] = useState<number | null>(null)
  useEffect(
    () =>
      clock.on((t) => {
        let i = -1
        votes.forEach((v, k) => {
          if (t >= v.at - 4 && t <= v.end + 30) i = k
        })
        setAutoVote(i < 0 ? null : i)
      }),
    [clock, votes],
  )
  const shownVote = pinVote ?? (autoVote !== closed ? autoVote : null)
  const onVote = useCallback(
    (i: number) => {
      setPinVote(i)
      setClosed(null)
      seek(votes[i].at)
    },
    [seek, votes],
  )
  const seekPlay = useCallback((g: number) => seek(g, true), [seek])

  // kad se govor praćenog govornika završi sam od sebe (ne kad posetilac premota), snimak ide na njegov sledeći govor
  const prevCur = useRef(cur)
  useEffect(() => {
    const was = data.speeches[prevCur.current]
    const now = data.speeches[cur]
    const natural = cur === prevCur.current + 1 && now && clock.t - now.at < 2
    prevCur.current = cur
    if (!follow || !autoSkip || !playing || !natural || was?.who !== follow || now.who === follow) return
    const n = mine.find((s) => s.at > clock.t)
    if (n) seek(n.at, true)
    // nema više njegovih govora ovog dana: nastavlja se njegovim prvim govorom sledećeg dana
    else if (nextDay) openDay(nextDay.id, { govor: String(nextDay.first), prati: follow, pusti: '1' })
  }, [cur, follow, autoSkip, playing, mine, data, clock, seek, nextDay, openDay])
  const startFollow = useCallback(
    (who: string, jump = true) => {
      setFollow(who)
      const list = data.speeches.filter((s) => s.who === who && s.dur >= MIN_FOLLOW)
      const here = data.speeches[curRef.current]
      // ako već govori, ostajemo tu; inače na njegov sledeći (ili prvi) govor
      if (jump && here?.who !== who && list.length) seek((list.find((s) => s.at > clock.t) ?? list[0]).at, true)
    },
    [data, clock, seek],
  )
  const unfollow = useCallback(() => setFollow(null), [])
  const whoOfMp = useCallback((mpId: string) => Object.keys(data.people).find((k) => data.people[k].mp === mpId) ?? null, [data])

  // tačka dnevnog reda o kojoj se sada govori
  const agenda = useMemo(() => data.agenda ?? [], [data])
  const [agI, setAgI] = useState(-1)
  useEffect(() => clock.on((t) => setAgI(lastAtOrBefore(agenda, t + 0.05, (a) => a.at))), [clock, agenda])
  const ag = agenda[agI]

  const spId = data.speeches[cur]?.id
  const marks = useMemo(() => {
    const m = new Set<number>()
    votes.filter((v) => v.sp === spId).forEach((v) => v.marks?.forEach((i) => m.add(i)))
    return m.size ? m : undefined
  }, [votes, spId])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select,summary')) return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seek(clock.t + (e.shiftKey ? 30 : 5))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seek(clock.t - (e.shiftKey ? 30 : 5))
      } else if (e.key === 'm') toggleMute()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [toggle, seek, clock, toggleMute])

  const [mps, setMps] = useState<Mp[]>([])
  const [lists, setLists] = useState<ListInfo[]>([])
  useEffect(() => {
    Promise.all([fetch('/data/mps.json').then((r) => r.json()), fetch('/data/lists.json').then((r) => r.json())])
      .then(([m, l]: [Mp[], ListInfo[]]) => {
        setMps(m)
        setLists(l)
      })
      .catch(() => {})
  }, [])
  const seats = useMemo(() => (mps.length && lists.length ? assignSeats(buildSeats(250), mps, lists) : []), [mps, lists])

  const sp = data.speeches[cur]
  const p = sp ? data.people[sp.who] : undefined

  // deljenje: označen deo govora, rečenica koja se upravo čuje, statistika dana, govornik
  const [share, setShare] = useState<Share | null>(null)
  const [quotes, setQuotes] = useState(false)
  const closeShare = useCallback(() => setShare(null), [])
  const closeQuotes = useCallback(() => setQuotes(false), [])
  const quoteOf = useCallback((s: TSpeech, a: number, b: number) => speechQuote(data, s, a, b), [data])
  const onQuote = useCallback((a: number, b: number) => sp && setShare(quoteOf(sp, a, b)), [sp, quoteOf])
  const shareNow = useCallback(() => {
    if (!sp) return
    // rečenica koja se čuje: red u kome je glava, proširen do početka i kraja rečenice
    const L = sp.lines
    let li = 0
    L.forEach((l, i) => {
      if (sp.at + l.t[0] / 10 <= clock.t + 0.05) li = i
    })
    const ends = (i: number) => /[.!?…]["”)]?$/.test(L[i]?.w[L[i].w.length - 1] ?? '')
    let a = li
    while (a > 0 && !ends(a - 1) && li - a < 3) a--
    let b = li
    while (b < L.length - 1 && !ends(b) && b - li < 3) b++
    const base = (i: number) => L.slice(0, i).reduce((n, l) => n + l.w.length, 0)
    setShare(quoteOf(sp, base(a), base(b + 1) - 1))
  }, [sp, clock, quoteOf])
  const chair = isChair(p)
  const color = p?.color ?? '#8e98ab'
  const vote = shownVote != null ? votes[shownVote] ?? null : null

  const onScrub = useCallback((g: number) => seek(g), [seek])

  // titl preko snimka (pamti se) i ceo ekran: u celom ekranu sala/glasanja ostaju levo, tekst desno, preko snimka
  const [subs, setSubs] = useState(() => {
    try {
      return localStorage.getItem('proba-titl') !== '0'
    } catch {
      return true
    }
  })
  const toggleSubs = useCallback(
    () =>
      setSubs((v) => {
        try {
          localStorage.setItem('proba-titl', v ? '0' : '1')
        } catch {
          /* bez pamćenja */
        }
        return !v
      }),
    [],
  )
  const stage = useRef<HTMLElement>(null)
  // telefon: ceo tekst govora (reč po reč) je sklonjen; reči se vide u titlu na snimku, a tekst se otvara dugmetom
  const [txt, setTxt] = useState(false)
  const [realFs, setFs] = useState(false)
  // kad pregledač ne dozvoli pravi ceo ekran (iPhone, ugrađeni prikaz): isti raspored preko celog prozora
  const [pseudo, setPseudo] = useState(false)
  const fs = realFs || pseudo
  // u celom ekranu svaki prikaz preko snimka može da se skloni
  // na telefonu naredni govori su u celom ekranu podrazumevano sklonjeni (traka bi pokrila donji deo snimka)
  const [hid, setHid] = useState<Record<FsBox, boolean>>(() => ({
    stat: false,
    sala: false,
    tekst: false,
    red: window.matchMedia('(max-width: 760px) and (orientation: landscape), (max-height: 500px)').matches,
  }))
  const flip = (k: FsBox) => setHid((h) => ({ ...h, [k]: !h[k] }))
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px) and (orientation: landscape), (max-height: 500px)')
    const on = () => setHid((h) => ({ ...h, red: mq.matches }))
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // naredni govori (bez predsedavajućeg; uzastopna javljanja istog govornika su jedno)
  const next = useMemo(() => {
    const out: { who: string; at: number; dur: number; clock: string }[] = []
    for (const s of data.speeches.slice(cur + 1)) {
      if (follow ? s.who !== follow || s.dur < MIN_FOLLOW : isChair(data.people[s.who])) continue
      const L = out[out.length - 1]
      if (L && L.who === s.who && !follow) L.dur += s.dur
      else if (out.length >= 6) break
      else out.push({ who: s.who, at: s.at, dur: s.dur, clock: s.clock })
    }
    return out
  }, [data, cur, follow])
  const toggleFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else if (pseudo) setPseudo(false)
    else {
      const el = stage.current
      if (!el?.requestFullscreen) return setPseudo(true)
      el.requestFullscreen().catch(() => setPseudo(true))
      // neki ugrađeni prikazi zahtev ni ne odbiju ni ne ispune
      window.setTimeout(() => !document.fullscreenElement && setPseudo(true), 400)
    }
  }, [pseudo])
  useEffect(() => {
    const on = () => setFs(document.fullscreenElement === stage.current)
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input,textarea,select')) return
      if (e.key === 'f') toggleFs()
      else if (e.key === 'Escape') setPseudo(false)
      else if (e.key === 't') toggleSubs()
    }
    document.addEventListener('fullscreenchange', on)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('fullscreenchange', on)
      window.removeEventListener('keydown', key)
    }
  }, [toggleFs, toggleSubs])

  // klik na sedište poslanika koji tog dana nije govorio: kratka poruka umesto praćenja
  const [noSpeech, setNoSpeech] = useState<string | null>(null)
  useEffect(() => {
    if (!noSpeech) return
    const t = window.setTimeout(() => setNoSpeech(null), 3500)
    return () => clearTimeout(t)
  }, [noSpeech])
  const mpName = (id: string) => mps.find((m) => m.id === id)?.name ?? 'Ovaj poslanik'

  // poslanik koji sada govori (službeni podaci za kocku „Ko govori”)
  const curMp = p?.mp ? mps.find((m) => m.id === p.mp) : undefined

  // sledeći govori onoga ko sada govori (isti dan, bez kratkih upadica)
  const later = useMemo(() => (sp ? data.speeches.filter((x) => x.who === sp.who && x.at > sp.at && x.dur >= MIN_FOLLOW) : []), [data, sp])

  const laterDay = useMemo(() => nextDayOf(sp?.who), [nextDayOf, sp])

  const hall = seats.length > 0 && (
    <HallCard clock={clock} seats={seats} lists={lists} vote={vote?.roll ? vote : null} speakerMp={p?.mp ?? null} chairOn={chair} chairName={chair ? p?.name : undefined} onPlay={seekPlay} onPick={(id) => {
      const k = whoOfMp(id)
      if (k) startFollow(k)
      else setNoSpeech(mpName(id))
    }} />
  )
  const card = vote && (
    <VoteCard
      key={shownVote}
      v={vote}
      data={data}
      clock={clock}
      pinned={pinVote === shownVote}
      hideSeats={!!seats.length}
      onClose={() => {
        setPinVote(null)
        setClosed(shownVote)
      }}
      onPlay={seekPlay}
    />
  )

  return (
    <div className="tka-studio" style={{ ['--c' as string]: color }}>
      <div className="tka-bg" aria-hidden>
        <div key={sp?.who} className="tka-bg-img" style={p?.photo ? { backgroundImage: `url(/${p.photo})` } : undefined} />
        <div className="tka-bg-blob a" />
        <div className="tka-bg-blob b" />
        <div className="tka-bg-grain" />
      </div>

      <main className={`pb-stage${fs ? ' fs' : ''}${pseudo ? ' pseudo' : ''}${fs ? FS_BOXES.filter(([k]) => hid[k]).map(([k]) => ` hide-${k}`).join('') : ''}${subs ? ' subs' : ''}${txt ? ' txt' : ''}`} ref={stage}>
        {/* levo: sala i glasanja (u prozivci sala je gore, sedišta se boje kako ko glasa) */}
        <aside className="pb-left" aria-label="Sala i glasanja">
          {/* gornja kocka: statistika dana, a dok traje glasanje, kvorum ili odluka — prikaz te radnje */}
          {/* odozgo: radnja koja traje (glasanje, kvorum), praćeni govornik, ko sada govori, naredni govori, statistika dana, sala */}
          {card}
          {follow && (
            <FollowCard data={data} who={follow} mine={mine} index={index} nextDay={nextDay} cur={sp?.id ?? -1} days={days} auto={autoSkip} setAuto={setAutoSkip} onSeek={seekPlay} openDay={openDay} onClose={() => setFollow(null)} onShare={() => setShare(personShare(data, follow, days, index))} />
          )}
          {curMp && sp && (
            <WhoCard mp={curMp} list={lists.find((l) => l.key === curMp.list)} role={p?.role}>
              {/* kratko: sledeći govori ovog poslanika tog dana */}
              <div className="pb-wn" style={{ ['--c' as string]: color }}>
                <h3>{later.length ? (later.length === 1 ? 'Njegov sledeći govor' : 'Njegovi sledeći govori') : laterDay ? 'Danas više ne govori' : 'Nema narednih govora'}</h3>
                {later.slice(0, 2).map((x) => (
                  <button key={x.id} onClick={() => seek(x.at, true)} title={x.summary ?? undefined}>
                    <span className="mono">
                      {x.clock} · {fmtTc(x.dur, false)}
                    </span>
                    {x.summary && <span>{x.summary}</span>}
                  </button>
                ))}
                {later.length > 2 && <small>i još {later.length - 2} danas</small>}
                {/* kad danas više nema (ili ostaje samo jedan), sledeći govor je prvi govor narednog dana */}
                {laterDay && later.length < 2 && (
                  <button className="day" onClick={() => openDay(laterDay.id, { govor: String(laterDay.first), pusti: '1' })} title={laterDay.sum || undefined}>
                    <span className="mono">
                      <b>
                        Sledeći dan · {laterDay.date.slice(8, 10)}.{laterDay.date.slice(5, 7)}.
                      </b>{' '}
                      {laterDay.clock} · {fmtTc(laterDay.dur, false)} →
                    </span>
                    {laterDay.sum && <span>{laterDay.sum}</span>}
                  </button>
                )}
              </div>
            </WhoCard>
          )}
          {!follow && !card && <DayStats data={data} onPick={startFollow} onShare={() => setShare(dayShare(data))} onQuotes={() => setQuotes(true)} />}
          {noSpeech && <p className="pb-note">{noSpeech} ovog dana nije govorio/la.</p>}
          {hall}
        </aside>

        {/* sredina: snimak, najveći koji staje */}
        <section className="pb-mid">
          <div className="pb-mid-in">
            {ag && (
              <div className="pb-ag" title={`Tačka ${ag.n} dnevnog reda`}>
                <b>Tačka {ag.n}</b>
                <span>{ag.title}</span>
              </div>
            )}
            <div className="tka-video">
              <div ref={host} className="tka-yt" />
              <button className="tka-shield" onClick={toggle} aria-label={playing ? 'Pauziraj' : 'Pusti snimak'}>
                {!playing && (
                  <span className="tka-play" aria-hidden>
                    <svg viewBox="0 0 24 24" width="30" height="30"><path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" /></svg>
                  </span>
                )}
              </button>
              {sp && (
                <div className="tka-l3" key={sp.id}>
                  <i style={{ background: color }} />
                  {p?.photo && <img src={`/${p.photo}`} alt="" />}
                  <span>
                    <b>{p?.name ?? sp.who}</b>
                    <small>{chair ? p?.role : p?.party ?? p?.list ?? ''}</small>
                    {ag && <em>Tačka {ag.n} · {ag.title}</em>}
                  </span>
                </div>
              )}
              {subs && sp && <Subs key={`t${sp.id}`} sp={sp} clock={clock} />}
              <div className="pb-vbtns">
                <button className={subs ? 'on' : ''} onClick={toggleSubs} aria-pressed={subs} title="Titl preko snimka (t)">
                  Titl
                </button>
                <button onClick={toggleFs} aria-label={fs ? 'Izađi iz celog ekrana' : 'Ceo ekran'} title={fs ? 'Izađi iz celog ekrana (f)' : 'Ceo ekran (f)'}>
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    {fs ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
                  </svg>
                </button>
              </div>
              <button className="tka-mute" onClick={toggleMute} aria-label={muted ? 'Uključi zvuk' : 'Isključi zvuk'} title={muted ? 'Uključi zvuk (m)' : 'Isključi zvuk (m)'}>
                {muted ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M17 9l5 6M22 9l-5 6" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" /><path d="M17 8a5 5 0 010 8M19.5 5.5a9 9 0 010 13" /></svg>
                )}
              </button>
            </div>
            {sp && (
              <div className="tka-meta mono">
                <button className={`pb-follow${follow === sp.who ? ' on' : ''}`} onClick={() => (follow === sp.who ? setFollow(null) : startFollow(sp.who, false))} aria-pressed={follow === sp.who} title="Istakni sve govore ovog govornika i puštaj ih redom">
                  {follow === sp.who ? '✓ Pratiš govornika' : '+ Prati govornika'}
                </button>
                <button className="pod-mini" onClick={shareNow} title="Rečenica koja se upravo čuje, kao slika za deljenje (ili označi deo teksta desno)">
                  ❝ Podeli citat
                </button>
                <button className={`pb-txt${txt ? ' on' : ''}`} onClick={() => setTxt(!txt)} aria-pressed={txt} aria-controls="pb-tekst">
                  {txt ? 'Sakrij tekst' : 'Ceo tekst'}
                </button>
              </div>
            )}
            {sp?.summary && (
              <p className="pb-sum" key={sp.id}>
                {sp.summary}
              </p>
            )}
          </div>
        </section>

        {fs && (
          <>
            <div className="pb-fsbar" role="toolbar" aria-label="Šta se vidi preko snimka">
              {FS_BOXES.map(([k, name]) => (
                <button key={k} className={hid[k] ? '' : 'on'} onClick={() => flip(k)} aria-pressed={!hid[k]}>
                  {name}
                </button>
              ))}
              <button className={subs ? 'on' : ''} onClick={toggleSubs} aria-pressed={subs} title="Titl (t)">
                Titl
              </button>
              <button className="x" onClick={toggleFs} title="Izađi iz celog ekrana (f)">
                Izađi
              </button>
            </div>
            {next.length > 0 && (
              <nav className="pb-next" aria-label="Naredni govori">
                <span className="eyebrow">{follow ? 'Njegovi naredni' : 'Naredni'}</span>
                {next.map((n) => {
                  const np = data.people[n.who]
                  return (
                    <button key={n.at} onClick={() => seek(n.at, true)} style={{ ['--c' as string]: np?.color ?? '#8e98ab' }} title={`${np?.name ?? n.who}${np?.party ? ' · ' + np.party : ''}`}>
                      <span className="rc-q-ph">{np?.photo ? <img src={`/${np.photo}`} alt="" /> : initials(np?.name ?? n.who)}</span>
                      <span>
                        <b>{np?.name ?? n.who}</b>
                        <small className="mono">
                          {n.clock} · {fmtTc(n.dur, false)}
                        </small>
                      </span>
                    </button>
                  )
                })}
              </nav>
            )}
          </>
        )}

        {/* desno: tekst govora reč po reč */}
        <section className="pb-right" id="pb-tekst" aria-label="Tekst govora">
          {sp && <Lyrics sp={sp} clock={clock} onSeek={seekPlay} marks={marks} onQuote={onQuote} />}
        </section>
      </main>

      {share && <ShareSheet key={share.url + share.label} share={share} onClose={closeShare} />}
      {quotes && (
        <QuotesSheet
          data={data}
          onClose={closeQuotes}
          onPick={(x) => {
            setQuotes(false)
            setShare(x)
          }}
        />
      )}
      <Timeline data={data} clock={clock} cur={cur} playing={playing} onSeek={onScrub} onToggle={toggle} onVote={onVote} vote={shownVote} startPps={0.4} agenda={agenda} follow={follow} onUnfollow={unfollow} />
    </div>
  )
}

/** govornik koji se prati: svi njegovi govori ovog dana, pa ostali dani (iz traka-govornici.json) */
function FollowCard({ data, who, mine, index, nextDay, cur, days, auto, setAuto, onSeek, openDay, onClose, onShare }: {
  data: Traka
  who: string
  mine: TSpeech[]
  index: WhoIndex | null
  nextDay: { id: string; date: string; first: number; n: number } | null
  cur: number
  days: { id: string; date: string }[]
  auto: boolean
  setAuto: (v: boolean) => void
  onSeek: (g: number) => void
  openDay: (id: string, extra?: Record<string, string>) => void
  onClose: () => void
  onShare: () => void
}) {
  const p = data.people[who]
  const total = mine.reduce((a, s) => a + s.dur, 0)
  const other = days.filter((d) => d.id !== data.id && index?.[who]?.days[d.id]?.length)
  const curEl = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // u novijim pregledačima scrollIntoView vraća Promise, a efekat sme da vrati samo funkciju
    curEl.current?.scrollIntoView({ block: 'nearest' })
  }, [cur])
  return (
    <section className="rc pb-fw" style={{ ['--c' as string]: p?.color ?? '#8e98ab' }}>
      <header>
        <span className="eyebrow">Pratiš govornika</span>
        <button className="pod-mini" onClick={onShare} title="Govornik u brojevima, kao slika za deljenje" style={{ marginLeft: 'auto' }}>
          ↗ Podeli
        </button>
        <button className="vc-x" onClick={onClose} aria-label="Prekini praćenje" title="Prekini praćenje">
          ×
        </button>
      </header>
      <div className="pb-fw-top">
        <span className="rc-q-ph">{p?.photo ? <img src={`/${p.photo}`} alt="" /> : initials(p?.name ?? who)}</span>
        <div>
          <b>{p?.name ?? who}</b>
          <small>{p?.party ?? p?.list ?? p?.role ?? ''}</small>
        </div>
      </div>
      <div className="pb-fw-nums mono">
        {mine.length} {mine.length === 1 ? 'govor' : 'govora'} danas · {fmtTc(total)}
        {index?.[who] && other.length > 0 && <> · ukupno {fmtTc(index[who].sec)}</>}
      </div>
      <label className="pb-fw-auto">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Posle svakog govora pusti njegov sledeći{nextDay ? ', i sledećeg dana' : ''}
      </label>
      {nextDay && (
        <button className="pb-fw-next" onClick={() => openDay(nextDay.id, { govor: String(nextDay.first), prati: who, pusti: '1' })}>
          Sledeći dan ({nextDay.date.slice(8, 10)}.{nextDay.date.slice(5, 7)}.) · {nextDay.n} {nextDay.n === 1 ? 'govor' : 'govora'} →
        </button>
      )}
      <div className="pb-fw-list">
        {mine.length === 0 && <p className="pb-note">Ovog dana nema govora dužih od {MIN_FOLLOW} sekundi.</p>}
        {mine.map((s) => (
          <button key={s.id} ref={s.id === cur ? curEl : undefined} className={s.id === cur ? 'on' : ''} onClick={() => onSeek(s.at)}>
            <span className="mono">
              {s.clock} · {fmtTc(s.dur, false)}
            </span>
            {s.summary && <span>{s.summary}</span>}
          </button>
        ))}
        {other.map((d) => {
          const list = index![who].days[d.id]
          return (
            <div key={d.id}>
              <h3>
                {d.date.slice(8, 10)}.{d.date.slice(5, 7)}. · {list.length} {list.length === 1 ? 'govor' : 'govora'}
              </h3>
              {list.map(([id, , dur, clock, sum]) => (
                <button key={id} onClick={() => openDay(d.id, { govor: String(id), prati: who, pusti: '1' })}>
                  <span className="mono">
                    {clock} · {fmtTc(dur, false)}
                  </span>
                  {sum && <span>{sum}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}
