import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error(
    'Missing Supabase config. Copy .env.example to .env and fill in your project URL and anon key.'
  )
}

export const supabase = createClient(url, key)

// Single source of truth for self-service account deletion. There used to
// be two separate implementations — Profile.jsx called the delete-account
// Edge Function while Settings.jsx called the delete_own_account() DB RPC.
// The RPC approach is documented in schema-update-3.sql as SUPERSEDED:
// hosted Supabase silently no-ops a plain SQL DELETE against auth.users
// even from a SECURITY DEFINER function, so that path looked like it
// worked (no error) but never actually removed the account. The Edge
// Function uses the Admin API (auth.admin.deleteUser) with the
// service-role key, which is the only reliable way to do this — see
// supabase/functions/delete-account/index.ts. Both UI paths now call this
// one function so they can't drift again.
export async function deleteOwnAccount() {
  return supabase.functions.invoke('delete-account')
}

// Admin removing someone else's account. A SEPARATE Edge Function from
// delete-account, which checks is_admin() against the CALLER's own token
// server-side — the target id sent from here is never trusted on its own.
//
// Replaces the admin_delete_member() RPC, which did a plain
// `delete from auth.users` and no storage cleanup, so an admin-deleted member
// left their CV, avatar, business photos and job attachments sitting in public
// buckets forever. Both delete paths now share purgeAndDeleteUser(), so they
// can't drift apart again.
//
// The separate function name is a safety measure, not a style choice: adding a
// target parameter to delete-account instead would mean that until the new
// version was deployed, the live one would ignore the parameter and delete
// whoever was calling — an admin removing a member would have deleted their
// own account. An undeployed function just 404s.
export async function adminDeleteAccount(targetUserId) {
  const result = await supabase.functions.invoke('admin-delete-member', {
    body: { target_user_id: targetUserId },
  })
  if (result.error) return result
  // Belt and braces: only treat this as done if the server confirms it removed
  // the person we actually asked about.
  if (result.data?.deleted_user_id !== targetUserId) {
    return { data: null, error: new Error('Account deletion could not be confirmed — nothing was changed.') }
  }
  return result
}

// Distinguishes "your JWT/session is no good" from an ordinary network
// blip or a genuine "no rows" result. Postgrest returns 401s as a JWT-shaped
// message/code, and a network failure (offline, DNS, CORS) never reaches
// Postgrest at all so it carries no `code`/`status` — checking for either
// shape here means callers can react to "you're not really signed in
// anymore" without mistaking it for "the network hiccupped" or "that row
// doesn't exist".
export function isAuthError(error) {
  if (!error) return false
  if (error.code === 'PGRST301' || error.status === 401) return true
  const msg = (error.message || '').toLowerCase()
  return msg.includes('jwt') || msg.includes('refresh_token') || msg.includes('invalid_grant')
}

// True for a fetch/network-level failure (offline, DNS, CORS, Mapbox/
// Supabase unreachable) as opposed to a real error response from the
// server — no `code`, no `status`, just "the request never completed".
export function isNetworkError(error) {
  return !!error && !error.code && !error.status
}

// Pulls the storage object path out of a Supabase storage URL, for either a
// public (`/object/public/<bucket>/…`) or a signed (`/object/sign/<bucket>/…`)
// URL. Returns null if the URL isn't for this bucket. A value that's already
// a bare path (what ApplyModal saves for job application files) is handed
// back unchanged by the callers below.
export function storagePathFromUrl(bucket, url) {
  if (!url) return null
  for (const marker of [`/storage/v1/object/public/${bucket}/`, `/storage/v1/object/sign/${bucket}/`]) {
    const idx = url.indexOf(marker)
    if (idx !== -1) return decodeURIComponent(url.slice(idx + marker.length).split('?')[0])
  }
  return null
}

// Opens a file from a PRIVATE bucket in a new tab via a short-lived signed
// URL.
//
// The `cvs` bucket used to be public with a blanket "anyone can read" policy,
// which meant every member's CV — home address, phone number, employment
// history — was listable by any signed-in account and downloadable by anyone
// at all who had the URL. schema-update-47 makes the bucket private and gates
// reads on is_approved(), so getPublicUrl() no longer resolves and every read
// has to be signed. Members can still see each other's CVs; the wider internet
// can't.
//
// Accepts either a full storage URL (what profiles.cv_url has held all along)
// or a bare object path, so old and new rows both work without a data migration.
export async function openStorageFile(bucket, urlOrPath) {
  const path = storagePathFromUrl(bucket, urlOrPath) || urlOrPath
  if (!path) return false
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) {
    console.error(`Could not sign ${bucket} file:`, error)
    return false
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  return true
}

// Best-effort cleanup for storage files whose owning row (a post,
// a business listing, …) has just been deleted.
// Every upload flow in this app (post-images, post-videos, avatars,
// business-logos/covers) writes to a
// public bucket and saves the resulting public URL on the row — but
// nothing removed the underlying file once that row went away, so deleted
// posts/listings/albums left their images and videos behind in storage
// forever. This takes one or more of those public URLs, works out each
// one's storage path, and removes them from `bucket`.
//
// Deliberately swallows errors and never throws: cleanup here is a nice-to-
// have, not something that should turn "delete this post" into a visible
// failure for the person doing it just because a storage call hiccupped.
export async function deleteStorageFilesFromUrls(bucket, urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean)
  if (list.length === 0) return
  // storagePathFromUrl strips the marker prefix and any `?t=...` cache-buster
  // some upload flows append, and handles signed URLs as well as public ones.
  const paths = list.map((url) => storagePathFromUrl(bucket, url)).filter(Boolean)
  if (paths.length === 0) return
  try {
    await supabase.storage.from(bucket).remove(paths)
  } catch {
    // Best-effort — see comment above.
  }
}
