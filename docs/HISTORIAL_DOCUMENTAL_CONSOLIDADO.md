# Historial documental consolidado

Este archivo conserva literalmente los documentos Markdown retirados de la raíz durante la limpieza estructural de v1.3.1. Cada sección indica el nombre original. Para la operación actual prevalecen `README.md`, `CHANGELOG.md`, `RELEASE_MANIFEST.json`, las migraciones y las pruebas vigentes.

Los originales individuales también se conservan en el ZIP histórico entregado junto con el repositorio limpio.


---

## Archivo original: `00_LEER_PRIMERO_V1_1_1.md`

# LEER PRIMERO - v1.1.1

1. No borres IndexedDB ni datos del sitio antes de recuperar la sesion de RC2.
2. El hotfix PT409 ya fue aplicado y verificado; la migracion incluida es idempotente.
3. Publica todos los archivos, incluido version.js.
4. Recarga dos veces y confirma v1.1.1.
5. Abre inicialmente una sola pestana y ejecuta el smoke test de VALIDACION_V1_1_1.md.
6. Usa HANDOFF_V1_1_1.md para continuar las mejoras en otro chat.

---

## Archivo original: `00_LEER_PRIMERO_V1_2_0.md`

# LEER PRIMERO — Residentado v1.2.0

Esta versión debe publicarse **sobre v1.1.1**, no sobre v1.1.0-rc2 ni sobre v1.1.0-rc3.

1. Conserva una copia del despliegue v1.1.1 y no borres IndexedDB, caché ni datos locales.
2. El hotfix PT409 de v1.1.1 debe permanecer aplicado. No restaures SQLSTATE 40001.
3. Ejecuta una sola vez `MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql` en Supabase.
4. Publica **todos** los archivos, incluido `version.js`.
5. Recarga dos veces; si la webapp está instalada como PWA, ciérrala por completo y vuelve a abrirla.
6. Confirma que la interfaz muestre `v1.2.0`.
7. Prueba una nota, una revisión parcial y la numeración de Cobertura antes de continuar el estudio normal.

Las notas son independientes de los flags de auditoría y no modifican respuestas, memoria, sesiones ni preguntas.

---

## Archivo original: `00_LEER_PRIMERO_V1_3_0.md`

# LEER PRIMERO — Residentado v1.3.0

Esta versión debe publicarse **sobre Residentado v1.2.0**. La base utilizada fue el ZIP actualizado `260805_residentado-banco-main.zip`, no el ZIP antiguo v1.1.1.

## Estado previo confirmado

- `public.tts_topic_catalog`: 89 TTS disponibles, TTS_001–089.
- 89 `rentability_topic_id` con correspondencia canónica.
- RLS activo.
- Rol `authenticated`: `SELECT=true`; `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER=false`.
- Políticas: 1 de lectura y 0 de escritura.
- Control de solo lectura: `PASS`.

## Publicación

1. Conserva una copia del despliegue v1.2.0.
2. No borres IndexedDB, caché, almacenamiento local, sesiones ni progreso.
3. No necesitas ejecutar otra migración de Supabase: el catálogo y su corrección C1 ya fueron aplicados y verificados.
4. Publica **todos** los archivos de este paquete, incluido `version.js`, `service-worker.js`, `app.js`, `w4-data.js` y `tts_catalog.json`.
5. Recarga dos veces. Si la app está instalada como PWA, ciérrala por completo y vuelve a abrirla.
6. Confirma que la interfaz muestre `v1.3.0`.
7. Abre **Mi Estado → Cobertura canónica** y confirma:
   - columna `TTS`;
   - 89 TTS disponibles;
   - códigos TTS_001–089 donde corresponda;
   - `Pendiente` en los demás temas.
8. Abre **Tu mapa actual de debilidades** y confirma que usa la misma disponibilidad.

## Comportamiento de seguridad

La webapp consulta el catálogo TTS una sola vez al sincronizar la cuenta. Después, ambas vistas trabajan con el mapa local en memoria. No se realizan consultas por fila ni al cambiar el orden o la vista.

Si Supabase no responde o devuelve una tabla vacía por error, se conserva el respaldo local V061 con 274 temas y 89 TTS disponibles.

---

## Archivo original: `00_LEER_PRIMERO_V1_3_1.md`

# Residentado v1.3.1 — exportación autosuficiente para auditoría y parche

**Fecha:** 6 de agosto de 2026  
**Base:** Residentado v1.3.0 del ZIP `260806_v130_residentado-banco-main(1).zip`  
**SHA-256 de la base recibida:** `2ef803ee51e256aaa72c0632d540d030500373e82e79def7a7c4d63299a33bc9`

## Cambio funcional

En **Preguntas para revisar → Pendientes**, la interfaz muestra un único botón:

`Exportar CSV completo para auditoría y parche`

Al pulsarlo, la aplicación:

1. toma los flags visibles según el filtro activo;
2. consulta directamente a Supabase las filas completas actuales de `public.question_review_flags`;
3. consulta directamente a Supabase las filas completas actuales de `public.questions`;
4. valida que no falte ningún flag ni ninguna pregunta;
5. genera un único CSV con todas las columnas detectadas dinámicamente;
6. prefija las columnas con `flag__` y `question__`;
7. incorpora metadatos `export__*`, incluyendo versión, lote, fuente, conteos, revisión, hash y fecha;
8. declara `export__source = SUPABASE_AUTHORITATIVE`.

No existe fallback silencioso a caché local. Si no hay conexión autenticada o la respuesta es incompleta, la aplicación no descarga el archivo.

## Publicación

1. Respaldar el despliegue v1.3.0.
2. Publicar todos los archivos de esta entrega.
3. No ejecutar migraciones nuevas: v1.3.1 no requiere cambios en Supabase.
4. Recargar dos veces; si es PWA, cerrarla y abrirla nuevamente.
5. Confirmar visualmente `v1.3.1`.
6. Marcar una pregunta de prueba y exportar el CSV.
7. Verificar que el nombre empiece por `residentado_revision_para_patch_`.
8. Abrir el CSV y confirmar columnas `export__source`, `flag__id`, `question__id`, `question__record_version` y `question__content_sha256`.
9. Confirmar que `export__source` sea `SUPABASE_AUTHORITATIVE` y `export__is_complete` sea `SI`.

## Archivos necesarios para que la WebApp funcione

Estos archivos o carpetas sí forman parte del runtime publicado:

- `index.html`
- `version.js`
- `styles.css`
- `app.js`
- `session-core.js`
- `session-storage.js`
- `question-parser.js`
- `w3-tools.js`
- `w4-data.js`
- `config.js`
- `pilot-data.js`
- `tts_catalog.json`
- `service-worker.js`
- `manifest.webmanifest`
- `icons/`
- `assets/questions/`

## Archivos que no ejecuta la WebApp

Los siguientes tipos no son cargados por `index.html` ni por el service worker y no afectan la ejecución ordinaria:

- documentos `.md`;
- manifiestos y checksums históricos;
- archivos `.diff`;
- `QA/`;
- `MIGRATIONS/` y SQL históricos;
- CSV/XLSX piloto;
- scripts de esquema, seed y setup de Supabase.

Sin embargo, varios conservan decisiones, pruebas, migraciones, rollback conceptual y trazabilidad. Por ello **v1.3.1 no elimina ni mueve archivos históricos**. La limpieza del repositorio debe hacerse como una tarea separada, preferentemente moviendo documentación antigua a `docs/archive/` o conservándola en GitHub Releases, con un índice que mantenga los enlaces y la secuencia de versiones.

## Guardrails preservados

- PT409/HTTP 409 para conflictos de sesión;
- recuperación no destructiva;
- lease entre pestañas;
- `CREATE_SESSION` mediante inserción;
- Mi Estado calculado localmente;
- catálogo TTS leído una vez y conservado en memoria;
- separación entre flags y notas personales;
- `session-core.js` y `session-storage.js` preservados byte por byte.

---

## Archivo original: `ADENDA_CONTEXTO_WEBAPP_V1_2_0.md`

# Adenda de precedencia — Webapp Residentado v1.2.0

Esta adenda reemplaza cualquier referencia que considere v1.0.0, v1.1.0-rc2, v1.1.0-rc3 o v1.1.1 como versión funcional vigente de la webapp.

## Versión vigente

- Aplicación: Residentado v1.2.0.
- Base técnica: v1.1.1.
- Fuente única de versión/caché: `version.js`.
- Caché: `residentado-v1-2-0`.
- Corpus y taxonomía: sin cambios; siguen vigentes las fuentes canónicas post segunda auditoría del 4 de agosto de 2026.

## Nuevas reglas

- Las notas personales de aprendizaje no son flags de auditoría.
- Se almacenan en `question_learning_notes` y pueden coexistir con un flag sobre la misma pregunta.
- Su objetivo es exportar vacíos personales, resolverlos y deduplicarlos contra la exportación Anki más reciente.
- No toda nota produce tarjeta.
- Las tarjetas nuevas se ordenan por rentabilidad y prioridad personal; si el tema ya fue iniciado, se priorizan entre las primeras nuevas del tier. La colocación junto a tarjetas relacionadas requiere `.colpkg` actualizado y verificación segura.
- Las tarjetas existentes conservan GUID, programación e historial.
- Mi Estado continúa calculándose localmente.

