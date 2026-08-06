import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import EmptyState from './EmptyState.jsx'
import LoadingState from './LoadingState.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { useToast } from './Toast.jsx'
import MentorshipRequestModal, { friendlyError } from './MentorshipRequestModal.jsx'
import MentorshipWorkspace from './MentorshipWorkspace.jsx'
import { buildIcebreaker } from '../icebreaker.js'
import { normalizeExpertise, safeUrl } from '../utils.js'
import { scoreMentor, scoreMentee, mentorHeadroom, byScore, TIER_LABEL } from '../mentorMatch.js'

// Mentoring, rebuilt.
//
// Two paths on purpose, because they suit different moments and the old page
// only had half of one:
//
//   Flash mentoring — message anyone who is open to it, one question, no
//   commitment, no row in any table. Still the default action on every card,
//   because most useful mentoring is a twenty-minute conversation and making
//   people sign up for six months first kills it.
//
//   A structured mentorship — request, accept, goals, session log, an agreed
//   ending. Opt-in, on top, for the pairings that warrant it.
//
// The other change is that mentees now exist as a thing you can find. Before,
// a willing mentor had nowhere to look and nothing to do but wait.

const PERSON_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'is_current_resident, linkedin_url, bio, expertise, services_offered, business_website, ' +
  'availability, geographic_focus, is_open_to_opportunities, ' +
  'seeking_mentor, mentee_goals, mentee_note, mentor_capacity, mentor_paused'

const MENTORSHIP_FIELDS =
  'id, mentor_id, mentee_id, initiated_by, status, request_message, response_message, ' +
  'focus, cadence, duration_months, closing_note, requested_at, started_at, ended_at, ended_by'

