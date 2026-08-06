import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// SACS legends — the photo mosaic on Home, plus the standalone "Hoek van
// Helde" section it opens onto (LegendsHall.jsx for the full list,
// LegendProfile.jsx for one person's page).
//
// Admin-curated (see the `legends` table in schema-update-54.sql), not derived
// from member profiles: the people here are mostly long gone and were never on
// the hub, so there's no account to hang any of it off.
//
// The whole design leans on the photography — full-bleed portrait, dark scrim,
// white type over it — which is why a photo is required by the Admin form. A
// tile with no image would be a hole in the grid, not a smaller tile.

// Labels and pill colours live here rather than in the database so the palette
// can't drift; the DB only stores the key, and legends_category_check keeps it
// to this list. `class` maps to a .legend-pill-* rule in styles.css.
export const LEGEND_CATEGORIES = [
  { key: 'sport', label: 'Sport' },
  { key: 'business', label: 'Business' },
  { key: 'politics', label: 'Politics' },
  { key: 'arts', label: 'Arts' },
  { key: 'academia', label: 'Academia' },
  { key: 'military', label: 'Military' },
  { key: 'medicine', label: 'Medicine' },
  { key: 'media', label: 'Media' },
  { key: 'service', label: 'Public service' },
  { key: 'other', label: 'SACS' },
]

export const CATEGORY_LABEL = Object.fromEntries(LEGEND_CATEGORIES.map((c) => [c.key, c.label]))

// Fields both the Home band and the Hall/Profile pages need. Shared so a
// column added to one never quietly goes missing from the other.
export const LEGEND_FIELDS = 'id, name, years, degree, category, headline, story, photo_url, link_url, link_label'

// How many tiles the desktop mosaic shows at once: one hero plus two stacked
// beside it. The mobile carousel isn't bound by this — it pages through
// everyone (see LegendsBand below).
const TILE_COUNT = 3

// How many dots the mobile carousel's page indicator shows at once. With a
// few dozen legends curated, one dot per person would print a solid bar of
// tick marks — this caps it to a small moving window centred on whichever
// slide is active instead (same idea as Instagram/YouTube Shorts' page
// dots), see dotWindow below.
const DOT_WINDOW = 5

