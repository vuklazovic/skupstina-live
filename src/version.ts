/**
 * Osvežavanje otvorenih strana samo na zahtev: dugme „Osveži sve posetioce” u lokalnom portalu (scripts/rucno.py)
 * piše /data/live/osvezi.json → otvorene strane se jednom ponovo učitaju.
 * Nova verzija sajta (deploy) NE prekida gledanje: posetilac je dobija kad sledeći put otvori ili osveži stranu.
 * Ne osvežava dok neko kuca (polje sa tekstom u fokusu); proba ponovo za minut.
 */
declare const __BUILD__: string

const EVERY = 60_000

async function read(url: string) {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    const d = (await r.json()) as { v?: string; t?: number }
    return String(d.v ?? d.t ?? '')
  } catch {
    return null
  }
}

const typing = () => {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !!el.value
}

export function watchVersion() {
  if (__BUILD__ === 'dev') return
  let force: string | null | undefined // vrednost osvezi.json pri otvaranju strane
  const check = async () => {
    const f = await read('/data/live/osvezi.json')
    if (force === undefined) force = f
    const stale = f && f !== force
    if (!stale) return
    if (typing()) return
    window.location.reload()
  }
  void check()
  setInterval(check, EVERY)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
}
