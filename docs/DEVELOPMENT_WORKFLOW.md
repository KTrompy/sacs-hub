# DEVELOPMENT_WORKFLOW.md — Reusable Development Processes

> Step-by-step checklists for common development tasks.
> Each workflow matches the conventions and patterns already established in the codebase.

---

## 1. Adding a New Feature

### Planning
1. **Understand the existing pattern.** Read 2-3 similar features (e.g., if adding a new list view, study `Jobs.jsx` and `Events.jsx`). Note the data-fetching pattern, state management, loading/empty states, and error handling.
2. **Identify the database changes needed.** What tables, columns, RLS policies, and storage buckets does this feature require?
3. **Identify the route.** Where does it fit in the nav? Check `App.jsx` TABS array and the lazy-import section.

### Database (if needed)
1. Create a new migration file: `schema-update-{next-number}.sql`
2. Follow the existing migration conventions:
   - Add a header comment explaining what this migration does and when it was applied
   - Use `IF NOT EXISTS` / `IF EXISTS` guards so the migration is safe to re-run
   - Enable RLS on every new table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
   - Add `is_approved()` gate on every SELECT policy
   - Add ownership checks (`auth.uid()`) on INSERT/UPDATE/DELETE policies
   - Add admin policies with `is_admin()` if the table needs admin management
3. If the feature has admin-modifiable content, add `log_admin_action()` triggers for admin operations
4. Apply via the Supabase SQL editor
5. Update `schema-all.sql` if doing a periodic consolidation

### Component
1. Create the component file in `src/components/`
2. Follow established patterns:
   - Import `supabase` from `../supabaseClient`
   - Use `EmptyState` and `LoadingState` for loading/empty views
   - Use `useToast` for user feedback
   - Use `DeleteButton` for destructive actions
   - Use `ReportButton` if content can be flagged
   - Use `useDiscardGuard` if the component has a form with unsaved-changes risk
   - Use `DOMParser` for plain-text extraction (never `innerHTML` on a live element)
   - Define page-size constants at the top (e.g., `const PAGE_SIZE = 20`)
3. Add a `timeAgo()` function if showing timestamps (copy from the nearest existing component)
4. Export any shared constants or components that other features will need

### Routing
1. Add lazy import in `App.jsx`: `const MyFeature = lazy(() => import('./components/MyFeature.jsx'))`
2. Add route in the `<Routes>` section of App.jsx
3. If it's a main nav item, add to the `TABS` array (and `MOBILE_TABS` if it should appear on mobile)

### Styling
1. Add CSS rules to `src/styles.css`
2. Use a section comment: `/* ---------- My Feature ---------- */`
3. Place it near related sections
4. Use design tokens exclusively — no hard-coded colors, spacing, radii, or font sizes
5. Add mobile breakpoint rules if needed (at minimum, test at 720px and 420px)

### Final Checks
- [ ] RLS policies gate all access correctly
- [ ] Loading and empty states render properly
- [ ] Mobile layout works (test at 720px breakpoint)
- [ ] Error handling covers network failures and auth errors
- [ ] User feedback via toasts for all actions
- [ ] Navigation works (browser back/forward, direct URL access)
- [ ] `vite build` completes without errors

---

## 2. Adding a Database Migration

### Process
1. Find the current highest migration number:
   ```bash
   ls schema-update-*.sql | sort -t- -k3 -n | tail -1
   ```
2. Create `schema-update-{N+1}.sql`
3. Write the migration with these conventions:
   ```sql
   -- schema-update-{N}.sql — brief description
   --
   -- Longer explanation of what this changes and why.
   -- Applied to live project on YYYY-MM-DD.

   -- Use guards for idempotency
   CREATE TABLE IF NOT EXISTS ...
   ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
   DROP POLICY IF EXISTS "..." ON ...;
   CREATE POLICY "..." ON ...;
   ```
4. **Always enable RLS** on new tables
5. **Always add policies** — a table with RLS enabled but no policies returns zero rows to everyone
6. **Revoke EXECUTE** on sensitive functions from `public, anon, authenticated`
7. Test the migration in the Supabase SQL editor
8. Verify from the client that data access works as expected

### RLS Policy Checklist
- [ ] SELECT policy with `is_approved()` gate (for member-visible data)
- [ ] INSERT policy with `auth.uid()` ownership check + `is_approved()`
- [ ] UPDATE policy with `auth.uid()` ownership check + `is_approved()`
- [ ] DELETE policy with `auth.uid()` ownership check + `is_approved()`
- [ ] Admin policies with `is_admin()` where needed
- [ ] Storage bucket policies match the table's access pattern

---

## 3. Adding a Storage Bucket

### Process
1. Create the bucket in the Supabase dashboard or via SQL:
   ```sql
   INSERT INTO storage.buckets (id, name, public)
   VALUES ('my-bucket', 'my-bucket', false);  -- or true for public
   ```
2. Add storage policies:
   ```sql
   -- Members can upload to their own folder
   CREATE POLICY "members upload" ON storage.objects
     FOR INSERT WITH CHECK (
       bucket_id = 'my-bucket'
       AND (storage.foldername(name))[1] = auth.uid()::text
       AND public.is_approved()
     );
   ```
3. Update `SECURITY.md` with the new bucket's access pattern
4. Update `_shared/accountCleanup.ts` if the bucket should be cleaned on account deletion

