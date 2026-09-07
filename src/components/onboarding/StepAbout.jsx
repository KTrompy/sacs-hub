import { TITLES, COMMUNITY_ROLES } from '../../constants.js'
import PhoneInput from '../PhoneInput.jsx'

// SACS was founded in 1829 — nobody can have started before that. End years
// allow a few years into the future so current residents can pick their
// expected final year. Same ranges the old wizard used.
const FOUNDING_YEAR = 1829
const THIS_YEAR = new Date().getFullYear()
const START_YEARS = []
for (let y = THIS_YEAR; y >= FOUNDING_YEAR; y--) START_YEARS.push(y)
const END_YEARS = []
for (let y = THIS_YEAR + 7; y >= FOUNDING_YEAR; y--) END_YEARS.push(y)

// Step 2 of 3 — Tell us about yourself. This is what the committee checks
// against school records. Industry/occupation are deliberately not asked
// here any more — see Profile.jsx's post-approval completion prompts.
export default function StepAbout({ values, onChange }) {
  function toggleRole(key) {
    onChange('roles', { ...values.roles, [key]: !values.roles[key] })
  }

  return (
    <div className="acct-onb-step">
      <h2 className="auth-step-heading">Tell us about yourself</h2>
      <p className="auth-step-sub">We use these details to verify your connection to SACS.</p>

      <div className="auth-field-row">
        <label className="field">
          <span>Title *</span>
          <div className="select-wrap">
            <select value={values.title} onChange={(e) => onChange('title', e.target.value)}>
              <option value="">Select</option>
              {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </label>
        <label className="field">
          <span>Date of birth *</span>
          <input
            type="date"
            value={values.dob}
            onChange={(e) => onChange('dob', e.target.value)}
            autoComplete="bday"
          />
        </label>
      </div>

      <label className="field">
        <span>Cell number</span>
        <PhoneInput value={values.phone} onChange={(v) => onChange('phone', v)} />
      </label>

      <div className="auth-field-row">
        <label className="field">
          <span>From *</span>
          <div className="select-wrap">
            <select value={values.startYear} onChange={(e) => onChange('startYear', e.target.value)}>
              <option value="">Year</option>
              {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </label>
        <label className="field">
          <span>Class of *</span>
          <div className="select-wrap">
            <select value={values.endYear} onChange={(e) => onChange('endYear', e.target.value)}>
              <option value="">Year</option>
              {END_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </label>
      </div>

      <fieldset className="auth-consent-group">
        <legend>I&rsquo;m part of the SACS community as&hellip; * <span className="hint-inline">(pick all that apply)</span></legend>
        <div className="chip-toggle-row">
          {COMMUNITY_ROLES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={values.roles[r.key] ? 'chip-toggle on' : 'chip-toggle'}
              aria-pressed={values.roles[r.key]}
              onClick={() => toggleRole(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
