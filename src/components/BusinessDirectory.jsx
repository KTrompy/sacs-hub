import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TILE_URL, TILE_ATTRIBUTION, TILE_SIZE, ZOOM_OFFSET } from '../mapTiles.js'
import { BusinessLogo } from './BusinessLogo.jsx'
import { supabase, deleteStorageFilesFromUrls } from '../supabaseClient'
import { geocodeCity } from '../geocode.js'
import CityAutocomplete from './CityAutocomplete.jsx'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import DeleteButton from './DeleteButton.jsx'
import ReportButton from './ReportButton.jsx'
import { useToast } from './Toast.jsx'
import useDiscardGuard from './useDiscardGuard.jsx'
import useModal from '../useModal.js'
import { useIsWide } from '../utils.js'
import { COUNTRIES } from '../constants.js'
import BusinessDescriptionEditor from './BusinessDescriptionEditor.jsx'
import { sanitizeBusinessHtml } from '../sanitizeHtml.js'

const MAX_LOGO_SIZE = 3 * 1024 * 1024
const MAX_COVER_SIZE = 5 * 1024 * 1024

// Businesses sharing a city/country collapse onto one pin — same rule
// AlumniMap uses for people. The explicit `if (city || country)` matters:
// this used to be `\`${city}|${country}\` || \`${lat},${lng}\``, and a
// template literal is always truthy (an empty one is still "|"), so the
// coordinate fallback never ran and every listing missing city/country data
// piled into a single cluster at their averaged centroid.
function clusterKey(b) {
  const city = (b.city || '').trim().toLowerCase()
  const country = (b.country || '').trim().toLowerCase()
  if (city || country) return `place:${city}|${country}`
  return `coord:${b.lat.toFixed(2)},${b.lng.toFixed(2)}`
}

// Does the HTML contain anything besides whitespace/empty tags? Used so an
// empty WYSIWYG description doesn't pass validation as "filled in".
// Parsed via DOMParser into a detached document rather than assigned to a
// live element's innerHTML — a detached document never loads its
// resources, so an untrusted payload like <img src=x onerror=alert(1)>
// can't fire its handler while we're just extracting text.
function hasText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent.trim().length > 0
}

// Strips tags for search matching and the card's plain-text excerpt.
function plainText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''
}

function truncate(text, max = 140) {
  const t = text.trim()
  return t.length > max ? t.slice(0, max).trim() + '…' : t
}

// Classifies the *listing itself* (not the poster), so someone browsing can
// filter "show me the lawyers" the way the reference's directory does.
export const LISTING_CATEGORIES = [
  'Professional Services',
  'Technology & IT',
  'Retail & E-commerce',
  'Food & Beverage',
  'Health & Wellness',
  'Finance & Insurance',
  'Real Estate & Construction',
  'Legal',
  'Consulting',
  'Education & Training',
  'Creative & Media',
  'Travel & Hospitality',
  'Agriculture',
  'Manufacturing',
  'Non-Profit',
  'Other',
]

const POSTER_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'availability, geographic_focus, is_open_to_opportunities'

const EMPTY_FILTERS = { category: '', country: '' }

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function pinIcon(count) {
  return L.divIcon({
    className: 'alumni-pin-wrap',
    html: `<div class="alumni-pin business-pin">${count > 1 ? count : '★'}</div>`,
    iconSize: [count > 9 ? 36 : 30, count > 9 ? 36 : 30],
    iconAnchor: [count > 9 ? 18 : 15, count > 9 ? 18 : 15],
    popupAnchor: [0, -14],
  })
}

// Re-fits the view to show every pin whenever the set of clusters changes
// (first load, or search/filters narrowing the list) — without this, the
// map stayed pinned at its hardcoded initial center/zoom forever, so
// filtering down to a handful of far-flung businesses still showed the
// original all-world view instead of zooming to where they actually are.
// Same pattern AlumniMap.jsx's FitToMarkers uses.
function FitToMarkers({ points }) {
  const map = useMap()
  const fingerprint = points.map((p) => p.key).join('|')

  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 8)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 9 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint])

  return null
}

