// Supabase Edge Function: send-member-email
//
// The two transactional emails the signup flow was missing, in one function
// because they share a template shell and a Resend call:
//
//   kind: 'received' — "we've got your details, the committee is checking
//                      them". Sent by the member's own browser the moment
//                      consent is captured (the last step of the Auth.jsx
//                      wizard, or FinishSignup.jsx for Google joiners).
//                      Google joiners previously got NO email whatsoever
//                      between signing up and being approved — the account
//                      was created silently and then went quiet, which is
//                      indistinguishable from "the signup didn't work".
//
//   kind: 'declined' — "we couldn't place you against school records".
//                      Admin-only. Before this, an admin could approve or
//                      permanently delete and nothing else, so anyone who
//                      wasn't a SACS Old Boy sat on the "we're verifying you"
//                      screen forever waiting for an answer that was never
//                      coming.
//
// Auth model differs per kind, deliberately:
//   'received' acts on the CALLER'S OWN account — no target id is accepted
//              at all, so it can't be used to spray mail at other members.
//   'declined' requires is_admin() checked against the caller's own token,
//              same pattern as admin-delete-member and send-approval-email.
//
// Required secret (Project Settings → Edge Functions → Secrets):
//   RESEND_API_KEY
//
// Deploy:
//   supabase functions deploy send-member-email

import { createClient } from 'npm:@supabase/supabase-js@2'

// CORS is inlined rather than imported from ../_shared/accountCleanup.ts.
// That module also pulls in the storage-purge helpers, which this function has
// no business touching, and keeping this file dependency-free means it deploys
// identically whether it goes out via the Supabase CLI or a single-file push.
// Keep ALLOWED_ORIGINS in step with the copy in _shared/accountCleanup.ts —
// the production domain MUST be listed, or the browser blocks the response and
// the email silently never sends.
const ALLOWED_ORIGINS = [
  'https://sacsalumni.org',
  'https://www.sacsalumni.org',
  'http://localhost:5173',
  'http://localhost:3000',
]
// NOTE: 'sacs-hub' assumes that's the Vercel project name/slug — update if
// the project gets created under a different name. See the matching note in
// _shared/accountCleanup.ts, which this file deliberately doesn't import.
const PREVIEW_ORIGIN_RE = /^https:\/\/sacs-hub[a-z0-9-]*\.vercel\.app$/

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN_RE.test(origin)
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
}

// NOTE: sacsalumni.org isn't purchased yet — update SITE_URL to the live
// vercel.app URL after Phase 6 deploy, and again once the domain is wired up.
const SITE_URL = 'https://sacsalumni.org'
const FROM_ADDRESS = 'SACS Alumni Hub <no-reply@sacsalumni.org>'
const ADMIN_CONTACT = 'sacsalumnihub@gmail.com'

// Same table-based shell as send-approval-email and the confirm-signup
// template, so all four transactional emails read as one product. Inline
// styles only — Outlook throws away <style> blocks.
function shell(heading: string, bodyHtml: string, footerNote: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0; padding:0; background:#FAF7F2; font-family:'Inter',Arial,sans-serif; color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px; width:100%; background:#FFFFFF; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(26,26,26,0.06);">
          <tr>
            <td style="background:#002F5F; padding:20px 32px;">
              <span style="font-family:Georgia,'Times New Roman',serif; font-size:20px; color:#FFFFFF; letter-spacing:0.02em;">SACS Alumni Hub</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <h1 style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:22px; color:#002F5F;">${heading}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px; border-top:1px solid #E8E1D5;">
              <p style="margin:0; font-size:12px; line-height:1.6; color:#5C5C5C;">
                SACS Alumni Hub · <a href="${SITE_URL}" style="color:#5C5C5C;">sacsalumni.org</a><br>
                ${footerNote}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()
}

const P = 'margin:0 0 16px; font-size:15px; line-height:1.6; color:#1A1A1A;'

