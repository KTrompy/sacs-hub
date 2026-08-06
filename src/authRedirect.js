// Where Supabase should send people back to after an OAuth round-trip or a
// password-reset link.
//
// This was `window.location.origin` at all three call sites, which is right
// on the live site and wrong everywhere else: request a password reset from
// a Vercel preview deployment (or localhost) and the emailed link points
// back at that preview, so the member ends up setting their password on a
// throwaway build — or, more often, on a URL that's since been torn down.
//
// VITE_SITE_URL pins it to the canonical site when set. It's deliberately
// optional: unset (local dev, or before it's configured in Vercel) it falls
// back to the old behaviour, which is what you want on localhost.
//
// Whatever this resolves to must also be listed under Authentication → URL
// Configuration → Redirect URLs in the Supabase dashboard, or Supabase will
// silently fall back to the project's Site URL.
export function authRedirectTo(path = '') {
  const base = (import.meta.env.VITE_SITE_URL || window.location.origin).replace(/\/+$/, '')
  return path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base
}
