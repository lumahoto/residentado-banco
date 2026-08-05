-- Verificación posterior a MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql
select to_regclass('public.question_learning_notes') as learning_notes_table;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'question_learning_notes'
order by indexname;

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'question_learning_notes'
order by policyname;

select status, count(*) as registros, count(distinct question_id) as preguntas
from public.question_learning_notes
group by status
order by status;

select user_id, question_id, count(*) as abiertas
from public.question_learning_notes
where status = 'OPEN'
group by user_id, question_id
having count(*) > 1;
