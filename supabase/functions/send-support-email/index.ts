// Supabase Edge Function: send-support-email
//
// Replaces every "get in touch" / "let us know" / "email an admin" mailto:
// link in the app (footer, the profile-load-error / account-removed /
// account-declined screens, PendingVerification, the Donate page) with the
// same floating compose dialog used everywhere else (EmailModal.jsx). Those
// screens are all reached by someone who is SIGNED IN but not necessarily
// approved yet — that's the whole point of most of them — so unlike
// send-contact-email, this function deliberately does NOT gate on
// is_approved(). It only requires a valid session, so it can't be used by a
// fully logged-out visitor (there's no route that shows one of these links
// without a session already — see App.jsx's `if (!session) return <Auth/>`).
//
// The recipient is fixed, not caller-supplied — this is a "contact support"
// form, not a general relay, so there's no recipient_id to validate.
//
// Required secret (Project Settings → Edge Functions → Secrets):
//   RESEND_API_KEY
//
// Deploy:
//   supabase functions deploy send-support-email

import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://sacsalumni.org',
  'https://www.sacsalumni.org',
  'http://localhost:5173',
  'http://localhost:3000',
]
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

const SITE_URL = 'https://sacsalumni.org'
const FROM_DOMAIN = 'no-reply@sacsalumni.org'
// The exact address every "get in touch" mailto: link in the app pointed
// at — kept the same so nothing about where these land changes, only how
// they're sent.
const SUPPORT_EMAIL = 'kyletrompeter0@gmail.com'
const MAX_SUBJECT = 150
const MAX_MESSAGE = 4000

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeHeaderName(s: string): string {
  return s.replace(/[\r\n"<>]/g, '').trim().slice(0, 100)
}

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

const P = 'margin:0 0 16px; font-size:15px; line-height:1.6; color:#1A1A1A; white-space:pre-wrap;'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { subject?: string; message?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body' }, 400)
    }

    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const subjectInput = typeof body?.subject === 'string' ? body.subject.trim() : ''

    if (!message) return json(req, { error: 'Please write a message.' }, 400)
    if (message.length > MAX_MESSAGE) {
      return json(req, { error: `Message is too long (max ${MAX_MESSAGE} characters).` }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      console.error('RESEND_API_KEY is not set')
      return json(req, { error: 'Email sending is not configured yet' }, 500)
    }

    // Who's actually sending this — never trust anything from the body for
    // identity, same as every other function here.
    const callerClient = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const senderId = userData.user.id
    const senderEmail = userData.user.email
    if (!senderEmail) return json(req, { error: 'Your account has no email on file' }, 400)

    // Best-effort name lookup — a brand-new signup or someone whose profile
    // row is missing still gets to send this, just with a plainer name.
    let senderFullName = ''
    if (serviceRoleKey) {
      const adminClient = createClient(supabaseUrl!, serviceRoleKey!)
      const { data: senderProfile } = await adminClient
        .from('profiles')
        .select('full_name')
        .eq('id', senderId)
        .maybeSingle()
      senderFullName = (senderProfile?.full_name ?? '').trim()
    }
    const senderDisplayName = senderFullName || senderEmail
    const senderFirstName = senderFullName.split(/\s+/)[0] || senderEmail

    const subject = (subjectInput || `Message from ${senderDisplayName} via SACS Alumni Hub`).slice(0, MAX_SUBJECT)
    const fromName = sanitizeHeaderName(`${senderDisplayName} (via SACS Alumni Hub)`)

    const html = shell(
      `${escapeHtml(senderFirstName)} sent you a message`,
      `
      <p style="${P}">${escapeHtml(message)}</p>
      <p style="margin:24px 0 0; font-size:13px; line-height:1.6; color:#5C5C5C;">
        Just hit reply — it'll go straight to ${escapeHtml(senderDisplayName)} (${escapeHtml(senderEmail)}), not to us.
      </p>`,
      `Sent via the "get in touch" / "email an admin" form on sacsalumni.org.`,
    )
    const text =
      `${message}\n\n---\nFrom: ${senderDisplayName} <${senderEmail}>\n` +
      `Sent via the "get in touch" / "email an admin" form on sacsalumni.org.`

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${FROM_DOMAIN}>`,
        to: [SUPPORT_EMAIL],
        reply_to: senderEmail,
        subject,
        html,
        text,
      }),
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
