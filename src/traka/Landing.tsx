import { useEffect, useMemo, useState } from 'react'
import { VoteCarousel } from './VoteCarousel'
import { MrezePoziv } from '../components/Mreze'
import { Putokaz } from './Putokaz'

export type PVote = {
  kind: 'glasanje' | 'prozivka' | 'kvorum' | 'konstatacija'
  title: string
  headline?: string
  at: number
  outcome?: string
  result?: { za: number; protiv: number; uzdrzano: number; nije: number; prisutno: number }
  options?: { key: string; label: string; short?: string; n?: number; color?: string }[]
  roll?: [string, string][]
  rollSource?: string
}
export type PDay = { id: string; title: string; date: string; speeches: number; speakers: number; hours: number; outcomes: string[]; votes: PVote[] }
type PTop = { mp: string; name: string; photo?: string; color?: string; party?: string; sec: number; n: number; best: { day: string; id: number } }
type Pregled = { days: PDay[]; top: PTop[] }

type Props = {
  openDay: (id: string, extra?: Record<string, string>) => void
  openSala: () => void
  /** učitaj podatke sale unapred (pokazivač ili prst je na dugmetu) */
  warmSala: () => void
  openLive: () => void
  openSpeech: (sessionId: string, turnId: number) => void
}

const hm = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : `${Math.round(sec / 60)} min`)
const dateLabel = (d: string) => new Date(d).toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long' })

/**
 * Početna strana /traka: šta je sajt, šta se ovde može, i dugmad koja vode na traku dana, salu i prenos uživo.
 */
