-- REL-20260805-V1.1.1
-- FIX-SESSION-001
-- Reemplaza el uso incorrecto de SQLSTATE 40001 por PT409 (HTTP 409).
-- Idempotente: puede ejecutarse nuevamente sin alterar datos.

begin;

create or replace function public.save_practice_session_state(
  p_session_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_config jsonb,
  p_answered_count integer,
  p_active_time_ms bigint,
  p_paused_time_ms bigint,
  p_client_app_version text,
  p_state_schema_version integer default 1
)
returns public.practice_sessions
language plpgsql
volatile
security invoker
set search_path to 'public'
as $function$
declare
  v_row public.practice_sessions;
begin
  if p_answered_count < 0
     or p_active_time_ms < 0
     or p_paused_time_ms < 0 then
    raise exception 'INVALID_SESSION_COUNTERS'
      using errcode = '22023';
  end if;

  update public.practice_sessions
  set
    state = coalesce(p_state, '{}'::jsonb),
    config = coalesce(p_config, config),
    answered_count = least(greatest(p_answered_count, 0), planned_count),
    active_time_ms = p_active_time_ms,
    paused_time_ms = p_paused_time_ms,
    client_app_version = p_client_app_version,
    state_schema_version = greatest(coalesce(p_state_schema_version, 1), 1),
    state_revision = state_revision + 1,
    last_synced_at = now(),
    updated_at = now()
  where id = p_session_id
    and user_id = (select auth.uid())
    and status = 'active'
    and state_revision = p_expected_revision
  returning * into v_row;

  if not found then
    raise sqlstate 'PT409'
      using
        message = 'SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE',
        detail = 'La sesión no está activa o la revisión esperada está desactualizada.',
        hint = 'Recargar la versión vigente de la sesión antes de volver a guardar.';
  end if;

  return v_row;
end;
$function$;

comment on function public.save_practice_session_state(
  uuid,
  bigint,
  jsonb,
  jsonb,
  integer,
  bigint,
  bigint,
  text,
  integer
) is
'Guarda estado de sesión mediante control optimista de revisión. Los conflictos funcionales retornan HTTP 409 mediante PT409. Hotfix v1.1.1, 2026-08-05.';

commit;

notify pgrst, 'reload schema';
