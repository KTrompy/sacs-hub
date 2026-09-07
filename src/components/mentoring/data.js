import { supabase } from '../../supabaseClient'

// Every field the redesigned mentoring pages need, gathered in one place so
// each page imports one thing rather than re-typing column lists. Kept
// separate from the old Mentoring.jsx's PERSON_FIELDS/MENTORSHIP_FIELDS
// constants (that file is gone) but pulls from the same underlying columns —
// see schema-update-64's header comment for what's new vs. untouched.

export const PERSON_FIELDS =
  'id, full_name, avatar_url, grad_year, degree, industry, occupation, company, city, country, ' +
  'linkedin_url, bio, expertise, services_offered, business_website, ' +
  'availability, geographic_focus, is_open_to_opportunities, ' +
  'seeking_mentor, mentee_goals, mentee_note, mentor_capacity, mentor_paused'

export const MENTORING_PROFILE_FIELDS =
  'profile_id, quick_questions_enabled, conversations_enabled, mentorships_enabled, ' +
  'mentor_paused_until, guidance_goal, pref_experience, pref_international, pref_local, ' +
  'pref_same_industry, pref_seniority, onboarding_completed_at'

export const MENTORSHIP_FIELDS =
  'id, mentor_id, mentee_id, initiated_by, status, request_message, response_message, ' +
  'focus, cadence, duration_months, expected_length, closing_note, decline_reason, outcome, reflection, ' +
  'requested_at, responded_at, started_at, review_at, ended_at, ended_by, ' +
  'last_interaction_at, next_interaction_at, next_action, next_action_owner'

export const CONNECTION_FIELDS =
  'id, requester_id, recipient_id, kind, message, duration_minutes, status, reply, ' +
  'scheduled_at, created_at, responded_at, expires_at'

export const GOAL_FIELDS = 'id, mentorship_id, title, detail, status, target_date, created_by, created_at, completed_at, owner'
export const ACTION_FIELDS = 'id, mentorship_id, title, owner, due_date, completed_at, created_from_session, created_by, created_at'
export const SESSION_FIELDS =
  'id, mentorship_id, logged_by, met_on, duration_minutes, notes, next_steps, next_session_on, ' +
  'created_at, next_conversation_at, next_step_owner'
export const TERMS_FIELDS = 'id, mentorship_id, proposed_by, cadence, expected_length, focus, note, created_at'

// Fetches everything the Overview/Discover pages need in parallel. Mirrors
// the old load()'s shape (one round trip per table, merged client-side)
// rather than a single RPC, matching how the rest of this codebase's list
// pages work.
export async function loadMentoringData(myId) {
  await supabase.auth.getSession()

  const [people, allMentoringProfiles, mentorships, connections, counts, saved] = await Promise.all([
    supabase.from('profiles').select(PERSON_FIELDS)
      .or('is_open_to_opportunities.eq.true,seeking_mentor.eq.true')
      .neq('id', myId),
    // Every member's mentoring_profiles row, not just mine — the "Anyone can
    // read mentoring profiles" policy is approved-wide, not owner-scoped,
    // because a person card needs someone else's quick-question/conversation
    // toggles and pause state to know what to offer, same reasoning as
    // mentor_load being public.
    supabase.from('mentoring_profiles').select(MENTORING_PROFILE_FIELDS),
    supabase.from('mentorships').select(MENTORSHIP_FIELDS)
      .or(`mentor_id.eq.${myId},mentee_id.eq.${myId}`)
      .order('requested_at', { ascending: false }),
    supabase.from('mentorship_connections').select(CONNECTION_FIELDS)
      .or(`requester_id.eq.${myId},recipient_id.eq.${myId}`)
      .order('created_at', { ascending: false }),
    supabase.rpc('mentor_load'),
    supabase.from('saved_mentors').select('id, saved_profile_id, notify_when_available').eq('profile_id', myId),
  ])

  if (people.error || mentorships.error || connections.error) {
    return { error: true }
  }

  const countMap = {}
  for (const row of counts.data || []) countMap[row.mentor_id] = row.active_count

  const mpMap = {}
  for (const row of allMentoringProfiles.data || []) mpMap[row.profile_id] = row

  return {
    error: false,
    people: (people.data || []).map((p) => ({
      ...p,
      active_mentorships: countMap[p.id] || 0,
      mentoringProfile: mpMap[p.id] || null,
    })),
    myMentoringProfile: mpMap[myId] || null,
    mentorships: mentorships.data || [],
    connections: connections.data || [],
    savedIds: new Set((saved.data || []).map((s) => s.saved_profile_id)),
    savedRows: saved.data || [],
  }
}

// Missing-row upsert — every write to mentoring_profiles goes through this so
// callers never have to branch on "does a row exist yet".
export async function saveMentoringProfile(myId, patch) {
  return supabase.from('mentoring_profiles').upsert({ profile_id: myId, ...patch }).select().maybeSingle()
}

