import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { Avatar } from '../Directory.jsx'
import LoadingState from '../LoadingState.jsx'
import EmptyState from '../EmptyState.jsx'
import MultiSelectAutocomplete from '../MultiSelectAutocomplete.jsx'
import { EXPERTISE_BY_INDUSTRY, EXPERTISE_OPTIONS } from '../../constants.js'
import {
  firstName, fmtDate, fmtDateTime, friendlyError, mentorshipHealth, HEALTH_LABEL,
  myRole, otherId, loadWorkspaceData, CADENCE_OPTIONS, EXPECTED_LENGTH_OPTIONS, EXPECTED_LENGTH_LABEL,
  OUTCOME_OPTIONS, CHECKIN_OPTIONS,
} from './data.js'

// One mentorship, start to finish. What renders here depends entirely on
// status — a pending request, a counter-proposal waiting on someone, the
// live workspace, or the closing summary — rather than five separate pages,
// because a person only ever cares about the one state their relationship
// is actually in right now.
export default function Workspace(props) {
  const { me, myId, people, mentorships, reload, showToast } = props
  const { id } = useParams()
  const navigate = useNavigate()
  const mentorship = useMemo(() => mentorships.find((m) => String(m.id) === String(id)), [mentorships, id])
  const other = useMemo(() => (mentorship ? people.find((p) => p.id === otherId(mentorship, myId)) : null), [mentorship, people, myId])

  if (!mentorship) {
    return <EmptyState icon="search" message="Couldn't find that mentorship" actionLabel="Back to Relationships" onAction={() => navigate('/mentoring/relationships')} />
  }

  const role = myRole(mentorship, myId)
  const mine = mentorship.initiated_by === myId

  return (
    <div>
      <div className="mtg-workspace-head">
        <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'center' }}>
          <Avatar url={other?.avatar_url} name={other?.full_name} size={56} />
          <div>
            <h2 style={{ fontFamily: 'var(--display)', color: 'var(--maroon)', margin: 0 }}>{other?.full_name || 'Member'}</h2>
            <p className="hint" style={{ margin: 0 }}>{role === 'mentor' ? 'You are mentoring them' : 'They are mentoring you'}</p>
          </div>
        </div>
        <Link to="/mentoring/relationships" className="link-btn">All relationships</Link>
      </div>

      {mentorship.status === 'pending' && (
        <RequestReview mentorship={mentorship} other={other} mine={mine} reload={reload} showToast={showToast} navigate={navigate} />
      )}
      {mentorship.status === 'discussing' && (
        <DiscussingView mentorship={mentorship} other={other} mine={mine} reload={reload} showToast={showToast} />
      )}
      {mentorship.status === 'active' && (
        <ActiveWorkspace mentorship={mentorship} other={other} myId={myId} role={role} reload={reload} showToast={showToast} />
      )}
      {(mentorship.status === 'completed' || mentorship.status === 'ended') && (
        <CompletionView mentorship={mentorship} other={other} />
      )}
      {(mentorship.status === 'declined' || mentorship.status === 'cancelled') && (
        <ClosedStatusView mentorship={mentorship} other={other} />
      )}
    </div>
  )
}

function AgreementSummary({ mentorship }) {
  return (
    <div className="mtg-agreement" style={{ marginBottom: 'var(--sp-6)' }}>
      {mentorship.focus?.length > 0 && (
        <div className="mtg-agreement-field">
          <span className="mtg-agreement-field-label">Focus</span>
          <span>{mentorship.focus.join(', ')}</span>
        </div>
      )}
      {mentorship.cadence && (
        <div className="mtg-agreement-field">
          <span className="mtg-agreement-field-label">Rhythm</span>
          <span>{mentorship.cadence}</span>
        </div>
      )}
      {mentorship.expected_length && (
        <div className="mtg-agreement-field">
          <span className="mtg-agreement-field-label">Expected length</span>
          <span>{EXPECTED_LENGTH_LABEL[mentorship.expected_length] || mentorship.expected_length}</span>
        </div>
      )}
    </div>
  )
}

