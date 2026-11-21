import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const STEPS = [
  {
    target: '.sb-start',
    title: 'Prati sednicu redom',
    text: 'Pritisni dugme i govori se otvaraju jedan za drugim, iz sedišta odakle je ko govorio. U svakom je snimak, sažetak i ceo transkript.',
  },
  {
    target: '.sb-speakers',
    title: 'Skoči na govornika',
    text: 'Govornici su poređani po tome koliko su govorili. Klik otvara njihov prvi govor i prikazuje samo njihove govore.',
  },
  {
    target: '.zoom-ctl',
    title: 'Zumiraj i pomeraj salu',
    text: 'Točkićem miša (na telefonu sa dva prsta) približi deo sale i prevuci da se pomeraš. Izbliza se vide lica svih poslanika; veća glava znači da je više govorio.',
  },
  {
    target: '.sb-timeline',
    title: 'Ili izaberi trenutak',
    text: 'Ovo je tok cele sednice. Dužina trake pokazuje koliko je govor trajao. Klikni na bilo koji govor.',
  },
]

export const GUIDE_KEY = 'skupstina-vodic-v1'

/** Kratko uputstvo u tri koraka pri prvom ulasku u salu. */
export function Guide({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [tipH, setTipH] = useState(200)
  const tipRef = useRef<HTMLDivElement>(null)
  const step = STEPS[i]
  // posle uputstva stranica se vraća tamo gde je bila
  useEffect(() => {
    const y = window.scrollY
    return () => window.scrollTo({ top: y })
  }, [])

  useLayoutEffect(() => {
    // označeni deo prvo dovedi u vidno polje (tok sednice je pri dnu bočne trake)
    const el = document.querySelector(step.target)
    const er = el?.getBoundingClientRect()
    if (el && er && (er.top < 0 || er.top > window.innerHeight - 160)) el.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })
    const measure = () => {
      const r = document.querySelector(step.target)?.getBoundingClientRect() ?? null
      // deo koji se ne vidi (npr. lista na manjem ekranu) preskačemo
      if (!r || r.width === 0) {
        if (i < STEPS.length - 1) setI(i + 1)
        else onClose()
        return
      }
      setRect(r)
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step.target, i, onClose])
  // stvarna visina oblačića, da ga postavimo tako da ceo stane na ekran
  useLayoutEffect(() => {
    const h = tipRef.current?.offsetHeight
    if (h && h !== tipH) setTipH(h)
  })

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' || e.key === 'ArrowRight') i < STEPS.length - 1 ? setI(i + 1) : onClose()
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [i, onClose])

  if (!rect) return null
  const pad = 8
  // oblačić ide pored označenog dela: levo od panela, iznad table, levo od liste
  const W = 320
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = rect.left - W - 18
  let top = rect.top + 20
  if (left < 16) {
    left = Math.min(vw - W - 16, rect.left + 20)
    top = rect.top - tipH - 14 > 16 ? rect.top - tipH - 14 : rect.bottom + 16
  }
  // oblačić uvek ceo u prozoru
  top = Math.max(16, Math.min(top, vh - tipH - 16))
  left = Math.max(16, Math.min(left, vw - W - 16))
  // otvor ne izlazi van prozora (deo ispod ivice se ionako ne vidi)
  const hole = { left: Math.max(4, rect.left - pad), top: Math.max(4, rect.top - pad) }
  const holeW = Math.min(vw - 4, rect.right + pad) - hole.left
  const holeH = Math.min(vh - 4, rect.bottom + pad) - hole.top

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label="Kako se koristi">
      <motion.div
        className="guide-hole"
        animate={{ left: hole.left, top: hole.top, width: holeW, height: holeH }}
        transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
      />
      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          ref={tipRef}
          className="guide-tip"
          style={{ left, top, width: W }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="gt-step mono">
            {i + 1} / {STEPS.length}
          </div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <div className="gt-actions">
            <button className="gt-skip" onClick={onClose}>
              Preskoči
            </button>
            <button className="gt-next" onClick={() => (i < STEPS.length - 1 ? setI(i + 1) : onClose())} autoFocus>
              {i < STEPS.length - 1 ? 'Dalje' : 'Razumem'}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
