import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

// Full-screen gate shown to signed-in members who haven't been approved
// yet — the app itself stays locked until the alumni committee verifies
// them against SACS school records (Admin → Pending approval).
// A confirmation email on approval is planned once an email provider
// (e.g. Resend) is wired up — see Admin.jsx's setApproved.
export default function PendingVerification({ session, profile, onProfileChange }) {
  const email = session.user.email
  const name = (profile?.full_name || '').split(' ')[0]
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null) // { type: 'pending' | 'error' | 'removed', text }

  // "Check my status" used to be a bare window.location.reload(), which
  // looked broken: the page flashed and landed on this same screen with no
  // word either way. Now it actually re-reads the approval flag and says
  // what it found — and on approval hands the fresh row up to App.jsx,
  // which swaps this gate out for the real app without a reload.
  async function checkStatus() {
    setChecking(true)
    setResult(null)
    // Same auth-not-settled race guarded against in App.jsx's profile
    // load — wait for the client to have its auth header attached before
    // querying, or RLS silently matches nothing.
    await supabase.auth.getSession()
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
    setChecking(false)

    if (error) {
      setResult({ type: 'error', text: "Couldn't reach the server just now — try again in a moment." })
      return
    }
    if (!data) {
      // Profile row is gone: an admin removed the account while they were
      // sitting on this screen. Nothing to come back to, so sign them out —
      // but say why first, and give them a beat to read it. Silently
      // bouncing to the sign-in page read as a random bug rather than "your
      // account was removed".
      setResult({ type: 'removed', text: 'This account is no longer registered — it looks like it was removed by an administrator. Signing you out. If you think that’s a mistake, get in touch using the link below.' })
      setTimeout(() => { supabase.auth.signOut() }, 6000)
      return
    }
    if (data.approved) {
      onProfileChange?.(data)
      return
    }
    setResult({ type: 'pending', text: 'Not verified yet — the committee still has your details to review. We’ll email you the moment it’s done.' })
  }

  // Quiet background poll, on top of the manual button.
  //
  // The approval email says "you can sign in now", and the overwhelmingly
  // common thing to do is click through to a tab that's already sitting on
  // this screen — which then keeps saying "pending" until you notice the
  // button. Checking every 60 seconds means the gate usually lifts on its own
  // while they're reading it.
  //
  // Deliberately silent: it only ever acts on success (handing the fresh row
  // up to App.jsx, which swaps this screen out). A failed poll writes nothing,
  // so a brief network blip can't replace the explanatory text on screen with
  // an error the person didn't ask for. The button stays as the manual
  // override, and is the only path that reports failures.
  const onProfileChangeRef = useRef(onProfileChange)
  onProfileChangeRef.current = onProfileChange
  useEffect(() => {
    let cancelled = false
    const interval = setInterval(async () => {
      // Don't race the manual check, and don't poll a backgrounded tab.
      if (document.visibilityState !== 'visible') return
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle()
      if (cancelled) return
      if (data?.approved) onProfileChangeRef.current?.(data)
    }, 60 * 1000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [session.user.id])

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <div className="pending-verify-icon" aria-hidden="true">⏳</div>
        <h1 className="auth-title">{name ? `Thanks, ${name}!` : 'Thanks for joining!'}</h1>
        <p className="auth-verify-note">
          Your details are being verified against SACS school records by
          the alumni committee. You&rsquo;ll receive an email at{' '}
          <strong>{email}</strong> as soon as you&rsquo;re confirmed — then you
          can sign in and meet everyone.
        </p>
        {result && (
          <p className={result.type === 'pending' ? 'auth-verify-status' : 'form-error'} role="status">
            {result.text}
          </p>
        )}
        <button type="button" className="btn primary wide" onClick={checkStatus} disabled={checking || result?.type === 'removed'}>
          {checking ? 'Checking…' : 'Check my status'}
        </button>
        {/* The profile editor sits behind the approval gate, so until the
            committee verifies them there is no way for someone to correct
            a misspelt surname or the wrong years — the very details being
            checked against school records. This at least gives them a
            route to say so, with the account's email already in the
            subject line so it can be matched up. */}
        <p className="auth-verify-contact">
          Spotted a mistake in your details, or been waiting a while?{' '}
          <a
            className="footer-link"
            href={`mailto:kyletrompeter0@gmail.com?subject=${encodeURIComponent('SACS Alumni — my signup details')}&body=${encodeURIComponent(`Hi,\n\nI signed up for SACS Alumni with ${email} and wanted to check on / correct my details:\n\n`)}`}
          >
            Get in touch
          </a>{' '}
          and we&rsquo;ll sort it out.
        </p>
        <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
