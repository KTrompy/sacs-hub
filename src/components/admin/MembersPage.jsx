import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, DataTable, StatusBadge, Toolbar, Drawer, DrawerSection, DrawerField, Skeleton } from './ui.jsx'
import { useAdmin } from './AdminContext.jsx'
import { Avatar } from '../Directory.jsx'
import ConfirmDialog from '../ConfirmDialog.jsx'
import EmptyState from '../EmptyState.jsx'
import EmailModal from '../EmailModal.jsx'
import { supabase } from '../../supabaseClient'

const FILTERS = [
  { id: 'all', label: 'Everyone', match: () => true },
  { id: 'approved', label: 'Approved', match: (m) => m.approved },
  { id: 'pending', label: 'Pending', match: (m) => !m.approved && !m.declined_at },
  { id: 'declined', label: 'Declined', match: (m) => !!m.declined_at },
  { id: 'admins', label: 'Admins', match: (m) => m.is_admin },
  { id: 'unconfirmed', label: 'Email unconfirmed', match: (m) => !m.email_confirmed_at },
]

function statusTone(m) {
  return m.approved ? 'good' : m.declined_at ? 'neutral' : 'pending'
}
function statusLabel(m) {
  return m.approved ? 'Approved' : m.declined_at ? 'Declined' : 'Pending'
}

/* Table + drawer, the pattern used everywhere a list needs to open onto a
   full record: the table is for scanning/finding, the drawer is for
   reading everything about one member and deciding what to do about them.
   Consequential decisions (delete, promote, demote, unapprove) stay in a
   modal on top of the drawer — a drawer is for looking, a modal is for
   deciding, and the two are never the same surface. */
