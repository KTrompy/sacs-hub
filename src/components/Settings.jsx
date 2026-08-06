import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, deleteOwnAccount, isNetworkError } from '../supabaseClient'
import ConfirmDialog from './ConfirmDialog.jsx'
import LoadingState from './LoadingState.jsx'
import PasswordInput from './PasswordInput.jsx'
import Turnstile, { TURNSTILE_SITE_KEY } from './Turnstile.jsx'
import { useToast } from './Toast.jsx'
import { PASSWORD_MIN, passwordProblem, PasswordStrengthMeter } from '../passwordRules.jsx'
import { friendlyAuthError } from '../authErrors.js'

const SETTINGS_TABS = [
  { id: 'account', label: 'Account' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy' },
]

// Real categories only — these are the notification types SACS Hub
// actually generates today (see the notify_* triggers in schema-update-9).
// No group-invite / business / admin-broadcast rows, because those
// features don't send notifications yet — adding them here would just be
// UI with nothing behind it.
const NOTIF_CATEGORIES = [
  { key: 'notify_message', label: 'Someone sends you a message' },
  { key: 'notify_post_activity', label: 'Someone likes or comments on your post' },
  { key: 'notify_event_rsvp', label: "Someone RSVPs to an event you created" },
  { key: 'notify_event_comment', label: 'Someone comments on an event you created' },
]

const PRIVACY_FIELDS = [
  { key: 'privacy_phone', label: 'Who can see your phone number?' },
  { key: 'privacy_email', label: 'Who can see your email address?' },
  { key: 'privacy_location', label: 'Who can see your location (city, country)?' },
  { key: 'privacy_messages', label: 'Who can send you messages?' },
]

const PRIVACY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'hide', label: 'Hide' },
]

