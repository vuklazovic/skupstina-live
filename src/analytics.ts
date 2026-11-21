/**
 * Analitika (Umami na analitika.trynow.live, bez kolačića). Skripta se učitava samo na skupstina.live
 * (data-domains u index.html), pa lokalni razvoj ne šalje ništa.
 */
type UmamiProps = Record<string, string | number | boolean>
type Umami = {
  track: {
    (event: string, data?: UmamiProps): void
    (fn: (props: Record<string, unknown>) => Record<string, unknown>): void
  }
}
declare global {
  interface Window {
    umami?: Umami
  }
}

/** Događaj, npr. track('govor-otvoren', { govornik: 'Aleksandar Vučić' }). */
export function track(event: string, data?: UmamiProps) {
  try {
    window.umami?.track(event, data)
  } catch {
    /* analitika nikad ne sme da pokvari sajt */
  }
}

/** Virtuelna „stranica” (uvod, sala, govor), da Umami meri koliko se ljudi zadrže na kom delu sajta. */
export function trackView(url: string, title: string) {
  try {
    window.umami?.track((props) => ({ ...props, url, title }))
  } catch {
    /* analitika nikad ne sme da pokvari sajt */
  }
}
