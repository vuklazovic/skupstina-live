import { useEffect, useRef } from 'react'

/**
 * Dok govori utišani poslanik, preko jedne strane prenosa ide uspravni snimak igre (Subway Surfers).
 * Snimak se ugrađuje sa YouTube-a (ne kopira se na naš server); plejer ostaje učitan i samo se pauzira,
 * pa kad sledeći utišani poslanik dobije reč, igra nastavlja odmah.
 */

const VIDEO = 'zZ7AimPACzc' // „Subway surfers 1 hour Gameplay no commentary free to use” (ImNotRU), 576×1280, ~1 h

type P = { playVideo: () => void; pauseVideo: () => void; mute: () => void; unMute: () => void; destroy: () => void }
type NS = { Player: new (el: HTMLElement, o: Record<string, unknown>) => P }

function loadYT(): Promise<NS> {
  const w = window as unknown as { YT?: NS & { Player?: unknown }; onYouTubeIframeAPIReady?: () => void }
  if (w.YT?.Player) return Promise.resolve(w.YT)
  return new Promise((res) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prev?.()
      res(w.YT!)
    }
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
}

export function SubwayOverlay({ active, side }: { active: boolean; side: 'left' | 'right' }) {
  const el = useRef<HTMLDivElement>(null)
  const player = useRef<P | null>(null)
  const ready = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    let cancelled = false
    loadYT().then((YT) => {
      if (cancelled || !el.current) return
      const host = document.createElement('div')
      el.current.replaceChildren(host)
      player.current = new YT.Player(host, {
        width: '100%',
        height: '100%',
        videoId: VIDEO,
        playerVars: {
          autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3,
          loop: 1, playlist: VIDEO, mute: 1, start: Math.floor(Math.random() * 3000),
        },
        events: {
          onReady: () => {
            ready.current = true
            // uključen dok govori utišani poslanik: odmah sa zvukom (prenos je tada utišan)
            if (activeRef.current) {
              player.current?.playVideo()
              player.current?.unMute()
            }
          },
        },
      })
    })
    return () => {
      cancelled = true
      player.current?.destroy()
      player.current = null
    }
  }, [])

  useEffect(() => {
    const p = player.current
    if (!p || !ready.current) return
    try {
      if (active) {
        p.playVideo()
        p.unMute() // prenos je utišan; čuje se igra (posle klika na strani pregledač to dozvoljava)
      } else {
        p.mute()
        p.pauseVideo()
      }
    } catch {
      /* plejer još nije spreman */
    }
  }, [active])

  return <div className={`lv-subway ${side} ${active ? 'on' : ''}`} aria-hidden={!active} ref={el} />
}
