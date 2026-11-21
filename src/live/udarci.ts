// Zbirovi čekića, srca i zastava stižu u istom zahtevu kao chat (GET /api/chat?posle=…&udarci=…),
// pa gledalac šalje jedan zahtev umesto dva. LiveChat pita i prosleđuje, HammerLayer sluša.
export type Udarci = { now: number; counts: { s: number; cekic: number; srce: number; zastava?: number }[] }

const subs = new Set<(d: Udarci) => void>()
let after = -1 // poslednja viđena sekunda zbira (-1: tek otvorena strana)

export const udarciParam = () => (subs.size ? `&udarci=${after}` : '')
export const setUdarciAfter = (s: number) => {
  after = Math.max(after, s)
}
export function publishUdarci(d: Udarci | undefined) {
  if (d) for (const f of subs) f(d)
}
export function onUdarci(f: (d: Udarci) => void) {
  subs.add(f)
  return () => void subs.delete(f)
}
