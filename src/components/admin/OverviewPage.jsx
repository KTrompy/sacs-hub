import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { useAdmin } from './AdminContext.jsx'
import { PageHeader, MetricGrid, Skeleton } from './ui.jsx'

/* Same six words a human greeter would use — nothing clever, just "good
   morning/afternoon/evening" off the visitor's own clock. */
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const ACTION_TEXT = {
  approve_member: { verb: 'approved', tone: 'good' },
  unapprove_member: { verb: 'moved back to pending', tone: 'warn' },
  grant_admin: { verb: 'made an admin', tone: 'warn' },
  revoke_admin: { verb: 'removed admin access from', tone: 'warn' },
  delete_member: { verb: 'permanently deleted the account of', tone: 'bad' },
  delete_post: { verb: 'deleted the post', tone: 'bad' },
  delete_job: { verb: 'deleted the job listing', tone: 'bad' },
  delete_event: { verb: 'deleted the event', tone: 'bad' },
  delete_business: { verb: 'deleted the business', tone: 'bad' },
  resolve_report: { verb: 'marked reviewed:', tone: 'good' },
  dismiss_report: { verb: 'dismissed:', tone: 'good' },
  reopen_report: { verb: 'reopened:', tone: 'warn' },
}

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

/* The Overview is the one page every admin sees first, every time — the
   "is anything on fire" screen. It answers that in three tiers: a short list
   of things that genuinely need a decision (Needs attention), a single
   glanceable grid of every count that matters (Site at a glance), and a
   peek at the last few things that happened (Recent activity) with a door
   to the full log. Nothing here is a form; everything here is a shortcut. */
