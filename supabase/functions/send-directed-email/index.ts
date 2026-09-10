// Supabase Edge Function: send-directed-email
//
// Two more mailto: replacements that don't fit send-contact-email's shape
// (both sides must be an *approved* member) or send-support-email's (fixed
// recipient):
//
//   kind: 'admin_to_member' — an admin emailing a member/pending-signup who
//     may not be approved yet (MembersPage's email field, PendingPage's
//     "Nudge them"). Gated on is_admin(); the recipient is looked up by id
//     regardless of approval status, because half the point is reaching
//     people who AREN'T approved yet.
//
//   kind: 'member_to_business' — any approved member emailing the contact
//     address a business listing published (BusinessDetail.jsx). That
//     address is free text the business owner typed in, not necessarily
//     their own login email — the existing "Message" button already
//     handles emailing the owner's account directly (send-contact-email),
//     this is specifically for the business's own listed contact. Gated on
//     is_approved(); the address is looked up server-side from businesses
//     by id, never trusted from the request body, so this can't be turned
//     into a way to email an arbitrary address.
//
// Required secret (Project Settings → Edge Functions → Secrets):
//   RESEND_API_KEY
//
// Deploy:
//   supabase functions deploy send-directed-email

import { createClient } from 'npm:@supabase/supabase-js@2'

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

    let body: { kind?: string; target_id?: string; subject?: string; message?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body' }, 400)
    }

    const kind = typeof body?.kind === 'string' ? body.kind : ''
    const targetId = typeof body?.target_id === 'string' ? body.target_id.trim() : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const subjectInput = typeof body?.subject === 'string' ? body.subject.trim() : ''

    if (kind !== 'admin_to_member' && kind !== 'member_to_business') {
      return json(req, { error: 'Unknown request type' }, 400)
    }
    if (!targetId) return json(req, { error: 'target_id is required' }, 400)
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

    const callerClient = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const senderId = userData.user.id
    const senderEmail = userData.user.email
    if (!senderEmail) return json(req, { error: 'Your account has no email on file' }, 400)

    const adminClient = createClient(supabaseUrl!, serviceRoleKey!)

    const { data: senderProfile } = await adminClient
      .from('profiles')
      .select('full_name, first_name')
      .eq('id', senderId)
      .maybeSingle()
    const senderFirstName =
      (senderProfile?.first_name ?? '').trim() ||
      (senderProfile?.full_name ?? '').trim().split(/\s+/)[0] ||
      senderEmail
    const senderFullName = (senderProfile?.full_name ?? '').trim() || senderFirstName

    let recipientEmail: string | null = null
    let recipientFirstName = 'there'
    let footerNote = ''
    let heading = ''

    if (kind === 'admin_to_member') {
      const { data: isAdmin, error: adminErr } = await callerClient.rpc('is_admin')
      if (adminErr || isAdmin !== true) {
        return json(req, { error: 'Only admins can send this.' }, 403)
      }

      const [{ data: recipientProfile }, { data: recipientAuthUser, error: recipientAuthErr }] = await Promise.all([
        adminClient.from('profiles').select('full_name').eq('id', targetId).maybeSingle(),
        adminClient.auth.admin.getUserById(targetId),
      ])

      recipientEmail = recipientAuthUser?.user?.email ?? null
      if (recipientAuthErr || !recipientEmail) {
        return json(req, { error: 'Could not find an email address for that person.' }, 404)
      }
      recipientFirstName = (recipientProfile?.full_name ?? '').trim().split(/\s+/)[0] || 'there'
      heading = `A message from the SACS Alumni team`
      footerNote = `You're receiving this because ${escapeHtml(senderFullName)} (SACS Alumni admin) messaged you through sacsalumni.org.`
    } else {
      const { data: isApproved, error: approvedErr } = await callerClient.rpc('is_approved')
      if (approvedErr || isApproved !== true) {
        return json(req, { error: 'Your account must be approved before you can contact a business.' }, 403)
      }

      const { data: business, error: businessErr } = await adminClient
        .from('businesses')
        .select('name, contact_email')
        .eq('id', targetId)
        .maybeSingle()

      if (businessErr || !business || !business.contact_email) {
        return json(req, { error: 'Could not find a contact address for that business.' }, 404)
      }
      recipientEmail = business.contact_email
      recipientFirstName = (business.name ?? '').trim() || 'there'
      heading = `${escapeHtml(senderFirstName)} sent you a message via SACS Alumni Hub`
      footerNote = `You're receiving this because ${escapeHtml(senderFullName)} messaged your business listing "${escapeHtml(business.name ?? '')}" on sacsalumni.org.`
    }

    const subject = (subjectInput || `Message from ${senderFullName} via SACS Alumni Hub`).slice(0, MAX_SUBJECT)
    const fromName = sanitizeHeaderName(`${senderFullName} (via SACS Alumni Hub)`)

    const html = shell(
      heading,
      `
      <p style="${P}">${escapeHtml(message)}</p>
      <p style="margin:24px 0 0; font-size:13px; line-height:1.6; color:#5C5C5C;">
        Just hit reply — it'll go straight to ${escapeHtml(senderFullName)}, not to us.
      </p>`,
      footerNote,
    )
    const text =
      `${message}\n\n---\nJust hit reply — it'll go straight to ${senderFullName}, not to us.\n${footerNote}`

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
