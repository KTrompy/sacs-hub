// Single source of truth for password rules and the strength meter.
//
// These used to disagree across three screens: Auth.jsx required 8
// characters at signup, while ResetPassword.jsx and Settings.jsx both
// accepted 6. So anyone could sign up with a strong password and then
// immediately weaken it below the signup minimum via "forgot password" —
// the strictest gate was the one people passed through once, and the
// loosest were the ones they could come back to any time.
//
// The strength meter lived in Auth.jsx and only ever appeared at signup,
// for the same reason: nothing else could import it without pulling in the
// whole auth page. It lives here now so every screen that takes a password
// shows the same feedback.

export const PASSWORD_MIN = 8

// Rough client-side strength score, 0..4 — mirrors the usual zxcvbn-style
// buckets without pulling in a library. Server-side rules (min length etc.)
// still apply regardless of what this says.
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '', percent: 0 }
  let score = 0
  if (pw.length >= PASSWORD_MIN) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^a-zA-Z0-9]/.test(pw)) score++
  score = Math.min(4, score)
  const labels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  return { score, label: labels[score], percent: (score / 4) * 100 }
}

// The one message every screen shows when a password is too short, so the
// wording can't drift either.
export const PASSWORD_TOO_SHORT = `Password must be at least ${PASSWORD_MIN} characters.`

// A pure length check let eight spaces through as a "valid" password on
// every screen. Callers should use this instead of testing `.length`
// directly, so the whitespace rule can't drift back apart the way the
// minimum length once did.
export function passwordProblem(pw, { emptyMessage = 'Choose a password.' } = {}) {
  if (!pw) return emptyMessage
  if (pw.length < PASSWORD_MIN) return PASSWORD_TOO_SHORT
  if (!pw.trim()) return 'Your password can’t be made up only of spaces.'
  return null
}

// Shared strength-meter markup. Renders nothing for an empty field so
// callers can drop it in unconditionally.
export function PasswordStrengthMeter({ password }) {
  if (!password) return null
  const { score, label, percent } = passwordStrength(password)
  return (
    <div className="pw-strength">
      <div className="pw-strength-bar">
        <div className={`pw-strength-fill s${score}`} style={{ width: `${percent}%` }} />
      </div>
      <span className="pw-strength-label">{label}</span>
    </div>
  )
}
