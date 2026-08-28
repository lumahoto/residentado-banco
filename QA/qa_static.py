#!/usr/bin/env python3
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / 'MIGRATIONS' / '20260818_TAXONOMY_V3_A16'
EXPECTED = json.loads((ROOT / 'docs' / 'TAXONOMY_V3_A16_EXPECTED.json').read_text(encoding='utf-8'))
errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

def js_check(name):
    result = subprocess.run(['node', '--check', str(ROOT / name)], capture_output=True, text=True)
    require(result.returncode == 0, f'Sintaxis JS inválida en {name}: {result.stderr.strip()}')

for name in ['app.js','session-core.js','session-storage.js','service-worker.js','version.js','question-parser.js','w3-tools.js','w4-data.js']:
    js_check(name)

app = (ROOT/'app.js').read_text(encoding='utf-8')
core = (ROOT/'session-core.js').read_text(encoding='utf-8')
storage = (ROOT/'session-storage.js').read_text(encoding='utf-8')
sw = (ROOT/'service-worker.js').read_text(encoding='utf-8')
version = (ROOT/'version.js').read_text(encoding='utf-8')
index = (ROOT/'index.html').read_text(encoding='utf-8')
manifest = json.loads((ROOT/'RELEASE_MANIFEST.json').read_text(encoding='utf-8'))
w3 = (ROOT/'w3-tools.js').read_text(encoding='utf-8')
w4 = (ROOT/'w4-data.js').read_text(encoding='utf-8')

# Guardrail documental: v1.5.9 no crea archivos versionados auxiliares nuevos.
for forbidden in [
    ROOT/'QA'/'QA_RELEASE_V1_5_9.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_9.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_9.md',
    ROOT/'QA'/'QA_RELEASE_V1_5_8.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_8.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_8.md',
    ROOT/'QA'/'QA_RELEASE_V1_5_7.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_7.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_7.md',
    ROOT/'QA'/'QA_RELEASE_V1_5_6.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_6.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_6.md',
    ROOT/'QA'/'QA_RELEASE_V1_5_5.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_5.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_5.md',
    ROOT/'QA'/'QA_RELEASE_V1_5_4.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_4.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_4.md',
    ROOT/'QA'/'QA_RELEASE_V1_5_3.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_3.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_3.md',
]:
    require(not forbidden.exists(), f'Proliferación documental no permitida: {forbidden.relative_to(ROOT)}')

# Release/version consistency.
require("version: '1.5.9'" in version, 'version.js no declara 1.5.9')
require("cacheName: 'residentado-v1-5-9'" in version, 'version.js no declara cache v1.5.9')
require(manifest.get('version') == '1.5.9', 'RELEASE_MANIFEST no coincide con v1.5.9')
require(manifest.get('taxonomy', {}).get('source_release_id') == EXPECTED['release_id'], 'El release fuente de taxonomía V3/A16 es inconsistente')
require('window.RESIDENTADO_BUILD?.version' in app, 'app.js no consume version.js')
require("importScripts('./version.js')" in sw, 'service-worker.js no consume version.js')
require('<script src="./version.js"></script>' in index, 'index.html no carga version.js')

# Session/concurrency guardrails: byte-identical to the actual v1.3.4 baseline supplied on 2026-08-17.
protected = {
    'session-core.js':'d5875ebfdbe3b1658023617948f38c99746ca74c3412607103c28fabe156b7f5',
    'session-storage.js':'eed7339ad479d21cefb6429210c350f8c2fcd551d78449359798c15a405e68da',
}
for name, expected_hash in protected.items():
    actual = hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
    require(actual == expected_hash, f'{name} cambió respecto del baseline v1.3.4')
