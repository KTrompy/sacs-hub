import { useState } from 'react'
import { PageHeader, Skeleton } from './ui.jsx'
import { useAdmin } from './AdminContext.jsx'
import { Avatar } from '../Directory.jsx'
import EmptyState from '../EmptyState.jsx'
import Turnstile, { TURNSTILE_SITE_KEY } from '../Turnstile.jsx'

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

// Association-with-SACS flags from profile_details, rendered as short badge
// labels on a pending card — the one thing an admin most needs at a glance
// to judge whether someone belongs in the queue at all.
const MEMBERSHIP_ROLE_LABELS = [
  ['old_boy', 'Old Boy'],
  ['current_parent', 'Current Parent'],
  ['past_parent', 'Past Parent'],
  ['current_staff', 'Current Staff'],
  ['past_staff', 'Past Staff'],
]

/* The review queue. Four groups, preserved exactly from the old page because
   each means something different to whoever's on duty:
   - ready        — a real decision, approve or decline, right now.
   - unconfirmed  — finished signing up but never clicked the email link.
                    Approving does nothing until they do; the fix is Resend.
   - unfinished   — came in through Google and never finished the short
                    form. Nothing to approve; a nudge is all there is.
   - declined     — already turned down, kept visible so it can be undone. */
export default function PendingPage() {
  const {
    pending, members, loadingMembers, busyIds,
    setApproved, declineMember, undoDecline, resendConfirmation,
    captchaNonce, setCaptchaToken, resendMsg, withBusy,
  } = useAdmin()
  const [declineTarget, setDeclineTarget] = useState(null)
  const [declineReason, setDeclineReason] = useState('')

  const declined = members.filter((m) => m.declined_at)
  const ready = pending.filter((m) => m.consented_at && m.email_confirmed_at)
  const unconfirmed = pending.filter((m) => m.consented_at && !m.email_confirmed_at)
  const unfinished = pending.filter((m) => !m.consented_at)

  function confirmDecline() {
    withBusy(declineTarget.id, () => declineMember(declineTarget.id, declineReason.trim()))
    setDeclineTarget(null)
    setDeclineReason('')
  }

  return (
    <>
      <PageHeader
        title="Pending"
        description="Approving lets someone read every profile, message anyone and post to the feed. If you can't place a name, leave them here and ask a classmate — waiting costs nothing."
      />

      {loadingMembers ? (
        <Skeleton rows={4} />
      ) : pending.length === 0 && declined.length === 0 ? (
        <EmptyState
          icon="feed"
          message="No one's waiting on approval."
          subMessage="New signups will show up here as soon as they create an account."
        />
      ) : (
        <>
          {ready.length > 0 && (
            <QueueGroup title="Waiting on your decision" count={ready.length}>
              {ready.map((m) => (
                <PendingCard
                  key={m.id}
                  member={m}
                  busy={busyIds.has(m.id)}
                  onApprove={() => withBusy(m.id, () => setApproved(m.id, true))}
                  onDecline={() => { setDeclineTarget(m); setDeclineReason('') }}
                />
              ))}
            </QueueGroup>
          )}

          {unconfirmed.length > 0 && (
            <QueueGroup
              title="Haven't confirmed their email yet"
              count={unconfirmed.length}
              note="These people finished signing up but never clicked the link in their inbox — usually a spam filter ate it. Approving them wouldn't work: sign-in is refused until the address is confirmed. Send a fresh link instead."
            >
              {TURNSTILE_SITE_KEY && (
                <Turnstile onToken={setCaptchaToken} resetSignal={captchaNonce} className="auth-captcha admin-captcha" />
              )}
              {resendMsg && (
                <p className={resendMsg.type === 'ok' ? 'form-notice' : 'form-error'} role="status">{resendMsg.text}</p>
              )}
              {unconfirmed.map((m) => (
                <PendingCard
                  key={m.id}
                  member={m}
                  busy={busyIds.has(m.id)}
                  onResend={() => withBusy(m.id, () => resendConfirmation(m.id))}
                />
              ))}
            </QueueGroup>
          )}

          {unfinished.length > 0 && (
            <QueueGroup
              title="Started but didn't finish signing up"
              count={unfinished.length}
              note="These accounts have no details yet — almost always someone who used the Google button and closed the tab. They move up on their own the moment the person comes back; a nudge works too."
            >
              {unfinished.map((m) => (
                <PendingCard key={m.id} member={m} busy={busyIds.has(m.id)} />
              ))}
            </QueueGroup>
          )}

          {declined.length > 0 && (
            <QueueGroup
              title="Declined"
              count={declined.length}
              note="Turned down and told so by email. Nothing of theirs is touched, so this can be reversed at any time."
              muted
            >
              {declined.map((m) => (
                <div className="adm-pending-card adm-pending-declined" key={m.id}>
                  <Avatar url={null} name={m.full_name} size={44} />
                  <div className="adm-pending-info">
                    <span className="adm-pending-name">{m.full_name || 'Name not set yet'}</span>
                    <span className="adm-pending-meta">{m.email}</span>
                    <span className="adm-pending-meta">
                      Declined {timeAgo(m.declined_at)}{m.declined_reason ? ` · "${m.declined_reason}"` : ''}
                    </span>
                  </div>
                  <button type="button" className="btn ghost small" onClick={() => withBusy(m.id, () => undoDecline(m.id))} disabled={busyIds.has(m.id)}>
                    {busyIds.has(m.id) ? 'Working…' : 'Move back to pending'}
                  </button>
                </div>
              ))}
            </QueueGroup>
          )}
        </>
      )}

      {declineTarget && (
        <div className="modal-backdrop" onClick={() => setDeclineTarget(null)} role="dialog" aria-modal="true" aria-label="Decline this signup">
          <div className="modal confirm-modal adm-decline-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Decline {declineTarget.full_name || 'this signup'}?</h2>
              <button type="button" className="modal-close" onClick={() => setDeclineTarget(null)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <p>
                They'll be emailed to say we couldn't match them against school records, and they'll
                see the same message if they sign in. Nothing is deleted and this can be undone at any time.
              </p>
              <label className="field">
                <span>Reason (optional — they will see this)</span>
                <input
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="e.g. No record of these years in SACS"
                  maxLength={200}
                  autoFocus
                />
              </label>
              <p className="hint">Leave it blank if you'd rather not say. Either way the email invites them to come back with more detail.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn ghost" onClick={() => setDeclineTarget(null)} data-autofocus>Cancel</button>
              <button type="button" className="btn danger" onClick={confirmDecline}>Decline and email them</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function QueueGroup({ title, count, note, muted, children }) {
  return (
    <section className={muted ? 'adm-queue-group muted' : 'adm-queue-group'}>
      <div className="adm-queue-group-head">
        <h3>{title}</h3>
        <span className="adm-queue-group-count">{count}</span>
      </div>
      {note && <p className="adm-queue-note">{note}</p>}
      <div className="adm-pending-cards">{children}</div>
    </section>
  )
}

function PendingCard({ member: m, busy, onApprove, onDecline, onResend }) {
  const finished = !!m.consented_at
  const confirmed = !!m.email_confirmed_at
  const roles = MEMBERSHIP_ROLE_LABELS.filter(([key]) => m[key])
  return (
    <div className="adm-pending-card">
      <Avatar url={null} name={m.full_name} size={48} />
      <div className="adm-pending-info">
        <span className="adm-pending-name">
          {m.full_name || 'Name not set yet'}
          {m.first_name && m.preferred_name && m.preferred_name !== m.first_name && (
            <span className="adm-pending-meta"> (on records: {m.first_name} {m.last_name})</span>
          )}
          {m.title && <span className="adm-pending-meta"> · {m.title}</span>}
        </span>
        <span className="adm-pending-meta">
          <a href={`mailto:${m.email}`}>{m.email}</a>
          {m.grad_year ? ` · Class of '${String(m.grad_year).slice(-2)}` : ''}
          {m.city ? ` · ${m.city}` : ''}{m.province ? `, ${m.province}` : ''}{m.country ? `, ${m.country}` : ''}
        </span>
        {(m.date_of_birth || m.industry || m.occupation || m.phone) && (
          <span className="adm-pending-meta">
            {m.date_of_birth ? `Born ${m.date_of_birth}` : ''}
            {m.occupation ? `${m.date_of_birth ? ' · ' : ''}${m.occupation}` : ''}
            {m.industry ? ` (${m.industry})` : ''}
            {m.phone ? `${(m.date_of_birth || m.occupation) ? ' · ' : ''}${m.phone}` : ''}
          </span>
        )}
        {roles.length > 0 && (
          <span className="adm-pending-badges">
            {roles.map(([key, label]) => <span key={key} className="adm-badge adm-badge-neutral">{label}</span>)}
          </span>
        )}
        <span className="adm-pending-meta">
          Signed up {timeAgo(m.created_at)}{finished && !confirmed ? ' · email not confirmed' : ''}
        </span>
      </div>
      <div className="adm-pending-actions">
        {finished && confirmed && (
          <>
            <button type="button" className="btn primary small" onClick={onApprove} disabled={busy}>{busy ? 'Working…' : 'Approve'}</button>
            <button type="button" className="btn ghost small" onClick={onDecline} disabled={busy}>Decline</button>
          </>
        )}
        {finished && !confirmed && (
          <button type="button" className="btn primary small" onClick={onResend} disabled={busy}>{busy ? 'Sending…' : 'Resend confirmation'}</button>
        )}
        {!finished && (
          <a
            className="btn ghost small"
            href={`mailto:${m.email}?subject=${encodeURIComponent('Finishing your SACS Alumni signup')}&body=${encodeURIComponent('Hi,\n\nYou started signing up for the SACS Alumni Hub but there are a couple of details still to fill in — it takes about thirty seconds. Just sign in again at https://www.sacsalumni.org and it will pick up where you left off.\n\nThanks,\nSACS Alumni')}`}
          >
            Nudge them
          </a>
        )}
      </div>
    </div>
  )
}
