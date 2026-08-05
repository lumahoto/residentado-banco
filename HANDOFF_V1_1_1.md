# Handoff - Residentado v1.1.1

## Base obligatoria

- Continuar desde este paquete v1.1.1.
- No usar v1.1.0-rc2 como base ni restaurar SQLSTATE 40001.
- Mantener las fuentes clinicas canonicas post segunda auditoria del 4 de agosto de 2026.

## Invariantes

1. Todo conflicto de revision es PT409/HTTP 409, nunca 40xxx.
2. Un conflicto no entra en outbox como fallo offline.
3. Una revision remota superior nunca queda oculta por una sombra local inferior.
4. Antes de descartar estado local diferente se crea recuperacion con otro UUID.
5. Una misma sesion no se edita simultaneamente desde dos pestanas.
6. El cierre tambien valida state_revision.
7. CREATE_SESSION offline nunca usa upsert destructivo.
8. version.js es la fuente unica de version y nombre de cache.
9. Mi Estado sigue siendo calculo local.
10. El corpus completo solo se descarga si cambia el manifiesto o falla la cache.

## Archivos principales modificados

app.js, session-core.js, service-worker.js, index.html, version.js y la migracion PT409. Se agregaron changelog, incidente, validacion, QA y manifiesto.

## Pruebas para la siguiente version

Ejecutar python3 QA/qa_v1_1_1.py; repetir dos pestanas; forzar un conflicto controlado; confirmar una sola recuperacion; verificar ausencia de UPSERT_SESSION despues de PT409; probar cierre con revision obsoleta; comprobar que Mi Estado no emita consultas adicionales.

Versionado recomendado: v1.1.2 para correcciones y v1.2.0 para funciones nuevas.