pt409 = (ROOT/'MIGRATIONS/20260805_FIX_SESSION_CONFLICT_PT409.sql').read_text(encoding='utf-8').lower()
require("raise sqlstate 'pt409'" in pt409, 'La migración de conflicto no usa PT409')
require("errcode = '40001'" not in pt409, 'Se reintrodujo SQLSTATE 40001')
require("queueOperation('UPSERT_SESSION'" in app, 'Falta cola offline de sesiones')
require("from('practice_sessions').upsert" not in app, 'CREATE_SESSION volvió a usar upsert destructivo')
require('if (isSessionConflictError(error)) return handleSessionRevisionConflict' in app, 'Falta recuperación PT409')
require('SESSION_LEASE_HEARTBEAT_MS' in app and 'BroadcastChannel' in app, 'Falta guardia entre pestañas')
require('OUTBOX_LOCK_NAME' in app and 'navigator.locks?.request' in app and 'outboxProcessPromise' in app, 'Falta mutex de outbox entre/intra pestañas')
require('isAttemptSessionForeignKeyError' in app and 'SESSION_NOT_FOUND_23503' in app and 'orphaned_session' in app, 'Falta reparación terminal de attempt huérfano 23503')
require("a.type === 'CREATE_SESSION' ? 0 : 1" in app, 'CREATE_SESSION no tiene prioridad sobre operaciones dependientes del outbox')
require('SESSION_NAVIGATION_CHECKPOINT_MS = 30000' in app, 'Falta checkpoint remoto diferido de navegación')
require('localOnly:currentStudy.config.feedback' in app, 'La respuesta inmediata sigue lanzando un save remoto antes de persistir el attempt')
require('OPT-SAVE-002' in app and 'baseFingerprint === nextFingerprint' in app, 'Falta supresión de RPC de sesión sin cambios')
require(".eq('state_revision', expectedRevision)" in app, 'El cierre no valida state_revision')
require('localRevision > remoteRevision' in core and 'localRevision === remoteRevision && localPending' in core, 'Reglas de reconciliación de sesiones alteradas')
# v1.4.3: regresiones del incidente PT409/recovery replay.
require('function sessionStateContains' in app, 'Falta detector de snapshot local contenido por remoto')
require("sessionStateContains(remote.state || {}, local.state || {})" in app, 'Outbox PT409 no descarta snapshot atrasado ya contenido por remoto')
require('function persistedAttemptForIdentity' in app, 'Falta resolución global de attempt_id/client_attempt_id')
require("Recovery attempt identity not loaded; refusing to fabricate a duplicate." in app, 'Falta failsafe contra attempts duplicados en recovery')
require('detachInheritedAttemptIdentity(currentStudy, q.id)' in app, 'Respuesta nueva en recovery de práctica no separa identidad heredada')
require('detachInheritedAttemptIdentity(currentExam, q.id)' in app, 'Respuesta nueva en recovery de simulacro no separa identidad heredada')

# v1.5.7: conserva guardrails v1.5.5 y añade únicamente QRV2/referencias frontend.
require('function renderReviewSummary()' in app and 'REVIEW_FILTERS' in app, 'Falta Centro de revisión único')
for token in ["['incorrect','Incorrectas']", "['dont_know','No sé']", "['doubt','? Duda']", "['notes','Notas']", "['marked','Marcadas']", "['review_flag','Revisar']", "['audit','Auditoría']"]:
    require(token in app, f'Falta filtro del Centro de revisión: {token}')
require('canonical_entity || q.subtopic' in app and 'review-question-row' in app, 'La hoja informativa no expone Tema/Entidad')
require('data-question-doubt-top' in app and 'data-question-doubt-label' in app, 'La duda no tiene controles superior/inferior sincronizados')
require('data-uncertain-toggle' not in app, 'Se reintrodujo el ? por alternativa')
require("REEXPOSE_EXISTING_CARD" in app and "ACTIVE_LEARNING_NOTE_OUTCOMES" in app, 'Falta reexposición Anki obligatoria')
require('ensureLearningNoteForContentReview' not in app, 'v1.5.7 reintrodujo acoplamiento automático flag CONTENT → Nota')
require("CONTENT: { label:'Contenido clínico', icon:'🧠', ankiRequired:false }" in app, 'CONTENT no está definido como auditoría independiente')
require("learningScope === 'CONTENT' && cloudConfigured && !learningNotesAvailable" not in app, 'Flag CONTENT todavía depende de disponibilidad de Notes')
require('EDITORIAL_TECHNICAL' in app and 'data-set-review-scope' in app, 'Falta separación Contenido vs Editorial/técnico')
require('function expireActiveSessionAtDayBoundary' in app and "closed_reason:hasAnswers ? 'day_expired_partial' : 'day_expired_empty'" in app, 'Falta autocierre diario')
require('statusOnly:true' in app, 'El autocierre diario no usa cierre status-only')
expiry = app[app.find('async function expireActiveSessionAtDayBoundary'):app.find('async function expireStaleActiveSessions')]
require('ensureStudyAttempts' not in expiry and 'ensureExamAttempts' not in expiry and "from('attempts')" not in expiry, 'El autocierre diario intenta materializar attempts')
require("if (!error && !data && p.statusOnly)" in app and "persistRecoverySession(local, 'close_revision_conflict')" in app, 'Falta separación entre cierre status-only y recovery ordinaria')
require((ROOT/'MIGRATIONS/20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql').exists(), 'Falta migración v1.5.0')
mig150=(ROOT/'MIGRATIONS/20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql').read_text(encoding='utf-8')
require('learning_scope' in mig150 and 'REEXPOSE_EXISTING_CARD' in mig150, 'Migración v1.5.0 incompleta')
require('update public.attempts' not in mig150.lower() and 'update public.question_memory_state' not in mig150.lower(), 'Migración v1.5.0 toca progreso de usuario')

