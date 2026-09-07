// Shared profile-completion scoring — the single source of truth for "how
// complete is this profile" used by both the Home page (progress ring,
// hero CTA, once-a-day nudge modal) and the Edit Profile completion card.
// Extracted from Home.jsx so the two surfaces can never drift out of sync
// on which fields count or what they're called. The logic itself is
// unchanged from before this file existed — this is a relocation, not a
// behavior change.

// The ten fields that actually make a profile useful to other Old Boys
// (who you are, what you do, where you are, how to reach you) — not every
// column on the `profiles` table.
export const COMPLETION_FIELDS = [
  'avatar_url', 'bio', 'occupation', 'company', 'city', 'country',
  'grad_year', 'degree', 'industry', 'linkedin_url',
]

// Human-readable labels for the same ten fields — shared by the Home nudge
// modal and the Edit Profile completion card.
export const COMPLETION_FIELD_LABELS = {
  avatar_url: 'Add a profile photo',
  bio: 'Write a short bio',
  occupation: 'Add your occupation',
  company: 'Add your company',
  city: 'Add your city',
  country: 'Add your country',
  grad_year: 'Add your graduation year',
  degree: 'Add your degree',
  industry: 'Add your industry',
  linkedin_url: 'Link your LinkedIn',
}

// Which Edit Profile section a given completion field lives in — lets the
// completion card's missing-item list jump straight to the right section
// instead of just naming the field.
export const COMPLETION_FIELD_SECTION = {
  avatar_url: 'overview',
  bio: 'about',
  occupation: 'career',
  company: 'career',
  city: 'location',
  country: 'location',
  grad_year: 'about',
  degree: 'about',
  industry: 'career',
  linkedin_url: 'contact',
}

export function isFieldFilled(profile, f) {
  const v = profile?.[f]
  return v !== null && v !== undefined && String(v).trim() !== ''
}

export function completionPercent(profile) {
  if (!profile) return 0
  const filled = COMPLETION_FIELDS.filter((f) => isFieldFilled(profile, f)).length
  return Math.round((filled / COMPLETION_FIELDS.length) * 100)
}

export function missingCompletionFields(profile) {
  if (!profile) return []
  return COMPLETION_FIELDS.filter((f) => !isFieldFilled(profile, f))
}
