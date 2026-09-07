import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { useToast } from '../Toast.jsx'
import EmptyState from '../EmptyState.jsx'
import DeleteButton from '../DeleteButton.jsx'
import { PageHeader, DataTable, Toolbar, StatusBadge, Skeleton } from './ui.jsx'

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
function plainText(html) {
  if (!html) return ''
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
function truncate(text, n = 140) {
  if (!text) return ''
  return text.length > n ? `${text.slice(0, n).trim()}…` : text
}

/* ---------- Posts ---------- */
export function PostsPage() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
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

  const needle = q.trim().toLowerCase()
  const shown = posts.filter((p) => !needle || [p.title, plainText(p.content), p.profiles?.full_name].filter(Boolean).join(' ').toLowerCase().includes(needle))

  const columns = [
    { key: 'title', label: 'Post', render: (p) => (
      <span className="adm-content-cell">
        <strong>{p.title || 'Untitled post'}</strong>
        {p.content && p.content !== '(no text)' && <span className="adm-content-preview">{truncate(plainText(p.content), 90)}</span>}
      </span>
    ) },
    { key: 'author', label: 'Author', render: (p) => p.profiles?.full_name || 'a member' },
    { key: 'when', label: 'Posted', render: (p) => timeAgo(p.created_at) },
    { key: 'actions', label: '', className: 'adm-table-actions-col', render: (p) => (
      <span className="adm-table-row-actions">
        <button type="button" className="btn ghost small" onClick={() => navigate(`/feed/${p.id}`)}>View</button>
        <DeleteButton onConfirm={() => remove(p.id)} label="Delete post" message="This removes the post for everyone. This can't be undone." />
      </span>
    ) },
  ]

  return (
    <>
      <PageHeader title="Posts" description="Every feed post, newest first." />
      <Toolbar search={q} onSearch={setQ} searchPlaceholder="Search posts by title, text or author…" />
      {loading ? <Skeleton rows={5} /> : shown.length === 0 ? (
        <EmptyState icon="feed" message={posts.length === 0 ? "Nothing's been posted yet." : 'No matching posts.'} />
      ) : (
        <DataTable columns={columns} rows={shown} />
      )}
      {shown.length > 0 && <p className="adm-table-footnote">Showing the {posts.length} most recent posts.</p>}
    </>
  )
}

/* ---------- Jobs ---------- */
export function JobsPage() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
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

  const needle = q.trim().toLowerCase()
  const shown = jobs.filter((j) => !needle || [j.title, j.company, j.location, j.profiles?.full_name].filter(Boolean).join(' ').toLowerCase().includes(needle))

  const columns = [
    { key: 'title', label: 'Listing', render: (j) => <span className="adm-content-cell"><strong>{j.title}</strong><span className="adm-content-preview">{j.company}</span></span> },
    { key: 'location', label: 'Location', render: (j) => j.location || '—' },
    { key: 'poster', label: 'Posted by', render: (j) => j.profiles?.full_name || 'a member' },
    { key: 'when', label: 'Posted', render: (j) => timeAgo(j.created_at) },
    { key: 'actions', label: '', className: 'adm-table-actions-col', render: (j) => (
      <span className="adm-table-row-actions">
        <button type="button" className="btn ghost small" onClick={() => navigate(`/jobs/${j.id}`)}>View</button>
        <DeleteButton onConfirm={() => remove(j.id)} label="Delete listing" message="This removes the job listing. This can't be undone." />
      </span>
    ) },
  ]

  return (
    <>
      <PageHeader title="Jobs" description="Every job listing posted by a member." />
      <Toolbar search={q} onSearch={setQ} searchPlaceholder="Search jobs by title, company, location or poster…" />
      {loading ? <Skeleton rows={5} /> : shown.length === 0 ? (
        <EmptyState icon="jobs" message={jobs.length === 0 ? 'No job listings yet.' : 'No matching job listings.'} />
      ) : (
        <DataTable columns={columns} rows={shown} />
      )}
    </>
  )
}

