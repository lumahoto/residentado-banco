'use strict';
const assert = require('assert');
const core = require('../session-core.js');

function state(selected, currentIndex = 0) {
  return core.normalizeState({
    currentIndex,
    responses: selected ? { Q1: { selected } } : {},
  });
}

// FIX-SESSION-004: una revisión remota más nueva no puede quedar oculta por una sombra local stale/conflict.
{
  const remote = [{ id:'s1', mode:'study', status:'active', question_ids:['Q1'], state:state('A'), state_revision:10, updated_at:'2026-08-05T18:00:00Z' }];
  const local = [{ id:'s1', mode:'study', status:'active', question_ids:['Q1'], state:state('B'), state_revision:9, syncStatus:'conflict', localUpdatedAt:'2026-08-05T18:05:00Z' }];
  const merged = core.mergeSessionRows(remote, local);
  assert.equal(merged[0].state_revision, 10);
  assert.equal(merged[0].state.responses.Q1.selected, 'A');
  assert.equal(merged[0].syncStatus, 'synced');
}

// Un cambio local pendiente con la misma revisión y marca temporal posterior debe conservarse para sincronización.
{
  const remote = [{ id:'s2', mode:'study', status:'active', question_ids:['Q1'], state:state('A'), state_revision:5, updated_at:'2026-08-05T18:00:00Z' }];
  const local = [{ id:'s2', mode:'study', status:'active', question_ids:['Q1'], state:state('B'), state_revision:5, syncStatus:'pending', localUpdatedAt:'2026-08-05T18:05:00Z' }];
  const merged = core.mergeSessionRows(remote, local);
  assert.equal(merged[0].state.responses.Q1.selected, 'B');
  assert.equal(merged[0].syncStatus, 'pending');
}

// El fingerprint ignora timestamps volátiles, pero detecta progreso clínicamente significativo.
{
  const a = core.normalizeState({ currentIndex:1, responses:{ Q1:{ selected:'C' } }, lastSavedAt:'2026-08-05T18:00:00Z', lastVisibleAt:'2026-08-05T18:00:00Z', activeTimeMs:1000 });
  const b = core.normalizeState({ currentIndex:1, responses:{ Q1:{ selected:'C' } }, lastSavedAt:'2026-08-05T18:05:00Z', lastVisibleAt:'2026-08-05T18:05:00Z', activeTimeMs:9000 });
  const c = core.normalizeState({ currentIndex:2, responses:{ Q1:{ selected:'C' } } });
  assert.equal(core.sessionStateFingerprint(a), core.sessionStateFingerprint(b));
  assert.notEqual(core.sessionStateFingerprint(a), core.sessionStateFingerprint(c));
}

console.log('QA session-core v1.1.1: OK');
