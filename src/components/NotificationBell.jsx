import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

// Where a notification should take you when clicked — matches the tabs
// this app already has (see App.jsx TABS).
// `member` covers the new-signup alerts added in schema-update-46, which
// go to admins and should land them on the pending-approval queue.
// `mentorship` covers the request/accept/decline/session alerts added in
// schema-update-56 — they all land on Mentoring's "My mentoring" tab, which
// is where every one of them is actionable.
const ENTITY_TAB = {
  post: 'feed',
  event: 'events',
  job: 'jobs',
  member: 'admin',
  mentorship: 'mentoring',
  conversation: null,
}

// Bell + dropdown in the header. Polls once on mount, then stays live via
// Supabase realtime (new row insert) so a badge appears without a refresh —
// this is the app's only cross-feature "something happened" signal, so it
// intentionally covers likes/comments/RSVPs/messages in one place instead
// of each feature inventing its own alert.
const PAGE_SIZE = 30

export default function NotificationBell({ session, onNavigate }) {
  const [items, setItems] = useState([])
  // The badge used to count unread rows inside the 30 fetched above, so
  // anyone sitting on 30+ unread notifications saw an undercount that never
  // moved. Counted server-side instead, with no row limit.
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // persistRead() below deliberately awaits getSession() first to dodge the
  // auth-header-not-settled race (see its comment). This load had exactly the
  // same exposure and no such guard — the very first fetch could come back
  // empty because RLS matched nothing yet, and nothing retried.
  async function load() {
    await supabase.auth.getSession()
    const fetchPage = () => supabase
      .from('notifications')
      .select('id, type, entity_type, entity_id, message, read, created_at')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    let { data, error } = await fetchPage()
    if (error) {
      await new Promise((r) => setTimeout(r, 600));
      ({ data, error } = await fetchPage())
    }
    if (error) { setLoadError(true); return }
    setLoadError(false)
    setItems(data || [])
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('read', false)
    if (typeof count === 'number') setUnreadTotal(count)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('notifications:' + session.user.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${session.user.id}`,
      }, (payload) => {
        setItems((prev) => [payload.new, ...prev].slice(0, PAGE_SIZE))
        if (!payload.new.read) setUnreadTotal((n) => n + 1)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id])

  useEffect(() => {
    if (!open) return
    function onClick(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unreadCount = unreadTotal

  // Persist read=true with a settle + retry. The naive fire-and-forget
  // update this replaces could silently fail (same auth-header-not-settled
  // race documented in App.jsx's profile load — the RLS policy then matches
  // zero rows without erroring), which is exactly the reported "clicked it,
  // reloaded, and the notification came back" bug. Awaiting getSession()
  // first closes that window; one retry covers transient blips.
  async function persistRead(ids) {
    await supabase.auth.getSession()
    const attempt = () =>
      supabase.from('notifications').update({ read: true }).in('id', ids)
        .eq('user_id', session.user.id)
    const { error } = await attempt()
    if (error) {
      await new Promise((r) => setTimeout(r, 600))
      await attempt()
    }
  }

  // Marks *everything* unread, not just the page of 30 currently loaded —
  // otherwise "Mark all read" left an older backlog unread and the badge
  // popped straight back to a non-zero count on the next load.
  async function markAllRead() {
    if (unreadTotal === 0) return
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadTotal(0)
    await supabase.auth.getSession()
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('read', false)
    if (error) load()
  }

  async function openNotification(n) {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnreadTotal((c) => Math.max(0, c - 1))
      persistRead([n.id])
    }
    setOpen(false)
    const tab = ENTITY_TAB[n.entity_type]
    // Pass the entity id along too, so the caller can deep-link straight to
    // the specific post/event this notification is about (e.g. /feed/:id)
    // instead of just landing generically on that tab's top.
    if (tab) onNavigate?.(tab, n.entity_type, n.entity_id)
    else onNavigate?.('messages')
  }

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        aria-expanded={open}
      >
        <BellIcon />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown" role="dialog" aria-label="Notifications">
          <div className="notif-dropdown-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && (
              <button type="button" className="link-btn" onClick={markAllRead}>Mark all read</button>
            )}
          </div>
          <div className="notif-list">
            {loadError && (
              <p className="form-error">
                Couldn&rsquo;t load your notifications.{' '}
                <button type="button" className="link-btn" onClick={load}>Try again</button>
              </p>
            )}
            {!loadError && items.length === 0 && <p className="empty small">Nothing yet — likes, comments, RSVPs and messages will show up here.</p>}
            {items.map((n) => (
              <button type="button"
                key={n.id}
                className={n.read ? 'notif-item' : 'notif-item unread'}
                onClick={() => openNotification(n)}
              >
                <span className="notif-dot" aria-hidden="true" />
                <span className="notif-item-body">
                  <span className="notif-item-message">{n.message}</span>
                  <span className="notif-item-time">{timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
