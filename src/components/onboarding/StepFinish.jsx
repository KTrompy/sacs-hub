import { SA_PROVINCES } from '../../constants.js'
import CountryAutocomplete from '../CountryAutocomplete.jsx'
import CityAutocomplete from '../CityAutocomplete.jsx'
import ClearableInput from '../ClearableInput.jsx'
import Turnstile from '../Turnstile.jsx'
import { PrivacyPolicyModal } from '../PrivacyPolicy.jsx'

// Step 3 of 3 — Almost there: location, communication preferences, consent.
// Deliberately light — everything here answers "why do I need to know this
// right now?" with either "so we can find you on the alumni map" or
// "because you have to actively consent to join". Nothing else.
export default function StepFinish({
  values, onChange, privacyOpen, onPrivacyOpenChange,
  onCaptchaToken, onCaptchaErrorChange, captchaResetSignal,
}) {
  const isSA = values.country.trim() === 'South Africa'

  return (
    <div className="acct-onb-step">
      <h2 className="auth-step-heading">Almost there</h2>

      <section className="acct-onb-section">
        <h2 className="acct-onb-section-title">Location</h2>
        <div className="auth-field-row">
          <label className="field">
            <span>Country *</span>
            <CountryAutocomplete value={values.country} onChange={(v) => onChange('country', v)} />
          </label>
          {isSA ? (
            <label className="field">
              <span>Province *</span>
              <div className="select-wrap">
                <select value={values.province} onChange={(e) => onChange('province', e.target.value)}>
                  <option value="">Select</option>
                  {SA_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </label>
          ) : (
            <label className="field">
              <span>Province / region</span>
              <ClearableInput
                value={values.province}
                onChange={(e) => onChange('province', e.target.value)}
                onClear={() => onChange('province', '')}
              />
            </label>
          )}
        </div>
        <label className="field">
          <span>City / town *</span>
          <CityAutocomplete
            value={values.city}
            country={values.country}
            onChange={(v) => onChange('city', v)}
            onSelectCoords={(c) => onChange('cityCoords', c)}
            placeholder="Start typing your town&hellip;"
          />
        </label>
        <p className="hint">Your address is optional and can be added later from your profile.</p>
        <div className="auth-field-row">
          <label className="field">
            <span>Address</span>
            <ClearableInput
              value={values.address}
              onChange={(e) => onChange('address', e.target.value)}
              onClear={() => onChange('address', '')}
              autoComplete="address-line1"
            />
          </label>
          <label className="field">
            <span>Postcode</span>
            <ClearableInput
              value={values.postCode}
              onChange={(e) => onChange('postCode', e.target.value)}
              onClear={() => onChange('postCode', '')}
              autoComplete="postal-code"
            />
          </label>
        </div>
      </section>

      <section className="acct-onb-section">
        <h2 className="acct-onb-section-title">Communication</h2>
        <fieldset className="auth-consent-group">
          <legend>Would you like to receive SACS news and event updates by email? *</legend>
          <div className="onboarding-choice-row">
            <button
              type="button"
              className={values.newsOptIn === true ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => onChange('newsOptIn', true)}
            >
              Yes
            </button>
            <button
              type="button"
              className={values.newsOptIn === false ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => onChange('newsOptIn', false)}
            >
              No
            </button>
          </div>
        </fieldset>
        <fieldset className="auth-consent-group">
          <legend>You may also contact me via&hellip;</legend>
          <div className="chip-toggle-row">
            {[
              ['commPrefPhone', 'Phone'],
              ['commPrefSms', 'SMS'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={values[key] ? 'chip-toggle on' : 'chip-toggle'}
                aria-pressed={values[key]}
                onClick={() => onChange(key, !values[key])}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="acct-onb-section">
        <h2 className="acct-onb-section-title">Privacy</h2>
        <label className="auth-consent-check">
          <input
            type="checkbox"
            checked={values.dataConsent}
            onChange={(e) => onChange('dataConsent', e.target.checked)}
          />
          <span>
            I consent to my personal data being stored and used to operate the
            SACS Alumni community, including essential communication about my
            account. *
          </span>
        </label>
        <p className="hint auth-privacy-link">
          <button type="button" className="link-btn" onClick={() => onPrivacyOpenChange(true)}>
            Read our Privacy Policy
          </button>
        </p>
        {privacyOpen && <PrivacyPolicyModal onClose={() => onPrivacyOpenChange(false)} />}

        <Turnstile
          onToken={onCaptchaToken}
          onErrorChange={onCaptchaErrorChange}
          resetSignal={captchaResetSignal}
          className="auth-captcha acct-onb-captcha"
        />
      </section>
    </div>
  )
}
