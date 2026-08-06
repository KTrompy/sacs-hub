import { useMemo, useRef, useState } from 'react'
import DropdownPortal from './DropdownPortal.jsx'
import { useListboxKeys } from '../useListboxKeys.js'
import { rankOptions } from '../utils.js'

// Same "type to filter, pick from suggestions" behaviour as ListAutocomplete,
// but lets you pick more than one value — each pick adds a removable chip
// instead of replacing whatever was chosen before, so filtering the
// directory by industry can mean "Accounting & Finance OR Banking,
// Insurance & Actuarial Science" instead of only ever one at a time.
export default function MultiSelectAutocomplete({
  values,
  onChange,
  options,
  // Optional { option: 'hidden search terms' } map — see INDUSTRY_KEYWORDS.
  // Lets an option be found by words that aren't in its visible label.
  keywords,
  placeholder,
  // When true, typing something that isn't in `options` shows an "Add"
  // entry (and Enter adds it directly) so people can note something not
  // on the list — used for Main areas of expertise's "Other".
  allowCustom = false,
  // Extra class(es) for the <input> itself — e.g. "onboarding-input" so it
  // matches the centered, full-width look every other onboarding field
  // gets (see CityAutocomplete/CountryAutocomplete's inputClassName). Left
  // unset, callers like the directory/jobs filters get the same bare input
  // they always have.
  inputClassName,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimeoutRef = useRef(null)
  // Anchor for the portalled suggestion list — see DropdownPortal.
  const anchorRef = useRef(null)

  function handleBlur() {
    blurTimeoutRef.current = setTimeout(() => setOpen(false), 150)
  }
  function handleFocus() {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    // Open the dropdown to show suggestions; if query is empty,
    // it will show all available options
    setOpen(true)
  }

  const needle = query.trim().toLowerCase()
  // Ranked rather than plain-substring filtered, so best matches lead and
  // hidden keywords count — see rankOptions. Memoised because the industry
  // list is long and this would otherwise recompute on every parent render.
  const suggestions = useMemo(() => {
    const available = options.filter((o) => !values.includes(o))
    return rankOptions(available, query, keywords)
  }, [options, values, query, keywords])
  const hasExactMatch = options.some((o) => o.toLowerCase() === needle)
  const alreadyAdded = values.some((v) => v.toLowerCase() === needle)
  const showAddCustom = allowCustom && needle.length > 0 && !hasExactMatch && !alreadyAdded

  function pick(option) {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current)
    if (!values.some((v) => v.toLowerCase() === option.toLowerCase())) onChange([...values, option])
    setQuery('') // cleared so the next pick starts from the full list again
    setOpen(false) // close dropdown after selection
  }

  function remove(option) {
    onChange(values.filter((v) => v !== option))
  }

  const showDropdown = open && (suggestions.length > 0 || showAddCustom)

  // The "Add …" row is navigable too, so it goes in the same list the arrow
  // keys walk — hence the wrapper objects rather than a bare string array.
  const navItems = [
    ...suggestions.map((o) => ({ value: o })),
    ...(showAddCustom ? [{ value: query.trim() }] : []),
  ]
  const keys = useListboxKeys({
    items: navItems,
    open: showDropdown,
    setOpen,
    onPick: (item) => pick(item.value),
  })

  function handleKeyDown(e) {
    // Arrow keys, Escape, and Enter-on-a-highlighted-row are handled by the
    // shared hook; it only claims Enter when something is actually
    // highlighted, so the existing "Enter commits what I typed" behaviour
    // below still runs for a plain Enter.
    keys.onKeyDown(e)
    if (e.defaultPrevented || e.key !== 'Enter') return
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    // Prefer the option's canonical casing over whatever was typed.
    const canonical = options.find((o) => o.toLowerCase() === trimmed.toLowerCase())
    if (canonical) { pick(canonical); return }
    if (allowCustom) pick(trimmed)
  }

  return (
    <div className="multi-select-autocomplete">
      {values.length > 0 && (
        <ul className="multi-select-chips">
          {values.map((v) => (
            <li key={v} className="multi-select-chip">
              <span>{v}</span>
              <button type="button" onClick={() => remove(v)} aria-label={`Remove ${v}`}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="city-autocomplete" ref={anchorRef}>
        <input
          className={inputClassName}
          value={query}
          onChange={(e) => { setQuery(e.target.value) }}
          onFocus={handleFocus}
          onClick={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={values.length ? 'Add another…' : placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
        />
        <DropdownPortal anchorRef={anchorRef} open={showDropdown}>
          <ul className="city-suggestions" ref={keys.listRef} role="listbox">
            {suggestions.map((option, i) => (
              <li key={option}>
                <button
                  type="button"
                  data-listbox-item
                  role="option"
                  aria-selected={i === keys.highlight}
                  className={i === keys.highlight ? 'is-highlighted' : undefined}
                  onMouseEnter={() => keys.setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(option)}
                >
                  {option}
                </button>
              </li>
            ))}
            {showAddCustom && (
              <li>
                <button
                  type="button"
                  data-listbox-item
                  role="option"
                  aria-selected={keys.highlight === suggestions.length}
                  className={keys.highlight === suggestions.length ? 'city-suggestion-add is-highlighted' : 'city-suggestion-add'}
                  onMouseEnter={() => keys.setHighlight(suggestions.length)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(query.trim())}
                >
                  Add "{query.trim()}"
                </button>
              </li>
            )}
          </ul>
        </DropdownPortal>
      </div>
    </div>
  )
}
