import { useEffect, useRef, useState } from 'react'

// Arrow-key navigation for the four "type, then pick from a dropdown"
// components (City / Country / List / MultiSelect autocomplete).
//
// All four were mouse-only: you could type into them, but not walk the
// suggestions with the arrow keys, and Enter did nothing — so filling in a
// city or an industry meant reaching for the mouse, and keyboard-only and
// screen-reader users had no way to reach the list at all. Escape didn't
// close them either; only a click elsewhere did.
//
// Shared rather than reimplemented per component, since the exact behaviour
// (wrap-around, reset on the list changing, Escape closes without picking)
// is the part that's easy to let drift.
export function useListboxKeys({ items, open, setOpen, onPick, inputRef }) {
  const [highlight, setHighlight] = useState(-1)
  const itemsKey = items.length

  // Typing narrows the list, so an index from the previous list would point
  // at something unrelated. Start each new list unhighlighted (-1) — that
  // way Enter on a freshly typed query submits the form / commits free text
  // rather than silently choosing whatever happened to be first.
  useEffect(() => { setHighlight(-1) }, [itemsKey, open])

  const listRef = useRef(null)

  // Keep the highlighted row in view when arrowing past the visible window.
  useEffect(() => {
    if (highlight < 0 || !listRef.current) return
    const el = listRef.current.querySelectorAll('[data-listbox-item]')[highlight]
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (open) { e.stopPropagation(); setOpen(false); setHighlight(-1) }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return
      e.preventDefault()
      if (!open) { setOpen(true); return }
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => {
        const next = h + delta
        if (next < 0) return items.length - 1
        if (next >= items.length) return 0
        return next
      })
      return
    }
    if (e.key === 'Enter') {
      // Only intercept Enter when something is actually highlighted —
      // otherwise the surrounding form submits as it always has.
      if (open && highlight >= 0 && items[highlight] !== undefined) {
        e.preventDefault()
        onPick(items[highlight])
        setHighlight(-1)
      }
      return
    }
    if (e.key === 'Tab' && open) {
      setOpen(false)
      setHighlight(-1)
    }
  }

  return { highlight, setHighlight, onKeyDown, listRef, inputRef }
}
