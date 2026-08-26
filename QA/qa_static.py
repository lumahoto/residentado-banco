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

# Guardrail documental: v1.5.4 no crea archivos versionados auxiliares nuevos.
for forbidden in [
    ROOT/'QA'/'QA_RELEASE_V1_5_4.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_4.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_4.md',
    ROOT/'QA'/'QA_RELEASE_V1_5_3.md',
    ROOT/'docs'/'INSTRUCCIONES_APLICACION_V1_5_3.md',
    ROOT/'docs'/'DECISION_LOG_V1_5_3.md',
]:
    require(not forbidden.exists(), f'Proliferación documental no permitida: {forbidden.relative_to(ROOT)}')

# Release/version consistency.
require("version: '1.5.4'" in version, 'version.js no declara 1.5.4')
require("cacheName: 'residentado-v1-5-4'" in version, 'version.js no declara cache v1.5.4')
require(manifest.get('version') == '1.5.4', 'RELEASE_MANIFEST no coincide con v1.5.4')
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

# v1.5.4: preserva scheduler/guardrails v1.5.2 y cambia solo práctica personalizada, QRV2 y semántica flag/nota.
require('function renderReviewSummary()' in app and 'REVIEW_FILTERS' in app, 'Falta Centro de revisión único')
for token in ["['incorrect','Incorrectas']", "['dont_know','No sé']", "['doubt','? Duda']", "['notes','Notas']", "['marked','Marcadas']", "['review_flag','Revisar']", "['audit','Auditoría']"]:
    require(token in app, f'Falta filtro del Centro de revisión: {token}')
require('canonical_entity || q.subtopic' in app and 'review-question-row' in app, 'La hoja informativa no expone Tema/Entidad')
require('data-question-doubt-top' in app and 'data-question-doubt-label' in app, 'La duda no tiene controles superior/inferior sincronizados')
require('data-uncertain-toggle' not in app, 'Se reintrodujo el ? por alternativa')
require("REEXPOSE_EXISTING_CARD" in app and "ACTIVE_LEARNING_NOTE_OUTCOMES" in app, 'Falta reexposición Anki obligatoria')
require('ensureLearningNoteForContentReview' not in app, 'v1.5.4 reintrodujo acoplamiento automático flag CONTENT → Nota')
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

# v1.5.4 práctica personalizada: selección y presentación son contratos separados.
for token in ['id="selection-order"', 'id="presentation-order"', "function orderSelectionPool", "function orderSessionQuestions", "function compareCanonicalRentability"]:
    require(token in app, f'Falta contrato de práctica personalizada v1.5.4: {token}')
require("selectionOrder === 'RENTABILITY'" in app and "presentationOrder === 'QUEUE'" in app, 'Faltan ramas RENTABILITY/QUEUE')
require("rentabilityTierRank(b) - rentabilityTierRank(a)" in app and "bScore > aScore ? 1 : -1" in app and "localeSort(a?.id, b?.id)" in app, 'Ranking canónico no tiene tier + score + desempate estable')
require('questionPriority(' not in app[app.find('function orderSelectionPool'):app.find('function filterPool')], 'Selección por rentabilidad contaminada con prioridad personal')
require("if (mode === 'exam') {\n        const selected = (config.randomize ? shuffle(pool) : pool).slice(0, config.count);" in app, 'Simulacro no conserva randomize legacy v1.5.2')
require(manifest.get('scope', {}).get('simulators_changed') is False, 'Manifest marca simuladores cambiados por error')
require(manifest.get('scope', {}).get('practice_ui_change') is True, 'Manifest no marca cambio de práctica personalizada')

# v1.5.4 QRV2: dos capas, referente explícito, trazabilidad editorial oculta y fuentes colapsadas.
for token in ['function qrv2Profile', 'function qrv2MigrationStatus', 'Núcleo rápido', 'Detalle útil', 'Fuentes y trazabilidad', 'q.audit_source_urls']:
    require(token in app, f'Falta componente QRV2 v1.5.4: {token}')
reference_renderer = app[app.find('function referenceQuickHtml'):app.find('function auditEditorialHtml')]
require('q.reference_notes' not in reference_renderer, 'v1.5.4 volvió a renderizar reference_notes en la experiencia de estudio')
require('Notas generales' not in reference_renderer, 'v1.5.4 volvió a mostrar Notas generales editoriales')
require('Fuentes y trazabilidad' in reference_renderer and '<details class="qrv2-collapsible">' in reference_renderer, 'Fuentes QRV2 no permanecen colapsadas')
for feedback_name, feedback_end in [('renderReviewFeedbackFallback', 'renderFeedback'), ('renderFeedback', 'function renderQuestion')]:
    start = app.find(f'function {feedback_name}')
    end = app.find(feedback_end, start + 1)
    segment = app[start:end if end != -1 else None]
    require(segment.find('${quickReference}') != -1 and segment.find('learning-note-action') != -1 and segment.find('${quickReference}') < segment.find('learning-note-action'), f'{feedback_name}: Referencia rápida debe estar antes de Añadir nota')
require('const referent = comparisonTitle || entity || topic' in app, 'QRV2 no prioriza comparison_title/Entidad como referente explícito')
require('💊 Fármacos y antibióticos' not in app, 'QRV2 conserva encabezado farmacológico genérico que oculta el referente')
require('rel="noopener noreferrer"' in app, 'Fuentes QRV2 no protegen enlaces externos')
require(manifest.get('scope', {}).get('quick_reference_change') is True, 'Manifest no marca cambio QRV2')
require(manifest.get('scope', {}).get('review_flag_semantics_change') is True, 'Manifest no marca desacoplamiento flag/nota')

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
require(manifest.get('scope', {}).get('scheduler_change') is False, 'v1.5.4 no debe marcar cambio de scheduler')
require(manifest.get('scope', {}).get('supabase_migration_required') is False, 'v1.5.4 no debe requerir nueva migración')

if errors:
    print('QA v1.5.4 CUSTOM QUEUE + QRV2: FAIL')
    for error in errors: print('- '+error)
    sys.exit(1)
print('QA v1.5.4 CUSTOM QUEUE + QRV2: OK')
