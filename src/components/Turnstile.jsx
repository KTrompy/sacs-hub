import { useEffect, useRef, useState } from 'react'

// Standalone Cloudflare Turnstile widget.
//
// Auth.jsx has its own inline copy of this logic, tangled up with the signup
// wizard's step state — deliberately left alone, because it works and it's the
// highest-traffic path in the app. This component exists for everywhere else
// that needs a captcha token, starting with Settings.jsx's password change.
//
// Why Settings needs one at all: savePassword() re-authenticates by calling
// signInWithPassword() before changing anything. If CAPTCHA protection is
// enabled in the Supabase dashboard, GoTrue rejects that call outright for
// having no token — and Settings' error handler maps every non-network failure
// to "Current password is incorrect", so every member is told their correct
// password is wrong, permanently. See SIGNUP_LOGIN_AUDIT_2026_08_02.md (C2).
//
// Renders nothing when VITE_TURNSTILE_SITE_KEY is unset (local dev), and the
// callers treat a null token as "no captcha required" in that case.

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

// `resetSignal` is how a parent asks for a fresh challenge: bump the number
// after every auth attempt. Turnstile tokens are single-use, so reusing one
// fails with "captcha protection: request disallowed" — which reads exactly
// like a wrong password if you don't know to look for it.
export default function Turnstile({ onToken, onErrorChange, resetSignal = 0, className = 'auth-captcha' }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [failed, setFailed] = useState(false)

  // Latest callbacks, read from inside the widget's own callbacks without
  // re-rendering the widget every time a parent re-renders with new function
  // identities — re-rendering a Turnstile widget resets it and throws away a
  // token the person has already solved for.
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onErrorChangeRef = useRef(onErrorChange)
  onErrorChangeRef.current = onErrorChange

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return undefined

    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 100 // 100 × 150ms ≈ 15s

    function report(isFailed) {
      setFailed(isFailed)
      onErrorChangeRef.current?.(isFailed)
    }

    function render() {
      if (cancelled || !window.turnstile || !containerRef.current) return
      // Clear anything left from a previous pass (StrictMode double-invoke,
      // or a re-mount) so turnstile.render isn't silently skipped.
      if (widgetIdRef.current) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
        widgetIdRef.current = null
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => { onTokenRef.current?.(token); report(false) },
        'expired-callback': () => onTokenRef.current?.(null),
        'error-callback': () => { onTokenRef.current?.(null); report(true) },
      })
      report(false)
    }

    if (window.turnstile) {
      render()
    } else {
      // api.js is loaded async/defer in index.html — poll briefly. If it never
      // arrives (ad/privacy blocker, or challenges.cloudflare.com unreachable)
      // say so rather than leaving a blank box that silently blocks the form.
      const interval = setInterval(() => {
        attempts += 1
        if (window.turnstile) {
          clearInterval(interval)
          render()
        } else if (attempts >= MAX_ATTEMPTS) {
          clearInterval(interval)
          report(true)
        }
      }, 150)
      return () => { cancelled = true; clearInterval(interval) }
    }

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
      }
      widgetIdRef.current = null
    }
  }, [])

  // Skips the initial render: there's nothing to reset before the first
  // attempt, and resetting a freshly rendered widget throws away a token the
  // person may have already solved.
  const firstResetRef = useRef(true)
  useEffect(() => {
    if (firstResetRef.current) { firstResetRef.current = false; return }
    onToken?.(null)
    if (window.turnstile && widgetIdRef.current) {
      try { window.turnstile.reset(widgetIdRef.current) } catch { /* already gone */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  if (!TURNSTILE_SITE_KEY) return null

  return (
    <>
      <div ref={containerRef} className={className} />
      {failed && (
        <p className="form-error" role="alert">
          Security check failed to load. Disable any ad or privacy blocker for this
          site and{' '}
          <button type="button" className="link-btn" onClick={() => window.location.reload()}>
            refresh the page
          </button>.
        </p>
      )}
    </>
  )
}
