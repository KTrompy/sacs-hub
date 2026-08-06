-- ============================================================
-- Update 41: In-app job applications
-- Adds job_applications table + private storage bucket for CVs
-- and cover letters. Run in Supabase SQL Editor. Safe to re-run.
-- ============================================================

create table if not exists public.job_applications (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null references auth.users(id) on delete cascade,
  cover_letter text not null default '',
  cv_url text,
  cv_name text,
  cover_letter_url text,
  cover_letter_name text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);

alter table public.job_applications enable row level security;

create policy "Approved members can apply to jobs"
  on public.job_applications for insert to authenticated
  with check (applicant_id = auth.uid() and public.is_approved());

create policy "Users can view own applications"
  on public.job_applications for select to authenticated
  using (applicant_id = auth.uid());

create policy "Posters can view applications to their jobs"
  on public.job_applications for select to authenticated
  using (exists (
    select 1 from public.jobs
    where jobs.id = job_applications.job_id and jobs.posted_by = auth.uid()
  ));

create policy "Users can withdraw own applications"
  on public.job_applications for delete to authenticated
  using (applicant_id = auth.uid());

-- Private storage bucket for CVs and cover letter documents
insert into storage.buckets (id, name, public)
values ('job-application-files', 'job-application-files', false)
on conflict (id) do nothing;

create policy "Approved members can upload application files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-application-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_approved()
  );

create policy "Authenticated users can read application files"
  on storage.objects for select to authenticated
  using (bucket_id = 'job-application-files');

create policy "Users can delete own application files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-application-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter publication supabase_realtime add table public.job_applications;
