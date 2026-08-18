-- Residentado Médico Perú — Taxonomía V3 A16 (freeze)
-- Batch: TAXV3-A16-20260818
-- Taxonomy: TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18
-- Dataset revision objetivo: QUESTIONS-TAXV3-A16-20260818-R1
-- Fuente: TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014
-- SHA-256 fuente: a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a
-- NO ejecutar fuera del orden indicado en README.md.

begin;
select pg_advisory_xact_lock(hashtext('TAXV3-A16-20260818'));

-- Evitar una reaplicación accidental después de un COMMIT exitoso.
do $$
declare current_rev text;
begin
  select dataset_revision into current_rev from public.app_dataset_versions where dataset_key='questions';
  if current_rev='QUESTIONS-TAXV3-A16-20260818-R1' then
    raise exception 'La migración TAXV3-A16-20260818 ya está aplicada (dataset_revision=%).', current_rev;
  end if;
end $$;

-- Verificación final de staging dentro de la misma transacción.
do $$
declare nq int; nt int; na int; nr int; norphan int; nsum int;
begin
  select count(*) into nq from residentado_stage.tax_v3_a16_question_patch where batch_id='TAXV3-A16-20260818';
  select count(*) into nt from residentado_stage.tax_v3_a16_active_topics where batch_id='TAXV3-A16-20260818';
  select count(*) into na from residentado_stage.tax_v3_a16_aliases where batch_id='TAXV3-A16-20260818';
  select count(*) into nr from residentado_stage.tax_v3_a16_relations where batch_id='TAXV3-A16-20260818';
  select coalesce(sum((payload->>'n_questions')::int),0) into nsum from residentado_stage.tax_v3_a16_active_topics where batch_id='TAXV3-A16-20260818';
  select count(*) into norphan
  from residentado_stage.tax_v3_a16_question_patch q
  left join residentado_stage.tax_v3_a16_active_topics t on t.batch_id=q.batch_id and t.entity_id=q.payload->>'rentability_topic_id'
  where q.batch_id='TAXV3-A16-20260818' and t.entity_id is null;
  if nq<>2180 or nt<>287 or na<>291 or nr<>18 or nsum<>2180 or norphan<>0 then
    raise exception 'Staging inválido: q=% topics=% aliases=% relations=% membership=% orphan=%',nq,nt,na,nr,nsum,norphan;
  end if;
end $$;

-- Backups fuera de public: no quedan expuestos por PostgREST/RLS.
-- Si hubo un rollback previo y se reintenta la migración, renovar el snapshot con el estado V2 restaurado.
drop table if exists residentado_backup.tax_v3_a16_questions_before;
drop table if exists residentado_backup.tax_v3_a16_topics_before;
drop table if exists residentado_backup.tax_v3_a16_manifest_before;
drop table if exists residentado_backup.tax_v3_a16_aliases_before;
drop table if exists residentado_backup.tax_v3_a16_relations_before;
create table residentado_backup.tax_v3_a16_questions_before as select * from public.questions;
create table residentado_backup.tax_v3_a16_topics_before as select * from public.rentability_topics;
create table residentado_backup.tax_v3_a16_manifest_before as select * from public.app_dataset_versions where dataset_key='questions';
create table residentado_backup.tax_v3_a16_aliases_before as select * from public.taxonomy_topic_aliases;
create table residentado_backup.tax_v3_a16_relations_before as select * from public.taxonomy_topic_relations;

-- 1) Crear los 29 topics nuevos. Los 258 retenidos se actualizan en el paso siguiente.
insert into public.rentability_topics
select (jsonb_populate_record(null::public.rentability_topics, s.payload)).*
from residentado_stage.tax_v3_a16_active_topics s
where s.batch_id='TAXV3-A16-20260818'
  and not exists (select 1 from public.rentability_topics t where t.id=s.entity_id);

