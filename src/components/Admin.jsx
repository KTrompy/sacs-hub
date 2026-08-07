import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, adminDeleteAccount, deleteStorageFilesFromUrls } from '../supabaseClient'
import { LEGEND_CATEGORIES } from './Legends.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { Avatar } from './Directory.jsx'
import { useToast } from './Toast.jsx'
import AdminHandbook from './AdminHandbook.jsx'
import MerchAdmin from './MerchAdmin.jsx'
import Turnstile, { TURNSTILE_SITE_KEY } from './Turnstile.jsx'
import { authRedirectTo } from '../authRedirect.js'
import { friendlyAuthError } from '../authErrors.js'

// `help` is the one-line explainer rendered under the tab strip whenever that
// section is open. It exists because this page is meant to be handed to a
// committee member who has never seen it before: every tab should say what it
// is for and what the buttons on it will do, without them having to click one
// to find out. The Handbook tab is the long-form version of the same idea.
const SUBTABS = [
  {
    id: 'pending',
    label: 'Pending approval',
    help: "New signups waiting to be let in. Approving someone gives them full access — the directory, private messaging and posting. Only approve people you can actually place.",
  },
  {
    id: 'reports',
    label: 'Reports',
    help: "Things members have flagged. Use View to judge it yourself, then Mark reviewed once you've dealt with it, or Dismiss if there's nothing wrong. Neither button deletes anything.",
  },
  {
    id: 'members',
    label: 'Members',
    help: "Everyone with an account. Un-approve is the reversible one — it pauses access but keeps everything they've written. Delete account is permanent and has no undo.",
  },
  {
    id: 'posts',
    label: 'Posts',
    help: "Everything on the feed, newest first. Members can delete their own posts, so you only need this for something that shouldn't be up.",
  },
  {
    id: 'jobs',
    label: 'Jobs',
    help: "Job listings members have posted. Deleting one also removes any applications sent to it.",
  },
  {
    id: 'events',
    label: 'Events',
    help: "All events, newest first. Deleting an event also wipes everyone's RSVPs, so check with the organiser first.",
  },
  {
    id: 'businesses',
    label: 'Businesses',
    help: "Alumni businesses. Feature pins one to the top of the directory — harmless and reversible, but worth agreeing a rule for so it doesn't become a favour.",
  },
  {
    id: 'merch',
    label: 'Merch',
    help: "The SACS shop — products, size/colour options and stock, and every order placed. There's no live payment gateway yet, so a new order is a promise to pay, not a completed sale — chase payment before moving someone past Pending.",
  },
  {
    id: 'legends',
    label: 'Notable Old Boys',
    help: "The old boys featured on the home page. Three show at a time and the set rotates every Monday, so the more you write up the longer it stays fresh. Hide is the reversible one — it pulls someone off the home page but keeps the write-up.",
  },
  {
    id: 'activity',
    label: 'Activity log',
    help: "A permanent record of every admin action — who approved, removed or deleted what, and when. Written by the database itself, so nobody can edit or erase it, including you.",
  },
  {
    id: 'handbook',
    label: 'Handbook',
    help: null, // it explains itself
  },
]

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Strips HTML down to plain text for short previews in moderation lists —
// same trick Jobs.jsx uses for search, just reused here for post/job bodies.
// Parsed via DOMParser into a detached document rather than assigned to a
// live element's innerHTML — a detached document never loads its
// resources, so an untrusted payload like <img src=x onerror=alert(1)>
// can't fire its handler while we're just extracting text.
function plainText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''
}

function truncate(text, n = 140) {
  const t = text.trim()
  return t.length > n ? t.slice(0, n).trimEnd() + '…' : t
}

const COUNT_TABLES = [
  ['posts', 'posts'],
  ['jobs', 'jobs'],
  ['events', 'events'],
  ['businesses', 'businesses'],
  ['merchOrders', 'merch_orders'],
]

