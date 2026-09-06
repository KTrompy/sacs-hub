# The Admin Page — Complete Reverse-Engineering Documentation

**Scope:** everything behind `/admin` in the SACS Alumni Hub React SPA — `src/components/Admin.jsx`, `src/components/MerchAdmin.jsx`, `src/components/AdminHandbook.jsx`, every shared component they use, every Supabase table/RPC/Edge Function/storage bucket they touch, and every `.admin-*`/`.hb-*` CSS rule that renders them.

**Method:** read in full, line by line — `Admin.jsx` (1955 lines), `MerchAdmin.jsx` (592 lines), `AdminHandbook.jsx` (524 lines) — plus the shared components they import, `App.jsx`'s routing/nav, `supabaseClient.js`, and the SQL migrations (`schema-all.sql` + `schema-update-0.sql` through `schema-update-63.sql`) that define the tables, RPCs, RLS policies and triggers the page depends on. Nothing below is inferred from naming alone; where the source didn't settle a question, that's stated explicitly rather than guessed.

**No code was changed to produce this document.**

---

## 1. High-Level Mental Model

The Admin page is the single control panel for running the whole site. It exists so that a non-technical committee member — described throughout the code's own comments as someone who "has never opened a terminal, will never read the repo, and inherited this job at an AGM" — can operate the site's moderation and gatekeeping without ever touching the Supabase dashboard.

**Who uses it:** exactly the members whose `profiles.is_admin` column is `true`. There is no other role tier (no "moderator," no "read-only admin") — you either have full admin power or none. The nav item, the route, and the server-side RPCs all gate on this single boolean.

**What an admin can do, in one sentence each:**
- Decide who gets into the site (approve/decline pending signups).
- Manage existing members (un-approve, promote/demote other admins, permanently delete accounts).
- Adjudicate reports members file against posts/jobs/businesses/profiles.
- Remove any post, job listing, event, or business listing site-wide.
- Feature/unfeature businesses in the public directory.
- Run the merch shop (products, size/colour variants with stock, and order fulfilment).
- Curate the "Notable Old Boys" (Legends) home-page feature.
- Read an immutable, database-written audit trail of every admin action ever taken.
- Read an in-app operating manual (the Handbook) that explains all of the above in plain English.

**The eleven sub-tabs, grouped into four labelled clusters** (this grouping is itself a deliberate UI decision — see Section 3):

| Group | Tabs |
|---|---|
| **People** | Pending approval, Members, Reports |
| **Content** | Posts, Jobs, Events, Businesses |
| **Shop** | Merch & orders |
| **Site** | Notable Old Boys, Activity log, Handbook |

**Information hierarchy, top to bottom:** page title → intro line pointing at the Handbook → an "Attention" strip that answers "does anything need me right now?" in one glance → eight clickable stat cards (a dashboard-style overview that doubles as navigation) → the grouped tab strip → a section header naming the active tab and explaining it in one sentence → the tab's actual content (a list, a table, or a form).

**How the sections relate:** the Attention panel and the stat cards are both *read* from the same underlying state (`members`, `counts`, `openReportsCount`) that the tab content also reads — they're views onto data the page already loaded, not separate fetches. Clicking a stat card or an Attention-panel action button just calls `setSubtab(...)`, which is the single piece of state that decides which of the eleven tab components renders below.

**Main workflows an administrator performs, roughly in order of frequency:** approve or decline pending signups; look at and resolve member-filed reports; occasionally delete a piece of content that shouldn't be up; rarely promote/demote an admin or delete an account outright; run the merch shop day-to-day if the shop is active; add write-ups to the Legends feature occasionally; consult the Handbook when unsure or handing the role to someone else.

---

## 2. Top-to-Bottom UI Walkthrough

### 2.1 Page title and intro (`Admin.jsx` return, top)

**Location:** very top of the page, inside `<section className="panel">`.
**Purpose:** orient a first-time visitor and point them at the Handbook.
**Appearance:** `<h2 className="panel-title">Admin</h2>` — this is the shared `.panel-title` style used by every top-level page (Georgia display font, an accent underline via `::after`, per global CSS — not admin-specific). Below it, a `.panel-sub` paragraph in the muted "ink-soft" body-text color.
**Contents:** the word "Admin" as the heading; a sentence ending in a clickable `Handbook` link (rendered as a `<button className="linklike">`, styled as an inline underlined link in the accent blue, not a real `<a>` because it has no URL — it just calls `setSubtab('handbook')`).
**Behaviour:** clicking "Handbook" switches `subtab` state to `'handbook'`, which unmounts whatever tab was showing and mounts `<AdminHandbook />` at the bottom of the page. Nothing else on the page changes (stat cards, tab strip, and Attention panel all stay put — they render regardless of which sub-tab is active).

### 2.2 Attention panel (`AttentionPanel` function component)

