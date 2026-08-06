// Minimal RFC 5545 (iCalendar) writer — just enough to export SACS Hub
// events as .ics files that Google/Apple/Outlook calendar can import. No
// external dependency; the format is simple enough that pulling one in
// isn't worth it for what's otherwise a few dozen lines of string building.

function pad(n) { return String(n).padStart(2, '0') }

// UTC, "basic" format per RFC 5545 (YYYYMMDDTHHMMSSZ). Using UTC throughout
// avoids needing to ship VTIMEZONE definitions just for a South
// Africa-based alumni network's calendar exports — every calendar client
// converts a UTC timestamp to the viewer's local time correctly on its own.
function toIcsDate(iso) {
  const d = new Date(iso)
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z'
  )
}

// Escapes text per RFC 5545 §3.3.11 — commas, semicolons, backslashes and
// newlines are all meaningful to the format and need escaping so a title
// or description containing them doesn't corrupt the file.
function escapeText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// The spec caps content lines at 75 OCTETS, folding longer ones onto a
// continuation line that starts with a space. Without this, a long
// description can get truncated or rejected outright by stricter clients
// (Outlook in particular).
//
// Counting octets, not JS string length, matters here: this is an Afrikaans
// alumni network, so titles and descriptions routinely carry ë/é/ê/ï, each of
// which is 2 bytes in UTF-8. Measuring by `.length` would let a line of 75
// characters run to 90+ octets and blow the limit the fold exists to respect.
//
// The walk below also never splits a multi-byte character across a fold (it
// only breaks between whole code points), and never splits an escape sequence
// like `\,` or `\n` written by escapeText — a break between the backslash and
// the character it escapes would change the meaning of the value.
function foldLine(line) {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out = []
  let current = ''
  let currentBytes = 0
  // Array.from splits on code points rather than UTF-16 units, so surrogate
  // pairs (emoji) stay intact too.
  const chars = Array.from(line)

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const size = encoder.encode(ch).length
    // Continuation lines start with a space, which itself costs an octet, so
    // every line after the first has 74 to play with rather than 75.
    const limit = out.length === 0 ? 75 : 74
    if (currentBytes + size > limit) {
      out.push(current)
      current = ''
      currentBytes = 0
    }
    current += ch
    currentBytes += size
    // Don't leave a fold sitting between a backslash and the character it
    // escapes — carry the escaped character onto this line too.
    if (ch === '\\' && i + 1 < chars.length) {
      const next = chars[i + 1]
      current += next
      currentBytes += encoder.encode(next).length
      i++
    }
  }
  if (current) out.push(current)

  return out.join('\r\n ')
}

function icsLine(key, value) {
  return foldLine(`${key}:${value}`)
}

function eventToVevent(e, siteUrl) {
  const start = e.event_start_time || e.event_date
  // No end time set — default to a 2-hour block rather than a zero-length
  // event, which some calendar apps render oddly (or not at all).
  const end = e.event_end_time || new Date(new Date(start).getTime() + 2 * 60 * 60 * 1000).toISOString()
  const lines = [
    'BEGIN:VEVENT',
    icsLine('UID', `event-${e.id}@sacsalumnihub`),
    icsLine('DTSTAMP', toIcsDate(new Date().toISOString())),
    icsLine('DTSTART', toIcsDate(start)),
    icsLine('DTEND', toIcsDate(end)),
    icsLine('SUMMARY', escapeText(e.title || 'SACS Hub event')),
  ]
  if (e.description) lines.push(icsLine('DESCRIPTION', escapeText(e.description)))
  if (e.location) lines.push(icsLine('LOCATION', escapeText(e.location)))
  if (siteUrl) lines.push(icsLine('URL', `${siteUrl}/events/${e.id}`))
  lines.push('END:VEVENT')
  return lines
}

// Builds a full .ics file's contents for one event or a list of them (the
// latter for a "export all my saved/upcoming events" download).
export function buildIcs(events, { calendarName } = {}) {
  const list = Array.isArray(events) ? events : [events]
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SACS Hub//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  if (calendarName) lines.push(icsLine('X-WR-CALNAME', escapeText(calendarName)))
  for (const e of list) lines.push(...eventToVevent(e, siteUrl))
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// Triggers a browser download of the given .ics content via a temporary
// object URL — no server round-trip needed since everything's already in
// hand client-side.
export function downloadIcs(filename, icsContent) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Filesystem-safe-ish filename from an event title, e.g. for
// "Cape Town Golf Day!" -> "cape-town-golf-day.ics".
export function icsFilenameFor(title) {
  const slug = (title || 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'event'}.ics`
}