# Práctica personalizada heredada: selección y presentación siguen siendo contratos separados.
for token in ['id="selection-order"', 'id="presentation-order"', "function orderSelectionPool", "function orderSessionQuestions", "function compareCanonicalRentability"]:
    require(token in app, f'Falta contrato de práctica personalizada heredada en v1.5.7: {token}')
require("selectionOrder === 'RENTABILITY'" in app and "presentationOrder === 'QUEUE'" in app, 'Faltan ramas RENTABILITY/QUEUE')
require("rentabilityTierRank(b) - rentabilityTierRank(a)" in app and "bScore > aScore ? 1 : -1" in app and "localeSort(a?.id, b?.id)" in app, 'Ranking canónico no tiene tier + score + desempate estable')
require('questionPriority(' not in app[app.find('function orderSelectionPool'):app.find('function filterPool')], 'Selección por rentabilidad contaminada con prioridad personal')
require("if (mode === 'exam') {\n        const selected = (config.randomize ? shuffle(pool) : pool).slice(0, config.count);" in app, 'Simulacro no conserva randomize legacy v1.5.2')
require('examQuestionEnteredAt = 0;' in app[app.find('function renderExamOverview'):app.find('function examAttemptPayload')], 'Overview de simulacro sigue atribuyendo tiempo de revisión a una pregunta')
require('startExamTimer();' in app[app.find('function renderExamOverview'):app.find('function examAttemptPayload')], 'Overview de simulacro sigue pausando el cronómetro')
require('id="timer" class="value"' in app[app.find('function renderExamOverview'):app.find('function examAttemptPayload')], 'Overview no actualiza visualmente el tiempo restante')
require(manifest.get('scope', {}).get('practice_ui_change') is False, 'v1.5.9 no debe declarar cambio de práctica ordinaria')

# v1.5.7 QRV2: referencias nominadas + bloque completo plegable.
for token in ['function qrv2Profile', 'function qrv2MigrationStatus', 'Núcleo rápido', 'Detalle útil', 'Fuentes y trazabilidad', 'q.audit_source_urls']:
    require(token in app, f'Falta componente QRV2 v1.5.7: {token}')
reference_renderer = app[app.find('function referenceQuickHtml'):app.find('function auditEditorialHtml')]
require('q.reference_notes' not in reference_renderer, 'v1.5.7 volvió a renderizar reference_notes en la experiencia de estudio')
require('Notas generales' not in reference_renderer, 'v1.5.7 volvió a mostrar Notas generales editoriales')
require('Fuentes y trazabilidad' in reference_renderer and '<details class="qrv2-collapsible">' in reference_renderer, 'Fuentes QRV2 no permanecen colapsadas')
require('<details class="explain-block quick-reference qrv2-reference qrv2-reference-collapsible">' in reference_renderer, 'Referencia rápida completa no es plegable')
require('qrv2-reference-summary' in reference_renderer and '<details class="explain-block quick-reference qrv2-reference qrv2-reference-collapsible" open' not in reference_renderer, 'Referencia rápida no queda cerrada por defecto')
source_parser = app[app.find('function auditSourceLinks'):app.find('function referenceQuickHtml')]
for token in ['markdownPattern', "['http:','https:']", 'sources = new Map()', 'normalizedLabel', 'legacyMatches', 'item.label || fallback']:
    require(token in source_parser, f'Parser de referencias nominadas incompleto: {token}')
require("raw.replace(markdownPattern" in source_parser, 'Parser no excluye enlaces Markdown antes del fallback legacy')
for feedback_name, feedback_end in [('renderReviewFeedbackFallback', 'renderFeedback'), ('renderFeedback', 'function renderQuestion')]:
    start = app.find(f'function {feedback_name}')
    end = app.find(feedback_end, start + 1)
    segment = app[start:end if end != -1 else None]
    memory_pos = segment.find('Gancho de memoria')
    reference_pos = segment.find('${quickReference}')
    note_pos = segment.find('learning-note-action')
    require(memory_pos != -1 and reference_pos != -1 and note_pos != -1 and memory_pos < reference_pos < note_pos, f'{feedback_name}: orden requerido es Gancho de memoria → Referencia rápida → Añadir nota')
