import { normalizeExpertise } from './utils.js'

// Ranking for Find a Mentor / Find a Mentee.
//
// The old page listed everyone who had flipped one toggle, in whatever order
// Postgres handed them back. With a handful of members that is fine; with a
// few hundred it is a wall of strangers, and the person who would actually
// have been useful to you is on page three.
//
// Scoring is deliberately plain arithmetic rather than anything clever. Two
// reasons: it runs on data already in memory (no extra round trip, and no
// server-side ranking to keep in sync), and every point is explainable — the
// UI shows the *reasons*, not the number, because "Can help with Fundraising
// and Pricing" persuades someone to reach out and "83% match" does not.
//
// Nothing here is a hard filter. A low score still shows, just further down:
// alumni networks are small enough that hiding people is worse than ordering
// them badly.

const AVAILABILITY_POINTS = {
  'Available now': 10,
  'Part-time available': 7,
  'By request/ad-hoc': 4,
  'Fully booked': 0,
}

function lower(list) {
  return (list || []).filter(Boolean).map((s) => String(s).trim().toLowerCase())
}

// Case-insensitive intersection that returns the *original* casing from the
// first list, so reasons read the way the person typed them.
function overlap(a, b) {
  const bSet = new Set(lower(b))
  const seen = new Set()
  const out = []
  for (const item of a || []) {
    if (!item) continue
    const key = String(item).trim().toLowerCase()
    if (bSet.has(key) && !seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

function listPhrase(items, max = 2) {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length
  const joined = shown.length === 2 ? `${shown[0]} and ${shown[1]}` : shown[0]
  if (rest > 0) return `${joined} +${rest} more`
  return joined
}

// The half of the score that doesn't care which chair anyone is sitting in.
function commonSignals(me, them, { seniorIsThem }) {
  let score = 0
  const reasons = []

  if (me?.industry && them?.industry && me.industry === them.industry) {
    score += 20
    reasons.push({ key: 'industry', label: `Also in ${them.industry}` })
  }

  // Experience gap. Same-year peers can be great sounding boards but they are
  // not what someone means by "mentor", so a gap in the wrong direction
  // simply scores nothing rather than going negative — plenty of people
  // haven't filled in a grad year at all, and punishing them for a blank
  // field would bury them under everyone who did.
  const myYear = Number(me?.grad_year)
  const theirYear = Number(them?.grad_year)
  if (myYear && theirYear) {
    const gap = seniorIsThem ? myYear - theirYear : theirYear - myYear
    if (gap >= 5 && gap <= 30) {
      score += 15
      reasons.push({
        key: 'experience',
        label: seniorIsThem ? `${gap} years ahead of you` : `${gap} years behind you`,
      })
    } else if (gap >= 1) {
      score += 8
    }
  }

  if (me?.city && them?.city && me.city.trim().toLowerCase() === them.city.trim().toLowerCase()) {
    score += 10
    reasons.push({ key: 'location', label: `Both in ${them.city}` })
  } else if (me?.country && them?.country && me.country === them.country) {
    score += 4
  }

  return { score, reasons }
}

// Ranking a potential mentor, from the mentee's point of view.
export function scoreMentor(me, them) {
  let score = 0
  const reasons = []

  // The strongest signal by a distance: they have said they can help with the
  // exact thing you have said you want help with.
  const goals = normalizeExpertise(me?.mentee_goals)
  const canHelp = overlap(goals, normalizeExpertise(them?.expertise))
  if (canHelp.length > 0) {
    score += Math.min(canHelp.length, 3) * 15
    reasons.push({ key: 'goals', label: `Can help with ${listPhrase(canHelp)}`, strong: true })
  }

  const common = commonSignals(me, them, { seniorIsThem: true })
  score += common.score
  reasons.push(...common.reasons)

  score += AVAILABILITY_POINTS[them?.availability] ?? 3

  const room = mentorHeadroom(them)
  if (room.paused) {
    // Not hidden — someone may still want to see them and come back later —
    // but never suggested ahead of a mentor who can actually say yes.
    score = Math.round(score * 0.4)
  } else if (room.hasRoom) {
    score += 10
    if (room.active === 0) reasons.push({ key: 'capacity', label: 'Not mentoring anyone yet' })
  } else {
    score = Math.round(score * 0.5)
  }

  return { score, reasons: reasons.slice(0, 3), tier: tierFor(score) }
}

// Ranking a potential mentee, from the mentor's point of view.
export function scoreMentee(me, them) {
  let score = 0
  const reasons = []

  const theirGoals = normalizeExpertise(them?.mentee_goals)
  const canHelp = overlap(normalizeExpertise(me?.expertise), theirGoals)
  if (canHelp.length > 0) {
    score += Math.min(canHelp.length, 3) * 15
    reasons.push({ key: 'goals', label: `You can help with ${listPhrase(canHelp)}`, strong: true })
  }

  const common = commonSignals(me, them, { seniorIsThem: false })
  score += common.score
  reasons.push(...common.reasons)

  // A mentee who wrote something about what they're after has already put in
  // more effort than one who ticked a box, and is a better bet for a mentor
  // deciding where to spend a limited number of hours.
  if ((them?.mentee_note || '').trim().length > 40) {
    score += 8
    reasons.push({ key: 'note', label: 'Wrote about what they need' })
  }

  return { score, reasons: reasons.slice(0, 3), tier: tierFor(score) }
}

function tierFor(score) {
  if (score >= 55) return 'strong'
  if (score >= 30) return 'good'
  return null
}

export const TIER_LABEL = { strong: 'Strong match', good: 'Good match' }

// How much room a mentor has left. `active_mentorships` is attached by
// Mentoring.jsx from a single grouped count query rather than fetched per
// card — see the note there.
export function mentorHeadroom(mentor) {
  const capacity = Number(mentor?.mentor_capacity) || 2
  const active = Number(mentor?.active_mentorships) || 0
  return {
    capacity,
    active,
    paused: !!mentor?.mentor_paused,
    hasRoom: !mentor?.mentor_paused && active < capacity,
    spotsLeft: Math.max(0, capacity - active),
  }
}

// Sort helper: score first, then a stable tiebreak so the list doesn't
// reshuffle between renders for people who happen to score identically.
export function byScore(a, b) {
  if (b.match.score !== a.match.score) return b.match.score - a.match.score
  return String(a.full_name || '').localeCompare(String(b.full_name || ''))
}
