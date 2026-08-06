import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
import ClearableInput from './ClearableInput.jsx'
import PasswordInput from './PasswordInput.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import CityAutocomplete from './CityAutocomplete.jsx'
import { PASSWORD_MIN, passwordProblem, PasswordStrengthMeter } from '../passwordRules.jsx'
import { authRedirectTo } from '../authRedirect.js'
import { friendlyAuthError } from '../authErrors.js'
import { MAX_SCHOOL_YEARS } from '../constants.js'
import { PrivacyPolicyModal } from './PrivacyPolicy.jsx'

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY

// SACS was founded in 1829 — nobody can have started before that.
const FOUNDING_YEAR = 1829
const THIS_YEAR = new Date().getFullYear()
// Start years run 1961..now; end years allow a few years into the future so
// current residents can pick their expected final year.
const START_YEARS = []
for (let y = THIS_YEAR; y >= FOUNDING_YEAR; y--) START_YEARS.push(y)
const END_YEARS = []
for (let y = THIS_YEAR + 7; y >= FOUNDING_YEAR; y--) END_YEARS.push(y)

// Google only — Facebook/LinkedIn were dropped (each needs its own dev-app
// + review process for little extra coverage). Configured in the Supabase
// dashboard: Authentication → Providers → Google.
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google' },
]

// passwordStrength moved to ../passwordRules.jsx so ResetPassword.jsx and
// Settings.jsx can share it — see the note there about the three screens
// having drifted to different minimums.

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

// Draft persistence for the three-step signup wizard.
//
// `signupStep` is React state and nothing else — no URL, no history entry — so
// a back-gesture on step 2 or 3 (the single most common thing a thumb does on
// a phone) left the site entirely and threw away everything typed: name,
// email, both year dropdowns and the whole address block. A refresh or an
// accidental tab close did the same. FinishSignup.jsx already solved exactly
// this for its own form and explains why; the wizard, which is far higher
// traffic, never got the same treatment.
//
// Deliberately NOT saved:
//   • both passwords — never write a password to localStorage, and a restored
//     draft therefore always reopens at step 1 so they're retyped knowingly.
//   • the data-consent tick — an affirmation somebody has to make on purpose,
//     not something to restore on their behalf.
const SIGNUP_DRAFT_KEY = 'sacs-signup-draft'
const SIGNUP_DRAFT_FIELDS = [
  'firstName', 'preferredName', 'lastName', 'signupEmail', 'confirmEmail',
  'startYear', 'endYear', 'newsOptIn',
  'address1', 'address2', 'address3', 'province', 'city', 'postCode', 'country',
]
// Same week-long window FinishSignup uses: comfortably longer than "I'll
// finish this tonight", short enough that a half-typed home address isn't
// sitting on a shared computer indefinitely.
const SIGNUP_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function readSignupDraft() {
  try {
    const raw = localStorage.getItem(SIGNUP_DRAFT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > SIGNUP_DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(SIGNUP_DRAFT_KEY)
      return {}
    }
    const values = parsed.values
    if (!values || typeof values !== 'object') return {}
    // Coerce back to the types the form expects rather than trusting whatever
    // is in storage. `??` only guards null/undefined, so a value that had
    // become a number or an object (hand-edited storage, or a draft written by
    // an older build with different fields) would sail through into state and
    // then throw on `.trim()` at submit — and because the draft is re-read on
    // every load, that crash would be permanent and unfixable from the UI.
    const clean = {}
    for (const key of SIGNUP_DRAFT_FIELDS) {
      const v = values[key]
      if (v === null || v === undefined) continue
      // newsOptIn is a tri-state boolean; everything else is a string.
      clean[key] = key === 'newsOptIn' ? (typeof v === 'boolean' ? v : null) : String(v)
    }
    return clean
  } catch {
    return {}
  }
}

function clearSignupDraft() {
  try { localStorage.removeItem(SIGNUP_DRAFT_KEY) } catch { /* private mode */ }
}