export default function MembersPage() {
  const { members, loadingMembers, session, busyIds, setApproved, setAdmin, deleteMember, withBusy } = useAdmin()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [openMember, setOpenMember] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null) // { member, action }
  const [emailOpen, setEmailOpen] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [broadcastOpen, setBroadcastOpen] = useState(false)

  const myId = session?.user?.id
  const active = FILTERS.find((f) => f.id === filter) || FILTERS[0]
  const needle = q.trim().toLowerCase()
  const shown = members.filter((m) => {
    if (!active.match(m)) return false
    if (!needle) return true
    return [m.full_name, m.email, m.city].filter(Boolean).join(' ').toLowerCase().includes(needle)
  })

  // "Select all" only ever acts on the currently filtered/searched rows
  // (`shown`) — selection itself is NOT reset when the filter changes, so
  // an admin can filter to "Pending", tick a few, switch to "Admins", tick
  // a few more, and send one email to the combined set.
  const allShownSelected = shown.length > 0 && shown.every((m) => selected.has(m.id))
  function toggleAllShown() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allShownSelected) shown.forEach((m) => next.delete(m.id))
      else shown.forEach((m) => next.add(m.id))
      return next
    })
  }
  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function ask(member, action) { setConfirmTarget({ member, action }) }
  function runConfirmed() {
    const { member, action } = confirmTarget
    if (action === 'delete') withBusy(member.id, () => deleteMember(member.id))
    if (action === 'promote') withBusy(member.id, () => setAdmin(member.id, true))
    if (action === 'demote') withBusy(member.id, () => setAdmin(member.id, false))
    if (action === 'unapprove') withBusy(member.id, () => setApproved(member.id, false))
    setConfirmTarget(null)
    setOpenMember(null)
  }

  const columns = [
    {
      key: 'select',
      className: 'adm-col-select',
      label: (
        <input
          type="checkbox"
          checked={allShownSelected}
          onChange={toggleAllShown}
          aria-label="Select all shown members"
        />
      ),
      render: (m) => (
        <input
          type="checkbox"
          checked={selected.has(m.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleOne(m.id)}
          aria-label={`Select ${m.full_name || m.email}`}
        />
      ),
    },
    {
      key: 'name', label: 'Name',
      render: (m) => (
        <span className="adm-table-person">
          <Avatar url={null} name={m.full_name} size={30} />
          <span>
            {m.full_name || 'Name not set yet'}
            {m.id === myId && <span className="person-name-you">You</span>}
          </span>
        </span>
      ),
    },
    { key: 'email', label: 'Email', render: (m) => m.email },
    { key: 'status', label: 'Status', render: (m) => <StatusBadge tone={statusTone(m)}>{statusLabel(m)}</StatusBadge> },
    { key: 'admin', label: 'Admin', render: (m) => (m.is_admin ? <StatusBadge tone="info">Admin</StatusBadge> : null) },
    { key: 'joined', label: 'Joined', render: (m) => new Date(m.created_at).toLocaleDateString() },
  ]

  const openM = openMember ? members.find((m) => m.id === openMember) : null

  return (
    <>
      <PageHeader
        title="Members"
        description="Un-approve pauses access reversibly. Delete erases the account and everything they've posted, for good — keep it for spam and for people who've asked to be removed."
        action={selected.size > 0 && (
          <button type="button" className="btn primary small" onClick={() => setBroadcastOpen(true)}>
            Email {selected.size} selected
          </button>
        )}
      />

      <Toolbar
        search={q}
        onSearch={setQ}
        searchPlaceholder="Search by name, email, city…"
        filters={FILTERS.map((f) => ({ id: f.id, label: f.label, count: members.filter(f.match).length }))}
        active={filter}
        onFilter={setFilter}
      />

      {loadingMembers ? (
        <Skeleton rows={6} />
      ) : shown.length === 0 ? (
        <EmptyState icon="search" message="No matching members." subMessage="Try a different search or filter." />
      ) : (
        <DataTable columns={columns} rows={shown} onRowClick={(m) => setOpenMember(m.id)} />
      )}

      {shown.length > 0 && (
        <p className="adm-table-footnote">
          Showing {shown.length} of {members.length} member{members.length === 1 ? '' : 's'}.
          {selected.size > 0 && (
            <>
              {' '}{selected.size} selected — <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>clear</button>
            </>
          )}
        </p>
      )}

      <Drawer
        open={!!openM}
        onClose={() => setOpenMember(null)}
        title={openM?.full_name || 'Member'}
        eyebrow="Member"
      >
        {openM && (
          <>
            <DrawerSection label="Profile">
              <div className="adm-drawer-person">
                <Avatar url={null} name={openM.full_name} size={56} />
                <div>
                  <strong>{openM.full_name || 'Name not set yet'}</strong>
                  <div className="adm-drawer-badges">
                    <StatusBadge tone={statusTone(openM)}>{statusLabel(openM)}</StatusBadge>
                    {openM.is_admin && <StatusBadge tone="info">Admin</StatusBadge>}
                    {!openM.email_confirmed_at && <StatusBadge tone="pending">Email unconfirmed</StatusBadge>}
                  </div>
                </div>
              </div>
              <DrawerField label="Email">
                <button type="button" className="link-btn" onClick={() => setEmailOpen(true)}>{openM.email}</button>
              </DrawerField>
              <DrawerField label="City">{[openM.city, openM.province, openM.country].filter(Boolean).join(', ')}</DrawerField>
              <DrawerField label="Class year">{openM.grad_year ? `Class of '${String(openM.grad_year).slice(-2)}` : null}</DrawerField>
            </DrawerSection>

            <DrawerSection label="Membership">
              <DrawerField label="Joined">{new Date(openM.created_at).toLocaleDateString()}</DrawerField>
              {openM.declined_at && (
                <DrawerField label="Declined">{new Date(openM.declined_at).toLocaleDateString()}{openM.declined_reason ? ` — "${openM.declined_reason}"` : ''}</DrawerField>
              )}
            </DrawerSection>

            <DrawerSection label="Account">
              <div className="adm-drawer-actions">
                <div className="adm-drawer-action-row">
                  {openM.approved && (
                    <button type="button" className="btn secondary small" onClick={() => navigate(`/people/${openM.id}`)}>View profile</button>
                  )}
                  {!openM.approved ? (
                    <button
                      type="button" className="btn primary small"
                      disabled={!openM.consented_at || !openM.email_confirmed_at || busyIds.has(openM.id)}
                      title={!openM.consented_at ? "Hasn't finished signing up" : !openM.email_confirmed_at ? 'Email unconfirmed — resend from Pending' : undefined}
                      onClick={() => withBusy(openM.id, () => setApproved(openM.id, true))}
                    >
                      {busyIds.has(openM.id) ? 'Working…' : 'Approve'}
                    </button>
                  ) : (
                    <button type="button" className="btn secondary small" disabled={openM.id === myId || busyIds.has(openM.id)} onClick={() => ask(openM, 'unapprove')}>
                      Un-approve
                    </button>
                  )}
                </div>
                <div className="adm-drawer-action-row">
                  {openM.is_admin ? (
                    <button type="button" className="btn secondary small" disabled={openM.id === myId} onClick={() => ask(openM, 'demote')}>Remove admin</button>
                  ) : (
                    <button type="button" className="btn secondary small" onClick={() => ask(openM, 'promote')}>Make admin</button>
                  )}
                </div>
                <div className="adm-drawer-action-row adm-drawer-danger">
                  <button
                    type="button" className="btn danger small"
                    disabled={openM.id === myId || busyIds.has(openM.id)}
                    title={openM.id === myId ? 'Use Settings to delete your own account' : undefined}
                    onClick={() => ask(openM, 'delete')}
                  >
                    Delete account
                  </button>
                </div>
              </div>
            </DrawerSection>
          </>
        )}
      </Drawer>

      {confirmTarget && (
        <ConfirmDialog
          title={
            confirmTarget.action === 'delete' ? 'Delete this account?'
              : confirmTarget.action === 'promote' ? 'Grant admin access?'
              : confirmTarget.action === 'unapprove' ? 'Move back to pending?'
              : 'Remove admin access?'
          }
          message={
            confirmTarget.action === 'delete'
              ? `${confirmTarget.member.full_name || 'This member'} will be removed from the site entirely — their login, profile, posts, comments, job listings, events, RSVPs, business listings and messages all go with it. This can't be undone.`
              : confirmTarget.action === 'promote'
              ? `${confirmTarget.member.full_name || 'This member'} will be able to approve members and moderate posts, jobs and events — the same access you have.`
              : confirmTarget.action === 'unapprove'
              ? `${confirmTarget.member.full_name || 'This member'} will lose access to the site and go back to the "waiting to be verified" screen. Nothing they've posted is deleted.`
              : `${confirmTarget.member.full_name || 'This member'} will lose admin access.`
          }
          confirmLabel={
            confirmTarget.action === 'delete' ? 'Delete account'
              : confirmTarget.action === 'promote' ? 'Make admin'
              : confirmTarget.action === 'unapprove' ? 'Move to pending'
              : 'Remove admin'
          }
          onConfirm={runConfirmed}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      {emailOpen && openM && (
        <EmailModal
          eyebrow="New message"
          recipientName={openM.full_name || openM.email}
          onSend={(subject, message) => supabase.functions.invoke('send-directed-email', {
            body: { kind: 'admin_to_member', target_id: openM.id, subject, message },
          })}
          sentToast="Email sent."
          onClose={() => setEmailOpen(false)}
        />
      )}

      {broadcastOpen && (
        <EmailModal
          eyebrow={`${selected.size} member${selected.size === 1 ? '' : 's'} selected`}
          recipientName="Broadcast email"
          placeholder="Write your announcement…"
          richText={true}
          onSend={async (subject, message) => {
            const res = await supabase.functions.invoke('send-broadcast-email', {
              body: { recipient_ids: Array.from(selected), subject, message },
            })
            // Only clear the selection once it's actually sent — a failed
            // send (or one the admin cancels) shouldn't lose the group
            // they just spent time building.
            if (!res.error && !res.data?.error) setSelected(new Set())
            return res
          }}
          sentToast={(data) => {
            const parts = []
            if (data?.sent) parts.push(`Sent to ${data.sent} member${data.sent === 1 ? '' : 's'}`)
            if (data?.opted_out) parts.push(`${data.opted_out} opted out`)
            if (data?.skipped_no_email) parts.push(`${data.skipped_no_email} had no email on file`)
            return parts.length ? `${parts.join(' · ')}.` : 'Broadcast sent.'
          }}
          onClose={() => setBroadcastOpen(false)}
        />
      )}
    </>
  )
}
