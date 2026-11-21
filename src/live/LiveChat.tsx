import { useEffect, useMemo, useRef, useState } from 'react'
import { track } from '../analytics'
import { publishUdarci, udarciParam, type Udarci } from './udarci'

/** Chat na strani uživo (server/chat.ts): bez naloga, nadimak se pamti u pregledaču, provera na 3 s. */

type Msg = { id: number; t: number; name: string; text: string; admin?: boolean; sys?: boolean }
type Reacts = { c: Record<string, number>; m: string | null }
const REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍', '💩', '🇷🇸', '3']
// zastava i crveni broj 3 se crtaju sami (Windows zastave prikazuje kao slova „RS”)
const Emo = ({ e }: { e: string }) =>
  e === '🇷🇸' ? (
    <svg className="lc-emo-flag" viewBox="0 0 18 12" aria-label="zastava Srbije" role="img"><rect width="18" height="4" fill="#C6363C" /><rect y="4" width="18" height="4" fill="#0C4076" /><rect y="8" width="18" height="4" fill="#fff" /></svg>
  ) : e === '3' ? (
    <span className="lc-emo-3" aria-label="tri">3</span>
  ) : (
    <>{e}</>
  )
type Poll = { id: string; q: string; options: string[]; open: boolean; counts: number[]; total: number; mine: number | null }
// na 5 s, i samo dok je strana vidljiva (stotine gledalaca × jedan zahtev; isti zahtev donosi i čekiće i srca)
const POLL = 5000
const NAME_KEY = 'skupstina-nadimak'
const CLIENT_KEY = 'skupstina-klijent'

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* bez pamćenja */
    }
  },
}
const clientId = (() => {
  let k = store.get(CLIENT_KEY)
  if (!k) {
    k = Math.random().toString(36).slice(2, 12)
    store.set(CLIENT_KEY, k)
  }
  return k
})()
const BLOCK_KEY = 'skupstina-chat-sakriveni'
const ERR: Record<string, string> = {
  rate: 'Polako: jedna poruka na nekoliko sekundi.',
  rate_window: 'Poslao si mnogo poruka za kratko vreme. Sačekaj malo pa nastavi.',
  link: 'Linkovi nisu dozvoljeni.',
  long: 'Poruka je preduga (najviše 300 znakova).',
  empty: 'Poruka je prazna.',
  name: 'Taj nadimak je rezervisan. Izaberi drugi.',
  taken: 'Taj nadimak već koristi neko drugi u chatu. Izaberi drugi.',
}
/** tekst poruke sa istaknutim @nadimcima (poznati nadimci iz chata, najduži prvi, pa i oni sa razmakom) */
function withMentions(text: string, names: string[], me: string) {
  const lower = text.toLowerCase()
  const out: React.ReactNode[] = []
  let i = 0
  let last = 0
  while ((i = lower.indexOf('@', i)) !== -1) {
    const n = names.find((x) => lower.startsWith(x.toLowerCase(), i + 1))
    if (!n) {
      i++
      continue
    }
    if (i > last) out.push(text.slice(last, i))
    const mine = !!me && n.toLowerCase() === me.toLowerCase()
    out.push(<span key={i} className={`lc-at ${mine ? 'me' : ''}`}>@{text.slice(i + 1, i + 1 + n.length)}</span>)
    i += 1 + n.length
    last = i
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
/** linkovi u obaveštenju i porukama admina: samo http(s) ili goli domen, otvaraju se u novoj kartici */
const URL_RE = /\b(https?:\/\/[^\s<>"]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|rs|live|io|me|info)(?:\/[^\s<>"]*)?)/gi
function linkify(text: string) {
  const out: React.ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0]
    const trail = /[.,!?;:)\]]+$/.exec(raw)?.[0] ?? ''
    raw = raw.slice(0, raw.length - trail.length)
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    out.push(
      <a key={i} href={href} target="_blank" rel="noopener noreferrer nofollow" className="lc-link">
        {raw.replace(/^https?:\/\//i, '')}
      </a>,
    )
    last = i + raw.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
const hhmm = (t: number) => new Date(t).toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' })
// ista boja za isti nadimak (samo radi lakšeg praćenja razgovora)
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)

export function LiveChat({ ytViewers }: { ytViewers: number | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [online, setOnline] = useState<number | null>(null)
  const [name, setName] = useState(() => store.get(NAME_KEY) ?? '')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [down, setDown] = useState(false)
  // reakcije: id -> broj po emojiju + moja; own: moje poruke (na njih ne mogu da reagujem)
  const [reacts, setReacts] = useState<Record<number, Reacts>>({})
  const [picker, setPicker] = useState<number | null>(null)
  const [own, setOwn] = useState<Set<number>>(new Set())
  const [sticky, setSticky] = useState<{ text: string; t: number } | null>(null)
  const [poll, setPoll] = useState<Poll | null>(null)
  // skupljeno obaveštenje / anketa (po sadržaju: novo obaveštenje ili nova anketa se opet prikažu)
  const [foldedSticky, setFoldedSticky] = useState(() => store.get('skupstina-chat-obavestenje') ?? '')
  const [foldedPoll, setFoldedPoll] = useState(() => store.get('skupstina-chat-anketa') ?? '')
  // nadimci koje je ovaj gledalac sakrio (samo u njegovom pregledaču)
  const [blocked, setBlocked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(store.get(BLOCK_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const setBlock = (n: Set<string>) => {
    setBlocked(n)
    store.set(BLOCK_KEY, JSON.stringify([...n]))
  }
  // @označavanje: predlozi nadimaka dok se kuca posle @
  const [at, setAt] = useState<{ q: string; from: number } | null>(null)
  const [atSel, setAtSel] = useState(0)
  const textRef = useRef<HTMLInputElement>(null)
  const last = useRef(0)
  const list = useRef<HTMLDivElement>(null)
  // da li je čitalac pri dnu: samo tada nova poruka spušta chat; ko skroluje gore, ostaje gde je
  const stick = useRef(true)
  const [unread, setUnread] = useState(0)
  const seenCount = useRef(0) // id najnovije viđene poruke
  const lastTop = useRef(0)

  useEffect(() => {
    let alive = true
    let busy = false
    const tick = async () => {
      if (document.hidden || busy) return
      busy = true
      try {
        const r = await fetch(`/api/chat?posle=${last.current}&k=${clientId}${udarciParam()}`, { cache: 'no-store' })
        if (!r.ok) throw new Error(String(r.status))
        const d = (await r.json()) as { messages: Msg[]; online: number; hidden: number[]; reactions?: Record<number, Reacts>; own?: number[]; sticky?: { text: string; t: number } | null; poll?: Poll | null; udarci?: Udarci }
        if (!alive) return
        publishUdarci(d.udarci)
        setDown(false)
        setOnline(d.online)
        setReacts(d.reactions ?? {})
        setOwn(new Set(d.own ?? []))
        setSticky(d.sticky ?? null)
        setPoll(d.poll ?? null)
        const hid = new Set(d.hidden)
        setMsgs((old) => {
          const known = new Set(old.map((m) => m.id))
          const merged = [...old.filter((m) => !hid.has(m.id)), ...d.messages.filter((m) => !known.has(m.id))]
          return merged.slice(-200)
        })
        if (d.messages.length) last.current = Math.max(last.current, ...d.messages.map((m) => m.id))
      } catch {
        if (alive) setDown(true)
      } finally {
        busy = false
      }
    }
    void tick()
    const t = setInterval(tick, POLL)
    // vraćen na tab: odmah osveži, ne čekaj sledeći krug
    const vis = () => void (!document.hidden && tick())
    document.addEventListener('visibilitychange', vis)
    return () => {
      alive = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  const toBottom = () => {
    const el = list.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    lastTop.current = el.scrollTop
    stick.current = true
    setUnread(0)
  }
  // nova poruka: dole ako je čitalac bio pri dnu, inače samo brojač „nove poruke”
  // (broji se po id-u, ne po dužini niza: lista je ograničena na 200 pa dužina prestane da raste)
  useEffect(() => {
    const prev = seenCount.current
    const newest = msgs.length ? msgs[msgs.length - 1].id : 0
    seenCount.current = Math.max(prev, newest)
    if (stick.current) toBottom()
    else if (prev) {
      const added = msgs.filter((m) => m.id > prev).length
      if (added > 0) setUnread((n) => n + added)
    }
  }, [msgs])
  // visina se menja i bez nove poruke: reakcije, anketa, obaveštenje, emodži/slike, prelom reda,
  // okrenut telefon. Ko je bio na dnu, ostaje na dnu.
  useEffect(() => {
    const el = list.current
    if (!el) return
    const pin = () => {
      // čitalac je upravo skrolovao gore, a scroll događaj još nije stigao: ne vraćaj ga dole
      // (sadržaj koji se skupi isto spusti scrollTop, ali tada je lista i dalje na dnu)
      if (stick.current && el.scrollTop < lastTop.current - 2 && el.scrollHeight - el.scrollTop - el.clientHeight >= 60) stick.current = false
      if (!stick.current) return
      el.scrollTop = el.scrollHeight
      lastTop.current = el.scrollTop
    }
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(pin) : null
    mo?.observe(el, { childList: true, subtree: true, characterData: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(pin) : null
    ro?.observe(el)
    el.addEventListener('load', pin, true)
    return () => {
      mo?.disconnect()
      ro?.disconnect()
      el.removeEventListener('load', pin, true)
    }
  }, [])

  const names = useMemo(() => {
    const seen = new Map<string, string>()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const n = msgs[i].admin ? 'admin' : msgs[i].name
      if (n && n !== 'Gost' && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n)
    }
    return [...seen.values()]
  }, [msgs])
  const byLength = useMemo(() => [...names].sort((a, b) => b.length - a.length), [names])
  const me = name.trim()
  const sugg = at ? names.filter((n) => n.toLowerCase() !== me.toLowerCase() && n.toLowerCase().startsWith(at.q.toLowerCase())).slice(0, 6) : []
  const onText = (v: string, caret: number) => {
    setText(v)
    const m = /(^|\s)@([^\s@]{0,24})$/.exec(v.slice(0, caret))
    setAt(m ? { q: m[2], from: caret - m[2].length - 1 } : null)
    setAtSel(0)
  }
  const pickName = (n: string) => {
    if (!at) return
    const caret = textRef.current?.selectionStart ?? text.length
    const v = text.slice(0, at.from) + '@' + n + ' ' + text.slice(caret)
    setText(v.slice(0, 300))
    setAt(null)
    requestAnimationFrame(() => {
      const el = textRef.current
      if (el) {
        el.focus()
        const c = at.from + n.length + 2
        el.setSelectionRange(c, c)
      }
    })
  }

  /** klik na nadimak: „@nadimak ” u polje za poruku */
  const mention = (n: string) => {
    if (n === 'Gost' || n.toLowerCase() === me.toLowerCase()) return
    setText((t) => (t.includes('@' + n) ? t : `${t}${t && !t.endsWith(' ') ? ' ' : ''}@${n} `).slice(0, 300))
    textRef.current?.focus()
  }

  // ista reakcija još jednom = povuci; druga = zameni (kao na Instagramu, jedna po osobi)
  const react = async (id: number, e: string) => {
    setPicker(null)
    const cur = reacts[id]?.m ?? null
    const next = cur === e ? null : e
    setReacts((o) => {
      const c = { ...(o[id]?.c ?? {}) }
      if (cur) c[cur] = Math.max(0, (c[cur] ?? 1) - 1)
      if (next) c[next] = (c[next] ?? 0) + 1
      return { ...o, [id]: { c, m: next } }
    })
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ react: id, e: next, k: clientId }) })
      const d = (await r.json()) as { ok?: boolean; reactions?: Reacts }
      if (d.ok && d.reactions) setReacts((o) => ({ ...o, [id]: d.reactions! }))
      if (next) track('chat-reakcija', { e: next })
    } catch {
      /* sledeća provera vraća stanje sa servera */
    }
  }
  const vote = async (opt: number) => {
    if (!poll || poll.mine != null || !poll.open) return
    setPoll({ ...poll, mine: opt, counts: poll.counts.map((c, i) => (i === opt ? c + 1 : c)), total: poll.total + 1 })
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ poll: poll.id, option: opt, k: clientId }) })
      const d = (await r.json()) as { ok?: boolean; poll?: Poll }
      if (d.poll) setPoll(d.poll)
      track('chat-glasanje')
    } catch {
      /* sledeća provera vraća stanje */
    }
  }

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    setErr(null)
    // jedan zahtev sa rokom od 10 s (bez roka bi dugme ostalo zaključano kad veza zapne)
    const post = async () => {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 10_000)
      try {
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), text: t, k: clientId }),
          signal: ac.signal,
        })
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: Msg; error?: string; wait?: number }
        return { ok: r.ok && !!d.ok && !!d.message, d }
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      let { ok, d } = await post()
      // „rate” sa čekanjem do 2 s (više ljudi na istoj adresi u istoj sekundi): sačekaj i pošalji sam još jednom
      if (!ok && d.error === 'rate' && (d.wait ?? 9) <= 2) {
        await new Promise((r) => setTimeout(r, (d.wait ?? 1) * 1000 + 150))
        ;({ ok, d } = await post())
      }
      if (!ok || !d.message) {
        const w = d.wait && d.wait > 2 ? ` Možeš ponovo za ${d.wait < 90 ? `${d.wait} s` : `${Math.ceil(d.wait / 60)} min`}.` : ''
        setErr((ERR[d.error ?? ''] ?? 'Poruka nije poslata. Pokušaj ponovo.') + w)
        return
      }
      const m = d.message
      setOwn((o) => new Set(o).add(m.id))
      setMsgs((old) => (old.some((x) => x.id === m.id) ? old : [...old, m]))
      setText('')
      stick.current = true
      track('chat-poruka')
    } catch {
      setErr('Poruka nije poslata (veza je zapela). Pokušaj ponovo.')
    } finally {
      setSending(false)
    }
  }
  const stickyKey = sticky ? String(sticky.t) : ''
  const shown = blocked.size ? msgs.filter((m) => m.admin || !blocked.has(m.name.toLowerCase())) : msgs

  return (
    <div className="lc">
      <div className="lv-chat-head">
        <b>Chat</b>
        <span>
          {online != null && <><b>{online.toLocaleString('sr-Latn-RS')}</b> na sajtu</>}
          {ytViewers != null && <> · <b>{ytViewers.toLocaleString('sr-Latn-RS')}</b> na YouTube-u</>}
        </span>
      </div>
      {sticky && foldedSticky !== stickyKey && (
        <div className="lc-sticky" role="note">
          <span className="lc-sticky-tag">Obaveštenje</span>
          <p>{linkify(sticky.text)}</p>
          <button type="button" className="lc-fold" aria-label="Skloni obaveštenje" title="Skloni" onClick={() => { setFoldedSticky(stickyKey); store.set('skupstina-chat-obavestenje', stickyKey) }}>×</button>
        </div>
      )}
      {poll && foldedPoll === poll.id && (
        <button type="button" className="lc-poll-mini" onClick={() => { setFoldedPoll(''); store.set('skupstina-chat-anketa', '') }}>
          <span className="lc-sticky-tag">{poll.open ? 'Glasanje' : 'Glasanje završeno'}</span> <b>{poll.q}</b> <em>prikaži</em>
        </button>
      )}
      {poll && foldedPoll !== poll.id && (
        <div className="lc-poll">
          <div className="lc-poll-q">
            <span className="lc-sticky-tag">{poll.open ? 'Anonimno glasanje' : 'Glasanje je završeno'}</span>
            <b>{poll.q}</b>
            <button type="button" className="lc-fold" aria-label="Skloni glasanje" title="Skloni (ostaje jedan red iznad poruka)" onClick={() => { setFoldedPoll(poll.id); store.set('skupstina-chat-anketa', poll.id) }}>×</button>
          </div>
          {poll.options.map((o, i) => {
            const showRes = poll.mine != null || !poll.open
            const pct = poll.total ? Math.round((poll.counts[i] / poll.total) * 100) : 0
            return showRes ? (
              <div key={i} className={`lc-poll-res ${poll.mine === i ? 'mine' : ''}`}>
                <i style={{ width: `${pct}%` }} aria-hidden />
                <span>{o}{poll.mine === i ? ' ✓' : ''}</span>
                <em>{pct}%</em>
              </div>
            ) : (
              <button key={i} type="button" className="lc-poll-opt" onClick={() => void vote(i)}>{o}</button>
            )
          })}
          <p className="lc-poll-note">{poll.total.toLocaleString('sr-Latn-RS')} {poll.total === 1 ? 'glas' : 'glasova'} · niko ne vidi ko je za šta glasao{poll.mine == null && poll.open ? ' · rezultat posle glasanja' : ''}</p>
        </div>
      )}
      <div
        className="lc-list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          // odlepi se samo kad čitalac sam skroluje gore; sadržaj koji naraste ispod ne menja scrollTop
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
          if (atBottom) {
            stick.current = true
            setUnread(0)
          } else if (el.scrollTop < lastTop.current - 2) stick.current = false
          lastTop.current = el.scrollTop
        }}
      >
        {shown.length === 0 && <p className="lv-note">{down ? 'Chat trenutno nije dostupan.' : 'Još nema poruka. Napiši prvu.'}</p>}
        {shown.map((m) =>
          m.sys ? (
            <div key={m.id} className="lc-msg lc-sys">
              <span className="mono">{hhmm(m.t)}</span> <b style={{ color: `hsl(${hue(m.name)} 70% 72%)` }}>{m.name}</b> {m.text}
            </div>
          ) : (
          <div key={m.id} className={`lc-msg ${m.admin ? 'lc-admin' : ''} ${me && m.name !== me && m.text.toLowerCase().includes('@' + me.toLowerCase()) ? 'lc-mine' : ''}`}>
            <span className="mono">{hhmm(m.t)}</span>{' '}
            {m.admin ? <b className="lc-admin-name">admin <span className="lc-badge">✓</span></b> : <b className="lc-nick" style={{ color: `hsl(${hue(m.name)} 70% 72%)` }} title="Klikni da označiš (@)" onClick={() => mention(m.name)}>{m.name}</b>} {m.admin ? linkify(m.text) : withMentions(m.text, byLength, me)}
            {!own.has(m.id) && (
              <button type="button" className={`lc-react-add ${picker === m.id ? 'on' : ''}`} onClick={() => setPicker(picker === m.id ? null : m.id)} aria-label="Reaguj" title="Reaguj">
                <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="7.4" cy="8.3" r="1" fill="currentColor" /><circle cx="12.6" cy="8.3" r="1" fill="currentColor" /><path d="M6.9 11.6c.8 1.3 1.8 1.9 3.1 1.9s2.3-.6 3.1-1.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </button>
            )}
            {picker === m.id && (
              <div className="lc-picker" role="menu" aria-label="Izaberi reakciju">
                {REACTIONS.map((e) => (
                  <button key={e} type="button" role="menuitem" className={reacts[m.id]?.m === e ? 'on' : ''} onClick={() => void react(m.id, e)}><Emo e={e} /></button>
                ))}
                {!m.admin && m.name !== 'Gost' && (
                  <button type="button" role="menuitem" className="lc-block" title={`Ne prikazuj mi poruke nadimka ${m.name}`} onClick={() => {
                    setPicker(null)
                    setBlock(new Set(blocked).add(m.name.toLowerCase()))
                    track('chat-sakrij')
                  }}>Sakrij</button>
                )}
              </div>
            )}
            {(() => {
              const r = reacts[m.id]
              const list = r ? REACTIONS.filter((e) => (r.c[e] ?? 0) > 0) : []
              if (!list.length) return null
              const isOwn = own.has(m.id)
              return (
                <div className="lc-chips">
                  {list.map((e) => (
                    <button key={e} type="button" className={r!.m === e ? 'on' : ''} disabled={isOwn} onClick={() => void react(m.id, e)} title={isOwn ? 'Reakcije na tvoju poruku' : r!.m === e ? 'Povuci reakciju' : 'Reaguj isto'}>
                      <Emo e={e} /><b>{r!.c[e]}</b>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
          ),
        )}
      </div>
      {unread > 0 && (
        <button type="button" className="lc-new" onClick={toBottom}>
          ↓ {unread === 1 ? 'Nova poruka' : `Nove poruke (${unread})`}
        </button>
      )}
      <form className="lc-form" onSubmit={send}>
        <input
          className="lc-name"
          placeholder="Nadimak"
          maxLength={24}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            store.set(NAME_KEY, e.target.value)
          }}
          aria-label="Nadimak"
        />
        <div className="lc-row">
          {sugg.length > 0 && (
            <ul className="lc-sugg" role="listbox" aria-label="Označi nadimak">
              {sugg.map((n, i) => (
                <li key={n} role="option" aria-selected={i === atSel}>
                  <button type="button" className={i === atSel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pickName(n) }}>
                    @<b style={{ color: `hsl(${hue(n)} 70% 72%)` }}>{n}</b>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={textRef}
            className="lc-text"
            placeholder="Napiši poruku… (@ za označavanje)"
            maxLength={300}
            value={text}
            onChange={(e) => onText(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (!sugg.length) return
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setAtSel((i) => (i + (e.key === 'ArrowDown' ? 1 : sugg.length - 1)) % sugg.length)
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pickName(sugg[Math.min(atSel, sugg.length - 1)])
              } else if (e.key === 'Escape') setAt(null)
            }}
            onBlur={() => setTimeout(() => setAt(null), 150)}
            aria-label="Poruka"
          />
          <button type="submit" disabled={sending || !text.trim()}>Pošalji</button>
        </div>
        {err && <p className="lc-err" role="alert">{err}</p>}
        {blocked.size > 0 && (
          <p className="lv-note lc-blocked">
            Sakriveno nadimaka: {blocked.size} · <button type="button" onClick={() => setBlock(new Set())}>prikaži sve</button>
          </p>
        )}
        <p className="lv-note">Bez uvreda i linkova. Poruke koje krše pravila brišemo. Ne deli lične podatke.</p>
      </form>
    </div>
  )
}
