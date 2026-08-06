// Shared by the delete-account and admin-delete-member Edge Functions, so the
// self-service and admin removal paths can't drift apart the way they did
// before (the admin path used to be a plain SQL `delete from auth.users` via
// the admin_delete_member() RPC, with no storage cleanup at all).

// Only allow requests from the actual site origin(s).
//
// The production domain MUST be in this list. When an origin isn't allowed the
// response still carries an Access-Control-Allow-Origin header — just the
// wrong one — so the browser blocks it and account deletion fails with an
// opaque network error, on the one operation where a silent failure is worst.
// That's exactly what would have happened the day this site moved off the
// Vercel URL onto its own domain.
//
// Preview deploys are matched by prefix rather than a bare
// `.endsWith('.vercel.app')`, which let in *any* site hosted on Vercel —
// anyone can deploy one for free. No credentials travel by cookie here (the
// session is an explicit Authorization header), so that was never directly
// exploitable, but there's no reason to leave the door open.
export const ALLOWED_ORIGINS = [
  'https://sacsalumni.org',
  'https://www.sacsalumni.org',
  'http://localhost:5173',
  'http://localhost:3000',
]

// Vercel preview builds for THIS project, e.g.
// https://sacs-hub-abc123-kyles-projects.vercel.app
// Also covers the first vercel.app production URL before the custom domain
// is wired up (sacsalumni.org isn't purchased yet — see project memory).
//
// NOTE: 'sacs-hub' here assumes that's the Vercel project name/slug. If the
// project gets created under a different name, update this regex (and
// redeploy this function) to match, or preview/production URLs on that
// project will get CORS-blocked from calling this function.
const PREVIEW_ORIGIN_RE = /^https:\/\/sacs-hub[a-z0-9-]*\.vercel\.app$/

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN_RE.test(origin)
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  })
}

// Every bucket that can hold something owned by a single member, all of which
// namespace their objects under a `<user-id>/` folder.
//
// This used to be a single hardcoded `avatars/<id>/avatar.jpg` plus a listing
// of post-images — which meant that after someone deleted their account their
// CV, headshot, business logo and cover, job attachments and event images all
// stayed exactly where they were. Every one of those except
// job-application-files is a PUBLIC bucket, so a deleted member's CV (home
// address, phone number, employment history) remained downloadable at its
// original URL indefinitely, while Settings told them:
//
//   "Permanently deletes your account, profile, posts, photos, messages…"
//
// That's an erasure problem, not just untidiness. And `avatar.jpg` hadn't even
// been the avatar filename for months — Profile.jsx writes
// `<id>/avatar-<timestamp>.jpg` plus `<id>/original` since the CDN
// cache-busting change, so the one path it did try to remove never existed.
//
// Listing the whole `<user-id>/` prefix sidesteps filename drift entirely.
export const OWNED_BUCKETS = [
  'avatars',
  'post-images',
  'post-videos',
  'cvs',
  'business-logos',
  'business-covers',
  'job-logos',
  'job-attachments',
  'event-images',
  'job-application-files',
]

// Removes everything under `<userId>/` in one bucket. Best-effort per bucket:
// a bucket that doesn't exist yet (post-videos) or a transient storage error
// must not stop the account deletion itself, which is the part that matters.
// deno-lint-ignore no-explicit-any
async function purgeBucket(adminClient: any, bucket: string, userId: string) {
  try {
    const { data, error } = await adminClient.storage.from(bucket).list(userId, { limit: 1000 })
    if (error || !data?.length) return
    const paths = data.map((f: { name: string }) => `${userId}/${f.name}`)
    await adminClient.storage.from(bucket).remove(paths)
  } catch (e) {
    console.error(`Storage cleanup failed for bucket ${bucket}:`, e)
  }
}

// Storage cleanup + the account deletion itself. Cleanup runs first, while the
// row is still there to reason about. Deleting the auth user cascades through
// every person-owned table via the FK constraints.
// deno-lint-ignore no-explicit-any
export async function purgeAndDeleteUser(adminClient: any, userId: string) {
  await Promise.all(OWNED_BUCKETS.map((b) => purgeBucket(adminClient, b, userId)))
  return await adminClient.auth.admin.deleteUser(userId)
}
