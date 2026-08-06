import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TILE_URL, TILE_ATTRIBUTION, TILE_SIZE, ZOOM_OFFSET } from '../mapTiles.js'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import { useToast } from './Toast.jsx'
import { matchReason } from '../icebreaker.js'
import { sanitizeHtml, trimTrailingHtml } from '../sanitizeHtml.js'
import { safeUrl } from '../utils.js'
import ApplyModal from './ApplyModal.jsx'
import JobApplications from './JobApplications.jsx'
import { JOB_FIELDS, POSTER_FIELDS, JobForm, JobLogo, PdfIcon, isJobClosed } from './Jobs.jsx'

// Same plain-div marker Leaflet trick BusinessDetail's mini map uses —
// avoids depending on Leaflet's default marker image assets for a single pin.
function singlePinIcon() {
  return L.divIcon({
    className: 'alumni-pin-wrap',
    html: '<div class="alumni-pin business-pin">★</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

// The standalone job listing page — reached from the job board's card
// instead of the old floating JobModal popup, same "modal → real page"
// migration Directory/Businesses already went through. Logo + title sit
// together up top, then the organisation/type/industry/posted info, then a
// full-width map with the location underneath it, then the attachment and
// closing date, then the description.
export default function JobDetail({ session, profile, onMessage }) {
  const { jobId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showApply, setShowApply] = useState(false)
  const [hasApplied, setHasApplied] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('jobs')
      .select(`${JOB_FIELDS}, profiles!jobs_posted_by_fkey ( ${POSTER_FIELDS} )`)
      .eq('id', jobId)
      .maybeSingle()
    if (error) console.error(error)
    setJob(data || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [jobId])

  useEffect(() => {
    let cancelled = false
    supabase
      .from('saved_jobs')
      .select('job_id')
      .eq('user_id', session.user.id)
      .eq('job_id', jobId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsSaved(!!data) })
    supabase
      .from('job_applications')
      .select('id')
      .eq('applicant_id', session.user.id)
      .eq('job_id', jobId)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setHasApplied(!!data) })
    return () => { cancelled = true }
  }, [jobId, session.user.id])

  async function toggleSave() {
    const next = !isSaved
    setIsSaved(next)
    const { error } = next
      ? await supabase.from('saved_jobs').insert({ job_id: job.id, user_id: session.user.id })
      : await supabase.from('saved_jobs').delete().match({ job_id: job.id, user_id: session.user.id })
    if (error) {
      setIsSaved(!next)
      showToast('Could not update saved jobs.', { type: 'error' })
    } else {
      showToast(next ? 'Job saved' : 'Removed from saved')
    }
  }

  async function remove() {
    const { error } = await supabase.from('jobs').delete().eq('id', job.id)
    if (error) { showToast('Could not delete listing.', { type: 'error' }); return }
    showToast('Listing deleted')
    navigate('/jobs')
  }

  // Copies a link, matching Events and the job board list — see the fuller
  // note on shareJob() in Jobs.jsx.
  async function shareJob() {
    const url = `${window.location.origin}/jobs/${job.id}`
    try {
      await navigator.clipboard.writeText(`${job.title} @ ${job.company}\n${url}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable — button just won't confirm.
    }
  }

  if (loading) return <section className="panel"><LoadingState message="Loading role…" /></section>

  if (!job) {
    return (
      <section className="panel">
        <button type="button" className="profile-back-btn" onClick={() => navigate('/jobs')}>‹ Career &amp; Volunteer Opportunities</button>
        <EmptyState icon="jobs" message="Listing not found." subMessage="It may have been removed." actionLabel="Back to job board" onAction={() => navigate('/jobs')} />
      </section>
    )
  }

  const isMine = job.posted_by === session.user.id
  // The board hides Apply on closed listings, but this page is reachable
  // directly (saved link, share, bookmark) — so the gate has to live here too,
  // not just in the filtered card list.
  const closed = isJobClosed(job)
  const poster = job.profiles
  const reason = !isMine ? matchReason(profile, poster) : null
  const hasPin = typeof job.lat === 'number' && typeof job.lng === 'number'
  // Legacy rows might carry a scheme-less domain (e.g. "example.com") — add
  // https:// so the click actually leaves the app. safeUrl afterwards is
  // what filters out any javascript:/data: URIs the old code would have
  // happily wrapped in https:// prefix without noticing.
  const rawCompanyWebsite = job.company_website
    ? (/^https?:\/\//i.test(job.company_website) ? job.company_website : `https://${job.company_website}`)
    : null
  const companyWebsite = safeUrl(rawCompanyWebsite)
  const attachmentHref = safeUrl(job.attachment_url)

  if (editing) {
    return (
      <section className="panel job-detail-page">
        <button type="button" className="profile-back-btn" onClick={() => setEditing(false)}>‹ Cancel edit</button>
        <JobForm
          session={session}
          initial={job}
          onCancel={() => setEditing(false)}
          onCreated={() => { setEditing(false); load(); showToast('Listing updated') }}
        />
      </section>
    )
  }

  return (
    <section className="panel job-detail-page">
      <button type="button" className="profile-back-btn" onClick={() => navigate('/jobs')}>‹ Career &amp; Volunteer Opportunities</button>

      <div className="job-detail-layout">
        <div className="job-detail-main">
          <div className="job-detail-card">
            <div className="job-detail-card-head">
              <JobLogo url={job.logo_url} company={job.company} />
              <div className="job-detail-heading">
                <h2 className="job-detail-title">
                  {job.title}
                  {job.employment_type && <span className="job-badge">{job.employment_type}</span>}
                  {job.updated_at && <span className="edited-tag">edited</span>}
                </h2>
              </div>
            </div>

            <div className="job-detail-info-grid">
              <div className="job-detail-info-item">
                <span className="job-detail-info-label">Organisation</span>
                <strong>{job.company}</strong>
              </div>
              <div className="job-detail-info-item">
                <span className="job-detail-info-label">Employment type</span>
                <strong>{job.employment_type || '—'}</strong>
              </div>
              <div className="job-detail-info-item">
                <span className="job-detail-info-label">Industry</span>
                <strong>{job.industry || '—'}</strong>
              </div>
              <div className="job-detail-info-item">
                <span className="job-detail-info-label">Posted</span>
                <strong>{formatDate(job.created_at)}</strong>
              </div>
            </div>

            {companyWebsite && (
              <a className="business-visit-website job-detail-company-link" href={companyWebsite} target="_blank" rel="noopener noreferrer">
                <ExternalIcon /> Visit company website
              </a>
            )}

            {hasPin && (
              <div className="job-detail-map-section">
                <div className="job-detail-map">
                  <MapContainer center={[job.lat, job.lng]} zoom={12} scrollWheelZoom={false} dragging={false} className="job-detail-map-inner">
                    <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} tileSize={TILE_SIZE} zoomOffset={ZOOM_OFFSET} />
                    <Marker position={[job.lat, job.lng]} icon={singlePinIcon()} />
                  </MapContainer>
                </div>
              </div>
            )}
            <p className="business-location-line job-detail-location-line">
              <PinIcon /> {job.location || 'Location not set'}
            </p>

            {attachmentHref && (
              <a className="job-detail-attachment-link" href={attachmentHref} target="_blank" rel="noopener noreferrer">
                <PdfIcon /> {job.attachment_name || 'Attachment'} <span className="job-detail-download-hint">file download</span>
              </a>
            )}

            {job.closing_date && (
              <p className="job-detail-closing-date">
                Closing date for applications: <strong>{formatDate(job.closing_date)}</strong>
              </p>
            )}

            <div className="job-poster-row" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="job-poster" onClick={() => poster?.id && navigate(`/people/${poster.id}`)}>
                <Avatar url={poster?.avatar_url} name={poster?.full_name} size={22} />
                <span>Posted by {poster?.full_name || 'a member'} · {timeAgo(job.created_at)}</span>
              </button>
              {reason && (
                <span className="job-match-badge" title="Something you have in common with the poster">
                  {reason}
                </span>
              )}
            </div>

            <div className="job-detail-description">
              <h3 className="profile-card-section-title">Description</h3>
              <div
                className="job-desc rendered-html"
                dangerouslySetInnerHTML={{ __html: trimTrailingHtml(sanitizeHtml(job.description)) }}
              />
            </div>

            <div className="job-detail-actions">
              <button
                type="button"
                className={isSaved ? 'btn ghost small job-modal-save on' : 'btn ghost small job-modal-save'}
                onClick={toggleSave}
                aria-pressed={isSaved}
              >
                {isSaved ? 'Saved' : 'Save'}
              </button>
              {!isMine && (
                <button type="button"
                  className="btn primary small"
                  onClick={() => !hasApplied && !closed && setShowApply(true)}
                  disabled={hasApplied || closed}
                  title={closed ? 'Applications for this role have closed.' : undefined}
                >
                  {hasApplied ? 'Applied' : closed ? 'Applications closed' : 'Apply'}
                </button>
              )}
              {!isMine && (
                <button type="button"
                  className="btn ghost small"
                  onClick={() => onMessage(
                    { id: job.posted_by, full_name: poster?.full_name },
                    `Hi! I saw your "${job.title}" post on the job board and wanted to reach out.`
                  )}
                >
                  Message about this role
                </button>
              )}
              <button type="button" className="btn ghost small" onClick={shareJob}>
                {copied ? 'Link copied!' : 'Share'}
              </button>
              {isMine && (
                <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {isMine && (
                <DeleteButton
                  onConfirm={remove}
                  label="Delete listing"
                  message="This removes the job listing. This can't be undone."
                  className="btn ghost small delete-danger"
                >
                  Delete
                </DeleteButton>
              )}
            </div>
          </div>
        </div>

        <aside className="job-detail-sidebar">
          <div className="feed-widget job-detail-poster-card">
            <p className="job-detail-poster-label">Added by</p>
            <button type="button" className="business-detail-poster" onClick={() => poster?.id && navigate(`/people/${poster.id}`)}>
              <Avatar url={poster?.avatar_url} name={poster?.full_name} size={44} />
              <span className="business-detail-poster-text">
                <strong>{poster?.full_name || 'a member'}</strong>
              </span>
            </button>
          </div>

          <div className="feed-widget business-promote-card">
            <p>Know of an opening a fellow Old Boy should hear about?</p>
            <button type="button" className="btn primary wide" onClick={() => navigate('/jobs')}>Post a role</button>
          </div>
        </aside>
      </div>

      {isMine && (
        <div className="job-detail-applications-section">
          <h3 className="profile-card-section-title">Applications</h3>
          <JobApplications jobId={job.id} session={session} />
        </div>
      )}

      {showApply && !closed && (
        <ApplyModal
          job={job}
          session={session}
          profile={profile}
          onClose={() => setShowApply(false)}
          onApplied={() => setHasApplied(true)}
        />
      )}
    </section>
  )
}

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
