import { useEffect, useState } from 'react'

/** Poslanici koje posetilac ne želi da sluša (id iz mps.json). Pamti se samo u njegovom pregledaču. */
const KEY = 'skupstina-utisani'
const EVT = 'utisani-promena'

export function readMuted(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function writeMuted(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]))
  } catch {
    /* bez pamćenja: važi do zatvaranja strane */
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: [...s] }))
}

/** [utišani, uključi/isključi jednog, postavi sve] — usklađeno između komponenti i tabova */
export function useMuted(): [Set<string>, (id: string) => void, (s: Set<string>) => void] {
  const [m, setM] = useState<Set<string>>(readMuted)
  useEffect(() => {
    const f = (e: Event) => setM(new Set((e as CustomEvent<string[]>).detail))
    const g = (e: StorageEvent) => e.key === KEY && setM(readMuted())
    window.addEventListener(EVT, f)
    window.addEventListener('storage', g)
    return () => {
      window.removeEventListener(EVT, f)
      window.removeEventListener('storage', g)
    }
  }, [])
  const toggle = (id: string) => {
    const n = new Set(m)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    writeMuted(n)
  }
  return [m, toggle, writeMuted]
}