// Fisher–Yates — every load of Home (and of the Hall page) gets its own
// fresh order rather than always the same curated sort_order sequence, so
// the spotlight/list doesn't always lead with the same few people.
export function shuffled(list) {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// The slice of `[0, total)` the dot row should render, given which slide is
// active. Centers the window on `active` and clamps it to the list's ends,
// so the window only ever shrinks against an edge rather than sliding off it.
function dotWindow(total, active, size) {
  if (total <= size) return { start: 0, end: total - 1 }
  const start = Math.max(0, Math.min(active - Math.floor(size / 2), total - size))
  return { start, end: start + size - 1 }
}

export function legendMeta(l) {
  return [l.years, l.degree].filter(Boolean).join(' · ')
}

export default function LegendsBand() {
  const [legends, setLegends] = useState([])
  const [loading, setLoading] = useState(true)

  // Mobile-only "one person at a time" carousel — same scroll-snap-strip
  // pattern as Home's Recent posts / Businesses near me carousels (see
  // postsScrollRef/postIndex in Home.jsx), but paging through every curated
  // legend rather than just the mosaic's three — there's no mosaic-shaped
  // space constraint on a single-column phone layout, so there's no reason
  // to hold most of them back. Desktop never renders this; it keeps the
  // hero+stack mosaic below instead (see .legends-carousel's display:none
  // base rule in styles.css).
  const carouselRef = useRef(null)
  const [slideIndex, setSlideIndex] = useState(0)
  const updateSlideIndex = () => {
    const el = carouselRef.current
    if (!el || el.clientWidth === 0) return
    setSlideIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  const scrollToSlide = (idx) => {
    const el = carouselRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' })
  }
  useLayoutEffect(() => { setSlideIndex(0) }, [legends])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('legends')
        .select(LEGEND_FIELDS)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (cancelled) return
      // No error state and no empty state on purpose — if this fails or there's
      // nothing curated yet, the band renders nothing at all rather than a
      // "no legends yet" box. It's an editorial extra on someone else's home
      // page; an empty frame for it would be worse than its absence.
      if (!error) setLegends(data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Reshuffled once per fetch — i.e. once per visit to Home — rather than on
  // every render, so scrolling the carousel doesn't reorder it under your
  // thumb. The desktop mosaic takes its hero+stack from the front of this
  // same order instead of a separate pick, so a person up in the mosaic is
  // also wherever this order put them in the mobile carousel/Hall list.
  const order = useMemo(() => shuffled(legends), [legends])

  if (loading || order.length === 0) return null

  const [hero, ...rest] = order.slice(0, TILE_COUNT)
  const dots = dotWindow(order.length, slideIndex, DOT_WINDOW)

  return (
    <section className="legends-band" aria-labelledby="legends-heading">
      <div className="legends-head">
        <div className="legends-head-text">
          <h3 className="legends-title" id="legends-heading">Notable Old Boys</h3>
        </div>
        {/* Opens the full Hoek van Helde page rather than cycling to another
            three in place — everyone curated lives there, not just the next
            batch this widget happens to rotate to. */}
        {legends.length > TILE_COUNT && (
          <Link className="legends-more" to="/legends">
            See others <ArrowRightIcon />
          </Link>
        )}
      </div>

      {/* Desktop/tablet: hero + stacked mosaic. Hidden on mobile in favour
          of the carousel below (see the max-width:760px rule). */}
      <div className={rest.length > 0 ? 'legends-grid' : 'legends-grid legends-grid-single'}>
        <LegendTile legend={hero} hero />
        {/* legends-stack-one: with exactly two legends curated there's only one
            tile to stack, and a two-row grid would leave it floating in the top
            half with a hole underneath. */}
        {rest.length > 0 && (
          <div className={rest.length === 1 ? 'legends-stack legends-stack-one' : 'legends-stack'}>
            {rest.map((l) => <LegendTile key={l.id} legend={l} />)}
          </div>
        )}
      </div>

      {/* Mobile: one full-bleed tile per screen, swipe (or tap a dot) to see
          the next — everyone curated, in this visit's shuffled order, same
          photo-with-scrim newspaper look as the mosaic. */}
      <div className="legends-carousel" ref={carouselRef} onScroll={updateSlideIndex}>
        {order.map((l) => (
          <div className="legends-carousel-slide" key={l.id}>
            <LegendTile legend={l} hero />
          </div>
        ))}
      </div>
      {order.length > 1 && (
        <div className="home-carousel-dots legends-carousel-dots" role="tablist" aria-label="Notable Old Boys">
          {order.slice(dots.start, dots.end + 1).map((l, offset) => {
            const i = dots.start + offset
            // The dot at whichever end of the window still has more people
            // past it renders smaller — a quiet "there's more this way" hint
            // instead of a hard cut-off edge.
            const isEdge = (i === dots.start && i > 0) || (i === dots.end && i < order.length - 1)
            return (
              <button
                key={l.id}
                type="button"
                className={
                  'home-carousel-dot' +
                  (i === slideIndex ? ' active' : '') +
                  (isEdge ? ' legends-carousel-dot-edge' : '')
                }
                role="tab"
                aria-selected={i === slideIndex}
                aria-label={`${l.name}, ${i + 1} of ${order.length}`}
                onClick={() => scrollToSlide(i)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

// A single photo tile — used by the Home mosaic/carousel above and by
// LegendsHall's full grid. Always a link to that person's own page
// (/legends/:id) rather than a modal: it's shareable, and it gets a real
// "back" the browser already understands.
export function LegendTile({ legend, hero = false }) {
  const meta = legendMeta(legend)
  return (
    <article className={hero ? 'legend-tile legend-tile-hero' : 'legend-tile'}>
      {/* alt="" — the photo is decorative here in the strict sense: everything
          it conveys (who this is, what they did) is already in the text sitting
          on top of it, which a screen reader will read out anyway. Naming the
          portrait as well would just say the person's name twice. */}
      <img className="legend-tile-photo" src={legend.photo_url} alt="" loading="lazy" />
      <div className="legend-tile-scrim" aria-hidden="true" />
      <span className={`legend-pill legend-pill-${legend.category}`}>
        {CATEGORY_LABEL[legend.category] || 'SACS'}
      </span>
      <div className="legend-tile-body">
        <h4 className="legend-tile-name">{legend.name}</h4>
        <p className="legend-tile-headline">{legend.headline}</p>
        {meta && <p className="legend-tile-meta">{meta}</p>}
      </div>
      <Link className="stretched-link" to={`/legends/${legend.id}`}>
        <span className="sr-only">{`Read about ${legend.name}`}</span>
      </Link>
    </article>
  )
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}