export default function Mentoring({ session, profile, onProfileChange, onMessage }) {
  const [params, setParams] = useSearchParams()
  const showToast = useToast()
  const myId = session.user.id

  const [mentors, setMentors] = useState([])
  const [mentees, setMentees] = useState([])
  const [mentorships, setMentorships] = useState([])
  const [loadCounts, setLoadCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [requestTarget, setRequestTarget] = useState(null)

  const canMentor = !!profile?.is_open_to_opportunities

  // `quiet` refetches without flipping `loading`. That matters: the loading
  // branch below swaps the whole tab body out for a spinner, which unmounts
  // Settings and loses whatever the person just clicked. Anything that
  // refreshes *because of* a change made on this page should refresh quietly.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    await supabase.auth.getSession()

    const [people, mine, counts] = await Promise.all([
      supabase.from('profiles').select(PERSON_FIELDS)
        .or('is_open_to_opportunities.eq.true,seeking_mentor.eq.true')
        .neq('id', myId),
      supabase.from('mentorships').select(MENTORSHIP_FIELDS)
        .or(`mentor_id.eq.${myId},mentee_id.eq.${myId}`)
        .order('requested_at', { ascending: false }),
      supabase.rpc('mentor_load'),
    ])

    // A quiet refresh that fails leaves the lists as they were rather than
    // replacing a working page with an error screen — the save it followed
    // already succeeded, so there is nothing for the person to retry.
    if (people.error || mine.error) { if (!quiet) setLoadError(true); setLoading(false); return }
    setLoadError(false)

    const countMap = {}
    for (const row of counts.data || []) countMap[row.mentor_id] = row.active_count
    setLoadCounts(countMap)

    const all = (people.data || []).map((p) => ({ ...p, active_mentorships: countMap[p.id] || 0 }))
    setMentors(all.filter((p) => p.is_open_to_opportunities))
    setMentees(all.filter((p) => p.seeking_mentor))
    setMentorships(mine.data || [])
    setLoading(false)
  }, [myId])

  useEffect(() => { load() }, [load])

  // Everyone I already have something live with, so browse cards can show
  // "Request sent" instead of offering a request the RPC would reject.
  const liveWith = useMemo(() => {
    const map = {}
    for (const m of mentorships) {
      if (m.status !== 'pending' && m.status !== 'active') continue
      const other = m.mentor_id === myId ? m.mentee_id : m.mentor_id
      map[other] = m
    }
    return map
  }, [mentorships, myId])

  const incoming = useMemo(
    () => mentorships.filter((m) => m.status === 'pending' && m.initiated_by !== myId),
    [mentorships, myId]
  )

  // Memoised because My mentoring uses it as an effect dependency — an array
  // rebuilt inline in JSX would be a new identity on every render and set
  // that effect running in a loop.
  const allPeople = useMemo(() => [...mentors, ...mentees], [mentors, mentees])

  const TABS = useMemo(() => ([
    { id: 'find', label: 'Find a mentor' },
    ...(canMentor ? [{ id: 'mentees', label: 'Find a mentee' }] : []),
    { id: 'mine', label: 'My mentoring', badge: incoming.length },
    { id: 'settings', label: 'Settings' },
  ]), [canMentor, incoming.length])

  const tab = TABS.find((t) => t.id === params.get('tab'))?.id || 'find'

  function setTab(id) {
    const p = new URLSearchParams(params)
    if (id === 'find') p.delete('tab')
    else p.set('tab', id)
    setParams(p, { replace: true })
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Mentoring</h2>
      <p className="panel-sub">
        Ask a quick question, or set up a proper mentorship with goals and a record of what you talked about.
      </p>

      <div className="section-tabs mentoring-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'section-tab on' : 'section-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge > 0 && <span className="section-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>

      {loading ? <LoadingState message="Loading mentoring…" /> : loadError ? (
        <p className="form-error">
          Couldn&rsquo;t load mentoring.{' '}
          <button type="button" className="link-btn" onClick={load}>Try again</button>
        </p>
      ) : (
        <>
          {tab === 'find' && (
            <BrowseTab
              mode="mentor"
              people={mentors}
              profile={profile}
              liveWith={liveWith}
              onMessage={onMessage}
              onRequest={(person) => setRequestTarget({ person, asMentor: false })}
              onGoToSettings={() => setTab('settings')}
            />
          )}
          {tab === 'mentees' && canMentor && (
            <BrowseTab
              mode="mentee"
              people={mentees}
              profile={profile}
              liveWith={liveWith}
              onMessage={onMessage}
              onRequest={(person) => setRequestTarget({ person, asMentor: true })}
              onGoToSettings={() => setTab('settings')}
            />
          )}
          {tab === 'mine' && (
            <MyMentoringTab
              mentorships={mentorships}
              people={allPeople}
              session={session}
              onMessage={onMessage}
              onChanged={load}
              onBrowse={() => setTab('find')}
              showToast={showToast}
            />
          )}
          {tab === 'settings' && (
            <SettingsTab
              profile={profile}
              session={session}
              activeAsMentor={loadCounts[myId] || 0}
              onProfileChange={onProfileChange}
              onSaved={() => load({ quiet: true })}
              showToast={showToast}
            />
          )}
        </>
      )}

      {requestTarget && (
        <MentorshipRequestModal
          target={requestTarget.person}
          profile={profile}
          asMentor={requestTarget.asMentor}
          onClose={() => setRequestTarget(null)}
          onSent={load}
        />
      )}
    </section>
  )
}

/* ============================================================
   Browse — one component for both directions
   ============================================================ */
