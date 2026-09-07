import { completionPercent, missingCompletionFields, COMPLETION_FIELD_LABELS, COMPLETION_FIELD_SECTION } from '../../profileCompletion.js'

// The redesigned presentation of the existing profile-completion system —
// same ten COMPLETION_FIELDS, same percentage math as Home.jsx's progress
// ring (see profileCompletion.js), just shown as a proper card at the top
// of Edit Profile instead of only living on Home. Clicking a missing item
// jumps straight to the field that needs it.
export default function ProfileCompletionCard({ profile, onJumpToField }) {
  const pct = completionPercent(profile)
  const missing = missingCompletionFields(profile)
  const complete = pct >= 100

  return (
    <div className="pe-completion-card" id="pe-section-overview-completion">
      <div className="pe-completion-head">
        <span className="pe-completion-label">Profile completion</span>
        <span className="pe-completion-pct">{pct}%</span>
      </div>
      <div className="pe-completion-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="pe-completion-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {complete ? (
        <p className="pe-completion-sub">Nice — your profile is complete.</p>
      ) : (
        <>
          <p className="pe-completion-sub">
            {missing.length} {missing.length === 1 ? 'item' : 'items'} remaining
          </p>
          <ul className="pe-completion-missing">
            {missing.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="pe-completion-missing-item"
                  onClick={() => onJumpToField(key, COMPLETION_FIELD_SECTION[key])}
                >
                  {COMPLETION_FIELD_LABELS[key]}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
