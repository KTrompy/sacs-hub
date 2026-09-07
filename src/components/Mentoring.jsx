import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import LoadingState from './LoadingState.jsx'
import EmptyState from './EmptyState.jsx'
import { useToast } from './Toast.jsx'
import { loadMentoringData, mentorshipHealth } from './mentoring/data.js'
import OnboardingWizard from './mentoring/OnboardingWizard.jsx'
import Overview from './mentoring/Overview.jsx'
import Discover from './mentoring/Discover.jsx'
import Relationships from './mentoring/Relationships.jsx'
import Workspace from './mentoring/Workspace.jsx'
import MentoringProfile from './mentoring/MentoringProfile.jsx'

// Ground-up redesign of the mentoring programme (2026-09). Three primary
// destinations — Overview, Discover, Relationships — plus a secondary
// Mentoring Profile page reachable from the header, replacing the old
// Find-a-mentor / Find-a-mentee / My-mentoring / Settings tab set. See
// schema-update-64's header comment for what changed underneath.
//
// This file owns the one data fetch every sub-page needs (people,
// mentorships, connections, saved list, my own mentoring preferences) and
// hands it down as plain props — a nested <Routes> rather than relying on
// Outlet context, so each page's prop list stays explicit and easy to trace.
export default function Mentoring({ session, profile, onProfileChange }) {
  const showToast = useToast()
  const navigate = useNavigate()
  const myId = session.user.id

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const onboardingChecked = useRef(false)

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true)
    const res = await loadMentoringData(myId)
    if (res.error) {
      if (!quiet) setLoadError(true)
      setLoading(false)
      return
    }
    setLoadError(false)
    setData(res)
    setLoading(false)
  }, [myId])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!data || onboardingChecked.current) return
    onboardingChecked.current = true
    if (!data.myMentoringProfile?.onboarding_completed_at) setShowOnboarding(true)
  }, [data])

  async function toggleSaved(personId, shouldSave) {
    if (shouldSave) {
      await supabase.from('saved_mentors').insert({ profile_id: myId, saved_profile_id: personId })
    } else {
      await supabase.from('saved_mentors').delete().eq('profile_id', myId).eq('saved_profile_id', personId)
    }
    reload({ quiet: true })
  }

  function onOnboardingDone(result) {
    setShowOnboarding(false)
    reload({ quiet: true })
    if (result?.wantsGuidance || result?.offersGuidance) {
      showToast('Your mentoring profile is set up.')
    }
  }

  const myId_ = myId
  const mentorships = data?.mentorships || []
  const connections = data?.connections || []

  // Shared across the header badge and Overview's "Needs your attention" —
  // computed once here so both agree on what counts as needing a look.
  const attention = useMemo(() => {
    const incomingRequests = mentorships.filter((m) => m.status === 'pending' && m.initiated_by !== myId_)
    const discussingMyTurn = mentorships.filter((m) => m.status === 'discussing' && m.initiated_by === myId_)
    const pendingConnections = connections.filter((c) => c.recipient_id === myId_ && c.status === 'sent')
    const unhealthyActive = mentorships.filter((m) => m.status === 'active' && mentorshipHealth(m) !== 'healthy')
    return { incomingRequests, discussingMyTurn, pendingConnections, unhealthyActive }
  }, [mentorships, connections, myId_])

  const relationshipsBadge =
    attention.incomingRequests.length + attention.discussingMyTurn.length + attention.pendingConnections.length

  const NAV = [
    { to: '/mentoring', end: true, label: 'Overview' },
    { to: '/mentoring/discover', end: false, label: 'Discover' },
    { to: '/mentoring/relationships', end: false, label: 'Relationships', badge: relationshipsBadge || null },
  ]

  const shared = {
    me: profile,
    myId,
    people: data?.people || [],
    myMentoringProfile: data?.myMentoringProfile || null,
    mentorships,
    connections,
    savedIds: data?.savedIds || new Set(),
    savedRows: data?.savedRows || [],
    attention,
    reload,
    toggleSaved,
    showToast,
    onOpenOnboarding: () => setShowOnboarding(true),
  }

  return (
    <div className="mtg-page page-shell">
      <div className="mtg-header">
        <div>
          <h1>Mentoring</h1>
          <p>Find someone useful, start the right kind of conversation, and keep it moving.</p>
        </div>
        <div className="mtg-header-actions">
          <button type="button" className="link-btn" onClick={() => navigate('/mentoring/profile')}>
            Mentoring profile
          </button>
        </div>
      </div>

      <nav className="mtg-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `mtg-nav-item ${isActive ? 'on' : ''}`}>
            {n.label}
            {!!n.badge && <span className="mtg-nav-badge">{n.badge}</span>}
          </NavLink>
        ))}
      </nav>

      {loading && !data ? (
        <LoadingState message="Loading mentoring…" />
      ) : loadError ? (
        <EmptyState icon="search" message="Couldn't load Mentoring" subMessage="Please try again in a moment." actionLabel="Retry" onAction={() => reload()} />
      ) : (
        <Routes>
          <Route index element={<Overview {...shared} />} />
          <Route path="discover" element={<Discover {...shared} />} />
          <Route path="relationships" element={<Relationships {...shared} />} />
          <Route path="relationships/:id" element={<Workspace {...shared} />} />
          <Route path="profile" element={<MentoringProfile {...shared} onProfileChange={onProfileChange} />} />
        </Routes>
      )}

      {showOnboarding && (
        <OnboardingWizard me={profile} onDone={onOnboardingDone} />
      )}
    </div>
  )
}
