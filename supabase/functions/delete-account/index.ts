// Supabase Edge Function: delete-account
//
// Deletes the CALLER's own account. This is the only thing it does — an admin
// removing somebody else goes to the separate admin-delete-member function.
//
// That separation is deliberate rather than tidiness. If this function took a
// "delete this other person instead" parameter, then during the window between
// shipping the frontend and deploying the new function, the *old* deployment
// would still be live — and the old deployment ignores the request body
// entirely and deletes whoever is calling. An admin clicking "Delete account"
// on a member would have deleted their own admin account. A separate function
// name fails closed instead: if it isn't deployed yet, the invoke 404s and
// nothing is deleted.
//
// Why an Edge Function at all: a plain Postgres function running as SECURITY
// DEFINER cannot reliably delete rows from auth.users on hosted Supabase —
// that table can only be modified through the Admin API, which requires the
// service-role key. That key must never be shipped to the browser, so the
// delete has to happen here, server-side.
//
// Flow:
//   1. Read the caller's access token from the Authorization header.
//   2. Verify it against Supabase Auth to find out who is actually calling
//      (never trust a user id sent from the client).
//   3. Clean up their storage objects, which the database cascade doesn't
//      cover — see OWNED_BUCKETS in ../_shared/accountCleanup.ts.
//   4. Use the service-role client to permanently delete that auth user.
//      Everything referencing it cascades: profiles, posts, messages, jobs,
//      events, likes, comments.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy delete-account
//
// No extra secrets need to be set — SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically to every Edge
// Function by the Supabase platform.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCorsHeaders, json, purgeAndDeleteUser } from '../_shared/accountCleanup.ts'

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

    // Client scoped to the caller's own token, used only to identify them
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: userData, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !userData?.user) return json(req, { error: 'Invalid or expired session' }, 401)

    const userId = userData.user.id

    // Admin client, only ever used inside this server-side function
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { error: deleteErr } = await purgeAndDeleteUser(adminClient, userId)
    if (deleteErr) return json(req, { error: deleteErr.message }, 400)

    return json(req, { success: true, deleted_user_id: userId })
  } catch (e) {
    return json(req, { error: e.message ?? 'Unknown error' }, 500)
  }
})