require('feedback-next-actions' in app, 'Siguiente pregunta no usa footer dedicado de alineación')
styles = (ROOT/'styles.css').read_text(encoding='utf-8')
require('.post-answer-reflection .btn' in styles and 'justify-self: end' in styles, 'Marcar duda no está alineado a la derecha en escritorio')
require('.feedback-next-actions' in styles and 'justify-content: flex-end' in styles, 'Siguiente pregunta no está alineado a la derecha')
require('const referent = comparisonTitle || entity || topic' in app, 'QRV2 no prioriza comparison_title/Entidad como referente explícito')
require('💊 Fármacos y antibióticos' not in app, 'QRV2 conserva encabezado farmacológico genérico que oculta el referente')
require('rel="noopener noreferrer"' in app, 'Fuentes QRV2 no protegen enlaces externos')
require(manifest.get('scope', {}).get('review_flag_semantics_change') is False, 'v1.5.7 no debe declarar cambio semántico flag/nota')

# v1.5.7 simulacro realista 2026: dos partes independientes y B bloqueada.
for token in [
    'Simulacro realista 2026',
    'function historicalSeriesComplete',
    'function twoPartExamEnabled',
    'function activeExamBounds',
    'function examBreakPending',
    'function beginExamBreak',
    'function continueAfterExamBreak',
    'breakDurationSeconds:3600',
    "base.partSeconds = base.official2026 ? 120 * 60",
    "base.breakDurationSeconds = base.official2026 ? 60 * 60",
    "if (twoPartExamEnabled() && !currentExam.state.breakTaken) await beginExamBreak(true)",
]:
    require(token in app, f'Falta contrato de simulacro realista v1.5.7: {token}')
require('list.length !== expected' in app and 'value === index + 1' in app, 'Catálogo histórico no exige numeración exacta y completa')
require('activeExamEntries().map(({q:x,index:i}) => examGridButton(x,i))' in app, 'Navegación no se restringe al bloque activo')
require("twoPartExamEnabled() ? i - bounds.start + 1 : i + 1" in app, 'Parte B personalizada no renumera 1–100 dentro del bloque')
require("currentExam.state.breakTaken = false" in app[app.find('async function beginExamBreak'):app.find('function startBreakTimer')], 'El intermedio no persiste como estado pendiente')
require("currentExam.state.breakTaken = true" in app[app.find('async function continueAfterExamBreak'):app.find('function renderBreakScreen')], 'La Parte B no se desbloquea explícitamente al terminar el intermedio')
require('Intermedio oficial: 60 minutos' in app, 'La UI no muestra la duración oficial del intermedio')
require('Finalizar Parte A' in app and 'Iniciar Parte B' in app, 'Faltan acciones explícitas de transición A→B')
require('flex-wrap: wrap' in styles and '@media (max-width: 360px)' in styles, 'Falta microfix responsive del footer a 320–360 px')

# v1.5.8: Dashboard operativo + Revisión del día read-only.
render_dashboard = app[app.find('  function renderDashboard()'):app.find('\n  function renderPracticeHub', app.find('  function renderDashboard()'))]
require(render_dashboard.find('${primaryActiveSession') >= 0, 'No se localizó Siguiente tarea/Continuar sesión en Dashboard')
require(render_dashboard.find("priorityReadingAlertMarkup(readingAlert, 'dashboard-reading')") >= 0, 'No se localizó alerta prioritaria en Dashboard')
require(render_dashboard.find('${primaryActiveSession') < render_dashboard.find("priorityReadingAlertMarkup(readingAlert, 'dashboard-reading')"), 'Dashboard no coloca Siguiente tarea inmediatamente antes de la alerta académica')
for token in [
    'HISTORY_DAY_REVIEW_FILTERS',
    "['all','Todas']",
    "['incorrect','Erradas']",
    "['doubt','Duda ?']",
    "['dont_know','No sé']",
    "['slow','Lentas']",
    "['review_flag','Revisar']",
    "type:'history_day_filter'",
    'data-history-day-review',
    'historyDayReviewEntries',
    'historyDayAttemptIsSlow',
    'readOnlyHistoryDay:true',
]:
    require(token in app, f'Falta contrato v1.5.8 de Revisión del día: {token}')
