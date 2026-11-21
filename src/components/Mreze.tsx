import { track } from '../analytics'

/**
 * Profili sajta na društvenim mrežama. Sajt nema reklame ni pretplatu i održava se dobrovoljno,
 * pa je praćenje na mrežama jedina podrška koju tražimo. Isti nalog „skupstinalive” na sve tri mreže,
 * a uz njih i mejl uredništva (ista adresa je i u prozoru „Kontakt”).
 */
type Mreza = { key: 'x' | 'instagram' | 'tiktok' | 'mejl'; name: string; href: string; what: string }

export const MEJL = 'skupstinalive@gmail.com'

export const MREZE: Mreza[] = [
  { key: 'tiktok', name: 'TikTok', href: 'https://www.tiktok.com/@skupstinalive', what: 'Najvažniji govori u kratkim snimcima' },
  { key: 'instagram', name: 'Instagram', href: 'https://www.instagram.com/skupstinalive', what: 'Ključni trenuci i glasanja, dan po dan' },
  { key: 'x', name: 'X', href: 'https://x.com/skupstinalive', what: 'Šta se dešava u sali, dok traje' },
  { key: 'mejl', name: 'Mejl', href: `mailto:${MEJL}`, what: 'Primedba, ispravka, predlog ili saradnja' },
]

/** Mejl se otvara u programu za poštu, ne u novoj kartici. */
const cilj = (m: Mreza) => (m.key === 'mejl' ? {} : { target: '_blank', rel: 'noopener' })
const opis = (m: Mreza) => (m.key === 'mejl' ? MEJL : '@skupstinalive')

export function MrezaIkona({ k }: { k: Mreza['key'] }) {
  if (k === 'x')
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path fill="currentColor" d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.6l5.24 6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3Z" />
      </svg>
    )
  if (k === 'mejl')
    return (
      <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
        <path d="m3.5 7 8.5 6.2L20.5 7" />
      </svg>
    )
  if (k === 'instagram')
    return (
      <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4.4" />
        <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12.53.02c1.3-.02 2.6-.01 3.9-.02.09 1.53.64 3.09 1.76 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03a10.7 10.7 0 0 1-5.82-1.9c-.01 2.92.01 5.84-.02 8.75a7.6 7.6 0 0 1-1.35 3.94 7.43 7.43 0 0 1-5.91 3.21 7.27 7.27 0 0 1-4.08-1.03 7.53 7.53 0 0 1-3.65-5.71c-.02-.5-.03-1-.01-1.49a7.5 7.5 0 0 1 8.73-6.68c.02 1.48-.04 2.96-.04 4.44a3.42 3.42 0 0 0-4.38 2.12c-.21.51-.15 1.07-.14 1.61a3.38 3.38 0 0 0 6.27 1.26c.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z"
      />
    </svg>
  )
}

const open = (m: Mreza, gde: string) => track('mreza-klik', { mreza: m.key, gde })

/** Veliki blok za početnu: poziv da nas prate, uz objašnjenje da se sajt održava iz džepa. */
export function MrezePoziv({ gde = 'pocetna' }: { gde?: string }) {
  return (
    <section className="mz" aria-labelledby="mz-h">
      <span className="eyebrow">Jedina podrška koju tražimo</span>
      <h2 id="mz-h">Zaprati nas. To je sve.</h2>
      <p>
        Sajt nema reklame, pretplatu ni sponzore. Server, prepis i sažetak svakog govora plaćaju se iz sopstvenog džepa, dobrom
        voljom. Ne tražimo novac: ako ti je ovo korisno, zaprati nas na mreži koju koristiš i pošalji govor nekome kome treba.
        Svaki novi pratilac je znak da vredi nastaviti.
      </p>
      <div className="mz-list">
        {MREZE.map((m) => (
          <a key={m.key} className={`mz-card ${m.key}`} href={m.href} {...cilj(m)} onClick={() => open(m, gde)}>
            <span className="mz-ic">
              <MrezaIkona k={m.key} />
            </span>
            <span className="mz-txt">
              <b>{m.name}</b>
              <small>{m.what}</small>
            </span>
            <span className="mz-cta">{m.key === 'mejl' ? `${MEJL} →` : 'Zaprati @skupstinalive →'}</span>
          </a>
        ))}
      </div>
    </section>
  )
}

/** Mali red ikonica (prenos uživo, pored kontakta). */
export function MrezeRed({ gde }: { gde: string }) {
  return (
    <div className="mz-row">
      <span>Podrži nas: zaprati</span>
      {MREZE.map((m) => (
        <a key={m.key} href={m.href} {...cilj(m)} title={`${m.name} · ${opis(m)}`} aria-label={`${m.name}: ${opis(m)}`} onClick={() => open(m, gde)}>
          <MrezaIkona k={m.key} />
        </a>
      ))}
    </div>
  )
}
