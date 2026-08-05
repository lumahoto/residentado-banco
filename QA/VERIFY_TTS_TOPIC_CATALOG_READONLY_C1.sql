-- Verificación posterior — catálogo TTS V061 C1 en solo lectura

-- 1) El contenido debe permanecer intacto.
select
  count(*) filter (where status='COMPLETE') as tts_disponibles,
  count(distinct rentability_topic_id) as temas_con_tts,
  min(primary_code) as primer_tts,
  max(primary_code) as ultimo_tts,
  max(catalog_version) as catalogo,
  max(reviewed_as_of) as revision_mas_reciente
from public.tts_topic_catalog;

-- 2) Privilegios efectivos del rol usado por la webapp.
select
  has_table_privilege('authenticated','public.tts_topic_catalog','SELECT') as authenticated_puede_leer,
  has_table_privilege('authenticated','public.tts_topic_catalog','INSERT') as authenticated_puede_insertar,
  has_table_privilege('authenticated','public.tts_topic_catalog','UPDATE') as authenticated_puede_actualizar,
  has_table_privilege('authenticated','public.tts_topic_catalog','DELETE') as authenticated_puede_eliminar,
  has_table_privilege('authenticated','public.tts_topic_catalog','TRUNCATE') as authenticated_puede_truncar,
  has_table_privilege('authenticated','public.tts_topic_catalog','REFERENCES') as authenticated_puede_referenciar,
  has_table_privilege('authenticated','public.tts_topic_catalog','TRIGGER') as authenticated_puede_crear_trigger;

-- 3) Políticas RLS. Debe existir solo SELECT para authenticated y ninguna de escritura.
select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname='public'
  and tablename='tts_topic_catalog'
order by policyname;

-- 4) Resumen PASS/FAIL automático.
with privilege_check as (
  select
    has_table_privilege('authenticated','public.tts_topic_catalog','SELECT') as can_select,
    has_table_privilege('authenticated','public.tts_topic_catalog','INSERT') as can_insert,
    has_table_privilege('authenticated','public.tts_topic_catalog','UPDATE') as can_update,
    has_table_privilege('authenticated','public.tts_topic_catalog','DELETE') as can_delete,
    has_table_privilege('authenticated','public.tts_topic_catalog','TRUNCATE') as can_truncate,
    has_table_privilege('authenticated','public.tts_topic_catalog','REFERENCES') as can_references,
    has_table_privilege('authenticated','public.tts_topic_catalog','TRIGGER') as can_trigger
), policy_check as (
  select
    count(*) filter (
      where cmd='SELECT'
        and 'authenticated'=any(roles)
    ) as select_policies,
    count(*) filter (where cmd in ('INSERT','UPDATE','DELETE','ALL')) as write_policies
  from pg_policies
  where schemaname='public'
    and tablename='tts_topic_catalog'
)
select
  case
    when p.can_select
      and not p.can_insert
      and not p.can_update
      and not p.can_delete
      and not p.can_truncate
      and not p.can_references
      and not p.can_trigger
      and r.select_policies=1
      and r.write_policies=0
    then 'PASS'
    else 'FAIL'
  end as control_solo_lectura,
  p.*,
  r.select_policies,
  r.write_policies
from privilege_check p
cross join policy_check r;
