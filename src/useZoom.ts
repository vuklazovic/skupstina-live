import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type View = { z: number; x: number; y: number }
/** položaj sale van React stanja: čitanje i pretplata (late = posle onih koji crtaju, npr. imena posle lica) */
export type ZoomStore = { get: () => View; subscribe: (fn: (v: View) => void, late?: boolean) => () => void; poke: () => void }
const MIN = 1
const MAX = 5

/**
 * Zum i pomeranje sale: točkić (oko kursora), prevlačenje mišem ili jednim prstom kad je zumirano,
 * dva prsta za zum na telefonu. Klik posle prevlačenja se ne računa kao klik na sedište.
 */
export function useZoom(stageRef: RefObject<HTMLElement | null>) {
  // sloj sale postoji tek kad se uđe u salu, pa ga hvatamo preko ref povratnog poziva
  const [el, layerRef] = useState<HTMLElement | null>(null)
  // Položaj se NE drži u React stanju: svaki pomeraj bi ponovo iscrtao celu stranicu (20+ ms po kadru).
  // Ovde se transformacija upisuje pravo u sloj, najviše jednom po kadru, a ko prati položaj (lica, imena)
  // dobija ga preko pretplate. React zna samo da li je sala zumirana.
  const viewRef = useRef<View>({ z: 1, x: 0, y: 0 })
  const [zoomed, setZoomed] = useState(false)
  const subs = useRef({ early: new Set<(v: View) => void>(), late: new Set<(v: View) => void>() })
  const frame = useRef(0)
  const anim = useRef(0)
  const still = useRef(0)
  const elRef = useRef<HTMLElement | null>(null)
  elRef.current = el

  const flush = useCallback(() => {
    frame.current = 0
    const v = viewRef.current
    const z = elRef.current?.querySelector<HTMLElement>('.zoomer')
    if (z) z.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`
    // dok se sala pomera, skupi efekti (zamućene senke, filteri) se gase u CSS-u; vraćaju se kad stane
    const layer = elRef.current
    if (layer) {
      layer.dataset.moving = ''
      clearTimeout(still.current)
      still.current = window.setTimeout(() => delete layer.dataset.moving, 160)
    }
    subs.current.early.forEach((f) => f(v))
    subs.current.late.forEach((f) => f(v))
    setZoomed(v.z > 1.01)
  }, [])
  /** novi položaj; više događaja u istom kadru se sabira u jedno crtanje */
  const setView = useCallback(
    (next: View | ((v: View) => View)) => {
      viewRef.current = typeof next === 'function' ? next(viewRef.current) : next
      if (!frame.current) frame.current = requestAnimationFrame(flush)
    },
    [flush],
  )
  const stopAnim = useCallback(() => {
    cancelAnimationFrame(anim.current)
    anim.current = 0
  }, [])
  /** dugmad +, − i „cela sala”: kratak gladak prelaz umesto skoka */
  const animateTo = useCallback(
    (to: View) => {
      stopAnim()
      const from = viewRef.current
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setView(to)
      const t0 = performance.now()
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 260)
        const e = 1 - (1 - k) ** 3
        viewRef.current = { z: from.z + (to.z - from.z) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }
        cancelAnimationFrame(frame.current)
        flush()
        anim.current = k < 1 ? requestAnimationFrame(step) : 0
      }
      anim.current = requestAnimationFrame(step)
    },
    [flush, setView, stopAnim],
  )
  const zoom = useRef<ZoomStore>({
    get: () => viewRef.current,
    subscribe: (fn, late) => {
      const set = late ? subs.current.late : subs.current.early
      set.add(fn)
      return () => void set.delete(fn)
    },
    poke: () => subs.current.late.forEach((f) => f(viewRef.current)),
  }).current
  // sloj sale se pravi iznova (npr. posle statistike): novi element dobija trenutni položaj
  useEffect(() => {
    if (el && !frame.current) frame.current = requestAnimationFrame(flush)
    return () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      stopAnim()
    }
  }, [el, flush, stopAnim])

  // sadržaj ne sme da pobegne iz kadra
  const clamp = useCallback(
    (v: View): View => {
      const r = stageRef.current?.getBoundingClientRect()
      const z = Math.min(MAX, Math.max(MIN, v.z))
      if (!r) return { z, x: 0, y: 0 }
      return { z, x: Math.min(0, Math.max(r.width - r.width * z, v.x)), y: Math.min(0, Math.max(r.height - r.height * z, v.y)) }
    },
    [stageRef],
  )
  /** zum za faktor f oko tačke (px, py) u koordinatama sale */
  const target = useCallback(
    (f: number, px: number, py: number) => {
      const v = viewRef.current
      const z = Math.min(MAX, Math.max(MIN, v.z * f))
      const k = z / v.z
      return clamp({ z, x: px - (px - v.x) * k, y: py - (py - v.y) * k })
    },
    [clamp],
  )
  const zoomAt = useCallback((f: number, px: number, py: number) => setView(target(f, px, py)), [setView, target])
  const zoomBy = useCallback(
    (f: number) => {
      const r = stageRef.current?.getBoundingClientRect()
      if (r) animateTo(target(f, r.width / 2, r.height / 2))
    },
    [stageRef, animateTo, target],
  )
  const reset = useCallback(() => animateTo({ z: 1, x: 0, y: 0 }), [animateTo])

  useEffect(() => {
    const stage = stageRef.current
    if (!el || !stage) return
    const pts = new Map<number, { x: number; y: number }>()
    let moved = 0
    let pinch: { d: number; mx: number; my: number } | null = null
    const local = (e: { clientX: number; clientY: number }) => {
      const r = stage.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      stopAnim()
      const p = local(e)
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y)
    }
    const onDown = (e: PointerEvent) => {
      // miš: bez podrazumevanog prevlačenja slike i označavanja teksta
      if (e.pointerType === 'mouse' && e.button === 0) e.preventDefault()
      stopAnim()
      pts.set(e.pointerId, local(e))
      moved = 0
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
      }
    }
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId)
      if (!prev) return
      const p = local(e)
      pts.set(e.pointerId, p)
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const v = viewRef.current
        const z = Math.min(MAX, Math.max(MIN, v.z * (d / pinch.d)))
        const k = z / v.z
        setView(clamp({ z, x: mx - (pinch.mx - v.x) * k, y: my - (pinch.my - v.y) * k }))
        pinch = { d, mx, my }
        moved += 10
        return
      }
      const dx = p.x - prev.x, dy = p.y - prev.y
      moved += Math.abs(dx) + Math.abs(dy)
      // pomeranje samo kad je zumirano (inače prst skroluje stranicu)
      if (viewRef.current.z > 1.01 && moved > 4) {
        setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }))
        try {
          el.setPointerCapture?.(e.pointerId)
        } catch {
          /* pokazivač je već pušten */
        }
      }
    }
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pts.size < 2) pinch = null
    }
    // posle prevlačenja ne otvaraj sedište na kome je prst stao
    const onClick = (e: MouseEvent) => {
      if (moved > 6) {
        e.stopPropagation()
        e.preventDefault()
      }
      moved = 0
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('click', onClick, true)
    const noDrag = (e: Event) => e.preventDefault()
    el.addEventListener('dragstart', noDrag)
    return () => {
      el.removeEventListener('dragstart', noDrag)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('click', onClick, true)
    }
  }, [el, stageRef, zoomAt, clamp, setView, stopAnim])

  return { zoom, zoomed, zoomBy, reset, layerRef }
}
