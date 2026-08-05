-- Residentado v1.2.0 — notas personales de aprendizaje y trazabilidad Anki
-- Ejecutar una sola vez en el SQL Editor de Supabase antes de usar las notas.
-- Idempotente: puede ejecutarse nuevamente sin duplicar tablas, índices ni políticas.
-- No modifica preguntas, intentos, memoria, sesiones ni flags de auditoría.

begin;

create table if not exists public.question_learning_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  note_type text not null default 'general',
  note_text text not null,
  status text not null default 'OPEN',
  content_revision text,
  client_app_version text,
  previous_note_id uuid,
  resolved_at timestamptz,
  resolved_by_batch_id text,
  resolution_summary text,
  anki_action text,
  anki_guid text,
  anki_deck text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Permite aplicar la migración incluso si se creó una versión preliminar de la tabla.
alter table public.question_learning_notes
  add column if not exists note_type text not null default 'general',
  add column if not exists note_text text,
  add column if not exists status text not null default 'OPEN',
  add column if not exists content_revision text,
  add column if not exists client_app_version text,
  add column if not exists previous_note_id uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_batch_id text,
  add column if not exists resolution_summary text,
  add column if not exists anki_action text,
  add column if not exists anki_guid text,
  add column if not exists anki_deck text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.question_learning_notes
set
  note_type = case
    when note_type in ('general','drug','cutoff','differential','explanation','other') then note_type
    else 'general'
  end,
  status = case
    when upper(coalesce(status, '')) in ('OPEN','RESOLVED','DISMISSED') then upper(status)
    else 'OPEN'
  end,
  note_text = coalesce(note_text, ''),
  anki_action = case
    when anki_action in ('ALREADY_COVERED','UPDATE_EXISTING_CARD','CREATE_NEW_CARD','RESOLVED_WITHOUT_ANKI') then anki_action
    else null
  end,
  updated_at = coalesce(updated_at, created_at, now());

alter table public.question_learning_notes
  alter column note_text set not null;

alter table public.question_learning_notes
  drop constraint if exists question_learning_notes_note_type_check;
alter table public.question_learning_notes
  add constraint question_learning_notes_note_type_check
  check (note_type in ('general','drug','cutoff','differential','explanation','other'));

alter table public.question_learning_notes
  drop constraint if exists question_learning_notes_status_check;
alter table public.question_learning_notes
  add constraint question_learning_notes_status_check
  check (status in ('OPEN','RESOLVED','DISMISSED'));

alter table public.question_learning_notes
  drop constraint if exists question_learning_notes_anki_action_check;
alter table public.question_learning_notes
  add constraint question_learning_notes_anki_action_check
  check (anki_action is null or anki_action in (
    'ALREADY_COVERED',
    'UPDATE_EXISTING_CARD',
    'CREATE_NEW_CARD',
    'RESOLVED_WITHOUT_ANKI'
  ));

alter table public.question_learning_notes
  drop constraint if exists question_learning_notes_previous_note_id_fkey;
alter table public.question_learning_notes
  add constraint question_learning_notes_previous_note_id_fkey
  foreign key (previous_note_id)
  references public.question_learning_notes(id)
  on delete set null;

-- Si existiera una tabla preliminar con varias notas OPEN para la misma pregunta,
-- conserva como abierta la más reciente y cierra las anteriores sin borrarlas.
with ranked_open as (
  select
    id,
    row_number() over (
      partition by user_id, question_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.question_learning_notes
  where status = 'OPEN'
)
update public.question_learning_notes n
set
  status = 'DISMISSED',
  resolved_at = coalesce(n.resolved_at, now()),
  resolution_summary = coalesce(nullif(n.resolution_summary, ''), 'Cierre automático de duplicado OPEN durante migración v1.2.0.'),
  updated_at = now()
from ranked_open r
where n.id = r.id
  and r.rn > 1;

-- Una sola nota abierta por usuario/pregunta; cierres históricos ilimitados.
drop index if exists public.question_learning_notes_one_open_per_question_idx;
create unique index question_learning_notes_one_open_per_question_idx
  on public.question_learning_notes (user_id, question_id)
  where status = 'OPEN';

create index if not exists question_learning_notes_user_status_updated_idx
  on public.question_learning_notes (user_id, status, updated_at desc);

create index if not exists question_learning_notes_question_idx
  on public.question_learning_notes (question_id);

create index if not exists question_learning_notes_previous_note_idx
  on public.question_learning_notes (previous_note_id)
  where previous_note_id is not null;

alter table public.question_learning_notes enable row level security;

drop policy if exists "question_learning_notes_select_own" on public.question_learning_notes;
create policy "question_learning_notes_select_own"
on public.question_learning_notes for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "question_learning_notes_insert_own" on public.question_learning_notes;
create policy "question_learning_notes_insert_own"
on public.question_learning_notes for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "question_learning_notes_update_own" on public.question_learning_notes;
create policy "question_learning_notes_update_own"
on public.question_learning_notes for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "question_learning_notes_delete_own" on public.question_learning_notes;
create policy "question_learning_notes_delete_own"
on public.question_learning_notes for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.question_learning_notes from anon, authenticated;
grant select, insert, update, delete on table public.question_learning_notes to authenticated;

commit;

-- Verificación: no debe existir más de una nota OPEN por usuario/pregunta.
select status, count(*) as registros, count(distinct question_id) as preguntas
from public.question_learning_notes
group by status
order by status;

select user_id, question_id, count(*) as abiertas
from public.question_learning_notes
where status = 'OPEN'
group by user_id, question_id
having count(*) > 1;
