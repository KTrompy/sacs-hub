import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, adminDeleteAccount } from '../../supabaseClient'
import { authRedirectTo } from '../../authRedirect.js'
import { friendlyAuthError } from '../../authErrors.js'
import { TURNSTILE_SITE_KEY } from '../Turnstile.jsx'

/*
 * All of the Admin page's shared data and mutations, lifted out of the old
 * monolithic Admin.jsx into a context so every page (Overview, Pending,
 * Members, and the sidebar's badge counts) can read the same live state
 * without each re-fetching it or without threading a dozen props down
 * through a router.
 *
 * Nothing about WHAT this does changed from the previous single-file
 * version — same Supabase calls, same optimistic updates, same client-side
 * guards, same fire-and-forget email semantics, same reasoning in the
 * comments. Only WHERE it lives changed.
 */

const COUNT_TABLES = [
  ['posts', 'posts'],
  ['jobs', 'jobs'],
  ['events', 'events'],
  ['businesses', 'businesses'],
  ['merchOrders', 'merch_orders'],
]

const AdminCtx = createContext(null)

export function useAdmin() {
  const ctx = useContext(AdminCtx)
  if (!ctx) throw new Error('useAdmin() must be used inside <AdminProvider>')
  return ctx
}

export default function AdminProvider({ session, children }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Optimistic toggle, rolled back (via a full reload) if the write fails —
  // e.g. the schema-update-8.sql migration hasn't been run yet, so the
  // is_admin column or RLS policy doesn't exist.
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
    if (approved) {
      if (target && !target.consented_at) {
        setMemberError("This member hasn't finished signing up yet — they still need to complete their profile before you can approve them.")
        return
      }
      if (target && !target.email_confirmed_at) {
        setMemberError("This member hasn't confirmed their email address yet, so they couldn't sign in even once you approve them. Send them a confirmation email first — there's a button on their row.")
        return
      }
    }
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, approved, declined_at: approved ? null : m.declined_at } : m)))
    const { error } = await supabase.from('profiles').update({ approved }).eq('id', id)
    if (error) { setMemberError(friendlyAuthError(error)); loadMembers(); return }
    if (approved) {
      supabase.functions.invoke('send-approval-email', { body: { user_id: id } })
        .then(({ error: mailErr }) => {
          if (mailErr) {
            console.error('send-approval-email failed:', mailErr)
            setMemberError("They're approved, but the 'you're verified' email didn't send — let them know another way.")
          }
        })
    }
  }

  async function declineMember(id, reason) {
    setMembers((prev) => prev.map((m) => (
      m.id === id ? { ...m, approved: false, declined_at: new Date().toISOString(), declined_reason: reason } : m
    )))
    const { error } = await supabase
      .from('profiles')
      .update({ declined_at: new Date().toISOString(), declined_reason: reason })
      .eq('id', id)
    if (error) { setMemberError(friendlyAuthError(error)); loadMembers(); return }
    supabase.functions.invoke('send-member-email', { body: { kind: 'declined', user_id: id, reason } })
      .then(({ error: mailErr }) => {
        if (mailErr) {
          console.error('send-member-email (declined) failed:', mailErr)
          setMemberError("They're marked as declined, but the email explaining why didn't send — please tell them directly.")
        }
      })
  }

  async function undoDecline(id) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, declined_at: null, declined_reason: '' } : m)))
    const { error } = await supabase
      .from('profiles')
      .update({ declined_at: null, declined_reason: '' })
      .eq('id', id)
    if (error) { setMemberError(friendlyAuthError(error)); loadMembers() }
  }

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

  const value = {
    session,
    members, loadingMembers, memberError, setMemberError,
    counts, openReportsCount, setOpenReportsCount,
    busyIds, withBusy,
    setApproved, declineMember, undoDecline, deleteMember, setAdmin,
    resendConfirmation, captchaNonce, captchaToken, setCaptchaToken, resendMsg,
    pending, readyToApprove, unconfirmedCount, unfinished, adminCount, needsSetup,
    loadMembers, loadCounts,
  }

  return <AdminCtx.Provider value={value}>{children}</AdminCtx.Provider>
}
