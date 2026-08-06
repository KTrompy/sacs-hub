// Lightweight rich text — markdown-lite syntax (**bold**, *italic*/_italic_, "- " bullets).
// No external editor library: a plain <textarea> holds the raw markdown, a toolbar
// inserts the syntax around the current selection, and renderRichText turns it into
// React elements (never dangerouslySetInnerHTML, so there's no injection risk).

// Wraps (or unwraps, if already wrapped) the current selection in a textarea with
// the given marker. Returns the new full value and where the selection should land.
export function toggleWrap(value, start, end, marker) {
  const selected = value.slice(start, end)
  const before = value.slice(0, start)
  const after = value.slice(end)

  const alreadyWrapped =
    before.endsWith(marker) && after.startsWith(marker)

  if (alreadyWrapped) {
    const newValue =
      before.slice(0, before.length - marker.length) +
      selected +
      after.slice(marker.length)
    return { value: newValue, start: start - marker.length, end: end - marker.length }
  }

  const newValue = before + marker + selected + marker + after
  return { value: newValue, start: start + marker.length, end: end + marker.length }
}

// Toggles "- " bullet prefix on every line touched by the current selection.
export function toggleBullets(value, start, end) {
  const before = value.slice(0, start)
  const after = value.slice(end)

  // Expand the selection to cover full lines.
  const lineStart = before.lastIndexOf('\n') + 1
  const nextBreak = after.indexOf('\n')
  const lineEnd = nextBreak === -1 ? value.length : end + nextBreak

  const block = value.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const allBulleted = lines.every((l) => l.startsWith('- ') || l.trim() === '')

  const newLines = lines.map((l) => {
    if (l.trim() === '') return l
    return allBulleted ? l.replace(/^- /, '') : `- ${l}`
  })
  const newBlock = newLines.join('\n')
  const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd)

  return { value: newValue, start: lineStart, end: lineStart + newBlock.length }
}

// Parses **bold** and *italic*/_italic_ within a single line into React nodes.
function parseInline(text, keyPrefix) {
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g
  const nodes = []
  let last = 0
  let match
  let i = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{match[1]}</strong>)
    } else {
      const italicText = match[2] !== undefined ? match[2] : match[3]
      nodes.push(<em key={`${keyPrefix}-i${i++}`}>{italicText}</em>)
    }
    last = regex.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length ? nodes : [text]
}

// Turns markdown-lite text into a list of React elements: paragraphs, <br>-joined
// lines, and <ul><li> blocks for consecutive "- " lines.
export function renderRichText(text) {
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
    if (line.startsWith('- ')) {
      flushLines(idx)
      bulletBuffer.push(line)
    } else {
      flushBullets(idx)
      lineBuffer.push(line)
    }
  })
  flushBullets('end')
  flushLines('end')

  return blocks
}