-- 2) Actualizar los 287 activos con el catálogo A16, preservando columnas históricas no incluidas en A16.
with src as (
  select s.entity_id, jsonb_populate_record(t, s.payload) rec
  from residentado_stage.tax_v3_a16_active_topics s
  join public.rentability_topics t on t.id=s.entity_id
  where s.batch_id='TAXV3-A16-20260818'
)
update public.rentability_topics t set
      label=(src.rec).label,
      canonical_area=(src.rec).canonical_area,
      main_specialty=(src.rec).main_specialty,
      n_questions=(src.rec).n_questions,
      n_validated_questions=(src.rec).n_validated_questions,
      n_observed_questions=(src.rec).n_observed_questions,
      n_entities=(src.rec).n_entities,
      n_tested_aspects=(src.rec).n_tested_aspects,
      n_cognitive_operations=(src.rec).n_cognitive_operations,
      n_years=(src.rec).n_years,
      years_asked=(src.rec).years_asked,
      n_recent_years=(src.rec).n_recent_years,
      recent_years=(src.rec).recent_years,
      tests_ab_presence=(src.rec).tests_ab_presence,
      historical_frequency_score=(src.rec).historical_frequency_score,
      recurrence_across_years_score=(src.rec).recurrence_across_years_score,
      recency_score=(src.rec).recency_score,
      transferability_score=(src.rec).transferability_score,
      structural_pattern_score=(src.rec).structural_pattern_score,
      tests_ab_score=(src.rec).tests_ab_score,
      normative_priority_source_mean=(src.rec).normative_priority_source_mean,
      normative_priority_score=(src.rec).normative_priority_score,
      audit_reliability_adjustment=(src.rec).audit_reliability_adjustment,
      deterministic_subtotal=(src.rec).deterministic_subtotal,
      exam_rentability_score=(src.rec).exam_rentability_score,
      rentability_tier=(src.rec).rentability_tier,
      tier_confidence=(src.rec).tier_confidence,
      distance_to_nearest_tier_boundary=(src.rec).distance_to_nearest_tier_boundary,
      top_entities=(src.rec).top_entities,
      tested_aspects=(src.rec).tested_aspects,
      topic_origin=(src.rec).topic_origin,
      source_raw_topic_id=(src.rec).source_raw_topic_id,
      source_current_label=(src.rec).source_current_label,
      audit_decision_status=(src.rec).audit_decision_status,
      scope_note=(src.rec).scope_note,
      audit_rationale=(src.rec).audit_rationale,
      taxonomy_version=(src.rec).taxonomy_version,
      rentability_formula_version=(src.rec).rentability_formula_version,
      scoring_method=(src.rec).scoring_method,
      primary_path=(src.rec).primary_path,
      sample_band=(src.rec).sample_band,
      scoring_reliability_policy=(src.rec).scoring_reliability_policy,
      secondary_relation_count=(src.rec).secondary_relation_count,
      taxonomy_role=(src.rec).taxonomy_role,
      coverage_counting_rule=(src.rec).coverage_counting_rule,
      facet_model=(src.rec).facet_model,
      freeze_status=(src.rec).freeze_status,
      freeze_until=(src.rec).freeze_until,
      allowed_pre_exam_change=(src.rec).allowed_pre_exam_change,
      migration_status=(src.rec).migration_status,
      is_active=(src.rec).is_active,
      topic_status=(src.rec).topic_status,
      updated_at=(src.rec).updated_at
from src where t.id=src.entity_id;

-- 3) Deprecar los 16 IDs V2 distribuidos. No se borran físicamente.
update public.rentability_topics t
set is_active=false,
    topic_status='DEPRECATED_DISTRIBUTED',
    migration_status='TAXV3-A16-20260818',
    updated_at=now()
where t.id in (
  select payload->>'source_topic_id'
  from residentado_stage.tax_v3_a16_aliases
  where batch_id='TAXV3-A16-20260818' and payload->>'status'='DEPRECATED_DISTRIBUTED'
);

