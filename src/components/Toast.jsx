import { createContext, useCallback, useContext, useState } from 'react'

// Lightweight global toast/snackbar system. Most actions in the app (post,
// RSVP, delete, save a draft, bookmark a job…) used to complete silently —
// the only feedback loop was a confirm dialog before destructive actions.
// This gives every action a brief, dismissible confirmation instead of
// leaving people to guess whether something actually happened.
const ToastContext = createContext(null)

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  // showToast(message, { type: 'success' | 'error', duration })
  //
  // Errors persist until dismissed. 3.2 seconds is fine for "Post
  // published" — you don't need to do anything about it — but it's not
  // enough time to read "Could not delete listing", work out what it means
  // and decide what to try next. WCAG 2.2.1 makes the same distinction:
  // a message the person has to act on shouldn't time out on them.
  // Callers can still pass an explicit `duration` either way.
  const showToast = useCallback((message, opts = {}) => {
    const { type = 'success' } = opts
    const duration = 'duration' in opts ? opts.duration : (type === 'error' ? 0 : 3200)
    const id = ++idCounter
    setToasts((t) => [...t, { id, message, type }])
    if (duration) setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {/* aria-live="assertive" for errors: a polite region waits for the
          screen reader to finish whatever it's saying, which for a failure
          the person needs to act on is too late. */}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type}`}
            role={t.type === 'error' ? 'alert' : undefined}
          >
            {t.type === 'success' ? <CheckIcon /> : <ErrorIcon />}
            <span>{t.message}</span>
            {/* The whole toast used to be the dismiss button, with nothing
                indicating that. A visible × says so — and matters more now
                that an error sits there until it's dismissed. */}
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// Returns a showToast(message, opts) function. Falls back to a no-op
// outside the provider instead of throwing, so components stay easy to
// test/reuse without always needing the full app tree.
export function useToast() {
  const ctx = useContext(ToastContext)
  return ctx || (() => {})
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}
