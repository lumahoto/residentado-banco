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

for name in ['app.js','session-core.js','session-storage.js','service-worker.js','version.js','question-parser.js','w3-tools.js','w4-data.js']:
    result = subprocess.run(['node','--check',str(ROOT/name)], capture_output=True, text=True)
    require(result.returncode == 0, f'Sintaxis JS inválida en {name}: {result.stderr.strip()}')

app = (ROOT/'app.js').read_text(encoding='utf-8')
core = (ROOT/'session-core.js').read_text(encoding='utf-8')
sw = (ROOT/'service-worker.js').read_text(encoding='utf-8')
version = (ROOT/'version.js').read_text(encoding='utf-8')
migration = (ROOT/'MIGRATIONS/20260805_FIX_SESSION_CONFLICT_PT409.sql').read_text(encoding='utf-8')
index = (ROOT/'index.html').read_text(encoding='utf-8')

require("version: '1.1.1'" in version, 'version.js no declara 1.1.1')
require("cacheName: 'residentado-v1-1-1'" in version, 'version.js no declara el caché 1.1.1')
require('window.RESIDENTADO_BUILD?.version' in app, 'app.js no usa la fuente canónica de versión')
require("importScripts('./version.js')" in sw, 'service-worker.js no usa version.js')
require('<script src="./version.js"></script>' in index, 'index.html no carga version.js')
require("raise sqlstate 'pt409'" in migration.lower(), 'La migración no usa PT409')
require("errcode = '40001'" not in migration.lower(), 'La migración conserva errcode 40001')
require("queueOperation('UPSERT_SESSION'" in app, 'Falta la cola offline de sesiones')
require("from('practice_sessions').upsert" not in app, 'CREATE_SESSION todavia usa upsert destructivo')
require('persistir la fila elegida por reconciliacion' in app, 'La carga vuelve a sobrescribir la reconciliacion con remoto bruto')
require('if (isSessionConflictError(error)) return handleSessionRevisionConflict' in app, 'Los conflictos no se desvían a recuperación')
require("persistRecoverySession(conflicted, 'revision_conflict')" in app, 'No se conserva una copia de recuperación')
require('SESSION_LEASE_HEARTBEAT_MS' in app and 'BroadcastChannel' in app, 'Falta protección entre pestañas')
require(".eq('state_revision', expectedRevision)" in app, 'El cierre de sesión no valida la revisión esperada')
require('localRevision > remoteRevision' in core, 'La reconciliación no prioriza revisiones')
require('localRevision === remoteRevision && localPending' in core, 'La reconciliación no preserva cambios locales de igual revisión')
require('network-first' in sw.lower(), 'El service worker no documenta navegación network-first')

unit = subprocess.run(['node', str(ROOT/'QA/test-session-core-v1.1.1.js')], capture_output=True, text=True)
require(unit.returncode == 0, f'Falló test session-core: {unit.stdout} {unit.stderr}')

if errors:
    print('QA v1.1.1: FAIL')
    for error in errors:
        print(f'- {error}')
    sys.exit(1)

print('QA v1.1.1: OK')
