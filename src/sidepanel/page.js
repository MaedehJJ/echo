// Reads the readable text of the current tab by injecting an extractor
// function into the page via chrome.scripting. Requires "scripting" +
// host permission for the tab (we grant <all_urls> in the manifest).

const MAX_CHARS = 12000 // keep prompts within a sane context window

/**
 * Runs in the *page* context (serialized by chrome.scripting). Must be
 * self-contained — no closures over outer variables, no imports.
 * Picks the most article-like container and returns its visible text.
 */
function extractReadableText() {
  const pick =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body

  // Drop obvious noise before reading text.
  const clone = pick.cloneNode(true)
  clone
    .querySelectorAll('script, style, noscript, nav, header, footer, aside, svg, form')
    .forEach((el) => el.remove())

  const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
  return text
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

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractReadableText,
  })

  const text = (injection?.result || '').slice(0, MAX_CHARS)
  if (!text) throw new Error('No readable text found on this page.')

  return { title: tab.title || '', url: tab.url || '', text }
}
