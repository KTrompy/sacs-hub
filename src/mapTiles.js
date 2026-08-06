// Shared Leaflet tile config for every map on the site (Alumni Map, Business
// Directory, Business/Job detail pages, Events). Centralized here so there's
// one place to swap providers instead of five.
//
// Uses Mapbox Streets tiles (much crisper/more current-looking than plain
// OpenStreetMap raster tiles) once VITE_MAPBOX_TOKEN is set — see
// .env.example for how to get a free token. Falls back to the old plain OSM
// tile server if no token is configured yet, so the app doesn't break in
// the meantime.
//
// Mapbox raster tiles are served at 512px (vs. OSM's 256px), which is why
// TILE_SIZE/ZOOM_OFFSET need to be passed to <TileLayer> alongside the URL —
// without them the tiles render at the wrong zoom level.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export const TILE_URL = MAPBOX_TOKEN
  ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`
  : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

export const TILE_ATTRIBUTION = MAPBOX_TOKEN
  ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Spread these onto <TileLayer> alongside url/attribution — only matters
// for Mapbox tiles, but harmless to always pass.
export const TILE_SIZE = MAPBOX_TOKEN ? 512 : 256
export const ZOOM_OFFSET = MAPBOX_TOKEN ? -1 : 0
