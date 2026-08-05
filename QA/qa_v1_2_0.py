#!/usr/bin/env python3
from pathlib import Path
import json
import re
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

# Release/versioning: version.js remains the single source of truth.
require("version: '1.2.0'" in version, 'version.js no declara 1.2.0')
require("cacheName: 'residentado-v1-2-0'" in version, 'version.js no declara el caché 1.2.0')
require('window.RESIDENTADO_BUILD?.version' in app, 'app.js no consume version.js')
require("importScripts('./version.js')" in sw, 'service-worker.js no consume version.js')
require('<script src="./version.js"></script>' in index, 'index.html no carga version.js')
require('1.1.0-rc3' not in app + sw + version, 'Quedó una referencia runtime a rc3')

# Full v1.1.1 session/concurrency regression guardrails.
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

# Requested UI improvements.
require('coverage-rank' in app and '>N.º<' in app, 'Cobertura canónica no está numerada')
require('id="review-jump-input"' in app and 'data-review-jump' in app, 'Falta salto directo en revisión')
require('data-review-last' in app, 'Falta botón Última en revisión')
require('data-review-exit' in app and 'const exitReview' in app, 'Falta salida intermedia de revisión')
require('originalQuestionIds:currentStudy.questions.map' in app, 'La sesión parcial de práctica no conserva posición original')
require('originalQuestionIds:exam.questions.map' in app, 'La sesión parcial de examen no conserva posición original')

# Learning notes are separate from review flags and export an Anki-aware package.
require("DEMO_LEARNING_NOTES_KEY" in app, 'Falta almacenamiento demo de notas')
require("from('question_learning_notes')" in app, 'Falta persistencia de notas en tabla separada')
require('data-question-learning-note' in app and 'renderLearningNotesPage' in app, 'Falta UI de notas')
require('learningNotesProtocolText' in app and 'downloadLearningNotesMarkdown' in app and 'downloadLearningNotesCsv' in app, 'Falta exportación de notas')
require('ALREADY_COVERED' in app and 'UPDATE_EXISTING_CARD' in app and 'CREATE_NEW_CARD' in app and 'RESOLVED_WITHOUT_ANKI' in app, 'Falta clasificación de resultado Anki')
require('CONCEPT_NEIGHBOR_ONLY_WITH_VERIFIED_COLPKG' in app, 'Falta estrategia segura de posición conceptual')
require('instrucciones vigentes del Contexto Maestro' in app, 'El paquete no da precedencia a instrucciones Anki vigentes')
require('question_has_open_review_flag' in app, 'La exportación no registra si existe flag paralelo')

# Migration safety and RLS.
notes_lower = notes_sql.lower()
for token in [
    'create table if not exists public.question_learning_notes',
    'enable row level security',
    'question_learning_notes_one_open_per_question_idx',
    "where status = 'open'",
    'question_learning_notes_select_own',
    'question_learning_notes_insert_own',
    'question_learning_notes_update_own',
    'question_learning_notes_delete_own',
]:
    require(token in notes_lower, f'La migración de notas no contiene: {token}')
require('question_review_flags' not in notes_lower, 'La migración de notas modifica la tabla de flags')
require('practice_sessions' not in notes_lower and 'attempts' not in notes_lower, 'La migración de notas toca progreso/sesiones')

# Mi Estado must remain local: no Supabase call inside renderStats.
stats_start = app.find("  function renderStats(")
stats_end = app.find("\n  init();", stats_start)
require(stats_start >= 0 and stats_end > stats_start, 'No se pudo localizar renderStats')
if stats_start >= 0 and stats_end > stats_start:
    stats_body = app[stats_start:stats_end]
    require(".from('" not in stats_body and 'supa.' not in stats_body, 'Mi Estado emite consultas remotas')

unit = subprocess.run(['node', str(ROOT / 'QA/test-session-core-v1.1.1.js')], capture_output=True, text=True)
require(unit.returncode == 0, f'Falló test session-core heredado: {unit.stdout} {unit.stderr}')

if errors:
    print('QA v1.2.0: FAIL')
    for error in errors:
        print(f'- {error}')
    sys.exit(1)

print('QA v1.2.0: OK')
