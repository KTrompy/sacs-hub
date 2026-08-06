// Small shared helpers used across components.
import { useEffect, useState } from 'react'

// Tracks whether the viewport is at/above `breakpoint` (default: the
// desktop breakpoint the app already uses elsewhere, e.g. .sidebar /
// .mobile-tabbar switch at 720px). Used to switch a filter panel between
// "persistent sidebar column" (wide) and "slide-in drawer" (narrow)
// without duplicating the panel's markup for each layout.
// "Online" for the Directory's green dot / "Recently online" sort means
// "had a heartbeat in the last few minutes" (see the App.jsx interval that
// writes profiles.last_seen) — a deliberately loose window since the
// heartbeat itself only fires every couple of minutes, not on every click.
const ONLINE_WINDOW_MS = 5 * 60 * 1000
export function isRecentlyOnline(lastSeen) {
  if (!lastSeen) return false
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_WINDOW_MS
}

// Lowercases and strips diacritics so "Côte d'Ivoire" is reachable by typing
// "cote", and "elektrisien" matches "elektrisiën". Without this the picker
// quietly punishes anyone who doesn't have the accented key handy.
function foldText(s) {
  return (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

// Ranked matcher behind the type-to-filter pickers (industry, country).
//
// The old behaviour was a flat `option.includes(needle)`, which had two
// problems on a long list: results came back in list order regardless of how
// well they matched (typing "eng" led with "Accounting & Finance", because
// "Finance" is nowhere near where you're looking), and nothing matched unless
// you already knew the exact wording we chose.
//
// `keywords` is an optional { option: 'space separated hidden terms' } map —
// those terms are searched but never displayed, which is what lets "dokter"
// or "plumber" find a row whose label contains neither word.
//
// Tiers, best first:
//   0  the label starts with what you typed
//   1  a word inside the label starts with it
//   2  the label contains it anywhere
//   3  only a hidden keyword matched
// Ties keep the original list order, so the curated ordering still shows
// through and the result is stable as you type.
export function rankOptions(options, query, keywords) {
  const needle = foldText(query).trim()
  if (!needle) return options

  const scored = []
  options.forEach((option, index) => {
    const label = foldText(option)
    let score
    if (label.startsWith(needle)) score = 0
    else if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(needle))) score = 1
    else if (label.includes(needle)) score = 2
    else if (keywords && foldText(keywords[option]).includes(needle)) score = 3
    else return
    scored.push({ option, score, index })
  })

  scored.sort((a, b) => a.score - b.score || a.index - b.index)
  return scored.map((s) => s.option)
}

// Graduation/leaving year format check — any year is accepted (no tie to
// SACS' founding year or a forward cutoff), but the value still has to
// actually look like a year: a whole number, exactly 4 digits. Rejects
// obvious junk like 0, -5, 18, 99999, or a decimal, which nothing else in
// the form was stopping.
export function isValidGradYear(value) {
  if (value === '' || value === null || value === undefined) return true // optional field
  const n = Number(value)
  if (!Number.isInteger(n)) return false
  return /^\d{4}$/.test(String(value).trim())
}

// Only http(s) links are allowed through profile/business "website" style
// fields — blocks a javascript:/data: URI (or anything else non-http) from
// being saved and later rendered as a clickable href. An empty value is
// left alone (optional field); anything non-empty must parse as a URL with
// an http/https scheme.
export function isSafeHttpUrl(value) {
  const v = (value || '').trim()
  if (!v) return true
  try {
    const url = new URL(v)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// Defense-in-depth for href render sites. Save-time validation covers
// everything the current forms produce, but legacy data or rows inserted
// directly against the API could still carry a `javascript:` / `data:` URI —
// this returns null for those so callers can render them as inert text or a
// disabled control instead of an active exploit. Accepts http(s), mailto,
// tel, and scheme-less relative URLs (which can only navigate, never
// execute).
export function safeUrl(value) {
  const v = (value || '').trim()
  if (!v) return null
  try {
    const url = new URL(v)
    const p = url.protocol
    if (p === 'http:' || p === 'https:' || p === 'mailto:' || p === 'tel:') return v
    return null
  } catch {
    // No scheme at all — safe as a relative navigation. Reject anything
    // that looks like it's trying to be a scheme we don't recognise.
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null
    return v
  }
}

// Turns a single File/Blob (or null) into a stable object URL for preview
// purposes, revoking the previous one whenever `file` changes and on
// unmount. Calling URL.createObjectURL(file) directly inside JSX (the
// pattern this replaces) minted a brand new blob URL on every render with
// nothing ever calling revokeObjectURL — each keystroke in a form sharing
// the same page leaked another one for the life of the tab.
export function useObjectUrl(file) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!file) { setUrl(null); return undefined }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])
  return url
}

