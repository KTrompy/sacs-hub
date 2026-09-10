// Supabase Edge Function: send-broadcast-email
//
// Admin -> many members in one go ("Email N selected" on Admin -> Members).
// Same auth shape as send-directed-email's admin_to_member kind (is_admin()
// checked against the caller's own token, recipients looked up server-side
// so the browser never needs a member's email), but fans out to a list
// instead of one target and requires real opt-in consent (see below) --
// nothing else sent by this codebase works that way.
//
// Recipient emails and names come from admin_list_members() rather than
// admin.getUserById() in a loop -- that RPC already joins profiles to
// auth.users and is_admin()-gated, so one call gets every member's email
// in the same shape the Members page itself uses, instead of one Admin
// API round trip per recipient.
//
// Consent: a member is sent this only if notification_preferences
// .notify_admin_broadcast is true (whatever they last chose in Settings),
// or -- if they've never saved a Settings preference -- if
// profiles.email_news_opt_in is true (their signup answer). No signal at
// all = not sent. (schema-update-66 originally shipped this as an
// opt-out, default-true column; that didn't match what the signup screen
// promised members, so this now requires an actual opt-in signal.)
//
// Sends batch through Resend's /emails/batch endpoint (max 100 per call
// per Resend's limit), chunking larger selections.
//
// Required secret (Project Settings -> Edge Functions -> Secrets):
//   RESEND_API_KEY
//
// Deploy:
//   supabase functions deploy send-broadcast-email

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
// Matches EmailModal.jsx's RICH_MAX_MESSAGE -- this is now sanitized HTML
// (headings, formatting, inline image tags), not plain text, so the old
// 4000-character plain-text cap was far too tight for a real newsletter.
const MAX_MESSAGE = 20000
// A hard ceiling, not a real-world expectation -- this is a safety rail
// against a mis-click sending to an enormous accidental selection, and
// keeps one request well within Resend's rate limits. Raise it if the
// Alumni Hub ever has more members than this.
const MAX_RECIPIENTS = 1000
// Resend's /emails/batch endpoint caps a single call at 100 messages.
const RESEND_BATCH_SIZE = 100

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// The composer (EmailEditor.jsx) already runs everything through DOMPurify
// with a tight tag/attribute whitelist (sanitizeEmailHtml, src/sanitizeHtml.js)
// before it ever reaches here, and only an admin (is_admin(), checked below)
// can call this function at all. This is a second, deliberately simple pass
// on top of that -- not a full HTML parser, just a backstop in case this
// endpoint is ever called directly with a bypassed or stale client -- since
// whatever comes through goes out to every selected member's inbox. It
// strips the categories of tag/attribute no legitimate newsletter needs:
// script/style/iframe/object/embed blocks, any on*="" event handler, and
// javascript:/data: URLs in href or src.
function stripDangerousHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed)[^>]*\/?>(?!<\/\1>)/gi, '')
    .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/((?:href|src)\s*=\s*)(["'])\s*(javascript|data):[^"']*\2/gi, '$1$2$2')
}

function sanitizeHeaderName(s: string): string {
  return s.replace(/[\r\n"<>]/g, '').trim().slice(0, 100)
}

// Same table-based shell as every other transactional email in this app --
// inline styles only, Outlook throws away <style> blocks.
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
                SACS Alumni Hub &middot; <a href="${SITE_URL}" style="color:#5C5C5C;">sacsalumni.org</a><br>
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

type Member = {
  id: string
  email: string | null
  full_name: string | null
  first_name?: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { recipient_ids?: unknown; subject?: unknown; message?: unknown } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body' }, 400)
    }

    const recipientIdsRaw = Array.isArray(body?.recipient_ids) ? body.recipient_ids : null
    const subjectInput = typeof body?.subject === 'string' ? body.subject.trim() : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''

    if (!recipientIdsRaw || recipientIdsRaw.length === 0) {
      return json(req, { error: 'Select at least one recipient.' }, 400)
    }
    if (!recipientIdsRaw.every((v) => typeof v === 'string' && v.trim())) {
      return json(req, { error: 'Invalid recipient list.' }, 400)
    }
    if (!message) return json(req, { error: 'Please write a message.' }, 400)
    if (message.length > MAX_MESSAGE) {
      return json(req, { error: `Message is too long (max ${MAX_MESSAGE} characters).` }, 400)
    }
    const safeMessage = stripDangerousHtml(message)

    const recipientIds = Array.from(new Set(recipientIdsRaw as string[]))
    if (recipientIds.length > MAX_RECIPIENTS) {
      return json(req, { error: `Too many recipients selected (max ${MAX_RECIPIENTS} at once).` }, 400)
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

    const { data: isAdmin, error: adminErr } = await callerClient.rpc('is_admin')
    if (adminErr || isAdmin !== true) {
      return json(req, { error: 'Only admins can send this.' }, 403)
    }

    const senderId = userData.user.id
    const senderEmail = userData.user.email

    const adminClient = createClient(supabaseUrl!, serviceRoleKey!)

    // One call gets every member's email/name in the shape the Members
    // page already uses -- cheaper and simpler than an Admin API round
    // trip per recipient. is_admin() is re-checked inside the RPC itself,
    // so this is safe to call with the caller's own (already-admin) token.
    const { data: allMembers, error: membersErr } = await callerClient.rpc('admin_list_members')
    if (membersErr || !allMembers) {
      return json(req, { error: 'Could not load the member list.' }, 500)
    }

    const [{ data: senderProfile }, { data: prefRows }, { data: optInRows }] = await Promise.all([
      adminClient.from('profiles').select('full_name, first_name').eq('id', senderId).maybeSingle(),
      adminClient
        .from('notification_preferences')
        .select('user_id, notify_admin_broadcast')
        .in('user_id', recipientIds),
      // Real POPIA opt-in consent has to come from somewhere even for a
      // member who has never opened Settings -- that's what they answered
      // on the "email me news and events" question at signup. Only once
      // they've actually saved a preference in Settings does that value
      // (prefRows, below) take over.
      adminClient
        .from('profiles')
        .select('id, email_news_opt_in')
        .in('id', recipientIds),
    ])

    const senderFirstName =
      (senderProfile?.first_name ?? '').trim() ||
      (senderProfile?.full_name ?? '').trim().split(/\s+/)[0] ||
      senderEmail ||
      'The committee'
    const senderFullName = (senderProfile?.full_name ?? '').trim() || senderFirstName

    // A member is only included if they've affirmatively opted in:
    // either they've explicitly set notify_admin_broadcast in Settings
    // (true or false, whichever they chose most recently), or -- if
    // they've never touched Settings at all -- they said yes to news/event
    // emails at signup (profiles.email_news_opt_in). Anyone with neither
    // signal is treated as opted out, not opted in.
    const explicitPref = new Map((prefRows ?? []).map((r) => [r.user_id, r.notify_admin_broadcast === true]))
    const signupOptIn = new Map((optInRows ?? []).map((r) => [r.id, r.email_news_opt_in === true]))
    const optedIn = (id: string): boolean => explicitPref.has(id) ? (explicitPref.get(id) ?? false) : (signupOptIn.get(id) ?? false)

    const membersById = new Map((allMembers as Member[]).map((m) => [m.id, m]))

    const toSend: { email: string; firstName: string }[] = []
    let optedOutCount = 0
    let skippedNoEmail = 0

    for (const id of recipientIds) {
      const m = membersById.get(id)
      if (!m || !m.email) { skippedNoEmail++; continue }
      if (!optedIn(id)) { optedOutCount++; continue }
      const firstName = (m.first_name ?? '').trim() || (m.full_name ?? '').trim().split(/\s+/)[0] || 'there'
      toSend.push({ email: m.email, firstName })
    }

    if (toSend.length === 0) {
      return json(req, {
        error:
          optedOutCount > 0
            ? 'None of the selected members have opted in to committee emails.'
            : 'None of the selected members have a usable email address.',
      }, 400)
    }

    const subject = (subjectInput || `A message from ${senderFullName} via SACS Alumni Hub`).slice(0, MAX_SUBJECT)
    const fromName = sanitizeHeaderName(`${senderFullName} (via SACS Alumni Hub)`)
    const heading = 'A message from the SACS Alumni team'
    const footerNote =
      `You're receiving this because you're a SACS Alumni Hub member and ${escapeHtml(senderFullName)} ` +
      `(SACS Alumni admin) sent this to a group that included you. Turn these off any time in ` +
      `Settings &rarr; Notifications &rarr; Committee emails.`
    // Rough HTML -> plain text: strip tags, then unescape the handful of
    // entities the editor's own commands can produce (bold/italic/lists/
    // links/headings never need more than this). Good enough for the
    // fallback body a handful of very old or text-only mail clients show
    // -- not meant to be a general HTML-to-text converter.
    const plainMessage = safeMessage
      .replace(/<(p|div|h1|h2|h3|li|br|hr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const footerText =
      `---\nYou're receiving this because you're a SACS Alumni Hub member and ${senderFullName} ` +
      `(SACS Alumni admin) sent this to a group that included you. Turn these off any time in ` +
      `Settings -> Notifications -> Committee emails.`

    let sent = 0
    let sendFailed = 0

    for (let i = 0; i < toSend.length; i += RESEND_BATCH_SIZE) {
      const chunk = toSend.slice(i, i + RESEND_BATCH_SIZE)
      const payload = chunk.map(({ email, firstName }) => ({
        from: `${fromName} <${FROM_DOMAIN}>`,
        to: [email],
        reply_to: senderEmail || undefined,
        subject,
        html: shell(
          heading,
          `<p style="${P}">Hi ${escapeHtml(firstName)},</p><div style="font-size:15px;line-height:1.6;color:#1A1A1A;padding-bottom:16px;">${safeMessage}</div>`,
          footerNote,
        ),
        text: `Hi ${firstName},\n\n${plainMessage}\n\n${footerText}`,
      }))

      const resendRes = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!resendRes.ok) {
        const detail = await resendRes.text()
        console.error('Resend batch send failed:', resendRes.status, detail)
        sendFailed += chunk.length
      } else {
        sent += chunk.length
      }
    }

    // Direct insert, not the log_admin_action() trigger path -- there's no
    // profiles row being changed here for a trigger to fire on, same
    // reasoning as admin-delete-member's direct admin_actions insert
    // (service-role writes have no auth.uid() for a trigger to key off).
    await adminClient.from('admin_actions').insert({
      actor_id: senderId,
      actor_name: senderFullName,
      action: 'send_broadcast_email',
      target_type: 'members',
      target_id: null,
      target_label: `${sent} member${sent === 1 ? '' : 's'}`,
      details: subject,
    })

    if (sent === 0) {
      return json(req, { error: 'Failed to send. Please try again.' }, 502)
    }

    return json(req, {
      success: true,
      sent,
      opted_out: optedOutCount,
      skipped_no_email: skippedNoEmail,
      failed: sendFailed,
    })
  } catch (e) {
    return json(req, { error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})
