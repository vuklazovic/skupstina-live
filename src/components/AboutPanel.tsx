import { motion } from 'motion/react'
import { useEffect } from 'react'

/** „Kako radimo”: ko smo, odakle su podaci, kako merimo i kako nastaju sažeci i vesti. */
export function AboutPanel({ onClose, onContact }: { onClose: () => void; onContact?: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const items: [string, string][] = [
    ['Nezavisni smo', 'Skupština live je nezavisan, nestranački projekat. Nismo zvanični sajt Narodne skupštine Republike Srbije i nismo povezani ni sa jednom strankom, poslaničkom grupom ni kandidatom.'],
    ['Isti aršin za sve', 'Svaki govor prikazujemo na isti način: ko je govorio, koliko, šta je rekao i snimak. Ne biramo koga ćemo istaći; veličina u sali zavisi samo od izmerenog vremena govora.'],
    ['Izvori', 'Tekst govora je iz zvaničnih stenografskih beleški sa parlament.gov.rs. Dok beleške za neki dan ne budu objavljene, koristimo automatski transkript snimka i to jasno označavamo. Snimci su sa YouTube kanala Narodne skupštine.'],
    ['Kako merimo', 'Trajanje govora merimo iz snimka: od početka javljanja do sledećeg govornika. Brojke koje prikazujemo (minuti, reči, nastupi) izračunate su iz tih podataka, bez ručnog doterivanja.'],
    ['Sažeci i analiza', 'Sažetke pišemo uz pomoć veštačke inteligencije, po pravilima: samo ono što piše u zapisniku, tvrdnje se prenose kao tvrdnje („navodi da…”), bez ocena. Mogu da sadrže greške; uvek imate ceo tekst i snimak da proverite.'],
    ['Vesti', 'Prikazujemo naslove i linkove ka tekstovima medija različitih uređivačkih politika: javni servis, agencije, nezavisni i dnevni listovi. Tekst članka ne prenosimo; kratak sažetak je naš. Vesti označene „iz zapisnika” pišemo sami, samo iz podataka sa sednice, uz link na govor.'],
    ['Fotografije', 'Fotografije poslanika su sa sajta Narodne skupštine, a za nove poslanike sa Wikimedia Commons (pod slobodnim licencama) ili sa zvaničnih stranica fakulteta i instituta. Izvor i licenca stoje uz svaku fotografiju u profilu poslanika; ko nema fotografiju, prikazan je inicijalima.'],
    ['AI asistent', 'Asistent odgovara iz zapisnika sednice i uz svaki odgovor navodi govore iz kojih je to uzeo. Kad ga pitate za procenu, može da je iznese uz obrazloženje; to je procena modela, ne stav ovog sajta.'],
  ]
  return (
    <motion.div className="dossier-backdrop spk-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="news about"
        role="dialog"
        aria-modal="true"
        aria-label="Kako radimo"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="spk-x" onClick={onClose} aria-label="Zatvori">
          ×
        </button>
        <header className="news-head">
          <div className="eyebrow">Skupština live</div>
          <h2>Kako radimo</h2>
          <p>Da svako može da proveri šta je rečeno u Skupštini, iz prve ruke i bez tumačenja.</p>
        </header>
        <dl className="about-list">
          {items.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {onContact && (
          <button className="spk-all about-contact" onClick={onContact}>
            Pišite nam: primedbe i ispravke →
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}