const BUSINESSES_PAGE_SIZE = 30

export default function BusinessDirectory({ session, profile, onMessage }) {
  const navigate = useNavigate()
  const [businesses, setBusinesses] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const isWide = useIsWide(900)
  const showToast = useToast()

  const canPost = profile?.approved
  const isAdmin = !!profile?.is_admin

  // Was loading every business row with no limit at all — fine for a
  // handful of listings, but the payload only ever grows as the directory
  // fills up. Loads one page up front; loadMoreBusinesses fetches the next.
  async function loadBusinesses() {
    setLoading(true)
    const { data, error } = await supabase
      .from('businesses')
      .select(`*, profiles!businesses_owner_id_fkey ( ${POSTER_FIELDS} )`)
      .order('promoted', { ascending: false })
      .order('created_at', { ascending: false })
      .range(0, BUSINESSES_PAGE_SIZE - 1)
    if (error) { console.error(error); setLoading(false); return }
    setBusinesses(data || [])
    setHasMore((data || []).length === BUSINESSES_PAGE_SIZE)
    setLoading(false)
  }

  async function loadMoreBusinesses() {
    setLoadingMore(true)
    const { data, error } = await supabase
      .from('businesses')
      .select(`*, profiles!businesses_owner_id_fkey ( ${POSTER_FIELDS} )`)
      .order('promoted', { ascending: false })
      .order('created_at', { ascending: false })
      .range(businesses.length, businesses.length + BUSINESSES_PAGE_SIZE - 1)
    if (!error) {
      setBusinesses((prev) => [...prev, ...(data || [])])
      setHasMore((data || []).length === BUSINESSES_PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  useEffect(() => {
    loadBusinesses()
    const channel = supabase
      .channel('businesses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, () => loadBusinesses())
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!filterOpen || isWide) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') setFilterOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [filterOpen, isWide])

  async function removeBusiness(id) {
    const target = businesses.find((b) => b.id === id)
    const { error } = await supabase.from('businesses').delete().eq('id', id)
    if (error) { showToast('Could not delete listing.', { type: 'error' }); return }
    setBusinesses((prev) => prev.filter((b) => b.id !== id))
    showToast('Listing deleted')
    if (target?.logo_url) deleteStorageFilesFromUrls('business-logos', target.logo_url)
    if (target?.cover_image_url) deleteStorageFilesFromUrls('business-covers', target.cover_image_url)
  }

  async function togglePromote(b) {
    const next = !b.promoted
    setBusinesses((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: next } : x)))
    const { error } = await supabase.from('businesses').update({ promoted: next }).eq('id', b.id)
    if (error) {
      setBusinesses((prev) => prev.map((x) => (x.id === b.id ? { ...x, promoted: !next } : x)))
      showToast('Could not update featured status.', { type: 'error' })
    } else {
      showToast(next ? 'Business featured' : 'Business unfeatured')
    }
  }

  const countryOptions = useMemo(
    () => [...new Set(businesses.map((b) => (b.country || '').trim()).filter(Boolean))].sort(),
    [businesses]
  )

  function set(k, v) { setFilters((f) => ({ ...f, [k]: v })) }
  function clearFilters() { setFilters(EMPTY_FILTERS); setQ('') }

  const needle = q.trim().toLowerCase()
  const shown = businesses.filter((b) => {
    if (needle) {
      const hay = [b.name, b.tagline, b.category, plainText(b.description), b.city, b.country, b.profiles?.full_name]
        .join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    if (filters.category && b.category !== filters.category) return false
    if (filters.country && b.country !== filters.country) return false
    return true
  })

  const promotedShown = shown.filter((b) => b.promoted)
  const regularShown = shown.filter((b) => !b.promoted)
  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const pinned = useMemo(
    () => shown.filter((b) => typeof b.lat === 'number' && typeof b.lng === 'number'),
    [shown]
  )
  const clusters = useMemo(() => {
    const map = new Map()
    for (const b of pinned) {
      const key = clusterKey(b)
      if (!map.has(key)) map.set(key, { key, latSum: 0, lngSum: 0, items: [] })
      const c = map.get(key)
      c.latSum += b.lat
      c.lngSum += b.lng
      c.items.push(b)
    }
    return [...map.values()].map((c) => ({
      key: c.key, lat: c.latSum / c.items.length, lng: c.lngSum / c.items.length, items: c.items,
    }))
  }, [pinned])

  const filterFields = (
    <>
      <FilterSection title="Category">
        <div className="select-wrap">
          <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {LISTING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </FilterSection>
      <FilterSection title="Location">
        <div className="select-wrap">
          <select value={filters.country} onChange={(e) => set('country', e.target.value)}>
            <option value="">All countries</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </FilterSection>
    </>
  )

  function openMessageWithOwner(b) {
    onMessage(
      { id: b.owner_id, full_name: b.profiles?.full_name },
      `Hi! I saw "${b.name}" on the SACS Business Directory and wanted to reach out.`
    )
  }

  return (
    <section className="panel">
      <div className="panel-header-row">
        <div>
          <h2 className="panel-title">Business Directory</h2>
          <p className="panel-sub">Old Boy-owned and Old Boy-run businesses, all in one place.</p>
        </div>
      </div>

      {showForm && (
        <BusinessForm
          session={session}
          onCancel={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); loadBusinesses(); showToast('Business listed') }}
        />
      )}

      {!showForm && businesses.length > 0 && (
        <div className="jobs-encourage-banner">
          <span>
            🏢 {businesses.length} {businesses.length === 1 ? 'business has' : 'businesses have'} been listed by fellow Old Boys. Run something of your own? List it — it takes about two minutes.
          </span>
          {canPost && (
            <button type="button" className="btn primary small" onClick={() => setShowForm(true)}>List it</button>
          )}
        </div>
      )}

      <div className="directory-toolbar">
        <div className="search-wrap">
          <input
            className="search directory-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, category, location…"
          />
          {q && <button type="button" className="search-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>}
        </div>
        {!isWide && (
          <button type="button" className="filters-toggle-btn" onClick={() => setFilterOpen(true)}>
            <FilterIcon />
            Filters
            {activeFilterCount > 0 && <span className="filters-toggle-badge">{activeFilterCount}</span>}
          </button>
        )}
      </div>

      <p className="result-count">
        Showing {shown.length} of {businesses.length} {businesses.length === 1 ? 'business' : 'businesses'}
      </p>

      <div className="directory-layout">
        <div className="directory-main">
          {loading ? (
            <LoadingState message="Loading businesses…" />
          ) : shown.length === 0 ? (
            <EmptyState
              icon="business"
              message={businesses.length === 0 ? 'No businesses listed yet.' : 'No matching businesses found.'}
              subMessage={businesses.length === 0 ? 'Be the first to list yours.' : 'Try widening a filter or clearing them all.'}
              actionLabel={businesses.length === 0 ? (canPost && !showForm ? 'List your business' : undefined) : 'Clear filters'}
              onAction={businesses.length === 0 ? () => setShowForm(true) : clearFilters}
            />
          ) : (
            <>
              {promotedShown.length > 0 && (
                <div className="pinned-posts-section">
                  <p className="feed-section-label">Featured businesses</p>
                  <ul className="business-list">
                    {promotedShown.map((b) => (
                      <BusinessCard
                        key={b.id}
                        b={b}
                        session={session}
                        isAdmin={isAdmin}
                        editingId={editingId}
                        setEditingId={setEditingId}
                        onOpenOwner={() => b.profiles?.id && navigate(`/people/${b.profiles.id}`)}
                        onMessage={() => openMessageWithOwner(b)}
                        onDelete={() => removeBusiness(b.id)}
                        onTogglePromote={() => togglePromote(b)}
                        onUpdated={() => { setEditingId(null); loadBusinesses(); showToast('Listing updated') }}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {regularShown.length > 0 && (
                <>
                  {promotedShown.length > 0 && <p className="feed-section-label">All businesses</p>}
                  <ul className="business-list">
                    {regularShown.map((b) => (
                      <BusinessCard
                        key={b.id}
                        b={b}
                        session={session}
                        isAdmin={isAdmin}
                        editingId={editingId}
                        setEditingId={setEditingId}
                        onOpenOwner={() => b.profiles?.id && navigate(`/people/${b.profiles.id}`)}
                        onMessage={() => openMessageWithOwner(b)}
                        onDelete={() => removeBusiness(b.id)}
                        onTogglePromote={() => togglePromote(b)}
                        onUpdated={() => { setEditingId(null); loadBusinesses(); showToast('Listing updated') }}
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {/* Same rule Feed.jsx/Photos.jsx follow: search/filters only cover
              already-loaded businesses, so the pager is hidden while one's
              active rather than implying "load more" would surface more
              matches. */}
          {!needle && activeFilterCount === 0 && hasMore && (
            <div className="load-more-row">
              <button type="button" className="btn ghost" onClick={loadMoreBusinesses} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more businesses'}
              </button>
            </div>
          )}
        </div>

        {isWide && (
          <aside className="filter-panel persistent" aria-label="Filter businesses">
            <div className="filter-panel-header"><h3><FilterIcon /> Filter by</h3></div>
            {filterFields}
            <div className="filter-panel-footer static">
              <button type="button" className="filter-clear" onClick={clearFilters}>Reset</button>
            </div>

            {pinned.length > 0 && (
              <div className="business-sidebar-map-section">
                <div className="map-shell">
                  <MapContainer center={[20, 10]} zoom={2} scrollWheelZoom className="alumni-map">
                    <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} tileSize={TILE_SIZE} zoomOffset={ZOOM_OFFSET} />
                    <FitToMarkers points={clusters} />
                    {clusters.map((c) => {
                      const place = [c.items[0].city, c.items[0].country].filter(Boolean).join(', ')
                      return (
                        <Marker key={c.key} position={[c.lat, c.lng]} icon={pinIcon(c.items.length)}>
                          <Popup maxWidth={280} minWidth={220}>
                            <div className="map-popup">
                              <div className="map-popup-title">{place || 'Unknown location'}</div>
                              <ul className="map-popup-list">
                                {c.items.map((b) => (
                                  <li key={b.id}>
                                    <button type="button" className="map-popup-person" onClick={() => navigate(`/businesses/${b.id}`)}>
                                      <BusinessLogo url={b.logo_url} name={b.name} />
                                      <span className="map-popup-info">
                                        <strong>{b.name}{b.promoted && <span className="business-featured-tag">Featured</span>}</strong>
                                        <span className="map-popup-meta">{b.category}</span>
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </Popup>
                        </Marker>
                      )
                    })}
                  </MapContainer>
                </div>
              </div>
            )}

            {canPost && (
              <div className="jobs-panel-post-cta">
                <button type="button" className="btn primary wide" onClick={() => setShowForm(true)}>List your business</button>
              </div>
            )}
          </aside>
        )}
      </div>

      {!isWide && filterOpen && (
        <>
          <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
          <aside className="filter-panel open" aria-label="Filter businesses">
            <div className="filter-panel-header">
              <h3>Filter · {activeFilterCount || 'none'}</h3>
              <button type="button" className="modal-close" onClick={() => setFilterOpen(false)} aria-label="Close filters">×</button>
            </div>
            {filterFields}
            <div className="filter-panel-footer">
              <button type="button" className="filter-clear" onClick={clearFilters}>Clear all filters</button>
              <button type="button" className="btn primary wide" onClick={() => setFilterOpen(false)}>
                Show {shown.length} {shown.length === 1 ? 'result' : 'results'}
              </button>
            </div>
          </aside>
        </>
      )}

    </section>
  )
}

/* ---------- One business card (used in both Featured and All sections) ---------- */
function BusinessCard({ b, session, isAdmin, editingId, setEditingId, onOpenOwner, onMessage, onDelete, onTogglePromote, onUpdated }) {
  const isMine = b.owner_id === session.user.id

  if (editingId === b.id) {
    return (
      <li className="job-card business-card">
        <BusinessForm session={session} initial={b} onCancel={() => setEditingId(null)} onCreated={onUpdated} />
      </li>
    )
  }

  const excerpt = truncate(plainText(b.description), 160)

  return (
    <li className="job-card business-card">
      {isAdmin && (
        <button
          type="button"
          className={b.promoted ? 'job-save-btn saved' : 'job-save-btn'}
          onClick={(e) => { e.stopPropagation(); onTogglePromote() }}
          aria-pressed={b.promoted}
          title={b.promoted ? 'Remove from Featured' : 'Feature this business'}
        >
          <StarIcon filled={b.promoted} />
        </button>
      )}
      {/* Stretched link rather than a clickable div — see the note on the
          same pattern in Directory.jsx. */}
      <Link className="stretched-link" to={`/businesses/${b.id}`}>
        <span className="sr-only">{`Open details for ${b.name}`}</span>
      </Link>
      <div className="job-card-main business-card-main">
        {b.cover_image_url && (
          <div className="business-card-cover">
            <img src={b.cover_image_url} alt="" loading="lazy" />
          </div>
        )}
        <div className="business-card-body">
          <BusinessLogo url={b.logo_url} name={b.name} />
          <div className="job-card-content">
            <h3 className="job-title">
              {b.name}
              {b.promoted && <span className="job-badge business-featured-tag">Featured</span>}
              {b.category && <span className="job-badge">{b.category}</span>}
            </h3>
            <p className="job-meta">
              {[b.city, b.country].filter(Boolean).join(', ') || 'Location not set'}
            </p>
            <div className="job-poster-row">
              <button type="button" className="job-poster" onClick={onOpenOwner}>
                <Avatar url={b.profiles?.avatar_url} name={b.profiles?.full_name} size={22} />
                <span>Run by {b.profiles?.full_name || 'a member'} · {timeAgo(b.created_at)}</span>
              </button>
            </div>
            {b.tagline && <p className="business-card-tagline">{b.tagline}</p>}
            {excerpt && (
              <p className="business-desc-excerpt">
                {excerpt}{' '}
                {/* Now that the whole card is a link to the same place, this
                    is a visual affordance rather than a second control —
                    keeping it focusable would just give screen readers a
                    duplicate "Read more" link next to the card's own. */}
                <span className="business-read-more" aria-hidden="true">Read more</span>
              </p>
            )}
          <div className="business-card-actions" style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {b.website && (
              <a className="btn primary small" href={/^https?:\/\//.test(b.website) ? b.website : `https://${b.website}`} target="_blank" rel="noopener noreferrer">
                Visit website
              </a>
            )}
            {!isMine && (
              <button type="button" className="btn ghost small" onClick={onMessage}>Message about this business</button>
            )}
            {!isMine && (
              <ReportButton session={session} entityType="business" entityId={b.id} className="btn ghost small" />
            )}
            {isMine && (
              <button type="button" className="btn ghost small" onClick={() => setEditingId(b.id)}>Edit</button>
            )}
            {(isMine || isAdmin) && (
              <DeleteButton
                onConfirm={onDelete}
                label="Delete listing"
                message="This removes the business listing. This can't be undone."
                className="btn ghost small delete-danger"
              >
                Delete
              </DeleteButton>
            )}
          </div>
          </div>
        </div>
      </div>
    </li>
  )
}

/* ---------- Create/edit form ---------- */
const DRAFT_FIELDS = ['name', 'tagline', 'category', 'description', 'website', 'contact_email', 'phone', 'city', 'country']

export function BusinessForm({ session, onCancel, onCreated, initial = null }) {
  const isEdit = !!initial
  const draftKey = `sacs-business-draft-${session.user.id}`
  const draftRestoredRef = useRef(false)
  const showToast = useToast()
  const [form, setForm] = useState({
    name: initial?.name || '',
    tagline: initial?.tagline || '',
    category: initial?.category || LISTING_CATEGORIES[0],
    description: initial?.description || '',
    website: initial?.website || '',
    contact_email: initial?.contact_email || '',
    phone: initial?.phone || '',
    city: initial?.city || '',
    country: initial?.country || '',
  })
  const [logoFile, setLogoFile] = useState(null)
  const [logoUrl, setLogoUrl] = useState(initial?.logo_url || '')
  const [coverFile, setCoverFile] = useState(null)
  const [coverUrl, setCoverUrl] = useState(initial?.cover_image_url || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [isClosing, setIsClosing] = useState(false)
  const logoRef = useRef(null)
  const coverRef = useRef(null)
  // Coordinates captured straight from a picked CityAutocomplete suggestion
  // (address or city-level) — see handleLocationCoords. When present and
  // still matching what's in the field, submit uses these directly instead
  // of re-geocoding, same pattern as Jobs.jsx's "Post a role" form.
  const [pickedCoords, setPickedCoords] = useState(
    isEdit && typeof initial?.lat === 'number' ? { lat: initial.lat, lng: initial.lng } : null
  )
  const [pickedLabel, setPickedLabel] = useState(isEdit ? initial?.city || '' : '')

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  function handleLocationCoords(payload) {
    if (!payload) { setPickedCoords(null); setPickedLabel(''); return }
    setPickedCoords({ lat: payload.lat, lng: payload.lng })
    setPickedLabel(payload.label)
  }

  useEffect(() => {
    if (isEdit) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prevOverflow }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isEdit || draftRestoredRef.current) return
    draftRestoredRef.current = true
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const saved = JSON.parse(raw)
      const meaningful = DRAFT_FIELDS.some((k) => (saved[k] || '').trim())
      if (!meaningful) return
      setForm((f) => ({ ...f, ...saved }))
      showToast('Draft restored')
    } catch { /* corrupt/unavailable storage — nothing to restore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isEdit) return
    const t = setTimeout(() => {
      try {
        const meaningful = DRAFT_FIELDS.some((k) => (form[k] || '').trim())
        if (!meaningful) localStorage.removeItem(draftKey)
        else localStorage.setItem(draftKey, JSON.stringify(form))
      } catch { /* storage full/unavailable — draft just won't persist this time */ }
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isEdit])

  function handleCancel() {
    if (busy) return
    if (isEdit) { onCancel(); return }
    setIsClosing(true)
    setTimeout(onCancel, 200)
  }

  // See the fuller note on the same pattern in Jobs.jsx: a backdrop click
  // used to discard a part-written listing outright, with no warning and no
  // undo, even though deleting a saved listing has always asked first.
  const pristineRef = useRef(JSON.stringify(form))
  const dirty = JSON.stringify(form) !== pristineRef.current || !!logoFile || !!coverFile

  const { requestClose, discardDialog } = useDiscardGuard({
    dirty: dirty && !busy,
    onDiscard: handleCancel,
    title: isEdit ? 'Discard your changes?' : 'Discard this listing?',
    message: "Anything you've entered here will be lost.",
    confirmLabel: 'Discard',
  })

  const panelRef = useModal({
    enabled: !isEdit,
    onClose: requestClose,
    closeOnEscape: !busy,
    // This form already locks body scroll itself, just above.
    lockScroll: false,
  })

  function pickLogo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_LOGO_SIZE) { setError('Logo image is over 3MB.'); e.target.value = ''; return }
    setLogoFile(f)
    setError(null)
    e.target.value = ''
  }

  function removeLogo() { setLogoFile(null); setLogoUrl('') }

  async function uploadLogo() {
    const ext = logoFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('business-logos')
      .upload(path, logoFile, { upsert: false, contentType: logoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('business-logos').getPublicUrl(path)
    return data.publicUrl
  }

  function pickCover(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > MAX_COVER_SIZE) { setError('Cover image is over 5MB.'); e.target.value = ''; return }
    setCoverFile(f)
    setError(null)
    e.target.value = ''
  }

  function removeCover() { setCoverFile(null); setCoverUrl('') }

  async function uploadCover() {
    const ext = coverFile.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('business-covers')
      .upload(path, coverFile, { upsert: false, contentType: coverFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('business-covers').getPublicUrl(path)
    return data.publicUrl
  }

  async function submit() {
    if (!form.name.trim() || !form.category || !hasText(form.description)) {
      setError('Name, category and description are required.'); return
    }
    if (!form.website.trim() && !form.contact_email.trim() && !form.phone.trim()) {
      setError('Please provide at least one way to get in touch — website, email or phone.'); return
    }
    setBusy(true); setError(null)
    try {
      const finalLogoUrl = logoFile ? await uploadLogo() : logoUrl
      const finalCoverUrl = coverFile ? await uploadCover() : coverUrl

      // Prefer coordinates captured straight from a picked suggestion —
      // already a confirmed, geocodable place/address, no need to look it
      // up again. Otherwise fall back to re-geocoding only when the
      // city/country actually changed (or this is a brand new listing),
      // same "don't hit the API on every unrelated edit" rule Profile.jsx
      // follows for people's pins.
      let coords = { lat: initial?.lat ?? null, lng: initial?.lng ?? null }
      const cityChanged = !isEdit || form.city !== initial?.city || form.country !== initial?.country
      if (pickedCoords && form.city.trim() === pickedLabel.trim()) {
        coords = pickedCoords
      } else if (cityChanged && form.city.trim()) {
        const geo = await geocodeCity(form.city, form.country)
        coords = { lat: geo?.lat ?? null, lng: geo?.lng ?? null }
      } else if (cityChanged && !form.city.trim()) {
        coords = { lat: null, lng: null }
      }

      const payload = {
        ...form,
        name: form.name.trim(),
        tagline: form.tagline.trim(),
        description: sanitizeBusinessHtml(form.description),
        website: form.website.trim(),
        contact_email: form.contact_email.trim(),
        phone: form.phone.trim(),
        logo_url: finalLogoUrl,
        cover_image_url: finalCoverUrl,
        ...coords,
      }
      const { error } = isEdit
        ? await supabase.from('businesses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', initial.id)
        : await supabase.from('businesses').insert({ ...payload, owner_id: session.user.id })
      if (error) {
        setError(error.message.includes('policy')
          ? 'Listing a business unlocks once your account is approved.'
          : error.message)
        setBusy(false)
      } else {
        if (!isEdit) { try { localStorage.removeItem(draftKey) } catch { /* ignore */ } }
        onCreated()
      }
    } catch (e) {
      setError(e.message || 'Logo upload failed.')
      setBusy(false)
    }
  }

  const logoPreview = logoFile ? URL.createObjectURL(logoFile) : logoUrl
  const coverPreview = coverFile ? URL.createObjectURL(coverFile) : coverUrl

  return (
    <div
      className={isEdit ? '' : `create-panel-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={isEdit ? undefined : (e) => e.target === e.currentTarget && requestClose()}
      role={isEdit ? undefined : 'dialog'}
      aria-modal={isEdit ? undefined : 'true'}
      aria-label={isEdit ? undefined : 'List your business'}
    >
      {/* A real <form> so Enter submits — see the note in Jobs.jsx. */}
      <form
        className={isEdit ? 'create-panel inline' : `create-panel business-form-panel ${isClosing ? 'closing' : ''}`}
        ref={panelRef}
        onSubmit={(e) => { e.preventDefault(); if (!busy) submit() }}
        noValidate
      >
        <h3>{isEdit ? 'Edit business' : 'List your business'}</h3>
        <div className="create-panel-content">
          <p className="form-hint">Takes about two minutes — fellow Old Boys love supporting their own.</p>

          {/* ── Section 1: Business basics ── */}
          <div className="job-form-section">
            <h4 className="job-form-section-title">Business details</h4>
            <div className="field-row">
              <label className="field"><span>Business name *</span>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="SACS Coffee Co." />
              </label>
              <label className="field"><span>Category *</span>
                <div className="select-wrap">
                  <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {LISTING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </label>
            </div>
            <label className="field"><span>Header / tagline (optional)</span>
              <input
                value={form.tagline}
                onChange={(e) => set('tagline', e.target.value)}
                placeholder="A fun and friendly beerhouse & bistro"
                maxLength={140}
              />
            </label>
          </div>

          {/* ── Section 2: Media ── */}
          <div className="job-form-section">
            <h4 className="job-form-section-title">Images</h4>
            <label className="field"><span>Cover image (optional)</span></label>
            <p className="form-hint" style={{ marginTop: -8 }}>A big banner image shown above your listing's name — on the card preview and the full listing page.</p>
            <div className="job-logo-picker business-cover-picker">
              {coverPreview ? (
                <img className="business-cover-preview" src={coverPreview} alt="Cover preview" />
              ) : (
                <div className="business-cover-preview business-cover-fallback" aria-hidden="true"><ImagePlaceholderIcon /></div>
              )}
              <div className="job-logo-picker-actions">
                <button type="button" className="btn ghost small" onClick={() => coverRef.current?.click()}>
                  {coverPreview ? 'Replace image' : 'Upload image'}
                </button>
                {coverPreview && <button type="button" className="btn ghost small" onClick={removeCover}>Remove</button>}
              </div>
              <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickCover} />
            </div>

            <label className="field" style={{ marginTop: 14 }}><span>Logo (optional)</span></label>
            <div className="job-logo-picker">
              {logoPreview ? (
                <img className="job-logo job-logo-preview" src={logoPreview} alt="Logo preview" />
              ) : (
                <div className="job-logo job-logo-fallback" aria-hidden="true">{(form.name || '?').trim().charAt(0).toUpperCase()}</div>
              )}
              <div className="job-logo-picker-actions">
                <button type="button" className="btn ghost small" onClick={() => logoRef.current?.click()}>
                  {logoPreview ? 'Replace image' : 'Upload image'}
                </button>
                {logoPreview && <button type="button" className="btn ghost small" onClick={removeLogo}>Remove</button>}
              </div>
              <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={pickLogo} />
            </div>
          </div>

          {/* ── Section 3: Description ── */}
          <div className="job-form-section">
            <h4 className="job-form-section-title">Description *</h4>
            <div className="rte-box">
              <BusinessDescriptionEditor
                value={form.description}
                onChange={(html) => set('description', html)}
                placeholder="What you do, who you serve, why a fellow Old Boy should reach out…"
              />
            </div>
          </div>

          {/* ── Section 4: Location & contact ── */}
          <div className="job-form-section">
            <h4 className="job-form-section-title">Location &amp; contact</h4>
            <div className="field-row">
              <label className="field"><span>Location</span>
                <CityAutocomplete
                  value={form.city}
                  country={form.country}
                  onChange={(v) => set('city', v)}
                  onSelectCoords={handleLocationCoords}
                  placeholder="Street address, or just a city"
                />
                <span className="hint">Start typing and choose from suggestions — a full address pins your listing more precisely</span>
              </label>
              <label className="field"><span>Country</span>
                <div className="select-wrap">
                  <select value={form.country} onChange={(e) => set('country', e.target.value)}>
                    <option value="">Select…</option>
                    {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </label>
            </div>

            <div className="field-row" style={{ marginTop: 14 }}>
              <label className="field"><span>Website</span>
                <input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
              </label>
              <label className="field"><span>Contact email</span>
                <input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)} placeholder="you@business.com" />
              </label>
            </div>
            <label className="field"><span>Phone</span>
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+27 …" />
            </label>
            <p className="form-hint" style={{ marginBottom: 0 }}>At least one of website, email or phone is required so people can reach you.</p>
          </div>

          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            onClick={requestClose}
            disabled={isClosing || busy}
            title={busy ? 'Wait for the save to finish' : undefined}
          >
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy} title={busy ? 'Saving…' : undefined}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'List business')}
          </button>
        </div>
      </form>
      {discardDialog}
    </div>
  )
}

/* ---------- Small pieces ---------- */
// Moved to ./BusinessLogo.jsx so Home can render it without importing this
// whole module. Re-exported here so existing importers keep working.
export { BusinessLogo }

function ImagePlaceholderIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

function FilterSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={open ? 'filter-section open' : 'filter-section'}>
      <button type="button" className="filter-section-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}</span>
        <span className="chev" aria-hidden="true">▸</span>
      </button>
      {open && <div className="filter-section-body">{children}</div>}
    </div>
  )
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  )
}

function StarIcon({ filled = false }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.5l3 6.5 7 1-5.2 5 1.3 7-6.1-3.4-6.1 3.4 1.3-7-5.2-5 7-1z" />
    </svg>
  )
}

