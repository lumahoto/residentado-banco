-- Residentado Médico Perú — Taxonomía V3 A16 (freeze)
-- Batch: TAXV3-A16-20260818
-- Taxonomy: TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18
-- Dataset revision objetivo: QUESTIONS-TAXV3-A16-20260818-R1
-- Fuente: TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014
-- SHA-256 fuente: a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a
-- NO ejecutar fuera del orden indicado en README.md.

begin;

create schema if not exists residentado_stage;
create schema if not exists residentado_backup;

-- Campos aditivos de compatibilidad V3. Los datos V2 siguen siendo válidos hasta el COMMIT.
alter table public.questions add column if not exists score_confidence text;

alter table public.rentability_topics add column if not exists is_active boolean not null default true;
alter table public.rentability_topics add column if not exists topic_status text not null default 'ACTIVE';
alter table public.rentability_topics add column if not exists normative_priority_source_mean numeric;
alter table public.rentability_topics add column if not exists deterministic_subtotal numeric;
alter table public.rentability_topics add column if not exists tier_confidence text;
alter table public.rentability_topics add column if not exists distance_to_nearest_tier_boundary numeric;
alter table public.rentability_topics add column if not exists topic_origin text;
alter table public.rentability_topics add column if not exists source_raw_topic_id text;
alter table public.rentability_topics add column if not exists source_current_label text;
alter table public.rentability_topics add column if not exists audit_decision_status text;
alter table public.rentability_topics add column if not exists scope_note text;
alter table public.rentability_topics add column if not exists audit_rationale text;
alter table public.rentability_topics add column if not exists scoring_method text;
alter table public.rentability_topics add column if not exists primary_path text;
alter table public.rentability_topics add column if not exists sample_band text;
alter table public.rentability_topics add column if not exists scoring_reliability_policy text;
alter table public.rentability_topics add column if not exists secondary_relation_count integer;
alter table public.rentability_topics add column if not exists taxonomy_role text;
alter table public.rentability_topics add column if not exists coverage_counting_rule text;
alter table public.rentability_topics add column if not exists facet_model text;
alter table public.rentability_topics add column if not exists freeze_status text;
alter table public.rentability_topics add column if not exists freeze_until date;
alter table public.rentability_topics add column if not exists allowed_pre_exam_change text;
alter table public.rentability_topics add column if not exists migration_status text;

create table if not exists public.taxonomy_topic_aliases (
  alias_id text primary key,
  source_topic_id text not null,
  source_label text,
  source_kind text,
  status text not null,
  canonical_topic_id text,
  canonical_label text,
  replacement_topic_ids text[] not null default '{}',
  replacement_labels text[] not null default '{}',
  n_questions_before integer,
  n_questions_final integer,
  notes text,
  taxonomy_version text not null,
  updated_at timestamptz not null default now()
);
create index if not exists taxonomy_topic_aliases_source_id_idx on public.taxonomy_topic_aliases(source_topic_id);
create index if not exists taxonomy_topic_aliases_source_label_idx on public.taxonomy_topic_aliases(source_label);
alter table public.taxonomy_topic_aliases enable row level security;
drop policy if exists taxonomy_topic_aliases_read_authenticated on public.taxonomy_topic_aliases;
create policy taxonomy_topic_aliases_read_authenticated on public.taxonomy_topic_aliases for select to authenticated using (true);
revoke all privileges on table public.taxonomy_topic_aliases from anon, authenticated;
grant select on table public.taxonomy_topic_aliases to authenticated;

create table if not exists public.taxonomy_topic_relations (
  relation_id text primary key,
  shared_canonical_entity text not null,
  topic_id_a text not null,
  topic_label_a text,
  area_a text,
  specialty_a text,
  topic_id_b text not null,
  topic_label_b text,
  area_b text,
  specialty_b text,
  relation_type text not null,
  counting_rule text not null,
  study_rule text,
  taxonomy_version text not null,
  updated_at timestamptz not null default now()
);
alter table public.taxonomy_topic_relations enable row level security;
drop policy if exists taxonomy_topic_relations_read_authenticated on public.taxonomy_topic_relations;
create policy taxonomy_topic_relations_read_authenticated on public.taxonomy_topic_relations for select to authenticated using (true);
revoke all privileges on table public.taxonomy_topic_relations from anon, authenticated;
grant select on table public.taxonomy_topic_relations to authenticated;

create table if not exists residentado_stage.tax_v3_a16_question_patch (
  batch_id text not null,
  entity_id text not null,
  payload jsonb not null,
  primary key (batch_id, entity_id)
);
create table if not exists residentado_stage.tax_v3_a16_active_topics (
  batch_id text not null,
  entity_id text not null,
  payload jsonb not null,
  primary key (batch_id, entity_id)
);
create table if not exists residentado_stage.tax_v3_a16_aliases (
  batch_id text not null,
  entity_id text not null,
  payload jsonb not null,
  primary key (batch_id, entity_id)
);
create table if not exists residentado_stage.tax_v3_a16_relations (
  batch_id text not null,
  entity_id text not null,
  payload jsonb not null,
  primary key (batch_id, entity_id)
);
create table if not exists residentado_stage.tax_v3_a16_user_sentinels (
  batch_id text not null,
  table_name text not null,
  row_count bigint not null,
  captured_at timestamptz not null default now(),
  primary key(batch_id, table_name)
);

-- Captura conteos de tablas de progreso si existen. No se copia contenido de usuario.
delete from residentado_stage.tax_v3_a16_user_sentinels where batch_id = 'TAXV3-A16-20260818';
do $$
declare t text; n bigint;
begin
  foreach t in array array['attempts','practice_sessions','question_review_flags','question_learning_notes','question_memory_state','user_learning_profile'] loop
    if to_regclass('public.'||t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      insert into residentado_stage.tax_v3_a16_user_sentinels(batch_id,table_name,row_count)
      values ('TAXV3-A16-20260818',t,n);
    end if;
  end loop;
end $$;

commit;