function BrowseTab({ mode, people, profile, liveWith, onMessage, onRequest, onGoToSettings }) {
  const [search, setSearch] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(false)
  const [sort, setSort] = useState('match')

  const lookingForMentor = mode === 'mentor'
  const myGoals = normalizeExpertise(profile?.mentee_goals)

  const scored = useMemo(() => people.map((p) => ({
    ...p,
    match: lookingForMentor ? scoreMentor(profile, p) : scoreMentee(profile, p),
  })), [people, profile, lookingForMentor])

  const industries = useMemo(() => {
    const set = new Set()
    scored.forEach((m) => { if (m.industry) set.add(m.industry) })
    return [...set].sort()
  }, [scored])

  const filtered = useMemo(() => {
    let list = scored
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) => (
        (p.full_name || '').toLowerCase().includes(q) ||
        (p.occupation || '').toLowerCase().includes(q) ||
        (p.company || '').toLowerCase().includes(q) ||
        (p.industry || '').toLowerCase().includes(q) ||
        normalizeExpertise(p.expertise).some((e) => e.toLowerCase().includes(q)) ||
        normalizeExpertise(p.mentee_goals).some((e) => e.toLowerCase().includes(q)) ||
        (p.bio || '').toLowerCase().includes(q)
      ))
    }
    if (industryFilter) list = list.filter((p) => p.industry === industryFilter)
    if (onlyAvailable && lookingForMentor) list = list.filter((p) => mentorHeadroom(p).hasRoom)

    const out = [...list]
    if (sort === 'match') out.sort(byScore)
    else out.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
    return out
  }, [scored, search, industryFilter, onlyAvailable, sort, lookingForMentor])

  if (people.length === 0) {
    return lookingForMentor ? (
      <EmptyState
        icon="search"
        message="No mentors available right now."
        subMessage='People appear here as soon as they turn on "open to mentoring" on their profile.'
      />
    ) : (
      <EmptyState
        icon="search"
        message="Nobody is looking for a mentor yet."
        subMessage="When someone asks to be matched, they'll show up here with what they need help with."
      />
    )
  }

  return (
    <div className="mentoring-find">
      {/* Matching is only as good as what you've told it. Rather than
          silently ranking on almost nothing, say so once, with the fix one
          click away. */}
      {lookingForMentor && myGoals.length === 0 && (
        <div className="mentoring-callout">
          <p>
            <strong>Tell us what you want help with</strong> and this list reorders itself around it — otherwise
            it&rsquo;s just everyone, alphabetically.
          </p>
          <button type="button" className="btn ghost small" onClick={onGoToSettings}>Set my goals</button>
        </div>
      )}

      <div className="mentoring-filter-bar">
        <div className="mentoring-search-wrap">
          <SearchIcon />
          <input
            type="text"
            placeholder={lookingForMentor
              ? 'Search mentors by name, role, expertise…'
              : 'Search by name, role, what they need…'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mentoring-search"
          />
          {search && (
            <button type="button" className="mentoring-search-clear" onClick={() => setSearch('')} aria-label="Clear search">×</button>
          )}
        </div>
        <div className="mentoring-filter-selects">
          {industries.length > 1 && (
            <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="mentoring-filter-select" aria-label="Filter by industry">
              <option value="">All industries</option>
              {industries.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          )}
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="mentoring-filter-select" aria-label="Sort">
            <option value="match">Best match first</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
      </div>

      {lookingForMentor && (
        <label className="mentoring-toggle-filter">
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
          <span>Only mentors with a free slot</span>
        </label>
      )}

      <p className="result-count">
        {filtered.length} {lookingForMentor
          ? (filtered.length === 1 ? 'mentor' : 'mentors')
          : (filtered.length === 1 ? 'person' : 'people')}
        {(search || industryFilter || onlyAvailable) ? ' found' : ' available'}
      </p>

      {filtered.length === 0 ? (
        <EmptyState icon="search" message="Nobody matches those filters." subMessage="Try broadening your search." />
      ) : (
        <div className="mentor-card-grid">
          {filtered.map((person) => (
            <PersonCard
              key={person.id}
              person={person}
              mode={mode}
              profile={profile}
              existing={liveWith[person.id]}
              onMessage={onMessage}
              onRequest={onRequest}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PersonCard({ person, mode, profile, existing, onMessage, onRequest }) {
  const lookingForMentor = mode === 'mentor'
  const expertise = normalizeExpertise(lookingForMentor ? person.expertise : person.mentee_goals)
  const roleLine = person.occupation && person.company
    ? `${person.occupation} @ ${person.company}`
    : (person.occupation || person.company || '')
  const room = mentorHeadroom(person)
  const { tier, reasons } = person.match

  return (
    <div className="mentor-card">
      {/* Stretched link rather than a clickable div — see the note on the
          same pattern in Directory.jsx. Real buttons below sit above it via
          position: relative, so they stay clickable. */}
      <Link className="stretched-link" to={`/people/${person.id}`}>
        <span className="sr-only">{`Open profile for ${person.full_name || 'member'}`}</span>
      </Link>

      <div className="mentor-card-top">
        <Avatar url={person.avatar_url} name={person.full_name} size={56} />
        <div className="mentor-card-identity">
          <span className="mentor-card-name">{person.full_name}</span>
          {roleLine && <span className="mentor-card-role">{roleLine}</span>}
          {person.industry && <span className="mentor-card-industry">{person.industry}</span>}
        </div>
        {tier && <span className={`mentor-match-badge ${tier}`}>{TIER_LABEL[tier]}</span>}
      </div>

      {/* Why this person, in their words and yours — far more persuasive
          than the score that produced the ordering, which is why the number
          itself is never shown. */}
      {reasons.length > 0 && (
        <ul className="mentor-match-reasons">
          {reasons.map((r) => (
            <li key={r.key} className={r.strong ? 'strong' : undefined}>{r.label}</li>
          ))}
        </ul>
      )}

      {!lookingForMentor && person.mentee_note && (
        <p className="mentor-card-bio">{person.mentee_note}</p>
      )}
      {lookingForMentor && person.bio && <p className="mentor-card-bio">{person.bio}</p>}

      {expertise.length > 0 && (
        <div className="mentor-card-tags">
          {!lookingForMentor && <span className="mentor-tag-label">Wants help with</span>}
          {expertise.slice(0, 4).map((e) => <span key={e} className="mentor-tag">{e}</span>)}
          {expertise.length > 4 && <span className="mentor-tag mentor-tag-more">+{expertise.length - 4}</span>}
        </div>
      )}

      <div className="mentor-card-meta">
        {person.grad_year && <span className="mentor-card-grad">Class of {person.grad_year}</span>}
        {lookingForMentor && (
          <span className={`mentor-capacity ${room.paused ? 'paused' : room.hasRoom ? 'open' : 'full'}`}>
            {room.paused
              ? 'Paused'
              : room.hasRoom
                ? `${room.spotsLeft} slot${room.spotsLeft === 1 ? '' : 's'} open`
                : 'At capacity'}
          </span>
        )}
      </div>

      <div className="mentor-card-footer">
        <div className="mentor-card-actions">
          <button
            type="button"
            className="header-icon-btn mentor-message-btn"
            onClick={() => onMessage?.({ id: person.id, full_name: person.full_name }, buildIcebreaker(profile, person))}
            aria-label={`Message ${person.full_name}`}
            title="Ask a quick question"
          >
            <MessageIcon />
          </button>
          {/* safeUrl rather than the raw column — see the note on the same
              field in Directory.jsx. */}
          {safeUrl(person.linkedin_url) && (
            <a
              href={safeUrl(person.linkedin_url)}
              target="_blank"
              rel="noopener noreferrer"
              className="header-icon-btn mentor-linkedin-btn"
              aria-label={`${person.full_name} on LinkedIn`}
              title="LinkedIn"
            >
              <LinkedInIcon />
            </a>
          )}
        </div>

        {existing ? (
          <span className="mentor-card-state">
            {existing.status === 'active' ? 'Mentoring underway' : 'Request pending'}
          </span>
        ) : (
          <button
            type="button"
            className="btn ghost small mentor-request-btn"
            onClick={() => onRequest(person)}
            disabled={lookingForMentor && (room.paused || !room.hasRoom)}
            title={lookingForMentor && !room.hasRoom ? 'This mentor has no free slots right now' : undefined}
          >
            {lookingForMentor ? 'Request mentorship' : 'Offer to mentor'}
          </button>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   My mentoring
   ============================================================ */
function MyMentoringTab({ mentorships, people, session, onMessage, onChanged, onBrowse, showToast }) {
  const myId = session.user.id
  const [expanded, setExpanded] = useState(null)
  const [names, setNames] = useState({})

  // Browse only loads people who are currently opted in. A mentorship can
  // easily outlive that — someone accepts you, then switches their toggle
  // off precisely because they are now busy mentoring you — so any
  // counterpart missing from that list is fetched by id rather than shown as
  // a blank card.
  useEffect(() => {
    const known = {}
    for (const p of people) known[p.id] = p
    const missing = [...new Set(mentorships
      .map((m) => (m.mentor_id === myId ? m.mentee_id : m.mentor_id))
      .filter((id) => !known[id]))]
    if (missing.length === 0) { setNames(known); return }
    let cancelled = false
    supabase.from('profiles')
      .select('id, full_name, avatar_url, occupation, company, industry, grad_year')
      .in('id', missing)
      .then(({ data }) => {
        if (cancelled) return
        const merged = { ...known }
        for (const p of data || []) merged[p.id] = p
        setNames(merged)
      })
    return () => { cancelled = true }
  }, [mentorships, people, myId])

  const groups = useMemo(() => ({
    incoming: mentorships.filter((m) => m.status === 'pending' && m.initiated_by !== myId),
    outgoing: mentorships.filter((m) => m.status === 'pending' && m.initiated_by === myId),
    active: mentorships.filter((m) => m.status === 'active'),
    past: mentorships.filter((m) => ['completed', 'ended', 'declined', 'cancelled'].includes(m.status)),
  }), [mentorships, myId])

  if (mentorships.length === 0) {
    return (
      <EmptyState
        icon="search"
        message="No mentorships yet."
        subMessage="Find someone whose experience lines up with what you're working on, and send them a request."
        actionLabel="Find a mentor"
        onAction={onBrowse}
      />
    )
  }

  const sections = [
    { key: 'incoming', title: 'Needs your answer', items: groups.incoming },
    { key: 'active', title: 'Active', items: groups.active },
    { key: 'outgoing', title: 'Waiting on them', items: groups.outgoing },
    { key: 'past', title: 'Past', items: groups.past },
  ].filter((s) => s.items.length > 0)

  return (
    <div className="mentoring-mine">
      {sections.map((s) => (
        <div key={s.key} className="mentoring-group">
          <h3 className="mentoring-group-title">{s.title} <span>{s.items.length}</span></h3>
          <ul className="relationship-list">
            {s.items.map((m) => (
              <MentorshipRow
                key={m.id}
                mentorship={m}
                other={names[m.mentor_id === myId ? m.mentee_id : m.mentor_id]}
                iAmMentor={m.mentor_id === myId}
                session={session}
                expanded={expanded === m.id}
                onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                onMessage={onMessage}
                onChanged={onChanged}
                showToast={showToast}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

const STATUS_PILL = {
  pending: 'pending',
  active: 'active',
  declined: 'declined',
  cancelled: 'declined',
  completed: 'completed',
  ended: 'completed',
}

const STATUS_LABEL = {
  pending: 'Pending',
  active: 'Active',
  declined: 'Declined',
  cancelled: 'Withdrawn',
  completed: 'Completed',
  ended: 'Ended early',
}

function MentorshipRow({ mentorship: m, other, iAmMentor, session, expanded, onToggle, onMessage, onChanged, showToast }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null)
  const isPending = m.status === 'pending'
  const iSent = m.initiated_by === session.user.id
  const canExpand = ['active', 'completed', 'ended'].includes(m.status)

  const roleLabel = iAmMentor ? 'You mentor them' : 'They mentor you'
  const firstName = (other?.full_name || '').trim().split(/\s+/)[0] || 'them'

  async function respond(accept) {
    setBusy(true)
    const { error } = await supabase.rpc('respond_to_mentorship', {
      p_id: m.id,
      p_accept: accept,
      p_message: '',
    })
    setBusy(false)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    showToast(accept ? `You're now mentoring ${firstName}.` : 'Request declined.')
    onChanged()
  }

  async function withdraw() {
    setConfirming(null)
    setBusy(true)
    const { error } = await supabase.rpc('cancel_mentorship_request', { p_id: m.id })
    setBusy(false)
    if (error) { showToast(friendlyError(error), { type: 'error' }); return }
    showToast('Request withdrawn.')
    onChanged()
  }

  return (
    <li className="relationship-card">
      <div className="relationship-card-head">
        <div className="relationship-card-left">
          <Avatar url={other?.avatar_url} name={other?.full_name} size={44} />
          <div className="relationship-card-info">
            <div className="relationship-card-name-line">
              {/* The counterpart is fetched separately and can lag a frame
                  behind, so this falls back to plain text rather than
                  rendering a link to /people/undefined. */}
              {other?.id ? (
                <Link to={`/people/${other.id}`} className="relationship-card-name">
                  {other.full_name || 'Member'}
                </Link>
              ) : (
                <span className="relationship-card-name">{other?.full_name || 'Member'}</span>
              )}
              <span className={`mentoring-status-pill ${STATUS_PILL[m.status]}`}>{STATUS_LABEL[m.status]}</span>
            </div>
            <span className="relationship-card-role">
              {roleLabel}
              {m.cadence ? ` · ${m.cadence}` : ''}
              {m.duration_months ? ` · ${m.duration_months} months` : ''}
            </span>
            {m.focus?.length > 0 && (
              <div className="mentor-card-tags">
                {m.focus.slice(0, 4).map((f) => <span key={f} className="mentor-tag">{f}</span>)}
                {m.focus.length > 4 && <span className="mentor-tag mentor-tag-more">+{m.focus.length - 4}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="relationship-card-actions">
          {other?.id && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => onMessage?.({ id: other.id, full_name: other.full_name }, '')}
            >
              Message
            </button>
          )}
          {isPending && !iSent && (
            <>
              <button type="button" className="btn ghost small" onClick={() => setConfirming('decline')} disabled={busy}>Decline</button>
              <button type="button" className="btn primary small" onClick={() => respond(true)} disabled={busy}>Accept</button>
            </>
          )}
          {isPending && iSent && (
            <button type="button" className="btn ghost small" onClick={() => setConfirming('withdraw')} disabled={busy}>Withdraw</button>
          )}
          {canExpand && (
            <button type="button" className="btn ghost small" onClick={onToggle} aria-expanded={expanded}>
              {expanded ? 'Hide' : (m.status === 'active' ? 'Open' : 'View record')}
            </button>
          )}
        </div>
      </div>

      {/* The request note is the whole basis for a yes or no, so it shows
          without needing to expand anything. */}
      {isPending && m.request_message && (
        <div className="relationship-card-body">
          <div className="relationship-completion-note">
            <strong>{iSent ? 'What you wrote' : `${firstName} wrote`}</strong>
            {m.request_message}
          </div>
        </div>
      )}

      {(m.status === 'completed' || m.status === 'ended') && m.closing_note && !expanded && (
        <div className="relationship-card-body">
          <div className="relationship-completion-note">
            <strong>Closing note</strong>
            {m.closing_note}
          </div>
        </div>
      )}

      {expanded && canExpand && (
        <MentorshipWorkspace
          mentorship={m}
          session={session}
          otherPerson={other}
          onChanged={onChanged}
        />
      )}

      {confirming === 'decline' && (
        <ConfirmDialog
          title={`Decline ${firstName}'s request?`}
          message="They'll be told you declined. You can always start something later."
          confirmLabel="Decline"
          onConfirm={() => { setConfirming(null); respond(false) }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === 'withdraw' && (
        <ConfirmDialog
          title="Withdraw this request?"
          message={`${firstName} won't be notified either way.`}
          confirmLabel="Withdraw"
          onConfirm={withdraw}
          onCancel={() => setConfirming(null)}
        />
      )}
    </li>
  )
}

/* ============================================================
   Settings
   ============================================================ */
//
// Deliberately editable here rather than being four more links to the
// profile editor. Pausing requests and changing how many people you can take
// on are things you do *because* of what you're seeing on this page, and
// bouncing someone to a different screen to do it is how you end up with
// mentors who never adjust either.
function formFromProfile(profile) {
  return {
    is_open_to_opportunities: !!profile?.is_open_to_opportunities,
    mentor_paused: !!profile?.mentor_paused,
    mentor_capacity: Number(profile?.mentor_capacity) || 2,
    seeking_mentor: !!profile?.seeking_mentor,
  }
}

function SettingsTab({ profile, session, activeAsMentor, onProfileChange, onSaved, showToast }) {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => formFromProfile(profile))

  // Only re-sync from the prop when nothing is in flight. Mid-save the local
  // form is ahead of the app-level profile on purpose, and letting an
  // unrelated re-render push the old value back in is exactly the flicker
  // where a click appeared to do nothing until the page was refreshed.
  const savingRef = useRef(false)
  useEffect(() => {
    if (savingRef.current) return
    setForm(formFromProfile(profile))
  }, [profile])

  async function save(patch) {
    savingRef.current = true
    setSaving(true)
    const next = { ...form, ...patch }
    setForm(next)

    await supabase.auth.getSession()
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', session.user.id)
      .select()
      .single()
    setSaving(false)
    savingRef.current = false

    if (error) {
      showToast('Could not save that — please try again.', { type: 'error' })
      // Revert to profile state since the update failed
      setForm(formFromProfile(profile))
      return
    }

    // Hand the saved row back up so the app-level profile matches the
    // database. Without this the parent keeps serving the pre-save profile,
    // and the effect above quietly undoes the click on the next re-render.
    if (data) {
      setForm(formFromProfile(data))
      onProfileChange?.(data)
    }
    onSaved?.()
  }

  const capacityWarning = form.mentor_capacity < activeAsMentor

  return (
    <div className="mentoring-settings">
      <div className="settings-card">
        <h3>Mentoring others</h3>
        <p>
          {form.is_open_to_opportunities
            ? 'You show up under Find a Mentor, and people can send you requests.'
            : 'You’re not listed as a mentor at the moment.'}
        </p>

        <div className="mentoring-settings-row">
          <span>Open to mentoring</span>
          <div className="onboarding-choice-row">
            <button
              type="button"
              className={form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => save({ is_open_to_opportunities: true })}
              disabled={saving}
            >
              Yes
            </button>
            <button
              type="button"
              className={!form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => save({ is_open_to_opportunities: false })}
              disabled={saving}
            >
              Not right now
            </button>
          </div>
        </div>

        {form.is_open_to_opportunities && (
          <>
            <div className="mentoring-settings-row">
              <span>
                How many people at once?
                <small>You&rsquo;re currently mentoring {activeAsMentor}.</small>
              </span>
              <div className="mentoring-capacity-picker">
                {[1, 2, 3, 5, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={form.mentor_capacity === n ? 'tag-btn selected' : 'tag-btn'}
                    onClick={() => save({ mentor_capacity: n })}
                    disabled={saving}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {capacityWarning && (
              <p className="hint">
                You already have {activeAsMentor} active — nothing is cancelled, you just won&rsquo;t be able to
                accept anyone new until one wraps up.
              </p>
            )}

            <div className="mentoring-settings-row">
              <span>
                Pause new requests
                <small>Stay listed, but nobody can send you anything new.</small>
              </span>
              {/* The same two-button choice used everywhere else in this app
                  rather than a bespoke switch — one fewer control to learn,
                  and it reads unambiguously either way round. */}
              <div className="onboarding-choice-row">
                <button
                  type="button"
                  className={form.mentor_paused ? 'onboarding-choice on' : 'onboarding-choice'}
                  onClick={() => save({ mentor_paused: true })}
                  disabled={saving}
                >
                  Paused
                </button>
                <button
                  type="button"
                  className={!form.mentor_paused ? 'onboarding-choice on' : 'onboarding-choice'}
                  onClick={() => save({ mentor_paused: false })}
                  disabled={saving}
                >
                  Open
                </button>
              </div>
            </div>

            <button type="button" className="btn ghost small" onClick={() => navigate('/profile')}>
              Edit your expertise and availability
            </button>
          </>
        )}
      </div>

      <div className="settings-card">
        <h3>Being mentored</h3>
        <p>
          {form.seeking_mentor
            ? 'You appear under Find a Mentee, so mentors can approach you too — not just the other way round.'
            : 'Turn this on and mentors can find you, instead of you having to do all the asking.'}
        </p>

        <div className="mentoring-settings-row">
          <span>Looking for a mentor</span>
          <div className="onboarding-choice-row">
            <button
              type="button"
              className={form.seeking_mentor ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => save({ seeking_mentor: true })}
              disabled={saving}
            >
              Yes
            </button>
            <button
              type="button"
              className={!form.seeking_mentor ? 'onboarding-choice on' : 'onboarding-choice'}
              onClick={() => save({ seeking_mentor: false })}
              disabled={saving}
            >
              Not right now
            </button>
          </div>
        </div>

        <p className="hint">
          What you want help with is set on your profile — it&rsquo;s also what orders the Find a Mentor list for you.
        </p>
        <button type="button" className="btn ghost small" onClick={() => navigate('/profile')}>
          Set what you need help with
        </button>
      </div>
    </div>
  )
}

/* ---------- Icons ---------- */
function SearchIcon() {
  return (
    <svg className="mentoring-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.13 1 2.5 1s2.48 1.13 2.48 2.5zM.24 8h4.52v14H.24V8zm7.5 0h4.34v1.92h.06c.6-1.14 2.07-2.34 4.26-2.34 4.56 0 5.4 3 5.4 6.9V22h-4.52v-6.14c0-1.46-.02-3.34-2.04-3.34-2.04 0-2.36 1.6-2.36 3.24V22H7.74V8z"/>
    </svg>
  )
}
