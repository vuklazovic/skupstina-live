/**
 * Lokalna zamena za server skupstina.live, samo za razvoj (npm run dev).
 *
 * Pravi server nije deo ovog repoa. Da bi sajt radio lokalno bez ključeva i naloga:
 *  - /api/chat      chat u memoriji ovog procesa (poruke, reakcije, čekić/srce); ništa ne ide na pravi sajt
 *  - /api/kontakt   poruka se samo ispiše u terminalu
 *  - /api/asistent  503 „server_key_unavailable”: sajt tada nudi rad sa tvojim OpenRouter ključem (ostaje u pregledaču)
 *  - /api/klip, /api/zvuk  404: video citata se pravi sa plakatom, bez snimka iz sale
 *  - /data/live/*   dan uživo: javni fajlovi se ČITAJU sa https://skupstina.live (isto što vidi svaki posetilac).
 *                   Isključi sa SKUPSTINA_BEZ_MREZE=1; tada sajt prikazuje samo objavljene dane iz public/data/.
 *
 * Na pravi server se odavde ništa ne upisuje.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const UZIVO = 'https://skupstina.live'

type Msg = { id: number; t: number; name: string; text: string; sys?: boolean }

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let s = ''
    req.on('data', (c: Buffer) => (s.length < 20_000 ? (s += c) : null))
    req.on('end', () => {
      try {
        resolve(JSON.parse(s) as Record<string, unknown>)
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function lokalniApi(): Plugin {
  return {
    name: 'skupstina-lokalni-api',
    apply: 'serve',
    configureServer(server) {
      // ---- chat u memoriji
      const msgs: Msg[] = [{ id: 1, t: Date.now(), name: 'Lokalni chat', text: 'Ovo je chat samo na tvom računaru. Poruke ne idu na skupstina.live.' }]
      let nextId = 2
      const owners = new Map<number, string>()
      const reacts = new Map<number, Map<string, string>>()
      const buckets = new Map<number, { cekic: number; srce: number; zastava: number }>()
      const sec = () => Math.floor(Date.now() / 1000)
      const reactOne = (m: Map<string, string>, k: string) => {
        const c: Record<string, number> = {}
        for (const v of m.values()) c[v] = (c[v] ?? 0) + 1
        return { c, m: m.get(k) ?? null }
      }
      server.middlewares.use('/api/chat', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (req.method === 'GET') {
          const k = url.searchParams.get('k') ?? ''
          const after = Number(url.searchParams.get('posle')) || 0
          const now = sec()
          const counts = [...buckets].filter(([s]) => s > (Number(url.searchParams.get('udarci')) || 0) && s > now - 10 && s < now).map(([s, b]) => ({ s, ...b }))
          return json(res, 200, {
            messages: msgs.filter((m) => m.id > after).slice(-100),
            online: 1,
            hidden: [],
            reactions: Object.fromEntries([...reacts].filter(([, m]) => m.size).map(([id, m]) => [id, reactOne(m, k)])),
            own: msgs.filter((m) => owners.get(m.id) === k).map((m) => m.id),
            sticky: null,
            poll: null,
            ...(url.searchParams.has('udarci') ? { udarci: { now: now - 1, counts } } : {}),
          })
        }
        const body = await readJson(req)
        const k = String(body.k ?? '')
        if (body.hits != null) {
          const h = body.hits as Record<string, number>
          const b = buckets.get(sec()) ?? { cekic: 0, srce: 0, zastava: 0 }
          b.cekic += Number(h.cekic) || 0
          b.srce += Number(h.srce) || 0
          b.zastava += Number(h.zastava) || 0
          buckets.set(sec(), b)
          for (const s of buckets.keys()) if (s < sec() - 30) buckets.delete(s)
          return json(res, 200, { ok: true })
        }
        if (body.react != null) {
          const id = Number(body.react)
          const m = reacts.get(id) ?? new Map<string, string>()
          if (typeof body.e === 'string') m.set(k, body.e)
          else m.delete(k)
          reacts.set(id, m)
          return json(res, 200, { ok: true, reactions: reactOne(m, k) })
        }
        const text = body.event === 'cekic' ? 'uzima čekić' : String(body.text ?? '').trim().slice(0, 300)
        if (!text) return json(res, 400, { error: 'empty' })
        const m: Msg = { id: nextId++, t: Date.now(), name: String(body.name ?? '').trim().slice(0, 24) || 'Gost', text }
        if (body.event === 'cekic') m.sys = true
        msgs.push(m)
        owners.set(m.id, k)
        if (msgs.length > 300) msgs.shift()
        return json(res, 200, { ok: true, message: m })
      })

      // ---- kontakt: samo ispis u terminalu
      server.middlewares.use('/api/kontakt', async (req, res) => {
        if (req.method === 'GET') return json(res, 200, { enabled: true })
        const body = await readJson(req)
        console.log('\n[lokalni-api] kontakt forma (nije poslato nikome):', body)
        return json(res, 200, { ok: true })
      })

      // ---- asistent: bez serverskog ključa; sajt nudi rad sa sopstvenim OpenRouter ključem
      server.middlewares.use('/api/asistent', (_req, res) => json(res, 503, { error: 'server_key_unavailable' }))

      // ---- isečci snimka i zvuka postoje samo na pravom serveru
      for (const p of ['/api/klip', '/api/zvuk']) {
        server.middlewares.use(p, (_req, res) => {
          res.statusCode = 404
          res.end('nema u lokalnom razvoju')
        })
      }

      // ---- dan uživo: javni fajlovi se čitaju sa pravog sajta (samo GET, kratko pamćenje)
      const offline = !!process.env.SKUPSTINA_BEZ_MREZE
      const cache = new Map<string, { at: number; status: number; type: string; body: Buffer }>()
      server.middlewares.use('/data/live', async (req, res) => {
        const rel = (req.url ?? '/').split('?')[0]
        if (offline || req.method !== 'GET' || !/^\/[\w./-]+\.(json|md)$/.test(rel) || rel.includes('..')) {
          res.statusCode = 404
          return res.end()
        }
        let hit = cache.get(rel)
        if (!hit || Date.now() - hit.at > 10_000) {
          try {
            const r = await fetch(`${UZIVO}/data/live${rel}`, { signal: AbortSignal.timeout(8000) })
            hit = { at: Date.now(), status: r.status, type: r.headers.get('content-type') ?? 'application/json', body: Buffer.from(await r.arrayBuffer()) }
          } catch {
            hit = { at: Date.now(), status: 404, type: 'text/plain', body: Buffer.alloc(0) }
          }
          if (cache.size > 50) cache.clear()
          cache.set(rel, hit)
        }
        res.statusCode = hit.status === 200 ? 200 : 404
        res.setHeader('Content-Type', hit.type)
        res.setHeader('Cache-Control', 'no-cache')
        res.end(hit.status === 200 ? hit.body : undefined)
      })
    },
  }
}
