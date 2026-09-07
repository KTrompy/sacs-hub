// The two ways a finished onboarding wizard gets saved. Ported from the old
// Auth.jsx's handleSignupSubmit (mode="new") and FinishSignup.jsx's save()
// (mode="resume"), field-for-field, minus industry/occupation/address-2/3
// (dropped from signup entirely — see Profile.jsx for where they now live)
// and with address collapsed to one line.
//
// Both build the *same* metadata shape the handle_new_user trigger already
// knows how to read (see schema-update-46's definition) — only which
// fields get collected changed, not the keys the trigger looks for.

import { supabase } from '../../supabaseClient'
import { authRedirectTo } from '../../authRedirect.js'
import { friendlyAuthError } from '../../authErrors.js'
import { COMMUNITY_ROLES } from '../../constants.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function buildMetadata(values) {
  const fullName = `${(values.preferredName.trim() || values.firstName.trim())} ${values.lastName.trim()}`.trim()
  return {
    full_name: fullName,
    first_name: values.firstName.trim(),
    preferred_name: values.preferredName.trim(),
    last_name: values.lastName.trim(),
    start_year: Number(values.startYear),
    grad_year: Number(values.endYear),
    email_news_opt_in: values.newsOptIn === true,
    address_line1: values.address.trim(),
    province: values.province.trim(),
    city: values.city.trim(),
    postal_code: values.postCode.trim(),
    country: values.country.trim(),
    phone: values.phone.trim(),
    // Ticked on the Finish step to get here — handle_new_user reads this
    // and stamps consented_at server-side, so email signups (no session
    // until the confirmation link is clicked) are covered by the trigger
    // itself rather than depending on a follow-up write below.
    data_consent: true,
    ...(values.cityCoords ? { lat: values.cityCoords.lat, lng: values.cityCoords.lng } : {}),
    title: values.title,
    date_of_birth: values.dob,
    ...Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, values.roles[r.key] === true])),
    comm_pref_email: values.newsOptIn === true,
    comm_pref_phone: values.commPrefPhone === true,
    comm_pref_sms: values.commPrefSms === true,
  }
}

// mode="new" — no session yet. Calls signUp() with the full metadata bundle
// so handle_new_user can write profiles + profile_details the instant the
// auth user is created, even when "Confirm email" leaves no session for the
// client to write with directly.
//
// Returns one of:
//   { status: 'confirm' }                    — check-your-email screen
//   { status: 'pending', session }            — signed in, PendingVerification next
//   { status: 'account-exists', message }     — point them at sign-in
//   { status: 'error', message }
export async function submitNewAccount({ values, captchaToken }) {
  const metadata = buildMetadata(values)
  try {
    const { data, error } = await supabase.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: { captchaToken, data: metadata, emailRedirectTo: authRedirectTo() },
    })
    if (error) throw error

    // Duplicate signup, the quiet way — Supabase returns a fake-success
    // (empty identities array) rather than an error when "Confirm email" is
    // on, specifically so the signup form can't be used to test whether an
    // address is registered. Wording stays symmetrical with the genuine
    // case for the same reason.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return {
        status: 'account-exists',
        message:
          'If that email address is already registered, we’ve emailed you about it — ' +
          'otherwise check your inbox for a confirmation link. You can also sign in below, ' +
          'or reset your password if you’ve forgotten it.',
      }
    }

    let session = data?.session
    if (!session && data?.user && !data.user.email_confirmed_at) {
      return { status: 'confirm' }
    }
    if (!session) {
      const { data: signinData, error: signInError } =
        await supabase.auth.signInWithPassword({ email: values.email.trim(), password: values.password })
      if (signInError) {
        if (/confirm/i.test(signInError.message)) return { status: 'confirm' }
        return {
          status: 'account-exists',
          message: /captcha/i.test(signInError.message)
            ? 'Your account was created. Please sign in below — you’ll need to complete the security check once more.'
            : "Your account was created, but we couldn't sign you in just now. " +
              'Try signing in below with the email and password you just chose.',
        }
      }
      session = signinData?.session
    }

    if (!session) return { status: 'error', message: 'Something went wrong. Please try again.' }

    // Belt-and-braces. handle_new_user already wrote this from
    // user_metadata — this is a safety net for anything the trigger
    // couldn't apply, not the primary write path.
    const { error: profErr } = await supabase
      .from('profiles')
      .update({
        full_name: metadata.full_name,
        first_name: metadata.first_name,
        preferred_name: metadata.preferred_name,
        last_name: metadata.last_name,
        start_year: metadata.start_year,
        grad_year: metadata.grad_year,
        email_news_opt_in: metadata.email_news_opt_in,
        address_line1: metadata.address_line1,
        province: metadata.province,
        city: metadata.city,
        postal_code: metadata.postal_code,
        country: metadata.country,
        phone: metadata.phone,
        ...(values.cityCoords ? { lat: values.cityCoords.lat, lng: values.cityCoords.lng } : {}),
        consented_at: new Date().toISOString(),
        details_completed_at: new Date().toISOString(),
      })
      .eq('id', session.user.id)
    if (profErr) console.warn('Profile update after signup failed:', profErr.message)

    const { error: detErr } = await supabase
      .from('profile_details')
      .upsert({
        profile_id: session.user.id,
        title: metadata.title,
        date_of_birth: metadata.date_of_birth,
        ...Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, metadata[r.key] === true])),
        comm_pref_email: metadata.comm_pref_email,
        comm_pref_phone: metadata.comm_pref_phone,
        comm_pref_sms: metadata.comm_pref_sms,
      })
    if (detErr) console.warn('Membership details save after signup failed:', detErr.message)

    // Fire-and-forget — a mail failure must never turn a successful signup
    // into a visible error. Note .then, not .catch: supabase-js's
    // functions.invoke resolves with { data, error } even for an
    // undeployed function or a network failure, so a .catch() here could
    // never fire.
    supabase.functions
      .invoke('send-member-email', { body: { kind: 'received' } })
      .then(({ error: mailErr }) => {
        if (mailErr) console.error('send-member-email (received) failed:', mailErr)
      })

    return { status: 'pending', session }
  } catch (e2) {
    if (/already registered|already exists|user_already_exists/i.test(e2.message || '')) {
      return {
        status: 'account-exists',
        message: 'There’s already an account with that email address. Try signing in instead — or reset your password if you’ve forgotten it.',
      }
    }
    return { status: 'error', message: friendlyAuthError(e2) }
  }
}

