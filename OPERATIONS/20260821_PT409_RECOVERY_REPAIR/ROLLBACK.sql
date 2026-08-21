-- ROLLBACK del incidente PT409 2026-08-20.
-- Usar solo si todavía NO se ha continuado estudiando después del repair.

begin;

insert into public.practice_sessions
select *
from residentado_backup.incident_20260820_sessions_before
on conflict (id) do nothing;

delete from public.attempts a
using residentado_backup.incident_20260820_attempts_before b
where a.id=b.id;

insert into public.attempts
select *
from residentado_backup.incident_20260820_attempts_before;

delete from public.question_memory_state qms
using residentado_backup.incident_20260820_memory_before b
where qms.user_id=b.user_id
  and qms.question_id=b.question_id;

insert into public.question_memory_state
select *
from residentado_backup.incident_20260820_memory_before;

commit;

select
  (select count(*)
   from public.practice_sessions ps
   join residentado_backup.incident_20260820_session_ids i on i.id=ps.id) as incident_sessions_restored,

  (select count(*)
   from public.attempts a
   join residentado_backup.incident_20260820_attempts_before b on b.id=a.id
   where a.session_id=b.session_id
     and a.answered_at=b.answered_at) as attempts_restored_exactly,

  (select count(*)
   from public.question_memory_state qms
   join residentado_backup.incident_20260820_memory_before b
     on b.user_id=qms.user_id and b.question_id=qms.question_id) as memory_rows_restored;

-- ESPERADO: 7 / 156 / 122.
