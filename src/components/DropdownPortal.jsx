import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function sameStyle(a, b) {
  return (
    a.left === b.left && a.top === b.top && a.bottom === b.bottom &&
    a.width === b.width && a.maxWidth === b.maxWidth && a.maxHeight === b.maxHeight &&
    a.visibility === b.visibility
  )
}

// Renders a floating panel (autocomplete suggestion list, country picker,
// …) into <body> instead of leaving it inside the field it belongs to.
//
// Why: a `position: absolute` dropdown can only ever paint above things in
// the *same* stacking context. Half the cards on this site create their own
// — `.profile-section` has an entrance animation with `both` fill, which
// makes it a permanent stacking context — so a dropdown inside one was
// trapped there no matter how big its z-index got, and the next card down
// the page painted straight over it. That was being patched card-by-card
// with hand-tuned z-indexes on each section, which broke again every time a
// section was added, reordered, or given a dropdown it didn't have before.
//
// Portalling to <body> sidesteps the whole problem: the panel has no
// positioned ancestor left to be trapped by (or clipped by, if anything
// upstream ever gets `overflow: hidden`), so one z-index governs every
// dropdown on the site. The trade-off is that it no longer moves with the
// field automatically, so we measure the anchor and re-measure on scroll,
// resize, and anchor resize.
export default function DropdownPortal({
  // Ref to the element the panel should hang off — usually the input wrap.
  anchorRef,
  open,
  children,
  // Match the anchor's width exactly (suggestion lists) vs. let the panel
  // size itself (a fixed-width calendar popover).
  matchWidth = true,
  // Space between the field and the panel.
  gap = 4,
  // Tallest the panel may get; it shrinks further if the viewport is tight.
  maxHeight = 260,
  className = '',
}) {
  const [style, setStyle] = useState(null)

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8

    const roomBelow = vh - r.bottom - gap - margin
    const roomAbove = r.top - gap - margin
    // Flip above the field only when below is genuinely cramped and above
    // is roomier — otherwise a dropdown near the fold jitters between the
    // two as the list length changes.
    const flip = roomBelow < Math.min(maxHeight, 160) && roomAbove > roomBelow
    const available = Math.max(120, Math.min(maxHeight, flip ? roomAbove : roomBelow))

    const width = Math.round(r.width)
    // Keep the panel on screen on narrow viewports / right-aligned fields.
    const left = Math.round(
      Math.max(margin, Math.min(r.left, vw - width - margin)),
    )

    const next = {
      position: 'fixed',
      left,
      top: flip ? undefined : Math.round(r.bottom + gap),
      bottom: flip ? Math.round(vh - r.top + gap) : undefined,
      width: matchWidth ? width : undefined,
      maxWidth: matchWidth ? undefined : Math.round(vw - margin * 2),
      maxHeight: Math.round(available),
      // A fixed panel doesn't scroll away with its field, so once the field
      // itself has scrolled off screen the panel would otherwise sit there
      // pointing at nothing (and float over the sticky header on the way
      // past). Fade it out instead, and let it come back on scroll-back.
      visibility: r.bottom < 0 || r.top > vh ? 'hidden' : undefined,
    }
    // Bail when nothing actually moved. scroll/resize fire in bursts and
    // this runs on every one of them; without the guard each event queues a
    // fresh render for an identical position.
    setStyle((prev) => (prev && sameStyle(prev, next) ? prev : next))
  }, [anchorRef, gap, matchWidth, maxHeight])

  // Layout effect so the panel is positioned before it is ever painted —
  // measuring in a plain effect lets it flash at the top-left corner first.
  //
  // `children` is deliberately not a dependency: it's a fresh element on
  // every parent render, so depending on it would mean measure -> setState
  // -> re-render -> measure, forever. Nothing about the anchor changes when
  // the list contents do, and a panel that grows downward is already capped
  // by maxHeight (one that grows upward is pinned by `bottom`), so there's
  // nothing to re-measure for.
  useLayoutEffect(() => {
    if (!open) { setStyle(null); return }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    // Capture phase so scrolling *any* ancestor (a modal body, a filter
    // rail) repositions the panel, not just the window.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    let ro
    if (typeof ResizeObserver !== 'undefined' && anchorRef.current) {
      ro = new ResizeObserver(place)
      ro.observe(anchorRef.current)
    }
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      ro?.disconnect()
    }
  }, [open, place, anchorRef])

  if (!open || !style) return null

  return createPortal(
    <div className={className ? `dropdown-portal ${className}` : 'dropdown-portal'} style={style}>
      {children}
    </div>,
    document.body,
  )
}
