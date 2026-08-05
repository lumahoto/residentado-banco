# INC-20260805-SESSION-40001

## Resumen

Durante v1.1.0-rc2, Supabase registro millones de errores PostgreSQL con pocas solicitudes API. Al cerrar las pestaanas de la webapp, los errores cesaron.

## Evidencia

- PostgREST 14.5, backend cliente, RPC save_practice_session_state.
- Mensaje SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE.
- SQLSTATE anterior 40001, lanzado cuando status no era active o state_revision no coincidia.
- Sesion remota preservada: revision 109 y 39/94 preguntas.
- La prueba de cinco minutos sin webapps no genero nuevos errores ni llamadas.

## Causa raiz

Se uso un codigo de aborto/reintento transaccional para un conflicto funcional normal. Una solicitud podia repetirse internamente hasta cancelarse al cerrar la pestaana.

## Factores contribuyentes

1. Una sombra local conflictiva podia ocultar una revision remota superior.
2. La revision obsoleta se guardaba otra vez en la outbox.
3. No habia exclusion entre pestanas.
4. Varias acciones solicitaban guardado inmediato y los eventos de salida podian duplicarlo.

## Contencion y cierre

La funcion activa fue reemplazada por PT409. La verificacion devolvio usa_pt409=true y elimino_40001=true. v1.1.1 agrega recuperacion, leases, control de cierre y guardados consolidados.

No se atribuyo el incidente al disco, a Mi Estado ni a la cache del corpus. No se observo evidencia de corrupcion del banco.
