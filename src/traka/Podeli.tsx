import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { track } from '../analytics'
import { isChair, type Traka, type TSpeech } from './types'
import './podeli.css'

/**
 * Deljenje: citat, statistika dana ili jedan govornik kao slika (objava 4:5 ili priča 9:16) + link koji otvara
 * tačno taj trenutak snimka (?dan=<id>&t=<sekunda>). Slika se crta u pregledaču (canvas), server ne učestvuje.
 */

export type QuoteCard = {
  kind: 'citat'
  text: string
  name: string
  sub: string
  color: string
  photo?: string
  date: string
  clock: string
  /** citat je skraćen (posetilac je označio više nego što staje) */
  cut?: boolean
  /** kada je izgovorena svaka reč, sekunde od prve reči (za video) */
  times?: number[]
  /** originalan zvuk: YouTube snimak, sekunda prve reči u njemu, trajanje citata */
  audio?: { v: string; s: number; dur: number }
  /** video: snimak iz sale u sredini (umesto plakata) */
  clip?: boolean
  /** istaknute reči (redni brojevi reči u text) */
  hl?: number[]
  /** plakat: lice veliko, citat preko; tamno: znak navoda i malo lice */
  style?: 'plakat' | 'tamno'
}
export type StatRow = { name: string; photo?: string; color: string; value: string; frac: number }
export type StatCard = {
  kind: 'stat'
  eyebrow: string
  title: string
  big: string
  bigSub: string
  rowsTitle: string
  rows: StatRow[]
  bar?: { name: string; color: string; frac: number }[]
  date: string
  /** boja pozadine (lista govornika kod kartice jednog govornika) */
  color?: string
  photo?: string
}
export type Card = QuoteCard | StatCard
export type Share = {
  card: Card
  url: string
  text: string
  label: string
  /** citat iz govora: prva i poslednja reč i broj reči govora (za dodavanje i oduzimanje reči) */
  range?: [number, number, number]
  rebuild?: (a: number, b: number) => Share
}

type Fmt = 'post' | 'story'
const SIZE: Record<Fmt, [number, number]> = { post: [1080, 1350], story: [1080, 1920] }
const DISPLAY = 'Archivo, "Arial Narrow", sans-serif'
const BODY = '"IBM Plex Sans", system-ui, sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, monospace'
const TUNGSTEN = '#ffc56b'
const BG = '#0a0d13'

export const fmtDate = (iso: string) => `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}.`
export const fmtDur = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export const dayUrl = (id: string, t?: number, extra?: Record<string, string>) => {
  const u = new URL('/', window.location.origin)
  u.searchParams.set('dan', id)
  if (t != null) u.searchParams.set('t', String(Math.max(0, Math.floor(t))))
  for (const [k, v] of Object.entries(extra ?? {})) u.searchParams.set(k, v)
  return u.toString()
}

/** reči → citat koji staje na karticu (najviše ~44 reči, skraćuje se na kraju rečenice kad može) */
export function quoteText(words: string[]) {
  const MAX = 60
  if (words.length <= MAX) return { text: words.join(' '), cut: false }
  let end = MAX
  for (let i = MAX; i > 18; i--) if (/[.!?]$/.test(words[i - 1])) {
    end = i
    break
  }
  return { text: words.slice(0, end).join(' ').replace(/[,;:–-]$/, '') + (end === MAX ? ' …' : ''), cut: true }
}

export function quoteShare(data: Traka, who: string, words: string[], at: number, clock: string, times?: number[]): Share {
  const p = data.people[who]
  const q = quoteText(words)
  const name = p?.name ?? who
  const url = dayUrl(data.id, at - 1)
  return {
    label: 'citat',
    url,
    text: `„${q.text}” — ${name}, Narodna skupština, ${fmtDate(data.date)}`,
    card: {
      kind: 'citat',
      text: q.text,
      cut: q.cut,
      times: times?.map((x) => x - (times[0] ?? 0)),
      name,
      sub: isChair(p) ? p?.role ?? '' : p?.party ?? p?.list ?? p?.role ?? '',
      color: p?.color ?? '#8e98ab',
      photo: p?.photo,
      date: data.date,
      clock,
    },
  }
}

/** sat u sali („14:32” ili „14:32:10”) + sekunde → „14:33” */
export function hallClock(start: string, plus: number) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(start)
  if (!m) return start
  const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) + Math.max(0, Math.round(plus))
  return `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`
}

/** citat iz govora s: reči a..b (redni brojevi u celom govoru); može da se proširi ili skrati (rebuild) */
export function speechQuote(data: Traka, s: TSpeech, a: number, b: number): Share {
  const ws: string[] = []
  const ts: number[] = []
  s.lines.forEach((l) => l.w.forEach((w, k) => (ws.push(w), ts.push(s.at + l.t[k] / 10))))
  const n = ws.length
  a = Math.max(0, Math.min(n - 1, a))
  b = Math.max(a, Math.min(n - 1, b))
  const at = ts[a]
  const end = Math.min((ts[b + 1] ?? s.at + s.dur) - 0.04, ts[b] + 1.6)
  const sh = quoteShare(data, s.who, ws.slice(a, b + 1), at, hallClock(s.clock, at - s.at), ts.slice(a, b + 1))
  // deo snimka i sekunda u njemu za trenutak prve reči (govor može da pređe u sledeći deo snimka)
  const part = data.parts.find((p) => at >= p.at && at < p.at + p.dur)
  const where = part ? { v: part.v, s: at - part.at } : { v: s.v, s: s.s + (at - s.at) }
  if (sh.card.kind === 'citat') sh.card.audio = { ...where, dur: Math.max(0.5, end - at) }
  sh.range = [a, b, n]
  sh.rebuild = (na, nb) => speechQuote(data, s, na, nb)
  return sh
}

/** statistika dana kao kartica */
export function dayShare(data: Traka): Share {
  const byWho = new Map<string, { dur: number; n: number }>()
  const byList = new Map<string, { dur: number; color: string }>()
  let talk = 0
  let n = 0
  for (const s of data.speeches) {
    const p = data.people[s.who]
    if (isChair(p)) continue
    talk += s.dur
    n++
    const w = byWho.get(s.who) ?? { dur: 0, n: 0 }
    w.dur += s.dur
    w.n++
    byWho.set(s.who, w)
    const key = p?.list ?? 'Ostali'
    const l = byList.get(key) ?? { dur: 0, color: p?.color ?? '#8e98ab' }
    l.dur += s.dur
    byList.set(key, l)
  }
  const top = [...byWho.entries()].sort((a, b) => b[1].dur - a[1].dur).slice(0, 5)
  const max = top[0]?.[1].dur || 1
  const votes = (data.votes ?? []).filter((v) => v.kind === 'glasanje' || v.kind === 'prozivka').length
  const title = data.title.replace(/^.*·\s*/, '')
  return {
    label: 'statistika-dana',
    url: dayUrl(data.id),
    text: `${data.title}, ${fmtDate(data.date)}: ${fmtDur(talk)} govora, ${byWho.size} govornika. Ko je koliko govorio:`,
    card: {
      kind: 'stat',
      eyebrow: data.title.replace(/\s*·.*$/, ''),
      title: `${title[0].toUpperCase()}${title.slice(1)} · ${fmtDate(data.date)}`,
      big: fmtDur(talk),
      bigSub: `govora · ${n} javljanja · ${byWho.size} govornika${votes ? ` · ${votes} ${votes === 1 ? 'glasanje' : 'glasanja'}` : ''}`,
      rowsTitle: 'Najduže su govorili',
      rows: top.map(([who, v]) => {
        const p = data.people[who]
        return { name: p?.name ?? who, photo: p?.photo, color: p?.color ?? '#8e98ab', value: `${fmtDur(v.dur)} · ${v.n}×`, frac: v.dur / max }
      }),
      bar: [...byList.entries()].sort((a, b) => b[1].dur - a[1].dur).map(([name, v]) => ({ name, color: v.color, frac: v.dur / (talk || 1) })),
      date: data.date,
    },
  }
}

