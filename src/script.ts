/**
 * Ćirilica/latinica za ceo sajt: tekst se piše latinicom, a kad posetilac izabere ćirilicu,
 * svaki tekstualni čvor u stranici se preslovi (i novi tekst, npr. odgovor asistenta dok stiže).
 * Ne diramo polja za unos, adrese, mejlove i strane nazive (YouTube, OpenRouter, „live”…).
 */
export type Script = 'lat' | 'cyr'
export const SCRIPT_KEY = 'skupstina-pismo'

const PAIRS: [string, string][] = [
  ['Lj', 'Љ'], ['LJ', 'Љ'], ['lj', 'љ'], ['Nj', 'Њ'], ['NJ', 'Њ'], ['nj', 'њ'], ['Dž', 'Џ'], ['DŽ', 'Џ'], ['dž', 'џ'],
]
const ONE: Record<string, string> = {
  A: 'А', B: 'Б', C: 'Ц', Č: 'Ч', Ć: 'Ћ', D: 'Д', Đ: 'Ђ', E: 'Е', F: 'Ф', G: 'Г', H: 'Х', I: 'И', J: 'Ј', K: 'К', L: 'Л',
  M: 'М', N: 'Н', O: 'О', P: 'П', R: 'Р', S: 'С', Š: 'Ш', T: 'Т', U: 'У', V: 'В', Z: 'З', Ž: 'Ж',
  a: 'а', b: 'б', c: 'ц', č: 'ч', ć: 'ћ', d: 'д', đ: 'ђ', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'ј', k: 'к', l: 'л',
  m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', š: 'ш', t: 'т', u: 'у', v: 'в', z: 'з', ž: 'ж',
}
// reči koje ostaju latinicom (nazivi, skraćenice koje se ne preslovljavaju)
const KEEP = new Set(['AI', 'live', 'Live', 'LIVE', 'Umami', 'Resend', 'Commons', 'Wikimedia', 'Wikipedia', 'Wikipedija', 'CC', 'BY', 'SA', 'BBC', 'API'])

function word(w: string) {
  // rimski brojevi (Deo II, IV) ostaju; „h” za sate je „ч”
  if (/^[IVXLCM]+$/.test(w)) return w
  if (w === 'h') return 'ч'
  // strana reč (q, w, x, y) ili mešana velika slova unutra (OpenRouter, YouTube, DeepSeek)
  if (KEEP.has(w) || /[qwxyQWXY]/.test(w) || /^[a-zčćšđž]+[A-ZČĆŠĐŽ]/.test(w) || /^[A-ZČĆŠĐŽ][a-zčćšđž]+[A-ZČĆŠĐŽ]/.test(w)) return w
  let out = ''
  for (let i = 0; i < w.length; i++) {
    const two = w.slice(i, i + 2)
    const p = PAIRS.find(([l]) => l === two)
    if (p) {
      out += p[1]
      i++
    } else out += ONE[w[i]] ?? w[i]
  }
  return out
}

/** Preslovi tekst; delovi koji liče na adresu ili mejl ostaju kako jesu. */
export function toCyr(text: string) {
  return text
    .split(/(\S*(?:https?:\/\/|www\.|@|\.(?:rs|live|com|org|net)\b)\S*)/)
    .map((part, i) => (i % 2 ? part : part.replace(/[A-Za-zČĆŠĐŽčćšđž]+/g, word)))
    .join('')
}

const SKIP = 'input,textarea,script,style,code,pre,[data-lat]'
const orig = new Map<Text, { lat: string; cyr: string }>()
let active = false
let observer: MutationObserver | null = null
let busy = false

function convert(node: Text) {
  const parent = node.parentElement
  if (!parent || parent.closest(SKIP)) return
  const cur = node.data
  const known = orig.get(node)
  // React je u međuvremenu upisao novi (latinični) tekst: to je novi original
  const lat = known && known.cyr === cur ? known.lat : cur
  const cyr = toCyr(lat)
  orig.set(node, { lat, cyr })
  if (cur !== cyr) node.data = cyr
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return convert(root as Text)
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) convert(n as Text)
}
const ATTRS = ['placeholder', 'title', 'aria-label']
function attrs(root: ParentNode) {
  root.querySelectorAll?.(ATTRS.map((a) => `[${a}]`).join(',')).forEach((el) => {
    if (el.closest('[data-lat]')) return
    ATTRS.forEach((a) => {
      const v = el.getAttribute(a)
      if (!v) return
      const key = `data-lat-${a}`
      const base = el.getAttribute(key) && toCyr(el.getAttribute(key)!) === v ? el.getAttribute(key)! : v
      el.setAttribute(key, base)
      const c = toCyr(base)
      if (c !== v) el.setAttribute(a, c)
    })
  })
}

export function applyScript(s: Script) {
  document.documentElement.lang = s === 'cyr' ? 'sr-Cyrl' : 'sr-Latn'
  const t = document.querySelector('title')
  if (t) {
    t.dataset.lat ??= t.textContent ?? ''
    t.textContent = s === 'cyr' ? toCyr(t.dataset.lat) : t.dataset.lat
  }
  if (s === 'cyr' && !active) {
    active = true
    busy = true
    walk(document.body)
    attrs(document.body)
    busy = false
    observer = new MutationObserver((list) => {
      if (busy) return
      busy = true
      // čvorovi koji su izbačeni iz stranice ne treba da se pamte
      if (orig.size > 4000) orig.forEach((_, n) => !n.isConnected && orig.delete(n))
      for (const m of list) {
        if (m.type === 'characterData') convert(m.target as Text)
        else m.addedNodes.forEach((n) => {
          walk(n)
          if (n instanceof Element) attrs(n)
        })
      }
      busy = false
    })
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
  } else if (s === 'lat' && active) {
    active = false
    observer?.disconnect()
    observer = null
    orig.forEach((v, node) => {
      if (node.isConnected && node.data === v.cyr) node.data = v.lat
    })
    orig.clear()
    document.querySelectorAll('[data-lat-placeholder],[data-lat-title],[data-lat-aria-label]').forEach((el) =>
      ATTRS.forEach((a) => {
        const v = el.getAttribute(`data-lat-${a}`)
        if (v != null) el.setAttribute(a, v)
      }),
    )
  }
}

export function savedScript(): Script {
  try {
    return localStorage.getItem(SCRIPT_KEY) === 'cyr' ? 'cyr' : 'lat'
  } catch {
    return 'lat'
  }
}
export function saveScript(s: Script) {
  try {
    localStorage.setItem(SCRIPT_KEY, s)
  } catch {
    /* bez pamćenja */
  }
}
