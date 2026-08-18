-- Residentado Médico Perú — Taxonomía V3 A16 (freeze)
-- Batch: TAXV3-A16-20260818
-- Taxonomy: TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18
-- Dataset revision objetivo: QUESTIONS-TAXV3-A16-20260818-R1
-- Fuente: TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014
-- SHA-256 fuente: a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a
-- NO ejecutar fuera del orden indicado en README.md.

-- POSTCHECK 100% LECTURA.
select 'questions_active' control, count(*)::bigint value from public.questions where active is true
union all select 'questions_unique_ids',count(distinct id) from public.questions where active is true
union all select 'topics_active',count(*) from public.rentability_topics where is_active is true and topic_status not like 'DEPRECATED%'
union all select 'topics_stored_total',count(*) from public.rentability_topics
union all select 'topics_deprecated_distributed',count(*) from public.rentability_topics where topic_status='DEPRECATED_DISTRIBUTED'
union all select 'aliases_v3',count(*) from public.taxonomy_topic_aliases where taxonomy_version='TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18'
union all select 'relations_v3',count(*) from public.taxonomy_topic_relations where taxonomy_version='TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18';

-- Debe ser 0.
select count(*) as orphan_question_topic_ids
from public.questions q
left join public.rentability_topics t on t.id=q.rentability_topic_id and t.is_active is true and t.topic_status not like 'DEPRECATED%'
where q.active is true and t.id is null;

-- Debe ser 2180 y coincidir con los conteos reales por topic.
select sum(n_questions) as membership_sum
from public.rentability_topics where is_active is true and topic_status not like 'DEPRECATED%';

with real as (
  select rentability_topic_id id,count(*) n from public.questions where active is true group by 1
)
select count(*) as topic_membership_mismatches
from public.rentability_topics t left join real r using(id)
where t.is_active is true and t.topic_status not like 'DEPRECATED%' and coalesce(r.n,0)<>t.n_questions;

-- Taxonomía y tiers A16.
select taxonomy_version,count(*) from public.questions where active is true group by taxonomy_version;
select rentability_tier,count(*) from public.questions where active is true group by rentability_tier order by rentability_tier;
select rentability_tier,count(*) from public.rentability_topics where is_active is true and topic_status not like 'DEPRECATED%' group by rentability_tier order by rentability_tier;
select tier_confidence,count(*) from public.rentability_topics where is_active is true and topic_status not like 'DEPRECATED%' group by tier_confidence order by tier_confidence;

-- Manifiesto: debe ser QUESTIONS-TAXV3-A16-20260818-R1, row_count 2180, metadata.active_topic_count 287.
select dataset_key,dataset_revision,row_count,metadata,updated_at from public.app_dataset_versions where dataset_key='questions';

-- No pérdida de progreso: comparar contra sentinels. Mantén la WebApp cerrada durante migración/postcheck.
with current_counts as (
  select s.table_name,
    case s.table_name
      when 'attempts' then (select count(*) from public.attempts)
      when 'practice_sessions' then (select count(*) from public.practice_sessions)
      when 'question_review_flags' then (select count(*) from public.question_review_flags)
      when 'question_learning_notes' then (select count(*) from public.question_learning_notes)
      when 'question_memory_state' then (select count(*) from public.question_memory_state)
      when 'user_learning_profile' then (select count(*) from public.user_learning_profile)
    end::bigint as row_count
  from residentado_stage.tax_v3_a16_user_sentinels s where s.batch_id='TAXV3-A16-20260818'
)
select s.table_name,s.row_count before_count,c.row_count after_count,(s.row_count=c.row_count) as unchanged
from residentado_stage.tax_v3_a16_user_sentinels s join current_counts c using(table_name)
where s.batch_id='TAXV3-A16-20260818' order by s.table_name;

-- Rollback disponible.
select to_regclass('residentado_backup.tax_v3_a16_questions_before') is not null as questions_backup,
       to_regclass('residentado_backup.tax_v3_a16_topics_before') is not null as topics_backup,
       to_regclass('residentado_backup.tax_v3_a16_manifest_before') is not null as manifest_backup;
