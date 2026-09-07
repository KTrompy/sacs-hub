// Subtle "Step X of 3" indicator — deliberately not a 4-dot wizard bar.
// The dots are decoration; the real progress statement lives in an
// sr-only live region so moving between steps is announced to a
// screen-reader user, same pattern the old Auth.jsx wizard used.
const STEP_LABELS = {
  1: 'Create your account',
  2: 'About you',
  3: 'Finish',
}

export default function OnboardingProgress({ step, total = 3 }) {
  return (
    <div className="acct-onb-progress">
      <div className="acct-onb-progress-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={`acct-onb-progress-dot ${step === n ? 'on' : ''} ${step > n ? 'done' : ''}`}
          />
        ))}
      </div>
      <span className="acct-onb-progress-label" aria-hidden="true">
        Step {step} of {total}
      </span>
      <p className="sr-only" role="status">
        Step {step} of {total}: {STEP_LABELS[step]}
      </p>
    </div>
  )
}
