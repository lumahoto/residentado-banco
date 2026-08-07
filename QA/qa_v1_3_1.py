#!/usr/bin/env python3
from pathlib import Path
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

def js_check(name):
    result = subprocess.run(['node', '--check', str(ROOT / name)], capture_output=True, text=True)
    require(result.returncode == 0, f'Sintaxis JS inválida en {name}: {result.stderr.strip()}')

for name in ['app.js','session-core.js','session-storage.js','service-worker.js','version.js','question-parser.js','w3-tools.js','w4-data.js']:
    js_check(name)

app = (ROOT / 'app.js').read_text(encoding='utf-8')
core = (ROOT / 'session-core.js').read_text(encoding='utf-8')
sw = (ROOT / 'service-worker.js').read_text(encoding='utf-8')
version = (ROOT / 'version.js').read_text(encoding='utf-8')
index = (ROOT / 'index.html').read_text(encoding='utf-8')
pt409 = (ROOT / 'MIGRATIONS/20260805_FIX_SESSION_CONFLICT_PT409.sql').read_text(encoding='utf-8')
notes_sql = (ROOT / 'MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql').read_text(encoding='utf-8')
tts_sql = (ROOT / 'MIGRATIONS/20260805_ADD_TTS_TOPIC_CATALOG_V061.sql').read_text(encoding='utf-8')
tts_c1 = (ROOT / 'MIGRATIONS/20260805_FIX_TTS_TOPIC_CATALOG_READONLY_C1.sql').read_text(encoding='utf-8')

# Release/versioning.
require("version: '1.3.1'" in version, 'version.js no declara 1.3.0')
require("cacheName: 'residentado-v1-3-1'" in version, 'version.js no declara el caché 1.3.0')
require('window.RESIDENTADO_BUILD?.version' in app, 'app.js no consume version.js')
require("importScripts('./version.js')" in sw, 'service-worker.js no consume version.js')
require('<script src="./version.js"></script>' in index, 'index.html no carga version.js')
require('1.1.0-rc3' not in app + sw + version, 'Quedó una referencia runtime a rc3')

# Session/concurrency guardrails inherited intact.
require("raise sqlstate 'pt409'" in pt409.lower(), 'La migración de conflicto no usa PT409')
require("errcode = '40001'" not in pt409.lower(), 'La migración conserva SQLSTATE 40001')
require("queueOperation('UPSERT_SESSION'" in app, 'Falta la cola offline de actualización de sesiones')
require("from('practice_sessions').upsert" not in app, 'CREATE_SESSION volvió a usar upsert destructivo')
require('persistir la fila elegida por reconciliacion' in app, 'La carga vuelve a ocultar la reconciliación con remoto bruto')
require('if (isSessionConflictError(error)) return handleSessionRevisionConflict' in app, 'Los conflictos no se desvían a recuperación')
require("persistRecoverySession(conflicted, 'revision_conflict')" in app, 'No se conserva una copia de recuperación')
require('SESSION_LEASE_HEARTBEAT_MS' in app and 'BroadcastChannel' in app, 'Falta protección entre pestañas')
require(".eq('state_revision', expectedRevision)" in app, 'El cierre no valida state_revision')
require('localRevision > remoteRevision' in core, 'La reconciliación no prioriza revisiones')
require('localRevision === remoteRevision && localPending' in core, 'La reconciliación no preserva cambios locales pendientes')
require('network-first' in sw.lower(), 'La navegación no conserva network-first')

# v1.2.0 features remain present.
require('coverage-rank' in app and '>N.º<' in app, 'Cobertura canónica perdió numeración')
require('id="review-jump-input"' in app and 'data-review-jump' in app, 'Falta salto directo en revisión')
require('data-review-last' in app, 'Falta botón Última en revisión')
require('data-review-exit' in app and 'const exitReview' in app, 'Falta salida intermedia de revisión')
require('originalQuestionIds:currentStudy.questions.map' in app, 'La práctica parcial no conserva posición original')
require('originalQuestionIds:exam.questions.map' in app, 'El examen parcial no conserva posición original')
require("from('question_learning_notes')" in app and 'renderLearningNotesPage' in app, 'Se perdió el flujo de notas personales')


