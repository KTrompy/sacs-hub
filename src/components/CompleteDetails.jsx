import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { INDUSTRIES, TITLES, SA_PROVINCES, COMMUNITY_ROLES } from '../constants.js'
import CityAutocomplete from './CityAutocomplete.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import PhoneInput from './PhoneInput.jsx'

// Step 2 of joining — shown (full-screen, between the consent gate and the
// approval gate in App.jsx) to anyone whose profile has no
// details_completed_at yet. Email and Google joiners both land here right
// after consent, so the committee's required membership details are captured
// once, in one place, before the account enters the verification queue.
//
// The old site asked for all of this (and more) inside one endless signup
// form, with five separate yes/no dropdowns for the community roles. Here
// it's a single screen with one multi-select for the roles, and everything
// not on it (address lines, ID number, languages, …) stays optional on the
// profile page after approval.
const MIN_AGE = 5
const MAX_AGE = 120

export default function CompleteDetails({ session, profile, onDone }) {
  const [title, setTitle] = useState('')
  const [dob, setDob] = useState('')
  const [phone, setPhone] = useState(profile.phone || '')
  const [country, setCountry] = useState(profile.country || 'South Africa')
  const [province, setProvince] = useState(profile.province || '')
  const [city, setCity] = useState(profile.city || '')
  const [cityCoords, setCityCoords] = useState(null)
  const [industry, setIndustry] = useState(
    INDUSTRIES.includes(profile.industry) ? profile.industry : (profile.industry ? 'Other' : '')
  )
  const [customIndustry, setCustomIndustry] = useState(
    INDUSTRIES.includes(profile.industry) ? '' : (profile.industry || '')
  )
  const [occupation, setOccupation] = useState(profile.occupation || '')
  const [roles, setRoles] = useState(() => Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, false])))
  const [comms, setComms] = useState({
    email: profile.email_news_opt_in === true,
    phone: false,
    sms: false,
  })
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const isSA = country === 'South Africa'

  // A profile_details row may already exist (someone who half-filled the
  // profile page before this screen shipped) — prefill rather than clobber.
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
          setComms({
            email: data.comm_pref_email === true,
            phone: data.comm_pref_phone === true,
            sms: data.comm_pref_sms === true,
          })
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [session.user.id])

  function validate() {
    if (!title) return 'Select your title.'
    if (!dob) return 'Enter your date of birth.'
    const d = new Date(dob)
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
    if (Number.isNaN(d.getTime()) || age < MIN_AGE || age > MAX_AGE) {
      return 'That date of birth doesn’t look right — please check it.'
    }
    if (!phone.trim() || phone.trim().replace(/\D/g, '').length < 6) return 'Enter your cell number.'
    if (!country.trim()) return 'Select your country.'
    if (isSA && !province) return 'Select your province.'
    if (!city.trim()) return 'Enter your town or city.'
    if (!industry) return 'Select your industry.'
    if (industry === 'Other' && !customIndustry.trim()) return 'Tell us your industry.'
    if (!occupation.trim()) return 'Enter your occupation.'
    if (!COMMUNITY_ROLES.some((r) => roles[r.key])) {
      return 'Select at least one — how are you part of the SACS community?'
    }
    return null
  }

  async function save(e) {
    e.preventDefault()
    const problem = validate()
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)

    const profilePayload = {
      phone: phone.trim(),
      country: country.trim(),
      province: isSA ? province : province.trim(),
      city: city.trim(),
      industry: industry === 'Other' ? customIndustry.trim() : industry,
      occupation: occupation.trim(),
      // Keep the step-1 email answer in sync with the channels chosen here.
      email_news_opt_in: comms.email,
      details_completed_at: new Date().toISOString(),
    }
    // Picked from the suggestions dropdown — a confirmed, geocodable place,
    // so the Alumni Map pin can be set right away instead of waiting for the
    // person's first profile edit.
    if (cityCoords) {
      profilePayload.lat = cityCoords.lat
      profilePayload.lng = cityCoords.lng
    }

    const { data, error: err } = await supabase
      .from('profiles')
      .update(profilePayload)
      .eq('id', session.user.id)
      .select()
      .single()
    if (err) {
      setBusy(false)
      setError('Couldn’t save your details — please try again.')
      return
    }

    const { error: detErr } = await supabase
      .from('profile_details')
      .upsert({
        profile_id: session.user.id,
        title,
        date_of_birth: dob,
        ...Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, roles[r.key] === true])),
        comm_pref_email: comms.email,
        comm_pref_phone: comms.phone,
        comm_pref_sms: comms.sms,
      })
    setBusy(false)
    if (detErr) { setError('Couldn’t save your details — please try again.'); return }
    onDone(data)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">Your details</h1>
        <p className="auth-sub">Step 2 of 2 &mdash; then you&rsquo;re in the queue</p>
        <p className="auth-verify-note">
          These details complete your membership record. Everything else on
          your profile is optional and can be filled in any time after
          you&rsquo;re approved.
        </p>

        <form onSubmit={save} noValidate>
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
            <legend>You may contact me via&hellip;</legend>
            <div className="chip-toggle-row">
              {[['email', 'Email'], ['phone', 'Phone'], ['sms', 'SMS']].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={comms[key] ? 'chip-toggle on' : 'chip-toggle'}
                  aria-pressed={comms[key]}
                  onClick={() => setComms((prev) => ({ ...prev, [key]: !prev[key] }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button type="submit" className="btn primary wide" disabled={busy || loading}>
            {busy ? 'Saving…' : 'Finish joining'}
          </button>
        </form>

        <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