// Both the member's own name and an admin-typed decline reason end up inside
// an HTML email, and both are free text somebody chose. Escape everything that
// gets interpolated rather than deciding case by case which source is "safe".
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function receivedEmail(name: string) {
  const firstName = escapeHtml(name)
  return {
    subject: 'We’ve got your SACS Alumni Hub details',
    html: shell(
      `Thanks, ${firstName} — we’ve got your details`,
      `
      <p style="${P}">
        Your signup is in. The Alumni Association now checks your details against
        SACS school records, which is usually quick but can take a few days
        if there’s a query.
      </p>
      <p style="${P}">
        <strong>You don’t need to do anything.</strong> We’ll email you the moment
        you’re confirmed, and you’ll be able to sign in then.
      </p>
      <p style="margin:0; font-size:13px; line-height:1.6; color:#5C5C5C;">
        Spotted a mistake in what you sent, or been waiting longer than a week?
        Reply to <a href="mailto:${ADMIN_CONTACT}" style="color:#5C5C5C;">${ADMIN_CONTACT}</a>
        and we’ll sort it out.
      </p>`,
      'You’re receiving this because you signed up at sacsalumni.org.',
    ),
  }
}

function declinedEmail(name: string, reason: string) {
  const firstName = escapeHtml(name)
  const reasonBlock = reason
    ? `<p style="${P}"><strong>What we were told:</strong> ${escapeHtml(reason)}</p>`
    : ''
  return {
    subject: 'About your SACS Alumni Hub account',
    html: shell(
      `Hi ${firstName}`,
      `
      <p style="${P}">
        Thanks for signing up to SACS Alumni Hub. We check every new account
        against SACS school records before letting anyone in, and we
        weren’t able to match yours.
      </p>
      ${reasonBlock}
      <p style="${P}">
        That’s very often our mistake rather than yours — records from the older
        years in particular are patchy, and names change. If you did attend
        SACS, reply to
        <a href="mailto:${ADMIN_CONTACT}" style="color:#1A1A1A;">${ADMIN_CONTACT}</a>
        with the years you were there and anyone who’d vouch for you, and we’ll
        take another look.
      </p>
      <p style="margin:0; font-size:13px; line-height:1.6; color:#5C5C5C;">
        Your account stays as it is in the meantime — there’s no need to sign up again.
      </p>`,
      'You’re receiving this because you requested a SACS Alumni Hub account.',
    ),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { kind?: string; user_id?: string; reason?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body' }, 400)
    }

    const kind = body?.kind
    if (kind !== 'received' && kind !== 'declined') {
      return json(req, { error: "kind must be 'received' or 'declined'" }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      console.error('RESEND_API_KEY is not set')
      return json(req, { error: 'Email sending is not configured yet' }, 500)
    }

    const callerClient = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    // Who the mail is about. 'received' is always about the caller — the
    // request body is not consulted, so this endpoint can't be turned into a
    // way to email arbitrary members.
    let targetUserId = userData.user.id
    if (kind === 'declined') {
      const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc('is_admin')
      if (adminCheckErr || isAdmin !== true) return json(req, { error: 'Admins only' }, 403)
      // Typed as string in the interface above, but that's a compile-time
      // fiction over runtime JSON — check the shape rather than assume it.
      if (typeof body?.user_id !== 'string' || !body.user_id.trim()) {
        return json(req, { error: 'user_id is required' }, 400)
      }
      targetUserId = body.user_id.trim()
    }

    const adminClient = createClient(supabaseUrl!, serviceRoleKey!)

    const [{ data: profile }, { data: authUser, error: authUserErr }] = await Promise.all([
      adminClient.from('profiles').select('full_name, first_name').eq('id', targetUserId).maybeSingle(),
      adminClient.auth.admin.getUserById(targetUserId),
    ])

    const email = authUser?.user?.email
    if (authUserErr || !email) {
      return json(req, { error: 'Could not find an email address for that member' }, 400)
    }

    const firstName =
      (profile?.first_name ?? '').trim() ||
      (profile?.full_name ?? '').trim().split(/\s+/)[0] ||
      'there'

    // Same reasoning as user_id: coerce, don't trust the declared type.
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

    const { subject, html } =
      kind === 'received'
        ? receivedEmail(firstName)
        : declinedEmail(firstName, reason)

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [email], subject, html }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.text()
      console.error('Resend send failed:', resendRes.status, detail)
      return json(req, { error: 'Failed to send email' }, 502)
    }

    return json(req, { success: true })
  } catch (e) {
    return json(req, { error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})
