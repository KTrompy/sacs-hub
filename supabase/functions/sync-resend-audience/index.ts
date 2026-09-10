// Supabase Edge Function: sync-resend-audience
//
// Pushes the current approved member list into a Resend Audience so admins
// can compose and send broadcasts from Resend's own Broadcasts editor
// (resend.com/broadcasts) instead of the in-site composer. Resend's
// Audience is a separate, external contact list -- nothing here keeps it
// in sync automatically, which is exactly why this function exists: an
// admin clicks "Sync to Resend" (Admin -> Members) right before opening
// Resend to compose a send, and this brings the Audience up to date first.
//
// Consent: every approved member is pushed into the Audience, but members
// who haven't opted in to committee/broadcast emails are pushed with
// `unsubscribed: true`. Resend's Broadcasts automatically skip unsubscribed
// contacts when a broadcast is sent to an audience/segment -- so "select
// everyone" in Resend still honours the same opt-in rule
// send-broadcast-email enforces:
//   - notification_preferences.notify_admin_broadcast, if the member has
//     ever saved a preference in Settings (whatever they last chose), else
//   - profiles.email_news_opt_in, their signup answer
//   - no signal at all = treated as opted out (unsubscribed: true)
// This mirrors send-broadcast-email's optedIn() logic exactly -- if that
// logic ever changes, change it here too.
//
// Members who are no longer approved (declined, or deleted -- deletion
// removes the profiles row entirely) are removed from the Resend Audience
// entirely, not just marked unsubscribed, so someone who leaves doesn't
// keep sitting in a third-party contact list.
//
// Required secrets (Project Settings -> Edge Functions -> Secrets):
//   RESEND_API_KEY   -- must have "Full access" permission; "Sending
//                        access" can send emails but cannot manage contacts
//
// Deploy:
//   supabase functions deploy sync-resend-audience

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

// Fixed to this project's one Resend Audience ("SACS Alumni Members"),
// same as FROM_DOMAIN is a fixed constant in send-broadcast-email rather
// than something admins configure through the UI.
const RESEND_AUDIENCE_ID = '349503c9-a0fe-4612-80e4-fb21f78dfc3b'
const RESEND_API = 'https://api.resend.com'

type Member = {
  id: string
  email: string | null
  full_name: string | null
  first_name: string | null
  preferred_name: string | null
  last_name: string | null
  approved: boolean
}

