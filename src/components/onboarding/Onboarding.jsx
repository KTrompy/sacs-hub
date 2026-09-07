import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { COMMUNITY_ROLES } from '../../constants.js'
import { TURNSTILE_SITE_KEY } from '../Turnstile.jsx'
import StepAccount from './StepAccount.jsx'
import StepAbout from './StepAbout.jsx'
import StepFinish from './StepFinish.jsx'
import OnboardingProgress from './OnboardingProgress.jsx'
import EmailConfirmation from './EmailConfirmation.jsx'
import { validateStepAccount, validateStepAbout, validateStepFinish } from './onboardingValidation.js'
import { readDraft, writeDraft, clearDraft, draftHasContent } from './onboardingDraft.js'
import { submitNewAccount, submitResume } from './onboardingSubmit.js'

// Fields safe to draft in either mode. Never the passwords, never the
// consent tick — see onboardingDraft.js.
const DRAFT_FIELDS = [
  'firstName', 'preferredName', 'lastName', 'email', 'confirmEmail',
  'startYear', 'endYear', 'phone', 'newsOptIn',
  'country', 'province', 'city', 'address', 'postCode',
]

function emptyRoles() {
  return Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, false]))
}

function splitName(full) {
  const parts = (full || '').trim().split(/\s+/)
  return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' }
}

