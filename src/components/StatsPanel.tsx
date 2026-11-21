import { motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ListInfo, Mp, Session, SessionMeta, SpeechEvent } from '../types'

/** Statistika svih praćenih dana: ko je koliko govorio, liste naspram mandata, po danima, dužina govora, tok dana.
 *  Sve brojke se računaju iz istih podataka kao sala (vreme iz snimka, reči iz transkripta). */

type Row = { sid: string; day: string; e: SpeechEvent; sec: number; key: string; name: string; chair: boolean; mp?: Mp; list?: ListInfo }
type Tip = { x: number; y: number; body: ReactNode } | null

const dayNo = (id: string) => id.match(/-d(\d+)$/)?.[1] ?? ''
const fmtMin = (sec: number) => {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`
}
const nf = (n: number) => n.toLocaleString('sr-Latn-RS')
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`

export function StatsPanel({ sessions, days, mps, lists, chairColor, onClose, onSpeech, page = false }: {
  sessions: Session[]
  days: SessionMeta[]
  mps: Mp[]
  lists: ListInfo[]
  chairColor: string
  onClose: () => void
  onSpeech: (sessionId: string, eventId: number) => void
  /** stranica umesto sale (u <main className="stage">), a ne prozor preko nje */
  page?: boolean
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const [tip, setTip] = useState<Tip>(null)
  const [dayFilter, setDayFilter] = useState<string>('sve')

  const mpById = useMemo(() => new Map(mps.map((m) => [m.id, m])), [mps])
  const listByKey = useMemo(() => new Map(lists.map((l) => [l.key, l])), [lists])
  const ordered = useMemo(() => [...sessions].sort((a, b) => a.date.localeCompare(b.date)), [sessions])

  const allRows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const s of ordered) {
      const sp = new Map(s.speakers.map((x) => [x.key, x]))
      for (const e of s.events) {
        if (e.type !== 'speech') continue
        const who = sp.get(e.speaker)
        const mp = who?.mp_id ? mpById.get(who.mp_id) : undefined
        out.push({
          sid: s.id, day: `Dan ${dayNo(s.id)}`, e, sec: e.vdur ?? e.dur * 60,
          key: mp?.id ?? (who?.name ?? e.speaker).toUpperCase(), name: who?.name ?? e.speaker, chair: !!who?.role,
          mp, list: mp ? listByKey.get(mp.list) : undefined,
        })
      }
    }
    return out
  }, [ordered, mpById, listByKey])
  const rows = useMemo(() => (dayFilter === 'sve' ? allRows : allRows.filter((r) => r.sid === dayFilter)), [allRows, dayFilter])

  const colorOf = (r: { chair: boolean; list?: ListInfo }) => (r.chair ? chairColor : r.list?.color ?? '#8E98AB')

  const total = useMemo(() => {
    const sec = rows.reduce((a, r) => a + r.sec, 0)
    const words = rows.reduce((a, r) => a + r.e.words, 0)
    const people = new Set(rows.map((r) => r.key))
    const mpsSpoke = new Set(rows.filter((r) => r.mp).map((r) => r.mp!.id))
    return { sec, words, speeches: rows.length, people: people.size, mpsSpoke: mpsSpoke.size }
  }, [rows])

  // po osobi (predsedavanje se broji odvojeno od govora sa poslaničkog mesta)
  const people = useMemo(() => {
    const m = new Map<string, { key: string; name: string; chair: boolean; list?: ListInfo; sec: number; words: number; n: number }>()
    for (const r of rows) {
      const k = r.key + (r.chair ? '#chair' : '')
      const p = m.get(k) ?? { key: k, name: r.name, chair: r.chair, list: r.list, sec: 0, words: 0, n: 0 }
      p.sec += r.sec; p.words += r.e.words; p.n += 1
      m.set(k, p)
    }
    return [...m.values()].sort((a, b) => b.sec - a.sec)
  }, [rows])
  const top = people.filter((p) => !p.chair).slice(0, 10)
  const chairSec = people.filter((p) => p.chair).reduce((a, p) => a + p.sec, 0)

  // liste: udeo u vremenu govora (bez predsedavanja) naspram udela u mandatima
  const byList = useMemo(() => {
    const seats = lists.reduce((a, l) => a + l.seats, 0)
    const spoken = rows.filter((r) => !r.chair)
    const tot = spoken.reduce((a, r) => a + r.sec, 0) || 1
    const res = lists.map((l) => ({ l, time: spoken.filter((r) => r.list?.key === l.key).reduce((a, r) => a + r.sec, 0) / tot, seats: l.seats / seats }))
    const other = spoken.filter((r) => !r.list).reduce((a, r) => a + r.sec, 0) / tot
    return { res, other }
  }, [rows, lists])

  const perDay = useMemo(() => ordered.map((s) => {
    const rs = allRows.filter((r) => r.sid === s.id)
    const meta = days.find((d) => d.id === s.id)
    return { s, meta, n: rs.length, sec: rs.reduce((a, r) => a + r.sec, 0), words: rs.reduce((a, r) => a + r.e.words, 0) }
  }), [ordered, allRows, days])
  const maxDaySec = Math.max(1, ...perDay.map((d) => d.sec))

  const BUCKETS: [string, number, number][] = [['<1', 0, 60], ['1–3', 60, 180], ['3–5', 180, 300], ['5–10', 300, 600], ['10–20', 600, 1200], ['20+', 1200, 1e9]]
  const hist = BUCKETS.map(([label, a, b]) => ({ label, n: rows.filter((r) => !r.chair && r.sec >= a && r.sec < b).length }))
  const maxHist = Math.max(1, ...hist.map((h) => h.n))

  // tok dana: minuti govora po satu (zbir izabranih dana)
  const hours = useMemo(() => {
    const h = new Map<number, number>()
    for (const r of rows) {
      let t = r.e.t * 60, left = r.sec
      while (left > 0) {
        const hr = Math.floor(t / 3600)
        const take = Math.min(left, (hr + 1) * 3600 - t)
        h.set(hr, (h.get(hr) ?? 0) + take)
        t += take; left -= take
      }
    }
    const ks = [...h.keys()]
    if (!ks.length) return []
    const out = []
    for (let k = Math.min(...ks); k <= Math.max(...ks); k++) out.push({ hr: k, sec: h.get(k) ?? 0 })
    return out
  }, [rows])
  const maxHour = Math.max(1, ...hours.map((h) => h.sec))

  const nonChair = rows.filter((r) => !r.chair)
  const longest = [...nonChair].sort((a, b) => b.sec - a.sec)[0]
  const mostTurns = people.filter((p) => !p.chair).sort((a, b) => b.n - a.n)[0]
  const pace = people.filter((p) => !p.chair && p.sec >= 300).map((p) => ({ ...p, wpm: p.words / (p.sec / 60) })).sort((a, b) => b.wpm - a.wpm)
  const median = (() => {
    const xs = nonChair.map((r) => r.sec).sort((a, b) => a - b)
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0
  })()

  const showTip = (ev: React.MouseEvent, body: ReactNode) => setTip({ x: ev.clientX, y: ev.clientY, body })
  const hideTip = () => setTip(null)

  return (
    page ? (
      <motion.div className="stats-page" role="region" aria-label="Statistika" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <div className="news about stats">
        <button className="st-back" onClick={onClose}>← Nazad na salu</button>
        <header className="news-head">
          <div className="eyebrow">Skupština live · 15. saziv</div>
          <h2>Statistika</h2>
          <p>Izračunato iz istih podataka kao sala: trajanje iz snimka, reči iz transkripta. Dani sa automatskim transkriptom mogu imati greške u podeli na govornike.</p>
        </header>

        <div className="st-filter" role="tablist" aria-label="Dani">
          {[{ id: 'sve', label: 'Svi dani' }, ...perDay.map((d) => ({ id: d.s.id, label: `Dan ${dayNo(d.s.id)}${d.meta?.status === 'live' ? ' · uživo' : ''}` }))].map((x) => (
            <button key={x.id} role="tab" aria-selected={dayFilter === x.id} className={dayFilter === x.id ? 'on' : ''} onClick={() => setDayFilter(x.id)}>{x.label}</button>
          ))}
        </div>

        <div className="st-tiles">
          <Tile value={fmtMin(total.sec)} label="govora ukupno" />
          <Tile value={nf(total.speeches)} label="javljanja za reč" />
          <Tile value={nf(total.words)} label="izgovorenih reči" />
          <Tile value={`${total.mpsSpoke} / ${mps.length}`} label="poslanika je govorilo" />
          <Tile value={pct(chairSec / (total.sec || 1))} label="vremena je predsedavajući" />
          <Tile value={fmtMin(median)} label="tipičan govor (medijana)" />
        </div>

        <section className="st-sec">
          <h3>Ko je najduže govorio</h3>
          <p className="st-note">Ukupno vreme sa poslaničkog mesta (bez predsedavanja), deset najdužih.</p>
          <div className="st-bars">
            {top.map((p) => (
              <div key={p.key} className="st-row" onMouseMove={(ev) => showTip(ev, <><b>{p.name}</b><br />{p.list?.name ?? 'van poslaničkih lista'}<br />{fmtMin(p.sec)} · {nf(p.words)} reči · {p.n} javljanja</>)} onMouseLeave={hideTip}>
                <span className="st-label">{p.name}<small>{p.list?.name ?? ''}</small></span>
                <span className="st-track"><span className="st-bar" style={{ width: `${(p.sec / (top[0]?.sec || 1)) * 100}%`, background: colorOf(p) }} /></span>
                <span className="st-val">{fmtMin(p.sec)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="st-sec">
          <h3>Vreme govora naspram broja mandata</h3>
          <p className="st-note">Za svaku listu: udeo u ukupnom vremenu govora (puna traka) i udeo u 250 mandata (obrub). Predsedavanje nije uračunato.</p>
          <div className="st-legend"><span><i className="st-key solid" />vreme govora</span><span><i className="st-key outline" />mandati</span></div>
          <div className="st-bars">
            {byList.res.map(({ l, time, seats }) => (
              <div key={l.key} className="st-row st-pair" onMouseMove={(ev) => showTip(ev, <><b>{l.full}</b><br />vreme govora: {pct(time)}<br />mandati: {l.seats} ({pct(seats)})</>)} onMouseLeave={hideTip}>
                <span className="st-label">{l.name}<small>{l.seats} mandata</small></span>
                <span className="st-track st-two">
                  <span className="st-bar" style={{ width: `${time * 100}%`, background: l.color }} />
                  <span className="st-bar st-out" style={{ width: `${seats * 100}%`, borderColor: l.color }} />
                </span>
                <span className="st-val">{pct(time)}<small>{pct(seats)}</small></span>
              </div>
            ))}
            {byList.other > 0.001 && (
              <div className="st-row"><span className="st-label">Ostali<small>ministri, gosti, nepoznati</small></span><span className="st-track"><span className="st-bar" style={{ width: `${byList.other * 100}%`, background: '#8E98AB' }} /></span><span className="st-val">{pct(byList.other)}</span></div>
            )}
          </div>
        </section>

        <div className="st-grid">
          <section className="st-sec">
            <h3>Po danima</h3>
            <div className="st-bars">
              {perDay.map((d) => (
                <div key={d.s.id} className="st-row" onMouseMove={(ev) => showTip(ev, <><b>Dan {dayNo(d.s.id)}</b> · {new Date(d.s.date).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'long' })}<br />{d.n} javljanja · {fmtMin(d.sec)} · {nf(d.words)} reči</>)} onMouseLeave={hideTip}>
                  <span className="st-label">Dan {dayNo(d.s.id)}{d.meta?.status === 'live' && <em className="live-tag"><i aria-hidden />uživo</em>}<small>{d.n} javljanja</small></span>
                  <span className="st-track"><span className="st-bar" style={{ width: `${(d.sec / maxDaySec) * 100}%`, background: 'var(--tungsten)' }} /></span>
                  <span className="st-val">{fmtMin(d.sec)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="st-sec">
            <h3>Koliko traju govori</h3>
            <p className="st-note">Broj javljanja poslanika po dužini govora, u minutima.</p>
            <div className="st-cols" role="img" aria-label={hist.map((h) => `${h.label} min: ${h.n}`).join(', ')}>
              {hist.map((h) => (
                <div key={h.label} className="st-col" onMouseMove={(ev) => showTip(ev, <><b>{h.label} min</b><br />{h.n} javljanja</>)} onMouseLeave={hideTip}>
                  <span className="st-col-v">{h.n}</span>
                  <span className="st-col-bar" style={{ height: `${(h.n / maxHist) * 100}%` }} />
                  <span className="st-col-l">{h.label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {hours.length > 1 && (
          <section className="st-sec">
            <h3>Tok dana</h3>
            <p className="st-note">Minuti govora po satu{dayFilter === 'sve' ? ', zbir svih dana' : ''}; prazni sati su pauze.</p>
            <div className="st-cols st-hours" role="img" aria-label={hours.map((h) => `${h.hr}h: ${Math.round(h.sec / 60)} min`).join(', ')}>
              {hours.map((h) => (
                <div key={h.hr} className="st-col" onMouseMove={(ev) => showTip(ev, <><b>{h.hr}–{h.hr + 1} h</b><br />{Math.round(h.sec / 60)} min govora</>)} onMouseLeave={hideTip}>
                  <span className="st-col-bar" style={{ height: `${(h.sec / maxHour) * 100}%` }} />
                  <span className="st-col-l">{h.hr}h</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="st-sec">
          <h3>Zanimljivosti</h3>
          <dl className="about-list st-facts">
            {longest && (
              <div>
                <dt>Najduži govor</dt>
                <dd>
                  {longest.name}, {longest.day.toLowerCase()} u {longest.e.clock}: {fmtMin(longest.sec)} ({nf(longest.e.words)} reči).{' '}
                  <button className="st-link" onClick={() => onSpeech(longest.sid, longest.e.id)}>Otvori govor →</button>
                </dd>
              </div>
            )}
            {mostTurns && (
              <div>
                <dt>Najviše javljanja</dt>
                <dd>{mostTurns.name}: {mostTurns.n} puta za reč (repliku, povredu Poslovnika ili govor), ukupno {fmtMin(mostTurns.sec)}.</dd>
              </div>
            )}
            {pace.length > 1 && (
              <div>
                <dt>Tempo govora</dt>
                <dd>Najbrže: {pace[0].name}, oko {Math.round(pace[0].wpm)} reči u minuti. Najsporije: {pace[pace.length - 1].name}, oko {Math.round(pace[pace.length - 1].wpm)}. (Među onima sa bar 5 minuta.)</dd>
              </div>
            )}
            <div>
              <dt>Ko još nije govorio</dt>
              <dd>{mps.length - total.mpsSpoke} od {mps.length} poslanika nije se javilo za reč {dayFilter === 'sve' ? 'nijednog dana' : 'tog dana'}.</dd>
            </div>
          </dl>
        </section>

        <details className="st-table">
          <summary>Tabela: svi govornici ({people.length})</summary>
          <table>
            <thead><tr><th>Govornik</th><th>Lista</th><th>Javljanja</th><th>Minuta</th><th>Reči</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.key}><td>{p.name}{p.chair ? ' (predsedava)' : ''}</td><td>{p.list?.name ?? '–'}</td><td>{p.n}</td><td>{Math.round(p.sec / 60)}</td><td>{nf(p.words)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>

        {tip && (
          <div className="st-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 240), top: tip.y + 14 }} role="tooltip">{tip.body}</div>
        )}
        </div>
      </motion.div>
    ) : (
    <motion.div className="dossier-backdrop spk-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="news about stats"
        role="dialog"
        aria-modal="true"
        aria-label="Statistika"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="spk-x" onClick={onClose} aria-label="Zatvori">×</button>
        <header className="news-head">
          <div className="eyebrow">Skupština live · 15. saziv</div>
          <h2>Statistika</h2>
          <p>Izračunato iz istih podataka kao sala: trajanje iz snimka, reči iz transkripta. Dani sa automatskim transkriptom mogu imati greške u podeli na govornike.</p>
        </header>

        <div className="st-filter" role="tablist" aria-label="Dani">
          {[{ id: 'sve', label: 'Svi dani' }, ...perDay.map((d) => ({ id: d.s.id, label: `Dan ${dayNo(d.s.id)}${d.meta?.status === 'live' ? ' · uživo' : ''}` }))].map((x) => (
            <button key={x.id} role="tab" aria-selected={dayFilter === x.id} className={dayFilter === x.id ? 'on' : ''} onClick={() => setDayFilter(x.id)}>{x.label}</button>
          ))}
        </div>

        <div className="st-tiles">
          <Tile value={fmtMin(total.sec)} label="govora ukupno" />
          <Tile value={nf(total.speeches)} label="javljanja za reč" />
          <Tile value={nf(total.words)} label="izgovorenih reči" />
          <Tile value={`${total.mpsSpoke} / ${mps.length}`} label="poslanika je govorilo" />
          <Tile value={pct(chairSec / (total.sec || 1))} label="vremena je predsedavajući" />
          <Tile value={fmtMin(median)} label="tipičan govor (medijana)" />
        </div>

        <section className="st-sec">
          <h3>Ko je najduže govorio</h3>
          <p className="st-note">Ukupno vreme sa poslaničkog mesta (bez predsedavanja), deset najdužih.</p>
          <div className="st-bars">
            {top.map((p) => (
              <div key={p.key} className="st-row" onMouseMove={(ev) => showTip(ev, <><b>{p.name}</b><br />{p.list?.name ?? 'van poslaničkih lista'}<br />{fmtMin(p.sec)} · {nf(p.words)} reči · {p.n} javljanja</>)} onMouseLeave={hideTip}>
                <span className="st-label">{p.name}<small>{p.list?.name ?? ''}</small></span>
                <span className="st-track"><span className="st-bar" style={{ width: `${(p.sec / (top[0]?.sec || 1)) * 100}%`, background: colorOf(p) }} /></span>
                <span className="st-val">{fmtMin(p.sec)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="st-sec">
          <h3>Vreme govora naspram broja mandata</h3>
          <p className="st-note">Za svaku listu: udeo u ukupnom vremenu govora (puna traka) i udeo u 250 mandata (obrub). Predsedavanje nije uračunato.</p>
          <div className="st-legend"><span><i className="st-key solid" />vreme govora</span><span><i className="st-key outline" />mandati</span></div>
          <div className="st-bars">
            {byList.res.map(({ l, time, seats }) => (
              <div key={l.key} className="st-row st-pair" onMouseMove={(ev) => showTip(ev, <><b>{l.full}</b><br />vreme govora: {pct(time)}<br />mandati: {l.seats} ({pct(seats)})</>)} onMouseLeave={hideTip}>
                <span className="st-label">{l.name}<small>{l.seats} mandata</small></span>
                <span className="st-track st-two">
                  <span className="st-bar" style={{ width: `${time * 100}%`, background: l.color }} />
                  <span className="st-bar st-out" style={{ width: `${seats * 100}%`, borderColor: l.color }} />
                </span>
                <span className="st-val">{pct(time)}<small>{pct(seats)}</small></span>
              </div>
            ))}
            {byList.other > 0.001 && (
              <div className="st-row"><span className="st-label">Ostali<small>ministri, gosti, nepoznati</small></span><span className="st-track"><span className="st-bar" style={{ width: `${byList.other * 100}%`, background: '#8E98AB' }} /></span><span className="st-val">{pct(byList.other)}</span></div>
            )}
          </div>
        </section>

        <div className="st-grid">
          <section className="st-sec">
            <h3>Po danima</h3>
            <div className="st-bars">
              {perDay.map((d) => (
                <div key={d.s.id} className="st-row" onMouseMove={(ev) => showTip(ev, <><b>Dan {dayNo(d.s.id)}</b> · {new Date(d.s.date).toLocaleDateString('sr-Latn-RS', { day: 'numeric', month: 'long' })}<br />{d.n} javljanja · {fmtMin(d.sec)} · {nf(d.words)} reči</>)} onMouseLeave={hideTip}>
                  <span className="st-label">Dan {dayNo(d.s.id)}{d.meta?.status === 'live' && <em className="live-tag"><i aria-hidden />uživo</em>}<small>{d.n} javljanja</small></span>
                  <span className="st-track"><span className="st-bar" style={{ width: `${(d.sec / maxDaySec) * 100}%`, background: 'var(--tungsten)' }} /></span>
                  <span className="st-val">{fmtMin(d.sec)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="st-sec">
            <h3>Koliko traju govori</h3>
            <p className="st-note">Broj javljanja poslanika po dužini govora, u minutima.</p>
            <div className="st-cols" role="img" aria-label={hist.map((h) => `${h.label} min: ${h.n}`).join(', ')}>
              {hist.map((h) => (
                <div key={h.label} className="st-col" onMouseMove={(ev) => showTip(ev, <><b>{h.label} min</b><br />{h.n} javljanja</>)} onMouseLeave={hideTip}>
                  <span className="st-col-v">{h.n}</span>
                  <span className="st-col-bar" style={{ height: `${(h.n / maxHist) * 100}%` }} />
                  <span className="st-col-l">{h.label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {hours.length > 1 && (
          <section className="st-sec">
            <h3>Tok dana</h3>
            <p className="st-note">Minuti govora po satu{dayFilter === 'sve' ? ', zbir svih dana' : ''}; prazni sati su pauze.</p>
            <div className="st-cols st-hours" role="img" aria-label={hours.map((h) => `${h.hr}h: ${Math.round(h.sec / 60)} min`).join(', ')}>
              {hours.map((h) => (
                <div key={h.hr} className="st-col" onMouseMove={(ev) => showTip(ev, <><b>{h.hr}–{h.hr + 1} h</b><br />{Math.round(h.sec / 60)} min govora</>)} onMouseLeave={hideTip}>
                  <span className="st-col-bar" style={{ height: `${(h.sec / maxHour) * 100}%` }} />
                  <span className="st-col-l">{h.hr}h</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="st-sec">
          <h3>Zanimljivosti</h3>
          <dl className="about-list st-facts">
            {longest && (
              <div>
                <dt>Najduži govor</dt>
                <dd>
                  {longest.name}, {longest.day.toLowerCase()} u {longest.e.clock}: {fmtMin(longest.sec)} ({nf(longest.e.words)} reči).{' '}
                  <button className="st-link" onClick={() => onSpeech(longest.sid, longest.e.id)}>Otvori govor →</button>
                </dd>
              </div>
            )}
            {mostTurns && (
              <div>
                <dt>Najviše javljanja</dt>
                <dd>{mostTurns.name}: {mostTurns.n} puta za reč (repliku, povredu Poslovnika ili govor), ukupno {fmtMin(mostTurns.sec)}.</dd>
              </div>
            )}
            {pace.length > 1 && (
              <div>
                <dt>Tempo govora</dt>
                <dd>Najbrže: {pace[0].name}, oko {Math.round(pace[0].wpm)} reči u minuti. Najsporije: {pace[pace.length - 1].name}, oko {Math.round(pace[pace.length - 1].wpm)}. (Među onima sa bar 5 minuta.)</dd>
              </div>
            )}
            <div>
              <dt>Ko još nije govorio</dt>
              <dd>{mps.length - total.mpsSpoke} od {mps.length} poslanika nije se javilo za reč {dayFilter === 'sve' ? 'nijednog dana' : 'tog dana'}.</dd>
            </div>
          </dl>
        </section>

        <details className="st-table">
          <summary>Tabela: svi govornici ({people.length})</summary>
          <table>
            <thead><tr><th>Govornik</th><th>Lista</th><th>Javljanja</th><th>Minuta</th><th>Reči</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.key}><td>{p.name}{p.chair ? ' (predsedava)' : ''}</td><td>{p.list?.name ?? '–'}</td><td>{p.n}</td><td>{Math.round(p.sec / 60)}</td><td>{nf(p.words)}</td></tr>
              ))}
            </tbody>
          </table>
        </details>

        {tip && (
          <div className="st-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 240), top: tip.y + 14 }} role="tooltip">{tip.body}</div>
        )}
      </motion.div>
    </motion.div>
    )
  )
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="st-tile">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}