export default function OverviewPage() {
  const navigate = useNavigate()
  const {
    session, members, loadingMembers,
    readyToApprove, unconfirmedCount, unfinished, adminCount,
    openReportsCount, counts,
  } = useAdmin()
  const [recent, setRecent] = useState([])
  const [loadingActivity, setLoadingActivity] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('admin_actions')
        .select('id, actor_name, action, target_label, created_at')
        .order('created_at', { ascending: false })
        .limit(6)
      if (!alive) return
      setRecent(data || [])
      setLoadingActivity(false)
    })()
    return () => { alive = false }
  }, [])

  const me = members.find((m) => m.id === session?.user?.id)
  const firstName = (me?.full_name || '').split(' ')[0]

  // Same four situations the old AttentionPanel distinguished, carried over
  // verbatim: a decision you can make now (ready to approve, open reports),
  // something you can only nudge (unconfirmed email — approving does
  // nothing until they click the link), and something that isn't a task at
  // all (sole admin — informational, softer tone; unfinished signups — not
  // actionable, mentioned only in passing, never given a card of its own).
  const items = []
  if (readyToApprove.length > 0) {
    items.push({
      key: 'approve',
      tone: 'action',
      text: readyToApprove.length === 1 ? '1 person is waiting to be approved' : `${readyToApprove.length} people are waiting to be approved`,
      sub: 'Check them against school records, then approve or decline.',
      action: 'Review queue',
      to: '/admin/pending',
    })
  }
  if (unconfirmedCount > 0) {
    items.push({
      key: 'unconfirmed',
      tone: 'secondary',
      text: unconfirmedCount === 1
        ? "1 person never confirmed their email"
        : `${unconfirmedCount} people never confirmed their email`,
      sub: "They can't sign in until they do — approving them won't help.",
      action: 'Send a link',
      to: '/admin/pending',
    })
  }
  if (openReportsCount > 0) {
    items.push({
      key: 'reports',
      tone: 'action',
      text: openReportsCount === 1 ? '1 report needs a decision' : `${openReportsCount} reports need a decision`,
      sub: 'Members flagged a post, job, business or profile.',
      action: 'Open reports',
      to: '/admin/reports',
    })
  }
  if (adminCount === 1) {
    items.push({
      key: 'soloadmin',
      tone: 'info',
      text: "You're the only admin",
      sub: 'If you lose access, nobody can approve members or moderate content.',
      action: 'Add a second',
      to: '/admin/members',
    })
  }

  return (
    <>
      <PageHeader
        title={me?.full_name ? `${greeting()}, ${firstName}` : greeting()}
        description="Here's where things stand across the site right now."
      />

      <section className="adm-overview-section">
        <h2 className="adm-overview-heading">Needs attention</h2>
        {loadingMembers ? (
          <Skeleton rows={2} />
        ) : items.length === 0 ? (
          <div className="adm-attn-card adm-attn-clear">
            <span className="adm-attn-clear-mark" aria-hidden="true">✓</span>
            <div>
              <strong>Nothing needs you right now.</strong>
              <p>
                No one's waiting on approval and there are no open reports.
                {unfinished > 0 && ` ${unfinished} ${unfinished === 1 ? 'person has' : 'people have'} started signing up but not finished — nothing to do until they come back.`}
              </p>
            </div>
          </div>
        ) : (
          <div className="adm-attn-list">
            {items.map((it) => (
              <div className={`adm-attn-card adm-attn-${it.tone}`} key={it.key}>
                <div>
                  <strong>{it.text}</strong>
                  <p>{it.sub}</p>
                </div>
                <button type="button" className="btn secondary small" onClick={() => navigate(it.to)}>{it.action}</button>
              </div>
            ))}
            {unfinished > 0 && (
              <p className="adm-attn-footnote">
                {unfinished} {unfinished === 1 ? 'person has' : 'people have'} started signing up but not finished — nothing to do until they come back.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="adm-overview-section">
        <h2 className="adm-overview-heading">Site at a glance</h2>
        <MetricGrid
          metrics={[
            { label: 'Members', value: members.length, hint: 'Everyone with an account, approved or not.', onClick: () => navigate('/admin/members') },
            { label: 'Pending', value: readyToApprove.length + unconfirmedCount + unfinished, tone: (readyToApprove.length > 0 ? 'action' : undefined), hint: 'Signed up but not yet let in.', onClick: () => navigate('/admin/pending') },
            { label: 'Open reports', value: openReportsCount, tone: (openReportsCount > 0 ? 'action' : undefined), hint: "Flags from members you haven't ruled on.", onClick: () => navigate('/admin/reports') },
            { label: 'Posts', value: counts.posts, hint: 'Total posts on the feed.', onClick: () => navigate('/admin/posts') },
            { label: 'Jobs', value: counts.jobs, hint: 'Job listings, open and closed.', onClick: () => navigate('/admin/jobs') },
            { label: 'Events', value: counts.events, hint: 'Events, past and upcoming.', onClick: () => navigate('/admin/events') },
            { label: 'Businesses', value: counts.businesses, hint: 'Alumni businesses listed.', onClick: () => navigate('/admin/businesses') },
            { label: 'Merch orders', value: counts.merchOrders, hint: 'Total shop orders placed, any status.', onClick: () => navigate('/admin/orders') },
          ]}
        />
      </section>

      <section className="adm-overview-section">
        <div className="adm-overview-heading-row">
          <h2 className="adm-overview-heading">Recent activity</h2>
          <button type="button" className="btn ghost small" onClick={() => navigate('/admin/activity')}>View full log</button>
        </div>
        {loadingActivity ? (
          <Skeleton rows={3} />
        ) : recent.length === 0 ? (
          <p className="adm-overview-empty">Nothing recorded yet. Approvals, removals and deletions will show up here.</p>
        ) : (
          <ul className="adm-recent-list">
            {recent.map((a) => {
              const meta = ACTION_TEXT[a.action] || { verb: a.action.replace(/_/g, ' '), tone: 'warn' }
              return (
                <li className="adm-recent-row" key={a.id}>
                  <span className={`adm-recent-dot ${meta.tone}`} aria-hidden="true" />
                  <span className="adm-recent-text">
                    <strong>{a.actor_name || 'An admin'}</strong> {meta.verb} <strong>{a.target_label || 'something'}</strong>
                  </span>
                  <span className="adm-recent-time">{timeAgo(a.created_at)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
