import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { MAX_SCHOOL_YEARS, TITLES, INDUSTRIES, SA_PROVINCES, COMMUNITY_ROLES } from '../constants.js'
import { friendlyAuthError } from '../authErrors.js'
import { PrivacyPolicyModal } from './PrivacyPolicy.jsx'
import PhoneInput from './PhoneInput.jsx'
import CityAutocomplete from './CityAutocomplete.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'

// Shown (full-screen, before anything else) to anyone signed in whose profile
// has no consented_at yet — in practice that's people who joined via Google
// and so never went through the signup form, plus the rare email signup whose
// post-signup profile update failed.
//
// One screen, everything at once — name, years, membership record and
// address — mirroring the merged Auth.jsx wizard. This used to be split into
// a short "who you are" screen here plus a second CompleteDetails.jsx screen
// afterwards; that split is gone, so a Google joiner now finishes signing up
// in exactly one sitting, same as an email joiner.
const FOUNDING_YEAR = 1829
const THIS_YEAR = new Date().getFullYear()
const START_YEARS = []
for (let y = THIS_YEAR; y >= FOUNDING_YEAR; y--) START_YEARS.push(y)
const END_YEARS = []
for (let y = THIS_YEAR + 7; y >= FOUNDING_YEAR; y--) END_YEARS.push(y)

