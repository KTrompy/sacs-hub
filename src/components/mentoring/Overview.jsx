import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { Avatar } from '../Directory.jsx'
import EmptyState from '../EmptyState.jsx'
import PersonSheet from './PersonSheet.jsx'
import {
  firstName, fmtDate, fmtDateTime, friendlyError, mentorshipHealth, HEALTH_LABEL,
  liveMentorshipMap, openConnectionMap, myRole, otherId,
} from './data.js'
import { eligibleForMentorship, eligibleForGuidanceFrom, scoreMentor, scoreMentee, byScore } from '../../mentorMatch.js'

// The page every visit starts on. Three jobs, in order: tell me what I can
// do right now (intent panel), tell me what's waiting on me (needs
// attention), and show me people worth meeting — never a database dump of
// every mentor in the network.
export default function Overview(props) {
  const {
    me, myId, people, myMentoringProfile, mentorships, connections,
    savedIds, attention, reload, toggleSaved, showToast, onOpenOnboarding,
  } = props
  const navigate = useNavigate()
  const [openPerson, setOpenPerson] = useState(null) // { person, mode }
  const [respondingId, setRespondingId] = useState(null)

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people])
  const liveMap = useMemo(() => liveMentorshipMap(mentorships, myId), [mentorships, myId])
  const openConnMap = useMemo(() => openConnectionMap(connections, myId), [connections, myId])

  const activeMentorships = useMemo(
    () => mentorships.filter((m) => m.status === 'active').sort((a, b) => new Date(a.next_interaction_at || '9999') - new Date(b.next_interaction_at || '9999')),
    [mentorships]
  )

  const wantsGuidance = !!me?.seeking_mentor
  const offersGuidance = !!me?.is_open_to_opportunities

  const recommendations = useMemo(() => {
    const out = []
    if (wantsGuidance) {
      for (const p of people) {
        if (!p.is_open_to_opportunities || !eligibleForMentorship(me, p) || liveMap[p.id]) continue
        const match = scoreMentor(me, p, myMentoringProfile)
        if (match.score <= 0) continue
        out.push({ ...p, match, mode: 'mentor' })
      }
    }
    if (offersGuidance) {
      for (const p of people) {
        if (!p.seeking_mentor || !eligibleForGuidanceFrom(me, p) || liveMap[p.id]) continue
        const match = scoreMentee(me, p)
        if (match.score <= 0) continue
        out.push({ ...p, match, mode: 'mentee' })
      }
    }
    return out.sort(byScore).slice(0, 4)
  }, [people, me, myMentoringProfile, liveMap, wantsGuidance, offersGuidance])

  function openIntent(intent) {
    navigate(`/mentoring/discover?intent=${intent}`)
  }

  async function respondConnection(c, action, extra = {}) {
    setRespondingId(c.id)
    const { error } = await supabase.rpc('respond_mentoring_connection', {
      p_id: c.id, p_action: action, p_reply: extra.reply || '', p_scheduled_at: extra.scheduledAt || null,
    })
    setRespondingId(null)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    showToast(action === 'decline' ? 'Declined.' : 'Reply sent.')
    reload({ quiet: true })
  }

  const noSetup = !myMentoringProfile?.onboarding_completed_at

  return (
    <div>
      <div className="mtg-intent">
        <h2>What would you like to do?</h2>
        <div className="mtg-intent-grid">
          <button type="button" className="mtg-intent-option" onClick={() => openIntent('guidance')}>
            <strong>Find guidance</strong>
            <span>Meet people who've done what you're trying to do.</span>
          </button>
          <button type="button" className="mtg-intent-option" onClick={() => openIntent('offer')}>
            <strong>Offer my experience</strong>
            <span>See who's looking for what you already know.</span>
          </button>
          <button type="button" className="mtg-intent-option" onClick={() => openIntent('question')}>
            <strong>Ask a quick question</strong>
            <span>No commitment — just one specific thing.</span>
          </button>
        </div>
        {noSetup && (
          <button type="button" className="mtg-intent-question" onClick={onOpenOnboarding}>
            Not sure where to start? Set up your mentoring profile →
          </button>
        )}
      </div>

      {(attention.incomingRequests.length > 0 || attention.discussingMyTurn.length > 0 || attention.pendingConnections.length > 0) && (
        <div className="mtg-section">
          <div className="mtg-section-head"><h2>Needs your attention</h2></div>

          {attention.incomingRequests.map((m) => {
            const other = peopleById[otherId(m, myId)]
            return (
              <div key={`req-${m.id}`} className="mtg-attention-card">
                <Avatar url={other?.avatar_url} name={other?.full_name} size={44} />
                <div className="mtg-attention-card-body">
                  <div className="mtg-attention-card-title">{firstName(other?.full_name)} sent a mentorship request</div>
                  <div className="mtg-attention-card-meta">{fmtDate(m.requested_at)}</div>
                  {m.request_message && <p className="mtg-attention-card-quote">"{m.request_message}"</p>}
                  <Link to={`/mentoring/relationships/${m.id}`} className="btn primary small">Review</Link>
                </div>
              </div>
            )
          })}

          {attention.discussingMyTurn.map((m) => {
            const other = peopleById[otherId(m, myId)]
            return (
              <div key={`terms-${m.id}`} className="mtg-attention-card">
                <Avatar url={other?.avatar_url} name={other?.full_name} size={44} />
                <div className="mtg-attention-card-body">
                  <div className="mtg-attention-card-title">{firstName(other?.full_name)} suggested different terms</div>
                  <div className="mtg-attention-card-meta">Waiting on your answer</div>
                  <Link to={`/mentoring/relationships/${m.id}`} className="btn primary small">Review</Link>
                </div>
              </div>
            )
          })}

          {attention.pendingConnections.map((c) => {
            const other = peopleById[c.requester_id]
            return (
              <ConnectionAttentionCard
                key={`conn-${c.id}`}
                connection={c}
                other={other}
                busy={respondingId === c.id}
                onRespond={respondConnection}
              />
            )
          })}
        </div>
      )}

      <div className="mtg-section">
        <div className="mtg-section-head">
          <h2>Your mentorships</h2>
          {mentorships.length > 0 && <Link to="/mentoring/relationships" className="link-btn">See all</Link>}
        </div>
        {activeMentorships.length === 0 ? (
          <EmptyState icon="search" message="No active mentorships yet" subMessage="When one gets going, you'll see it here." />
        ) : (
          <div className="mtg-relationship-grid">
            {activeMentorships.slice(0, 4).map((m) => {
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
        )}
      </div>

      {recommendations.length > 0 && (
        <div className="mtg-section">
          <div className="mtg-section-head">
            <h2>People worth meeting</h2>
            <Link to="/mentoring/discover" className="link-btn">Browse everyone</Link>
          </div>
          <div className="mtg-person-grid">
            {recommendations.map((p) => (
              <div key={`${p.mode}-${p.id}`} className="mtg-person-card">
                <div className="mtg-person-card-top">
                  <Avatar url={p.avatar_url} name={p.full_name} size={48} />
                  <div>
                    <span className="mtg-person-card-name">{p.full_name}</span>
                    <span className="mtg-person-card-role">{p.occupation || p.industry || ''}</span>
                  </div>
                </div>
                {p.match.reasons.length > 0 && (
                  <div>
                    <div className="mtg-person-card-why-label">Why</div>
                    <ul className="mtg-person-card-reasons">
                      {p.match.reasons.map((r) => <li key={r.key}>{r.label}</li>)}
                    </ul>
                  </div>
                )}
                <div className="mtg-person-card-footer">
                  <button type="button" className="btn primary small" onClick={() => setOpenPerson({ person: p, mode: p.mode })}>
                    Connect
                  </button>
                  <button type="button" className="link-btn subtle" onClick={() => toggleSaved(p.id, !savedIds.has(p.id))}>
                    {savedIds.has(p.id) ? '♥' : '♡'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {openPerson && (
        <PersonSheet
          person={openPerson.person}
          me={me}
          mode={openPerson.mode}
          existingMentorship={liveMap[openPerson.person.id]}
          existingConnection={openConnMap[openPerson.person.id]}
          savedIds={savedIds}
          onToggleSaved={toggleSaved}
          onClose={() => setOpenPerson(null)}
          onSent={() => reload({ quiet: true })}
          showToast={showToast}
        />
      )}
    </div>
  )
}

function ConnectionAttentionCard({ connection, other, busy, onRespond }) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')

  return (
    <div className="mtg-attention-card">
      <Avatar url={other?.avatar_url} name={other?.full_name} size={44} />
      <div className="mtg-attention-card-body">
        <div className="mtg-attention-card-title">
          {firstName(other?.full_name)} {connection.kind === 'question' ? 'asked you a quick question' : 'suggested a conversation'}
        </div>
        {connection.message && <p className="mtg-attention-card-quote">"{connection.message}"</p>}
        {!replying ? (
          <div className="mentoring-form-actions">
            <button type="button" className="btn primary small" onClick={() => setReplying(true)} disabled={busy}>
              {connection.kind === 'question' ? 'Answer' : 'Suggest a time'}
            </button>
            <button type="button" className="btn ghost small" onClick={() => onRespond(connection, 'decline')} disabled={busy}>
              Can't help
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={connection.kind === 'question' ? 'Your answer' : 'A note, if you like'} />
            {connection.kind === 'conversation' && (
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={{ marginTop: 6 }} />
            )}
            <div className="mentoring-form-actions" style={{ marginTop: 'var(--sp-2)' }}>
              <button type="button" className="btn ghost small" onClick={() => setReplying(false)} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="btn primary small"
                disabled={busy}
                onClick={() => onRespond(connection, connection.kind === 'question' ? 'answer' : 'schedule', {
                  reply, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
                })}
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