// Same idea as useObjectUrl, but for an array of files (e.g. a multi-image
// picker) — returns a same-length array of object URLs, revoking every URL
// from the previous render whenever the file list changes or the component
// unmounts.
export function useObjectUrls(files) {
  const [urls, setUrls] = useState([])
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f))
    setUrls(next)
    return () => next.forEach((u) => URL.revokeObjectURL(u))
  }, [files])
  return urls
}

export function useIsWide(breakpoint = 900) {
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= breakpoint : true
  )
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const handler = (e) => setIsWide(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])
  return isWide
}

// Normalizes a profile's "expertise" value into a clean string array.
//
// This field is meant to be a text[] column, but if it's ever saved while
// the column is still plain text (e.g. before schema-update-13.sql has
// been run against Supabase), the array gets silently JSON-stringified —
// so what comes back on load is the literal string
// '["Financial Accounting & Reporting"]' instead of a real array. Detect
// and unwrap that case so the UI never shows raw brackets/quotes, on top
// of the older legacy case where expertise was a single plain string.
export function normalizeExpertise(value) {
  if (Array.isArray(value)) {
    // A real text[] column can still end up holding a single element that's
    // itself the JSON-stringified array (saved back before the column was
    // migrated, then re-saved as one text[] entry instead of several) —
    // e.g. ['["Financial Accounting & Reporting","Personal Tax"]'] instead
    // of ['Financial Accounting & Reporting', 'Personal Tax']. Unwrap that
    // one level so the UI never shows raw brackets/quotes in a single chip.
    if (value.length === 1 && typeof value[0] === 'string') return normalizeExpertise(value[0])
    return value.filter((v) => typeof v === 'string' && v)
  }
  if (!value) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string' && v)
      } catch {
        // Not valid JSON after all — fall through and treat as plain text.
      }
    }
    return [trimmed]
  }
  return []
}

// Experience dates are stored as "YYYY-MM" (from a native <input type="month">).
// Renders "Jan 2022 – Present" style ranges, or nothing if both are blank.
// Shared by the profile editor's collapsed entry cards and the read-only
// person-profile timeline, so the two always agree on formatting.
export function formatExperienceRange(from, to) {
  const fmt = (v) => {
    if (!v) return ''
    const [y, m] = v.split('-')
    const d = new Date(Number(y), Number(m) - 1)
    return isNaN(d) ? v : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  const fromLabel = fmt(from)
  const toLabel = to ? fmt(to) : (from ? 'Present' : '')
  if (!fromLabel && !toLabel) return ''
  return [fromLabel, toLabel].filter(Boolean).join(' – ')
}

// LinkedIn-style rough duration ("2 yrs 3 mos") for an experience entry. A
// blank `to` is treated as ongoing (counts up to today). Returns '' when
// `from` is missing/unparseable, since a duration without a start point
// isn't meaningful, or when the range comes out to less than a month.
export function formatExperienceDuration(from, to) {
  if (!from) return ''
  const [fy, fm] = from.split('-').map(Number)
  if (!fy || !fm) return ''

  let ey, em
  if (to) {
    [ey, em] = to.split('-').map(Number)
    if (!ey || !em) return ''
  } else {
    const now = new Date()
    ey = now.getFullYear()
    em = now.getMonth() + 1
  }

  const months = (ey - fy) * 12 + (em - fm) + 1 // inclusive of both start/end months
  if (months < 1) return ''

  const years = Math.floor(months / 12)
  const rem = months % 12
  const parts = []
  if (years) parts.push(`${years} yr${years === 1 ? '' : 's'}`)
  if (rem || !years) parts.push(`${rem} mo${rem === 1 ? '' : 's'}`)
  return parts.join(' ')
}
