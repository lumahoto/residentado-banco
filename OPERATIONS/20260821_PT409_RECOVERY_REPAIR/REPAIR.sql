-- RESIDENTADO — reparación del incidente PT409 / recovery replay
-- Incidente confirmado: 2026-08-20 20:51 America/Lima
-- V002: reemplaza jsonb_object_length() por jsonb_object_keys()+count(*)
-- para compatibilidad con la instancia actual de Supabase/PostgreSQL.
-- Baseline auditado: 7 recovery sessions, 156 attempt rows actuales, 122 preguntas.
-- NO ejecutar con la WebApp abierta.
-- Desplegar v1.4.3 antes del BLOQUE 2.
-- Esta reparación NO toca las demás recuperaciones históricas.

-- ============================================================
-- BLOQUE 1 — BACKUP + MAPA FORENSE (V002; SEGURO; NO MODIFICA PUBLIC)
-- ============================================================

create schema if not exists residentado_backup;

create table if not exists residentado_backup.incident_20260820_session_ids (
  id uuid primary key
);

insert into residentado_backup.incident_20260820_session_ids(id)
values
  ('d29d03d0-c4a8-4cdc-a868-b6891c6308cb'::uuid),
  ('cdf76b4e-67cf-4cc6-ad54-6096723be601'::uuid),
  ('4fcae0f5-fd76-4868-940f-bc4418190e7e'::uuid),
  ('dc479b73-b97f-4bac-b73d-114a413222bb'::uuid),
  ('ba0d50b2-72b6-457e-a2ef-dadccc6fec5d'::uuid),
  ('01db33a3-ccbd-4f21-b830-33e3d51d7468'::uuid),
  ('96b14ccf-eaa7-4ea2-9aa0-4d647e4dc357'::uuid)
on conflict (id) do nothing;

create table if not exists residentado_backup.incident_20260820_attempt_repair_map as
with incident as (
  select
    r.id as recovery_session_id,
    (r.config->'recovery'->>'sourceSessionId')::uuid as source_session_id,
    (
      select count(*)::int
      from jsonb_object_keys(
        coalesce((r.state->'responses')::jsonb, '{}'::jsonb)
      )
    ) as prefix_len
  from public.practice_sessions r
  join residentado_backup.incident_20260820_session_ids i on i.id=r.id
),
mapped as (
  select
    a.id as attempt_id,
    a.user_id,
    a.question_id,
    a.session_id as corrupted_session_id,
    i.source_session_id,
    a.session_question_index,
    a.answered_at as corrupted_answered_at,
    coalesce(
      (
        select min(tail.answered_at)
        from public.attempts tail
        where tail.session_id = i.source_session_id
          and tail.session_question_index is not null
          and tail.session_question_index >= i.prefix_len
      ),
      src.completed_at,
      src.updated_at
    ) as anchor_at,
    i.prefix_len
  from incident i
  join public.practice_sessions src on src.id=i.source_session_id
  join public.attempts a on a.session_id=i.recovery_session_id
)
select
  attempt_id,
  user_id,
  question_id,
  corrupted_session_id,
  source_session_id,
  session_question_index,
  corrupted_answered_at,
  anchor_at - ((prefix_len - session_question_index) * interval '1 second')
    as repaired_answered_at,
  case
    when exists (
      select 1
      from public.attempts tail
      where tail.session_id=source_session_id
        and tail.session_question_index is not null
        and tail.session_question_index >= prefix_len
    )
    then 'FIRST_INTACT_TAIL_ATTEMPT_MINUS_1S_STEPS'
    else 'SOURCE_COMPLETED_AT_MINUS_1S_STEPS'
  end as reconstruction_method
from mapped;

create table if not exists residentado_backup.incident_20260820_sessions_before as
select ps.*
from public.practice_sessions ps
join residentado_backup.incident_20260820_session_ids i on i.id=ps.id;

create table if not exists residentado_backup.incident_20260820_attempts_before as
select a.*
from public.attempts a
join residentado_backup.incident_20260820_attempt_repair_map m on m.attempt_id=a.id;

create table if not exists residentado_backup.incident_20260820_memory_before as
select qms.*
from public.question_memory_state qms
join (
  select distinct user_id, question_id
  from residentado_backup.incident_20260820_attempt_repair_map
) x
  on x.user_id=qms.user_id
 and x.question_id=qms.question_id;

select
  (select count(*) from residentado_backup.incident_20260820_sessions_before) as backup_sessions,
  (select count(*) from residentado_backup.incident_20260820_attempts_before) as backup_attempts,
  (select count(*) from residentado_backup.incident_20260820_memory_before) as backup_memory_rows,
  (select count(*) from residentado_backup.incident_20260820_attempt_repair_map) as repair_map_rows,
  (select count(distinct question_id) from residentado_backup.incident_20260820_attempt_repair_map) as affected_questions;

