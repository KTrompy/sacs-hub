// Supabase Edge Function: send-approval-email
//
// Fires when an admin approves a pending member in Admin.jsx (setApproved).
// Sends a "you're verified — come sign in" email via Resend.
//
// Mirrors the auth pattern in admin-delete-member: the caller's own token is
// used to verify they're actually an admin server-side, never trusting a
// role claim from the client. The service-role client is only used to look
// up the target member's email (profiles has no email column — that lives
// on auth.users) and to send the mail.
//
// Required secret (Project Settings → Edge Functions → Secrets, or
// `supabase secrets set RESEND_API_KEY=...`):
//   RESEND_API_KEY
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-approval-email
//
// Wire-up: in Admin.jsx's setApproved, after a successful approve:
//   if (approved && !error) {
//     supabase.functions.invoke('send-approval-email', { body: { user_id: id } })
//   }
// Deliberately fire-and-forget from the client — a failed email must never
// block or roll back the approval itself.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, json } from '../_shared/accountCleanup.ts'

// NOTE: sacsalumni.org isn't purchased yet (see project memory) — this is
// the intended production domain. Until then, update SITE_URL to the live
// vercel.app URL after Phase 6 deploy, and again once the domain is wired
// up, or these links point nowhere useful.
const SITE_URL = 'https://sacsalumni.org'
const FROM_ADDRESS = 'SACS Alumni Hub <no-reply@sacsalumni.org>'

// Branded HTML shell — mirrors the palette in src/styles.css (SACS gold
// #C9A227, SACS navy #002F5F, paper #FAF7F2) so transactional mail matches
// the app rather than reading like a bare system notice. Table-based layout
// + inline styles for email-client compatibility (Outlook etc. ignore
// <style> blocks).
function approvalEmailHtml(firstName: string): string {
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
              <h1 style="margin:0 0 16px; font-family:Georgia,'Times New Roman',serif; font-size:22px; color:#002F5F;">You're verified, ${firstName}</h1>
              <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#1A1A1A;">
                An admin has reviewed and approved your SACS Alumni Hub account. You're all set to sign in.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px; background:#C9A227;">
                    <a href="${SITE_URL}" style="display:inline-block; padding:12px 28px; font-size:15px; font-weight:600; color:#FFFFFF; text-decoration:none; border-radius:8px;">Sign in to SACS Alumni Hub</a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0; font-size:13px; line-height:1.6; color:#5C5C5C;">
                See you there.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px; border-top:1px solid #E8E1D5;">
              <p style="margin:0; font-size:12px; line-height:1.6; color:#5C5C5C;">
                SACS Alumni Hub · <a href="${SITE_URL}" style="color:#5C5C5C;">sacsalumni.org</a><br>
                You're receiving this because an admin approved your account request.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    let body: { user_id?: string } = {}
    try {
      body = await req.json()
    } catch {
      return json(req, { error: 'Expected a JSON body with user_id' }, 400)
    }

    const targetUserId = body?.user_id
    if (!targetUserId) return json(req, { error: 'user_id is required' }, 400)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      // Fail loudly in logs but don't break the approval flow for the admin.
      console.error('RESEND_API_KEY is not set')
      return json(req, { error: 'Email sending is not configured yet' }, 500)
    }

    // Client scoped to the caller's own token — establishes who they really
    // are and whether they're actually an admin, same as admin-delete-member.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc('is_admin')
    if (adminCheckErr || isAdmin !== true) return json(req, { error: 'Admins only' }, 403)

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Name comes from profiles; email only exists on auth.users.
    const [{ data: profile }, { data: authUser, error: authUserErr }] = await Promise.all([
      adminClient.from('profiles').select('full_name').eq('id', targetUserId).maybeSingle(),
      adminClient.auth.admin.getUserById(targetUserId),
    ])

    const email = authUser?.user?.email
    if (authUserErr || !email) {
      return json(req, { error: 'Could not find an email address for that member' }, 400)
    }

    const firstName = (profile?.full_name ?? '').trim().split(/\s+/)[0] || 'there'

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: 'Your SACS Alumni Hub account is verified',
        html: approvalEmailHtml(firstName),
      }),
    })

    if (!resendRes.ok) {
      const detail = await resendRes.text()
      console.error('Resend send failed:', resendRes.status, detail)
      return json(req, { error: 'Failed to send approval email' }, 502)
    }

    return json(req, { success: true })
  } catch (e) {
    return json(req, { error: e.message ?? 'Unknown error' }, 500)
  }
})