-- 4) Aplicar la membresía/labels/scoring A16 a las 2.180 preguntas sin cambiar sus IDs.
with src as (
  select s.entity_id, jsonb_populate_record(q, s.payload) rec
  from residentado_stage.tax_v3_a16_question_patch s
  join public.questions q on q.id=s.entity_id
  where s.batch_id='TAXV3-A16-20260818'
)
update public.questions q set
      canonical_area=(src.rec).canonical_area,
      canonical_specialty=(src.rec).canonical_specialty,
      rentability_topic_id=(src.rec).rentability_topic_id,
      rentability_topic_label=(src.rec).rentability_topic_label,
      rentability_topic_question_count=(src.rec).rentability_topic_question_count,
      rentability_topic_year_count=(src.rec).rentability_topic_year_count,
      rentability_topic_years=(src.rec).rentability_topic_years,
      exam_rentability_score=(src.rec).exam_rentability_score,
      rentability_tier=(src.rec).rentability_tier,
      rentability_formula_version=(src.rec).rentability_formula_version,
      taxonomy_version=(src.rec).taxonomy_version,
      topic_audit_action=(src.rec).topic_audit_action,
      topic_audit_status=(src.rec).topic_audit_status,
      taxonomy_review_required=(src.rec).taxonomy_review_required,
      taxonomy_review_reason=(src.rec).taxonomy_review_reason,
      taxonomy_source=(src.rec).taxonomy_source,
      personal_priority_status=(src.rec).personal_priority_status,
      score_confidence=(src.rec).score_confidence
from src where q.id=src.entity_id;

-- 5) Publicar aliases/deprecaciones y relaciones secundarias sin duplicar cobertura.
insert into public.taxonomy_topic_aliases
select (jsonb_populate_record(null::public.taxonomy_topic_aliases, payload)).*
from residentado_stage.tax_v3_a16_aliases where batch_id='TAXV3-A16-20260818'
on conflict(alias_id) do update set
  source_topic_id=excluded.source_topic_id, source_label=excluded.source_label, source_kind=excluded.source_kind,
  status=excluded.status, canonical_topic_id=excluded.canonical_topic_id, canonical_label=excluded.canonical_label,
  replacement_topic_ids=excluded.replacement_topic_ids, replacement_labels=excluded.replacement_labels,
  n_questions_before=excluded.n_questions_before, n_questions_final=excluded.n_questions_final,
  notes=excluded.notes, taxonomy_version=excluded.taxonomy_version, updated_at=excluded.updated_at;

insert into public.taxonomy_topic_relations
select (jsonb_populate_record(null::public.taxonomy_topic_relations, payload)).*
from residentado_stage.tax_v3_a16_relations where batch_id='TAXV3-A16-20260818'
on conflict(relation_id) do update set
  shared_canonical_entity=excluded.shared_canonical_entity, topic_id_a=excluded.topic_id_a, topic_label_a=excluded.topic_label_a,
  area_a=excluded.area_a, specialty_a=excluded.specialty_a, topic_id_b=excluded.topic_id_b, topic_label_b=excluded.topic_label_b,
  area_b=excluded.area_b, specialty_b=excluded.specialty_b, relation_type=excluded.relation_type,
  counting_rule=excluded.counting_rule, study_rule=excluded.study_rule, taxonomy_version=excluded.taxonomy_version, updated_at=excluded.updated_at;

-- 6) Controles de integridad ANTES del bump. Un fallo revierte toda la transacción.
do $$
declare
  nq int; nuq int; nta int; ntt int; norphan int; nsum int; nbadq int; nbadt int; ndepr int; nalias int; nrel int;
