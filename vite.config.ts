import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { lokalniApi } from './dev/lokalni-api.ts'

// Javni repo sadrži samo frontend. Pravi server (chat, asistent, kontakt, isečci snimka) nije ovde;
// u razvoju ga zamenjuje dev/lokalni-api.ts, pa sajt radi lokalno bez ikakvog ključa i naloga.
export default defineConfig(({ mode }) => ({
  // oznaka builda (src/version.ts); u razvoju je uvek 'dev'
  define: { __BUILD__: JSON.stringify(mode === 'production' ? String(Date.now()) : 'dev') },
  plugins: [react(), lokalniApi()],
}))
