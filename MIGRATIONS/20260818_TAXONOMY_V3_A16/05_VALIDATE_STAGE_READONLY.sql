-- Residentado Médico Perú — Taxonomía V3 A16 (freeze)
-- Batch: TAXV3-A16-20260818
-- Taxonomy: TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18
-- Dataset revision objetivo: QUESTIONS-TAXV3-A16-20260818-R1
-- Fuente: TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014
-- SHA-256 fuente: a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a
-- NO ejecutar fuera del orden indicado en README.md.

-- VALIDACIÓN DE STAGING. Solo SELECT; no toca datos canónicos.
select 'stage_questions' as control, count(*)::bigint as value from residentado_stage.tax_v3_a16_question_patch where batch_id='TAXV3-A16-20260818'
union all select 'stage_active_topics', count(*) from residentado_stage.tax_v3_a16_active_topics where batch_id='TAXV3-A16-20260818'
union all select 'stage_aliases', count(*) from residentado_stage.tax_v3_a16_aliases where batch_id='TAXV3-A16-20260818'
union all select 'stage_relations', count(*) from residentado_stage.tax_v3_a16_relations where batch_id='TAXV3-A16-20260818';

-- Debe dar 2180 / 287 / 291 / 18.

-- Todos los IDs de preguntas de staging deben existir exactamente una vez en producción pre-migración.
select count(*) as missing_question_ids
from residentado_stage.tax_v3_a16_question_patch s
left join public.questions q on q.id=s.entity_id
where s.batch_id='TAXV3-A16-20260818' and q.id is null;

select count(*) as extra_production_question_ids
from public.questions q
left join residentado_stage.tax_v3_a16_question_patch s on s.batch_id='TAXV3-A16-20260818' and s.entity_id=q.id
where s.entity_id is null;

-- Membresía primaria: la suma de n_questions debe ser exactamente 2180.
select sum((payload->>'n_questions')::integer) as active_topic_membership_sum
from residentado_stage.tax_v3_a16_active_topics
where batch_id='TAXV3-A16-20260818';

-- Cada rentability_topic_id de pregunta debe resolver a uno de los 287 activos.
select count(*) as staged_orphan_topic_ids
from residentado_stage.tax_v3_a16_question_patch q
left join residentado_stage.tax_v3_a16_active_topics t
  on t.batch_id=q.batch_id and t.entity_id=q.payload->>'rentability_topic_id'
where q.batch_id='TAXV3-A16-20260818' and t.entity_id is null;

-- Reconciliar los conteos por topic contra las 2.180 asignaciones de preguntas.
with q as (
  select payload->>'rentability_topic_id' topic_id, count(*) n
  from residentado_stage.tax_v3_a16_question_patch
  where batch_id='TAXV3-A16-20260818' group by 1
), t as (
  select entity_id topic_id, (payload->>'n_questions')::integer n
  from residentado_stage.tax_v3_a16_active_topics
  where batch_id='TAXV3-A16-20260818'
)
select count(*) as topic_count_mismatches
from t left join q using(topic_id)
where coalesce(q.n,0)<>t.n;

-- Freeze y scoring: sin fórmulas inventadas; solo versiones A16.
select count(*) as wrong_taxonomy_version
from residentado_stage.tax_v3_a16_question_patch
where batch_id='TAXV3-A16-20260818' and payload->>'taxonomy_version'<>'TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18';

select count(*) as wrong_formula_version
from residentado_stage.tax_v3_a16_active_topics
where batch_id='TAXV3-A16-20260818' and payload->>'rentability_formula_version'<>'RENTABILIDAD_TAX_AUD_FINAL_V3_LEGACY_EMULATION_2026-08-18';

select payload->>'rentability_tier' tier, count(*) topics
from residentado_stage.tax_v3_a16_active_topics where batch_id='TAXV3-A16-20260818' group by 1 order by 1;
select payload->>'tier_confidence' tier_confidence, count(*) topics
from residentado_stage.tax_v3_a16_active_topics where batch_id='TAXV3-A16-20260818' group by 1 order by 1;
