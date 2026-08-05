(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResidentadoSessionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LETTERS = ['A', 'B', 'C', 'D', 'E'];

  function nowIso() {
    return new Date().toISOString();
  }

  function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function normalizeResponse(value) {
    if (typeof value === 'string') {
      return {
        selected: LETTERS.includes(value) ? value : null,
        didNotKnow: false,
        timedOut: false,
        locked: false,
        lockedByTimeout: false,
        metadataRevealed: false,
      };
    }
    const row = asObject(value);
    const selected = LETTERS.includes(row.selected) ? row.selected : null;
    return {
      selected,
      didNotKnow: Boolean(row.didNotKnow),
      timedOut: Boolean(row.timedOut),
      locked: Boolean(row.locked),
      lockedByTimeout: Boolean(row.lockedByTimeout),
      metadataRevealed: Boolean(row.metadataRevealed),
    };
  }

  function normalizeResponses(value) {
    const source = asObject(value);
    return Object.fromEntries(Object.entries(source).map(([questionId, response]) => [questionId, normalizeResponse(response)]));
  }

  function normalizeStringMap(value) {
    return Object.fromEntries(Object.entries(asObject(value)).map(([key, item]) => [key, String(item)]));
  }

  function normalizeNumberMap(value) {
    return Object.fromEntries(Object.entries(asObject(value)).map(([key, item]) => [key, Math.max(0, Math.round(Number(item) || 0))]));
  }

  function normalizeBooleanMap(value) {
    return Object.fromEntries(Object.entries(asObject(value)).map(([key, item]) => [key, Boolean(item)]));
  }

  function normalizeOptionOrders(value) {
    const output = {};
    for (const [questionId, letters] of Object.entries(asObject(value))) {
      if (!Array.isArray(letters)) continue;
      const unique = [...new Set(letters.filter(letter => LETTERS.includes(letter)))];
      if (unique.length) output[questionId] = unique;
    }
    return output;
  }

  function normalizeScratch(value) {
    const output = {};
    for (const [questionId, raw] of Object.entries(asObject(value))) {
      const row = asObject(raw);
      const normalized = {};
      for (const [letter, state] of Object.entries(row)) {
        if (LETTERS.includes(letter) && state === 'tentative') normalized[letter] = 'tentative';
      }
      if (Object.keys(normalized).length) output[questionId] = normalized;
    }
    return output;
  }

  function createEmptyState(overrides = {}) {
    const stamp = nowIso();
    return normalizeState({
      schemaVersion: 1,
      currentIndex: 0,
      responses: {},
      scratch: {},
      marked: {},
      optionOrders: {},
      durations: {},
      answerTimes: {},
      timeSpent: {},
      lockedQuestionIds: [],
      attemptIdsByQuestion: {},
      clientAttemptIdsByQuestion: {},
      remainingSeconds: null,
      totalRemaining: null,
      breakTaken: false,
      activeTimeMs: 0,
      pausedTimeMs: 0,
      lastVisibleAt: null,
      lastSavedAt: stamp,
      deviceInstanceId: null,
      ...overrides,
    });
  }

  function normalizeState(value = {}) {
    const state = asObject(value);
    const responses = normalizeResponses(state.responses);
    const lockedFromResponses = Object.entries(responses)
      .filter(([, response]) => response.locked)
      .map(([questionId]) => questionId);
    const lockedQuestionIds = [...new Set([
      ...(Array.isArray(state.lockedQuestionIds) ? state.lockedQuestionIds : []),
      ...lockedFromResponses,
    ].filter(Boolean))];

    return {
      schemaVersion: 1,
      currentIndex: Math.max(0, Math.round(Number(state.currentIndex) || 0)),
      responses,
      scratch: normalizeScratch(state.scratch),
      marked: normalizeBooleanMap(state.marked),
      optionOrders: normalizeOptionOrders(state.optionOrders),
      durations: normalizeNumberMap(state.durations),
      answerTimes: normalizeNumberMap(state.answerTimes),
      timeSpent: normalizeNumberMap(state.timeSpent),
      lockedQuestionIds,
      attemptIdsByQuestion: normalizeStringMap(state.attemptIdsByQuestion),
      clientAttemptIdsByQuestion: normalizeStringMap(state.clientAttemptIdsByQuestion),
      remainingSeconds: state.remainingSeconds == null ? null : Math.max(0, Math.round(Number(state.remainingSeconds) || 0)),
      totalRemaining: state.totalRemaining == null ? null : Math.max(0, Math.round(Number(state.totalRemaining) || 0)),
      breakTaken: Boolean(state.breakTaken),
      activeTimeMs: Math.max(0, Math.round(Number(state.activeTimeMs) || 0)),
      pausedTimeMs: Math.max(0, Math.round(Number(state.pausedTimeMs) || 0)),
      lastVisibleAt: state.lastVisibleAt || null,
      lastSavedAt: state.lastSavedAt || nowIso(),
      deviceInstanceId: state.deviceInstanceId || null,
    };
  }

  function responseSelected(state, questionId) {
    return normalizeResponse(asObject(state?.responses)[questionId]).selected;
  }

  function responseAnswered(response) {
    const normalized = normalizeResponse(response);
    return normalized.selected != null || normalized.didNotKnow || normalized.timedOut;
  }

  function answeredQuestionIds(questionIds, state) {
    const responses = asObject(state?.responses);
    return (questionIds || []).filter(questionId => responseAnswered(responses[questionId]));
  }

  function setResponse(state, questionId, patch) {
    const normalized = normalizeState(state);
    normalized.responses[questionId] = normalizeResponse({
      ...normalized.responses[questionId],
      ...asObject(patch),
    });
    if (normalized.responses[questionId].locked && !normalized.lockedQuestionIds.includes(questionId)) {
      normalized.lockedQuestionIds.push(questionId);
    }
    normalized.lastSavedAt = nowIso();
    return normalized;
  }

  function studyToState(study, deviceInstanceId = null) {
    const base = createEmptyState({
      currentIndex: study?.index || 0,
      responses: study?.responses || {},
      scratch: study?.scratch || {},
      marked: study?.marked || {},
      optionOrders: study?.optionOrders || {},
      durations: study?.durations || {},
      answerTimes: study?.answerTimes || {},
      timeSpent: study?.timeSpent || {},
      attemptIdsByQuestion: study?.attemptIdsByQuestion || {},
      clientAttemptIdsByQuestion: study?.clientAttemptIdsByQuestion || {},
      totalRemaining: study?.totalRemaining ?? null,
      remainingSeconds: null,
      activeTimeMs: study?.activeTimeMs || 0,
      pausedTimeMs: study?.pausedTimeMs || 0,
      lastVisibleAt: study?.lastVisibleAt || null,
      lastSavedAt: nowIso(),
      deviceInstanceId: study?.deviceInstanceId || deviceInstanceId || null,
    });
    return normalizeState(base);
  }

  function stateToStudy(row, questions, createOptionOrders) {
    const config = asObject(row?.config);
    const state = normalizeState(row?.state || {});
    const selected = questions || [];
    return {
      row,
      config,
      questions: selected,
      index: Math.min(Math.max(0, state.currentIndex), Math.max(0, selected.length - 1)),
      responses: state.responses,
      scratch: state.scratch,
      marked: state.marked,
      durations: state.durations,
      answerTimes: state.answerTimes,
      timeSpent: state.timeSpent,
      optionOrders: Object.keys(state.optionOrders).length
        ? state.optionOrders
        : createOptionOrders(selected, config.shuffleOptions !== false),
      totalRemaining: state.totalRemaining ?? (config.timeMode === 'total' ? config.totalSeconds : null),
      attemptIdsByQuestion: state.attemptIdsByQuestion,
      clientAttemptIdsByQuestion: state.clientAttemptIdsByQuestion,
      activeTimeMs: state.activeTimeMs,
      pausedTimeMs: state.pausedTimeMs,
      lastVisibleAt: state.lastVisibleAt,
      deviceInstanceId: state.deviceInstanceId,
    };
  }

  // FIX-SESSION-004: compare only meaningful progress; volatile timestamps must not create false conflicts.
  function meaningfulSessionState(value = {}) {
    const state = normalizeState(value);
    return {
      schemaVersion: state.schemaVersion,
      currentIndex: state.currentIndex,
      responses: state.responses,
      scratch: state.scratch,
      marked: state.marked,
      optionOrders: state.optionOrders,
      durations: state.durations,
      answerTimes: state.answerTimes,
      timeSpent: state.timeSpent,
      lockedQuestionIds: state.lockedQuestionIds,
      attemptIdsByQuestion: state.attemptIdsByQuestion,
      clientAttemptIdsByQuestion: state.clientAttemptIdsByQuestion,
      remainingSeconds: state.remainingSeconds,
      totalRemaining: state.totalRemaining,
      breakTaken: state.breakTaken,
    };
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function sessionStateFingerprint(value = {}) {
    return stableStringify(meaningfulSessionState(value));
  }

  function normalizeSessionRow(row = {}) {
    const questionIds = Array.isArray(row.question_ids) ? row.question_ids.filter(Boolean) : [];
    const state = normalizeState(row.state || {});
    const answeredCount = answeredQuestionIds(questionIds, state).length;
    return {
      ...row,
      mode: row.mode === 'exam' ? 'exam' : 'study',
      question_ids: questionIds,
      state,
      status: ['active', 'completed', 'abandoned'].includes(row.status) ? row.status : 'active',
      planned_count: Math.max(questionIds.length, Math.round(Number(row.planned_count) || 0)),
      answered_count: Math.max(answeredCount, Math.round(Number(row.answered_count) || 0)),
      is_partial: Boolean(row.is_partial),
      state_revision: Math.max(0, Math.round(Number(row.state_revision) || 0)),
      state_schema_version: Math.max(1, Math.round(Number(row.state_schema_version) || 1)),
      active_time_ms: Math.max(0, Math.round(Number(row.active_time_ms ?? state.activeTimeMs) || 0)),
      paused_time_ms: Math.max(0, Math.round(Number(row.paused_time_ms ?? state.pausedTimeMs) || 0)),
    };
  }

  function mergeSessionRows(remoteRows = [], localRows = []) {
    const byId = new Map();
    for (const row of remoteRows.map(normalizeSessionRow)) byId.set(row.id, { ...row, syncStatus: 'synced' });
    for (const localRaw of localRows.map(normalizeSessionRow)) {
      const current = byId.get(localRaw.id);
      if (!current) {
        byId.set(localRaw.id, localRaw);
        continue;
      }

      const localPending = ['pending', 'conflict', 'offline', 'offline_create', 'recovery_local'].includes(localRaw.syncStatus);
      const localRevision = Number(localRaw.state_revision || 0);
      const remoteRevision = Number(current.state_revision || 0);
      const localUpdated = new Date(localRaw.localUpdatedAt || localRaw.updated_at || 0).getTime();
      const remoteUpdated = new Date(current.updated_at || 0).getTime();

      // FIX-SESSION-004: a stale local shadow must never hide a newer server revision.
      if (localRevision > remoteRevision || (localRevision === remoteRevision && localPending && localUpdated > remoteUpdated)) {
        byId.set(localRaw.id, localRaw);
      }
    }
    return [...byId.values()].sort((a, b) => new Date(b.updated_at || b.localUpdatedAt || 0) - new Date(a.updated_at || a.localUpdatedAt || 0));
  }

  function buildSessionSummary(row, sessionAttempts = []) {
    const normalized = normalizeSessionRow(row);
    const unique = new Map();
    for (const attempt of sessionAttempts || []) {
      const key = attempt.client_attempt_id || `${attempt.question_id}:${attempt.id || ''}`;
      if (!unique.has(key)) unique.set(key, attempt);
    }
    const list = [...unique.values()];
    const correct = list.filter(attempt => Boolean(attempt.is_correct)).length;
    const activeTimeMs = normalized.active_time_ms || normalized.state.activeTimeMs || list.reduce((sum, attempt) => sum + Math.max(0, Number(attempt.response_time_ms) || 0), 0);
    return {
      sessionId: normalized.id,
      title: normalized.title || (normalized.mode === 'exam' ? 'Simulacro' : 'Práctica'),
      mode: normalized.mode,
      partial: normalized.is_partial || normalized.closed_reason === 'completed_partial',
      planned: normalized.planned_count || normalized.question_ids.length,
      answered: list.length || normalized.answered_count,
      correct,
      accuracy: list.length ? Math.round((correct / list.length) * 100) : null,
      activeTimeMs,
      completedAt: normalized.completed_at || normalized.updated_at || normalized.created_at || null,
    };
  }

  return {
    LETTERS,
    normalizeResponse,
    normalizeResponses,
    normalizeState,
    createEmptyState,
    responseSelected,
    responseAnswered,
    answeredQuestionIds,
    setResponse,
    studyToState,
    stateToStudy,
    normalizeSessionRow,
    meaningfulSessionState,
    sessionStateFingerprint,
    mergeSessionRows,
    buildSessionSummary,
  };
});
