// Approximate location (city/region/country) detected automatically from the
// visitor's IP address — no browser permission prompt, unlike
// navigator.geolocation (which this site actually has disabled via the
// Permissions-Policy header in vercel.json, since IP-level accuracy is all
// address search needs here). Used to bias CityAutocomplete's Mapbox
// suggestions toward wherever the person actually is, the same way sites
// that "already know" your country resolve an address to the local match
// first instead of one on the other side of the world.
//
// Two free, no-key IP geolocation APIs, tried in order — either can have an
// off day or get rate-limited on a shared network (office wifi, campus
// network), so a single provider isn't reliable enough on its own.
//
// Cached for a day per browser — the result almost never changes within a
// session, and it keeps every one of these lookups well within each
// provider's free daily quota even as traffic grows.

const CACHE_KEY = 'sacs_ip_location_v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY))
    if (raw && Date.now() - raw.at < CACHE_TTL_MS) return raw.value
  } catch {
    // ignore — treat as a cache miss
  }
  return undefined
}

function writeCache(value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ value, at: Date.now() }))
  } catch {
    // storage full or unavailable — fine, caching is just an optimization
  }
}

async function fetchIpapi() {
  const res = await fetch('https://ipapi.co/json/')
  if (!res.ok) throw new Error('ipapi.co failed')
  const d = await res.json()
  if (d.error || !d.latitude) throw new Error('ipapi.co returned no location')
  return {
    lat: d.latitude,
    lng: d.longitude,
    city: d.city || null,
    region: d.region || null,
    countryCode: d.country_code || null,
    countryName: d.country_name || null,
  }
}

async function fetchIpwhois() {
  const res = await fetch('https://ipwho.is/')
  if (!res.ok) throw new Error('ipwho.is failed')
  const d = await res.json()
  if (!d.success || !d.latitude) throw new Error('ipwho.is returned no location')
  return {
    lat: d.latitude,
    lng: d.longitude,
    city: d.city || null,
    region: d.region || null,
    countryCode: d.country_code || null,
    countryName: d.country || null,
  }
}

let inFlight = null

/**
 * @returns {Promise<{lat:number,lng:number,city:string|null,region:string|null,countryCode:string|null,countryName:string|null}|null>}
 *   Resolves to null if both providers fail (offline, blocked, both
 *   rate-limited) — callers should just skip the location bias in that
 *   case, same as a failed Mapbox lookup elsewhere in the app. Safe to call
 *   from multiple components at once — the underlying network request only
 *   ever happens once per cache window.
 */
export function getApproxLocation() {
  const cached = readCache()
  if (cached !== undefined) return Promise.resolve(cached)
  if (inFlight) return inFlight

  inFlight = (async () => {
    let result = null
    try {
      result = await fetchIpapi()
    } catch {
      try {
        result = await fetchIpwhois()
      } catch {
        result = null
      }
    }
    writeCache(result)
    inFlight = null
    return result
  })()
  return inFlight
}
