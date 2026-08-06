import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { MAX_SCHOOL_YEARS } from '../constants.js'
import { friendlyAuthError } from '../authErrors.js'
import { PrivacyPolicyModal } from './PrivacyPolicy.jsx'

// Shown (full-screen, before anything else) to anyone signed in whose profile
// has no consented_at yet — in practice that's people who joined via Google
// and so never went through the signup form, plus the rare email signup whose
// post-signup profile update failed.
//
// This screen used to ask for eleven things: three name fields, two years,
// three address lines, province, city, post code, country, plus both consent
// answers. Seven of the twenty-seven people who came in through the Google
// button never finished it — they clicked a one-click sign-in and were handed
// a form asking for their home address, and simply left. Nothing chased them:
// notify_admins_new_signup only fires once consent is captured, so no admin
// ever heard about them either, and their accounts sat unreachable.
//
// So it now asks only for what the committee actually needs to verify someone
// against school records — who you are and when you were in SACS — plus
// the consent that legally has to be collected before anything is stored.
// Everything else (address, city, the map pin, post code) is collected on the
// profile page immediately after approval: App.jsx already routes first-time
// members straight there with every empty field highlighted, so nothing is
// lost, it's just asked for at a point where the person is already in and has
// a reason to care.
const FOUNDING_YEAR = 1961
const THIS_YEAR = new Date().getFullYear()
const START_YEARS = []
for (let y = THIS_YEAR; y >= FOUNDING_YEAR; y--) START_YEARS.push(y)
const END_YEARS = []
for (let y = THIS_YEAR + 7; y >= FOUNDING_YEAR; y--) END_YEARS.push(y)

// A refresh or a stray back-gesture mid-fill used to throw away everything
// typed, because "Sign out" was the only way off this screen. `dataConsent` is
// deliberately left out: a consent tick is an affirmation someone has to make
// deliberately, not something to silently restore on their behalf.
const DRAFT_FIELDS = [
  'firstName', 'preferredName', 'lastName', 'startYear', 'endYear', 'newsOptIn',
]

// Drafts expire. Without this they were kept forever: a stale draft from
// months ago silently overriding the name a social provider hands back today.
// A week is comfortably longer than "I'll finish this tonight" and shorter
// than "why is this filled in?".
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function readDraft(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Drafts written before this change have no savedAt — treat them as
    // expired rather than trusting an unknown age.
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key)
      return null
    }
    const values = parsed.values
    if (!values || typeof values !== 'object') return null
    // Coerce rather than trust: `??` at the state initialisers below only
    // guards null/undefined, so a value that had somehow become a number or an
    // object would reach state and then throw on `.trim()` in validate() —
    // permanently, since the draft is re-read on every load.
    const clean = {}
    for (const key of DRAFT_FIELDS) {
      const v = values[key]
      if (v === null || v === undefined) continue
      clean[key] = key === 'newsOptIn' ? (typeof v === 'boolean' ? v : null) : String(v)
    }
    return clean
  } catch {
    return null
  }
}

