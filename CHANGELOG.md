# Changelog - Residentado

## v1.4.1 - 2026-08-18

Hotfix de uniformidad funcional sobre v1.4.0. No modifica Supabase, dataset, taxonomía, memoria, scheduler ni simulacros.

- hace visible `🤷 No sé` en **toda sesión de práctica**, incluida práctica personalizada con tiempo por pregunta o tiempo total, sprints y entrenamiento de velocidad;
- conserva la semántica canónica de `No sé`: respuesta incorrecta explícita, `selected_answer = null`, `timed_out = false`, `speed_bucket = dont_know` y `NO_SE_EXPLICITO`;
- diferencia `No sé` de un timeout incluso cuando existe cronómetro; el tiempo real transcurrido sigue guardándose;
- en corrección inmediata usa `No sé · mostrar respuesta`; en corrección al final usa `No sé · continuar`;
- mantiene el marcador `?`, mezcla de alternativas, cierre/reanudación, navegación y revisión con el mismo motor compartido `launchStudy`;
- deja los simulacros estándar e históricos sin cambios, preservando su formato especial y reglas propias.

## v1.4.0 - 2026-08-18

Adaptación estructural a la taxonomía V3 congelada en A16, preparada sobre el ZIP v1.3.4 vigente. No aplica cambios directamente a Supabase, Anki ni TTS.

- carga `questions` y `rentability_topics` como un bundle versionado y rechaza combinaciones incompatibles antes de reemplazar IndexedDB;
- invalida automáticamente el corpus local cuando cambia `dataset_revision`, `taxonomy_version` o el número de topics activos;
- migra la identidad del selector de topics desde rutas basadas en labels a `rentability_topic_id`, preservando compatibilidad con selecciones V2 mediante aliases/deprecaciones;
- añade filtros individuales MUY_ALTA, ALTA, MEDIA y BAJA, conservando el filtro combinado MUY_ALTA+ALTA;
- Mi Estado calcula cobertura taxonómica sobre las 2.180 preguntas del corpus y topics activos dinámicos; las preguntas observadas siguen excluyéndose únicamente de las métricas adaptativas de precisión/debilidad;
- evita sintetizar un tier de especialidad: el promedio de scores por especialidad se presenta explícitamente como descriptivo;
- mantiene TTS por coincidencia exacta de topic ID y no realiza aún la migración de Anki/TTS;
- incorpora migración Supabase por staging, transacción, backups fuera de `public`, aliases/deprecaciones, relaciones secundarias, controles pre/post y rollback;
- preserva byte por byte `session-core.js` y `session-storage.js` del baseline v1.3.4, incluidos PT409, leases y recuperación no destructiva;
- corrige una inconsistencia de trazabilidad del baseline: `version.js` ya estaba en v1.3.4 pero `RELEASE_MANIFEST.json` y `QA/qa_static.py` seguían anclados a v1.3.1.

## v1.3.4 - 2026-08-17

Hotfix de ciclo de vida de sesiones conflictivas sobre v1.3.3. No modifica el plan de estudio, cobertura, memoria, retención ni selección de preguntas.

- evita lanzar un guardado activo redundante justo antes de «Terminar y revisar respuestas»; el cierre persiste directamente el estado final con control optimista de revisión;
- durante un cierre explícito, un PT409 ya no muestra la alerta bloqueante que decía que se continuaría en una recuperación; el flujo termina y navega a revisión como fue solicitado;
- deduplica recuperaciones de forma persistente en IndexedDB, no solo mediante un `Map` válido durante una ejecución;
- detecta sombras locales `conflict` huérfanas cuyo UUID ya no existe en Supabase; antes de retirarlas verifica o crea una recuperación equivalente y elimina operaciones obsoletas del outbox;
- si una recuperación fue cerrada explícitamente, retira de forma optimista la sesión fuente que quedó activa por el conflicto usando `status=abandoned`, sin modificar su estado clínico/progreso y conservando la copia de recuperación;
- elimina la sombra conflictiva local y sus operaciones pendientes después de preservar/comparar el progreso, evitando que la misma sesión vuelva a aparecer o vuelva a generar cadenas de duplicados;
- conserva PT409, control por `state_revision`, UUID independiente para recuperaciones, lease entre pestañas e IndexedDB no destructivo;
- no requiere migración SQL ni cambios manuales en Supabase.

