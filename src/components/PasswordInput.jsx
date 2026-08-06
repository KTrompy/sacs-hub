import { useState } from 'react'

// A password field with a show/hide toggle.
//
// Every password field in the app used to be a bare <input type="password">
// with no way to see what you'd typed. On a phone keyboard that's the single
// biggest cause of "my password is wrong" when it isn't — and it's why the
// signup wizard needs a "confirm password" field at all.
//
// The toggle is a real <button type="button"> (not a checkbox or a div) so it
// can't submit the form, is reachable by keyboard, and announces its state.
// It's excluded from the tab order deliberately: tabbing from "Password" should
// land on "Confirm password", not on a toggle. It's still clickable, and
// screen-reader users reach it in browse mode.
export default function PasswordInput({ id, value, onChange, placeholder, autoComplete = 'current-password', ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="pw-input-wrap">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        {...props}
      />
      <button
        type="button"
        className="pw-reveal"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.8 12S5.5 5.5 12 5.5 22.2 12 22.2 12 18.5 18.5 12 18.5 1.8 12 1.8 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 5.7a9.6 9.6 0 0 1 2.1-.2c6.5 0 10.2 6.5 10.2 6.5a17.6 17.6 0 0 1-2.9 3.8" />
      <path d="M6.3 6.4A17.4 17.4 0 0 0 1.8 12S5.5 18.5 12 18.5a9.9 9.9 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  )
}