-- ESPERADO: 7 / 156 / 122 / 156 / 122.
-- Si no coincide, NO ejecutar el bloque 2.


-- ============================================================
-- BLOQUE 2 — REPARACIÓN TRANSACCIONAL
-- Ejecutar solo tras desplegar v1.4.3 y cerrar todas las pestañas.
-- ============================================================

begin;

do $$
declare
  n_sessions int;
  n_map int;
  n_questions int;
  n_live int;
  n_bad int;
begin
  select count(*) into n_sessions
  from residentado_backup.incident_20260820_sessions_before;

  select count(*), count(distinct question_id)
    into n_map, n_questions
  from residentado_backup.incident_20260820_attempt_repair_map;

  select count(*) into n_live
  from public.attempts a
  join residentado_backup.incident_20260820_attempt_repair_map m
    on m.attempt_id=a.id
   and m.corrupted_session_id=a.session_id;

  select count(*) into n_bad
  from residentado_backup.incident_20260820_attempt_repair_map
  where session_question_index is null
     or repaired_answered_at is null;

  if n_sessions <> 7 then
    raise exception 'ABORT: expected 7 backed-up sessions, got %', n_sessions;
  end if;
  if n_map <> 156 then
    raise exception 'ABORT: expected 156 mapped attempts, got %', n_map;
  end if;
  if n_questions <> 122 then
    raise exception 'ABORT: expected 122 affected questions, got %', n_questions;
  end if;
  if n_live <> 156 then
    raise exception 'ABORT: live DB changed; expected 156 attempts still on incident recoveries, got %', n_live;
  end if;
  if n_bad <> 0 then
    raise exception 'ABORT: null index/timestamp rows in repair map: %', n_bad;
  end if;
end $$;

update public.attempts a
set
  session_id=m.source_session_id,
  answered_at=m.repaired_answered_at,
  updated_at=m.repaired_answered_at
from residentado_backup.incident_20260820_attempt_repair_map m
where a.id=m.attempt_id;

do $$
declare n_remaining int;
begin
  select count(*) into n_remaining
  from public.attempts a
  join residentado_backup.incident_20260820_session_ids i on i.id=a.session_id;
  if n_remaining <> 0 then
    raise exception 'ABORT: % attempts remain on incident recovery sessions', n_remaining;
  end if;
end $$;

delete from public.question_memory_state qms
using (
  select distinct user_id, question_id
  from residentado_backup.incident_20260820_attempt_repair_map
) x
where qms.user_id=x.user_id
  and qms.question_id=x.question_id;

delete from public.practice_sessions ps
using residentado_backup.incident_20260820_session_ids i
where ps.id=i.id;

commit;


-- ============================================================
-- BLOQUE 3 — POSTCHECK INMEDIATO, ANTES DE ABRIR LA APP
-- ============================================================

select
  (select count(*)
   from public.attempts a
   join residentado_backup.incident_20260820_attempt_repair_map m
     on m.attempt_id=a.id
    and m.source_session_id=a.session_id) as restored_attempts,

  (select count(*)
   from public.attempts a
   join residentado_backup.incident_20260820_session_ids i
     on i.id=a.session_id) as attempts_still_on_incident_sessions,

  (select count(*)
   from public.practice_sessions ps
   join residentado_backup.incident_20260820_session_ids i
     on i.id=ps.id) as incident_sessions_remaining,

  (select count(*)
   from public.question_memory_state qms
   join (
     select distinct user_id, question_id
     from residentado_backup.incident_20260820_attempt_repair_map
   ) x using (user_id, question_id)) as memory_rows_before_app_rebuild;

-- ESPERADO: 156 / 0 / 0 / 0.

select count(*) as repaired_attempts_still_in_fake_window
from public.attempts a
join residentado_backup.incident_20260820_attempt_repair_map m on m.attempt_id=a.id
where a.answered_at >= '2026-08-21 01:52:00+00'
  and a.answered_at <  '2026-08-21 01:54:30+00';

-- ESPERADO: 0.

select
  m.source_session_id,
  count(*) as restored_attempts,
  min(a.answered_at) at time zone 'America/Lima' as first_restored_lima,
  max(a.answered_at) at time zone 'America/Lima' as last_restored_lima
from residentado_backup.incident_20260820_attempt_repair_map m
join public.attempts a on a.id=m.attempt_id
group by m.source_session_id
order by first_restored_lima;

-- En el snapshot exportado, 20/08 pasaría de 208 a 52 attempts.
-- Si estudiaste después de exportar, ese total puede ser mayor.


-- ============================================================
-- BLOQUE 4 — DESPUÉS DE ABRIR v1.4.3 UNA VEZ
-- ============================================================

select count(*) as rebuilt_memory_rows
from public.question_memory_state qms
join (
  select distinct user_id, question_id
  from residentado_backup.incident_20260820_attempt_repair_map
) x using (user_id, question_id);

-- ESPERADO: 122.
