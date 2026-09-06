import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import EmptyState from '../EmptyState.jsx'
import { PageHeader, Toolbar, Skeleton } from './ui.jsx'

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

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

// Read-only by design. Rows are written by database triggers, never by this
// component — so the log records what actually happened to the data,
// including changes made straight from the Supabase dashboard.
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
  feature_business: { verb: 'featured', tone: 'good' },
  unfeature_business: { verb: 'unfeatured', tone: 'good' },
  resolve_report: { verb: 'marked reviewed:', tone: 'good' },
  dismiss_report: { verb: 'dismissed:', tone: 'good' },
  reopen_report: { verb: 'reopened:', tone: 'warn' },
}

const FILTERS = [
  { id: 'all', label: 'Everything', match: () => true },
  { id: 'members', label: 'Members', match: (a) => a.target_type === 'member' },
  { id: 'content', label: 'Content removed', match: (a) => a.action.startsWith('delete_') && a.target_type !== 'member' },
  { id: 'reports', label: 'Reports', match: (a) => a.target_type === 'report' },
]

export default function ActivityPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from('admin_actions')
        .select('id, actor_name, action, target_type, target_id, target_label, details, created_at')
        .order('created_at', { ascending: false })
        .limit(300)
      if (!alive) return
      if (error) setError(error.message)
      else setItems(data || [])
      setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  if (loading) return (<><PageHeader title="Activity" description="Every approval, removal and deletion, with who did it. Nothing here can be edited." /><Skeleton rows={5} /></>)

  if (error) {
    return (
      <>
        <PageHeader title="Activity" description="Every approval, removal and deletion, with who did it." />
        <div className="admin-setup-banner">
          <strong>The activity log isn't set up yet</strong>
          <p>It needs one database update that hasn't been run — <code>schema-update-52.sql</code>. Everything else works fine without it.</p>
          <p className="admin-setup-banner-detail">Error detail: {error}</p>
        </div>
      </>
    )
  }

  const active = FILTERS.find((f) => f.id === filter)
  const shown = active?.match ? items.filter(active.match) : items

  // Grouped by calendar day — an audit console reads like a log, not a list
  // of unrelated rows, and "Today" / "Yesterday" is how anyone actually
  // thinks about when something happened.
  const groups = []
  let currentLabel = null
  shown.forEach((a) => {
    const label = dayLabel(a.created_at)
    if (label !== currentLabel) { groups.push({ label, rows: [] }); currentLabel = label }
    groups[groups.length - 1].rows.push(a)
  })

  return (
    <>
      <PageHeader title="Activity" description="Every approval, removal and deletion, with who did it. Nothing here can be edited or removed." />
      <Toolbar filters={FILTERS.map((f) => ({ id: f.id, label: f.label }))} active={filter} onFilter={setFilter} />

      {items.length === 0 ? (
        <EmptyState icon="feed" message="Nothing recorded yet." subMessage="Approvals, removals and deletions will appear here from now on." />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" message="Nothing of that kind has happened yet." />
      ) : (
        <div className="adm-activity-console">
          {groups.map((g) => (
            <div className="adm-activity-day" key={g.label}>
              <h3 className="adm-activity-day-label">{g.label}</h3>
              <ul className="adm-activity-rows">
                {g.rows.map((a) => {
                  const meta = ACTION_TEXT[a.action] || { verb: a.action.replace(/_/g, ' '), tone: 'warn' }
                  return (
                    <li className="adm-activity-row" key={a.id}>
                      <span className={`adm-activity-dot ${meta.tone}`} aria-hidden="true" />
                      <span className="adm-activity-text">
                        <strong>{a.actor_name || 'An admin'}</strong> {meta.verb} <strong>{a.target_label || 'something'}</strong>
                        {a.details && <span className="adm-activity-detail"> — {a.details}</span>}
                      </span>
                      <span className="adm-activity-time" title={new Date(a.created_at).toLocaleString()}>{timeAgo(a.created_at)}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="adm-table-footnote">Showing the {items.length} most recent entries.</p>
    </>
  )
}
