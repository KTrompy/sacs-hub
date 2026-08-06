import { useCallback, useEffect, useRef } from 'react'

// Everything a modal owes the person using it, in one hook.
//
// Before this existed only ProfileModal did the full job — trap focus, give
// it back on close, honour Escape — and every other overlay in the app got
// some subset. That inconsistency is worse than any single missing piece:
// Escape closed the small dialogs but not the big composers, Tab walked out
// of most overlays into the page behind them, and on mobile the hardware
// Back button navigated away from the page instead of closing the sheet.
//
// Usage:
//   const ref = useModal({ onClose })
//   return <div className="modal-backdrop" ...><div className="modal" ref={ref}>
//
// `onClose` is what Escape and the Back button call. Pass `closeOnEscape:
// false` for a modal that must not be dismissed by accident (mid-upload,
// say); pass `history: false` for one that shouldn't be a Back-button stop.
//
// Components that keep their open/closed state in a boolean rather than
// mounting and unmounting the modal should pass `enabled: open` — hooks
// can't be called conditionally, and a hook that scroll-locked the page for
// a modal nobody had opened would be worse than the bug it fixes.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

// Only the topmost modal should react to Escape or trap Tab. Without this,
// hitting Escape on a ConfirmDialog that's sitting on top of a composer
// would close both at once — you'd answer "don't discard" and watch your
// draft disappear anyway.
const stack = []

let seq = 0

export default function useModal(options = {}) {
  const {
    onClose,
    enabled = true,
    closeOnEscape = true,
    trapFocus = true,
    lockScroll = true,
    history = true,
  } = options

  const ref = useRef(null)
  // Kept in a ref so a caller passing an inline arrow doesn't tear down and
  // re-run the whole effect (and re-push a history entry) on every render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const close = useCallback(() => { onCloseRef.current?.() }, [])

  useEffect(() => {
    if (!enabled) return undefined
    const token = { close, closeOnEscape, trapFocus }
    stack.push(token)

    // Remember who opened us so focus can go back there on close — losing
    // your place in a long directory listing because you opened and closed a
    // profile is a small thing that makes keyboard use exhausting.
    const previouslyFocused = document.activeElement

    function onKey(e) {
      if (stack[stack.length - 1] !== token) return
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== 'Tab' || !trapFocus) return
      const root = ref.current
      if (!root) return
      const focusable = Array.from(root.querySelectorAll(FOCUSABLE))
        .filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      // Also catch the case where focus has escaped the modal entirely
      // (clicked the backdrop, say) — pull it back to the first control
      // rather than letting Tab continue through the page underneath.
      if (!root.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)

    let prevOverflow
    if (lockScroll) {
      prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    // Move focus into the modal. Prefer an actual input over the close
    // button when there is one, so opening a composer puts the cursor where
    // you're about to type.
    if (trapFocus) {
      const root = ref.current
      const preferred = root?.querySelector('[data-autofocus]')
      const firstFocusable = preferred || root?.querySelector(FOCUSABLE)
      firstFocusable?.focus?.()
    }

    // Make the modal a stop in browser history, so Back (including the
    // Android hardware button and the iOS back-swipe) closes it instead of
    // leaving the page. The marker lets us tell our own entry apart from one
    // the router pushed.
    const marker = `modal-${++seq}`
    let poppedByUser = false
    let pushed = false
    let pushTimer = null
    function onPop() {
      poppedByUser = true
      close()
    }
    if (history) {
      // Deferred by a tick rather than pushed synchronously. React's
      // StrictMode runs every effect twice in development (mount → unmount →
      // mount); pushing straight away would push, then asynchronously pop,
      // then push again, and those two overlapping history operations
      // settle unpredictably. Scheduling it means the throwaway first pass
      // cancels before it ever touches history.
      pushTimer = setTimeout(() => {
        window.history.pushState({ ...window.history.state, __modal: marker }, '')
        pushed = true
      }, 0)
      window.addEventListener('popstate', onPop)
    }

    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(token)
      if (i !== -1) stack.splice(i, 1)
      if (lockScroll) document.body.style.overflow = prevOverflow

      if (history) {
        clearTimeout(pushTimer)
        window.removeEventListener('popstate', onPop)
        // Clean up our history entry when the modal was closed some other
        // way (× button, save, backdrop). Guarded on the marker still being
        // current: if the app navigated somewhere while the modal was open —
        // "Send a message" jumping to /messages, for instance — our entry is
        // no longer on top and calling back() would undo that navigation.
        if (pushed && !poppedByUser && window.history.state?.__modal === marker) {
          window.history.back()
        }
      }

      // Restore focus last, after the modal is gone from the tree.
      if (trapFocus && previouslyFocused?.isConnected) previouslyFocused.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, close, closeOnEscape, trapFocus, lockScroll, history])

  return ref
}
