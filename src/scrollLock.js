// Locks the page in place behind a modal, drawer, sheet, or any other
// floating overlay with a backdrop — used by every such overlay in the app
// (see useModal.js's `lockScroll` option, and the call sites that don't go
// through useModal: App.jsx's mobile nav drawer, admin/ui.jsx's Drawer,
// admin/PendingPage.jsx's decline dialog, admin/AdminSidebar.jsx's mobile
// nav, and the filter/post-item panels in Jobs.jsx, BusinessDirectory.jsx
// and DirectoryFilters.jsx).
//
// Plain `overflow: hidden` on <body> stops the scrollbar but not mobile
// Safari's touch-driven rubber-band scroll, which still drags the whole
// page behind the overlay — the "background moves around behind it" bug.
// Pinning both <html> and <body> to `position: fixed` at the current
// scroll offset is the standard fix; the returned `unlock` function
// restores the exact scroll position so the page doesn't jump when the
// overlay closes.
//
// Reference-counted at module scope, rather than each call saving/restoring
// its own snapshot of "whatever was there before it." Two overlays are
// often open at once (a ConfirmDialog on top of the modal it's discarding),
// and ConfirmDialog frequently unmounts in the *same tick* as the modal
// underneath it (confirm a discard and both disappear together) — so the
// two lock/unlock pairs don't always settle in strict last-opened-first-
// closed order. With a per-call snapshot, an unlock that fires "out of
// order" reapplies a stale, already-locked snapshot instead of the page's
// true original style, and the page is left stuck unscrollable for good.
// A shared counter sidesteps that entirely: only the *first* lock call
// captures the original style and scroll position, and only when the
// count drops back to zero does the last unlock restore them — regardless
// of which order the calls happen in.
let lockCount = 0
let savedScrollY = 0
let prevStyles = null

export function lockBodyScroll() {
  if (lockCount === 0) {
    savedScrollY = window.scrollY
    const html = document.documentElement
    const body = document.body
    prevStyles = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
    }
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.width = '100%'
  }
  lockCount++

  // Guards a caller that accidentally invokes its own unlock twice (e.g. an
  // effect cleanup that runs, then a stray extra call) from decrementing
  // the shared counter more than once for a single lock.
  let released = false
  return function unlock() {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0 && prevStyles) {
      const html = document.documentElement
      const body = document.body
      html.style.overflow = prevStyles.htmlOverflow
      body.style.overflow = prevStyles.bodyOverflow
      body.style.position = prevStyles.bodyPosition
      body.style.top = prevStyles.bodyTop
      body.style.width = prevStyles.bodyWidth
      window.scrollTo(0, savedScrollY)
      prevStyles = null
    }
  }
}
