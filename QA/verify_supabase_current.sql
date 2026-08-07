-- Residentado v1.3.1 — verificación consolidada, exclusivamente de lectura.
-- Ejecutar por bloques en Supabase SQL Editor después de publicar o migrar.

-- ============================================================================
-- Fuente consolidada: QA/VERIFY_SUPABASE_V1_1_1.sql
-- ============================================================================
-- Solo lectura.
select
  position('PT409' in pg_get_functiondef('public.save_practice_session_state(uuid,bigint,jsonb,jsonb,integer,bigint,bigint,text,integer)'::regprocedure)) > 0 as usa_pt409,
  position('40001' in pg_get_functiondef('public.save_practice_session_state(uuid,bigint,jsonb,jsonb,integer,bigint,bigint,text,integer)'::regprocedure)) = 0 as elimino_40001;

select id, title, status, state_revision, answered_count, planned_count,
       client_app_version, updated_at, completed_at
from public.practice_sessions
where user_id = (select auth.uid())
order by updated_at desc
limit 20;

-- ============================================================================
-- Fuente consolidada: QA/VERIFY_SUPABASE_V1_2_0.sql
-- ============================================================================
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

-- ============================================================================
-- Fuente consolidada: QA/VERIFY_SUPABASE_V1_3_0.sql
-- ============================================================================
-- Residentado v1.3.0 — verificación consolidada del catálogo TTS.
-- Solo lectura; no modifica datos ni políticas.

select
  count(*) as tts_disponibles,
  count(distinct rentability_topic_id) as temas_con_tts,
  min(primary_code) as primer_tts,
  max(primary_code) as ultimo_tts,
  min(catalog_version) as catalogo_min,
  max(catalog_version) as catalogo_max,
  max(updated_at) as actualizacion_mas_reciente
from public.tts_topic_catalog;

select rentability_tier, count(*) as tts_disponibles
from public.tts_topic_catalog
group by rentability_tier
order by case rentability_tier
  when 'MUY_ALTA' then 1 when 'ALTA' then 2 when 'MEDIA' then 3 when 'BAJA' then 4 else 5 end;

select count(*) as topic_ids_sin_correspondencia
from public.tts_topic_catalog t
where not exists (
  select 1 from public.questions q
  where q.rentability_topic_id = t.rentability_topic_id
);

select
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'SELECT') as can_select,
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'INSERT') as can_insert,
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'UPDATE') as can_update,
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'DELETE') as can_delete,
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'TRUNCATE') as can_truncate,
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'REFERENCES') as can_references,
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'TRIGGER') as can_trigger;

select
  count(*) filter (where cmd = 'SELECT') as select_policies,
  count(*) filter (where cmd <> 'SELECT') as write_policies
from pg_policies
where schemaname = 'public' and tablename = 'tts_topic_catalog';

select case when
  has_table_privilege('authenticated', 'public.tts_topic_catalog', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tts_topic_catalog', 'INSERT')
  and not has_table_privilege('authenticated', 'public.tts_topic_catalog', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.tts_topic_catalog', 'DELETE')
  and not has_table_privilege('authenticated', 'public.tts_topic_catalog', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.tts_topic_catalog', 'REFERENCES')
  and not has_table_privilege('authenticated', 'public.tts_topic_catalog', 'TRIGGER')
  and (select count(*) from pg_policies where schemaname='public' and tablename='tts_topic_catalog' and cmd='SELECT') = 1
  and (select count(*) from pg_policies where schemaname='public' and tablename='tts_topic_catalog' and cmd<>'SELECT') = 0
then 'PASS' else 'FAIL' end as control_solo_lectura;