require("!attempt.is_correct || attempt.was_uncertain || attempt.timed_out" in app and "response_time_ms || 0) > target * 1000" in app, 'Lentas no reutiliza el criterio existente de respuesta correcta/no dudosa por encima del objetivo')
open_day_start = app.find('  function openHistoryDayReview(')
open_day_end = app.find('\n  async function renderHistory', open_day_start)
require(open_day_start >= 0 and open_day_end > open_day_start, 'No se pudo aislar openHistoryDayReview')
if open_day_start >= 0 and open_day_end > open_day_start:
    day_body = app[open_day_start:open_day_end]
    for forbidden in ['ensureHistorySessionAttempts(', 'recordAttempt(', 'recordAttemptsBatch(', 'createPersistentSession(', 'finalizeSessionRow(', "from('practice_sessions')", "from('attempts')", 'applyAttemptsToMemory(', 'scheduleCurrentSessionSave(', 'persistExamState(']:
        require(forbidden not in day_body, f'Revisión del día puede escribir/crear progreso: {forbidden}')
require("historyDayReview?'':questionDoubtButton(q.id, questionDoubt)" in app, 'Revisión del día todavía expone ? editable en cabecera')
require('allowPostMark:!omitted && !historyDayReview' in app, 'Revisión del día todavía permite mutar duda post-respuesta')
require('if (historyDayReview || btn.dataset.questionDoubt !== q.id) return;' in app, 'Falta guardia defensiva contra escritura de duda en revisión del día')
require("if (!historyLegacyAttempt) document.querySelectorAll('[data-review-prev]')" in app, 'La navegación Anterior de revisión histórica filtrada sigue bloqueada')
require(manifest.get('scope', {}).get('dashboard_order_change') is False, 'v1.5.9 no debe declarar un nuevo cambio de orden del Dashboard')
require(manifest.get('scope', {}).get('history_day_review_change') is False, 'v1.5.9 no debe declarar un nuevo cambio de Revisión del día')
require(manifest.get('scope', {}).get('runtime_sync_change') is False, 'Revisión del día no debe declarar cambios de sincronización')
require(manifest.get('scope', {}).get('simulators_changed') is True, 'v1.5.9 debe declarar cambios de simulador')

# v1.5.9: todos los simulacros usan cuadernillo + hoja y scratch reversible independiente de duda.
for token in [
    "examLayout:'paper'",
    'function paperExamIsHistorical',
    'function paperOptionList',
    "state === 'candidate'",
    'function toggleScratchCandidate',
    'function toggleScratchCrossed',
    'data-candidate-index',
    'data-discard-index',
    'function refreshPaperOptionScratch',
    'function flexibleExamBreakPending',
    'Modo simulacro · cuadernillo',
    'preferida tentativa',
]:
    require(token in app, f'Falta contrato v1.5.9 de simulacro/cuadernillo: {token}')
launch_exam = app[app.find('  async function launchExam('):app.find('  async function resumePersistentSession', app.find('  async function launchExam('))]
require("config = { shuffleOptions:true, ...config, examLayout:'paper'" in launch_exam, 'Los simulacros nuevos no fuerzan cuadernillo universal')
require('createOptionOrders(selected, config.shuffleOptions !== false)' in launch_exam, 'Cuadernillo universal no preserva mezcla de alternativas personalizada')
resume_exam = app[app.find('    currentStudy = null;\n    const state = normalizeSessionState(row.state || {});'):app.find('  function accumulateExamTime', app.find('    currentStudy = null;\n    const state = normalizeSessionState(row.state || {});'))]
require("const config = { ...(row.config || {}), examLayout:'paper' };" in resume_exam, 'Simulacro activo legacy no migra a cuadernillo al reanudar')
require('function questionDoubtScratchKey' in app and '__question_doubt__' in app, 'La duda de pregunta no usa persistencia scratch compatible con SessionCore')
question_doubt = app[app.find('  function questionHasDoubt('):app.find('  function setQuestionDoubt', app.find('  function questionHasDoubt('))]
require("state === 'tentative'" in question_doubt and "state === 'candidate'" not in question_doubt, 'La preferencia tentativa v1.5.9 se acopló indebidamente a ? Duda')
answer_sheet = app[app.find('  function historicalAnswerSheetHtml()'):app.find('  function historicalAnsweredCount', app.find('  function historicalAnswerSheetHtml()'))]
require('const sourceLetter = o.sourceLetter || o.letter' in answer_sheet and 'data-answer-letter="${sourceLetter}"' in answer_sheet, 'Hoja de respuestas no conserva mapeo de alternativas mezcladas')
require('.paper-option-wrap.scratch-candidate' in styles and '.paper-option-wrap.scratch-crossed' in styles and '.paper-option-discard.active' in styles, 'Faltan estilos v1.5.9 para candidata/tachado reversible')
require(manifest.get('scope', {}).get('simulators_changed') is True, 'Manifest v1.5.9 no declara simulators_changed')
require(manifest.get('scope', {}).get('scheduler_change') is False, 'v1.5.9 no debe cambiar scheduler')
require(manifest.get('scope', {}).get('memory_algorithm_change') is False, 'v1.5.9 no debe cambiar memoria')