## v1.3.3 - 2026-08-17

Actualización metodológica preexamen basada en el progreso real exportado el 17/08/2026 y en una disponibilidad declarada de 6–7 h/día para preguntas + 2 h/día de Anki.

- elimina la **deuda histórica acumulada** como controlador del plan diario; los días de viaje ya no generan una deuda imposible de recuperar antes del examen;
- sustituye el calendario rígido por dos estados operativos: **Cobertura intensiva** hasta 10 días antes del examen y **Consolidación final** después;
- calcula el objetivo de preguntas nuevas a partir de las preguntas válidas aún no vistas y de los días restantes hasta el cierre de primera vuelta;
- crea `new_coverage`: primera vuelta estrictamente por rentabilidad **MUY_ALTA → ALTA → MEDIA → BAJA**, con prioridad adaptativa dentro de cada tier;
- limita el bloque de repasos para que el backlog vencido no pueda volver a desplazar la cobertura nueva;
- crea un bloque `fragile` basado en último error, duda o rendimiento reciente inestable;
- `questionPriority` deja de arrastrar para siempre errores y lentitud antiguos: debilidad/velocidad se calculan con las últimas 5 exposiciones y `wrong_fast` con las últimas 3;
- el bloque de velocidad solo incluye preguntas cuya **última** respuesta correcta sigue por encima de su objetivo; al volverse fluida sale automáticamente de esa cola;
- impide que los bloques automáticos del mismo día reutilicen preguntas ya contestadas ese día;
- elimina el fallback silencioso de colas vacías hacia `priority`, fuente de repeticiones inesperadas;
- mantiene 93 % de retención para MUY_ALTA/ALTA durante cobertura intensiva; desde 28/08 sube MUY_ALTA/ALTA a 95 %, MEDIA a 93 % y deja BAJA en 90 %;
- preserva el comportamiento histórico de retención hasta 17/08 para que la reconstrucción de memoria sea determinista;
- `question_memory_state` se reconcilia contra `attempts` incluso cuando `last_attempt_at` coincide, corrigiendo drift de contadores/estabilidad;
- un intento reenviado por sincronización ya no puede evolucionar la memoria por segunda vez;
- resuelve sombras locales `conflict` cuyo registro remoto ya está cerrado y evita crear una nueva recuperación al cerrar una sesión que el servidor ya considera cerrada;
- Mi Estado utiliza como denominador principal las preguntas **válidas/no observadas**, coherente con el corpus que usa el scheduler;
- no requiere migración ni cambios manuales en Supabase.


## v1.3.2 - 2026-08-17

Hotfix mínimo de sesiones sobre v1.3.1. **No modifica el algoritmo de memoria, `questionPriority`, `smartPool`, intervalos, retención objetivo, deuda ni metas del plan.**

- vincula cada sesión automática al día concreto del checklist mediante `planDate`;
- mantiene compatibilidad con sesiones automáticas antiguas infiriendo su día desde `created_at`;
- las copias de recuperación conservan el día del plan de la sesión origen, aunque la recuperación se cree en una fecha posterior;
- una sesión automática de un día anterior deja de convertir la tarea de hoy en «Continuar»;
- las sesiones automáticas antiguas se conservan en «Sesiones en curso» para recuperación o cierre, sin desplazar la selección adaptativa del día actual;
- al iniciar la tarea de hoy, las preguntas vuelven a seleccionarse con el `smartPool` original usando intentos, memoria, vencimiento, debilidad, velocidad y rentabilidad actuales;
- tras preservar una copia local divergente como recuperación, la fila remota canónica deja de quedar ocultada por una sombra marcada `conflict` con el mismo ID;
- no añade cooldown fijo ni excluye preguntas por un número arbitrario de días;
- no requiere cambios en Supabase ni migraciones.