/** jedan govornik: svi njegovi govori (danas i, iz traka-govornici.json, ukupno) */
export function personShare(data: Traka, who: string, days: { id: string; date: string }[], index: Record<string, { sec: number; days: Record<string, [number, number, number, string, string][]> }> | null): Share {
  const p = data.people[who]
  const name = p?.name ?? who
  const all = index?.[who]
  const perDay = days
    .map((d) => ({ d, list: all?.days[d.id] ?? (d.id === data.id ? data.speeches.filter((s) => s.who === who).map((s) => [s.id, s.at, s.dur, s.clock, ''] as [number, number, number, string, string]) : []) }))
    .filter((x) => x.list.length)
  const secs = perDay.map((x) => x.list.reduce((a, s) => a + s[2], 0))
  const total = all?.sec ?? secs.reduce((a, b) => a + b, 0)
  const nAll = perDay.reduce((a, x) => a + x.list.length, 0)
  const max = Math.max(1, ...secs)
  return {
    label: 'govornik',
    url: dayUrl(data.id, undefined, { prati: who }),
    text: `${name} u Narodnoj skupštini: ${nAll} ${nAll === 1 ? 'javljanje' : 'javljanja'}, ukupno ${fmtDur(total)}. Svi govori sa snimkom:`,
    card: {
      kind: 'stat',
      eyebrow: isChair(p) ? p?.role ?? 'Narodna skupština' : p?.party ?? p?.list ?? 'Narodna skupština',
      title: name,
      big: fmtDur(total),
      bigSub: `za govornicom · ${nAll} ${nAll === 1 ? 'javljanje' : 'javljanja'} · ${perDay.length} ${perDay.length === 1 ? 'dan' : 'dana'}`,
      rowsTitle: 'Po danima',
      rows: perDay.map((x, i) => ({ name: fmtDate(x.d.date), color: p?.color ?? '#8e98ab', value: `${fmtDur(secs[i])} · ${x.list.length}×`, frac: secs[i] / max })),
      date: data.date,
      color: p?.color,
      photo: p?.photo,
    },
  }
}

/**
 * „Citati dana”: rečenice koje se najlakše dele (uzvik, retoričko pitanje, reakcija sale odmah posle), bez predsedavajućeg
 * i bez pozdrava; po jedna od svakog govornika i redom po listama, da nijedna strana ne preovlada.
 */
export function pickQuotes(data: Traka, limit = 9) {
  const SKIP = /^(hvala|zahvaljujem|poštovan|uvažen|dame i gospodo|reč ima|izvolite|dobar dan|dobro jutro|molim)/i
  const inter = data.inter.map((x) => x.at).sort((a, b) => a - b)
  const reacted = (from: number, to: number) => inter.some((t) => t >= from && t <= to)
  type C = { who: string; words: string[]; sp: TSpeech; a: number; at: number; clock: string; score: number; list: string }
  const best = new Map<string, C>()
  for (const s of data.speeches) {
    const p = data.people[s.who]
    if (isChair(p) || s.dur < 20) continue
    let base = 0
    s.lines.forEach((ln, li) => {
      const lb = base
      base += ln.w.length
      const w = ln.w
      if (w.length < 6 || w.length > 30) return
      const txt = w.join(' ')
      // samo cele rečenice: počinje velikim slovom (ili navodnikom), završava se znakom interpunkcije
      if (SKIP.test(txt) || /\d{3,}/.test(txt) || !/^[„"(]?\p{Lu}/u.test(txt) || !/[.!?…]$/.test(w[w.length - 1])) return
      const last = w[w.length - 1]
      const next = s.lines[li + 1]
      const start = s.at + ln.t[0] / 10
      const end = next ? s.at + next.t[0] / 10 : s.at + s.dur
      let score = 0
      if (last.endsWith('!')) score += 3
      else if (last.endsWith('?')) score += 1.5
      if (reacted(end - 1, end + 6)) score += 3
      if (w.length >= 8 && w.length <= 20) score += 1
      if (score < 2.5) return
      const c: C = { who: s.who, words: w, sp: s, a: lb, at: start, clock: s.clock, score, list: p?.list ?? 'Ostali' }
      const old = best.get(s.who)
      if (!old || c.score > old.score || (c.score === old.score && w.length < old.words.length)) best.set(s.who, c)
    })
  }
  const byList = new Map<string, C[]>()
  for (const c of best.values()) byList.set(c.list, [...(byList.get(c.list) ?? []), c])
  byList.forEach((l) => l.sort((a, b) => b.score - a.score))
  const out: C[] = []
  const lists = [...byList.values()].sort((a, b) => b[0].score - a[0].score)
  for (let r = 0; out.length < limit && lists.some((l) => l[r]); r++) for (const l of lists) if (l[r] && out.length < limit) out.push(l[r])
  return out
}

// ---------------------------------------------------------------- crtanje

const imgCache = new Map<string, Promise<HTMLImageElement | null>>()
function loadImg(src?: string) {
  if (!src) return Promise.resolve(null)
  if (!imgCache.has(src))
    imgCache.set(
      src,
      new Promise((res) => {
        const i = new Image()
        i.onload = () => res(i)
        i.onerror = () => res(null)
        i.src = src.startsWith('http') || src.startsWith('/') ? src : `/${src}`
      }),
    )
  return imgCache.get(src)!
}

let fontsReady: Promise<unknown> | null = null
const loadFonts = () =>
  (fontsReady ??= Promise.all(
    ['800 80px Archivo', '700 80px Archivo', '500 30px "IBM Plex Mono"', '400 30px "IBM Plex Sans"', '600 30px "IBM Plex Sans"'].map((f) => document.fonts?.load(f).catch(() => null)),
  ))

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = []
  let line = ''
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) {
      out.push(line)
      line = w
    } else line = t
  }
  if (line) out.push(line)
  return out
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, fy = 0.22) {
  const s = Math.max(w / img.width, h / img.height)
  const sw = w / s
  const sh = h / s
  ctx.drawImage(img, (img.width - sw) / 2, Math.max(0, (img.height - sh) * fy), sw, sh, x, y, w, h)
}

function circle(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, r: number, color: string, name: string) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = hexA(color, 0.35)
  ctx.fill()
  ctx.clip()
  if (img) cover(ctx, img, x - r, y - r, r * 2, r * 2, 0.15)
  else {
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${r * 0.8}px ${DISPLAY}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name.split(/\s+/).slice(0, 2).map((x) => x[0]).join(''), x, y)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.lineWidth = Math.max(3, r * 0.06)
  ctx.strokeStyle = color
  ctx.stroke()
}