/* ---------- Events ---------- */
export function EventsPage() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
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

  const needle = q.trim().toLowerCase()
  const shown = events.filter((e) => !needle || [e.title, e.location, e.profiles?.full_name].filter(Boolean).join(' ').toLowerCase().includes(needle))
  const now = Date.now()
  const upcoming = shown.filter((e) => new Date(e.event_date) >= now)
  const past = shown.filter((e) => new Date(e.event_date) < now)

  const card = (e) => {
    const d = new Date(e.event_date)
    return (
      <div className="adm-event-card" key={e.id}>
        <div className="adm-event-date">
          <span className="adm-event-date-day">{d.toLocaleDateString(undefined, { day: 'numeric' })}</span>
          <span className="adm-event-date-month">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
        </div>
        <div className="adm-event-info">
          <strong>{e.title}</strong>
          <span className="adm-content-preview">
            {d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' })}
            {e.location ? ` · ${e.location}` : ''} · by {e.profiles?.full_name || 'a member'}
          </span>
        </div>
        <div className="adm-event-actions">
          <button type="button" className="btn ghost small" onClick={() => navigate(`/events/${e.id}`)}>View</button>
          <DeleteButton onConfirm={() => remove(e.id)} label="Delete event" message="This removes the event and everyone's RSVPs. This can't be undone." />
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Events" description="Reunions, socials and anything else members schedule." />
      <Toolbar search={q} onSearch={setQ} searchPlaceholder="Search events by title, location or organiser…" />
      {loading ? <Skeleton rows={4} /> : shown.length === 0 ? (
        <EmptyState icon="events" message={events.length === 0 ? 'No events yet.' : 'No matching events.'} />
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="adm-event-group">
              <h3 className="adm-content-heading">Upcoming</h3>
              <div className="adm-event-cards">{upcoming.map(card)}</div>
            </section>
          )}
          {past.length > 0 && (
            <section className="adm-event-group">
              <h3 className="adm-content-heading">Past</h3>
              <div className="adm-event-cards">{past.map(card)}</div>
            </section>
          )}
        </>
      )}
    </>
  )
}

/* ---------- Businesses ---------- */
export function BusinessesPage() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const showToast = useToast()

  async function load() {
    const { data } = await supabase
      .from('businesses')
      .select('id, name, category, city, country, created_at, profiles!businesses_owner_id_fkey ( full_name )')
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

  const needle = q.trim().toLowerCase()
  const shown = items.filter((b) => !needle || [b.name, b.category, b.city, b.country, b.profiles?.full_name].filter(Boolean).join(' ').toLowerCase().includes(needle))

  const columns = [
    { key: 'name', label: 'Business', render: (b) => (
      <span className="adm-content-cell">
        <strong>{b.name}</strong>
        <span className="adm-content-preview">{b.category}</span>
      </span>
    ) },
    { key: 'place', label: 'Place', render: (b) => [b.city, b.country].filter(Boolean).join(', ') || '—' },
    { key: 'owner', label: 'Listed by', render: (b) => b.profiles?.full_name || 'a member' },
    { key: 'actions', label: '', className: 'adm-table-actions-col', render: (b) => (
      <span className="adm-table-row-actions">
        <button type="button" className="btn ghost small" onClick={() => navigate(`/businesses/${b.id}`)}>View</button>
        <DeleteButton onConfirm={() => remove(b.id)} label="Delete business" message="This removes the business listing. This can't be undone." />
      </span>
    ) },
  ]

  return (
    <>
      <PageHeader title="Businesses" description="Alumni businesses listed in the directory." />
      <Toolbar search={q} onSearch={setQ} searchPlaceholder="Search businesses by name, category, place or owner…" />
      {loading ? <Skeleton rows={5} /> : shown.length === 0 ? (
        <EmptyState icon="business" message={items.length === 0 ? 'No businesses listed yet.' : 'No matching businesses.'} />
      ) : (
        <DataTable columns={columns} rows={shown} />
      )}
    </>
  )
}
