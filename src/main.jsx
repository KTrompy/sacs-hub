import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { ToastProvider } from './components/Toast.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles.css'

// The browser's own back/forward scroll restoration fights with the manual
// scroll-position restore in useModal.js's `history` option (every modal
// pushes a history entry so the Back button closes it, then calls
// history.back() on any other close to clean that entry up). Since that
// push happens while the page is scroll-locked — pinned to
// `position: fixed`, so window.scrollY reads 0 at that instant — the
// browser records 0 as "where you were" for the entry underneath the
// modal. Closing the modal then triggers the browser's own restoration
// back to that wrongly-recorded 0, overriding the correct position
// useModal.js already scrolled back to, and the page jumps to the top.
// Turning restoration off entirely leaves scroll position fully in our own
// hands, which useModal.js's unlock already handles correctly.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
