import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ breaks: true, gfm: true })

/**
 * Render Markdown to sanitized HTML.
 * The content passes through a model and can include arbitrary page text,
 * so we always sanitize before rendering with dangerouslySetInnerHTML.
 */
export function renderMarkdown(text) {
  const raw = marked.parse(text || '')
  return DOMPurify.sanitize(raw)
}
