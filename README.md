# SACS Alumni Hub

A community platform for SACS (South African College Schools) Old Boys: a feed, an alumni directory with an interactive map, 1:1 realtime messaging, events, jobs, a business directory, mentoring, and a "Notable Old Boys" spotlight. Built with React (Vite) + Supabase, forked from the sister project [eendrag-hub](../eendrag-hub) and rebranded/extended for SACS.

Intended production domain: **sacsalumni.org** (not purchased yet — deploys to a `vercel.app` URL until it is).

## What's inside

- **Auth** — email/password and social signup (Supabase Auth), with a 3-step signup wizard
- **Approval gate** — anyone can sign up, but the directory, feed, and messaging only unlock once an admin approves them
- **Feed** — text posts with likes, comments, reactions, edit/delete, typing indicators and read receipts
- **Directory** — searchable Old Boys list with class-year, industry, location and skills filters
- **Alumni map** — a pin per city, powered by Mapbox (`VITE_MAPBOX_TOKEN`)
- **Messages** — 1:1 DMs with realtime delivery, reactions, edit/delete
- **Profiles** — self-editable directory entries, photos, CVs, and a SACS-specific "membership details" section (title, ID/passport, membership category, communication preferences — see `profile_details` table)
- **Events** — list + calendar view, RSVPs, iCal export
- **Jobs / Business Directory** — postings and listings with an interactive map
- **Mentoring** — flash + structured mentorship matching
- **Notable Old Boys** — admin-curated spotlight on the home page (formerly "Legends"/"Hoek van Helde" in the Eendrag original)
- **Admin page** — approve/decline members, promote admins, moderate content, curate Notable Old Boys, view the activity log

## Project state

- **Supabase**: project `sstftccywbijcuzpipuo`, bootstrapped via migrations (not the old `schema.sql` copy-paste flow — see project memory / migration history for the full trail). RLS is enabled everywhere; `profile_details` holds sensitive membership fields separately from `profiles` because `profiles` still has a broad "any authenticated user can read" policy inherited from the Eendrag original.
- **Admin account**: `sacsalumnihub@gmail.com`.
- **Mapbox**: token already generated (see `.env`).
- **Not yet set up**: Resend (transactional email — `send-approval-email` and `send-member-email` Edge Functions need a `RESEND_API_KEY` secret before they'll actually send anything), Cloudflare Turnstile (`VITE_TURNSTILE_SITE_KEY` is blank), custom domain.

## Local setup

1. Copy `.env.example` to `.env` — the Supabase URL/key and Mapbox token are already known (see project notes); Turnstile and site URL can stay blank for local dev.
2. `npm install`
3. `npm run dev`

## Deploy to Vercel

See the deploy checklist Kyle has (Phase 6 of the sacs-hub build-out) for the current step-by-step. Short version:

1. Push this repo to `github.com/sacsalumnihub/sacs-hub`.
2. Import it into a new Vercel project (auto-detects Vite).
3. Set the same env vars as `.env` (plus `VITE_SITE_URL` once the URL is known).
4. Add the resulting `*.vercel.app` origin to `supabase/functions/_shared/accountCleanup.ts` and `supabase/functions/send-member-email/index.ts` (`ALLOWED_ORIGINS`/`PREVIEW_ORIGIN_RE`) if it doesn't match the `sacs-hub*.vercel.app` pattern already there, then redeploy those functions.
5. In Supabase → Authentication → URL Configuration, set Site URL to the live URL.
6. Paste `supabase/email-templates/confirm-signup.html` and `reset-password.html` into Supabase → Authentication → Email Templates.
7. Once `sacsalumni.org` is purchased: add it under Vercel → Settings → Domains, update `VITE_SITE_URL`, `SITE_URL`/`ALLOWED_ORIGINS` in the Edge Functions, and Supabase's Site URL again.

## Security notes

- The `anon`/publishable key in the frontend is **meant to be public** — real protection lives in RLS policies. Never ship the `service_role` key to the frontend.
- Users can't approve themselves (the update policy blocks changing `approved`).
- Account deletion (self-service and admin-initiated) goes through Edge Functions (`delete-account`, `admin-delete-member`) that also purge storage — not a raw SQL delete.
