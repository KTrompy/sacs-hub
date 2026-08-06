import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useIsWide } from '../utils.js'
import { Avatar } from './Directory.jsx'
// Imported from their own modules, not from Feed.jsx / BusinessDirectory.jsx.
// Home is eagerly loaded (it's the default route), so a named import from
// either of those pulled the whole ~40-60 kB module into the initial bundle
// and cancelled out the lazy route split in App.jsx — Vite warns about
// exactly this at build time.
import { WhosOnline } from './WhosOnline.jsx'
import { BusinessLogo } from './BusinessLogo.jsx'
import LegendsBand from './Legends.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import LoadingState from './LoadingState.jsx'
import EmptyState from './EmptyState.jsx'
import CompleteProfilePrompt from './CompleteProfilePrompt.jsx'

// Fields checked for the profile-completion bar — the ones that actually
// make a profile useful to other Old Boys (who you are, what you do,
// where you are, how to reach you), not every column on the table.
const COMPLETION_FIELDS = [
  'avatar_url', 'bio', 'occupation', 'company', 'city', 'country',
  'grad_year', 'degree', 'industry', 'linkedin_url',
]

// The mobile-only pill row above the two-column layout — same sections
// that sit side-by-side on desktop. On mobile every section still renders
// (nothing is hidden), the pills just act as a jump nav: tap one and the
// page smooth-scrolls to that section, same idea as an in-page anchor
// link. See .home-mobile-tabs in styles.css for the sticky/peek styling
// and .home-tabsection's scroll-margin-top for the landing offset.
const MOBILE_TABS = [
  { id: 'posts', label: 'Recent feed posts' },
  { id: 'community', label: 'My Community' },
  { id: 'businesses', label: 'Businesses near me' },
  { id: 'events', label: 'Upcoming events' },
]

function isFieldFilled(profile, f) {
  const v = profile?.[f]
  return v !== null && v !== undefined && String(v).trim() !== ''
}

function completionPercent(profile) {
  if (!profile) return 0
  const filled = COMPLETION_FIELDS.filter((f) => isFieldFilled(profile, f)).length
  return Math.round((filled / COMPLETION_FIELDS.length) * 100)
}

function missingCompletionFields(profile) {
  if (!profile) return []
  return COMPLETION_FIELDS.filter((f) => !isFieldFilled(profile, f))
}