const MIN_AGE = 5
const MAX_AGE = 120

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

  // Membership-record + address fields — previously CompleteDetails.jsx, a
  // separate screen shown only after this one. profile.* prefills are used
  // (rather than drafted) since a profile_details row may already exist for
  // someone who half-filled the old profile page before this merge shipped.
  const [title, setTitle] = useState('')
  const [dob, setDob] = useState('')
  const [phone, setPhone] = useState(profile.phone || '')
  const [country, setCountry] = useState(profile.country || 'South Africa')
  const [province, setProvince] = useState(profile.province || '')
  const [city, setCity] = useState(profile.city || '')
  const [cityCoords, setCityCoords] = useState(null)
  const [address1, setAddress1] = useState('')
  const [address2, setAddress2] = useState('')
  const [address3, setAddress3] = useState('')
  const [postCode, setPostCode] = useState('')
  const [industry, setIndustry] = useState(
    INDUSTRIES.includes(profile.industry) ? profile.industry : (profile.industry ? 'Other' : '')
  )
  const [customIndustry, setCustomIndustry] = useState(
    INDUSTRIES.includes(profile.industry) ? '' : (profile.industry || '')
  )
  const [occupation, setOccupation] = useState(profile.occupation || '')
  const [roles, setRoles] = useState(() => Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, false])))
  const [commPrefPhone, setCommPrefPhone] = useState(true)
  const [commPrefSms, setCommPrefSms] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(true)

  const [newsOptIn, setNewsOptIn] = useState(
    draft.newsOptIn ?? (typeof meta.email_news_opt_in === 'boolean' ? meta.email_news_opt_in : null)
  )
  const [dataConsent, setDataConsent] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const isSA = country === 'South Africa'

  // A profile_details row may already exist (someone who half-filled the
  // profile page, or hit this screen once already and reloaded) — prefill
  // rather than clobber.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('profile_details')
      .select('title, date_of_birth, old_boy, current_parent, past_parent, current_staff, past_staff, comm_pref_email, comm_pref_phone, comm_pref_sms')
      .eq('profile_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          if (data.title) setTitle(data.title)
          if (data.date_of_birth) setDob(data.date_of_birth)
          setRoles(Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, data[r.key] === true])))
          setCommPrefPhone(data.comm_pref_phone !== false)
          setCommPrefSms(data.comm_pref_sms !== false)
        }
        setLoadingDetails(false)
      })
    return () => { cancelled = true }
  }, [session.user.id])

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
    if (!title) return 'Select your title.'
    if (!dob) return 'Enter your date of birth.'
    const d = new Date(dob)
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
    if (Number.isNaN(d.getTime()) || age < MIN_AGE || age > MAX_AGE) {
      return 'That date of birth doesn’t look right — please check it.'
    }
    if (!phone.trim() || phone.trim().replace(/\D/g, '').length < 6) return 'Enter your cell number.'
    if (!startYear) return 'Select the year you arrived at SACS.'
    if (!endYear) return 'Select your final year (or expected final year).'
    if (Number(endYear) < Number(startYear)) return 'Your final year can’t be before your first year.'
    // Same sanity check as the signup wizard — see Auth.jsx.
    if (Number(endYear) - Number(startYear) > MAX_SCHOOL_YEARS) {
      return `That's more than ${MAX_SCHOOL_YEARS} years in SACS — check the years are right.`
    }
    if (!country.trim()) return 'Select your country.'
    if (isSA && !province) return 'Select your province.'
    if (!city.trim()) return 'Enter your town or city.'
    if (!industry) return 'Select your industry.'
    if (industry === 'Other' && !customIndustry.trim()) return 'Tell us your industry.'
    if (!occupation.trim()) return 'Enter your occupation.'
    if (!COMMUNITY_ROLES.some((r) => roles[r.key])) {
      return 'Select at least one — how are you part of the SACS community?'
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
        phone: phone.trim(),
        country: country.trim(),
        province: isSA ? province : province.trim(),
        city: city.trim(),
        address_line1: address1.trim(),
        address_line2: address2.trim(),
        address_line3: address3.trim(),
        postal_code: postCode.trim(),
        industry: industry === 'Other' ? customIndustry.trim() : industry,
        occupation: occupation.trim(),
        ...(cityCoords ? { lat: cityCoords.lat, lng: cityCoords.lng } : {}),
        consented_at: new Date().toISOString(),
        details_completed_at: new Date().toISOString(),
      })
      .eq('id', session.user.id)
      .select()
      .single()
    if (err) {
      setBusy(false)
      setError(friendlyAuthError(err, "Couldn't save your details — please try again."))
      return
    }

    const { error: detErr } = await supabase
      .from('profile_details')
      .upsert({
        profile_id: session.user.id,
        title,
        date_of_birth: dob,
        ...Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, roles[r.key] === true])),
        comm_pref_email: newsOptIn === true,
        comm_pref_phone: commPrefPhone,
        comm_pref_sms: commPrefSms,
      })
    setBusy(false)
    if (detErr) { setError(friendlyAuthError(detErr, "Couldn't save your details — please try again.")); return }

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
        <p className="auth-sub">One more step to join</p>

        <p className="auth-verify-note">
          This is everything the committee needs to verify you against school
          records — all on one page, nothing left for later.
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
              <span>Title *</span>
              <div className="select-wrap">
                <select value={title} onChange={(e) => setTitle(e.target.value)}>
                  <option value="">Select</option>
                  {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </label>
            <label className="field">
              <span>Date of birth *</span>
              <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} autoComplete="bday" />
            </label>
          </div>

          <label className="field">
            <span>Cell number *</span>
            <PhoneInput value={phone} onChange={setPhone} />
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
              <span>Class of *</span>
              <div className="select-wrap">
                <select value={endYear} onChange={(e) => setEndYear(e.target.value)}>
                  <option value="">Year</option>
                  {END_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </label>
          </div>

          <div className="auth-field-row">
            <label className="field">
              <span>Industry *</span>
              <div className="select-wrap">
                <select value={industry} onChange={(e) => setIndustry(e.target.value)}>
                  <option value="">Select</option>
                  {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </label>
            <label className="field">
              <span>Occupation *</span>
              <input value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="e.g. Attorney, Student" />
            </label>
          </div>
          {industry === 'Other' && (
            <label className="field">
              <span>Your industry *</span>
              <input value={customIndustry} onChange={(e) => setCustomIndustry(e.target.value)} />
            </label>
          )}

          <p className="hint" style={{ marginTop: 4 }}>
            Your address is optional. It&rsquo;s used to place you on the alumni map
            and to post you reunion invitations, and it isn&rsquo;t displayed on
            your profile.
          </p>
          <label className="field">
            <span>Address line 1</span>
            <input value={address1} onChange={(e) => setAddress1(e.target.value)} autoComplete="address-line1" />
          </label>
          <label className="field">
            <span>Address line 2</span>
            <input value={address2} onChange={(e) => setAddress2(e.target.value)} autoComplete="address-line2" />
          </label>

          <div className="auth-field-row">
            <label className="field">
              <span>Country *</span>
              <CountryAutocomplete value={country} onChange={setCountry} />
            </label>
            {isSA ? (
              <label className="field">
                <span>Province *</span>
                <div className="select-wrap">
                  <select value={province} onChange={(e) => setProvince(e.target.value)}>
                    <option value="">Select</option>
                    {SA_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </label>
            ) : (
              <label className="field">
                <span>Province / region</span>
                <input value={province} onChange={(e) => setProvince(e.target.value)} />
              </label>
            )}
          </div>

          <div className="auth-field-row">
            <label className="field">
              <span>Town / city *</span>
              <CityAutocomplete
                value={city}
                country={country}
                onChange={setCity}
                onSelectCoords={setCityCoords}
                placeholder="Start typing your town&hellip;"
              />
            </label>
            <label className="field">
              <span>Post code</span>
              <input value={postCode} onChange={(e) => setPostCode(e.target.value)} autoComplete="postal-code" />
            </label>
          </div>

          <fieldset className="auth-consent-group">
            <legend>I&rsquo;m part of the SACS community as&hellip; * <span className="hint-inline">(pick all that apply)</span></legend>
            <div className="chip-toggle-row">
              {COMMUNITY_ROLES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={roles[r.key] ? 'chip-toggle on' : 'chip-toggle'}
                  aria-pressed={roles[r.key]}
                  onClick={() => setRoles((prev) => ({ ...prev, [r.key]: !prev[r.key] }))}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </fieldset>

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

          <fieldset className="auth-consent-group">
            <legend>You may also contact me via&hellip;</legend>
            <div className="chip-toggle-row">
              {[['phone', commPrefPhone, setCommPrefPhone, 'Phone'], ['sms', commPrefSms, setCommPrefSms, 'SMS']].map(
                ([key, val, setVal, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={val ? 'chip-toggle on' : 'chip-toggle'}
                    aria-pressed={val}
                    onClick={() => setVal(!val)}
                  >
                    {label}
                  </button>
                )
              )}
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

          <button type="submit" className="btn primary wide" disabled={busy || loadingDetails}>
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
