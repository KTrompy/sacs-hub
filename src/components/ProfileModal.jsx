import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { PhotoBlock } from './Directory.jsx'
import useModal from '../useModal.js'
import { normalizeExpertise, safeUrl } from '../utils.js'

const dash = '—'

// A handful of structured facts read better as a compact strip (short label
// above a short value) than as full-width rows once the header block above
// already covers role, company and location — this only needs to carry
// what's left: background and field.
function Fact({ label, value }) {
  return (
    <div className="profile-fact">
      <span className="profile-fact-label">{label}</span>
      <span className={value === dash ? 'profile-fact-value muted' : 'profile-fact-value'}>{value}</span>
    </div>
  )
}

// Read-only tag list — same look as the card grid's expertise/category
// chips, reused here so a business profile section reads consistently
// whether you're scanning the grid or looking at the full modal.
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

export default function ProfileModal({ person: p, isMe, onClose, onMessage }) {
  // Phone/email/location are fetched separately from a privacy-aware RPC
  // rather than read straight off `p` — the caller's initial select may
  // include city/country for other purposes, but showing them here has to
  // respect that person's Settings → Privacy choices first, so we wait for
  // this to resolve rather than flashing the unfiltered values from `p`.
  const [contact, setContact] = useState(null)
  // The focus trap, focus restore, Escape handling, scroll lock and
  // Back-button behaviour that used to be written out longhand here now
  // live in useModal — this component was the only modal in the app that
  // did the full job, so the rest of them were inheriting a worse version
  // of the same interaction. See src/useModal.js.
  const modalRef = useModal({ onClose })

  useEffect(() => {
    setContact(null)
    let cancelled = false
    supabase.rpc('get_profile_contact', { target_id: p.id }).then(({ data, error }) => {
      // Guard against a stale RPC resolving after the modal has switched to
      // a different person — otherwise the wrong contact info could
      // momentarily replace the newly-opened profile's own.
      if (cancelled) return
      setContact(error ? {} : (data?.[0] || {}))
    })
    return () => { cancelled = true }
  }, [p.id])

  const roleLine = p.occupation && p.company
    ? `${p.occupation} @ ${p.company}`
    : (p.occupation || p.company || '')

  const locationLine = contact?.city && contact?.country
    ? `${contact.city}, ${contact.country}`
    : (contact?.country || contact?.city || '')

  const linkedinHref = safeUrl(p.linkedin_url)
  const websiteHref = safeUrl(p.business_website)
  const experience = Array.isArray(p.experience) ? p.experience : []
  const expertise = normalizeExpertise(p.expertise)
  const servicesOffered = Array.isArray(p.services_offered) ? p.services_offered : []
  const geographicFocus = Array.isArray(p.geographic_focus) ? p.geographic_focus : []
  // Only show the mentoring section at all if there's something in it —
  // most fields here default to blank/true and shouldn't clutter the
  // profile of someone who never opened that part of the form.
  const hasMentoringInfo = expertise.length > 0 || servicesOffered.length > 0
    || geographicFocus.length > 0
    || !!p.business_website || !!p.availability

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal profile-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="modal-title">{p.full_name || 'Alumnus'}{isMe && <span className="person-name-you">You</span>}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <div className="profile-card-header">
            <PhotoBlock url={p.avatar_url} name={p.full_name} className="modal-photo" />
            <div className="profile-card-heading">
              {roleLine && <p className="profile-card-role">{roleLine}</p>}
              {locationLine && (
                <p className="profile-card-location">
                  <LocationIcon /> {locationLine}
                </p>
              )}
              <span className="profile-status-pill">Alumnus</span>
            </div>
          </div>

          <div className="profile-fact-strip">
            <Fact label="Year left / leaving SACS" value={p.grad_year || dash} />
            <Fact label="Degree studied" value={p.degree || dash} />
            <Fact label="Industry" value={p.industry || dash} />
          </div>

          {p.bio && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">About</h3>
              <p className="profile-card-bio">{p.bio}</p>
            </div>
          )}

          {experience.length > 0 && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">Experience</h3>
              <ul className="experience-timeline">
                {experience.map((entry, i) => (
                  <li className="experience-timeline-entry" key={i}>
                    <div className="experience-timeline-title">
                      {entry.title || 'Role'}{entry.company && <> @ {entry.company}</>}
                    </div>
                    <div className="experience-timeline-meta">
                      {[entry.industry, formatExperienceRange(entry.from, entry.to)].filter(Boolean).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(contact?.phone || contact?.email) && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">Contact</h3>
              <div className="profile-fact-strip">
                {contact.phone && <Fact label="Phone" value={contact.phone} />}
                {contact.email && <Fact label="Email" value={contact.email} />}
              </div>
            </div>
          )}

          {hasMentoringInfo && (
            <div className="profile-card-section">
              <h3 className="profile-card-section-title">Mentoring</h3>

              <div className="profile-fact-strip">
                <Fact label="Open to opportunities" value={p.is_open_to_opportunities ? 'Yes' : 'Not right now'} />
                {p.availability && <Fact label="Availability" value={p.availability} />}
                {websiteHref && (
                  <div className="profile-fact">
                    <span className="profile-fact-label">Website</span>
                    <a
                      className="profile-fact-value"
                      href={websiteHref}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {websiteHref.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>

              {expertise.length > 0 && (
                <div className="profile-card-subsection">
                  <span className="profile-fact-label">Main areas of expertise</span>
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
            </div>
          )}
        </div>
        <div className="modal-footer">
          {linkedinHref && (
            <a className="linkedin-link" href={linkedinHref} target="_blank" rel="noopener noreferrer">
              <LinkedInIconSmall /> LinkedIn
            </a>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
          {!isMe && (
            <button type="button" className="btn primary" onClick={onMessage}>
              Send a message
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Experience dates are stored as "YYYY-MM" (from a native <input type="month">).
// Renders "Jan 2022 – Present" style ranges, or nothing if both are blank.
function formatExperienceRange(from, to) {
  const fmt = (v) => {
    if (!v) return ''
    const [y, m] = v.split('-')
    const d = new Date(Number(y), Number(m) - 1)
    return isNaN(d) ? v : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }
  const fromLabel = fmt(from)
  const toLabel = to ? fmt(to) : (from ? 'Present' : '')
  if (!fromLabel && !toLabel) return ''
  return [fromLabel, toLabel].filter(Boolean).join(' – ')
}

function LinkedInIconSmall() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.13 1 2.5 1s2.48 1.13 2.48 2.5zM.24 8h4.52v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.52v-6.14c0-1.46-.02-3.34-2.04-3.34-2.04 0-2.36 1.6-2.36 3.24V22H7.74V8z"/>
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
