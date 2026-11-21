export type Mp = {
  id: string
  name: string // "Ime Prezime"
  title?: string // dr, prof. ...
  list: string // izborna lista (kratko)
  listFull: string
  group?: string
  party?: string
  profession?: string
  born?: string
  residence?: string
  confirmed?: string
  photo?: string
  url: string
  bio?: string
  bioUrl?: string
  /** imao je mandat i u prethodnom sazivu */
  prior?: boolean
  /** odakle je fotografija (licenca/izvor) */
  photoCredit?: { text: string; url: string }
}

export type Speaker = {
  key: string
  name: string
  mp_id: string | null
  role: string | null
  count: number
  words: number
}

export type VideoRef = { v: string; s: number; q: 'tacno' | 'priblizno' }

export type SpeechEvent = {
  id: number
  type: 'speech'
  t: number
  dur: number
  clock: string
  speaker: string
  paragraphs: string[]
  words: number
  continued?: boolean
  yt?: VideoRef
  summary?: string
  vdur?: number // sekundi, izmereno iz snimka
  vdur_q?: 'tacno' | 'priblizno'
}
export type InterjectionEvent = {
  id: number
  type: 'interjection'
  t: number
  dur: number
  clock: string
  speaker: string | null
  label: string
  text: string
  yt?: VideoRef
  vdur?: number
  vdur_q?: 'tacno' | 'priblizno'
}
export type StageEvent = { id: number; type: 'stage'; t: number; dur: number; clock: string; text: string }
export type SessionEvent = SpeechEvent | InterjectionEvent | StageEvent

export type Vote = { event: number; t: number; for: string; against: string; abstain: string; not_voted: string; present: string }

export type Session = {
  id: string
  title: string
  date: string
  start: number
  end: number
  pauses: { from: number; to: number }[]
  votes: Vote[]
  speakers: Speaker[]
  events: SessionEvent[]
  agenda: string[]
  source: string
  sourceUrl: string
  video?: { title: string; url: string }[]
  outcomes?: string[]
  moments?: { id: number; title: string; text: string }[]
  progress?: { agendaItem: number; note: string }
  /** od kog minuta dana počinje koja tačka dnevnog reda (item je indeks u agenda) */
  agendaMarks?: { t: number; item: number }[]
  /** tekst je Whisper transkript snimka (stenogram još nije objavljen) */
  auto?: boolean
  /** predložena pitanja za asistenta */
  suggested?: string[]
  /** otvoreno pitanje dana (npr. izbor predsednika) za prvi kadar uvoda */
  race?: Race
  /** dan u toku: ko govori, kada je poslednja izmena */
  live?: LiveInfo
}

/** Govor na koji se poziva uvod: dan sednice i id događaja. */
export type SpeechRef = { session: string; id: number }
export type Race = {
  question: string
  status: string
  statusRef?: SpeechRef
  topNote?: string
  candidates: {
    name: string
    mp_id: string | null
    by: string
    list: string
    proposed?: SpeechRef
    support: ({ who: string } & SpeechRef)[]
  }[]
}

/** status 'live': dan je u toku (podaci iz data/live/, dopunjuju se dok sednica traje); updated: ISO vreme poslednje izmene */
export type SessionMeta = { id: string; title: string; date: string; status: 'ready' | 'pending' | 'live' | 'ended'; note?: string; updated?: string; speeches?: number }

/** stanje prenosa uživo (samo za dan koji je u toku) */
export type LiveInfo = {
  status: 'live' | 'ended'
  updated: string
  now: { speaker: string; chair: boolean; since: string; mp_id: string | null } | null
  pause: boolean
}

export type ListInfo = { key: string; name: string; full: string; color: string; seats: number }