### Client-Side Upload Pattern
```javascript
const path = `${session.user.id}/${Date.now()}-${file.name}`
const { error } = await supabase.storage
  .from('my-bucket')
  .upload(path, file, { upsert: false })
```

### File Size/Type Validation
Always validate client-side before upload:
```javascript
const MAX_SIZE = 5 * 1024 * 1024  // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
if (file.size > MAX_SIZE) { /* show error */ }
if (!ALLOWED_TYPES.includes(file.type)) { /* show error */ }
```

---

## 4. Bug Fix Workflow

1. **Reproduce** — confirm the bug exists and understand when it happens
2. **Locate** — find the relevant component(s) and database queries
3. **Understand** — read the surrounding code. Check comments (they often explain *why* something is done a specific way)
4. **Fix** — make the minimal change. Don't refactor unrelated code in a bug-fix commit
5. **Test scenarios:**
   - Does the fix work for the reported case?
   - Does it break the happy path?
   - Does it work on mobile (720px)?
   - Does it work for non-admin users?
   - Does it work for unapproved users (should they see nothing)?
6. **Build check** — `npm run build` must complete without errors

---

## 5. Adding an Admin Feature

Admin features live in `src/components/Admin.jsx` (or `MerchAdmin.jsx` for shop management).

### Process
1. Add a new subtab to the `SUBTABS` array in `Admin.jsx`:
   ```javascript
   {
     id: 'my-feature',
     label: 'My Feature',
     group: 'Content',  // People | Content | Shop | Site
     help: "One-line explanation for committee members who've never seen this page.",
   },
   ```
2. Add the rendering branch in the `subtab === 'my-feature'` section
3. Follow existing admin UI patterns:
   - Search/filter at the top
   - Table or card list for data
   - Action buttons with `ConfirmDialog` for destructive operations
   - `DeleteButton` with `useToast` feedback
4. Add `log_admin_action()` database triggers for any admin operation
5. Add RLS policies gated on `is_admin()`

---

## 6. Modifying the Profile

The profile system has two tables and two components:

| Table | Component | Fields |
|-------|-----------|--------|
| `profiles` | `Profile.jsx` (`form` state) | Public alumni data (name, bio, industry, etc.) |
| `profile_details` | `Profile.jsx` (`details` state) | SACS membership record (title, DOB, ID number, etc.) |

### Adding a Profile Field
1. Add the column to the database (migration)
2. Add the field to the `EMPTY` object in `Profile.jsx`
3. Add the form input in the appropriate section
4. If the field should show on directory cards or profile modals, update:
   - `POSTER_FIELDS` constant (used in Feed, Jobs, Events for profile popups)
   - `PERSON_FIELDS` in Mentoring.jsx
   - `Directory.jsx` card rendering
   - `ProfileModal.jsx` display
5. If it's a completion-tracked field, add to `COMPLETION_FIELDS` in `Home.jsx`

---

## 7. Working with Realtime

Supabase Realtime is used for:
- **Messages** — new message inserts, scoped to the user's conversations
- **Notifications** — new notification inserts, scoped to the user
- **Posts** — new post inserts (feed live updates)

### Pattern
```javascript
const channel = supabase
  .channel('my-channel')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'my_table',
    filter: `user_id=eq.${session.user.id}`,  // ALWAYS scope to user
  }, (payload) => {
    // Handle the change — debounce if the handler does a refetch
  })
  .subscribe()

// Cleanup
return () => { supabase.removeChannel(channel) }
```

### Rules
- **Always scope subscriptions** — unscoped subscriptions fire for every user's activity, causing N queries per insert
- **Debounce refetches** — a burst of messages shouldn't fire N separate queries
- **Clean up on unmount** — remove the channel in the useEffect cleanup

---

## 8. Build & Deploy

### Local Development
```bash
npm install          # Install dependencies (only 9 total)
npm run dev          # Start Vite dev server with HMR
```

### Production Build
```bash
npm run build        # Vite production build → dist/
npm run preview      # Preview the production build locally
```

### Vite Configuration
- Manual chunks: `vendor-react`, `vendor-leaflet`, `vendor-supabase` (keeps framework code separate from page code)
- React plugin: `@vitejs/plugin-react`
- No other Vite plugins

### Deploy to Vercel
- Push to the repository's main branch
- Vercel auto-deploys from Git
- Preview deploys for branches
- Verify `vercel.json` is correct (catch-all rewrite + security headers)
- See `DEPLOY.md` for the full deployment checklist

### Build Verification
Before deploying, always run:
```bash
npm run build
```
This catches:
- Import errors (missing files, circular dependencies)
- JSX syntax errors
- Unused import warnings (Vite surfaces these)
- Bundle size issues (Vite reports chunk sizes)

---

## 9. Edge Function Development

### Structure
```
supabase/functions/
  my-function/
    index.ts          # Entry point (Deno)
  _shared/
    accountCleanup.ts # Shared utilities
```

### Template
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://your-domain.com']

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : '',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(req) })
  }

  // 1. Verify JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  // 2. Create clients
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const serviceClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 3. Verify caller identity
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 })

  // 4. Do the work with serviceClient (bypasses RLS)
  // ...

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
  })
})
```

### Deploy
```bash
supabase functions deploy my-function --project-ref <ref>
```
