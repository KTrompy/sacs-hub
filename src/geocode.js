// Turns free-text into approximate coordinates — anything from a full
// street address down to just a city/country — so the Alumni Map (and
// Business Directory / Jobs / Events location pins) has something to plot.
// This is the fallback path for text that wasn't picked from
// CityAutocomplete's dropdown (see that component); a picked suggestion
// already carries its own coordinates and skips this lookup entirely. Uses
// Mapbox's Geocoding API — far more accurate for real-world place names and
// addresses than the free OpenStreetMap/Nominatim lookup this used to run
// on, and its free tier (100k requests/month) comfortably covers this
// site's traffic before any billing kicks in.
//
// Needs a Mapbox access token: sign up free at mapbox.com/signup, copy the
// default public token from your Account page, and set it as
// VITE_MAPBOX_TOKEN — see .env.example. Without a token, geocodeCity just
// returns null (no pin), same as a failed lookup.
//
// We only ever call this once per person/listing, right when they save a
// new city/country (not on every page view), which keeps us well within
// Mapbox's free tier even as the alumni base grows.
//
// Results are cached in localStorage so re-saving the same city (by anyone
// on this device) doesn't hit the network again.

const CACHE_KEY = 'sacs_geocode_cache_v2' // v2: bumped since Mapbox results can differ slightly from the old Nominatim ones
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}
  } catch {
    return {}
  }
}

function saveCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // storage full or unavailable — fine, caching is just an optimization
  }
}

/**
 * @param {string} city
 * @param {string} country
 * @returns {Promise<{ lat: number, lng: number } | null>} null if it can't
 *   find a match, no token is configured, or the lookup fails — callers
 *   should treat that as "no pin for this person" rather than an error
 *   worth surfacing.
 */
export async function geocodeCity(city, country) {
  const cleanCity = (city || '').trim()
  const cleanCountry = (country || '').trim()
  if (!cleanCity) return null

  if (!MAPBOX_TOKEN) {
    console.warn('VITE_MAPBOX_TOKEN is not set — location pins will not be placed. See .env.example.')
    return null
  }

  const key = `${cleanCity.toLowerCase()}|${cleanCountry.toLowerCase()}`
  const cache = loadCache()
  if (key in cache) return cache[key]

  const query = [cleanCity, cleanCountry].filter(Boolean).join(', ')
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&limit=1` +
    `&types=address,poi,neighborhood,place,locality,region,country`

  let result = null
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (res.ok) {
      const data = await res.json()
      const feature = data?.features?.[0]
      if (feature?.center) {
        // Mapbox returns [lng, lat] — the opposite order from the {lat,lng}
        // shape every caller in this app expects.
        result = { lat: feature.center[1], lng: feature.center[0] }
      }
    }
  } catch {
    result = null // offline, blocked, or Mapbox is down — just skip the pin
  }

  // Only cache a real hit. Caching a miss (Mapbox down, network error, or a
  // genuinely unmatched place) forever would mean a transient outage
  // permanently blanks that person's pin until someone manually clears
  // localStorage — the next save should get another shot at the network
  // instead of silently reusing today's failure forever.
  if (result) {
    cache[key] = result
    saveCache(cache)
  }
  return result
}
