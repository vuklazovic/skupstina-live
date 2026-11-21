import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { fmtTc, zoomOf, type Clock, type Traka, type Vote } from './types'

export const VCOL = { za: '#5fd394', protiv: '#ff5d63', uzdrzano: '#ffc56b', nije: '#7d879a', od: '#4a5263', ne: '#b0566a', uz: '#ffc56b' }

const KIND: Record<Vote['kind'], string> = {
  glasanje: 'Glasanje',
  prozivka: 'Glasanje prozivkom',
  kvorum: 'Kvorum',
  konstatacija: 'Konstatacija',
}

type Props = {
  v: Vote
  data: Traka
  clock: Clock
  pinned: boolean
  onClose: () => void
  onPlay: (g: number) => void
  /** mreža po listama se ne crta (prozivka se vidi u sali) */
  hideSeats?: boolean
}

/** boja glasa u prozivci */
export function rollColor(v: Vote, key: string) {
  const o = v.options?.find((x) => x.key === key)
  if (o) return o.color ?? '#fff'
  return (VCOL as Record<string, string>)[key] ?? 'transparent'
}

/** kratak opis rezultata (za traku i karticu) */
export function voteTally(v: Vote): { c: string; n: number; label: string }[] {
  if (v.result) {
    const r = v.result
    return [
      { c: VCOL.za, n: r.za, label: 'za' },
      { c: VCOL.protiv, n: r.protiv, label: 'protiv' },
      { c: VCOL.uzdrzano, n: r.uzdrzano, label: 'uzdržano' },
      { c: VCOL.nije, n: r.nije, label: 'nije glasalo' },
    ]
  }
  if (v.options) {
    const counts: Record<string, number> = {}
    v.roll?.forEach((x) => (counts[x.v] = (counts[x.v] ?? 0) + 1))
    return v.options.map((o) => ({ c: o.color ?? '#fff', n: o.n ?? counts[o.key] ?? 0, label: o.short ?? o.label }))
  }
  if (v.present != null) return [{ c: VCOL.za, n: v.present, label: 'u sali' }]
  return []
}

/** pseudo-slučajni brojevi sa semenom (isto glasanje uvek izgleda isto) */
function rng(seed: number) {
  let x = Math.floor(seed * 1000) % 2147483647 || 1
  return () => {
    x = (x * 48271) % 2147483647
    return x / 2147483647
  }
}

/** kada poslanici glasaju, tačno po tekstu: od „pritisnite taster” do „zaključujem glasanje” */
function pressWindow(v: Vote) {
  const firstReveal = v.reveal ? Math.min(...Object.values(v.reveal)) : undefined
  let we = v.close ?? (firstReveal != null ? firstReveal - 0.5 : v.end - 4)
  if (we <= v.at) we = v.end
  let ws = v.press ?? Math.max(v.at, we - 10)
  if (we - ws < 2) ws = Math.max(v.at, we - 2)
  return [ws, we] as const
}

type Hover = { x: number; y: number; below?: boolean; mp?: string; text: string; sub?: string; color?: string; at?: number }

/**
 * Kartica glasanja: šta se glasa, kako, rezultat i 250 kockica (jedna po poslaniku).
 * Elektronsko glasanje: glasovi stižu jedan po jedan dok traje glasanje (kao na tabli u sali).
 * Prozivka: kockice se pune redom kako poslanici glasaju (vreme iz prenosa); prelaz mišem kaže ko je i kako glasao.
 */
