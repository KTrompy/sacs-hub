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
// Safe to call more than once while already locked (nested overlays, e.g.
// a ConfirmDialog on top of a modal): each call snapshots whatever is
// already in place as "prev" and restores exactly that on its own unlock,
// so the outermost lock/unlock pair always wins.
export function lockBodyScroll() {
  const scrollY = window.scrollY
  const html = document.documentElement
  const body = document.body
  const prev = {
    htmlOverflow: html.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyWidth: body.style.width,
  }
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${scrollY}px`
  body.style.width = '100%'
  return function unlock() {
    html.style.overflow = prev.htmlOverflow
    body.style.overflow = prev.bodyOverflow
    body.style.position = prev.bodyPosition
    body.style.top = prev.bodyTop
    body.style.width = prev.bodyWidth
    window.scrollTo(0, scrollY)
  }
}