# v1.3.1: exportación autoritativa autosuficiente para auditoría y parche.
require("async function downloadReviewFlagsCsv" in app, 'La exportación de flags no es asíncrona')
require("fetchAuthoritativeRowsByIds('question_review_flags', 'id', flagIds)" in app, 'La exportación no relee flags completos desde Supabase')
require("fetchAuthoritativeRowsByIds('questions', 'id', questionIds)" in app, 'La exportación no relee preguntas completas desde Supabase')
require("select('*').in(idColumn, chunk)" in app, 'La exportación no usa select dinámico de todas las columnas')
require("export__source:'SUPABASE_AUTHORITATIVE'" in app, 'El CSV no declara fuente autoritativa')
require("residentado-review-patch-csv-v1" in app, 'Falta versión de esquema del CSV')
require("flagColumns.map(column => `flag__${column}`)" in app, 'Faltan columnas completas prefijadas de flags')
require("questionColumns.map(column => `question__${column}`)" in app, 'Faltan columnas completas prefijadas de preguntas')
require('missingFlagIds.length || missingQuestionIds.length' in app, 'Falta guardrail de IDs incompletos')
require('No se generó un archivo basado solo en caché local' in app, 'Falta bloqueo de exportación local no autoritativa')
require('Exportar CSV completo para auditoría y parche' in app, 'Falta el único botón de CSV completo')
require('id="copy-review-flags"' not in app, 'La interfaz todavía muestra el botón de copia simple')
require("replace(/\\r\\n/g, '\\n')" in app, 'El CSV no conserva campos multilínea')

# Archivos sensibles y corpus auxiliares preservados byte por byte desde v1.3.0.
import hashlib
protected = {
    'session-core.js':'ab81e2ff36c24e871dce40567a1812d7488b04d5587c800fb889fb2bd4affaaf',
    'session-storage.js':'eed7339ad479d21cefb6429210c350f8c2fcd551d78449359798c15a405e68da',
    'config.js':'6659f3ed8fc2162ba9388e7159f9376a1b1b60922acb6847edce954ffdeab554',
    'question-parser.js':'d224c6446652018398c97ea6b4d6718bfa81485a9aa7def3699fac099d3e1a65',
    'w3-tools.js':'40de509733278abdfb043522d8dc28e20c1617f97f1a206d5a6fd8144a5fb1e5',
    'w4-data.js':'a51c8fe813b301ee18306598bdd3a43cd46e3c41cccc4eb3b4e50d485c08c3a6',
    'pilot-data.js':'2f838ea00a41ce471f4be432cac80e0c53d8f70e9cd019b9bf251f69878f4c39',
    'index.html':'6b2dcab398729294da39c768fae178802236d0b3e76ee26c1b4fe4e7c340ed0e',
    'styles.css':'e33ba7d952abca56bc0bf27e3aa208be31ef63a715563b4da76032413b1fc3f8',
    'tts_catalog.json':'55fde0266e3a3e9cc491e74e07f333438b5e015dcad23c74c22029c7d2beda05',
}
for name, expected in protected.items():
    actual = hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
    require(actual == expected, f'{name} cambió respecto de la base v1.3.0')

# TTS integration: one catalog load, shared local map, no per-row calls.
require("const TTS_CATALOG_TABLE = 'tts_topic_catalog'" in app, 'No se declara la tabla TTS')
require('async function loadCloudTtsCatalog()' in app, 'Falta carga del catálogo TTS desde Supabase')
require("supa.from(TTS_CATALOG_TABLE)" in app, 'La carga TTS no consulta la tabla autoritativa')
require('await loadCloudTtsCatalog();' in app, 'El catálogo TTS no se sincroniza al cargar datos')
require("applyTtsCatalog(await response.json(), 'static-fallback')" in app, 'Falta respaldo local TTS')
require('enrichCoverageTopics' in app and 'data-topic-tts-key' in app, 'Cobertura canónica no muestra TTS')
require('<th>TTS</th>' in app, 'Falta columna TTS en Cobertura canónica')
require('W4Data.catalogCompactLabel' in app, 'Debilidades no muestra código/estado TTS actualizado')
require('availableTtsCount()' in app and 'TTS disponibles' in app, 'Falta conteo real de disponibilidad TTS')
require(".insert(" not in app[app.find('async function loadCloudTtsCatalog()'):app.find('async function fetchDatasetManifest()')], 'La carga TTS intenta insertar')
require(".update(" not in app[app.find('async function loadCloudTtsCatalog()'):app.find('async function fetchDatasetManifest()')], 'La carga TTS intenta actualizar')
require(".delete(" not in app[app.find('async function loadCloudTtsCatalog()'):app.find('async function fetchDatasetManifest()')], 'La carga TTS intenta eliminar')

