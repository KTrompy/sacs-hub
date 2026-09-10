// Supabase Edge Function: send-contact-email
//
// Replaces the old real-time DM feature. Clicking "Message" anywhere in the
// app now opens ContactModal.jsx, which calls this function instead of
// writing to a `messages` table. There is no inbox and nothing is stored —
// this is a one-shot relay: caller writes a subject + message, this
// function emails the recipient via Resend, and that's the whole feature.
//
// Auth model:
//   The caller's own token proves who they are (never trust a sender id
//   from the request body) and must belong to an approved member — the
//   same is_approved() gate every other write in this app uses. The
//   *recipient* just needs to be a real, approved profile; there's no
//   reciprocal "who can message you" setting anymore (that was
//   profiles.privacy_messages, dropped in schema-update-63) — any approved
//   member can email any other approved member, same as the old default
//   "all" setting most people already had.
//
// Why Reply-To instead of a real "from":
//   Resend can only send from a domain this project has verified
//   (sacsalumni.org) — it can't send as someone's personal Gmail/Outlook
//   address. So the email arrives *from* the no-reply address with the
//   sender's name attached, but Reply-To is set to the sender's real
//   email, so hitting "Reply" in any mail client goes straight to them —
//   no need to expose their address anywhere in the UI.
//
// Required secret (Project Settings → Edge Functions → Secrets, or
// `supabase secrets set RESEND_API_KEY=...`):
//   RESEND_API_KEY
//
// Deploy:
//   supabase functions deploy send-contact-email

import { createClient } from 'npm:@supabase/supabase-js@2'

// Keep in step with the other email functions' ALLOWED_ORIGINS — the
// production domain MUST be listed, or the browser blocks the response and
// the email silently never sends.
const ALLOWED_ORIGINS = [
  'https://sacsalumni.org',
  'https://www.sacsalumni.org',
  'http://localhost:5173',
  'http://localhost:3000',
  'https://sacsalumni.pages.dev',
]
const PREVIEW_ORIGIN_RE = /^https:\/\/sacs-hub[a-z0-9-]*\.vercel\.app$/
// The live site moved to Cloudflare Pages (sacsalumni.pages.dev) --
// this covers Cloudflare's preview-deploy subdomains the same way
// PREVIEW_ORIGIN_RE covers Vercel's.
const CF_PAGES_PREVIEW_ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.sacsalumni\.pages\.dev$/

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN_RE.test(origin) || CF_PAGES_PREVIEW_ORIGIN_RE.test(origin)
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

// A display name goes into an email header ("From: <name> <addr>") — strip
// anything that could break out of that (newlines, angle brackets, quotes)
// rather than trying to escape it correctly for every mail client.
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

    let body: { recipient_id?: string; subject?: string; message?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body' }, 400)
    }

    const recipientId = typeof body?.recipient_id === 'string' ? body.recipient_id.trim() : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const subjectInput = typeof body?.subject === 'string' ? body.subject.trim() : ''

    if (!recipientId) return json(req, { error: 'recipient_id is required' }, 400)
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

    // Who's actually sending this — never trust a sender id from the body.
    const callerClient = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const senderId = userData.user.id
    const senderEmail = userData.user.email
    if (!senderEmail) return json(req, { error: 'Your account has no email on file' }, 400)

    if (recipientId === senderId) {
      return json(req, { error: "You can't email yourself." }, 400)
    }

    // Only approved members can send — the same gate every write in this
    // app respects. (There's deliberately no matching check that the
    // *recipient* has some "who can message me" setting — that setting
    // was removed along with the old DM feature.)
    const { data: isApproved, error: approvedErr } = await callerClient.rpc('is_approved')
    if (approvedErr || isApproved !== true) {
      return json(req, { error: 'Your account must be approved before you can contact other members.' }, 403)
    }

    const adminClient = createClient(supabaseUrl!, serviceRoleKey!)

    const [{ data: senderProfile }, { data: recipientProfile }, { data: recipientAuthUser, error: recipientAuthErr }] =
      await Promise.all([
        adminClient.from('profiles').select('full_name, first_name').eq('id', senderId).maybeSingle(),
        adminClient.from('profiles').select('full_name, approved').eq('id', recipientId).maybeSingle(),
        adminClient.auth.admin.getUserById(recipientId),
      ])

    if (!recipientProfile || recipientProfile.approved !== true) {
      return json(req, { error: 'Could not find that member.' }, 404)
    }

    const recipientEmail = recipientAuthUser?.user?.email
    if (recipientAuthErr || !recipientEmail) {
      return json(req, { error: 'Could not find an email address for that member.' }, 400)
    }

    const senderFirstName =
      (senderProfile?.first_name ?? '').trim() ||
      (senderProfile?.full_name ?? '').trim().split(/\s+/)[0] ||
      'A fellow Old Boy'
    const senderFullName = (senderProfile?.full_name ?? '').trim() || senderFirstName
    const recipientFirstName = (recipientProfile?.full_name ?? '').trim().split(/\s+/)[0] || 'there'

    const subject = (subjectInput || `Message from ${senderFullName} via SACS Alumni Hub`).slice(0, MAX_SUBJECT)
    const fromName = sanitizeHeaderName(`${senderFullName} (via SACS Alumni Hub)`)

    const html = shell(
      `${senderFirstName} sent you a message`,
      `
      <p style="${P}">${escapeHtml(message)}</p>
      <p style="margin:24px 0 0; font-size:13px; line-height:1.6; color:#5C5C5C;">
        Just hit reply — it'll go straight to ${escapeHtml(senderFirstName)}, not to us.
      </p>`,
      `You're receiving this because ${escapeHtml(senderFullName)} messaged you through sacsalumni.org. Sent on their behalf — we don't read or store this message.`,
    )
    const text =
      `${message}\n\n---\nJust hit reply — it'll go straight to ${senderFirstName}, not to us.\n` +
      `You're receiving this because ${senderFullName} messaged you through sacsalumni.org.`

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${FROM_DOMAIN}>`,
        to: [recipientEmail],
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

    return json(req, { success: true, recipient_first_name: recipientFirstName })
  } catch (e) {
    return json(req, { error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})