function RequestReview({ mentorship: m, other, mine, reload, showToast, navigate }) {
  const [view, setView] = useState('review') // review | suggest | decline
  const [message, setMessage] = useState('')
  const [cadence, setCadence] = useState(m.cadence || '')
  const [expectedLength, setExpectedLength] = useState(m.expected_length || '')
  const [focus, setFocus] = useState(m.focus || [])
  const [declineReason, setDeclineReason] = useState('')
  const [busy, setBusy] = useState(false)
  const options = EXPERTISE_BY_INDUSTRY[other?.industry] || EXPERTISE_OPTIONS

  async function respond(action, extra = {}) {
    setBusy(true)
    const { error } = await supabase.rpc('respond_to_mentorship', {
      p_id: m.id, p_action: action, p_message: message, ...extra,
    })
    setBusy(false)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    showToast(action === 'accept' ? 'Mentorship started.' : action === 'decline' ? 'Declined.' : 'Sent your suggested changes.')
    reload({ quiet: true })
  }

  async function withdraw() {
    setBusy(true)
    const { error } = await supabase.rpc('cancel_mentorship_request', { p_id: m.id })
    setBusy(false)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    showToast('Request withdrawn.')
    reload({ quiet: true })
    navigate('/mentoring/relationships')
  }

  if (mine) {
    return (
      <div className="mtg-agreement">
        <h2>Waiting for {firstName(other?.full_name)}'s reply</h2>
        {m.request_message && <p className="mtg-agreement-quote">"{m.request_message}"</p>}
        <AgreementSummary mentorship={m} />
        <button type="button" className="btn ghost" onClick={withdraw} disabled={busy}>Withdraw request</button>
      </div>
    )
  }

  return (
    <div className="mtg-agreement">
      <h2>{firstName(other?.full_name)} would like {m.mentor_id === other?.id ? 'you to mentor them' : 'to mentor you'}</h2>
      {m.request_message && <p className="mtg-agreement-quote">"{m.request_message}"</p>}
      <AgreementSummary mentorship={m} />

      {view === 'review' && (
        <div className="mentoring-form-actions">
          <button type="button" className="btn primary" onClick={() => respond('accept')} disabled={busy}>Accept</button>
          <button type="button" className="btn ghost" onClick={() => setView('suggest')} disabled={busy}>Suggest changes</button>
          <button type="button" className="btn ghost" onClick={() => setView('decline')} disabled={busy}>Decline</button>
        </div>
      )}

      {view === 'suggest' && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <div className="field">
            <span>What would you mainly work on together?</span>
            <MultiSelectAutocomplete values={focus} onChange={(v) => setFocus(v.slice(0, 3))} options={options} placeholder="Search areas" allowCustom />
          </div>
          <div className="field">
            <span>Rhythm</span>
            <div className="mtg-choice-grid">
              {CADENCE_OPTIONS.map((c) => <button key={c} type="button" className={`mtg-choice-card ${cadence === c ? 'on' : ''}`} onClick={() => setCadence(c)}>{c}</button>)}
            </div>
          </div>
          <div className="field">
            <span>Expected length</span>
            <div className="mtg-choice-grid">
              {EXPECTED_LENGTH_OPTIONS.map((o) => <button key={o.value} type="button" className={`mtg-choice-card ${expectedLength === o.value ? 'on' : ''}`} onClick={() => setExpectedLength(o.value)}>{o.label}</button>)}
            </div>
          </div>
          <label className="field">
            <span>A note about what you'd change</span>
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div className="mentoring-form-actions">
            <button type="button" className="btn ghost" onClick={() => setView('review')} disabled={busy}>Back</button>
            <button type="button" className="btn primary" onClick={() => respond('suggest_changes', { p_cadence: cadence, p_expected_length: expectedLength, p_focus: focus })} disabled={busy}>
              Send suggested changes
            </button>
          </div>
        </div>
      )}

      {view === 'decline' && (
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <label className="field">
            <span>A short reason, if you'd like to share one (optional)</span>
            <textarea rows={3} value={declineReason} onChange={(e) => setDeclineReason(e.target.value.slice(0, 200))} />
          </label>
          <div className="mentoring-form-actions">
            <button type="button" className="btn ghost" onClick={() => setView('review')} disabled={busy}>Back</button>
            <button type="button" className="btn primary" onClick={() => respond('decline', { p_decline_reason: declineReason })} disabled={busy}>Confirm decline</button>
          </div>
        </div>
      )}
    </div>
  )
}

