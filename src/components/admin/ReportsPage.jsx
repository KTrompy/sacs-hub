import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { useAdmin } from './AdminContext.jsx'
import { PageHeader, StatusBadge, Drawer, DrawerSection, DrawerField, Skeleton } from './ui.jsx'
import EmptyState from '../EmptyState.jsx'
import { useToast } from '../Toast.jsx'

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

const ENTITY_LABELS = { post: 'Feed post', job: 'Job listing', business: 'Business listing', profile: 'Member profile' }
const ENTITY_PATH = {
  post: (id) => `/feed/${id}`,
  job: (id) => `/jobs/${id}`,
  business: (id) => `/businesses/${id}`,
  profile: (id) => `/people/${id}`,
}
const REASON_LABELS = { spam: 'Spam or misleading', harassment: 'Harassment or abuse', inappropriate: 'Inappropriate content', scam: 'Scam or fraud', other: 'Something else' }

/* Open needs to dominate the page — it's the only group with a decision left
   in it — so it renders first, full-size, unboxed. Resolved is kept for
   context but visually recedes: smaller type, quieter colour, tucked below
   a divider rather than competing for the same attention. */
export default function ReportsPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [openDrawerId, setOpenDrawerId] = useState(null)
  const navigate = useNavigate()
  const showToast = useToast()
  const { setOpenReportsCount } = useAdmin()

  async function load() {
    const { data } = await supabase
      .from('reports')
      .select('id, entity_type, entity_id, reason, details, status, created_at, reporter:profiles!reports_reporter_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function setStatus(id, status) {
    const { error } = await supabase.from('reports').update({ status }).eq('id', id)
    if (error) {
      showToast("Couldn't update that report — please try again.", { type: 'error' })
      load()
      return
    }
    setItems((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, status } : r))
      setOpenReportsCount(next.filter((r) => r.status === 'open').length)
      return next
    })
  }

  if (loading) return (<><PageHeader title="Reports" description="Flags members filed on a post, job, business or profile." /><Skeleton rows={4} /></>)

  const open = items.filter((r) => r.status === 'open')
  const resolved = items.filter((r) => r.status !== 'open')
  const drawerItem = items.find((r) => r.id === openDrawerId)

  return (
    <>
      <PageHeader title="Reports" description="Flags members filed on a post, job, business or profile." />

      {items.length === 0 ? (
        <EmptyState icon="feed" message="No reports filed." subMessage="When a member flags something it lands here. An empty list is a good sign, not a broken page." />
      ) : (
        <>
          {open.length > 0 ? (
            <section className="adm-reports-open">
              <h3 className="adm-reports-heading">Needs review</h3>
              <ReportRows items={open} onSetStatus={setStatus} navigate={navigate} onOpen={setOpenDrawerId} />
            </section>
          ) : (
            <p className="adm-overview-empty">Nothing open right now.</p>
          )}

          {resolved.length > 0 && (
            <section className="adm-reports-resolved">
              <h3 className="adm-reports-heading">Resolved</h3>
              <ReportRows items={resolved} onSetStatus={setStatus} navigate={navigate} onOpen={setOpenDrawerId} quiet />
            </section>
          )}
        </>
      )}

      <Drawer open={!!drawerItem} onClose={() => setOpenDrawerId(null)} title={drawerItem ? (ENTITY_LABELS[drawerItem.entity_type] || drawerItem.entity_type) : ''} eyebrow="Report">
        {drawerItem && (
          <DrawerSection label="Context">
            <DrawerField label="Status"><StatusBadge tone={drawerItem.status === 'open' ? 'pending' : drawerItem.status === 'dismissed' ? 'neutral' : 'good'}>{drawerItem.status === 'open' ? 'Open' : drawerItem.status === 'dismissed' ? 'Dismissed' : 'Reviewed'}</StatusBadge></DrawerField>
            <DrawerField label="Reason">{REASON_LABELS[drawerItem.reason] || drawerItem.reason}</DrawerField>
            <DrawerField label="Reported by">{drawerItem.reporter?.full_name || 'a member'}</DrawerField>
            <DrawerField label="Filed">{timeAgo(drawerItem.created_at)}</DrawerField>
            <DrawerField label="Details">{drawerItem.details}</DrawerField>
            <div className="adm-drawer-actions">
              <div className="adm-drawer-action-row">
                {ENTITY_PATH[drawerItem.entity_type] && (
                  <button type="button" className="btn secondary small" onClick={() => navigate(ENTITY_PATH[drawerItem.entity_type](drawerItem.entity_id))}>Go and look</button>
                )}
                {drawerItem.status !== 'reviewed' && (
                  <button type="button" className="btn secondary small" onClick={() => setStatus(drawerItem.id, 'reviewed')}>Mark reviewed</button>
                )}
                {drawerItem.status !== 'dismissed' && (
                  <button type="button" className="btn ghost small" onClick={() => setStatus(drawerItem.id, 'dismissed')}>Dismiss</button>
                )}
              </div>
            </div>
          </DrawerSection>
        )}
      </Drawer>
    </>
  )
}

function ReportRows({ items, onSetStatus, navigate, onOpen, quiet }) {
  return (
    <ul className={quiet ? 'adm-report-list quiet' : 'adm-report-list'}>
      {items.map((r) => {
        const path = ENTITY_PATH[r.entity_type]?.(r.entity_id)
        return (
          <li className="adm-report-row" key={r.id}>
            <button type="button" className="adm-report-row-main" onClick={() => onOpen(r.id)}>
              <span className="adm-report-title">
                {ENTITY_LABELS[r.entity_type] || r.entity_type}
                <StatusBadge tone={r.status === 'open' ? 'pending' : r.status === 'dismissed' ? 'neutral' : 'good'}>
                  {r.status === 'open' ? 'Open' : r.status === 'dismissed' ? 'Dismissed' : 'Reviewed'}
                </StatusBadge>
              </span>
              <span className="adm-report-meta">
                {REASON_LABELS[r.reason] || r.reason} · Reported by {r.reporter?.full_name || 'a member'} · {timeAgo(r.created_at)}
              </span>
            </button>
            <div className="adm-report-actions">
              {path && <button type="button" className="btn ghost small" onClick={() => navigate(path)}>View</button>}
              {r.status !== 'reviewed' && <button type="button" className="btn ghost small" onClick={() => onSetStatus(r.id, 'reviewed')}>Mark reviewed</button>}
              {r.status !== 'dismissed' && <button type="button" className="btn ghost small" onClick={() => onSetStatus(r.id, 'dismissed')}>Dismiss</button>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
