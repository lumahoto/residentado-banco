-- Residentado WebApp v1.5.0
-- Centro de revisión + clasificación de observaciones + resultado Anki obligatorio.
-- Idempotente. No modifica preguntas, taxonomía, attempts ni memoria.

begin;

alter table public.question_review_flags
  add column if not exists learning_scope text not null default 'UNCLASSIFIED';

alter table public.question_review_flags
  drop constraint if exists question_review_flags_learning_scope_check;

alter table public.question_review_flags
  add constraint question_review_flags_learning_scope_check
  check (learning_scope in ('CONTENT', 'EDITORIAL_TECHNICAL', 'UNCLASSIFIED'));

alter table public.question_learning_notes
  drop constraint if exists question_learning_notes_anki_action_check;

alter table public.question_learning_notes
  add constraint question_learning_notes_anki_action_check
  check (
    anki_action is null
    or anki_action in (
      'ALREADY_COVERED',
      'UPDATE_EXISTING_CARD',
      'CREATE_NEW_CARD',
      'RESOLVED_WITHOUT_ANKI',
      'REEXPOSE_EXISTING_CARD'
    )
  );

commit;

-- Verificación rápida (solo lectura):
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'question_review_flags'
--   and column_name = 'learning_scope';
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid in (
--   'public.question_review_flags'::regclass,
--   'public.question_learning_notes'::regclass
-- )
-- and conname in (
--   'question_review_flags_learning_scope_check',
--   'question_learning_notes_anki_action_check'
-- );
