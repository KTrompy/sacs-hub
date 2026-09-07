// Shared validation for the unified onboarding wizard — one implementation
// used by both mode="new" (Auth.jsx's Join tab, no session yet) and
// mode="resume" (App.jsx's post-auth gate: Google joiners, and legacy
// accounts that consented but never finished their membership record).
//
// Ported from the old Auth.jsx wizard's validateStep1-4 and
// FinishSignup.jsx's validate(), with two deliberate relaxations per the
// onboarding redesign brief: industry/occupation/address are no longer
// asked at signup at all (they move to post-approval profile completion,
// which already has its own required/optional split — see Profile.jsx),
// and cell number is optional rather than required.

import { passwordProblem } from '../../passwordRules.jsx'
import { MAX_SCHOOL_YEARS, COMMUNITY_ROLES } from '../../constants.js'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Same sanity bounds the old CompleteDetails.jsx / FinishSignup.jsx used.
export const MIN_AGE = 5
export const MAX_AGE = 120

// Step 1 — Create your account.
//
// `requireCredentials` is false whenever there's already a session (Google,
// or a legacy account resuming mid-flow) — those never show password
// fields, so there's nothing to validate there, and the email on the
// account is already fixed.
export function validateStepAccount({
  firstName, lastName, email, confirmEmail, password, confirmPassword,
  requireCredentials,
}) {
  if (!firstName.trim()) return 'Enter your first name.'
  if (!lastName.trim()) return 'Enter your last name.'
  if (!requireCredentials) return null
  const cleanEmail = (email || '').trim()
  if (!cleanEmail) return 'Enter your email address.'
  if (!EMAIL_RE.test(cleanEmail)) return 'Enter a valid email address.'
  if (cleanEmail.toLowerCase() !== (confirmEmail || '').trim().toLowerCase()) {
    return "Email addresses don't match."
  }
  const pwProblem = passwordProblem(password)
  if (pwProblem) return pwProblem
  if (password !== confirmPassword) return "Passwords don't match."
  return null
}

// Step 2 — Tell us about yourself (the committee's verification record).
//
// Cell number used to be required (min 6 digits); now it's optional, and
// only checked for shape if something was actually typed. Industry and
// occupation are gone from this step entirely — they're profile-completion
// fields now, not signup fields.
export function validateStepAbout({ title, dob, phone, startYear, endYear, roles }) {
  if (!title) return 'Select your title.'
  if (!dob) return 'Enter your date of birth.'
  const d = new Date(dob)
  const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (Number.isNaN(d.getTime()) || age < MIN_AGE || age > MAX_AGE) {
    return 'That date of birth doesn’t look right — please check it.'
  }
  const cleanPhone = (phone || '').trim()
  if (cleanPhone && cleanPhone.replace(/\D/g, '').length < 6) {
    return 'That cell number doesn’t look right — please check it.'
  }
  if (!startYear) return 'Select the year you arrived at SACS.'
  if (!endYear) return 'Select your final year (or expected final year).'
  if (Number(endYear) < Number(startYear)) return 'Class of can’t be before your first year.'
  if (Number(endYear) - Number(startYear) > MAX_SCHOOL_YEARS) {
    return `That's more than ${MAX_SCHOOL_YEARS} years in SACS — check the years are right.`
  }
  if (!COMMUNITY_ROLES.some((r) => roles[r.key])) {
    return 'Select at least one — how are you part of the SACS community?'
  }
  return null
}

// Step 3 — Almost there (location, communication preferences, consent).
//
// Address and postcode stay fully optional (unchanged from today).
// newsOptIn has no default and must be actively chosen, same as today.
// Phone/SMS contact chips are optional and not validated either way — see
// StepFinish.jsx for the default-off behaviour change.
export function validateStepFinish({
  city, country, province, newsOptIn, dataConsent, captchaRequired, captchaToken,
}) {
  if (!city.trim()) return 'Enter your city or town.'
  if (!country.trim()) return 'Enter your country.'
  if (country.trim() === 'South Africa' && !province) return 'Select your province.'
  if (newsOptIn === null) return 'Choose whether you’d like news and events by email.'
  if (!dataConsent) return 'You’ll need to consent to your data being held to join.'
  if (captchaRequired && !captchaToken) return 'Please complete the security check.'
  return null
}