export function Landing({ openDay, openSala, warmSala, openLive, openSpeech }: Props) {
  const warm = { onPointerEnter: warmSala, onTouchStart: warmSala, onFocus: warmSala }
  const [p, setP] = useState<Pregled | null>(null)
  useEffect(() => {
    fetch('/data/traka-pregled.json').then((r) => r.json()).then(setP).catch(() => {})
  }, [])
  const days = p?.days ?? []
  const last = days[days.length - 1]
  const lastN = days.length
  const total = {
    speeches: days.reduce((a, d) => a + d.speeches, 0),
    hours: Math.round(days.reduce((a, d) => a + d.hours, 0)),
    votes: days.reduce((a, d) => a + d.votes.filter((v) => v.kind === 'glasanje' || v.kind === 'prozivka').length, 0),
  }
  // ključni trenutak: izbor predsednika (prozivka)
  const key = useMemo(() => {
    for (const d of days) {
      const v = d.votes.find((x) => x.kind === 'prozivka' && /predsednika Narodne/.test(x.title))
      if (v) return { d, v }
    }
    return null
  }, [days])

  return (
    <div className="ld-wrap">
      <div className="tka-bg home" aria-hidden>
        <div className="tka-bg-blob a" style={{ ['--c' as string]: '#8FC3E6' }} />
        <div className="tka-bg-blob b" style={{ ['--c' as string]: '#D9963F' }} />
        <div className="tka-bg-grain" />
      </div>
      <div className="ld">

      {/* ---------- zaglavlje ---------- */}
      <section className="ld-hero">
        <div className="ld-hero-txt">
          <h1>
            Šta se zaista govori u Skupštini.
            <span> Reč po reč.</span>
          </h1>
          <p className="ld-lead">
            Svaki govor sa snimkom i tekstom koji se popunjava dok slušaš. Svako glasanje, i ko je kako glasao. Ceo dan sednice na jednoj traci, kao u programu za montažu.
          </p>
          <div className="ld-ctas">
            {last && (
              <button className="ld-cta primary" onClick={() => openDay(last.id)}>
                <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" /></svg>
                Gledaj dan {lastN} reč po reč
              </button>
            )}
            <button className="ld-cta" onClick={openSala} {...warm}>
              Uđi u salu: 250 poslanika
            </button>
            <button className="ld-cta live" onClick={openLive}>
              <i /> Uživo
            </button>
          </div>
          <p className="ld-note">Nezavisan, nestranački projekat. Sve je iz javnih zapisa Skupštine: stenograma i snimaka.</p>
        </div>

        <VoteCarousel days={days} openDay={openDay} />
      </section>

      {/* ---------- putokaz: šta sajt pokriva danas i šta sledi ---------- */}
      <Putokaz />

      {/* ---------- brojke ---------- */}
      <section className="ld-stats">
        <div><b>250</b><span>poslanika, svako sa licem i biografijom</span></div>
        <div><b>{days.length || '–'}</b><span>dana sednice na traci</span></div>
        <div><b>{total.speeches || '–'}</b><span>govora sa snimkom i tekstom</span></div>
        <div><b>{total.hours || '–'} h</b><span>snimka, svaka reč sa vremenom</span></div>
        <div><b>{total.votes || '–'}</b><span>glasanja, ko je kako glasao</span></div>
      </section>

      {/* ---------- šta možeš ---------- */}
      <section className="ld-sec">
        <h2>Šta ovde možeš</h2>
        <div className="ld-features">
          <button className="ld-f" onClick={() => last && openDay(last.id)}>
            <span className="ld-f-ic">▤</span>
            <b>Ceo dan na jednoj traci</b>
            <p>Govori, predsedavajući, glasanja i dobacivanja, po obliku i boji liste. Zumiraj do pojedinačne reči.</p>
            <span className="ld-f-cta">Otvori traku →</span>
          </button>
          <button className="ld-f" onClick={() => last && openDay(last.id)}>
            <span className="ld-f-ic">Aa</span>
            <b>Tekst koji prati snimak</b>
            <p>Kao tekst pesme: rečenica koja se čuje je istaknuta, a klik na bilo koju reč pušta snimak od tog trenutka.</p>
            <span className="ld-f-cta">Probaj →</span>
          </button>
          <button className="ld-f" onClick={() => key && openDay(key.d.id, { t: String(Math.floor(key.v.at)) })}>
            <span className="ld-f-ic">✓</span>
            <b>Glasanje uživo, sedište po sedište</b>
            <p>Brojevi rastu dok poslanici glasaju, a u prozivci svako sedište dobija boju kad poslanik izgovori ime kandidata.</p>
            <span className="ld-f-cta">Pogledaj prozivku →</span>
          </button>
          <button className="ld-f" onClick={openSala} {...warm}>
            <span className="ld-f-ic">◠</span>
            <b>Sala sa svim poslanicima</b>
            <p>Klik na poslanika: biografija i svi njegovi govori po danima. Odatle pravo na traku, na taj govor.</p>
            <span className="ld-f-cta">Uđi u salu →</span>
          </button>
          {/* asistent za sada postoji samo u prethodnoj verziji sajta */}
          <button className="ld-f" onClick={() => window.location.assign('/staro')}>
            <span className="ld-f-ic">AI</span>
            <b>Pitaj zapisnik</b>
            <p>AI asistent odgovara samo iz stenograma, sa izvorom za svaku tvrdnju. Bez mišljenja, bez izmišljanja.</p>
            <span className="ld-f-cta">Postavi pitanje →</span>
          </button>
          <button className="ld-f" onClick={openLive}>
            <span className="ld-f-ic live">●</span>
            <b>Sednica uživo</b>
            <p>Prenos, ko sada govori, chat, reakcije i utišavanje poslanika koje ne želiš da slušaš.</p>
            <span className="ld-f-cta">Otvori prenos →</span>
          </button>
        </div>
      </section>

      {/* ---------- ključni trenutak + poslednji dan ---------- */}
      <section className="ld-sec ld-two">
        {key && (
          <article className="ld-key">
            <span className="eyebrow">Ključni trenutak · dan {days.indexOf(key.d) + 1}</span>
            <h3>{key.v.title}</h3>
            <div className="ld-score">
              {key.v.options?.map((o, i) => (
                <div key={i} style={{ ['--c' as string]: o.color ?? '#fff' }}>
                  <b>{o.n}</b>
                  <span>{o.short ?? o.label}</span>
                </div>
              ))}
            </div>
            <div className="ld-scorebar">
              {key.v.options?.map((o, i) => (
                <i key={i} style={{ width: `${((o.n ?? 0) / 250) * 100}%`, background: o.color }} />
              ))}
              <em title="Većina svih poslanika: 126" />
            </div>
            <p>{key.v.outcome}</p>
            <button className="ld-cta primary sm" onClick={() => openDay(key.d.id, { t: String(Math.floor(key.v.at)) })}>
              Pogledaj prozivku ime po ime →
            </button>
          </article>
        )}
        {last && (
          <article className="ld-day">
            <span className="eyebrow">Poslednji dan · {dateLabel(last.date)}</span>
            <h3>{last.title}</h3>
            <div className="hm-stats mono">
              <span><b>{last.speeches}</b> govora</span>
              <span><b>{last.speakers}</b> govornika</span>
              <span><b>{last.hours}</b> h</span>
            </div>
            <ul>
              {last.outcomes.slice(0, 4).map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
            <div className="ld-daybtns">
              <button className="ld-cta primary sm" onClick={() => openDay(last.id)}>
                Otvori traku dana {lastN} →
              </button>
              {days.slice(0, -1).map((d, i) => (
                <button key={d.id} className="ld-cta sm" onClick={() => openDay(d.id)}>
                  Dan {i + 1}
                </button>
              ))}
            </div>
          </article>
        )}
      </section>

      {/* ---------- ko je najviše govorio ---------- */}
      {p && (
        <section className="ld-sec">
          <h2>Ko je najviše govorio</h2>
          <div className="ld-faces">
            {p.top.map((t) => (
              <button key={t.mp} className="ld-face" style={{ ['--c' as string]: t.color ?? '#8e98ab' }} onClick={() => openSpeech(t.best.day, t.best.id)}>
                <span className="ld-face-ph">{t.photo ? <img src={`/${t.photo}`} alt="" /> : t.name[0]}</span>
                <b>{t.name}</b>
                <small>{hm(t.sec)} · {t.n} {t.n === 1 ? 'govor' : 'govora'}</small>
                <span className="ld-face-cta">▶ najduži govor</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- podrška: praćenje na mrežama ---------- */}
      <MrezePoziv />

      {/* ---------- poziv na kraju ---------- */}
      <section className="ld-final">
        <h2>Sledeća sednica: prati je uživo.</h2>
        <p>Kad Skupština zaseda, prenos, ko govori i chat su ovde, a svaki govor odmah dobija tekst i sažetak.</p>
        <div className="ld-ctas center">
          <button className="ld-cta live" onClick={openLive}>
            <i /> Otvori prenos uživo
          </button>
          {last && (
            <button className="ld-cta" onClick={() => openDay(last.id)}>
              Ili pogledaj poslednji dan
            </button>
          )}
        </div>
        <p className="ld-note">skupstina.live · nezavisan, nestranački projekat · nije zvanični sajt Narodne skupštine</p>
      </section>
      </div>
    </div>
  )
}
