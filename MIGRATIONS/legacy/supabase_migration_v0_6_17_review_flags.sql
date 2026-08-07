-- Residentado v0.6.17 — flags personales para auditoría de preguntas
-- Ejecutar una sola vez en el SQL Editor de Supabase antes de abrir la v0.6.17.
-- Es idempotente: puede ejecutarse nuevamente sin duplicar datos ni políticas.

begin;

create table if not exists public.question_review_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  flag_type text not null check (flag_type in ('statement','explanation','general')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, question_id)
);

create index if not exists question_review_flags_user_updated_idx
  on public.question_review_flags (user_id, updated_at desc);

create index if not exists question_review_flags_question_idx
  on public.question_review_flags (question_id);

alter table public.question_review_flags enable row level security;

drop policy if exists "question_review_flags_select_own" on public.question_review_flags;
create policy "question_review_flags_select_own"
on public.question_review_flags for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "question_review_flags_insert_own" on public.question_review_flags;
create policy "question_review_flags_insert_own"
on public.question_review_flags for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "question_review_flags_update_own" on public.question_review_flags;
create policy "question_review_flags_update_own"
on public.question_review_flags for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "question_review_flags_delete_own" on public.question_review_flags;
create policy "question_review_flags_delete_own"
on public.question_review_flags for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.question_review_flags from anon, authenticated;
grant select, insert, update, delete on table public.question_review_flags to authenticated;

commit;

-- Verificación esperada después de instalar: tabla existente y 0 filas inicialmente.
select
  count(*) as flags_existentes,
  count(distinct question_id) as preguntas_marcadas
from public.question_review_flags;