export default function FinishSignup({ session, profile, onDone }) {
  const meta = session.user.user_metadata || {}
  const draftKey = `sacs-finish-signup-${session.user.id}`
  const [draft] = useState(() => readDraft(draftKey) || {})
  // Social providers hand back given_name/family_name (Google) or just a full
  // name — prefill whatever's available.
  const [firstName, setFirstName] = useState(
    draft.firstName ?? (meta.first_name || meta.given_name || (meta.full_name || meta.name || '').split(' ')[0] || '')
  )
  const [preferredName, setPreferredName] = useState(draft.preferredName ?? (meta.preferred_name || ''))
  const [lastName, setLastName] = useState(
    draft.lastName ?? (meta.last_name || meta.family_name || (meta.full_name || meta.name || '').split(' ').slice(1).join(' ') || '')
  )
  const [startYear, setStartYear] = useState(draft.startYear ?? (meta.start_year || ''))
  const [endYear, setEndYear] = useState(draft.endYear ?? (meta.grad_year || ''))
  const [newsOptIn, setNewsOptIn] = useState(
    draft.newsOptIn ?? (typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null)
  )
  const [dataConsent, setDataConsent] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const values = { firstName, preferredName, lastName, startYear, endYear, newsOptIn }
  // Only writes once there's something the person actually typed, and only
  // when it differs from what the provider handed back.
  //
  // Writing unconditionally on mount had two bad effects. It refreshed
  // `savedAt` every time the screen was opened, so DRAFT_MAX_AGE_MS could
  // never expire anything for a regular visitor — the whole point of the
  // expiry. And it immediately persisted the *prefilled* Google values, which
  // then take priority over `meta` on the next load (see the `??` chain
  // above), pinning the first thing Google ever returned and making a later
  // corrected name from the provider impossible to pick up. That's precisely
  // the failure the header comment warns about.
  const providerDefaults = {
    firstName: meta.first_name || meta.given_name || (meta.full_name || meta.name || '').split(' ')[0] || '',
    preferredName: meta.preferred_name || '',
    lastName: meta.last_name || meta.family_name || (meta.full_name || meta.name || '').split(' ').slice(1).join(' ') || '',
    startYear: meta.start_year || '',
    endYear: meta.grad_year || '',
    newsOptIn: typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null,
  }
  const draftWorthSaving = DRAFT_FIELDS.some((k) => {
    const v = values[k]
    if (v === '' || v === null || v === undefined) return false
    return String(v) !== String(providerDefaults[k] ?? '')
  })
  useEffect(() => {
    if (!draftWorthSaving) return
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        savedAt: Date.now(),
        values: Object.fromEntries(DRAFT_FIELDS.map((k) => [k, values[k]])),
      }))
    } catch { /* private mode / quota — the form still works, just not resumable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftWorthSaving, ...DRAFT_FIELDS.map((k) => values[k])])

  function validate() {
    if (!firstName.trim()) return 'Enter your first name.'
    if (!lastName.trim()) return 'Enter your last name.'
    if (!startYear) return 'Select the year you arrived at SACS.'
    if (!endYear) return 'Select your final year (or expected final year).'
    if (Number(endYear) < Number(startYear)) return 'Your final year can’t be before your first year.'
    // Same sanity check as the signup wizard — see Auth.jsx.
    if (Number(endYear) - Number(startYear) > MAX_SCHOOL_YEARS) {
      return `That's more than ${MAX_SCHOOL_YEARS} years in SACS — check the years are right.`
    }
    if (newsOptIn === null) return 'Choose whether you’d like news and events by email.'
    if (!dataConsent) return 'You’ll need to consent to your data being held to join.'
    return null
  }

  async function save(e) {
    e.preventDefault()
    const problem = validate()
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    const fullName = `${(preferredName.trim() || firstName.trim())} ${lastName.trim()}`.trim()
    const { data, error: err } = await supabase
      .from('profiles')
      .update({
        full_name: fullName,
        // Own columns as of schema-update-57 — an admin checking someone
        // against school records needs the legal first name, which is
        // exactly what full_name loses whenever a preferred name is given.
        first_name: firstName.trim(),
        preferred_name: preferredName.trim(),
        last_name: lastName.trim(),
        start_year: Number(startYear),
        grad_year: Number(endYear),
        email_news_opt_in: newsOptIn === true,
        consented_at: new Date().toISOString(),
      })
      .eq('id', session.user.id)
      .select()
      .single()
    setBusy(false)
    if (err) { setError(friendlyAuthError(err, "Couldn't save your details — please try again.")); return }
    try { localStorage.removeItem(draftKey) } catch { /* ignore */ }
    // "We've got your details" email. Google joiners previously received no
    // email at all between signing up and being approved, so the account went
    // silent at exactly the point people worry it hasn't worked.
    //
    // Fire-and-forget — a mail failure must never block joining — but read the
    // result rather than chaining .catch(): supabase-js's functions.invoke
    // resolves with { data, error } even for network, CORS and "function isn't
    // deployed" failures, so a .catch() can never fire and would hide all of
    // them behind an empty console.
    supabase.functions
      .invoke('send-member-email', { body: { kind: 'received' } })
      .then(({ error: mailErr }) => {
        if (mailErr) console.error('send-member-email (received) failed:', mailErr)
      })
    onDone(data)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">Nearly done</h1>
        <p className="auth-sub">Two quick things and you&rsquo;re in the queue</p>

        {/* Says up front how long this is. The old version opened straight
            into eleven fields with no indication of where the bottom was,
            which is its own reason to abandon a form. */}
        <p className="auth-verify-note">
          We just need your name and the years you were in SACS &mdash; that&rsquo;s what
          the committee checks against school records. You can fill in the rest
          of your profile once you&rsquo;re in.
        </p>

        <form onSubmit={save} noValidate>
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

          <div className="auth-field-row">
            <label className="field">
              <span>In SACS from *</span>
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
            <input type="checkbox" checked={dataConsent} onChange={(e) => setDataConsent(e.target.checked)} />
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

          {/* Live region: validate() returns one message at a time, so without
              an announcement a screen-reader user submitting this gets no
              feedback at all. */}
          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="btn primary wide" disabled={busy}>
            {busy ? 'Saving…' : 'Finish joining'}
          </button>
        </form>

        <button type="button"
          className="link-btn"
          onClick={() => { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } supabase.auth.signOut() }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
