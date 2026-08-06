import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { supabase, isAuthError } from './supabaseClient'
import Auth from './components/Auth.jsx'
import ResetPassword from './components/ResetPassword.jsx'
import FinishSignup from './components/FinishSignup.jsx'
import PendingVerification from './components/PendingVerification.jsx'
import Home from './components/Home.jsx'
import People from './components/People.jsx'
import { Avatar } from './components/Directory.jsx'
import FloatingMessages from './components/FloatingMessages.jsx'
import NotificationBell from './components/NotificationBell.jsx'
import ConfirmDialog from './components/ConfirmDialog.jsx'

// Route-level code splitting.
//
// Everything used to be a static import, which built one 947 kB JS bundle
// (268 kB gzipped) that had to download and parse in full before anything
// rendered — including Leaflet, the rich-text editors and every screen a
// given person might never open. On a mid-range phone that's seconds of
// blank page, and every deploy invalidated the whole thing.
//
// Kept eager above: the sign-in path (Auth/ResetPassword/FinishSignup/
// PendingVerification), Home (the default landing route), and the chrome that
// renders on every screen (header bell, messages dock, dialogs). Splitting
// those would only add a spinner to the very first paint.
//
// Everything below is fetched on first navigation to it and cached from then
// on. Rollup hoists whatever they genuinely share into common chunks, so
// nothing is downloaded twice.
const Feed = lazy(() => import('./components/Feed.jsx'))
const Mentoring = lazy(() => import('./components/Mentoring.jsx'))
const Profile = lazy(() => import('./components/Profile.jsx'))
const PersonProfile = lazy(() => import('./components/PersonProfile.jsx'))
const Events = lazy(() => import('./components/Events.jsx'))
const Jobs = lazy(() => import('./components/Jobs.jsx'))
const JobDetail = lazy(() => import('./components/JobDetail.jsx'))
const BusinessDirectory = lazy(() => import('./components/BusinessDirectory.jsx'))
const BusinessDetail = lazy(() => import('./components/BusinessDetail.jsx'))
const LegendsHall = lazy(() => import('./components/LegendsHall.jsx'))
const LegendProfile = lazy(() => import('./components/LegendProfile.jsx'))
const Donate = lazy(() => import('./components/Donate.jsx'))
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy.jsx'))
const Admin = lazy(() => import('./components/Admin.jsx'))
const Settings = lazy(() => import('./components/Settings.jsx'))
const NotFound = lazy(() => import('./components/NotFound.jsx'))

// Old Boys (directory) now includes the alumni map as a view toggle
// (see People.jsx) instead of splitting "find a person" across two nav
// items. Support/Donate isn't a top-level tab while it's still a stub with
// no real payment flow — it's reachable from the footer link instead.
// My profile isn't in this list either — it lives as an avatar icon in the
// top-right of the header (see .header-avatar-btn) on every screen size,
// not in the sidebar/hamburger nav.
//
// Each tab carries its own sidebar icon now that navigation lives in the
// left sidebar (see .sidebar in styles.css) rather than the old inline
// header tab strip.
const TABS = [
  { id: 'home', label: 'Home', path: '/home', icon: HomeIcon },
  { id: 'directory', label: 'Old Boys', path: '/directory', icon: PeopleIcon },
  { id: 'jobs', label: 'Jobs', path: '/jobs', icon: JobsIcon },
  { id: 'feed', label: 'Feed', path: '/feed', icon: FeedIcon },
  { id: 'mentoring', label: 'Mentoring', path: '/mentoring', icon: MentoringIcon },
  { id: 'events', label: 'Events', path: '/events', icon: EventsIcon },
  { id: 'businesses', label: 'Business Directory', path: '/businesses', icon: BusinessIcon },
]

// Admin-only, appended to the nav when the signed-in profile has is_admin
// set — kept out of the base TABS list so it never flashes for regular
// members before the profile loads.
const ADMIN_TAB = { id: 'admin', label: 'Admin', path: '/admin', icon: AdminIcon }

// Desktop sidebar's five "always visible" tabs — the rest of TABS (and
// Admin, when present) live behind the sidebar's "More" toggle instead.
const PRIMARY_TAB_IDS = ['directory', 'home', 'jobs', 'feed', 'businesses']

