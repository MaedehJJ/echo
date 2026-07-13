// Keyless web search via DuckDuckGo's HTML endpoint. The side panel can fetch
// it because the manifest grants <all_urls> host permission (which bypasses
// CORS for the extension). Note: this sends the query to DuckDuckGo — it is the
// one feature that leaves the machine, so it's opt-in and off by default.

const DDG = 'https://html.duckduckgo.com/html/'

// Tool definition handed to the model when web search is enabled. The model
// decides whether to call it — so search happens only when the answer needs it.
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for current, real-time, or niche factual information. ' +
      'Only call this when the answer needs up-to-date facts, recent events, or ' +
      'specifics you are not confident about — not for general knowledge you already have.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
      },
      required: ['query'],
    },
  },
}

/**
 * @param {string} query
 * @param {number} limit  max results
 * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
 */
export async function searchWeb(query, limit = 5) {
  const res = await fetch(`${DDG}?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`Web search failed (${res.status})`)
  const html = await res.text()
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const results = []
  for (const a of doc.querySelectorAll('a.result__a')) {
    let url = a.getAttribute('href') || ''
    // DDG wraps outbound links as //duckduckgo.com/l/?uddg=<encoded-url>
    const wrapped = url.match(/[?&]uddg=([^&]+)/)
    if (wrapped) url = decodeURIComponent(wrapped[1])

    const container = a.closest('.result') || a.parentElement
    const snippet = container?.querySelector('.result__snippet')?.textContent?.trim() || ''

    results.push({ title: a.textContent.trim(), url, snippet })
    if (results.length >= limit) break
  }

  // A zero-result page is usually a genuine "nothing found" — but it's also
  // what we'd see if DuckDuckGo changed its markup and our selectors no
  // longer match anything. Surface that ambiguity in the console rather than
  // failing silently, since the caller otherwise can't tell the difference.
  if (results.length === 0) {
    console.warn('[Echo] web search returned zero results — either no matches, or DuckDuckGo markup changed and the scraper selectors need updating:', query)
  }

  return results
}

/** Render results as a numbered context block for the model to cite as [n]. */
export function formatResults(results) {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join('\n\n')
}
