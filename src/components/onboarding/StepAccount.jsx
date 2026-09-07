import ClearableInput from '../ClearableInput.jsx'
import PasswordInput from '../PasswordInput.jsx'
import { PasswordStrengthMeter } from '../../passwordRules.jsx'

// Step 1 of 3 — Create your account.
//
// `requireCredentials` is false whenever there's already a session (Google,
// or a legacy account resuming mid-flow): those never see the
// email/password fields at all — just name fields, pre-filled from
// whatever the provider handed back and freely editable.
export default function StepAccount({ values, onChange, requireCredentials, fixedEmail }) {
  const set = (field) => (e) => onChange(field, e.target.value)

  return (
    <div className="acct-onb-step">
      <h2 className="auth-step-heading">Create your account</h2>
      <p className="auth-step-sub">Join the SACS Alumni community.</p>

      <div className="auth-field-row">
        <label className="field">
          <span>First name *</span>
          <ClearableInput
            value={values.firstName}
            onChange={set('firstName')}
            onClear={() => onChange('firstName', '')}
            autoComplete="given-name"
          />
        </label>
        <label className="field">
          <span>Last name *</span>
          <ClearableInput
            value={values.lastName}
            onChange={set('lastName')}
            onClear={() => onChange('lastName', '')}
            autoComplete="family-name"
          />
        </label>
      </div>

      <label className="field">
        <span>Preferred first name</span>
        <ClearableInput
          value={values.preferredName}
          onChange={set('preferredName')}
          onClear={() => onChange('preferredName', '')}
          placeholder="e.g. JP, Wikus"
        />
      </label>

      {requireCredentials ? (
        <>
          <label className="field">
            <span>Email *</span>
            <ClearableInput
              type="email"
              value={values.email}
              onChange={set('email')}
              onClear={() => onChange('email', '')}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Confirm email *</span>
            <ClearableInput
              type="email"
              value={values.confirmEmail}
              onChange={set('confirmEmail')}
              onClear={() => onChange('confirmEmail', '')}
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>Password *</span>
            <PasswordInput
              value={values.password}
              onChange={set('password')}
              placeholder="Choose a password"
              autoComplete="new-password"
            />
            <PasswordStrengthMeter password={values.password} />
          </label>
          <label className="field">
            <span>Confirm password *</span>
            <PasswordInput
              value={values.confirmPassword}
              onChange={set('confirmPassword')}
              placeholder="Type it again"
              autoComplete="new-password"
            />
          </label>
        </>
      ) : fixedEmail ? (
        <label className="field">
          <span>Email</span>
          <input value={fixedEmail} disabled className="acct-onb-fixed-field" />
        </label>
      ) : null}
    </div>
  )
}