// `initialError` carries a message App.jsx pulled off the OAuth redirect —
// most often a cancelled Google consent screen, which otherwise dumped
// people back here with no explanation at all.
// `initialMode` lets App.jsx open a specific view — currently only used to
// land someone who clicked an expired password-reset link straight on the
// "Forgot password?" form, since the sign-in form is no use to them.
export default function Auth({ initialError = null, initialMode = null }) {
  const [mode, setMode] = useState(initialMode || 'signin') // 'signin' | 'signup' | 'forgot'
  // Same reason the initialError effect below exists: App.jsx resolves this in
  // an effect, which can land after this component has already mounted.
  useEffect(() => { if (initialMode) setMode(initialMode) }, [initialMode])
  const [signupStep, setSignupStep] = useState(1) // 1 details, 2 years, 3 consent

  // Sign-in fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Signup fields. Seeded from a saved draft where there is one — see
  // readSignupDraft above for what is and isn't kept.
  const [draft] = useState(readSignupDraft)
  // A form that silently fills itself in is unsettling — say where it came
  // from, and offer a way to bin it rather than making someone clear fifteen
  // fields by hand. Stays up for the whole wizard: it's also where the
  // "you'll need to pick your password again" warning lives, and that's true
  // right up until they submit.
  const [draftRestored, setDraftRestored] = useState(() => Object.keys(readSignupDraft()).length > 0)
  const [firstName, setFirstName] = useState(draft.firstName ?? '')
  const [preferredName, setPreferredName] = useState(draft.preferredName ?? '')
  const [lastName, setLastName] = useState(draft.lastName ?? '')
  const [signupEmail, setSignupEmail] = useState(draft.signupEmail ?? '')
  const [confirmEmail, setConfirmEmail] = useState(draft.confirmEmail ?? '')
  const [signupPassword, setSignupPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [startYear, setStartYear] = useState(draft.startYear ?? '')
  const [endYear, setEndYear] = useState(draft.endYear ?? '')
  const [address1, setAddress1] = useState(draft.address1 ?? '')
  const [address2, setAddress2] = useState(draft.address2 ?? '')
  const [address3, setAddress3] = useState(draft.address3 ?? '')
  const [province, setProvince] = useState(draft.province ?? '')
  const [city, setCity] = useState(draft.city ?? '')
  // Coordinates captured when a City suggestion is picked (see
  // CityAutocomplete) — saved alongside the profile so the new member shows
  // up on the alumni map immediately.
  // Not drafted: coordinates are only trustworthy alongside the exact city
  // label they came from, so a restored draft re-picks rather than reusing a
  // stale pin. Same reasoning as FinishSignup.
  const [cityCoords, setCityCoords] = useState(null)
  const [postCode, setPostCode] = useState(draft.postCode ?? '')
  const [country, setCountry] = useState(draft.country ?? 'South Africa')
  const [newsOptIn, setNewsOptIn] = useState(draft.newsOptIn ?? null) // null until they choose
  const [dataConsent, setDataConsent] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  // 'confirm'  — account created, Supabase has emailed a confirmation link and
  //              they must click it before they can sign in ("Confirm email" is
  //              on in the dashboard).
  // 'pending'  — account created and already signed in; nothing to click. The
  //              auth listener in App.jsx normally swaps this screen out for
  //              PendingVerification before it's even seen.
  const [signupDone, setSignupDone] = useState(null) // null | 'confirm' | 'pending'
  // Resend state for the confirmation email. Shared between the 'confirm'
  // screen (right after signup) and the sign-in form (someone returning
  // later to a link that's since expired — see signinUnconfirmed below).
  const [resendBusy, setResendBusy] = useState(false)
  const [resendMsg, setResendMsg] = useState(null)
  // Set when a sign-in attempt fails with "Email not confirmed". Confirmation
  // links expire (Supabase default is a few hours), and someone who signed up
  // and comes back later than that lands here with no session and no memory
  // of the 'confirm' screen's resend button — which only ever existed in this
  // component's local state, gone the moment they closed the tab. Without a
  // resend option reachable from the sign-in form itself, that's a dead end:
  // the account can never be confirmed and they can never sign in.
  const [signinUnconfirmed, setSigninUnconfirmed] = useState(false)
  // Set when signUp succeeded but the follow-up sign-in didn't: the account
  // exists, so the only useful next step is signing in, not signing up
  // again. Drives the "Go to sign in" button under the error.
  const [accountExists, setAccountExists] = useState(false)

  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(initialError)
  // App.jsx reads the OAuth redirect error in an effect, which can resolve
  // after this component has already mounted — so the useState initialiser
  // above isn't enough on its own to catch it.
  useEffect(() => { if (initialError) setError(initialError) }, [initialError])

  // Cloudflare Turnstile (CAPTCHA). Rendered manually via the global
  // `window.turnstile` API (loaded in index.html). One token is required per
  // Supabase auth call. The widget container mounts/unmounts as the user
  // moves between sign-in / signup steps, so the render effect keys on
  // (mode, signupStep) — the old version only ran on mount, which is exactly
  // why the checkbox sometimes never appeared after switching views.
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaError, setCaptchaError] = useState(false)
  const turnstileRef = useRef(null)
  const widgetIdRef = useRef(null)

  // Whether the current view actually shows the captcha: sign-in, forgot, the
  // final signup (consent) step — and the "check your email" screen, which
  // needs one of its own for the resend below. That last case used to be
  // excluded (`!signupDone`), which is half of why the resend button never
  // worked: GoTrue validates a captcha token on /resend exactly like it does
  // on /signup, and there was no widget on that screen to produce one.
  const captchaVisible = !!TURNSTILE_SITE_KEY && (
    signupDone
      ? signupDone === 'confirm'
      : (mode !== 'signup' || signupStep === 3)
  )

  useEffect(() => {
    if (!captchaVisible || !turnstileRef.current) return

    let cancelled = false
    let pollAttempts = 0
    let interval = null
    const MAX_POLL_ATTEMPTS = 100 // 100 * 150ms = 15s before giving up

    // ONE teardown for both paths below.
    //
    // There used to be two, and the polling branch's version only cleared the
    // interval — it neither removed the widget nor cleared the token. That's
    // the branch taken on any cold load, because index.html loads Turnstile's
    // api.js async/defer, so window.turnstile usually isn't there yet when
    // this first runs. Result: solve the captcha on the sign-in form, switch
    // to Join, and the already-spent token was still sitting in state.
    // validateStep3 saw a token and let the submit through, GoTrue rejected it
    // for the captcha, and the person got "the security check didn't go
    // through" while looking at a ticked box.
    function teardown() {
      cancelled = true
      if (interval) clearInterval(interval)
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
      }
      widgetIdRef.current = null
      setCaptchaToken(null)
    }

    function renderWidget() {
      if (cancelled || !window.turnstile || !turnstileRef.current) return
      // Clear any widget id left over from a previous render pass (StrictMode
      // replays, or the container re-mounting on a mode/step change) so
      // turnstile.render isn't silently skipped.
      if (widgetIdRef.current) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
        widgetIdRef.current = null
      }
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => { setCaptchaToken(token); setCaptchaError(false) },
        'expired-callback': () => setCaptchaToken(null),
        'error-callback': () => { setCaptchaToken(null); setCaptchaError(true) },
      })
      setCaptchaError(false)
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      // api.js loads async/defer in index.html — poll briefly until it's
      // ready. If it never shows up (ad/privacy blocker, or a network hiccup
      // on challenges.cloudflare.com) give up after ~15s and surface that,
      // rather than leaving a blank box that silently blocks submission.
      interval = setInterval(() => {
        pollAttempts += 1
        if (window.turnstile) {
          clearInterval(interval)
          interval = null
          renderWidget()
        } else if (pollAttempts >= MAX_POLL_ATTEMPTS) {
          clearInterval(interval)
          interval = null
          setCaptchaError(true)
        }
      }, 150)
    }

    return teardown
  }, [captchaVisible, mode, signupStep, signupDone])

  function resetCaptcha() {
    setCaptchaToken(null)
    if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current)
  }

  /* ---------- Signup draft ---------- */

  const draftValues = {
    firstName, preferredName, lastName, signupEmail, confirmEmail,
    startYear, endYear, newsOptIn,
    address1, address2, address3, province, city, postCode, country,
  }
  // Only writes once there's actually something worth restoring, so merely
  // opening the Join tab and wandering off doesn't leave a file behind.
  const draftHasContent = SIGNUP_DRAFT_FIELDS.some((k) => {
    const v = draftValues[k]
    return v !== '' && v !== null && v !== undefined && !(k === 'country' && v === 'South Africa')
  })
  useEffect(() => {
    if (mode !== 'signup' || signupDone) return
    if (!draftHasContent) return
    try {
      localStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        values: Object.fromEntries(SIGNUP_DRAFT_FIELDS.map((k) => [k, draftValues[k]])),
      }))
    } catch { /* private mode / quota — the form still works, just not resumable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, signupDone, draftHasContent, ...SIGNUP_DRAFT_FIELDS.map((k) => draftValues[k])])

  // Second line of defence for the case the draft can't cover: the passwords,
  // which are never written to storage. Closing the tab or navigating away
  // mid-wizard now asks first, instead of silently binning the form.
  useEffect(() => {
    if (mode !== 'signup' || signupDone) return undefined
    if (!draftHasContent && !signupPassword) return undefined
    function handler(e) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [mode, signupDone, draftHasContent, signupPassword])

  function switchMode(next) {
    setMode(next)
    setSignupStep(1)
    setError(null)
    setNotice(null)
    setAccountExists(false)
    setSigninUnconfirmed(false)
    setResendMsg(null)
  }

  // "Your account exists — go sign in" recovery. Carries the email across
  // so they only have to type the password.
  function goToSignIn() {
    setEmail(signupEmail.trim())
    // Carry the password across too. They chose it thirty seconds ago and it's
    // still in state — making them retype it (and risk a typo) to recover from
    // a failure that wasn't theirs is a pointless last hurdle.
    if (signupPassword) setPassword(signupPassword)
    switchMode('signin')
    setNotice('Your account is ready — sign in with the password you just chose.')
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  /* ---------- Sign in / forgot ---------- */

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
    // validateSignin() has always checked `email.trim()`, but the auth calls
    // below used to send the raw value — so a pasted address with a trailing
    // space passed validation and then failed with "invalid login
    // credentials", which reads as a wrong password. Normalise once here and
    // write it back so the field shows what was actually submitted.
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
      // friendlyAuthError rewrites the handful of GoTrue strings members
      // actually hit ("Invalid login credentials", the rate-limit countdown,
      // "Email not confirmed") and passes anything unrecognised through
      // untouched, so a novel error is never swallowed.
      setError(friendlyAuthError(e2))
      // Only on the actual sign-in branch — resend needs a signup to resend
      // against, and 'forgot' can't hit this GoTrue error at all.
      if (mode === 'signin' && /email not confirmed|email_not_confirmed/i.test(e2?.message || '')) {
        setSigninUnconfirmed(true)
      }
    } finally {
      setBusy(false)
      // Turnstile tokens are single-use — reset after every attempt.
      resetCaptcha()
    }
  }

  // Re-sends the confirmation link. Used by the 'confirm' screen right after
  // signup (no argument — falls back to signupEmail) and by the sign-in
  // form's "email not confirmed" recovery, which passes the sign-in email
  // field instead since signupEmail is empty on a fresh page load. Only
  // reachable when "Confirm email" is on in the dashboard — without a resend
  // path, anyone whose confirmation link expired or was eaten by a spam
  // filter had no way forward at all, because signing up again just fails
  // with "already registered" and signing in fails with "not confirmed".
  // `targetEmail` is optional and MUST be a string when given. It used to be
  // wired straight to onClick as `onClick={resendConfirmation}`, which handed
  // it React's click event instead — and since an event object isn't null,
  // `??` kept it and `.trim()` threw a TypeError before a single line of state
  // was set. The button did nothing at all: no spinner, no message, no error
  // on screen (an async handler's rejection doesn't reach the ErrorBoundary).
  // Every call site now passes an explicit string or nothing.
  async function resendConfirmation(targetEmail) {
    const addr = String(targetEmail ?? signupEmail ?? '').trim()
    if (!addr) {
      setResendMsg({ type: 'error', text: 'Enter the email address you signed up with first.' })
      return
    }
    if (!EMAIL_RE.test(addr)) {
      setResendMsg({ type: 'error', text: 'That email address doesn’t look right — check it for typos.' })
      return
    }
    // GoTrue validates a captcha token on /resend just as it does on /signup
    // and /token (supabase-js sends it as gotrue_meta_security.captcha_token).
    // Sending none meant every resend was rejected for the captcha wherever
    // CAPTCHA protection is enabled — which is the one screen a member reaches
    // precisely because they can't get in any other way. Passing a token when
    // CAPTCHA is switched off is harmless: GoTrue ignores it.
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setResendMsg({ type: 'error', text: 'Please complete the security check first, then try again.' })
      return
    }
    setResendBusy(true)
    setResendMsg(null)
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: addr,
      options: { emailRedirectTo: authRedirectTo(), captchaToken },
    })
    setResendBusy(false)
    // Single-use, spent whether it succeeded or not.
    resetCaptcha()
    setResendMsg(
      err
        // The rate-limit message ("you can only request this after N seconds")
        // is the expected outcome of an impatient double-click, so it needs to
        // read as information rather than as a failure.
        ? { type: 'error', text: friendlyAuthError(err) }
        : { type: 'ok', text: `Sent to ${addr} — check your inbox again in a minute or two, and look in spam.` }
    )
  }

  /* ---------- Signup wizard ---------- */

  function validateStep1() {
    if (!firstName.trim()) return 'Enter your first name.'
    if (!lastName.trim()) return 'Enter your last name.'
    const cleanEmail = signupEmail.trim()
    if (!cleanEmail) return 'Enter your email address.'
    if (!EMAIL_RE.test(cleanEmail)) return 'Enter a valid email address.'
    if (cleanEmail.toLowerCase() !== confirmEmail.trim().toLowerCase()) return "Email addresses don't match."
    const pwProblem = passwordProblem(signupPassword)
    if (pwProblem) return pwProblem
    if (signupPassword !== confirmPassword) return "Passwords don't match."
    return null
  }

  function validateStep2() {
    if (!startYear) return 'Select the year you arrived at SACS.'
    if (!endYear) return 'Select your final year (or expected final year).'
    if (Number(endYear) < Number(startYear)) return 'Your final year can’t be before your first year.'
    // Nobody lives in res for more than about a decade. Catches the common
    // slip of picking the wrong decade in one of the two dropdowns, which
    // the committee otherwise has to spot by hand during verification.
    if (Number(endYear) - Number(startYear) > MAX_SCHOOL_YEARS) {
      return `That's more than ${MAX_SCHOOL_YEARS} years in SACS — check the years are right.`
    }
    if (!city.trim()) return 'Enter your city or town.'
    if (!country.trim()) return 'Enter your country.'
    return null
  }

  function validateStep3() {
    if (newsOptIn === null) return 'Choose whether you’d like news and events by email.'
    if (!dataConsent) return 'You’ll need to consent to your data being held to join.'
    if (TURNSTILE_SITE_KEY && !captchaToken) return 'Please complete the security check.'
    return null
  }

  function nextStep() {
    const problem = signupStep === 1 ? validateStep1() : validateStep2()
    if (problem) { setError(problem); return }
    setError(null)
    setSignupStep((s) => s + 1)
  }

  function prevStep() {
    setError(null)
    setSignupStep((s) => Math.max(1, s - 1))
  }

  async function handleSignupSubmit(e) {
    e.preventDefault()
    const problem = validateStep3()
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)

    const fullName = `${(preferredName.trim() || firstName.trim())} ${lastName.trim()}`.trim()
    const details = {
      full_name: fullName,
      first_name: firstName.trim(),
      preferred_name: preferredName.trim(),
      last_name: lastName.trim(),
      start_year: Number(startYear),
      grad_year: Number(endYear),
      email_news_opt_in: newsOptIn === true,
      address_line1: address1.trim(),
      address_line2: address2.trim(),
      address_line3: address3.trim(),
      province: province.trim(),
      city: city.trim(),
      postal_code: postCode.trim(),
      country: country.trim(),
      // Ticked on step 3 to get here. handle_new_user (schema-update-46)
      // reads this and stamps consented_at server-side, so the details are
      // saved by the trigger itself rather than depending on the follow-up
      // update below having a session to run under.
      data_consent: true,
      // Only present when a City suggestion was picked — a null pair would
      // wipe coordinates the profile might already have.
      ...(cityCoords ? { lat: cityCoords.lat, lng: cityCoords.lng } : {}),
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail.trim(),
        password: signupPassword,
        // Stashed in user_metadata too, so the details survive even if the
        // profile update below can't run (e.g. email confirmation enabled
        // → no session yet). App.jsx's FinishSignup fallback reads these.
        //
        // emailRedirectTo was missing here, and this was the only auth call in
        // the app without it — OAuth, resetPasswordForEmail and resend all pass
        // authRedirectTo(). Without it the confirmation link falls back to the
        // project's dashboard Site URL, so a signup from a Vercel preview (or
        // localhost) emailed a link pointing at production, and the original
        // link and any resent one could land on different origins.
        options: { captchaToken, data: details, emailRedirectTo: authRedirectTo() },
      })
      if (error) throw error

      // Duplicate signup, the quiet way.
      //
      // With "Confirm email" OFF, signUp on an existing address errors with
      // "User already registered" and the catch below handles it. With it ON,
      // Supabase deliberately returns a *fake success* instead — an obfuscated
      // user with an empty `identities` array — so an attacker can't use the
      // signup form to test whether an address is registered.
      //
      // Nothing checked for that, so a real member re-running signup got
      // "Your account was created, but we couldn't sign you in just now",
      // which is both wrong and alarming. The wording below is deliberately
      // symmetrical with the genuine case: it doesn't confirm or deny that the
      // address exists, so the anti-enumeration property is preserved.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setAccountExists(true)
        setError(
          'If that email address is already registered, we’ve emailed you about it — ' +
          'otherwise check your inbox for a confirmation link. You can also sign in below, ' +
          'or reset your password if you’ve forgotten it.'
        )
        resetCaptcha()
        return
      }

      let session = data?.session
      if (!session && data?.user && !data.user.email_confirmed_at) {
        // Supabase withholds a session at signup for exactly one reason: the
        // address has to be confirmed first. That's readable straight off the
        // signUp response, so ask it here rather than probing with a second
        // sign-in call and reading the failure.
        //
        // The probe below used to be the only way this was detected, and it
        // had a hole: it sends no captchaToken (the signUp one is single-use
        // and already spent), so with CAPTCHA enforced GoTrue rejected it for
        // the captcha *before* it ever got as far as "Email not confirmed".
        // The /confirm/i branch then never matched, and someone who'd just
        // signed up perfectly successfully was told their account couldn't be
        // signed into — with a confirmation email sitting unmentioned in their
        // inbox. Checking the response instead can't miss.
        clearSignupDraft()
        // Fresh token for the resend button on the screen we're about to show.
        resetCaptcha()
        setSignupDone('confirm')
        return
      }
      if (!session) {
        // Turnstile tokens are single-use — can't reuse the signUp one.
        resetCaptcha()
        const { data: signinData, error: signInError } =
          await supabase.auth.signInWithPassword({ email: signupEmail.trim(), password: signupPassword })
        if (signInError) {
          // Whatever went wrong here, the auth user from signUp above
          // already exists. Rethrowing (the old behaviour) showed a raw
          // error that read like "signup failed", so people retried — and
          // got "User already registered", with no way forward and no hint
          // that the account they'd just made was sitting there waiting.
          // Every branch below has to leave them somewhere they can act.
          if (/confirm/i.test(signInError.message)) {
            // "Confirm email" is on in the project. Their details are
            // already saved by the handle_new_user trigger, so there's
            // nothing left to do but confirm and come back.
            clearSignupDraft()
            setSignupDone('confirm')
            return
          }
          setAccountExists(true)
          // This retry deliberately sends no captchaToken (the signUp one is
          // single-use and already spent). If CAPTCHA is enforced on sign-in
          // too, it therefore *always* fails here — and the generic message
          // below made that look like a broken signup rather than "your
          // account is fine, just sign in and tick the box".
          setError(
            /captcha/i.test(signInError.message)
              ? 'Your account was created. Please sign in below — you’ll need to complete the security check once more.'
              : "Your account was created, but we couldn't sign you in just now. " +
                'Try signing in below with the email and password you just chose.'
          )
          return
        }
        session = signinData?.session
      }

      if (session) {
        // Belt-and-braces. As of schema-update-46 handle_new_user writes
        // all of this from user_metadata the moment the auth user is
        // created, so this update is a safety net for anything the trigger
        // couldn't apply — not the primary write path it used to be.
        const { error: profErr } = await supabase
          .from('profiles')
          .update({
            full_name: details.full_name,
            // The three name parts have their own columns as of
            // schema-update-57. Before that they existed only inside
            // auth.users.raw_user_meta_data, where nothing in the app could
            // read them — so an admin verifying someone against school
            // records couldn't see the legal first name whenever a preferred
            // name had been given, which is exactly when they'd need it.
            first_name: details.first_name,
            preferred_name: details.preferred_name,
            last_name: details.last_name,
            start_year: details.start_year,
            grad_year: details.grad_year,
            email_news_opt_in: details.email_news_opt_in,
            address_line1: details.address_line1,
            address_line2: details.address_line2,
            address_line3: details.address_line3,
            province: details.province,
            city: details.city,
            postal_code: details.postal_code,
            country: details.country,
            ...(cityCoords ? { lat: cityCoords.lat, lng: cityCoords.lng } : {}),
            consented_at: new Date().toISOString(),
          })
          .eq('id', session.user.id)
        // Non-fatal: FinishSignup in App.jsx will catch anything missed.
        if (profErr) console.warn('Profile update after signup failed:', profErr.message)
        // "We've got your details" email. Fire-and-forget, and deliberately
        // not awaited: a mail failure must never turn a successful signup into
        // a visible error. Only reachable on the branch where a session
        // exists — with email confirmation on there's no session here, and the
        // confirmation email already explains what happens next.
        clearSignupDraft()
        // Note the .then, not .catch: supabase-js's functions.invoke swallows
        // everything internally and RESOLVES with { data, error } — an
        // undeployed function, a CORS rejection and a network failure all come
        // back as a fulfilled promise. A .catch() here can never fire, so it
        // would look like error handling while guaranteeing silence.
        supabase.functions
          .invoke('send-member-email', { body: { kind: 'received' } })
          .then(({ error: mailErr }) => {
            if (mailErr) console.error('send-member-email (received) failed:', mailErr)
          })
        // App.jsx's auth listener picks the session up and swaps in the
        // pending-verification screen (accounts start unapproved). That's
        // usually instant — but on a slow connection the "Join our community"
        // button used to just un-grey with nothing else happening, which reads
        // as "my click didn't register" and gets clicked again. Showing a
        // confirmation state means there's never a moment where the wizard is
        // sitting there looking untouched after a successful submit.
        setSignupDone('pending')
        return
      }
    } catch (e2) {
      // Someone re-running a signup they thought had failed lands here.
      // Point them at sign-in rather than leaving them to work out that
      // "User already registered" means "you're fine, just log in".
      if (/already registered|already exists|user_already_exists/i.test(e2.message || '')) {
        setAccountExists(true)
        setError('There’s already an account with that email address. Try signing in instead — or reset your password if you’ve forgotten it.')
      } else {
        setError(friendlyAuthError(e2))
      }
      resetCaptcha()
    } finally {
      setBusy(false)
    }
  }

  /* ---------- Render ---------- */

  if (signupDone) {
    // Two very different situations that used to share one screen and one
    // message. The old copy talked only about committee verification, so
    // someone who actually needed to click a link in their inbox was told to
    // sit and wait — then hit "Email not confirmed" at sign-in with no idea
    // why. Getting a person to check their email needs to be the whole point
    // of the screen when that's what's required, and absent when it isn't.
    const needsConfirm = signupDone === 'confirm'
    return (
      <div className="auth-page">
        <div className="auth-card">
          <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
          <h1 className="auth-title">{needsConfirm ? 'Check your email' : 'Almost there'}</h1>
          <p className="auth-sub">Thanks for joining, {preferredName.trim() || firstName}!</p>

          {needsConfirm ? (
            <>
              <p className="auth-verify-note">
                We&rsquo;ve sent a confirmation link to <strong>{signupEmail}</strong>.
                Click it to confirm the address is yours &mdash; you won&rsquo;t be
                able to sign in until you do.
              </p>
              <p className="auth-verify-note">
                After that, your details go to the alumni committee to be checked
                against SACS school records, and we&rsquo;ll email you again
                once you&rsquo;re confirmed as an Old Boy.
              </p>
              <p className="hint">
                No email after a few minutes? Check your spam or junk folder first
                &mdash; it&rsquo;s almost always there.
              </p>
              {/* The widget has to be on this screen, not just on the forms —
                  the resend is a Supabase auth call like any other and needs
                  its own token. */}
              {captchaVisible && <div ref={turnstileRef} className="auth-captcha" />}
              {captchaVisible && captchaError && (
                <p className="form-error" role="alert">
                  Security check failed to load. Disable any ad/privacy blocker for this
                  site and{' '}
                  <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                    refresh the page
                  </button>.
                </p>
              )}
              {resendMsg && (
                <p className={resendMsg.type === 'ok' ? 'form-notice' : 'form-error'} role="status">
                  {resendMsg.text}
                </p>
              )}
              {/* Arrow function, not a bare reference — see resendConfirmation. */}
              <button type="button" className="btn ghost wide" onClick={() => resendConfirmation()} disabled={resendBusy}>
                {resendBusy ? 'Sending…' : 'Resend the confirmation email'}
              </button>
            </>
          ) : (
            <p className="auth-verify-note">
              Your details will be verified against SACS school records. Once
              you&rsquo;re confirmed as an Old Boy, you&rsquo;ll receive an email at{' '}
              <strong>{signupEmail}</strong> and can sign in.
            </p>
          )}

          <button type="button" className="link-btn" onClick={() => { setSignupDone(null); setResendMsg(null); switchMode('signin') }}>
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">SACS Alumni</h1>
        <p className="auth-sub">Spectemur Agendo · Since 1829</p>

        {mode !== 'forgot' && (
          // Deliberately NOT role="tablist"/"tab". That markup promises a
          // matching role="tabpanel" and arrow-key navigation between tabs;
          // neither existed here, and ARIA that lies about the structure is
          // worse for a screen-reader user than no ARIA at all (they're told
          // to arrow between panels that aren't there). These are two buttons
          // that swap the form, so that's what they now announce as, with
          // aria-pressed carrying the on/off state.
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
              aria-pressed={mode === 'signup'}
              className={mode === 'signup' ? 'auth-tab on' : 'auth-tab'}
              onClick={() => switchMode('signup')}
            >
              Join
            </button>
          </div>
        )}

        {mode !== 'signup' && (
          <form onSubmit={handleSigninSubmit} noValidate>
            {mode === 'signin' && (
              <>
                <SocialButtons prefix="Continue with" onError={setError} />
                <div className="auth-divider"><span>or with your email</span></div>
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

            {captchaVisible && <div ref={turnstileRef} className="auth-captcha" />}
            {captchaVisible && captchaError && (
              <p className="form-error" role="alert">
                Security check failed to load. Disable any ad/privacy blocker for this
                site and{' '}
                <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                  refresh the page
                </button>.
              </p>
            )}

            {/* role="alert" so a validation failure is announced. Without it a
                screen-reader user submitting this form got silence — the error
                appeared visually and nothing else happened. */}
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
                  onClick={() => resendConfirmation(email)}
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
                a signup-confirmation one — the two are indistinguishable, and
                App.jsx lands both here. Resetting a password does nothing for
                someone whose address was never confirmed, so this screen has
                to offer the other remedy too rather than quietly assuming
                which link they clicked. It reuses the email field and the
                captcha that are already on this form. */}
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
                  onClick={() => resendConfirmation(email)}
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

        {mode === 'signup' && (
          <>
            {/* Above the wizard, not inside step 1. Sitting below the name
                and password fields, this button was a trap: anyone who
                filled the form in and only then noticed it lost everything
                they'd typed, because OAuth navigates away and FinishSignup
                can't recover form state it never saw. Offering the choice
                before the form starts means it's a choice, not a mistake. */}
            <SocialButtons prefix="Join with" onError={setError} />
            <div className="auth-divider"><span>or complete the form</span></div>

            <form onSubmit={handleSignupSubmit} noValidate>
            {/* The dots are decoration — three bare numerals read aloud tell
                you nothing. The real progress statement lives in the live
                region beside them, so moving between steps is announced. */}
            <div className="auth-steps" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <span key={n} className={`auth-step-dot ${signupStep === n ? 'on' : ''} ${signupStep > n ? 'done' : ''}`}>
                  {signupStep > n ? '✓' : n}
                </span>
              ))}
            </div>
            <p className="sr-only" role="status">
              Step {signupStep} of 3
              {signupStep === 1 ? ': your details' : signupStep === 2 ? ': your years in SACS' : ': consent'}
            </p>

            {draftRestored && (
              <p className="form-notice" role="status">
                We&rsquo;ve put back what you&rsquo;d already filled in. You&rsquo;ll need to
                choose your password again &mdash; we never store that.{' '}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    clearSignupDraft()
                    setDraftRestored(false)
                    setFirstName(''); setPreferredName(''); setLastName('')
                    setSignupEmail(''); setConfirmEmail('')
                    setStartYear(''); setEndYear('')
                    setAddress1(''); setAddress2(''); setAddress3('')
                    setProvince(''); setCity(''); setCityCoords(null)
                    setPostCode(''); setCountry('South Africa')
                    setNewsOptIn(null)
                    setSignupStep(1)
                  }}
                >
                  Start fresh instead
                </button>
              </p>
            )}

            {/* Hidden, not unmounted.

                Chrome, Safari and every password manager decide whether to
                offer "save this password?" by looking at the form being
                submitted. Step 1 used to be `{signupStep === 1 && …}`, so by
                the time anyone pressed "Join our community" on step 3 the form
                contained no email or password field at all and nothing was
                ever offered — people joined, were never prompted to save
                anything, and then couldn't get back in. Keeping the fields
                mounted (and merely display:none) means the credentials are
                still part of the submitted form.

                `hidden` plus the inline style deliberately: the bare attribute
                relies on the UA stylesheet's `[hidden] { display: none }`,
                which any later `div { display: … }` rule would beat. */}
            <div hidden={signupStep !== 1} style={signupStep === 1 ? undefined : { display: 'none' }}>
                <div className="auth-field-row">
                  <label className="field">
                    <span>First name *</span>
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                  </label>
                  <label className="field">
                    <span>Last name *</span>
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                  </label>
                </div>
                <label className="field">
                  <span>Preferred first name</span>
                  <input
                    value={preferredName}
                    onChange={(e) => setPreferredName(e.target.value)}
                    placeholder="If different — e.g. JP, Wikus"
                  />
                </label>
                <label className="field">
                  <span>Email *</span>
                  {/* `username`, not `email`. This is the field that pairs with
                      the new-password fields below, and `username` is what
                      password managers look for when deciding what login they
                      are being asked to save. */}
                  <input type="email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} autoComplete="username" />
                </label>
                <label className="field">
                  <span>Confirm email *</span>
                  {/* Explicitly off: a second address field advertising itself
                      as the username makes managers guess between the two. */}
                  <input type="email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" />
                </label>
                <label className="field">
                  <span>Password *</span>
                  <PasswordInput
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder={`At least ${PASSWORD_MIN} characters`}
                    autoComplete="new-password"
                  />
                </label>
                <PasswordStrengthMeter password={signupPassword} />
                <label className="field">
                  <span>Confirm password *</span>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
            </div>

            {signupStep === 2 && (
              <>
                <h2 className="auth-step-heading">Your years in SACS</h2>
                <p className="auth-step-sub">
                  When did you live in SACS? An expected final year is fine if
                  you&rsquo;re still there.
                </p>
                <div className="auth-field-row">
                  <label className="field">
                    <span>From *</span>
                    <div className="select-wrap">
                      <select value={startYear} onChange={(e) => setStartYear(e.target.value)}>
                        <option value="">Year</option>
                        {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </label>
                  <label className="field">
                    <span>To *</span>
                    <div className="select-wrap">
                      <select value={endYear} onChange={(e) => setEndYear(e.target.value)}>
                        <option value="">Year</option>
                        {END_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  </label>
                </div>

                {/* See the matching note in FinishSignup.jsx — an unexplained
                    home-address block mid-signup is a well-known drop-off
                    point, and the answer ("map + posted invitations, not shown
                    on your profile") is one sentence. */}
                <p className="hint" style={{ marginTop: 14 }}>
                  Your address is optional. It&rsquo;s used to place you on the alumni
                  map and to post you reunion invitations, and it isn&rsquo;t
                  displayed on your profile.
                </p>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Address line 1</span>
                  <input value={address1} onChange={(e) => setAddress1(e.target.value)} autoComplete="address-line1" />
                </label>
                <label className="field">
                  <span>Address line 2</span>
                  <input value={address2} onChange={(e) => setAddress2(e.target.value)} autoComplete="address-line2" />
                </label>
                <label className="field">
                  <span>Address line 3</span>
                  <input value={address3} onChange={(e) => setAddress3(e.target.value)} autoComplete="address-line3" />
                </label>
                <div className="auth-field-row">
                  <label className="field">
                    <span>Province</span>
                    <input value={province} onChange={(e) => setProvince(e.target.value)} autoComplete="address-level1" />
                  </label>
                  <label className="field">
                    <span>City *</span>
                    {/* Same live Mapbox suggestions as the profile editor — a
                        picked suggestion also gives us coordinates, so new
                        members land on the alumni map straight away instead
                        of waiting for a later geocode of free-typed text. */}
                    <CityAutocomplete
                      value={city}
                      country={country}
                      onChange={setCity}
                      onSelectCoords={setCityCoords}
                      placeholder="Start typing…"
                    />
                  </label>
                </div>
                <div className="auth-field-row">
                  <label className="field">
                    {/* Optional, and no longer hinted as numeric: plenty of
                        countries use letters in theirs (UK, Canada,
                        Netherlands) and a few have none at all, so
                        requiring a numeric post code blocked exactly the
                        overseas alumni this directory most wants to find. */}
                    <span>Post code</span>
                    <input
                      value={postCode}
                      onChange={(e) => setPostCode(e.target.value)}
                      autoComplete="postal-code"
                    />
                  </label>
                  <label className="field">
                    <span>Country *</span>
                    <CountryAutocomplete value={country} onChange={setCountry} placeholder="Start typing…" />
                  </label>
                </div>
              </>
            )}

            {signupStep === 3 && (
              <>
                <h2 className="auth-step-heading">Consent</h2>
                <fieldset className="auth-consent-group">
                  <legend>I&rsquo;m happy to hear about news and events by email. *</legend>
                  <div className="auth-consent-row">
                    <button
                      type="button"
                      className={newsOptIn === true ? 'onboarding-choice on' : 'onboarding-choice'}
                      onClick={() => setNewsOptIn(true)}
                    >
                      Yes, email me
                    </button>
                    <button
                      type="button"
                      className={newsOptIn === false ? 'onboarding-choice on' : 'onboarding-choice'}
                      onClick={() => setNewsOptIn(false)}
                    >
                      No, don&rsquo;t email me
                    </button>
                  </div>
                </fieldset>
                <label className="auth-consent-check">
                  <input
                    type="checkbox"
                    checked={dataConsent}
                    onChange={(e) => setDataConsent(e.target.checked)}
                  />
                  <span>
                    I consent to my personal data being held on the SACS Alumni
                    database and used to run this community, and to receiving
                    occasional system emails about my profile. *
                  </span>
                </label>
                <p className="hint auth-privacy-link">
                  <button type="button" className="link-btn" onClick={() => setPrivacyOpen(true)}>
                    Read our Privacy Policy
                  </button>
                </p>
                {privacyOpen && <PrivacyPolicyModal onClose={() => setPrivacyOpen(false)} />}

                {captchaVisible && <div ref={turnstileRef} className="auth-captcha" />}
                {captchaVisible && captchaError && (
                  <p className="form-error" role="alert">
                    Security check failed to load. Disable any ad/privacy blocker for
                    this site and{' '}
                    <button type="button" className="link-btn" onClick={() => window.location.reload()}>
                      refresh the page
                    </button>.
                  </p>
                )}
              </>
            )}

            {/* Same reasoning as the sign-in form: without a live region, a
                failed "Continue" on the wizard is silent to a screen reader —
                the step simply doesn't advance and nothing says why. */}
            {error && <p className="form-error" role="alert">{error}</p>}

            {accountExists ? (
              // The account is already there — retrying the wizard can only
              // fail. Sign-in is the only route forward, so it's the only
              // button we show.
              <button type="button" className="btn primary wide" onClick={goToSignIn}>
                Go to sign in
              </button>
            ) : (
              <div className="auth-wizard-actions">
                {signupStep > 1 && (
                  <button type="button" className="btn ghost" onClick={prevStep} disabled={busy}>
                    Back
                  </button>
                )}
                {signupStep < 3 ? (
                  <button type="button" className="btn primary" onClick={nextStep} disabled={busy}>
                    Continue
                  </button>
                ) : (
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? 'One moment…' : 'Join our community'}
                  </button>
                )}
              </div>
            )}
            </form>
          </>
        )}

        <p className="auth-note">
          New accounts are verified against SACS school records — you&rsquo;ll
          get an email as soon as you&rsquo;re confirmed.
        </p>
      </div>
    </div>
  )
}