begin
  select count(*),count(distinct id) into nq,nuq from public.questions where active is true;
  select count(*) into nta from public.rentability_topics where is_active is true and topic_status not like 'DEPRECATED%';
  select count(*) into ntt from public.rentability_topics;
  select count(*) into norphan from public.questions q left join public.rentability_topics t on t.id=q.rentability_topic_id and t.is_active is true and t.topic_status not like 'DEPRECATED%' where q.active is true and t.id is null;
  select coalesce(sum(n_questions),0) into nsum from public.rentability_topics where is_active is true and topic_status not like 'DEPRECATED%';
  select count(*) into nbadq from public.questions where active is true and taxonomy_version<>'TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18';
  select count(*) into nbadt from public.rentability_topics where is_active is true and topic_status not like 'DEPRECATED%' and taxonomy_version<>'TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18';
  select count(*) into ndepr from public.rentability_topics where topic_status='DEPRECATED_DISTRIBUTED';
  select count(*) into nalias from public.taxonomy_topic_aliases where taxonomy_version='TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18';
  select count(*) into nrel from public.taxonomy_topic_relations where taxonomy_version='TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18';
  if nq<>2180 or nuq<>2180 or nta<>287 or ntt<>303 or norphan<>0 or nsum<>2180 or nbadq<>0 or nbadt<>0 or ndepr<>16 or nalias<>291 or nrel<>18 then
    raise exception 'Integridad V3 falló: q=% uq=% active_topics=% stored_topics=% orphan=% membership=% bad_q_tax=% bad_t_tax=% depr=% aliases=% rel=%',nq,nuq,nta,ntt,norphan,nsum,nbadq,nbadt,ndepr,nalias,nrel;
  end if;
end $$;

-- 7) Bump del manifiesto como ÚLTIMO cambio lógico del mismo COMMIT.
-- La WebApp v1.4.0 solo acepta el bundle cuando revision + 2180 questions + 287 active topics + taxonomy_version coinciden.
update public.app_dataset_versions
set dataset_revision='QUESTIONS-TAXV3-A16-20260818-R1',
    row_count=2180,
    metadata=jsonb_build_object(
      'taxonomy_version','TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18',
      'rentability_formula_version','RENTABILIDAD_TAX_AUD_FINAL_V3_LEGACY_EMULATION_2026-08-18',
      'question_row_count',2180,
      'active_topic_count',287,
      'stored_topic_count',303,
      'deprecated_topic_count',16,
      'alias_row_count',291,
      'secondary_relation_count',18,
      'coverage_counting_rule','EXCLUSIVE_PRIMARY_TOPIC_ONLY',
      'compatibility','V2_TO_V3_PRIMARY_TOPIC_STABLE_QUESTION_IDS',
      'source_package','TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014',
      'source_package_sha256','a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a',
      'release_id','REL-20260818-V1.4.0-TAXV3-A16',
      'freeze_until','2026-09-06'
    ),
    updated_at=now()
where dataset_key='questions';

insert into public.app_dataset_versions(dataset_key,dataset_revision,row_count,metadata,updated_at)
select 'questions','QUESTIONS-TAXV3-A16-20260818-R1',2180,jsonb_build_object(
      'taxonomy_version','TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18', 'rentability_formula_version','RENTABILIDAD_TAX_AUD_FINAL_V3_LEGACY_EMULATION_2026-08-18', 'question_row_count',2180,
      'active_topic_count',287, 'stored_topic_count',303, 'deprecated_topic_count',16, 'alias_row_count',291,
      'secondary_relation_count',18, 'coverage_counting_rule','EXCLUSIVE_PRIMARY_TOPIC_ONLY',
      'compatibility','V2_TO_V3_PRIMARY_TOPIC_STABLE_QUESTION_IDS', 'source_package','TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014',
      'source_package_sha256','a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a', 'release_id','REL-20260818-V1.4.0-TAXV3-A16', 'freeze_until','2026-09-06')::jsonb, now()
where not exists (select 1 from public.app_dataset_versions where dataset_key='questions');

commit;
