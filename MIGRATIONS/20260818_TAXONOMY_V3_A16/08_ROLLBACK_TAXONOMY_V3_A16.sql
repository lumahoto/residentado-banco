-- Residentado Médico Perú — Taxonomía V3 A16 (freeze)
-- Batch: TAXV3-A16-20260818
-- Taxonomy: TAXONOMIA_RENTABILIDAD_TAX_AUD_FINAL_V3_2026-08-18
-- Dataset revision objetivo: QUESTIONS-TAXV3-A16-20260818-R1
-- Fuente: TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014
-- SHA-256 fuente: a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a
-- NO ejecutar fuera del orden indicado en README.md.

-- ROLLBACK de datos V3 A16. Preserva intentos/sesiones/notas/flags; solo restaura corpus/topics/aliases/relations.
-- IMPORTANTE: el contenido vuelve al snapshot previo, pero el manifiesto publica una revisión NUEVA de rollback
-- para que clientes que ya descargaron V3 detecten también la reversión.
begin;
select pg_advisory_xact_lock(hashtext('TAXV3-A16-20260818'));

do $$
declare current_rev text;
begin
  select dataset_revision into current_rev from public.app_dataset_versions where dataset_key='questions';
  if current_rev is distinct from 'QUESTIONS-TAXV3-A16-20260818-R1' then
    raise exception 'Rollback rechazado: revisión actual esperada QUESTIONS-TAXV3-A16-20260818-R1, recibida %', current_rev;
  end if;

  if to_regclass('residentado_backup.tax_v3_a16_questions_before') is null
     or to_regclass('residentado_backup.tax_v3_a16_topics_before') is null
     or to_regclass('residentado_backup.tax_v3_a16_manifest_before') is null then
    raise exception 'No existen los backups requeridos para rollback TAXV3-A16-20260818.';
  end if;
end $$;

-- Restaurar QUESTIONS dinámicamente por columnas comunes, sin tocar IDs ni tablas de progreso.
do $$
declare set_clause text;
begin
  select string_agg(format('%I = b.%I', c.column_name,c.column_name), ', ' order by c.ordinal_position)
    into set_clause
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='questions' and c.column_name<>'id' and c.is_generated='NEVER'
    and exists (select 1 from information_schema.columns b where b.table_schema='residentado_backup' and b.table_name='tax_v3_a16_questions_before' and b.column_name=c.column_name);
  execute format('update public.questions q set %s from residentado_backup.tax_v3_a16_questions_before b where q.id=b.id', set_clause);
end $$;

-- Quitar únicamente topics añadidos por V3 y restaurar byte lógico/columnar de los 274 preexistentes.
delete from public.rentability_topics t
where not exists (select 1 from residentado_backup.tax_v3_a16_topics_before b where b.id=t.id);

do $$
declare set_clause text;
begin
  select string_agg(format('%I = b.%I', c.column_name,c.column_name), ', ' order by c.ordinal_position)
    into set_clause
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='rentability_topics' and c.column_name<>'id' and c.is_generated='NEVER'
    and exists (select 1 from information_schema.columns b where b.table_schema='residentado_backup' and b.table_name='tax_v3_a16_topics_before' and b.column_name=c.column_name);
  execute format('update public.rentability_topics t set %s from residentado_backup.tax_v3_a16_topics_before b where t.id=b.id', set_clause);
end $$;

-- Restaurar aliases/relaciones al estado previo al commit.
delete from public.taxonomy_topic_aliases;
insert into public.taxonomy_topic_aliases select * from residentado_backup.tax_v3_a16_aliases_before;
delete from public.taxonomy_topic_relations;
insert into public.taxonomy_topic_relations select * from residentado_backup.tax_v3_a16_relations_before;

-- Restaurar todos los campos del manifiesto desde el snapshot previo y, a continuación,
-- publicar una revisión NUEVA de rollback. Nunca se reutiliza silenciosamente la revisión anterior.
delete from public.app_dataset_versions where dataset_key='questions';
insert into public.app_dataset_versions select * from residentado_backup.tax_v3_a16_manifest_before;

update public.app_dataset_versions
set dataset_revision='QUESTIONS-ROLLBACK-TAXV3-A16-20260818-R1',
    row_count=2180,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'rollback_of','QUESTIONS-TAXV3-A16-20260818-R1',
      'rollback_batch','TAXV3-A16-20260818',
      'rollback_release_id','REL-20260818-V1.4.0-TAXV3-A16',
      'rollback_source_package','TAXONOMIA_META_AUDITORIA_FREEZE_A16_META-AUD-014',
      'rollback_source_package_sha256','a759bd56e7a7170989e54f2d31baacc483274abcc4a8e5a0c25a4e2608e1ee7a',
      'rollback_restores_snapshot',true,
      'rollback_published_at',now()
    ),
    updated_at=now()
where dataset_key='questions';

-- Integridad de rollback: 2.180 IDs de pregunta, mismo catálogo del backup, cero huérfanos
-- y revisión de rollback única/publicada.
do $$
declare nq int; nuq int; nt int; ntb int; norphan int; nmanifest int; rev text;
begin
  select count(*),count(distinct id) into nq,nuq from public.questions;
  select count(*) into nt from public.rentability_topics;
  select count(*) into ntb from residentado_backup.tax_v3_a16_topics_before;
  select count(*) into norphan
    from public.questions q
    left join public.rentability_topics t on t.id=q.rentability_topic_id
    where q.rentability_topic_id is null or t.id is null;
  select count(*),max(dataset_revision) into nmanifest,rev
    from public.app_dataset_versions where dataset_key='questions';
  if nq<>2180 or nuq<>2180 or nt<>ntb or norphan<>0 or nmanifest<>1
     or rev<>'QUESTIONS-ROLLBACK-TAXV3-A16-20260818-R1' then
    raise exception 'Rollback incompleto: q=% uq=% topics=% backup_topics=% orphan=% manifest_rows=% revision=%',
      nq,nuq,nt,ntb,norphan,nmanifest,rev;
  end if;
end $$;

commit;

-- Tras rollback, al siguiente inicio online la WebApp detectará QUESTIONS-ROLLBACK-TAXV3-A16-20260818-R1
-- como una revisión nueva y recargará automáticamente el bundle V2 restaurado.
