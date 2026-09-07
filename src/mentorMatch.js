import { normalizeExpertise } from './utils.js'

// Matching, rebuilt around three stages: eligibility (can this pairing even
// happen), purpose fit (does their experience answer your actual need), and
// preference weighting (what you said would make someone especially useful
// to you). The score itself is never shown anywhere — only the reasons it
// produced, in the person's own words wherever possible. See docs/ADMIN_PAGE
// -style comments throughout: every number here should be explainable in one
// short sentence a member would find persuasive, not just true.

// A small, hand-built taxonomy so related topics contribute to matching
// without a database table. Deliberately shallow — a handful of clusters
// that come up constantly in an alumni network, not an attempt at a
// universal ontology. Keys and values are matched case-insensitively.
const TOPIC_CLUSTERS = [
  ['fundraising', 'venture capital', 'angel investment', 'pitching', 'financial modelling', 'startups', 'entrepreneurship'],
  ['startups', 'entrepreneurship', 'starting a business', 'scaling', 'founder', 'business strategy'],
  ['career direction', 'career transition', 'changing industries', 'job search', 'interview preparation'],
  ['leadership', 'management', 'people management', 'executive coaching', 'board & advisory roles'],
  ['working overseas', 'international experience', 'relocation', 'immigration'],
  ['finance', 'investment banking', 'private equity', 'asset management', 'accounting'],
  ['engineering', 'technology', 'software development', 'product management', 'data science'],
  ['law', 'legal', 'commercial law', 'compliance'],
  ['university decisions', 'postgraduate study', 'further study'],
  ['marketing', 'branding', 'communications', 'public relations'],
  ['sales', 'business development', 'client relationships'],
  ['consulting', 'management consulting', 'strategy consulting'],
]

function lower(v) { return String(v || '').trim().toLowerCase() }

function clusterMates(topic) {
  const t = lower(topic)
  const out = new Set()
  for (const cluster of TOPIC_CLUSTERS) {
    if (cluster.some((c) => c === t)) cluster.forEach((c) => out.add(c))
  }
  return out
}

// Topic overlap that also credits related-but-not-identical topics at a
// discount, so "Fundraising" and "Venture capital" count for something even
// when neither list uses the other's exact words.
function topicFit(want, have) {
  const wantList = normalizeExpertise(want)
  const haveSet = new Set(normalizeExpertise(have).map(lower))
  if (wantList.length === 0 || haveSet.size === 0) return { exact: [], related: [] }

  const exact = []
  const related = []
  for (const w of wantList) {
    const wl = lower(w)
    if (haveSet.has(wl)) { exact.push(w); continue }
    const mates = clusterMates(wl)
    if ([...mates].some((m) => haveSet.has(m))) related.push(w)
  }
  return { exact, related }
}

function listPhrase(items, max = 2) {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length
  const joined = shown.length === 2 ? `${shown[0]} and ${shown[1]}` : shown[0]
  return rest > 0 ? `${joined} +${rest} more` : joined
}

// Stage 1 — eligibility. Nothing below should ever be scored or shown as a
// recommendation if it fails here; a low score still shows (alumni networks
// are small enough that hiding people is worse than ordering them badly),
// but an ineligible pairing genuinely can't happen.
export function eligibleForMentorship(me, them) {
  if (!them || !me || them.id === me.id) return false
  if (!them.is_open_to_opportunities) return false
  return true
}

export function eligibleForGuidanceFrom(me, them) {
  // "them" is a potential mentee, from a mentor's point of view.
  if (!them || !me || them.id === me.id) return false
  return !!them.seeking_mentor
}

// How much room a mentor has left, and what they're actually open to right
// now. `active_mentorships` is attached by the caller from a single grouped
// count query rather than fetched per card.
export function mentorAvailability(person, mentoringProfile) {
  const mp = mentoringProfile || {}
  const capacity = Number(person?.mentor_capacity) || 2
  const active = Number(person?.active_mentorships) || 0
  const pausedUntil = mp.mentor_paused_until ? new Date(mp.mentor_paused_until) : null
  const stillPaused = pausedUntil ? pausedUntil.getTime() > Date.now() : !!person?.mentor_paused
  return {
    capacity,
    active,
    paused: stillPaused,
    hasRoom: !stillPaused && active < capacity,
    spotsLeft: Math.max(0, capacity - active),
    quickQuestions: mp.quick_questions_enabled !== false,
    conversations: mp.conversations_enabled !== false,
    mentorships: mp.mentorships_enabled !== false,
  }
}