## Precedencia técnica

Las correcciones de v1.1.1 sobre PT409, recuperación de sesiones, lease entre pestañas, cierre optimista, outbox y caché no pueden eliminarse al continuar el desarrollo.

---

## Archivo original: `ADENDA_CONTEXTO_WEBAPP_V1_3_0.md`

# ADENDA DE PRECEDENCIA — WEBAPP v1.3.0 Y CATÁLOGO TTS EN SUPABASE

Fecha: 5 de agosto de 2026.

Esta adenda actualiza únicamente la relación entre TTS, Supabase y la webapp. Conserva las reglas clínicas, editoriales, Anki, sesiones y notas del Contexto Maestro A12.

## Estado autoritativo

1. La versión funcional vigente pasa a ser **Residentado v1.3.0**.
2. La base directa es Residentado v1.2.0 del archivo `260805_residentado-banco-main.zip`.
3. Se conserva la base técnica de seguridad v1.1.1 y todos sus guardrails PT409.
4. El catálogo TTS vigente al release es V061: TTS_001–089, 89 de 274 temas.
5. `public.tts_topic_catalog` queda como fuente autoritativa online de disponibilidad TTS.
6. El catálogo es solo lectura para `authenticated`: SELECT permitido; escritura, truncado, referencias y triggers denegados; 1 política SELECT y 0 políticas de escritura.

## Comportamiento de la webapp

1. La app carga primero un respaldo local V061 con 274 temas y 89 disponibles.
2. Después de autenticar, consulta una sola vez `tts_topic_catalog`.
3. No realiza consultas por fila ni al abrir, ordenar o agrupar Cobertura canónica.
4. Si Supabase falla o responde vacío, conserva el respaldo local.
5. **Tu mapa actual de debilidades** y **Mi Estado → Cobertura canónica** consumen el mismo mapa local por `rentability_topic_id`.
6. Cobertura canónica muestra una columna TTS y la vista agrupada informa cuántos TTS existen por especialidad.
7. El detalle de tema muestra el estado TTS y permite copiar un pedido de suplemento o creación.
8. La webapp no puede insertar, actualizar ni eliminar registros TTS.

## Continuidad

Las futuras lecturas pueden incorporarse administrativamente a `tts_topic_catalog`; aparecerán en la webapp después de recargar sin requerir una nueva versión frontend. El respaldo local debe actualizarse en releases posteriores cuando se quiera equivalencia offline con el catálogo online.

---

## Archivo original: `HANDOFF_AUDITORIA_TOTAL_POST_V1_0_0.md`

# Handoff para auditoría total posterior a Residentado v1.0.0

La webapp está funcionalmente congelada. El siguiente chat debe trabajar principalmente sobre datos, no sobre interfaz.

## Fuentes canónicas

1. PDF oficial 2015–2025.
2. `BANCO_MAESTRO_CANONICO_V0721_TAXONOMIA_V2_5_2180.csv`.
3. `DICCIONARIO_TEMAS_RENTABILIDAD_V2_5_274.csv`.
4. Contexto maestro V0721.
5. Exportación nueva de flags `OPEN` desde la webapp v1.0.0.

## Regla de trazabilidad

Cada tanda aprobada debe recibir un identificador único, por ejemplo:

```text
DBPATCH-2026-07-24-01
```

Después de ejecutar y verificar el parche, registrar ese identificador en el flag mediante **Registrar parche**. No borrar el registro histórico.

## Prioridad de auditoría

1. Posible clave errónea.
2. Pregunta desactualizada o ambigua.
3. Explicación deficiente o tautológica.
4. Punto de corte, criterio diagnóstico, clasificación, escala, dosis o algoritmo preguntado.
5. Fármacos, antibióticos, antídotos, mecanismos, toxicidades y contraindicaciones.
6. Taxonomía, imagen y formato.

Dentro de cada grupo:

```text
MUY_ALTA → ALTA → MEDIA → BAJA
```

Luego priorizar errores personales, `No sé`, dudas `?`, lentitud y repetición histórica.

## Salidas esperadas de cada tanda

- SQL transaccional e idempotente;
- verificación antes/después;
- lista de preguntas modificadas;
- identificador del parche;
- exportación actualizada de `questions` y `rentability_topics` cuando corresponda;
- candidatos Anki deduplicados con tipo de dato:
  - punto de corte;
  - criterio diagnóstico;
  - clasificación;
  - escala;
  - algoritmo;
  - dosis;
  - antídoto;
  - valor normal;
  - mecanismo farmacológico.

No volver a desarrollar nuevas funciones de la app salvo error funcional real.

---

## Archivo original: `HANDOFF_V1_1_1.md`

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

---

## Archivo original: `HANDOFF_V1_2_0.md`

# Handoff — Residentado v1.2.0

## Base obligatoria

- Continuar desde este paquete v1.2.0.
- No volver a v1.1.0-rc2 ni usar v1.1.0-rc3 como base.
- Conservar íntegramente los invariantes de v1.1.1 sobre PT409, recuperación, lease, `state_revision`, outbox y `version.js`.
- Mantener las fuentes clínicas canónicas post segunda auditoría del 4 de agosto de 2026.

## Funciones añadidas

1. Numeración visible en Cobertura canónica.
2. Revisión con salto numérico, `Última`, `Salir` y posición original en cierres parciales.
3. Notas personales de aprendizaje separadas de flags.
4. Exportación Markdown/CSV con protocolo Anki, contexto clínico, rentabilidad, progreso y trazabilidad.
5. Historial de resultados Anki por nota.

## Persistencia nueva

- Tabla: `public.question_learning_notes`.
- Migración: `MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql`.
- Una sola nota `OPEN` por usuario/pregunta.
- Estados: `OPEN`, `RESOLVED`, `DISMISSED`.
- Resultados Anki: `ALREADY_COVERED`, `UPDATE_EXISTING_CARD`, `CREATE_NEW_CARD`, `RESOLVED_WITHOUT_ANKI`.

## Invariantes que no deben romperse

1. Conflictos de sesión: PT409/HTTP 409, nunca SQLSTATE 40001.
2. Un conflicto no se encola como fallo offline.
3. Remoto con revisión superior prevalece; el local distinto se preserva como recuperación.
4. Una sesión no se edita simultáneamente desde dos pestañas.
5. El cierre valida `state_revision`.
6. `CREATE_SESSION` offline nunca usa upsert destructivo.
7. `version.js` sigue siendo la fuente única de versión/caché.
8. Mi Estado sigue siendo local.
9. Notas y flags permanecen conceptualmente y físicamente separados.
10. Ninguna tarjeta se crea automáticamente por cada nota; se deduplica contra Anki actualizado.

## QA siguiente

Ejecutar `python3 QA/qa_v1_2_0.py`, repetir smoke de navegador, dos pestañas, conflicto controlado, cierre con revisión obsoleta, creación/exportación de notas y verificación de Supabase.

---

## Archivo original: `HANDOFF_V1_3_0.md`

# HANDOFF — Residentado v1.3.0

## Checkpoint

- Versión: `1.3.0`.
- Base: `260805_residentado-banco-main.zip` — Residentado v1.2.0.
- Cambio principal: catálogo TTS Supabase compartido por Debilidades y Cobertura canónica.
- Catálogo vigente al cierre: V061, TTS_001–089, 89/274 temas.

## Estado Supabase ya aplicado

`public.tts_topic_catalog`:

- 89 filas;
- 89 temas distintos;
- TTS_001–089;
- `topic_ids_sin_correspondencia = 0`;
- RLS activo;
- `authenticated` puede seleccionar y no puede escribir;
- 1 política de lectura, 0 de escritura;
- control de solo lectura `PASS`.

## Arquitectura runtime

- `loadStaticTtsCatalog()` carga el respaldo V061.
- `loadCloudTtsCatalog()` ejecuta un único `SELECT` después de autenticación.
- `applyTtsCatalog()` genera un mapa por `rentability_topic_id`.
- `w4-data.js` normaliza camelCase y snake_case.
- `renderWeaknessReport()` y `renderStats()` consumen el mismo mapa local.
- `renderStats()` no llama Supabase.
- Una respuesta remota vacía no reemplaza un respaldo válido.

## Futuras incorporaciones TTS

Para TTS_090 y posteriores:

1. insertar/actualizar el registro correspondiente mediante un paquete administrativo trazable;
2. preservar permisos de solo lectura para `authenticated`;
3. verificar correspondencia con `questions.rentability_topic_id`;
4. recargar la webapp: la nueva disponibilidad aparecerá sin modificar el frontend;
5. actualizar `tts_catalog.json` en una entrega posterior si se quiere respaldo offline al mismo nivel.

No escribir desde la webapp en `tts_topic_catalog`.

## Archivos runtime modificados

- `app.js`;
- `w4-data.js`;
- `tts_catalog.json`;
- `styles.css`;
- `version.js`;
- `service-worker.js`.

## Archivos críticos preservados

- `session-core.js`;
- `session-storage.js`;
- `config.js`;
- `question-parser.js`;
- `w3-tools.js`;
- `pilot-data.js`.

## Pruebas posteriores al despliegue

