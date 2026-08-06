import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import useModal from '../useModal.js'

// Parsed via DOMParser into a detached document rather than assigned to a
// live element's innerHTML — a detached document never loads its
// resources, so an untrusted payload like <img src=x onerror=alert(1)>
// can't fire its handler while we're just extracting text.
function plainText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''
}

function truncate(text, max = 80) {
  const t = (text || '').trim()
  return t.length > max ? t.slice(0, max).trim() + '…' : t
}

// Every section (Directory, Feed, Jobs, Business Directory) already has its
// own local search box, but there was no single "search everything" —
// this is that: one header button, four small parallel queries (5 rows
// each, cheap enough to re-run on every keystroke via the debounce below),
// grouped results, click-through straight to the person/post/job/business.
// `,()` are stripped from the query before building the ilike pattern so a
// stray one in what someone types can't break the .or() filter syntax.
const SECTION_LABEL = { people: 'Old Boys', posts: 'Feed', jobs: 'Jobs', businesses: 'Business Directory' }
const PREVIEW_LIMIT = 5
const EXPANDED_LIMIT = 50

export default function GlobalSearch({ open, onClose }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState({ people: [], posts: [], jobs: [], businesses: [] })
  // Exact total counts per category (independent of the 5-row preview cap)
  // so "See all 23 results" can show a real number rather than a vague
  // "more". Previously every category hard-capped at 5 with no way to see
  // the rest at all.
  const [counts, setCounts] = useState({ people: 0, posts: 0, jobs: 0, businesses: 0 })
  const [loading, setLoading] = useState(false)
  // Which single category (if any) is showing its full result list instead
  // of the mixed 4-category preview.
  const [expanded, setExpanded] = useState(null)
  const [expandedResults, setExpandedResults] = useState([])
  const [expandedLoading, setExpandedLoading] = useState(false)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setQ('')
    setResults({ people: [], posts: [], jobs: [], businesses: [] })
    setCounts({ people: 0, posts: 0, jobs: 0, businesses: 0 })
    setExpanded(null)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // `,()` are stripped (rather than escaped) since they'd otherwise break
  // the .or() filter's own syntax. `%` and `_` are ILIKE wildcards — `%` is
  // stripped the same way, and `_` is backslash-escaped (not stripped) so
  // "j_hn" only matches a literal underscore instead of also matching
  // "john" via `_`'s "any single character" meaning.
  function likePattern(needle) {
    const safe = needle.replace(/[,()%]/g, ' ').replace(/_/g, '\\_').trim()
    return `%${safe}%`
  }

  useEffect(() => {
    if (!open) return
    const needle = q.trim()
    setExpanded(null) // typing a new query always drops back to the mixed preview
    if (needle.length < 2) {
      setResults({ people: [], posts: [], jobs: [], businesses: [] })
      setCounts({ people: 0, posts: 0, jobs: 0, businesses: 0 })
      setLoading(false)
      return
    }
    setLoading(true)
    // Debouncing the *timer* isn't the same as debouncing the *request*: once
    // a batch is in flight nothing cancels it, so a slow response for an
    // earlier query could land after a faster later one and overwrite the
    // results with stale rows. `stale` is flipped by this effect's cleanup,
    // which React runs before re-running it for the next keystroke.
    let stale = false
    const timer = setTimeout(async () => {
      const like = likePattern(needle)
      const [{ data: people, count: peopleCount }, { data: posts, count: postsCount }, { data: jobs, count: jobsCount }, { data: businesses, count: businessesCount }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, avatar_url, occupation, company', { count: 'exact' })
          .or(`full_name.ilike.${like},occupation.ilike.${like},company.ilike.${like}`)
          .limit(PREVIEW_LIMIT),
        supabase.from('posts').select('id, content, profiles!posts_author_id_fkey ( full_name )', { count: 'exact' })
          .ilike('content', like).limit(PREVIEW_LIMIT),
        supabase.from('jobs').select('id, title, company', { count: 'exact' })
          .or(`title.ilike.${like},company.ilike.${like}`).limit(PREVIEW_LIMIT),
        supabase.from('businesses').select('id, name, description', { count: 'exact' })
          .or(`name.ilike.${like},description.ilike.${like}`).limit(PREVIEW_LIMIT),
      ])
      if (stale) return
      setResults({ people: people || [], posts: posts || [], jobs: jobs || [], businesses: businesses || [] })
      setCounts({ people: peopleCount || 0, posts: postsCount || 0, jobs: jobsCount || 0, businesses: businessesCount || 0 })
      setLoading(false)
    }, 300)
    return () => { stale = true; clearTimeout(timer) }
  }, [q, open])

  // Re-runs just one category's query with a much higher limit, so "See
  // all results" shows the real list instead of navigating away from the
  // search modal entirely.
  async function expandSection(section) {
    setExpanded(section)
    setExpandedLoading(true)
    const like = likePattern(q.trim())
    let query
    if (section === 'people') {
      query = supabase.from('profiles').select('id, full_name, avatar_url, occupation, company')
        .or(`full_name.ilike.${like},occupation.ilike.${like},company.ilike.${like}`)
    } else if (section === 'posts') {
      query = supabase.from('posts').select('id, content, profiles!posts_author_id_fkey ( full_name )')
        .ilike('content', like)
    } else if (section === 'jobs') {
      query = supabase.from('jobs').select('id, title, company')
        .or(`title.ilike.${like},company.ilike.${like}`)
    } else {
      query = supabase.from('businesses').select('id, name, description')
        .or(`name.ilike.${like},description.ilike.${like}`)
    }
    const { data } = await query.limit(EXPANDED_LIMIT)
    setExpandedResults(data || [])
    setExpandedLoading(false)
  }

  // Escape backs out of an expanded section first, same as most search UIs'
  // "step back before close" behaviour, then closes on a second press. That
  // logic was already here; useModal now carries it, and adds the focus
  // trap, focus restore and Back-button handling this modal was missing.
  const modalRef = useModal({
    enabled: open,
    onClose: () => { if (expanded) setExpanded(null); else onClose() },
  })

  if (!open) return null

  const hasAny = results.people.length || results.posts.length || results.jobs.length || results.businesses.length
  const go = (path) => { onClose(); navigate(path) }

  return (
    <div className="modal-backdrop global-search-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className="modal global-search-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="global-search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            data-autofocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Old Boys, Feed, Jobs, Business Directory…"
            className="global-search-input"
          />
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close search">×</button>
        </div>

        <div className="global-search-results">
          {q.trim().length < 2 ? (
            <p className="empty small">Start typing to search across the whole site.</p>
          ) : expanded ? (
            <>
              <button type="button" className="global-search-back" onClick={() => setExpanded(null)}>
                <BackIcon /> All results for "{q.trim()}"
              </button>
              <div className="global-search-group">
                <h4>{SECTION_LABEL[expanded]} · {counts[expanded]} result{counts[expanded] === 1 ? '' : 's'}</h4>
                {expandedLoading ? (
                  <p className="empty small">Searching…</p>
                ) : (
                  expandedResults.map((item) => (
                    <SearchResultRow key={item.id} section={expanded} item={item} onGo={go} />
                  ))
                )}
              </div>
            </>
          ) : loading ? (
            <p className="empty small">Searching…</p>
          ) : !hasAny ? (
            <p className="empty small">No results for "{q.trim()}".</p>
          ) : (
            <>
              {results.people.length > 0 && (
                <div className="global-search-group">
                  <h4>Old Boys</h4>
                  {results.people.map((p) => (
                    <SearchResultRow key={p.id} section="people" item={p} onGo={go} />
                  ))}
                  {counts.people > PREVIEW_LIMIT && (
                    <button type="button" className="global-search-see-all" onClick={() => expandSection('people')}>
                      See all {counts.people} results →
                    </button>
                  )}
                </div>
              )}
              {results.posts.length > 0 && (
                <div className="global-search-group">
                  <h4>Feed</h4>
                  {results.posts.map((p) => (
                    <SearchResultRow key={p.id} section="posts" item={p} onGo={go} />
                  ))}
                  {counts.posts > PREVIEW_LIMIT && (
                    <button type="button" className="global-search-see-all" onClick={() => expandSection('posts')}>
                      See all {counts.posts} results →
                    </button>
                  )}
                </div>
              )}
              {results.jobs.length > 0 && (
                <div className="global-search-group">
                  <h4>Jobs</h4>
                  {results.jobs.map((j) => (
                    <SearchResultRow key={j.id} section="jobs" item={j} onGo={go} />
                  ))}
                  {counts.jobs > PREVIEW_LIMIT && (
                    <button type="button" className="global-search-see-all" onClick={() => expandSection('jobs')}>
                      See all {counts.jobs} results →
                    </button>
                  )}
                </div>
              )}
              {results.businesses.length > 0 && (
                <div className="global-search-group">
                  <h4>Business Directory</h4>
                  {results.businesses.map((b) => (
                    <SearchResultRow key={b.id} section="businesses" item={b} onGo={go} />
                  ))}
                  {counts.businesses > PREVIEW_LIMIT && (
                    <button type="button" className="global-search-see-all" onClick={() => expandSection('businesses')}>
                      See all {counts.businesses} results →
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// One result row, factored out so both the 5-item preview and the
// "see all" expanded list render identically instead of duplicating each
// section's markup twice.
function SearchResultRow({ section, item, onGo }) {
  if (section === 'people') {
    return (
      <button type="button" className="global-search-result" onClick={() => onGo(`/people/${item.id}`)}>
        <Avatar url={item.avatar_url} name={item.full_name} size={32} />
        <span>
          <strong>{item.full_name || 'Alumnus'}</strong>
          {(item.occupation || item.company) && <em>{[item.occupation, item.company].filter(Boolean).join(' @ ')}</em>}
        </span>
      </button>
    )
  }
  if (section === 'posts') {
    return (
      <button type="button" className="global-search-result" onClick={() => onGo(`/feed/${item.id}`)}>
        <span>
          <strong>{item.profiles?.full_name || 'Alumnus'}</strong>
          <em>{truncate(plainText(item.content))}</em>
        </span>
      </button>
    )
  }
  if (section === 'jobs') {
    return (
      <button type="button" className="global-search-result" onClick={() => onGo(`/jobs/${item.id}`)}>
        <span>
          <strong>{item.title}</strong>
          {item.company && <em>{item.company}</em>}
        </span>
      </button>
    )
  }
  return (
    <button type="button" className="global-search-result" onClick={() => onGo(`/businesses/${item.id}`)}>
      <span>
        <strong>{item.name}</strong>
        {item.description && <em>{truncate(plainText(item.description), 60)}</em>}
      </span>
    </button>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}
