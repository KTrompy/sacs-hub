import DOMPurify from 'dompurify'

// Only what the rich text toolbar can produce (bold, italic, bullets, line
// breaks). No attributes at all — that also strips any pasted inline
// `style=` or `on*=` handlers. Used both right before saving to Supabase and
// again right before rendering, so it's safe even if old data or a future
// code path ever puts something unexpected in the column.
const CONFIG = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'ul', 'li', 'br', 'div', 'p'],
  ALLOWED_ATTR: [],
}

export function sanitizeHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(html, CONFIG)
}

// Wider whitelist for the Business Directory description editor only — it
// carries a fuller toolbar (underline, alignment, indent, ordered lists,
// links) than the 3-button editor everywhere else, so it needs a few more
// tags/attributes. Still no script/style/event-handler attributes; `style`
// is limited in practice to what execCommand itself writes (text-align,
// margin for indent) since nothing else in the editor can set it, and
// DOMPurify still strips dangerous constructs (url(javascript:...), etc.)
// out of any style value that does get through.
const BUSINESS_CONFIG = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'br', 'div', 'p', 'span', 'blockquote', 'a'],
  ALLOWED_ATTR: ['style', 'href', 'target', 'rel'],
}

export function sanitizeBusinessHtml(html) {
  if (!html) return ''
  return DOMPurify.sanitize(html, BUSINESS_CONFIG)
}

// contentEditable (the rich text editor used for job/post descriptions)
// often leaves a trailing empty <div><br></div> or two behind if someone
// hits Enter a few extra times while composing. Nothing was stripping
// that before saving, so it rendered as real, visible blank lines after
// the actual text — the "big empty gap at the bottom of the card" bug.
// Removing trailing empty elements/whitespace makes the card end where
// the content actually does.
export function trimTrailingHtml(html) {
  if (!html) return html
  const container = document.createElement('div')
  container.innerHTML = html
  while (container.lastChild) {
    const node = container.lastChild
    const isEmpty =
      (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) ||
      (node.nodeType === Node.ELEMENT_NODE && !node.textContent.trim())
    if (!isEmpty) break
    container.removeChild(node)
  }
  return container.innerHTML
}
