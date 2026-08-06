import { useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { useToast } from './Toast.jsx'
import useDiscardGuard from './useDiscardGuard.jsx'
import useModal from '../useModal.js'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'
import { EXPERTISE_OPTIONS, EXPERTISE_BY_INDUSTRY } from '../constants.js'
import { normalizeExpertise } from '../utils.js'

export const CADENCES = ['Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'As needed']
const DURATIONS = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '12 months' },
  { months: null, label: 'Open-ended' },
]

const MAX_MESSAGE = 1000

// Asking someone to mentor you (or offering to mentor someone) is a bigger
// ask than a message, so this modal makes the shape of the commitment
// explicit up front: what it's about, how often, for how long. Agreeing that
// before the first conversation is most of what stops a mentorship quietly
// evaporating after two weeks — and it gives the person answering enough to
// decide on, instead of a bare "will you mentor me?" with no scope attached.
export default function MentorshipRequestModal({ target, profile, asMentor = false, onClose, onSent }) {
  const showToast = useToast()

  // Pre-fill the focus areas from whatever both sides have already said.
  // When you're asking for a mentor, the sensible default is the overlap
  // between your goals and their expertise — the reason you clicked in the
  // first place. It stays fully editable.
  const [focus, setFocus] = useState(() => {
    const mine = normalizeExpertise(asMentor ? profile?.expertise : profile?.mentee_goals)
    const theirs = normalizeExpertise(asMentor ? target?.mentee_goals : target?.expertise)
    const theirSet = new Set(theirs.map((s) => s.toLowerCase()))
    const shared = mine.filter((s) => theirSet.has(s.toLowerCase()))
    return shared.slice(0, 4)
  })
  const [cadence, setCadence] = useState('Monthly')
  const [duration, setDuration] = useState(6)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const dirty = !!message.trim() || focus.length > 0

  const { requestClose, discardDialog } = useDiscardGuard({
    dirty: dirty && !busy,
    onDiscard: onClose,
    title: 'Discard this request?',
    message: "What you've written here won't be saved.",
    confirmLabel: 'Discard',
  })

  const modalRef = useModal({ onClose: requestClose, closeOnEscape: !busy })

  const firstName = (target?.full_name || '').trim().split(/\s+/)[0] || 'them'
  const options = EXPERTISE_BY_INDUSTRY[target?.industry] || EXPERTISE_OPTIONS

  async function submit() {
    if (!message.trim()) {
      setError('Add a short note — a request with no context is easy to say no to.')
      return
    }
    setBusy(true)
    setError(null)

    // Every transition goes through a SECURITY DEFINER function rather than a
    // direct insert: the rules (are they open to this, is there already a
    // pairing, capacity) belong next to the data, not in the client where a
    // second tab or a stale page can route around them.
    const { error: rpcErr } = await supabase.rpc('request_mentorship', {
      p_other: target.id,
      p_as_mentor: asMentor,
      p_message: message.trim().slice(0, MAX_MESSAGE),
      p_focus: focus,
      p_cadence: cadence,
      p_duration: duration,
    })

    if (rpcErr) {
      setError(friendlyError(rpcErr))
      setBusy(false)
      return
    }

    showToast(asMentor ? 'Offer sent!' : 'Request sent!')
    onSent?.()
    onClose()
  }

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={requestClose} role="dialog" aria-modal="true" aria-labelledby="mentorship-request-title">
        <form
          className="modal modal-mentorship"
          ref={modalRef}
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); if (!busy) submit() }}
          noValidate
        >
          <div className="modal-header">
            <h2 id="mentorship-request-title">
              {asMentor ? `Offer to mentor ${firstName}` : `Ask ${firstName} to be your mentor`}
            </h2>
            <button type="button" className="modal-close" onClick={requestClose} aria-label="Close">×</button>
          </div>

          <div className="modal-body">
            <p className="apply-modal-hint">
              {asMentor
                ? `${firstName} will get your offer and can accept or decline. Nothing is shared with anyone else.`
                : `${firstName} will get your request and can accept or decline. Nothing is shared with anyone else.`}
            </p>

            <label className="field">
              <span>What should this focus on?</span>
              <MultiSelectAutocomplete
                values={focus}
                onChange={setFocus}
                options={options}
                placeholder="Search areas, or type your own"
                allowCustom
              />
              <span className="hint">Pick a few. Vague mentorships are the ones that fizzle out.</span>
            </label>

            <div className="field">
              <span>How often would you meet?</span>
              <div className="tags-grid compact">
                {CADENCES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`tag-btn ${cadence === c ? 'selected' : ''}`}
                    onClick={() => setCadence(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span>For how long?</span>
              <div className="tags-grid compact">
                {DURATIONS.map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    className={`tag-btn ${duration === d.months ? 'selected' : ''}`}
                    onClick={() => setDuration(d.months)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <span className="hint">
                An end date isn&rsquo;t a deadline — it&rsquo;s permission for both of you to stop without it feeling
                like a failure. You can always agree to carry on.
              </span>
            </div>

            <label className="field">
              <span>Your note</span>
              <textarea
                className="apply-modal-textarea"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
                placeholder={asMentor
                  ? `Why you'd like to help, and what you could offer ${firstName}.`
                  : `What you're working on, and why you're asking ${firstName} specifically.`}
                rows={5}
              />
              <span className="apply-modal-counter">{message.length} / {MAX_MESSAGE}</span>
            </label>

            {error && <p className="form-error">{error}</p>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn ghost" onClick={requestClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Sending…' : (asMentor ? 'Send offer' : 'Send request')}
            </button>
          </div>
        </form>
      </div>
      {discardDialog}
    </>,
    document.body
  )
}

// The RPC raises named exceptions with SQLSTATEs chosen so the client can
// tell "you already have one of these" apart from "they closed their door"
// without string-matching the message text.
export function friendlyError(err) {
  const code = err?.code
  const msg = err?.message || ''
  if (code === '23505' || msg.includes('already have a request')) {
    return 'You already have a request or an active mentorship with this member.'
  }
  if (msg.includes('AT_CAPACITY')) {
    return 'This mentor is already at their limit of active mentorships.'
  }
  if (code === '54000') return msg.replace(/^.*?:\s*/, '')
  if (code === '42501') return msg || 'You don’t have permission to do that.'
  return msg || 'Something went wrong — please try again.'
}
