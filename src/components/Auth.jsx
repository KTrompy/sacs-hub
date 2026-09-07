import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'
import PasswordInput from './PasswordInput.jsx'
import Turnstile, { TURNSTILE_SITE_KEY } from './Turnstile.jsx'
import { authRedirectTo } from '../authRedirect.js'
import { friendlyAuthError } from '../authErrors.js'
import Onboarding from './onboarding/Onboarding.jsx'
import { resendConfirmation } from './onboarding/onboardingSubmit.js'

// Google only — Facebook/LinkedIn were dropped (each needs its own dev-app
// + review process for little extra coverage). Configured in the Supabase
// dashboard: Authentication → Providers → Google.
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
]

function SocialButtons({ prefix, onError }) {
  async function social(provider) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: authRedirectTo() },
    })
    if (error) onError(error.message)
  }
  return (
    <div className="auth-social-row">
      {SOCIAL_PROVIDERS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`auth-social-btn provider-${p.id}`}
          onClick={() => social(p.id)}
        >
          <ProviderIcon id={p.id} />
          {prefix} {p.label}
        </button>
      ))}
    </div>
  )
}

function ProviderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.2-2 3.8-5 3.8-8.5z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-4 3.1C3.3 21.4 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3l-4-3.1C.4 8.3 0 10.1 0 12s.4 3.7 1.2 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c2.2 0 3.7.9 4.5 1.7l3.4-3.3C17.9 1.2 15.2 0 12 0 7.3 0 3.3 2.6 1.2 6.6l4 3.1c1-2.9 3.7-4.9 6.8-4.9z" />
    </svg>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// `initialError` carries a message App.jsx pulled off the OAuth redirect —
