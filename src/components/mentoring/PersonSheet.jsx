import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { Avatar } from '../Directory.jsx'
import useModal from '../../useModal.js'
import MultiSelectAutocomplete from '../MultiSelectAutocomplete.jsx'
import { EXPERTISE_OPTIONS, EXPERTISE_BY_INDUSTRY } from '../../constants.js'
import { normalizeExpertise, safeUrl } from '../../utils.js'
import { mentorAvailability } from '../../mentorMatch.js'
import { firstName, friendlyError, CADENCE_OPTIONS, EXPECTED_LENGTH_OPTIONS } from './data.js'

// The profile sheet + the whole Connect commitment ladder in one component,
// because they're one continuous piece of screen real estate to the person
// using it — closing the sheet mid-request should feel like closing one
// thing, not backing out of a nested flow.
//
// `mode` is which chair the *other* person is sitting in: 'mentor' (they can
// help you) or 'mentee' (you can help them) — same convention the old
// Mentoring.jsx used, kept because it maps directly onto request_mentorship's
// p_as_mentor.
export default function PersonSheet({
  person, me, mode, existingMentorship, existingConnection,
  savedIds, onToggleSaved, onClose, onSent, showToast,
}) {
  const [view, setView] = useState('profile') // profile | ladder | question | conversation | mentorship | sent
  const modalRef = useModal({ onClose })
  const avail = mentorAvailability(person, person.mentoringProfile)
  const name = person.full_name || 'Member'
  const roleLine = person.occupation && person.company ? `${person.occupation} · ${person.company}` : (person.occupation || person.company || '')
  const isMentorMode = mode === 'mentor'
  const isSaved = savedIds?.has(person.id)

  function afterSent(message) {
    setView('sent')
    showToast?.(message)
    onSent?.()
  }

  return createPortal(
    <div className="mtg-sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mtg-sheet" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="mtg-sheet-close" onClick={onClose} aria-label="Close">×</button>

        {view === 'profile' && (
          <>
            <div className="mtg-sheet-hero">
              <Avatar url={person.avatar_url} name={name} size={88} />
              <h2>{name}</h2>
              <p>{roleLine}</p>
              <p>
                {[person.grad_year && `Class of ${person.grad_year}`, person.city].filter(Boolean).join(' · ')}
              </p>
            </div>

            <div className="mtg-sheet-primary">
              {existingMentorship ? (
                <p className="hint" style={{ textAlign: 'center' }}>
                  {existingMentorship.status === 'active' ? 'Mentorship under way' :
                    existingMentorship.status === 'discussing' ? 'Discussing terms' : 'Request pending'}
                </p>
              ) : existingConnection ? (
                <p className="hint" style={{ textAlign: 'center' }}>
                  {existingConnection.status === 'sent' ? 'Waiting on their reply' : 'Already in touch'}
                </p>
              ) : (
                <button type="button" className="btn primary" style={{ width: '100%' }} onClick={() => setView('ladder')}>
                  Connect
                </button>
              )}
              <button
                type="button"
                className="link-btn subtle"
                style={{ display: 'block', margin: '10px auto 0' }}
                onClick={() => onToggleSaved?.(person.id, !isSaved)}
              >
                {isSaved ? '♥ Saved' : '♡ Save for later'}
              </button>
            </div>

            <div className="mtg-sheet-body">
              {person.match?.reasons?.length > 0 && (
                <div className="mtg-sheet-why">
                  <h3>Why we think you should meet</h3>
                  <ul>
                    {person.match.reasons.map((r) => <li key={r.key}>{r.label}</li>)}
                  </ul>
                </div>
              )}

              {person.bio && (
                <div className="mtg-sheet-section">
                  <h3>About</h3>
                  <p>{person.bio}</p>
                </div>
              )}

              {isMentorMode && normalizeExpertise(person.expertise).length > 0 && (
                <div className="mtg-sheet-section">
                  <h3>How I can help</h3>
                  <div className="mentor-card-tags">
                    {normalizeExpertise(person.expertise).map((e) => <span key={e} className="mentor-tag">{e}</span>)}
                  </div>
                </div>
              )}

              {!isMentorMode && normalizeExpertise(person.mentee_goals).length > 0 && (
                <div className="mtg-sheet-section">
                  <h3>Would value help with</h3>
                  <div className="mentor-card-tags">
                    {normalizeExpertise(person.mentee_goals).map((e) => <span key={e} className="mentor-tag">{e}</span>)}
                  </div>
                </div>
              )}

              <div className="mtg-sheet-section">
                <h3>Availability</h3>
                {isMentorMode ? (
                  <p className="hint">
                    {avail.paused ? 'Mentorship slots currently paused' :
                      avail.hasRoom ? `Open for mentorship (${avail.spotsLeft} slot${avail.spotsLeft === 1 ? '' : 's'} left)` :
                      'Mentorship slots currently full'}
                    {(avail.quickQuestions || avail.conversations) && ' · '}
                    {avail.quickQuestions && 'Quick questions'}
                    {avail.quickQuestions && avail.conversations && ' · '}
                    {avail.conversations && 'Conversations'}
                  </p>
                ) : (
                  <p className="hint">Looking for a mentor</p>
                )}
              </div>

              <div className="mtg-sheet-section">
                <Link to={`/people/${person.id}`} className="link-btn">View full profile</Link>
                {safeUrl(person.linkedin_url) && (
                  <a href={safeUrl(person.linkedin_url)} target="_blank" rel="noopener noreferrer" className="link-btn" style={{ marginLeft: 16 }}>
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          </>
        )}

        {view === 'ladder' && (
          <div className="mtg-sheet-body" style={{ paddingTop: 'var(--sp-7)' }}>
            <h2 style={{ fontFamily: 'var(--display)', color: 'var(--maroon)' }}>How would you like to connect?</h2>
            <div className="mtg-ladder">
              <button type="button" className="mtg-ladder-option" disabled={!avail.quickQuestions} onClick={() => setView('question')}>
                <strong>Ask a quick question</strong>
                <span>Best for something specific.</span>
              </button>
              <button type="button" className="mtg-ladder-option" disabled={!avail.conversations} onClick={() => setView('conversation')}>
                <strong>Have a conversation</strong>
                <span>Suggest a one-off conversation.</span>
              </button>
              <button
                type="button"
                className="mtg-ladder-option"
                disabled={isMentorMode ? avail.paused : false}
                onClick={() => setView('mentorship')}
              >
                <strong>Explore mentorship</strong>
                <span>Start an ongoing mentoring relationship.</span>
              </button>
            </div>
          </div>
        )}

        {view === 'question' && (
          <QuickAskForm
            person={person} kind="question"
            onBack={() => setView('ladder')} onSent={afterSent}
          />
        )}
        {view === 'conversation' && (
          <QuickAskForm
            person={person} kind="conversation"
            onBack={() => setView('ladder')} onSent={afterSent}
          />
        )}
        {view === 'mentorship' && (
          <MentorshipRequestWizard
            person={person} me={me} asMentor={!isMentorMode}
            onBack={() => setView('ladder')} onSent={afterSent}
          />
        )}

        {view === 'sent' && (
          <div className="mtg-sheet-body" style={{ paddingTop: 'var(--sp-8)', textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--display)', color: 'var(--maroon)' }}>Sent</h2>
            <p className="hint">{firstName(name)} will get this and can reply from their end.</p>
            <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function QuickAskForm({ person, kind, onBack, onSent }) {
  const [message, setMessage] = useState('')
  const [duration, setDuration] = useState(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const name = firstName(person.full_name)

  async function submit() {
    if (!message.trim()) { setError('Add a message.'); return }
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('send_mentoring_connection', {
      p_recipient: person.id,
      p_kind: kind,
      p_message: message.trim(),
      p_duration: kind === 'conversation' ? duration : null,
    })
    setBusy(false)
    if (rpcErr) { setError(friendlyError(rpcErr)); return }
    onSent(kind === 'question' ? `Question sent to ${name}.` : `Suggested a conversation with ${name}.`)
  }

  return (
    <div className="mtg-sheet-body" style={{ paddingTop: 'var(--sp-7)' }}>
      <h2 style={{ fontFamily: 'var(--display)', color: 'var(--maroon)' }}>
        {kind === 'question' ? `Ask ${name}` : `Suggest a conversation with ${name}`}
      </h2>

      {kind === 'question' ? (
        <label className="field">
          <span>What would you like to ask?</span>
          <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} placeholder="Be specific — specific questions are much easier to answer." />
        </label>
      ) : (
        <>
          <label className="field">
            <span>What would you like to talk about?</span>
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 2000))} placeholder={`What you'd value hearing about from ${name}.`} />
          </label>
          <div className="field">
            <span>How long?</span>
            <div className="tags-grid compact">
              {[20, 30, 45].map((m) => (
                <button key={m} type="button" className={`tag-btn ${duration === m ? 'selected' : ''}`} onClick={() => setDuration(m)}>{m} min</button>
              ))}
            </div>
          </div>
        </>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="mentoring-form-actions" style={{ justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}>
        <button type="button" className="btn ghost" onClick={onBack} disabled={busy}>Back</button>
        <button type="button" className="btn primary" onClick={submit} disabled={busy || !message.trim()}>
          {busy ? 'Sending…' : (kind === 'question' ? 'Send question' : 'Suggest conversation')}
        </button>
      </div>
    </div>
  )
}

function MentorshipRequestWizard({ person, me, asMentor, onBack, onSent }) {
  const [step, setStep] = useState(1)
  const [purpose, setPurpose] = useState('')
  const [focus, setFocus] = useState(() => {
    const mine = normalizeExpertise(asMentor ? me?.expertise : me?.mentee_goals)
    const theirs = normalizeExpertise(asMentor ? person?.mentee_goals : person?.expertise)
    const theirSet = new Set(theirs.map((s) => s.toLowerCase()))
    return mine.filter((s) => theirSet.has(s.toLowerCase())).slice(0, 3)
  })
  const [cadence, setCadence] = useState('')
  const [expectedLength, setExpectedLength] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const name = firstName(person.full_name)
  const options = EXPERTISE_BY_INDUSTRY[person?.industry] || EXPERTISE_OPTIONS

  async function submit() {
    if (!purpose.trim()) { setError('Say what you\'re hoping to get from this.'); return }
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('request_mentorship', {
      p_other: person.id,
      p_as_mentor: asMentor,
      p_message: purpose.trim(),
      p_focus: focus,
      p_cadence: cadence,
      p_expected_length: expectedLength,
    })
    setBusy(false)
    if (rpcErr) { setError(friendlyError(rpcErr)); return }
    onSent(asMentor ? `Offer sent to ${name}.` : `Request sent to ${name}.`)
  }

  const steps = 3
  return (
    <div className="mtg-wizard-step mtg-sheet-body" style={{ paddingTop: 'var(--sp-7)' }}>
      <div className="mtg-wizard-progress">
        {Array.from({ length: steps }).map((_, i) => <span key={i} className={i < step ? 'done' : ''} />)}
      </div>

      {step === 1 && (
        <>
          <h2>What are you hoping to get from this mentorship?</h2>
          <p className="hint">Be specific. The best requests explain where you are now and what you're hoping to change.</p>
          <textarea rows={5} value={purpose} onChange={(e) => setPurpose(e.target.value.slice(0, 1000))} placeholder={asMentor ? `Why you'd like to help ${name}, and what you could offer.` : `What you're working on, and why you're asking ${name} specifically.`} />
        </>
      )}

      {step === 2 && (
        <>
          <h2>What would you mainly work on together?</h2>
          <p className="hint">Pick up to three.</p>
          <MultiSelectAutocomplete values={focus} onChange={(v) => setFocus(v.slice(0, 3))} options={options} placeholder="Search areas, or type your own" allowCustom />
        </>
      )}

      {step === 3 && (
        <>
          <h2>What kind of rhythm are you imagining?</h2>
          <div className="mtg-choice-grid">
            {CADENCE_OPTIONS.map((c) => (
              <button key={c} type="button" className={`mtg-choice-card ${cadence === c ? 'on' : ''}`} onClick={() => setCadence(c)}>{c}</button>
            ))}
          </div>
          <h2 style={{ marginTop: 'var(--sp-5)' }}>How long do you expect you'll need?</h2>
          <div className="mtg-choice-grid">
            {EXPECTED_LENGTH_OPTIONS.map((o) => (
              <button key={o.value} type="button" className={`mtg-choice-card ${expectedLength === o.value ? 'on' : ''}`} onClick={() => setExpectedLength(o.value)}>{o.label}</button>
            ))}
          </div>
          <p className="hint">This isn't a contract — it's just something to plan around.</p>
        </>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="mentoring-form-actions" style={{ justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}>
        <button type="button" className="btn ghost" onClick={() => (step === 1 ? onBack() : setStep(step - 1))} disabled={busy}>Back</button>
        {step < steps ? (
          <button type="button" className="btn primary" onClick={() => setStep(step + 1)} disabled={step === 1 && !purpose.trim()}>Continue</button>
        ) : (
          <button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : (asMentor ? 'Send offer' : 'Send request')}</button>
        )}
      </div>
    </div>
  )
}
