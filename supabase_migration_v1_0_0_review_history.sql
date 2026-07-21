-- Residentado v1.0.0 — historial y trazabilidad de preguntas observadas
-- Ejecutar una sola vez DESPUÉS de las migraciones v0.6.17 y v0.6.18.
-- Es idempotente y no modifica preguntas, intentos, memoria ni sesiones.

begin;

alter table public.question_review_flags
  add column if not exists status text not null default 'OPEN',
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_patch_id text,
  add column if not exists resolution_summary text,
  add column if not exists content_revision text,
  add column if not exists previous_flag_id uuid;

update public.question_review_flags
set
  status = coalesce(nullif(upper(status), ''), 'OPEN'),
  content_revision = coalesce(nullif(content_revision, ''), 'PRE_V1_0_0')
where status is null
   or status = ''
   or content_revision is null
   or content_revision = '';

alter table public.question_review_flags
  drop constraint if exists question_review_flags_status_check;

alter table public.question_review_flags
  add constraint question_review_flags_status_check
  check (status in ('OPEN','RESOLVED','DISMISSED'));

alter table public.question_review_flags
  drop constraint if exists question_review_flags_previous_flag_id_fkey;

alter table public.question_review_flags
  add constraint question_review_flags_previous_flag_id_fkey
  foreign key (previous_flag_id)
  references public.question_review_flags(id)
  on delete set null;

-- La versión anterior permitía una sola fila histórica por usuario/pregunta.
-- Se reemplaza por una sola fila ABIERTA y cualquier número de cierres históricos.
alter table public.question_review_flags
  drop constraint if exists question_review_flags_user_id_question_id_key;

drop index if exists public.question_review_flags_one_open_per_question_idx;
create unique index question_review_flags_one_open_per_question_idx
  on public.question_review_flags (user_id, question_id)
  where status = 'OPEN';

create index if not exists question_review_flags_user_status_updated_idx
  on public.question_review_flags (user_id, status, updated_at desc);

create index if not exists question_review_flags_previous_flag_idx
  on public.question_review_flags (previous_flag_id)
  where previous_flag_id is not null;

-- Mantiene las políticas de seguridad de v0.6.17; se recrean por seguridad.
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

-- Verificación: no debe existir más de un flag OPEN por usuario/pregunta.
select
  status,
  count(*) as registros,
  count(distinct question_id) as preguntas
from public.question_review_flags
group by status
order by status;

select user_id, question_id, count(*) as abiertos
from public.question_review_flags
where status = 'OPEN'
group by user_id, question_id
having count(*) > 1;
