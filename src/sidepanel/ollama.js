// All network calls to the local Ollama server live here, so the UI
// components stay free of URLs and response-shape details.

const OLLAMA_BASE = 'http://localhost:11434'

/**
 * Fetch the list of locally installed models.
 * GET /api/tags → { models: [{ name, model, size, details, ... }, ...] }
 * Returns an array of model names, e.g. ["llama3.2:latest", "gpt-oss:20b"].
 */
export async function getModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`)
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status} ${res.statusText}`)
  }
  const data = await res.json()
  return (data.models ?? []).map((m) => m.name)
}

/**
 * Fetch a model's capabilities, e.g. ["completion", "tools", "thinking"].
 * Used to enable/disable the effort (thinking) control per model.
 */
export async function getCapabilities(model) {
  const res = await fetch(`${OLLAMA_BASE}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.capabilities ?? []
}

/**
 * Stream a chat completion.
 *
 * POST /api/chat with { stream: true } returns NDJSON — one JSON object per
 * line — each shaped like { message: { role, content }, done }. The `content`
 * on each line is a *delta* (a token or few); concatenating them yields the
 * full reply.
 *
 * @param {object}   opts
 * @param {string}   opts.model     model name, e.g. "llama3.2:latest"
 * @param {Array}    opts.messages  [{ role, content }, ...]
 * @param {string}   [opts.think]   reasoning effort ("low"|"medium"|"high") for
 *                                  thinking-capable models; omit otherwise.
 * @param {Array}    [opts.tools]   tool/function definitions the model may call.
 * @param {AbortSignal} [opts.signal]  to cancel mid-stream (Stop button)
 * @param {(delta: string, full: string) => void} opts.onToken called per delta
 * @returns {Promise<{content: string, toolCalls: Array}>} reply + any tool calls
 */
export async function streamChat({ model, messages, think, tools, signal, onToken }) {
  const body = { model, messages, stream: true }
  if (think) body.think = think // only for models that support "thinking"
  if (tools) body.tools = tools // model decides whether to call them

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`Ollama returned ${res.status} ${res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  const toolCalls = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // NDJSON: process complete lines, keep any partial line in the buffer.
    let newlineIndex
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue

      let json
      try {
        json = JSON.parse(line)
      } catch {
        continue // ignore malformed partial lines
      }

      const delta = json.message?.content ?? ''
      if (delta) {
        full += delta
        onToken?.(delta, full)
      }
      if (json.message?.tool_calls?.length) {
        toolCalls.push(...json.message.tool_calls)
      }
    }
  }

  return { content: full, toolCalls }
}
