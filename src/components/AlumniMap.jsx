import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { TILE_URL, TILE_ATTRIBUTION, TILE_SIZE, ZOOM_OFFSET } from '../mapTiles.js'
import { PhotoBlock, OnlineDot } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'

// People sharing a city/country cluster onto one pin, so a city with 40
// Old Boys doesn't paint 40 overlapping markers on top of each other —
// grouping by place name (rather than raw lat/lng) means two people
// geocoded to slightly different addresses within the same city ("Cape
// Town" vs. a specific Cape Town suburb) still land in the same bubble.
// Anyone missing a city/country falls back to rounding their coordinates
// (~0.01deg, on the order of a city block) so they still cluster with
// close-by pins instead of each getting their own marker.
function clusterKey(p) {
  const city = (p.city || '').trim().toLowerCase()
  const country = (p.country || '').trim().toLowerCase()
  if (city || country) return `place:${city}|${country}`
  return `coord:${p.lat.toFixed(2)},${p.lng.toFixed(2)}`
}

function pinIcon(count) {
  return L.divIcon({
    className: 'alumni-pin-wrap',
    html: `<div class="alumni-pin">${count}</div>`,
    iconSize: [count > 9 ? 36 : 30, count > 9 ? 36 : 30],
    iconAnchor: [count > 9 ? 18 : 15, count > 9 ? 18 : 15],
    popupAnchor: [0, -14],
  })
}

// Re-fits the view to show every pin whenever the set of clusters changes
// (first load, or the shared filters up in People.jsx narrowing the list).
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

// Alumni map — the List/Map toggle's other view. Filtering/search now live
// one level up in People.jsx (see DirectoryFilters.jsx) so this just plots
// whatever `people` it's handed; it no longer fetches its own copy.
export default function AlumniMap({ session, people, loading, onGoToProfile, hideHeader = false }) {
  const navigate = useNavigate()

  const pinned = useMemo(
    () => people.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number'),
    [people]
  )

  const clusters = useMemo(() => {
    const map = new Map()
    for (const p of pinned) {
      const key = clusterKey(p)
      if (!map.has(key)) map.set(key, { key, latSum: 0, lngSum: 0, people: [] })
      const c = map.get(key)
      c.latSum += p.lat
      c.lngSum += p.lng
      c.people.push(p)
    }
    // Position each cluster's pin at the centroid of everyone grouped into
    // it, rather than just the first person's exact coordinates.
    return [...map.values()].map((c) => ({
      key: c.key,
      lat: c.latSum / c.people.length,
      lng: c.lngSum / c.people.length,
      people: c.people,
    }))
  }, [pinned])

  const placeCount = useMemo(
    () => new Set(pinned.map((p) => `${(p.city || '').toLowerCase()}|${(p.country || '').toLowerCase()}`)).size,
    [pinned]
  )

  return (
    <div className={hideHeader ? '' : 'panel'}>
      {!hideHeader && (
        <>
          <h2 className="panel-title">Alumni map</h2>
          <p className="panel-sub">Where are we all now? And no, not everyone is just hiding in the ondergrond waiting for Burger Friday.</p>
        </>
      )}

      {pinned.length > 0 && (
        <p className="result-count">
          {pinned.length} Old Boys pinned across {placeCount} {placeCount === 1 ? 'place' : 'places'}
        </p>
      )}

      {loading && <LoadingState message="Loading alumni map…" />}

      {!loading && pinned.length === 0 && (
        <EmptyState
          icon="search"
          message="No one's on the map yet."
          subMessage="A pin appears automatically once an alumnus saves a city on their profile — or try widening/clearing your filters."
          actionLabel={onGoToProfile ? 'Update your profile location' : undefined}
          onAction={onGoToProfile}
        />
      )}

      {pinned.length > 0 && (
        <div className="map-shell">
          <MapContainer
            center={[20, 10]}
            zoom={2}
            minZoom={2}
            maxBounds={[[-90, -180], [90, 180]]}
            maxBoundsViscosity={1.0}
            scrollWheelZoom
            className="alumni-map"
          >
            <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} tileSize={TILE_SIZE} zoomOffset={ZOOM_OFFSET} />
            <FitToMarkers points={clusters} />
            {clusters.map((c) => {
              const place = [c.people[0].city, c.people[0].country].filter(Boolean).join(', ')
              return (
                <Marker key={c.key} position={[c.lat, c.lng]} icon={pinIcon(c.people.length)}>
                  <Popup maxWidth={280} minWidth={220}>
                    <div className="map-popup">
                      <div className="map-popup-title">{place || 'Unknown location'}</div>
                      <ul className="map-popup-list">
                        {c.people.map((p) => (
                          <li key={p.id}>
                            <button type="button" className="map-popup-person" onClick={() => navigate(`/people/${p.id}`)}>
                              <span className="map-popup-photo-wrap">
                                <PhotoBlock url={p.avatar_url} name={p.full_name} className="map-popup-photo" />
                                <OnlineDot lastSeen={p.last_seen} />
                              </span>
                              <span className="map-popup-info">
                                <strong>
                                  {p.full_name || 'Alumnus'}
                                  {p.id === session.user.id && <span className="person-name-you">You</span>}
                                </strong>
                                <span className="map-popup-meta">
                                  {p.industry ? p.industry : ''}
                                  {p.industry && (p.occupation || p.company) ? ' · ' : ''}
                                  {[p.occupation, p.company].filter(Boolean).join(' @ ')}
                                </span>
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
          <p className="map-hint">Tap a pin to see who's there, view their profile, or send a message.</p>
        </div>
      )}
    </div>
  )
}
