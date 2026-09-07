import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { Avatar } from '../Directory.jsx'
import LoadingState from '../LoadingState.jsx'
import EmptyState from '../EmptyState.jsx'
import { normalizeExpertise } from '../../utils.js'

const FIELDS =
  'id, full_name, avatar_url, grad_year, occupation, company, industry, degree, ' +
  'city, country, expertise, mentor_note'

const MAX_CATEGORY_CHIPS = 8

// The whole mentoring product, in one page: search, filter, find someone,
// go look at their profile. No requests, no relationships, no dashboard —
// just a directory of Old Boys who've said they're willing to help, the way
// a person would actually look for one.
export default function MentorDirectory() {
  const [mentors, setMentors] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')

  useEffect(() => {
    let alive = true
    supabase
      .from('profiles')
      .select(FIELDS)
      .eq('is_open_to_opportunities', true)
      .eq('mentor_paused', false)
      .order('full_name', { ascending: true })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setLoadError(true)
        else setMentors(data || [])
        setLoading(false)
      })
    return () => { alive = false }
  }, [])

  // The category chips are whatever this network's mentors have actually
  // picked, ranked by how common they are — not a fixed taxonomy that might
  // not match what anyone here has selected.
  const categories = useMemo(() => {
    const counts = new Map()
    for (const m of mentors) {
      for (const c of normalizeExpertise(m.expertise)) {
        counts.set(c, (counts.get(c) || 0) + 1)
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORY_CHIPS).map(([c]) => c)
  }, [mentors])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mentors.filter((m) => {
      if (category && !normalizeExpertise(m.expertise).some((c) => c === category)) return false
      if (!q) return true
      const hay = [
        m.full_name, m.occupation, m.company, m.industry, m.degree, m.mentor_note,
        ...normalizeExpertise(m.expertise),
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [mentors, query, category])

  return (
    <div className="mtg-page page-shell">
      <div className="mtg-header">
        <div>
          <h1>Mentoring</h1>
          <p>Connect with Old Boys who are willing to share their experience and advice.</p>
        </div>
      </div>

      <div className="mtg-discover-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search mentors by name, industry, expertise…"
          aria-label="Search mentors"
        />
      </div>

      {categories.length > 0 && (
        <div className="mtg-discover-filters">
          <button type="button" className={`mtg-filter-chip ${category === '' ? 'on' : ''}`} onClick={() => setCategory('')}>All</button>
          {categories.map((c) => (
            <button key={c} type="button" className={`mtg-filter-chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c === category ? '' : c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="mtg-section" style={{ marginTop: 'var(--sp-6)' }}>
        {loading ? (
          <LoadingState message="Loading mentors…" />
        ) : loadError ? (
          <EmptyState icon="search" message="Couldn't load the mentor directory" subMessage="Please try again in a moment." />
        ) : mentors.length === 0 ? (
          <EmptyState icon="search" message="Mentoring is coming soon" subMessage="There are currently no Old Boys listed as available mentors." />
        ) : results.length === 0 ? (
          <EmptyState
            icon="search"
            message={category ? 'No mentors in this area yet' : 'No mentors found'}
            subMessage="Try another search or browse all available mentors."
            actionLabel={(query || category) ? 'Clear filters' : undefined}
            onAction={(query || category) ? () => { setQuery(''); setCategory('') } : undefined}
          />
        ) : (
          <div className="mtg-person-grid">
            {results.map((m) => <MentorCard key={m.id} mentor={m} />)}
          </div>
        )}
      </div>
    </div>
  )
}

function MentorCard({ mentor: m }) {
  const cats = normalizeExpertise(m.expertise)
  const roleLine = [m.occupation, m.grad_year ? `Class of ${m.grad_year}` : null].filter(Boolean).join(' · ')
  return (
    <Link to={`/people/${m.id}`} className="mtg-person-card">
      <div className="mtg-person-card-top">
        <Avatar url={m.avatar_url} name={m.full_name} size={56} />
        <div>
          <span className="mtg-person-card-name">{m.full_name}</span>
          {roleLine && <span className="mtg-person-card-role">{roleLine}</span>}
        </div>
      </div>
      {cats.length > 0 && (
        <div className="mentor-card-tags">
          {cats.slice(0, 3).map((c) => <span key={c} className="mentor-tag">{c}</span>)}
        </div>
      )}
      {m.mentor_note && <p className="mtg-card-description">{m.mentor_note}</p>}
      <div className="mtg-person-card-footer">
        <span className="link-btn">View profile →</span>
      </div>
    </Link>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}
