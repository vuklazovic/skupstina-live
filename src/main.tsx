import { StrictMode, Suspense, lazy, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dodatak.css'
import App from './App.tsx'
import TrakaPage from './traka/TrakaPage.tsx'

// Glavna verzija sajta je TrakaPage (početna sa glasanjima, sala, svaki dan kao traka, vesti); radi i na starim adresama /dev i /traka.
// /uzivo je prenos uživo u glavnoj verziji. Prethodna verzija (sala sa prozorom govora, AI asistent, kontakt) je sačuvana na /staro.
const url = new URL(window.location.href)
const path = url.pathname.replace(/\/+$/, '')
// stara verzija učitava podatke sa relativnih adresa (data/…), pa adresa ne sme da se završava kosom crtom
if (path && path !== url.pathname) {
  url.pathname = path
  window.history.replaceState(null, '', url)
}
const isOld = path === '/staro'
// /admin se učitava posebno (prijava, priprema objava, ljudi), da ne ulazi u kod koji preuzimaju posetioci
// (import.meta.glob: u javnom repou frontenda foldera admin/ nema, pa tamo /admin otvara početnu)
const adminPage = import.meta.glob<{ default: ComponentType }>('./admin/AdminPage.tsx')['./admin/AdminPage.tsx']
const Admin = path === '/admin' && adminPage ? lazy(adminPage) : null

createRoot(document.getElementById('root')!).render(<StrictMode>{Admin ? <Suspense fallback={null}><Admin /></Suspense> : isOld ? <App /> : <TrakaPage />}</StrictMode>)