function DiscussingView({ mentorship: m, other, mine, reload, showToast }) {
  const [busy, setBusy] = useState(null)
  const [terms, setTerms] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    loadWorkspaceData(m.id).then((res) => { if (live) { setTerms(res.latestTerms); setLoading(false) } })
    return () => { live = false }
  }, [m.id])

  async function respond(action) {
    setBusy(action)
    const { error } = await supabase.rpc('respond_to_mentorship_terms', { p_id: m.id, p_action: action })
    setBusy(null)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    showToast(action === 'accept' ? 'Mentorship started.' : 'Declined.')
    reload({ quiet: true })
  }

  if (loading) return <LoadingState message="Loading…" />

  return (
    <div className="mtg-agreement">
      <h2>{mine ? `${firstName(other?.full_name)} suggested different terms` : `You suggested changes — waiting on ${firstName(other?.full_name)}`}</h2>
      {terms ? (
        <>
          {terms.focus?.length > 0 && <div className="mtg-agreement-field"><span className="mtg-agreement-field-label">Focus</span><span>{terms.focus.join(', ')}</span></div>}
          {terms.cadence && <div className="mtg-agreement-field"><span className="mtg-agreement-field-label">Rhythm</span><span>{terms.cadence}</span></div>}
          {terms.expected_length && <div className="mtg-agreement-field"><span className="mtg-agreement-field-label">Expected length</span><span>{EXPECTED_LENGTH_LABEL[terms.expected_length]}</span></div>}
          {terms.note && <p className="mtg-agreement-quote">"{terms.note}"</p>}
        </>
      ) : <AgreementSummary mentorship={m} />}

      {mine && (
        <div className="mentoring-form-actions">
          <button type="button" className="btn primary" onClick={() => respond('accept')} disabled={!!busy}>Accept these terms</button>
          <button type="button" className="btn ghost" onClick={() => respond('decline')} disabled={!!busy}>Decline</button>
        </div>
      )}
    </div>
  )
}

