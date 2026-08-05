-- Verificación posterior — catálogo TTS V061
select
  count(*) filter (where status='COMPLETE') as tts_disponibles,
  count(distinct rentability_topic_id) as temas_con_tts,
  min(primary_code) as primer_tts,
  max(primary_code) as ultimo_tts,
  max(catalog_version) as catalogo,
  max(reviewed_as_of) as revision_mas_reciente
from public.tts_topic_catalog;

select rentability_tier, count(*) as tts_disponibles
from public.tts_topic_catalog
where status='COMPLETE'
group by rentability_tier
order by case rentability_tier when 'MUY_ALTA' then 1 when 'ALTA' then 2 when 'MEDIA' then 3 when 'BAJA' then 4 else 5 end;

select primary_code, rentability_topic_id, topic_label, status, part_count, tts_version, catalog_version
from public.tts_topic_catalog
order by primary_code desc
limit 10;

select count(*) as topic_ids_sin_correspondencia
from public.tts_topic_catalog t
where not exists (
  select 1 from public.questions q
  where q.rentability_topic_id=t.rentability_topic_id
);

select
  has_table_privilege('authenticated','public.tts_topic_catalog','SELECT') as authenticated_puede_leer,
  has_table_privilege('authenticated','public.tts_topic_catalog','INSERT') as authenticated_puede_insertar,
  has_table_privilege('authenticated','public.tts_topic_catalog','UPDATE') as authenticated_puede_actualizar,
  has_table_privilege('authenticated','public.tts_topic_catalog','DELETE') as authenticated_puede_eliminar;
