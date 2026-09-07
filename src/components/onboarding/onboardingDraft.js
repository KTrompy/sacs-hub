// Shared draft persistence for the unified onboarding wizard.
//
// Two callers, two key schemes, one implementation:
//   mode="new"    (Auth.jsx, no session yet)      → key 'sacs-signup-draft'
//   mode="resume" (App.jsx, session exists)        → key `sacs-onboarding-draft-${uid}`
//
// Deliberately never stores, in either mode: the password fields (a
// restored draft always reopens with password re-typed knowingly), or the
// data-consent tick (an affirmation made on purpose each time, never
// restored on someone's behalf). Callers pass in exactly the field list
// that's safe to draft — see Onboarding.jsx.
//
// Same 7-day expiry the old Auth.jsx/FinishSignup.jsx drafts used:
// comfortably longer than "I'll finish this tonight", short enough that a
// half-typed home address isn't sitting on a shared computer indefinitely.
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function readDraft(key, fields) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key)
      return {}
    }
    const values = parsed.values
    if (!values || typeof values !== 'object') return {}
    // Coerce back to the types the form expects rather than trusting
    // whatever's in storage — a value that had become a number or object
    // (hand-edited storage, or an older build's draft with different
    // fields) would otherwise sail into state and throw on `.trim()` at
    // submit time, permanently, since the draft is re-read on every load.
    const clean = {}
    for (const field of fields) {
      const v = values[field]
      if (v === null || v === undefined) continue
      clean[field] = field === 'newsOptIn' ? (typeof v === 'boolean' ? v : null) : String(v)
    }
    return clean
  } catch {
    return {}
  }
}

export function writeDraft(key, fields, values) {
  try {
    localStorage.setItem(key, JSON.stringify({
      savedAt: Date.now(),
      values: Object.fromEntries(fields.map((f) => [f, values[f]])),
    }))
  } catch {
    /* private mode / quota — the form still works, just isn't resumable */
  }
}

export function clearDraft(key) {
  try { localStorage.removeItem(key) } catch { /* private mode */ }
}

// Whether there's actually anything worth restoring — so merely opening the
// Join tab and wandering off doesn't leave a file behind. `ignoreDefaults`
// lets a caller exclude a field's default value from counting as content
// (e.g. country defaulting to 'South Africa').
export function draftHasContent(fields, values, ignoreDefaults = {}) {
  return fields.some((f) => {
    const v = values[f]
    if (v === '' || v === null || v === undefined) return false
    if (ignoreDefaults[f] !== undefined && v === ignoreDefaults[f]) return false
    return true
  })
}
