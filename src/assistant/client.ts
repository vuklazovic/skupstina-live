/**
 * Slanje pitanja asistentu.
 * - Bez sopstvenog ključa: preko našeg servera (/api/asistent), koji ima ključ i limite.
 * - Sa sopstvenim OpenRouter ključem: direktno iz browsera ka OpenRouteru; ključ ne prolazi kroz naš server.
 */
export type ChatMsg = { role: 'user' | 'assistant'; content: string }
export type UserKey = { key: string; model: string }

export const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'
export const MODEL_SUGGESTIONS = [
  'deepseek/deepseek-v4.1-flash',
  'deepseek/deepseek-v4-pro',
  'anthropic/claude-haiku-5.5',
  'anthropic/claude-sonnet-5.5',
  'google/gemini-omni-1.2-flash',
  'qwen/qwen3.8-flash',
]

export class ServerUnavailable extends Error {}
export class RateLimited extends Error {}
export class KeyError extends Error {}

const STORE = 'skupstina-openrouter'
export function loadUserKey(): UserKey | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null')
    return v?.key ? { key: v.key, model: v.model || DEFAULT_MODEL } : null
  } catch {
    return null
  }
}
export function saveUserKey(v: UserKey | null) {
  try {
    if (v) localStorage.setItem(STORE, JSON.stringify(v))
    else localStorage.removeItem(STORE)
  } catch {
    /* bez pamćenja: ključ važi do osvežavanja stranice */
  }
}

let systemCache: Record<string, Promise<string>> = {}
/** Isti sastav kao na serveru (server/assistant.ts → buildSystem). */
function systemFor(sessionId: string) {
  systemCache[sessionId] ??= Promise.all(
    ['sistemski-prompt.md', `analiza-${sessionId}.md`, `transkript-${sessionId}.md`].map((f) =>
      fetch(`data/asistent/${f}`).then((r) => {
        if (!r.ok) throw new Error(f)
        return r.text()
      }),
    ),
  ).then(([p, a, t]) => [p, '# ANALIZA SEDNICE', a, '# TRANSKRIPT SEDNICE', t].join('\n\n'))
  systemCache[sessionId].catch(() => (systemCache = {}))
  return systemCache[sessionId]
}

/** Čita OpenRouter SSE tok i javlja svaki novi deo teksta. */
async function readStream(res: Response, onText: (t: string) => void, signal: AbortSignal) {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue // komentari tipa ": OPENROUTER PROCESSING"
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const j = JSON.parse(data)
        if (j.error) throw new KeyError(j.error.message ?? 'Greška modela')
        const t = j.choices?.[0]?.delta?.content
        if (t) onText(t)
        if (j.choices?.[0]?.finish_reason === 'length') onText('\n\n_(Odgovor je skraćen zbog dužine. Postavi uže pitanje za detalje.)_')
      } catch (e) {
        if (e instanceof KeyError) throw e
      }
    }
  }
}

export async function ask(opts: {
  sessionId: string
  messages: ChatMsg[]
  userKey: UserKey | null
  onText: (t: string) => void
  signal: AbortSignal
}) {
  const { sessionId, messages, userKey, onText, signal } = opts
  if (!userKey) {
    const res = await fetch('api/asistent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, messages }),
      signal,
    }).catch(() => null)
    if (!res || res.status === 503 || res.status === 404 && !res.headers.get('content-type')?.includes('json')) throw new ServerUnavailable()
    if (res.status === 429) throw new RateLimited()
    if (!res.ok || !res.body) throw new ServerUnavailable()
    return readStream(res, onText, signal)
  }

  const system = await systemFor(sessionId)
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userKey.key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Narodna skupstina - pracenje sednica',
    },
    body: JSON.stringify({
      model: userKey.model || DEFAULT_MODEL,
      stream: true,
      max_tokens: 4000, // uključuje i interno razmišljanje modela
      reasoning: { effort: 'low', exclude: true },
      messages: [{ role: 'system', content: system }, ...messages.slice(-16)],
    }),
    signal,
  })
  if (res.status === 401 || res.status === 403) throw new KeyError('OpenRouter nije prihvatio ključ. Proveri da li je ključ ispravan.')
  if (res.status === 402) throw new KeyError('Na tvom OpenRouter nalogu nema dovoljno kredita.')
  if (res.status === 404 || res.status === 400) {
    const j = await res.json().catch(() => null)
    throw new KeyError(j?.error?.message ? `Model nije dostupan: ${j.error.message}` : 'Model nije dostupan. Izaberi drugi model.')
  }
  if (res.status === 429) throw new RateLimited()
  if (!res.ok || !res.body) throw new KeyError(`OpenRouter je vratio grešku (${res.status}).`)
  return readStream(res, onText, signal)
}
