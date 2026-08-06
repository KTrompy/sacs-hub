import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import useModal from '../useModal.js'

// Human-readable labels for the same COMPLETION_FIELDS Home.jsx scores
// against — kept here rather than exported from Home.jsx since this is the
// only place that needs to show them to a person rather than just count them.
const FIELD_LABELS = {
  avatar_url: 'Add a profile photo',
  bio: 'Write a short bio',
  occupation: 'Add your occupation',
  company: 'Add your company',
  city: 'Add your city',
  country: 'Add your country',
  grad_year: 'Add your graduation year',
  degree: 'Add your degree',
  industry: 'Add your industry',
  linkedin_url: 'Link your LinkedIn',
}

// A once-a-day, dismissible nudge for anyone whose profile is still
// incomplete — sits on top of the always-present Home banner rather than
// replacing it. The banner alone turned out to be easy to miss (people
// scanning straight past it to the feed), so this repeats the same CTA as
// a modal the first time someone lands on Home each day, then gets out of
// the way. Not a hard gate: Escape, the backdrop, and "Not now" all close
// it, and dismissing doesn't touch the field values themselves — only the
// once-a-day localStorage timestamp deciding whether to show again next visit.
export default function CompleteProfilePrompt({ missing, onDismiss }) {
  const navigate = useNavigate()
  const modalRef = useModal({ onClose: onDismiss, history: false })

  const labels = missing.map((f) => FIELD_LABELS[f]).filter(Boolean)

  return createPortal(
    <div className="modal-backdrop" onClick={onDismiss} role="dialog" aria-modal="true" aria-labelledby="complete-profile-title">
      <div className="modal modal-confirm" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="complete-profile-title">Finish setting up your profile</h2>
          <button type="button" className="modal-close" onClick={onDismiss} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <p>A few things are still missing, so other Old Boys see less of who you are:</p>
          <ul className="profile-nudge-list">
            {labels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn ghost" data-autofocus onClick={onDismiss}>Not now</button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              onDismiss()
              navigate('/profile', { state: { highlightMissing: true, focusFirst: true } })
            }}
          >
            Complete your profile
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