// One mentorship's whole workspace in parallel — goals, actions, sessions,
// and any proposed terms (only ever non-empty while status is 'discussing').
export async function loadWorkspaceData(mentorshipId) {
  const [goals, actions, sessions, terms] = await Promise.all([
    supabase.from('mentorship_goals').select(GOAL_FIELDS).eq('mentorship_id', mentorshipId).order('created_at', { ascending: true }),
    supabase.from('mentorship_actions').select(ACTION_FIELDS).eq('mentorship_id', mentorshipId).order('created_at', { ascending: true }),
    supabase.from('mentorship_sessions').select(SESSION_FIELDS).eq('mentorship_id', mentorshipId).order('met_on', { ascending: false }),
    supabase.from('mentorship_terms').select(TERMS_FIELDS).eq('mentorship_id', mentorshipId).order('created_at', { ascending: false }).limit(1),
  ])
  return {
    error: !!(goals.error || actions.error || sessions.error || terms.error),
    goals: goals.data || [],
    actions: actions.data || [],
    sessions: sessions.data || [],
    latestTerms: (terms.data || [])[0] || null,
  }
}

export function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || 'them'
}

export function fmtDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function daysSince(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

export const CADENCE_OPTIONS = ['Every few weeks', 'Monthly', 'Occasionally', 'Not sure yet']
export const EXPECTED_LENGTH_OPTIONS = [
  { value: 'few_months', label: 'A few months' },
  { value: 'six_months', label: 'Around 6 months' },
  { value: 'longer_term', label: 'Longer term' },
  { value: 'decide_together', label: "Let's decide together" },
]
export const EXPECTED_LENGTH_LABEL = Object.fromEntries(EXPECTED_LENGTH_OPTIONS.map((o) => [o.value, o.label]))

// Relationship health — computed client-side from the fields the session
// trigger keeps up to date, rather than a stored "score". Only ever renders
// as one of three human words.
export function mentorshipHealth(m) {
  if (m.status !== 'active') return null
  const anchor = m.last_interaction_at || m.started_at
  const days = daysSince(anchor)
  if (m.next_interaction_at && new Date(m.next_interaction_at) > new Date()) return 'healthy'
  if (days === null) return 'healthy'
  if (days >= 45) return 'inactive'
  if (days >= 30) return 'attention'
  return 'healthy'
}

export const HEALTH_LABEL = { healthy: 'Healthy', attention: 'Needs attention', inactive: 'Inactive' }

export const OUTCOME_OPTIONS = [
  { value: 'achieved', label: 'We achieved what we set out to do' },
  { value: 'natural_stop', label: "It's reached a natural stopping point" },
  { value: 'not_right_fit', label: "It wasn't quite the right fit" },
]
export const OUTCOME_LABEL = Object.fromEntries(OUTCOME_OPTIONS.map((o) => [o.value, o.label]))

export const CHECKIN_OPTIONS = [
  { value: 'very_useful', label: 'Very useful' },
  { value: 'useful', label: 'Useful' },
  { value: 'needs_adjustment', label: 'Could use some adjustment' },
  { value: 'ready_to_wrap', label: "I'm about ready to wrap up" },
]

// Which chair *I* sit in for a given mentorship row.
export function myRole(m, myId) { return m.mentor_id === myId ? 'mentor' : 'mentee' }
export function otherId(m, myId) { return m.mentor_id === myId ? m.mentee_id : m.mentor_id }

// otherPersonId -> the one live mentorship (if any) with them, so a person
// card can show "Request pending" / "Discussing terms" instead of offering
// a Connect the backend would reject as a duplicate.
export function liveMentorshipMap(mentorships, myId) {
  const map = {}
  for (const m of mentorships) {
    if (m.status !== 'pending' && m.status !== 'discussing' && m.status !== 'active') continue
    map[otherId(m, myId)] = m
  }
  return map
}

// Same idea for the lighter-weight connections tier.
export function openConnectionMap(connections, myId) {
  const map = {}
  for (const c of connections) {
    if (c.status !== 'sent' && c.status !== 'scheduled') continue
    const other = c.requester_id === myId ? c.recipient_id : c.requester_id
    map[other] = c
  }
  return map
}

export function friendlyError(err) {
  const code = err?.code
  const msg = err?.message || ''
  if (code === '23505' || msg.includes('already have a request')) {
    return 'You already have a request or an active mentorship with this member.'
  }
  if (msg.includes('AT_CAPACITY')) return 'This mentor is already at their limit of active mentorships.'
  if (msg.includes('NOT_AVAILABLE')) return "That member isn't taking these right now."
  if (msg.includes('TOO_MANY_OPEN')) {
    return "You have several unanswered requests already — you'll usually get better results waiting for those to land before sending more."
  }
  if (code === '54000') return msg.replace(/^.*?:\s*/, '')
  if (code === '42501') return msg || 'You don’t have permission to do that.'
  return msg || 'Something went wrong — please try again.'
}