## v1.3.1 - 2026-08-06

Release compatible construido sobre v1.3.0. No modifica sesiones, intentos, memoria, notas, preguntas ni Supabase.

- sustituye la exportación simple de observaciones por un único CSV autosuficiente para auditoría y parche;
- consulta directamente a Supabase, solo al pulsar exportar, las filas completas actuales de `question_review_flags` y `questions`;
- exporta dinámicamente todas las columnas existentes, con prefijos `flag__` y `question__`;
- añade metadatos de lote, versión, fuente autoritativa, conteos y revisión/hash para control de concurrencia;
- impide exportar si no hay sesión autenticada o Supabase devuelve IDs incompletos;
- conserva el contenido exacto de campos multilínea dentro de celdas CSV entrecomilladas;
- elimina de la interfaz de flags la copia de texto y deja un solo botón de CSV completo.

## v1.3.0 - 2026-08-05

Release funcional construido sobre v1.2.0. Conserva sus funciones y todos los guardrails de v1.1.1.

- integra `public.tts_topic_catalog` como fuente autoritativa online de disponibilidad TTS;
- carga el catálogo una vez por sincronización y no por fila o vista;
- conserva respaldo local V061 con 274 temas y TTS_001–089 disponibles;
- actualiza Tu mapa actual de debilidades con código y estado TTS;
- añade columna TTS a Mi Estado → Cobertura canónica;
- añade conteo TTS en la vista agrupada por especialidad;
- añade estado y pedido TTS en el detalle de tema;
- mantiene Mi Estado calculado localmente y sin polling;
- no modifica corpus, progreso, sesiones, memoria, flags ni notas.

## v1.2.0 - 2026-08-05

Release funcional construido sobre v1.1.1. Conserva todos los guardrails de sesiones y añade:

- numeración de Cobertura canónica;
- salto directo, Última y Salir en revisión;
- posición original para cierres parciales;
- notas personales de aprendizaje separadas de flags;
- exportación Markdown/CSV con protocolo Anki y trazabilidad;
- migración RLS `question_learning_notes`;
- QA estático, unitario y smoke headless.

## v1.1.1 - 2026-08-05

Primera base estable posterior a v1.1.0-rc2. v1.1.0 no se promueve a estable por INC-20260805-SESSION-40001.

### Persistencia de sesiones

- FIX-SESSION-001: PT409/HTTP 409 reemplaza SQLSTATE 40001.
- FIX-SESSION-002: se detienen guardados contra una revision obsoleta.
- FIX-SESSION-003: un conflicto no entra en la outbox como fallo de red.
- FIX-SESSION-004: la revision remota superior prevalece; el estado local distinto se conserva como recuperacion.
- FIX-SESSION-005: lease por pestana con localStorage y BroadcastChannel.
- FIX-SESSION-006: CREATE_SESSION offline usa INSERT, nunca upsert destructivo.
- FIX-SESSION-007: beforeunload no lanza un segundo guardado asincrono.
- FIX-SESSION-008: el cierre valida state_revision y recupera antes de reintentar.

### Optimizacion y publicacion

- OPT-SAVE-001: debounce de 1 segundo y deduplicacion de eventos de salida.
- FIX-RELEASE-001: version.js es fuente canonica; navegacion network-first.
- VERIFY-EGRESS-001: corpus condicionado por manifiesto e IndexedDB; sin polling completo.
- VERIFY-STATE-001: Mi Estado se calcula localmente.

## v1.1.0-rc2 - retirada

Se retiro porque un conflicto funcional usaba SQLSTATE 40001 y podia disparar reintentos internos masivos.