1. Confirmar `v1.3.0`.
2. Confirmar `residentado-v1-3-0` en la PWA.
3. Abrir Mi Estado y verificar `Catálogo V061 · 89 TTS disponibles · fuente Supabase`.
4. Cambiar entre temas y especialidades sin nuevas consultas por fila.
5. Abrir Debilidades y confirmar códigos TTS correctos.
6. Probar un botón TTS disponible y uno pendiente.
7. Confirmar que notas, revisión y sesiones siguen funcionando.
8. Observar logs y confirmar ausencia de `40001` y de escrituras a `tts_topic_catalog`.

---

## Archivo original: `INCIDENTE_SESIONES_20260805.md`

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

---

## Archivo original: `QA_FLAGS_AUDITORIA_V0_6_17.md`

# QA — flags de auditoría v0.6.17

1. Ejecutar `supabase_migration_v0_6_17_review_flags.sql`.
2. Abrir una práctica y responder una pregunta.
3. En la corrección, pulsar `Marcar para revisar`.
4. Probar las tres categorías y confirmar que solo queda una activa.
5. Recargar el navegador y verificar persistencia.
6. Abrir `⋮ → Preguntas para revisar`.
7. Probar filtro, copiar lista y descargar CSV.
8. Quitar un flag y verificar que desaparece del listado.
9. Confirmar que marcar o quitar flags no crea intentos y no modifica la memoria adaptativa.
10. Confirmar que los metadatos siguen ocultos antes de responder.

---

## Archivo original: `QA_METADATA_PROTEGIDA_V0_6_16.md`

# QA v0.6.16

- Sintaxis de `app.js`: validada con `node --check`.
- Sintaxis de `service-worker.js`: validada con `node --check`.
- Metadatos pre-respuesta en práctica: ocultos.
- Metadatos tras corrección inmediata: revelados.
- Metadatos en simulacro activo: ocultos.
- Metadatos en revisión: conservados.
- No se modifican consultas, escrituras ni esquema de Supabase.

---

## Archivo original: `QA_TAXONOMIA_GLOBAL_V2.md`

# Control de calidad — taxonomía global V2

- Versión visible: 0.6.16.
- Caché de aplicación web progresiva: residentado-v0-6-16.
- Fallback antiguo disponible.
- Jerarquía V2 detectada por presencia de `rentability_topic_label`.
- Puntaje V2 0–100 convertido internamente a peso 0–1.
- Entidad clínica visible cuando difiere del tema.
- No se alteraron las funciones de escritura en intentos, memoria o sesiones.

---

## Archivo original: `QA_V1_0_0_FINAL.md`

# QA — Residentado v1.0.0

## Validaciones automáticas realizadas

- `node --check app.js`: sin errores de sintaxis.
- Renderizado en Chromium sin errores JavaScript.
- Vista móvil simulada: 390 × 844 px.
- Vista escritorio simulada: 1440 × 900 px.
- Retroalimentación inmediata funcional.
- `Referencia rápida` presente solo con contenido y cerrada por defecto.
- Comparación farmacológica estructurada en tarjetas por aspecto.
- Variantes vacías de abreviaturas ocultas.
- Preguntas con cuatro alternativas: no aparece una quinta alternativa vacía.
- Pregunta con imagen: el activo se renderiza.
- Preguntas `OBSERVADA_*`: excluidas de práctica adaptativa actual.
- Ciclo de flag en modo local:
  - marcar;
  - cambiar motivo;
  - registrar parche;
  - retirar de pendientes;
  - conservar en historial;
  - mostrar identificador y resumen del parche.
- Diseño móvil del historial revisado visualmente.

## Validaciones que debe hacer el usuario después de desplegar

Estas pruebas requieren la cuenta y Supabase reales:

1. Iniciar sesión en móvil Samsung y escritorio.
2. Confirmar 2.180 preguntas y 274 temas.
3. Abrir `RM-2022-A-038` y verificar su electrocardiograma.
4. Marcar una pregunta de prueba y confirmar que sincroniza entre dispositivos.
5. Registrar un parche de prueba y confirmar que pasa de Pendientes a Historial.
6. Verificar una pregunta `OBSERVADA_AMBIGUA` en simulacro histórico.
7. Completar una sesión de 10 preguntas y confirmar intentos, duda `?`, memoria e historial.
8. Borrar o cerrar el flag de prueba cuando termine la validación.

## Resultado

La Fase B queda implementada. La auditoría médica y farmacológica total pertenece a la siguiente fase y no debe confundirse con esta mejora de presentación.

---

## Archivo original: `QA_V1_2_0.md`

# QA — Residentado v1.2.0

## Resultado automatizado

- Sintaxis JavaScript: PASS.
- Regresión completa de invariantes v1.1.1: PASS.
- Test unitario de reconciliación `session-core`: PASS.
- Verificación estática de migración, RLS y unicidad de nota abierta: PASS.
- Verificación de que Mi Estado no contiene llamadas a Supabase: PASS.
- Smoke UI headless: PASS.

## Smoke UI ejecutado

1. Inicio demo cargó `v1.2.0`.
2. Mi Estado mostró `N.º` y primera fila numerada `1`.
3. Se respondió una pregunta.
4. Se abrió el modal de nota.
5. La nota vacía mostró validación y no se guardó.
6. Se guardó una nota válida y el contador pasó a 1.
7. Se cerró una sesión parcial y se abrió revisión.
8. Aparecieron `Ir a`, `Última`, `Salir` y la posición original.
9. `Salir` volvió al inicio.
10. La página de notas mostró la duda y los botones de exportación Markdown/CSV.

## Smoke real tras despliegue

- Confirmar que el hotfix PT409 continúa activo y no reaparece 40001.
- Abrir la misma sesión desde dos pestañas y confirmar el bloqueo por lease.
- Crear, editar y retirar una nota en la cuenta real.
- Cerrar una práctica parcial con varias respondidas; saltar a la última y salir desde una intermedia.
- Abrir Mi Estado y comprobar que no aumentan las consultas del corpus.
- Descargar un paquete Markdown y un CSV de notas; verificar caracteres y columnas.
- Cerrar y abrir la PWA para confirmar actualización de caché a `residentado-v1-2-0`.

No existe garantía absoluta de ausencia de defectos; este release reduce el riesgo mediante integración aditiva sobre v1.1.1, regresión automatizada y smoke de navegador.

---

## Archivo original: `QA_V1_3_0.md`

# QA — Residentado v1.3.0

## Automatizada

```bash
python3 QA/qa_v1_3_0.py
python3 QA/qa_browser_v1_3_0.py
```

La primera prueba valida:

- sintaxis de todos los JavaScript runtime;
- versión y caché;
- invariantes PT409, recuperación, lease y cierre;
- permanencia de notas y navegación v1.2.0;
- consulta TTS exclusivamente de lectura;
- ausencia de consultas Supabase dentro de `renderStats`;
- respaldo V061 con 274 temas y 89 disponibles;
- códigos exactos TTS_001–089;
- normalización de filas snake_case;
- migración aditiva y permisos C1;
- test unitario heredado de `session-core`.

La segunda prueba valida visualmente:

- versión v1.3.0;
- columna TTS en Cobertura canónica;
- conteo de 89 disponibles;
- código TTS visible;
- acción de copiar pedido;
- vista por especialidad con resumen TTS;
- Debilidades usando el mismo catálogo.

## Smoke real post despliegue

1. Abrir con una sola pestaña y confirmar v1.3.0.
2. Mi Estado → Cobertura canónica:
   - `N.º` presente;
   - `TTS` presente;
   - 89 disponibles;
   - códigos correctos;
   - temas restantes pendientes.
3. Cambiar orden y vista; confirmar que los códigos siguen unidos al tema correcto.
4. Abrir detalle de un tema con TTS y copiar pedido de suplemento.
5. Abrir detalle de un tema pendiente y copiar pedido de creación.
6. Abrir Debilidades y confirmar la misma disponibilidad.
7. Desconectar temporalmente la red, recargar la PWA y confirmar respaldo local V061.
8. Confirmar que no hay escrituras a `tts_topic_catalog`.
9. Probar notas, cierre parcial y navegación de revisión.
10. Confirmar que no reaparece SQLSTATE `40001`.

---

## Archivo original: `README_PASO_A_PASO.md`

# Actualización vigente — v1.0.0

Para actualizar desde v0.6.18, lee primero `README_V1_0_0_FINAL.md` y ejecuta `supabase_migration_v1_0_0_review_history.sql`. El resto de este documento conserva instrucciones históricas de instalación inicial.

---

# Residentado — banco piloto

Esta carpeta contiene una PWA funcional con las 20 preguntas del piloto.

## Qué ya funciona sin configurar nada

Abre `index.html` y la app entra en **Modo demo**:

- 20 preguntas reales.
- Corrección inmediata.
- Explicación de la clave.
- Explicación de distractores.
- Alertas de auditoría.
- Modo de 20 segundos.
- Repaso de errores.
- Estadísticas.
- Progreso guardado en `localStorage` del navegador.

En modo demo el progreso **no se sincroniza** entre celular y laptop.

Para probarla mediante un servidor local:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

---

# Paso en el que necesitas intervenir: configurar Supabase

## 1. Crear un proyecto en Supabase

Crea un proyecto gratuito en tu cuenta.