# Static fallback must represent the full taxonomy while marking exactly 89 available.
catalog = json.loads((ROOT / 'tts_catalog.json').read_text(encoding='utf-8'))
topics = catalog.get('topics', [])
available = [row for row in topics if row.get('status') in {'COMPLETE','PARTIAL'}]
require(catalog.get('catalogVersion') == 'V061', 'El respaldo TTS no declara V061')
require(len(topics) == 274, f'El respaldo TTS no contiene 274 temas: {len(topics)}')
require(len(available) == 89, f'El respaldo TTS no contiene 89 disponibles: {len(available)}')
require({row.get('primaryCode') for row in available} == {f'TTS_{i:03d}' for i in range(1,90)}, 'El respaldo TTS no cubre exactamente TTS_001–089')

# W4 normalizes Supabase snake_case rows and emits a compact label.
node_test = r"""
const w = require(process.argv[1]);
const c = w.normalizeCatalog({topics:[{rentability_topic_id:'R1',topic_label:'Tema',status:'COMPLETE',primary_code:'TTS_089',tts_version:'V061',catalog_version:'V061',part_codes:['TTS_089A','TTS_089B'],estimated_minutes:12.5}]});
if (c.catalogVersion !== 'V061') process.exit(2);
if (c.topics[0].topicId !== 'R1' || c.topics[0].parts.length !== 2) process.exit(3);
if (!w.catalogCompactLabel(c.topics[0]).startsWith('TTS_089 · Completa')) process.exit(4);
"""
node = subprocess.run(['node','-e',node_test,str(ROOT/'w4-data.js')],capture_output=True,text=True)
require(node.returncode == 0, f'Falló normalización TTS Supabase: {node.stdout} {node.stderr}')

# Database catalog is additive and read-only for authenticated after C1.
tts_lower = tts_sql.lower()
c1_lower = tts_c1.lower()
tts_runtime = '\n'.join(line.split('--', 1)[0] for line in tts_lower.splitlines())
require('create table if not exists public.tts_topic_catalog' in tts_lower, 'Falta creación idempotente de tts_topic_catalog')
require('enable row level security' in tts_lower, 'El catálogo TTS no activa RLS')
require('delete ' not in tts_runtime and 'truncate ' not in tts_runtime and 'drop table' not in tts_runtime, 'La migración de datos TTS contiene operación destructiva')
require('revoke all privileges on table public.tts_topic_catalog from authenticated' in c1_lower, 'C1 no retira privilegios heredados de authenticated')
require('grant select on table public.tts_topic_catalog to authenticated' in c1_lower, 'C1 no conserva SELECT autenticado')

# Existing notes migration remains isolated.
notes_lower = notes_sql.lower()
require('create table if not exists public.question_learning_notes' in notes_lower, 'Falta migración de notas v1.2.0')
require('question_review_flags' not in notes_lower, 'La migración de notas modifica flags')
require('practice_sessions' not in notes_lower and 'attempts' not in notes_lower, 'La migración de notas toca progreso/sesiones')

# Mi Estado remains local: rendering must not query Supabase.
stats_start = app.find('  function renderStats(')
stats_end = app.find('\n  init();', stats_start)
require(stats_start >= 0 and stats_end > stats_start, 'No se pudo localizar renderStats')
if stats_start >= 0 and stats_end > stats_start:
    stats_body = app[stats_start:stats_end]
    require(".from('" not in stats_body and 'supa.' not in stats_body, 'Mi Estado emite consultas remotas por vista/fila')

unit = subprocess.run(['node', str(ROOT / 'QA/test-session-core-v1.1.1.js')], capture_output=True, text=True)
require(unit.returncode == 0, f'Falló test session-core heredado: {unit.stdout} {unit.stderr}')

if errors:
    print('QA v1.3.1: FAIL')
    for error in errors:
        print(f'- {error}')
    sys.exit(1)

print('QA v1.3.1: OK')
