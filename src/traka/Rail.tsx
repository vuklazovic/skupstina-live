import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Seat } from '../geometry'
import type { ListInfo, Mp } from '../types'
import { Hall, type SeatVote } from './Hall'
import { VCOL, rollColor } from './VoteCard'
import { fmtTc, initials, isChair, type Clock, type Traka, type Vote } from './types'

/** sala u desnoj koloni: ko govori, a u prozivci kako ko glasa (do trenutka na traci) */
export const HallCard = memo(function HallCard({ clock, seats, lists, vote, speakerMp, chairOn, chairName, onPlay, onPick }: {
  clock: Clock
  seats: Seat[]
  lists: ListInfo[]
  vote: Vote | null
  speakerMp: string | null
  chairOn: boolean
  chairName?: string
  onPlay: (g: number) => void
  /** klik na sedište van prozivke: izbor poslanika (praćenje njegovih govora) */
  onPick?: (mpId: string) => void
}) {
  const roll = vote?.roll
  const order = useMemo(() => (roll ? roll.filter((r) => r.at != null).sort((a, b) => a.at! - b.at!) : []), [roll])
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!roll) return
    return clock.on((t) => {
      let k = 0
      while (k < order.length && order[k].at! <= t) k++
      // posle kraja prozivke: svi glasovi (i oni čije vreme nije pročitano)
      setN(t >= vote!.end - 0.5 ? -1 : k)
    })
  }, [clock, order, roll, vote])

  const votes = useMemo(() => {
    if (!vote || !roll) return null
    const m = new Map<string, SeatVote>()
    const label = (k: string) => {
      const o = vote.options?.find((x) => x.key === k)
      if (o) return `glasa za: ${o.short ? `${o.short} (${o.label})` : o.label}`
      return k === 'od' ? 'nije glasao / nije bio u sali' : k === 'uz' ? 'uzdržan' : k === 'ne' ? 'ne učestvuje u glasanju' : vote.rollSource === 'stenogram' ? 'nije nađen u zapisu' : 'glas nije prepoznat iz prenosa'
    }
    const list = n < 0 ? roll : order.slice(0, n)
    for (const r of list) m.set(r.mp, { color: r.v === '?' ? undefined : rollColor(vote, r.v), unk: r.v === '?', label: label(r.v), at: r.at })
    return m
  }, [vote, roll, order, n])
  const latest = n > 0 ? order[n - 1]?.mp : null

  return (
    <section className="rc rc-hall">
      <header>
        <span className="eyebrow">{votes ? 'Sala · prozivka' : 'Sala'}</span>
        {votes && <span className="rc-sub mono">{n < 0 ? 'svi glasovi' : `prozvano ${n}`}</span>}
      </header>
      <Hall
        seats={seats}
        lists={lists}
        speakerMp={speakerMp}
        chairOn={chairOn}
        chairName={chairName}
        votes={votes}
        latestMp={latest}
        onSeat={(id, at) => (at != null ? onPlay(at - 1.5) : onPick?.(id))}
      />
      {!votes && (
        <div className="rc-legend">
          {lists.map((l) => (
            <span key={l.key} title={l.full}>
              <i style={{ background: l.color }} />
              {l.name} <b>{l.seats}</b>
            </span>
          ))}
        </div>
      )}
      {votes && vote?.options && (
        <div className="rc-legend">
          {vote.options.map((o) => (
            <span key={o.key}>
              <i style={{ background: o.color }} />
              {o.short ?? o.label}
            </span>
          ))}
          <span>
            <i style={{ background: VCOL.od }} />
            nije glasao
          </span>
        </div>
      )}
    </section>
  )
})

/** ko je ovo: podaci iz biografije sa sajta Skupštine */
/** children: dodatak odmah ispod imena (npr. sledeći govori ovog poslanika) */
export function WhoCard({ mp, list, role, children }: { mp?: Mp; list?: ListInfo; role?: string | null; children?: ReactNode }) {
  if (!mp) return null
  const facts = [
    mp.profession && ['Zanimanje', mp.profession],
    mp.born && ['Rođen(a)', mp.born],
    mp.residence && ['Mesto', mp.residence],
    mp.group && ['Poslanička grupa', mp.group],
    ['Prethodni saziv', mp.prior ? 'imao(la) je mandat' : 'prvi mandat'],
  ].filter(Boolean) as [string, string][]
  return (
    <section className="rc rc-who">
      <header>
        <span className="eyebrow">Ko govori</span>
        {role && <span className="rc-sub">{role}</span>}
      </header>
      <div className="rc-who-top">
        {mp.photo ? <img src={`/${mp.photo}`} alt="" /> : <span className="ph">{initials(mp.name)}</span>}
        <div>
          <b>{mp.title ? `${mp.title} ` : ''}{mp.name}</b>
          <span>
            <i style={{ background: list?.color }} />
            {mp.party ?? list?.name}
          </span>
        </div>
      </div>
      {children}
      <dl>
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {mp.bio && <p className="rc-bio">{mp.bio.length > 240 ? mp.bio.slice(0, 240).replace(/\s+\S*$/, '') + '…' : mp.bio}</p>}
      <a className="rc-link" href={mp.url} target="_blank" rel="noreferrer">
        Stranica na sajtu Skupštine ↗
      </a>
    </section>
  )
}

/** dobacivanja tokom ovog govora */
export function InterCard({ items, onSeek }: { items: Traka['inter']; onSeek: (g: number) => void }) {
  if (!items.length) return null
  return (
    <section className="rc rc-inter">
      <header>
        <span className="eyebrow">Dobacivanja u ovom govoru</span>
        <span className="rc-sub mono">{items.length}</span>
      </header>
      <ul>
        {items.map((x, i) => (
          <li key={i}>
            <button onClick={() => onSeek(x.at)}>
              <span className="mono">{fmtTc(x.at)}</span>
              <b>{x.who}</b> {x.text}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** sledeći govornici */
export function QueueCard({ data, cur, onSeek }: { data: Traka; cur: number; onSeek: (g: number) => void }) {
  const next: Traka['speeches'] = []
  for (const s of data.speeches.slice(cur + 1)) {
    if (isChair(data.people[s.who])) continue
    if (next.some((x) => x.who === s.who)) continue
    next.push(s)
    if (next.length >= 4) break
  }
  if (!next.length) return null
  return (
    <section className="rc rc-queue">
      <header>
        <span className="eyebrow">Sledeći govornici</span>
      </header>
      {next.map((s) => {
        const p = data.people[s.who]
        return (
          <button key={s.id} className="rc-q" onClick={() => onSeek(s.at)} style={{ ['--c' as string]: p?.color ?? '#8e98ab' }}>
            <span className="rc-q-ph">{p?.photo ? <img src={`/${p.photo}`} alt="" /> : initials(p?.name ?? s.who)}</span>
            <span className="rc-q-t">
              <b>{p?.name ?? s.who}</b>
              <small>
                {s.clock} · {fmtTc(s.dur, false)} · {p?.list ?? ''}
              </small>
            </span>
          </button>
        )
      })}
    </section>
  )
}