## 2. Crear la base de datos

En el **SQL Editor** de Supabase:

1. Abre `supabase_setup.sql`.
2. Copia todo su contenido.
3. Pégalo en una consulta nueva.
4. Ejecuta la consulta.

Ese único archivo:

- crea `questions`;
- crea `attempts`;
- activa Row Level Security;
- crea las políticas de privacidad;
- deja el banco en solo lectura desde la app;
- carga las 20 preguntas.

## 3. Crear tu usuario

La configuración recomendada es:

- Email/password habilitado.
- **Allow new users to sign up: desactivado** cuando termines de crear tu cuenta.
- Mantener un único usuario para el piloto.

Puedes crear tu usuario desde el panel de Authentication si el panel ofrece esa acción. Otra opción es habilitar temporalmente el registro, poner `ALLOW_SIGNUP: true` en `config.js`, crear tu cuenta desde la app y luego:
1. volver `ALLOW_SIGNUP` a `false`;
2. desactivar nuevos registros en Supabase.

## 4. Copiar los datos de conexión

En Supabase busca:

- **Project URL**
- **Publishable key**

En proyectos antiguos puede aparecer una `anon key`; también sirve para el cliente web.

Nunca copies una **Secret key** ni una `service_role` dentro de esta app.

Edita `config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_...",
  ALLOW_SIGNUP: false
};
```

Cuando ambas variables están completas, la app cambia automáticamente de Modo demo a Modo sincronizado.

---

# Publicar gratis con GitHub Pages

1. Crea un repositorio, por ejemplo `residentado-banco`.
2. Sube **el contenido de esta carpeta** al nivel principal del repositorio.
3. En el repositorio abre `Settings` → `Pages`.
4. En `Build and deployment`, selecciona `Deploy from a branch`.
5. Elige la rama `main` y la carpeta `/ (root)`.
6. Guarda y espera a que GitHub publique la dirección.

La app usa rutas relativas, por lo que funciona en una URL de proyecto como:

```text
https://TUUSUARIO.github.io/residentado-banco/
```

## Instalar en Android

Abre la dirección publicada en Chrome y usa la opción de instalar/añadir la app a la pantalla de inicio cuando el navegador la ofrezca.

---

# Seguridad implementada

## `questions`
- Solo usuarios autenticados pueden leer el banco.
- La app no recibe permisos para insertar, modificar ni borrar preguntas.

## `attempts`
- Cada fila guarda `user_id`.
- RLS solo permite leer, crear, modificar o borrar filas cuando `auth.uid()` coincide con `user_id`.

Por eso, aunque en el futuro existieran varios usuarios, cada uno vería únicamente su propio historial.

---

# Archivos principales

- `index.html`: entrada de la app.
- `styles.css`: interfaz responsive.
- `app.js`: lógica de práctica, sincronización y estadísticas.
- `pilot-data.js`: copia local de las 20 preguntas para modo demo.
- `config.js`: configuración de Supabase.
- `manifest.webmanifest`: instalación PWA.
- `service-worker.js`: caché del shell de la app.
- `supabase_setup.sql`: archivo recomendado para crear todo de una sola vez.
- `supabase_schema.sql`: solo estructura y seguridad.
- `supabase_seed.sql`: solo las 20 preguntas.

---

# Regla de auditoría incorporada

- Las claves oficiales de CONAREME se conservan.
- Las preguntas `OBSERVADA_*` muestran una alerta y se excluyen del porcentaje de dominio por defecto.
- Las preguntas `VALIDADA_CON_CAVEAT` puntúan normalmente, pero muestran la precisión clínica después de responder.

---

# Estado de esta copia

Esta versión ya tiene configurados:

- Project URL de Supabase.
- Publishable key del proyecto.
- `ALLOW_SIGNUP: false`.

Por tanto, ya no inicia en Modo demo: al publicarla debe mostrar la pantalla de inicio de sesión y usar Supabase para sincronizar los intentos.

---

## Archivo original: `README_V0_5.md`

# Residentado v0.5 — Plan 75+/80

Esta versión consolida en una sola actualización:

- meta 75+/80;
- examen: 6 de septiembre de 2026;
- fecha objetivo de estar listo: 23 de agosto;
- viajes 25–29 de julio y 8–15 de agosto;
- plan diario automático y exigente;
- deuda de estudio;
- checklist diaria;
- hoja de ruta y prelectura;
- práctica rápida y Sprints 10/15/30;
- repaso adaptativo según acierto, tiempo y estabilidad estimada;
- objetivo de velocidad: 25 s por pregunta;
- sesiones personalizadas;
- simulacros persistentes entre dispositivos.

## Orden de actualización

### 1. Supabase

En SQL Editor ejecuta **todo** `supabase_migration_v0_5.sql`.

Esta migración está hecha para tu estado actual: ya tienes las tablas `questions` y `attempts`, pero todavía no ejecutaste v0.4.

### 2. GitHub

Después de que Supabase muestre `Success`, reemplaza en el repositorio los archivos de la app por los de `residentado_v0_5_update.zip`.

Los principales son:

- `app.js`
- `styles.css`
- `service-worker.js`
- `pilot-data.js`
- `index.html`
- `manifest.webmanifest`

Conserva `config.js` de este paquete: ya está conectado a tu proyecto Supabase.

### 3. Recarga forzada

Tras el despliegue de GitHub Pages:

- Windows: `Ctrl + F5`.
- Android: cierra la pestaña/app y vuelve a abrirla. Si la versión antigua persiste, borra los datos del sitio o desinstala/reinstala la PWA.

## Nota del algoritmo de repaso

La v0.5 usa un programador adaptativo basado en tres estados conceptuales: dificultad, estabilidad y probabilidad estimada de recuerdo. No pretende ser una implementación oficial de FSRS. Ajusta el próximo repaso usando:

- correcta/incorrecta;
- tiempo de respuesta;
- objetivo absoluto de 25 s;
- historial individual de la pregunta;
- riesgo de olvido estimado;
- fase del plan hasta el examen.

El banco completo añadirá rentabilidad histórica real por tema y agrupación por concepto.

---

## Archivo original: `README_V0_6.md`

# Residentado app v0.6

## Nuevo: Simulacro histórico realista

La sección **Simulacro** ahora ofrece:

- Pruebas históricas completas por año y serie (A/B) cuando estén completamente cargadas.
- Maratón A+B cuando ambas pruebas del año estén disponibles.
- Preguntas en el orden original.
- Cuadernillo completo visible, con alternativas no clicables.
- Hoja de respuestas independiente en el lateral.
- Sin claves ni explicaciones hasta entregar.
- Persistencia en `practice_sessions` para reanudar.
- En la maratón A+B se ofrece descanso entre ambas pruebas.

La app detecta automáticamente qué exámenes históricos están completos en la tabla `questions`.

## Escalabilidad

La carga de preguntas, intentos y estados de memoria ahora usa paginación para superar el límite de 1000 filas por consulta.

---

## Archivo original: `README_V0_6_10.md`

# Residentado — v0.6.10

## Corrección final: Alta rentabilidad

La v0.6.8/v0.6.9 podía dejar deshabilitado el filtro `Alta rentabilidad` porque exigía que el nombre exacto del tema se repitiera varias veces. La taxonomía editorial del banco es deliberadamente granular, por lo que muchos temas exactos son únicos aunque pertenezcan a áreas y especialidades muy recurrentes.

### Nuevo cálculo

La webapp estima la rentabilidad histórica combinando:

- recurrencia del tema;
- frecuencia y presencia entre años de la especialidad;
- frecuencia y presencia entre años del área.

Se selecciona aproximadamente el 30% superior del corpus cargado, preservando cualquier clasificación explícita de alta rentabilidad que se incorpore en el futuro.

La clasificación:

- se recalcula al cargar el corpus;
- no depende del número de preguntas respondidas por el usuario;
- se actualiza automáticamente al importar más años;
- es provisional hasta la auditoría final del corpus completo de 2.180 preguntas.

## Compatibilidad

- No requiere migración SQL.
- Conserva todas las funciones de v0.6.9.
- Versión visible en la interfaz: `v0.6.10`.

---

## Archivo original: `README_V0_6_11.md`

# Residentado — v0.6.11

Actualización de navegación y protección de taxonomía sobre v0.6.10.

## Cambios

- La interfaz muestra la versión `v0.6.11`.
- Añade una capa defensiva para conservar las 6 áreas canónicas aunque una importación futura use variantes antiguas.
- Las etiquetas de tema o especialidad puramente numéricas ya no se muestran como categorías válidas.
  - Si `topic` es inválido y existe un `subtopic` útil, se usa el subtema como etiqueta de navegación.
  - Si no hay una etiqueta válida, se usa `Sin tema clasificado`.
- El navegador de temas sigue la jerarquía `Área → Especialidad → Tema`.
- Los grupos se muestran plegados inicialmente para reducir el desplazamiento en celular.
- El buscador abre automáticamente las áreas y especialidades que contienen coincidencias.
- El formulario impide iniciar una sesión con cero áreas, cero años o cero temas seleccionados.
- No requiere migración SQL adicional.

## Compatibilidad

Compatible con el esquema de Supabase usado desde la migración v0.6.2. No modifica preguntas, intentos, memoria adaptativa ni estadísticas.

