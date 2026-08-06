-- SACS Alumni Hub is exclusively for alumni — no member is a current SACS
-- pupil, so the current-resident distinction never carried real information.
-- Drop it, and the "In house" affiliation filter/badge that read it, along
-- with the various "the house" wording that assumed a residence rather than
-- a school (see accompanying frontend changes).
alter table public.profiles drop column if exists is_current_resident;
