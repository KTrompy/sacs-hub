import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COUNTRY_DIAL_CODES, PHONE_PRIORITY_COUNTRIES } from '../constants.js'
import DropdownPortal from './DropdownPortal.jsx'

const GENERIC_FORMAT = '123 456 7890'

// ISO 3166-1 alpha-2 -> flag emoji. Each letter maps to a Unicode "regional
// indicator symbol" a fixed offset above its ASCII code point, so e.g. "ZA"
// becomes 🇿🇦 without needing an icon font or image asset. Deriving the flag
// from the same iso2 the dial code lives on also means the two can never
// drift out of sync with each other.
function flagFor(iso2) {
  return iso2.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

const ALL = COUNTRY_DIAL_CODES.map(([name, iso2, dial, format]) => ({
  name, iso2, dial, format: format || GENERIC_FORMAT, flag: flagFor(iso2),
}))
const BY_NAME = new Map(ALL.map((c) => [c.name, c]))
const PRIORITY = PHONE_PRIORITY_COUNTRIES.map((name) => BY_NAME.get(name)).filter(Boolean)
const DEFAULT_COUNTRY = BY_NAME.get('South Africa') || ALL[0]

// Longest dial codes first, so e.g. "27" (South Africa) doesn't shadow a
// country whose code happens to start with the same digits.
const BY_DIAL_DESC = [...ALL].sort((a, b) => b.dial.length - a.dial.length)

// Splits a stored value like "+27 82 123 4567" back into {country, national}
// so re-opening a saved profile shows the right flag pre-selected instead of
// dumping the whole string into the free-text side. Anything that doesn't
// start with a recognised dial code (legacy entries saved before this
// picker existed, or just a raw local number) falls back to South Africa
// with the original text kept intact — nothing is ever silently dropped.
function parseValue(value) {
  const raw = (value || '').trim()
  if (!raw) return { country: DEFAULT_COUNTRY, national: '' }
  const digits = raw.replace(/^\+/, '')
  const match = BY_DIAL_DESC.find((c) => digits.startsWith(c.dial))
  if (match) return { country: match, national: digits.slice(match.dial.length).trim() }
  return { country: DEFAULT_COUNTRY, national: raw }
}

function composeValue(country, national) {
  const trimmed = national.trim()
  return trimmed ? `+${country.dial} ${trimmed}` : ''
}

// Phone field styled as a single flowing control: a flag + dial-code picker
// on the left (searchable dropdown of every country) feeding straight into
// a free-text field on the right whose placeholder shows what a real local
// number looks like for whichever country is selected — so instead of a
// bare "+27 ..." hint, picking "South Africa" shows "82 123 4567" and
// picking "United States" shows "(415) 555-2671" right in the input.
export default function PhoneInput({ value, onChange, id }) {
  const [country, setCountry] = useState(() => parseValue(value).country)
  const [national, setNational] = useState(() => parseValue(value).national)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef(null)
  const searchRef = useRef(null)

  // Re-sync from the outside only when `value` changes for a reason other
  // than us having just emitted it ourselves — e.g. the profile finishing
  // its async load a beat after this field first mounts with an empty
  // default, which needs both the flag and the number to update. Comparing
  // against the value we last emitted (rather than re-parsing on every
  // render) means normal typing/country-picking never fights itself.
  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value === prevValueRef.current) return
    prevValueRef.current = value
    const parsed = parseValue(value)
    setCountry(parsed.country)
    setNational(parsed.national)
  }, [value])

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      // The country list lives in a portal on <body> now (see
      // DropdownPortal), so it is no longer inside wrapRef — without the
      // second check, clicking the search box or a country inside it would
      // read as an outside click and slam the dropdown shut.
      if (e.target.closest?.('.dropdown-portal')) return
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Focus via a callback ref rather than an effect keyed on `open`. The
  // dropdown lives in a portal that only mounts once its position has been
  // measured — a render later than `open` flipping true — so an effect
  // watching `open` would run while the search box still didn't exist.
  // useCallback with no deps keeps the ref identity stable, so React only
  // invokes it when the input actually attaches or detaches.
  const focusSearch = useCallback((el) => {
    searchRef.current = el
    el?.focus()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return { pinned: PRIORITY, rest: ALL.filter((c) => !PHONE_PRIORITY_COUNTRIES.includes(c.name)) }
    const matches = ALL.filter((c) => c.name.toLowerCase().includes(needle) || c.dial.includes(needle))
    return { pinned: [], rest: matches }
  }, [query])

  function pick(next) {
    setCountry(next)
    setOpen(false)
    setQuery('')
    prevValueRef.current = composeValue(next, national)
    onChange(prevValueRef.current)
  }

  function handleNationalChange(e) {
    // Digits plus the separators real numbers get written with (spaces,
    // dashes, brackets) — letters and other stray characters are dropped
    // as they're typed rather than failing later.
    const next = e.target.value.replace(/[^\d\s()-]/g, '')
    setNational(next)
    prevValueRef.current = composeValue(country, next)
    onChange(prevValueRef.current)
  }

  function clearNational() {
    setNational('')
    prevValueRef.current = ''
    onChange('')
  }

  return (
    <div className="phone-input" ref={wrapRef}>
      <button
        type="button"
        id={id}
        className="phone-input-code"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="phone-input-flag" aria-hidden="true">{country.flag}</span>
        <span className="phone-input-dial">+{country.dial}</span>
        <span className={open ? 'phone-input-chevron open' : 'phone-input-chevron'} aria-hidden="true">▾</span>
      </button>

      <div className="phone-input-national-wrap">
        <input
          type="tel"
          inputMode="tel"
          className="phone-input-national"
          value={national}
          onChange={handleNationalChange}
          placeholder={country.format}
        />
        {national && (
          <button type="button" className="search-clear" onClick={clearNational} aria-label="Clear phone number">×</button>
        )}
      </div>

      <DropdownPortal anchorRef={wrapRef} open={open} gap={6} maxHeight={340}>
        <div className="phone-input-dropdown" role="listbox">
          <input
            ref={focusSearch}
            className="phone-input-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search country or code…"
          />
          <ul className="phone-input-list">
            {filtered.pinned.map((c) => (
              <PhoneOption key={c.iso2} c={c} onPick={pick} active={c.iso2 === country.iso2} />
            ))}
            {filtered.pinned.length > 0 && filtered.rest.length > 0 && <li className="phone-input-divider" role="separator" />}
            {filtered.rest.map((c) => (
              <PhoneOption key={c.iso2} c={c} onPick={pick} active={c.iso2 === country.iso2} />
            ))}
            {filtered.pinned.length === 0 && filtered.rest.length === 0 && (
              <li className="phone-input-empty">No matching country</li>
            )}
          </ul>
        </div>
      </DropdownPortal>
    </div>
  )
}

function PhoneOption({ c, onPick, active }) {
  return (
    <li>
      <button
        type="button"
        className={active ? 'phone-input-option active' : 'phone-input-option'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(c)}
        role="option"
        aria-selected={active}
      >
        <span className="phone-input-option-flag" aria-hidden="true">{c.flag}</span>
        <span className="phone-input-option-name">{c.name}</span>
        <span className="phone-input-option-dial">+{c.dial}</span>
      </button>
    </li>
  )
}