---

## Archivo original: `README_V0_6_12.md`

# Residentado — v0.6.12

## Corrección: tiempo por pregunta + corrección al final

Esta versión corrige el reinicio indebido del cronómetro al volver a una pregunta anterior.

### Reglas de sesión

- **Práctica con tiempo por pregunta y corrección al final:** el tiempo consumido se conserva por pregunta entre visitas.
- Si el tiempo llega a cero **sin respuesta**, la pregunta queda cerrada, se registra al finalizar la sesión como **un único intento incorrecto por tiempo** (`timed_out = true`) y no puede responderse después.
- Si el tiempo llega a cero **después de haber elegido una respuesta**, se conserva esa respuesta y la pregunta queda cerrada; ya no puede modificarse.
- Volver atrás **no reinicia el reloj** y **no crea intentos adicionales**.
- Antes de que una pregunta quede cerrada, cambiar de alternativa en una sesión con corrección al final reemplaza la respuesta provisional. Al entregar, se guarda **un solo intento**, correspondiente a la respuesta final.
- Las preguntas dejadas voluntariamente en blanco y que no agotaron su tiempo siguen sin crear intentos de aprendizaje, según la política previa.
- En prácticas con **tiempo total** o **sin límite**, la corrección al final mantiene el comportamiento de respuesta editable hasta la entrega.

No requiere cambios SQL.

---

## Archivo original: `README_V0_6_13.md`

# Residentado — v0.6.13

## Revisión al terminar: explicaciones y duda posterior

- La revisión pregunta por pregunta siempre intenta mostrar la explicación completa, tanto si la respuesta fue correcta como incorrecta, omitida o cerrada por tiempo.
- Se mantiene visible la lógica rápida, comparación, explicación de la clave, distractores, trampa y perla cuando estén disponibles.
- En toda pregunta respondida de la revisión aparece `❓ No dominaba el razonamiento` cuando existe un intento guardado.
- Marcarla conserva el resultado original, pero reclasifica el conocimiento como frágil y adelanta el repaso.
- Se añadió un fallback defensivo: un dato editorial inesperado ya no debe dejar la revisión mostrando solo la alternativa verde sin explicación.
- Los simulacros guardan el mapa exacto de intentos de la sesión para que la duda posterior modifique el intento correcto de esa sesión.
- No requiere migración SQL nueva.

---

## Archivo original: `README_V0_6_14.md`

# Residentado — v0.6.14

## Procedencia visible e historial de actividad

- Durante la resolución y la revisión se muestra siempre el año, la prueba A/B y el número original de la pregunta.
- Se añade `Historial y ritmo` desde Inicio y Estadísticas.
- El historial permite elegir una fecha y revisar cada intento previo con la explicación completa.
- Cada día se divide en mañana (00:00–12:59) y tarde/noche (13:00–23:59).
- Cada periodo informa preguntas, acierto, tiempo medio, dudas, timeouts, bloques de actividad y pausa mayor entre respuestas.
- Las pausas se presentan como intervalos objetivos; la app no afirma que una pausa sea distracción.
- Se muestra un resumen de los últimos 14 días.
- No requiere migración SQL nueva: usa los intentos ya existentes.

---

## Archivo original: `README_V0_6_15.md`

# Residentado — v0.6.15

## Compatibilidad con la taxonomía global V2

Esta versión puede instalarse antes o después de la migración de Supabase.

### Antes de migrar

- Usa `area`, `specialty`, `topic` y `subtopic`.
- Mantiene el cálculo provisional de rentabilidad por corpus.
- No cambia sesiones, intentos ni memoria.

### Después de migrar

La app detecta automáticamente y prioriza:

- `canonical_area`
- `canonical_specialty`
- `rentability_topic_label`
- `canonical_entity`
- `exam_rentability_score`

La navegación queda:

**Área canónica → Especialidad canónica → Tema de rentabilidad**

La entidad clínica aparece como etiqueta fina durante la práctica y revisión.

## Rentabilidad y prioridad personal

- Rentabilidad del examen: procede del corpus auditado y usa un puntaje de 0 a 100.
- Prioridad personal: continúa calculándose con errores, dudas, lentitud,
  repasos vencidos y cobertura.

Ambas permanecen separadas.

## Seguridad

- No requiere migración para abrir la app.
- No contiene credenciales nuevas.
- No modifica Supabase por sí sola.
- Conserva compatibilidad con la estructura histórica.

---

## Archivo original: `README_V0_6_16.md`

# Residentado — v0.6.16

## Protección contra pistas taxonómicas

- Durante una pregunta activa, la app oculta el año, prueba, número original, área, tema, entidad clínica y estado de auditoría.
- En práctica con corrección inmediata, esas etiquetas aparecen después de responder, usar «No sé» o agotar el tiempo.
- En sesiones con corrección al final y en simulacros, permanecen ocultas hasta la revisión posterior a la entrega.
- El contador, el objetivo de tiempo y el cronómetro continúan visibles.

## Selección de preguntas

- «Alta prioridad personal» combina repasos vencidos, probabilidad de recuerdo, errores, dudas, lentitud, cobertura y rentabilidad histórica.
- «Temas rentables» incluye niveles MUY_ALTA y ALTA, pero los ordena por prioridad adaptativa personal y diversifica años cuando los puntajes son cercanos.
- No usa un orden rígido de mayor a menor rentabilidad ni una mezcla completamente aleatoria.

## Compatibilidad

Conserva la taxonomía global V2/V2.1, Supabase, intentos, sesiones y memoria adaptativa de v0.6.15.

---

## Archivo original: `README_V0_6_17.md`

# Residentado — v0.6.17

## Cambio principal

Se añadió un sistema persistente y personal de flags para auditar preguntas sin alterar respuestas, intentos, prioridad ni memoria adaptativa.

Después de responder o durante la revisión puedes marcar una pregunta como:

- **Revisar enunciado**: redacción, datos clínicos, alternativas o ambigüedad.
- **Revisar explicación**: explicación insuficiente, confusa, desactualizada o tautológica.
- **Revisar**: observación general.

Cada pregunta conserva un solo motivo activo. Se puede cambiar o quitar.

## Lista para compartir

En el menú `⋮` aparece **Preguntas para revisar**. Desde allí puedes:

- filtrar por tipo;
- copiar una lista lista para pegar en el chat;
- descargar un archivo CSV;
- quitar flags ya resueltos.

La lista incluye identificador, año/prueba/número, taxonomía y enunciado.

## Instalación requerida

Antes de usar esta versión en Supabase, ejecuta una sola vez:

`supabase_migration_v0_6_17_review_flags.sql`

La migración crea `public.question_review_flags` con Row Level Security (RLS), es decir, seguridad por filas: cada usuario solo puede leer y modificar sus propias marcas.

## Compatibilidad

- Conserva taxonomía global V2/V2.1.
- Conserva metadatos protegidos antes de responder.
- No cambia preguntas, claves, explicaciones, intentos ni memoria adaptativa.
- En modo local sin Supabase, los flags se guardan en `localStorage`.

---

## Archivo original: `README_V0_6_18.md`

# Residentado v0.6.18 - imágenes por pregunta

## Hallazgo de auditoría

En el corpus oficial 2015-2025 se identificó una sola pregunta que depende de una imagen no descrita completamente en el texto:

- `RM-2022-A-038`: electrocardiograma adjunto.

La auditoría combinó:

1. búsqueda de expresiones como `adjunto`, `ver EKG`, `imagen siguiente` y equivalentes en las 2.180 preguntas;
2. inventario de imágenes embebidas del PDF unificado;
3. verificación visual de la página 187 del PDF unificado, correspondiente a la página 5 de la Prueba A 2022.

Las demás preguntas que mencionan radiografía, tomografía o electrocardiograma incluyen el hallazgo relevante dentro del enunciado y no requieren reproducir una imagen para poder resolverse.

## Cambios incluidos

- soporte opcional de imágenes en práctica, simulacro, simulacro histórico y revisión;
- imagen `assets/questions/RM-2022-A-038.jpg` extraída directamente del PDF fuente;
- migración de Supabase con campos de imagen y actualización de la pregunta;
- precarga de la imagen en el service worker;
- manifiesto de trazabilidad `QUESTION_IMAGES_MANIFEST_V0618.csv`.

## Instalación

1. Reemplazar los archivos de la app por esta versión o aplicar el diff de `app.js`, `styles.css` y `service-worker.js`.
2. Mantener la carpeta `assets/questions` en la raíz del despliegue.
3. Ejecutar `supabase_migration_v0_6_18_question_images.sql` en Supabase.
4. Recargar la aplicación. Si está instalada como PWA, cerrarla y abrirla nuevamente para activar el nuevo caché.

## Campos añadidos a `public.questions`

- `image_required`
- `image_url`
- `image_alt`
- `image_caption`
- `image_source_page`
- `image_source_bbox`

La app usa `select('*')`, por lo que no requiere cambios adicionales en las consultas.

---

## Archivo original: `README_V0_6_2.md`

# Residentado app v0.6.2

## Cambios principales

### Cancelar / salir
- Simulacro estándar: salir y continuar después o cancelar.
- Simulacro histórico: salir y continuar después o cancelar.
- Descanso entre bloques: también permite salir o cancelar.
- Dashboard: muestra todas las sesiones activas, cada una con Reanudar y Cancelar.
- Práctica: botón Cancelar sesión.