export default function Settings({ session, profile, onSaved }) {
  const [tab, setTab] = useState('account')

  return (
    <section className="panel">
      <h2 className="panel-title">Settings</h2>

      <div className="settings-tabs" role="tablist">
        {SETTINGS_TABS.map((t) => (
          <button type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="settings-panel">
        {tab === 'account' && <AccountTab session={session} profile={profile} onSaved={onSaved} />}
        {tab === 'notifications' && <NotificationsTab session={session} />}
        {tab === 'privacy' && <PrivacyTab session={session} profile={profile} onSaved={onSaved} />}
      </div>
    </section>
  )
}

/* ---------- Account ---------- */
function AccountTab({ session, profile, onSaved }) {
  const showToast = useToast()
  const [language, setLanguage] = useState(profile?.language || 'en')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordMsg, setPasswordMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false)

  // Captcha token for the re-authentication in savePassword().
  //
  // This page had no captcha at all, and savePassword() re-authenticates by
  // calling signInWithPassword() — which GoTrue rejects outright when CAPTCHA
  // protection is enabled in the dashboard, because no token was attached.
  // The error handler below then maps every non-network failure to "Current
  // password is incorrect", so the result was that every member who tried to
  // change their password was told their correct password was wrong, with no
  // way to get past it and nothing in the logs to suggest why.
  //
  // Passing a token when captcha ISN'T enabled is harmless — GoTrue ignores
  // it — so this is safe either way, and stays correct if the dashboard
  // setting is ever turned on later.
  const [captchaToken, setCaptchaToken] = useState(null)
  // Bumped after each attempt: Turnstile tokens are single-use, so reusing one
  // fails exactly like a wrong password.
  const [captchaNonce, setCaptchaNonce] = useState(0)

  // Accounts created via Google (or any social provider) never get an
  // 'email' identity — there's no password to re-authenticate against, so
  // the "current password" flow below would just fail for them forever.
  // Show a plain set-password form instead: no current-password check
  // needed since they're already authenticated via their Google session.
  //
  // Checked against identities *and* app_metadata.providers, plus a
  // has_password flag we set ourselves. Identities alone was wrong:
  // updateUser({ password }) on a Google account adds a usable password but
  // does NOT add an 'email' identity to the session object, so hasPassword
  // stayed false permanently. Those accounts kept getting the no-re-auth
  // "set a password" form for the rest of time — meaning anyone on a
  // borrowed session could change the password without knowing the current
  // one, which is exactly what the re-auth below exists to prevent.
  //
  // The flag lives in user_metadata rather than component state. It used to
  // be a local `passwordJustSet` boolean, which fixed the bug only until the
  // next page load: reload and identities/providers still say Google-only,
  // the flag is back to false, and the unguarded form returns. user_metadata
  // rides along in the session, so it survives reloads and new devices.
  //
  // Worth being honest about what this is: a UI-level guard. user_metadata
  // is writable by the user, so someone determined could flip it back — but
  // anyone with a session can already call updateUser({ password }) directly
  // against the API, so the re-auth was never the real security boundary.
  // The server-side equivalent is Supabase's "require reauthentication for
  // password update" setting (Dashboard → Authentication → Sign In / Up),
  // which makes GoTrue itself demand a nonce. See AUTH_FLOW_AUDIT.
  const providers = session.user.app_metadata?.providers || []
  const hasPassword =
    session.user.user_metadata?.has_password === true ||
    (session.user.identities || []).some((i) => i.provider === 'email') ||
    providers.includes('email')

  async function saveLanguage(next) {
    const prev = language
    setLanguage(next)
    const { data, error } = await supabase.from('profiles').update({ language: next }).eq('id', session.user.id).select().single()
    if (error) {
      setLanguage(prev)
      showToast('Could not save language preference.', { type: 'error' })
      return
    }
    onSaved?.(data)
  }

  // The sign-in email is deliberately not editable here.
  //
  // It used to be: a plain input plus a Save button calling
  // updateUser({ email }), with no proof the person typing knew the
  // password. That's the cleanest account-takeover path in the whole app —
  // borrow an unlocked, already-signed-in device, change the address to one
  // you control, sign out, run "forgot password", and the account is yours
  // while the real owner is locked out of an address they no longer own.
  //
  // Requiring the current password would have closed that, but SACS Hub
  // has a second reason to hold the address still: members are vetted and
  // approved by an admin against the address they registered with (see
  // schema-update-45/46 and the approval gate in Admin.jsx). Letting the
  // sign-in address drift afterwards decouples the approved identity from
  // the one an admin actually checked. So the address is now shown
  // read-only, and changing it is an admin/support action.

  async function savePassword() {
    setPasswordMsg(null)
    if (!currentPassword) { setPasswordMsg('Enter your current password.'); return }
    const pwProblem = passwordProblem(password, { emptyMessage: 'Choose a new password.' })
    if (pwProblem) { setPasswordMsg(pwProblem); return }
    if (password !== passwordConfirm) { setPasswordMsg('Passwords don’t match.'); return }
    // Supabase rejects this server-side only when "prevent password reuse"
    // is switched on in the dashboard, which it isn't here — so without this
    // check "Change password" can report a cheerful "Password updated." for
    // an operation that changed nothing at all.
    if (password === currentPassword) {
      setPasswordMsg('That’s already your current password — pick a different one.')
      return
    }
    // Only enforced when a site key is configured — locally, where there's no
    // key, there's no widget to complete and this correctly does nothing.
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setPasswordMsg('Please complete the security check below first.')
      return
    }
    setBusy(true)

    // Two independent checks of the current password, deliberately.
    //
    // updateUser() on its own will happily change the password for whoever
    // is holding the current (still-valid) session, with no proof they know
    // the existing one — anyone with a few minutes on an unlocked,
    // already-signed-in device could lock the real owner out.
    //
    // 1. signInWithPassword re-checks the password against Supabase before
    //    anything changes. This is a *client-side* guard: it stops the
    //    borrowed-device case, but someone with the session token could skip
    //    this screen entirely and call the API directly.
    // 2. current_password below is the same check enforced by GoTrue itself,
    //    controlled by "Require current password when changing password"
    //    (Dashboard → Authentication → Sign In / Providers → Email). That one
    //    can't be bypassed.
    //
    // Both, rather than only (2), because (2) is a dashboard toggle rather
    // than anything in this repo — if it's ever switched off, GoTrue silently
    // *ignores* current_password and the update succeeds unverified, with no
    // error for this code to notice. (1) means the guard degrades to
    // "client-side only" instead of to nothing at all.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword,
      options: { captchaToken },
    })
    // Single-use — spent whether the call succeeded or failed.
    setCaptchaToken(null)
    setCaptchaNonce((n) => n + 1)
    if (reauthError) {
      setBusy(false)
      // "Current password is incorrect" was reported for *every* failure
      // here, including the offline/DNS/CORS case where the request never
      // reached Supabase at all — telling someone their correct password is
      // wrong, which is how people end up resetting a password that was
      // fine. isNetworkError separates "no response" from "server said no".
      // "Current password is incorrect" must NOT be the catch-all here. It was,
      // and it meant any failure that wasn't a network error — a spent or
      // missing captcha token, a rate limit — was reported as a wrong password,
      // which is how people end up resetting a password that was fine all
      // along. Each of those now says what actually happened.
      setPasswordMsg(
        isNetworkError(reauthError)
          ? "Couldn't reach the server — check your connection and try again."
          : /captcha/i.test(reauthError.message || '')
            ? 'The security check didn’t go through — please tick it again and retry.'
            : /invalid login credentials|invalid_credentials/i.test(reauthError.message || '')
              ? 'Current password is incorrect.'
              : friendlyAuthError(reauthError)
      )
      return
    }

    const { error } = await supabase.auth.updateUser({
      current_password: currentPassword,
      password,
    })
    setBusy(false)
    if (error) {
      // Reaching here after (1) already passed means GoTrue rejected the
      // current password that Supabase had just accepted a moment earlier —
      // which isn't a "you typed it wrong", it's the two disagreeing. Raw
      // error.message would tell the member to check a password that is
      // demonstrably correct, so say something they can act on instead.
      if (/current password/i.test(error.message || '')) {
        setPasswordMsg("Couldn't verify your current password just now — try again in a moment.")
        return
      }
      setPasswordMsg(friendlyAuthError(error))
      return
    }
    setCurrentPassword('')
    setPassword('')
    setPasswordConfirm('')
    setPasswordMsg('Password updated.')
  }

  // For accounts with no password identity yet (Google-only). No
  // current-password re-auth is possible or needed here — there is no old
  // password, and they're already proven to be the account owner by
  // holding a valid session. This also gives them an email/password
  // fallback if Google access is ever lost.
  async function setNewPassword() {
    setPasswordMsg(null)
    const pwProblem = passwordProblem(password)
    if (pwProblem) { setPasswordMsg(pwProblem); return }
    if (password !== passwordConfirm) { setPasswordMsg('Passwords don’t match.'); return }
    setBusy(true)
    // The has_password flag is written in the *same* call as the password
    // itself, so the two can't get out of step — a separate follow-up
    // updateUser() could fail on its own and leave an account that has a
    // password but still shows the unguarded set-password form.
    const { error } = await supabase.auth.updateUser({
      password,
      data: { has_password: true },
    })
    setBusy(false)
    if (error) {
      // No current_password is sent here because there isn't one — this
      // account has never had a password. GoTrue's "require current password"
      // setting is expected to skip accounts with no existing password for
      // exactly that reason, but it's a dashboard toggle we don't control, so
      // don't let a Google member hit a bare "current password is required"
      // with no way to act on it.
      if (/current password/i.test(error.message || '')) {
        setPasswordMsg("Your account doesn't have a password to verify against, and the server asked for one. Let an admin know — this needs a settings change, not something you can fix here.")
        return
      }
      setPasswordMsg(friendlyAuthError(error))
      return
    }
    setPassword('')
    setPasswordConfirm('')
    // No local flag to flip: updateUser fires USER_UPDATED, App.jsx's
    // onAuthStateChange puts the new session (carrying has_password) into
    // state, and this component re-renders with hasPassword true. That's
    // what makes it survive a reload — see the hasPassword comment above.
    setPasswordMsg('Password set. You can now sign in with your email and this password, as well as Google.')
  }

  // Revokes every refresh token for this user, on every device, not just this
  // browser's session. The standard companion to a password change: changing
  // your password does NOT by itself sign out a session someone else already
  // has open, so without this there was no way for a member to boot a borrowed
  // or stolen session — the exact scenario the re-auth above exists to guard.
  async function signOutEverywhere() {
    setSigningOutEverywhere(true)
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      setSigningOutEverywhere(false)
      showToast(friendlyAuthError(error, "Couldn't sign out everywhere — try again."), { type: 'error' })
      return
    }
    // No local cleanup needed: signOut fires SIGNED_OUT, App.jsx's listener
    // drops the session, and this component unmounts with it.
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    // Was calling the delete_own_account() DB RPC, which schema-update-3.sql
    // documents as SUPERSEDED: hosted Supabase silently no-ops a plain SQL
    // DELETE against auth.users even from a SECURITY DEFINER function, so
    // this returned success without actually deleting the account. Now
    // uses the same Edge-Function-backed helper Profile.jsx uses — see
    // deleteOwnAccount() in supabaseClient.js.
    const { error } = await deleteOwnAccount()
    if (error) {
      setDeleteError(error.message)
      setDeleting(false)
      return
    }
    await supabase.auth.signOut()
    // Without this, the app was left rendering a signed-out user's stale
    // state — same reload Profile.jsx's delete flow already does.
    window.location.reload()
  }

  return (
    <div className="settings-section-group">
      <div className="settings-section">
        <h3>Language</h3>
        <label className="field settings-field">
          <select value={language} onChange={(e) => saveLanguage(e.target.value)}>
            <option value="en">English (UK)</option>
            <option value="af">Afrikaans</option>
          </select>
        </label>
        <p className="hint">More languages, and full translation of the site, are on the way — this just saves your preference for now.</p>
      </div>

      <div className="settings-section">
        <h3>Login options</h3>

        <label className="field settings-field"><span>Email</span>
          <input
            type="email"
            value={session.user.email || ''}
            readOnly
            disabled
            title="Your registered address can only be changed by an admin"
          />
        </label>
        <p className="hint">
          This is the address you registered with and the one your membership
          was approved against, so it can&rsquo;t be changed here. Email an
          admin if you need it moved to a different address.
        </p>

        <div className="settings-divider" />

        {/* A real <form> — Enter in any of these fields now submits, and
            password managers get a proper current/new grouping to offer a
            save against. This was three loose inputs and an onClick button,
            which is exactly the shape browsers are worst at helping with. */}
        {hasPassword ? (
          <form
            className="settings-password-form"
            onSubmit={(e) => { e.preventDefault(); if (!busy) savePassword() }}
            noValidate
          >
            <label className="field settings-field"><span>Current password</span>
              <PasswordInput value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <label className="field settings-field"><span>New password</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${PASSWORD_MIN} characters`} autoComplete="new-password" />
            </label>
            <PasswordStrengthMeter password={password} />
            <label className="field settings-field"><span>Confirm new password</span>
              <PasswordInput value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" />
            </label>
            {/* Required because changing a password re-authenticates first, and
                that call is subject to the same CAPTCHA rule as the sign-in
                form. Without a widget here there was no way to produce a token
                and the re-auth could never succeed. */}
            <Turnstile
              onToken={setCaptchaToken}
              resetSignal={captchaNonce}
              className="auth-captcha settings-captcha"
            />
            {/* passwordConfirm belongs in this check too — leaving it out let
                the button look ready while the form still failed validation. */}
            <button
              type="submit"
              className="btn ghost"
              disabled={busy || !password || !passwordConfirm || !currentPassword}
              title={
                busy ? 'Saving…'
                  : !currentPassword ? 'Enter your current password first'
                  : !password ? 'Choose a new password'
                  : !passwordConfirm ? 'Confirm your new password'
                  : undefined
              }
            >
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </form>
        ) : (
          <form
            className="settings-password-form"
            onSubmit={(e) => { e.preventDefault(); if (!busy) setNewPassword() }}
            noValidate
          >
            <p className="hint">
              You signed up with Google and don&rsquo;t have a password yet.
              Set one to also be able to sign in with your email address.
            </p>
            <label className="field settings-field"><span>New password</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${PASSWORD_MIN} characters`} autoComplete="new-password" />
            </label>
            <PasswordStrengthMeter password={password} />
            <label className="field settings-field"><span>Confirm new password</span>
              <PasswordInput value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} autoComplete="new-password" />
            </label>
            {/* No captcha here: this path calls updateUser() on an existing
                session and never re-authenticates, so there's no sign-in
                request for GoTrue to challenge. */}
            <button
              type="submit"
              className="btn ghost"
              disabled={busy || !password || !passwordConfirm}
              title={
                busy ? 'Saving…'
                  : !password ? 'Choose a password'
                  : !passwordConfirm ? 'Confirm your password'
                  : undefined
              }
            >
              {busy ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )}
        {passwordMsg && <p className="hint" role="status">{passwordMsg}</p>}

        <div className="settings-divider" />

        <p className="hint">
          Signed in somewhere you shouldn&rsquo;t be &mdash; a shared computer, an
          old phone? This signs you out of every device, including this one.
          Changing your password on its own doesn&rsquo;t do that.
        </p>
        <button type="button" className="btn ghost" onClick={signOutEverywhere} disabled={signingOutEverywhere}>
          {signingOutEverywhere ? 'Signing out…' : 'Sign out of all devices'}
        </button>
      </div>

      <div className="settings-section settings-danger">
        <h3>Delete account</h3>
        <p className="hint">Permanently deletes your account, profile, posts, photos, messages and mentoring data. This can't be undone.</p>
        <button type="button" className="btn danger" onClick={() => setConfirmingDelete(true)}>Delete account</button>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete your account?"
          message={deleteError || "This permanently deletes your SACS Hub account and everything in it — there's no undo."}
          confirmLabel={deleting ? 'Deleting…' : 'Delete permanently'}
          onConfirm={deleteAccount}
          onCancel={() => { setConfirmingDelete(false); setDeleteError(null) }}
        />
      )}
    </div>
  )
}

