import { useState } from 'react'
import Turnstile, { TURNSTILE_SITE_KEY } from '../Turnstile.jsx'
import { resendConfirmation } from './onboardingSubmit.js'

// "Check your email" — shown after a mode="new" signup when "Confirm
// email" is on in the project and there's no session yet. Covers every
// edge case from the old Auth.jsx signupDone==='confirm' branch: resend,
// its own captcha, and a spam-folder reminder. Expired/already-used link
// handling lives on the sign-in/forgot-password screen (Auth.jsx), which is
// where Supabase actually bounces someone back to — this screen only
// covers the moment right after signing up.
export default function EmailConfirmation({ email, greetingName, onBackToSignIn }) {
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0)
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMsg, setResendMsg] = useState(null)

  async function handleResend() {
    setResendBusy(true)
    setResendMsg(null)
    const result = await resendConfirmation({
      email,
      captchaToken,
      captchaRequired: !!TURNSTILE_SITE_KEY,
    })
    setResendBusy(false)
    setCaptchaResetSignal((n) => n + 1)
    setResendMsg({ type: result.ok ? 'ok' : 'error', text: result.message })
  }

  return (
    <div className="acct-onb-step">
      <h2 className="auth-step-heading">Check your email</h2>
      <p className="auth-step-sub">Thanks for joining{greetingName ? `, ${greetingName}` : ''}!</p>

      <p className="auth-verify-note">
        We&rsquo;ve sent a confirmation link to <strong>{email}</strong>.
        Click it to confirm your account.
      </p>
      <p className="hint" style={{ textAlign: 'center' }}>
        No email after a few minutes? Check your spam or junk folder first —
        it&rsquo;s almost always there.
      </p>

      <Turnstile
        onToken={setCaptchaToken}
        resetSignal={captchaResetSignal}
        className="auth-captcha acct-onb-captcha"
      />

      {resendMsg && (
        <p className={resendMsg.type === 'ok' ? 'form-notice' : 'form-error'} role="status">
          {resendMsg.text}
        </p>
      )}
      <button type="button" className="btn ghost wide" onClick={handleResend} disabled={resendBusy}>
        {resendBusy ? 'Sending…' : 'Resend confirmation email'}
      </button>

      <button type="button" className="link-btn" onClick={onBackToSignIn}>
        Back to sign in
      </button>
    </div>
  )
}