function background(ctx: CanvasRenderingContext2D, W: number, H: number, color: string, photo: HTMLImageElement | null) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  // velika fotografija desno gore, utapa se u pozadinu
  if (photo) {
    const pw = W * 0.72
    const ph = H * 0.58
    const off = document.createElement('canvas')
    off.width = pw
    off.height = ph
    const o = off.getContext('2d')!
    o.filter = 'grayscale(0.35) contrast(1.08)'
    cover(o, photo, 0, 0, pw, ph, 0.12)
    o.filter = 'none'
    o.globalCompositeOperation = 'destination-in'
    const gx = o.createLinearGradient(0, 0, pw, 0)
    gx.addColorStop(0, 'rgba(0,0,0,0)')
    gx.addColorStop(0.55, 'rgba(0,0,0,.75)')
    gx.addColorStop(1, 'rgba(0,0,0,1)')
    o.fillStyle = gx
    o.fillRect(0, 0, pw, ph)
    const gy = o.createLinearGradient(0, 0, 0, ph)
    gy.addColorStop(0, 'rgba(0,0,0,1)')
    gy.addColorStop(0.6, 'rgba(0,0,0,.7)')
    gy.addColorStop(1, 'rgba(0,0,0,0)')
    o.fillStyle = gy
    o.fillRect(0, 0, pw, ph)
    ctx.globalAlpha = 0.5
    ctx.drawImage(off, W - pw, 0)
    ctx.globalAlpha = 1
  }
  let g = ctx.createRadialGradient(W * 0.9, H * 0.08, 0, W * 0.9, H * 0.08, W * 0.95)
  g.addColorStop(0, hexA(color, 0.5))
  g.addColorStop(1, hexA(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  g = ctx.createRadialGradient(0, H, 0, 0, H, W * 0.9)
  g.addColorStop(0, hexA(color, 0.28))
  g.addColorStop(1, hexA(color, 0))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // traka u boji liste levo
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 14, H)
}

function header(ctx: CanvasRenderingContext2D, x: number, y: number, left: string, right: string) {
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `500 26px ${MONO}`
  ctx.fillStyle = 'rgba(255,255,255,.62)'
  ctx.fillText(left.toUpperCase(), x, y)
  ctx.fillStyle = 'rgba(255,255,255,.42)'
  ctx.fillText(right, x, y + 40)
}

function footer(ctx: CanvasRenderingContext2D, W: number, H: number, pad: number, note: string) {
  const y = H - pad
  ctx.fillStyle = 'rgba(255,255,255,.14)'
  ctx.fillRect(pad, y - 74, W - pad * 2, 2)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `400 25px ${BODY}`
  ctx.fillStyle = 'rgba(255,255,255,.55)'
  ctx.fillText(note, pad, y - 8)
  // znak: polukrug sale + skupstina.live
  ctx.textAlign = 'right'
  ctx.font = `800 40px ${DISPLAY}`
  ctx.fillStyle = '#fff'
  const label = 'skupstina.live'
  ctx.fillText(label, W - pad, y - 4)
  const lw = ctx.measureText(label).width
  ctx.beginPath()
  ctx.arc(W - pad - lw - 34, y - 6, 18, Math.PI, 0)
  ctx.lineWidth = 5
  ctx.strokeStyle = TUNGSTEN
  ctx.stroke()
}

type QLayout = { words: { w: string; x: number; y: number; t: number; wd: number }[]; size: number; hl: Set<number>; ink: string; dim: number; ctaY: number }

/** poslanik bez bele pozadine (fotografije sa sajta Skupštine su 150×209 na beloj podlozi): popunjavanje od ivica */
const cutCache = new Map<HTMLImageElement, HTMLCanvasElement>()
function cutout(img: HTMLImageElement) {
  const hit = cutCache.get(img)
  if (hit) return hit
  const w = img.naturalWidth
  const h = img.naturalHeight
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, w, h)
  const px = d.data
  const bgLike = (i: number) => {
    const r = px[i * 4]
    const g = px[i * 4 + 1]
    const b = px[i * 4 + 2]
    return Math.min(r, g, b) > 206 && Math.max(r, g, b) - Math.min(r, g, b) < 26
  }
  const out = new Uint8Array(w * h)
  const st: number[] = []
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1)
  while (st.length) {
    const i = st.pop()!
    if (out[i] || !bgLike(i)) continue
    out[i] = 1
    const x = i % w
    const y = (i - x) / w
    if (x > 0) st.push(i - 1)
    if (x < w - 1) st.push(i + 1)
    if (y > 0) st.push(i - w)
    if (y < h - 1) st.push(i + w)
  }
  // pozadina providna, ivica meka (pola providnosti tamo gde se dodiruje sa pozadinom)
  for (let i = 0; i < w * h; i++) {
    if (out[i]) px[i * 4 + 3] = 0
    else {
      const x = i % w
      const n = (x > 0 && out[i - 1]) || (x < w - 1 && out[i + 1]) || out[i - w] || out[i + w]
      if (n) px[i * 4 + 3] = 120
    }
  }
  // ako je skoro sve „pozadina” (svetla odeća), bolje cela fotografija nego pola osobe
  const gone = out.reduce((a, v) => a + v, 0) / (w * h)
  if (gone < 0.75) ctx.putImageData(d, 0, 0)
  cutCache.set(img, cv)
  return cv
}

/** osoba uveličana preko kartice: crno-belo, kontrast, rastrer tačkica (sakriva malu rezoluciju) */
function poster(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, h: number, color: string) {
  const cut = cutout(img)
  const w = (h * cut.width) / cut.height
  const off = document.createElement('canvas')
  off.width = Math.round(w)
  off.height = Math.round(h)
  const o = off.getContext('2d')!
  o.imageSmoothingQuality = 'high'
  o.filter = 'grayscale(1) contrast(1.25) brightness(1.05)'
  o.drawImage(cut, 0, 0, w, h)
  o.filter = 'none'
  // boja liste u senkama
  o.globalCompositeOperation = 'source-atop'
  o.globalAlpha = 0.28
  o.fillStyle = color
  o.fillRect(0, 0, w, h)
  o.globalAlpha = 1
  // rastrer
  const dot = document.createElement('canvas')
  dot.width = dot.height = 9
  const dc = dot.getContext('2d')!
  dc.fillStyle = 'rgba(0,0,0,.32)'
  dc.beginPath()
  dc.arc(4.5, 4.5, 2.1, 0, Math.PI * 2)
  dc.fill()
  o.fillStyle = o.createPattern(dot, 'repeat')!
  o.fillRect(0, 0, w, h)
  // donji deo se utapa
  o.globalCompositeOperation = 'destination-out'
  const g = o.createLinearGradient(0, h * 0.72, 0, h)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(0,0,0,1)')
  o.fillStyle = g
  o.fillRect(0, 0, w, h)
  ctx.drawImage(off, x, y)
  return w
}

