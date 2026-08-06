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
import { sanitizeBusinessHtml } from '../sanitizeHtml.js'
import { BusinessLogo, BusinessForm } from './BusinessDirectory.jsx'

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'availability, geographic_focus, is_open_to_opportunities'

// Same plain-div marker Leaflet trick BusinessDirectory's map view uses
// (.alumni-pin-wrap / .alumni-pin business-pin) — avoids depending on
// Leaflet's default marker image assets for this single-pin mini map.
function singlePinIcon() {
  return L.divIcon({
    className: 'alumni-pin-wrap',
    html: '<div class="alumni-pin business-pin">★</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

// The standalone listing page — reached from the directory card's "Read
// more" link instead of the old floating modal. Laid out to match the
// Maties Connect reference: everything about the listing itself (logo,
// name, category/location, the cover photo at full size, who posted it,
// tagline, description) lives in one card in the main column; contact
// details, a map pin, and a "list your own" promo sit in cards down the
// right-hand sidebar.
export default function BusinessDetail({ session, profile, onMessage }) {
  const { businessId } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [business, setBusiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const isAdmin = !!profile?.is_admin

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('businesses')
      .select(`*, profiles!businesses_owner_id_fkey ( ${POSTER_FIELDS} )`)
      .eq('id', businessId)
      .maybeSingle()
    if (error) console.error(error)
    setBusiness(data || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [businessId])

  async function remove() {
    const { error } = await supabase.from('businesses').delete().eq('id', business.id)
    if (error) { showToast('Could not delete listing.', { type: 'error' }); return }
    showToast('Listing deleted')
    navigate('/businesses')
  }

  async function togglePromote() {
    const next = !business.promoted
    setBusiness((b) => ({ ...b, promoted: next }))
    const { error } = await supabase.from('businesses').update({ promoted: next }).eq('id', business.id)
    if (error) {
      setBusiness((b) => ({ ...b, promoted: !next }))
      showToast('Could not update featured status.', { type: 'error' })
    } else {
      showToast(next ? 'Business featured' : 'Business unfeatured')
    }
  }

  function messageOwner() {
    onMessage(
      { id: business.owner_id, full_name: business.profiles?.full_name },
      `Hi! I saw "${business.name}" on the SACS Business Directory and wanted to reach out.`
    )
  }

  if (loading) return <section className="panel"><LoadingState message="Loading listing…" /></section>

  if (!business) {
    return (
      <section className="panel">
        <button type="button" className="profile-back-btn" onClick={() => navigate('/businesses')}>‹ Business Directory</button>
        <EmptyState icon="business" message="Listing not found." subMessage="It may have been removed." actionLabel="Back to Business Directory" onAction={() => navigate('/businesses')} />
      </section>
    )
  }

  const isMine = business.owner_id === session.user.id
  const website = business.website
    ? (/^https?:\/\//.test(business.website) ? business.website : `https://${business.website}`)
    : null
  const hasPin = typeof business.lat === 'number' && typeof business.lng === 'number'
  const owner = business.profiles
  const ownerRole = owner && [owner.occupation, owner.company].filter(Boolean).join(' @ ')

  if (editing) {
    return (
      <section className="panel business-detail-page">
        <button type="button" className="profile-back-btn" onClick={() => setEditing(false)}>‹ Cancel edit</button>
        <BusinessForm
          session={session}
          initial={business}
          onCancel={() => setEditing(false)}
          onCreated={() => { setEditing(false); load(); showToast('Listing updated') }}
        />
      </section>
    )
  }

  return (
    <section className="panel business-detail-page">
      <button type="button" className="profile-back-btn" onClick={() => navigate('/businesses')}>‹ Business Directory</button>

      <div className="business-detail-layout">
        <div className="business-detail-main">
          <div className="business-detail-card">
            <div className="business-detail-card-head">
              <BusinessLogo url={business.logo_url} name={business.name} />
              <h2 className="business-detail-name">
                {business.name}
                {business.promoted && <span className="job-badge business-featured-tag">Featured</span>}
              </h2>
              <p className="business-detail-meta">
                {[business.category, [business.city, business.country].filter(Boolean).join(', ')]
                  .filter(Boolean).join(' - ') || 'Location not set'}
              </p>
            </div>

            {business.cover_image_url && (
              <div className="business-detail-cover">
                <img src={business.cover_image_url} alt="" />
              </div>
            )}

            <div className="business-detail-poster-row">
              <button type="button" className="business-detail-poster" onClick={() => owner?.id && navigate(`/people/${owner.id}`)}>
                <Avatar url={owner?.avatar_url} name={owner?.full_name} size={44} />
                <span className="business-detail-poster-text">
                  <strong>{owner?.full_name || 'a member'}</strong>
                  {ownerRole && <span>{ownerRole}</span>}
                </span>
              </button>
              {!isMine && (
                <button type="button" className="business-direct-message-btn" onClick={messageOwner}>
                  <MessageIcon /> Direct message
                </button>
              )}
            </div>

            {business.tagline && <h3 className="business-detail-tagline">{business.tagline}</h3>}

            {business.description && (
              <div
                className="business-rich-content"
                dangerouslySetInnerHTML={{ __html: sanitizeBusinessHtml(business.description) }}
              />
            )}

            {(isMine || isAdmin) && (
              <div className="business-detail-manage-row">
                {isAdmin && (
                  <button type="button" className="btn ghost small" onClick={togglePromote}>
                    {business.promoted ? 'Remove from Featured' : 'Feature this business'}
                  </button>
                )}
                {isMine && <button type="button" className="btn ghost small" onClick={() => setEditing(true)}>Edit</button>}
                {(isMine || isAdmin) && (
                  <DeleteButton
                    onConfirm={remove}
                    label="Delete listing"
                    message="This removes the business listing. This can't be undone."
                    className="btn ghost small delete-danger"
                  >
                    Delete
                  </DeleteButton>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="business-detail-sidebar">
          {(business.phone || business.contact_email || website) && (
            <div className="feed-widget business-contact-card">
              <p className="business-sidebar-label">Contact</p>
              {business.phone && (
                <a className="business-contact-row" href={`tel:${business.phone.replace(/\s+/g, '')}`}>
                  <PhoneIcon /> {business.phone}
                </a>
              )}
              {business.contact_email && (
                <a className="business-contact-row" href={`mailto:${business.contact_email}`}>
                  <MailIcon /> {business.contact_email}
                </a>
              )}
              {website && (
                <>
                  <hr className="business-contact-divider" />
                  <a className="business-visit-website" href={website} target="_blank" rel="noopener noreferrer">
                    <ExternalIcon /> Visit website
                  </a>
                </>
              )}
            </div>
          )}

          <div className="feed-widget business-location-card">
            <p className="business-sidebar-label">Location</p>
            <p className="business-location-line">
              <PinIcon /> {[business.city, business.country].filter(Boolean).join(', ') || 'Location not set'}
            </p>
            {hasPin && (
              <div className="business-mini-map">
                <MapContainer center={[business.lat, business.lng]} zoom={12} scrollWheelZoom={false} dragging={false} className="business-mini-map-inner">
                  <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} tileSize={TILE_SIZE} zoomOffset={ZOOM_OFFSET} />
                  <Marker position={[business.lat, business.lng]} icon={singlePinIcon()} />
                </MapContainer>
              </div>
            )}
          </div>

          <div className="feed-widget business-promote-card">
            <p className="business-sidebar-label">List your business</p>
            <p>Do you have a business you would like to promote?</p>
            <button type="button" className="btn primary wide" onClick={() => navigate('/businesses?post=1')}>Start posting</button>
          </div>
        </aside>
      </div>
    </section>
  )
}

function MessageIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}
function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 7l10 6 10-6" />
    </svg>
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