// mode="resume" — a session already exists (Google, or a legacy account
// resuming mid-flow). Writes profiles/profile_details directly rather than
// calling signUp(), same pattern the old FinishSignup.jsx used.
//
// Returns { status: 'done', profile } | { status: 'error', message }.
export async function submitResume({ session, values }) {
  const metadata = buildMetadata(values)
  const { data, error } = await supabase
    .from('profiles')
    .update({
      full_name: metadata.full_name,
      first_name: metadata.first_name,
      preferred_name: metadata.preferred_name,
      last_name: metadata.last_name,
      start_year: metadata.start_year,
      grad_year: metadata.grad_year,
      email_news_opt_in: metadata.email_news_opt_in,
      phone: metadata.phone,
      country: metadata.country,
      province: metadata.province,
      city: metadata.city,
      address_line1: metadata.address_line1,
      postal_code: metadata.postal_code,
      ...(values.cityCoords ? { lat: values.cityCoords.lat, lng: values.cityCoords.lng } : {}),
      consented_at: new Date().toISOString(),
      details_completed_at: new Date().toISOString(),
    })
    .eq('id', session.user.id)
    .select()
    .single()

  if (error) {
    return { status: 'error', message: friendlyAuthError(error, "Couldn't save your details — please try again.") }
  }

  const { error: detErr } = await supabase
    .from('profile_details')
    .upsert({
      profile_id: session.user.id,
      title: metadata.title,
      date_of_birth: metadata.date_of_birth,
      ...Object.fromEntries(COMMUNITY_ROLES.map((r) => [r.key, metadata[r.key] === true])),
      comm_pref_email: metadata.comm_pref_email,
      comm_pref_phone: metadata.comm_pref_phone,
      comm_pref_sms: metadata.comm_pref_sms,
    })
  if (detErr) {
    return { status: 'error', message: friendlyAuthError(detErr, "Couldn't save your details — please try again.") }
  }

  // Google joiners previously got no email at all between signing up and
  // being approved — this closes that gap, same as email signups get.
  supabase.functions
    .invoke('send-member-email', { body: { kind: 'received' } })
    .then(({ error: mailErr }) => {
      if (mailErr) console.error('send-member-email (received) failed:', mailErr)
    })

  return { status: 'done', profile: data }
}

// Resend the confirmation link. Used by EmailConfirmation.jsx (right after
// a mode="new" signup) and by Auth.jsx's sign-in form ("email not
// confirmed" recovery). GoTrue validates a captcha token on /resend just as
// it does on /signup — sending none means every resend is rejected wherever
// CAPTCHA protection is enabled, which is the one screen a member reaches
// precisely because they can't get in any other way.
export async function resendConfirmation({ email, captchaToken, captchaRequired }) {
  const addr = String(email ?? '').trim()
  if (!addr) return { ok: false, message: 'Enter the email address you signed up with first.' }
  if (!EMAIL_RE.test(addr)) return { ok: false, message: 'That email address doesn’t look right — check it for typos.' }
  if (captchaRequired && !captchaToken) {
    return { ok: false, message: 'Please complete the security check first, then try again.' }
  }
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: addr,
    options: { emailRedirectTo: authRedirectTo(), captchaToken },
  })
  if (error) return { ok: false, message: friendlyAuthError(error) }
  return { ok: true, message: `Sent to ${addr} — check your inbox again in a minute or two, and look in spam.` }
}