### Regla al cancelar práctica
- Corrección inmediata: los intentos ya respondidos se conservan; el resto de la cola se descarta.
- Corrección al final: cancelar descarta la sesión no entregada y no crea intentos.

### Duda `?`
- Las alternativas dejadas con `?` se guardan en el intento.
- Una respuesta correcta con `?` recibe una calificación de memoria menor y vuelve antes al repaso.
- La pregunta gana prioridad personal.
- En la revisión se destacan exactamente las alternativas que quedaron dudosas y se muestra su explicación.
- El puntaje del simulacro NO cambia: una respuesta correcta sigue siendo correcta.

### Robustez adicional
- Las preguntas en blanco de sesiones con corrección al final ya no cuentan como intentos.
- En la hoja de respuestas, tocar de nuevo la misma burbuja borra esa respuesta.
- El simulacro histórico permite marcar toda una pregunta para revisar.
- El resumen final muestra respondidas, sin responder, marcadas y dudosas.
- Corregido el retorno desde el resumen de un histórico: vuelve al cuadernillo histórico, no a la vista estándar.
- Todas las sesiones activas quedan visibles para evitar sesiones olvidadas.

## SQL
Ejecuta `supabase_migration_v0_6_2.sql`.
Incluye la limpieza del bug v0.6.1, por lo que no necesitas ejecutar por separado el SQL de limpieza anterior.

---

## Archivo original: `README_V0_6_4.md`

# Residentado app v0.6.4

## Incorrecta + `?`
Una respuesta incorrecta con una o más alternativas marcadas con `?` recibe prioridad adicional:
- mayor aumento de dificultad;
- reducción mayor de estabilidad de memoria;
- intervalo de repaso más corto;
- bonificación extra en la selección adaptativa.

Una respuesta correcta con `?` también se prioriza, pero menos que una incorrecta con `?`.

## Informe dinámico de debilidades
Accesible desde:
- Practicar → `Informe dinámico de debilidades`
- Estadísticas → `Ver informe`

Se recalcula con cada nueva respuesta y usa:
- estado más reciente por pregunta;
- errores actuales;
- dudas `?`;
- error + `?`;
- lentitud;
- errores recientes;
- repasos vencidos.

El índice 0–100 es una heurística interna de priorización y no predice la nota del examen.

Incluye:
- ranking de temas;
- prioridad Crítica / Alta / Moderada / Vigilancia / Controlada;
- evidencia Baja / Media / Alta;
- dominio actual;
- porcentaje de dudas;
- porcentaje de error + duda;
- lentitud;
- cobertura;
- práctica directa del tema;
- botón `Copiar informe para ChatGPT`;
- brechas de cobertura separadas para no confundir “no estudiado” con “débil”.

## Base de datos
No requiere migración SQL nueva si ya aplicaste `supabase_migration_v0_6_2.sql`.

---

## Archivo original: `README_V0_6_5.md`

# Residentado v0.6.5

Actualización consolidada sobre **v0.6.4**.

## No requiere nueva migración SQL

Esta versión reutiliza los campos ya creados en la migración v0.6.2:

- `was_uncertain`
- `uncertain_options`
- `uncertainty_note`

La política existente de actualización de intentos permite convertir un intento ya guardado en un intento con incertidumbre posterior a la corrección.

## Cambios

### 1. Diversificación por año sin romper la prioridad

Las colas de:

- preguntas nuevas;
- prioridad personal;
- errores;
- dudas;
- alta rentabilidad;

mezclan años cuando las preguntas tienen una prioridad suficientemente parecida.

Los repasos vencidos también pueden alternar años, pero **solo entre preguntas que ya están vencidas** y con prioridad muy similar. Nunca se introduce una pregunta no vencida únicamente para diversificar.

### 2. Tiempo visible después de responder

En la corrección inmediata se muestra el tiempo real empleado y el objetivo configurado, por ejemplo:

`⏱ 31 s · objetivo 25 s · el algoritmo registró la lentitud`

El tiempo ya se registraba en v0.6.4; ahora también es visible para el usuario.

### 3. Marcar duda después de ver la corrección

Después de responder aparece:

`❓ No dominaba el razonamiento`

Al pulsarlo:

- el intento se conserva como correcto o incorrecto según la respuesta real;
- `was_uncertain` pasa a `true`;
- se añade `POST_ANSWER_REASONING_MISMATCH` a `uncertainty_note`;
- la memoria de esa pregunta se reconstruye con todos sus intentos;
- la prioridad y el próximo repaso se recalculan.

También está disponible durante la revisión posterior de un simulacro recién entregado.

### 4. Volver arriba al pasar de pregunta

Al renderizar la siguiente pregunta o la siguiente pregunta de revisión, la página vuelve automáticamente al inicio.

### 5. Salir de la cuenta protegido en menú

El botón directo `Salir` fue reemplazado por un menú `⋮`.

Flujo:

1. pulsar `⋮`;
2. pulsar `Salir de la cuenta`;
3. confirmar el cierre de sesión.

Esto reduce cierres accidentales en celular.

### 6. Alta rentabilidad dinámica

Ya no depende de que el usuario responda una cantidad determinada de preguntas.

La app analiza el corpus cargado en cada inicio usando:

- frecuencia del tema;
- recurrencia en distintos años;
- estados explícitos de rentabilidad, cuando existan.

El filtro `Alta rentabilidad` muestra el número de preguntas disponibles y se recalcula automáticamente cuando se importan más años al mismo Supabase.

### 7. Metadatos visuales

Se reemplazó el nombre antiguo:

- `Residentado — Banco piloto`

por:

- `Residentado — Banco 2015–2025`

El caché del service worker se actualizó a `residentado-v0-6-5`.

## Despliegue recomendado

1. Conservar v0.6.4 como respaldo en el historial de Git o en una rama/tag.
2. Sustituir los archivos de la webapp por los de v0.6.5.
3. Hacer commit y push.
4. Abrir la app y recargar una vez para que el nuevo service worker elimine el caché v0.6.4.
5. Probar al menos:
   - una pregunta de repaso prioritario;
   - una respuesta correcta y pulsar `No dominaba el razonamiento`;
   - una respuesta lenta para verificar el indicador de tiempo;
   - `Siguiente pregunta` desde una corrección larga;
   - menú `⋮` y cierre de sesión;
   - filtro `Alta rentabilidad` en práctica personalizada.

Después de verificarlo, v0.6.5 puede convertirse en la nueva base de desarrollo. No conviene borrar el commit/tag de v0.6.4.

---

## Archivo original: `README_V0_6_6.md`

# Residentado — actualización v0.6.6

Base: v0.6.5.

No requiere nueva migración SQL ni cambios de esquema en Supabase.

## Cambios

### 1. Botón “No sé”
En práctica sin límite de tiempo aparece:

`🤷 No sé · mostrar respuesta`

- Registra una respuesta incorrecta explícita.
- No cuenta como pregunta en blanco.
- Evita elegir una alternativa al azar solo para avanzar.
- En corrección inmediata muestra la explicación.
- En corrección al final queda registrada como “No sé” y se contabiliza como incorrecta.

La identificación usa los campos existentes:
- `selected_answer = null`
- `is_correct = false`
- `timed_out = false`
- `speed_bucket = dont_know`
- `uncertainty_note = NO_SE_EXPLICITO`

No se añade ninguna columna nueva.

### 2. Objetivo de tiempo adaptable por pregunta
El objetivo ya no es idéntico para todas las preguntas. La heurística usa la carga de lectura y aplica una guardia para preguntas cortas que impliquen cálculo, dosis, puntuaciones o clasificaciones.

Con una base de 25 segundos:
- carga de lectura muy corta: 15 s
- corta: 20 s
- estándar: 25 s
- larga: 30 s
- muy larga: 35 s

La carga se estima con el texto del enunciado y las alternativas. La base sigue siendo configurable; los escalones se escalan proporcionalmente.

El objetivo adaptable:
- se muestra durante práctica sin límite;
- ajusta el cronómetro del modo “por pregunta”;
- se guarda en `target_seconds`;
- se usa para velocidad, fluidez, memoria y prioridad.

### 3. Alineación de “Orden aleatorio”
Se corrige la alineación del checkbox y el texto en el constructor de sesiones.

### Compatibilidad
- Compatible con la migración v0.6.2 ya aplicada.
- No modifica las tablas.
- Construida sobre v0.6.5.

---

## Archivo original: `README_V0_6_7.md`

# Residentado — actualización v0.6.7

Fecha: 2026-07-15

## Objetivo

Cerrar la etapa de desarrollo de la webapp con una protección adicional contra la memoria de posición/letra de las alternativas.

## Cambios

### 1. Mezcla de alternativas

- En las sesiones de práctica, las alternativas se mezclan por defecto.
- Las letras visibles A–E se reasignan a la nueva posición.
- Internamente se conserva la correspondencia con la alternativa oficial original, por lo que:
  - la corrección sigue siendo exacta;
  - las dudas `?` se guardan contra la alternativa real;
  - la memoria adaptativa y las estadísticas no cambian de significado.