/* ---------- Notifications ---------- */
function NotificationsTab({ session }) {
  const showToast = useToast()
  const [prefs, setPrefs] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setPrefs(data || { notify_message: true, notify_post_activity: true, notify_event_rsvp: true, notify_event_comment: true })
        setLoading(false)
      })
  }, [session.user.id])

  async function toggle(key) {
    const prev = prefs
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    // Upsert the whole row, not just the one changed column. When a
    // preferences row doesn't exist yet, upserting a single column creates
    // a row where every *other* preference falls back to whatever the
    // table's column defaults are — which may not match the "all on"
    // defaults this UI assumes, silently flipping toggles the person never
    // touched.
    const { error } = await supabase.from('notification_preferences').upsert({ user_id: session.user.id, ...next })
    if (error) {
      setPrefs(prev)
      showToast('Could not save notification preference.', { type: 'error' })
    }
  }

  if (loading) return <LoadingState message="Loading your notification settings…" />

  return (
    <div className="settings-section">
      <h3>Personal activity</h3>
      <p className="hint">Email and mobile push notifications aren't available yet — Platform (in-app, via the bell icon) is live today.</p>

      <div className="notif-prefs-table">
        <div className="notif-prefs-row notif-prefs-head">
          <span />
          <span>Email</span>
          <span>Mobile</span>
          <span>Platform</span>
        </div>
        {NOTIF_CATEGORIES.map((c) => (
          <div key={c.key} className="notif-prefs-row">
            <span className="notif-prefs-label">{c.label}</span>
            <Toggle checked={false} disabled />
            <Toggle checked={false} disabled />
            <Toggle checked={!!prefs[c.key]} onChange={() => toggle(c.key)} />
          </div>
        ))}
      </div>
    </div>
  )
}

