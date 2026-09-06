# SACS Alumni Hub — Database

## Database Overview

All data lives in a hosted Supabase project (PostgreSQL). The browser talks to Supabase's REST API via `supabase-js`; every table has Row Level Security (RLS) enabled. Schema changes are applied as numbered SQL files (`schema-update-N.sql`) pasted into the Supabase SQL Editor.

**Supabase project ref:** `sstftccywbijcuzpipuo`

## Tables

### Active Tables (current schema)

#### `profiles`
The central user table. One row per member, FK to `auth.users`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | References auth.users(id) ON DELETE CASCADE |
| full_name | text | Required |
| grad_year | integer | Year they left SACS |
| section | text | SACS section/house |
| occupation | text | Job title |
| company | text | Employer |
| bio | text | Free-text biography |
| approved | boolean | Set by admin after verification |
| is_admin | boolean | Admin privileges |
| avatar_url | text | Supabase Storage URL |
| avatar_crop | jsonb | Saved crop/zoom state for photo editor |
| industry | text | From INDUSTRIES constant list |
| occupation_description | text | Extended job description |
| linkedin_url | text | LinkedIn profile URL |
| country | text | Default 'South Africa' |
| province | text | SA province |
| city | text | City name |
| lat, lng | double precision | Geocoded coordinates for map |
| degree | text | Educational qualification |
| phone | text | Phone number |
| language | text | Preferred language (default 'en') |
| expertise | text[] | Areas of expertise (multi-select) |
| services_offered_new | text[] | Professional services |
| business_website | text | Personal/company website |
| looking_to_connect | text[] | Connection interests |
| business_categories | text[] | Business type tags |
| experience | jsonb | Work history entries (array of objects) |
| last_seen | timestamptz | Heartbeat for "recently online" |
| consented_at | timestamptz | Privacy consent timestamp |
| details_completed_at | timestamptz | Membership details completion |
| onboarding_complete | boolean | First-run profile setup done |
| privacy_phone/email/location | text | Privacy levels: 'all', 'mentoring', 'hide' |
| seeking_mentor | boolean | Open to being mentored |
| mentee_goals | text[] | What they want from mentoring |
| mentee_note | text | Mentee introduction |
| mentor_capacity | smallint | Max mentees (default 2) |
| mentor_bio | text | Mentor introduction |
| is_open_to_opportunities | boolean | Shows in Find a Mentor |
| declined_at | timestamptz | Set when admin declines application |
| declined_reason | text | Why they were declined |
| created_at | timestamptz | Account creation |

#### `posts`
Social feed posts.

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | Auto-increment |
| author_id | uuid FK → profiles | ON DELETE CASCADE |
| content | text | 1–4000 chars |
| title | text | Optional post title |
| image_urls | text[] | Uploaded image URLs |
| video_url | text | Video embed URL |
| pinned | boolean | Admin-pinned posts |
| updated_at | timestamptz | Last edit time |
| created_at | timestamptz | |

#### `post_likes`
| Column | Type |
|---|---|
| post_id | bigint FK → posts |
| user_id | uuid FK → profiles |
| PK | (post_id, user_id) |

#### `post_comments`
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| post_id | bigint FK → posts | |
| author_id | uuid FK → profiles | |
| content | text | 1–2000 chars |
| created_at | timestamptz | |

_Removed in schema-update-63: `conversations`, `conversation_participants`, `messages`,
`message_reactions` — the old real-time DM feature stored nothing but those threads, and
nothing replaces them. Contacting a member now sends a one-off email (`send-contact-email`
Edge Function via Resend) with no database row at all — see FEATURES.md § Contact via Email._

#### `events`
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| title | text | Required |
| description | text | |
| location | text | Free-text venue |
| event_date | date | |
| event_start_time / event_end_time | timestamptz | Optional times |
| event_url | text | External link |
| image_url | text | Event image |
| max_registrations | integer | Null = unlimited |
| lat, lng | double precision | Map pin |
| created_by | uuid FK → profiles | |
| updated_at, created_at | timestamptz | |

#### `event_rsvps`
| Column | Type |
|---|---|
| event_id | bigint FK → events |
| user_id | uuid FK → profiles |
| PK | (event_id, user_id) |

#### `event_comments`
Same shape as post_comments, FK to events.

