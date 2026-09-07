import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { Avatar } from '../Directory.jsx'
import EmptyState from '../EmptyState.jsx'
import {
  firstName, fmtDate, fmtDateTime, friendlyError, mentorshipHealth, HEALTH_LABEL, myRole, otherId,
} from './data.js'

const TABS = [
  { id: 'active', label: 'Active' },
  { id: 'requests', label: 'Requests' },
  { id: 'connections', label: 'Questions & conversations' },
  { id: 'past', label: 'Past' },
]

// Everything with another person that isn't a one-time browse — mentorship
// requests waiting on someone, active mentorships, and the lighter-weight
// questions/conversations tier, all in one place instead of split across the
// old Find-a-mentor/Find-a-mentee tabs.
export default function Relationships(props) {
  const { myId, people, mentorships, connections, attention, reload, showToast } = props
  const [tab, setTab] = useState(attention.incomingRequests.length || attention.discussingMyTurn.length ? 'requests' : 'active')

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people])

  const active = useMemo(() => mentorships.filter((m) => m.status === 'active'), [mentorships])
  const requests = useMemo(() => mentorships.filter((m) => m.status === 'pending' || m.status === 'discussing'), [mentorships])
  const past = useMemo(
    () => mentorships.filter((m) => ['completed', 'ended', 'declined', 'cancelled'].includes(m.status))
      .sort((a, b) => new Date(b.ended_at || b.responded_at || 0) - new Date(a.ended_at || a.responded_at || 0)),
    [mentorships]
  )
  const sortedConnections = useMemo(() => [...connections].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)), [connections])

  return (
    <div>
      <div className="mtg-discover-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`mtg-filter-chip ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'requests' && requests.length > 0 ? ` (${requests.length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'active' && (
        active.length === 0 ? (
          <EmptyState icon="search" message="No active mentorships" subMessage="Requests you accept will show up here." />
        ) : (
          <div className="mtg-relationship-grid">
            {active.map((m) => {
              const other = peopleById[otherId(m, myId)]
              const health = mentorshipHealth(m)
              return (
                <Link key={m.id} to={`/mentoring/relationships/${m.id}`} className="mtg-relationship-card">
                  <span className="mtg-relationship-card-name">{other?.full_name || 'Member'}</span>
                  <span className="mtg-relationship-card-role">{myRole(m, myId) === 'mentor' ? 'You are mentoring' : 'They are mentoring you'}</span>
                  {health && <span className={`mtg-health-pill ${health}`}>{HEALTH_LABEL[health]}</span>}
                  <div className="mtg-relationship-card-field" style={{ marginTop: 'var(--sp-3)' }}>
                    <span className="mtg-relationship-card-field-label">Next</span>
                    <span className="mtg-relationship-card-field-value">
                      {m.next_interaction_at ? fmtDateTime(m.next_interaction_at) : 'Nothing scheduled yet'}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )
      )}

      {tab === 'requests' && (
        requests.length === 0 ? (
          <EmptyState icon="search" message="No open requests" />
        ) : (
          <div className="mtg-relationship-grid">
            {requests.map((m) => {
              const other = peopleById[otherId(m, myId)]
              const mine = m.initiated_by === myId
              const label = m.status === 'discussing'
                ? (mine ? 'They suggested changes — your turn' : 'You suggested changes — waiting on them')
                : (mine ? 'Waiting for their reply' : 'Waiting on your reply')
              return (
                <Link key={m.id} to={`/mentoring/relationships/${m.id}`} className="mtg-relationship-card">
                  <span className="mtg-relationship-card-name">{other?.full_name || 'Member'}</span>
                  <span className="mtg-relationship-card-role">{myRole(m, myId) === 'mentor' ? 'They asked you to mentor them' : 'You asked them to mentor you'}</span>
                  <div className="mtg-relationship-card-field">
                    <span className="mtg-relationship-card-field-value">{label}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )
      )}

      {tab === 'connections' && (
        <ConnectionsList connections={sortedConnections} myId={myId} peopleById={peopleById} reload={reload} showToast={showToast} />
      )}

      {tab === 'past' && (
        past.length === 0 ? (
          <EmptyState icon="search" message="Nothing here yet" />
        ) : (
          <div className="mtg-relationship-grid">
            {past.map((m) => {
              const other = peopleById[otherId(m, myId)]
              return (
                <div key={m.id} className="mtg-relationship-card">
                  <span className="mtg-relationship-card-name">{other?.full_name || 'Member'}</span>
                  <span className="mtg-relationship-card-role">{statusLabel(m)}</span>
                  <div className="mtg-relationship-card-field">
                    <span className="mtg-relationship-card-field-value">{fmtDate(m.ended_at || m.responded_at)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

function statusLabel(m) {
  if (m.status === 'declined') return 'Declined'
  if (m.status === 'cancelled') return 'Withdrawn'
  if (m.status === 'completed') return 'Completed'
  return 'Ended'
}

function ConnectionsList({ connections, myId, peopleById, reload, showToast }) {
  const [busyId, setBusyId] = useState(null)

  async function act(c, action) {
    setBusyId(c.id)
    const { error } = await supabase.rpc('respond_mentoring_connection', { p_id: c.id, p_action: action, p_reply: '', p_scheduled_at: null })
    setBusyId(null)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    showToast(action === 'withdraw' ? 'Withdrawn.' : 'Updated.')
    reload({ quiet: true })
  }

  if (connections.length === 0) return <EmptyState icon="search" message="No quick questions or conversations yet" />

  return (
    <div className="mtg-relationship-grid">
      {connections.map((c) => {
        const mine = c.requester_id === myId
        const other = peopleById[mine ? c.recipient_id : c.requester_id]
        return (
          <div key={c.id} className="mtg-relationship-card">
            <span className="mtg-relationship-card-name">{other?.full_name || 'Member'}</span>
            <span className="mtg-relationship-card-role">
              {c.kind === 'question' ? 'Quick question' : 'Conversation'} · {mine ? 'You asked' : `${firstName(other?.full_name)} asked`}
            </span>
            <p className="mtg-attention-card-quote">"{c.message}"</p>
            <div className="mtg-relationship-card-field">
              <span className="mtg-relationship-card-field-label">Status</span>
              <span className="mtg-relationship-card-field-value">{connectionStatusLabel(c)}</span>
            </div>
            {c.reply && (
              <div className="mtg-relationship-card-field">
                <span className="mtg-relationship-card-field-label">Reply</span>
                <span className="mtg-relationship-card-field-value">{c.reply}</span>
              </div>
            )}
            {mine && c.status === 'sent' && (
              <button type="button" className="link-btn subtle" disabled={busyId === c.id} onClick={() => act(c, 'withdraw')}>Withdraw</button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function connectionStatusLabel(c) {
  switch (c.status) {
    case 'sent': return 'Waiting for a reply'
    case 'answered': return 'Answered'
    case 'scheduled': return c.scheduled_at ? `Scheduled for ${new Date(c.scheduled_at).toLocaleString()}` : 'Time suggested'
    case 'declined': return "Couldn't help this time"
    case 'withdrawn': return 'Withdrawn'
    case 'expired': return 'Expired'
    default: return c.status
  }
}