// Stage 2 + 3 — purpose fit and experience relevance, modified by the
// asker's stated preferences. Returns a score (internal only) and a short
// list of human reasons, strongest first.
export function scoreMentor(me, them, myMentoringProfile) {
  let score = 0
  const reasons = []
  const prefs = myMentoringProfile || {}

  // Purpose fit — the strongest signal by a distance.
  const goals = me?.mentee_goals
  const { exact, related } = topicFit(goals, them?.expertise)
  if (exact.length > 0) {
    score += Math.min(exact.length, 3) * 18
    reasons.push({ key: 'goals', label: `Can help with ${listPhrase(exact)}`, strong: true })
  }
  if (related.length > 0 && exact.length < 2) {
    score += Math.min(related.length, 2) * 8
    reasons.push({ key: 'related', label: `Has related experience in ${listPhrase(related)}` })
  }

  // Experience relevance — industry, occupation, career stage. Weighted by
  // what the person said would make someone especially useful to them,
  // rather than fixed weights for everyone.
  const industryMatch = me?.industry && them?.industry && lower(me.industry) === lower(them.industry)
  if (industryMatch && (prefs.pref_same_industry !== false)) {
    score += prefs.pref_same_industry ? 22 : 14
    reasons.push({ key: 'industry', label: `Also in ${them.industry}` })
  }

  const myYear = Number(me?.grad_year)
  const theirYear = Number(them?.grad_year)
  if (myYear && theirYear) {
    const gap = theirYear - myYear
    if (gap <= -3 && gap >= -35) {
      const weight = prefs.pref_seniority ? 20 : 12
      score += weight
      reasons.push({ key: 'experience', label: `${Math.abs(gap)} years ahead of you at your career stage` })
    }
  }

  if (prefs.pref_local !== false) {
    if (me?.city && them?.city && lower(me.city) === lower(them.city)) {
      score += prefs.pref_local ? 16 : 6
      reasons.push({ key: 'location', label: `Both in ${them.city}` })
    }
  }

  if (prefs.pref_international && (them?.geographic_focus || '').toLowerCase().includes('international')) {
    score += 14
    reasons.push({ key: 'international', label: 'Has international experience' })
  }

  if (prefs.pref_experience !== false && (them?.bio || '').trim().length > 60) {
    score += 4
  }

  const avail = mentorAvailability(them, them.mentoringProfile)
  if (avail.paused) {
    score = Math.round(score * 0.5)
  } else if (avail.hasRoom) {
    score += 8
  } else {
    score = Math.round(score * 0.6)
  }

  return { score, reasons: reasons.slice(0, 3), availability: avail }
}

// Ranking a potential mentee, from a mentor's point of view — the mirror of
// scoreMentor, using the mentor's own stated expertise as the "want" side.
export function scoreMentee(me, them) {
  let score = 0
  const reasons = []

  const { exact, related } = topicFit(me?.expertise, them?.mentee_goals)
  if (exact.length > 0) {
    score += Math.min(exact.length, 3) * 18
    reasons.push({ key: 'goals', label: `You can help with ${listPhrase(exact)}`, strong: true })
  }
  if (related.length > 0 && exact.length < 2) {
    score += Math.min(related.length, 2) * 8
    reasons.push({ key: 'related', label: `Related to what you offer: ${listPhrase(related)}` })
  }

  if (me?.industry && them?.industry && lower(me.industry) === lower(them.industry)) {
    score += 14
    reasons.push({ key: 'industry', label: `Also in ${them.industry}` })
  }

  if ((them?.mentee_note || '').trim().length > 40) {
    score += 8
    reasons.push({ key: 'note', label: 'Wrote about what they need' })
  }

  return { score, reasons: reasons.slice(0, 3) }
}

export function tierFor(score) {
  if (score >= 55) return 'strong'
  if (score >= 30) return 'good'
  return null
}

export const TIER_LABEL = { strong: 'Excellent fit', good: 'Good fit' }

export function byScore(a, b) {
  if (b.match.score !== a.match.score) return b.match.score - a.match.score
  return String(a.full_name || '').localeCompare(String(b.full_name || ''))
}

// Backward-compatible alias — mirrors the old mentorHeadroom name used
// elsewhere before this rewrite, now backed by the richer availability model.
export function mentorHeadroom(person, mentoringProfile) {
  return mentorAvailability(person, mentoringProfile)
}
