import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase, deleteOwnAccount, openStorageFile } from '../supabaseClient'
import { Avatar } from './Directory.jsx'
import { INDUSTRIES, INDUSTRY_KEYWORDS, SA_CITIES, EXPERTISE_OPTIONS, EXPERTISE_BY_INDUSTRY, AVAILABILITY_OPTIONS, GEOGRAPHIC_FOCUS, TITLES, GENDERS } from '../constants.js'
import PhotoCropper from './PhotoCropper.jsx'
import { geocodeCity } from '../geocode.js'
import CityAutocomplete from './CityAutocomplete.jsx'
import CountryAutocomplete from './CountryAutocomplete.jsx'
import ListAutocomplete from './ListAutocomplete.jsx'
import MultiSelectAutocomplete from './MultiSelectAutocomplete.jsx'
import ClearableInput from './ClearableInput.jsx'
import PhoneInput from './PhoneInput.jsx'
import DeleteButton from './DeleteButton.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import useModal from '../useModal.js'
import { normalizeExpertise, formatExperienceRange, formatExperienceDuration, isValidGradYear, isSafeHttpUrl } from '../utils.js'
import ProfileSectionNav from './profile/ProfileSectionNav.jsx'
import ProfileCompletionCard from './profile/ProfileCompletionCard.jsx'
import SaveBar from './profile/SaveBar.jsx'

const MAX_CV_SIZE = 10 * 1024 * 1024 // 10 MB
const CV_ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
// The `accept` attribute on <input type="file"> is a picker hint, not a
// constraint — every browser lets you get past it (drag-drop, "All files",
// a renamed extension). Both pickers below checked size only, so a
// non-image under 8 MB sailed through to PhotoCropper, whose <img onLoad>
// then never fired: a modal with Save permanently disabled, no error, no
// way to tell what went wrong. Same list ApplyModal enforces for its uploads.
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const CV_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

const EMPTY = {
  full_name: '', first_name: '', preferred_name: '', last_name: '',
  start_year: '', grad_year: '', degree: '',
  industry: '', occupation: '',
  company: '', city: '', country: 'South Africa',
  address_line1: '', address_line2: '', address_line3: '',
  province: '', postal_code: '',
  bio: '',
  linkedin_url: '', phone: '',
  expertise: [],
  services_offered: [],
  business_website: '',
  is_open_to_opportunities: false,
  mentor_note: '',
  mentor_paused: false,
  availability: '',
  geographic_focus: [],
  // The mentee half of mentoring (schema-update-56). Kept in the same
  // section as the mentor fields because they're two answers to one
  // question — what do you want out of this — and splitting them apart is
  // how you end up with people who only ever notice one of them.
  seeking_mentor: false,
  mentee_goals: [],
  mentee_note: '',
  experience: [],
  // keeping looking_to_connect for backward compatibility but not using in UI
  looking_to_connect: [],
}

// profile_details is a separate table (see the add_sacs_profile_details
// migration) — SACS membership-record fields with their own, tighter RLS,
// kept off the main `profiles` row on purpose. Loaded/saved independently
// of `form` above; see loadDetails()/save() below.
const EMPTY_DETAILS = {
  title: '',
  gender: '',
  date_of_birth: '',
  known_as: '',
  initials: '',
  surname_at_school: '',
  id_number: '',
  nationality: '',
  phone_home: '',
  phone_work: '',
  phone_fax: '',
  old_boy: true,
  current_parent: false,
  past_parent: false,
  current_staff: false,
  past_staff: false,
  comm_pref_email: true,
  comm_pref_phone: true,
  comm_pref_sms: true,
  subscription_tier: 'Standard',
}

const EMPTY_EXPERIENCE_ENTRY = { title: '', company: '', industry: '', from: '', to: '', description: '' }

// Client-only identity for an experience entry — the DB just stores a plain
// jsonb array with no ids, but the editor needs something stable to key
// list items and track which card is expanded by, that survives entries
// being added/removed/reordered. Stripped back out before saving.
function makeExperienceKey() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function monthNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Fields onboarding lets someone skip past (bio, LinkedIn, phone, CV, and
// the whole mentoring block) — used to point out what's still blank right
// after finishing the wizard. Checked straight off the raw `profile` row
// (not the editor's `form` state) so this doesn't race the effect below
// against the separate one that populates `form` from `profile` on mount.
const SKIPPABLE_FIELD_CHECKS = {
  bio: (p) => !p.bio?.trim(),
  linkedin_url: (p) => !p.linkedin_url?.trim(),
  phone: (p) => !p.phone?.trim(),
  business_website: (p) => !p.business_website?.trim(),
  availability: (p) => !p.availability,
  expertise: (p) => !Array.isArray(p.expertise) || p.expertise.length === 0,
  geographic_focus: (p) => !Array.isArray(p.geographic_focus) || p.geographic_focus.length === 0,
}

// The directory-critical fields the old onboarding wizard used to force.
// Since the wizard was replaced with "land on this page with everything
// missing highlighted" (first login after approval, and the Home
// "Complete your profile" button), these are checked alongside the
// skippable ones so nothing essential slips through unprompted.
const REQUIRED_FIELD_CHECKS = {
  degree: (p) => !p.degree?.trim(),
  industry: (p) => !p.industry?.trim(),
  occupation: (p) => !p.occupation?.trim(),
  company: (p) => !p.company?.trim(),
  city: (p) => !p.city?.trim(),
  postal_code: (p) => !p.postal_code?.trim(),
  photo: (p) => !p.avatar_url,
}

// Which Edit Profile section each of the missing-field keys above lives in
// — drives the little "something's incomplete in here" dot on the section
// nav, and which section the post-onboarding auto-scroll/focus effect
// needs to land on (mentoring fields already had this special case; this
// just generalizes it to the whole nav).
const MISSING_FIELD_SECTION = {
  photo: 'overview',
  bio: 'about',
  degree: 'about',
  industry: 'career',
  occupation: 'career',
  company: 'career',
  cv: 'documents',
  city: 'location',
  postal_code: 'location',
  linkedin_url: 'contact',
  phone: 'contact',
  business_website: 'mentoring',
  availability: 'mentoring',
  expertise: 'mentoring',
  geographic_focus: 'mentoring',
}

const NAV_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'about', label: 'About' },
  { id: 'career', label: 'Career' },
  { id: 'experience', label: 'Experience' },
  { id: 'documents', label: 'Documents' },
  { id: 'location', label: 'Location' },
  { id: 'contact', label: 'Contact' },
  { id: 'membership', label: 'Membership' },
  { id: 'mentoring', label: 'Mentoring' },
]

