import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, isNetworkError } from '../../supabaseClient'
import { Avatar } from '../Directory.jsx'
import LoadingState from '../LoadingState.jsx'
import EmptyState from '../EmptyState.jsx'
import { normalizeExpertise, safeUrl } from '../../utils.js'

const FIELDS =
  'id, full_name, avatar_url, grad_year, occupation, company, industry, degree, ' +
  'city, country, expertise, mentor_note, bio, linkedin_url, is_open_to_opportunities, mentor_paused'

// The one page that matters: who this person is, what they can help with,
// and a single obvious way to get in touch. No relationship state, no
// request button — the mentoring "product" is the introduction, not
// anything that happens inside this app afterwards.
export default function MentorProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [person, setPerson] = useState(null)
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    setLoadError(false)
    setPerson(null)
    setContact(null)

    supabase.from('profiles').select(FIELDS).eq('id', id).maybeSingle().then(({ data, error }) => {
      if (cancelled) return
      if (error && isNetworkError(error)) { setLoadError(true); setLoading(false); return }
      // Not found, or found but not currently a listed mentor — either way
      // this route has nothing to show. Availability isn't checked here on
      // purpose: someone who follows a link to a mentor who has since
      // paused should still be told why, not get a generic 404.
      if (!data || !data.is_open_to_opportunities) { setNotFound(true); setLoading(false); return }
      setPerson(data)
      setLoading(false)
    })

    supabase.rpc('get_profile_contact', { target_id: id }).then(({ data, error }) => {
      if (cancelled) return
      setContact(error ? {} : (data?.[0] || {}))
    })

    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return (
      <div className="mtg-page page-shell">
        <LoadingState message="Loading profile…" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mtg-page page-shell">
        <EmptyState icon="search" message="Couldn't load this profile" subMessage="Please try again in a moment." actionLabel="Back to Mentoring" onAction={() => navigate('/mentoring')} />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="mtg-page page-shell">
        <EmptyState icon="search" message="This mentor isn't listed right now" subMessage="They may have paused mentoring, or this link is out of date." actionLabel="Back to Mentoring" onAction={() => navigate('/mentoring')} />
      </div>
    )
  }

  const p = person
  const categories = normalizeExpertise(p.expertise)
  const roleLine = [p.occupation, p.grad_year ? `Class of ${p.grad_year}` : null].filter(Boolean).join(' · ')
  const location = [p.city, p.country].filter(Boolean).join(', ')
  const linkedin = safeUrl(p.linkedin_url)
  const mailtoHref = contact?.email
    ? `mailto:${contact.email}?subject=${encodeURIComponent('Mentoring enquiry')}` +
      `&body=${encodeURIComponent(`Hi ${firstName(p.full_name)},\n\nI found your profile on the Old Boys mentoring directory and would love to chat to you about your experience.\n\nThanks,\n`)}`
    : null

  return (
    <div className="mtg-page page-shell mtg-profile-page">
      <Link to="/mentoring" className="link-btn" style={{ display: 'inline-block', marginBottom: 'var(--sp-5)' }}>← Mentoring</Link>

      <div className="mtg-mentor-hero">
        <Avatar url={p.avatar_url} name={p.full_name} size={104} />
        <h1>{p.full_name}</h1>
        {roleLine && <p>{roleLine}</p>}
      </div>

      {categories.length > 0 && (
        <div className="mtg-sheet-section">
          <h3>I can help with</h3>
          <div className="mentor-card-tags">
            {categories.map((c) => <span key={c} className="mentor-tag">{c}</span>)}
          </div>
        </div>
      )}

      {p.mentor_note && (
        <div className="mtg-sheet-section">
          <h3>About</h3>
          <p className="mtg-card-description mtg-card-description-full">{p.mentor_note}</p>
        </div>
      )}

      <div className="mtg-mentor-facts">
        {p.company && <Fact label="Company" value={p.company} />}
        {p.industry && <Fact label="Industry" value={p.industry} />}
        {p.degree && <Fact label="Education" value={p.degree} />}
        {location && <Fact label="Location" value={location} />}
      </div>

      {p.bio && (
        <div className="mtg-sheet-section">
          <h3>Professional background</h3>
          <p>{p.bio}</p>
        </div>
      )}

      <div className="mtg-mentor-contact">
        <h3>Want to get in touch?</h3>
        {mailtoHref ? (
          <a href={mailtoHref} className="btn primary">Email {firstName(p.full_name)}</a>
        ) : (
          <p className="hint">
            This member hasn't made their email visible.
            {linkedin && ' Try reaching them on LinkedIn instead.'}
          </p>
        )}
        {linkedin && (
          <a href={linkedin} target="_blank" rel="noopener noreferrer" className="link-btn" style={{ marginLeft: mailtoHref ? 16 : 0 }}>
            LinkedIn
          </a>
        )}
      </div>
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div className="mtg-mentor-fact">
      <span className="mtg-mentor-fact-label">{label}</span>
      <span className="mtg-mentor-fact-value">{value}</span>
    </div>
  )
}

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || 'there'
}