type ResendContact = {
  id: string
  email: string
  unsubscribed: boolean
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Resend's default rate limit is 2 requests/second across the whole API
// key. Two requests in flight at once, with a short pause between pairs,
// stays comfortably under that without making a sync of a few hundred
// members take many minutes. A sync that still times out on a very large
// member list would need real batching/backoff -- not worth building until
// the Hub actually has that many members (see mass-email-feature.md for
// the same "worth adding if this becomes a frequent habit" reasoning).
const CONCURRENCY = 2
const PAUSE_MS = 650

async function runLimited<T>(items: T[], worker: (item: T) => Promise<void>) {
  let i = 0
  while (i < items.length) {
    const batch = items.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map((item) => worker(item)))
    i += CONCURRENCY
    if (i < items.length) await sleep(PAUSE_MS)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(req, { error: 'Missing Authorization header' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      console.error('RESEND_API_KEY is not set')
      return json(req, { error: 'Resend is not configured yet (missing RESEND_API_KEY).' }, 500)
    }

    const callerClient = createClient(supabaseUrl!, anonKey!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const { data: isAdmin, error: adminErr } = await callerClient.rpc('is_admin')
    if (adminErr || isAdmin !== true) {
      return json(req, { error: 'Only admins can do this.' }, 403)
    }

    // is_admin() is re-checked inside admin_list_members() itself, so this
    // is safe to call with the caller's own (already-admin) token -- same
    // reasoning send-broadcast-email uses for the same RPC.
    const { data: allMembers, error: membersErr } = await callerClient.rpc('admin_list_members')
    if (membersErr || !allMembers) {
      return json(req, { error: 'Could not load the member list.' }, 500)
    }

    const approved = (allMembers as Member[]).filter((m) => m.approved && m.email)
    const approvedIds = approved.map((m) => m.id)

    const adminClient = createClient(supabaseUrl!, serviceRoleKey!)
    const [{ data: prefRows }, { data: optInRows }] = await Promise.all([
      adminClient
        .from('notification_preferences')
        .select('user_id, notify_admin_broadcast')
        .in('user_id', approvedIds),
      adminClient
        .from('profiles')
        .select('id, email_news_opt_in')
        .in('id', approvedIds),
    ])

    // Same rule as send-broadcast-email's optedIn(): an explicit Settings
    // choice wins if one exists; otherwise fall back to the signup answer;
    // no signal at all means opted out.
    const explicitPref = new Map((prefRows ?? []).map((r) => [r.user_id, r.notify_admin_broadcast === true]))
    const signupOptIn = new Map((optInRows ?? []).map((r) => [r.id, r.email_news_opt_in === true]))
    const optedIn = (id: string): boolean =>
      explicitPref.has(id) ? (explicitPref.get(id) ?? false) : (signupOptIn.get(id) ?? false)

    const desired = new Map(
      approved.map((m) => [
        (m.email as string).toLowerCase(),
        {
          email: m.email as string,
          firstName: (m.preferred_name ?? m.first_name ?? '').trim(),
          lastName: (m.last_name ?? '').trim(),
          unsubscribed: !optedIn(m.id),
        },
      ])
    )

    // Fetch the audience's current contacts once, up front, so we know
    // which existing contacts need removing (former/declined members) --
    // there's no way to compute that without listing what's there. Resend
    // doesn't paginate this endpoint (it returns the whole audience in one
    // call), which is fine at this app's current member counts.
    const listRes = await fetch(`${RESEND_API}/audiences/${RESEND_AUDIENCE_ID}/contacts`, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
    })
    if (!listRes.ok) {
      const detail = await listRes.text()
      console.error('Resend: failed to list audience contacts', listRes.status, detail)
      return json(req, { error: 'Could not read the Resend audience. Check RESEND_API_KEY and the audience ID.' }, 502)
    }
    const listBody = await listRes.json()
    const existing: ResendContact[] = Array.isArray(listBody?.data) ? listBody.data : []
    const existingByEmail = new Map(existing.map((c) => [c.email.toLowerCase(), c]))

    let created = 0
    let updated = 0
    let unchanged = 0
    let removed = 0
    const failures: string[] = []

    // Upsert every currently-approved member. PATCH-by-email first (this
    // audience already has most contacts after the first sync); fall back
    // to POST only when PATCH says the contact doesn't exist yet. This
    // avoids needing a second lookup per contact on top of the list call
    // above.
    await runLimited(Array.from(desired.values()), async (contact) => {
      const already = existingByEmail.get(contact.email.toLowerCase())
      try {
        if (already) {
          if (already.unsubscribed === contact.unsubscribed) {
            unchanged++
            return
          }
          const res = await fetch(
            `${RESEND_API}/audiences/${RESEND_AUDIENCE_ID}/contacts/${encodeURIComponent(contact.email)}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                first_name: contact.firstName,
                last_name: contact.lastName,
                unsubscribed: contact.unsubscribed,
              }),
            }
          )
          if (!res.ok) {
            failures.push(`${contact.email}: update failed (${res.status})`)
            return
          }
          updated++
        } else {
          const res = await fetch(`${RESEND_API}/audiences/${RESEND_AUDIENCE_ID}/contacts`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: contact.email,
              first_name: contact.firstName,
              last_name: contact.lastName,
              unsubscribed: contact.unsubscribed,
            }),
          })
          if (!res.ok) {
            failures.push(`${contact.email}: create failed (${res.status})`)
            return
          }
          created++
        }
      } catch (e) {
        failures.push(`${contact.email}: ${e instanceof Error ? e.message : 'network error'}`)
      }
    })

    // Anyone in the Resend audience who is no longer an approved member
    // (declined, or their account was deleted) gets removed outright, not
    // just unsubscribed -- they shouldn't still be sitting in a
    // third-party contact list at all.
    const toRemove = existing.filter((c) => !desired.has(c.email.toLowerCase()))
    await runLimited(toRemove, async (contact) => {
      try {
        const res = await fetch(
          `${RESEND_API}/audiences/${RESEND_AUDIENCE_ID}/contacts/${encodeURIComponent(contact.email)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${resendApiKey}` } }
        )
        if (!res.ok) {
          failures.push(`${contact.email}: remove failed (${res.status})`)
          return
        }
        removed++
      } catch (e) {
        failures.push(`${contact.email}: ${e instanceof Error ? e.message : 'network error'}`)
      }
    })

    return json(req, {
      total: desired.size,
      created,
      updated,
      unchanged,
      removed,
      failed: failures.length,
      errors: failures.slice(0, 20),
    })
  } catch (e) {
    console.error('sync-resend-audience error:', e)
    return json(req, { error: 'Something went wrong syncing to Resend.' }, 500)
  }
})