export default function Profile({ session, profile, onSaved, onDirtyChange, saveRef }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState(EMPTY)
  const [details, setDetails] = useState(EMPTY_DETAILS)
  const [showDetails, setShowDetails] = useState(false)
  const [customIndustry, setCustomIndustry] = useState('')
  const [customCity, setCustomCity] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState(null)
  // Last-saved crop (zoom/position/rotation/flip/filters), passed to
  // PhotoCropper so re-editing an existing photo restores where you left
  // off instead of resetting — see editExistingPhoto below for why this is
  // only set when we're sure we loaded the true original image.
  const [cropInitial, setCropInitial] = useState(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)
  const [geoWarning, setGeoWarning] = useState(false)
  const [cityCoords, setCityCoords] = useState(null) // set when a dropdown suggestion is picked
  const [dirty, setDirty] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showMentoring, setShowMentoring] = useState(false)
  // Which of the two mentoring yes/no toggles (if any) has a write in
  // flight — see saveToggle below.
  const [togglingField, setTogglingField] = useState(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [deletingPhoto, setDeletingPhoto] = useState(false)
  // Which experience cards are showing the full edit form rather than the
  // collapsed LinkedIn-style summary. Tracked by each entry's client-only
  // _key rather than array index, so it doesn't get scrambled when entries
  // are added, removed or reordered.
  const [expandedExperience, setExpandedExperience] = useState(() => new Set())
  const [cvUploading, setCvUploading] = useState(false)
  // Fields to visually flag as "still blank" right after onboarding — see
  // the effect below that populates this from location.state.highlightMissing.
  // Empty otherwise, so this has no effect on a normal profile-page visit.
  const [missingFields, setMissingFields] = useState(() => new Set())
  // Which section nav item is currently active, driven by scroll position —
  // see the scroll-spy effect below.
  const [activeSection, setActiveSection] = useState('overview')
  const fileRef = useRef(null)
  const cvRef = useRef(null)
  const sectionRefs = useRef({})
  // Snapshot of the last-saved profile_details row, restored by Discard —
  // separate from `profile` (which the parent only updates for the main
  // `profiles` table) since profile_details lives entirely client-side
  // between loads/saves.
  const savedDetailsRef = useRef(EMPTY_DETAILS)

  function setSectionRef(id) {
    return (el) => { sectionRefs.current[id] = el }
  }

  // Builds the editor's form state from a `profiles` row — used both on
  // mount/profile-change and by Discard (reverting unsaved edits back to
  // whatever's actually saved).
  function populateForm(p) {
    const isKnownIndustry = INDUSTRIES.includes(p.industry)
    setForm({
      full_name: p.full_name || '',
      // Own-name columns (schema-update-57) — the editable fields. A
      // pre-57 row may have only full_name; split it as a best guess so
      // the inputs aren't blank for someone whose name is clearly known.
      first_name: p.first_name || (p.full_name || '').split(' ')[0] || '',
      preferred_name: p.preferred_name || '',
      last_name: p.last_name || (p.full_name || '').split(' ').slice(1).join(' ') || '',
      start_year: p.start_year || '',
      grad_year: p.grad_year || '',
      degree: p.degree || '',
      industry: isKnownIndustry ? p.industry : (p.industry ? 'Other' : ''),
      occupation: p.occupation || '',
      company: p.company || '',
      city: p.city || '',
      country: p.country || 'South Africa',
      address_line1: p.address_line1 || '',
      address_line2: p.address_line2 || '',
      address_line3: p.address_line3 || '',
      province: p.province || '',
      postal_code: p.postal_code || '',
      bio: p.bio || '',
      linkedin_url: p.linkedin_url || '',
      phone: p.phone || '',
      expertise: normalizeExpertise(p.expertise),
      services_offered: Array.isArray(p.services_offered) ? p.services_offered : [],
      business_website: p.business_website || '',
      is_open_to_opportunities: p.is_open_to_opportunities === true,
      mentor_note: p.mentor_note || '',
      mentor_paused: p.mentor_paused === true,
      availability: p.availability || '',
      geographic_focus: Array.isArray(p.geographic_focus) ? p.geographic_focus : [],
      seeking_mentor: p.seeking_mentor === true,
      mentee_goals: normalizeExpertise(p.mentee_goals),
      mentee_note: p.mentee_note || '',
      experience: (Array.isArray(p.experience) ? p.experience : [])
        .map((entry) => ({ ...entry, _key: makeExperienceKey() })),
      looking_to_connect: Array.isArray(p.looking_to_connect) ? p.looking_to_connect : [],
    })
    if (!isKnownIndustry && p.industry) setCustomIndustry(p.industry)
    else setCustomIndustry('')
    setCityCoords(null)
    setDirty(false)
    // Existing entries load collapsed as summary cards; only newly-added
    // ones (via addExperience) start expanded.
    setExpandedExperience(new Set())
  }

  useEffect(() => {
    if (profile) populateForm(profile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  // profile_details lives in its own table (tighter RLS than `profiles` —
  // see the add_sacs_profile_details migration), so it isn't part of the
  // `profile` prop and has to be fetched separately. maybeSingle() because a
  // brand-new member has no row yet — EMPTY_DETAILS covers that case, and
  // the first save() upserts one into existence.
  useEffect(() => {
    let cancelled = false
    async function loadDetails() {
      const { data, error: detErr } = await supabase
        .from('profile_details')
        .select('*')
        .eq('profile_id', session.user.id)
        .maybeSingle()
      if (cancelled) return
      if (detErr) { setError(detErr.message); return }
      if (data) {
        const { profile_id, created_at, updated_at, ...rest } = data
        const loaded = { ...EMPTY_DETAILS, ...rest }
        setDetails(loaded)
        savedDetailsRef.current = loaded
      } else {
        setDetails(EMPTY_DETAILS)
        savedDetailsRef.current = EMPTY_DETAILS
      }
    }
    loadDetails()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id])

  // Two things can arrive via nav state, handled in one effect so they can
  // never race each other clearing location.state:
  //  - openPhotoModal — "Change photo" clicked from the View Profile page.
  //  - highlightMissing — arriving fresh from onboarding, or the Home
  //    "Complete your profile" button / once-a-day nudge modal.
  useEffect(() => {
    if (location.state?.openPhotoModal) {
      setShowPhotoModal(true)
      navigate(location.pathname, { replace: true, state: {} })
      return
    }

    if (!location.state?.highlightMissing || !profile) return
    const missing = new Set([
      ...Object.keys(REQUIRED_FIELD_CHECKS).filter((key) => REQUIRED_FIELD_CHECKS[key](profile)),
      ...Object.keys(SKIPPABLE_FIELD_CHECKS).filter((key) => SKIPPABLE_FIELD_CHECKS[key](profile)),
    ])
    if (!profile.cv_url) missing.add('cv')
    setMissingFields(missing)
    const mentoringFields = ['availability', 'expertise', 'geographic_focus', 'business_website']
    if (mentoringFields.some((f) => missing.has(f))) setShowMentoring(true)
    // First login after approval (and the Home CTA) also ask us to put the
    // cursor straight into the first empty field, so there's zero "now
    // what?" moment. Deferred a tick so the highlighted classes are
    // actually in the DOM before we go looking for them.
    if (location.state?.focusFirst && missing.size > 0) {
      setTimeout(() => {
        const el = document.querySelector(
          '.field-missing input, .field-missing textarea, .field-missing select'
        )
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.focus({ preventScroll: true })
        }
      }, 150)
    }
    navigate(location.pathname, { replace: true, state: {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, location.state])

  // Scroll-spy for the section nav — no IntersectionObserver needed for a
  // single scrolling column of nine sections; just checks, on scroll,
  // which section's top has crossed the sticky header/nav offset.
  useEffect(() => {
    function onScroll() {
      const offset = 150
      let current = NAV_SECTIONS[0].id
      for (const { id } of NAV_SECTIONS) {
        const el = sectionRefs.current[id]
        if (el && el.getBoundingClientRect().top - offset <= 0) current = id
      }
      setActiveSection((prev) => (prev === current ? prev : current))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function scrollToSection(id) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Used by the completion card — jump to the section, then focus the
  // specific field once it's scrolled into view.
  function jumpToField(key, sectionId) {
    scrollToSection(sectionId)
    setTimeout(() => {
      const wrap = document.getElementById(`field-${key}`)
      const target = wrap?.querySelector('input, textarea, select, button') || wrap
      target?.focus?.({ preventScroll: true })
    }, 350)
  }

  // Reverts every unsaved edit back to what's actually in the database —
  // the About/Career/Experience/etc. form state resets from `profile`
  // (the last value the parent confirmed was saved), and the membership
  // details reset from the last-loaded/last-saved snapshot.
  function discardChanges() {
    if (profile) populateForm(profile)
    setDetails(savedDetailsRef.current)
    setError(null)
    setGeoWarning(false)
    setSaved(false)
  }

  // Let the parent (App) know whenever there are unsaved edits, so it can
  // warn before letting someone navigate away and lose them.
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the parent's ref pointing at the latest save() closure, so App can
  // trigger a save (e.g. from the "leave without saving?" prompt) without
  // this component needing to know anything about navigation.
  useEffect(() => { if (saveRef) saveRef.current = save }) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-hides the "✓ Changes saved" toast a couple of seconds after a
  // successful save, rather than leaving it sitting there indefinitely.
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2600)
    return () => clearTimeout(t)
  }, [saved])

  // Clears a field's "still missing" highlight the moment someone starts
  // addressing it — no reason to keep flagging it once they've engaged with
  // it, even before Save is hit.
  function clearMissing(k) {
    setMissingFields((s) => {
      if (!s.has(k)) return s
      const next = new Set(s)
      next.delete(k)
      return next
    })
  }

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false); setDirty(true); clearMissing(k) }

  // Same shape as set() above but for the separate profile_details table —
  // kept as its own setter rather than folded into `set` so the two tables'
  // fields can never accidentally collide under the same key.
  function setDetail(k, v) { setDetails((d) => ({ ...d, [k]: v })); setSaved(false); setDirty(true) }

  // "Open to mentoring" and "Looking for a mentor" read like on/off
  // settings switches, not fields you fill in and then remember to click
  // "Save changes" for. Routed through the full-form save() they could sit
  // changed-but-unsaved, or get silently blocked by unrelated validation
  // errors elsewhere in the form (a bad LinkedIn URL, a missing grad year)
  // with nothing telling you why the click "didn't hold". Writing just this
  // one column straight to the DB means the click itself is the save, so it
  // can never be lost to an unrelated field or an un-clicked Save button.
  async function saveToggle(key, value) {
    const previous = form[key]
    set(key, value)
    setTogglingField(key)
    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update({ [key]: value })
      .eq('id', session.user.id)
      .select()
      .single()
    setTogglingField(null)
    if (dbErr) {
      setForm((f) => ({ ...f, [key]: previous }))
      setError(dbErr.message)
      return
    }
    onSaved(data)
  }

  // className helper for the fields flagged by the post-onboarding
  // highlight — appends 'field-missing' (styles.css) when this key is
  // still in missingFields, otherwise just returns the base class.
  function fieldCls(key, base = 'field') {
    return missingFields.has(key) ? `${base} field-missing` : base
  }

  // Changing industry also drops any picked expertise tags that came from
  // the old industry's list but don't belong to the new one, so switching
  // from e.g. "Legal" to "Software Engineering & Development" doesn't leave
  // "Litigation" behind. Free-typed ("Other") tags aren't tied to any
  // industry's list, so they're always kept.
  function setIndustry(value) {
    setForm((f) => {
      const prevOptions = EXPERTISE_BY_INDUSTRY[f.industry] || EXPERTISE_OPTIONS
      const nextOptions = EXPERTISE_BY_INDUSTRY[value] || EXPERTISE_OPTIONS
      return {
        ...f,
        industry: value,
        expertise: f.expertise.filter((e) => nextOptions.includes(e) || !prevOptions.includes(e)),
      }
    })
    setSaved(false)
    setDirty(true)
    clearMissing('industry')
  }

  function toggleTag(field, tag) {
    setForm((f) => {
      const arr = f[field] || []
      const newArr = arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag]
      return { ...f, [field]: newArr }
    })
    setSaved(false)
    setDirty(true)
    clearMissing(field)
  }

  // Experience: a free-form, add/remove list of past roles rather than a
  // single job title/company — most alumni have more than one. Kept
  // separate from the single "current role" fields above (which drive the
  // directory card and quick filters) so this can grow without touching
  // those.
  function addExperience() {
    const entryKey = makeExperienceKey()
    setForm((f) => ({ ...f, experience: [...f.experience, { ...EMPTY_EXPERIENCE_ENTRY, _key: entryKey }] }))
    setExpandedExperience((s) => new Set(s).add(entryKey))
    setSaved(false)
    setDirty(true)
  }
  function removeExperience(entryKey) {
    setForm((f) => ({ ...f, experience: f.experience.filter((e) => e._key !== entryKey) }))
    setExpandedExperience((s) => {
      if (!s.has(entryKey)) return s
      const next = new Set(s)
      next.delete(entryKey)
      return next
    })
    setSaved(false)
    setDirty(true)
  }
  function setExperienceField(entryKey, key, value) {
    setForm((f) => ({
      ...f,
      experience: f.experience.map((entry) => (entry._key === entryKey ? { ...entry, [key]: value } : entry)),
    }))
    setSaved(false)
    setDirty(true)
  }
  function toggleExperienceExpanded(entryKey) {
    setExpandedExperience((s) => {
      const next = new Set(s)
      if (next.has(entryKey)) next.delete(entryKey)
      else next.add(entryKey)
      return next
    })
  }

  const isSA = form.country === 'South Africa'

  // Migrate city values when country changes
  useEffect(() => {
    if (!isSA) {
      if (form.city && !SA_CITIES.includes(form.city)) {
        setCustomCity(form.city)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSA])

  function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later (e.g. after cancel)
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) {
      setError('Please choose a JPEG, PNG or WebP image.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Photo must be under 8MB.')
      return
    }
    setError(null)
    setShowPhotoModal(false)
    setCropFile(file)
    // A newly picked photo is unrelated to whatever crop you last saved on
    // your previous avatar, so the editor should open centered/unzoomed —
    // never carry over the old crop fractions onto a differently-shaped image.
    setCropInitial(null)
    // Stash the untouched original (best-effort, don't block the crop UI on
    // it) so a later re-edit can start from the full photo again instead of
    // the already-cropped/zoomed avatar — see editExistingPhoto below.
    supabase.storage.from('avatars')
      .upload(`${session.user.id}/original`, file, { upsert: true, contentType: file.type || 'image/jpeg' })
      .catch(() => {})
  }

  async function uploadCroppedPhoto(blob, cropMeta) {
    // Deliberately NOT clearing cropFile/cropInitial here — the editor stays
    // open with a "Saving…" state until the upload + DB write actually
    // finish. Closing immediately (the old behavior) left no visible sign
    // anything was happening: the avatar on the page behind it was still the
    // old one until the network calls resolved, so on a slow connection it
    // looked like nothing happened — and refreshing mid-upload would abandon
    // the in-flight request entirely, permanently losing the change.
    setUploading(true); setError(null)
    // Every save gets its own filename instead of overwriting avatar.jpg.
    // Supabase's storage CDN caches by object key at the edge and largely
    // ignores query strings, so a `?t=` cache-buster on a reused path could
    // still serve the old bytes for up to the Cache-Control max-age (this is
    // the "doesn't update / takes forever" bug). A brand-new path is a
    // brand-new URL that's never been cached anywhere, so it shows up
    // immediately — and we can cache it aggressively since it never changes.
    const prevUrl = profile?.avatar_url || null
    const path = `${session.user.id}/avatar-${Date.now()}.jpg`

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: false, contentType: 'image/jpeg', cacheControl: '31536000' })

    if (upErr) {
      setError(upErr.message)
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = data.publicUrl

    const { data: updated, error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: url, avatar_crop: cropMeta || null })
      .eq('id', session.user.id)
      .select()
      .single()

    if (dbErr) {
      setError(dbErr.message)
    } else {
      onSaved(updated)
      setCropFile(null)
      setCropInitial(null)
      clearMissing('photo')
      // Best-effort cleanup of the now-orphaned previous avatar file.
      const prevPath = prevUrl?.match(/\/avatars\/([^?]+)/)?.[1]
      if (prevPath) supabase.storage.from('avatars').remove([prevPath]).catch(() => {})
    }
    setUploading(false)
  }

  async function deletePhoto() {
    setDeletingPhoto(true)
    setError(null)
    const currentPath = profile?.avatar_url?.match(/\/avatars\/([^?]+)/)?.[1]
    const paths = [`${session.user.id}/original`, ...(currentPath ? [currentPath] : [])]
    await supabase.storage.from('avatars').remove(paths)
    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: null, avatar_crop: null })
      .eq('id', session.user.id)
      .select()
      .single()
    if (dbErr) setError(dbErr.message)
    else onSaved(data)
    setDeletingPhoto(false)
    setShowPhotoModal(false)
  }

  // Edit existing photo: fetch the ORIGINAL (untouched) upload as a File and
  // open the cropper, so re-editing always starts from the full photo.
  // Using profile.avatar_url here instead would feed the cropper the
  // already-cropped/zoomed display image — every re-edit would then zoom in
  // further from wherever the last save left off, with no way to zoom back
  // out since the parts cropped away the first time are gone for good.
  // Falls back to avatar_url for accounts whose original predates this fix.
  async function editExistingPhoto() {
    if (!profile?.avatar_url) return
    try {
      const { data: origData } = supabase.storage.from('avatars').getPublicUrl(`${session.user.id}/original`)
      const originalUrl = `${origData.publicUrl}?t=${Date.now()}`
      let sourceUrl = profile.avatar_url
      let usingOriginal = false
      try {
        const check = await fetch(originalUrl, { method: 'HEAD' })
        if (check.ok) { sourceUrl = originalUrl; usingOriginal = true }
      } catch {
        // no preserved original (or network hiccup) — fall back to the current avatar
      }
      const res = await fetch(sourceUrl)
      const blob = await res.blob()
      const file = new File([blob], 'avatar.jpg', { type: blob.type || 'image/jpeg' })
      setShowPhotoModal(false)
      // Only restore the last-saved crop (zoom/position/rotation/filters)
      // when we know we're loading the real, uncropped original — applying
      // it on top of the fallback avatar_url image would re-crop an
      // already-cropped image and effectively zoom in even further, the
      // exact bug this whole original-preservation mechanism exists to fix.
      setCropInitial(usingOriginal ? (profile.avatar_crop || null) : null)
      setCropFile(file)
    } catch {
      setError('Could not load current photo for editing.')
    }
  }

  async function pickCv(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!CV_TYPES.includes(file.type)) { setError('Please upload your CV as a PDF or Word document.'); return }
    if (file.size > MAX_CV_SIZE) { setError('CV must be under 10 MB.'); return }
    setCvUploading(true); setError(null)
    const ext = file.name.split('.').pop().toLowerCase()
    const path = `${session.user.id}/cv-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('cvs')
      .upload(path, file, { upsert: false, contentType: file.type })
    if (upErr) { setError(upErr.message); setCvUploading(false); return }
    // The bucket is private now (schema-update-47), so this URL won't resolve
    // on its own — it's kept purely as the storage-path carrier, matching the
    // shape of every cv_url row saved before the change. Everything that
    // actually opens a CV goes through openStorageFile(), which pulls the path
    // back out and mints a short-lived signed URL. Keeping one shape means no
    // data migration and no "old CVs stopped working".
    const { data: urlData } = supabase.storage.from('cvs').getPublicUrl(path)
    // Remove old CV file if one exists
    const prevPath = profile?.cv_url?.match(/\/cvs\/([^?]+)/)?.[1]
    if (prevPath) supabase.storage.from('cvs').remove([prevPath]).catch(() => {})
    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update({ cv_url: urlData.publicUrl, cv_filename: file.name })
      .eq('id', session.user.id)
      .select()
      .single()
    if (dbErr) setError(dbErr.message)
    else { onSaved(data); clearMissing('cv') }
    setCvUploading(false)
  }

  async function removeCv() {
    setError(null)
    const prevPath = profile?.cv_url?.match(/\/cvs\/([^?]+)/)?.[1]
    if (prevPath) await supabase.storage.from('cvs').remove([prevPath])
    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update({ cv_url: null, cv_filename: null })
      .eq('id', session.user.id)
      .select()
      .single()
    if (dbErr) setError(dbErr.message)
    else onSaved(data)
  }

  // Returns true/false so callers (including App's "leave without saving?"
  // prompt) can tell whether it's safe to navigate away afterward.
  async function save() {
    setError(null)
    setGeoWarning(false)

    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('Please enter your first and last name.')
      return false
    }

    if (!form.city.trim()) {
      setError('Please enter your city or town.')
      return false
    }

    if (!isValidGradYear(form.grad_year)) {
      setError('Enter a valid 4-digit graduation year.')
      return false
    }

    if (!isSafeHttpUrl(form.linkedin_url)) {
      setError('LinkedIn URL should start with http:// or https://.')
      return false
    }

    // Same "people don't type the scheme" problem as LinkedIn (which now
    // has a fixed prefix in the UI) — quietly add https:// to a bare
    // "mysite.com" instead of failing the save over it.
    const websiteTrimmed = form.business_website.trim()
    const website = websiteTrimmed && !/^https?:\/\//i.test(websiteTrimmed)
      ? `https://${websiteTrimmed}`
      : websiteTrimmed
    if (!isSafeHttpUrl(website)) {
      setError('Business website should start with http:// or https://.')
      return false
    }

    // Drop fully-blank experience rows (e.g. an "+ Add" that was never
    // filled in), but any row with something in it needs at least a
    // company name to be worth keeping.
    const cleanedExperience = form.experience
      .filter((e) => e.title.trim() || e.company.trim() || e.industry.trim() || e.from.trim() || e.to.trim())
    if (cleanedExperience.some((e) => !e.company.trim())) {
      setError('Please add a company name for each experience entry, or remove the incomplete one.')
      return false
    }

    // Reorder most-recent-first (current roles, then past roles by end
    // date) — like LinkedIn, so entries don't just sit in whatever order
    // they were added, and so the read-only profile timeline reads as a
    // sensible career history without needing its own sort. `_key` is a
    // client-only id for tracking which card is expanded in this editor;
    // strip it before it ever reaches the database.
    const sortableTo = (e) => (e.to ? e.to : '9999-99') // blank `to` = current, sorts first
    const sortedExperience = [...cleanedExperience].sort((a, b) => {
      const byEnd = sortableTo(b).localeCompare(sortableTo(a))
      if (byEnd !== 0) return byEnd
      return (b.from || '').localeCompare(a.from || '')
    })
    const finalExperience = sortedExperience.map(({ _key, ...entry }) => entry)

    setBusy(true)
    const industry = form.industry === 'Other' ? customIndustry.trim() : form.industry

    const payload = {
      ...form,
      industry,
      experience: finalExperience,
      grad_year: form.grad_year ? Number(form.grad_year) : null,
      // linkedin_url/phone used to be the only two fields trimmed here —
      // everything else (name, degree, occupation, company, city, bio,
      // business website) saved with whatever leading/trailing whitespace
      // someone typed or pasted in, inconsistent with the signup flows
      // (Auth.jsx / FinishSignup.jsx), which do trim full_name. Trimming
      // the same free-text fields here keeps
      // the directory/search and this profile's own display from showing
      // stray whitespace depending on which flow last touched the row.
      // Assembled the same way the signup flows do it (preferred name wins
      // for display, legal first name kept in its own column).
      full_name: `${(form.preferred_name.trim() || form.first_name.trim())} ${form.last_name.trim()}`.trim(),
      first_name: form.first_name.trim(),
      preferred_name: form.preferred_name.trim(),
      last_name: form.last_name.trim(),
      start_year: form.start_year ? Number(form.start_year) : null,
      degree: form.degree.trim(),
      occupation: form.occupation.trim(),
      company: form.company.trim(),
      city: form.city.trim(),
      bio: form.bio.trim(),
      linkedin_url: form.linkedin_url.trim(),
      phone: form.phone.trim(),
      business_website: website,
      mentee_note: form.mentee_note.trim(),
      mentor_note: form.mentor_note.trim(),
      address_line1: form.address_line1.trim(),
      address_line2: form.address_line2.trim(),
      address_line3: form.address_line3.trim(),
      province: form.province.trim(),
      postal_code: form.postal_code.trim(),
    }

    // Re-geocode when the city/country changed, or when this profile simply
    // doesn't have coordinates yet (e.g. the city was set before the map
    // feature existed). Skips the network call on unrelated edits — like
    // tweaking a bio — once a pin is already in place. Powers the Alumni
    // Map "where are we all now" view; if it fails (offline, no match) we
    // just save without a pin instead of blocking the save.
    const cityMoved = form.city.trim() !== (profile?.city || '').trim()
      || form.country.trim() !== (profile?.country || '').trim()
    const missingCoords = profile?.lat == null || profile?.lng == null
    if (cityCoords) {
      // Picked straight from the suggestions dropdown — already a
      // confirmed, geocodable place, no need to look it up again.
      payload.lat = cityCoords.lat
      payload.lng = cityCoords.lng
    } else if (cityMoved || missingCoords) {
      const coords = await geocodeCity(form.city, form.country)
      payload.lat = coords?.lat ?? null
      payload.lng = coords?.lng ?? null
      if (!coords) setGeoWarning(true)
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', session.user.id)
      .select()
      .single()
    if (error) { setBusy(false); setError(error.message); return false }

    // Second table, second write — upsert rather than update since a
    // member who has never opened this section yet has no profile_details
    // row at all (see loadDetails() above). id_number/nationality/phones
    // are trimmed here for the same reason the profiles fields are above.
    const detailsPayload = {
      profile_id: session.user.id,
      ...details,
      // An empty string isn't a valid `date` value — store null instead.
      date_of_birth: details.date_of_birth || null,
      known_as: details.known_as.trim(),
      initials: details.initials.trim(),
      surname_at_school: details.surname_at_school.trim(),
      id_number: details.id_number.trim(),
      nationality: details.nationality.trim(),
      phone_home: details.phone_home.trim(),
      phone_work: details.phone_work.trim(),
      phone_fax: details.phone_fax.trim(),
    }
    const { error: detErr } = await supabase
      .from('profile_details')
      .upsert(detailsPayload)
    setBusy(false)
    if (detErr) { setError(detErr.message); return false }
    savedDetailsRef.current = details

    onSaved(data)
    setSaved(true)
    setDirty(false)
    return true
  }

  // Calls a server-side Edge Function (using the Admin API) to actually
  // remove the auth user — not just the profile row. Deleting the auth
  // user cascades to delete all of the account's data. Once it's gone,
  // signing in again with the same email requires signing up from
  // scratch. See deleteOwnAccount() in supabaseClient.js — Settings.jsx
  // uses this same helper so the two "Delete account" entry points in
  // the app can't drift out of sync again.
  //
  // Uses the same ConfirmDialog component as Settings.jsx rather than
  // window.confirm() — the two "Delete account" entry points had drifted
  // into inconsistent UX (native browser dialog vs. on-brand modal).
  async function deleteProfile() {
    setBusy(true)
    setError(null)

    const { error } = await deleteOwnAccount()

    if (error) {
      setError(error.message)
      setBusy(false)
      setConfirmingDelete(false)
    } else {
      await supabase.auth.signOut()
      window.location.reload()
    }
  }

  // Whether the collapsed Mentoring toggle should show a "something's
  // missing in here" dot — it auto-expands on arrival from onboarding, but
  // this keeps the cue visible even if someone collapses it again.
  const mentoringHasMissing = ['availability', 'expertise', 'geographic_focus', 'business_website']
    .some((f) => missingFields.has(f))

  const navSections = NAV_SECTIONS.map((s) => ({
    ...s,
    hasMissing: Array.from(missingFields).some((f) => MISSING_FIELD_SECTION[f] === s.id),
  }))

  const overviewRoleLine = form.occupation && form.company
    ? `${form.occupation} @ ${form.company}`
    : (form.occupation || form.company || '')
  const overviewLocationLine = form.city && form.country
    ? `${form.city}, ${form.country}`
    : (form.country || form.city || '')

  return (
    <section className="panel narrow profile-page profile-edit-page">
      {/* Header */}
      <div className="profile-header-with-back">
        <button
          type="button"
          className="profile-back-btn"
          onClick={() => navigate(`/people/${session.user.id}`)}
          aria-label="Back to profile"
        >
          ← Back to profile
        </button>
        <div>
          <h2 className="panel-title">Edit profile</h2>
          <p className="panel-sub">Keep your alumni profile up to date.</p>
        </div>
      </div>

      <ProfileCompletionCard profile={profile} onJumpToField={jumpToField} />

      {/* A real <form> wrapping the editor, so Enter in any text field
          saves instead of doing nothing — see the note in Jobs.jsx. It
          closes before the photo/cropper/delete modals below, which are
          their own overlays and shouldn't be nested inside it. */}
      <form onSubmit={(e) => { e.preventDefault(); if (!busy) save() }} noValidate>
      {missingFields.size > 0 && (
        <div className="profile-missing-banner">
          <span>
            Let&rsquo;s finish your profile — everything still blank is highlighted
            below. Fill in what you can, then hit Save.
          </span>
          <button type="button" className="link-btn small" onClick={() => setMissingFields(new Set())}>
            Dismiss
          </button>
        </div>
      )}

      <div className="pe-layout">
        <ProfileSectionNav sections={navSections} activeId={activeSection} onNavigate={scrollToSection} />

        <div className="pe-content">

          {/* Overview — confirms at a glance you're editing the right
              profile, and is where the photo lives. */}
          <div className="profile-section pe-section" id="pe-section-overview" ref={setSectionRef('overview')}>
            <h3 className="profile-section-title">Overview</h3>
            <div className="pe-overview-row">
              <div className={missingFields.has('photo') ? 'profile-photo-card field-missing' : 'profile-photo-card'} id="field-avatar_url">
                <button
                  type="button"
                  className="profile-photo-avatar-btn"
                  onClick={() => setShowPhotoModal(true)}
                  aria-label="View profile photo"
                >
                  <Avatar url={profile?.avatar_url} name={form.full_name} size={120} />
                </button>
                <div className="profile-photo-actions">
                  <button type="button"
                    className="btn primary small"
                    onClick={() => setShowPhotoModal(true)}
                  >
                    {profile?.avatar_url ? 'Change photo' : 'Add photo'}
                  </button>
                  <p className="profile-photo-hint">JPG, PNG or WebP • Max 8MB</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={pickPhoto}
                />
              </div>

              <div className="pe-overview-summary">
                <strong className="pe-overview-name">{form.full_name || 'Your name'}</strong>
                {overviewRoleLine && <span>{overviewRoleLine}</span>}
                {overviewLocationLine && <span>{overviewLocationLine}</span>}
                {form.grad_year && <span>Class of {form.grad_year}</span>}
              </div>
            </div>
          </div>

          {/* About */}
          <div className="profile-section pe-section" id="pe-section-about" ref={setSectionRef('about')}>
            <h3 className="profile-section-title">About</h3>
            <p className="pe-section-hint">Basic information that helps other alumni recognise you.</p>

            <div className="field-row">
              <label className="field"><span>First name</span>
                <ClearableInput
                  value={form.first_name}
                  onChange={(e) => set('first_name', e.target.value)}
                  onClear={() => set('first_name', '')}
                />
              </label>
              <label className="field"><span>Last name</span>
                <ClearableInput
                  value={form.last_name}
                  onChange={(e) => set('last_name', e.target.value)}
                  onClear={() => set('last_name', '')}
                />
              </label>
            </div>

            <label className="field"><span>Preferred first name</span>
              <ClearableInput
                value={form.preferred_name}
                onChange={(e) => set('preferred_name', e.target.value)}
                onClear={() => set('preferred_name', '')}
                placeholder="If different — this is the name others see"
              />
            </label>

            <label className={fieldCls('bio')} id="field-bio"><span>Bio</span>
              <ClearableInput
                as="textarea"
                rows={3}
                value={form.bio}
                onChange={(e) => set('bio', e.target.value)}
                onClear={() => set('bio', '')}
                placeholder="What you've been up to since SACS…"
              />
            </label>

            <div className="field-row">
              <label className="field"><span>At SACS from</span>
                <ClearableInput
                  inputMode="numeric"
                  value={form.start_year}
                  onChange={(e) => set('start_year', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onClear={() => set('start_year', '')}
                  placeholder="2012"
                />
              </label>
              <label className="field" id="field-grad_year"><span>Class of</span>
                <ClearableInput
                  inputMode="numeric"
                  value={form.grad_year}
                  onChange={(e) => set('grad_year', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onClear={() => set('grad_year', '')}
                  placeholder="2024"
                />
              </label>
            </div>

            <label className={fieldCls('degree')} id="field-degree"><span>Degree</span>
              <ClearableInput
                value={form.degree}
                onChange={(e) => set('degree', e.target.value)}
                onClear={() => set('degree', '')}
                placeholder="e.g. BCom Accounting"
              />
            </label>
          </div>

          {/* Career */}
          <div className="profile-section pe-section" id="pe-section-career" ref={setSectionRef('career')}>
            <h3 className="profile-section-title">Career</h3>
            <p className="pe-section-hint">Your current professional information — this is what helps other alumni find you in the directory.</p>

            <label className={fieldCls('industry')} id="field-industry"><span>Industry</span>
              <ListAutocomplete
                value={form.industry}
                onChange={setIndustry}
                options={INDUSTRIES}
                keywords={INDUSTRY_KEYWORDS}
                placeholder="Search or type your industry"
                clearable
              />
            </label>

            <div className="field-row">
              <label className={fieldCls('occupation')} id="field-occupation"><span>Job title</span>
                <ClearableInput
                  value={form.occupation}
                  onChange={(e) => set('occupation', e.target.value)}
                  onClear={() => set('occupation', '')}
                  placeholder="e.g. Software Engineer"
                />
              </label>
              <label className={fieldCls('company')} id="field-company"><span>Company</span>
                <ClearableInput
                  value={form.company}
                  onChange={(e) => set('company', e.target.value)}
                  onClear={() => set('company', '')}
                  placeholder="e.g. Naspers"
                />
              </label>
            </div>
          </div>

          {/* Experience — collapsed, LinkedIn-style summary cards that
              expand into the edit form one at a time, rather than every
              entry's full form sitting open at once. */}
          <div className="profile-section pe-section profile-section-experience" id="pe-section-experience" ref={setSectionRef('experience')}>
            <h3 className="profile-section-title"><ExperienceIcon /> Experience</h3>
            <p className="pe-section-hint">Your career journey — separate from the current role above, so it can grow into a full timeline.</p>

            {form.experience.length === 0 && (
              <p className="experience-empty">
                Add the roles you've held since SACS — they'll show up as a career timeline on your profile.
              </p>
            )}

            {form.experience.map((entry) => {
              const showCompanyError = !entry.company.trim() && (entry.title.trim() || entry.industry.trim() || entry.from.trim() || entry.to.trim())
              // An invalid entry (missing the required company name) always
              // shows expanded so the inline error stays visible — collapsing
              // it would hide the one thing the person needs to fix.
              const isExpanded = expandedExperience.has(entry._key) || showCompanyError
              const isCurrent = !entry.to

              if (!isExpanded) {
                const range = formatExperienceRange(entry.from, entry.to)
                const duration = formatExperienceDuration(entry.from, entry.to)
                return (
                  <div className="experience-summary-card" key={entry._key}>
                    <span className="experience-summary-icon" aria-hidden="true"><ExperienceIcon /></span>
                    <button
                      type="button"
                      className="experience-summary-body"
                      onClick={() => toggleExperienceExpanded(entry._key)}
                    >
                      <span className="experience-timeline-title">{entry.title || entry.company || 'Untitled role'}</span>
                      {entry.title && entry.company && <span className="experience-timeline-company">{entry.company}</span>}
                      <span className="experience-timeline-meta">
                        {range && <span className="experience-timeline-range">{range}{duration && ` · ${duration}`}</span>}
                        {entry.industry && <span className="experience-timeline-industry">{entry.industry}</span>}
                      </span>
                    </button>
                    <div className="experience-summary-actions">
                      <button
                        type="button"
                        className="icon-btn-edit"
                        onClick={() => toggleExperienceExpanded(entry._key)}
                        aria-label="Edit experience"
                        title="Edit"
                      >
                        <PencilIcon />
                      </button>
                      <DeleteButton
                        onConfirm={() => removeExperience(entry._key)}
                        label="Delete experience"
                        title="Delete this experience entry?"
                        message="This will remove it from your profile. This can't be undone."
                        className="icon-btn-delete"
                      />
                    </div>
                  </div>
                )
              }

              return (
                <div className="experience-entry" key={entry._key}>
                  <div className="field-row">
                    <label className="field"><span>Title</span>
                      <ClearableInput
                        value={entry.title}
                        onChange={(e) => setExperienceField(entry._key, 'title', e.target.value)}
                        onClear={() => setExperienceField(entry._key, 'title', '')}
                        placeholder="e.g. Marketing Manager"
                      />
                    </label>
                    <label className="field"><span>Company name</span>
                      <ClearableInput
                        value={entry.company}
                        onChange={(e) => setExperienceField(entry._key, 'company', e.target.value)}
                        onClear={() => setExperienceField(entry._key, 'company', '')}
                        placeholder="e.g. Naspers"
                        className={showCompanyError ? 'input-error' : ''}
                      />
                      {showCompanyError && <span className="field-error">Company name is required</span>}
                    </label>
                  </div>

                  <label className="field"><span>Industry</span>
                    <ListAutocomplete
                      value={entry.industry}
                      onChange={(v) => setExperienceField(entry._key, 'industry', v)}
                      options={INDUSTRIES}
                      keywords={INDUSTRY_KEYWORDS}
                      placeholder="Search or type an industry"
                      clearable
                    />
                  </label>

                  <label className="field"><span>Description (optional)</span>
                    <textarea
                      value={entry.description}
                      onChange={(e) => setExperienceField(entry._key, 'description', e.target.value)}
                      placeholder="Add details about your role, achievements, or responsibilities..."
                      style={{ resize: 'vertical', minHeight: '100px' }}
                    />
                  </label>

                  <div className="field-row">
                    <label className="field"><span>From</span>
                      <input
                        type="month"
                        className="experience-date"
                        value={entry.from}
                        onChange={(e) => setExperienceField(entry._key, 'from', e.target.value)}
                      />
                    </label>
                    <label className="field"><span>To</span>
                      {isCurrent ? (
                        <div className="experience-present-chip">Present</div>
                      ) : (
                        <input
                          type="month"
                          className="experience-date"
                          value={entry.to}
                          onChange={(e) => setExperienceField(entry._key, 'to', e.target.value)}
                        />
                      )}
                    </label>
                  </div>

                  <label className="experience-current-check">
                    <input
                      type="checkbox"
                      checked={isCurrent}
                      onChange={(e) => setExperienceField(entry._key, 'to', e.target.checked ? '' : monthNow())}
                    />
                    <span>I currently work here</span>
                  </label>

                  <div className="experience-entry-actions">
                    <button type="button" className="experience-remove" onClick={() => removeExperience(entry._key)}>
                      Remove
                    </button>
                    <button type="button" className="experience-done" onClick={() => toggleExperienceExpanded(entry._key)}>
                      Done
                    </button>
                  </div>
                </div>
              )
            })}

            <button type="button" className="experience-add" onClick={addExperience}>
              <PlusIcon /> Add position
            </button>
          </div>

          {/* Documents — CV / Resume */}
          <div
            className={missingFields.has('cv') ? 'profile-section pe-section field-missing' : 'profile-section pe-section'}
            id="pe-section-documents"
            ref={setSectionRef('documents')}
          >
            <h3 className="profile-section-title"><CvIcon /> Documents</h3>
            <p className="pe-section-hint">Add your CV to give alumni opportunities more context about your experience.</p>
            <div className="cv-upload-area">
              {profile?.cv_url ? (
                <div className="cv-file-row">
                  {/* Signed URL rather than a public one — see openStorageFile()
                      and the cvs-bucket note in schema-update-47.sql. */}
                  <a
                    className="cv-file-link"
                    href={profile.cv_url}
                    onClick={(e) => { e.preventDefault(); openStorageFile('cvs', profile.cv_url) }}
                    rel="noopener noreferrer"
                  >
                    <CvFileIcon /> {profile.cv_filename || 'CV'}
                    <span className="pe-doc-status">Uploaded</span>
                  </a>
                  <div className="cv-file-actions">
                    <button type="button" className="btn ghost small" onClick={() => cvRef.current?.click()} disabled={cvUploading}>
                      {cvUploading ? 'Uploading…' : 'Replace'}
                    </button>
                    <button type="button" className="btn ghost small" onClick={removeCv}>Remove</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="cv-upload-btn" onClick={() => cvRef.current?.click()} disabled={cvUploading}>
                  {cvUploading ? 'Uploading…' : '+ Upload CV'}
                </button>
              )}
              <input
                ref={cvRef}
                type="file"
                accept={CV_ACCEPT}
                style={{ display: 'none' }}
                onChange={pickCv}
              />
              <span className="hint">PDF or Word document · Max 10 MB</span>
            </div>
          </div>

          {/* Location */}
          <div className="profile-section pe-section" id="pe-section-location" ref={setSectionRef('location')}>
            <h3 className="profile-section-title">Location</h3>
            <p className="pe-section-hint">Where are you currently based?</p>

            <label className="field" id="field-country"><span>Country</span>
              <CountryAutocomplete
                value={form.country}
                onChange={(v) => set('country', v)}
                placeholder="Start typing a country…"
                clearable
              />
            </label>

            <label className={fieldCls('city')} id="field-city"><span>City / Town</span>
              <CityAutocomplete
                value={form.city}
                country={form.country}
                onChange={(v) => set('city', v)}
                onSelectCoords={setCityCoords}
                placeholder="e.g. Cape Town, London, New York"
              />
              <span className="hint">Start typing and choose from suggestions</span>
            </label>

            <label className="field"><span>Address line 1</span>
              <ClearableInput
                value={form.address_line1}
                onChange={(e) => set('address_line1', e.target.value)}
                onClear={() => set('address_line1', '')}
              />
            </label>
            <label className="field"><span>Address line 2</span>
              <ClearableInput
                value={form.address_line2}
                onChange={(e) => set('address_line2', e.target.value)}
                onClear={() => set('address_line2', '')}
              />
            </label>
            <label className="field"><span>Address line 3</span>
              <ClearableInput
                value={form.address_line3}
                onChange={(e) => set('address_line3', e.target.value)}
                onClear={() => set('address_line3', '')}
              />
            </label>
            <div className="field-row">
              <label className="field"><span>Province</span>
                <ClearableInput
                  value={form.province}
                  onChange={(e) => set('province', e.target.value)}
                  onClear={() => set('province', '')}
                />
              </label>
              <label className={fieldCls('postal_code')}><span>Post code</span>
                <ClearableInput
                  value={form.postal_code}
                  inputMode="numeric"
                  onChange={(e) => set('postal_code', e.target.value)}
                  onClear={() => set('postal_code', '')}
                />
              </label>
            </div>
          </div>

          {/* Contact & links */}
          <div className="profile-section pe-section" id="pe-section-contact" ref={setSectionRef('contact')}>
            <h3 className="profile-section-title">Contact &amp; links</h3>
            <p className="pe-section-hint">Who can see this is controlled in Settings → Privacy.</p>

            <label className={fieldCls('linkedin_url')} id="field-linkedin_url"><span>LinkedIn URL</span>
              {/* Fixed, visible https:// prefix — people kept pasting bare
                  "linkedin.com/in/…" links, hitting the "must start with
                  http://" save error, and not understanding why. The scheme is
                  now shown as a locked prefix and added to the stored value
                  automatically, so there's nothing to get wrong. Pasting a full
                  https:// link still works — the scheme is just de-duplicated. */}
              <div className="url-input-wrap">
                <span className="url-prefix" aria-hidden="true">https://</span>
                <input
                  type="text"
                  value={form.linkedin_url.replace(/^https?:\/\//i, '')}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/^https?:\/\//i, '')
                    set('linkedin_url', raw.trim() ? `https://${raw}` : '')
                  }}
                  placeholder="linkedin.com/in/yourname"
                />
              </div>
              <span className="hint">Just paste your profile link — the https:// is added for you.</span>
            </label>

            <label className={fieldCls('phone')}><span>Phone number</span>
              <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
            </label>
          </div>

          {/* SACS membership details — Collapsible, backed by the separate
              profile_details table (tighter RLS than `profiles`), so
              id_number/nationality/personal phones never ride along with
              the "any authenticated user can read every profile column"
              policy the directory relies on. Visually separated from the
              rest of the public profile because it isn't part of it. */}
          <div className="profile-section pe-section pe-membership-section" id="pe-section-membership" ref={setSectionRef('membership')}>
            <button type="button"
              className="profile-mentoring-toggle"
              onClick={() => setShowDetails(!showDetails)}
            >
              <span className="profile-mentoring-title">
                SACS membership
                <span className="pe-admin-tag">Administrative</span>
              </span>
              <span className={`toggle-arrow ${showDetails ? 'open' : ''}`}>▼</span>
            </button>

            {showDetails && (
              <div className="profile-mentoring-content">
                <p className="hint" style={{ marginBottom: 12 }}>
                  Used for the Alumni Association&rsquo;s membership records — private, and separate from your public profile.
                </p>

                <div className="field-row">
                  <label className="field"><span>Title</span>
                    <ListAutocomplete
                      value={details.title}
                      onChange={(v) => setDetail('title', v)}
                      options={TITLES}
                      placeholder="Select a title"
                      clearable
                    />
                  </label>
                  <label className="field"><span>Gender</span>
                    <ListAutocomplete
                      // Defaults the picker to Male for a brand-new, never-saved
                      // record (SACS is a boys' school) without ever overwriting
                      // an existing choice — once details.gender has any value
                      // (including one someone deliberately changed away from
                      // Male), that value wins.
                      value={details.gender || 'Male'}
                      onChange={(v) => setDetail('gender', v)}
                      options={GENDERS}
                      placeholder="Select a gender"
                      clearable
                    />
                  </label>
                </div>

                <label className="field"><span>Date of birth</span>
                  <input
                    type="date"
                    value={details.date_of_birth || ''}
                    onChange={(e) => setDetail('date_of_birth', e.target.value)}
                    autoComplete="bday"
                  />
                </label>

                {/* "Known as" used to live here too — it duplicated the
                    "Preferred first name" field in About, which writes to
                    profiles.preferred_name and is what the directory shows. */}
                <div className="field-row">
                  <label className="field"><span>Initials</span>
                    <ClearableInput
                      value={details.initials}
                      onChange={(e) => setDetail('initials', e.target.value)}
                      onClear={() => setDetail('initials', '')}
                      placeholder="e.g. J.A."
                    />
                  </label>
                  <label className="field"><span>Surname at school (if different)</span>
                    <ClearableInput
                      value={details.surname_at_school}
                      onChange={(e) => setDetail('surname_at_school', e.target.value)}
                      onClear={() => setDetail('surname_at_school', '')}
                      placeholder="Only if it has changed"
                    />
                  </label>
                </div>

                <div className="field-row">
                  <label className="field"><span>ID / passport number</span>
                    <ClearableInput
                      value={details.id_number}
                      onChange={(e) => setDetail('id_number', e.target.value)}
                      onClear={() => setDetail('id_number', '')}
                    />
                  </label>
                  <label className="field"><span>Nationality</span>
                    <ClearableInput
                      value={details.nationality}
                      onChange={(e) => setDetail('nationality', e.target.value)}
                      onClear={() => setDetail('nationality', '')}
                    />
                  </label>
                </div>

                <div className="field-row">
                  <label className="field"><span>Home phone</span>
                    <PhoneInput value={details.phone_home} onChange={(v) => setDetail('phone_home', v)} />
                  </label>
                  <label className="field"><span>Work phone</span>
                    <PhoneInput value={details.phone_work} onChange={(v) => setDetail('phone_work', v)} />
                  </label>
                </div>

                <div className="field">
                  <span>Association with SACS</span>
                  <span className="hint">Tick everything that applies — these aren&rsquo;t mutually exclusive.</span>
                  <div className="chip-toggle-row">
                    {[
                      ['old_boy', 'Old Boy'],
                      ['current_parent', 'Current parent'],
                      ['past_parent', 'Past parent'],
                      ['current_staff', 'Current staff'],
                      ['past_staff', 'Past staff'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={details[key] ? 'chip-toggle on' : 'chip-toggle'}
                        aria-pressed={details[key]}
                        onClick={() => setDetail(key, !details[key])}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <span>How can the Alumni Association reach you?</span>
                  <div className="chip-toggle-row">
                    {[
                      ['comm_pref_email', 'Email'],
                      ['comm_pref_phone', 'Phone'],
                      ['comm_pref_sms', 'SMS'],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={details[key] ? 'chip-toggle on' : 'chip-toggle'}
                        aria-pressed={details[key]}
                        onClick={() => setDetail(key, !details[key])}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <span>Membership tier</span>
                  <p className="hint">
                    {details.subscription_tier} — set by the Alumni Association office, not editable here.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Mentoring — Collapsible, two clearly separate halves. */}
          <div className="profile-section pe-section" id="pe-section-mentoring" ref={setSectionRef('mentoring')}>
            <button type="button"
              className="profile-mentoring-toggle"
              onClick={() => setShowMentoring(!showMentoring)}
            >
              <span className="profile-mentoring-title">
                Mentoring
                {mentoringHasMissing && <span className="field-missing-dot" aria-label="Has unfilled optional fields" />}
              </span>
              <span className={`toggle-arrow ${showMentoring ? 'open' : ''}`}>▼</span>
            </button>

            {showMentoring && (
              <div className="profile-mentoring-content">
                <p className="pe-section-hint" style={{ marginTop: 0 }}>
                  Choose how you&rsquo;d like to participate in the alumni mentoring network — you can be both a mentor and a mentee, or either alone.
                </p>

                {/* ---- Half 1: helping other alumni ---- */}
                <div className="pe-mentor-subhead">
                  <span className="pe-mentor-subhead-eyebrow">Help other alumni</span>
                  <span className="pe-mentor-subhead-desc">Share your experience with other alumni.</span>
                </div>

                {/* Single, top-level gate for this half — everything below
                    only makes sense once someone has actually said yes
                    here, so it's the one and only "am I open to this"
                    question. This toggle alone is also what puts someone
                    under Find a Mentor — there's no separate
                    "Mentoring/Coaching" checkbox anymore, so this is the
                    only thing to flip. */}
                <div className="field">
                  <span>Open to mentoring and other opportunities?</span>
                  <div className="onboarding-choice-row profile-choice-row">
                    <button
                      type="button"
                      className={form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
                      onClick={() => saveToggle('is_open_to_opportunities', true)}
                      disabled={togglingField === 'is_open_to_opportunities'}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className={!form.is_open_to_opportunities ? 'onboarding-choice on' : 'onboarding-choice'}
                      onClick={() => saveToggle('is_open_to_opportunities', false)}
                      disabled={togglingField === 'is_open_to_opportunities'}
                    >
                      Not right now
                    </button>
                  </div>
                  {togglingField === 'is_open_to_opportunities' && <span className="hint">Saving…</span>}
                  {form.is_open_to_opportunities && togglingField !== 'is_open_to_opportunities' && (
                    <span className="hint mentor-status-hint">
                      ✓ You'll show up under Find a Mentor.{' '}
                      <button type="button" className="link-btn" onClick={() => navigate('/mentoring')}>
                        See how you appear →
                      </button>
                    </span>
                  )}
                </div>

                {form.is_open_to_opportunities && (
                  <div className="profile-mentoring-details">
                    <div className="field-row">
                      <label className={fieldCls('availability')} id="field-availability"><span>Availability</span>
                        <ListAutocomplete
                          value={form.availability}
                          onChange={(value) => set('availability', value)}
                          options={AVAILABILITY_OPTIONS}
                          placeholder="Search your availability"
                          clearable
                        />
                      </label>

                      <div className={fieldCls('geographic_focus')} id="field-geographic_focus">
                        <span>Geographic focus</span>
                        <div className="tags-grid compact">
                          {GEOGRAPHIC_FOCUS.map((geo) => (
                            <button
                              key={geo}
                              type="button"
                              className={`tag-btn ${form.geographic_focus.includes(geo) ? 'selected' : ''}`}
                              onClick={() => toggleTag('geographic_focus', geo)}
                            >
                              {geo}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Main expertise — options are scoped to whichever industry is selected above */}
                    <label className={fieldCls('expertise')} id="field-expertise"><span>Main areas you can mentor in</span>
                      <MultiSelectAutocomplete
                        values={form.expertise}
                        onChange={(value) => set('expertise', value)}
                        options={EXPERTISE_BY_INDUSTRY[form.industry] || EXPERTISE_OPTIONS}
                        placeholder={form.industry ? 'Search your expertise, or type your own' : 'Pick an industry above to see relevant options'}
                        allowCustom
                      />
                    </label>

                    {/* Free-text mentoring description — replaces the old
                        structured "what can you offer" tag picker. A specific
                        list of services never covered what actually makes a
                        mentor useful nearly as well as a couple of sentences in
                        their own words does. */}
                    <label className="field"><span>Anything else you'd like people to know?</span>
                      <span className="hint">
                        Tell people about your experience, specific topics you're happy to discuss, industries you've worked in, or anything else that might be useful.
                      </span>
                      <textarea
                        rows={4}
                        value={form.mentor_note}
                        onChange={(e) => set('mentor_note', e.target.value.slice(0, 600))}
                        placeholder="I've worked in investment banking for the past 8 years and am happy to chat about careers in finance, preparing for interviews, or starting out in the industry."
                      />
                    </label>

                    {/* A simple on/off — not a capacity or scheduling system,
                        just whether you currently show up in the mentor
                        directory. Saves immediately like the toggle above,
                        same reasoning: this is a status, not a draft. */}
                    <div className="field">
                      <span>Are you currently available to mentor?</span>
                      <div className="onboarding-choice-row profile-choice-row">
                        <button
                          type="button"
                          className={!form.mentor_paused ? 'onboarding-choice on' : 'onboarding-choice'}
                          onClick={() => saveToggle('mentor_paused', false)}
                          disabled={togglingField === 'mentor_paused'}
                        >
                          Available
                        </button>
                        <button
                          type="button"
                          className={form.mentor_paused ? 'onboarding-choice on' : 'onboarding-choice'}
                          onClick={() => saveToggle('mentor_paused', true)}
                          disabled={togglingField === 'mentor_paused'}
                        >
                          Not currently available
                        </button>
                      </div>
                      {togglingField === 'mentor_paused' && <span className="hint">Saving…</span>}
                      <span className="hint">
                        Keeps your mentoring info on your profile but hides you from the active mentor directory. You can change this any time.
                      </span>
                    </div>

                    {/* Business website */}
                    <label className={fieldCls('business_website')} id="field-business_website"><span>Business website or portfolio (optional)</span>
                      <ClearableInput
                        type="url"
                        value={form.business_website}
                        onChange={(e) => set('business_website', e.target.value)}
                        onClear={() => set('business_website', '')}
                        placeholder="https://yourwebsite.com"
                      />
                    </label>
                  </div>
                )}

                {/* ---- Half 2: being mentored ---- */}
                <div className="pe-mentor-subhead pe-mentee-subhead">
                  <span className="pe-mentor-subhead-eyebrow">Find a mentor</span>
                  <span className="pe-mentor-subhead-desc">Let other alumni know you&rsquo;d like guidance.</span>
                </div>

                <div className="profile-mentee-block">
                  <div className="field">
                    <span>Looking for a mentor yourself?</span>
                    <span className="hint">
                      Say yes and mentors can find you under Find a Mentee, instead of you having to do all the asking.
                    </span>
                    <div className="onboarding-choice-row profile-choice-row">
                      <button
                        type="button"
                        className={form.seeking_mentor ? 'onboarding-choice on' : 'onboarding-choice'}
                        onClick={() => saveToggle('seeking_mentor', true)}
                        disabled={togglingField === 'seeking_mentor'}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        className={!form.seeking_mentor ? 'onboarding-choice on' : 'onboarding-choice'}
                        onClick={() => saveToggle('seeking_mentor', false)}
                        disabled={togglingField === 'seeking_mentor'}
                      >
                        Not right now
                      </button>
                    </div>
                    {togglingField === 'seeking_mentor' && <span className="hint">Saving…</span>}
                  </div>

                  {form.seeking_mentor && (
                    <div className="profile-mentoring-details">
                      <label className="field"><span>What do you want help with?</span>
                        <MultiSelectAutocomplete
                          values={form.mentee_goals}
                          onChange={(value) => set('mentee_goals', value)}
                          options={EXPERTISE_BY_INDUSTRY[form.industry] || EXPERTISE_OPTIONS}
                          placeholder={form.industry ? 'Search areas, or type your own' : 'Pick an industry above to see relevant options'}
                          allowCustom
                        />
                        {/* This is also what orders Find a Mentor for you, which
                            is worth saying out loud — otherwise it reads like
                            yet another optional tag field. */}
                        <span className="hint">
                          This is what sorts the Find a Mentor list for you, so it&rsquo;s worth being specific.
                        </span>
                      </label>

                      <label className="field"><span>Anything else a mentor should know? (optional)</span>
                        <textarea
                          value={form.mentee_note}
                          onChange={(e) => set('mentee_note', e.target.value.slice(0, 600))}
                          placeholder="Where you are now, and what you're trying to work out."
                          rows={3}
                        />
                        <span className="hint">{form.mentee_note.length} / 600</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status messages */}
          {error && <p className="form-error">{error}</p>}
          {geoWarning && (
            <p className="form-warning">
              Saved — but couldn't locate "{form.city}" for the Alumni Map. Double-check the spelling.
            </p>
          )}

          {/* Account — sign out / delete account. Deliberately not routed
              through the Save flow above: these aren't draft edits, they're
              immediate account actions. */}
          <div className="profile-section pe-section pe-account-section">
            <h3 className="profile-section-title">Account</h3>
            <div className="pe-account-actions">
              <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()} disabled={busy}>
                Sign out
              </button>
              <button type="button" className="btn ghost delete-danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
                Delete account
              </button>
            </div>
          </div>

        </div>
      </div>
      </form>

      {saved && (
        <div className="pe-saved-toast" role="status">
          <span className="check">✓</span> Changes saved
        </div>
      )}

      {dirty && (
        <SaveBar
          busy={busy}
          error={error}
          onDiscard={discardChanges}
          onSave={() => save()}
        />
      )}

      {showPhotoModal && (
        <ProfilePhotoModal
          avatarUrl={profile?.avatar_url}
          name={form.full_name}
          onClose={() => setShowPhotoModal(false)}
          onEdit={editExistingPhoto}
          onUpdate={() => fileRef.current?.click()}
          onDelete={deletePhoto}
          deleting={deletingPhoto}
          hasPhoto={!!profile?.avatar_url}
        />
      )}

      {cropFile && (
        <PhotoCropper
          file={cropFile}
          initialCrop={cropInitial}
          onCancel={() => { setCropFile(null); setCropInitial(null); setError(null) }}
          onSave={uploadCroppedPhoto}
          uploading={uploading}
          error={error}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete your account?"
          message={error || 'This will permanently remove your profile, posts, messages and photos, and cannot be undone.'}
          confirmLabel={busy ? 'Deleting…' : 'Delete permanently'}
          onConfirm={deleteProfile}
          onCancel={() => { setConfirmingDelete(false); setError(null) }}
        />
      )}
    </section>
  )
}

function ExperienceIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <path d="M2 13h20" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function CvIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8M10 9H8" />
    </svg>
  )
}

function CvFileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

function ProfilePhotoModal({ avatarUrl, name, onClose, onEdit, onUpdate, onDelete, deleting, hasPhoto }) {
  const initials = (name || 'A').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  // Escape, focus trap and Back-button close — this one was closable by
  // backdrop click only.
  // history: false — this modal is a quick-action sheet (view / edit / update /
  // delete), not a page-level view. Giving it a history entry caused a race: the
  // cleanup history.back() fired a popstate that PhotoCropper's useModal caught,
  // closing the cropper before the user ever saw it.
  const modalRef = useModal({ onClose, closeOnEscape: !deleting, history: false })
  return (
    <div className="modal-backdrop pfp-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Profile photo">
      <div className="pfp-modal" ref={modalRef} onClick={e => e.stopPropagation()}>
        <div className="pfp-modal-header">
          <h2>Profile photo</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="pfp-modal-body">
          <div className="pfp-modal-photo">
            {avatarUrl ? (
              <img src={avatarUrl} alt={name || 'Profile photo'} />
            ) : (
              <div className="pfp-modal-fallback" style={{ fontSize: 72 }}>{initials}</div>
            )}
          </div>
        </div>
        <div className="pfp-modal-actions">
          {hasPhoto && (
            <button type="button" className="pfp-action-btn" onClick={onEdit}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              <span>Edit</span>
            </button>
          )}
          <button type="button" className="pfp-action-btn" onClick={onUpdate}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            <span>Update</span>
          </button>
          {hasPhoto && (
            <button type="button" className="pfp-action-btn pfp-action-delete" onClick={onDelete} disabled={deleting}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              <span>{deleting ? 'Deleting…' : 'Delete'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