**Location:** directly under the intro paragraph, above the stat-card grid.
**Purpose:** answer "do I need to do anything right now?" without reading all eleven tabs. This is explicitly, per an inline code comment, the point of the whole strip.
**Appearance — "clear" state (nothing needs attention):** a flat white (`--card`) box with a hairline border (`--line`), rounded with `--radius` (12px), with a **green** 3px accent bar on the left edge (`.admin-attention-accent`, background `--ok` = `#2C6E49`) and a green circular checkmark badge (24px, white check on green). Bold "Nothing needs you right now." headline, one line of muted grey explanatory text below.
**Appearance — "needs attention" state:** same box shape but the accent bar is **baby-blue/orange-token** (`--orange` = `#6EC3E8`, the site's accent color — the CSS variable is still literally named `--orange` from a earlier rebrand, see Section 15) instead of green. A small uppercase tracked label "NEEDS YOUR ATTENTION" in accent-dark color, then a bulleted (visually — actually a plain `<ul>` with no bullet glyphs, just vertical `gap: 10px` rows) list of items, each a text line plus a small ghost pill button on the right ("Review them", "Send them a link", "Open reports", "Add a second").
**Contents (conditions, evaluated in this exact order in the code):**
1. If `readyToApprove > 0` → "N people are waiting to be approved" / action **Review them** → jumps to `pending` tab.
2. If `unconfirmed > 0` (people who finished signup but never clicked their email confirmation link) → "N people never confirmed their email — they can't sign in until they do" / action **Send them a link** → jumps to `pending` tab.
3. If `openReports > 0` → "N reports need a decision" / action **Open reports** → jumps to `reports` tab.
4. If `adminCount === 1` (exactly one admin exists site-wide) → a softer-weight, non-urgent line: "You're the only admin — if you lose access, nobody can approve members" / action **Add a second** → jumps to `members` tab. This item renders in a lighter font-weight (`li.soft` CSS class) than the other three, signalling "worth knowing, not urgent."
If none of the four conditions are true, the "clear" state (green, checkmark) renders instead, and if there are people who started but never finished signing up (`unfinished > 0`), that count is mentioned parenthetically inside the "nothing to do" message rather than as its own attention item — because, per the code comment, there is literally nothing an admin can do about someone who hasn't come back to finish their own signup.
**Behaviour:** while `loadingMembers` is true, the whole panel renders nothing (`return null`) — it does not show a loading skeleton. Clicking any action button calls the `onGo` prop, which is `Admin`'s `setSubtab`.

### 2.3 Stat-card row (`.admin-stats-row` → eight `StatCard` buttons)

**Location:** directly below the Attention panel.
**Purpose:** at-a-glance counts of everything the site holds, and a navigation shortcut — every card is a `<button>` that jumps to the tab where that number lives.
**Appearance:** a CSS grid, `repeat(auto-fit, minmax(100px, 1fr))`, so cards reflow to fill the available width and wrap onto multiple rows on narrow screens (see Section 14). Each card is flat — white background, 1px hairline border, `--radius` (12px) corners — with **no permanent shadow**; a hairline-to-solid border transition, 1px upward lift (`translateY(-1px)`), and a soft `--shadow-card` drop shadow appear only on hover/focus. A card can also carry a `.highlight` modifier (accent-blue border + pale-blue background + accent-dark numeral) used for "Pending" and "Open reports" whenever their count is above zero — i.e. the two counts that represent outstanding work get visually called out even outside the Attention panel.
**Contents, left to right:** Members (total, always-approved-or-not), Pending (signed up, not yet let in — highlighted if > 0), Open reports (highlighted if > 0), Posts, Jobs, Events, Businesses, Merch orders.
**Behaviour:** each card's number comes from a different source — Members/Pending are derived client-side from the already-loaded `members` array (`useMemo` filters), Open reports from a dedicated count query, and Posts/Jobs/Events/Businesses/Merch-orders from five parallel `count: 'exact', head: true` queries fired once on mount (`loadCounts`). A card shows `–` instead of a number while its count is still `null`/`undefined` (i.e., before `loadCounts` resolves) — there's no separate skeleton loader for the stat row, the em-dash placeholder is the "loading" state. Clicking any card calls `setSubtab` to that card's tab; it does **not** scroll — the tab strip and content below just re-render in place since everything is on one page.
**Hover title text:** every card has a native browser `title` attribute (the `hint` prop) explaining what the number means — e.g. "Everyone with an account, approved or not." for Members.

### 2.4 Grouped tab strip (`.admin-tabbar`, role="tablist")

**Location:** below the stat cards, closed off by a bottom hairline border rather than sitting in its own boxed card (a deliberate departure from an earlier design — see Section 15's design-history note).
**Purpose:** the actual sub-navigation for the eleven admin sections, organised into the four named groups so eleven raw labels read as four smaller decisions.
**Appearance:** four vertical `.admin-tabgroup` columns laid out in a flex row (wraps to stacked full-width groups under 560px — see Section 14), each with a small uppercase tracked group label ("PEOPLE", "CONTENT", "SHOP", "SITE") above a wrapped row of pill-shaped tab buttons. A vertical hairline divider sits between groups (removed and replaced by a horizontal divider + top padding on mobile). The active tab in each group is a solid navy pill with white text; inactive tabs are transparent-background text buttons that turn accent-blue-tinted on hover. The Handbook tab specifically renders in accent-dark color at rest (via `.admin-subtab-guide`) so a brand-new admin's eye is drawn to it, per an inline code comment calling it "the 'start here' of the whole page."
**Contents:** eleven tab buttons (Pending approval, Members, Reports, Posts, Jobs, Events, Businesses, Merch & orders, Notable Old Boys, Activity log, Handbook), each with `role="tab"` and `aria-selected`. The "Pending approval" tab shows a small solid-accent numeric badge (`.admin-subtab-badge`) when `readyToApprove.length > 0`; the "Reports" tab shows the same badge style when `openReportsCount > 0`. These badges use the count of *actionable* items (ready-to-approve, open reports), not the raw pending/report totals.
**Behaviour:** clicking a tab button calls `setSubtab(t.id)`. Because `subtab` is plain React state (not reflected into the URL), **reloading the page or sharing a link always lands back on the "pending" tab** — there is no deep-linking to a specific admin sub-tab. This is worth knowing before "fixing" it as a bug; it may be intentional simplicity or may be an oversight — the code gives no comment either way (marked here as unclear from implementation).

### 2.5 Section header (`.admin-section-head`)

**Location:** between the tab strip and the tab's actual content. Suppressed entirely when the active tab is `handbook` (the Handbook renders its own hero banner instead — see Section 2.11).
**Purpose:** always tell the admin both which group they're in and which specific tab, plus a one-line plain-English explanation of what the tab is for and what its buttons will do — so nobody has to click a button to find out what it does.
**Appearance:** a small uppercase tracked "eyebrow" label (e.g. "PEOPLE") in accent-dark color, then a Georgia `<h3>` with the tab's display name (e.g. "Members") in navy, then (if the tab defines a `help` string — all do except Handbook) a muted paragraph capped at `74ch` width for readability.
**Contents:** exactly the `SUBTABS` array entry's `group`, `label`, and `help` text for the active tab — these three strings are hard-coded in `Admin.jsx` (see Section 17 for the exact source location) and are the authoritative, single place to edit any tab's blurb.

### 2.6 Setup-needed banner / generic error line

**Location:** between the section header and the tab body, shown regardless of which tab is active (it reflects a page-wide `memberError` state set by member-list operations).
**Purpose:** turn an opaque database error into an actionable instruction for a non-technical admin, specifically for the case where a required SQL migration hasn't been run yet.
**Appearance:** a pale-accent box with a solid accent-colour border (`.admin-setup-banner`) containing a bold headline, an explanation naming the exact SQL file to run in the Supabase dashboard's SQL Editor, and the raw error text in a smaller muted line underneath (`.admin-setup-banner-detail`) for a technical helper to read over the phone.
**Behaviour/condition:** rendered when `memberError` is set **and** its text contains the substring `"does not exist"` or `"function"` (`needsSetup` boolean) — i.e. it's a heuristic string match on the Postgres error message, not a specific error code check. Any other kind of `memberError` (e.g. a permission error, a network blip) instead renders as a plain `<p className="form-error">` line with no special banner.

### 2.7 Tab body

Everything from here down is one of eleven possible components, swapped by simple `{subtab === 'x' && <Component/>}` conditionals (not a router, not lazy-loaded — all eleven are already inside the already-lazy-loaded `Admin.jsx` chunk). Each is documented in full in Section 2.8 onward and again in the Element Inventory / Forms / Tables sections below.

### 2.8 Pending approval tab (`PendingList` + `PendingRows`)

**Purpose:** the primary day-to-day queue — decide who gets let into the site.
**Structure:** an `.admin-guidance` callout (pale background, navy left accent bar) reminding the admin what approving actually grants and to ask a classmate if unsure, followed by **up to four** grouped lists, each only rendered if non-empty:
1. **"Waiting on your decision"** — people who finished signup and confirmed their email; each row has working **Approve** / **Decline** buttons.
2. **"Haven't confirmed their email yet"** — finished signup, but the confirmation link was never clicked. A footnote explains why approving them wouldn't work. A Cloudflare Turnstile captcha widget renders once above this group (only if `TURNSTILE_SITE_KEY` is configured), because resending confirmation goes through Supabase's public `/resend` auth endpoint, which requires the same captcha a real signup would need. Each row here shows a **Resend confirmation** button instead of Approve/Decline.
3. **"Started but didn't finish signing up"** — accounts with no `consented_at` yet (typically a Google-sign-in that was abandoned mid-form). No action button works here except a `mailto:` **Nudge them** link that pre-fills a templated email.
4. **"Declined"** — people already turned down, kept visible with a **Move back to pending** (undo) button.
If both `pending` and `declined` are empty, an `EmptyState` (feed icon) renders instead of any of the above four groups.
**Row contents (`PendingRows`):** avatar placeholder (initials, no photo — `Avatar url={null}`), full name (or "Name not set yet"), a parenthetical showing the legal name on file when it differs from the display/preferred name, title if present, email as a `mailto:` link, class year, city/province/country, a line combining date of birth / occupation / industry / phone **if any of those four are present**, up to five membership-role badges (Old Boy / Current Parent / Past Parent / Current Staff / Past Staff — see the important caveat in Section 20), and "Signed up Xh ago" (plus "· email not confirmed" when relevant).

### 2.9 Members tab (`MembersTable`)

**Purpose:** the complete member directory with moderation actions — the tab an admin uses for anything beyond the initial approve/decline decision.
**Structure:** an `.admin-guidance` callout explaining Un-approve vs. Delete account (the two "remove someone" actions and why they're different), a toolbar with a free-text search box and six filter-chip buttons (Everyone / Approved / Pending / Declined / Admins / Email unconfirmed — each chip shows a live count), then the filtered member list, then a footnote ("Showing N of M members").
**Row contents:** avatar, name (with a "You" tag on the signed-in admin's own row), email/class-year/city, status badges (Approved/Declined/Pending, plus "Email unconfirmed" and/or "Admin" badges layered on), and up to four action buttons: **View profile** (only if approved), **Approve**/**Un-approve** (Approve is disabled with an explanatory tooltip if the person hasn't finished signup or hasn't confirmed email), **Make admin**/**Remove admin**, and **Delete account**. All destructive/consequential actions on this row except the two moderation ones are blocked on your own row (you cannot un-approve, demote, or delete yourself from here — the buttons render `disabled` with a tooltip saying so, and this is enforced again server-side, see Section 11).

### 2.10 Reports tab (`ReportsModeration` + `ReportList`)

**Purpose:** adjudicate reports members file against a post, job listing, business, or profile.
**Structure:** loads up to 200 most recent reports, splits into **"Needs review"** (status = open) and **"Resolved"** (anything else) sections, each its own `.admin-list`.
**Row contents:** the type of thing reported (Feed post / Job listing / Business listing / Member profile) with a status badge (Open/Dismissed/Reviewed), the report reason (Spam, Harassment, Inappropriate, Scam, Something else) and who filed it and when, an optional free-text detail excerpt (truncated to 140 characters), and up to three buttons: **View** (navigates straight to the reported item — post/job/business/profile route), **Mark reviewed**, **Dismiss**. Neither of the latter two deletes anything; they only change the report's own `status` column. If nothing has ever been reported, an `EmptyState` renders explaining that an empty list is a good sign.

### 2.11 Posts / Jobs / Events / Businesses tabs (four near-identical moderation components)

**Purpose:** blunt, single-purpose removal tools for content that shouldn't be up — most content moderation is expected to happen via the Reports tab; these four exist for "you know it when you see it."
**Structure (all four):** a search box filtering the already-loaded rows client-side (no server-side search), then a list. Events additionally splits into **Upcoming** and **Past** sections (upcoming first, since a deletion there affects someone's actual plans).
**Row contents:** Posts show title/author/timestamp and a truncated plain-text preview of the post body (HTML stripped via `DOMParser`, see Section 20 for why that matters). Jobs show title, company, poster, location, timestamp. Events show title, date/time, organiser, location. Businesses show name, category, owner, city/country, timestamp, and a "Featured" badge if promoted.
**Row actions:** all four have **View** (navigates to the public page for that item) and a trash-can **Delete** icon button (`DeleteButton`, always confirms first via `ConfirmDialog`). Businesses additionally have **Feature**/**Unfeature**, a direct toggle with no confirmation dialog (reversible, described in the code as "harmless").
**Load limits:** Posts/Jobs load the 100 most recent rows; Businesses loads 200; Events loads 100 (sorted by event date descending, not creation date). None of the four paginate past that limit — there is no "load more."

### 2.12 Merch & orders tab (`MerchAdmin` → `MerchOrdersAdmin` / `MerchProductsAdmin`)

**Purpose:** run the SACS shop — products with size/colour variants and stock, and every order placed against them.
**Structure:** a two-way pill toggle at the top ("Orders" / "Products") switches between two entirely separate sub-views, each with its own state and its own data load. Full detail in Section 2.13/2.14 below and again in Section 7 (Tables).

### 2.13 Merch → Orders view (`MerchOrdersAdmin`)

**Purpose:** track and fulfil orders. A footnote explicitly warns that there is no live payment gateway — an order landing here is a promise to pay, not a completed sale.
**Structure:** a filter-pill row (All + one pill per status, each showing a live count), then a list of collapsible order rows. Clicking a row's summary line expands `OrderDetail` inline (an accordion, not a modal) showing the itemised order, the buyer's contact info and optional note, a status `<select>`, and an internal admin-only note textarea with a **Save note** button that only appears once the note text has actually changed (`noteDirty`).
**Live updates:** this view subscribes to a Supabase Realtime channel on the `merch_orders` table (`postgres_changes`, event `*`) and calls `load()` again on any change — so a new order placed by a member appears here without the admin refreshing the page. The channel is created on mount and torn down (`supabase.removeChannel`) on unmount.

### 2.14 Merch → Products view (`MerchProductsAdmin` → `ProductForm` → `VariantsEditor`)

**Purpose:** create/edit products and, per product, their size/colour variants (each variant carries its own stock count and its own price adjustment relative to the product's base price).
**Structure:** a flat product list (thumbnail, name, category, price, variant count, total stock, Hidden badge if inactive) with **Hide/Show**, **Edit**, and **Delete** (trash icon, confirms) per row, plus an **Add product** button. Clicking Edit or Add product replaces the list entirely with `ProductForm` — there is no modal here, editing is a full view swap (a `‹ Products` back button returns to the list).
**The nested variants editor:** `VariantsEditor` only renders once a product has been saved (has an `id`) — a brand-new, unsaved product shows a message telling the admin to save first. Once available, it's its own mini CRUD list (size/colour, computed sell price = base + delta, stock, optional SKU) with inline Add/Edit forms (`VariantForm`) rendered below the list rather than in a modal.

### 2.15 Notable Old Boys tab (`LegendsAdmin` → `LegendForm`)

**Purpose:** the only tab where an admin *creates* new public content rather than moderating member-submitted content — there is no member-facing submission flow for Legends by design.
**Structure:** a footnote explaining the home page shows three entries at a time on a weekly rotation and recommends at least six entries before the set stops visibly repeating; an **Add someone** button; a flat list showing every entry **including hidden ones** (admins deliberately see hidden entries — the query has no `active` filter, matching the RLS policy that also lets admins read everything).
**Row contents:** thumbnail photo, name, "Hidden" badge if inactive, category label + years + a 70-character-truncated headline, and five actions: **↑ / ↓** (reorder — disabled at the top/bottom of the list respectively), **Hide/Show**, **Edit**, and a trash-can **Delete** (confirms, and explicitly frames Hide as "the reversible option").
**The form (`LegendForm`):** full detail in Section 6.

### 2.16 Activity log tab (`ActivityLog`)

**Purpose:** a permanent, tamper-proof record of every consequential admin action, for accountability ("who let this person in?" should have a database answer, not an argument).
**Structure:** a filter-pill row (Everything / Members / Content removed / Reports), then a flat reverse-chronological list, capped at the 300 most recent entries with a footnote saying so.
**Row contents:** a small coloured dot (green=good, blue/accent=warn, red=bad, keyed by action type) followed by a sentence built from the row's data — "**{actor name}** {verb} **{target label}**" (e.g. "**Jane Smith** approved **John Doe**") — plus a timestamp and, for reports, the report's reason text as a detail line underneath.
**Read-only by design:** there are zero write actions anywhere on this tab. Almost every row is written by a database trigger, never by this component (see Section 11) — this is stated explicitly in a code comment as the reason the log can be trusted even against a bug in the front end or someone editing data directly in the Supabase dashboard. **One documented exception:** the `delete_member` entry is written directly by the `admin-delete-member` Edge Function itself (a plain `INSERT` into `admin_actions` using the service-role client), not by the `log_member_deletion` trigger from `schema-update-52.sql` — because that trigger keys off `auth.uid()`, which is `null` under a service-role connection, so it cannot fire meaningfully on this path. The Edge Function writes the log entry itself, deliberately *before* it deletes the profile row, since the person's name would otherwise be gone by the time it tried to record it.
**Error state:** if the query fails, it renders the same kind of setup banner as the member list (pointing at `schema-update-52.sql`) rather than a generic error — the code notes this specific migration might not have been run yet.

### 2.17 Handbook tab (`AdminHandbook`)

**Purpose:** the entire operating manual for the role, written to be readable by someone who has never used the site's admin tools or opened a terminal. Full contents summarized in Section 2.11... see the dedicated walk-through in **Section 6 (the Handbook is not a form, but is documented in full detail there for completeness)** — actually see the standalone description below since it isn't a form or table.

**Structure:** a solid-navy hero intro card, then eight collapsible `Section` accordions (all closed by default except sections 1 "What the job actually is" and 6 "Handover checklist," which open on arrival). Each section has a clickable header (title + one-line summary + a +/− chevron) and, when open, prose/definition-lists/tables/callout boxes.
**The eight sections, verbatim titles:**
1. What the job actually is (open by default) — the weekly routine, and an explicit "you are NOT responsible for" list.
2. Every button on this page, and what it does — a per-tab `<dl>` walkthrough of every button, matching what's documented in Section 5 of this document.
3. Judgement calls, decided in advance — six specific awkward scenarios (unrecognised signup, comment argument, someone selling things, a member asking to delete their own account, a member asking for someone else's contact info, someone has died) each with a pre-agreed default response, framed explicitly as decisions the *committee* should make in advance rather than one admin improvising under pressure.
4. When something breaks — a triage checklist (refresh, sign out/in, try another device/browser, ask another member), a table of known error messages and what they mean, and two callout boxes: "stop and call someone technical when…" and "never do these" (never share hosting/DB logins outside the committee, never delete an account "to test," never paste an unsolicited SQL snippet, never export the member list off this page).
5. Where the site actually lives (open by default is NOT this one — re-check: only 1 and 6 are `openByDefault`) — a table of the five external services (Vercel, Supabase, Mapbox, Cloudflare Turnstile, domain name), what each does, what breaks if it lapses, and cost (all free except an unbought ~R180/year domain). Two callouts: current-address note (no custom domain yet, with an inline `TODO` marker for Kyle to fill in later), and a cost-tier warning that Vercel's free plan disallows commercial use, so the site would need to move host the moment it starts taking real payments.
6. Handover checklist (open by default) — an ordered list of everything to do before stepping down as admin (create a shared committee email, migrate every service account to it, store passwords in a shared password manager, promote the incoming admin and watch them approve someone once, keep at least two admins always, export a manual database backup, hand over GitHub repo ownership, walk them through this handbook in one sitting), framed with an opening warning that every service is currently registered to Kyle's personal accounts — named explicitly as the single biggest survival risk to the site.
7. Known gaps and unfinished business — an honest list: approved members aren't auto-emailed (no email service configured yet), no custom domain, no automatic database backups, uploaded photos aren't compressed (a future storage-limit risk), and the two Edge Functions ("delete-account"/"admin-delete-member") may not always be deployed yet.
8. For whoever inherits the code — a developer-facing cheat sheet: stack, the four public env vars, where SQL migrations live and how to run them, the `is_admin()`/`is_approved()` security model, the two Edge Functions and their deploy command, the activity-log trigger mechanism, and the deploy process (push to GitHub, host auto-builds).
**`TODO(...)` markers:** several spots in the Handbook render a small dashed-underline "TODO: …" inline span (`hb-todo` CSS class) marking gaps only Kyle personally can fill in (e.g. "record the exact domain address once bought," "name the person willing to be phoned when something breaks"). These are intentional, visible placeholders — not bugs.

---

## 3. Complete Element Inventory

| Element | Location | Purpose | Type | Interaction | Result |
|---|---|---|---|---|---|
| "Admin" page title | Top of page | Page identity | Static heading | none | — |
| "Handbook" inline link | Intro paragraph | Shortcut to Handbook tab | `<button className="linklike">` | Click | `setSubtab('handbook')` |
| Attention panel | Below intro | Priority to-do surface | Conditional block, 2 visual states | Click an item's action button | `setSubtab(tab)` for that item |
| 8× Stat card | Below Attention panel | Counts + nav shortcuts | `<button>` grid | Click | `setSubtab(...)` to that card's tab |
| Group label (×4: People/Content/Shop/Site) | Tab strip | Categorise tabs | Static label | none | — |
| 11× Sub-tab button | Tab strip | Switch active section | `<button role="tab">` | Click | `setSubtab(id)` |
| Sub-tab numeric badge (Pending, Reports only) | On tab button | Show actionable count | Conditional `<span>` | none (display only) | — |
| Section eyebrow + `<h3>` + help text | Above tab body | Explain active tab | Static, driven by `SUBTABS` data | none | — |
| Setup-needed banner | Above tab body | Explain a missing migration | Conditional block | none (informational) | — |
| Search input (Members/Posts/Jobs/Events/Businesses) | Toolbar in 5 tabs | Client-side text filter | `<input>` | Type | Filters the already-loaded array in memory |
| Status filter chips (Members: 6, Activity log: 4, Merch orders: status+All) | Toolbar | Client-side category filter | `<button>` row, each showing a live count | Click | Sets local `statusFilter`/`filter` state |
| Pending row: Approve | Pending tab | Grant site access | `<button>` | Click | `UPDATE profiles SET approved=true` + fire-and-forget approval email |
| Pending row: Decline | Pending tab | Refuse access, reversibly | `<button>` → opens modal | Click, then confirm in modal | `UPDATE profiles SET declined_at, declined_reason` + fire-and-forget decline email |
| Pending row: Resend confirmation | Pending tab (unconfirmed group) | Re-send Supabase auth email | `<button>` | Click (requires captcha token) | `supabase.auth.resend()` |
| Pending row: Nudge them | Pending tab (unfinished group) | Prompt an abandoned signup | `<a href="mailto:...">` | Click | Opens the user's email client with a pre-filled message; no server call |
| Declined row: Move back to pending | Pending tab (declined group) | Undo a decline | `<button>` | Click | `UPDATE profiles SET declined_at=null, declined_reason=''` |
| Turnstile captcha widget | Pending tab (unconfirmed group) | Satisfy Supabase's `/resend` captcha requirement | 3rd-party widget iframe | Solve challenge | Produces a token consumed by the next Resend click |
| Decline modal: reason input | Modal | Optional member-visible reason | `<input maxLength=200>` | Type | Passed to `declineMember` |
| Decline modal: Cancel / Decline and email them | Modal footer | Abort or confirm | `<button>` ×2 | Click | Cancel closes modal; Confirm runs decline + closes |
| Members: search box | Members tab | Filter by name/email/city | `<input>` | Type | Client-side filter |
| Members: 6 status filter chips | Members tab | Filter by status | `<button>` row | Click | Client-side filter |
| Member row: View profile | Members tab | Open public profile | `<button>` | Click | `navigate('/people/:id')` |
| Member row: Approve/Un-approve | Members tab | Toggle site access | `<button>` (Approve can be disabled) | Click → confirm dialog for Un-approve only | `UPDATE profiles SET approved` |
| Member row: Make admin/Remove admin | Members tab | Toggle admin rights | `<button>` | Click → confirm dialog | `UPDATE profiles SET is_admin` |
| Member row: Delete account | Members tab | Permanently remove | `<button className="btn danger">` | Click → confirm dialog | Edge Function `admin-delete-member` |
| Confirm dialog (shared) | Portal to `<body>` | Prevent accidental destructive actions | Modal | Click Cancel/Confirm, click backdrop, or Escape | Cancel closes; Confirm runs the pending action |
| Report row: View | Reports tab | Jump to reported item | `<button>` | Click | `navigate()` to post/job/business/profile route |
| Report row: Mark reviewed | Reports tab | Close out a report | `<button>` | Click | `UPDATE reports SET status='reviewed'` |
| Report row: Dismiss | Reports tab | Close out a report as unfounded | `<button>` | Click | `UPDATE reports SET status='dismissed'` |
| Post/Job/Event/Business row: View | Their tabs | Open the public item | `<button>` | Click | `navigate()` |
| Post/Job/Event/Business row: Delete | Their tabs | Remove the item site-wide | `DeleteButton` (trash icon) | Click → confirm | `DELETE` from that table |
| Business row: Feature/Unfeature | Businesses tab | Pin to top of public directory | `<button>` | Click (no confirm) | `UPDATE businesses SET promoted` |
| Merch: Orders/Products toggle | Merch tab | Switch sub-view | 2-way pill toggle | Click | Local `view` state |
| Order row (collapsible) | Merch → Orders | Expand/collapse detail | `<button>` (whole summary row) | Click | Toggles `openId` |
| Order detail: status `<select>` | Expanded order row | Change fulfilment status | `<select>` | Change | `UPDATE merch_orders SET status`; cancelling triggers a stock-restore DB trigger |
| Order detail: internal note textarea + Save note | Expanded order row | Admin-only note | `<textarea>` + `<button>` (only shown when dirty) | Type, then click Save | `UPDATE merch_orders SET admin_note` |
| Product row: Hide/Show | Merch → Products | Toggle storefront visibility | `<button>` | Click | `UPDATE merch_products SET active` |
| Product row: Edit | Merch → Products | Open product form | `<button>` | Click | View swap to `ProductForm` |
| Product row: Delete | Merch → Products | Remove product for good | `DeleteButton` | Click → confirm | `DELETE` (past orders keep their own item snapshot, unaffected) |
| Add product button | Merch → Products | Create new product | `<button>` | Click | View swap to blank `ProductForm` |
| Variant row: Hide/Show, Edit, Delete | Inside `ProductForm` | Manage one size/colour option | `<button>` ×3 | Click | `UPDATE`/`DELETE` on `merch_variants` |
| + Add option | Inside `ProductForm` | Create a new variant | `<button>` | Click | Opens inline `VariantForm` |
| Legend row: ↑ / ↓ | Legends tab | Reorder | `<button>` ×2 | Click | Renumbers `sort_order` for every row via N parallel `UPDATE`s |
| Legend row: Hide/Show | Legends tab | Toggle home-page visibility | `<button>` | Click | `UPDATE legends SET active` |
| Legend row: Edit | Legends tab | Open edit form | `<button>` | Click | View swap to `LegendForm` |
| Legend row: Delete | Legends tab | Remove entry + photo | `DeleteButton` | Click → confirm | `DELETE` row + best-effort storage file removal |
| Add someone button | Legends tab | Create new entry | `<button>` | Click | View swap to blank `LegendForm` |
| Legend form fields (7) | `LegendForm` | Author a Legend entry | Various (see Section 6) | Type/upload/submit | `INSERT`/`UPDATE` on `legends`, optional storage upload |
| Activity log: 4 filter chips | Activity log tab | Filter by category | `<button>` row | Click | Client-side filter |
| Activity log row | Activity log tab | Read-only audit entry | Static row | none | — |
| Handbook: 8 accordion sections | Handbook tab | Expand/collapse manual sections | `<button>` header per section | Click | Toggles local `open` state per section |

---

## 4. Every Button, In Detail

This section documents **behaviour**, not just presence — every item above that performs a mutation is expanded here with success/failure/loading/permission behaviour.

**Approve** (Pending tab and Members tab) — Optimistically flips the row's `approved` flag to `true` in local state, then sends `UPDATE profiles SET approved=true WHERE id=X`. Guarded client-side (with a plain-English `memberError` message, not a dialog) against two specific bad states before the request is even sent: the person hasn't finished signup (`!consented_at`) or hasn't confirmed their email (`!email_confirmed_at`) — both are also enforced by RLS server-side (`schema-update-45`/`schema-update-57`), so this is a UX nicety, not the real gate. On success, fires (but never awaits or blocks on) `supabase.functions.invoke('send-approval-email', ...)`; if that email send fails, the approval itself is **not** rolled back — a `memberError` message says the approval went through but the email didn't. On a real database error, the optimistic update is undone via a full `loadMembers()` reload. No confirmation dialog. Disabled with a "Working…" label while in flight (per-row busy tracking via a `Set` of in-flight ids, `withBusy`), which also prevents a double-click from firing the request twice.

**Decline** — Opens a modal (not an immediate action) asking for an optional reason (max 200 characters, member-visible). Confirming sets `declined_at`/`declined_reason` and fires `send-member-email` with `kind: 'declined'`. Same fire-and-forget-but-report-failure pattern as Approve's email. No hard delete of any kind — fully reversible via "Move back to pending."

**Resend confirmation** — Requires a solved Turnstile captcha token first if `TURNSTILE_SITE_KEY` is configured (else the check is skipped entirely — see Section 11). Calls `supabase.auth.resend({type:'signup', ...})` — this is the public Supabase Auth endpoint, not an admin RPC, which is exactly why it needs its own captcha. The captcha token is single-use; a nonce counter forces the Turnstile widget to reset after every attempt whether it succeeded or failed.

**Un-approve** — Confirmation dialog required (unlike Approve). Sets `approved=false`. Disabled on your own row. Explicitly described in the Handbook as "almost always the right one" over Delete, because it's reversible and preserves everything the person has posted.

**Make admin / Remove admin** — Confirmation dialog required either direction. `UPDATE profiles SET is_admin`. Disabled on your own row both ways in the UI; separately, the database itself refuses (via the `prevent_last_admin_demotion` trigger) any `UPDATE` that would demote the sole remaining admin, on any row, regardless of who's asking — a real, server-enforced floor, not just a UI courtesy or a Handbook-stated policy.

**Delete account** — Confirmation dialog spells out everything that goes with the account (login, profile, posts, comments, job listings, events, RSVPs, business listings, messages). Disabled on your own row in the UI (with a tooltip pointing at Settings instead) — and, independently, the `admin-delete-member` Edge Function itself rejects `target_user_id === caller_id` with an explicit 400 error telling the caller to use Settings instead, so this is enforced twice, not once. The Edge Function does storage cleanup across ten owned buckets (`avatars`, `post-images`, `post-videos`, `cvs`, `business-logos`, `business-covers`, `job-logos`, `job-attachments`, `event-images`, `job-application-files` — every object under that user's `<user-id>/` folder prefix in each) before deleting the `auth.users` row via the Supabase Admin API, which cascades through every foreign-keyed table. It also writes the `admin_actions` audit-log row itself, directly, *before* the delete (see Section 2.16's read-only-by-design caveat). The client double-checks the function's response actually reports the correct `deleted_user_id` before treating it as successful.

**Mark reviewed / Dismiss** (Reports) — No confirmation dialog (non-destructive — nothing is deleted, only the report's own status changes). On failure, reloads the whole report list rather than leaving a stale optimistic update in place, specifically because a failed update "looking like it worked" until the row reappeared was called out as a past bug in a code comment.

**Delete** (Posts/Jobs/Events/Businesses, via `DeleteButton`) — Always confirms first. A straight `DELETE FROM <table> WHERE id=X`. Server-side, deleting an event also cascades to its RSVPs (foreign key), and deleting a post/job/event/business that the admin doesn't own fires a database trigger that writes an Activity Log row (Section 11).

**Feature / Unfeature** (Businesses) — No confirmation (reversible, low-stakes). Optimistic toggle, rolled back on error.

**Order status `<select>`** — Changing it fires `UPDATE merch_orders SET status=X` immediately (no separate Save button — the select's `onChange` is the save). Setting status to `cancelled` fires a database trigger that restores the reserved stock on every line item back onto its `merch_variants` row. Changing status also fires a logging trigger that writes an Activity Log entry, **except** when the buyer is the one changing it (i.e., their own self-cancel of a still-pending order isn't logged as an admin action).

**Save note** (Order detail) — Only rendered once the textarea's content differs from the saved value (`noteDirty`). `UPDATE merch_orders SET admin_note`.

**Hide/Show** (Products, Variants, Legends) — Simple boolean toggle, no confirmation, described everywhere in the UI as "the reversible option" relative to Delete.

**Delete product/variant/legend** — Confirms first. Deleting a product also best-effort-deletes its storage image; deleting a legend also best-effort-deletes its storage photo (only *after* the row delete succeeds, so a failed storage cleanup never leaves a dangling row). Deleting a merch product is explicitly noted as leaving past orders intact because order items snapshot the product name/price at time of purchase rather than referencing the live product row.

**↑ / ↓ (Legend reorder)** — No confirmation. Swaps two entries' positions in the local array, then re-writes `sort_order` for **every** row in the list as N separate `UPDATE` calls (not a single batched upsert — a code comment explains a naive upsert would fail Postgres's `NOT NULL` checks on columns not included in the partial payload). If any of the N writes fails, the whole list is reloaded from the server to avoid a half-applied order persisting client-side.

---

## 5. Every Form

### 5.1 Decline reason (inline within `PendingList`'s modal)
Purpose: capture an optional, member-visible reason for a decline. One field: a free-text `<input maxLength={200}>`, no validation beyond the length cap, defaults to empty, entirely optional. Submit ("Decline and email them") always succeeds client-side validation-wise; the only way this "form" fails is the underlying database write. Cancel discards the typed reason and closes with no change. After a successful submit, the modal closes and the member row moves into the Declined group.

### 5.2 Legend form (`LegendForm`)
Purpose: author or edit one "Notable Old Boy" entry. Create and edit share the exact same component and fields — the only difference is whether `initial.id` exists, which decides `INSERT` vs `UPDATE` and the submit button's label ("Add legend" vs "Save changes").

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| Full name | text, maxLength 80 | Yes | '' | |
| Category | `<select>`, one of 10 fixed values (Sport, Business, Politics, Arts, Academia, Military, Medicine, Media, Public service, SACS/other) | Yes (has a default) | 'sport' | Drives the tile's pill colour on the public page |
| Years in SACS | text, maxLength 40 | No | '' | Free text (not two integer years) deliberately, because the source records are often vague ("early 1950s") |
| Degree | text, maxLength 60 | No | '' | |
| Claim to fame (headline) | text, maxLength 160 | Yes | '' | Shown on the public tile under the name |
| Photo | file upload, JPG/PNG/WebP, ≤5MB | Yes (a photo URL must exist, new or pre-existing) | none | Validated client-side (type + size) before any upload attempt; the storage bucket enforces the same limits server-side as a backstop |
| The story | `<textarea rows=8>` | No | '' | Long-form, shown only inside the public modal; plain text with newlines, deliberately not rich text/HTML (no injection surface) |
| Read-more link | URL text input | No | '' | |
| Link wording | text, maxLength 40 | No | '' | Label for the read-more link |
| Show on the home page | checkbox | — | `true` | Maps to the `active` column |

**Validation:** name, headline, and "a photo must exist" are checked client-side before any network call; failures set a local `error` string shown above the button row. There is no server-side check beyond the database's own `not null` constraints on `name`/`headline`.
**Submit behaviour:** if a new photo file was picked, it's uploaded to the `legend-photos` storage bucket first (random filename, original extension preserved), and only once that succeeds does the old photo (if replacing one) get best-effort deleted. Then a single `INSERT` or `UPDATE` writes the row. On any failure (upload or database), the error message is shown and the form stays open with everything typed still in place — nothing is lost.
**Cancel:** discards all changes, returns to the list view, no confirmation prompt (even for a half-filled new entry).
**After success:** a toast confirms ("Entry added."/"Entry updated."), the view returns to the list, and the list is reloaded from the server.

### 5.3 Merch product form (`ProductForm`)
| Field | Type | Required | Default |
|---|---|---|---|
| Name | text, maxLength 120 | Yes | '' |
| Description | `<textarea rows=3>`, maxLength 1000 | No | '' |
| Category | `<select>`, one of 7 fixed values (Apparel, Headwear, Drinkware, Accessories, Stationery, Homeware, Other) | — | first value |
| Base price (R) | number input, min 0, step 0.01 | Yes | '' |
| Photo | file upload, JPG/PNG/WebP, ≤4MB | No (product can exist with no photo — an empty placeholder tile shows instead) | '' |
| Visible in the shop | checkbox | — | `true` (maps to `active`) |

**Validation:** name must be non-empty; price must parse as a finite number ≥ 0. Both checked client-side before any request.
**Submit behaviour:** differs meaningfully between create and edit — on **create**, a successful insert immediately re-renders the *same* form component with the returned row (including its new `id`) rather than closing, specifically so the `VariantsEditor` below it becomes available without a second navigation step. On **edit**, the same happens (form stays open, state refreshed from the server response) plus `updated_at` is stamped. **Close/Cancel** always reloads the product list on the way out (not just on Cancel) — the code comment explains this is because a Save may have already happened inline while other edits were still in progress.
**Nested variants:** `VariantsEditor` only appears once `product.id` exists; a not-yet-saved product shows a placeholder message instructing "save the product first."

### 5.4 Merch variant form (`VariantForm`)
| Field | Type | Required | Default |
|---|---|---|---|
| Size | text, maxLength 30, placeholder suggests leaving blank | No | '' |
| Colour | text, maxLength 30 | No | '' |
| Price adjustment (R) | number, step 0.01 (can be negative) | No | '0' |
| Stock | number, min 0, step 1 | No | '0' |
| SKU | text, maxLength 60 | No | '' |
| Available to order | checkbox | — | `true` |

**Validation:** stock must be a finite number ≥ 0; price adjustment must be a finite number (can be negative, e.g. a discount variant). A duplicate size+colour combination for the same product is caught via the database's unique constraint and surfaced as "That size/colour combination already exists." rather than a raw Postgres error code.
**Submit behaviour:** `INSERT` or `UPDATE` depending on whether `form.id` exists; on success, closes the inline form and reloads the variant list; on failure, shows the error inline and keeps the form open.

---

## 6. Every Data Table / List

All "tables" in this UI are actually `<ul className="admin-list">` rows, not `<table>` elements (the sole exception is the Handbook's services table, which is genuinely a `<table className="hb-table">`, and it's purely informational/static). "Table" below means "the repeating list of records," matching the spirit of the requested section.

### 6.1 Members list
**Represents:** every row in `profiles`, joined with `auth.users` for email/confirmation status, via the `admin_list_members()` RPC (loaded once on mount, not paginated or re-queried per filter/search — filtering and searching are 100% client-side over the already-fetched array). **Sort:** server-side, `created_at desc` (newest signups first) — not user-controllable. **Filter:** 6 status chips, computed client-side. **Search:** client-side substring match across name/email/city, case-insensitive. **Selection/bulk actions:** none — every action is per-row. **Row actions:** documented in Section 4. **Empty state:** "No matching members" (search icon) when a filter/search yields nothing; there's no distinct "there are zero members ever" empty state because that can't realistically happen (the signed-in admin is always a member). **Loading state:** `LoadingState` spinner + "Loading members…" while the RPC is in flight. **Error state:** the shared setup-banner/plain-error handling described in Section 2.6. **Responsive:** rows wrap their action buttons onto a new full-width line below 560px (Section 14).

### 6.2 Pending signups list
Same underlying `members` array as 6.1, filtered client-side into the not-yet-`approved`-and-not-`declined` subset, then split three further ways (ready/unconfirmed/unfinished) as described in Section 2.8. No independent sort/filter/search controls of its own. Empty state covers both `pending` and `declined` being empty simultaneously.

### 6.3 Reports list
**Represents:** `reports` rows (up to 200, newest first), each joined to the reporter's `full_name` via a Postgres foreign-key embed (`reporter:profiles!reports_reporter_id_fkey`). **Sort:** fixed, `created_at desc`. **No filter/search UI** — the only "filtering" is the fixed open/resolved split into two headed sections. **Row actions:** View/Mark reviewed/Dismiss (Section 4). **Empty state:** distinct copy for "no reports at all" vs. the implicit "resolved section only" (if there are zero open reports but some resolved ones, the "Needs review" heading and its list simply don't render at all — no explicit "nothing needs review" sub-message the way the Attention panel has one).

### 6.4 Posts / Jobs / Events / Businesses lists
Each independently loaded (own `useState`/`useEffect`, own `load()` function), each with a client-side search box, no server-side filtering. Sort is fixed per table: Posts/Jobs `created_at desc`; Events `event_date desc` (then split client-side into upcoming/past by comparing to `Date.now()`); Businesses `created_at desc`. Row counts are capped (100/100/100/200 respectively) with **no pagination control** — anything beyond the cap is simply invisible to the admin from this screen (a real limitation worth flagging to a future maintainer if the site's content volume grows — see Section 21).

### 6.5 Merch orders list
**Represents:** `merch_orders` joined with the buyer's `profiles` (name, phone) and all `merch_order_items` for that order, loaded in one query with no row cap and no pagination. **Sort:** fixed, `created_at desc`. **Filter:** status pills (computed client-side from the already-loaded set, each showing a live count). **Selection:** none; rows expand individually (accordion, one at a time — clicking a second row's summary does not auto-collapse the first, `openId` is a single value so actually only one can be open simultaneously). **Live updates:** Realtime-subscribed (Section 2.13) — this is the *only* list on the whole admin page that updates itself without a manual refresh or user action. **Row action inside the expanded detail:** status change, note save (Section 4).

### 6.6 Merch products list
**Represents:** `merch_products`, each augmented with a client-computed "total stock" (sum of active variants' `stock_quantity`) via a second query against `merch_variants` filtered `.in('product_id', ids)`. **Sort:** fixed, `created_at desc`. No filter/search UI at all on this particular list (unlike most other admin lists). **Row actions:** Hide/Show, Edit, Delete (Section 4).

### 6.7 Merch variants list (nested inside `ProductForm`)
**Represents:** `merch_variants` for one specific product, sorted by `id asc` (creation order, not alphabetical). No filter/search (variant lists are expected to be short — sizes/colours for one product). **Row actions:** Hide/Show, Edit, Delete.

### 6.8 Legends list
**Represents:** every row in `legends` (admins see hidden ones too — no `active` filter in the admin query), sorted `sort_order asc, created_at asc`. **No filter/search UI.** **Row actions:** reorder (↑/↓), Hide/Show, Edit, Delete (Section 4). **Empty state:** distinct copy noting the public home page shows nothing in this feature until at least one entry exists.

### 6.9 Activity log list
**Represents:** `admin_actions`, up to 300 most recent rows, `created_at desc`, **entirely read-only** (Section 11 explains why it can be trusted). **Filter:** 4 client-side category chips (Everything / Members / Content removed / Reports) matched against the row's `target_type`/`action` fields. **No search box.** **No row actions of any kind.**

---

## 7. Modals, Drawers, and Popups

The admin page has exactly **two** kinds of overlay, both built on the same shared `ConfirmDialog` component, plus one bespoke modal:

### 7.1 `ConfirmDialog` (shared, used everywhere destructive)
**What opens it:** any `DeleteButton` click; the explicit `askDelete`/`askPromote`/`askDemote`/`askUnapprove` calls in `MembersTable`.
**Why it exists:** a styled stand-in for the browser's native `window.confirm()`, matching the app's own visual chrome.
**Displayed:** a title, an optional message paragraph (both fully customised per call-site — see Section 4 for the exact wording used for each action), Cancel and Confirm buttons.
**Fields/validation:** none — it's a pure yes/no gate.
**Cancel behaviour:** calls the `onCancel` callback and unmounts; no side effect.
**Close behaviour:** clicking the backdrop, clicking the "×" in the header, or (via the shared `useModal` hook) pressing **Escape** all behave identically to Cancel.
**Submit/Confirm behaviour:** calls `onConfirm`, which is whatever specific mutation the call-site wired up (delete, promote, demote, etc.), then the dialog unmounts.
**Does clicking outside close it:** yes (backdrop click = cancel).
**Focus:** the Cancel button carries `data-autofocus`, not Confirm — an accidental Enter keystroke right after the dialog appears lands on the safe half of a destructive choice, per an explicit code comment.
**Rendering mechanism:** rendered via `createPortal` straight into `document.body`, not in place in the component tree — this matters because `DeleteButton` is often mounted deep inside a list row that may have a CSS `transform` on hover (which would otherwise break `position: fixed` positioning for anything nested inside it). See Section 20 for why this is a "don't casually refactor this" detail.
**History:** explicitly opts out of the app's back-button/history-stack integration (`history: false` passed to `useModal`) — it's a transient answer instead of a "page" worth a Back-button stop, and it often unmounts in the same tick as a dialog underneath it.

### 7.2 Decline reason modal (bespoke, inside `PendingList`)
**What opens it:** clicking **Decline** on a pending row.
**Displayed:** explanation text, the optional reason `<input>` (Section 5.1), Cancel / "Decline and email them" buttons.
**Close behaviour:** clicking the backdrop or the "×" button calls the same handler as Cancel (`setDecliningId(null)`). No explicit Escape-key handling was found wired to this specific modal in the code read (this modal is hand-rolled inline in `PendingList`, not built on `useModal`/`ConfirmDialog` — **unclear from implementation** whether Escape closes it; not confirmed either way from the source).
**State persistence:** the typed reason is cleared (`setDeclineReason('')`) whenever the modal is closed by any path, including Cancel — reopening Decline on the same or a different row always starts from an empty reason field.

### 7.3 Turnstile captcha widget (not a modal, but an embedded third-party overlay)
Rendered inline (not as a popup) above the "unconfirmed" group on the Pending tab, only when `TURNSTILE_SITE_KEY` is configured. Resets itself (`resetSignal={captchaNonce}`) after every resend attempt, success or failure, forcing a fresh challenge each time.

---

## 8. Page State

State is split across `Admin.jsx` (page-level, shared across tabs) and each tab component (local, tab-specific). None of it is global/Redux-style — it's all plain `useState`/`useMemo` inside function components, reset entirely if the whole `Admin` component unmounts (e.g. navigating away and back re-fetches everything from scratch — nothing persists client-side between visits).

**Page-level state (`Admin.jsx`):**
- `subtab` (string, default `'pending'`) — which of the 11 tabs is showing. Drives the entire tab-body conditional render, the active tab's pill styling, and the section header. Not persisted to the URL (Section 2.4).
- `members` (array) — the full result of `admin_list_members()`. Read by the Attention panel, all 8 stat cards indirectly (via derived counts), the Pending tab, and the Members tab. Every mutation to a member (approve/decline/promote/delete) updates this array optimistically before or in place of a full reload.
- `loadingMembers` (bool) — gates the Attention panel (renders nothing while true) and both the Pending and Members tabs (each shows its own `LoadingState` while true).
- `memberError` (string|null) — surfaces as either the setup banner or a plain error line (Section 2.6); also reused for user-facing messages about failed side-effect emails.
- `counts` (object, keyed by `posts`/`jobs`/`events`/`businesses`/`merchOrders`) — feeds 4 of the 8 stat cards. Populated once from 5 parallel head-count queries; **never refreshed automatically** after a delete on those tabs — e.g. deleting a post updates the Posts tab's own local list but does **not** decrement the Posts stat card until the whole `Admin` page remounts (confirmed from the code: `PostsModeration`'s `remove()` only calls `setPosts`, never anything that touches the parent's `counts` state). This is a real, observable staleness — see Section 20.
- `openReportsCount` (number) — feeds the Reports stat card and the Reports tab's own sub-tab badge; kept in sync by `ReportsModeration`'s `onCountChange` callback whenever a report's status changes, so unlike `counts` above, this one *does* stay live.
- `busyIds` (a `Set`) — tracks which member rows have an in-flight mutation, used to disable buttons and show "Working…" text, and to hard-prevent a double-click firing the same request twice (`withBusy` checks membership before starting).
- `captchaToken` / `captchaNonce` / `resendMsg` — the Turnstile/resend-confirmation flow's own small state machine, page-level because the (single, shared) Turnstile widget lives once above the "unconfirmed" group rather than per-row.

**Per-tab local state** (not shared, reset every time the tab component mounts — i.e., switching away and back to a tab **always reloads its data from the server**, since `subtab === 'x' && <Component/>` fully unmounts the previous tab): each of `ReportsModeration`, `PostsModeration`, `JobsModeration`, `EventsModeration`, `BusinessesModeration`, `MerchOrdersAdmin`, `MerchProductsAdmin`, `LegendsAdmin`, `ActivityLog` independently owns its own `items`/`loading`/`q` (search)/`error` state and its own `load()` function called from its own `useEffect(..., [])`.

**Key state relationships:**
- Selecting `editing` (a Legend, Product, or Variant row, or the sentinel `EMPTY_*` object) inside `LegendsAdmin`/`MerchProductsAdmin`/`VariantsEditor` is a single value that is either `null` (list view) or the row/blank-template being edited — deliberately modeled as one variable rather than a separate `adding` boolean plus an `editing` row, specifically so "both a full editor and the empty-add-form are open at once" can never happen (an explicit code comment calls this out).
- `confirmTarget` in `MembersTable` similarly bundles which member *and* which action (`delete`/`promote`/`demote`/`unapprove`) into one object, so exactly one confirm dialog can ever be pending.
- `openId` in `MerchOrdersAdmin` is a single id (not a Set), so only one order row can be expanded at a time.
- The Pending tab's `ready`/`unconfirmed`/`unfinished` groupings and the Members tab's filter counts are **not stored state** — they're recomputed on every render via `.filter()`/`useMemo` over `members`, so they can never drift out of sync with the underlying data by definition.

---

## 9. Data Flow

**Members / pending signups:** `auth.users` + `public.profiles` (source) → `admin_list_members()` security-definer RPC (the only path; direct table reads are blocked for this join because `auth.users` isn't exposed to the client) → `Admin.jsx`'s `members` state → rendered by both `PendingList`/`PendingRows` and `MembersTable` → a button click (Approve/Decline/Un-approve/Promote/Demote) issues a direct `supabase.from('profiles').update(...)` → RLS policies (`is_admin()` check, plus the self-elevation-prevention `with check` clause) gate the write at the database → on success, local `members` state is patched optimistically → a database trigger (`log_profile_admin_change` / `log_member_deletion`) independently writes an `admin_actions` row, invisible to the client request that caused it → next time the Activity Log tab is opened, that row appears there.

**Reports:** member-facing `ReportButton` (elsewhere in the app, not part of the admin page) inserts into `public.reports` → `ReportsModeration` reads it back (with a `profiles` embed for the reporter's name) → admin clicks Mark reviewed/Dismiss → `UPDATE reports SET status` → a trigger (`log_report_decision`) writes to `admin_actions` → `onCountChange` prop bubbles the new open-count up to `Admin.jsx`'s `openReportsCount` state, which is what actually keeps the stat card and tab badge live without a full page reload.

**Content moderation (Posts/Jobs/Events/Businesses):** each tab independently `SELECT`s its table (with a `profiles` embed for the author/poster/organiser/owner's name) → admin clicks Delete → `DELETE FROM <table> WHERE id=X`, gated by an `is_admin()` RLS policy → a `before delete` trigger checks whether the deleter is the *owner*; if not, it writes an `admin_actions` row (so members deleting their own stuff is never logged as moderation) → the local list's `setState` filters the deleted row out immediately (no re-fetch needed, since the delete already succeeded).

**Merch orders:** a member's `Checkout.jsx` (elsewhere) calls the `place_merch_order()` security-definer RPC (atomically checks stock and decrements it) → row lands in `merch_orders`/`merch_order_items` → **pushed live** to `MerchOrdersAdmin` via a Postgres Realtime subscription (not a poll) → admin changes status via the `<select>` → `UPDATE merch_orders SET status` → if the new status is `cancelled`, a database trigger (`restore_stock_on_merch_cancel`) adds the reserved quantity back onto each `merch_variants` row → a second trigger (`log_merch_order_status_change`) writes an Activity Log entry, unless the buyer made the change themselves.

**Merch products/variants:** admin fills `ProductForm`/`VariantForm` → optional image uploaded to the `merch-images` public storage bucket first (admin-only write policy) → `INSERT`/`UPDATE` on `merch_products`/`merch_variants` → shop-facing `Shop.jsx` (elsewhere in the app) reads the same tables filtered to `active = true` and `is_approved()` members only, so a Hide toggle here takes effect on the public storefront on its very next load (no cache to invalidate — everything is a live Supabase query).

**Legends:** admin fills `LegendForm` → optional photo uploaded to `legend-photos` storage bucket → `INSERT`/`UPDATE` on `legends` → the public Home page and `LegendsHall.jsx` (elsewhere) read the same table filtered to `active = true` and pick a rotating trio based on the current week — so toggling Hide/Show or reordering here changes what the public home page shows the next time anyone loads it, with no separate publish step.

**Account deletion:** Delete account button → `adminDeleteAccount()` in `supabaseClient.js` → `admin-delete-member` Supabase Edge Function (server-side, checks `is_admin()` against the *caller's* own JWT — never trusts the target id blindly — and separately refuses a self-targeted delete) → the function writes its own `admin_actions` audit-log row directly via the service-role client, *before* deleting anything (since the profile's name would otherwise be gone by the time it tried), then purges the ten owned storage buckets, then calls Supabase's Admin API (`auth.admin.deleteUser`) with the service-role key → cascading foreign keys remove everything else in one transaction → client receives back `{deleted_user_id}` and only treats the operation as successful if it matches the id that was requested.

---

## 10. API / Backend Behaviour

All backend access is through the Supabase JS client (`supabase` from `src/supabaseClient.js`) — there is no separate custom REST API. Every call below is anonymous-key + row-level-security, **except** the two Edge Functions, which run with the service-role key server-side.

| Call | Kind | Purpose | Auth/Authz | Loading UI | Error UI | Success UI |
|---|---|---|---|---|---|---|
| `admin_list_members()` | RPC (security definer) | Fetch every member + auth fields for the Pending/Members tabs | Raises `'Admins only'` internally if caller isn't an admin; also revoked from `anon` entirely | `LoadingState` | Setup banner (if migration-shaped error) or plain error line | Populates `members` |
| `profiles` UPDATE (`approved`, `is_admin`, `declined_at`, `declined_reason`) | Direct table write | Approve/decline/promote/demote/undo-decline | RLS: `is_admin()` on the "Admins can update any profile" policy; a separate self-update policy blocks members from writing their own `approved`/`is_admin` | Row-level "Working…" via `busyIds` | `memberError` line + reload | Optimistic UI update kept |
| `admin-delete-member` | Edge Function (`supabase/functions/admin-delete-member/index.ts`) | Permanently delete a member (admin-initiated) | Checks `is_admin()` server-side against the caller's own token; independently refuses `target_user_id === caller_id` (400) | "Working…" on the row | `memberError` | Row removed from list, counts reloaded; writes its own `admin_actions` row directly (not via trigger — see Section 6.9) |
| `delete-account` | Edge Function (`supabase/functions/delete-account/index.ts`) | Self-service account deletion — **not called from the Admin page**, called from `Settings.jsx`/`Profile.jsx` elsewhere in the app; documented here because it shares all its cleanup logic with `admin-delete-member` and because of the last-admin gap it creates (Section 19/20) | Only checks the caller is a valid, signed-in user — no admin check, no last-admin check of any kind | n/a (not on this page) | n/a | Deletes the caller's own account, cascades everywhere |
| `send-approval-email` / `send-member-email` | Edge Functions | Fire-and-forget notification emails on approve/decline | No special authz beyond being invoked by an already-verified admin session | none (never awaited/blocking) | `memberError` text says the action succeeded but the email failed | Member is emailed |
| `auth.resend()` | Supabase Auth (public endpoint) | Re-send signup confirmation email | Requires Turnstile captcha if configured; otherwise open (any authenticated admin can trigger it for any email) | "Sending…" | Inline `form-error` message | Inline success message naming the email |
| `reports` SELECT/UPDATE | Direct table | Load & resolve reports | RLS: select = reporter or admin; update = admin only | `LoadingState` | Toast + reload | Row status updates in place |
| `posts`/`jobs`/`events`/`businesses` SELECT/DELETE | Direct table | Moderation | RLS: admin-only delete policies (owners can also delete their own separately, elsewhere in the app) | `LoadingState` | Toast | Row removed from list |
| `businesses` UPDATE (`promoted`) | Direct table | Feature/unfeature | RLS: admin-only (or owner, per the wider app's own policy — not confirmed which applies here since the row could also belong to the admin) | none (instant toggle) | Optimistic rollback | Badge appears/disappears |
| `admin_actions` SELECT | Direct table | Load Activity Log | RLS: `is_admin()` select-only; insert/update/delete revoked from all client roles | `LoadingState` | Setup banner (schema-update-52 hint) | Read-only list |
| `merch_orders`/`merch_order_items` SELECT, `merch_orders` UPDATE | Direct table + Realtime subscription | Order fulfilment | RLS: buyer or admin can read; only admin (or buyer, pending-only, cancel-only) can update | `LoadingState` | `error` state text | Live-updates via Realtime, no manual refresh needed |
| `merch_products`/`merch_variants` SELECT/INSERT/UPDATE/DELETE | Direct table | Catalogue management | RLS: `for all` admin-only management policy; separate read policy for approved members (active items only) | `LoadingState` | Toast | List/form updates |
| `legends` SELECT/INSERT/UPDATE/DELETE | Direct table | Legends curation | RLS: admin has full read (including inactive) + full write; approved members read active-only | `LoadingState` | Toast / inline form error | List/form updates |
| Storage: `legend-photos`, `merch-images` buckets | Storage upload/getPublicUrl/remove | Photo uploads for Legends/Products | Insert/update/delete policies gated on `is_admin()`; public buckets so anyone can *read* the resulting URL | inline during save | inline form error, upload aborts the whole save | New public URL saved to the row |

**Authentication requirement for the whole page:** a valid Supabase session (the same one used for the rest of the app) — there's no separate admin login.
**Authorization requirement for the whole page:** `profiles.is_admin = true` on the signed-in user's own row, checked in exactly one client-side place (the `/admin` route element, Section 11) and independently re-checked by every RPC/RLS policy the page's actions touch.
**No secrets are ever sent to or exposed by the client** — the anon key and `VITE_SUPABASE_URL` are the only Supabase credentials in the bundle (both public by design, per the Handbook's own developer section); the service-role key used by the two Edge Functions never leaves the server.

---

## 11. Permissions and Security

**Who can access the `/admin` route:** only a signed-in user whose `profiles.is_admin` column is `true`. Enforced at the route level in `App.jsx`:
```
<Route path="/admin" element={profile?.is_admin ? <Admin session={session} /> : <Navigate to="/home" replace />} />
```
Anyone else hitting `/admin` directly (typed URL, bookmark, back button) is silently redirected to `/home` — there is no "access denied" page and no error message shown for this case.

**How admin access is determined:** a single boolean column, `profiles.is_admin`, readable by any authenticated user for their own row and settable only by another admin (or, for the very first admin, a one-time hardcoded SQL statement in `schema-update-8.sql` that grants it to `kyletrompeter0@gmail.com`).

**Nav-level gating:** the "Admin" sidebar item is appended to the nav array only when `profile.is_admin` is true, and is deliberately kept out of the base `TABS` array specifically so it can never flash into view for a regular member before the profile has finished loading (an inline code comment in `App.jsx`).

**Server-side enforcement (the real gate — the client-side checks above are UX only, not security):**
- `is_admin()` is a `security definer` SQL function (`select coalesce((select is_admin from profiles where id = auth.uid()), false)`), used as the `using`/`with check` clause on essentially every admin-only RLS policy in the schema.
- **Self-elevation is explicitly blocked**: the "Users can update own profile" RLS policy's `with check` clause requires that the incoming row's `approved` and `is_admin` values match what's already on that row — meaning a member cannot flip their own `is_admin` (or `approved`) via a raw PostgREST call, even though every other column on their own profile remains freely editable by them. This was a real, fixed vulnerability, documented in-line in `schema-update-39.sql` with the exact exploit that used to work.
- `admin_list_members()` independently re-checks `is_admin()` inside the function body and `raise exception 'Admins only'` if it fails, and additionally has execute permission **revoked from `anon`/`public`**, granted only to `authenticated` — so even an unauthenticated request can't call it at all, regardless of the internal check.
- `log_admin_action()` (the function every audit-trail trigger calls) has execute revoked from `public`, `anon`, **and** `authenticated` — it is only ever invoked by the security-definer trigger functions themselves, never directly callable by any client role. This specific detail is called out in a code comment as deliberate: without revoking from `public` explicitly (revoking from `authenticated`/`anon` alone is a no-op, since Postgres grants new functions to `PUBLIC` by default and those roles inherit it), any signed-in member could have forged arbitrary audit-log entries.
- `admin-delete-member` Edge Function (`supabase/functions/admin-delete-member/index.ts`) re-derives admin status from the **caller's own** JWT server-side — the `target_user_id` in the request body is never trusted to imply the caller's authority. It also independently refuses a self-targeted delete (`if (targetUserId === callerId) return 400 "You can't delete your own account here — use Settings instead"`), which is a second, server-side enforcement of the "Delete account is disabled on your own row" rule the UI already shows — not merely a UI courtesy.
- **The "last admin can't be demoted" rule from the Handbook IS enforced — by a database trigger.** `prevent_last_admin_demotion()` (`before update of is_admin on public.profiles`) raises a hard exception ("This is the only admin account — promote someone else before removing admin rights.") if an `UPDATE` would flip the sole remaining admin's `is_admin` to `false`. This trigger's own comment states admin *deletion* is "already covered" because the old `admin_delete_member()` RPC refused to delete the caller — but that reasoning does **not** fully carry over to the current code path: `admin-delete-member` (the Edge Function that replaced the RPC) does refuse a self-delete (see above), so a lone admin cannot delete themself **through the Admin page**. However, `delete-account` (the separate, self-service Edge Function that Settings → Delete account calls) has **no admin-count check of any kind** — a lone admin genuinely can lock the site out of all admin access by deleting their own account from Settings. **This is a real, currently-open gap**, not a documented decision — see Section 20.

**What happens if an unauthorized user attempts access:** redirected client-side (see above); any direct API/RPC call they might attempt independently fails at the RLS/RPC layer regardless of what the client UI shows.

**Role-based UI differences:** none beyond the single admin/non-admin split — there is no "read-only admin" or partial-permission tier anywhere in this codebase.

**Actions requiring elevated permissions beyond ordinary admin:** none — every admin has identical, full power, including the power to promote/demote other admins and delete any account (including, per the UI's own disabled-button logic, every account except their own).

---

## 12. All User Workflows

### Workflow: Approve a ready signup
1. Admin opens `/admin` (or is routed there via a "new signup" notification bell click).
2. Attention panel and Pending tab badge both show the outstanding count.
3. Admin clicks the Pending approval tab (or the panel's "Review them" shortcut).
4. Admin reviews the row's details (name, email, class year, location, DOB/occupation/industry/phone if present, membership-role badges if present).
5. Admin clicks Approve.
6. Client-side guard checks `consented_at` and `email_confirmed_at` are both set; if not, the button was already disabled with a tooltip explaining why.
7. Optimistic UI update flips the row's status immediately.
8. `UPDATE profiles SET approved=true` sent; RLS re-validates admin status.
9. On success, `send-approval-email` Edge Function is invoked (fire-and-forget).
10. A database trigger writes an `admin_actions` row.
11. If the email send failed, a `memberError` message says so without undoing the approval.
12. The member's next sign-in now passes the "not approved" gate in `App.jsx`.

### Workflow: Decline a signup
1. Admin clicks Decline on a pending row.
2. Modal opens with an optional reason field.
3. Admin optionally types a reason, clicks "Decline and email them" (or Cancel to abort with nothing saved).
4. `UPDATE profiles SET declined_at=now(), declined_reason=X`.
5. `send-member-email` (kind: declined) fires, mentioning the reason if given.
6. Row moves from the "waiting" groups into the "Declined" group, with a "Move back to pending" undo option.
7. Trigger logs `unapprove_member`... **note:** the code's own `ACTION_TEXT` map only distinguishes `approve_member`/`unapprove_member`, and the `log_profile_admin_change` trigger fires on any `approved` transition — declining someone (which does not touch `approved` at all, only `declined_at`/`declined_reason`) does **not** appear to fire that trigger at all based on the SQL read. **This means a decline may not be recorded in the Activity Log** — flagged as an open question in Section 20 rather than asserted as fact, since it rests on a negative (absence of a trigger on `declined_at`).

### Workflow: Resend a confirmation email
1. Admin opens Pending tab, sees the "haven't confirmed" group.
2. Solves the Turnstile challenge (if configured) once for the whole group.
3. Clicks "Resend confirmation" on a specific row.
4. `supabase.auth.resend()` fires with the captcha token attached.
5. Token is single-use; the widget resets for the next attempt regardless of outcome.
6. Success/failure message shown above the group.

### Workflow: Un-approve a member (pause access)
1. Members tab → click "Un-approve" on an approved, non-self row.
2. Confirm dialog explains the effect and reversibility.
3. `UPDATE profiles SET approved=false`.
4. Member's next page load in the app routes them to `PendingVerification.jsx` instead of the full app.
5. Trigger logs `unapprove_member` to the Activity Log.

### Workflow: Promote/demote an admin
1. Members tab → "Make admin"/"Remove admin" on a non-self row.
2. Confirm dialog states the exact power being granted/removed.
3. `UPDATE profiles SET is_admin`.
4. Target's nav bar gains/loses the Admin item on their next load (via `profile.is_admin` check in `App.jsx`); a `new_signup`-style notification path is unrelated here — no notification is sent to the promoted/demoted person about this change (not found in the code).
5. Trigger logs `grant_admin`/`revoke_admin`.

### Workflow: Permanently delete an account
1. Members tab → "Delete account" (disabled on own row).
2. Confirm dialog lists everything that will be removed, states no undo exists.
3. `admin-delete-member` Edge Function invoked with the target id.
4. Function verifies caller is an admin server-side, does storage cleanup, calls the Supabase Admin API to delete the `auth.users` row.
5. Cascading foreign keys remove every dependent row across the schema in one operation.
6. Client verifies the returned `deleted_user_id` matches before updating local state.
7. A `before delete` trigger on `profiles` logs `delete_member` to the Activity Log (only when the deleter isn't the deleted person).
8. Local `members` list filters the row out; `loadCounts()` re-fires to refresh the stat cards.

### Workflow: Resolve a report
1. Reports tab, "Needs review" section.
2. Admin clicks View to inspect the reported item on its real page, forms a judgement.
3. Returns to Admin, clicks Mark reviewed (if action was taken elsewhere, e.g. deleting the post) or Dismiss (if the report was unfounded).
4. `UPDATE reports SET status`.
5. Trigger logs `resolve_report`/`dismiss_report`, including the report's own reason text as the log's `details`.
6. `onCountChange` bubbles the new open-report count up, updating the stat card and tab badge live.
7. Row moves from "Needs review" to "Resolved" without a page reload.

### Workflow: Remove a piece of content (post/job/event/business)
1. Open the relevant tab, optionally search to find the item.
2. Click the trash-can Delete icon.
3. `ConfirmDialog` confirms, naming the specific consequence (e.g. "removes the event and everyone's RSVPs").
4. `DELETE FROM <table>`.
5. A `before delete` trigger checks ownership; if the admin isn't the owner, logs the deletion to the Activity Log.
6. Row disappears from the local list immediately (no reload needed, since the client already knows the delete succeeded).

### Workflow: Feature a business
1. Businesses tab, click Feature on a row.
2. No confirmation — optimistic toggle.
3. `UPDATE businesses SET promoted=true`.
4. A trigger logs `feature_business`.
5. The business now appears pinned at the top of the public Business Directory on its next load.

### Workflow: Fulfil a merch order
1. Merch & orders tab (defaults to Orders sub-view).
2. New orders appear live via Realtime as members check out.
3. Admin filters by status pill if needed, clicks a row to expand it.
4. Reviews items, buyer contact, and any buyer note.
5. Arranges payment with the buyer outside the system (there is no payment gateway).
6. Changes status via the dropdown as the order progresses (pending → confirmed → ready for pickup → collected), or cancels it.
7. Cancelling restores the reserved stock automatically via a database trigger.
8. Optionally types an internal note and clicks Save note (only appears once the text has changed).
9. A trigger logs the status change to the Activity Log (unless the buyer made the change themselves via self-service cancel).

### Workflow: Add or edit a merch product and its variants
1. Merch & orders tab → Products sub-view → Add product (or Edit an existing one).
2. Fill name/description/category/base price, optionally upload a photo.
3. Save — on a new product, the form stays open and now shows the Variants editor beneath it (using the newly assigned id).
4. Add one or more size/colour variants, each with its own stock and price adjustment.
5. Toggle Hide/Show on the product or any variant to control storefront visibility without deleting anything.
6. Close/Cancel returns to the product list, which reloads to reflect anything saved along the way.

### Workflow: Curate a Notable Old Boy (Legend)
1. Notable Old Boys tab → Add someone (or Edit an existing entry).
2. Fill name, category, years, degree, headline (required), story (optional), upload a required photo, optional read-more link.
3. Save — validates name/headline/photo presence client-side first.
4. New/updated entry appears in the admin list immediately (including if hidden) and, if `active`, becomes eligible for the public home page's rotating trio on its next load.
5. Use ↑/↓ to influence which trio of entries shows first once six or more exist.
6. Use Hide (not Delete) to pull a write-up without losing it, per the tab's own guidance text.

### Workflow: Read the Activity Log
1. Activity log tab.
2. Optionally filter by category (Members / Content removed / Reports / Everything).
3. Scan the reverse-chronological list of "{actor} {verb} {target}" sentences.
4. No action possible beyond reading — the tab exists purely for accountability lookups ("who approved this person?").

### Workflow: Read or hand over the Handbook
1. Handbook tab (or the intro paragraph's shortcut link).
2. Sections 1 and 6 are pre-expanded (the weekly routine, and the handover checklist) since those are the two most load-bearing for a first-time or outgoing admin.
3. Expand any other section as needed; nothing here writes to the database — it's pure documentation.

---

## 13. Document All States

**Normal state:** described throughout Sections 2–7 above per component.

**Loading state:** every tab that fetches its own data shows the shared `LoadingState` component (a spinning icon + a tab-specific message like "Loading pending signups…") while its first fetch is in flight. The Attention panel is the one exception — it renders nothing at all (not even a skeleton) while `loadingMembers` is true, so on a slow connection the whole top strip below the intro paragraph is simply blank until the member list resolves. Stat cards show an em-dash (`–`) per-card instead of a shared loading state for the four count-based cards specifically.

**Empty state:** every list-based tab uses the shared `EmptyState` component (a simple line-art icon + message + optional sub-message), with tab-specific copy. Two flavours exist per tab where relevant: a genuine "there is nothing here at all" state (e.g. "No one's waiting on approval") and a "your filter/search matched nothing" state (e.g. "No matching members" with a magnifying-glass icon) — these are two different copy strings/icons, not one generic message reused.

**Error state:** three distinct patterns coexist: (1) the "setup banner" heuristic (Section 2.6) for likely-migration-missing errors on the member list and Activity Log specifically; (2) a plain `<p className="form-error">` line for any other member-list error; (3) a transient `Toast` notification (green check / red alert icon, auto-dismissing after 3.2s for success, persisting until manually dismissed for errors) for every other tab's mutations (posts/jobs/events/businesses delete failures, legend/product/variant save failures, order update failures, etc.). Toasts are rendered via a React context (`ToastProvider`) that must wrap the app somewhere above `Admin.jsx` — not shown to fail gracefully if that provider is missing (falls back to a no-op function, per `useToast`'s own fallback, so a missing provider would silently swallow all toasts rather than crashing).

**Success state:** optimistic UI updates (no distinct "success" visual beyond the change itself sticking) for most mutations; explicit success toasts for Legend/Product/Variant saves and product deletion; an inline success message (not a toast) for the Resend-confirmation flow specifically.

**Disabled state:** buttons disable (with an explanatory `title` tooltip) in four situations: (1) an action targeting the signed-in admin's own row (Un-approve/demote/delete-self); (2) Approve, when the target hasn't finished signup or hasn't confirmed email; (3) any button on a row currently mid-mutation (`busyIds` tracking, label swaps to "Working…"/"Sending…"); (4) form submit buttons while `saving` is true.

**Permission-denied state:** handled entirely at the routing layer (Section 11) — a non-admin never sees any part of this page's UI at all, so there is no in-page "you don't have permission" message anywhere inside `Admin.jsx`, `MerchAdmin.jsx`, or `AdminHandbook.jsx`. The only place a permission failure could surface *within* the page is if an admin's own `is_admin` flag were revoked by someone else in the same browser session without a refresh — this scenario was not found handled anywhere (the page would keep functioning client-side until an RLS-gated write failed with a raw Postgres/RLS error, which would fall through to the generic error-line/toast handling rather than a dedicated message).

---

## 14. Responsive Behaviour

Only **one** admin-specific breakpoint was found in the CSS: `@media (max-width: 560px)`, applying four rules:
- `.admin-row` gets `flex-wrap: wrap`, so a row's info block and its action buttons can stack instead of being forced onto one cramped line.
- `.admin-row-actions` becomes full-width and left-justified (instead of right-justified) once wrapped, so buttons form a natural left-aligned row underneath the row's info.
- `.admin-attention li` (Attention panel items) switch from a horizontal `space-between` layout to a stacked column, so the action button drops below its text line rather than being squeezed beside it.
- `.admin-tabbar` switches from a horizontal row of tab-groups to a vertical stack, and the vertical hairline divider between groups becomes a horizontal one above each group (with matching top padding) instead of a left border.

**What was NOT found to have bespoke mobile handling:** the 8-card stat grid (relies entirely on its `auto-fit, minmax(100px, 1fr)` grid to reflow — no dedicated media query, it just wraps more rows as the viewport narrows); the Merch order accordion, product/variant forms, and Legend form (`.admin-legend-form { max-width: none }` is set at the 760px breakpoint, but that rule lives in the **Legends public-page** section of the CSS, not a dedicated admin breakpoint — it happens to also apply here since the class name is shared); the Handbook's section accordions and its services `<table>` (the table only gets a horizontal-scroll wrapper — `.hb-table-wrap { overflow-x: auto }` — with a hard `min-width: 520px` on the table itself, so on a narrow phone the table scrolls sideways rather than reflowing).

**Modals:** `ConfirmDialog` and the decline-reason modal rely entirely on the shared, page-wide `.modal`/`.modal-backdrop` CSS (not admin-specific) for their responsive behaviour — that shared styling was not read as part of this pass and should be checked separately if modal responsiveness on the admin page specifically needs to change.

**Overall assessment:** responsive behaviour here is intentionally light-touch — the admin page assumes a desktop-class viewport is the common case (its own audience, per the Handbook, is a committee member "at a laptop," not primarily a phone user), and the single 560px breakpoint exists mainly to keep row actions from being crushed rather than to substantially re-architect the layout for mobile.

---

## 15. Visual Design System

**Where the design system comes from:** entirely hand-rolled CSS custom properties in `src/styles.css` (11,162 lines, one file, no CSS-in-JS, no Tailwind, no component library). No third-party design system is used anywhere on this page.

**Core tokens** (defined once on `:root`, reused via `var(--x)` everywhere, including every `.admin-*`/`.hb-*` rule):
- Colour: `--orange: #6EC3E8` (SACS baby-blue, the site's *accent* — the variable name is a holdover from an earlier, differently-branded fork and is explicitly commented as such; do not assume "orange" means the colour orange anywhere in this codebase), `--orange-dark: #3E9DC9`, `--orange-soft: #E6F6FC`, `--maroon: #002F5F` (SACS navy, the *primary* colour, same historical-name caveat), `--maroon-dark: #001B37`, `--paper: #FAF7F2` (page background), `--card: #FFFFFF`, `--ink: #1A1A1A`, `--ink-soft: #5C5C5C`, `--line: #E8E1D5` (hairline borders), `--line-strong: #C9BFAE`, `--danger: #A33327`, `--ok: #2C6E49`.
- Radius scale: `--radius: 12px` (default — cards, buttons, most inputs), `--radius-xs: 4px`, `--radius-sm: 8px`, `--radius-lg: 20px`, `--radius-xl: 24px`, `--radius-pill: 999px` (chips/badges/pills).
- Spacing scale (4px-based): `--sp-1` (4px) through `--sp-8` (48px).
- Type scale (9 steps): `--fs-2xs` (10.5px, eyebrows/overlines) through `--fs-3xl` (30px, page titles); admin content mostly sits in the `--fs-xs`/`--fs-sm`/`--fs-base` range with `--fs-xl`/`--fs-2xl` reserved for section/hero headings.
- Fonts: `--display: Georgia, 'Times New Roman', serif` for every heading (page title, section `<h3>`, Handbook section titles, hero `<h3>`, stat values); `--body: 'Inter', sans-serif` for everything else.
- Shadows: `--shadow-card` (a soft double-shadow, used only on hover for stat cards and permanently on an *open* Handbook accordion section) and `--shadow-lift` (not used anywhere on this page in the code that was read).
- Easing: `--ease: cubic-bezier(0.22, 1, 0.36, 1)` — a single shared "settle" curve for every hover/transition on the page.

**The governing visual principle (per an explicit project-memory note and matching in-CSS comments): "editorial, not widget-heavy."** Concretely, on this page that means: no permanent drop shadows anywhere except an *open* Handbook accordion section — every card (stat cards, the Attention panel) is flat with a hairline border at rest, and only gains a shadow + a 1px lift on hover/focus; list rows (`.admin-row`, used identically across all 9 row-based tabs) are separated by a hairline `border-bottom`, not individually boxed; a 3px coloured accent bar (not a filled colour panel) is the device used both for the Attention panel's urgency signal and for the setup/warning banners' visual weight; pill shapes (`--radius-pill`) are reserved for genuine chip/badge/tag uses (status badges, filter chips, the active-tab pill, the numeric sub-tab badges) and are deliberately *not* used for ordinary buttons, which stay rounded-rectangle (`--radius`).

**Status colour vocabulary**, used consistently across badges, activity-log dots, and order-status chips: green (`--ok`) = good/approved/collected; accent-blue (`--orange`/`--orange-dark`/`--orange-soft`) = pending/warn/needs-attention; navy (`--maroon`) = admin/primary emphasis; red (`--danger`) = bad/destructive/cancelled.

**Icons:** all hand-drawn inline SVGs (line-art style, `currentColor` stroke, no icon font/library) — the trash-can on `DeleteButton`, the check/error icons on `Toast`, the five `EmptyState` illustrations, and the `AdminIcon` shield-with-checkmark used in the sidebar nav.

**Design history note (relevant if asked to change any of this further):** the Admin page's current flat/editorial look is a **2026-09-06 redesign** that reused the Home page's just-established "editorial" system verbatim — no new tokens, colours, or fonts were introduced for it. The redesign's key insight (recorded in project memory) was that every admin sub-tab already shared one CSS class system (`.admin-list`/`.admin-row`/`.admin-badge`), so flattening those shared classes once in `styles.css` cascaded the new look across all 11 tabs with almost no JSX changes — only the shell (stat cards, Attention panel, tab strip, section headers) needed markup edits. Any future visual pass on this page should look for the same leverage point before touching per-tab JSX.

---

## 16. Component Architecture

```
Admin.jsx (default export: Admin) — one 1955-line file, page-level state
├── AttentionPanel                          — "does anything need me?" strip
├── StatCard × 8                            — clickable count tiles
├── (tab strip — inline JSX, not a component) — 11 buttons in 4 groups, from the SUBTABS array
├── (section head — inline JSX)             — eyebrow + h3 + help text, from SUBTABS
├── (setup banner / error line — inline JSX)
├── PendingList                             — subtab === 'pending'
│   └── PendingRows                         — one <ul> per group (ready/unconfirmed/unfinished)
│   └── (decline modal — inline JSX in PendingList)
│   └── Turnstile (imported)                — captcha widget
├── ReportsModeration                       — subtab === 'reports'
│   └── ReportList                          — rendered twice (open, resolved)
├── MembersTable                            — subtab === 'members'
│   └── ConfirmDialog (imported, shared)
├── PostsModeration                         — subtab === 'posts'
│   └── DeleteButton (imported, shared) → ConfirmDialog
├── JobsModeration                          — subtab === 'jobs'
│   └── DeleteButton
├── EventsModeration                        — subtab === 'events'
│   └── DeleteButton
├── BusinessesModeration                    — subtab === 'businesses'
│   └── DeleteButton
├── MerchAdmin.jsx (imported, own file)     — subtab === 'merch'
│   ├── MerchOrdersAdmin
│   │   └── OrderDetail                     — the expanded accordion body
│   └── MerchProductsAdmin
│       ├── ProductForm
│       │   └── VariantsEditor
│       │       └── VariantForm
│       └── DeleteButton
├── LegendsAdmin                            — subtab === 'legends'
│   ├── LegendForm
│   └── DeleteButton
├── ActivityLog                             — subtab === 'activity'
└── AdminHandbook.jsx (imported, own file)  — subtab === 'handbook'
    ├── Section × 8                          — collapsible accordion
    └── Callout                              — coloured note box, used inside Sections
```

**Shared components pulled in from elsewhere in the app** (not admin-specific, used by other pages too — treat changes to these as changes to the *whole app*, not just Admin): `EmptyState.jsx`, `LoadingState.jsx`, `DeleteButton.jsx`, `ConfirmDialog.jsx`, `Toast.jsx` (`ToastProvider`/`useToast`), `Avatar` (exported from `Directory.jsx`), `Turnstile.jsx`, `useModal.js` (used internally by `ConfirmDialog`).

**Props of note:**
- `Admin` receives one prop: `session` (the Supabase auth session object), used only for `session.user.id` (to identify "your own row" for the self-action guards) and passed straight through to `MerchAdmin`/`LegendsAdmin` for their own `created_by` stamps on inserts.
- `MerchAdmin` receives `session` and passes it straight to `MerchProductsAdmin` → `ProductForm` (used only at insert time, for `created_by`).
- Nearly every tab component takes **no props at all** — they call `supabase` directly and manage their own state, which is why switching tabs always re-fetches (Section 8): there is no lifted shared cache being passed down.

**What renders `Admin`:** `App.jsx`'s router, at the `/admin` path, conditionally on `profile?.is_admin` (Section 11), lazy-loaded (`const Admin = lazy(() => import('./components/Admin.jsx'))`) so its code (and, transitively, `MerchAdmin.jsx`/`AdminHandbook.jsx`, since they're statically imported *by* `Admin.jsx` rather than separately lazy-loaded) is only downloaded the first time a signed-in admin actually navigates there.

---

## 17. Important Code Locations

| Functionality | File | Component/Function |
|---|---|---|
| Admin page shell, tab strip, stat cards, Attention panel | `src/components/Admin.jsx` | `Admin` (default export), `AttentionPanel`, `StatCard` |
| Tab metadata (labels, groups, help text) — **the single place to edit any tab's blurb** | `src/components/Admin.jsx`, top of file | `SUBTABS` array, `TAB_GROUPS` array |
| Pending approvals UI | `src/components/Admin.jsx` | `PendingList`, `PendingRows`, `MEMBERSHIP_ROLE_LABELS` |
| Members table | `src/components/Admin.jsx` | `MembersTable` |
| Reports moderation | `src/components/Admin.jsx` | `ReportsModeration`, `ReportList`, `REPORT_ENTITY_LABELS`, `REPORT_ENTITY_PATH`, `REPORT_REASON_LABELS` |
| Posts/Jobs/Events/Businesses moderation | `src/components/Admin.jsx` | `PostsModeration`, `JobsModeration`, `EventsModeration`, `BusinessesModeration` |
| Activity log UI + label map | `src/components/Admin.jsx` | `ActivityLog`, `ACTION_TEXT`, `ACTIVITY_FILTERS` |
| Legends curation UI | `src/components/Admin.jsx` | `LegendsAdmin`, `LegendForm`, `EMPTY_LEGEND` |
| Merch shop admin (orders + products + variants) | `src/components/MerchAdmin.jsx` | `MerchAdmin`, `MerchOrdersAdmin`, `OrderDetail`, `MerchProductsAdmin`, `ProductForm`, `VariantsEditor`, `VariantForm` |
| In-app operating manual | `src/components/AdminHandbook.jsx` | `AdminHandbook`, `Section`, `Callout` |
| Route gating for `/admin` | `src/App.jsx` | the `<Route path="/admin" .../>` element, `ADMIN_TAB` constant |
| Admin nav item, sidebar icon | `src/App.jsx` | `ADMIN_TAB`, `AdminIcon()` |
| Self-service vs. admin account deletion (client wrappers) | `src/supabaseClient.js` | `deleteOwnAccount()`, `adminDeleteAccount()` |
| Admin-initiated account deletion (server-side, self-delete refusal, direct activity-log write) | `supabase/functions/admin-delete-member/index.ts` | the Deno request handler |
| Self-service account deletion (server-side, **no admin-count check**) | `supabase/functions/delete-account/index.ts` | the Deno request handler |
| Shared storage-purge-then-delete logic + CORS allowlist | `supabase/functions/_shared/accountCleanup.ts` | `OWNED_BUCKETS`, `purgeBucket()`, `purgeAndDeleteUser()` |
| Server-enforced "can't demote the last admin" rule | `schema-update-46.sql` (or `-47`/`-49`/`-50` — the trigger reappears with `create or replace` across a few consecutive migrations; the version in `schema-all.sql` around line 3930 is current) | `prevent_last_admin_demotion()`, trigger `on_admin_demotion` |
| Storage cleanup helper | `src/supabaseClient.js` | `deleteStorageFilesFromUrls()`, `storagePathFromUrl()` |
| Delete confirmation UI (shared) | `src/components/DeleteButton.jsx`, `src/components/ConfirmDialog.jsx` | — |
| Toast notifications (shared) | `src/components/Toast.jsx` | `ToastProvider`, `useToast` |
| Empty/Loading state UI (shared) | `src/components/EmptyState.jsx`, `src/components/LoadingState.jsx` | — |
| `is_admin()` helper + first-admin bootstrap | `schema-update-8.sql` (superseded definition also present verbatim in `schema-all.sql` around line 630) | `public.is_admin()` |
| Self-elevation prevention | `schema-update-39.sql` | the "Users can update own profile" RLS policy |
| `admin_list_members()` RPC — **current/last version** | `schema-update-57.sql` (same text repeated in `schema-all.sql` ~line 6383) | `public.admin_list_members()` |
| Activity log table + shared writer | `schema-update-52.sql` (repeated in `schema-all.sql` ~line 4928) | `admin_actions` table, `log_admin_action()` |
| Per-domain audit triggers (members/posts/jobs/events/businesses/reports) | `schema-update-52.sql` | `log_profile_admin_change`, `log_member_deletion`, `log_post_moderation`, `log_job_moderation`, `log_event_moderation`, `log_business_moderation`, `log_business_promotion`, `log_report_decision` |
| Merch schema (products/variants/orders/order items), order RPC, stock-restore trigger, merch audit triggers | `schema-update-59.sql` | `merch_products`, `merch_variants`, `merch_orders`, `merch_order_items`, `place_merch_order()`, `restore_stock_on_merch_cancel()`, `log_merch_product_delete()`, `log_merch_order_status_change()` |
| Legends schema + RLS | `schema-update-54.sql` (repeated in `schema-all.sql` ~line 5313) | `legends` table |
| Admin notification on new signup | `schema-update-46.sql` | `notify_admins_new_signup()` |
| Admin-only styling (all `.admin-*`/`.hb-*` rules) | `src/styles.css`, lines ~7383–7960 (core admin), ~10862–10960 and ~11109–11157 (merch/legend-form specifics) | — |
| Design tokens (colours/spacing/type/radius/shadow) | `src/styles.css`, lines 1–70 | `:root` block |

---

## 18. Dependency Map

**Shared components this page depends on** (changing these affects other pages too — see Section 21 for specific caution): `EmptyState.jsx`, `LoadingState.jsx`, `DeleteButton.jsx`, `ConfirmDialog.jsx` (and its own dependency, `useModal.js`), `Toast.jsx`, `Avatar` from `Directory.jsx`, `Turnstile.jsx`.

**Shared data/constants imported from other feature files**, meaning a change made *for* Admin's sake in these files can silently affect the public-facing pages that own them:
- `LEGEND_CATEGORIES` — imported from `Legends.jsx` (the public Legends feature owns this constant; Admin only reads it for the category `<select>`).
- `MERCH_CATEGORIES` — imported from `Shop.jsx` (same relationship: the public shop owns the category list).
- `ORDER_STATUS_LABELS` — imported from `MyOrders.jsx` (the member-facing "my orders" page owns the human-readable status labels; Admin reuses them verbatim so the two surfaces never disagree on wording).
- `formatZAR` — imported from `utils.js` (shared currency formatter, used app-wide).
- `authRedirectTo` / `friendlyAuthError` — imported from `authRedirect.js`/`authErrors.js`, the same helpers the sign-up/sign-in flow uses.

**Backend objects shared with the rest of the app** (a change here has a blast radius beyond this page): `is_admin()` and `is_approved()` are the two functions "nearly every policy leans on" per the Handbook's own developer notes — used far outside the admin page's own tables. The `profiles`, `posts`, `jobs`, `events`, `businesses`, `reports` tables are all read/written by their own public-facing pages as well as by this admin page. The `merch_products`/`merch_variants` tables are read by the public `Shop.jsx`/`ShopProduct.jsx`. The `legends` table is read by the public `Home.jsx` (via `LegendsBand`), `LegendsHall.jsx`, and `LegendProfile.jsx`.

**Storage buckets shared with other features:** `legend-photos` and `merch-images` are admin-write-only, but both are **public-read** buckets, meaning their contents are directly linked to from public pages.

**Realtime:** the `merch_orders` table's Realtime publication (`supabase_realtime`) is also presumably relied on by the member-facing order confirmation flow, if one exists (not confirmed — this pass only read the admin side of merch orders).

---

## 19. Important Relationships and Hidden Behaviour

- **The "Pending" stat card, its badge, and the Attention panel's "waiting to be approved" count all mean different, overlapping-but-not-identical things.** The stat card counts *everyone* not yet approved and not declined (`pending.length`). The sub-tab badge and the Attention panel's first item both count only the *actionable* subset (`readyToApprove` — consented **and** email-confirmed). Someone who signed up but never confirmed their email inflates the stat card's "Pending" number but does **not** inflate the tab badge or trigger the Attention panel's top item — they instead trigger a *separate* Attention item ("N people never confirmed their email").
- **The "Posts"/"Jobs"/"Events"/"Businesses"/"Merch orders" stat cards go stale after a delete.** Deleting a post inside the Posts tab updates that tab's own local list instantly, but the parent `Admin` component's `counts` state (which the stat card reads) is only ever populated once, on the page's initial mount — nothing re-fires `loadCounts()` afterward. The count only becomes accurate again after a full remount of the `Admin` component (e.g., navigating away and back). This is a genuine, observable discrepancy, not a display quirk of this document.
- **Pending-row fields that may never actually render.** `PendingRows` reads `m.title`, `m.date_of_birth`, `m.industry`, `m.occupation`, `m.phone`, and five membership-role booleans (`old_boy`, `current_parent`, `past_parent`, `current_staff`, `past_staff`) off each member object. The `admin_list_members()` RPC definition found in the schema files (`schema-update-57.sql`, matching what's in `schema-all.sql`) returns only: `id, email, email_confirmed_at, full_name, first_name, preferred_name, last_name, grad_year, city, country, approved, is_admin, created_at, consented_at, declined_at, declined_reason`. It does **not** return `title`, `date_of_birth`, `industry`, `occupation`, `phone`, or any membership-role column — even though `occupation`, `industry`, and `phone` do exist as real columns on `profiles`, and `date_of_birth` exists on a separate `profile_details` table (added in `schema-update-61.sql`). **This is flagged, not asserted as a confirmed bug**: either (a) the live Supabase database has a newer, hand-applied version of `admin_list_members()` that was never saved back into a numbered `schema-update-*.sql` file, or (b) this UI code is currently displaying conditions that are always false/undefined for every member (the "Born…/occupation/industry/phone" line never appears, the role badges never appear, and `m.title` is always blank). **Whoever picks this up next should check the live function definition in the Supabase dashboard before changing anything here** — do not assume either possibility without checking.
- **A decline may not be written to the Activity Log.** The `log_profile_admin_change` trigger fires `after update of approved, is_admin` — i.e. only when one of those two specific columns changes. `declineMember()` in `Admin.jsx` updates `declined_at`/`declined_reason` but explicitly does **not** touch `approved` (it was already `false`). No other trigger targeting `declined_at` was found in the schema files read. If this holds on the live database, declining someone leaves no Activity Log trace — flagged as an open question (Section 12's Decline workflow) rather than a confirmed fact, since it rests on the *absence* of a trigger.
- **"Last admin can't be removed" is a real, enforced rule for demotion — but has a genuine hole for self-deletion via Settings.** A database trigger (`prevent_last_admin_demotion`) blocks the last admin from being demoted, and the `admin-delete-member` Edge Function blocks a self-targeted delete from the Admin page. But `delete-account` — the separate, self-service Edge Function that `Settings.jsx` calls — has no admin-count check at all: a lone remaining admin can delete their own account from their own Settings page and permanently lock everyone else out of the admin tools. The Attention panel's "you're the only admin" nudge is the only mitigation in the product today, and it's purely informational.
- **A business's Feature/Unfeature toggle has no confirmation dialog**, unlike almost every other consequential admin action, because it's genuinely, fully reversible with no side effects (it's exactly the exception the "when to skip a confirm dialog" pattern is built around elsewhere in the app).
- **The Turnstile captcha on the Pending tab exists for a non-obvious reason**: it's not protecting the admin page itself from bots — it's satisfying Supabase's own public `/resend` auth endpoint's captcha requirement, which applies identically whether an admin or the actual signee triggers it. If `VITE_TURNSTILE_SITE_KEY` isn't configured, the widget and the check are both skipped entirely (`if (TURNSTILE_SITE_KEY && !captchaToken)`), meaning resend confirmation works with no captcha at all in an environment without Turnstile configured.
- **The Activity Log's `ACTION_TEXT` verb map is missing two known trigger-emitted action types.** `schema-update-59.sql`'s merch triggers write `delete_merch_product` and `update_merch_order_status` action strings, neither of which appears in `Admin.jsx`'s `ACTION_TEXT` object. The `ActivityLog` component's fallback (`a.action.replace(/_/g, ' ')`) still renders a readable-enough sentence ("an admin delete merch product something"), but these two action types won't get the polished, hand-written verb phrasing every other action type gets, and won't match any of the four `ACTIVITY_FILTERS` categories cleanly either (they'd fall into "Everything" only, since `target_type` for these is `'merch_product'`/`'merch_order'`, not `'member'`/matching the `content`/`reports` filter predicates).
- **Deleting a merch product does not warn about affecting past orders because it doesn't need to** — `merch_order_items` snapshots `product_name`/`variant_label`/`unit_price` at time of purchase rather than foreign-keying live pricing, so a deleted or edited product never changes how a historical order reads. This is stated explicitly in both the UI copy and a schema comment.
- **`ConfirmDialog` is portaled to `document.body`, not rendered in place**, specifically because `DeleteButton` frequently sits inside a hoverable card that applies a CSS `transform` (which creates a new containing block for `position: fixed` descendants) — without the portal, the dialog would render squashed/misplaced relative to whatever row was hovered when it opened.
- **Legend reordering rewrites every row's `sort_order`, not just the two being swapped**, because rows created before the feature had drag/reordering all default to `sort_order = 0`, making a two-row swap alone insufficient to establish a stable, gap-free order.

---

## 20. Potentially Dangerous Areas — "Things an AI Must Be Careful About When Modifying This Page"

- **`.admin-list` / `.admin-row` / `.admin-badge` are shared across all nine row-based tabs.** A CSS change to any of these three classes cascades to Members, Pending, Reports, Posts, Jobs, Events, Businesses, Merch orders, and Legends simultaneously (this is exactly the leverage the 2026-09-06 redesign relied on — see Section 15 — but it cuts both ways: an unintended change here is nine tabs' worth of blast radius, not one).
- **`EmptyState.jsx`, `LoadingState.jsx`, `DeleteButton.jsx`, `ConfirmDialog.jsx`, `Toast.jsx`, and `Avatar` (from `Directory.jsx`) are used by pages far outside Admin.** Treat any prop-signature or behavioural change to these as an app-wide change requiring a check of every other call site, not an Admin-only tweak.
- **`LEGEND_CATEGORIES`, `MERCH_CATEGORIES`, and `ORDER_STATUS_LABELS` are owned by other feature files** (`Legends.jsx`, `Shop.jsx`, `MyOrders.jsx` respectively) and merely imported here. Editing the admin-side category `<select>` options means editing someone else's file, and doing so changes the public-facing feature too.
- **RLS is the real security boundary, not the React code.** Every client-side guard in `Admin.jsx` (disabled buttons, the `consented_at`/`email_confirmed_at` checks before Approve, the self-action blocks) is a UX nicety layered on top of database policies that enforce the same rules independently. Removing or "simplifying" a client-side check without checking whether the matching RLS policy still exists (or vice versa) can silently reopen a gap that was deliberately closed — the self-elevation-prevention policy in `schema-update-39.sql` exists precisely because an earlier version of this exact pattern was exploitable.
- **`log_admin_action()` and every trigger that calls it are the entire trust basis of the Activity Log.** They run as `security definer` and have `execute` revoked from every client-facing role. Any refactor that turns audit-log writes into a client-side `supabase.from('admin_actions').insert(...)` call would defeat the entire point of the feature (a client-forgeable/skippable log) — this must stay trigger-driven.
- **`admin-delete-member` and `admin_delete_member()` (the RPC) are not interchangeable — the RPC is explicitly superseded/dead.** The current code path is exclusively the Edge Function; a naive "just call the RPC, it's simpler" change would resurrect a documented bug (no storage cleanup, and a raw `delete from auth.users` that Supabase can silently no-op).
- **The two admin-only Edge Functions (`delete-account`'s admin counterpart, `admin-delete-member`) must independently re-verify `is_admin()` server-side.** Never trust a `target_user_id` passed from the client as proof the caller has authority over it — this is precisely why `delete-account` (self) and `admin-delete-member` (admin) are kept as two separate functions rather than one function with a conditional target, per the code's own reasoning (an undeployed new version of a merged function would silently ignore the extra parameter and delete the wrong account).
- **`ConfirmDialog`'s portal-to-`document.body` and its `data-autofocus` placement on Cancel (not Confirm) are both deliberate, tested-against-real-bugs decisions**, not arbitrary styling choices — see Section 19's explanation. Don't "simplify" by rendering it inline or moving default focus to Confirm.
- **The Legend reorder logic's N-parallel-`UPDATE`s-instead-of-one-upsert pattern is deliberate**, working around a specific Postgres `NOT NULL` constraint-checking-order quirk with partial upsert payloads — replacing it with a single batched upsert call without re-reading that comment risks reintroducing the exact bug it was written to avoid.
- **`storagePathFromUrl` / `deleteStorageFilesFromUrls` are shared utilities used by every feature that uploads to Supabase Storage, not admin-specific.** They're called from the admin page for Legend photos and merch product images, but changing their URL-parsing logic affects every other upload flow in the app (avatars, business logos, job attachments, post images).
- **Every Attention-panel/stat-card count is derived, not stored — but `counts` specifically is stale-by-design (Section 19).** Before "fixing" the stale-stat-card behaviour, confirm whether that's actually wanted; it may be an intentional simplification (avoid a refetch on every single content delete) rather than an oversight, though the code contains no comment either way.
- **The `admin_list_members()` field mismatch (Section 19) should be resolved by checking the live database, not by guessing.** Don't add UI for `date_of_birth`/`industry`/`occupation`/`phone`/membership-role fields assuming the RPC already returns them (it may not, per the schema files read), and don't remove the UI code assuming it's simply dead (the live RPC may have been updated out-of-band).
- **The self-service `delete-account` Edge Function has no last-admin protection, unlike every other admin-removal path on this page.** If this gap is ever closed, the fix belongs in `supabase/functions/delete-account/index.ts` (check the caller's own admin count before deleting, the same way `prevent_last_admin_demotion()` does at the database layer) — not in the Admin page's React code, since Settings/Profile call `delete-account` directly and never go anywhere near `Admin.jsx`.

---

## 21. What Is Visual vs. Functional vs. Data

**Visual-only (safe to change without touching behaviour):** every token in Section 15 (colours, radii, spacing, type scale, shadows, easing); the flat-card/hairline-row "editorial" treatment itself; icon artwork (trash can, toast check/error, empty-state illustrations, the admin shield icon); the eyebrow/section-header pattern; badge/pill colour-to-status mapping (as long as the status *values* themselves aren't renamed); the Handbook's accordion open/closed defaults; which stat cards get the `.highlight` treatment (currently hardcoded to Pending and Open reports, could be changed purely visually).

**Functional (changes app behaviour but not stored data):** which tab is active (`subtab` state, not persisted anywhere); search/filter state on every list; which order/legend/product is expanded or being edited; the 100/100/100/200/300 row-load caps on Posts/Jobs/Events/Businesses/Activity-log respectively (raising these is a functional change with a real performance/payload-size tradeoff, not a cosmetic one); whether the Turnstile captcha is required (driven by an env var, not by anything in this page's own code); disabled-button conditions (self-action guards, busy-state guards).

**Data (touches the database, storage, or auth):** every mutation documented in Section 4 without exception — approvals, declines, promotions, deletions, report status changes, content deletions, business featuring, merch order status/notes, product/variant/legend create-edit-delete, and every storage upload/delete. Also data-layer, even though it looks like a UI action: the fire-and-forget approval/decline emails (Edge Function invocations) and the Turnstile-gated confirmation resend (a real Supabase Auth API call) — neither is a purely local UI event even though neither blocks the UI while in flight.

---

## 22. Change Map — "If I want to change X, where should I look?"

| If I want to change... | Look here |
|---|---|
| Any tab's label, group, or one-line explainer | `Admin.jsx` → `SUBTABS` array (top of file) |
| The order of the four tab groups | `Admin.jsx` → `TAB_GROUPS` array |
| Which stat cards exist, or their hint text | `Admin.jsx` → the `.admin-stats-row` JSX block and `COUNT_TABLES` array |
| The Attention panel's rules/wording | `Admin.jsx` → `AttentionPanel` function |
| Stat card / row / badge appearance (all 9 tabs at once) | `src/styles.css` → `.admin-stat-*`, `.admin-list`, `.admin-row*`, `.admin-badge*` rules (~7383–7530) |
| Page-wide colours/spacing/type | `src/styles.css` → `:root` block, lines 1–70 |
| Pending-approval grouping logic or copy | `Admin.jsx` → `PendingList`, `PendingRows` |
| What counts as "ready to approve" | `Admin.jsx` → the `readyToApprove`/`unconfirmedCount`/`unfinished` `useMemo`s inside `Admin` |
| Member filter chips | `Admin.jsx` → `MEMBER_FILTERS` array inside `MembersTable` |
| Report reasons/entity labels/routing | `Admin.jsx` → `REPORT_ENTITY_LABELS`, `REPORT_ENTITY_PATH`, `REPORT_REASON_LABELS` |
| Activity Log verb phrasing or filters | `Admin.jsx` → `ACTION_TEXT`, `ACTIVITY_FILTERS` (**remember to add entries here for `delete_merch_product`/`update_merch_order_status` if fixing Section 19's gap**) |
| Row caps on Posts/Jobs/Events/Businesses | `Admin.jsx` → each moderation component's `.limit(N)` in its `load()` function |
| Legend categories | `src/components/Legends.jsx` → `LEGEND_CATEGORIES` (not in Admin.jsx — imported) |
| Legend form fields/validation | `Admin.jsx` → `LegendForm`, `EMPTY_LEGEND` |
| Merch categories | `src/components/Shop.jsx` → `MERCH_CATEGORIES` (imported into `MerchAdmin.jsx`) |
| Merch order status values/labels | `src/components/MyOrders.jsx` → `ORDER_STATUS_LABELS`; `MerchAdmin.jsx` → `STATUS_FLOW` array |
| Merch product/variant forms | `MerchAdmin.jsx` → `ProductForm`, `VariantForm`, `VariantsEditor` |
| Handbook content | `AdminHandbook.jsx` → the relevant numbered `<Section>` |
| Handbook accordion look | `src/styles.css` → `.hb-*` rules (~7747–7960) |
| Who can access `/admin` | `App.jsx` → the `/admin` `<Route>` element, and `profiles.is_admin` |
| Server-side admin authorization | `schema-update-8.sql`/`schema-update-39.sql` and every `using (public.is_admin())` policy across `schema-all.sql` |
| The audit trail / what gets logged | `schema-update-52.sql` (member/content/report triggers), `schema-update-59.sql` (merch triggers) |
| Account deletion behaviour (admin path) | `supabase/functions/admin-delete-member/index.ts` + `adminDeleteAccount()` in `supabaseClient.js` |
| Account deletion behaviour (self-service path, the one with no last-admin check) | `supabase/functions/delete-account/index.ts` + `deleteOwnAccount()` in `supabaseClient.js` |
| The last-admin-demotion floor | `schema-all.sql` (~line 3930), `prevent_last_admin_demotion()` |
| Storage cleanup on delete | `supabaseClient.js` → `deleteStorageFilesFromUrls`, `storagePathFromUrl` |
| Confirmation-dialog behaviour/wording for a specific action | The call site in `Admin.jsx`/`MerchAdmin.jsx` (each passes its own `title`/`message`/`confirmLabel` into the shared `ConfirmDialog`/`DeleteButton`) |
| Toast timing/styling | `Toast.jsx` |
| Mobile layout at ≤560px | `src/styles.css` → the single `@media (max-width: 560px)` block inside the admin section |
| Turnstile requirement | Environment variable `VITE_TURNSTILE_SITE_KEY` (not in this page's own code) |

---

# CRYSTAL CLEAR MENTAL MODEL

**1. What is this page?** `/admin` in the SACS Alumni Hub React SPA — a single-page control panel (`src/components/Admin.jsx`, plus `MerchAdmin.jsx` and `AdminHandbook.jsx`) with eleven sub-tabs, gated entirely by a `profiles.is_admin` boolean.

**2. What is its purpose?** Let a non-technical committee volunteer run the entire site — gatekeeping (who gets in), moderation (what stays up), commerce (the merch shop), curation (the Legends feature), and accountability (an immutable log of it all) — without ever opening the Supabase dashboard.

**3. What can an admin do here?** Approve/decline/un-approve members; promote/demote other admins; permanently delete accounts; resolve member reports; delete any post/job/event/business; feature businesses; manage merch products, variants, and fulfil orders; curate the Notable Old Boys feature; read a read-only audit log; read an in-app operating manual.

**4. What does every major section do?** An Attention strip surfaces outstanding work at a glance; eight stat cards are both a dashboard and shortcut navigation; a four-group, eleven-tab strip is the actual navigation; a section header explains whatever tab is open in one sentence; and the tab body itself is one of eleven independent, self-fetching components.

**5. How does the UI work?** Almost everything is a flat list of rows (`.admin-list`/`.admin-row`, shared across nine of the eleven tabs) with per-row action buttons; destructive actions always go through a shared `ConfirmDialog`; forms swap in as full view replacements rather than modals (Legend/Product/Variant editing); the only genuine popups are the confirm dialog and one bespoke decline-reason modal; the only live-updating list on the page is Merch Orders (Supabase Realtime).

**6. How does the state work?** `Admin.jsx` owns page-level state (`subtab`, `members`, `counts`, `openReportsCount`, `busyIds`) shared across the shell (Attention panel, stat cards, tab strip); every individual tab component owns its own local `items`/`loading`/`search`/`error` state and re-fetches from scratch every time it mounts (switching tabs away and back is always a fresh network round-trip, nothing is cached between visits).

**7. How does the data flow?** Client (Supabase JS, anon key + RLS) → direct table reads/writes for almost everything, plus two security-definer RPCs (`admin_list_members()`, `place_merch_order()` — the latter used by the *public* checkout flow, not the admin page) and two Edge Functions (`delete-account`/`admin-delete-member`, service-role key, server-side `is_admin()` re-check) for the two operations too sensitive or too complex to trust to a raw RLS-gated client write. Every consequential admin action independently triggers a database-side write to `admin_actions` (the audit log) that the client code never touches directly.

**8. How do the API/database interactions work?** Row Level Security, driven by a single `is_admin()` SQL function, is the actual enforcement layer everywhere — the React code's disabled buttons and inline guards are UX conveniences layered on top, not the security boundary. Self-elevation (a member granting themselves `is_admin`) is explicitly blocked by a `with check` clause on the profile-update policy. The audit log can only ever be written by security-definer triggers, never by a direct client insert, which is what makes it trustworthy.

**9. What are the major user workflows?** Approve/decline a pending signup; un-approve, promote/demote, or delete a member; resolve a report; delete a piece of moderated content; feature a business; fulfil a merch order; manage merch products/variants; add/edit/reorder a Legend entry; read the activity log; read the handbook. All are walked through step-by-step in Section 12.

**10. What are the important edge cases?** A member who signed up via Google but never finished the details form (no `consented_at`) is unactionable except by email nudge. A member who finished signup but never confirmed their email cannot be usefully approved (blocked both client-side and by RLS) — only resent a confirmation link. Cancelling a merch order restores its reserved stock automatically. Deleting a merch product doesn't corrupt past orders (they snapshot their own data). Several stat-card counts (Posts/Jobs/Events/Businesses/Merch-orders) go stale after a delete until the whole page remounts — a known, documented discrepancy, not a display bug in this write-up. Several member fields the Pending-row UI reads (title, date of birth, industry, occupation, phone, membership-role flags) may not actually be returned by the current `admin_list_members()` RPC per the schema files found — verify against the live database before relying on or "fixing" this. A decline may not be recorded in the Activity Log, because the logging trigger only watches the `approved`/`is_admin` columns, not `declined_at`. A lone remaining admin cannot demote themselves (blocked by a DB trigger) and cannot delete themselves from the Admin page (blocked by the `admin-delete-member` Edge Function) — but **can** still delete their own account from Settings (`delete-account`, a different Edge Function with no such check), which would lock the site out of admin access entirely.

**11. What files control each part?** See Section 17 (Where Things Live) and Section 22 (Change Map) in full — the short version: page shell and ten of eleven tabs live in `Admin.jsx`; the merch shop lives in `MerchAdmin.jsx`; the manual lives in `AdminHandbook.jsx`; routing/nav gating lives in `App.jsx`; account-deletion plumbing lives in `supabaseClient.js`; every piece of server-side enforcement lives across `schema-update-8/39/45/46/52/54/57/59/61.sql` (and their consolidated copy in `schema-all.sql`); all visual styling lives in one `styles.css` file, admin-specific rules concentrated around lines 7383–7960 plus a few merch/legend-form rules near the end of the file.

**12. What must someone be careful about when changing it?** Section 21 has the full list; the two highest-leverage (and highest-risk) facts to hold in mind are that (a) `.admin-list`/`.admin-row`/`.admin-badge` are one shared CSS system feeding nine different tabs at once, so a "small" style tweak there is never actually small, and (b) every permission check visible in the React code is a courtesy — the database's RLS policies and security-definer functions are the real gate, and any change to one side without checking the other risks either breaking a legitimate action or reopening a previously-fixed security hole (the self-elevation exploit that `schema-update-39.sql` exists specifically to close is the canonical example of what "the other side" getting out of sync used to cost).
