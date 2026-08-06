import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useToast } from './Toast.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

// The inside of an active mentorship: what you agreed to work on, and what
// actually happened.
//
// Both halves exist because of the same failure mode. A mentorship that dies
// does not usually die from a falling-out — it dies because two busy people
// each assume the other will suggest the next date, and three months pass.
// Goals give the pairing something to be *about* after the initial
// enthusiasm wears off, and the session log makes the gap since you last
// spoke visible to both of you instead of only to whoever feels guiltier.
//
// Loaded lazily: this only mounts when a card is expanded, so the My
// mentoring list stays one query no matter how many pairings someone has.

const MAX_NOTE = 2000

function fmtDate(value) {
  if (!value) return ''
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysSince(value) {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

export default function MentorshipWorkspace({ mentorship, session, otherPerson, onChanged }) {
  const showToast = useToast()
  const [goals, setGoals] = useState([])
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const isActive = mentorship.status === 'active'
  const myId = session.user.id

  async function load() {
    setLoading(true)
    // Session tokens can still be settling on a first paint (the race
    // documented in App.jsx). Awaiting getSession() first means RLS matches
    // rows rather than silently matching none.
    await supabase.auth.getSession()
    const [{ data: g, error: gErr }, { data: s, error: sErr }] = await Promise.all([
      supabase.from('mentorship_goals')
        .select('id, title, status, target_date, created_by, created_at, completed_at')
        .eq('mentorship_id', mentorship.id)
        .order('created_at', { ascending: true }),
      supabase.from('mentorship_sessions')
        .select('id, met_on, duration_minutes, notes, next_steps, next_session_on, logged_by, created_at')
        .eq('mentorship_id', mentorship.id)
        .order('met_on', { ascending: false }),
    ])
    if (gErr || sErr) { setLoadError(true); setLoading(false); return }
    setLoadError(false)
    setGoals(g || [])
    setSessions(s || [])
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mentorship.id])

  if (loading) return <p className="empty small">Loading…</p>
  if (loadError) {
    return (
      <p className="form-error">
        Couldn&rsquo;t load this mentorship.{' '}
        <button type="button" className="link-btn" onClick={load}>Try again</button>
      </p>
    )
  }

  const done = goals.filter((g) => g.status === 'done').length
  const pct = goals.length ? Math.round((done / goals.length) * 100) : 0
  const lastMet = sessions[0]?.met_on
  const sinceLast = daysSince(lastMet)

  return (
    <div className="relationship-card-body">
      {isActive && sessions.length > 0 && sinceLast !== null && sinceLast >= 45 && (
        // Shown to both sides rather than nudging only the mentee. Whichever
        // of you opens the page first is the one who can fix it.
        <p className="mentoring-stale-note">
          It&rsquo;s been {sinceLast} days since your last logged session
          {otherPerson?.full_name ? ` with ${otherPerson.full_name.split(/\s+/)[0]}` : ''}.
        </p>
      )}

      <GoalsSection
        goals={goals}
        mentorshipId={mentorship.id}
        myId={myId}
        editable={isActive}
        done={done}
        pct={pct}
        onReload={load}
        showToast={showToast}
      />

      <SessionsSection
        sessions={sessions}
        mentorshipId={mentorship.id}
        myId={myId}
        editable={isActive}
        otherPerson={otherPerson}
        onReload={load}
        showToast={showToast}
      />

      {isActive && (
        <EndSection mentorship={mentorship} goalsDone={done} goalsTotal={goals.length} onChanged={onChanged} showToast={showToast} />
      )}
    </div>
  )
}

/* ---------- Goals ---------- */
function GoalsSection({ goals, mentorshipId, myId, editable, done, pct, onReload, showToast }) {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function addGoal(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    const { error } = await supabase.from('mentorship_goals').insert({
      mentorship_id: mentorshipId,
      title: t.slice(0, 200),
      target_date: target || null,
      created_by: myId,
    })
    setBusy(false)
    if (error) { showToast('Could not add that goal.', { type: 'error' }); return }
    setTitle('')
    setTarget('')
    onReload()
  }

  async function toggle(goal) {
    const next = goal.status === 'done' ? 'open' : 'done'
    const { error } = await supabase.from('mentorship_goals')
      .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
      .eq('id', goal.id)
    if (error) { showToast('Could not update that goal.', { type: 'error' }); return }
    onReload()
  }

  async function remove(goal) {
    setConfirmDelete(null)
    const { error } = await supabase.from('mentorship_goals').delete().eq('id', goal.id)
    if (error) { showToast('Could not delete that goal.', { type: 'error' }); return }
    onReload()
  }

  return (
    <div className="mentoring-goals-section">
      <div className="mentoring-section-header">
        <h4>Goals</h4>
        {goals.length > 0 && <span className="mentoring-progress-label">{done} of {goals.length} done</span>}
      </div>

      {goals.length > 0 && (
        <div
          className="mentoring-progress-bar"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Goals completed"
        >
          <div className="mentoring-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {editable && (
        <form className="mentoring-inline-form" onSubmit={addGoal}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 200))}
            placeholder="Add a goal — e.g. “Get my CV in front of three firms”"
            aria-label="New goal"
          />
          <input
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Target date (optional)"
            className="mentoring-goal-date"
          />
          <button type="submit" className="btn ghost small" disabled={!title.trim() || busy}>Add</button>
        </form>
      )}

      {goals.length === 0 ? (
        <p className="empty small">
          {editable
            ? 'No goals yet. Two or three specific ones beat a long wish list.'
            : 'No goals were set for this mentorship.'}
        </p>
      ) : (
        <ul className="mentoring-goal-list">
          {goals.map((g) => (
            <li key={g.id} className={g.status === 'done' ? 'mentoring-goal-item done' : 'mentoring-goal-item'}>
              <label className="mentoring-goal-check">
                <input
                  type="checkbox"
                  checked={g.status === 'done'}
                  onChange={() => toggle(g)}
                  disabled={!editable}
                />
                <span>{g.title}</span>
              </label>
              {g.target_date && <span className="mentoring-goal-target">by {fmtDate(g.target_date)}</span>}
              {editable && (
                <button
                  type="button"
                  className="mentoring-goal-delete"
                  onClick={() => setConfirmDelete(g)}
                  aria-label={`Delete goal: ${g.title}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this goal?"
          message={confirmDelete.title}
          confirmLabel="Delete"
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

/* ---------- Sessions ---------- */
function SessionsSection({ sessions, mentorshipId, myId, editable, otherPerson, onReload, showToast }) {
  const [open, setOpen] = useState(false)
  const [metOn, setMetOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [minutes, setMinutes] = useState('')
  const [notes, setNotes] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [nextOn, setNextOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function logSession(e) {
    e.preventDefault()
    if (busy) return
    if (!notes.trim() && !nextSteps.trim()) {
      showToast('Add a note or a next step so this is worth looking back at.', { type: 'error' })
      return
    }
    setBusy(true)
    const { error } = await supabase.from('mentorship_sessions').insert({
      mentorship_id: mentorshipId,
      logged_by: myId,
      met_on: metOn,
      duration_minutes: minutes ? Number(minutes) : null,
      notes: notes.trim().slice(0, MAX_NOTE),
      next_steps: nextSteps.trim().slice(0, MAX_NOTE),
      next_session_on: nextOn || null,
    })
    setBusy(false)
    if (error) { showToast('Could not save that session.', { type: 'error' }); return }
    setNotes(''); setNextSteps(''); setMinutes(''); setNextOn('')
    setOpen(false)
    showToast('Session logged.')
    onReload()
  }

  async function remove(s) {
    setConfirmDelete(null)
    const { error } = await supabase.from('mentorship_sessions').delete().eq('id', s.id)
    if (error) { showToast('Could not delete that entry.', { type: 'error' }); return }
    onReload()
  }

  // The most useful thing on the whole page: what you said you'd do last
  // time. Pulled out of the newest entry that has one, so it survives a
  // couple of quick catch-ups that didn't set new actions.
  const openNextSteps = sessions.find((s) => (s.next_steps || '').trim())
  const upcoming = sessions.find((s) => s.next_session_on && new Date(`${s.next_session_on}T00:00:00`) >= new Date(new Date().toDateString()))

  return (
    <div className="mentoring-notes-section">
      <div className="mentoring-section-header">
        <h4>Sessions</h4>
        <span className="mentoring-progress-label">
          {sessions.length === 0 ? 'None logged' : `${sessions.length} logged`}
        </span>
      </div>

      {upcoming && (
        <p className="mentoring-next-session">Next session: <strong>{fmtDate(upcoming.next_session_on)}</strong></p>
      )}

      {openNextSteps && (
        <div className="relationship-completion-note">
          <strong>Agreed next steps</strong>
          {openNextSteps.next_steps}
        </div>
      )}

      {editable && !open && (
        <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>Log a session</button>
      )}

      {editable && open && (
        <form className="mentoring-note-form" onSubmit={logSession}>
          <div className="mentoring-session-fields">
            <label className="field-inline">
              <span>Met on</span>
              <input type="date" value={metOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setMetOn(e.target.value)} />
            </label>
            <label className="field-inline">
              <span>Minutes</span>
              <input type="number" min="5" max="600" step="5" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="60" />
            </label>
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTE))}
            placeholder="What did you talk about?"
            rows={3}
          />
          <textarea
            value={nextSteps}
            onChange={(e) => setNextSteps(e.target.value.slice(0, MAX_NOTE))}
            placeholder="What happens before the next one?"
            rows={2}
          />

          <div className="mentoring-note-form-row">
            <label className="field-inline">
              <span>Next session</span>
              <input type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} />
            </label>
            <div className="mentoring-form-actions">
              <button type="button" className="btn ghost small" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn primary small" disabled={busy}>{busy ? 'Saving…' : 'Save session'}</button>
            </div>
          </div>
          <p className="hint">
            Both of you can see everything logged here — and {otherPerson?.full_name?.split(/\s+/)[0] || 'the other person'} gets a notification.
          </p>
        </form>
      )}

      {sessions.length === 0 ? (
        <p className="empty small">Nothing logged yet.</p>
      ) : (
        <ul className="mentoring-note-list">
          {sessions.map((s) => (
            <li key={s.id} className="mentoring-note-item">
              <div className="mentoring-note-head">
                <span className="mentoring-note-date">{fmtDate(s.met_on)}</span>
                <span className="mentoring-note-author">
                  {s.logged_by === myId ? 'You' : (otherPerson?.full_name || 'Them')}
                </span>
                {s.duration_minutes ? <span className="mentoring-note-time">{s.duration_minutes} min</span> : null}
                {s.logged_by === myId && editable && (
                  <button
                    type="button"
                    className="mentoring-goal-delete"
                    onClick={() => setConfirmDelete(s)}
                    aria-label={`Delete session from ${fmtDate(s.met_on)}`}
                  >
                    ×
                  </button>
                )}
              </div>
              {s.notes && <p className="mentoring-note-content">{s.notes}</p>}
              {s.next_steps && <p className="mentoring-note-next"><strong>Next:</strong> {s.next_steps}</p>}
            </li>
          ))}
        </ul>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this session entry?"
          message="The other person will no longer see it either."
          confirmLabel="Delete"
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

/* ---------- Ending ---------- */
function EndSection({ mentorship, goalsDone, goalsTotal, onChanged, showToast }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function end(completed) {
    setBusy(true)
    const { error } = await supabase.rpc('end_mentorship', {
      p_id: mentorship.id,
      p_completed: completed,
      p_note: note.trim().slice(0, 1000),
    })
    setBusy(false)
    if (error) { showToast(error.message || 'Could not close this mentorship.', { type: 'error' }); return }
    showToast(completed ? 'Marked as complete.' : 'Mentorship closed.')
    setOpen(false)
    onChanged?.()
  }

  if (!open) {
    return (
      <div className="mentoring-end-row">
        <button type="button" className="link-btn subtle" onClick={() => setOpen(true)}>Wrap this up</button>
      </div>
    )
  }

  return (
    <div className="mentoring-end-panel">
      <h4>Wrapping up</h4>
      <p className="hint">
        {goalsTotal > 0
          ? `You've ticked off ${goalsDone} of ${goalsTotal} goals. `
          : ''}
        Ending it keeps the record — goals and sessions stay readable to both of you — and frees up a slot.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 1000))}
        placeholder="Anything worth saying to close it off (optional)"
        rows={2}
      />
      <div className="mentoring-form-actions">
        <button type="button" className="btn ghost small" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        {/* Two different endings on purpose — see end_mentorship() in
            schema-update-56. "Finished early" is a normal outcome, not a
            failure, and giving it its own button means people actually close
            the record instead of leaving a dead pairing marked active. */}
        <button type="button" className="btn ghost small" onClick={() => end(false)} disabled={busy}>Finished early</button>
        <button type="button" className="btn primary small" onClick={() => end(true)} disabled={busy}>
          {busy ? 'Saving…' : 'Completed'}
        </button>
      </div>
    </div>
  )
}