# Taxonomía V3: identidad estable y compatibilidad de aliases.
require('TOPIC_ID:${encodeURIComponent(stableId)}' in app, 'El selector no serializa rentability_topic_id estable')
require('function resolveTopicSelectionKey' in app and 'function topicSelectionMatches' in app, 'Falta resolver selección legacy/alias')
require('topicAliasesBySourceLabel' in app, 'Falta compatibilidad con paths históricos basados en label')
require("from('taxonomy_topic_aliases')" in app, 'La app no carga aliases V2→V3')
require("from('rentability_topics')" in app, 'La app no carga el catálogo autoritativo de topics')
require('function validateCorpusBundle' in app, 'Falta validación atómica del bundle questions+topics')
require('manifestMatchesBundle' in w4, 'W4 no compara revisión + active_topic_count')
require('replaceCorpus(normalized, validation.activeTopics, manifest)' in app, 'La cache no reemplaza questions/topics como bundle validado')
require('indexeddb-stale-invalid-remote' in app, 'No se preserva caché válida ante bundle remoto incompatible')
require('coverage_counting_rule' in app or 'coverageCountingRule' in app or 'EXCLUSIVE_PRIMARY_TOPIC_ONLY' in json.dumps(EXPECTED), 'Falta regla de conteo primario')

# Mi Estado: cobertura usa el corpus completo; observadas solo se excluyen de métricas adaptativas.
require('W3Tools.buildCoverageSnapshot(questions, coverageAttempts, coverageMemory' in app, 'Mi Estado no calcula cobertura sobre las 2.180 preguntas del corpus')
require('Preguntas del corpus vistas ≥1 vez' in app, 'La UI no distingue cobertura total de métricas adaptativas')
require('Puedes ver los ${coverage.totalTopics} temas activos' in app, 'Quedó un conteo de topics no dinámico en Mi Estado')
require('La especialidad es la columna vertebral de navegación' in app, 'Falta navegación conceptual por especialidad primaria')
require('promedio descriptivo ponderado' in app, 'La UI no distingue score descriptivo de especialidad vs tier canónico')

# Filtros de rentabilidad respetan tiers A16, incluido acceso individual.
for token in ['value="muy_alta"','value="alta"','value="media"','value="baja"','matchesRentabilityFilter']:
    require(token in app, f'Falta filtro de rentabilidad {token}')
require("if (filter === 'high') return isHighRentability(q)" in app, 'Se perdió filtro MUY_ALTA+ALTA')

# No hardcodear 274 en runtime. Se permite solo en catálogo TTS legacy/documentación/QA explícita.
runtime_text = '\n'.join((ROOT/name).read_text(encoding='utf-8') for name in ['app.js','w3-tools.js','w4-data.js','version.js','service-worker.js','index.html'])
require('274' not in runtime_text, 'Existe constante runtime 274; el número de topics debe ser dinámico')

# TTS se conserva sin migrar: fallback V061 sigue siendo 274/89, pero la disponibilidad UI puede limitarse a IDs activos.
catalog = json.loads((ROOT/'tts_catalog.json').read_text(encoding='utf-8'))
topics = catalog.get('topics', [])
available = [row for row in topics if row.get('status') in {'COMPLETE','PARTIAL'}]
require(catalog.get('catalogVersion') == 'V061', 'El respaldo TTS legacy cambió de versión')
require(len(topics) == 274, f'El respaldo TTS legacy ya no tiene 274 filas: {len(topics)}')
require(len(available) == 89, f'El respaldo TTS legacy ya no tiene 89 disponibles: {len(available)}')
require('availableTtsCount(rentabilityTopics.length ? rentabilityTopics : null)' in app, 'Debilidades no restringe TTS por topic activo cuando existe catálogo V3')
require('availableTtsCount(coverageTopics)' in app, 'Mi Estado no restringe TTS por topics activos')

