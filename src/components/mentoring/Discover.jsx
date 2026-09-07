import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Avatar } from '../Directory.jsx'
import EmptyState from '../EmptyState.jsx'
import PersonSheet from './PersonSheet.jsx'
import { normalizeExpertise } from '../../utils.js'
import {
  eligibleForMentorship, eligibleForGuidanceFrom, scoreMentor, scoreMentee,
  mentorAvailability, byScore,
} from '../../mentorMatch.js'
import { liveMentorshipMap, openConnectionMap } from './data.js'

const INTENT_COPY = {
  guidance: 'Looking for guidance — here are people who can help.',
  offer: "Here's who's looking for what you know.",
  question: 'Find someone to ask — a quick question is a fine place to start.',
}

// Search across the whole network, not just the handful the Overview page
// already surfaced. Filter chips instead of a sidebar (rule: this page is
// not a database query builder), and "Recommended" rather than "Best match"
// as the sort label — the score itself never appears.
export default function Discover(props) {
  const { me, myId, people, myMentoringProfile, mentorships, connections, savedIds, toggleSaved, reload, showToast } = props
  const [params] = useSearchParams()
  const intent = params.get('intent')
  const [tab, setTab] = useState(intent === 'offer' ? 'mentees' : 'mentors')
  const [query, setQuery] = useState('')
  const [industry, setIndustry] = useState('')
  const [availFilters, setAvailFilters] = useState([]) // 'quick' | 'conversation' | 'mentorship'
  const [openPerson, setOpenPerson] = useState(null)

  const liveMap = useMemo(() => liveMentorshipMap(mentorships, myId), [mentorships, myId])
  const openConnMap = useMemo(() => openConnectionMap(connections, myId), [connections, myId])

  const pool = useMemo(() => {
    if (tab === 'mentors') return people.filter((p) => p.is_open_to_opportunities && eligibleForMentorship(me, p))
    return people.filter((p) => p.seeking_mentor && eligibleForGuidanceFrom(me, p))
  }, [people, tab, me])

  const industries = useMemo(() => {
    const set = new Set(pool.map((p) => p.industry).filter(Boolean))
    return Array.from(set).sort().slice(0, 10)
  }, [pool])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = pool.filter((p) => {
      if (industry && p.industry !== industry) return false
      if (q) {
        const hay = [
          p.full_name, p.bio, p.industry, p.occupation, p.company,
          ...normalizeExpertise(p.expertise), ...normalizeExpertise(p.mentee_goals),
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (tab === 'mentors' && availFilters.length > 0) {
        const avail = mentorAvailability(p, p.mentoringProfile)
        if (availFilters.includes('quick') && !avail.quickQuestions) return false
        if (availFilters.includes('conversation') && !avail.conversations) return false
        if (availFilters.includes('mentorship') && !avail.mentorships) return false
      }
      return true
    })

    list = list.map((p) => ({
      ...p,
      match: tab === 'mentors' ? scoreMentor(me, p, myMentoringProfile) : scoreMentee(me, p),
    }))
    return list.sort(byScore)
  }, [pool, query, industry, availFilters, tab, me, myMentoringProfile])

  function toggleAvail(key) {
    setAvailFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  return (
    <div>
      {intent && INTENT_COPY[intent] && (
        <p className="hint" style={{ marginBottom: 'var(--sp-4)' }}>{INTENT_COPY[intent]}</p>
      )}

      <div className="mtg-discover-tabs">
        <button type="button" className={`mtg-filter-chip ${tab === 'mentors' ? 'on' : ''}`} onClick={() => setTab('mentors')}>Mentors</button>
        <button type="button" className={`mtg-filter-chip ${tab === 'mentees' ? 'on' : ''}`} onClick={() => setTab('mentees')}>People looking for guidance</button>
      </div>

      <div className="mtg-discover-search">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'mentors' ? 'Search by name, industry, or what you need help with…' : 'Search by name, industry, or what they need help with…'}
        />
      </div>

      {industries.length > 0 && (
        <div className="mtg-discover-filters">
          <button type="button" className={`mtg-filter-chip ${industry === '' ? 'on' : ''}`} onClick={() => setIndustry('')}>All industries</button>
          {industries.map((i) => (
            <button key={i} type="button" className={`mtg-filter-chip ${industry === i ? 'on' : ''}`} onClick={() => setIndustry(i === industry ? '' : i)}>{i}</button>
          ))}
        </div>
      )}

      {tab === 'mentors' && (
        <div className="mtg-discover-filters">
          <button type="button" className={`mtg-filter-chip ${availFilters.includes('quick') ? 'on' : ''}`} onClick={() => toggleAvail('quick')}>Open to quick questions</button>
          <button type="button" className={`mtg-filter-chip ${availFilters.includes('conversation') ? 'on' : ''}`} onClick={() => toggleAvail('conversation')}>Open to a conversation</button>
          <button type="button" className={`mtg-filter-chip ${availFilters.includes('mentorship') ? 'on' : ''}`} onClick={() => toggleAvail('mentorship')}>Open to mentorship</button>
        </div>
      )}

      {results.length === 0 ? (
        <EmptyState icon="search" message="No one matches yet" subMessage="Try clearing a filter or searching something broader." />
      ) : (
        <div className="mtg-person-grid" style={{ marginTop: 'var(--sp-5)' }}>
          {results.map((p) => {
            const avail = tab === 'mentors' ? mentorAvailability(p, p.mentoringProfile) : null
            return (
              <div key={p.id} className="mtg-person-card">
                <div className="mtg-person-card-top">
                  <Avatar url={p.avatar_url} name={p.full_name} size={48} />
                  <div>
                    <span className="mtg-person-card-name">{p.full_name}</span>
                    <span className="mtg-person-card-role">{p.occupation || p.industry || ''}</span>
                  </div>
                </div>
                {p.match.reasons.length > 0 && (
                  <ul className="mtg-person-card-reasons">
                    {p.match.reasons.map((r) => <li key={r.key}>{r.label}</li>)}
                  </ul>
                )}
                {avail && (
                  <div className="mtg-person-card-availability">
                    {avail.paused ? 'Mentorship paused' : avail.hasRoom ? 'Open for mentorship' : 'Mentorship full — quick questions still welcome'}
                  </div>
                )}
                <div className="mtg-person-card-footer">
                  <button type="button" className="btn primary small" onClick={() => setOpenPerson({ person: p, mode: tab === 'mentors' ? 'mentor' : 'mentee' })}>
                    View profile
                  </button>
                  <button type="button" className="link-btn subtle" onClick={() => toggleSaved(p.id, !savedIds.has(p.id))}>
                    {savedIds.has(p.id) ? '♥' : '♡'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {openPerson && (
        <PersonSheet
          person={openPerson.person}
          me={me}
          mode={openPerson.mode}
          existingMentorship={liveMap[openPerson.person.id]}
          existingConnection={openConnMap[openPerson.person.id]}
          savedIds={savedIds}
          onToggleSaved={toggleSaved}
          onClose={() => setOpenPerson(null)}
          onSent={() => reload({ quiet: true })}
          showToast={showToast}
        />
      )}
    </div>
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