// most often a cancelled Google consent screen, which otherwise dumped
// people back here with no explanation at all.
// `initialMode` lets App.jsx open a specific view — currently only used to
// land someone who clicked an expired password-reset link straight on the
// "Forgot password?" form, since the sign-in form is no use to them.
export default function Auth({ initialError = null, initialMode = null }) {
  const [mode, setMode] = useState(initialMode || 'signin') // 'signin' | 'join' | 'forgot'
  useEffect(() => { if (initialMode) setMode(initialMode) }, [initialMode])
  // Tracks Onboarding's active step so the Google button + divider only show
  // above Step 1 — offering it again mid-form, or on the confirm-email/
  // pending screens, doesn't make sense.
  const [joinStep, setJoinStep] = useState(1)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(initialError)
  useEffect(() => { if (initialError) setError(initialError) }, [initialError])

  // Set when a sign-in attempt fails with "Email not confirmed" — a
  // confirmation link expires (Supabase default is a few hours), and
  // someone who joined and comes back later than that has no memory of the
  // "check your email" screen's resend button, which only ever existed in
  // that screen's own local state. Without a resend option reachable from
  // the sign-in form itself, that's a dead end.
  const [signinUnconfirmed, setSigninUnconfirmed] = useState(false)
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMsg, setResendMsg] = useState(null)

  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0)
  const captchaVisible = mode === 'signin' || mode === 'forgot'

  function resetCaptcha() {
    setCaptchaToken(null)
    setCaptchaResetSignal((n) => n + 1)
  }

  function switchMode(next) {
    setMode(next)
    setError(null)
    setNotice(null)
    setSigninUnconfirmed(false)
    setResendMsg(null)
  }

  // Recovery route from Onboarding's "account already exists" case — carries
  // the email (and, if they're seconds away from having just chosen it, the
  // password) across so there's only one thing left to do.
  function goToSignIn(prefillEmail, prefillPassword) {
    setEmail((prefillEmail || '').trim())
    if (prefillPassword) setPassword(prefillPassword)
    switchMode('signin')
    setNotice('Your account is ready — sign in with the password you just chose.')
  }

  function validateSignin() {
    const cleanEmail = email.trim()
    if (!cleanEmail) return 'Enter your email address.'
    if (!EMAIL_RE.test(cleanEmail)) return 'Enter a valid email address.'
    if (mode === 'signin' && !password) return 'Enter your password.'
    if (TURNSTILE_SITE_KEY && !captchaToken) return 'Please complete the security check.'
    return null
  }

  async function handleSigninSubmit(e) {
    e.preventDefault()
    const problem = validateSignin()
    if (problem) { setError(problem); setNotice(null); return }
    const cleanEmail = email.trim()
    if (cleanEmail !== email) setEmail(cleanEmail)
    setBusy(true); setError(null); setNotice(null); setSigninUnconfirmed(false); setResendMsg(null)
    try {
      if (mode === 'forgot') {
        // Supabase emails a link that signs the browser into a recovery
        // session and fires PASSWORD_RECOVERY — App.jsx swaps in
        // ResetPassword.jsx on that event.
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: authRedirectTo(),
          captchaToken,
        })
        if (error) throw error
        setNotice("If that email's registered, a reset link is on its way — check your inbox.")
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password, options: { captchaToken } })
        if (error) throw error
      }
    } catch (e2) {
      setError(friendlyAuthError(e2))
      if (mode === 'signin' && /email not confirmed|email_not_confirmed/i.test(e2?.message || '')) {
        setSigninUnconfirmed(true)
      }
    } finally {
      setBusy(false)
      resetCaptcha()
    }
  }

  async function handleResend(targetEmail) {
    setResendBusy(true)
    setResendMsg(null)
    const result = await resendConfirmation({
      email: targetEmail,
      captchaToken,
      captchaRequired: !!TURNSTILE_SITE_KEY,
    })
    setResendBusy(false)
    resetCaptcha()
    setResendMsg({ type: result.ok ? 'ok' : 'error', text: result.message })
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">SACS Alumni</h1>
        <p className="auth-sub">Spectemur Agendo · Since 1829</p>

        {mode !== 'forgot' && (
          <div className="auth-tabs">
            <button
              type="button"
              aria-pressed={mode === 'signin'}
              className={mode === 'signin' ? 'auth-tab on' : 'auth-tab'}
              onClick={() => switchMode('signin')}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === 'join'}
              className={mode === 'join' ? 'auth-tab on' : 'auth-tab'}
              onClick={() => switchMode('join')}
            >
              Join
            </button>
          </div>
        )}

        {mode !== 'join' && (
          <form onSubmit={handleSigninSubmit} noValidate>
            {mode === 'signin' && (
              <>
                <SocialButtons prefix="Continue with" onError={setError} />
                <div className="auth-divider"><span>or continue with email</span></div>
              </>
            )}
            <label className="field">
              <span>Email</span>
              <ClearableInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onClear={() => setEmail('')}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>
            {mode === 'signin' && (
              <>
                <label className="field">
                  <span>Password</span>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    autoComplete="current-password"
                  />
                </label>
                <button
                  type="button"
                  className="link-btn auth-forgot-link"
                  onClick={() => switchMode('forgot')}
                >
                  Forgot password?
                </button>
              </>
            )}

            {captchaVisible && (
              <Turnstile onToken={setCaptchaToken} resetSignal={captchaResetSignal} />
            )}

            {error && <p className="form-error" role="alert">{error}</p>}
            {notice && <p className="form-notice" role="status">{notice}</p>}

            {signinUnconfirmed && (
              <>
                {resendMsg && (
                  <p className={resendMsg.type === 'ok' ? 'form-notice' : 'form-error'} role="status">
                    {resendMsg.text}
                  </p>
                )}
                <button
                  type="button"
                  className="btn ghost wide"
                  onClick={() => handleResend(email)}
                  disabled={resendBusy}
                >
                  {resendBusy ? 'Sending…' : 'Resend the confirmation email'}
                </button>
              </>
            )}

            <button type="submit" className="btn primary wide" disabled={busy}>
              {busy ? 'One moment…' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}
            </button>

            {/* An expired link comes back from Supabase as
                error_code=otp_expired whether it was a password-reset link or
                a signup-confirmation one — the two are indistinguishable, so
                this screen offers both remedies rather than assuming which
                link was clicked. */}
            {mode === 'forgot' && (
              <>
                <p className="hint" style={{ marginTop: 14 }}>
                  Never confirmed your email when you joined? A reset link won&rsquo;t
                  help with that — you need a fresh confirmation link instead.
                </p>
                {resendMsg && (
                  <p className={resendMsg.type === 'ok' ? 'form-notice' : 'form-error'} role="status">
                    {resendMsg.text}
                  </p>
                )}
                <button
                  type="button"
                  className="btn ghost wide"
                  onClick={() => handleResend(email)}
                  disabled={resendBusy || busy}
                >
                  {resendBusy ? 'Sending…' : 'Resend my confirmation email'}
                </button>
              </>
            )}
          </form>
        )}

        {mode === 'forgot' && (
          <button type="button" className="link-btn" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        )}

        {mode === 'join' && (
          <>
            {/* Offered before any field is filled in, not buried after —
                choosing Google mid-form used to throw away everything
                already typed, since OAuth navigates away entirely. Hidden
                again once Step 1 is behind them. */}
            {joinStep === 1 && (
              <>
                <SocialButtons prefix="Continue with" onError={setError} />
                <div className="auth-divider"><span>or continue with email</span></div>
              </>
            )}
            <Onboarding mode="new" onGoToSignIn={goToSignIn} onStepChange={setJoinStep} />
          </>
        )}

        {mode !== 'join' && (
          <p className="auth-note">
            New accounts are verified against SACS school records — you&rsquo;ll
            get an email as soon as you&rsquo;re confirmed.
          </p>
        )}
      </div>
    </div>
  )
}