# Paridad de práctica v1.4.3 (heredada de v1.4.1): No sé debe existir con o sin cronómetro y seguir separado de timeout.
require('id="dont-know-study"' in app, 'Falta botón No sé en práctica')
require("currentStudy.config.timeMode === 'none' ? `<div class=\"dont-know-row" not in app, 'No sé sigue condicionado a práctica sin límite')
require("if (!q || !currentStudy || studyQuestionLocked(q)) return;" in app, 'No sé no usa el mismo guardrail de bloqueo que las respuestas normales')
require("currentStudy.config.feedback === 'immediate' ? '🤷 No sé · mostrar respuesta' : '🤷 No sé · continuar'" in app, 'No sé no adapta su etiqueta al modo de corrección')
require('no como pregunta en blanco ni como tiempo agotado' in app, 'La UI no distingue No sé de timeout')

# Features previas sensibles siguen presentes.
for token, msg in [
    ('coverage-rank','Cobertura perdió numeración'),('id="review-jump-input"','Falta salto en revisión'),
    ('data-review-last','Falta Última en revisión'),('data-review-exit','Falta salida intermedia'),
    ("from('question_learning_notes')",'Se perdió notas personales'),('async function downloadReviewFlagsCsv','Se perdió exportación autoritativa'),
    ("export__source:'SUPABASE_AUTHORITATIVE'",'CSV ya no declara fuente autoritativa'),('residentado-review-patch-csv-v1','Cambió esquema CSV de revisión')]:
    require(token in app, msg)

# Mi Estado debe seguir 100% local una vez cargado el bundle.
stats_start = app.find('  function renderStats(')
stats_end = app.find('\n  init();', stats_start)
require(stats_start >= 0 and stats_end > stats_start, 'No se pudo localizar renderStats')
if stats_start >= 0 and stats_end > stats_start:
    stats_body = app[stats_start:stats_end]
    require(".from('" not in stats_body and 'supa.' not in stats_body, 'Mi Estado emite consultas Supabase al renderizar')

# Migration package completeness and counts.
required_sql = [
 '01_PRECHECK_READONLY.sql','02_PREPARE_SCHEMA_AND_STAGE.sql','03_LOAD_STAGE_TOPICS_ALIASES_RELATIONS.sql',
 '04_LOAD_STAGE_QUESTIONS.sql','05_VALIDATE_STAGE_READONLY.sql','06_COMMIT_TAXONOMY_V3_A16.sql',
 '07_POSTCHECK_READONLY.sql','08_ROLLBACK_TAXONOMY_V3_A16.sql','README.md']
for name in required_sql: require((MIG/name).exists(), f'Falta migration artifact {name}')
qload=(MIG/'04_LOAD_STAGE_QUESTIONS.sql').read_text(encoding='utf-8')
otherload=(MIG/'03_LOAD_STAGE_TOPICS_ALIASES_RELATIONS.sql').read_text(encoding='utf-8')
commit=(MIG/'06_COMMIT_TAXONOMY_V3_A16.sql').read_text(encoding='utf-8')
rollback=(MIG/'08_ROLLBACK_TAXONOMY_V3_A16.sql').read_text(encoding='utf-8')
require(qload.count('::jsonb') == EXPECTED['question_count'], 'Staging questions no contiene exactamente 2180 payloads')
require(otherload.count('::jsonb') == EXPECTED['active_topic_count'] + EXPECTED['alias_rows'] + EXPECTED['secondary_relation_rows'], 'Staging topics/aliases/relations no coincide con A16')
require("topic_status='DEPRECATED_DISTRIBUTED'" in commit, 'El commit no preserva deprecados')
require('create table residentado_backup.tax_v3_a16_questions_before' in commit, 'Falta backup de questions fuera de public')
require("dataset_revision='QUESTIONS-TAXV3-A16-20260818-R1'" in commit, 'Falta bump de dataset_revision')
require(commit.rfind("dataset_revision='QUESTIONS-TAXV3-A16-20260818-R1'") > commit.find('update public.questions q set'), 'El bump ocurre antes de actualizar questions')
require(commit.rfind("dataset_revision='QUESTIONS-TAXV3-A16-20260818-R1'") > commit.find('update public.rentability_topics t set'), 'El bump ocurre antes de actualizar topics')
for table in ['attempts','practice_sessions','question_review_flags','question_learning_notes','question_memory_state','user_learning_profile']:
    require(f'update public.{table}' not in commit.lower() and f'delete from public.{table}' not in commit.lower() and f'insert into public.{table}' not in commit.lower(), f'El commit toca datos de usuario: {table}')
