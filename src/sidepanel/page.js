// Reads the readable text of the current tab by injecting an extractor
// function into the page via chrome.scripting. Requires "scripting" +
// host permission for the tab (we grant <all_urls> in the manifest).

const MAX_CHARS = 12000 // keep prompts within a sane context window

/**
 * Runs in the *page* context (serialized by chrome.scripting). Must be
 * self-contained — no closures over outer variables, no imports.
 * Picks the most article-like container and returns its visible text.
 *
 * Walks the live DOM (rather than cloning and detaching a subtree) because
 * a detached clone has no layout, so .innerText on it stops respecting
 * `display: none` / `visibility: hidden` and can pull in hidden content —
 * getComputedStyle only gives reliable visibility info on live, attached
 * nodes.
 */
function extractReadableText() {
  const pick =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body

  const NOISE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'SVG', 'FORM'])
  const chunks = []

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue.trim()
      if (t) chunks.push(t)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    if (NOISE_TAGS.has(node.tagName)) return
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return
    for (const child of node.childNodes) walk(child)
  }

  walk(pick)
  return chunks.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * @returns {Promise<{ title: string, url: string, text: string }>}
 */
export async function getPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No active tab found.')
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
    throw new Error("This page can't be read (browser-internal page).")
  }

  // allFrames: true because lesson/article content is often rendered inside
  // an iframe (e.g. a "multimedia" content player on course platforms) —
  // reading only the top frame can silently miss the actual text.
  const injections = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: extractReadableText,
  })

  const text = injections
    .map((r) => r.result || '')
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_CHARS)
  if (!text) throw new Error('No readable text found on this page.')

  return { title: tab.title || '', url: tab.url || '', text }
}
