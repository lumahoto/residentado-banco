-- Residentado Médico Perú — banco piloto
-- Ejecuta este archivo en el SQL Editor de tu proyecto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.questions (
  id text primary key,
  year integer,
  exam text,
  test text,
  question_number integer,
  area text,
  specialty text,
  topic text,
  subtopic text,
  question text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  option_e text,
  official_answer text,
  official_answer_text text,
  key_detection_method text,
  key_verification_status text,
  key_visual_fill text,
  key_visual_bbox text,
  source_pdf text,
  source_page integer,
  source_sha256 text,
  content_sha256 text,
  traceability_complete boolean,
  extraction_status text,
  medical_review_status text,
  explanation_status text,
  correct_explanation text,
  why_not_a text,
  why_not_b text,
  why_not_c text,
  why_not_d text,
  why_not_e text,
  exam_pearl text,
  update_alert text,
  reference_notes text,
  record_version text,
  import_batch text,
  active boolean default true,
  audit_status text,
  audit_current_assessment text,
  audit_current_answer text,
  audit_app_behavior text,
  audit_source_urls text,
  audit_date text
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  selected_answer text null check (selected_answer is null or selected_answer in ('A','B','C','D','E')),
  is_correct boolean not null,
  response_time_ms integer not null default 0 check (response_time_ms >= 0),
  study_mode text not null default 'continue',
  timed_out boolean not null default false,
  answered_at timestamptz not null default now()
);

create index if not exists attempts_user_answered_idx
  on public.attempts (user_id, answered_at desc);

create index if not exists attempts_user_question_idx
  on public.attempts (user_id, question_id);

alter table public.questions enable row level security;
alter table public.attempts enable row level security;

drop policy if exists "questions_read_authenticated" on public.questions;
create policy "questions_read_authenticated"
on public.questions
for select
to authenticated
using (active = true);

drop policy if exists "attempts_select_own" on public.attempts;
create policy "attempts_select_own"
on public.attempts
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "attempts_insert_own" on public.attempts;
create policy "attempts_insert_own"
on public.attempts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "attempts_update_own" on public.attempts;
create policy "attempts_update_own"
on public.attempts
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "attempts_delete_own" on public.attempts;
create policy "attempts_delete_own"
on public.attempts
for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.questions from anon, authenticated;
grant select on table public.questions to authenticated;

revoke all on table public.attempts from anon, authenticated;
grant select, insert, update, delete on table public.attempts to authenticated;
