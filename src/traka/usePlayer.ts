import { useCallback, useEffect, useRef, useState } from 'react'
import { loadApi } from '../components/YtPlayer'
import type { Clock, Part } from './types'

type P = {
  getCurrentTime: () => number
  getPlayerState: () => number
  seekTo: (s: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  pauseVideo: () => void
  mute: () => void
  unMute: () => void
  loadVideoById: (o: { videoId: string; startSeconds: number }) => void
  cueVideoById: (o: { videoId: string; startSeconds: number }) => void
  destroy: () => void
}

const MUTE_KEY = 'tka-bez-zvuka'
const savedMute = () => {
  try {
    return sessionStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

const PLAYING = 1
const ENDED = 0

/**
 * Jedan YouTube plejer za ceo dan: traka je niz delova snimka (Deo I, II…) jedan za drugim.
 * Vreme na traci (sekunde programa) → deo + sekunda u tom delu. Sat se pomera glatko (rAF),
 * a plejer se proverava na 200 ms.
 */
export function usePlayer(parts: Part[], clock: Clock, startAt: number) {
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<P | null>(null)
  const ready = useRef(false)
  const vid = useRef<string | null>(null)
  const partsRef = useRef(parts)
  partsRef.current = parts
  const [playing, setPlaying] = useState(false)
  const playingRef = useRef(false)
  // isključen zvuk se pamti dok je kartica otvorena: važi i kad se pređe na drugi dan
  const [muted, setMuted] = useState(false)
  // poslednje očitavanje plejera: vreme programa i trenutak očitavanja
  const last = useRef({ g: startAt, wall: performance.now() })
  // posle premotavanja plejer kratko javlja staro vreme; dotle verujemo cilju
  const guard = useRef(0)

  const partOf = (g: number) => {
    const ps = partsRef.current
    let i = ps.findIndex((p) => g >= p.at && g < p.at + p.dur)
    if (i < 0) i = g < 0 ? 0 : ps.length - 1
    return ps[i]
  }

  const setT = (g: number) => {
    last.current = { g, wall: performance.now() }
    clock.set(g)
  }

  const seek = useCallback(
    (g: number, play?: boolean) => {
      const total = partsRef.current.reduce((a, p) => Math.max(a, p.at + p.dur), 0)
      g = Math.max(0, Math.min(total - 0.5, g))
      setT(g)
      guard.current = performance.now() + 700
      const p = player.current
      if (!p || !ready.current) return
      const part = partOf(g)
      const local = g - part.at
      const wantPlay = play ?? playingRef.current
      if (vid.current !== part.v) {
        vid.current = part.v
        if (wantPlay) p.loadVideoById({ videoId: part.v, startSeconds: local })
        else p.cueVideoById({ videoId: part.v, startSeconds: local })
      } else {
        p.seekTo(local, true)
        if (wantPlay) p.playVideo()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clock],
  )

  // plejer se pravi jednom
  useEffect(() => {
    let cancelled = false
    let timer = 0
    let raf = 0
    const el = document.createElement('div')
    host.current?.appendChild(el)
    const first = partOf(clock.t)
    vid.current = first.v
    loadApi().then((YT) => {
      if (cancelled) return
      player.current = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId: first.v,
        width: '100%',
        height: '100%',
        playerVars: { start: Math.floor(clock.t - first.at), rel: 0, modestbranding: 1, playsinline: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3 },
        events: {
          onReady: () => {
            ready.current = true
            if (savedMute()) {
              player.current?.mute()
              setMuted(true)
            }
            timer = window.setInterval(() => {
              const p = player.current
              if (!p?.getCurrentTime || !playingRef.current) return
              if (performance.now() < guard.current) return
              const part = partsRef.current.find((x) => x.v === vid.current)
              if (!part) return
              const g = part.at + p.getCurrentTime()
              // očitavanje usklađuje glatki sat (bez skokova unazad za sitne razlike)
              const est = last.current.g + (performance.now() - last.current.wall) / 1000
              if (Math.abs(g - est) > 0.35) last.current = { g, wall: performance.now() }
              else last.current = { g: est, wall: performance.now() }
            }, 200) as unknown as number
          },
          onStateChange: (e: { data: number }) => {
            const on = e.data === PLAYING
            if (on && !playingRef.current) last.current = { g: clock.t, wall: performance.now() }
            playingRef.current = on
            setPlaying(on)
            if (e.data === ENDED) {
              // kraj dela: nastavi sledećim delom
              const ps = partsRef.current
              const i = ps.findIndex((x) => x.v === vid.current)
              if (i >= 0 && i < ps.length - 1) seek(ps[i + 1].at + 0.1, true)
            }
          },
        },
      }) as unknown as P
    })
    const loop = () => {
      if (playingRef.current) {
        const g = last.current.g + Math.min(1.5, (performance.now() - last.current.wall) / 1000)
        clock.set(g)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelled = true
      clearInterval(timer)
      cancelAnimationFrame(raf)
      player.current?.destroy?.()
      player.current = null
      ready.current = false
      el.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock])

  const play = useCallback(() => {
    const p = player.current
    if (!p || !ready.current) return
    const part = partOf(clock.t)
    if (vid.current !== part.v) seek(clock.t, true)
    else {
      // posle pomeranja trake dok je plejer stajao: plejer kreće tačno odatle
      const local = clock.t - part.at
      if (Math.abs(p.getCurrentTime() - local) > 0.6) p.seekTo(local, true)
      p.playVideo()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, seek])
  const pause = useCallback(() => player.current?.pauseVideo(), [])
  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [play, pause])
  const toggleMute = useCallback(() => {
    const p = player.current
    if (!p) return
    setMuted((m) => {
      if (m) p.unMute()
      else p.mute()
      try {
        sessionStorage.setItem(MUTE_KEY, m ? '0' : '1')
      } catch {
        /* bez pamćenja */
      }
      return !m
    })
  }, [])

  return { host, playing, seek, play, pause, toggle, muted, toggleMute }
}
