// Shown exactly once — the moment `profile.approved` flips true and
// `onboarding_complete` hasn't been set yet (App.jsx flips it the instant
// either button here is pressed, so this can never appear a second time,
// same once-only guarantee the old silent-redirect version had).
//
// Deliberately not a straight drop onto Home or Profile: someone who's just
// been let in should feel welcomed before being handed a to-do list. Profile
// completion itself isn't part of this screen or of onboarding at all —
// "Complete my profile" just sends them to the real, permanent Profile
// page (with its own highlight-what's-missing system), not another wizard.
export default function ApprovalWelcome({ profile, onChoose }) {
  const name = (profile?.first_name || profile?.full_name || '').split(' ')[0]

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">Welcome to the SACS Alumni Hub</h1>
        <p className="auth-verify-note">
          {name ? `${name}, your` : 'Your'} account has been verified. Welcome to the community.
        </p>
        <p className="auth-verify-note">
          Let&rsquo;s finish your profile so other Old Boys can find and connect with you.
        </p>
        <button type="button" className="btn primary wide" onClick={() => onChoose('profile')}>
          Complete my profile
        </button>
        <button type="button" className="link-btn" onClick={() => onChoose('explore')}>
          Explore the community
        </button>
      </div>
    </div>
  )
}
