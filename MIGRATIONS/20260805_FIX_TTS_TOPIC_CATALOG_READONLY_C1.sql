-- Residentado Médico Perú — corrección C1 de permisos del catálogo TTS V061
-- Fecha: 2026-08-05
-- Objetivo: dejar public.tts_topic_catalog en solo lectura para usuarios autenticados.
-- Seguridad: no elimina filas, no modifica contenido clínico ni altera otras tablas.
-- Idempotente: puede ejecutarse más de una vez.

begin;

-- Retirar privilegios heredados o concedidos previamente a roles cliente.
-- REVOKE no elimina datos ni políticas RLS.
revoke all privileges on table public.tts_topic_catalog from public;
revoke all privileges on table public.tts_topic_catalog from anon;
revoke all privileges on table public.tts_topic_catalog from authenticated;

-- Restituir únicamente la lectura necesaria para la webapp autenticada.
grant select on table public.tts_topic_catalog to authenticated;

-- Asegurar RLS y una única política de lectura conocida.
alter table public.tts_topic_catalog enable row level security;

drop policy if exists tts_topic_catalog_read_authenticated
  on public.tts_topic_catalog;

create policy tts_topic_catalog_read_authenticated
  on public.tts_topic_catalog
  for select
  to authenticated
  using (true);

-- Defensa adicional: retirar políticas de escritura con nombres previsibles
-- si alguna prueba o ejecución previa las hubiera creado. Estas sentencias
-- no afectan filas ni la política de lectura.
drop policy if exists tts_topic_catalog_insert_authenticated
  on public.tts_topic_catalog;
drop policy if exists tts_topic_catalog_update_authenticated
  on public.tts_topic_catalog;
drop policy if exists tts_topic_catalog_delete_authenticated
  on public.tts_topic_catalog;
drop policy if exists tts_topic_catalog_write_authenticated
  on public.tts_topic_catalog;

comment on table public.tts_topic_catalog is
  'Catálogo separado del banco clínico: disponibilidad TTS por tema. Solo lectura para authenticated; escritura reservada a administración/migraciones.';

commit;
