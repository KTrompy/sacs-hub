-- schema-update-61: two-step signup ("Step 2 — your details").
-- Step 2 collects the committee's required membership details (DOB, title,
-- cell, location, industry/occupation, community roles, comms preferences)
-- before the account enters the verification queue.
-- Applied to the live project as migration `add_signup_step2_details`.

-- date_of_birth lives on profile_details (tighter RLS, alongside id_number).
alter table public.profile_details add column if not exists date_of_birth date;

-- Gate flag: null = step 2 not yet completed. Checked in App.jsx between
-- the consent gate (FinishSignup) and the approval gate (PendingVerification).
alter table public.profiles add column if not exists details_completed_at timestamptz;
