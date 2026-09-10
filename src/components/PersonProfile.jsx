import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, isNetworkError, openStorageFile } from '../supabaseClient'
import { PhotoBlock } from './Directory.jsx'
import LoadingState from './LoadingState.jsx'
import EmptyState from './EmptyState.jsx'
import ReportButton from './ReportButton.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import { normalizeExpertise, formatExperienceRange, formatExperienceDuration, safeUrl } from '../utils.js'

const dash = '—'

// A handful of structured facts read better as a compact strip (short label
// above a short value) than as full-width rows.
function Fact({ label, value }) {
  return (
    <div className="profile-fact">
      <span className="profile-fact-label">{label}</span>
      <span className={value === dash ? 'profile-fact-value muted' : 'profile-fact-value'}>{value}</span>
    </div>
  )
}

// Read-only tag list — same look as the directory card grid's
// expertise/category chips, reused here so this reads consistently with
// the rest of the app.
function Chips({ items }) {
  if (!items || items.length === 0) return null
  return (
    <ul className="person-tags modal-chips">
      {items.map((item) => (
        <li key={item} className="person-tag">{item}</li>
      ))}
    </ul>
  )
}

// PROFILE VIEW — the public/read-only side of the profile system. Shown at
// /people/:personId for both other alumni AND your own profile (when
// personId === your own id): "let me understand who this person is" for
// someone else, "this is exactly what other Old Boys see" for yourself.
// The one thing this page never does is turn into a form — editing your own
// information happens on a completely separate page (EDIT PROFILE, at
// /profile), reached from the "Edit profile" button in the hero below. See
// Profile.jsx for that half of the system.
//
// Replaces the old floating ProfileModal that used to pop up over whatever
// list you clicked a name from — a real page reads more like a normal
// profile and means the URL can be shared/bookmarked/opened directly, at
// the cost of always doing a fresh fetch by id rather than reusing whatever
// row the calling list already had in memory.
export default function PersonProfile({ session, me, onMessage }) {
  const { personId } = useParams()
  const navigate = useNavigate()
  const [person, setPerson] = useState(null)
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  const isMe = personId === session.user.id

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotFound(false)
    setLoadError(false)
    setPerson(null)
    setContact(null)

    supabase.from('profiles').select('*').eq('id', personId).single().then(({ data, error }) => {
      if (cancelled) return
      if (!data) {
        // A real "no such row" (or an RLS policy quietly matching nothing)
        // comes back with no data and no error — that's genuinely "not
        // found". A network/connectivity failure also comes back with no
        // data, but carries an error — treating that the same as "not
        // found" told people their friend's profile had been deleted when
        // really their wifi had just dropped. Distinguishing the two means
        // a network hiccup shows "couldn't load, try again" instead.
        if (error && isNetworkError(error)) setLoadError(true)
        else setNotFound(true)
        setLoading(false)
        return
      }
      setPerson(data)
      setLoading(false)
    })

    // Your own contact details never need the privacy-aware lookup — you
    // can always see your own phone/email/location in full, so this call
    // (and the round trip it costs) is skipped entirely when isMe.
    if (personId !== session.user.id) {
      supabase.rpc('get_profile_contact', { target_id: personId }).then(({ data, error }) => {
        // Same `cancelled` guard as the profile fetch above — rapidly
        // switching between /people/:x and /people/:y could otherwise let an
        // older RPC resolve after a newer one and show the wrong contact.
        if (cancelled) return
        setContact(error ? {} : (data?.[0] || {}))
      })
    }

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, retryTick])

  if (loading) {
    return (
      <section className="panel narrow profile-page">
        <LoadingState message="Loading profile…" />
      </section>
    )
  }

  if (loadError) {
    return (
      <section className="panel narrow profile-page">
        <button type="button" className="profile-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <EmptyState
          icon="search"
          message="Couldn't load this profile."
          subMessage="Check your connection and try again."
          actionLabel="Retry"
          onAction={() => setRetryTick((t) => t + 1)}
        />
      </section>
    )
  }

  if (notFound || !person) {
    return (
      <section className="panel narrow profile-page">
        <button type="button" className="profile-back-btn" onClick={() => navigate(-1)}>← Back</button>
        <EmptyState icon="search" message="Couldn't find that profile." subMessage="It may have been removed." />
      </section>
    )
  }

  const p = person
  const linkedinHref = safeUrl(p.linkedin_url)
  const websiteHref = safeUrl(p.business_website)

  const roleLine = p.occupation && p.company
    ? `${p.occupation} @ ${p.company}`
    : (p.occupation || p.company || '')

  // Own location/phone/email are read straight off the full row (and the
  // session) rather than the privacy RPC, which is never called for isMe.
  const contactCity = isMe ? p.city : contact?.city
  const contactCountry = isMe ? p.country : contact?.country
  const contactPhone = isMe ? p.phone : contact?.phone
  const contactEmail = isMe ? session.user.email : contact?.email

  const locationLine = contactCity && contactCountry
    ? `${contactCity}, ${contactCountry}`
    : (contactCountry || contactCity || '')

  // Most recent role first — a role still "in progress" (no `to` date) sorts
  // above finished ones, then finished ones sort by how recently they ended.
  const experience = (Array.isArray(p.experience) ? p.experience : [])
    .slice()
    .sort((a, b) => (b.to || b.from || '').localeCompare(a.to || a.from || ''))
  const expertise = normalizeExpertise(p.expertise)
  const servicesOffered = Array.isArray(p.services_offered) ? p.services_offered : []
  const geographicFocus = Array.isArray(p.geographic_focus) ? p.geographic_focus : []
  const menteeGoals = normalizeExpertise(p.mentee_goals)

  // CAREER — current role, kept separate from the free-form Experience
  // timeline below (that's history; this is "right now").
  const hasCareerInfo = !!(p.occupation || p.company || p.industry)

  // EDUCATION / SACS — the alumni relationship, deliberately scoped to
  // exactly the fields that are safe to show publicly (years, degree).
  // Administrative membership fields (ID number, DOB, association type,
  // etc.) live only in Edit Profile's separate Membership section and are
  // never fetched or rendered here.
  const hasSacsInfo = !!(p.grad_year || p.start_year || p.degree)
  const sacsRange = p.start_year && p.grad_year
    ? `${p.start_year} – ${p.grad_year}`
    : (p.grad_year ? `Class of ${p.grad_year}` : (p.start_year ? `From ${p.start_year}` : dash))

  // The mentor half counts as mentoring info if there's anything to show
  // about it, and the mentee half counts separately — otherwise someone
  // who is only looking for a mentor (and has filled in exactly that) gets
  // no Mentoring section at all.
  const hasMentorInfo = p.is_open_to_opportunities && (
    !!p.availability || expertise.length > 0 || servicesOffered.length > 0
    || geographicFocus.length > 0 || !!p.business_website || !!p.mentor_note
  )
  const hasMenteeInfo = p.seeking_mentor && (menteeGoals.length > 0 || !!p.mentee_note)
  const hasMentoringInfo = hasMentorInfo || hasMenteeInfo
    || (p.is_open_to_opportunities && !hasMentorInfo) // the toggle alone is still worth showing
    || (p.seeking_mentor && !hasMenteeInfo)

  const hasContactInfo = !!(linkedinHref || contactPhone || contactEmail)

  // Whether this person is currently listed as an available mentor — the
  // only mentoring-related thing this page needs to know, since the actual
  // "get in touch" action lives on their mentor profile, not here.
  const canAskToMentorMe = !isMe && !!p.is_open_to_opportunities && !p.mentor_paused

  return (
    <section className="panel narrow profile-page person-profile-page">
      <button type="button" className="profile-back-btn profile-back-standalone" onClick={() => navigate(-1)} aria-label="Back">
        ← Back
      </button>

      {/* Side-by-side hero: a large real photo on the left with name, role,
          location and SACS chip alongside it — stacks on mobile. */}
      <div className="profile-hero">
        <div className="profile-hero-photo">
          <PhotoBlock url={p.avatar_url} name={p.full_name} className="profile-hero-photo-img" />
          {isMe && (
            <button
              type="button"
              className="profile-change-photo-link"
              onClick={() => navigate('/profile', { state: { openPhotoModal: true } })}
            >
              <CameraIcon /> Change photo
            </button>
          )}
        </div>

        <div className="profile-hero-body">
          <div className="profile-hero-top">
            <div>
              <h2 className="panel-title profile-hero-name">
                {p.full_name || 'Alumnus'}
                {isMe && <span className="person-name-you">You</span>}
              </h2>
              {roleLine && <p className="panel-sub profile-hero-role">{roleLine}</p>}
            </div>
            <div className="profile-header-actions">
              {isMe ? (
                <button type="button" className="btn primary" onClick={() => navigate('/profile')}>
                  <EditIcon /> Edit profile
                </button>
              ) : (
                <>
                  <button type="button" className="header-icon-btn profile-message-btn" onClick={() => onMessage({ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url })} aria-label="Message" title="Message">
                    <MessageIcon />
                  </button>
                  {linkedinHref && (
                    <a href={linkedinHref} target="_blank" rel="noopener noreferrer" className="header-icon-btn profile-linkedin-btn" aria-label="LinkedIn" title="LinkedIn">
                      <LinkedInIcon />
                    </a>
                  )}
                  <ReportButton session={session} entityType="profile" entityId={p.id} className="header-icon-btn" label="" title="Report member" />
                </>
              )}
            </div>
          </div>

          {locationLine && (
            <p className="profile-card-location profile-hero-location">
              <LocationIcon /> {locationLine}
            </p>
          )}
          <span className="profile-status-pill">
            SACS{p.grad_year ? ` • Class of ${p.grad_year}` : ''}
          </span>
        </div>
      </div>

      {/* ABOUT — the bio, as actual readable prose. Omitted entirely (not
          shown as an empty section) when there's nothing to read. */}
      {p.bio && (
        <div className="profile-section">
          <h3 className="profile-card-section-title">About</h3>
          <p className="profile-card-bio">{p.bio}</p>
        </div>
      )}

      {/* CAREER — current role, scannable at a glance. */}
      {hasCareerInfo && (
        <div className="profile-section">
          <h3 className="profile-card-section-title">Career</h3>
          <div className="profile-fact-strip profile-fact-strip-noborder">
            <Fact label="Current role" value={p.occupation || dash} />
            <Fact label="Company" value={p.company || dash} />
            <Fact label="Industry" value={p.industry || dash} />
          </div>
        </div>
      )}

      {/* EXPERIENCE — a career timeline, most recent first. */}
      {experience.length > 0 && (
        <div className="profile-section profile-card-section-experience">
          <h3 className="profile-card-section-title">Experience</h3>
          <ul className="experience-timeline">
            {experience.map((entry, i) => {
              const range = formatExperienceRange(entry.from, entry.to)
              const duration = formatExperienceDuration(entry.from, entry.to)
              const isCurrent = !!entry.from && !entry.to
              return (
                <li className={isCurrent ? 'experience-timeline-entry current' : 'experience-timeline-entry'} key={i}>
                  <span className="experience-timeline-marker" aria-hidden="true" />
                  <div className="experience-timeline-content">
                    <div className="experience-timeline-title">{entry.title || 'Role'}</div>
                    {entry.company && <div className="experience-timeline-company">{entry.company}</div>}
                    <div className="experience-timeline-meta">
                      {range && <span className="experience-timeline-range">{range}{duration && ` · ${duration}`}</span>}
                      {entry.industry && <span className="experience-timeline-industry">{entry.industry}</span>}
                    </div>
                    {entry.description && <p className="experience-timeline-description">{entry.description}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {p.cv_url && (
        <div className="profile-section">
          <h3 className="profile-card-section-title">CV / Resume</h3>
          {/* The cvs bucket is private as of schema-update-47 — CVs carry home
              addresses and phone numbers, and a public bucket meant anyone
              with the URL could read one without signing in at all. Approved
              members can still open any CV; it just goes through a 60-second
              signed URL now instead of a permanent public one. */}
          <a
            className="cv-download-link"
            href={p.cv_url}
            onClick={(e) => { e.preventDefault(); openStorageFile('cvs', p.cv_url) }}
            rel="noopener noreferrer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M16 13H8M16 17H8M10 9H8" />
            </svg>
            {p.cv_filename || 'Download CV'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 'auto', opacity: 0.5 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </a>
        </div>
      )}

      {/* EDUCATION / SACS — the alumni relationship. Deliberately just
          years + degree; membership-record fields (ID number, DOB, etc.)
          never appear on a profile, public or your own. */}
      {hasSacsInfo && (
        <div className="profile-section">
          <h3 className="profile-card-section-title">SACS</h3>
          <div className="profile-fact-strip profile-fact-strip-noborder">
            <Fact label="At SACS" value={sacsRange} />
            <Fact label="Degree" value={p.degree || dash} />
          </div>
        </div>
      )}

      {/* LOCATION */}
      {locationLine && (
        <div className="profile-section">
          <h3 className="profile-card-section-title">Location</h3>
          <div className="profile-fact-strip profile-fact-strip-noborder">
            <Fact label="City" value={contactCity || dash} />
            <Fact label="Country" value={contactCountry || dash} />
          </div>
        </div>
      )}

      {/* MENTORING — two clearly separate halves, since being a mentor and
          looking for one are different states that plenty of people hold
          at once. Technical flags never surface directly (no "seeking_mentor
          = true") — only the human-readable version of each. */}
      {hasMentoringInfo && (
        <div className="profile-section">
          <h3 className="profile-card-section-title">Mentoring</h3>

          {p.is_open_to_opportunities && (
            <div className="profile-card-subsection profile-mentor-half">
              <span className="profile-fact-label profile-mentoring-subhead">
                Can help other alumni
                {p.mentor_paused && <span className="profile-mentor-paused-note"> · not currently available</span>}
              </span>

              <div className="profile-fact-strip profile-fact-strip-noborder">
                {p.availability && <Fact label="Availability" value={p.availability} />}
                {websiteHref && (
                  <div className="profile-fact">
                    <span className="profile-fact-label">Website</span>
                    <a className="profile-fact-value" href={websiteHref} target="_blank" rel="noopener noreferrer">
                      {websiteHref.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>

              {expertise.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Areas of expertise</span>
                  <Chips items={expertise} />
                </div>
              )}
              {servicesOffered.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Can offer other Old Boys</span>
                  <Chips items={servicesOffered} />
                </div>
              )}
              {geographicFocus.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Geographic focus</span>
                  <Chips items={geographicFocus} />
                </div>
              )}
              {p.mentor_note && <p className="profile-card-bio">{p.mentor_note}</p>}

              {/* Mentoring here is a pointer, not an action — contacting a
                  mentor happens on their mentor profile (which has the
                  actual Email CTA), not via a request flow bolted onto the
                  general people directory. */}
              {canAskToMentorMe && (
                <div className="profile-mentoring-cta">
                  <Link to={`/mentoring/${p.id}`} className="btn primary small">
                    View mentor profile
                  </Link>
                </div>
              )}
            </div>
          )}

          {p.seeking_mentor && (
            <div className="profile-card-subsection profile-mentee-half">
              <span className="profile-fact-label profile-mentoring-subhead">Looking for a mentor</span>
              {menteeGoals.length > 0
                ? <Chips items={menteeGoals} />
                : <p className="profile-card-bio">Open to a mentor — hasn&rsquo;t listed specific areas yet.</p>}
              {p.mentee_note && <p className="profile-card-bio">{p.mentee_note}</p>}
            </div>
          )}
        </div>
      )}

      {/* CONTACT & LINKS */}
      {hasContactInfo && (
        <div className="profile-section">
          <h3 className="profile-card-section-title">Contact &amp; links</h3>
          <div className="profile-fact-strip profile-fact-strip-noborder">
            {linkedinHref && (
              <div className="profile-fact">
                <span className="profile-fact-label">LinkedIn</span>
                <a className="profile-fact-value" href={linkedinHref} target="_blank" rel="noopener noreferrer">
                  View profile ↗
                </a>
              </div>
            )}
            {contactPhone && <Fact label="Phone" value={contactPhone} />}
            {contactEmail && <Fact label="Email" value={contactEmail} />}
          </div>
        </div>
      )}

      {!isMe && (
        <div className="profile-actions">
          <button type="button"
            className="btn primary"
            onClick={() => onMessage?.({ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url }, buildIcebreaker(me, p))}
          >
            Send a message
          </button>
        </div>
      )}

    </section>
  )
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function LocationIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.13 1 2.5 1s2.48 1.13 2.48 2.5zM.24 8h4.52v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.52v-6.14c0-1.46-.02-3.34-2.04-3.34-2.04 0-2.36 1.6-2.36 3.24V22H7.74V8z"/>
    </svg>
  )
}