#### `jobs`
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| title | text | Required |
| company | text | Required |
| description | text | |
| location | text | |
| salary | text | Free-text |
| type | text | full-time/part-time/contract/etc. |
| apply_url | text | External application link |
| industry | text | |
| company_website | text | |
| logo_url | text | Company logo |
| attachment_url / attachment_name | text | PDF attachment |
| additional_email | text | |
| closing_date | date | Applications close (Africa/Johannesburg) |
| lat, lng | double precision | Map pin |
| posted_by | uuid FK → profiles | |
| updated_at, created_at | timestamptz | |

#### `job_applications`
In-app job applications (schema-update-41).

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| job_id | bigint FK → jobs | |
| applicant_id | uuid FK → profiles | |
| cv_url | text | Private storage bucket |
| cover_letter_url | text | Private storage bucket |
| note | text | Application note |
| created_at | timestamptz | |
| UNIQUE | (job_id, applicant_id) | One application per person per job |

#### `saved_jobs` / `saved_events`
Bookmark tables. PK on (user_id, job_id/event_id).

#### `businesses`
Alumni business directory (schema-update-19).

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| owner_id | uuid FK → profiles | |
| name | text | Business name |
| category | text | Business category |
| tagline | text | Short headline |
| description | text | Rich text |
| website, phone, email | text | Contact info |
| address, city, country | text | Location |
| logo_url, cover_image_url | text | Storage URLs |
| lat, lng | double precision | Map pin |
| featured | boolean | Admin-promoted |
| created_at, updated_at | timestamptz | |

#### `notifications`
In-app notification bell (schema-update-9).

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| user_id | uuid FK → profiles | Recipient |
| type | text | like, comment, rsvp, mentoring_request, etc. |
| entity_type | text | post, event, job, mentorship |
| entity_id | text | ID of the related entity |
| actor_id | uuid FK → profiles | Who triggered it |
| read | boolean | |
| created_at | timestamptz | |

#### `notification_preferences`
Per-user notification settings (schema-update-21).

#### `badges`
Static badge catalogue (schema-update-20). Earned status computed client-side.

#### `reports`
Content flagging/reporting (schema-update-28).

| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| reporter_id | uuid FK → profiles | |
| target_type | text | post, job, event, business, member |
| target_id | text | |
| reason | text | |
| status | text | open, resolved, dismissed |
| resolved_by | uuid | Admin who handled it |
| created_at | timestamptz | |

#### `photo_albums` / `photos`
Shared photo albums (schema-update-16).

#### `legends`
Admin-curated Notable Old Boys (schema-update-54). Not linked to profiles — these are historical figures.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | Display name |
| years | text | Free-text (e.g. "1962–1966") |
| category | text | CHECK constraint on values |
| summary | text | Short bio |
| full_bio | text | Rich text |
| image_url | text | |
| visible | boolean | Admin toggle |
| sort_order | integer | Display order |
| created_at, updated_at | timestamptz | |

#### `mentorships`
Mentoring matches (schema-update-56, replacing the earlier mentoring_programs system).

#### `mentorship_goals` / `mentorship_sessions`
Goals and session tracking for active mentorships.

#### `merch_products` / `merch_variants` / `merch_orders` / `merch_order_items`
Merchandise shop (schema-update-59, hardened in 60–62).

#### `admin_actions`
Audit log of admin activities (schema-update-52). Written by triggers, not application code.

### Dropped Tables

These were created and later removed:
- `groups`, `group_members`, `group_posts`, `group_post_likes`, `group_post_comments` — dropped in schema-update-40
- `merchandise`, `merch_wishlist` — dropped in schema-update-43, replaced by merch_products system in 59
- `mentoring_programs`, `mentoring_participants`, `mentoring_matches`, `mentoring_goals`, `mentoring_notes` — replaced by mentorships system in 56

## Relationships

```
auth.users  ←─ profiles (1:1, ON DELETE CASCADE)
                  ├── posts (1:many)
                  │     ├── post_likes (many:many)
                  │     └── post_comments (1:many)
                  ├── events (1:many, via created_by)
                  │     ├── event_rsvps (many:many)
                  │     └── event_comments (1:many)
                  ├── jobs (1:many, via posted_by)
                  │     └── job_applications (1:many)
                  ├── businesses (1:many, via owner_id)
                  ├── notifications (1:many, via user_id)
                  ├── reports (1:many, via reporter_id)
                  ├── mentorships (via mentor_id / mentee_id)
                  └── merch_orders (1:many, via buyer_id)
```

All person-owned FKs cascade on delete — removing a profile removes all their content.