export default function Admin({ session }) {
  const [subtab, setSubtab] = useState('pending')
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [memberError, setMemberError] = useState(null)
  const [counts, setCounts] = useState({})
  const [openReportsCount, setOpenReportsCount] = useState(0)

  async function loadOpenReportsCount() {
    const { count } = await supabase.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
    setOpenReportsCount(count || 0)
  }

  async function loadMembers() {
    setLoadingMembers(true)
    const { data, error } = await supabase.rpc('admin_list_members')
    if (error) setMemberError(error.message)
    else { setMembers(data || []); setMemberError(null) }
    setLoadingMembers(false)
  }

  async function loadCounts() {
    const results = await Promise.all(
      COUNT_TABLES.map(([, table]) => supabase.from(table).select('*', { count: 'exact', head: true }))
    )
    const next = {}
    COUNT_TABLES.forEach(([key], i) => { next[key] = results[i].count })
    setCounts(next)
  }

  useEffect(() => {
    loadMembers()
    loadCounts()
    loadOpenReportsCount()
  }, [])

  // Optimistic toggle, rolled back (via a full reload) if the write fails —
  // e.g. the schema-update-8.sql migration hasn't been run yet, so the
  // is_admin column or RLS policy doesn't exist.
  // Every destructive/consequential member action runs through here: the
  // buttons had no busy state at all, so a double-click fired the write twice
  // and — worse — gave no feedback that anything was happening on a slow
  // connection, which is what invites the second click.
  const [busyIds, setBusyIds] = useState(() => new Set())
  async function withBusy(id, fn) {
    if (busyIds.has(id)) return
    setBusyIds((prev) => new Set(prev).add(id))
    try {
      await fn()
    } finally {
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  async function setApproved(id, approved) {
    const target = members.find((m) => m.id === id)
    // Guard against approving a signup that hasn't finished FinishSignup.jsx
    // (or the Auth.jsx wizard) yet — e.g. someone who used "Continue with
    // Google" but closed the tab before submitting years and consent.
    // The RLS policy (schema-update-45) enforces this server-side too, but
    // checking here avoids the optimistic-update-then-rollback flicker and
    // gives a clearer message than the raw Postgres error.
    if (approved) {
      if (target && !target.consented_at) {
        setMemberError("This member hasn't finished signing up yet — they still need to complete their profile before you can approve them.")
        return
      }
      // Approving an unconfirmed address is worse than useless: the profile
      // row (and consented_at) is written by handle_new_user the instant the
      // auth user is created, i.e. BEFORE anyone clicks anything in their
      // inbox — so an unconfirmed signup looked exactly like a confirmed one
      // here. Two members were approved that way, were emailed "you're
      // verified, sign in", and then couldn't: sign-in fails outright until
      // the address is confirmed. schema-update-57 blocks this in the database
      // as well; this is the readable version of the same rule.
      if (target && !target.email_confirmed_at) {
        setMemberError("This member hasn't confirmed their email address yet, so they couldn't sign in even once you approve them. Send them a confirmation email first — there's a button on their row.")
        return
      }
    }
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, approved, declined_at: approved ? null : m.declined_at } : m)))
    const { error } = await supabase.from('profiles').update({ approved }).eq('id', id)
    if (error) { setMemberError(friendlyAuthError(error)); loadMembers(); return }
    // Fire-and-forget: a failed email must never block or roll back the
    // approval itself. The member can still find out via "Check my status"
    // on PendingVerification.jsx if this silently fails.
    if (approved) {
      // .then, not .catch — functions.invoke never rejects, it resolves with
      // { data, error } even when the function is undeployed or CORS blocks
      // the response. The old .catch() could not fire under any circumstance,
      // so an approval email that never sent left no trace anywhere.
      supabase.functions.invoke('send-approval-email', { body: { user_id: id } })
        .then(({ error: mailErr }) => {
          if (mailErr) {
            console.error('send-approval-email failed:', mailErr)
            setMemberError("They're approved, but the 'you're verified' email didn't send — let them know another way.")
          }
        })
    }
  }

  // Turning someone down. Keeps the account (so it can be undone, and so they
  // can't simply sign up again into the same queue) but flips them onto the
  // "we couldn't verify you" screen in App.jsx and emails them why.
  async function declineMember(id, reason) {
    setMembers((prev) => prev.map((m) => (
      m.id === id ? { ...m, approved: false, declined_at: new Date().toISOString(), declined_reason: reason } : m
    )))
    const { error } = await supabase
      .from('profiles')
      .update({ declined_at: new Date().toISOString(), declined_reason: reason })
      .eq('id', id)
    if (error) { setMemberError(friendlyAuthError(error)); loadMembers(); return }
    // Same .then-not-.catch reasoning as setApproved above. This one matters
    // more: a decline the person is never told about is exactly the silent
    // limbo this feature exists to end, so say so rather than logging nothing.
    supabase.functions.invoke('send-member-email', { body: { kind: 'declined', user_id: id, reason } })
      .then(({ error: mailErr }) => {
        if (mailErr) {
          console.error('send-member-email (declined) failed:', mailErr)
          setMemberError("They're marked as declined, but the email explaining why didn't send — please tell them directly.")
        }
      })
  }

  // Undo. Puts them back on the ordinary waiting screen with nothing lost.
  async function undoDecline(id) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, declined_at: null, declined_reason: '' } : m)))
    const { error } = await supabase
      .from('profiles')
      .update({ declined_at: null, declined_reason: '' })
      .eq('id', id)
    if (error) { setMemberError(friendlyAuthError(error)); loadMembers() }
  }

  // Re-sends Supabase's own confirmation email to someone whose address is
  // still unconfirmed.
  //
  // This is the member-facing /resend endpoint rather than an admin API call,
  // which is why it needs a captcha token: GoTrue validates one on /resend
  // exactly as it does on /signup. `captchaToken` comes from the widget
  // rendered on the pending tab, and is single-use, so the nonce below forces
  // a fresh challenge after every attempt.
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaNonce, setCaptchaNonce] = useState(0)
  const [resendMsg, setResendMsg] = useState(null)

  async function resendConfirmation(id) {
    const target = members.find((m) => m.id === id)
    if (!target?.email) return
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setResendMsg({ type: 'error', text: 'Complete the security check above first, then try again.' })
      return
    }
    setResendMsg(null)
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: target.email,
      options: { emailRedirectTo: authRedirectTo(), captchaToken },
    })
    setCaptchaToken(null)
    setCaptchaNonce((n) => n + 1)
    setResendMsg(
      error
        ? { type: 'error', text: friendlyAuthError(error) }
        : { type: 'ok', text: `Confirmation email sent to ${target.email}. They need to click it before you can approve them.` }
    )
  }

  // Permanent removal — replaces the old "Revoke" (which only flipped
  // `approved` back to false and left the account and everything they'd
  // posted in place). Deleting the auth user cascades through every
  // person-owned table; see schema-update-44.sql.
  //
  // Goes through the delete-account Edge Function rather than the
  // admin_delete_member() RPC it used to call. Two reasons: the RPC did a raw
  // `delete from auth.users`, which the codebase's own comments elsewhere
  // claim hosted Supabase can silently no-op (the Admin API used by the Edge
  // Function is the documented, reliable route) — and the RPC did no storage
  // cleanup, so an admin-deleted member left their CV, avatar, business photos
  // and job attachments behind in public buckets. Self-deletion and admin
  // deletion now run the exact same code path.
  async function deleteMember(id) {
    const { error } = await adminDeleteAccount(id)
    if (error) { setMemberError(error.message); return }
    setMembers((prev) => prev.filter((m) => m.id !== id))
    loadCounts()
  }

  async function setAdmin(id, is_admin) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, is_admin } : m)))
    const { error } = await supabase.from('profiles').update({ is_admin }).eq('id', id)
    if (error) { setMemberError(error.message); loadMembers() }
  }

  const pending = useMemo(() => members.filter((m) => !m.approved && !m.declined_at), [members])
  // Split three ways, because they mean different things to whoever's on duty:
  // a decision you can make now, someone who wandered off mid-signup, and
  // someone who can't be approved until they confirm their email — which is a
  // thing you CAN act on (resend), unlike the middle group.
  const readyToApprove = useMemo(
    () => pending.filter((m) => m.consented_at && m.email_confirmed_at),
    [pending],
  )
  const unconfirmedCount = useMemo(
    () => pending.filter((m) => m.consented_at && !m.email_confirmed_at).length,
    [pending],
  )
  const unfinished = pending.filter((m) => !m.consented_at).length
  const adminCount = useMemo(() => members.filter((m) => m.is_admin).length, [members])
  const needsSetup = !!memberError && (memberError.includes('does not exist') || memberError.includes('function'))

  const activeTab = SUBTABS.find((t) => t.id === subtab)

  return (
    <section className="panel">
      <h2 className="panel-title">Admin</h2>
      <p className="panel-sub">
        Everything needed to run this site. New to the job? Start with the{' '}
        <button type="button" className="linklike" onClick={() => setSubtab('handbook')}>Handbook</button> tab —
        it's the whole role written down.
      </p>

      {/* The point of this strip: someone opening this page should be able to
          tell in one glance whether they need to do anything, without reading
          seven tabs to find out. When there's nothing outstanding it says so
          explicitly rather than showing a row of zeroes that still looks like
          homework. */}
      <AttentionPanel
        loading={loadingMembers}
        readyToApprove={readyToApprove.length}
        unfinished={unfinished}
        unconfirmed={unconfirmedCount}
        openReports={openReportsCount}
        adminCount={adminCount}
        onGo={setSubtab}
      />

      <div className="admin-stats-row">
        <StatCard label="Members" value={members.length} hint="Everyone with an account, approved or not." />
        <StatCard label="Pending" value={pending.length} highlight={pending.length > 0} hint="Signed up but not yet let in." />
        <StatCard label="Open reports" value={openReportsCount} highlight={openReportsCount > 0} hint="Flags from members you haven't ruled on." />
        <StatCard label="Posts" value={counts.posts} hint="Total posts on the feed." />
        <StatCard label="Jobs" value={counts.jobs} hint="Job listings, open and closed." />
        <StatCard label="Events" value={counts.events} hint="Events, past and upcoming." />
        <StatCard label="Businesses" value={counts.businesses} hint="Alumni businesses listed." />
        <StatCard label="Merch orders" value={counts.merchOrders} hint="Total shop orders placed, any status." />
      </div>

      <div className="admin-subtabs" role="tablist" aria-label="Admin sections">
        {SUBTABS.map((t) => (
          <button type="button"
            key={t.id}
            role="tab"
            aria-selected={subtab === t.id}
            className={[
              subtab === t.id ? 'on' : '',
              t.id === 'handbook' ? 'admin-subtab-guide' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setSubtab(t.id)}
          >
            {t.label}
            {t.id === 'pending' && readyToApprove.length > 0 && (
              <span className="admin-subtab-badge">{readyToApprove.length}</span>
            )}
            {t.id === 'reports' && openReportsCount > 0 && (
              <span className="admin-subtab-badge">{openReportsCount}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab?.help && <p className="admin-tab-help">{activeTab.help}</p>}

      {needsSetup ? (
        <div className="admin-setup-banner">
          <strong>One-time setup needed</strong>
          <p>
            The admin tools (approving members, granting admin access) rely on a database migration
            that hasn't been run yet. Open the Supabase dashboard for this project, go to the
            <strong> SQL Editor</strong>, and run <code>schema-update-8.sql</code> from the project
            folder — it's safe to re-run if you're not sure whether it already went through.
          </p>
          <p className="admin-setup-banner-detail">Error detail: {memberError}</p>
        </div>
      ) : memberError && (
        <p className="form-error">{memberError}</p>
      )}

      {subtab === 'pending' && (
        <PendingList
          loading={loadingMembers}
          pending={pending}
          declined={members.filter((m) => m.declined_at)}
          busyIds={busyIds}
          onApprove={(id) => withBusy(id, () => setApproved(id, true))}
          onDecline={(id, reason) => withBusy(id, () => declineMember(id, reason))}
          onUndoDecline={(id) => withBusy(id, () => undoDecline(id))}
          onResendConfirmation={(id) => withBusy(id, () => resendConfirmation(id))}
          resendMsg={resendMsg}
          captchaNonce={captchaNonce}
          onCaptchaToken={setCaptchaToken}
        />
      )}
      {subtab === 'reports' && <ReportsModeration onCountChange={setOpenReportsCount} />}
      {subtab === 'members' && (
        <MembersTable
          loading={loadingMembers}
          members={members}
          myId={session.user.id}
          busyIds={busyIds}
          onSetApproved={(id, approved) => withBusy(id, () => setApproved(id, approved))}
          onSetAdmin={(id, isAdmin) => withBusy(id, () => setAdmin(id, isAdmin))}
          onDeleteMember={(id) => withBusy(id, () => deleteMember(id))}
        />
      )}
      {subtab === 'posts' && <PostsModeration />}
      {subtab === 'jobs' && <JobsModeration />}
      {subtab === 'events' && <EventsModeration />}
      {subtab === 'businesses' && <BusinessesModeration />}
      {subtab === 'merch' && <MerchAdmin session={session} />}
      {subtab === 'legends' && <LegendsAdmin session={session} />}
      {subtab === 'activity' && <ActivityLog />}
      {subtab === 'handbook' && <AdminHandbook />}
    </section>
  )
}

/* ---------- "Does anything need me?" ---------- */
function AttentionPanel({ loading, readyToApprove, unfinished, unconfirmed, openReports, adminCount, onGo }) {
  if (loading) return null

  const items = []
  if (readyToApprove > 0) {
    items.push({
      key: 'approve',
      text: readyToApprove === 1 ? '1 person is waiting to be approved' : `${readyToApprove} people are waiting to be approved`,
      action: 'Review them',
      tab: 'pending',
    })
  }
  // Surfaced here rather than left buried in the list, because this group is
  // completely stuck until somebody acts: they finished signing up, so from
  // their side it's done, but they can't sign in and no amount of approving
  // will change that.
  if (unconfirmed > 0) {
    items.push({
      key: 'unconfirmed',
      text: unconfirmed === 1
        ? "1 person never confirmed their email — they can't sign in until they do"
        : `${unconfirmed} people never confirmed their email — they can't sign in until they do`,
      action: 'Send them a link',
      tab: 'pending',
    })
  }
  if (openReports > 0) {
    items.push({
      key: 'reports',
      text: openReports === 1 ? '1 report needs a decision' : `${openReports} reports need a decision`,
      action: 'Open reports',
      tab: 'reports',
    })
  }
  // Not urgent, but the thing most likely to end the site: a single admin who
  // loses their phone takes the admin tools with them. Says so once there's
  // someone to promote, rather than nagging on an empty site.
  if (adminCount === 1) {
    items.push({
      key: 'soloadmin',
      text: "You're the only admin — if you lose access, nobody can approve members",
      action: 'Add a second',
      tab: 'members',
      tone: 'soft',
    })
  }

  if (items.length === 0) {
    return (
      <div className="admin-attention clear">
        <span className="admin-attention-icon" aria-hidden="true">✓</span>
        <div>
          <strong>Nothing needs you right now.</strong>
          <p>
            No one's waiting on approval and there are no open reports.
            {unfinished > 0 && ` (${unfinished} ${unfinished === 1 ? 'person has' : 'people have'} started signing up but not finished — nothing to do until they come back.)`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-attention">
      <strong className="admin-attention-title">Needs your attention</strong>
      <ul>
        {items.map((it) => (
          <li key={it.key} className={it.tone === 'soft' ? 'soft' : undefined}>
            <span>{it.text}</span>
            <button type="button" className="btn ghost small" onClick={() => onGo(it.tab)}>{it.action}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Stat card ---------- */
function StatCard({ label, value, highlight, hint }) {
  return (
    <div className={highlight ? 'admin-stat-card highlight' : 'admin-stat-card'} title={hint}>
      <span className="admin-stat-value">{value === null || value === undefined ? '–' : value}</span>
      <span className="admin-stat-label">{label}</span>
      {hint && <span className="admin-stat-hint">{hint}</span>}
    </div>
  )
}

/* ---------- Pending approvals ---------- */
function PendingList({
  loading, pending, declined = [], onApprove, onDecline, onUndoDecline,
  onResendConfirmation, resendMsg, captchaNonce, onCaptchaToken, busyIds,
}) {
  const [decliningId, setDecliningId] = useState(null)
  const [declineReason, setDeclineReason] = useState('')

  if (loading) return <LoadingState message="Loading pending signups…" />

  // Four groups now, because "pending" was hiding four different situations
  // behind one word and only one of them is a decision:
  //   ready       — you can approve or decline right now.
  //   unconfirmed — finished signing up, but never clicked the link in their
  //                 email. Approving them does nothing: sign-in fails until
  //                 the address is confirmed. Actionable, via Resend.
  //   unfinished  — came in through Google and never completed the short form.
  //                 Nothing to approve, but they can be chased.
  //   declined    — already turned down, kept visible so it can be undone.
  const ready = pending.filter((m) => m.consented_at && m.email_confirmed_at)
  const unconfirmed = pending.filter((m) => m.consented_at && !m.email_confirmed_at)
  const unfinished = pending.filter((m) => !m.consented_at)

  if (pending.length === 0 && declined.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="No one's waiting on approval."
        subMessage="New signups will show up here as soon as they create an account."
      />
    )
  }

  function confirmDecline(id) {
    onDecline(id, declineReason.trim())
    setDecliningId(null)
    setDeclineReason('')
  }

  const rowProps = {
    busyIds,
    onApprove,
    onResendConfirmation,
    onStartDecline: (id) => { setDecliningId(id); setDeclineReason('') },
  }

  return (
    <>
      <div className="admin-guidance">
        <strong>Before you approve someone</strong>
        <p>
          Approving lets them read every member's profile, message anyone privately and post to the
          feed. If you can't place the name, leave them here and ask a classmate first — waiting
          costs them nothing, and there's no way to un-send access to the directory.
        </p>
        <p className="admin-guidance-note">
          Approving emails them automatically. If you're sure someone isn't an Old Boy, use
          Decline rather than leaving them waiting — it tells them so, politely, and can be undone.
        </p>
      </div>

      {ready.length > 0 && <h3 className="admin-list-heading">Waiting on your decision</h3>}
      {ready.length > 0 && <PendingRows rows={ready} {...rowProps} />}

      {unconfirmed.length > 0 && (
        <>
          <h3 className="admin-list-heading">Haven&rsquo;t confirmed their email yet</h3>
          <p className="admin-tab-footnote" style={{ marginTop: 0, marginBottom: 10 }}>
            These people finished signing up but never clicked the link in their inbox — usually a
            spam filter ate it. <strong>Approving them wouldn&rsquo;t work</strong>: sign-in is
            refused until the address is confirmed, so they'd get a "you're verified" email and
            then be locked out. Send them a fresh link instead.
          </p>
          {/* The resend goes through Supabase's own /resend endpoint, which
              validates a captcha exactly like signup does — hence a widget on
              an admin screen. Rendered once for the whole group rather than
              per row. */}
          {TURNSTILE_SITE_KEY && (
            <Turnstile onToken={onCaptchaToken} resetSignal={captchaNonce} className="auth-captcha admin-captcha" />
          )}
          {resendMsg && (
            <p className={resendMsg.type === 'ok' ? 'form-notice' : 'form-error'} role="status">
              {resendMsg.text}
            </p>
          )}
          <PendingRows rows={unconfirmed} {...rowProps} />
        </>
      )}

      {unfinished.length > 0 && (
        <>
          <h3 className="admin-list-heading">Started but didn&rsquo;t finish signing up</h3>
          <p className="admin-tab-footnote" style={{ marginTop: 0, marginBottom: 10 }}>
            These accounts have no details yet — almost always someone who used the Google button
            and closed the tab before finishing the short form. They move up on their own the
            moment the person comes back, but a nudge works: use the email link on their row.
          </p>
          <PendingRows rows={unfinished} {...rowProps} />
        </>
      )}

      {declined.length > 0 && (
        <>
          <h3 className="admin-list-heading">Declined</h3>
          <p className="admin-tab-footnote" style={{ marginTop: 0, marginBottom: 10 }}>
            Turned down and told so by email. Their account and anything they'd posted is untouched,
            so this can be reversed at any time — which matters, because the older school records
            are patchy and a decline is often our mistake rather than theirs.
          </p>
          <ul className="admin-list">
            {declined.map((m) => (
              <li className="admin-row" key={m.id}>
                <Avatar url={null} name={m.full_name} size={40} />
                <div className="admin-row-info">
                  <span className="admin-row-name">{m.full_name || 'Name not set yet'}</span>
                  <span className="admin-row-meta">{m.email}</span>
                  <span className="admin-row-meta">
                    Declined {timeAgo(m.declined_at)}
                    {m.declined_reason ? ` · “${m.declined_reason}”` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => onUndoDecline(m.id)}
                  disabled={busyIds?.has(m.id)}
                >
                  {busyIds?.has(m.id) ? 'Working…' : 'Move back to pending'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {decliningId && (
        <div
          className="modal-backdrop"
          onClick={() => setDecliningId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Decline this signup"
        >
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Decline this signup?</h2>
              <button type="button" className="modal-close" onClick={() => setDecliningId(null)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <p>
                They'll be emailed to say we couldn't match them against school records, and
                they'll see the same message if they sign in. Nothing is deleted and you can undo
                this at any time.
              </p>
              <label className="field">
                <span>Reason (optional — they will see this)</span>
                <input
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="e.g. No record of these years in SACS"
                  maxLength={200}
                />
              </label>
              <p className="hint">
                Leave it blank if you'd rather not say. Either way the email invites them to come
                back to us with more detail.
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn ghost" onClick={() => setDecliningId(null)}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => confirmDecline(decliningId)}>
                Decline and email them
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Association-with-SACS flags from profile_details, rendered as short badge
// labels on a pending row — the one thing an admin most needs at a glance to
// judge whether someone belongs in the queue at all (e.g. someone who ticked
// only "Current parent" isn't an Old Boy and may need a different check).
const MEMBERSHIP_ROLE_LABELS = [
  ['old_boy', 'Old Boy'],
  ['current_parent', 'Current Parent'],
  ['past_parent', 'Past Parent'],
  ['current_staff', 'Current Staff'],
  ['past_staff', 'Past Staff'],
]

function PendingRows({ rows, onApprove, onStartDecline, onResendConfirmation, busyIds }) {
  return (
    <ul className="admin-list">
      {rows.map((m) => {
        const busy = busyIds?.has(m.id)
        // consented_at is only set once someone finishes FinishSignup.jsx
        // (Google) or the last step of the signup wizard (email).
        const finished = !!m.consented_at
        const confirmed = !!m.email_confirmed_at
        const roles = MEMBERSHIP_ROLE_LABELS.filter(([key]) => m[key])
        return (
          <li className="admin-row" key={m.id}>
            <Avatar url={null} name={m.full_name} size={40} />
            <div className="admin-row-info">
              <span className="admin-row-name">
                {m.full_name || 'Name not set yet'}
                {/* The legal first name, shown only when it differs from the
                    display name — that's the one to check against school
                    records, and it's exactly the one full_name hides whenever
                    someone gave a preferred name. */}
                {m.first_name && m.preferred_name && m.preferred_name !== m.first_name && (
                  <span className="admin-row-meta"> (on records: {m.first_name} {m.last_name})</span>
                )}
                {m.title && <span className="admin-row-meta"> · {m.title}</span>}
              </span>
              <span className="admin-row-meta">
                <a className="footer-link" href={`mailto:${m.email}`}>{m.email}</a>
                {m.grad_year ? ` · Class of '${String(m.grad_year).slice(-2)}` : ''}
                {m.city ? ` · ${m.city}` : ''}
                {m.province ? `, ${m.province}` : ''}
                {m.country ? `, ${m.country}` : ''}
              </span>
              {/* Membership-record details captured at signup (title, DOB,
                  industry/occupation, cell number) — the committee needs
                  these to check someone against school records, and until
                  now they only lived on the person's own profile page,
                  invisible from here. */}
              {(m.date_of_birth || m.industry || m.occupation || m.phone) && (
                <span className="admin-row-meta">
                  {m.date_of_birth ? `Born ${m.date_of_birth}` : ''}
                  {m.occupation ? `${m.date_of_birth ? ' · ' : ''}${m.occupation}` : ''}
                  {m.industry ? ` (${m.industry})` : ''}
                  {m.phone ? `${(m.date_of_birth || m.occupation) ? ' · ' : ''}${m.phone}` : ''}
                </span>
              )}
              {roles.length > 0 && (
                <span className="admin-row-badges">
                  {roles.map(([key, label]) => (
                    <span key={key} className="admin-badge">{label}</span>
                  ))}
                </span>
              )}
              <span className="admin-row-meta">
                Signed up {timeAgo(m.created_at)}
                {finished && !confirmed ? ' · email not confirmed' : ''}
              </span>
            </div>
            <div className="admin-row-actions">
              {finished && confirmed && (
                <>
                  <button type="button" className="btn primary small" onClick={() => onApprove(m.id)} disabled={busy}>
                    {busy ? 'Working…' : 'Approve'}
                  </button>
                  <button type="button" className="btn ghost small" onClick={() => onStartDecline(m.id)} disabled={busy}>
                    Decline
                  </button>
                </>
              )}
              {finished && !confirmed && (
                <button type="button" className="btn primary small" onClick={() => onResendConfirmation(m.id)} disabled={busy}>
                  {busy ? 'Sending…' : 'Resend confirmation'}
                </button>
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
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Reports (member-filed flags on posts/jobs/businesses/profiles) ---------- */
const REPORT_ENTITY_LABELS = { post: 'Feed post', job: 'Job listing', business: 'Business listing', profile: 'Member profile' }
const REPORT_ENTITY_PATH = {
  post: (id) => `/feed/${id}`,
  job: (id) => `/jobs/${id}`,
  business: (id) => `/businesses/${id}`,
  profile: (id) => `/people/${id}`,
}
const REPORT_REASON_LABELS = { spam: 'Spam or misleading', harassment: 'Harassment or abuse', inappropriate: 'Inappropriate content', scam: 'Scam or fraud', other: 'Something else' }

function ReportsModeration({ onCountChange }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const showToast = useToast()

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
      // Reloading the list on failure made a failed action look like it had
      // worked, right up until the report visibly reappeared. Say so instead.
      showToast("Couldn't update that report — please try again.", { type: 'error' })
      load()
      return
    }
    setItems((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, status } : r))
      onCountChange?.(next.filter((r) => r.status === 'open').length)
      return next
    })
  }

  if (loading) return <LoadingState message="Loading reports…" />
  if (items.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="No reports filed."
        subMessage="When a member flags a post, job, business or profile it lands here. An empty list is a good sign, not a broken page."
      />
    )
  }

  const open = items.filter((r) => r.status === 'open')
  const resolved = items.filter((r) => r.status !== 'open')

  return (
    <>
      {open.length > 0 && (
        <>
          <h3 className="admin-list-heading">Needs review</h3>
          <ReportList items={open} onSetStatus={setStatus} navigate={navigate} />
        </>
      )}
      {resolved.length > 0 && (
        <>
          <h3 className="admin-list-heading">Resolved</h3>
          <ReportList items={resolved} onSetStatus={setStatus} navigate={navigate} />
        </>
      )}
    </>
  )
}

function ReportList({ items, onSetStatus, navigate }) {
  return (
    <ul className="admin-list">
      {items.map((r) => {
        const path = REPORT_ENTITY_PATH[r.entity_type]?.(r.entity_id)
        return (
          <li className="admin-row" key={r.id}>
            <div className="admin-row-info">
              <span className="admin-row-name">
                {REPORT_ENTITY_LABELS[r.entity_type] || r.entity_type}
                <span
                  className={r.status === 'open' ? 'admin-badge pending' : r.status === 'dismissed' ? 'admin-badge' : 'admin-badge approved'}
                  style={{ marginLeft: 8 }}
                >
                  {r.status === 'open' ? 'Open' : r.status === 'dismissed' ? 'Dismissed' : 'Reviewed'}
                </span>
              </span>
              <span className="admin-row-meta">
                {REPORT_REASON_LABELS[r.reason] || r.reason} · Reported by {r.reporter?.full_name || 'a member'} · {timeAgo(r.created_at)}
              </span>
              {r.details && <p className="admin-row-preview">{truncate(r.details)}</p>}
            </div>
            <div className="admin-row-actions">
              {path && (
                <button type="button" className="btn ghost small" onClick={() => navigate(path)} title="Go and look at what was reported">
                  View
                </button>
              )}
              {r.status !== 'reviewed' && (
                <button type="button"
                  className="btn ghost small"
                  onClick={() => onSetStatus(r.id, 'reviewed')}
                  title="You've looked at it and dealt with it. Doesn't delete anything."
                >
                  Mark reviewed
                </button>
              )}
              {r.status !== 'dismissed' && (
                <button type="button"
                  className="btn ghost small"
                  onClick={() => onSetStatus(r.id, 'dismissed')}
                  title="You've looked at it and there's nothing wrong. Doesn't delete anything."
                >
                  Dismiss
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- Members table ---------- */
function MembersTable({ loading, members, myId, onSetApproved, onSetAdmin, onDeleteMember, busyIds }) {
  const [confirmTarget, setConfirmTarget] = useState(null) // { member, action: 'delete' | 'promote' | 'demote' | 'unapprove' }
  const [q, setQ] = useState('')

  if (loading) return <LoadingState message="Loading members…" />

  const needle = q.trim().toLowerCase()
  const shown = members.filter((m) => {
    if (!needle) return true
    return [m.full_name, m.email, m.city].filter(Boolean).join(' ').toLowerCase().includes(needle)
  })

  function askDelete(m) { setConfirmTarget({ member: m, action: 'delete' }) }
  function askPromote(m) { setConfirmTarget({ member: m, action: 'promote' }) }
  function askDemote(m) { setConfirmTarget({ member: m, action: 'demote' }) }
  function askUnapprove(m) { setConfirmTarget({ member: m, action: 'unapprove' }) }

  function runConfirmed() {
    const { member, action } = confirmTarget
    if (action === 'delete') onDeleteMember(member.id)
    if (action === 'promote') onSetAdmin(member.id, true)
    if (action === 'demote') onSetAdmin(member.id, false)
    if (action === 'unapprove') onSetApproved(member.id, false)
    setConfirmTarget(null)
  }

  return (
    <>
      <div className="admin-guidance">
        <strong>Un-approve, or delete?</strong>
        <p>
          <strong>Un-approve</strong> is almost always the right one. It pauses someone's access —
          they see the “waiting to be verified” screen — but keeps their profile, posts and
          messages, and you can let them back in with one click.
        </p>
        <p>
          <strong>Delete account</strong> erases them and everything they've ever posted, for good.
          There is no undo and no backup. Keep it for spam accounts and for people who've asked to
          be removed.
        </p>
        <p className="admin-guidance-note">
          Every action on this tab is recorded in the Activity log with your name against it.
        </p>
      </div>
      <input
        className="search"
        style={{ marginBottom: 14 }}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, email, city…"
      />
      {shown.length === 0 ? (
        <EmptyState icon="search" message="No matching members." />
      ) : (
        <ul className="admin-list">
          {shown.map((m) => {
            const isMe = m.id === myId
            const busy = !!busyIds?.has(m.id)
            return (
              <li className="admin-row" key={m.id}>
                <Avatar url={null} name={m.full_name} size={40} />
                <div className="admin-row-info">
                  <span className="admin-row-name">
                    {m.full_name || 'Name not set yet'}
                    {isMe && <span className="person-name-you">You</span>}
                  </span>
                  <span className="admin-row-meta">
                    {m.email}
                    {m.grad_year ? ` · Class of '${String(m.grad_year).slice(-2)}` : ''}
                    {m.city ? ` · ${m.city}` : ''}
                  </span>
                  <span className="admin-row-badges">
                    <span className={
                      m.approved ? 'admin-badge approved'
                        : m.declined_at ? 'admin-badge'
                        : 'admin-badge pending'
                    }>
                      {m.approved ? 'Approved' : m.declined_at ? 'Declined' : 'Pending'}
                    </span>
                    {/* Silent before: nothing anywhere in the admin tools said
                        an address was unconfirmed, so an account that
                        physically cannot sign in looked identical to a healthy
                        one. */}
                    {!m.email_confirmed_at && <span className="admin-badge pending">Email unconfirmed</span>}
                    {m.is_admin && <span className="admin-badge admin">Admin</span>}
                  </span>
                </div>
                <div className="admin-row-actions">
                  {!m.approved ? (
                    !m.consented_at ? (
                      <button type="button" className="btn primary small" disabled title="Hasn't finished signing up yet">Approve</button>
                    ) : !m.email_confirmed_at ? (
                      // Blocked in the database too (schema-update-57): they
                      // can't sign in until the address is confirmed, so an
                      // approval here would only produce a "you're verified"
                      // email followed by a locked door.
                      <button type="button" className="btn primary small" disabled title="Hasn't confirmed their email address yet — resend it from the Pending approval tab">Approve</button>
                    ) : (
                      <button type="button" className="btn primary small" onClick={() => onSetApproved(m.id, true)} disabled={busy}>
                        {busy ? 'Working…' : 'Approve'}
                      </button>
                    )
                  ) : (
                    // Approving the wrong person used to be irreversible from
                    // here: the only remedy on offer was permanently deleting
                    // their account and everything they'd posted. This puts
                    // them back to Pending instead — they land on the
                    // verification screen, keep their data, and can be
                    // approved again once it's sorted out.
                    <button type="button"
                      className="btn ghost small"
                      onClick={() => askUnapprove(m)}
                      disabled={isMe || busy}
                      title={isMe ? "You can't un-approve yourself" : 'Move back to pending verification'}
                    >
                      Un-approve
                    </button>
                  )}
                  {m.is_admin ? (
                    <button type="button" className="btn ghost small" onClick={() => askDemote(m)} disabled={isMe || busy} title={isMe ? "Can't remove your own admin rights" : undefined}>
                      Remove admin
                    </button>
                  ) : (
                    <button type="button" className="btn ghost small" onClick={() => askPromote(m)} disabled={busy}>Make admin</button>
                  )}
                  {/* Permanent, and there's no undo — the confirm dialog
                      spells out what goes with it. Blocked on your own row;
                      admin_delete_member refuses it server-side too. */}
                  <button type="button"
                    className="btn danger small"
                    onClick={() => askDelete(m)}
                    disabled={isMe || busy}
                    title={isMe ? "Use Settings to delete your own account" : undefined}
                  >
                    {busy ? 'Working…' : 'Delete account'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

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
              ? `${confirmTarget.member.full_name || 'This member'} will be removed from the site entirely — their login, profile, posts, comments, job listings, events, RSVPs, business listings and messages all go with it. This can't be undone, and they'd have to sign up and be approved again from scratch.`
              : confirmTarget.action === 'promote'
              ? `${confirmTarget.member.full_name || 'This member'} will be able to approve members and moderate posts, jobs and events — the same access you have.`
              : confirmTarget.action === 'unapprove'
              ? `${confirmTarget.member.full_name || 'This member'} will lose access to the site and go back to the "waiting to be verified" screen. Nothing they've posted is deleted, and you can approve them again at any time.`
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
    </>
  )
}

/* ---------- Activity log ---------- */
// Read-only by design. The rows are written by database triggers
// (schema-update-52.sql), never by this component — so the log records what
// actually happened to the data, including changes made straight from the
// Supabase dashboard, and can't be quietly skipped by a bug up here.
const ACTION_TEXT = {
  approve_member:    { verb: 'approved',                 tone: 'good' },
  unapprove_member:  { verb: 'moved back to pending',    tone: 'warn' },
  grant_admin:       { verb: 'made an admin',            tone: 'warn' },
  revoke_admin:      { verb: 'removed admin access from', tone: 'warn' },
  delete_member:     { verb: 'permanently deleted the account of', tone: 'bad' },
  delete_post:       { verb: 'deleted the post',         tone: 'bad' },
  delete_job:        { verb: 'deleted the job listing',  tone: 'bad' },
  delete_event:      { verb: 'deleted the event',        tone: 'bad' },
  delete_business:   { verb: 'deleted the business',     tone: 'bad' },
  feature_business:  { verb: 'featured',                 tone: 'good' },
  unfeature_business:{ verb: 'unfeatured',               tone: 'good' },
  resolve_report:    { verb: 'marked reviewed:',         tone: 'good' },
  dismiss_report:    { verb: 'dismissed:',               tone: 'good' },
  reopen_report:     { verb: 'reopened:',                tone: 'warn' },
}

const ACTIVITY_FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'members', label: 'Members', match: (a) => a.target_type === 'member' },
  { id: 'content', label: 'Content removed', match: (a) => a.action.startsWith('delete_') && a.target_type !== 'member' },
  { id: 'reports', label: 'Reports', match: (a) => a.target_type === 'report' },
]

function ActivityLog() {
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

  if (loading) return <LoadingState message="Loading the activity log…" />

  // Same reasoning as the setup banner above: a bare error string tells a
  // non-technical admin nothing they can act on.
  if (error) {
    return (
      <div className="admin-setup-banner">
        <strong>The activity log isn't set up yet</strong>
        <p>
          It needs one database update that hasn't been run — <code>schema-update-52.sql</code>,
          in the project folder. Everything else on this page works fine without it; you just
          won't have a record of who did what until it's run.
        </p>
        <p className="admin-setup-banner-detail">Error detail: {error}</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="Nothing recorded yet."
        subMessage="Approvals, removals and deletions will appear here from now on, with who did them."
      />
    )
  }

  const active = ACTIVITY_FILTERS.find((f) => f.id === filter)
  const shown = active?.match ? items.filter(active.match) : items

  return (
    <>
      <div className="admin-filter-row">
        {ACTIVITY_FILTERS.map((f) => (
          <button type="button"
            key={f.id}
            className={filter === f.id ? 'admin-filter on' : 'admin-filter'}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="search" message="Nothing of that kind has happened yet." />
      ) : (
        <ul className="admin-list">
          {shown.map((a) => {
            const meta = ACTION_TEXT[a.action] || { verb: a.action.replace(/_/g, ' '), tone: 'warn' }
            return (
              <li className="admin-row admin-activity-row" key={a.id}>
                <span className={`admin-activity-dot ${meta.tone}`} aria-hidden="true" />
                <div className="admin-row-info">
                  <span className="admin-row-name">
                    <strong>{a.actor_name || 'An admin'}</strong> {meta.verb}{' '}
                    <strong>{a.target_label || 'something'}</strong>
                  </span>
                  <span className="admin-row-meta">
                    {new Date(a.created_at).toLocaleString()} · {timeAgo(a.created_at)}
                  </span>
                  {a.details && <p className="admin-row-preview">{a.details}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="admin-tab-footnote">
        Showing the {items.length} most recent entries. Nothing here can be edited or removed.
      </p>
    </>
  )
}

/* ---------- Posts moderation ---------- */
function PostsModeration() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('posts')
      .select('id, title, content, created_at, author_id, profiles!posts_author_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(100)
    setPosts(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('posts').delete().eq('id', id)
    if (error) { showToast('Could not delete post.', { type: 'error' }); return }
    setPosts((prev) => prev.filter((p) => p.id !== id))
  }

  if (loading) return <LoadingState message="Loading posts…" />
  if (posts.length === 0) {
    return (
      <EmptyState
        icon="feed"
        message="Nothing's been posted yet."
        subMessage="Every feed post will appear here, newest first, so you can remove one without hunting for it."
      />
    )
  }

  return (
    <ul className="admin-list">
      {posts.map((p) => (
        <li className="admin-row" key={p.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{p.title || 'Untitled post'}</span>
            <span className="admin-row-meta">By {p.profiles?.full_name || 'a member'} · {timeAgo(p.created_at)}</span>
            {p.content && p.content !== '(no text)' && (
              <p className="admin-row-preview">{truncate(plainText(p.content))}</p>
            )}
          </div>
          <DeleteButton onConfirm={() => remove(p.id)} label="Delete post" message="This removes the post for everyone. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Jobs moderation ---------- */
function JobsModeration() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('jobs')
      .select('id, title, company, location, created_at, posted_by, profiles!jobs_posted_by_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(100)
    setJobs(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('jobs').delete().eq('id', id)
    if (error) { showToast('Could not delete job listing.', { type: 'error' }); return }
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }

  if (loading) return <LoadingState message="Loading job listings…" />
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon="jobs"
        message="No job listings yet."
        subMessage="Anything members post to the Jobs board shows up here for removal if it's not genuine."
      />
    )
  }

  return (
    <ul className="admin-list">
      {jobs.map((j) => (
        <li className="admin-row" key={j.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{j.title} — {j.company}</span>
            <span className="admin-row-meta">
              Posted by {j.profiles?.full_name || 'a member'} · {timeAgo(j.created_at)}
              {j.location ? ` · ${j.location}` : ''}
            </span>
          </div>
          <DeleteButton onConfirm={() => remove(j.id)} label="Delete listing" message="This removes the job listing. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Events moderation ---------- */
function EventsModeration() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('events')
      .select('id, title, event_date, location, created_by, profiles!events_created_by_fkey ( full_name )')
      .order('event_date', { ascending: false })
      .limit(100)
    setEvents(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) { showToast('Could not delete event.', { type: 'error' }); return }
    setEvents((prev) => prev.filter((e) => e.id !== id))
  }

  if (loading) return <LoadingState message="Loading events…" />
  if (events.length === 0) {
    return (
      <EmptyState
        icon="events"
        message="No events yet."
        subMessage="Reunions, socials and anything else members schedule will be listed here."
      />
    )
  }

  return (
    <ul className="admin-list">
      {events.map((e) => (
        <li className="admin-row" key={e.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">{e.title}</span>
            <span className="admin-row-meta">
              {new Date(e.event_date).toLocaleString()} · Posted by {e.profiles?.full_name || 'a member'}
              {e.location ? ` · ${e.location}` : ''}
            </span>
          </div>
          <DeleteButton onConfirm={() => remove(e.id)} label="Delete event" message="This removes the event and everyone's RSVPs. This can't be undone." />
        </li>
      ))}
    </ul>
  )
}

/* ---------- Businesses moderation ---------- */
function BusinessesModeration() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('businesses')
      .select('id, name, category, city, country, promoted, created_at, profiles!businesses_owner_id_fkey ( full_name )')
      .order('created_at', { ascending: false })
      .limit(200)
    setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function remove(id) {
    const { error } = await supabase.from('businesses').delete().eq('id', id)
    if (error) { showToast('Could not delete business listing.', { type: 'error' }); return }
    setItems((prev) => prev.filter((b) => b.id !== id))
  }

  async function togglePromote(b) {
    const next = !b.promoted
    setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: next } : x)))
    const { error } = await supabase.from('businesses').update({ promoted: next }).eq('id', b.id)
    if (error) setItems((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: !next } : x)))
  }

  if (loading) return <LoadingState message="Loading businesses…" />
  if (items.length === 0) {
    return (
      <EmptyState
        icon="business"
        message="No businesses listed yet."
        subMessage="Alumni businesses appear here. Featuring one pins it to the top of the public directory."
      />
    )
  }

  return (
    <ul className="admin-list">
      {items.map((b) => (
        <li className="admin-row" key={b.id}>
          <div className="admin-row-info">
            <span className="admin-row-name">
              {b.name}
              {b.promoted && <span className="admin-badge admin" style={{ marginLeft: 8 }}>Featured</span>}
            </span>
            <span className="admin-row-meta">
              {b.category} · Listed by {b.profiles?.full_name || 'a member'}
              {(b.city || b.country) ? ` · ${[b.city, b.country].filter(Boolean).join(', ')}` : ''}
              {' · '}{timeAgo(b.created_at)}
            </span>
          </div>
          <div className="admin-row-actions">
            <button type="button"
              className="btn ghost small"
              onClick={() => togglePromote(b)}
              title={b.promoted ? 'Stop pinning this to the top of the directory' : 'Pin this to the top of the business directory'}
            >
              {b.promoted ? 'Unfeature' : 'Feature'}
            </button>
            <DeleteButton onConfirm={() => remove(b.id)} label="Delete business" message="This removes the business listing. This can't be undone." />
          </div>
        </li>
      ))}
    </ul>
  )
}



/* ---------- SACS legends ---------- */

const MAX_LEGEND_PHOTO_SIZE = 5 * 1024 * 1024 // 5 MB, matches the bucket limit in schema-update-54.sql
const LEGEND_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const EMPTY_LEGEND = {
  name: '', years: '', degree: '', category: 'sport',
  headline: '', story: '', photo_url: '', link_url: '', link_label: '', active: true,
}

// The home-page hall of fame. Unlike every other tab on this page, this one
// creates content rather than moderating it — nobody else can add a legend, so
// there's nothing to review.
function LegendsAdmin({ session }) {
  const [legends, setLegends] = useState([])
  const [loading, setLoading] = useState(true)
  // null = list view. Otherwise the row being edited, or EMPTY_LEGEND for a new
  // one. Kept as one piece of state rather than an `adding` boolean plus an
  // `editing` row, so the two can't both be true.
  const [editing, setEditing] = useState(null)
  const showToast = useToast()

  async function load() {
    // No `active` filter — admins need to see hidden entries, that's the whole
    // point of hiding rather than deleting. The RLS policy allows it.
    const { data, error } = await supabase
      .from('legends')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) showToast("Couldn't load entries.", { type: 'error' })
    setLegends(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function toggleActive(l) {
    const { error } = await supabase.from('legends').update({ active: !l.active }).eq('id', l.id)
    if (error) { showToast("Couldn't update that.", { type: 'error' }); return }
    setLegends((prev) => prev.map((x) => (x.id === l.id ? { ...x, active: !x.active } : x)))
  }

  async function remove(l) {
    const { error } = await supabase.from('legends').delete().eq('id', l.id)
    if (error) { showToast("Couldn't delete that.", { type: 'error' }); return }
    // Best-effort, and only after the row is gone: an orphaned photo in the
    // bucket is untidy, but a deleted photo with the row still pointing at it
    // is a broken tile on the home page.
    if (l.photo_url) deleteStorageFilesFromUrls('legend-photos', l.photo_url)
    setLegends((prev) => prev.filter((x) => x.id !== l.id))
  }

  // Reordering rewrites sort_order for the whole list rather than swapping the
  // two rows involved. Swapping only works if the existing values are already
  // distinct and sane — which they aren't for anything created before someone
  // first dragged something, since they all default to 0. Renumbering from the
  // array index is idempotent and self-healing.
  async function move(index, delta) {
    const target = index + delta
    if (target < 0 || target >= legends.length) return
    const next = [...legends]
    ;[next[index], next[target]] = [next[target], next[index]]
    setLegends(next)
    // One UPDATE per row rather than a single upsert. An upsert would be
    // fewer round trips, but PostgREST sends it as INSERT ... ON CONFLICT DO
    // UPDATE, and Postgres checks NOT NULL while building the tuple — before
    // it ever gets to the conflict — so a payload of just {id, sort_order}
    // fails on `name` and `headline` every time.
    const results = await Promise.all(
      next.map((l, i) => supabase.from('legends').update({ sort_order: i }).eq('id', l.id))
    )
    if (results.some((r) => r.error)) { showToast("Couldn't save the new order.", { type: 'error' }); load() }
  }

  if (editing) {
    return (
      <LegendForm
        session={session}
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }}
      />
    )
  }

  if (loading) return <LoadingState message="Loading…" />

  return (
    <>
      <p className="admin-tab-footnote" style={{ marginTop: 0, marginBottom: 12 }}>
        Three entries show on the home page at a time, chosen by the week so everyone sees the
        same set. Add at least six before it stops repeating. Order here decides which trio comes up first.
      </p>
      <button type="button" className="btn primary small" style={{ marginBottom: 14 }} onClick={() => setEditing(EMPTY_LEGEND)}>
        Add someone
      </button>

      {legends.length === 0 ? (
        <EmptyState
          icon="people"
          message="No one added yet."
          subMessage="Old boys worth remembering — Springboks, founders, cabinet ministers, anyone whose name still comes up. Until you add one, the home page shows nothing here at all."
        />
      ) : (
        <ul className="admin-list">
          {legends.map((l, i) => (
            <li className="admin-row" key={l.id}>
              {l.photo_url && <img className="admin-legend-thumb" src={l.photo_url} alt="" />}
              <div className="admin-row-info">
                <span className="admin-row-name">
                  {l.name}
                  {!l.active && <span className="admin-badge" style={{ marginLeft: 8 }}>Hidden</span>}
                </span>
                <span className="admin-row-meta">
                  {(LEGEND_CATEGORIES.find((c) => c.key === l.category)?.label) || l.category}
                  {l.years ? ` · ${l.years}` : ''} · {truncate(l.headline, 70)}
                </span>
              </div>
              <div className="admin-row-actions">
                <button type="button" className="btn ghost small admin-legend-move" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${l.name} up`} title="Move up">↑</button>
                <button type="button" className="btn ghost small admin-legend-move" onClick={() => move(i, 1)} disabled={i === legends.length - 1} aria-label={`Move ${l.name} down`} title="Move down">↓</button>
                <button type="button" className="btn ghost small" onClick={() => toggleActive(l)}>
                  {l.active ? 'Hide' : 'Show'}
                </button>
                <button type="button" className="btn ghost small" onClick={() => setEditing(l)}>Edit</button>
                <DeleteButton
                  onConfirm={() => remove(l)}
                  label="Delete entry"
                  message="This removes the write-up and the photo for good. Hide is the reversible option."
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function LegendForm({ session, initial, onCancel, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_LEGEND, ...initial })
  const [photoFile, setPhotoFile] = useState(null)
  const [preview, setPreview] = useState(initial.photo_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const showToast = useToast()

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Object URLs are revoked on replacement and unmount — without this every
  // photo the admin previews before settling on one leaks for the life of the
  // page.
  useEffect(() => {
    if (!photoFile) return
    const url = URL.createObjectURL(photoFile)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  function pickPhoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    // Checked here as well as by the bucket: the bucket rejects it either way,
    // but only after a full upload, and only with a raw storage error.
    if (!LEGEND_PHOTO_TYPES.includes(f.type)) { setError('Photo must be a JPG, PNG or WebP.'); return }
    if (f.size > MAX_LEGEND_PHOTO_SIZE) { setError('Photo is over 5MB.'); return }
    setError(null)
    setPhotoFile(f)
  }

  async function uploadPhoto() {
    const ext = photoFile.name.split('.').pop().toLowerCase()
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('legend-photos')
      .upload(path, photoFile, { upsert: false, contentType: photoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('legend-photos').getPublicUrl(path)
    return data.publicUrl
  }

  async function save(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Give the person a name.'); return }
    if (!form.headline.trim()) { setError('Add the one-line claim to fame — it’s what the tile shows.'); return }
    if (!photoFile && !form.photo_url) { setError('A photo is required — the tile is built around it.'); return }

    setSaving(true)
    setError(null)
    try {
      let photoUrl = form.photo_url
      if (photoFile) {
        photoUrl = await uploadPhoto()
        // Only after the new upload succeeded, so a failed replacement leaves
        // the old photo in place rather than none at all.
        if (form.photo_url) deleteStorageFilesFromUrls('legend-photos', form.photo_url)
      }

      const payload = {
        name: form.name.trim(),
        years: form.years.trim() || null,
        degree: form.degree.trim() || null,
        category: form.category,
        headline: form.headline.trim(),
        story: form.story.trim() || null,
        photo_url: photoUrl,
        link_url: form.link_url.trim() || null,
        link_label: form.link_label.trim() || null,
        active: form.active,
      }

      const { error: dbErr } = initial.id
        ? await supabase.from('legends').update(payload).eq('id', initial.id)
        : await supabase.from('legends').insert({ ...payload, created_by: session.user.id })
      if (dbErr) throw dbErr

      showToast(initial.id ? 'Entry updated.' : 'Entry added.')
      onSaved()
    } catch (err) {
      setError(err.message || 'Something went wrong saving that.')
      setSaving(false)
    }
  }

  return (
    <form className="admin-legend-form" onSubmit={save}>
      <div className="field-row">
        <label className="field"><span>Full name *</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="Jan van der Merwe" />
        </label>
        <label className="field"><span>Category *</span>
          <div className="select-wrap">
            <select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {LEGEND_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </label>
      </div>

      <div className="field-row">
        <label className="field"><span>Years in SACS</span>
          <input value={form.years} onChange={(e) => set('years', e.target.value)} maxLength={40} placeholder="1962–1966" />
        </label>
        <label className="field"><span>Degree</span>
          <input value={form.degree} onChange={(e) => set('degree', e.target.value)} maxLength={60} placeholder="BSc Ingenieurswese" />
        </label>
      </div>

      <label className="field"><span>Claim to fame *</span>
        <input
          value={form.headline}
          onChange={(e) => set('headline', e.target.value)}
          maxLength={160}
          placeholder="Springbok lock with 34 caps who captained the side in 1971"
        />
      </label>
      <p className="form-hint" style={{ marginTop: -6 }}>
        One sentence, shown on the tile under the name. The featured tile has room for about
        twice what the two smaller ones do, so keep it tight.
      </p>

      <label className="field"><span>Photo *</span></label>
      <p className="form-hint" style={{ marginTop: -8 }}>
        Landscape works best — the tile crops to fill, and a portrait-shaped photo loses the top of
        the head. JPG, PNG or WebP, up to 5MB.
      </p>
      <div className="job-logo-picker">
        {preview
          ? <img className="admin-legend-preview" src={preview} alt="Photo preview" />
          : <div className="admin-legend-preview admin-legend-preview-empty" aria-hidden="true" />}
        <div className="job-logo-picker-actions">
          <button type="button" className="btn ghost small" onClick={() => fileRef.current?.click()}>
            {preview ? 'Replace photo' : 'Upload photo'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickPhoto} />
      </div>

      <label className="field" style={{ marginTop: 14 }}><span>The story</span>
        <textarea
          rows={8}
          value={form.story}
          onChange={(e) => set('story', e.target.value)}
          placeholder={'Shown when someone opens the tile. Leave a blank line between paragraphs.'}
        />
      </label>

      <div className="field-row">
        <label className="field"><span>Read-more link</span>
          <input value={form.link_url} onChange={(e) => set('link_url', e.target.value)} placeholder="https://en.wikipedia.org/wiki/…" />
        </label>
        <label className="field"><span>Link wording</span>
          <input value={form.link_label} onChange={(e) => set('link_label', e.target.value)} maxLength={40} placeholder="Read his obituary" />
        </label>
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
        <span>Show on the home page</span>
      </label>

      {error && <p className="form-error">{error}</p>}

      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : (initial.id ? 'Save changes' : 'Add legend')}
        </button>
      </div>
    </form>
  )
}