- El orden queda estable durante toda la pregunta y durante su revisión posterior.

### 2. Configuración en práctica y simulacro personalizado

En el constructor aparece la opción:

`Mezclar alternativas`

Está activada por defecto.

### 3. Simulacro histórico realista

El modo histórico conserva el orden oficial de alternativas para mantener fidelidad al cuadernillo original.

### 4. Compatibilidad

- No requiere cambios SQL.
- Compatible con la migración v0.6.2 ya aplicada.
- Puede instalarse directamente sobre v0.6.6.

## Nota editorial

Los requisitos de definir epónimos y ampliar la comparación de mecanismos de acción farmacológicos son requisitos del contenido del banco, no del esquema visual de la aplicación. Se incorporan al estándar editorial y se mostrarán en los bloques de explicación ya existentes a medida que los bancos sean enriquecidos/auditados.

---

## Archivo original: `README_V0_6_8.md`

# Residentado — actualización v0.6.8

Fecha: 2026-07-15

## Objetivo

Cerrar la etapa de ajustes de la webapp antes del merge a la rama principal, añadiendo una alerta de lectura prioritaria basada en errores reales y haciendo robusta la mezcla de alternativas.

## Cambios

### 1. Mezcla de alternativas con protección automática

- Se mantiene la mezcla de alternativas introducida en v0.6.7 para práctica y simulacro personalizado.
- La app conserva la correspondencia con la alternativa canónica para corregir, registrar dudas y calcular estadísticas.
- El simulacro histórico realista conserva el orden oficial del cuadernillo.
- Como protección adicional, si una pregunta contiene alternativas que hacen referencia explícita a letras u otras opciones, la app mantiene el orden canónico de esa pregunta.
- Se auditó el `banco_maestro_raw_2015_2025_v0_1` de 2.180 preguntas y no se encontraron alternativas del tipo «A y B», «todas las anteriores» o «ninguna de las anteriores» que invaliden la mezcla actual.

### 2. Alerta de lectura prioritaria

- La pantalla principal puede mostrar `🚨 ALERTA DE LECTURA PRIORITARIA` cuando existe un tema con señal suficiente de debilidad.
- La selección usa el informe dinámico ya existente: errores recientes, duda `?`, error + duda, lentitud, repasos vencidos y nivel de evidencia.
- Prioriza temas críticos o altos con evidencia media/alta; puede mostrar una señal crítica temprana si el problema es muy marcado.
- La alerta muestra:
  - tema;
  - dominio actual;
  - prioridad;
  - cobertura;
  - motivo de alerta;
  - focos de lectura sugeridos.
- Incluye:
  - `📋 Copiar pedido de repaso`, para pegar un prompt dirigido en ChatGPT;
  - `🔥 Practicar este tema`, para iniciar un refuerzo de 10 preguntas.
- La misma alerta aparece también en `Qué viene después`.

### 3. Compatibilidad

- No requiere cambios SQL.
- Compatible con la migración v0.6.2 ya aplicada.
- El paquete de actualización v0.6.8 está preparado para instalarse directamente sobre la v0.6.6 probada; incluye de forma acumulativa los cambios de v0.6.7 y v0.6.8.

## Nota editorial

La definición de epónimos y la comparación de mecanismos de acción farmacológicos siguen siendo requisitos del contenido del banco. No requieren nuevas columnas ni una migración de Supabase: se muestran mediante los campos de explicación ya existentes.

---

## Archivo original: `README_V0_6_9.md`

# Residentado — v0.6.9

Actualización final de interfaz sobre v0.6.8.

## Cambios

- Muestra `v0.6.9` en letras pequeñas en la barra superior de la webapp y en la pantalla de inicio de sesión para facilitar el trazado durante pruebas.
- Reemplaza la lista plana de temas del constructor de práctica por un navegador jerárquico dinámico:
  - Área → Especialidad → Tema.
- Añade buscador por área, especialidad o tema.
- Añade conteos de temas y preguntas.
- Permite seleccionar o limpiar todos los temas de un área o especialidad.
- Mantiene los filtros existentes de área, año, estado previo y rentabilidad.
- No requiere cambios en Supabase ni nuevas migraciones SQL.

## Ejemplo de navegación

Para buscar un bloque pediátrico concreto:

1. Pulsa `Ninguno` en temas.
2. Escribe `exantemas` en el buscador, o despliega `Pediatría` y la especialidad correspondiente.
3. Marca el tema deseado.
4. Crea la sesión.

La jerarquía se construye automáticamente con los campos `area`, `specialty` y `topic` de las preguntas cargadas en Supabase, por lo que se actualiza al importar nuevos bancos enriquecidos.

---

## Archivo original: `README_V1_0_0_FINAL.md`

# Residentado v1.0.0 — versión funcional final

**Fecha:** 21 de julio de 2026  
**Base compatible:** banco canónico V0721, taxonomía V2.5, 2.180 preguntas y 274 temas.

Esta versión cierra la **Fase B** de la hoja de ruta. La aplicación queda congelada funcionalmente para que las mejoras posteriores se concentren en:

- auditoría integral del banco;
- parches periódicos de contenido y taxonomía;
- generación prioritaria de tarjetas Anki;
- incorporación futura de nuevos exámenes.

## Cambios incluidos

### 1. Referencia rápida

- Se muestra después de la explicación principal.
- Permanece cerrada por defecto.
- Solo aparece cuando existe contenido útil.
- Reúne comparaciones, criterios, escalas, valores, dosis, abreviaturas, epónimos y términos.
- La lógica rápida, la explicación de la clave, los distractores, la trampa y la perla siguen visibles fuera de este bloque.

### 2. Fármacos y antibióticos

La app deriva una presentación estructurada desde los campos ya existentes, sin añadir columnas a `questions`.

Cuando corresponde, organiza la comparación disponible en:

- clase;
- mecanismo y diana;
- espectro o cobertura;
- indicación;
- toxicidad o reacción adversa;
- contraindicación o precaución;
- antídoto o reversión;
- diferencias clave.

La auditoría farmacológica total sigue pendiente: esta función organiza lo que ya está escrito, pero no inventa información ausente.

### 3. Ocultamiento de contenido vacío

- No se renderizan alternativas vacías o con espacios.
- No se muestran tarjetas sin explicación real.
- Se eliminan líneas editoriales como `No requiere siglas`, `No hay siglas indispensables` y variantes equivalentes.
- Si una línea vacía precede a un epónimo o término útil, se elimina solo la línea vacía y se conserva el contenido real.

### 4. Trazabilidad de observaciones

Los flags ya no tienen que borrarse para desaparecer de la cola activa.

Estados:

- `OPEN`: pendiente de revisión;
- `RESOLVED`: corregida mediante un parche identificado;
- `DISMISSED`: retirada sin parche.

Al registrar un parche se conserva:

- pregunta;
- tipo de observación;
- revisión del contenido al momento de marcar;
- fecha de creación y cierre;
- identificador del parche;
- resumen de la resolución;
- vínculo con una observación anterior de la misma pregunta.

Si la pregunta vuelve a marcarse, se crea un nuevo registro enlazado y vuelve a la cola activa.

## Instalación sobre v0.6.18

1. Respaldar el repositorio y Supabase.
2. Ejecutar en Supabase:

```text
supabase_migration_v1_0_0_review_history.sql
```

3. Reemplazar los archivos de la aplicación por los de este paquete.
4. Conservar `config.js` con la configuración vigente del proyecto.
5. Publicar o hacer merge en GitHub.
6. Recargar dos veces la webapp. Si está instalada como aplicación web progresiva, cerrarla y abrirla nuevamente para activar el caché `residentado-v1-0-0`.

No es necesario volver a ejecutar:

- lotes médicos 1–6;
- reconciliación V2.5;
- migración de imágenes v0.6.18;
- migración inicial de flags v0.6.17, si ya está instalada.

## Flujo posterior recomendado

```text
flags OPEN
→ auditoría contra PDF oficial y fuentes vigentes
→ parche transaccional de questions/rentability_topics
→ registrar patch_id y resolución
→ flags RESOLVED
→ candidatos Anki priorizados
```

La aplicación no modifica automáticamente intentos, memoria, sesiones ni estados canónicos `OBSERVADA_*`.

---

## Archivo original: `README_V1_1_1.md`

# Residentado v1.1.1 - instalacion segura

Esta version estabiliza las sesiones de v1.1.0-rc2. No cambia el banco clinico, taxonomia, rentabilidad ni cobertura.

## Publicacion

1. Conservar copia del despliegue actual.
2. No borrar IndexedDB, cache ni almacenamiento local del dispositivo afectado.
3. Ejecutar MIGRATIONS/20260805_FIX_SESSION_CONFLICT_PT409.sql si aun no se aplico.
4. Publicar todos los archivos, incluido version.js.
5. Recargar dos veces; si esta instalada como PWA, cerrarla completamente y abrirla.
6. Confirmar que la interfaz muestre v1.1.1.
7. Abrir inicialmente una sola pestana.

## Recuperacion de RC2

Si la copia local conflictiva contiene progreso distinto y esta por detras del servidor, la app crea otra sesion cuyo titulo termina en recuperacion local. La original no se sobrescribe. Si no hay red, la copia queda en IndexedDB y se encola como CREATE_SESSION no destructivo.

