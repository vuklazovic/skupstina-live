import type { InterjectionEvent, Session, SpeechEvent, VideoRef } from './types'

/**
 * Nastup: jedan ili više uzastopnih govora istog govornika, između kojih su upala samo
 * dobacivanja ili kratke napomene (ne govor druge osobe i ne pauza).
 */
export type Turn = {
  id: number // id prvog govora
  speaker: string
  parts: SpeechEvent[]
  /** tekst redom: pasusi govornika i dobacivanja drugih između delova */
  segments: ({ kind: 'p'; text: string } | { kind: 'inter'; label: string; text: string })[]
  paragraphs: string[]
  t: number
  clock: string
  dur: number // minuta (procena iz stenograma)
  vdur?: number // sekundi, izmereno iz snimka
  words: number
  yt?: VideoRef
  /** sažetak: jedan, ili po jedan za svaki duži deo */
  summaries: { clock: string; text: string }[]
}

const SHORT = 40

export function buildTurns(session: Session): Turn[] {
  const ev = session.events
  const speeches = ev.filter((e): e is SpeechEvent => e.type === 'speech')
  const groups: SpeechEvent[][] = []
  for (const s of speeches) {
    const g = groups[groups.length - 1]
    const prev = g?.[g.length - 1]
    const pauseBetween = prev && session.pauses.some((p) => prev.t < p.to && s.t >= p.from)
    if (g && prev!.speaker === s.speaker && !pauseBetween) g.push(s)
    else groups.push([s])
  }

  return groups.map((parts) => {
    const first = parts[0]
    const last = parts[parts.length - 1]
    const segments: Turn['segments'] = []
    parts.forEach((p, i) => {
      p.paragraphs.forEach((text) => segments.push({ kind: 'p', text }))
      const next = parts[i + 1]
      if (next) {
        ev.filter((e): e is InterjectionEvent => e.type === 'interjection' && e.id > p.id && e.id < next.id).forEach((x) =>
          segments.push({ kind: 'inter', label: x.label, text: x.text }),
        )
      }
    })
    const sameVideo = parts.every((p) => p.yt && p.yt.v === first.yt?.v)
    let vdur: number | undefined
    if (sameVideo && first.yt && last.yt && last.vdur != null) vdur = last.yt.s + last.vdur - first.yt.s
    else if (parts.every((p) => p.vdur != null)) vdur = parts.reduce((a, p) => a + (p.vdur ?? 0), 0)
    const long = parts.filter((p) => p.words > SHORT && p.summary)
    return {
      id: first.id,
      speaker: first.speaker,
      parts,
      segments,
      paragraphs: parts.flatMap((p) => p.paragraphs),
      t: first.t,
      clock: first.clock,
      dur: parts.reduce((a, p) => a + p.dur, 0),
      vdur,
      words: parts.reduce((a, p) => a + p.words, 0),
      yt: first.yt,
      summaries: long.map((p) => ({ clock: p.clock, text: p.summary! })),
    }
  })
}
