import { useState } from 'react'
import { supabase } from '../supabaseClient'
import PasswordInput from './PasswordInput.jsx'
import { PASSWORD_MIN, passwordProblem, PasswordStrengthMeter } from '../passwordRules.jsx'
import { friendlyAuthError } from '../authErrors.js'

// Shown instead of the normal app when App.jsx detects a PASSWORD_RECOVERY
// auth event — i.e. someone arrived via the "reset your password" link
// Supabase emailed them (see Auth.jsx's forgot-password flow). Clicking
// that link already signs them into a real (recovery-scoped) session, so
// this just needs to collect a new password and call updateUser — no
// token handling of our own, supabase-js already parsed the link.
export default function ResetPassword({ onDone, onCancel }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e?.preventDefault()
    setError(null)
    // Was 6 while signup required 8 — so this screen was a standing offer
    // to weaken any password below the minimum it was created under.
    // Shared with Auth.jsx and Settings.jsx now (see passwordRules.jsx).
    const pwProblem = passwordProblem(password)
    if (pwProblem) { setError(pwProblem); return }
    if (password !== confirm) { setError("Passwords don't match."); return }
    setBusy(true)
    // has_password mirrors what Settings.jsx writes when a Google-only
    // account sets its first password, and it has to be written here too:
    // "forgot password" is the other route to a Google account acquiring a
    // password, and Supabase adds no 'email' identity either way. Without
    // this, such an account goes back to Settings' unguarded "set a
    // password" form — the one that changes the password with no
    // current-password check. See the hasPassword comment in Settings.jsx.
    const { error: err } = await supabase.auth.updateUser({
      password,
      data: { has_password: true },
    })
    setBusy(false)
    if (err) {
      // No current_password is sent from this screen, and there mustn't be:
      // the entire premise of "forgot password" is not knowing it. A
      // recovery-token session already proves the person controls the
      // address, so GoTrue exempts it from the "require current password"
      // setting (Dashboard → Authentication → Sign In / Providers → Email).
      // If that ever stops being true, the raw message would be a dead end —
      // "enter your current password" on the screen you reached *because* you
      // don't have it — so name what's actually wrong.
      if (/current password/i.test(err.message || '')) {
        setError("This reset link can't set a password right now — the server is asking for your current one. Please contact an admin.")
        return
      }
      setError(friendlyAuthError(err))
      return
    }
    setDone(true)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-sub">Character · Style · Pride · Since 1961</p>

        {done ? (
          <>
            <p className="form-notice">Your password's been updated. You're signed in — head back in.</p>
            <button type="button" className="btn primary wide" onClick={onDone}>Continue to SACS Alumni</button>
          </>
        ) : (
          // A real <form> rather than bare labels + an onClick button: every
          // other auth screen submits on Enter, and this one silently didn't.
          <form onSubmit={submit}>
            <label className="field">
              <span>New password</span>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${PASSWORD_MIN} characters`}
                autoComplete="new-password"
              />
            </label>
            <PasswordStrengthMeter password={password} />
            <label className="field">
              <span>Confirm new password</span>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type it again"
                autoComplete="new-password"
              />
            </label>

            {error && <p className="form-error" role="alert">{error}</p>}

            <button className="btn primary wide" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
            {/* An expired or already-used reset link leaves this screen
                rendering against a dead session. Without an exit the only
                way out was a manual refresh. */}
            {onCancel && (
              <button className="link-btn" type="button" onClick={onCancel} disabled={busy}>
                Cancel and go back to sign in
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