function ActiveWorkspace({ mentorship: m, other, myId, role, reload, showToast }) {
  const [ws, setWs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ending, setEnding] = useState(false)

  const refresh = () => loadWorkspaceData(m.id).then((res) => { setWs(res); setLoading(false) })
  useEffect(() => { refresh() }, [m.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const health = mentorshipHealth(m)
  const overdueReview = m.review_at && new Date(m.review_at) < new Date()

  if (loading || !ws) return <LoadingState message="Loading workspace…" />

  return (
    <div>
      <p className="mtg-workspace-status">
        {health && <span className={`mtg-health-pill ${health}`} style={{ marginRight: 8 }}>{HEALTH_LABEL[health]}</span>}
        {m.next_interaction_at ? `Next conversation ${fmtDate(m.next_interaction_at)}` : 'No next conversation scheduled yet'}
      </p>

      <div className="mtg-next-card">
        <div className="mtg-next-card-eyebrow">Next</div>
        {m.next_interaction_at ? (
          <p className="mtg-next-card-date">{fmtDateTime(m.next_interaction_at)}</p>
        ) : (
          <p className="mtg-next-card-empty">Nothing scheduled — log your last conversation to set one up.</p>
        )}
        {m.next_action && (
          <div className="mtg-next-card-field">
            <span className="mtg-next-card-field-label">{other?.full_name}'s next step</span>
            <span className="mtg-next-card-field-value">{m.next_action}{m.next_action_owner ? ` (${m.next_action_owner === 'both' ? 'both of you' : m.next_action_owner})` : ''}</span>
          </div>
        )}
        <div className="mtg-next-card-actions">
          <LogSessionForm mentorshipId={m.id} myId={myId} otherName={other?.full_name} onLogged={() => { refresh(); reload({ quiet: true }) }} showToast={showToast} />
        </div>
      </div>

      {overdueReview && <CheckinPrompt mentorshipId={m.id} showToast={showToast} />}

      <GoalsSection mentorshipId={m.id} goals={ws.goals} onChanged={refresh} showToast={showToast} />
      <ActionsSection mentorshipId={m.id} actions={ws.actions} onChanged={refresh} showToast={showToast} />

      <div className="mtg-section">
        <div className="mtg-section-head"><h2>Relationship journal</h2></div>
        {ws.sessions.length === 0 ? (
          <EmptyState icon="search" message="No conversations logged yet" subMessage="Log one after you meet — it takes under a minute." />
        ) : (
          <div className="mtg-timeline">
            {ws.sessions.map((s) => (
              <div key={s.id} className="mtg-timeline-entry">
                <span className="mtg-timeline-date">{fmtDate(s.met_on)}</span>
                {s.notes && <p className="mtg-timeline-body">{s.notes}</p>}
                {s.next_steps && (
                  <p className="mtg-timeline-next"><strong>Next:</strong> {s.next_steps}{s.next_conversation_at ? ` · ${fmtDateTime(s.next_conversation_at)}` : ''}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mtg-section">
        <div className="mtg-section-head"><h2>Ending the mentorship</h2></div>
        {!ending ? (
          <button type="button" className="btn ghost" onClick={() => setEnding(true)}>End this mentorship</button>
        ) : (
          <EndingFlow mentorshipId={m.id} onCancel={() => setEnding(false)} onDone={() => reload({ quiet: true })} showToast={showToast} />
        )}
      </div>
    </div>
  )
}

function LogSessionForm({ mentorshipId, myId, otherName, onLogged, showToast }) {
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 10))
  const [what, setWhat] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [nextOwner, setNextOwner] = useState('')
  const [nextAt, setNextAt] = useState('')
  const [duration, setDuration] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) {
    return <button type="button" className="btn primary" onClick={() => setOpen(true)}>Log a conversation</button>
  }

  async function submit() {
    setBusy(true)
    const { error } = await supabase.from('mentorship_sessions').insert({
      mentorship_id: mentorshipId,
      logged_by: myId,
      met_on: when,
      notes: what.trim(),
      next_steps: nextSteps.trim(),
      next_step_owner: nextOwner,
      next_conversation_at: nextAt ? new Date(nextAt).toISOString() : null,
      duration_minutes: duration ? Number(duration) : null,
    })
    setBusy(false)
    if (error) { showToast('Could not log that — please try again.', { type: 'error' }); return }
    showToast('Logged.')
    setOpen(false)
    setWhat(''); setNextSteps(''); setNextAt(''); setDuration(''); setMore(false)
    onLogged?.()
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 'var(--radius)', padding: 'var(--sp-4)', width: '100%' }}>
      <label className="field"><span style={{ color: '#fff' }}>When</span><input type="date" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="field"><span style={{ color: '#fff' }}>What did you cover?</span><textarea rows={3} value={what} onChange={(e) => setWhat(e.target.value)} /></label>
      <label className="field"><span style={{ color: '#fff' }}>What's next?</span><textarea rows={2} value={nextSteps} onChange={(e) => setNextSteps(e.target.value)} placeholder={`For ${otherName || 'them'}, or for you`} /></label>
      {nextSteps.trim() && (
        <div className="field">
          <span style={{ color: '#fff' }}>Whose step is that?</span>
          <div className="mtg-choice-grid">
            {['mentor', 'mentee', 'both'].map((o) => <button key={o} type="button" className={`mtg-choice-card ${nextOwner === o ? 'on' : ''}`} onClick={() => setNextOwner(o)}>{o}</button>)}
          </div>
        </div>
      )}
      <label className="field"><span style={{ color: '#fff' }}>Next conversation (optional)</span><input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} /></label>
      {!more ? (
        <button type="button" className="link-btn" style={{ color: 'var(--orange)' }} onClick={() => setMore(true)}>More details</button>
      ) : (
        <label className="field"><span style={{ color: '#fff' }}>Duration (minutes)</span><input type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
      )}
      <div className="mentoring-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={submit} disabled={busy || !what.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function GoalsSection({ mentorshipId, goals, onChanged, showToast }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('mentee')
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!title.trim()) return
    setBusy(true)
    const { error } = await supabase.from('mentorship_goals').insert({ mentorship_id: mentorshipId, title: title.trim(), owner })
    setBusy(false)
    if (error) { showToast('Could not add that goal.', { type: 'error' }); return }
    setTitle(''); setAdding(false)
    onChanged?.()
  }

  async function toggle(g) {
    await supabase.from('mentorship_goals').update({ status: g.status === 'done' ? 'open' : 'done', completed_at: g.status === 'done' ? null : new Date().toISOString() }).eq('id', g.id)
    onChanged?.()
  }

  return (
    <div className="mtg-section">
      <div className="mtg-section-head">
        <h2>What we're working towards</h2>
        {!adding && <button type="button" className="link-btn" onClick={() => setAdding(true)}>Add</button>}
      </div>
      {adding && (
        <div className="mtg-quick-add" style={{ marginBottom: 'var(--sp-3)' }}>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} placeholder="A goal for this mentorship" style={{ flex: 1 }} />
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="mentee">Mentee</option>
            <option value="mentor">Mentor</option>
            <option value="both">Both</option>
          </select>
          <button type="button" className="btn primary small" onClick={add} disabled={busy || !title.trim()}>Add</button>
          <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      {goals.length === 0 ? (
        <p className="hint">No goals set yet.</p>
      ) : (
        <ul className="mtg-goal-list">
          {goals.map((g) => (
            <li key={g.id} className={`mtg-goal-item ${g.status === 'done' ? 'done' : ''}`}>
              <input type="checkbox" checked={g.status === 'done'} onChange={() => toggle(g)} />
              <span className="mtg-goal-title">{g.title}</span>
              <span className="mtg-goal-owner-tag">{g.owner}</span>
              {g.target_date && <span className="mtg-goal-target">{fmtDate(g.target_date)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionsSection({ mentorshipId, actions, onChanged, showToast }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState('mentee')
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!title.trim()) return
    setBusy(true)
    const { error } = await supabase.from('mentorship_actions').insert({ mentorship_id: mentorshipId, title: title.trim(), owner })
    setBusy(false)
    if (error) { showToast('Could not add that action.', { type: 'error' }); return }
    setTitle(''); setAdding(false)
    onChanged?.()
  }

  async function toggle(a) {
    await supabase.from('mentorship_actions').update({ completed_at: a.completed_at ? null : new Date().toISOString() }).eq('id', a.id)
    onChanged?.()
  }

  return (
    <div className="mtg-section">
      <div className="mtg-section-head">
        <h2>Action items</h2>
        {!adding && <button type="button" className="link-btn" onClick={() => setAdding(true)}>Add</button>}
      </div>
      {adding && (
        <div className="mtg-quick-add" style={{ marginBottom: 'var(--sp-3)' }}>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} placeholder="Something specific to do next" style={{ flex: 1 }} />
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="mentee">Mentee</option>
            <option value="mentor">Mentor</option>
            <option value="both">Both</option>
          </select>
          <button type="button" className="btn primary small" onClick={add} disabled={busy || !title.trim()}>Add</button>
          <button type="button" className="btn ghost small" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      {actions.length === 0 ? (
        <p className="hint">No action items yet.</p>
      ) : (
        <ul className="mtg-goal-list">
          {actions.map((a) => (
            <li key={a.id} className={`mtg-goal-item ${a.completed_at ? 'done' : ''}`}>
              <input type="checkbox" checked={!!a.completed_at} onChange={() => toggle(a)} />
              <span className="mtg-goal-title">{a.title}</span>
              <span className="mtg-goal-owner-tag">{a.owner}</span>
              {a.due_date && <span className="mtg-goal-target">{fmtDate(a.due_date)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CheckinPrompt({ mentorshipId, showToast }) {
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function answer(value) {
    setBusy(true)
    const { error } = await supabase.rpc('submit_mentorship_checkin', { p_mentorship_id: mentorshipId, p_response: value })
    setBusy(false)
    if (error) { showToast('Could not save that.', { type: 'error' }); return }
    setSent(true)
  }

  if (sent) return null

  return (
    <div className="mtg-checkin">
      <h4>Still useful to you? This is private — only you'll see your answer.</h4>
      <div className="mtg-checkin-options">
        {CHECKIN_OPTIONS.map((o) => (
          <button key={o.value} type="button" className="mtg-filter-chip" disabled={busy} onClick={() => answer(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

function EndingFlow({ mentorshipId, onCancel, onDone, showToast }) {
  const [outcome, setOutcome] = useState('')
  const [reflection, setReflection] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  async function submit() {
    if (!outcome) return
    setBusy(true)
    const { error } = await supabase.rpc('wrap_up_mentorship', { p_id: mentorshipId, p_outcome: outcome, p_reflection: reflection })
    setBusy(false)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    setDone(outcome)
    onDone?.()
  }

  if (done) {
    return (
      <div className="mtg-completion">
        <h2>Thank you for being part of this.</h2>
        <p className="hint">This mentorship has been wrapped up.</p>
      </div>
    )
  }

  return (
    <div className="mtg-agreement">
      <h3>How would you describe how this went?</h3>
      <div className="mtg-ending-options">
        {OUTCOME_OPTIONS.map((o) => (
          <button key={o.value} type="button" className={`mtg-choice-card ${outcome === o.value ? 'on' : ''}`} style={{ textAlign: 'left' }} onClick={() => setOutcome(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <label className="field" style={{ marginTop: 'var(--sp-4)' }}>
        <span>Anything you'd want to remember about this (optional)</span>
        <textarea rows={3} value={reflection} onChange={(e) => setReflection(e.target.value.slice(0, 1000))} />
      </label>
      <div className="mentoring-form-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" onClick={submit} disabled={busy || !outcome}>{busy ? 'Saving…' : 'Confirm'}</button>
      </div>
    </div>
  )
}

function CompletionView({ mentorship: m, other }) {
  const days = m.started_at && m.ended_at ? Math.round((new Date(m.ended_at) - new Date(m.started_at)) / 86400000) : null
  return (
    <div className="mtg-completion">
      <h2>Mentorship with {other?.full_name || 'this member'} {m.status === 'completed' ? 'completed' : 'ended'}</h2>
      {m.outcome && <p className="hint">{{ achieved: 'You achieved what you set out to do.', natural_stop: 'It reached a natural stopping point.', not_right_fit: "It wasn't quite the right fit." }[m.outcome]}</p>}
      <div className="mtg-completion-stats">
        {days !== null && <div className="mtg-completion-stat"><strong>{days}</strong><span>days together</span></div>}
        {m.focus?.length > 0 && <div className="mtg-completion-stat"><strong>{m.focus.length}</strong><span>focus areas</span></div>}
      </div>
      {m.reflection && <p className="mtg-agreement-quote" style={{ textAlign: 'left', marginTop: 'var(--sp-5)' }}>"{m.reflection}"</p>}
    </div>
  )
}

function ClosedStatusView({ mentorship: m, other }) {
  return (
    <div className="mtg-agreement">
      <h2>{m.status === 'declined' ? `${firstName(other?.full_name)} declined this request` : 'Request withdrawn'}</h2>
      {m.decline_reason && <p className="mtg-agreement-quote">"{m.decline_reason}"</p>}
      <Link to="/mentoring/discover" className="btn ghost" style={{ marginTop: 'var(--sp-4)', display: 'inline-block' }}>Browse other recommendations</Link>
    </div>
  )
}