## Row Level Security (RLS)

RLS is enabled on **every** table. Key patterns:

### Read Access
- **All content tables** (posts, events, jobs, businesses, etc.): `SELECT` requires `is_approved()` — unapproved users see nothing.
- **profiles**: approved users can see all profiles; unapproved users can see only their own row (`id = auth.uid()`).
- **job_applications**: only the job poster and the applicant can see applications.

### Write Access
- **INSERT**: requires `is_approved()` plus ownership (`author_id = auth.uid()`).
- **UPDATE**: owner only (`id = auth.uid()` or `author_id = auth.uid()`).
- **DELETE**: owner or admin (`is_admin()`).

### Admin Override
Admins can delete any content. Admin status changes, profile approvals, and legend management require `is_admin()`.

### Self-Elevation Prevention
A `BEFORE UPDATE` trigger on profiles blocks non-admin users from changing their own `approved` or `is_admin` columns. A separate trigger prevents the last admin from being demoted.

## Supabase Storage Buckets

| Bucket | Access | Purpose |
|---|---|---|
| avatars | Private (since update-47) | Profile photos, namespaced `<user-id>/` |
| cvs | Private (since update-47) | CVs/resumes, signed URL access |
| post-images | Public | Feed post images |
| post-videos | Public | Feed post videos (uploads disabled in app) |
| business-logos | Public | Business directory logos |
| business-covers | Public | Business cover images |
| event-images | Public | Event images |
| job-logos | Public | Job listing logos |
| job-attachments | Public | Job PDF attachments |
| job-application-files | Private | Application CVs and cover letters |
| album-photos | Public | Shared photo albums |
| merch-images | Public | Merchandise product images |

All buckets namespace objects under `<user-id>/`. Storage cleanup on account deletion is handled by `purgeAndDeleteUser()` in the Edge Functions (not by database cascades).

## Important Database Functions

| Function | Purpose |
|---|---|
| `is_approved()` | Returns true if current user is approved. Used in nearly every RLS policy. |
| `is_admin()` | Returns true if current user is admin. |
| `handle_new_user()` | Trigger: creates profile row on auth signup. Swallows errors to never block signup. |
| `ensure_profile()` | RPC: creates missing profile row if handle_new_user failed. |
| `admin_list_members()` | RPC: SECURITY DEFINER, returns all members with emails for Admin panel. |
| `place_merch_order(items, buyer_note)` | RPC: atomic order placement with stock validation. |
| `notify_post_like/comment/rsvp/etc.` | Triggers: insert notifications on relevant events. |
| `notify_admins_new_signup()` | Trigger: notifies admins when someone finishes signup. |

## Realtime

Enabled on `posts` table via `supabase_realtime` publication. (The old `messages`/`message_reactions` realtime subscriptions were removed with schema-update-63 — contact emails have no realtime component.)

## Migration System

Database changes follow a numbered file convention:

1. Write `schema-update-N.sql` (N = next number after the highest existing file)
2. Make every statement idempotent: `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS`
3. Include a comment block explaining what the migration does and why
4. Paste the file's contents into Supabase Dashboard → SQL Editor → Run
5. Keep the file in the repo as history

**`schema-all.sql`** is a consolidated reference (migrations 0–57). It is NOT run for incremental updates — it's for bootstrapping a fresh project or for reading the full schema.

The project does NOT use the Supabase CLI migration system (`supabase/migrations/`).

## Database Development Rules

1. **Inspect schema before changing it.** Read `schema-all.sql` and recent `schema-update-*.sql` files.
2. **Use the migration file convention.** Create `schema-update-N.sql` with clear comments.
3. **Make migrations idempotent.** Use `IF NOT EXISTS` / `CREATE OR REPLACE` so they're safe to re-run.
4. **Preserve existing data.** Never DROP a column or table without explicit approval.
5. **Do not disable RLS.** Every table must have RLS enabled. Every policy must be intentional.
6. **Do not expose the service-role key.** It belongs in Edge Function secrets only.
7. **Test authorization.** Verify that unapproved users cannot see data, that non-owners cannot modify content, that non-admins cannot perform admin actions.
8. **Gate reads on `is_approved()`.** Any new SELECT policy must include this check (unless it's a self-read like profiles' `id = auth.uid()` escape hatch).
9. **Avoid unnecessary schema changes.** If the current schema works, don't change it.
10. **Document the reason.** Every migration file should explain *why*, not just *what*.