// `disabled` here only ever means "a save for this toggle is in flight",
// so say that rather than leaving a greyed-out switch with no explanation.
function Toggle({ checked, onChange, disabled, disabledReason = 'Saving…' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      className={checked ? 'settings-toggle on' : 'settings-toggle'}
      onClick={onChange}
    >
      <span className="settings-toggle-knob" />
    </button>
  )
}

/* ---------- Privacy ---------- */
function PrivacyTab({ session, profile, onSaved }) {
  const showToast = useToast()

  async function setValue(key, value) {
    const { data, error } = await supabase.from('profiles').update({ [key]: value }).eq('id', session.user.id).select().single()
    if (error) {
      showToast('Could not save privacy setting.', { type: 'error' })
      return
    }
    onSaved?.(data)
  }

  return (
    <div className="settings-section">
      <h3>General</h3>

      <div className="privacy-table">
        <div className="privacy-row privacy-row-head">
          <span />
          {PRIVACY_OPTIONS.map((o) => <span key={o.value}>{o.label}</span>)}
        </div>
        {PRIVACY_FIELDS.map((f) => (
          <div key={f.key} className="privacy-row">
            <span className="privacy-row-label">{f.label}</span>
            {PRIVACY_OPTIONS.map((o) => (
              <label key={o.value} className="privacy-radio">
                <input
                  type="radio"
                  name={f.key}
                  checked={profile?.[f.key] === o.value}
                  onChange={() => setValue(f.key, o.value)}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <p className="hint">
        See our <Link to="/privacy">Privacy Policy</Link> for what we collect and why.
      </p>
    </div>
  )
}