No eliminar ninguna de las dos hasta comparar el progreso.

## Prueba minima

Responder tres preguntas, esperar dos segundos, pausar y reanudar. Abrir la misma sesion en otra pestana debe quedar bloqueado mientras el lease este vigente. Revisar Supabase cinco minutos: no deben aparecer nuevos 40001 ni crecimiento continuo de errores PostgreSQL.

---

## Archivo original: `README_V1_2_0.md`

# Residentado v1.2.0 — notas de aprendizaje y navegación de revisión

## Base y alcance

Este release parte exclusivamente de **Residentado v1.1.1** y conserva sus correcciones de concurrencia, recuperación y persistencia de sesiones. No deriva de v1.1.0-rc3.

No modifica el corpus clínico, las 2.180 preguntas, la taxonomía de 274 temas, los intentos, la memoria adaptativa ni la rentabilidad.

## Mejoras incorporadas

### Cobertura canónica

- La tabla de temas en **Mi estado → Cobertura canónica** tiene columna `N.º`.
- La numeración corresponde al orden visible.
- En la vista agrupada, la numeración empieza nuevamente dentro de cada especialidad.
- Mi Estado sigue calculándose localmente, sin consultas nuevas al abrir la vista.

### Revisión de respondidas

- Campo `Ir a` para saltar a una posición concreta.
- Botón `Última`.
- Botón `Salir` disponible desde cualquier pregunta intermedia.
- En sesiones parciales se muestra la posición dentro de las respondidas y la posición original en la sesión completa.
- Salir de una revisión histórica vuelve al historial; salir de una revisión recién terminada vuelve al inicio.

### Notas personales de aprendizaje

- Tabla y flujo separados de `question_review_flags`.
- Una nota expresa un vacío personal; no afirma que la pregunta esté mal.
- Tipos: duda general, fármaco/mecanismo, valor/dosis/corte, diferencial, explicación no comprendida y otro dato.
- Edición, cierre, descarte e historial trazable.
- Exportación Markdown y CSV con:
  - duda y `note_id`;
  - pregunta, alternativas y clave histórica;
  - criterio auditado y explicación disponibles;
  - taxonomía canónica y rentabilidad;
  - cobertura personal e historial de intentos;
  - existencia de un flag de auditoría paralelo;
  - protocolo Anki vigente y estrategia preliminar de posición.

## Flujo Anki previsto

Cada nota debe resolverse como una de estas decisiones:

- `ALREADY_COVERED`;
- `UPDATE_EXISTING_CARD`;
- `CREATE_NEW_CARD`;
- `RESOLVED_WITHOUT_ANKI`.

La exportación ordena el trabajo por **MUY ALTA → ALTA → MEDIA → BAJA** y puntaje descendente. Si el tema ya fue iniciado, una tarjeta realmente nueva debe quedar entre las primeras nuevas pendientes de su mazo/tier. Colocarla cerca de tarjetas conceptualmente relacionadas solo se hará cuando un `.colpkg` actualizado permita verificar y modificar el orden sin dañar GUID, programación o historial.

Las instrucciones Anki vigentes del Contexto Maestro siempre prevalecen sobre el texto exportado por una versión anterior de la app.

## Migración de Supabase

Ejecutar:

`MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql`

La migración es idempotente y:

- crea `public.question_learning_notes`;
- permite una sola nota `OPEN` por usuario/pregunta;
- conserva cierres históricos ilimitados;
- aplica Row Level Security por usuario;
- no toca sesiones, intentos, memoria, preguntas ni flags.

Después puede ejecutarse `QA/VERIFY_SUPABASE_V1_2_0.sql`.

## Publicación segura

1. Respaldar el despliegue v1.1.1.
2. No borrar almacenamiento local ni IndexedDB.
3. Aplicar la migración de notas.
4. Publicar todos los archivos.
5. Recargar y verificar `v1.2.0`.
6. Ejecutar el smoke real descrito en `QA_V1_2_0.md`.

## QA automatizado

```bash
python3 QA/qa_v1_2_0.py
python3 QA/qa_browser_v1_2_0.py
```

El segundo comando requiere Python Playwright y Chromium; el primero no depende del navegador.

---

## Archivo original: `README_V1_3_0.md`

# Residentado v1.3.0 — catálogo TTS en Debilidades y Cobertura canónica

## Base y alcance

Este release parte de **Residentado v1.2.0** y conserva íntegramente:

- PT409/HTTP 409 para conflictos funcionales de sesión;
- recuperación antes de descartar estado local;
- lease entre pestañas;
- validación de `state_revision` al cerrar;
- notas personales separadas de flags;
- navegación de revisión;
- numeración de Cobertura canónica;
- cálculo local de Mi Estado.

No modifica las 2.180 preguntas, taxonomía, rentabilidad, claves históricas, explicaciones, intentos, memoria, sesiones, flags ni notas.

## Integración TTS

La fuente autoritativa online es:

`public.tts_topic_catalog`

La tabla fue creada y cargada previamente con TTS_001–089 y quedó protegida como solo lectura para `authenticated`.

La aplicación sigue esta secuencia:

1. carga `tts_catalog.json` como respaldo local;
2. después de autenticar al usuario, realiza una sola consulta `SELECT` a `tts_topic_catalog`;
3. normaliza el formato Supabase y reemplaza el respaldo únicamente si recibe filas válidas;
4. conserva el respaldo si hay error de red, permisos, tabla ausente o respuesta vacía;
5. comparte el mismo `Map` local entre Debilidades, Cobertura canónica y el detalle de tema.

No existe polling y no se consulta Supabase por tema, fila, ordenamiento o cambio de vista.

## Cambios visibles

### Tu mapa actual de debilidades

- La columna TTS usa el catálogo V061 actualizado.
- Los temas disponibles muestran código y estado, por ejemplo `TTS_089 · Completa · 7 partes`.
- Los temas sin lectura muestran `Pendiente`.
- El encabezado declara número de TTS, versión del catálogo y fuente utilizada.
- El botón continúa copiando un pedido de suplemento cuando la lectura ya existe o un pedido de TTS cuando está pendiente.

### Mi Estado → Cobertura canónica

- Nueva columna `TTS` en la vista de temas.
- La vista agrupada conserva la columna dentro de cada especialidad.
- El resumen de cada especialidad muestra `TTS disponibles/temas`.
- El detalle del tema muestra el estado TTS y permite copiar el pedido correspondiente.
- El bloque declara catálogo, cantidad disponible y si se usó Supabase o el respaldo local.

## Respaldo local

`tts_catalog.json` contiene los 274 temas:

- 89 en estado `COMPLETE` — TTS_001–089;
- 185 en estado `PENDING`.

Este respaldo permite que la disponibilidad siga visible sin conexión. Las futuras altas en Supabase aparecerán online después de recargar, sin exigir una nueva versión de la webapp. El respaldo local puede actualizarse en un release posterior para mejorar la experiencia offline.

## Supabase

No hay migración pendiente para publicar v1.3.0. Se incluyen por trazabilidad:

- `MIGRATIONS/20260805_ADD_TTS_TOPIC_CATALOG_V061.sql`;
- `MIGRATIONS/20260805_FIX_TTS_TOPIC_CATALOG_READONLY_C1.sql`;
- verificadores asociados.

No volver a ejecutarlos salvo necesidad documentada; son idempotentes o correctivos, pero el estado ya fue validado.

## QA

```bash
python3 QA/qa_v1_3_0.py
python3 QA/qa_browser_v1_3_0.py
```

Resultados de la entrega:

- sintaxis JavaScript: PASS;
- guardrails v1.1.1: PASS;
- funciones v1.2.0: PASS;
- catálogo estático 274/89: PASS;
- normalización Supabase snake_case: PASS;
- Cobertura canónica con TTS: PASS;
- Debilidades con TTS: PASS;
- vista por especialidad: PASS;
- smoke headless: PASS.

---

## Archivo original: `VALIDACION_V1_1_1.md`

# Validacion - Residentado v1.1.1

## Automatico

Se ejecutaron node --check en app.js, session-core.js, session-storage.js, service-worker.js, version.js, question-parser.js, w3-tools.js y w4-data.js.

Los tests de session-core verifican: remoto superior vence a local conflictivo inferior; local pending de igual revision se conserva; el fingerprint ignora timestamps volatiles y detecta progreso distinto.

Comando: python3 QA/qa_v1_1_1.py
Resultado esperado: QA v1.1.1: OK

## Supabase ya verificado

usa_pt409=true y elimino_40001=true.

## Manual despues de desplegar

A. Confirmar v1.1.1 y cache nueva.
B. No borrar IndexedDB; comprobar recuperacion local si existe diferencia.
C. Responder y navegar rapido: los guardados deben consolidarse.
D. Abrir la misma sesion en otra pestana: debe bloquearse.
E. Forzar revision obsoleta: debe devolver PT409, crear una recuperacion y no repetir la outbox.
F. Cerrar con revision obsoleta: no debe sobrescribir; debe recuperar y reintentar una vez.
G. Observar logs cinco minutos: sin crecimiento continuo de errores.

## Limite

La QA automatica no se conecto al Supabase real ni ejecuto una sesion del usuario. La prueba manual posterior al despliegue sigue siendo obligatoria.