// The single onboarding wizard, used two ways:
//   mode="new"    — no session yet (Auth.jsx's Join tab). Step 1 shows
//                   password fields; final submit calls supabase.auth.signUp().
//   mode="resume" — a session already exists (Google, or a legacy account
//                   that consented but never finished its membership
//                   record). Step 1 has no password fields and is
//                   pre-filled from the provider/profile; final submit
//                   writes profiles/profile_details directly.
//
// Both modes render the exact same three step components and validators —
// there's exactly one implementation of every field and every rule.
export default function Onboarding({ mode, session, profile, onDone, onGoToSignIn, onStepChange }) {
  const draftKey = mode === 'resume' ? `sacs-onboarding-draft-${session.user.id}` : 'sacs-signup-draft'
  const [draft] = useState(() => readDraft(draftKey, DRAFT_FIELDS))
  const [draftRestored, setDraftRestored] = useState(() => Object.keys(readDraft(draftKey, DRAFT_FIELDS)).length > 0)

  // Legacy resume case (the old CompleteDetails.jsx's job): consent was
  // already captured once, so name/email are already fixed — only the
  // membership record is missing. Start at Step 2 and disallow going back
  // past it. Everyone else (a fresh mode="new" signup, or a Google joiner
  // who has never consented at all) starts at Step 1.
  const startStep = (mode === 'resume' && profile?.consented_at && !profile?.details_completed_at) ? 2 : 1
  const [step, setStep] = useState(startStep)

  const meta = mode === 'resume' ? (session.user.user_metadata || {}) : {}
  const providerName = splitName(meta.full_name || meta.name || '')

  const [values, setValues] = useState(() => ({
    firstName: draft.firstName ?? (mode === 'resume'
      ? (profile?.first_name || meta.first_name || meta.given_name || providerName.first || '')
      : ''),
    lastName: draft.lastName ?? (mode === 'resume'
      ? (profile?.last_name || meta.last_name || meta.family_name || providerName.last || '')
      : ''),
    preferredName: draft.preferredName ?? (mode === 'resume' ? (profile?.preferred_name || '') : ''),
    email: draft.email ?? '',
    confirmEmail: draft.confirmEmail ?? '',
    password: '',
    confirmPassword: '',
    title: '',
    dob: '',
    phone: draft.phone ?? (mode === 'resume' ? (profile?.phone || '') : ''),
    startYear: draft.startYear ?? (mode === 'resume' ? String(profile?.start_year || '') : ''),
    endYear: draft.endYear ?? (mode === 'resume' ? String(profile?.grad_year || '') : ''),
    roles: emptyRoles(),
    country: draft.country ?? (mode === 'resume' ? (profile?.country || 'South Africa') : 'South Africa'),
    province: draft.province ?? (mode === 'resume' ? (profile?.province || '') : ''),
    city: draft.city ?? (mode === 'resume' ? (profile?.city || '') : ''),
    cityCoords: null,
    address: draft.address ?? '',
    postCode: draft.postCode ?? '',
    newsOptIn: draft.newsOptIn ?? (typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null),
    // Optional, and deliberately default OFF — no accidental opt-in.
    commPrefPhone: false,
    commPrefSms: false,
    dataConsent: false,
  }))
  const [loadingExisting, setLoadingExisting] = useState(mode === 'resume')
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [accountExistsMsg, setAccountExistsMsg] = useState(null)
  const [confirmScreen, setConfirmScreen] = useState(null) // { email, greetingName } | null
  const [justCreatedPending, setJustCreatedPending] = useState(false)

  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0)

  function set(field, value) {
    setValues((v) => ({ ...v, [field]: value }))
  }

  useEffect(() => { onStepChange?.(step) }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  // A profile_details row (and, for mode="resume", the profile row itself)
  // may already partially exist — someone resuming, or a half-filled
  // legacy account — so prefill rather than clobber. Mirrors FinishSignup/
  // CompleteDetails' original defensive fetch.
  useEffect(() => {
    if (mode !== 'resume') return
    let cancelled = false
    supabase
      .from('profile_details')
      .select('title, date_of_birth, old_boy, current_parent, past_parent, current_staff, past_staff, comm_pref_email, comm_pref_phone, comm_pref_sms')
      .eq('profile_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          setValues((v) => ({
            ...v,
            title: data.title || v.title,
            dob: data.date_of_birth || v.dob,
            roles: Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, data[r.key] === true])),
            commPrefPhone: data.comm_pref_phone === true,
            commPrefSms: data.comm_pref_sms === true,
          }))
        }
        setLoadingExisting(false)
      })
    return () => { cancelled = true }
  }, [mode, session?.user?.id])

  // Draft persistence — only once there's something worth restoring, and
  // never the password or consent tick (see DRAFT_FIELDS above).
  const hasContent = draftHasContent(DRAFT_FIELDS, values, { country: 'South Africa' })
  useEffect(() => {
    if (confirmScreen || justCreatedPending) return
    if (!hasContent) return
    writeDraft(draftKey, DRAFT_FIELDS, values)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, hasContent, confirmScreen, justCreatedPending, ...DRAFT_FIELDS.map((f) => values[f])])

  // Second line of defence for what the draft can't cover (passwords).
  // Only warns when there's actually something to lose.
  useEffect(() => {
    if (confirmScreen || justCreatedPending) return
    if (!hasContent && !values.password) return undefined
    function handler(e) { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasContent, values.password, confirmScreen, justCreatedPending])

  function startFresh() {
    clearDraft(draftKey)
    setDraftRestored(false)
    setValues((v) => ({
      ...v,
      firstName: mode === 'resume' ? (meta.first_name || meta.given_name || providerName.first || '') : '',
      lastName: mode === 'resume' ? (meta.last_name || meta.family_name || providerName.last || '') : '',
      preferredName: '',
      email: '', confirmEmail: '',
      startYear: '', endYear: '', phone: '',
      newsOptIn: typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null,
      country: 'South Africa', province: '', city: '', address: '', postCode: '',
    }))
  }

  const STEP_VALIDATORS = {
    1: () => validateStepAccount({ ...values, requireCredentials: mode === 'new' }),
    2: () => validateStepAbout(values),
  }

  function goNext() {
    const problem = STEP_VALIDATORS[step]?.()
    if (problem) { setError(problem); return }
    setError(null)
    setStep((s) => s + 1)
  }

  function goBack() {
    setError(null)
    setStep((s) => Math.max(startStep, s - 1))
  }

  async function handleFinalSubmit(e) {
    e.preventDefault()
    const problem = validateStepFinish({
      ...values,
      captchaRequired: !!TURNSTILE_SITE_KEY,
      captchaToken,
    })
    if (problem) { setError(problem); return }
    setError(null)
    setAccountExistsMsg(null)
    setBusy(true)

    if (mode === 'new') {
      const result = await submitNewAccount({ values, captchaToken })
      setBusy(false)
      setCaptchaToken(null)
      setCaptchaResetSignal((n) => n + 1)
      if (result.status === 'confirm') {
        clearDraft(draftKey)
        setConfirmScreen({ email: values.email.trim(), greetingName: values.preferredName.trim() || values.firstName })
      } else if (result.status === 'pending') {
        clearDraft(draftKey)
        // App.jsx's own auth listener picks the new session up within a
        // moment and swaps this whole screen out for PendingVerification —
        // this just avoids a blank/unresponsive-looking button in the
        // meantime.
        setJustCreatedPending(true)
      } else if (result.status === 'account-exists') {
        setAccountExistsMsg(result.message)
        setError(result.message)
      } else {
        setError(result.message)
      }
      return
    }

    const result = await submitResume({ session, values })
    setBusy(false)
    if (result.status === 'done') {
      clearDraft(draftKey)
      onDone(result.profile)
    } else {
      setError(result.message)
    }
  }

  if (confirmScreen) {
    return (
      <EmailConfirmation
        email={confirmScreen.email}
        greetingName={confirmScreen.greetingName}
        onBackToSignIn={() => setConfirmScreen(null)}
      />
    )
  }

  if (justCreatedPending) {
    return (
      <div className="acct-onb-step">
        <h2 className="auth-step-heading">Almost there</h2>
        <p className="auth-verify-note">
          Your details will be verified against SACS school records. We&rsquo;ll
          email you at <strong>{values.email}</strong> as soon as you&rsquo;re confirmed.
        </p>
      </div>
    )
  }

  return (
    <div className="acct-onb-wrap">
      <OnboardingProgress step={step} />

      {draftRestored && (
        <p className="form-notice acct-onb-draft-actions" role="status">
          We&rsquo;ve restored the details you previously entered.{' '}
          <button type="button" className="link-btn" onClick={startFresh}>Start fresh</button>
        </p>
      )}

      <form onSubmit={step === 3 ? handleFinalSubmit : (e) => { e.preventDefault(); goNext() }} noValidate>
        {step === 1 && (
          <StepAccount
            values={values}
            onChange={set}
            requireCredentials={mode === 'new'}
            fixedEmail={mode === 'resume' ? session.user.email : null}
          />
        )}
        {step === 2 && <StepAbout values={values} onChange={set} />}
        {step === 3 && (
          <StepFinish
            values={values}
            onChange={set}
            privacyOpen={privacyOpen}
            onPrivacyOpenChange={setPrivacyOpen}
            onCaptchaToken={setCaptchaToken}
            onCaptchaErrorChange={() => {}}
            captchaResetSignal={captchaResetSignal}
          />
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        {accountExistsMsg && onGoToSignIn && (
          <button
            type="button"
            className="btn ghost wide"
            onClick={() => onGoToSignIn(values.email, values.password)}
          >
            Go to sign in
          </button>
        )}

        <div className="acct-onb-nav">
          {step > startStep && (
            <button type="button" className="acct-onb-back" onClick={goBack} disabled={busy}>
              Back
            </button>
          )}
          {step < 3 ? (
            <button type="submit" className="btn primary" disabled={busy || loadingExisting}>
              Continue
            </button>
          ) : (
            <button type="submit" className="btn primary" disabled={busy}>
              {mode === 'new'
                ? (busy ? 'Creating your account…' : 'Create my account')
                : (busy ? 'Saving…' : 'Finish joining')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
