# Social login & signup flow — setup checklist

The app shows a "Continue/Join with Google" button on Sign in and Join (Facebook and LinkedIn were dropped). The button calls Supabase OAuth, so Google must be enabled in the Supabase dashboard before it works.

Your Supabase callback URL:

```
https://nshvaejjkknugfuyailz.supabase.co/auth/v1/callback
```

## 1. Google

1. Go to https://console.cloud.google.com → create a project (e.g. "SACS Alumni").
2. APIs & Services → OAuth consent screen → External → fill in app name, support email, and your site's domain. Add scopes `email` and `profile`.
3. APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
   - **Authorized redirect URI: paste the callback URL above — exactly, character for character.** The `Error 400: redirect_uri_mismatch` you saw means the URI saved in the Google console doesn't match this URL. Common causes: a trailing slash, `http` instead of `https`, your site's own domain instead of the Supabase callback, or it was left blank. Fix: Credentials → your OAuth client → Authorized redirect URIs → set it to the callback URL above and save (can take a few minutes to propagate).
4. Copy the Client ID and Client Secret.
5. Supabase dashboard → Authentication → Providers → Google → enable, paste both, save.

## 2. Supabase auth settings

- Authentication → Sign In / Up → **turn OFF "Confirm email"**. Verification now happens via committee approval, not an email link — with confirm-email on, people would get a confusing Supabase email anyway. (The code handles both states, but off is the intended setup.)
- Authentication → URL Configuration → Site URL: set to your production domain (and add `http://localhost:5173` to additional redirect URLs for local dev). Social logins redirect back here.
- Attack protection → keep CAPTCHA (Turnstile) enabled, same site key as `VITE_TURNSTILE_SITE_KEY`.

## 5. Approval email (later, once you have a domain)

When you have a domain + Resend account:

1. Verify the domain in Resend, create an API key.
2. Create a Supabase Edge Function `send-approval-email` that emails the member.
3. Uncomment/wire the hook in `src/components/Admin.jsx` → `setApproved` (there's a TODO comment marking the exact spot).

## How the new flow works

- **Sign in**: email+password or a social button. Simple.
- **Join (form)**: 3 steps — details (name, email×2, password with strength meter), SACS years (from–to), consent (opt in/out + data consent + Turnstile). On submit the account is created, profile filled, and the user lands on a locked "your details are being verified" screen.
- **Join (social)**: after OAuth redirect, a "Nearly done" screen collects name (prefilled), years, and consent, then the same locked screen.
- **Approval**: Admin → Pending approval → Approve. On the member's next visit (or "Check my status") they get the trimmed profile wizard (name/years questions removed — already collected), then the app.
