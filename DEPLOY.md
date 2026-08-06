# SACS Alumni Hub — Deploy checklist (Phase 6)

Everything Claude could do from the sandbox (migrations, Edge Function deploys, rebranding) is done. What's left needs your own GitHub/Vercel login — this is the exact sequence.

## 0. Clean up first

Claude tried `git init` directly against this OneDrive-synced folder from its sandbox and hit dozens of `Operation not permitted` errors — the sandbox's OneDrive virtualization doesn't play well with git's many small object-files. It left a **broken, partial `.git` folder** in this directory that it couldn't fully remove either.

Before doing anything else: in File Explorer (not through any sandbox), delete the `.git` folder inside `sacs-hub` if it's still there, then continue below. Running `git init` natively on your machine doesn't have this problem — it only showed up inside the sandbox.

## 1. Push to GitHub — done, under KTrompy instead of sacsalumnihub

`sacsalumnihub/sacs-hub` turned out to belong to an account KTrompy doesn't have write access to (403 on push). Simplest fix, and what actually happened: pushed to **`github.com/KTrompy/sacs-hub`** instead. Repo can be transferred to `sacsalumnihub` later once that account's access is sorted — Vercel's GitHub integration follows a transferred repo automatically, no redeploy config needed.

```bash
git remote set-url origin https://github.com/KTrompy/sacs-hub.git
git push -u origin main
```

## 2. Create the Vercel project

1. vercel.com → **Add New → Project** → import `KTrompy/sacs-hub`.
2. Vercel auto-detects Vite. Leave build settings as default.
3. **Before the first deploy**, add these Environment Variables (Project Settings → Environment Variables), for all environments (Production/Preview/Development). Copy the actual values from your local `.env` file (gitignored, never committed) — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_MAPBOX_TOKEN` are all already filled in there:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | from `.env` |
   | `VITE_SUPABASE_ANON_KEY` | from `.env` |
   | `VITE_MAPBOX_TOKEN` | from `.env` |
   | `VITE_SITE_URL` | leave blank for now — set after step 4 |
   | `VITE_TURNSTILE_SITE_KEY` | leave blank — Turnstile isn't set up yet |

   (Deliberately not pasted here as literal values — GitHub's push protection correctly blocked an earlier version of this file for containing a live Mapbox token. Credentials don't belong in a file that gets committed, even ones described as "public".)

4. Deploy. You'll get a URL like `https://sacs-hub-xxxxx.vercel.app` (or whatever Vercel names it based on the repo/project name).

## 3. Check the CORS allowlist matches your Vercel project name

The Edge Functions (`admin-delete-member`, `delete-account`, `send-approval-email`, `send-member-email`) already allow any origin matching `https://sacs-hub*.vercel.app`. **If Vercel names the project something other than `sacs-hub`** (check the URL from step 2), you need to update the regex in two places and redeploy those functions:

- `supabase/functions/_shared/accountCleanup.ts` → `PREVIEW_ORIGIN_RE`
- `supabase/functions/send-member-email/index.ts` → `PREVIEW_ORIGIN_RE`

(Claude already deployed all four functions once with the `sacs-hub` pattern — this step is only needed if the actual Vercel project name differs.)

## 4. Point Supabase at the live URL

Supabase Dashboard → Authentication → URL Configuration:
- **Site URL** → your `*.vercel.app` URL from step 2.
- **Redirect URLs** → add the same URL (and `http://localhost:5173` for local dev, if not already there).

Then set `VITE_SITE_URL` in Vercel to the same URL and redeploy (Vercel → Deployments → ⋯ → Redeploy) so password-reset and Google-login redirects land on the live site instead of localhost.

## 5. Paste in the two Auth email templates

Supabase Dashboard → Authentication → Email Templates:
- **Confirm signup** → paste the full contents of `supabase/email-templates/confirm-signup.html`
- **Reset password** → paste the full contents of `supabase/email-templates/reset-password.html`

These aren't deployable via API — has to be copy-paste in the dashboard. Both are already rebranded to SACS Alumni Hub.

## 6. Set up Resend (for approval/decline emails)

Right now `send-approval-email` and `send-member-email` are deployed but will return a 500 ("Email sending is not configured yet") because there's no `RESEND_API_KEY` secret. To enable them:

1. Sign up at resend.com, verify a sending domain (or use their test domain to start).
2. Supabase Dashboard → Edge Functions → Secrets → add `RESEND_API_KEY`.
3. Once `sacsalumni.org` is purchased and verified in Resend, update `FROM_ADDRESS` in both functions from `no-reply@sacsalumni.org` to whatever domain you verified, and redeploy.

Until this is done, approvals/declines still work in the Admin UI — the emails just silently fail (by design: a failed email never blocks the approval itself).

## 7. Cloudflare Turnstile (optional, for bot protection on signup)

1. dash.cloudflare.com → Turnstile → add a site, get a site key + secret key.
2. `VITE_TURNSTILE_SITE_KEY` in Vercel → the site key.
3. Supabase Dashboard → Authentication → Settings → Bot and Abuse Protection → enable CAPTCHA, paste the secret key.

## 8. Once sacsalumni.org is purchased

1. Vercel → Settings → Domains → add `sacsalumni.org` (and `www.sacsalumni.org`), follow the DNS instructions.
2. Update `VITE_SITE_URL` in Vercel to `https://sacsalumni.org`, redeploy.
3. Update `SITE_URL` and `ALLOWED_ORIGINS` in all four Edge Functions from `sacsalumni.org` placeholder values (they're already set to this domain — just double check it's actually live) — redeploy if anything changed.
4. Supabase → Authentication → URL Configuration → update Site URL and Redirect URLs to the custom domain.

---

**What Claude already verified working against the live Supabase project** (Phase 7, without needing a deployed frontend): signup trigger creates a profile row, the approval gate can't be bypassed before consent, and RLS is correctly approval-gated across the feed, comments, likes, events/RSVPs, messages, mentoring, jobs, and notifications. Full click-through E2E (real browser, real emails) still needs to happen once this is live — that's the one part that has to wait for you to finish the steps above.