export const VoteCard = memo(function VoteCard({ v, data, clock, pinned, onClose, onPlay, hideSeats }: Props) {
  const box = useRef<HTMLElement>(null)
  const roll = v.roll
  const order = useMemo(() => (roll ? roll.filter((r) => r.at != null).sort((a, b) => a.at! - b.at!) : []), [roll])
  const [ws, we] = useMemo(() => pressWindow(v), [v])

  // elektronsko glasanje / kvorum: kockice po ishodu (grupisane), a redosled pristizanja nasumičan
  const units = useMemo(() => {
    const cats: { c: string; k: string }[] = []
    const push = (c: string, k: string, n: number) => {
      for (let i = 0; i < n; i++) cats.push({ c, k })
    }
    const r = v.result
    if (r) {
      push(VCOL.za, 'za', r.za)
      push(VCOL.protiv, 'protiv', r.protiv)
      push(VCOL.uzdrzano, 'uzdrzano', r.uzdrzano)
      push(VCOL.nije, 'nije', r.nije)
      push('', 'odsutan', Math.max(0, 250 - r.prisutno))
    } else if (v.kind === 'kvorum' && v.present != null) {
      push(VCOL.za, 'prisutan', v.present)
      push('', 'odsutan', 250 - v.present)
    } else return null
    // ko glasa dobija mesto u redu pristizanja
    const rand = rng(v.at + 7)
    const voters = cats.map((_, i) => ({ i, f: rand() })).filter((x) => cats[x.i].k !== 'nije' && cats[x.i].k !== 'odsutan')
    voters.sort((a, b) => a.f - b.f)
    const rank = new Array<number>(cats.length).fill(-1)
    voters.forEach((x, r2) => (rank[x.i] = r2))
    return { cats, rank, total: voters.length }
  }, [v])

  const [n, setN] = useState(0) // prozivka: koliko je prozvano
  const [lit, setLit] = useState(0) // elektronsko: koliko je glasalo
  const [phase, setPhase] = useState<'pre' | 'live' | 'done'>('pre')
  // šta je predsedavajući već pročitao (brojevi, ishod) — tačno kad to izgovori
  const [said, setSaid] = useState('')
  useEffect(
    () =>
      clock.on((t) => {
        const ks = Object.entries(v.reveal ?? {})
          .filter(([, at]) => t >= at!)
          .map(([k]) => k)
        if (t >= (v.outcomeAt ?? (v.reveal ? Math.max(...Object.values(v.reveal)) + 1 : roll ? v.end - 0.5 : we))) ks.push('ishod')
        setSaid(ks.join(','))
        if (roll) {
          let k = 0
          while (k < order.length && order[k].at! <= t) k++
          setN(k)
          setPhase(t >= v.end - 0.5 ? 'done' : t >= v.at ? 'live' : 'pre')
          return
        }
        const q = Math.max(0, Math.min(1, (t - ws) / Math.max(0.1, we - ws)))
        // većina pritisne odmah, poslednji kasne (kao u sali)
        const e = 1 - Math.pow(1 - q, 1.7)
        setLit(units ? Math.round(units.total * e) : 0)
        setPhase(t >= we ? 'done' : t >= ws ? 'live' : 'pre')
      }),
    [clock, order, roll, v.end, v.at, ws, we, units, v.reveal, v.outcomeAt],
  )
  const finished = phase === 'done'
  const saidSet = new Set(said.split(','))
  /** broj je „pročitan”: kad ga predsedavajući izgovori (ili, ako nije u tekstu, kad se glasanje zaključi) */
  const isSaid = (k: string) => (v.reveal && k in v.reveal ? saidSet.has(k) : finished)
  const outcomeOn = saidSet.has('ishod')

  const votedAt = useMemo(() => new Map(order.slice(0, n).map((r) => [r.mp, r])), [order, n])
  const latest = n > 0 ? order[n - 1] : null

  // poslanici po listama (najveća lista prva), za mrežu kockica
  const groups = useMemo(() => {
    if (!data.mps || !data.lists) return []
    const by: Record<string, { id: string; name: string }[]> = {}
    for (const [id, [name, list]] of Object.entries(data.mps)) (by[list] ??= []).push({ id, name })
    return [...data.lists]
      .sort((a, b) => b.seats - a.seats)
      .map((l) => ({ ...l, mps: (by[l.key] ?? []).sort((a, b) => a.name.localeCompare(b.name, 'sr')) }))
      .filter((g) => g.mps.length)
  }, [data])
  const listOf = useMemo(() => new Map((data.lists ?? []).map((l) => [l.key, l])), [data])

  const unknownAll = roll ? roll.filter((r) => r.v === '?').length : 0
  const live: Record<string, number> = {}
  votedAt.forEach((x) => (live[x.v] = (live[x.v] ?? 0) + 1))

  // brojevi elektronskog glasanja uživo
  const liveCount: Record<string, number> = {}
  if (units) units.cats.forEach((u, i) => units.rank[i] >= 0 && units.rank[i] < lit && (liveCount[u.k] = (liveCount[u.k] ?? 0) + 1))

  // oblačić: ko je to i kako je glasao
  const [hover, setHover] = useState<Hover | null>(null)
  const show = (el: HTMLElement, h: Omit<Hover, 'x' | 'y'>) => {
    const b = box.current
    if (!b) return
    const r = el.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    const k = zoomOf(b)
    const below = (r.top - br.top) / k < 120
    setHover({ ...h, below, x: Math.max(110, Math.min(br.width / k - 110, (r.left - br.left + r.width / 2) / k)), y: ((below ? r.bottom : r.top) - br.top) / k + b.scrollTop })
  }

  const voteLabel = (key: string | undefined) => {
    if (key == null) return { text: 'još nije prozvan', color: undefined }
    const o = v.options?.find((x) => x.key === key)
    if (o) return { text: `glasa za: ${o.short ? `${o.short} (${o.label})` : o.label}`, color: o.color }
    if (key === 'od') return { text: 'nije glasao / nije bio u sali', color: VCOL.od }
    if (key === 'uz') return { text: 'uzdržan', color: VCOL.uz }
    if (key === 'ne') return { text: 'ne učestvuje u glasanju', color: VCOL.ne }
    return { text: v.rollSource === 'stenogram' ? 'nije nađen u zapisu' : 'glas nije prepoznat iz prenosa', color: undefined }
  }

  const UNIT_TXT: Record<string, string> = {
    za: 'glas ZA',
    protiv: 'glas PROTIV',
    uzdrzano: 'UZDRŽAN',
    nije: 'prisutan, NIJE GLASAO',
    odsutan: 'nije u sali',
    prisutan: 'prisutan u sali',
  }

  return (
    <aside ref={box} className={`vc${pinned ? ' pinned' : ''}`} aria-label={`Glasanje: ${v.title}`} onMouseLeave={() => setHover(null)}>
      <div className="vc-top">
        <span className={`vc-kind k-${v.kind}`}>
          <i />
          {KIND[v.kind]}
          {v.method === 'elektronski' && ' · elektronski'}
        </span>
        {phase === 'live' && <span className="vc-live">uživo</span>}
        <span className="mono vc-time">{fmtTc(v.at)}</span>
        <button className="vc-x" onClick={onClose} aria-label="Zatvori">
          ×
        </button>
      </div>
      <h2>{v.title}</h2>
      {v.detail && <p className="vc-detail">{v.detail}</p>}

      {/* elektronsko glasanje / kvorum */}
      {units && (
        <>
          <div className="vc-nums">
            {v.result ? (
              <>
                {voteTally(v).map((x) => {
                  const k = x.label === 'za' ? 'za' : x.label === 'protiv' ? 'protiv' : x.label === 'uzdržano' ? 'uzdrzano' : 'nije'
                  const fin = isSaid(k)
                  const val = fin ? x.n : k === 'nije' ? 0 : liveCount[k] ?? 0
                  return (
                    <span key={x.label} style={{ ['--c' as string]: x.c }} className={fin ? 'fin' : 'pending'}>
                      <b>{phase === 'pre' ? '–' : val}</b>
                      {x.label}
                    </span>
                  )
                })}
                <span className={`dim${isSaid('prisutno') ? ' fin' : ''}`}>
                  <b>{phase === 'pre' ? '–' : isSaid('prisutno') ? v.result.prisutno : lit}</b>
                  {isSaid('prisutno') ? 'prisutno' : 'glasalo do sada'}
                </span>
              </>
            ) : (
              <>
                <span style={{ ['--c' as string]: VCOL.za }} className={isSaid('prisutno') ? 'fin' : 'pending'}>
                  <b>{phase === 'pre' ? '–' : isSaid('prisutno') ? v.present : lit}</b>u sali
                </span>
                <span className={`dim${lit >= 126 ? ' quorum' : ''}`}>
                  <b>126</b>
                  {lit >= 126 ? 'kvorum postoji ✓' : 'potrebno za kvorum'}
                </span>
              </>
            )}
          </div>
          <div className={`vc-units ph-${phase}`}>
            {units.cats.map((u, i) => {
              const grey = u.k === 'nije' && isSaid('nije')
              const on = (units.rank[i] >= 0 && (finished || units.rank[i] < lit)) || grey
              return (
                <i
                  key={i}
                  className={on ? `lit${grey ? ' grey' : ''}` : u.c ? '' : 'empty'}
                  style={on ? { background: u.c } : undefined}
                  onMouseEnter={(e) =>
                    show(e.currentTarget, {
                      text: phase === 'pre' ? 'Glasanje još nije počelo' : on || finished ? UNIT_TXT[u.k] : 'još nije glasao',
                      sub:
                        v.kind === 'kvorum'
                          ? 'Prisustvo se utvrđuje karticama; spisak po imenu nije objavljen.'
                          : 'Elektronsko glasanje: stenogram daje samo zbir, ne i kako je glasao svaki poslanik.',
                      color: on ? u.c : undefined,
                    })
                  }
                />
              )
            })}
          </div>
          {!isSaid('prisutno') && !(v.kind !== 'kvorum' && isSaid('za')) && (
            <div className="vc-clock">
              <i style={{ width: `${phase === 'pre' ? 0 : Math.round((lit / Math.max(1, units.total)) * 100)}%` }} />
              <span>{phase === 'pre' ? 'Predlog je stavljen na glasanje…' : phase === 'live' ? 'Poslanici glasaju…' : 'Glasanje je zaključeno, predsedavajući čita rezultat…'}</span>
            </div>
          )}
        </>
      )}
      {!units && !roll && v.kind === 'glasanje' && (
        <div className={`vc-nonum ph-${phase}`}>{finished ? 'Brojke nisu pročitane u sali.' : phase === 'live' ? 'Poslanici glasaju…' : 'Predlog je stavljen na glasanje…'}</div>
      )}

      {/* prozivka: brojevi uživo + mreža poslanika po listama */}
      {roll && v.options && (
        <>
          <div className="vc-race">
            {v.options.map((o) => {
              const k = live[o.key] ?? 0
              const fin = finished && o.n != null ? o.n : k
              return (
                <div key={o.key} className="vc-opt" style={{ ['--c' as string]: o.color ?? '#fff' }}>
                  <div className="vc-opt-row">
                    <span>{o.short ?? o.label}</span>
                    <b className="mono">{fin}</b>
                  </div>
                  {o.short && <small>{o.label}</small>}
                  <div className="vc-bar">
                    <i style={{ width: `${Math.min(100, (fin / 250) * 100)}%` }} />
                    <em style={{ left: `${(126 / 250) * 100}%` }} title="Većina svih poslanika: 126" />
                  </div>
                </div>
              )
            })}
            <p className="vc-progress mono">
              {finished ? 'Prozivka je završena' : latest ? `Prozvano ${n} od ${order.length} · sada: ${data.mps?.[latest.mp]?.[0] ?? ''}` : 'Prozivka počinje…'}
            </p>
          </div>
          {!hideSeats && (
          <div className="vc-seats">
            {groups.map((g) => (
              <div key={g.key} className="vc-group">
                <span className="vc-group-name">
                  <i style={{ background: g.color }} />
                  {g.name} <span className="dim">{g.mps.length}</span>
                </span>
                <div className="vc-cells">
                  {g.mps.map((m) => {
                    const r = votedAt.get(m.id)
                    const x = r?.v
                    const isNow = latest?.mp === m.id && !finished
                    const full = roll.find((y) => y.mp === m.id)
                    return (
                      <i
                        key={m.id}
                        className={`${x == null ? 'empty' : 'lit'}${x === '?' ? ' unk' : ''}${isNow ? ' now' : ''}${hover?.mp === m.id ? ' hov' : ''}`}
                        style={x && x !== '?' ? { background: rollColor(v, x) } : undefined}
                        onMouseEnter={(e) => {
                          const lab = voteLabel(x)
                          show(e.currentTarget, { mp: m.id, text: lab.text, color: lab.color, at: full?.at, sub: listOf.get(g.key)?.name })
                        }}
                        onClick={() => full?.at != null && onPlay(full.at - 1.5)}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          )}
          {!hideSeats && (
          <div className="vc-legend">
            {v.options.map((o) => (
              <span key={o.key}>
                <i style={{ background: o.color }} />
                {o.short ?? o.label}
              </span>
            ))}
            <span>
              <i style={{ background: VCOL.od }} />
              nije glasao
            </span>
            <span>
              <i className="unk" />
              nije prepoznato
            </span>
          </div>
          )}
          <p className="vc-note">
            {v.rollSource === 'stenogram'
              ? `${hideSeats ? 'Sala iznad: pređi mišem preko sedišta (klik pušta trenutak glasa).' : 'Pređi mišem preko kockice; klik pušta trenutak glasa.'} Glasovi su iz zvaničnog stenograma${unknownAll ? ` (${unknownAll} poslanika nije nađeno u zapisu)` : ''}.`
              : hideSeats
                ? `Sala iznad: pređi mišem preko sedišta. Glasovi su pročitani iz automatskog zapisa prenosa (${unknownAll} nije prepoznato).`
                : `Pređi mišem preko kockice: ko je i kako je glasao, a klik pušta trenutak kad je glasao. Glasovi su pročitani iz automatskog zapisa prenosa (prozivka po imenu); ${unknownAll} nije prepoznato, pa su moguće greške. Zvanični rezultat je ispod.`}
          </p>
        </>
      )}

      {v.outcome && (
        <p className={`vc-outcome${outcomeOn ? ' on' : ''}`}>
          <span>{v.passed ? '✓' : '•'}</span>
          {outcomeOn ? v.outcome : 'Ishod se vidi kad ga predsedavajući konstatuje.'}
        </p>
      )}
      <button className="vc-play" onClick={() => onPlay(v.at)}>
        ▶ Pusti od početka ({fmtTc(v.end - v.at, false)})
      </button>

      {hover && (
        <div className={`vc-tip${hover.below ? ' below' : ''}`} style={{ left: hover.x, top: hover.y }} role="tooltip">
          {hover.mp && data.mps?.[hover.mp] && (
            <div className="vc-tip-who">
              {data.mps[hover.mp][2] ? <img src={`/${data.mps[hover.mp][2]}`} alt="" /> : <span className="ph" />}
              <span>
                <b>{data.mps[hover.mp][0]}</b>
                <small>{hover.sub}</small>
              </span>
            </div>
          )}
          <div className="vc-tip-vote">
            <i style={{ background: hover.color ?? 'transparent' }} className={hover.color ? '' : 'unk'} />
            {hover.text}
          </div>
          {hover.mp && hover.at != null && <div className="vc-tip-at mono">glasao u {fmtTc(hover.at)} · klik pušta snimak</div>}
          {!hover.mp && hover.sub && <div className="vc-tip-at">{hover.sub}</div>}
        </div>
      )}
    </aside>
  )
})
