-- Residentado Médico Perú — Taxonomía V3 A16 (freeze)
-- Batch: TAXV3-A16-20260818
-- Taxonomy: TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18
-- Dataset revision objetivo: QUESTIONS-TAXV3-A16-20260818-R1
-- Fuente: TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014
-- SHA-256 fuente: a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a
-- NO ejecutar fuera del orden indicado en README.md.

-- PRECHECK 100% LECTURA. No modifica datos ni esquema.
select 'questions_total' as control, count(*)::text as value from public.questions
union all select 'questions_active', count(*)::text from public.questions where active is true
union all select 'questions_unique_ids', count(distinct id)::text from public.questions
union all select 'topics_total', count(*)::text from public.rentability_topics
union all select 'topics_unique_ids', count(distinct id)::text from public.rentability_topics;

select dataset_key, dataset_revision, row_count, metadata, updated_at
from public.app_dataset_versions
where dataset_key = 'questions';

-- Debe devolver 0: los 2.180 IDs de preguntas deben ser estables y no nulos.
select count(*) as question_ids_invalid
from public.questions
where id is null or btrim(id) = '';

-- Inventario de tablas de progreso: el commit V3 no debe escribir en ninguna de ellas.
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in ('attempts','practice_sessions','question_review_flags','question_learning_notes','question_memory_state','user_learning_profile')
order by table_name;

-- Confirmar que el manifiesto permite la estrategia atómica usada por la app.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='app_dataset_versions'
order by ordinal_position;