/** nepomični deo kartice citata (pozadina, lice, ko je rekao, podnožje) + raspored reči citata */
async function quoteBase(c: QuoteCard, fmt: Fmt) {
  const [W, H] = SIZE[fmt]
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const photo = await loadImg(c.photo)
  const pad = 72
  const plakat = (c.style ?? 'plakat') === 'plakat'
  const hl = new Set(c.hl ?? [])
  let boxTop = 0
  let boxBot = 0
  let maxW = 0
  // citat: najveći font koji staje (u plakatu sa navodnicima oko teksta)
  const fitText = () => {
    const body = plakat ? `„${c.text}”` : `${c.text}”`
    let size = plakat ? (fmt === 'story' ? 124 : 112) : 104
    let lines: string[] = []
    for (; size >= 40; size -= 4) {
      ctx.font = `800 ${size}px ${DISPLAY}`
      lines = wrap(ctx, body, maxW)
      if (lines.length * size * 1.12 <= boxBot - boxTop) break
    }
    const lh = size * 1.12
    const y0 = boxTop + size + (plakat ? 0 : Math.max(0, (boxBot - boxTop - lines.length * lh) * (fmt === 'story' ? 0.35 : 0.15)))
    return { size, lines, lh, y0 }
  }

  if (plakat) {
    // tamna podloga, sjaj u boji liste iza osobe, osoba veliko desno dole
    ctx.fillStyle = '#07090d'
    ctx.fillRect(0, 0, W, H)
    let g = ctx.createRadialGradient(W * 0.78, H * 0.7, 0, W * 0.78, H * 0.7, W * 0.85)
    g.addColorStop(0, hexA(c.color, 0.85))
    g.addColorStop(0.55, hexA(c.color, 0.25))
    g.addColorStop(1, hexA(c.color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // kose pruge u pozadini
    ctx.save()
    ctx.globalAlpha = 0.07
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    for (let x = -H; x < W; x += 26) {
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.lineTo(x + H, 0)
      ctx.stroke()
    }
    ctx.restore()
    boxTop = pad + 110
    boxBot = H * 0.55
    maxW = W - pad * 2 - 20
    // lice ispod citata: dugačak citat spušta (i smanjuje) osobu, da tekst ne pokrije lice
    const ft = fitText()
    const textBot = ft.y0 + (ft.lines.length - 1) * ft.lh + ft.size * 0.25
    const bottom = H - (fmt === 'story' ? 150 : 96)
    const ph = Math.max(H * 0.38, Math.min(fmt === 'story' ? H * 0.6 : H * 0.66, (bottom - textBot) / 0.88))
    if (photo) {
      const pw = (ph * photo.naturalWidth) / photo.naturalHeight
      poster(ctx, photo, W - pw + pw * 0.12, bottom - ph, ph, c.color)
    }
    // tama odozgo i sleva, da citat bude čitljiv preko lica
    g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, 'rgba(7,9,13,.92)')
    g.addColorStop(fmt === 'story' ? 0.42 : 0.36, 'rgba(7,9,13,.55)')
    g.addColorStop(0.62, 'rgba(7,9,13,0)')
    g.addColorStop(0.86, 'rgba(7,9,13,.35)')
    g.addColorStop(1, 'rgba(7,9,13,.95)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    g = ctx.createLinearGradient(0, 0, W, 0)
    g.addColorStop(0, 'rgba(7,9,13,.75)')
    g.addColorStop(0.55, 'rgba(7,9,13,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)

    // gore: oznaka
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.font = `600 25px ${MONO}`
    const tag = 'REČENO U SKUPŠTINI'
    const tw = ctx.measureText(tag).width
    ctx.fillStyle = '#e5484d'
    ctx.beginPath()
    ctx.roundRect(pad, pad - 6, tw + 64, 50, 25)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(pad + 24, pad + 19, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillText(tag, pad + 42, pad + 28)
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,255,255,.7)'
    ctx.font = `500 25px ${MONO}`
    ctx.fillText(fmtDate(c.date), W - pad, pad + 28)


    // ime: crna traka + traka u boji liste
    const ny = H - (fmt === 'story' ? 330 : 250)
    ctx.textAlign = 'left'
    ctx.font = `800 52px ${DISPLAY}`
    const name = c.name.toUpperCase()
    const nw = Math.min(W - pad * 2, ctx.measureText(name).width + 44)
    ctx.fillStyle = '#fff'
    ctx.fillRect(pad, ny, nw, 76)
    ctx.fillStyle = '#07090d'
    ctx.fillText(name, pad + 22, ny + 57, nw - 44)
    ctx.font = `600 26px ${BODY}`
    const sub = c.sub.length > 46 ? c.sub.slice(0, 45) + '…' : c.sub
    const sw = ctx.measureText(sub).width + 36
    ctx.fillStyle = c.color
    ctx.fillRect(pad, ny + 76, sw, 46)
    ctx.fillStyle = '#07090d'
    ctx.fillText(sub, pad + 18, ny + 108)

    // dole: izvor + adresa
    const fy = H - (fmt === 'story' ? 110 : 64)
    ctx.font = `400 25px ${BODY}`
    ctx.fillStyle = 'rgba(255,255,255,.7)'
    ctx.fillText(`Doslovno${c.cut ? ' (skraćeno)' : ''} · u sali ${c.clock} · snimak na linku`, pad, fy)
    ctx.textAlign = 'right'
    ctx.font = `800 40px ${DISPLAY}`
    ctx.fillStyle = '#fff'
    ctx.fillText('skupstina.live', W - pad, fy + 2)
    const lw = ctx.measureText('skupstina.live').width
    ctx.beginPath()
    ctx.arc(W - pad - lw - 32, fy - 2, 17, Math.PI, 0)
    ctx.lineWidth = 5
    ctx.strokeStyle = TUNGSTEN
    ctx.stroke()
  } else {
    background(ctx, W, H, c.color, photo)
    header(ctx, pad, pad + 20, 'Narodna skupština Srbije', `${fmtDate(c.date)} · u sali ${c.clock}`)
    const top = fmt === 'story' ? H * 0.2 : H * 0.17
    ctx.font = `800 300px ${DISPLAY}`
    ctx.fillStyle = c.color
    ctx.textAlign = 'left'
    ctx.fillText('„', pad - 18, top + 40)
    boxTop = top + 90
    boxBot = H - (fmt === 'story' ? 420 : 330)
    maxW = W - pad * 2 - 10
    const by = H - (fmt === 'story' ? 250 : 200)
    circle(ctx, photo, pad + 56, by - 18, 56, c.color, c.name)
    ctx.textAlign = 'left'
    ctx.font = `800 46px ${DISPLAY}`
    ctx.fillStyle = '#fff'
    ctx.fillText(c.name, pad + 140, by - 22)
    ctx.font = `400 28px ${BODY}`
    ctx.fillStyle = hexA(c.color, 1)
    ctx.fillText(wrap(ctx, c.sub, W - pad * 2 - 140)[0] ?? '', pad + 140, by + 20)
    footer(ctx, W, H, pad, c.cut ? 'Doslovno iz zapisa sednice (skraćeno) · ceo govor i snimak:' : 'Doslovno iz zapisa sednice · ceo govor i snimak:')
  }

  const { size, lines, lh, y0 } = fitText()
  ctx.font = `800 ${size}px ${DISPLAY}`
  const sp = ctx.measureText(' ').width
  const words: QLayout['words'] = []
  lines.forEach((l, i) => {
    let x = pad
    for (const w of l.split(' ')) {
      const k = words.length
      const prev = words[k - 1]?.t ?? -0.3
      const wd = ctx.measureText(w).width
      words.push({ w, x, y: y0 + i * lh, t: c.times?.[k] ?? prev + 0.3, wd })
      x += wd + sp
    }
  })
  return { cv, L: { words, size, hl, ink: plakat ? TUNGSTEN : c.color, dim: plakat ? 0 : 0.16, ctaY: Math.min(H - 470, y0 + lines.length * lh + 20) } as QLayout }
}

/** reči citata; t = sekunda videa (reč se pali kad je izgovorena), bez t sve su pune. Istaknute reči: podloga u boji */
function drawWords(ctx: CanvasRenderingContext2D, L: QLayout, t?: number) {
  ctx.font = `800 ${L.size}px ${DISPLAY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const pH = L.size * 0.14
  // podloge prvo (susedne istaknute reči u istom redu su jedna traka)
  L.words.forEach((w, k) => {
    if (!L.hl.has(k)) return
    const f = t == null ? 1 : Math.max(0, Math.min(1, (t - w.t) / 0.18))
    if (f <= 0) return
    const n = L.words[k + 1]
    const joined = L.hl.has(k + 1) && n && n.y === w.y
    const right = joined ? n.x : w.x + w.wd + pH
    ctx.fillStyle = L.ink
    ctx.globalAlpha = f
    ctx.fillRect(w.x - pH, w.y - L.size * 0.86, (right - (w.x - pH)) * (joined ? 1 : f), L.size * 1.08)
    ctx.globalAlpha = 1
  })
  L.words.forEach((w, k) => {
    const f = t == null ? 1 : Math.max(0, Math.min(1, (t - w.t) / 0.22))
    const on = L.hl.has(k)
    ctx.shadowColor = on ? 'transparent' : 'rgba(0,0,0,.45)'
    ctx.shadowBlur = on ? 0 : 24
    ctx.fillStyle = on && f > 0.5 ? '#07090d' : `rgba(255,255,255,${L.dim + (1 - L.dim) * f})`
    ctx.fillText(w.w, w.x, w.y - (1 - f) * 10)
  })
  ctx.shadowBlur = 0
}

/** podrazumevano istaknute reči: završni deo rečenice sa uzvikom ili pitanjem (do 3 reči), inače ništa */
export function autoHighlight(text: string) {
  const ws = text.split(/\s+/)
  const last = ws.length - 1
  if (!/[!?]["”]?$/.test(ws[last] ?? '')) return []
  let a = last
  while (a > 0 && last - a < 2 && !/[,;:–—-]$/.test(ws[a - 1])) a--
  return Array.from({ length: last - a + 1 }, (_, i) => a + i)
}

async function drawQuote(c: QuoteCard, fmt: Fmt) {
  const { cv, L } = await quoteBase(c, fmt)
  drawWords(cv.getContext('2d')!, L)
  return cv
}

/** video citata 9:16: reči se pale po stvarnom vremenu izgovora, pa poziv na ceo govor; snima se u realnom vremenu */
export const canVideo = () => typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
/** originalan zvuk citata (lokalni /api/zvuk); null kad ga nema (produkcija, YouTube ne da) */
/** raspored videa sa snimkom (9:16): oznaka i citat gore, snimak u sredini, ime ispod, podnožje; vraća providan sloj */
async function clipBase(c: QuoteCard) {
  const [W, H] = SIZE.story
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const pad = 72
  // snimak: pun širinom, bez donjih 18 % kadra (natpis prenosa sa imenom; ime je već ispod)
  const vh = Math.round((W * 9) / 16 * 0.82)
  const vy = Math.round(H * 0.47)
  // oznaka gore
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `600 25px ${MONO}`
  const tag = 'REČENO U SKUPŠTINI'
  const tw = ctx.measureText(tag).width
  ctx.fillStyle = '#e5484d'
  ctx.beginPath()
  ctx.roundRect(pad, pad - 6, tw + 64, 50, 25)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(pad + 24, pad + 19, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillText(tag, pad + 42, pad + 28)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,.75)'
  ctx.font = `500 25px ${MONO}`
  ctx.fillText(fmtDate(c.date), W - pad, pad + 28)
  // linije u boji liste uz snimak
  ctx.fillStyle = c.color
  ctx.fillRect(0, vy - 8, W, 8)
  ctx.fillRect(0, vy + vh, W, 8)
  // ime ispod snimka
  const ny = vy + vh + 44
  ctx.textAlign = 'left'
  ctx.font = `800 52px ${DISPLAY}`
  const name = c.name.toUpperCase()
  const nw = Math.min(W - pad * 2, ctx.measureText(name).width + 44)
  ctx.fillStyle = '#fff'
  ctx.fillRect(pad, ny, nw, 76)
  ctx.fillStyle = '#07090d'
  ctx.fillText(name, pad + 22, ny + 57, nw - 44)
  ctx.font = `600 26px ${BODY}`
  const sub = c.sub.length > 46 ? c.sub.slice(0, 45) + '…' : c.sub
  ctx.fillStyle = c.color
  ctx.fillRect(pad, ny + 76, ctx.measureText(sub).width + 36, 46)
  ctx.fillStyle = '#07090d'
  ctx.fillText(sub, pad + 18, ny + 108)
  // podnožje
  const fy = H - 110
  ctx.font = `400 25px ${BODY}`
  ctx.fillStyle = 'rgba(255,255,255,.7)'
  ctx.fillText(`Doslovno${c.cut ? ' (skraćeno)' : ''} · u sali ${c.clock} · ceo govor na linku`, pad, fy)
  ctx.textAlign = 'right'
  ctx.font = `800 40px ${DISPLAY}`
  ctx.fillStyle = '#fff'
  ctx.fillText('skupstina.live', W - pad, fy + 2)
  const lw = ctx.measureText('skupstina.live').width
  ctx.beginPath()
  ctx.arc(W - pad - lw - 32, fy - 2, 17, Math.PI, 0)
  ctx.lineWidth = 5
  ctx.strokeStyle = TUNGSTEN
  ctx.stroke()

  // citat iznad snimka: najveći font koji staje
  const boxTop = pad + 110
  const boxBot = vy - 50
  const maxW = W - pad * 2 - 10
  const bodyTxt = `„${c.text}”`
  let size = 112
  let lines: string[] = []
  for (; size >= 36; size -= 4) {
    ctx.font = `800 ${size}px ${DISPLAY}`
    lines = wrap(ctx, bodyTxt, maxW)
    if (lines.length * size * 1.12 <= boxBot - boxTop) break
  }
  const lh = size * 1.12
  // poravnato uz snimak (dole), da prazan prostor bude gore
  const y0 = boxBot - (lines.length - 1) * lh - size * 0.22
  const sp = ctx.measureText(' ').width
  const words: QLayout['words'] = []
  lines.forEach((l, i) => {
    let x = pad
    for (const w of l.split(' ')) {
      const k = words.length
      const prev = words[k - 1]?.t ?? -0.3
      const wd = ctx.measureText(w).width
      words.push({ w, x, y: y0 + i * lh, t: c.times?.[k] ?? prev + 0.3, wd })
      x += wd + sp
    }
  })
  const L: QLayout = { words, size, hl: new Set(c.hl ?? []), ink: TUNGSTEN, dim: 0, ctaY: vy + vh / 2 - 39 }
  return { cv, L, vy, vh }
}

/** isečak snimka sa zvukom (lokalni /api/klip), keširan po opsegu */
const clipCache = new Map<string, Promise<Blob | number | null>>()
/** Blob, ili HTTP status kad server odbije (404 nema snimka, 429 previše isečaka, 503 red je pun), null kad mreža padne */
function fetchClip(v: string, od: number, len: number) {
  const key = `${v}|${od.toFixed(2)}|${len.toFixed(2)}`
  if (!clipCache.has(key)) {
    const p: Promise<Blob | number | null> = fetch(`/api/klip?v=${encodeURIComponent(v)}&od=${od.toFixed(2)}&do=${(od + len).toFixed(2)}`, { signal: AbortSignal.timeout(90_000) })
      .then((r): Promise<Blob | number> | number => (r.ok ? r.blob() : r.status))
      .then((b) => (typeof b === 'number' || (b && b.size > 5000) ? b : null))
      .catch(() => null)
    p.then((b) => !(b instanceof Blob) && clipCache.delete(key))
    clipCache.set(key, p)
  }
  return clipCache.get(key)!
}

export const CLIP_WHY: Record<number, string> = {
  404: 'Snimak ovog dana još nije na serveru: video je sa plakatom',
  429: 'Previše videa za kratko vreme: pokušaj ponovo za nekoliko minuta',
  503: 'Server je trenutno zauzet: pokušaj ponovo za minut',
}

/** tačno citat: od PRE s pre prve reči do početka reči posle poslednje (dur), ništa od onoga što sledi */
const PRE = 0.08
async function quoteAudio(c: QuoteCard, actx: AudioContext) {
  if (!c.audio) return null
  const od = Math.max(0, c.audio.s - PRE)
  const total = c.audio.dur + PRE
  try {
    const ctl = new AbortController()
    const tm = window.setTimeout(() => ctl.abort(), 45_000)
    const r = await fetch(`/api/zvuk?v=${encodeURIComponent(c.audio.v)}&od=${od.toFixed(2)}&do=${(od + total).toFixed(2)}`, { signal: ctl.signal })
    const buf = r.ok ? await r.arrayBuffer() : null
    clearTimeout(tm)
    if (!buf || buf.byteLength < 1000) return null
    return await actx.decodeAudioData(buf)
  } catch {
    return null
  }
}

export async function recordQuote(c: QuoteCard, onProg: (f: number, stage?: string) => void) {
  await loadFonts()
  const lead = 0.6
  const hold = 3.2
  const [W, H] = SIZE.story
  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')!
  const actx = new AudioContext({ sampleRate: 48000 })
  void actx.resume()

  // snimak iz sale (od lead pre prve reči do kraja poslednje); bez njega plakat + samo zvuk
  let vid: HTMLVideoElement | null = null
  let vidUrl: string | null = null
  let sound: AudioBuffer | null = null
  let clipStatus = 0
  if (c.clip && c.audio) {
    onProg(0, 'Uzimam snimak iz sale… (do ~20 s)')
    const got = await fetchClip(c.audio.v, Math.max(0, c.audio.s - lead), lead + c.audio.dur)
    if (typeof got === 'number') clipStatus = got
    const blob = got instanceof Blob ? got : null
    if (blob) {
      try {
        sound = await actx.decodeAudioData(await blob.arrayBuffer())
        vidUrl = URL.createObjectURL(blob)
        const v = document.createElement('video')
        v.muted = true
        v.playsInline = true
        v.preload = 'auto'
        v.src = vidUrl
        await new Promise<void>((ok, fail) => {
          v.oncanplaythrough = () => ok()
          v.onerror = () => fail(new Error('snimak'))
          window.setTimeout(ok, 8000)
        })
        vid = v
      } catch {
        vid = null
        sound = null
      }
    }
  }
  if (!vid && c.audio) {
    onProg(0, 'Uzimam originalan zvuk…')
    sound = await quoteAudio(c, actx)
  }

  const clip = vid ? await clipBase(c) : null
  const { cv: base, L } = clip ?? (await quoteBase(c, 'story'))
  const speak = Math.min(60, Math.max((L.words[L.words.length - 1]?.t ?? 0) + 0.6, c.audio?.dur ?? 0))
  const total = lead + speak + hold
  // zamućena pozadina: kadar umanjen na 36×64 pa razvučen (jeftino, svaki frejm)
  const tiny = document.createElement('canvas')
  tiny.width = 36
  tiny.height = 64
  const tc = tiny.getContext('2d')!

  const frame = (t: number) => {
    if (vid && clip) {
      const vw = vid.videoWidth || 1280
      const vh = vid.videoHeight || 720
      const sw = (vh * 9) / 16
      tc.drawImage(vid, (vw - sw) / 2, 0, sw, vh, 0, 0, 36, 64)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(tiny, 0, 0, W, H)
      ctx.fillStyle = 'rgba(7,9,13,.62)'
      ctx.fillRect(0, 0, W, H)
      const g = ctx.createRadialGradient(W * 0.5, clip.vy, 0, W * 0.5, clip.vy, W)
      g.addColorStop(0, hexA(c.color, 0.3))
      g.addColorStop(1, hexA(c.color, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      ctx.drawImage(vid, 0, 0, vw, vh * 0.82, 0, clip.vy, W, clip.vh)
      // posle citata kadar stane i potamni
      const d = Math.max(0, Math.min(1, (t - lead - speak) / 0.5))
      if (d > 0) {
        ctx.fillStyle = `rgba(7,9,13,${0.5 * d})`
        ctx.fillRect(0, clip.vy, W, clip.vh)
      }
      ctx.drawImage(base, 0, 0)
    } else ctx.drawImage(base, 0, 0)
    drawWords(ctx, L, t - lead)
    // traka napretka u boji govornika
    ctx.fillStyle = 'rgba(255,255,255,.12)'
    ctx.fillRect(0, 0, W, 8)
    ctx.fillStyle = c.color
    ctx.fillRect(0, 0, W * Math.min(1, t / (lead + speak)), 8)
    // kraj: poziv na ceo govor
    const o = Math.max(0, Math.min(1, (t - lead - speak) / 0.5))
    if (o > 0) {
      ctx.globalAlpha = o
      ctx.fillStyle = TUNGSTEN
      const bw = 760
      const bx = (W - bw) / 2
      const byy = L.ctaY
      ctx.beginPath()
      ctx.roundRect(bx, byy, bw, 78, 39)
      ctx.fill()
      ctx.fillStyle = '#0b0f17'
      ctx.font = `800 36px ${DISPLAY}`
      ctx.textAlign = 'center'
      ctx.fillText('▶  Ceo govor sa snimkom: skupstina.live', W / 2, byy + 51)
      ctx.globalAlpha = 1
    }
  }
  if (vid) {
    vid.currentTime = 0
    await new Promise((r) => window.setTimeout(r, 150))
  }
  frame(0)
  const stream = out.captureStream(30)
  let src: AudioBufferSourceNode | null = null
  let gain: GainNode | null = null
  if (sound) {
    const dest = actx.createMediaStreamDestination()
    gain = actx.createGain()
    src = actx.createBufferSource()
    src.buffer = sound
    src.connect(gain).connect(dest)
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
  }
  const kinds = sound
    ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  const mime = kinds.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 10_000_000, audioBitsPerSecond: 160_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const stopped = new Promise<void>((res) => (rec.onstop = () => res()))
  rec.start(250)
  const now = actx.currentTime
  if (src && gain && c.audio) {
    // zvuk se čuje samo od prve do poslednje reči citata (kratko utišavanje na krajevima)
    const on = now + lead - PRE
    const off = now + lead + c.audio.dur
    gain.gain.setValueAtTime(0, now)
    gain.gain.setValueAtTime(0, on)
    gain.gain.linearRampToValueAtTime(1, on + 0.06)
    gain.gain.setValueAtTime(1, Math.max(on + 0.1, off - 0.15))
    gain.gain.linearRampToValueAtTime(0, off)
    // isečak snimka počinje na „0” (lead pre prve reči), isečak samo zvuka na lead − PRE
    if (vid) src.start(now)
    else src.start(on)
  }
  void vid?.play().catch(() => {})
  const t0 = performance.now()
  // setTimeout umesto rAF: snimanje ne staje ako je kartica nakratko u pozadini
  await new Promise<void>((res) => {
    const step = () => {
      const t = (performance.now() - t0) / 1000
      // snimak prati sat (ako zakasni, premota se)
      if (vid && !vid.ended && t < vid.duration - 0.1 && Math.abs(vid.currentTime - t) > 0.25) vid.currentTime = t
      frame(t)
      onProg(Math.min(1, t / total))
      if (t < total) window.setTimeout(step, 1000 / 30)
      else res()
    }
    step()
  })
  rec.stop()
  await stopped
  src?.stop()
  vid?.pause()
  if (vidUrl) URL.revokeObjectURL(vidUrl)
  void actx.close()
  const type = (mime || 'video/webm').split(';')[0]
  return { blob: new Blob(chunks, { type }), sound: !!sound, clip: !!vid, why: clipStatus }
}

async function drawStat(c: StatCard, fmt: Fmt) {
  const [W, H] = SIZE[fmt]
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const color = c.color ?? TUNGSTEN
  const [photo, ...rowImgs] = await Promise.all([loadImg(c.photo), ...c.rows.map((r) => loadImg(r.photo))])
  background(ctx, W, H, color, photo)
  const pad = 84
  header(ctx, pad, pad + 20, c.eyebrow, fmtDate(c.date))
  let y = fmt === 'story' ? 380 : 300

  ctx.textAlign = 'left'
  ctx.fillStyle = '#fff'
  ctx.font = `800 64px ${DISPLAY}`
  for (const l of wrap(ctx, c.title, W - pad * 2).slice(0, 2)) {
    ctx.fillText(l, pad, y)
    y += 70
  }
  y += 70
  ctx.font = `800 150px ${DISPLAY}`
  ctx.fillStyle = color === TUNGSTEN ? TUNGSTEN : '#fff'
  ctx.fillText(c.big, pad - 4, y + 40)
  y += 92
  ctx.font = `400 30px ${BODY}`
  ctx.fillStyle = 'rgba(255,255,255,.7)'
  for (const l of wrap(ctx, c.bigSub, W - pad * 2).slice(0, 2)) {
    ctx.fillText(l, pad, y)
    y += 40
  }
  y += fmt === 'story' ? 90 : 50

  ctx.font = `500 24px ${MONO}`
  ctx.fillStyle = 'rgba(255,255,255,.5)'
  ctx.fillText(c.rowsTitle.toUpperCase(), pad, y)
  y += 30
  const rowH = fmt === 'story' ? 112 : 92
  const maxRows = Math.max(1, Math.floor((H - y - (c.bar ? 300 : 200)) / rowH))
  c.rows.slice(0, maxRows).forEach((r, i) => {
    const cy = y + rowH / 2
    const hasPh = !!r.photo
    if (hasPh) circle(ctx, rowImgs[i], pad + 34, cy, 34, r.color, r.name)
    const x = pad + (hasPh ? 90 : 0)
    ctx.textAlign = 'left'
    ctx.font = `700 34px ${DISPLAY}`
    ctx.fillStyle = '#fff'
    ctx.fillText(r.name, x, cy - 4)
    ctx.textAlign = 'right'
    ctx.font = `500 26px ${MONO}`
    ctx.fillStyle = 'rgba(255,255,255,.72)'
    ctx.fillText(r.value, W - pad, cy - 4)
    const bw = W - pad - x
    ctx.fillStyle = 'rgba(255,255,255,.08)'
    ctx.fillRect(x, cy + 14, bw, 10)
    ctx.fillStyle = r.color
    ctx.fillRect(x, cy + 14, Math.max(6, bw * r.frac), 10)
    y += rowH
  })

  if (c.bar?.length) {
    y += 40
    ctx.textAlign = 'left'
    ctx.font = `500 24px ${MONO}`
    ctx.fillStyle = 'rgba(255,255,255,.5)'
    ctx.fillText('VREME PO LISTAMA', pad, y)
    y += 24
    let x = pad
    const bw = W - pad * 2
    for (const b of c.bar) {
      ctx.fillStyle = b.color
      ctx.fillRect(x, y, bw * b.frac, 26)
      x += bw * b.frac
    }
    y += 64
    ctx.font = `400 25px ${BODY}`
    let lx = pad
    for (const b of c.bar.filter((b) => b.frac >= 0.02).slice(0, 6)) {
      const t = `${b.name.length > 24 ? b.name.slice(0, 23) + '…' : b.name} ${Math.round(b.frac * 100)} %`
      const tw = ctx.measureText(t).width + 50
      if (lx + tw > W - pad) {
        lx = pad
        y += 42
      }
      if (y > H - 170) break
      ctx.fillStyle = b.color
      ctx.fillRect(lx, y - 18, 18, 18)
      ctx.fillStyle = 'rgba(255,255,255,.78)'
      ctx.fillText(t, lx + 28, y)
      lx += tw
    }
  }
  footer(ctx, W, H, pad, 'Iz snimka i zapisa sednice · svi govori i snimak:')
  return cv
}

async function render(card: Card, fmt: Fmt) {
  await loadFonts()
  const cv = card.kind === 'citat' ? await drawQuote(card, fmt) : await drawStat(card, fmt)
  return new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'))
}

// ---------------------------------------------------------------- prozor „Podeli”


type Mode = Fmt | 'video'

export function ShareSheet({ share: initial, onClose }: { share: Share; onClose: () => void }) {
  const [share, setCur] = useState(initial)
  const base = share.card.kind === 'citat' ? share.card : null
  const [style, setStyle] = useState<'plakat' | 'tamno'>('plakat')
  const [hl, setHl] = useState<number[]>(() => (base ? autoHighlight(base.text) : []))
  // dodaj/oduzmi reči na početku (da) ili kraju (db); istaknute reči ostaju na istim rečima
  const range = share.range
  const adjust = (da: number, db: number) => {
    if (!range || !share.rebuild) return
    const [a, b] = range
    const nx = share.rebuild(a + da, b + db)
    const [na, nb] = nx.range ?? [a, b]
    const shift = a - na
    setHl((h) => h.map((k) => k + shift).filter((k) => k >= 0 && k <= nb - na))
    setCur(nx)
  }
  // video: snimak iz sale u sredini (ili plakat)
  const [bg, setBg] = useState<'snimak' | 'plakat'>('snimak')
  const quote = useMemo(() => (base ? { ...base, style, hl, clip: bg === 'snimak' } : null), [base, style, hl, bg])
  const card: Card = quote ?? share.card
  const [mode, setMode] = useState<Mode>(() => (matchMedia('(max-width: 700px)').matches ? 'story' : 'post'))
  const fmt: Fmt = mode === 'post' ? 'post' : 'story'
  const [img, setImg] = useState<Blob | null>(null)
  const [vid, setVid] = useState<Blob | null>(null)
  const [prog, setProg] = useState<number | null>(null)
  const [stage, setStage] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const blob = mode === 'video' ? vid : img
  const src = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob])
  const still = useMemo(() => (img ? URL.createObjectURL(img) : null), [img])
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src])
  useEffect(() => () => void (still && URL.revokeObjectURL(still)), [still])
  useEffect(() => {
    let off = false
    setImg(null)
    render(card, fmt).then((b) => !off && setImg(b))
    return () => {
      off = true
    }
  }, [card, fmt])
  // video se pravi kad se izabere (traje koliko i citat + 4 s); svaka promena izgleda ga pravi ponovo
  useEffect(() => {
    setVid(null)
  }, [card])
  useEffect(() => {
    if (mode !== 'video' || !quote || vid || prog != null) return
    let off = false
    // kratko čekanje: dok se biraju reči, video se ne pravi posle svakog klika
    const go = window.setTimeout(() => {
      setProg(0)
      recordQuote(quote, (f, st) => {
        if (off) return
        setProg(f)
        setStage(st ?? null)
      })
        .then((r) => {
          if (off) return
          setVid(r.blob)
          setProg(null)
          setStage(null)
          if (quote.clip && quote.audio && !r.clip) setMsg(CLIP_WHY[r.why] ?? (r.sound ? 'Snimak nije dostupan: video je sa plakatom i zvukom' : 'Snimak i zvuk nisu dostupni'))
          else if (!r.sound && quote.audio) setMsg('Originalan zvuk nije dostupan: video je bez zvuka')
        })
        .catch(() => {
          if (off) return
          setProg(null)
          setMsg('Ovaj pregledač ne može da napravi video')
        })
    }, 700)
    return () => {
      off = true
      clearTimeout(go)
      setProg(null)
    }
  }, [mode, quote, vid])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  useEffect(() => {
    if (!msg) return
    const t = window.setTimeout(() => setMsg(null), 2200)
    return () => clearTimeout(t)
  }, [msg])

  const ext = blob?.type === 'video/mp4' ? 'mp4' : blob?.type.startsWith('video') ? 'webm' : 'png'
  const what = mode === 'video' ? 'video' : 'sliku'
  const done = (how: string) => track('podeli', { sta: share.label, oblik: mode, kako: how })
  const download = () => {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = `skupstina-${share.label}-${mode === 'post' ? '4x5' : '9x16'}.${ext}`
    a.click()
    done(mode === 'video' ? 'video' : 'slika')
    setMsg(mode === 'video' ? 'Video je preuzet' : 'Slika je preuzeta')
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share.url)
      setMsg('Link je kopiran')
      done('kopiraj-link')
    } catch {
      setMsg('Pregledač nije dozvolio kopiranje')
    }
  }


  return createPortal(
    <div className="pod-back" onClick={onClose} role="presentation">
      <div className="pod" role="dialog" aria-modal="true" aria-label="Podeli" onClick={(e) => e.stopPropagation()}>
        <button className="pod-x" onClick={onClose} aria-label="Zatvori">
          ×
        </button>
        <div className={`pod-prev ${fmt}`}>
          {mode === 'video' && src ? (
            <video src={src} autoPlay loop playsInline controls />
          ) : still ? (
            <img src={still} alt="Slika za deljenje" />
          ) : (
            <span className="pod-wait">Pravim sliku…</span>
          )}
          {mode === 'video' && prog != null && (
            <span className="pod-rec">
              <b>{stage ?? `Pravim video… ${Math.round(prog * 100)} %`}</b>
              <i style={{ width: `${prog * 100}%` }} />
            </span>
          )}
        </div>
        <div className="pod-side">
          <h2>{quote ? 'Podeli citat' : 'Podeli statistiku'}</h2>
          <div className="pod-fmt" role="radiogroup" aria-label="Oblik">
            <button className={mode === 'post' ? 'on' : ''} onClick={() => setMode('post')} aria-pressed={mode === 'post'}>
              <i className="r45" /> Objava
            </button>
            <button className={mode === 'story' ? 'on' : ''} onClick={() => setMode('story')} aria-pressed={mode === 'story'}>
              <i className="r916" /> Priča
            </button>
            {quote && canVideo() && (
              <button className={mode === 'video' ? 'on' : ''} onClick={() => setMode('video')} aria-pressed={mode === 'video'}>
                ▶ Video
              </button>
            )}
          </div>
          {quote && (
            <>
              <div className="pod-fmt" role="radiogroup" aria-label="Izgled">
                <button className={style === 'plakat' ? 'on' : ''} onClick={() => setStyle('plakat')} aria-pressed={style === 'plakat'}>
                  Plakat
                </button>
                <button className={style === 'tamno' ? 'on' : ''} onClick={() => setStyle('tamno')} aria-pressed={style === 'tamno'}>
                  Tamno
                </button>
              </div>
              {range && (
                <div className="pod-trim" aria-label="Dužina citata">
                  <span>Početak</span>
                  <button onClick={() => adjust(-1, 0)} disabled={range[0] === 0} title="Dodaj reč ispred">
                    + reč
                  </button>
                  <button onClick={() => adjust(1, 0)} disabled={range[0] >= range[1]} title="Ukloni prvu reč">
                    − reč
                  </button>
                  <span>Kraj</span>
                  <button onClick={() => adjust(0, -1)} disabled={range[1] <= range[0]} title="Ukloni poslednju reč">
                    − reč
                  </button>
                  <button onClick={() => adjust(0, 1)} disabled={range[1] >= range[2] - 1} title="Dodaj reč posle">
                    + reč
                  </button>
                </div>
              )}
              <div className="pod-hl">
                <span className="pod-hint dim">Klikni reči koje treba da iskoče:</span>
                <p>
                  {quote.text.split(/\s+/).map((w, k) => (
                    <button key={k} className={hl.includes(k) ? 'on' : ''} onClick={() => setHl((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]))}>
                      {w}
                    </button>
                  ))}
                </p>
              </div>
            </>
          )}
          {mode === 'video' && quote?.audio && (
            <div className="pod-fmt" role="radiogroup" aria-label="Pozadina videa">
              <button className={bg === 'snimak' ? 'on' : ''} onClick={() => setBg('snimak')} aria-pressed={bg === 'snimak'}>
                Snimak iz sale
              </button>
              <button className={bg === 'plakat' ? 'on' : ''} onClick={() => setBg('plakat')} aria-pressed={bg === 'plakat'}>
                Plakat
              </button>
            </div>
          )}
          {mode === 'video' && <p className="pod-hint dim">Snimak i originalan zvuk iz sale, reči se pale onako kako su izgovorene, na kraju poziv na ceo govor. Video se pravi u realnom vremenu.</p>}
          <button className="pod-main pod-dl" onClick={download} disabled={!blob}>
            ↓ Preuzmi {what}
          </button>
          <div className="pod-link">
            <span className="mono">{share.url.replace(/^https?:\/\//, '')}</span>
            <button onClick={() => void copy()}>Kopiraj link</button>
          </div>
          {msg && <p className="pod-msg">{msg}</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** spisak „Citati dana”: klik otvara karticu za deljenje */
export function QuotesSheet({ data, onPick, onClose }: { data: Traka; onPick: (s: Share) => void; onClose: () => void }) {
  const qs = useMemo(() => pickQuotes(data), [data])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div className="pod-back" onClick={onClose} role="presentation">
      <div className="pod pod-q" role="dialog" aria-modal="true" aria-label="Citati dana" onClick={(e) => e.stopPropagation()}>
        <button className="pod-x" onClick={onClose} aria-label="Zatvori">
          ×
        </button>
        <h2>Citati dana</h2>
        <p className="pod-hint dim">
          Izdvojeno automatski: rečenice sa uzvikom ili pitanjem i one posle kojih je sala reagovala, po jedna od govornika i redom po listama. Ili označi bilo koji deo teksta govora.
        </p>
        <div className="pod-qlist">
          {qs.length === 0 && <p className="pod-hint">Za ovaj dan nema izdvojenih rečenica.</p>}
          {qs.map((q) => {
            const p = data.people[q.who]
            return (
              <button key={`${q.who}${q.at}`} style={{ ['--c' as string]: p?.color ?? '#8e98ab' }} onClick={() => onPick(speechQuote(data, q.sp, q.a, q.a + q.words.length - 1))}>
                <q>{q.words.join(' ')}</q>
                <span>
                  <b>{p?.name ?? q.who}</b> · <span className="mono">{q.clock}</span>
                </span>
                <em>Podeli →</em>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