// Once-a-day key for the modal nudge below — scoped per user so one
// person dismissing it doesn't affect another on a shared device, and
// dated (not just a boolean) so it reappears the next calendar day rather
// than being silenced for good after the first "Not now".
function nudgeStorageKey(userId) {
  return `profile-nudge-seen:${userId}`
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// Parsed via DOMParser into a detached document rather than assigned to a
// live element's innerHTML — a detached document never loads its
// resources, so an untrusted payload like <img src=x onerror=alert(1)>
// can't fire its handler while we're just extracting text.
function plainText(html) {
  return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''
}

function truncate(text, max = 140) {
  const t = text.trim()
  return t.length > max ? t.slice(0, max).trim() + '…' : t
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function formatEventDate(iso) {
  const d = new Date(iso)
  return {
    month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    day: d.getDate(),
    full: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  }
}

export default function Home({ session, profile, onMessage }) {
  // Greeting banner's avatar/ring shrink on mobile only (see home-banner
  // CSS) — this is set via JS rather than CSS alone because ProgressRing's
  // SVG dimensions come from a `size` prop, not a stylesheet value.
  const isWide = useIsWide(721)
  const [recentPosts, setRecentPosts] = useState([])
  const [upcomingEvent, setUpcomingEvent] = useState(null)
  // `badges` itself stays: Home's load() uses a non-empty badges result as
  // the auth-settled canary (see the comment at its retry check below). Only
  // the badge *display* (chip + modal + earned-status tracking) is gone.
  const [badges, setBadges] = useState([])
  const [community, setCommunity] = useState([])
  const [nearbyBusinesses, setNearbyBusinesses] = useState([])
  const [loading, setLoading] = useState(true)
  // The widget batch below never looked at `error` on any of its results, so
  // a failed query (RLS hiccup, dropped connection) was indistinguishable
  // from "there's genuinely nothing here" — every widget just rendered its
  // empty state, permanently, with no way to retry. Same failure class as the
  // auth-not-settled race further down, but triggered by real errors rather
  // than timing, and the one-shot retry for that race gives up for good.
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const navigate = useNavigate()
  const pct = completionPercent(profile)
  const firstName = (profile?.full_name || '').trim().split(' ')[0] || 'there'
  const [showNudge, setShowNudge] = useState(false)

  // The Home banner's "Complete your profile" pill is easy to scan past on
  // the way to the feed, so anyone still below 100% also gets it surfaced
  // as a modal — but only once per calendar day, so it nags rather than
  // blocks. Keyed by user id + today's date in localStorage; dismissing
  // ("Not now", Escape, or the backdrop) all just close the modal, since
  // the storage write already happened when it was shown.
  useEffect(() => {
    if (loading || loadError || pct >= 100) return
    const key = nudgeStorageKey(session.user.id)
    const today = new Date().toISOString().slice(0, 10)
    let lastSeen = null
    try { lastSeen = localStorage.getItem(key) } catch { /* ignore */ }
    if (lastSeen === today) return
    setShowNudge(true)
    try { localStorage.setItem(key, today) } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadError, pct, session.user.id])

  // Mobile pill row jumps to the matching section instead of switching
  // tabs — every section always renders (desktop and mobile alike), so
  // this just needs to scroll it into view. scroll-margin-top on
  // .home-tabsection (styles.css) keeps the landing spot clear of the
  // sticky masthead + sticky pill row; html { scroll-behavior: smooth }
  // (also styles.css) gives it the glide.
  function jumpToSection(id) {
    document.getElementById(`home-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // "My Community" is a horizontally-scrolling strip (2 full cards + a peek
  // of the next) rather than a static grid, so people know there's more to
  // browse without a page nav. communityDragRef tracks a mouse drag so we
  // can scroll the strip by hand-dragging (touch already scrolls natively);
  // `moved` distinguishes a drag from a plain click so dragging off a card
  // doesn't also fire its navigate/message action.
  const communityScrollRef = useRef(null)
  const communityDragRef = useRef({ down: false, startX: 0, startScroll: 0, moved: false })
  // Drives which arrow(s) show: back only once scrolled off the start,
  // forward only while there's more strip left to reveal.
  const [communityScrollState, setCommunityScrollState] = useState({ canBack: false, canForward: false })

  const updateCommunityScrollState = () => {
    const el = communityScrollRef.current
    if (!el) return
    setCommunityScrollState({
      canBack: el.scrollLeft > 4,
      canForward: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }

  // useLayoutEffect (not useEffect) — this measures the scroll strip's
  // actual DOM width to decide whether the forward arrow should show.
  // useEffect runs after paint, so the first frame would render with both
  // arrows hidden and only "correct itself" on the next tick — in
  // practice invisible until *something* (e.g. the user dragging, which
  // fires onScroll) forced a recompute. useLayoutEffect runs synchronously
  // before paint, so the arrow is right from the very first frame.
  useLayoutEffect(() => {
    updateCommunityScrollState()
    window.addEventListener('resize', updateCommunityScrollState)
    return () => window.removeEventListener('resize', updateCommunityScrollState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community])

  const scrollCommunity = (dir) => {
    const el = communityScrollRef.current
    if (!el) return
    const card = el.querySelector('.home-community-card')
    const step = card ? card.getBoundingClientRect().width + 10 : 112
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }
  const handleCommunityPointerDown = (e) => {
    if (e.pointerType !== 'mouse') return
    const el = communityScrollRef.current
    if (!el) return
    // Note: pointer capture is NOT grabbed here. Capturing on every
    // mousedown (including a plain click) redirects the click event's
    // target to this container instead of the card/button underneath,
    // which silently ate every click on a profile or Message button.
    // Capture is only grabbed in handleCommunityPointerMove once an
    // actual drag is confirmed, so plain clicks pass through untouched.
    communityDragRef.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false, pointerId: e.pointerId }
  }
  const handleCommunityPointerMove = (e) => {
    const drag = communityDragRef.current
    if (!drag.down) return
    const el = communityScrollRef.current
    if (!el) return
    const dx = e.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) > 4) {
      drag.moved = true
      try { el.setPointerCapture(drag.pointerId) } catch { /* no-op if already released */ }
    }
    if (drag.moved) el.scrollLeft = drag.startScroll - dx
  }
  const endCommunityDrag = () => { communityDragRef.current.down = false }

  // Mobile-only "Recent feed posts" carousel: one post per screen,
  // swipe/scroll horizontally between them, with dot indicators below
  // showing which post you're on. Desktop keeps the plain stacked list
  // (see .home-post-preview-list base rule vs. its max-width:720px
  // override in styles.css) — postsScrollRef/postIndex only matter once
  // that override turns the list into a horizontal scroll-snap strip.
  const postsScrollRef = useRef(null)
  const [postIndex, setPostIndex] = useState(0)
  const updatePostIndex = () => {
    const el = postsScrollRef.current
    if (!el || el.clientWidth === 0) return
    setPostIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  const scrollToPost = (idx) => {
    const el = postsScrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' })
  }

  // Same mobile-only carousel treatment for "Businesses near me" — see
  // postsScrollRef above for the shared reasoning.
  const businessesScrollRef = useRef(null)
  const [businessIndex, setBusinessIndex] = useState(0)
  const updateBusinessIndex = () => {
    const el = businessesScrollRef.current
    if (!el || el.clientWidth === 0) return
    setBusinessIndex(Math.round(el.scrollLeft / el.clientWidth))
  }
  const scrollToBusiness = (idx) => {
    const el = businessesScrollRef.current
    if (!el) return
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' })
  }
  const handleCommunityCardClick = (e, action) => {
    if (communityDragRef.current.moved) {
      e.preventDefault()
      communityDragRef.current.moved = false
      return
    }
    action()
  }

  useEffect(() => {
    let cancelled = false

    async function load(isRetry = false) {
      setLoading(true)

      // Confirm the client's session/auth state is fully settled before
      // firing this whole batch of RLS-protected queries. Firing them the
      // instant this component mounts can race a session that's still
      // being restored right after a fresh page load: the queries don't
      // error in that case, the `to authenticated` RLS policies on
      // profiles/posts/businesses/etc. just silently match nothing, so
      // every widget below renders its empty state even though the data is
      // there. A manual refresh only "fixes" it by giving the client more
      // time to settle before the same queries fire again — this await
      // (plus the retry-once fallback below) closes that window instead.
      await supabase.auth.getSession()
      if (cancelled) return
      const uid = session.user.id

      // PostgREST .or() parses commas/parens as its own grammar, and
      // double-quotes any value that could otherwise ambiguously be read as
      // one of its operators. Wrapping in double quotes and escaping any
      // embedded quote handles industries/cities/etc. that happen to
      // contain those characters (e.g. "Food, Beverage & Hospitality") —
      // without this, the whole query 400s or matches nothing.
      const forOr = (v) => `"${String(v).replace(/"/g, '\\"')}"`

      // Suggested connections for "My Community — Strengthen Your Network":
      // pulls a candidate pool of anyone matching on industry, grad year, or
      // city, then scores + sorts them client-side (industry weighted above
      // grad year, above city — see communityWeight below) so a triple match
      // outranks a single one instead of coming back in arbitrary DB order.
      // Falls back to recently-joined members if the profile doesn't have
      // enough filled in to match on, so the widget is never empty for a
      // sparse profile.
      const communityFilters = []
      if (profile?.industry) communityFilters.push(`industry.eq.${forOr(profile.industry)}`)
      if (profile?.grad_year) communityFilters.push(`grad_year.eq.${profile.grad_year}`)
      if (profile?.city) communityFilters.push(`city.eq.${forOr(profile.city)}`)

      // "Businesses near me": listings sharing the viewer's city or country,
      // same "match first, fall back to most recent" shape as the community
      // widget above so this is never empty just because the viewer's own
      // location fields are blank.
      const businessFilters = []
      if (profile?.city) businessFilters.push(`city.eq.${forOr(profile.city)}`)
      if (profile?.country) businessFilters.push(`country.eq.${forOr(profile.country)}`)

      const results = await Promise.all([
        supabase
          .from('posts')
          // `occupation` is rendered under the author's name in the preview
          // card below — it was missing from this select, so that line could
          // never display anything no matter whose post it was.
          .select('id, title, content, image_urls, pinned, created_at, profiles!posts_author_id_fkey ( full_name, avatar_url, occupation )')
          .order('created_at', { ascending: false })
          .limit(3),
        supabase
          .from('events')
          .select('id, title, event_date, location')
          .gte('event_date', new Date().toISOString())
          .order('event_date', { ascending: true })
          .limit(1),
        // Not shown anywhere anymore (badge display was removed from the
        // home banner), but the query itself stays: `load()`'s retry check
        // below uses a non-empty result here as its auth-settled canary.
        supabase.from('badges').select('id, key, name, description').order('sort_order', { ascending: true }),
        // Pull a wider candidate pool than we'll actually show (24, not 6) —
        // the weighting below needs enough rows to sort through, otherwise
        // "top 6" is really just "first 6 the DB happened to return".
        communityFilters.length
          ? supabase
              .from('profiles')
              .select('id, full_name, avatar_url, occupation, company, industry, grad_year, city, created_at')
              .eq('approved', true)
              .neq('id', uid)
              .or(communityFilters.join(','))
              .limit(24)
          : Promise.resolve({ data: [] }),
        businessFilters.length
          ? supabase
              .from('businesses')
              .select('id, name, logo_url, description, city, country')
              .or(businessFilters.join(','))
              .order('promoted', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(6)
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return

      const [
        { data: posts },
        { data: events },
        { data: badgeDefs },
        { data: matchedCommunity },
        { data: matchedBusinesses },
      ] = results

      // One retry for a transient blip, then say so rather than rendering a
      // page of convincingly empty widgets.
      if (results.some((r) => r.error)) {
        if (!isRetry) {
          await new Promise((r) => setTimeout(r, 600))
          if (!cancelled) await load(true)
          return
        }
        setLoadError(true)
        setLoading(false)
        return
      }

      // Industry match outweighs city, which outweighs grad year.
      // Ties fall back to newest-joined first.
      const communityWeight = (m) => {
        let score = 0
        if (profile?.industry && m.industry === profile.industry) score += 4
        if (profile?.city && m.city === profile.city) score += 2
        if (profile?.grad_year && m.grad_year === profile.grad_year) score += 1
        return score
      }

      let communityList = matchedCommunity || []
      if (communityList.length > 0) {
        communityList = [...communityList]
          .sort((a, b) => {
            const diff = communityWeight(b) - communityWeight(a)
            if (diff !== 0) return diff
            return new Date(b.created_at) - new Date(a.created_at)
          })
          .slice(0, 6)
      }
      // Always fill the widget to 6 — if the match/fallback above didn't
      // produce enough people, top up with the most recently joined
      // approved profiles that aren't already in the list, so the widget
      // never looks sparse just because few people match the viewer.
      if (communityList.length < 6) {
        const excludeIds = [uid, ...communityList.map((m) => m.id)]
        const { data: fillIn } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, occupation, company, industry')
          .eq('approved', true)
          .not('id', 'in', `(${excludeIds.join(',')})`)
          .order('created_at', { ascending: false })
          .limit(6 - communityList.length)
        communityList = [...communityList, ...(fillIn || [])]
      }

      let businessList = matchedBusinesses || []
      if (businessList.length === 0) {
        const { data: fallback } = await supabase
          .from('businesses')
          .select('id, name, logo_url, description, city, country')
          .order('promoted', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(6)
        businessList = fallback || []
      }
      if (cancelled) return

      // Retry canary for the auth-not-settled race described above.
      //
      // This used to check "community AND businesses both came back empty",
      // which sounds reasonable but is wrong on a young site: with no business
      // listings yet, that condition is true on *every single load*, so every
      // visit to Home paid a 600 ms sleep plus a second full round of seven
      // queries before rendering.
      //
      // `badges` is the better signal. It's a small fixed reference table with
      // no per-user filtering, readable by any approved member — and Home only
      // renders for approved members at all (App.jsx gates on it). So a
      // non-empty badges result means the client's auth header really did make
      // it onto the request; an empty one means nothing did, which is exactly
      // the race. It can't be confused with "this community is genuinely
      // empty" the way the old check could.
      if (!isRetry && (badgeDefs || []).length === 0) {
        await new Promise((r) => setTimeout(r, 600))
        if (!cancelled) await load(true)
        return
      }

      setLoadError(false)
      setRecentPosts(posts || [])
      setUpcomingEvent(events?.[0] || null)
      setBadges(badgeDefs || [])
      setCommunity(communityList)
      setNearbyBusinesses(businessList)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id, reloadKey])

  if (loading) return <section className="panel"><LoadingState message="Loading your home…" /></section>

  if (loadError) {
    return (
      <section className="panel">
        <EmptyState
          icon="feed"
          message="We couldn't load your home page."
          subMessage="Something went wrong fetching your dashboard. Your data is safe — this is just a hiccup loading it."
          actionLabel="Try again"
          onAction={() => setReloadKey((k) => k + 1)}
        />
      </section>
    )
  }

  return (
    <section className="panel">
      {showNudge && (
        <CompleteProfilePrompt
          missing={missingCompletionFields(profile)}
          onDismiss={() => setShowNudge(false)}
        />
      )}
      <div className="home-banner">
        <div className="home-banner-identity">
          <ProgressRing pct={pct} size={isWide ? 48 : 36}>
            <Avatar url={profile?.avatar_url} name={profile?.full_name} size={isWide ? 40 : 30} />
          </ProgressRing>
          <div className="home-banner-body">
            <h2 className="home-banner-title">{greeting()}, {firstName}</h2>
          </div>
        </div>
        <div className="home-banner-cta">
          {pct < 100 ? (
            <button type="button"
              className="btn primary"
              onClick={() => navigate('/profile', { state: { highlightMissing: true, focusFirst: true } })}
            >
              <RefreshIcon /> Complete your profile
            </button>
          ) : (
            <button type="button" className="btn primary" onClick={() => navigate('/feed', { state: { openComposer: true } })}>
              <ShareIcon /> Share something
            </button>
          )}
        </div>
      </div>

      <nav className="home-mobile-tabs" aria-label="Jump to home section">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="home-mobile-tab"
            onClick={() => jumpToSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Sits below the jump-nav pills rather than above them: the pills are
          the fastest route to the things people actually came for, and the
          legends band is editorial. It renders nothing at all until an admin
          has curated at least one entry (see LegendsBand), so this costs a
          fresh install no vertical space. */}
      <LegendsBand />

      <div className="feed-layout home-feed-layout">
        <div className="feed-main">
          <div className="home-tabsection" id="home-section-posts">
            <div className="feed-widget home-feed-widget">
              <div className="home-section-head">
                <h3 className="feed-section-label">Recent feed posts</h3>
                <button type="button" className="feed-widget-viewall home-more-link" onClick={() => navigate('/feed')}>More posts</button>
              </div>

              {recentPosts.length === 0 ? (
                <p className="empty small">No posts yet — be the first to share something.</p>
              ) : (
                <ul className="home-post-preview-list" ref={postsScrollRef} onScroll={updatePostIndex}>
                  {recentPosts.map((p) => {
                    const text = p.content && p.content !== '(no text)' ? truncate(plainText(p.content)) : ''
                    const thumb = p.image_urls?.[0] || null
                    return (
                      <li key={p.id} className="home-post-preview">
                        {/* Stretched link rather than a clickable <li> — see
                            the note on the same pattern in Directory.jsx.
                            This one also previously ignored Space, so it was
                            only half-operable by keyboard. */}
                        <Link className="stretched-link" to={`/feed/${p.id}`}>
                          <span className="sr-only">
                            {`Open post by ${p.profiles?.full_name || 'an alumnus'}`}
                          </span>
                        </Link>
                        <Avatar url={p.profiles?.avatar_url} name={p.profiles?.full_name} size={54} />
                        <div className="home-post-preview-body">
                          <div className="home-post-preview-header">
                            <div>
                              <span className="home-post-preview-head">
                                {p.pinned && <PinIcon />}
                                <strong>{p.profiles?.full_name || 'Alumnus'}</strong>
                              </span>
                              {p.profiles?.occupation && <p className="home-post-preview-occupation">{p.profiles.occupation}</p>}
                            </div>
                          </div>
                          {/* Post title gets its own bold line, separate from
                              the author's occupation above and the plain
                              content excerpt below — otherwise it read as
                              just more description text with nothing marking
                              it as the post's actual title. */}
                          {p.title && <p className="home-post-preview-title">{p.title}</p>}
                          {text && <p className="home-post-preview-text">{text}</p>}
                        </div>
                        {thumb && (
                          <div className="home-post-preview-thumb">
                            <img src={thumb} alt="" />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {recentPosts.length > 1 && (
                <div className="home-carousel-dots" role="tablist" aria-label="Recent posts">
                  {recentPosts.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      className={i === postIndex ? 'home-carousel-dot active' : 'home-carousel-dot'}
                      role="tab"
                      aria-selected={i === postIndex}
                      aria-label={`Post ${i + 1} of ${recentPosts.length}`}
                      onClick={() => scrollToPost(i)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="home-tabsection" id="home-section-businesses">
            <div className="feed-widget home-feed-widget">
              <div className="home-section-head">
                <h3 className="feed-section-label">Businesses near me</h3>
              </div>

              {nearbyBusinesses.length === 0 ? (
                <p className="empty small">No businesses listed yet.</p>
              ) : (
                <div className="home-business-grid" ref={businessesScrollRef} onScroll={updateBusinessIndex}>
                  {nearbyBusinesses.map((b) => (
                    <div key={b.id} className="home-business-card">
                      <Link className="stretched-link" to={`/businesses/${b.id}`}>
                        <span className="sr-only">{`Open ${b.name}`}</span>
                      </Link>
                      <div className="home-business-card-head">
                        <BusinessLogo url={b.logo_url} name={b.name} />
                        <strong>{b.name}</strong>
                      </div>
                      <p className="home-business-excerpt">{truncate(plainText(b.description), 90)}</p>
                      <p className="home-business-location">
                        <LocationDotIcon /> {[b.city, b.country].filter(Boolean).join(', ') || 'Location not set'}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {nearbyBusinesses.length > 1 && (
                <div className="home-carousel-dots" role="tablist" aria-label="Businesses near me">
                  {nearbyBusinesses.map((b, i) => (
                    <button
                      key={b.id}
                      type="button"
                      className={i === businessIndex ? 'home-carousel-dot active' : 'home-carousel-dot'}
                      role="tab"
                      aria-selected={i === businessIndex}
                      aria-label={`Business ${i + 1} of ${nearbyBusinesses.length}`}
                      onClick={() => scrollToBusiness(i)}
                    />
                  ))}
                </div>
              )}

              <button type="button" className="feed-widget-viewall home-more-link home-business-viewall" onClick={() => navigate('/businesses')}>More businesses</button>
            </div>
          </div>
        </div>

        <aside className="feed-sidebar">
          <div className="home-tabsection" id="home-section-community">
            <div className="feed-widget home-community-widget">
              <div className="home-section-head" style={{ marginBottom: 4 }}>
                <h3 className="feed-section-label" style={{ margin: 0 }}>My Community</h3>
                <button type="button" className="feed-widget-viewall home-more-link" onClick={() => navigate('/directory')}>All members</button>
              </div>
              <p className="home-community-sub">Strengthen Your Network</p>
              {community.length === 0 ? (
                <p className="empty small">No suggestions yet.</p>
              ) : (
                <div className="home-community-carousel">
                  <div
                    className="home-community-grid"
                    ref={communityScrollRef}
                    onScroll={updateCommunityScrollState}
                    onPointerDown={handleCommunityPointerDown}
                    onPointerMove={handleCommunityPointerMove}
                    onPointerUp={endCommunityDrag}
                    onPointerLeave={endCommunityDrag}
                  >
                    {community.map((m) => (
                      <div
                        key={m.id}
                        className="home-community-card"
                        title={[m.occupation, m.company].filter(Boolean).join(' @ ')}
                      >
                        {/* Stretched link, so these open in a tab like any
                            other result card. handleCommunityCardClick still
                            runs on it — it calls preventDefault() when the
                            pointer was dragging the carousel, which suppresses
                            an accidental navigation exactly as it used to
                            suppress an accidental click. */}
                        <Link
                          className="stretched-link"
                          to={`/people/${m.id}`}
                          onClick={(e) => handleCommunityCardClick(e, () => {})}
                        >
                          <span className="sr-only">{`Open profile for ${m.full_name || 'alumnus'}`}</span>
                        </Link>
                        <div className="home-community-card-identity">
                          <Avatar url={m.avatar_url} name={m.full_name} size={54} />
                          <span>{(m.full_name || 'Alumnus').split(' ')[0]}</span>
                        </div>
                        {m.industry && (
                          <p className="home-community-industry">{m.industry}</p>
                        )}
                        <button
                          type="button"
                          className="home-community-message-btn"
                          onClick={(e) => handleCommunityCardClick(e, () => onMessage?.(m, buildIcebreaker(profile, m)))}
                        >
                          Message
                        </button>
                      </div>
                    ))}
                  </div>
                  {communityScrollState.canBack && (
                    <button
                      type="button"
                      className="home-community-scroll-btn home-community-scroll-btn-prev"
                      onClick={() => scrollCommunity(-1)}
                      aria-label="Show previous suggested connections"
                    >
                      <ChevronLeftIcon />
                    </button>
                  )}
                  {communityScrollState.canForward && (
                    <button
                      type="button"
                      className="home-community-scroll-btn home-community-scroll-btn-next"
                      onClick={() => scrollCommunity(1)}
                      aria-label="Show more suggested connections"
                    >
                      <ChevronRightIcon />
                    </button>
                  )}
                </div>
              )}

              <div className="home-community-online">
                <WhosOnline session={session} onOpenProfile={(id) => navigate(`/people/${id}`)} />
              </div>
            </div>
          </div>

          <div className="home-tabsection" id="home-section-events">
            {upcomingEvent && (
              <div className="feed-widget home-event-widget">
                {/* Was focusable but had no key handler at all, so keyboard
                    users could land on it and never open it. A link fixes
                    both that and the missing open-in-new-tab. */}
                <Link className="stretched-link" to={`/events/${upcomingEvent.id}`}>
                  <span className="sr-only">{`Open event: ${upcomingEvent.title}`}</span>
                </Link>
                <div className="home-event-date">
                  <span>{formatEventDate(upcomingEvent.event_date).month}</span>
                  <strong>{formatEventDate(upcomingEvent.event_date).day}</strong>
                </div>
                <div className="feed-widget-row-text">
                  <span className="feed-section-label" style={{ margin: 0 }}>Upcoming Event</span>
                  <strong>{upcomingEvent.title}</strong>
                  <span>{formatEventDate(upcomingEvent.event_date).full}{upcomingEvent.location ? ` · ${upcomingEvent.location}` : ''}</span>
                </div>
              </div>
            )}
          </div>

          <div className="feed-widget home-donate-card">
            <h3>Support the house</h3>
            <p>Every gift, big or small, helps keep the house standing for the Old Boys who come after us. Give to whichever cause resonates with you most.</p>
            <button type="button" className="btn primary wide" onClick={() => navigate('/donate')}>Give now</button>
          </div>
        </aside>
      </div>
    </section>
  )
}

// Circular completion ring drawn around the avatar (SVG stroke-dasharray),
// in SACS' own orange/maroon rather than the reference screenshot's
// green — Kyle chose to keep brand colors here, matching everything else
// (ring shape/position, pill, layout) exactly.
function ProgressRing({ pct, size = 64, strokeWidth = 3, children }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(100, Math.max(0, pct)) / 100)
  const center = size / 2
  return (
    <div className="home-progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--line-strong)" strokeWidth={strokeWidth} />
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke="var(--orange)" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="home-progress-ring-inner">{children}</div>
    </div>
  )
}
function RefreshIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--cta-icon-color, var(--orange-dark))' }}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}
function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--cta-icon-color, var(--orange-dark))' }}>
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--orange)' }}>
      <path d="M12 2l1.5 5.5L19 9l-4 3.5L16 18l-4-3-4 3 1-5.5-4-3.5 5.5-1.5z" />
    </svg>
  )
}
function LocationDotIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--maroon)', flexShrink: 0 }}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}
function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-soft)', flexShrink: 0 }}>
      <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