// The mobile bottom tab bar — a smaller subset of TABS (My profile and Sign
// out move to the mobile header/avatar instead, so the bar stays to four
// core sections now that Map lives inside Old Boys).
const MOBILE_TABS = [
  { id: 'home', label: 'Home', path: '/home', icon: HomeIcon },
  { id: 'directory', label: 'Old Boys', path: '/directory', icon: PeopleIcon },
  { id: 'jobs', label: 'Jobs', path: '/jobs', icon: JobsIcon },
  { id: 'feed', label: 'Feed', path: '/feed', icon: FeedIcon },
  { id: 'events', label: 'Events', path: '/events', icon: EventsIcon },
]

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [dmTarget, setDmTarget] = useState(null) // profile to open a DM with
  const [dmDraft, setDmDraft] = useState('') // optional prefilled first message
  const [messagesOpen, setMessagesOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false) // mobile hamburger menu
  // True the instant Supabase fires PASSWORD_RECOVERY (someone clicked the
  // reset-password link from Auth.jsx's "Forgot password?" flow) — that
  // event carries a real session, so without this flag the check below
  // would just drop them straight into the normal signed-in app instead of
  // letting them set a new password first.
  const [recoveryMode, setRecoveryMode] = useState(false)
  // Desktop sidebar "More" section. null = no manual choice yet (falls back
  // to auto-expanding whenever the active page is one of the secondary
  // tabs); true/false = the person explicitly clicked More/Less, which
  // wins over the auto-expand — e.g. clicking "Less" while on Mentoring
  // collapses the list even though Mentoring's own link is inside it.
  // Reset to null on every navigation so the next page starts from the
  // same auto-expand default rather than staying manually stuck open/shut.
  const [moreNavOverride, setMoreNavOverride] = useState(null)
  const [loading, setLoading] = useState(true)
  const [checkedFirstRun, setCheckedFirstRun] = useState(false)
  // Lifecycle of the profile fetch below, kept separate from `profile`
  // itself because "still loading" and "loaded, and there's genuinely
  // nothing there" used to be indistinguishable — both were just
  // `profile === null`, and the render gates further down read that as
  // "skip the checks", dropping people into the full app. See the gates.
  // 'deleted' is its own state rather than a flavour of 'error': the account
  // is gone, so "Try again" is not an option and saying "your account is fine"
  // is a lie. See the profile-load effect and AccountRemoved below.
  const [profileStatus, setProfileStatus] = useState('loading') // 'loading' | 'ready' | 'error' | 'deleted'
  // Bumped by the error screen's "Try again" to re-run the fetch effect.
  const [profileReloadKey, setProfileReloadKey] = useState(0)

  const navigate = useNavigate()
  const location = useLocation()

  // Guards against losing unsaved profile edits. `profileDirty` mirrors
  // whether the profile form currently has unsaved changes; `profileSaveRef`
  // lets us trigger that form's save() from up here (e.g. from the "leave
  // without saving?" prompt) without Profile needing to know about
  // navigation at all. `pendingNav`, when set, means someone tried to
  // navigate away while dirty and we're waiting on their answer.
  const [profileDirty, setProfileDirty] = useState(false)
  const profileSaveRef = useRef(null)
  const [pendingNav, setPendingNav] = useState(null)
  const [leaveBusy, setLeaveBusy] = useState(false)
  const [leaveError, setLeaveError] = useState(null)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [directoryRefetchTrigger, setDirectoryRefetchTrigger] = useState(0) // increment to trigger refetch
  const [profileMenuOpen, setProfileMenuOpen] = useState(false) // header avatar dropdown (Settings/Edit profile/Sign out)
  const profileMenuRef = useRef(null)

  // Clear any manual More/Less click on navigation, so the sidebar's
  // "More" section goes back to auto-expand-if-relevant for whatever page
  // you land on next, rather than staying manually forced open/shut.
  useEffect(() => {
    setMoreNavOverride(null)
  }, [location.pathname])

  // Lock body scroll while the mobile nav drawer is open, and let Escape
  // close it — same pattern as the filter drawers (DirectoryFilters.jsx,
  // Jobs.jsx, BusinessDirectory.jsx).
  useEffect(() => {
    if (!navOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape') setNavOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [navOpen])

  // Header avatar dropdown — same outside-click/Escape pattern as
  // NotificationBell's dropdown.
  useEffect(() => {
    if (!profileMenuOpen) return
    function onClick(e) { if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) setProfileMenuOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setProfileMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [profileMenuOpen])

  // Warn on an actual browser navigation/refresh/close too, not just
  // switching tabs inside the app.
  useEffect(() => {
    function handler(e) {
      if (!profileDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [profileDirty])

  // Runs `action` immediately unless the profile page currently has unsaved
  // changes, in which case it's stashed and the confirm prompt takes over.
  function attemptNavigate(action) {
    if (location.pathname.startsWith('/profile') && profileDirty) {
      setLeaveError(null)
      setPendingNav(() => action)
    } else {
      action()
    }
  }

  function goTo(path) {
    attemptNavigate(() => { navigate(path); setNavOpen(false) })
  }

  async function confirmSaveAndLeave() {
    setLeaveBusy(true)
    setLeaveError(null)
    let ok = false
    try {
      ok = await profileSaveRef.current?.()
    } catch (e) {
      // Without this, a thrown save() (rather than one that just returns
      // false) left leaveBusy stuck true forever — "Save & leave" would
      // stay disabled for the rest of the session.
      setLeaveError(e?.message || "Couldn't save — check the profile page for what needs fixing.")
      return
    } finally {
      setLeaveBusy(false)
    }
    if (!ok) { setLeaveError("Couldn't save — check the profile page for what needs fixing."); return }
    pendingNav?.()
    setPendingNav(null)
  }

  function confirmDiscardAndLeave() {
    setProfileDirty(false) // Profile is about to unmount — nothing left to warn about
    pendingNav?.()
    setPendingNav(null)
  }

  function keepEditing() {
    setPendingNav(null)
    setLeaveError(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
      // Without this, signing out from the recovery screen (or having the
      // recovery session expire out from under it) left `recoveryMode` stuck
      // true — and since the check below runs *before* the "no session" one,
      // ResetPassword.jsx kept rendering against a dead session with no way
      // back to sign-in short of a manual page refresh.
      if (event === 'SIGNED_OUT') setRecoveryMode(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // Supabase reports a cancelled/denied social consent screen by bouncing
  // back to the redirect URL with an error — in the query string on the PKCE
  // flow, in the hash fragment on the implicit one. Nothing read either, so
  // cancelling a Google sign-in dropped you back at a blank sign-in form with
  // no explanation. Read it once, show it, and scrub it from the URL so a
  // refresh doesn't resurrect the message.
  const [authRedirectError, setAuthRedirectError] = useState(null)
  // Which view <Auth> should open on. Only set for an expired reset link, where
  // landing on the sign-in form would be actively unhelpful.
  const [authStartMode, setAuthStartMode] = useState(null)
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const code = query.get('error') || hash.get('error')
    if (!code) return
    const description = query.get('error_description') || hash.get('error_description')
    // error_code matters as much as error here, and used to be ignored.
    //
    // An expired or already-used password-reset link comes back as
    // `error=access_denied&error_code=otp_expired`, which is the SAME `error`
    // value Google sends when someone dismisses the consent screen. Reading
    // only `error` meant every dead reset link was reported as "that sign-in
    // was cancelled" — which implies the person cancelled something they
    // didn't, and points them at the password they're trying to reset.
    //
    // It's also the most common failure in the whole reset flow: links expire
    // after an hour, and corporate email scanners routinely follow (and so
    // burn) single-use links before the human ever clicks.
    const errorCode = query.get('error_code') || hash.get('error_code')
    const isExpiredLink = errorCode === 'otp_expired' ||
      /expired|invalid/i.test(description || '')
    setAuthRedirectError(
      isExpiredLink
        // Deliberately does not name which kind of link it was, because we
        // cannot tell: Supabase returns the identical
        // error=access_denied&error_code=otp_expired for a dead password-reset
        // link and a dead signup-confirmation link. The old copy asserted it
        // was a reset link and told people to request a new one — useless
        // advice for the confirmation case, where resetting a password does
        // nothing about an address that was never confirmed. The forgot screen
        // now carries both remedies (see Auth.jsx), so this just has to point
        // at it honestly.
        ? 'That link has expired or has already been used — they only work once, and mail scanners sometimes open them first. Ask for a fresh one below: a password-reset link if you’ve forgotten your password, or a new confirmation link if you never confirmed your email when you joined.'
        : code === 'access_denied'
          ? 'That sign-in was cancelled before it finished. You can try again, or use your email and password.'
          : (description ? description.replace(/\+/g, ' ') : "That sign-in didn't complete. Please try again.")
    )
    // Drops them straight onto the "Forgot password?" form with the message
    // above already showing, rather than onto a sign-in form they can't use.
    // That screen offers a confirmation resend as well, so it's the right
    // landing place for either flavour of expired link.
    if (isExpiredLink) setAuthStartMode('forgot')
    for (const key of ['error', 'error_code', 'error_description']) query.delete(key)
    const search = query.toString()
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (search ? `?${search}` : '')
    )
  }, [])

  // Scoped to the user id rather than the whole `session` object: supabase-js
  // hands back a brand-new session object (new identity, same user) on every
  // TOKEN_REFRESHED event, which fires on tab re-focus as well as on a timer
  // — not just at sign-in. Re-running this effect on every one of those
  // re-fetches the whole profile row from the DB, and if that fetch happens
  // to resolve *after* a Profile.jsx save() (e.g. you tab away mid-edit,
  // come back, toggle something, hit save — the refocus-triggered refetch
  // and the save's own response are now racing), the older row wins and
  // silently overwrites the change you just saved. Keying off just the user
  // id means this only re-runs on an actual sign-in/sign-out/account switch.
  const sessionUserId = session?.user?.id
  useEffect(() => {
    if (!sessionUserId) { setProfile(null); setProfileStatus('loading'); return }
    let cancelled = false
    setProfileStatus('loading')

    // Same auth-not-settled race documented in Home.jsx's dashboard load:
    // this effect can still fire around a token refresh (sign-in itself
    // counts), which can race the underlying supabase-js client's auth
    // header still being attached to outgoing requests. When that happens
    // the `to authenticated` RLS policy on profiles silently matches
    // nothing, .single() comes back as a "no rows" error, and
    // setProfile(null) makes the whole app render as a blank/0%-complete
    // profile (see Home's "Good afternoon, there" banner) until a manual
    // refresh gives the client time to settle. Awaiting getSession() first,
    // plus one retry on error, closes that window instead.
    async function load(isRetry = false) {
      await supabase.auth.getSession()
      if (cancelled) return
      // maybeSingle, not single. `.single()` turns "no rows" into a PostgREST
      // error (PGRST116), which made a genuinely missing profile row
      // indistinguishable from a network failure — so an account an admin had
      // just deleted showed the reassuring "Your account is fine, we just
      // couldn't reach it" screen and an infinite Try-again loop. With
      // maybeSingle, missing is `data === null` with no error, and the two
      // cases can be told apart and handled differently below.
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sessionUserId)
        .maybeSingle()
      if (cancelled) return
      if (error && !isRetry) {
        await new Promise((r) => setTimeout(r, 600))
        if (!cancelled) await load(true)
        return
      }
      // Still failing after the retry, and it *looks* like an auth problem
      // (401/JWT-shaped error) rather than a transient blip. This used to
      // sign out unconditionally on that shape alone — but a 401 here isn't
      // proof the session is actually dead. It's also exactly what a request
      // whose Authorization header got dropped or mangled in transit looks
      // like: a privacy-focused browser's shields (e.g. Brave, or a strict
      // tracker-protection extension) rewriting/stripping headers on a
      // cross-origin fetch to the Supabase domain produces the same 401
      // shape as a genuinely revoked token, and previously this silently
      // signed the person out and dropped them back on the sign-in screen a
      // couple of seconds after a perfectly good login — with no
      // explanation, which is exactly what "logs in, then bounces back to
      // sign-in" looks like from the outside.
      //
      // So: ask Supabase directly whether the session is actually dead
      // (refreshSession() talks to the auth server, not just local state)
      // before taking the destructive step. Only a confirmed-invalid
      // refresh token justifies a forced sign-out; anything else — including
      // the refresh itself failing for a network/blocked-request reason —
      // falls through to the ordinary 'error' screen below, which has a
      // visible "Try again" instead of silently booting them.
      if (error && isRetry && isAuthError(error)) {
        const { error: refreshErr } = await supabase.auth.refreshSession()
        if (cancelled) return
        if (refreshErr && isAuthError(refreshErr)) {
          await supabase.auth.signOut()
          return
        }
        // Session is fine (or refreshSession itself just couldn't reach the
        // server) — don't sign out. Report it as a normal load error instead.
        setProfile(null)
        setProfileStatus('error')
        return
      }
      // No error, but no row either. Two very different causes, and they need
      // different answers:
      //
      //  (a) The account was deleted by an admin while this person was signed
      //      in. Their session is still valid, so nothing else notices.
      //  (b) handle_new_user warned instead of inserting (it swallows its own
      //      errors by design, so a signup can complete without a profile row)
      //      and the account has never had one.
      //
      // (b) is recoverable and (a) isn't, so try the recovery first:
      // ensure_profile() (schema-update-53) creates the row if and only if
      // it's missing, with approved/is_admin left at their defaults — so a
      // self-healed account still goes through FinishSignup and admin approval
      // like everyone else. If it comes back with a row, this was (b) and
      // they're now unstuck. If it doesn't, treat it as (a).
      if (!error && !data) {
        const { data: healed, error: healErr } = await supabase.rpc('ensure_profile')
        if (cancelled) return
        if (!healErr && healed) {
          setProfile(healed)
          setProfileStatus('ready')
          return
        }
        setProfile(null)
        setProfileStatus('deleted')
        return
      }
      // Still failing after the retry, for some reason that isn't auth and
      // isn't a missing row. Flagging it as an error rather than leaving
      // `profile` null is what keeps the approval gates below from being
      // skipped entirely.
      if (error) {
        setProfile(null)
        setProfileStatus('error')
        return
      }
      setProfile(data)
      setProfileStatus('ready')
    }
    load()
    return () => { cancelled = true }
  }, [sessionUserId, profileReloadKey])

  // Heartbeat: writes last_seen every few minutes while the app is open (and
  // once immediately on load/tab-refocus) — this is what powers the
  // "Recently online" sort and the green dot in the Old Boys directory.
  // Deliberately not realtime presence (that only knows who's connected
  // *right now* and forgets everyone the instant they close the tab) — a
  // persisted timestamp is what lets "recently online" mean something for
  // someone who was here 10 minutes ago too.
  //
  // Gated on approval, not just on having a session: this effect sits above
  // the render gates, so before it was gated it also ran for people stuck on
  // the FinishSignup and PendingVerification screens. Combined with the
  // directory not filtering on `approved` (fixed in DirectoryFilters.jsx),
  // that put half-finished accounts — blank name and all — in the
  // Old Boys list with a green "recently online" dot next to them.
  useEffect(() => {
    if (!session || !profile?.approved) return
    function beat() {
      supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', session.user.id).then(() => {})
    }
    beat()
    const interval = setInterval(beat, 2 * 60 * 1000)
    function onVisible() { if (document.visibilityState === 'visible') beat() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [session, profile?.approved])

  // First load after approval: instead of the old question-by-question
  // wizard, drop them straight onto their Profile page with every
  // still-empty field highlighted and the first one focused (Profile.jsx
  // reads the nav state). onboarding_complete is flipped immediately so
  // this only ever happens once — after that, the Home "Complete your
  // profile" button re-triggers the same highlighting on demand.
  useEffect(() => {
    if (!profile || checkedFirstRun) return
    if (!profile.consented_at || !profile.approved) return
    if (!profile.onboarding_complete) {
      supabase.from('profiles').update({ onboarding_complete: true }).eq('id', profile.id).then(() => {})
      setProfile((p) => (p ? { ...p, onboarding_complete: true } : p))
      navigate('/profile', { state: { highlightMissing: true, focusFirst: true } })
    }
    setCheckedFirstRun(true)
  }, [profile, checkedFirstRun]) // eslint-disable-line react-hooks/exhaustive-deps

  function openMessage(targetProfile, draftText = '') {
    setDmTarget(targetProfile)
    setDmDraft(draftText)
    setMessagesOpen(true)
  }

  // Used by the notification bell to jump straight to whatever the
  // notification was about — deep-linking to the specific post/event when
  // one is available (matching NotificationBell's ENTITY_TAB mapping),
  // rather than just landing generically at the top of that tab.
  function handleNotificationNavigate(target, entityType, entityId) {
    if (target === 'messages') { setMessagesOpen(true); return }
    if (entityId && entityType === 'post') { goTo(`/feed/${entityId}`); return }
    if (entityId && entityType === 'event') { goTo(`/events/${entityId}`); return }
    if (entityId && entityType === 'job') { goTo(`/jobs/${entityId}`); return }
    // Mentoring has no per-mentorship route — the pairing lives inside a tab
    // rather than at its own URL — so these deep-link to the tab that lists
    // them instead of dropping the person on Find a Mentor.
    if (entityType === 'mentorship') { goTo('/mentoring?tab=mine'); return }
    // ADMIN_TAB is included deliberately: new-signup notifications
    // (schema-update-46) point admins at 'admin', which isn't in TABS.
    // Without it those notifications were clickable but went nowhere.
    const tab = [...TABS, ADMIN_TAB].find((t) => t.id === target)
    if (tab) goTo(tab.path)
  }

  if (loading) return <div className="center-page">Loading…</div>
  if (recoveryMode) {
    return (
      <ResetPassword
        onDone={() => setRecoveryMode(false)}
        onCancel={async () => { setRecoveryMode(false); await supabase.auth.signOut() }}
      />
    )
  }
  if (!session) return <Auth initialError={authRedirectError} initialMode={authStartMode} />

  // Everything below this point assumes a loaded profile. These three
  // checks used to read `if (profile && …)`, which meant a null profile —
  // the exact thing the fetch above produces when it fails twice, or when
  // the row is missing — sailed past *both* approval gates and rendered the
  // entire app. Now an unresolved profile is its own state and stops here.
  if (profileStatus === 'loading') return <div className="center-page">Loading…</div>
  // Account removed while they were signed in. PendingVerification has always
  // handled this properly on its own screen; this is the same treatment for
  // everyone else.
  if (profileStatus === 'deleted') {
    return <AccountRemoved onSignOut={() => supabase.auth.signOut()} />
  }
  if (profileStatus === 'error' || !profile) {
    return (
      <ProfileLoadError
        onRetry={() => setProfileReloadKey((k) => k + 1)}
        onSignOut={() => supabase.auth.signOut()}
      />
    )
  }

  // Checked and turned down (schema-update-57). Before this existed there was
  // no way to say no: an admin could approve or permanently delete, so someone
  // the committee couldn't place sat on the "we're verifying you" screen
  // indefinitely, being promised an answer that was never coming. Says what
  // happened and how to challenge it — and the account is left intact, so an
  // admin can put them back to pending if it turns out to be our mistake.
  //
  // Checked FIRST, above the consent gate: the Admin UI only offers Decline on
  // finished signups, but a decline applied straight from the Supabase
  // dashboard doesn't go through that UI. Ordered the other way, such a person
  // would be walked through the whole FinishSignup form and only told the
  // answer afterwards.
  if (profile.declined_at) {
    return <AccountDeclined reason={profile.declined_reason} onSignOut={() => supabase.auth.signOut()} />
  }

  // Signed in but signup details/consent never captured — social-login
  // joiners land here first (they skipped the signup form entirely).
  if (!profile.consented_at) {
    return (
      <FinishSignup
        session={session}
        profile={profile}
        onDone={(updatedProfile) => setProfile(updatedProfile)}
      />
    )
  }

  // Locked out until the committee verifies them against residence
  // records — no browsing while pending. Enforced in the database too as
  // of schema-update-46: every SELECT policy now requires is_approved(),
  // so this screen is a real lock rather than just a screen.
  if (!profile.approved) {
    return <PendingVerification session={session} profile={profile} onProfileChange={setProfile} />
  }

  const navTabs = profile?.is_admin ? [...TABS, ADMIN_TAB] : TABS
  const activeTabId = navTabs.find((t) => location.pathname.startsWith(t.path))?.id
  // Desktop sidebar shows five core sections up front; everything else
  // (Mentoring/Events, plus Admin) collapses
  // behind a "More" toggle so the rail doesn't run long. Filtering
  // navTabs (rather than listing IDs in this order) keeps whatever order
  // TABS already defines.
  const primaryNavTabs = navTabs.filter((t) => PRIMARY_TAB_IDS.includes(t.id))
  const secondaryNavTabs = navTabs.filter((t) => !PRIMARY_TAB_IDS.includes(t.id))
  const isSecondaryActive = secondaryNavTabs.some((t) => t.id === activeTabId)
  // A manual More/Less click always wins; absent one, it auto-expands
  // whenever you're already on a page that lives inside "More".
  const moreNavVisible = moreNavOverride !== null ? moreNavOverride : isSecondaryActive

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <img src="/sacs-logo.png" alt="SACS logo" className="brand-logo" />
            <div>
              <span className="brand-name">SACS Alumni</span>
              <span className="brand-motto">Character · Style · Pride · Since 1961</span>
            </div>
          </div>

          <div className="masthead-actions">
            <button type="button"
              className="header-icon-btn"
              onClick={() => setMessagesOpen((o) => !o)}
              aria-label="Messages"
              title="Messages"
            >
              <MessagesIcon />
            </button>

            <NotificationBell session={session} onNavigate={handleNotificationNavigate} />

            {/* My profile lives here — top-right of the header — on every
                screen size now, instead of as a sidebar/hamburger entry.
                Clicking the avatar opens a small dropdown (Settings / Edit
                profile / Sign out) rather than navigating straight to the
                profile page. */}
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button type="button"
                className="header-avatar-btn"
                onClick={() => setProfileMenuOpen((o) => !o)}
                aria-label="Account menu"
                aria-expanded={profileMenuOpen}
              >
                <Avatar url={profile?.avatar_url} name={profile?.full_name} size={36} />
                <ChevronDownIcon />
              </button>

              {profileMenuOpen && (
                <div className="profile-menu-dropdown" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); goTo('/settings') }}>
                    <SettingsIcon /> Settings
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); goTo('/profile') }}>
                    <EditIcon /> Edit profile
                  </button>
                  <button type="button"
                    role="menuitem"
                    className="profile-menu-signout"
                    onClick={() => { setProfileMenuOpen(false); attemptNavigate(() => { setNavOpen(false); setConfirmingSignOut(true) }) }}
                  >
                    <SignOutIcon /> Sign out
                  </button>
                </div>
              )}
            </div>

            <button type="button"
              className="nav-toggle"
              onClick={() => setNavOpen((o) => !o)}
              aria-label={navOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={navOpen}
            >
              {navOpen ? <CloseIcon /> : <BurgerIcon />}
            </button>
          </div>
        </div>
      </header>


      {/* Full-width photo banner, sitting above the sidebar/content row so
          the sidebar no longer runs flush from the header all the way down
          the page — same idea as the Lions Connect reference layout. Image
          lives at /Sacs-High-School-Newlands-Cape-Town.webp in public/. No
          text overlay (matches the reference exactly — just the photo;
          brand name/motto already live in the header next to the logo). */}
      <div className="hero-banner">
        <img src="/sacs1.jpg" alt="" className="hero-banner-img" />
        <div className="hero-banner-overlay" />
      </div>

      <div className="app-body">
        {/* Persistent left sidebar on desktop (see .sidebar in styles.css).
            Hidden on mobile in favour of the existing bottom tab bar —
            navOpen/hamburger are currently unused on mobile (kept as-is
            from before this rework, harmless if never toggled there). */}
        <aside className="sidebar" aria-label="Main">
          <nav className="sidebar-nav">
            {primaryNavTabs.map((t) => {
              const Icon = t.icon
              return (
                <button type="button"
                  key={t.id}
                  className={activeTabId === t.id ? 'sidebar-link active' : 'sidebar-link'}
                  onClick={() => goTo(t.path)}
                >
                  <Icon /> {t.label}
                </button>
              )
            })}

            <button type="button"
              // Highlighted only when it's standing in for the active page —
              // i.e. collapsed, so Events/Mentoring/etc. isn't itself visible
              // in the list. Once expanded, the real link below carries the
              // "active" state instead, so only one thing is highlighted at
              // a time.
              className={isSecondaryActive && !moreNavVisible ? 'sidebar-link sidebar-more-toggle active' : 'sidebar-link sidebar-more-toggle'}
              onClick={() => setMoreNavOverride(!moreNavVisible)}
              aria-expanded={moreNavVisible}
            >
              <MoreIcon />
              {moreNavVisible ? 'Less' : 'More'}
              <ChevronDownIcon className={moreNavVisible ? 'sidebar-more-chevron open' : 'sidebar-more-chevron'} />
            </button>

            {moreNavVisible && (
              <div className="sidebar-more-list">
                {secondaryNavTabs.map((t) => {
                  const Icon = t.icon
                  return (
                    <button type="button"
                      key={t.id}
                      className={activeTabId === t.id ? 'sidebar-link active' : 'sidebar-link'}
                      onClick={() => goTo(t.path)}
                    >
                      <Icon /> {t.label}
                    </button>
                  )
                })}
              </div>
            )}
          </nav>
          <div className="sidebar-footer">
            <button type="button"
              className="sidebar-link signout"
              onClick={() => attemptNavigate(() => { setNavOpen(false); setConfirmingSignOut(true) })}
            >
              <SignOutIcon /> Sign out
            </button>
          </div>
        </aside>

        <div className="app-main">
          <main className="content">
            {/* Covers the brief fetch of a lazy route's chunk on first visit.
                Deliberately the same "Loading…" treatment the auth/profile
                gates above use, so a first navigation to Jobs looks like every
                other load in the app rather than like something broke. */}
            <Suspense fallback={<div className="center-page">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<Home session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/directory" element={<People session={session} onMessage={openMessage} onGoToProfile={() => goTo('/profile')} refetchTrigger={directoryRefetchTrigger} />} />
              <Route path="/feed" element={<Feed session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/feed/:postId" element={<Feed session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/mentoring" element={<Mentoring session={session} profile={profile} onProfileChange={setProfile} onMessage={openMessage} />} />
              <Route path="/events" element={<Events session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/events/:eventId" element={<Events session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/jobs" element={<Jobs session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/jobs/:jobId" element={<JobDetail session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/businesses" element={<BusinessDirectory session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/businesses/:businessId" element={<BusinessDetail session={session} profile={profile} onMessage={openMessage} />} />
              <Route path="/legends" element={<LegendsHall />} />
              <Route path="/legends/:legendId" element={<LegendProfile />} />
              <Route path="/donate" element={<Donate />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route
                path="/admin"
                element={profile?.is_admin ? <Admin session={session} /> : <Navigate to="/home" replace />}
              />
              <Route
                path="/profile"
                element={
                  <Profile
                    session={session}
                    profile={profile}
                    onSaved={(updated) => {
                      setProfile(updated)
                      setDirectoryRefetchTrigger((t) => t + 1)
                    }}
                    onDirtyChange={setProfileDirty}
                    saveRef={profileSaveRef}
                    onNavigateHome={() => goTo('/home')}
                  />
                }
              />
              <Route
                path="/settings"
                element={<Settings session={session} profile={profile} onSaved={setProfile} />}
              />
              <Route
                path="/people/:personId"
                element={<PersonProfile session={session} me={profile} onMessage={openMessage} />}
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </main>

          <footer className="footer">
            <img src="/sacs-logo.png" alt="SACS logo" className="footer-logo" />
            <div className="footer-text">
              <span>SACS Alumni Hub — unofficial community site run by alumni, for alumni.</span>
              <span className="footer-credit">
                Initiated and built by Kyle Trompeter —{' '}
                <a className="footer-link" href="mailto:kyletrompeter0@gmail.com">get in touch</a>
                {' · '}
                <button type="button" className="footer-link footer-link-btn" onClick={() => goTo('/donate')}>Support the house</button>
                {' · '}
                <button type="button" className="footer-link footer-link-btn" onClick={() => goTo('/privacy')}>Privacy Policy</button>.
              </span>
            </div>
          </footer>
        </div>
      </div>

      <nav className="mobile-tabbar" aria-label="Main">
        {MOBILE_TABS.map((t) => {
          const Icon = t.icon
          return (
            <button type="button"
              key={t.id}
              className={activeTabId === t.id ? 'mobile-tab active' : 'mobile-tab'}
              onClick={() => goTo(t.path)}
            >
              <Icon />
              <span>{t.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Mobile-only "everything else" menu — the bottom tab bar only has
          room for five core sections, so Mentoring/Business
          Directory (and Admin, when relevant) live behind the header
          hamburger instead. Same navTabs/activeTabId/goTo the desktop
          sidebar uses, just in a slide-in drawer (see .mobile-nav-panel). */}
      {navOpen && (
        <>
          <div className="mobile-nav-backdrop" onClick={() => setNavOpen(false)} />
          <aside className="mobile-nav-panel" aria-label="Main menu">
            <div className="mobile-nav-panel-header">
              <h3>Menu</h3>
              <button type="button" className="modal-close" onClick={() => setNavOpen(false)} aria-label="Close menu">×</button>
            </div>
            <nav className="sidebar-nav">
              {navTabs.map((t) => {
                const Icon = t.icon
                return (
                  <button type="button"
                    key={t.id}
                    className={activeTabId === t.id ? 'sidebar-link active' : 'sidebar-link'}
                    onClick={() => goTo(t.path)}
                  >
                    <Icon /> {t.label}
                  </button>
                )
              })}
            </nav>
            <div className="sidebar-footer">
              <button type="button"
                className="sidebar-link signout"
                onClick={() => attemptNavigate(() => { setNavOpen(false); setConfirmingSignOut(true) })}
              >
                <SignOutIcon /> Sign out
              </button>
            </div>
          </aside>
        </>
      )}

      <FloatingMessages
        session={session}
        profile={profile}
        open={messagesOpen}
        onOpenChange={setMessagesOpen}
        initialTarget={dmTarget}
        initialDraft={dmDraft}
        onTargetConsumed={() => { setDmTarget(null); setDmDraft('') }}
        onBrowseDirectory={() => {
          setMessagesOpen(false)
          goTo('/directory')
        }}
      />

      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out?"
          message="You'll need to sign back in to post, message, or view your profile."
          confirmLabel="Sign out"
          onConfirm={() => { setConfirmingSignOut(false); supabase.auth.signOut() }}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}

      {pendingNav && (
        <div
          className="modal-backdrop"
          onClick={keepEditing}
          role="dialog"
          aria-modal="true"
          aria-label="Unsaved changes"
        >
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Unsaved changes</h2>
              <button type="button" className="modal-close" onClick={keepEditing} aria-label="Keep editing">×</button>
            </div>
            <div className="modal-body">
              <p>You've made changes to your profile that haven't been saved yet. Save them before you go?</p>
              {leaveError && <p className="form-error">{leaveError}</p>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn ghost" onClick={keepEditing} disabled={leaveBusy}>Keep editing</button>
              <button type="button" className="btn ghost" onClick={confirmDiscardAndLeave} disabled={leaveBusy} style={{ color: 'var(--error)' }}>
                Discard changes
              </button>
              <button type="button" className="btn primary" onClick={confirmSaveAndLeave} disabled={leaveBusy}>
                {leaveBusy ? 'Saving…' : 'Save & leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Shown when there's a valid session but the profile row couldn't be
// loaded — a repeated fetch failure, or (rarely) no row at all because
// handle_new_user warned and continued instead of aborting the signup.
// Deliberately a dead end with two ways out rather than a silent
// fall-through: the previous behaviour rendered the whole signed-in app
// with profile === null, which looked like the site was broken and, for
// anyone not yet approved, showed them past the verification gate.
function ProfileLoadError({ onRetry, onSignOut }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">We couldn't load your profile</h1>
        <p className="auth-verify-note">
          Your account is fine — we just couldn't reach it this time. This is
          usually a brief connection problem, so trying again normally sorts
          it. If it keeps happening,{' '}
          <a className="footer-link" href="mailto:kyletrompeter0@gmail.com">let us know</a>.
        </p>
        <button type="button" className="btn primary wide" onClick={onRetry}>Try again</button>
        <button type="button" className="link-btn" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}

// Shown when the session is valid but the profile row is definitively gone —
// i.e. an admin deleted the account while this person was signed in, and
// ensure_profile() didn't recreate it.
//
// Deliberately not the ProfileLoadError screen. That one says "Your account is
// fine — we just couldn't reach it this time" and offers Try again, which for
// a deleted account is both untrue and an infinite loop. Saying plainly what
// happened, and giving them a way to query it, is the difference between "the
// site is broken" and "something happened to my account".
function AccountRemoved({ onSignOut }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">This account is no longer registered</h1>
        <p className="auth-verify-note">
          It looks like it was removed by an administrator. If you think that&rsquo;s
          a mistake, get in touch and we&rsquo;ll sort it out &mdash;{' '}
          <a className="footer-link" href="mailto:kyletrompeter0@gmail.com?subject=SACS%20Alumni%20%E2%80%94%20my%20account%20was%20removed">
            email an admin
          </a>.
        </p>
        <button type="button" className="btn primary wide" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}

// Shown when an admin has checked someone against residence records and
// couldn't place them (profiles.declined_at, schema-update-57).
//
// Deliberately not the PendingVerification screen with different words. That
// one says an answer is coming; this one is the answer. It's also deliberately
// not a dead end — the overwhelming majority of these will be older years
// where the records are patchy or a surname has changed, so the whole point of
// the screen is the route back to a human.
function AccountDeclined({ reason, onSignOut }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/sacs-logo.png" alt="SACS logo" className="auth-logo" />
        <h1 className="auth-title">We couldn&rsquo;t verify your account</h1>
        <p className="auth-verify-note">
          Every new account is checked against SACS residence records before
          anyone is let in, and we weren&rsquo;t able to match yours.
        </p>
        {reason ? <p className="auth-verify-note"><strong>What we were told:</strong> {reason}</p> : null}
        <p className="auth-verify-note">
          That&rsquo;s often our records rather than you &mdash; the older years in
          particular are patchy, and names change. If you did live in SACS,
          get in touch with the years you were there and anyone who&rsquo;d vouch
          for you, and we&rsquo;ll take another look.
        </p>
        <p className="auth-verify-contact">
          <a
            className="footer-link"
            href={`mailto:kyletrompeter0@gmail.com?subject=${encodeURIComponent('SACS Alumni — please recheck my account')}`}
          >
            Email an admin
          </a>
        </p>
        <button type="button" className="btn primary wide" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}

/* ---------- Mobile nav icons ---------- */
function BurgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/* ---------- Mobile bottom tab bar icons ---------- */
function PeopleIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8" r="3.2" />
      <path d="M2.5 19.5c0-3.3 2.7-5.7 6-5.7s6 2.4 6 5.7" />
      <circle cx="17" cy="8.5" r="2.6" />
      <path d="M15.6 13.9c2.6.3 4.4 2.3 4.4 5" />
    </svg>
  )
}
function JobsIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7.5" width="18" height="12" rx="2" />
      <path d="M8.5 7.5V6a2.5 2.5 0 0 1 2.5-2.5h2A2.5 2.5 0 0 1 15 6v1.5" />
      <path d="M3 12.5h18" />
    </svg>
  )
}
function FeedIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M7.5 13.5h4M7.5 16.5h9" />
    </svg>
  )
}
function EventsIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
      <circle cx="8.3" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* ---------- Sidebar-only icons ---------- */
function HomeIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5L12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
    </svg>
  )
}
function MentoringIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 10a5 5 0 1 1 3.5 4.77L8 17v-2.5H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2" />
      <path d="M14 14a5 5 0 0 0 4.9-4H21a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-1v2.5l-3-2.34" />
    </svg>
  )
}
function BusinessIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V9.5l8-5 8 5V21" />
      <path d="M4 21h16" />
      <path d="M9.5 21v-6a2.5 2.5 0 0 1 5 0v6" />
      <path d="M8 12.5h.01M16 12.5h.01" />
    </svg>
  )
}
function AdminIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.6-3 8.4-7 10-4-1.6-7-5.4-7-10V6z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  )
}
function SignOutIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
function MessagesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
function ChevronDownIcon({ className }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a1.8 1.8 0 0 0 .36 1.98l.07.07a2.16 2.16 0 1 1-3.06 3.06l-.07-.07a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65v.2a2.16 2.16 0 1 1-4.32 0v-.1a1.8 1.8 0 0 0-1.17-1.65 1.8 1.8 0 0 0-1.98.36l-.07.07a2.16 2.16 0 1 1-3.06-3.06l.07-.07a1.8 1.8 0 0 0 .36-1.98 1.8 1.8 0 0 0-1.65-1.1h-.2a2.16 2.16 0 1 1 0-4.32h.1a1.8 1.8 0 0 0 1.65-1.17 1.8 1.8 0 0 0-.36-1.98l-.07-.07a2.16 2.16 0 1 1 3.06-3.06l.07.07a1.8 1.8 0 0 0 1.98.36h.09a1.8 1.8 0 0 0 1.1-1.65v-.2a2.16 2.16 0 1 1 4.32 0v.1a1.8 1.8 0 0 0 1.1 1.65h.09a1.8 1.8 0 0 0 1.98-.36l.07-.07a2.16 2.16 0 1 1 3.06 3.06l-.07.07a1.8 1.8 0 0 0-.36 1.98v.09a1.8 1.8 0 0 0 1.65 1.1h.2a2.16 2.16 0 1 1 0 4.32h-.1a1.8 1.8 0 0 0-1.65 1.1z" />
    </svg>
  )
}
function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  )
}
