/** web/public/data/traka-<id>.json (scripts/build_traka.py) */
export type Line = {
  /** reči reda (rečenice) */
  w: string[]
  /** početak svake reči, desetinke sekunde od početka govora */
  t: number[]
  /** prvi red novog pasusa */
  p?: 1
}

export type TSpeech = {
  id: number
  who: string
  /** početak na traci (sekunde programa: delovi snimka jedan za drugim) */
  at: number
  dur: number
  v: string
  /** sekunda snimka v na kojoj govor počinje */
  s: number
  clock: string
  words: number
  /** rec: vreme svake reči iz snimka; procena: reči ravnomerno raspoređene */
  q: 'rec' | 'procena'
  match: number
  summary?: string | null
  lines: Line[]
}

export type Person = {
  name: string
  role?: string | null
  mp?: string
  photo?: string
  party?: string
  list?: string
  color?: string
}

export type Part = { v: string; title: string; dur: number; at: number }

export type VoteResult = { za: number; protiv: number; uzdrzano: number; nije: number; prisutno: number }
export type VoteOption = { key: string; label: string; short?: string; list?: string; n?: number; color?: string }
/** glas poslanika u prozivci: ključ opcije, 'od' odsutan / nije glasao, 'uz' uzdržan, 'ne' ne učestvuje, '?' nije prepoznato */
export type RollVote = { mp: string; v: string; at?: number }
export type Vote = {
  kind: 'glasanje' | 'prozivka' | 'kvorum' | 'konstatacija'
  title: string
  detail?: string
  method?: string
  result?: VoteResult
  present?: number
  passed?: boolean
  outcome?: string
  voted?: number
  sp: number
  at: number
  end: number
  /** kada poslanici zaista glasaju (taster/kartice → „zaključujem”) */
  press?: number
  close?: number
  /** kada je pročitan svaki broj (za, protiv, uzdrzano, nije, prisutno) */
  reveal?: Partial<Record<'za' | 'protiv' | 'uzdrzano' | 'nije' | 'prisutno', number>>
  /** kada predsedavajući konstatuje ishod */
  outcomeAt?: number
  /** redni brojevi reči govora sp koje se ističu u tekstu (taster, zaključujem, brojevi, konstatujem) */
  marks?: number[]
  options?: VoteOption[]
  roll?: RollVote[]
  /** odakle su pojedinačni glasovi: zvanični stenogram ili automatski zapis prenosa */
  rollSource?: 'stenogram' | 'prenos'
}

export type Traka = {
  id: string
  title: string
  date: string
  total: number
  parts: Part[]
  people: Record<string, Person>
  speeches: TSpeech[]
  inter: { at: number; who: string | null; text: string }[]
  votes?: Vote[]
  /** tačke dnevnog reda: redni broj, naslov i početak na traci */
  agenda?: { n: number; title: string; at: number }[]
  lists?: { key: string; name: string; color: string; seats: number }[]
  /** id → [ime, lista, fotografija] */
  mps?: Record<string, [string, string, string]>
}

/** jednostavan sat: page ga pomera iz rAF petlje, komponente slušaju bez React renderovanja */
export class Clock {
  t = 0
  private ls = new Set<(t: number) => void>()
  set(t: number) {
    this.t = t
    this.ls.forEach((l) => l(t))
  }
  on(l: (t: number) => void) {
    this.ls.add(l)
    l(this.t)
    return () => {
      this.ls.delete(l)
    }
  }
}

export const isChair = (p?: Person) => !!p?.role && /predsedava/i.test(p.role)

export function fmtTc(sec: number, withH = true) {
  const x = Math.max(0, Math.floor(sec))
  const h = Math.floor(x / 3600)
  const m = Math.floor((x % 3600) / 60)
  const s = x % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return withH || h ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** poslednji element čiji je ključ ≤ t (niz je sortiran) */
export function lastAtOrBefore<T>(arr: T[], t: number, key: (x: T) => number) {
  let lo = 0
  let hi = arr.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(arr[mid]) <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase()
}

/** CSS zoom (TV): koliko je element uvećan; koordinate miša se dele s tim da bi bile u pikselima elementa */
export function zoomOf(el: Element) {
  const w = (el as HTMLElement).offsetWidth
  return w ? el.getBoundingClientRect().width / w : 1
}
