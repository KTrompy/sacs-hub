// Extended rich text — markdown syntax with strikethrough, headers, and links
// Extends richText.jsx with additional formatting options

import { toggleWrap, toggleBullets } from './richText.jsx'

// Toggles ~~strikethrough~~ on the current selection
export function toggleStrikethrough(value, start, end) {
  return toggleWrap(value, start, end, '~~')
}

// Converts "## " lines to headers on every line touched by selection
export function toggleHeaders(value, start, end) {
  const before = value.slice(0, start)
  const after = value.slice(end)

  const lineStart = before.lastIndexOf('\n') + 1
  const nextBreak = after.indexOf('\n')
  const lineEnd = nextBreak === -1 ? value.length : end + nextBreak

  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const allHeaders = lines.every((l) => l.startsWith('## ') || l.trim() === '')

  const newLines = lines.map((l) => {
    if (l.trim() === '') return l
    return allHeaders ? l.replace(/^## /, '') : `## ${l}`
  })
  const newBlock = newLines.join('\n')
  const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd)

  return { value: newValue, start: lineStart, end: lineStart + newBlock.length }
}

// Helper to convert link markdown [text](url) into an inserted link
export function insertLink(value, start, end, url = '') {
  const selected = value.slice(start, end) || 'link text'
  const before = value.slice(0, start)
  const after = value.slice(end)
  const newValue = before + `[${selected}](${url})` + after
  return { value: newValue, start: start + 1, end: start + selected.length + 1 }
}

// Only these URL schemes (plus scheme-relative/relative URLs, which have no
// scheme at all) are safe to render as a clickable href. Anything else —
// most importantly `javascript:`, but also things like `data:` or `vbscript:`
// — executes in the visitor's session instead of navigating, so a link
// markdown a user typed themselves (a post, comment, bio, anything that
// goes through this renderer) could otherwise run arbitrary script for
// anyone who clicked it.
const SAFE_URL_PATTERN = /^(https?:|mailto:|tel:)/i

function sanitizeHref(url) {
  const trimmed = (url || '').trim()
  // No scheme at all (relative path, `#anchor`, `//host/path`) is safe —
  // it can only ever navigate, never execute.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  return SAFE_URL_PATTERN.test(trimmed) ? trimmed : '#'
}

// Parses inline formatting including strikethrough, links, bold, italic
function parseInline(text, keyPrefix) {
  const nodes = []
  let last = 0
  let i = 0

  // Combined regex: [text](url) | **bold** | ~~strikethrough~~ | *italic* | _italic_
  const regex = /\[(.+?)\]\((.+?)\)|\*\*(.+?)\*\*|~~(.+?)~~|\*(.+?)\*|_(.+?)_/g
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))

    if (match[1] !== undefined) {
      // Link: [text](url)
      nodes.push(
        <a key={`${keyPrefix}-link${i++}`} href={sanitizeHref(match[2])} target="_blank" rel="noopener noreferrer">
          {match[1]}
        </a>
      )
    } else if (match[3] !== undefined) {
      // Bold: **text**
      nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{match[3]}</strong>)
    } else if (match[4] !== undefined) {
      // Strikethrough: ~~text~~
      nodes.push(<del key={`${keyPrefix}-del${i++}`}>{match[4]}</del>)
    } else {
      // Italic: *text* or _text_
      const italicText = match[5] !== undefined ? match[5] : match[6]
      nodes.push(<em key={`${keyPrefix}-i${i++}`}>{italicText}</em>)
    }

    last = regex.lastIndex
  }

  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length ? nodes : [text]
}

// Renders markdown text including headers, bold, italic, strikethrough, links, bullets
export function renderRichTextExtended(text) {
  if (!text) return null
  const lines = text.split('\n')
  const blocks = []
  let bulletBuffer = []
  let lineBuffer = []

  function flushBullets(key) {
    if (bulletBuffer.length) {
      blocks.push(
        <ul className="rte-list" key={`ul-${key}`}>
          {bulletBuffer.map((l, i) => (
            <li key={i}>{parseInline(l.replace(/^- /, ''), `ul-${key}-${i}`)}</li>
          ))}
        </ul>
      )
      bulletBuffer = []
    }
  }

  function flushLines(key) {
    if (lineBuffer.length) {
      blocks.push(
        <p className="rte-p" key={`p-${key}`}>
          {lineBuffer.map((l, i) => (
            <span key={i}>
              {parseInline(l, `p-${key}-${i}`)}
              {i < lineBuffer.length - 1 && <br />}
            </span>
          ))}
        </p>
      )
      lineBuffer = []
    }
  }

  lines.forEach((line, idx) => {
    if (line.startsWith('## ')) {
      // Header
      flushBullets(idx)
      flushLines(idx)
      const headerText = line.slice(3)
      blocks.push(
        <h3 className="rte-h3" key={`h3-${idx}`}>
          {parseInline(headerText, `h3-${idx}`)}
        </h3>
      )
    } else if (line.startsWith('- ')) {
      // Bullet
      flushLines(idx)
      bulletBuffer.push(line)
    } else {
      // Regular line
      flushBullets(idx)
      lineBuffer.push(line)
    }
  })

  flushBullets('end')
  flushLines('end')

  return blocks
}