require('residentado_backup.tax_v3_a16_questions_before' in rollback and 'residentado_backup.tax_v3_a16_topics_before' in rollback, 'Rollback no restaura backups')
require("dataset_revision='QUESTIONS-ROLLBACK-TAXV3-A16-20260818-R1'" in rollback, 'Rollback no publica revisión nueva')
require("'rollback_of','QUESTIONS-TAXV3-A16-20260818-R1'" in rollback, 'Rollback no registra rollback_of')
require("insert into public.app_dataset_versions select * from residentado_backup.tax_v3_a16_manifest_before" in rollback.lower(), 'Rollback no parte del snapshot previo del manifest')

# Unit tests: session core and W4 manifest behavior.
unit = subprocess.run(['node', str(ROOT/'QA/test_session_core.js')], capture_output=True, text=True)
require(unit.returncode == 0, f'Falló test session-core: {unit.stdout} {unit.stderr}')
node_test = r"""
const w = require(process.argv[1]);
const cached={dataset_revision:'R3',row_count:2180,metadata:{taxonomy_version:'T3',active_topic_count:287}};
const remote={dataset_revision:'R3',row_count:2180,metadata:{taxonomy_version:'T3',active_topic_count:287}};
if(!w.manifestMatchesBundle(cached,remote,2180,287))process.exit(2);
if(w.manifestMatchesBundle(cached,{...remote,dataset_revision:'R4'},2180,287))process.exit(3);
if(w.manifestMatchesBundle(cached,{...remote,metadata:{taxonomy_version:'T3',active_topic_count:274}},2180,287))process.exit(4);
const qs=Array.from({length:2180},(_,i)=>({id:'Q'+i,rentability_topic_id:'T'+(i%287),rentability_topic_label:'Tema '+(i%287),rentability_tier:'MEDIA'}));
const snap=require(process.argv[2]).buildCoverageSnapshot(qs,[],[],new Date());
if(snap.totalQuestions!==2180 || snap.totalTopics!==287)process.exit(5);
"""
node = subprocess.run(['node','-e',node_test,str(ROOT/'w4-data.js'),str(ROOT/'w3-tools.js')],capture_output=True,text=True)
require(node.returncode == 0, f'Falló unit bundle/cobertura V3: {node.stdout} {node.stderr}')


# v1.5.1 scheduler rescue: selection changes only; memory/session core remain protected.
require('function dueReviewPool' in app and 'anti-starvation preexamen' in app, 'Falta anti-starvation de vencidas v1.5.1')
require("return dueReviewPool(now);" in app, "smartPool('due') no usa la cola anti-starvation")
require('function highCoverageGoalIso' in app and 'shiftLocalDate(exam, -9)' in app, 'Falta objetivo relativo de cobertura ALTA')
require('function valuableCoverageGoalIso' in app and 'shiftLocalDate(exam, -5)' in app, 'Falta objetivo de cobertura MEDIA rentable')
require('function highCoverageCutoffIso' in app and 'shiftLocalDate(exam, -3)' in app, 'Falta cutoff tardío de ALTA')
require('const newTarget = Math.min(120' in app, 'Nuevo tope de cobertura v1.5.1 no está aplicado')
require('Math.min(140, Math.max(90' in app, 'Bloque vencido de rescate v1.5.1 no está aplicado')
require('function reviewEligible(q, now = new Date())' in app, 'Falta elegibilidad dinámica de repaso v1.5.2')
require('return recall < retention;' in app, 'La cola de repaso no respeta targetRetention vigente')
require('const due = valid.filter(q => reviewEligible(q, now));' in app, 'El plan diario no usa la misma elegibilidad dinámica')
require(manifest.get('scope', {}).get('memory_algorithm_change') is False, 'Manifest marca cambio de memoria por error')
require(manifest.get('scope', {}).get('scheduler_change') is False, 'v1.5.9 no debe marcar cambio de scheduler')
require(manifest.get('scope', {}).get('supabase_migration_required') is False, 'v1.5.9 no debe requerir nueva migración')

if errors:
    print('QA v1.5.9 UNIVERSAL EXAM PAPER + SCRATCH: FAIL')
    for error in errors: print('- '+error)
    sys.exit(1)
print('QA v1.5.9 UNIVERSAL EXAM PAPER + SCRATCH: OK')
