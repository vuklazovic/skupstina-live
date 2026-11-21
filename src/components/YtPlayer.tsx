import { useEffect, useRef, useState } from 'react'
import { track } from '../analytics'

/* Minimalni tipovi za YouTube IFrame API (https://developers.google.com/youtube/iframe_api_reference) */
type YTPlayer = {
  getCurrentTime: () => number
  getPlayerState: () => number
  seekTo: (s: number, allowSeekAhead: boolean) => void
  playVideo: () => void
  pauseVideo: () => void
  destroy: () => void
}
type YTNamespace = {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer
  PlayerState: { PLAYING: number; ENDED: number; PAUSED: number }
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null
export function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        prev?.()
        resolve(window.YT!)
      }
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    })
  }
  return apiPromise
}

type Props = {
  videoId: string
  start: number
  end?: number
  autoplay?: boolean
  title: string
  onNext?: () => void
  /** odakle da krene (sekunde snimka); čita se samo pri pokretanju plejera */
  from?: number
  /** javlja trenutni položaj, da drugi plejer (ceo ekran / prozor) nastavi odatle */
  report?: (t: number, playing: boolean) => void
  /** dugme za ceo ekran; fullActive menja ikonu u „izađi” */
  onFull?: () => void
  fullActive?: boolean
}

/**
 * Plejer koji pušta samo deo snimka od početka do kraja jednog izlaganja.
 * Ako korisnik premota van tog dela, plejer ga vraća u granice; na kraju pauzira.
 */
export function YtPlayer({ videoId, start, end, autoplay, title, onNext, from, report, onFull, fullActive }: Props) {
  const fromRef = useRef(from)
  const reportRef = useRef(report)
  reportRef.current = report
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState(start)
  const startedRef = useRef(false)
  const doneRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer = 0
    setDone(false)
    setProgress(0)
    setPlaying(false)
    const at = Math.max(start, Math.min(end != null ? end - 1 : Infinity, fromRef.current ?? start))
    setNow(at)
    let back = at // kuda se vraća snimak koji je pre početka izlaganja (na samom učitavanju plejer javlja 0)
    const el = document.createElement('div')
    host.current?.appendChild(el)
    loadApi().then((YT) => {
      if (cancelled) return
      player.current = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { start: Math.floor(at), end, autoplay: autoplay ? 1 : 0, rel: 0, modestbranding: 1, playsinline: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3 },
        events: {
          onReady: () => {
            timer = window.setInterval(() => {
              const p = player.current
              if (!p?.getCurrentTime) return
              const t = p.getCurrentTime()
              setNow(t)
              if (t >= start - 1) reportRef.current?.(t, p.getPlayerState?.() === YT.PlayerState.PLAYING)
              if (end != null) {
                setProgress(Math.min(1, Math.max(0, (t - start) / Math.max(1, end - start))))
                if (t >= end - 0.15) {
                  p.pauseVideo()
                  p.seekTo(end, true)
                  if (!doneRef.current) track('snimak-do-kraja', { naslov: title })
                  doneRef.current = true
                  setDone(true)
                } else if (t < start - 1) {
                  p.seekTo(back, true)
                } else {
                  back = start
                }
              }
            }, 250)
          },
          onStateChange: (e: { data: number }) => {
            setPlaying(e.data === YT.PlayerState.PLAYING)
            if (e.data === YT.PlayerState.PLAYING && !startedRef.current) {
              startedRef.current = true
              track('snimak-pusten', { naslov: title })
            }
            if (e.data === YT.PlayerState.PLAYING) setDone(false)
          },
        },
      })
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      player.current?.destroy?.()
      player.current = null
      el.remove()
    }
  }, [videoId, start, end, autoplay, title])

  const toggle = () => {
    const p = player.current
    if (!p) return
    if (playing) p.pauseVideo()
    else {
      if (done) p.seekTo(start, true)
      p.playVideo()
      setDone(false)
    }
  }
  const seek = (f: number) => {
    const p = player.current
    if (!p || end == null) return
    const t = start + f * (end - start)
    p.seekTo(Math.min(end - 0.5, Math.max(start, t)), true)
    setNow(t)
    setProgress(f)
    setDone(false)
  }
  const fmt = (t: number) => {
    const x = Math.max(0, Math.round(t))
    return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`
  }

  const replay = () => {
    const p = player.current
    if (!p) return
    p.seekTo(start, true)
    p.playVideo()
    setDone(false)
  }

  return (
    <div className="player yt" aria-label={title}>
      <div ref={host} className="yt-host" />
      {/* prozirni sloj: klik na video pušta/pauzira, a YouTube kontrole i premotavanje nisu dostupni */}
      <button className="yt-shield" onClick={toggle} aria-label={playing ? 'Pauziraj snimak' : 'Pusti snimak'}>
        {!playing && !done && (
          <span className="yt-big" aria-hidden>
            <svg viewBox="0 0 24 24" width="30" height="30"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
          </span>
        )}
      </button>
      <div className="yt-bar">
        <button className="yt-pp" onClick={toggle} aria-label={playing ? 'Pauziraj' : 'Pusti'}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="14" height="14"><rect x="6" y="5" width="4" height="14" fill="currentColor" /><rect x="14" y="5" width="4" height="14" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>
          )}
        </button>
        <span className="yt-time mono">{fmt(now - start)}</span>
        {end != null ? (
          <input
            className="yt-range"
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(e) => seek(Number(e.target.value) / 1000)}
            aria-label="Pomeri unutar izlaganja"
            style={{ ['--p' as string]: `${progress * 100}%` }}
          />
        ) : (
          <span className="yt-range-empty" />
        )}
        <span className="yt-time mono">{end != null ? fmt(end - start) : ''}</span>
        {onFull && (
          <button className="yt-fs" onClick={onFull} aria-label={fullActive ? 'Izađi iz celog ekrana' : 'Ceo ekran'} title={fullActive ? 'Izađi iz celog ekrana (Esc)' : 'Ceo ekran'}>
            {fullActive ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
            )}
          </button>
        )}
      </div>
      {done && (
        <div className="yt-done">
          <span>Kraj izlaganja</span>
          <div className="yt-done-actions">
            <button className="ghost" onClick={replay}>↺ Ponovo</button>
            {onNext && <button onClick={onNext}>Sledeći govor →</button>}
          </div>
        </div>
      )}
    </div>
  )
}
