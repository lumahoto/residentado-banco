(() => {
  const app = document.getElementById('app');
  const cfg = window.APP_CONFIG || {};
  const APP_VERSION = window.RESIDENTADO_BUILD?.version || '1.5.0';
  const LEARNING_NOTES_MIGRATION = 'MIGRATIONS/20260805_ADD_QUESTION_LEARNING_NOTES_V1_2_0.sql';
  const REVIEW_LEARNING_SCOPE_MIGRATION = 'MIGRATIONS/20260822_REVIEW_CENTER_ANKI_SCOPE_V1_5_0.sql';
  const TTS_CATALOG_TABLE = 'tts_topic_catalog';
  const cloudConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  const DEMO_KEY = 'residentado_piloto_attempts_v3';
  const DEMO_SESSIONS_KEY = 'residentado_piloto_sessions_v2';
  const DEMO_MEMORY_KEY = 'residentado_memory_state_v1';
  const DEMO_PROFILE_KEY = 'residentado_learning_profile_v1';
  const DEMO_REVIEW_FLAGS_KEY = 'residentado_question_review_flags_v1';
  const DEMO_LEARNING_NOTES_KEY = 'residentado_question_learning_notes_v1';

  let supa = null;
  let user = null;
  let questions = [];
  let attempts = [];
  let activeSessions = [];
  let completedSessions = [];
  let profile = null;
  let memoryStates = [];
  let memoryByQuestion = new Map();
  let corpusRentabilityByQuestion = new Map();
  let corpusRentabilityMeta = { highCount: 0, groupCount: 0, yearsCount: 0, threshold: null };

  let timerId = null;
  let questionStartedAt = 0;
  let currentStudy = null;
  let currentExam = null;
  let examQuestionEnteredAt = 0;
  let reviewContext = null;
  let specificQueryDraft = null;
  let reviewFlags = [];
  let reviewFlagHistory = [];
  let reviewFlagByQuestion = new Map();
  let learningNotes = [];
  let learningNoteHistory = [];
  let learningNoteByQuestion = new Map();
  let learningNotesAvailable = true;
  let learningNotesLoadError = '';
  let reviewLearningScopeAvailable = !cloudConfigured;
  let reviewLearningScopeLoadError = '';
  let dayBoundarySweepInProgress = false;

  const SessionCore = window.ResidentadoSessionCore || {};
  const QuestionParser = window.ResidentadoQuestionParser || {};
  const W3Tools = window.ResidentadoW3Tools || {};
  const W4Data = window.ResidentadoW4Data || {};
  let ttsCatalog = { catalogVersion:'unloaded', topics:[] };
  let ttsCatalogByTopic = new Map();
  let ttsCatalogSource = 'unloaded';
  let ttsCatalogLoadError = '';
  let datasetManifest = null;
  let rentabilityTopics = [];
  let rentabilityTopicsById = new Map();
  let topicAliases = [];
  let topicAliasBySourceId = new Map();
  let topicAliasesBySourceLabel = new Map();
  let historyPage = 0;
  let historyHasMore = true;
  const HISTORY_PAGE_SIZE = 50;
  let sessionStore = null;
  let sessionActivityStartedAt = 0;
  let sessionHiddenStartedAt = 0;
  let sessionSaveTimer = null;
  let sessionSaveChain = Promise.resolve();
  let sessionActionInProgress = false;
  let sessionNavigationGuardActive = false;
  let deviceInstanceId = null;
  // FIX-SESSION-005: lease de edicion exclusivo por pestana.
  const tabInstanceId = makeUuid();
  const sessionSyncBlocked = new Set();
  const conflictNoticeShown = new Set();
  const recoveryCreatedForSession = new Map();
  const SESSION_LEASE_PREFIX = 'residentado_session_lease_v1:';
  const SESSION_LEASE_TTL_MS = 18000;
  const SESSION_LEASE_HEARTBEAT_MS = 5000;
  let activeLeaseSessionId = null;
  let sessionLeaseHeartbeat = null;
  let lastLifecycleSaveAt = 0;
  const SESSION_SAVE_DEBOUNCE_MS = 1500;
  const SESSION_NAVIGATION_CHECKPOINT_MS = 30000;
  const OUTBOX_LOCK_NAME = 'residentado-session-outbox-v1';
  const OUTBOX_FALLBACK_LOCK_KEY = 'residentado_session_outbox_lock_v1';
  const OUTBOX_FALLBACK_LOCK_TTL_MS = 20000;
  let outboxProcessPromise = null;
  const sessionLeaseChannel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel('residentado-session-lease-v1')
    : null;

  const observed = q => String(q.audit_status || '').startsWith('OBSERVADA');
  const caveat = q => q.audit_status === 'VALIDADA_CON_CAVEAT';

  const esc = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');


  const EMPTY_EDITORIAL_PATTERNS = [
    /^no (?:se )?(?:requiere|requieren|hay|usar) (?:siglas|abreviaturas|términos)(?: indispensables| necesarias)?(?: en (?:esta|la) pregunta)?[.!]?$/i,
    /^(?:no aplica|n\/?a|ninguno|ninguna|sin contenido|sin datos)[.!]?$/i,
  ];

  function cleanEditorialText(value = '') {
    const text = String(value ?? '').replace(/\r/g, '').trim();
    if (!text) return '';
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !EMPTY_EDITORIAL_PATTERNS.some(rx => rx.test(line.replace(/\s+/g, ' ').trim())))
      .join('\n')
      .trim();
  }

  const hasEditorialText = value => Boolean(cleanEditorialText(value));

  function makeUuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function sessionNowIso() { return new Date().toISOString(); }

  function isSessionConflictError(error) {
    const code = String(error?.code || error?.status || '');
    const message = String(error?.message || '');
    return code === 'PT409' || code === '409' || code === '40001'
      || message.includes('SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE');
  }

  function isAttemptSessionForeignKeyError(error) {
    const code = String(error?.code || error?.status || '');
    const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
    return code === '23503' && /attempts_session_id_fkey|session_id.*practice_sessions|key \(session_id\)/i.test(text);
  }

  function sessionRemotePayloadFingerprint(row = {}, state = {}, answeredCount = 0) {
    return JSON.stringify({
      state:sessionStateFingerprint(state),
      config:row.config || {},
      answeredCount:Number(answeredCount || 0),
      activeTimeMs:Number(state.activeTimeMs ?? row.active_time_ms ?? 0),
      pausedTimeMs:Number(state.pausedTimeMs ?? row.paused_time_ms ?? 0),
    });
  }

  function readOutboxFallbackLease() {
    try { return JSON.parse(localStorage.getItem(OUTBOX_FALLBACK_LOCK_KEY) || 'null'); }
    catch { return null; }
  }

  function claimOutboxFallbackLease() {
    const current = readOutboxFallbackLease();
    if (current && current.tabId !== tabInstanceId && Number(current.expiresAt || 0) > Date.now()) return false;
    const lease = { tabId:tabInstanceId, expiresAt:Date.now() + OUTBOX_FALLBACK_LOCK_TTL_MS };
    try {
      localStorage.setItem(OUTBOX_FALLBACK_LOCK_KEY, JSON.stringify(lease));
      const confirmed = readOutboxFallbackLease();
      return Boolean(confirmed && confirmed.tabId === tabInstanceId);
    } catch {
      // Si localStorage no está disponible, el lock intra-pestaña sigue evitando duplicados locales.
      return true;
    }
  }

  function releaseOutboxFallbackLease() {
    try {
      const current = readOutboxFallbackLease();
      if (current?.tabId === tabInstanceId) localStorage.removeItem(OUTBOX_FALLBACK_LOCK_KEY);
    } catch {}
  }

  async function withOutboxLock(work) {
    if (navigator.locks?.request) {
      try {
        return await navigator.locks.request(OUTBOX_LOCK_NAME, { mode:'exclusive', ifAvailable:true }, async lock => {
          if (!lock) return { processed:0, remaining:(await sessionStore.listOutbox()).length, locked:true };
          return work();
        });
      } catch (error) {
        console.warn('Web Locks unavailable for outbox; using local lease fallback.', error);
      }
    }
    if (!claimOutboxFallbackLease()) return { processed:0, remaining:(await sessionStore.listOutbox()).length, locked:true };
    try { return await work(); }
    finally { releaseOutboxFallbackLease(); }
  }

  function sessionStateFingerprint(state = {}) {
    return SessionCore.sessionStateFingerprint
      ? SessionCore.sessionStateFingerprint(state)
      : JSON.stringify(normalizeSessionState(state));
  }

  // v1.4.3 — un shadow local atrasado no merece una recuperación si el remoto
  // ya contiene exactamente todo su progreso significativo. Esto evita convertir
  // snapshots prefijo de sesiones ya cerradas en copias fantasma de recuperación.
  function sessionResponseEquivalent(a, b) {
    const left = sessionResponse({ responses:{ value:a } }, 'value');
    const right = sessionResponse({ responses:{ value:b } }, 'value');
    return left.selected === right.selected
      && Boolean(left.didNotKnow) === Boolean(right.didNotKnow)
      && Boolean(left.timedOut) === Boolean(right.timedOut);
  }

  function sessionStateContains(candidateState = {}, subsetState = {}) {
    const candidate = normalizeSessionState(candidateState);
    const subset = normalizeSessionState(subsetState);

    for (const [questionId, response] of Object.entries(subset.responses || {})) {
      if (!responseCountsAsAnswered(response)) continue;
      const candidateResponse = candidate.responses?.[questionId];
      if (!candidateResponse || !responseCountsAsAnswered(candidateResponse)) return false;
      if (!sessionResponseEquivalent(candidateResponse, response)) return false;
    }

    for (const [questionId, scratch] of Object.entries(subset.scratch || {})) {
      if (JSON.stringify(candidate.scratch?.[questionId] || {}) !== JSON.stringify(scratch || {})) return false;
    }
    for (const [questionId, marked] of Object.entries(subset.marked || {})) {
      if (marked && !candidate.marked?.[questionId]) return false;
    }

    for (const [questionId, clientAttemptId] of Object.entries(subset.clientAttemptIdsByQuestion || {})) {
      const remoteId = candidate.clientAttemptIdsByQuestion?.[questionId];
      if (remoteId && String(remoteId) !== String(clientAttemptId)) return false;
    }
    for (const [questionId, attemptId] of Object.entries(subset.attemptIdsByQuestion || {})) {
      const remoteId = candidate.attemptIdsByQuestion?.[questionId];
      if (remoteId && String(remoteId) !== String(attemptId)) return false;
    }
    return true;
  }

  function sessionLeaseKey(sessionId) { return `${SESSION_LEASE_PREFIX}${sessionId}`; }

  function readSessionLease(sessionId) {
    try { return JSON.parse(localStorage.getItem(sessionLeaseKey(sessionId)) || 'null'); }
    catch { return null; }
  }

  function writeSessionLease(sessionId) {
    const lease = { sessionId, tabId:tabInstanceId, expiresAt:Date.now() + SESSION_LEASE_TTL_MS };
    try { localStorage.setItem(sessionLeaseKey(sessionId), JSON.stringify(lease)); }
    catch { return null; }
    sessionLeaseChannel?.postMessage({ type:'lease', ...lease });
    return lease;
  }

  function handleSessionLeaseLoss(sessionId) {
    if (!sessionId || sessionId !== activeLeaseSessionId) return;
    sessionSyncBlocked.add(sessionId);
    clearInterval(sessionLeaseHeartbeat);
    sessionLeaseHeartbeat = null;
    if (!conflictNoticeShown.has(`lease:${sessionId}`)) {
      conflictNoticeShown.add(`lease:${sessionId}`);
      alert('Esta sesión fue abierta en otra pestaña. Esta copia conservará el progreso local, pero no enviará más guardados a Supabase para evitar sobrescrituras.');
    }
  }

  function refreshSessionLease() {
    if (!activeLeaseSessionId) return;
    const current = readSessionLease(activeLeaseSessionId);
    if (current && current.tabId !== tabInstanceId && Number(current.expiresAt || 0) > Date.now()) {
      handleSessionLeaseLoss(activeLeaseSessionId);
      return;
    }
    writeSessionLease(activeLeaseSessionId);
  }

  function claimSessionLease(sessionId) {
    if (!sessionId) return true;
    const current = readSessionLease(sessionId);
    if (current && current.tabId !== tabInstanceId && Number(current.expiresAt || 0) > Date.now()) return false;
    if (activeLeaseSessionId && activeLeaseSessionId !== sessionId) releaseActiveSessionLease();
    activeLeaseSessionId = sessionId;
    sessionSyncBlocked.delete(sessionId);
    writeSessionLease(sessionId);
    clearInterval(sessionLeaseHeartbeat);
    sessionLeaseHeartbeat = setInterval(refreshSessionLease, SESSION_LEASE_HEARTBEAT_MS);
    return true;
  }

  function releaseActiveSessionLease() {
    clearInterval(sessionLeaseHeartbeat);
    sessionLeaseHeartbeat = null;
    if (!activeLeaseSessionId) return;
    const sessionId = activeLeaseSessionId;
    const current = readSessionLease(sessionId);
    if (!current || current.tabId === tabInstanceId) {
      try { localStorage.removeItem(sessionLeaseKey(sessionId)); } catch {}
      sessionLeaseChannel?.postMessage({ type:'release', sessionId, tabId:tabInstanceId });
    }
    activeLeaseSessionId = null;
  }

  function sessionInsertPayload(row) {
    return {
      id:row.id,
      user_id:user?.id || row.user_id,
      mode:row.mode,
      title:row.title,
      config:row.config || {},
      question_ids:row.question_ids || [],
      state:normalizeSessionState(row.state || {}),
      status:row.status || 'active',
      is_partial:Boolean(row.is_partial),
      closed_reason:row.closed_reason || null,
      answered_count:Number(row.answered_count || 0),
      planned_count:Number(row.planned_count || row.question_ids?.length || 0),
      active_time_ms:Number(row.active_time_ms || 0),
      paused_time_ms:Number(row.paused_time_ms || 0),
      last_synced_at:row.last_synced_at || null,
      state_schema_version:Number(row.state_schema_version || 1),
      state_revision:Number(row.state_revision || 0),
      client_app_version:APP_VERSION,
      created_at:row.created_at || sessionNowIso(),
      updated_at:row.updated_at || sessionNowIso(),
      completed_at:row.completed_at || null,
    };
  }

  function buildRecoverySessionRow(sourceRow, reason = 'revision_conflict') {
    const now = sessionNowIso();
    const sourceId = sourceRow.id;
    const previousRecovery = sourceRow.config?.recovery || {};
    // La recuperación de una sesión automática conserva el día del plan original.
    // Sin esto, una copia creada hoy de una sesión de ayer podría parecer una tarea de hoy.
    const preservedPlanDate = isDailyAutoSession(sourceRow) ? sessionPlanDate(sourceRow) : null;
    return {
      ...sourceRow,
      id:makeUuid(),
      title:`${String(sourceRow.title || 'Sesión').replace(/ · recuperación local$/i, '')} · recuperación local`,
      config:{
        ...(sourceRow.config || {}),
        ...(preservedPlanDate ? { planDate:preservedPlanDate } : {}),
        recovery:{
          rootSessionId:previousRecovery.rootSessionId || previousRecovery.sourceSessionId || sourceId,
          sourceSessionId:sourceId,
          reason,
          createdAt:now,
          sourceRevision:Number(sourceRow.state_revision || 0),
          sourceLocalDate:isoDateLocal(sourceRow.created_at || sourceRow.config?.planDate || sourceRow.updated_at || now),
        },
      },
      status:'active',
      is_partial:false,
      closed_reason:null,
      state_revision:0,
      last_synced_at:null,
      client_app_version:APP_VERSION,
      created_at:now,
      updated_at:now,
      completed_at:null,
      syncStatus:'recovery_local',
      syncError:null,
    };
  }

  function recoveryRootSessionId(row = {}) {
    const recovery = row?.config?.recovery || {};
    return recovery.rootSessionId || recovery.sourceSessionId || row?.id || null;
  }

  function recoveryReferencesSource(candidate = {}, sourceRow = {}) {
    if (!candidate?.config?.recovery || !sourceRow?.id) return false;
    const recovery = candidate.config.recovery || {};
    const sourceRoot = recoveryRootSessionId(sourceRow);
    return recovery.sourceSessionId === sourceRow.id
      || recovery.rootSessionId === sourceRow.id
      || (sourceRoot && recovery.rootSessionId === sourceRoot);
  }

  async function localRecoveryFor(sourceRow, { allowCompleted = false, equivalentState = true } = {}) {
    if (!sessionStore || !sourceRow?.id) return null;
    const rows = sessionStore.getSessionsForUser
      ? await sessionStore.getSessionsForUser(user?.id || sourceRow.user_id)
      : await sessionStore.getAllSessions();
    const sourceFingerprint = equivalentState ? sessionStateFingerprint(sourceRow.state || {}) : null;
    return (rows || [])
      .filter(candidate => candidate?.id !== sourceRow.id)
      .filter(candidate => recoveryReferencesSource(candidate, sourceRow))
      .filter(candidate => candidate.status === 'active' || (allowCompleted && candidate.status === 'completed'))
      .filter(candidate => !equivalentState || sessionStateFingerprint(candidate.state || {}) === sourceFingerprint)
      .sort((a,b) => new Date(b.completed_at || b.updated_at || b.localUpdatedAt || 0) - new Date(a.completed_at || a.updated_at || a.localUpdatedAt || 0))[0] || null;
  }

  async function clearSessionOutbox(sessionId) {
    if (!sessionStore?.listOutbox || !sessionStore?.deleteOutbox || !sessionId) return;
    const rows = await sessionStore.listOutbox();
    for (const item of rows || []) {
      const payload = item?.payload || {};
      const payloadSessionId = payload.sessionId || payload.id || payload?.updatePayload?.id || null;
      if (String(payloadSessionId || '') === String(sessionId)) await sessionStore.deleteOutbox(item.id);
    }
  }

  async function retireLocalConflictShadow(row) {
    if (!row?.id || !sessionStore) return;
    await clearSessionOutbox(row.id);
    await sessionStore.deleteSession(row.id);
    sessionSyncBlocked.delete(row.id);
    activeSessions = activeSessions.filter(item => item.id !== row.id);
  }

  async function retireRecoverySourceAfterClose(recoveryRow) {
    const recovery = recoveryRow?.config?.recovery || {};
    const sourceIds = [...new Set([recovery.sourceSessionId, recovery.rootSessionId].filter(Boolean))]
      .filter(sourceId => sourceId !== recoveryRow?.id);
    if (!sourceIds.length) return null;

    // La copia de recuperación ya conserva el progreso local. Al cerrarla de forma
    // explícita, las fuentes que quedaron activas solo por la cadena de conflicto dejan
    // de tener una función útil. Se conserva su estado remoto intacto y solo se
    // transicionan a `abandoned`, con control optimista de revisión.
    let lastResult = null;
    for (const sourceId of sourceIds) {
      await clearSessionOutbox(sourceId);
      const localSource = await sessionStore?.getSession?.(sourceId);
      if (localSource?.syncStatus === 'conflict') await retireLocalConflictShadow(localSource);
      if (!cloudConfigured || !user || !navigator.onLine) continue;

      const { data:remote, error:readError } = await supa.from('practice_sessions').select('*').eq('id', sourceId).maybeSingle();
      if (readError || !remote || remote.status !== 'active') {
        if (remote && remote.status !== 'active') await saveSessionShadow({ ...remote, syncStatus:'synced', syncError:null }, 'synced');
        lastResult = remote || lastResult;
        continue;
      }

      const now = sessionNowIso();
      const expectedRevision = Number(remote.state_revision || 0);
      const { data, error } = await supa.from('practice_sessions')
        .update({
          status:'abandoned',
          closed_reason:'superseded_by_completed_recovery',
          updated_at:now,
          last_synced_at:now,
          client_app_version:APP_VERSION,
          state_revision:expectedRevision + 1,
        })
        .eq('id', sourceId)
        .eq('status', 'active')
        .eq('state_revision', expectedRevision)
        .select()
        .maybeSingle();
      if (!error && data) {
        await saveSessionShadow({ ...data, syncStatus:'synced', syncError:null }, 'synced');
        activeSessions = activeSessions.filter(item => item.id !== sourceId);
        lastResult = data;
      }
    }
    return lastResult;
  }

  async function persistRecoverySession(sourceRow, reason = 'revision_conflict') {
    if (!sourceRow?.id) return null;
    const existingId = recoveryCreatedForSession.get(sourceRow.id);
    if (existingId) {
      const mapped = sessionStore?.getSession ? await sessionStore.getSession(existingId) : activeSessions.find(row => row.id === existingId);
      if (mapped?.status === 'active') return mapped;
      recoveryCreatedForSession.delete(sourceRow.id);
    }

    // FIX-SESSION-012: la deduplicación de recuperaciones debe sobrevivir recargas.
    // El Map anterior solo evitaba duplicados dentro de una misma ejecución.
    const existingRecovery = await localRecoveryFor(sourceRow, { allowCompleted:false, equivalentState:true });
    if (existingRecovery) {
      recoveryCreatedForSession.set(sourceRow.id, existingRecovery.id);
      return existingRecovery;
    }

    let recovery = buildRecoverySessionRow(sourceRow, reason);
    recoveryCreatedForSession.set(sourceRow.id, recovery.id);
    await saveSessionShadow(recovery, 'recovery_local');
    if (!cloudConfigured || !user || !navigator.onLine) {
      await sessionStore?.queueOperation('CREATE_SESSION', sessionInsertPayload(recovery), `CREATE_SESSION:${recovery.id}`);
      return recovery;
    }

    const payload = sessionInsertPayload(recovery);
    const { data, error } = await supa.from('practice_sessions').insert(payload).select().single();
    if (!error && data) {
      recovery = { ...data, syncStatus:'synced' };
      await saveSessionShadow(recovery, 'synced');
      return recovery;
    }

    recovery = { ...recovery, syncStatus:'offline_create', syncError:error?.message || 'No se pudo crear la copia de recuperación.' };
    await saveSessionShadow(recovery, 'offline_create');
    await sessionStore?.queueOperation('CREATE_SESSION', payload, `CREATE_SESSION:${recovery.id}`);
    return recovery;
  }

  // FIX-SESSION-004: preservar progreso local diferente antes de aceptar una revision remota superior.
  async function preserveStaleLocalSessionCopies(remoteRows = [], localRows = []) {
    if (!sessionStore) return [];
    const remoteById = new Map((remoteRows || []).map(row => [row.id, row]));
    const recoveries = [];
    for (const local of localRows || []) {
      const remote = remoteById.get(local.id);
      if (!remote || local.status !== 'active') continue;
      const localRevision = Number(local.state_revision || 0);
      const remoteRevision = Number(remote.state_revision || 0);
      const riskyStatus = ['conflict', 'pending', 'offline'].includes(local.syncStatus);
      const stateDiffers = sessionStateFingerprint(local.state || {}) !== sessionStateFingerprint(remote.state || {});
      const localHasUniqueProgress = stateDiffers && !sessionStateContains(remote.state || {}, local.state || {});
      if (localHasUniqueProgress && (local.syncStatus === 'conflict' || (riskyStatus && localRevision < remoteRevision))) {
        const recovery = await persistRecoverySession(local, 'stale_local_shadow_on_load');
        if (recovery) recoveries.push(recovery);
      }
    }
    return recoveries;
  }

  async function initializeSessionStorage() {
    try {
      sessionStore = window.ResidentadoSessionStorage?.createStore?.() || null;
      if (sessionStore) {
        await sessionStore.open();
        await sessionStore.migrateLegacyLocalStorage();
        const existing = await sessionStore.getMetadata('deviceInstanceId');
        deviceInstanceId = existing?.value || makeUuid();
        if (!existing?.value) await sessionStore.setMetadata('deviceInstanceId', deviceInstanceId);
      }
    } catch (error) {
      console.warn('Session storage unavailable; using legacy fallback.', error);
      sessionStore = null;
      deviceInstanceId = makeUuid();
    }
  }

  function normalizeSessionState(state = {}) {
    return SessionCore.normalizeState ? SessionCore.normalizeState(state) : state;
  }

  function sessionResponse(state, questionId) {
    const value = state?.responses?.[questionId];
    if (typeof value === 'string') return { selected:value, didNotKnow:false, timedOut:false };
    return value && typeof value === 'object' ? value : { selected:null, didNotKnow:false, timedOut:false };
  }

  function sessionSelected(state, questionId) {
    return SessionCore.responseSelected
      ? SessionCore.responseSelected(state, questionId)
      : (sessionResponse(state, questionId).selected ?? null);
  }

  function responseCountsAsAnswered(value) {
    if (SessionCore.responseAnswered) return SessionCore.responseAnswered(value);
    const row = typeof value === 'string' ? { selected:value } : (value || {});
    return row.selected != null || Boolean(row.didNotKnow) || Boolean(row.timedOut);
  }

  function answeredIdsFor(row, state) {
    if (SessionCore.answeredQuestionIds) return SessionCore.answeredQuestionIds(row?.question_ids || [], state || {});
    return (row?.question_ids || []).filter(id => responseCountsAsAnswered(state?.responses?.[id]));
  }

  function persistedAttemptForIdentity(holder, questionId) {
    if (!holder || !questionId) return null;
    const container = holder.state && holder === currentExam ? holder.state : holder;
    const attemptId = container?.attemptIdsByQuestion?.[questionId] || null;
    const clientAttemptId = container?.clientAttemptIdsByQuestion?.[questionId] || null;
    return attempts.find(attempt =>
      (attemptId && String(attempt.id || '') === String(attemptId))
      || (clientAttemptId && String(attempt.client_attempt_id || '') === String(clientAttemptId))
    ) || null;
  }

  function detachInheritedAttemptIdentity(holder, questionId) {
    if (!holder || !questionId) return;
    const container = holder.state && holder === currentExam ? holder.state : holder;
    const persisted = persistedAttemptForIdentity(holder, questionId);
    const belongsElsewhere = persisted
      && String(persisted.session_id || '') !== String(holder?.row?.id || '');
    if (!belongsElsewhere) return;
    if (container.attemptIdsByQuestion) delete container.attemptIdsByQuestion[questionId];
    if (container.clientAttemptIdsByQuestion) delete container.clientAttemptIdsByQuestion[questionId];
  }

  function ensureClientAttemptId(holder, questionId) {
    if (!holder) return makeUuid();
    const container = holder.state && holder === currentExam ? holder.state : holder;
    container.clientAttemptIdsByQuestion ||= {};
    if (!container.clientAttemptIdsByQuestion[questionId]) container.clientAttemptIdsByQuestion[questionId] = makeUuid();
    return container.clientAttemptIdsByQuestion[questionId];
  }

  function sessionAttemptMeta(holder, questionId) {
    const index = Math.max(0, (holder?.questions || []).findIndex(question => question.id === questionId));
    return {
      sessionId:holder?.row?.id || null,
      sessionQuestionIndex:index,
      clientAttemptId:ensureClientAttemptId(holder, questionId),
    };
  }

  function currentSessionOwner() {
    if (currentStudy?.row) return { kind:'study', holder:currentStudy, row:currentStudy.row, state:studyStateSnapshot() };
    if (currentExam?.row) return { kind:'exam', holder:currentExam, row:currentExam.row, state:normalizeSessionState(currentExam.state) };
    return null;
  }

  function studyStateSnapshot() {
    if (!currentStudy) return normalizeSessionState({});
    if (SessionCore.studyToState) return SessionCore.studyToState(currentStudy, deviceInstanceId);
    return normalizeSessionState({
      schemaVersion:1,
      currentIndex:currentStudy.index || 0,
      responses:currentStudy.responses || {},
      scratch:currentStudy.scratch || {},
      marked:currentStudy.marked || {},
      optionOrders:currentStudy.optionOrders || {},
      durations:currentStudy.durations || {},
      answerTimes:currentStudy.answerTimes || {},
      timeSpent:currentStudy.timeSpent || {},
      attemptIdsByQuestion:currentStudy.attemptIdsByQuestion || {},
      clientAttemptIdsByQuestion:currentStudy.clientAttemptIdsByQuestion || {},
      totalRemaining:currentStudy.totalRemaining ?? null,
      activeTimeMs:currentStudy.activeTimeMs || 0,
      pausedTimeMs:currentStudy.pausedTimeMs || 0,
      lastVisibleAt:currentStudy.lastVisibleAt || null,
      lastSavedAt:sessionNowIso(),
      deviceInstanceId,
    });
  }

  function applyStateToStudy(study, state) {
    const normalized = normalizeSessionState(state);
    study.index = Math.min(Math.max(0, normalized.currentIndex || 0), Math.max(0, study.questions.length - 1));
    study.responses = normalized.responses || {};
    study.scratch = normalized.scratch || {};
    study.marked = normalized.marked || {};
    study.durations = normalized.durations || {};
    study.answerTimes = normalized.answerTimes || {};
    study.timeSpent = normalized.timeSpent || {};
    study.optionOrders = Object.keys(normalized.optionOrders || {}).length
      ? normalized.optionOrders
      : createOptionOrders(study.questions, study.config.shuffleOptions !== false);
    study.totalRemaining = normalized.totalRemaining ?? (study.config.timeMode === 'total' ? study.config.totalSeconds : null);
    study.attemptIdsByQuestion = normalized.attemptIdsByQuestion || {};
    study.clientAttemptIdsByQuestion = normalized.clientAttemptIdsByQuestion || {};
    study.activeTimeMs = normalized.activeTimeMs || 0;
    study.pausedTimeMs = normalized.pausedTimeMs || 0;
    study.lastVisibleAt = normalized.lastVisibleAt || null;
    study.deviceInstanceId = normalized.deviceInstanceId || deviceInstanceId;
    return study;
  }

  function upsertSessionInMemory(row) {
    if (!row?.id) return;
    if (row.status === 'abandoned') {
      activeSessions = activeSessions.filter(item => item.id !== row.id);
      completedSessions = completedSessions.filter(item => item.id !== row.id);
      return;
    }
    const target = row.status === 'completed' ? completedSessions : activeSessions;
    const other = row.status === 'completed' ? activeSessions : completedSessions;
    const index = target.findIndex(item => item.id === row.id);
    if (index >= 0) target[index] = row;
    else target.unshift(row);
    const otherIndex = other.findIndex(item => item.id === row.id);
    if (otherIndex >= 0) other.splice(otherIndex, 1);
  }

  function removeActiveSessionInMemory(sessionId) {
    activeSessions = activeSessions.filter(row => row.id !== sessionId);
  }

  async function saveSessionShadow(row, syncStatus = 'pending') {
    if (!row?.id) return row;
    upsertSessionInMemory(row);
    if (sessionStore) {
      try { await sessionStore.putSession(row, syncStatus); }
      catch (error) { console.warn('Could not save local session shadow.', error); }
    } else if (!cloudConfigured) saveLocalSessions();
    return row;
  }

  function buildNewSessionRow(mode, selected, config, state) {
    const now = sessionNowIso();
    return {
      id: makeUuid(),
      user_id: user?.id || 'local-user',
      mode,
      title: config.title || (mode === 'exam' ? 'Simulacro' : 'Práctica'),
      config,
      question_ids: selected.map(question => question.id),
      state: normalizeSessionState(state),
      status:'active',
      is_partial:false,
      closed_reason:null,
      answered_count:0,
      planned_count:selected.length,
      active_time_ms:0,
      paused_time_ms:0,
      last_synced_at:null,
      state_schema_version:1,
      state_revision:0,
      client_app_version:APP_VERSION,
      created_at:now,
      updated_at:now,
      completed_at:null,
    };
  }

  async function createPersistentSession(mode, selected, config, state) {
    let row = buildNewSessionRow(mode, selected, config, state);
    await saveSessionShadow(row, cloudConfigured ? 'pending' : 'local');
    if (!cloudConfigured) return row;

    const insertRow = {
      id:row.id,
      user_id:user.id,
      mode:row.mode,
      title:row.title,
      config:row.config,
      question_ids:row.question_ids,
      state:row.state,
      status:'active',
      is_partial:false,
      closed_reason:null,
      answered_count:0,
      planned_count:row.planned_count,
      active_time_ms:0,
      paused_time_ms:0,
      state_schema_version:1,
      state_revision:0,
      client_app_version:APP_VERSION,
      updated_at:row.updated_at,
    };
    const { data, error } = await supa.from('practice_sessions').insert(insertRow).select().single();
    if (error) {
      await sessionStore?.queueOperation('CREATE_SESSION', insertRow, `CREATE_SESSION:${row.id}`);
      row = { ...row, syncStatus:'offline', syncError:error.message };
      await saveSessionShadow(row, 'offline');
      alert(`La sesión quedó guardada en este dispositivo, pero no se sincronizó con Supabase: ${error.message}`);
      return row;
    }
    row = { ...data, syncStatus:'synced' };
    await saveSessionShadow(row, 'synced');
    return row;
  }

  async function quarantineOrphanAttempt(payload = {}, error = null) {
    const clientAttemptId = String(payload.client_attempt_id || '').trim();
    if (!clientAttemptId) return;
    const current = await sessionStore.getAttempt(clientAttemptId);
    const orphaned = {
      ...(current || { id:`local-${clientAttemptId}`, ...payload }),
      ...payload,
      user_id:user?.id || payload.user_id || current?.user_id || 'local-user',
      syncStatus:'orphaned_session',
      syncError:'SESSION_NOT_FOUND_23503',
      orphanedAt:sessionNowIso(),
      orphanedError:String(error?.message || 'attempts_session_id_fkey'),
    };
    await saveAttemptShadow(orphaned, 'orphaned_session');
    upsertAttemptInMemory(orphaned);
    console.warn('Attempt preserved locally and retired from active outbox because its session no longer exists.', {
      client_attempt_id:clientAttemptId,
      session_id:payload.session_id || null,
    });
  }

  async function processSessionOutboxUnlocked() {
    let totalProcessed = 0;
    for (let pass = 0; pass < 4; pass++) {
      const rows = (await sessionStore.listOutbox()).slice().sort((a,b) => {
        // CREATE_SESSION must precede dependent attempts/saves even if it was queued later.
        const pa = a.type === 'CREATE_SESSION' ? 0 : 1;
        const pb = b.type === 'CREATE_SESSION' ? 0 : 1;
        return pa - pb || Number(a.id || 0) - Number(b.id || 0);
      });
      let processed = 0;
      let restartRequested = false;
      for (const item of rows) {
        let ok = false;
        try {
          if (item.type === 'CREATE_SESSION') {
            const payload = { ...item.payload, user_id:user.id };
            const { data, error } = await supa.from('practice_sessions').insert(payload).select().single();
            if (!error && data) {
              await saveSessionShadow({ ...data, syncStatus:'synced' }, 'synced');
              ok = true;
            } else if (String(error?.code || '') === '23505') {
              // FIX-SESSION-006: never overwrite an existing server session with an offline CREATE replay.
              const { data:existing } = await supa.from('practice_sessions').select('*').eq('id', payload.id).maybeSingle();
              if (existing) {
                const local = await sessionStore.getSession(payload.id);
                const localDiffers = local && sessionStateFingerprint(local.state || {}) !== sessionStateFingerprint(existing.state || {});
                if (localDiffers) {
                  const desired = { ...local, state_revision:Number(existing.state_revision || 0), syncStatus:'offline' };
                  await saveSessionShadow(desired, 'offline');
                  await sessionStore.queueOperation('UPSERT_SESSION', {
                    sessionId:desired.id,
                    expectedRevision:Number(existing.state_revision || 0),
                    state:desired.state || {},
                    config:desired.config || {},
                    answeredCount:Number(desired.answered_count || 0),
                    activeTimeMs:Number(desired.active_time_ms || 0),
                    pausedTimeMs:Number(desired.paused_time_ms || 0),
                  }, `UPSERT_SESSION:${desired.id}`);
                  restartRequested = true;
                } else {
                  await saveSessionShadow({ ...existing, syncStatus:'synced' }, 'synced');
                }
                ok = true;
              }
            }
          } else if (item.type === 'UPSERT_SESSION') {
            const p = item.payload || {};
            const { data, error } = await supa.rpc('save_practice_session_state', {
              p_session_id:p.sessionId,
              p_expected_revision:Number(p.expectedRevision || 0),
              p_state:p.state || {},
              p_config:p.config || {},
              p_answered_count:Number(p.answeredCount || 0),
              p_active_time_ms:Number(p.activeTimeMs || 0),
              p_paused_time_ms:Number(p.pausedTimeMs || 0),
              p_client_app_version:APP_VERSION,
              p_state_schema_version:1,
            });
            if (!error) {
              const saved = Array.isArray(data) ? data[0] : data;
              if (saved) await saveSessionShadow({ ...saved, syncStatus:'synced' }, 'synced');
              ok = true;
            } else if (isSessionConflictError(error)) {
              // FIX-SESSION-003: a revision conflict is terminal for this stale operation, not an offline retry.
              const stored = await sessionStore.getSession(p.sessionId);
              const local = stored ? {
                ...stored,
                state:p.state || stored.state,
                config:p.config || stored.config,
                answered_count:Number(p.answeredCount ?? stored.answered_count ?? 0),
                active_time_ms:Number(p.activeTimeMs ?? stored.active_time_ms ?? 0),
                paused_time_ms:Number(p.pausedTimeMs ?? stored.paused_time_ms ?? 0),
              } : null;
              const { data:remote } = await supa.from('practice_sessions').select('*').eq('id', p.sessionId).maybeSingle();
              if (remote && local && sessionStateContains(remote.state || {}, local.state || {})) {
                // El remoto ya contiene este snapshot atrasado (por ejemplo 39/40 de una
                // sesión completada). Aceptarlo y retirar el outbox es seguro; crear una
                // recuperación aquí duplicaría progreso ya persistido.
                await saveSessionShadow({ ...remote, syncStatus:'synced', syncError:null }, 'synced');
                sessionSyncBlocked.delete(p.sessionId);
              } else {
                if (local) await persistRecoverySession(local, 'outbox_revision_conflict');
                if (remote) await saveSessionShadow({ ...remote, syncStatus:'synced' }, 'synced');
              }
              ok = true;
            }
          } else if (item.type === 'INSERT_ATTEMPT') {
            const payload = { ...item.payload, user_id:user.id };
            let { data, error } = await supa.from('attempts')
              .upsert(payload, { onConflict:'user_id,client_attempt_id' })
              .select()
              .single();

            if (isAttemptSessionForeignKeyError(error)) {
              const sessionId = String(payload.session_id || '').trim();
              const { data:remoteSession, error:sessionError } = sessionId
                ? await supa.from('practice_sessions').select('id').eq('id', sessionId).maybeSingle()
                : { data:null, error:null };
              if (!sessionError && remoteSession) {
                // Posible carrera CREATE_SESSION -> INSERT_ATTEMPT: un único reintento, nunca un loop.
                ({ data, error } = await supa.from('attempts')
                  .upsert(payload, { onConflict:'user_id,client_attempt_id' })
                  .select()
                  .single());
              } else if (!sessionError && !remoteSession) {
                // El intento fue real y ya afectó memoria local, pero su padre remoto desapareció.
                // Se conserva en IndexedDB y se retira solo de la cola activa para que no la envenene.
                await quarantineOrphanAttempt(payload, error);
                ok = true;
              }
            }

            if (!error && data) {
              const saved = { ...data, syncStatus:'synced' };
              await saveAttemptShadow(saved, 'synced');
              upsertAttemptInMemory(saved);
              ok = true;
            }
          } else if (item.type === 'CLOSE_SESSION') {
            const p = item.payload || {};
            let request = supa.from('practice_sessions')
              .update(p.updatePayload || {})
              .eq('id', p.sessionId)
              .eq('status', 'active');
            if (p.expectedRevision != null) request = request.eq('state_revision', Number(p.expectedRevision));
            let { data, error } = await request.select().maybeSingle();
            if (!error && data) {
              await saveSessionShadow({ ...data, syncStatus:'synced' }, 'synced');
              ok = true;
            } else if (!error && !data && p.statusOnly) {
              // v1.5.0: el autocierre por cambio de día es una transición de estado.
              // Si cambió la revisión remota, se reintenta contra la revisión actual SIN
              // copiar state ni crear recoveries. Nunca materializa respuestas heredadas.
              const read = await supa.from('practice_sessions').select('*').eq('id', p.sessionId).maybeSingle();
              if (!read.error && read.data?.status === 'active') {
                const remoteRevision = Number(read.data.state_revision || 0);
                const retryPayload = {
                  ...(p.updatePayload || {}),
                  state_revision:remoteRevision + 1,
                  updated_at:sessionNowIso(),
                  last_synced_at:sessionNowIso(),
                };
                const retry = await supa.from('practice_sessions')
                  .update(retryPayload)
                  .eq('id', p.sessionId)
                  .eq('status', 'active')
                  .eq('state_revision', remoteRevision)
                  .select('*')
                  .maybeSingle();
                data = retry.data;
                error = retry.error;
                if (!error && data) {
                  await saveSessionShadow({ ...data, syncStatus:'synced' }, 'synced');
                  ok = true;
                }
              } else if (!read.error && read.data) {
                await saveSessionShadow({ ...read.data, syncStatus:'synced', syncError:null }, 'synced');
                ok = true;
              } else if (!read.error && !read.data) {
                await sessionStore.deleteSession(p.sessionId);
                removeActiveSessionInMemory(p.sessionId);
                ok = true;
              }
            } else if (!error && !data) {
              const stored = await sessionStore.getSession(p.sessionId);
              const local = stored ? { ...stored, ...(p.updatePayload || {}), status:'active' } : null;
              if (local) await persistRecoverySession(local, 'close_revision_conflict');
              ok = true;
            }
          }
        } catch (error) {
          console.warn('Outbox operation failed.', item.type, error);
        }
        if (!ok) break;
        await sessionStore.deleteOutbox(item.id);
        processed += 1;
      }
      totalProcessed += processed;
      const remaining = (await sessionStore.listOutbox()).length;
      if (!restartRequested || !remaining) return { processed:totalProcessed, remaining };
    }
    return { processed:totalProcessed, remaining:(await sessionStore.listOutbox()).length };
  }

  async function processSessionOutbox() {
    if (!cloudConfigured || !user || !sessionStore || !navigator.onLine) return { processed:0, remaining:0 };
    if (outboxProcessPromise) return outboxProcessPromise;
    outboxProcessPromise = withOutboxLock(processSessionOutboxUnlocked)
      .finally(() => { outboxProcessPromise = null; });
    return outboxProcessPromise;
  }

  function updateHolderFromSavedRow(owner, savedRow) {
    if (!owner || !savedRow) return;
    owner.holder.row = savedRow;
    if (owner.kind === 'exam') owner.holder.state = normalizeSessionState(savedRow.state || owner.holder.state);
  }

  async function handleSessionRevisionConflict(owner, row, error, options = {}) {
    // FIX-SESSION-002/003/004: stop stale writes, preserve local progress, and continue on a new revision-safe session.
    sessionSyncBlocked.add(row.id);
    const { data:remote } = await supa.from('practice_sessions').select('*').eq('id', row.id).maybeSingle();

    // v1.4.3: si el remoto ya contiene todo el snapshot local, el conflicto solo
    // demuestra que el local estaba atrasado. No crear una recuperación redundante.
    if (remote && sessionStateContains(remote.state || {}, row.state || {})) {
      const syncedRemote = { ...remote, syncStatus:'synced', syncError:null };
      await saveSessionShadow(syncedRemote, 'synced');
      sessionSyncBlocked.delete(row.id);
      upsertSessionInMemory(syncedRemote);
      if (remote.status !== 'active') activeSessions = activeSessions.filter(item => item.id !== row.id);
      if (owner) updateHolderFromSavedRow(owner, syncedRemote);
      return syncedRemote;
    }

    // v1.3.3: durante "Terminar / cerrar parcial", los intentos ya fueron persistidos
    // antes de cerrar. Si el servidor confirma que la sesión ya está cerrada, crear
    // otra recuperación activa solo produce una sesión fantasma.
    if (options.duringClose && remote && remote.status !== 'active') {
      const syncedRemote = { ...remote, syncStatus:'synced', syncError:null };
      await saveSessionShadow(syncedRemote, 'synced');
      sessionSyncBlocked.delete(row.id);
      upsertSessionInMemory(syncedRemote);
      activeSessions = activeSessions.filter(item => item.id !== row.id);
      return syncedRemote;
    }

    const conflicted = { ...row, syncStatus:'conflict', syncError:error?.message || 'SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE' };
    await saveSessionShadow(conflicted, 'conflict');
    const recovery = await persistRecoverySession(conflicted, 'revision_conflict');

    if (remote) await saveSessionShadow({ ...remote, syncStatus:'synced' }, 'synced');

    if (owner && recovery) {
      releaseActiveSessionLease();
      updateHolderFromSavedRow(owner, recovery);
      claimSessionLease(recovery.id);
      sessionSyncBlocked.delete(recovery.id);
    }

    if (!options.duringClose && !conflictNoticeShown.has(row.id)) {
      conflictNoticeShown.add(row.id);
      alert(recovery
        ? 'Se detectó una revisión distinta de esta sesión. Tu progreso local se conservó en una copia de recuperación y continuarás allí sin sobrescribir la otra copia.'
        : 'Se detectó una revisión distinta. El progreso local quedó conservado, pero la sincronización de esta sesión fue detenida para evitar una sobrescritura.');
    }
    return recovery || conflicted;
  }

  async function persistCurrentSessionShadow(owner = currentSessionOwner()) {
    if (!owner?.row?.id) return owner?.row || null;
    const state = normalizeSessionState(owner.kind === 'study' ? studyStateSnapshot() : owner.holder.state);
    const answeredCount = answeredIdsFor(owner.row, state).length;
    const row = {
      ...owner.row,
      state,
      answered_count:answeredCount,
      active_time_ms:state.activeTimeMs || 0,
      paused_time_ms:state.pausedTimeMs || 0,
      client_app_version:APP_VERSION,
      state_schema_version:1,
      updated_at:sessionNowIso(),
    };
    await saveSessionShadow(row, cloudConfigured ? 'pending' : 'local');
    return row;
  }

  async function syncSessionOwner(owner) {
    if (!owner?.row?.id) return owner?.row || null;
    const state = normalizeSessionState(owner.kind === 'study' ? studyStateSnapshot() : owner.holder.state);
    const now = sessionNowIso();
    const answeredCount = answeredIdsFor(owner.row, state).length;
    const baseFingerprint = sessionRemotePayloadFingerprint(
      owner.row,
      normalizeSessionState(owner.row.state || {}),
      Number(owner.row.answered_count || 0)
    );
    const nextFingerprint = sessionRemotePayloadFingerprint(owner.row, state, answeredCount);
    let row = {
      ...owner.row,
      state,
      answered_count:answeredCount,
      active_time_ms:state.activeTimeMs || 0,
      paused_time_ms:state.pausedTimeMs || 0,
      client_app_version:APP_VERSION,
      state_schema_version:1,
      updated_at:now,
    };

    // OPT-SAVE-002: no incrementar state_revision ni llamar al RPC si nada persistible cambió.
    if (owner.row.syncStatus === 'synced' && baseFingerprint === nextFingerprint) return owner.row;

    owner.holder.row = row;
    const preSyncStatus = ['recovery_local','offline_create','offline','conflict'].includes(row.syncStatus)
      ? row.syncStatus
      : 'pending';
    await saveSessionShadow(row, cloudConfigured ? preSyncStatus : 'local');
    if (!cloudConfigured || sessionSyncBlocked.has(row.id)) return row;

    if (['recovery_local', 'offline_create'].includes(row.syncStatus)) {
      await processSessionOutbox();
      const refreshed = await sessionStore?.getSession(row.id);
      if (!refreshed || refreshed.syncStatus !== 'synced') return row;
      row = refreshed;
      updateHolderFromSavedRow(owner, row);
    }

    const expectedRevision = Number(row.state_revision || 0);
    const { data, error } = await supa.rpc('save_practice_session_state', {
      p_session_id:row.id,
      p_expected_revision:expectedRevision,
      p_state:state,
      p_config:row.config || {},
      p_answered_count:answeredCount,
      p_active_time_ms:state.activeTimeMs || 0,
      p_paused_time_ms:state.pausedTimeMs || 0,
      p_client_app_version:APP_VERSION,
      p_state_schema_version:1,
    });
    if (error) {
      if (isSessionConflictError(error)) return handleSessionRevisionConflict(owner, row, error);

      const pending = { ...row, syncStatus:'offline', syncError:error.message };
      owner.holder.row = pending;
      await saveSessionShadow(pending, 'offline');
      await sessionStore?.queueOperation('UPSERT_SESSION', {
        sessionId:row.id,
        expectedRevision,
        state,
        config:row.config || {},
        answeredCount,
        activeTimeMs:state.activeTimeMs || 0,
        pausedTimeMs:state.pausedTimeMs || 0,
      }, `UPSERT_SESSION:${row.id}`);
      return pending;
    }
    const saved = Array.isArray(data) ? data[0] : data;
    const synced = { ...(saved || row), syncStatus:'synced' };
    updateHolderFromSavedRow(owner, synced);

    // Si el usuario avanzó mientras el RPC estaba en vuelo, no pisar el shadow local más nuevo.
    const latestLocal = await sessionStore?.getSession(row.id);
    const latestLocalFingerprint = latestLocal
      ? sessionRemotePayloadFingerprint(latestLocal, normalizeSessionState(latestLocal.state || {}), Number(latestLocal.answered_count || 0))
      : null;
    if (latestLocal && latestLocalFingerprint && latestLocalFingerprint !== nextFingerprint && ['pending','offline'].includes(latestLocal.syncStatus)) {
      await saveSessionShadow({
        ...latestLocal,
        state_revision:Number(synced.state_revision || expectedRevision + 1),
        last_synced_at:synced.last_synced_at || latestLocal.last_synced_at || null,
        syncStatus:'pending',
        syncError:null,
      }, 'pending');
    } else {
      await saveSessionShadow(synced, 'synced');
    }
    return synced;
  }

  function scheduleCurrentSessionSave({ immediate = false, localOnly = false, delayMs = SESSION_SAVE_DEBOUNCE_MS } = {}) {
    const owner = currentSessionOwner();
    if (!owner) return Promise.resolve(null);

    // Local-first: cada interacción importante queda en IndexedDB aunque el checkpoint remoto se consolide.
    const localSave = persistCurrentSessionShadow(owner).catch(error => {
      console.warn('Could not persist local session checkpoint.', error);
      return owner.row;
    });
    if (localOnly) return localSave;

    clearTimeout(sessionSaveTimer);
    const run = () => {
      sessionSaveTimer = null;
      sessionSaveChain = sessionSaveChain
        .catch(() => null)
        .then(() => syncSessionOwner(currentSessionOwner() || owner));
      return sessionSaveChain;
    };
    if (immediate) return localSave.then(run);
    sessionSaveTimer = setTimeout(run, Math.max(0, Number(delayMs) || SESSION_SAVE_DEBOUNCE_MS));
    return localSave;
  }

  async function flushCurrentSessionSave() {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
    const owner = currentSessionOwner();
    if (!owner) return null;
    await persistCurrentSessionShadow(owner);
    sessionSaveChain = sessionSaveChain.catch(() => null).then(() => syncSessionOwner(currentSessionOwner() || owner));
    return sessionSaveChain;
  }

  async function drainPendingSessionSaveWithoutWrite() {
    // Al cerrar explícitamente una sesión no lanzamos un guardado activo adicional.
    // Ese guardado era capaz de descubrir primero el PT409, crear una recuperación y
    // mostrar una alerta de "continuarás allí" justo antes de que el usuario pidiera
    // cerrar. Esperamos solamente cualquier escritura que ya estuviera en vuelo y el
    // cierre final persiste el estado completo con control optimista de revisión.
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
    try { await sessionSaveChain; } catch {}
  }

  function beginSessionActivity() {
    if (document.visibilityState === 'hidden') {
      sessionHiddenStartedAt = performance.now();
      sessionActivityStartedAt = 0;
      return;
    }
    sessionActivityStartedAt = performance.now();
    sessionHiddenStartedAt = 0;
  }

  function accumulateSessionActivity() {
    const owner = currentSessionOwner();
    if (!owner) return;
    const state = owner.kind === 'study' ? studyStateSnapshot() : normalizeSessionState(owner.holder.state);
    const now = performance.now();
    if (sessionActivityStartedAt) {
      state.activeTimeMs += Math.max(0, Math.round(now - sessionActivityStartedAt));
      sessionActivityStartedAt = now;
    }
    if (sessionHiddenStartedAt) {
      state.pausedTimeMs += Math.max(0, Math.round(now - sessionHiddenStartedAt));
      sessionHiddenStartedAt = now;
    }
    state.lastVisibleAt = document.visibilityState === 'hidden' ? null : sessionNowIso();
    if (owner.kind === 'study') applyStateToStudy(owner.holder, state);
    else owner.holder.state = state;
  }

  function endSessionActivity() {
    accumulateSessionActivity();
    sessionActivityStartedAt = 0;
    sessionHiddenStartedAt = 0;
  }

  function requestLifecycleSessionSave() {
    const now = Date.now();
    if (now - lastLifecycleSaveAt < 1500) return;
    lastLifecycleSaveAt = now;
    accumulateSessionActivity();
    scheduleCurrentSessionSave({ immediate:true });
  }

  function installSessionLifecycleHooks() {
    window.addEventListener('online', () => { processSessionOutbox().catch(() => {}); });
    window.addEventListener('storage', event => {
      if (!activeLeaseSessionId || event.key !== sessionLeaseKey(activeLeaseSessionId)) return;
      const lease = readSessionLease(activeLeaseSessionId);
      if (lease && lease.tabId !== tabInstanceId && Number(lease.expiresAt || 0) > Date.now()) handleSessionLeaseLoss(activeLeaseSessionId);
    });
    sessionLeaseChannel?.addEventListener('message', event => {
      const message = event.data || {};
      if (message.type === 'lease' && message.sessionId === activeLeaseSessionId && message.tabId !== tabInstanceId) {
        const lease = readSessionLease(activeLeaseSessionId);
        if (lease?.tabId !== tabInstanceId) handleSessionLeaseLoss(activeLeaseSessionId);
      }
    });
    document.addEventListener('visibilitychange', () => {
      const owner = currentSessionOwner();
      if (!owner) return;
      accumulateSessionActivity();
      if (document.visibilityState === 'hidden') {
        sessionActivityStartedAt = 0;
        sessionHiddenStartedAt = performance.now();
        requestLifecycleSessionSave();
      } else {
        sessionHiddenStartedAt = 0;
        sessionActivityStartedAt = performance.now();
        if (sessionExpiredByLocalDay(owner.row)) {
          handleCurrentSessionDayBoundary().catch(error => console.warn('Day-boundary close failed.', error));
          return;
        }
        refreshSessionLease();
      }
    });
    window.addEventListener('pagehide', () => {
      if (!currentSessionOwner()) return;
      requestLifecycleSessionSave();
    });
    window.addEventListener('beforeunload', event => {
      if (!currentSessionOwner()) return;
      // FIX-SESSION-007: do not launch a second asynchronous save during unload; visibility/pagehide already requested one.
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('popstate', () => {
      if (!sessionNavigationGuardActive || !currentSessionOwner()) return;
      history.pushState({ residentadoSessionGuard:true }, '', location.href);
      requestCurrentSessionExit();
    });
  }

  function activateSessionNavigationGuard() {
    if (sessionNavigationGuardActive) return;
    sessionNavigationGuardActive = true;
    history.pushState({ residentadoSessionGuard:true }, '', location.href);
  }

  function deactivateSessionNavigationGuard() {
    sessionNavigationGuardActive = false;
    releaseActiveSessionLease();
  }

  function closeExitDialog() {
    document.getElementById('session-exit-overlay')?.remove();
  }

  function showSessionExitDialog(answeredCount, handlers) {
    closeExitDialog();
    const overlay = document.createElement('div');
    overlay.id = 'session-exit-overlay';
    overlay.className = 'session-exit-overlay';
    overlay.innerHTML = `<section class="session-exit-dialog" role="dialog" aria-modal="true" aria-labelledby="session-exit-title">
      <button class="session-exit-close" type="button" aria-label="Volver a la sesión">×</button>
      <h2 id="session-exit-title">¿Qué deseas hacer con esta sesión?</h2>
      <p>Tu progreso se guarda antes de salir.</p>
      <div class="session-exit-actions">
        <button id="session-continue-later" class="btn primary" type="button">Continuar después</button>
        <button id="session-close-partial" class="btn" type="button" ${answeredCount ? '' : 'disabled'}>Cerrar sesión parcial y revisar respondidas</button>
      </div>
      ${answeredCount ? `<small>${answeredCount} pregunta${answeredCount===1?'':'s'} respondida${answeredCount===1?'':'s'} se incluirá${answeredCount===1?'':'n'} en la revisión.</small>` : '<small>Aún no hay preguntas respondidas. Continúa después y ciérrala cuando exista al menos una respuesta.</small>'}
    </section>`;
    document.body.appendChild(overlay);
    const keyHandler = event => { if (event.key === 'Escape') dismiss(); };
    const dismiss = () => {
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
    };
    overlay.querySelector('.session-exit-close').onclick = dismiss;
    overlay.onclick = event => { if (event.target === overlay) dismiss(); };
    document.addEventListener('keydown', keyHandler);
    document.getElementById('session-continue-later').onclick = async () => {
      dismiss();
      await handlers.continueLater();
    };
    const closePartial = document.getElementById('session-close-partial');
    if (closePartial && answeredCount) closePartial.onclick = async () => {
      dismiss();
      await handlers.closePartial();
    };
    overlay.querySelector('#session-continue-later')?.focus();
  }

  function requestCurrentSessionExit() {
    const owner = currentSessionOwner();
    if (!owner || sessionActionInProgress) return;
    const state = owner.kind === 'study' ? studyStateSnapshot() : normalizeSessionState(owner.holder.state);
    const answeredCount = answeredIdsFor(owner.row, state).length;
    showSessionExitDialog(answeredCount, {
      continueLater: owner.kind === 'study' ? continueStudyLater : continueExamLater,
      closePartial: owner.kind === 'study' ? closeStudyPartial : closeExamPartial,
    });
  }

  function cleanOptionText(value = '') {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  const PHARMACOLOGY_HINT = /\b(?:f[aá]rmaco|medicamento|antibi[oó]tico|antiviral|antif[uú]ngico|antiparasitario|antihipertensivo|antiarr[ií]tmico|anticoagulante|ant[ií]doto|toxicidad|neurotoxicidad|reacci[oó]n adversa|contraindicaci[oó]n|dosis|receptor|agonista|antagonista|inhibe|inhibidor|bloquea|mecanismo de acci[oó]n|espectro|cobertura|primera l[ií]nea|betalact[aá]mico|cefalosporina|carbapen[eé]mico|macr[oó]lido|aminogluc[oó]sido|fluoroquinolona|corticoide|insulina|heparina)\b/i;

  function pharmacologyRelevant(q = {}) {
    const options = ['a','b','c','d','e'].map(letter => cleanOptionText(q[`option_${letter}`])).filter(Boolean).join(' ');
    const text = [q.question, options, q.comparison_title, q.comparison_framework, q.correct_explanation]
      .map(cleanEditorialText).filter(Boolean).join(' ');
    return PHARMACOLOGY_HINT.test(text);
  }

  function splitReferenceSentences(value = '') {
    const text = cleanEditorialText(value);
    if (!text) return [];
    return text
      .split(/\n+|(?:[.;])\s+(?=[A-ZÁÉÍÓÚÜÑ])/)
      .map(item => item.trim().replace(/[.;]+$/, ''))
      .filter(Boolean)
      .filter((item, index, arr) => arr.findIndex(other => other.toLocaleLowerCase('es') === item.toLocaleLowerCase('es')) === index);
  }

  const PHARM_CATEGORY_RULES = [
    ['Clase', /\b(?:clase|cefalosporina|carbapen[eé]mico|betalact[aá]mico|macr[oó]lido|aminogluc[oó]sido|fluoroquinolona|antagonista|agonista|inhibidor)\b/i],
    ['Mecanismo y diana', /\b(?:mecanismo|inhibe|bloquea|activa|receptor|diana|polimerasa|subunidad|s[ií]ntesis de pared|canal|enzima)\b/i],
    ['Espectro o cobertura', /\b(?:espectro|cubre|cobertura|grampositivo|gramnegativo|pseudomonas|anaerobio|meticilina|resistencia|susceptibilidad)\b/i],
    ['Indicación', /\b(?:indicado|indicaci[oó]n|tratamiento|elecci[oó]n|preferente|se usa|utiliza|[uú]til)\b/i],
    ['Evento adverso', /\b(?:evento|tendinitis|rotura|toxicidad|t[oó]xico|advers[ao]|nefrotoxic|ototoxic|hepatotoxic|prolonga el qt|hiperpotasemia|hipopotasemia)\b/i],
    ['Factores de riesgo', /\b(?:factor(?:es)? de riesgo|riesgo mayor|aumenta el riesgo|predispone|predisponen)\b/i],
    ['Conducta', /\b(?:conducta|suspender|retirar|interrumpir|monitorizar|vigilar|evitar carga|ajustar dosis)\b/i],
    ['Contraindicación o precaución', /\b(?:contraindicado|contraindicaci[oó]n|evitar|precauci[oó]n|no usar|riesgo de)\b/i],
    ['Antídoto o reversión', /\b(?:ant[ií]doto|reversi[oó]n|revierte|neutraliza|n-acetilciste[ií]na|pralidoxima|naloxona|flumazenil)\b/i],
  ];

  function pharmacologyFrameworkHtml(value = '') {
    const sentences = splitReferenceSentences(value);
    if (!sentences.length) return '';
    const groups = new Map(PHARM_CATEGORY_RULES.map(([label]) => [label, []]));
    groups.set('Diferencias clave', []);
    for (const sentence of sentences) {
      const match = PHARM_CATEGORY_RULES.find(([, rx]) => rx.test(sentence));
      groups.get(match ? match[0] : 'Diferencias clave').push(sentence);
    }
    const cards = [...groups.entries()]
      .filter(([, items]) => items.length)
      .map(([label, items]) => `<section class="pharm-aspect"><h5>${esc(label)}</h5>${items.map(item => `<p>${esc(item)}</p>`).join('')}</section>`)
      .join('');
    return cards ? `<div class="pharm-grid">${cards}</div>` : '';
  }

  function qrv2Profile(q = {}) {
    const aspect = taxonomyKey(cleanEditorialText(q.tested_aspect_primary));
    const phase = taxonomyKey(cleanEditorialText(q.management_phase));
    const operation = taxonomyKey(cleanEditorialText(q.cognitive_operation));
    const combined = `${aspect} ${phase} ${operation}`;
    if (/diferencial|discrimina|distinguir|comparar/.test(combined)) return 'Diagnóstico diferencial';
    if (/tratamiento|manejo|conducta|terap|intervencion|profilaxis/.test(combined)) return 'Tratamiento / conducta';
    if (pharmacologyRelevant(q) || /farmac|toxicidad|reaccion adversa|interaccion/.test(combined)) return 'Farmacología';
    if (/clasificacion|estadia|estadificacion|score|escala|grado/.test(combined)) return 'Clasificación / score';
    if (/prueba|test|examen auxiliar|tamiz|screen|diagnostico por/.test(combined)) return 'Prueba diagnóstica';
    if (/etiolog|factor de riesgo|complicacion|pronostico/.test(combined)) return 'Etiología / riesgo / complicación';
    if (/fisiopat|mecanismo/.test(combined)) return 'Fisiopatología / mecanismo';
    if (/anatom|histol|embriol/.test(combined)) return 'Anatomía / histología / embriología';
    if (/prevencion|vacun|norma|salud publica/.test(combined)) return 'Prevención / normativa';
    if (/calculo|valor|desarrollo|percentil/.test(combined)) return 'Cálculo / valor / desarrollo';
    return 'Diagnóstico / reconocimiento';
  }

  function qrv2MigrationStatus(q = {}) {
    const raw = cleanEditorialText(q.qrv2_status || q.qrv2_migration_status || q.quick_reference_status).toUpperCase();
    if (raw.includes('VERIFIED')) return { code:'QRV2_VERIFIED', label:'QRV2 verificado' };
    if (raw.includes('DRAFT')) return { code:'QRV2_DRAFT', label:'QRV2 en revisión' };
    return { code:'LEGACY_ONLY', label:'Pendiente de migración QRV2' };
  }

  function referenceListHtml(value = '') {
    const items = splitReferenceSentences(value);
    if (!items.length) return '';
    if (items.length === 1) return `<p>${esc(items[0])}</p>`;
    return `<ul class="qrv2-list">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  }

  function auditSourceLinks(value = '') {
    const raw = String(value ?? '');
    const sources = new Map();
    const markdownPattern = /\[([^\]\r\n]+)\]\((https?:\/\/[^)\s<>"']+)\)/gi;
    let match;

    const addSource = (candidateUrl, label = '') => {
      try {
        const parsed = new URL(candidateUrl);
        if (!['http:','https:'].includes(parsed.protocol)) return;
        const href = parsed.href;
        const normalizedLabel = String(label || '').trim();
        const existing = sources.get(href);
        if (!existing || (!existing.label && normalizedLabel)) sources.set(href, { href, label:normalizedLabel });
      } catch { /* Ignorar referencias malformadas. */ }
    };

    while ((match = markdownPattern.exec(raw)) !== null) {
      addSource(match[2], match[1]);
    }

    markdownPattern.lastIndex = 0;
    const legacyText = raw.replace(markdownPattern, full => ' '.repeat(full.length));
    const legacyMatches = legacyText.match(/https?:\/\/[^\s<>"']+/gi) || [];
    legacyMatches.forEach(candidate => addSource(candidate.replace(/[),.;]+$/, '')));

    const items = [...sources.values()];
    return items.map((item, index) => {
      try {
        const parsed = new URL(item.href);
        const fallback = `${parsed.hostname.replace(/^www\./, '')}${items.length > 1 ? ` · ${index + 1}` : ''}`;
        return `<li><a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${esc(item.label || fallback)}</a></li>`;
      } catch { return ''; }
    }).filter(Boolean).join('');
  }

  function referenceQuickHtml(q = {}) {
    const comparison = cleanEditorialText(q.comparison_framework);
    const comparisonTitle = cleanEditorialText(q.comparison_title);
    const topic = cleanTaxonomyLabel(q.rentability_topic_label || q.topic);
    const entity = cleanTaxonomyLabel(q.canonical_entity || q.subtopic);
    const aspect = cleanEditorialText(q.tested_aspect_primary);
    const phase = cleanEditorialText(q.management_phase);
    const pivot = cleanEditorialText(q.pivot_text);
    const rule = cleanEditorialText(q.exam_logic);
    const abbreviations = cleanEditorialText(q.abbreviations);
    const sourceLinks = auditSourceLinks(q.audit_source_urls);
    const profile = qrv2Profile(q);
    const migration = qrv2MigrationStatus(q);
    const referent = comparisonTitle || entity || topic || 'Referencia rápida';

    const contextItems = [
      topic ? ['Tema', topic] : null,
      entity ? ['Entidad', entity] : null,
      aspect ? ['Aborda', aspect] : null,
      phase ? ['Fase', phase] : null,
      pivot ? ['Dato pivote', pivot] : null,
      ['Perfil', profile],
      ['Estado', migration.code],
    ].filter(Boolean);

    const nucleusItems = [];
    if (entity && taxonomyKey(entity) !== taxonomyKey(referent)) nucleusItems.push(`<li><strong>Qué es / entidad:</strong> ${esc(entity)}</li>`);
    if (pivot) nucleusItems.push(`<li><strong>Dato pivote:</strong> ${esc(pivot)}</li>`);
    if (rule) nucleusItems.push(`<li><strong>Regla decisoria:</strong> ${esc(rule)}</li>`);

    const detail = comparison
      ? (pharmacologyRelevant(q) ? pharmacologyFrameworkHtml(comparison) : referenceListHtml(comparison))
      : '';

    const hasUseful = Boolean(comparison || pivot || rule || abbreviations || sourceLinks || entity || topic);
    const statusClass = migration.code === 'QRV2_VERIFIED' ? 'verified' : migration.code === 'QRV2_DRAFT' ? 'draft' : 'legacy';
    const summary = `<summary class="qrv2-reference-summary"><div class="qrv2-title-row"><div><small class="qrv2-kicker">Referencia rápida · ${esc(profile)}</small><h4>📚 ${esc(hasUseful ? referent : 'Referencia rápida')}</h4></div><span class="qrv2-status ${esc(statusClass)}">${esc(migration.label)}</span></div></summary>`;

    if (!hasUseful) {
      return `<details class="explain-block quick-reference qrv2-reference qrv2-reference-collapsible">${summary}<div class="qrv2-reference-body"><p class="muted">No hay contenido estructurado auditado para mostrar aquí. La WebApp no sintetiza contenido clínico ausente.</p></div></details>`;
    }

    return `<details class="explain-block quick-reference qrv2-reference qrv2-reference-collapsible">
      ${summary}
      <div class="qrv2-reference-body">
        <div class="qrv2-context">${contextItems.map(([label,value]) => `<span><strong>${esc(label)}:</strong> ${esc(value)}</span>`).join('')}</div>
        <section class="qrv2-layer qrv2-nucleus"><h5>Núcleo rápido</h5>${nucleusItems.length ? `<ul class="qrv2-list">${nucleusItems.join('')}</ul>` : '<p class="muted">Núcleo estructurado pendiente de migración; se conserva el contenido existente sin inventar datos.</p>'}</section>
        <section class="qrv2-layer qrv2-detail"><h5>Detalle útil</h5>${detail || '<p class="muted">Detalle estructurado pendiente de migración QRV2.</p>'}</section>
        ${abbreviations ? `<section class="qrv2-layer qrv2-glossary"><h5>🔤 Siglas, epónimos y términos</h5>${referenceListHtml(abbreviations)}</section>` : ''}
        ${sourceLinks ? `<details class="qrv2-collapsible"><summary><strong>Fuentes y trazabilidad</strong><span>auditoría</span></summary><div class="qrv2-collapsible-body"><ul class="qrv2-source-list">${sourceLinks}</ul></div></details>` : ''}
      </div>
    </details>`;
  }

  function auditEditorialHtml(q = {}) {
    const assessment = cleanEditorialText(q.audit_current_assessment || q.update_alert);
    const currentAnswer = cleanEditorialText(q.audit_current_answer);
    if (observed(q)) {
      return `<div class="explain-block audit-box"><h4>⚠ Auditoría médica</h4><p><strong>Pregunta histórica observada: se conserva la clave oficial, pero no cuenta en dominio por defecto.</strong></p>${assessment ? `<p>${esc(assessment)}</p>` : ''}${currentAnswer ? `<p><strong>Criterio actual:</strong> ${esc(currentAnswer)}</p>` : ''}</div>`;
    }
    if (caveat(q) && assessment) return `<div class="explain-block"><h4>⚠ Precisión clínica</h4><p>${esc(assessment)}</p></div>`;
    return '';
  }

  function questionMediaHtml(q, className = 'question-media') {
    const src = String(q?.image_url || '').trim();
    if (!src) return '';
    const alt = String(q?.image_alt || 'Imagen clínica asociada a la pregunta').trim();
    const caption = String(q?.image_caption || '').trim();
    return `<figure class="${esc(className)}">
      <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">
      ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}
    </figure>`;
  }

  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const localeSort = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity:'base' });

  // Capa defensiva de taxonomía. La base está normalizada, pero la app evita
  // volver a mostrar etiquetas antiguas o valores numéricos si una importación
  // futura llega con datos inconsistentes.
  const NUMERIC_TAXONOMY_LABEL = /^[\s]*[0-9]+(?:[.,][0-9]+)?[\s]*$/;
  const taxonomyKey = (value = '') => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const CANONICAL_AREA_BY_KEY = new Map([
    ['ciencias basicas', 'Ciencias Básicas'],
    ['cirugia', 'Cirugía'],
    ['gineco obstetricia', 'Ginecología y Obstetricia'],
    ['ginecologia y obstetricia', 'Ginecología y Obstetricia'],
    ['obstetricia y ginecologia', 'Ginecología y Obstetricia'],
    ['medicina', 'Medicina Interna'],
    ['medicina interna', 'Medicina Interna'],
    ['psiquiatria', 'Medicina Interna'],
    ['pediatria', 'Pediatría'],
    ['salud publica', 'Salud Pública'],
  ]);

  function cleanTaxonomyLabel(value = '') {
    const label = String(value ?? '').trim();
    if (!label || NUMERIC_TAXONOMY_LABEL.test(label)) return '';
    return label;
  }

  function canonicalArea(value = '') {
    const label = cleanTaxonomyLabel(value);
    return CANONICAL_AREA_BY_KEY.get(taxonomyKey(label)) || label || 'Sin área';
  }

  function normalizedTaxonomyParts(q) {
    // Taxonomía canónica: usa los campos primarios versionados cuando están disponibles
    // y conserva compatibilidad automática con la estructura histórica.
    const area = canonicalArea(q?.canonical_area || q?.area);
    const specialty = cleanTaxonomyLabel(q?.canonical_specialty || q?.specialty) || 'General';
    const entity = cleanTaxonomyLabel(q?.canonical_entity || q?.subtopic);
    const topic = cleanTaxonomyLabel(q?.rentability_topic_label || q?.topic) || entity || 'Sin tema clasificado';
    const subtopic = entity || cleanTaxonomyLabel(q?.subtopic);
    return { area, specialty, topic, subtopic };
  }

  function normalizeQuestionTaxonomy(q) {
    const { area, specialty, topic, subtopic } = normalizedTaxonomyParts(q);
    return {
      ...q,
      area,
      specialty,
      topic,
      subtopic: subtopic || q?.subtopic || null,
      taxonomy_runtime_source: q?.rentability_topic_label ? 'CANONICAL_RENTABILITY_TOPIC' : 'LEGACY_FALLBACK',
    };
  }

  function taxonomyEntityTag(q) {
    const entity = cleanTaxonomyLabel(q?.canonical_entity || q?.subtopic);
    const topic = cleanTaxonomyLabel(q?.rentability_topic_label || q?.topic);
    if (!entity || taxonomyKey(entity) === taxonomyKey(topic)) return '';
    return `<span class="tag">${esc(entity)}</span>`;
  }


  function studyQuestionMetadataTags(q) {
    return `${questionSourceTag(q)}<span class="tag">${esc(q.area)}</span><span class="tag">${esc(q.topic)}</span>${taxonomyEntityTag(q)}${auditBadge(q)}`;
  }

  function revealStudyQuestionMetadata(q) {
    const metadata = document.getElementById('study-question-metadata');
    if (!metadata) return;
    metadata.innerHTML = studyQuestionMetadataTags(q);
    metadata.hidden = false;
    metadata.setAttribute('aria-hidden', 'false');
  }

  function normalizeQuestionCorpus(list = []) {
    return (list || []).map(normalizeQuestionTaxonomy);
  }

  function topicPathParts(q) {
    const { area, specialty, topic } = normalizedTaxonomyParts(q);
    return { area, specialty, topic };
  }

  function topicPathKey(q) {
    // Taxonomía V3: nunca usar el label visible como identidad si existe un ID estable.
    const stableId = cleanTaxonomyLabel(q?.rentability_topic_id || q?.topic_id);
    if (stableId) return `TOPIC_ID:${encodeURIComponent(stableId)}`;
    const { area, specialty, topic } = topicPathParts(q);
    return `LEGACY_PATH:${encodeURIComponent([area, specialty, topic].join('\u001f'))}`;
  }

  function aliasReplacementIds(row = {}) {
    const raw = row?.replacement_topic_ids;
    if (Array.isArray(raw)) return raw.map(String).map(x => x.trim()).filter(Boolean);
    if (raw == null) return [];
    const text = String(raw).trim();
    if (!text) return [];
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.map(String).map(x => x.trim()).filter(Boolean);
      } catch {}
    }
    return text.split(/\s*\|\s*|\s*,\s*/).map(x => x.trim()).filter(Boolean);
  }

  function resolveTopicSelectionKey(selectionKey = '') {
    const rawKey = String(selectionKey || '');
    if (!rawKey) return { kind:'empty', topicIds:[], legacyLabel:null };
    if (rawKey.startsWith('TOPIC_ID:')) {
      const sourceId = decodeURIComponent(rawKey.slice('TOPIC_ID:'.length));
      const alias = topicAliasBySourceId.get(sourceId);
      const replacements = aliasReplacementIds(alias);
      const canonical = String(alias?.canonical_topic_id || '').trim();
      return { kind:'id', sourceId, topicIds:[canonical, ...replacements, sourceId].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i), legacyLabel:null };
    }
    const encodedPath = rawKey.startsWith('LEGACY_PATH:') ? rawKey.slice('LEGACY_PATH:'.length) : rawKey;
    try {
      const decoded = decodeURIComponent(encodedPath);
      const parts = decoded.split('\u001f');
      const legacyLabel = cleanTaxonomyLabel(parts[parts.length - 1] || '');
      const aliases = topicAliasesBySourceLabel.get(normalizeTopicSearch(legacyLabel)) || [];
      const topicIds = aliases.flatMap(alias => [String(alias?.canonical_topic_id || '').trim(), ...aliasReplacementIds(alias)]).filter(Boolean);
      return { kind:'legacy', topicIds:[...new Set(topicIds)], legacyLabel };
    } catch {
      return { kind:'legacy', topicIds:[], legacyLabel:null };
    }
  }

  function topicSelectionMatches(q, selectedKeys = []) {
    if (!selectedKeys?.length) return true;
    const currentId = cleanTaxonomyLabel(q?.rentability_topic_id || q?.topic_id);
    const currentStableKey = topicPathKey(q);
    if (selectedKeys.includes(currentStableKey)) return true;
    // Compatibility with v1.3.x builder configs, which stored the encoded visible path.
    const { area, specialty, topic } = topicPathParts(q);
    const currentLegacyKey = encodeURIComponent([area, specialty, topic].join('\u001f'));
    if (selectedKeys.includes(currentLegacyKey) || selectedKeys.includes(`LEGACY_PATH:${currentLegacyKey}`)) return true;
    for (const key of selectedKeys) {
      const resolved = resolveTopicSelectionKey(key);
      if (currentId && resolved.topicIds.includes(currentId)) return true;
      if (!currentId && resolved.legacyLabel && normalizeTopicSearch(topic) === normalizeTopicSearch(resolved.legacyLabel)) return true;
    }
    return false;
  }

  function normalizeTopicSearch(value = '') {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function buildTopicHierarchy() {
    const areas = new Map();

    for (const q of questions) {
      const { area, specialty, topic } = topicPathParts(q);
      if (!areas.has(area)) areas.set(area, { name:area, count:0, specialties:new Map() });
      const areaNode = areas.get(area);
      areaNode.count += 1;

      if (!areaNode.specialties.has(specialty)) {
        areaNode.specialties.set(specialty, { name:specialty, count:0, topics:new Map() });
      }
      const specialtyNode = areaNode.specialties.get(specialty);
      specialtyNode.count += 1;

      const key = topicPathKey(q);
      if (!specialtyNode.topics.has(key)) specialtyNode.topics.set(key, { key, name:topic, count:0 });
      specialtyNode.topics.get(key).count += 1;
    }

    return [...areas.values()]
      .sort((a,b) => localeSort(a.name, b.name))
      .map(area => ({
        ...area,
        specialties:[...area.specialties.values()]
          .sort((a,b) => localeSort(a.name, b.name))
          .map(specialty => ({
            ...specialty,
            topics:[...specialty.topics.values()].sort((a,b) => localeSort(a.name, b.name)),
          })),
      }));
  }

  function topicHierarchyHtml(hierarchy) {
    return hierarchy.map((area, areaIndex) => {
      const areaId = `topic-area-${areaIndex}`;
      const areaTopicCount = area.specialties.reduce((sum, sp) => sum + sp.topics.length, 0);
      const specialtiesHtml = area.specialties.map((specialty, specialtyIndex) => {
        const specialtyId = `${areaId}-specialty-${specialtyIndex}`;
        const topicsHtml = specialty.topics.map(topic => {
          const searchText = normalizeTopicSearch(`${area.name} ${specialty.name} ${topic.name}`);
          return `<label class="topic-leaf" data-topic-search="${esc(searchText)}">
            <input type="checkbox" name="topicPath" value="${esc(topic.key)}" data-topic-area-id="${areaId}" data-topic-specialty-id="${specialtyId}" checked>
            <span class="topic-leaf-copy"><strong>${esc(topic.name)}</strong><small>${topic.count} pregunta${topic.count === 1 ? '' : 's'}</small></span>
          </label>`;
        }).join('');

        return `<details class="topic-specialty-group" data-topic-specialty-wrap="${specialtyId}">
          <summary><span>${esc(specialty.name)}</span><small>${specialty.topics.length} tema${specialty.topics.length === 1 ? '' : 's'} · ${specialty.count} pregunta${specialty.count === 1 ? '' : 's'}</small></summary>
          <div class="topic-group-actions">
            <button type="button" class="topic-scope-btn" data-topic-select-specialty="${specialtyId}">Todos</button>
            <button type="button" class="topic-scope-btn" data-topic-clear-specialty="${specialtyId}">Ninguno</button>
          </div>
          <div class="topic-leaf-list">${topicsHtml}</div>
        </details>`;
      }).join('');

      return `<details class="topic-area-group" data-topic-area-wrap="${areaId}">
        <summary><span>${esc(area.name)}</span><small>${areaTopicCount} tema${areaTopicCount === 1 ? '' : 's'} · ${area.count} pregunta${area.count === 1 ? '' : 's'}</small></summary>
        <div class="topic-group-actions">
          <button type="button" class="topic-scope-btn" data-topic-select-area="${areaId}">Todos</button>
          <button type="button" class="topic-scope-btn" data-topic-clear-area="${areaId}">Ninguno</button>
        </div>
        <div class="topic-specialty-list">${specialtiesHtml}</div>
      </details>`;
    }).join('');
  }

  const OPTION_REFERENCE_PATTERNS = [
    /\b(?:todas?|ninguna?)\s+(?:de\s+)?(?:las\s+)?(?:anteriores|opciones|alternativas)\b/i,
    /\b(?:opci[oó]n|alternativa)\s+[A-E]\b/i,
    /\b[A-E]\s*(?:y|e|\/|\+)\s*[A-E]\b/i,
  ];

  function optionOrderMustStayCanonical(q) {
    return optionList(q).some(o => OPTION_REFERENCE_PATTERNS.some(rx => rx.test(String(o.text || ''))));
  }

  function buildOptionOrder(q, shouldShuffle = true) {
    const letters = optionList(q).map(o => o.letter);
    return shouldShuffle && !optionOrderMustStayCanonical(q) ? shuffle(letters) : letters;
  }

  function createOptionOrders(list, shouldShuffle = true) {
    if (!shouldShuffle) return {};
    return Object.fromEntries((list || []).map(q => [q.id, buildOptionOrder(q, true)]));
  }

  function displayOptionList(q, orderStore = null, shouldShuffle = true) {
    const canonical = optionList(q);
    if (!shouldShuffle) return canonical.map(o => ({ ...o, sourceLetter: o.letter }));

    const byLetter = new Map(canonical.map(o => [o.letter, o]));
    if (orderStore && !Array.isArray(orderStore[q.id])) {
      orderStore[q.id] = buildOptionOrder(q, true);
    }
    const order = Array.isArray(orderStore?.[q.id])
      ? orderStore[q.id].filter(letter => byLetter.has(letter))
      : buildOptionOrder(q, true);

    const missing = canonical.map(o => o.letter).filter(letter => !order.includes(letter));
    const completeOrder = [...order, ...missing];

    return completeOrder.map((sourceLetter, index) => ({
      letter: String.fromCharCode(65 + index),
      sourceLetter,
      text: byLetter.get(sourceLetter)?.text || '',
    }));
  }

  const pct = (n, d) => d ? `${Math.round((n / d) * 100)}%` : '—';
  const formatTime = seconds => {
    const s = Math.max(0, Math.round(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function scrollPageTop() {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  }

  function localAttempts() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); }
    catch { return []; }
  }
  function saveLocalAttempts() { localStorage.setItem(DEMO_KEY, JSON.stringify(attempts)); }
  function localSessions() {
    try { return JSON.parse(localStorage.getItem(DEMO_SESSIONS_KEY) || '[]'); }
    catch { return []; }
  }
  function saveLocalSessions() { localStorage.setItem(DEMO_SESSIONS_KEY, JSON.stringify([...activeSessions, ...completedSessions])); }


  const DEFAULT_PROFILE = {
    score_goal: 75,
    max_exam_score: 80,
    target_response_seconds: 25,
    exam_date: '2026-09-06',
    readiness_target_date: '2026-08-23',
    plan_start_date: '2026-07-14',
    pressure_mode: 'demanding',
    auto_plan: true,
    travel_periods: [
      { start: '2026-07-25', end: '2026-07-29', mode: 'intensive_review', label: 'Viaje 1 · repaso intensivo' },
      { start: '2026-08-08', end: '2026-08-15', mode: 'maintenance', label: 'Viaje 2 · mantenimiento' },
    ],
  };

  const PHASES = [
    { start:'2026-07-14', end:'2026-07-24', key:'expansion', name:'Expansión intensa', target:180, minimum:120, aggressive:240, objective:'Construir cobertura y generar la primera ola de repasos.' },
    { start:'2026-07-25', end:'2026-07-29', key:'travel_review', name:'Viaje 1 · repaso intensivo', target:120, minimum:80, aggressive:180, objective:'Proteger memoria: vencidas, errores, lentas y alta prioridad.' },
    { start:'2026-07-30', end:'2026-08-07', key:'max_expansion', name:'Expansión máxima', target:220, minimum:150, aggressive:300, objective:'Aumentar cobertura con alto volumen sin abandonar repasos.' },
    { start:'2026-08-08', end:'2026-08-15', key:'travel_maintenance', name:'Viaje 2 · mantenimiento', target:100, minimum:60, aggressive:150, objective:'Mantener retención y velocidad; reducir contenido nuevo si falta tiempo.' },
    { start:'2026-08-16', end:'2026-08-23', key:'close_gaps', name:'Cierre de brechas', target:220, minimum:150, aggressive:280, objective:'Cerrar temas rentables débiles y errores persistentes.' },
    { start:'2026-08-24', end:'2026-09-05', key:'preexam', name:'Preexamen', target:160, minimum:100, aggressive:220, objective:'Simulacros, velocidad, repaso espaciado y mantenimiento.' },
    { start:'2026-09-06', end:'2026-09-06', key:'exam', name:'Día del examen', target:0, minimum:0, aggressive:0, objective:'Ejecutar. No aprender temas grandes nuevos.' },
  ];

  function localMemory() {
    try { return JSON.parse(localStorage.getItem(DEMO_MEMORY_KEY) || '[]'); }
    catch { return []; }
  }
  function saveLocalMemory() { localStorage.setItem(DEMO_MEMORY_KEY, JSON.stringify(memoryStates)); }
  function localProfile() {
    try { return { ...DEFAULT_PROFILE, ...(JSON.parse(localStorage.getItem(DEMO_PROFILE_KEY) || '{}')) }; }
    catch { return { ...DEFAULT_PROFILE }; }
  }
  function saveLocalProfile() { localStorage.setItem(DEMO_PROFILE_KEY, JSON.stringify(profile)); }
  function localReviewFlags() {
    try { return JSON.parse(localStorage.getItem(DEMO_REVIEW_FLAGS_KEY) || '[]'); }
    catch { return []; }
  }
  function saveLocalReviewFlags() { localStorage.setItem(DEMO_REVIEW_FLAGS_KEY, JSON.stringify(reviewFlagHistory)); }
  function localLearningNotes() {
    try { return JSON.parse(localStorage.getItem(DEMO_LEARNING_NOTES_KEY) || '[]'); }
    catch { return []; }
  }
  function saveLocalLearningNotes() { localStorage.setItem(DEMO_LEARNING_NOTES_KEY, JSON.stringify(learningNoteHistory)); }

  const LEARNING_NOTE_TYPES = {
    general: { label:'Duda o vacío de conocimiento', icon:'🗒' },
    drug: { label:'Fármaco o mecanismo', icon:'💊' },
    cutoff: { label:'Valor normal, dosis o punto de corte', icon:'📏' },
    differential: { label:'Diagnóstico diferencial', icon:'🔀' },
    explanation: { label:'No entendí la explicación', icon:'💬' },
    other: { label:'Otro dato para recordar', icon:'🧩' },
  };

  const LEARNING_NOTE_OUTCOMES = {
    CREATE_NEW_CARD: 'Se creó una tarjeta nueva',
    UPDATE_EXISTING_CARD: 'Se actualizó una tarjeta existente',
    REEXPOSE_EXISTING_CARD: 'Se reexpuso una tarjeta existente con prioridad inmediata',
    // Valores históricos preservados para poder leer cierres previos. No se ofrecen para nuevos cierres.
    ALREADY_COVERED: 'Histórico: ya estaba cubierto en Anki',
    RESOLVED_WITHOUT_ANKI: 'Histórico: resuelta sin tarjeta',
  };
  const ACTIVE_LEARNING_NOTE_OUTCOMES = ['CREATE_NEW_CARD','UPDATE_EXISTING_CARD','REEXPOSE_EXISTING_CARD'];

  const REVIEW_LEARNING_SCOPES = {
    CONTENT: { label:'Contenido clínico', icon:'🧠', ankiRequired:false },
    EDITORIAL_TECHNICAL: { label:'Editorial / técnico', icon:'🛠', ankiRequired:false },
    UNCLASSIFIED: { label:'Sin clasificar', icon:'•', ankiRequired:false },
  };

  const REVIEW_FLAG_TYPES = {
    statement: { label:'Revisar enunciado', icon:'📝' },
    explanation: { label:'Revisar explicación', icon:'💬' },
    general: { label:'Revisar', icon:'⚑' },
  };

  function reviewFlagMeta(type) {
    return REVIEW_FLAG_TYPES[type] || REVIEW_FLAG_TYPES.general;
  }


  function learningNoteMeta(type) {
    return LEARNING_NOTE_TYPES[type] || LEARNING_NOTE_TYPES.general;
  }

  function learningNoteStatus(row = {}) {
    const status = String(row.status || 'OPEN').toUpperCase();
    return ['OPEN','RESOLVED','DISMISSED'].includes(status) ? status : 'OPEN';
  }

  function activeLearningNoteRows(rows = []) {
    return (rows || []).filter(row => learningNoteStatus(row) === 'OPEN');
  }

  function rebuildLearningNoteMap() {
    learningNotes = activeLearningNoteRows(learningNoteHistory.length ? learningNoteHistory : learningNotes)
      .sort((a,b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    learningNoteByQuestion = new Map(learningNotes.map(row => [row.question_id, row]));
  }

  function learningNoteFor(questionId) {
    return learningNoteByQuestion.get(questionId) || null;
  }

  function latestClosedLearningNoteFor(questionId) {
    return learningNoteHistory
      .filter(row => row.question_id === questionId && learningNoteStatus(row) !== 'OPEN')
      .sort((a,b) => new Date(b.resolved_at || b.updated_at || 0) - new Date(a.resolved_at || a.updated_at || 0))[0] || null;
  }

  function mergeLearningNoteHistoryRow(row) {
    const byId = new Map(learningNoteHistory.map(item => [item.id, item]));
    byId.set(row.id, row);
    learningNoteHistory = [...byId.values()]
      .sort((a,b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    rebuildLearningNoteMap();
    if (!cloudConfigured) saveLocalLearningNotes();
  }

  function learningNoteButton(q) {
    const existing = learningNoteFor(q?.id);
    const meta = existing ? learningNoteMeta(existing.note_type) : null;
    return `<button class="btn small ghost learning-note-btn ${existing?'active':''}" type="button" data-question-learning-note="${esc(q?.id || '')}" aria-haspopup="dialog">${existing ? `${meta.icon} Editar nota` : '🗒 Añadir nota'}</button>`;
  }

  function refreshLearningNoteButtons(questionId) {
    const existing = learningNoteFor(questionId);
    const meta = existing ? learningNoteMeta(existing.note_type) : null;
    document.querySelectorAll('[data-question-learning-note]').forEach(btn => {
      if (btn.dataset.questionLearningNote !== questionId) return;
      btn.classList.toggle('active', Boolean(existing));
      btn.textContent = existing ? `${meta.icon} Editar nota` : '🗒 Añadir nota';
    });
    document.querySelectorAll('[data-learning-notes-count]').forEach(node => {
      node.textContent = String(learningNotes.length);
    });
  }

  function learningNotesUnavailableMessage() {
    return `La función de notas requiere ejecutar ${LEARNING_NOTES_MIGRATION} en Supabase.${learningNotesLoadError ? `\n\nDetalle: ${learningNotesLoadError}` : ''}`;
  }

  async function saveQuestionLearningNote(questionId, noteType, noteText = '') {
    const text = String(noteText ?? '').replace(/\r/g, '').trim().slice(0, 6000);
    if (!text) return null;
    if (!LEARNING_NOTE_TYPES[noteType]) noteType = 'general';
    if (cloudConfigured && !learningNotesAvailable) {
      alert(learningNotesUnavailableMessage());
      return null;
    }
    const now = new Date().toISOString();
    const previous = learningNoteFor(questionId);
    const previousClosed = latestClosedLearningNoteFor(questionId);
    let row = null;
    if (cloudConfigured) {
      if (previous) {
        const { data, error } = await supa.from('question_learning_notes')
          .update({ note_type:noteType, note_text:text, client_app_version:APP_VERSION, status:'OPEN', updated_at:now })
          .eq('id', previous.id)
          .eq('user_id', user.id)
          .select('*')
          .single();
        if (error) { alert(`No se pudo actualizar la nota: ${error.message}`); return null; }
        row = data;
      } else {
        const payload = {
          user_id:user.id,
          question_id:questionId,
          note_type:noteType,
          note_text:text,
          client_app_version:APP_VERSION,
          status:'OPEN',
          content_revision:questionContentRevision(questionId),
          previous_note_id:previousClosed?.id || null,
          updated_at:now,
        };
        const { data, error } = await supa.from('question_learning_notes')
          .insert(payload)
          .select('*')
          .single();
        if (error) { alert(`No se pudo guardar la nota: ${error.message}`); return null; }
        row = data;
      }
    } else {
      row = previous ? {
        ...previous, note_type:noteType, note_text:text, client_app_version:APP_VERSION, status:'OPEN', updated_at:now,
      } : {
        id:makeUuid(), user_id:'demo', question_id:questionId, note_type:noteType, note_text:text,
        client_app_version:APP_VERSION, status:'OPEN', content_revision:questionContentRevision(questionId),
        previous_note_id:previousClosed?.id || null, created_at:now, updated_at:now,
      };
    }
    mergeLearningNoteHistoryRow(row);
    refreshLearningNoteButtons(questionId);
    return row;
  }

  async function closeQuestionLearningNote(questionId, status, details = {}) {
    const existing = learningNoteFor(questionId);
    if (!existing) return false;
    if (cloudConfigured && !learningNotesAvailable) { alert(learningNotesUnavailableMessage()); return false; }
    const now = new Date().toISOString();
    const normalizedStatus = status === 'RESOLVED' ? 'RESOLVED' : 'DISMISSED';
    const outcome = normalizedStatus === 'RESOLVED' && ACTIVE_LEARNING_NOTE_OUTCOMES.includes(details.ankiAction)
      ? details.ankiAction : null;
    if (normalizedStatus === 'RESOLVED' && !outcome) {
      alert('Toda nota conceptual debe cerrarse con una intervención Anki: crear, actualizar o reexponer una tarjeta.');
      return false;
    }
    const summary = cleanEditorialText(details.summary) || (normalizedStatus === 'RESOLVED'
      ? 'Duda resuelta y revisada para su cobertura en Anki.'
      : 'Nota retirada por el usuario.');
    const changes = {
      status:normalizedStatus,
      resolved_at:now,
      resolved_by_batch_id:normalizedStatus === 'RESOLVED' ? (cleanEditorialText(details.batchId) || null) : null,
      resolution_summary:summary,
      anki_action:outcome,
      anki_guid:normalizedStatus === 'RESOLVED' ? (cleanEditorialText(details.ankiGuid) || null) : null,
      anki_deck:normalizedStatus === 'RESOLVED' ? (cleanEditorialText(details.ankiDeck) || null) : null,
      updated_at:now,
    };
    let row = null;
    if (cloudConfigured) {
      const { data, error } = await supa.from('question_learning_notes')
        .update(changes).eq('id', existing.id).eq('user_id', user.id).select('*').single();
      if (error) { alert(`No se pudo cerrar la nota: ${error.message}`); return false; }
      row = data;
    } else row = { ...existing, ...changes };
    mergeLearningNoteHistoryRow(row);
    refreshLearningNoteButtons(questionId);
    return true;
  }

  function closeLearningNoteDialog() {
    const modal = document.getElementById('question-learning-note-modal');
    if (!modal) return;
    if (modal._escapeHandler) document.removeEventListener('keydown', modal._escapeHandler);
    modal.remove();
  }

  function showLearningNoteDialog(questionId, afterSave = null) {
    closeLearningNoteDialog();
    const q = questions.find(item => item.id === questionId);
    if (!q) return;
    if (cloudConfigured && !learningNotesAvailable) { alert(learningNotesUnavailableMessage()); return; }
    const existing = learningNoteFor(questionId);
    const modal = document.createElement('div');
    modal.id = 'question-learning-note-modal';
    modal.className = 'review-flag-modal';
    modal.innerHTML = `<div class="review-flag-dialog learning-note-dialog" role="dialog" aria-modal="true" aria-labelledby="learning-note-title">
      <div class="review-flag-dialog-head"><div><h2 id="learning-note-title">🗒 Nota de aprendizaje</h2><p class="muted">Registra lo que no entiendes o no recuerdas. No marca la pregunta como defectuosa ni modifica tu resultado.</p></div><button class="btn small ghost" type="button" data-learning-note-close>✕</button></div>
      <div class="learning-note-question"><strong>${esc(questionSourceLabel(q))}</strong><p>${esc(q.question)}</p></div>
      <label class="learning-note-label">Tipo de duda<select id="learning-note-type" class="input">${Object.entries(LEARNING_NOTE_TYPES).map(([key,meta]) => `<option value="${key}" ${(existing?.note_type || 'general')===key?'selected':''}>${meta.icon} ${esc(meta.label)}</option>`).join('')}</select></label>
      <label class="learning-note-label">¿Qué necesitas aclarar o recordar?<textarea id="learning-note-text" class="input review-flag-note" maxlength="6000" placeholder="Ejemplo: No sé qué es letrozol ni en qué se diferencia del citrato de clomifeno.">${esc(existing?.note_text || '')}</textarea></label>
      <div id="learning-note-save-status" class="error-msg" aria-live="polite"></div>
      <div class="dialog-actions"><button class="btn ghost" type="button" data-learning-note-close>Cancelar</button>${existing?'<button id="learning-note-dismiss" class="btn danger ghost-danger" type="button">Quitar nota</button>':''}<button id="learning-note-save" class="btn primary" type="button">Guardar nota</button></div>
    </div>`;
    document.body.appendChild(modal);
    const close = () => closeLearningNoteDialog();
    modal.querySelectorAll('[data-learning-note-close]').forEach(btn => btn.onclick = close);
    modal.onclick = ev => { if (ev.target === modal) close(); };
    modal._escapeHandler = ev => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', modal._escapeHandler);
    document.getElementById('learning-note-save').onclick = async () => {
      const typeNode = document.getElementById('learning-note-type');
      const textNode = document.getElementById('learning-note-text');
      const statusNode = document.getElementById('learning-note-save-status');
      const text = String(textNode?.value || '').trim();
      if (!text) {
        statusNode.textContent = 'Escribe la duda o el dato que necesitas recordar.';
        textNode?.focus();
        return;
      }
      statusNode.textContent = 'Guardando…';
      modal.querySelectorAll('button, textarea, select').forEach(node => node.disabled = true);
      const saved = await saveQuestionLearningNote(questionId, typeNode.value, text);
      if (!saved) {
        statusNode.textContent = 'No se pudo guardar. Revisa la conexión o la migración e inténtalo otra vez.';
        modal.querySelectorAll('button, textarea, select').forEach(node => node.disabled = false);
        return;
      }
      close();
      if (typeof afterSave === 'function') afterSave();
    };
    const dismiss = document.getElementById('learning-note-dismiss');
    if (dismiss) dismiss.onclick = async () => {
      if (!confirm('¿Quitar esta nota? Quedará registrada como descartada en el historial.')) return;
      if (await closeQuestionLearningNote(questionId, 'DISMISSED')) { close(); if (typeof afterSave === 'function') afterSave(); }
    };
    document.getElementById('learning-note-text').focus();
  }

  function bindLearningNoteButtons(root = document) {
    root.querySelectorAll('[data-question-learning-note]').forEach(btn => {
      btn.onclick = () => showLearningNoteDialog(btn.dataset.questionLearningNote);
    });
  }

  function reviewFlagStatus(row = {}) {
    return String(row.status || 'OPEN').toUpperCase();
  }

  function activeReviewFlagRows(rows = []) {
    return (rows || []).filter(row => reviewFlagStatus(row) === 'OPEN');
  }

  function rebuildReviewFlagMap() {
    reviewFlags = activeReviewFlagRows(reviewFlagHistory.length ? reviewFlagHistory : reviewFlags)
      .sort((a,b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    reviewFlagByQuestion = new Map(reviewFlags.map(row => [row.question_id, row]));
  }

  function reviewFlagFor(questionId) {
    return reviewFlagByQuestion.get(questionId) || null;
  }

  function mergeReviewFlagHistoryRow(row) {
    const byId = new Map(reviewFlagHistory.map(item => [item.id, item]));
    byId.set(row.id, row);
    reviewFlagHistory = [...byId.values()]
      .sort((a,b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    rebuildReviewFlagMap();
    if (!cloudConfigured) saveLocalReviewFlags();
  }

  function latestClosedFlagFor(questionId) {
    return reviewFlagHistory
      .filter(row => row.question_id === questionId && reviewFlagStatus(row) !== 'OPEN')
      .sort((a,b) => new Date(b.resolved_at || b.updated_at || 0) - new Date(a.resolved_at || a.updated_at || 0))[0] || null;
  }

  function questionContentRevision(questionId) {
    const q = questions.find(item => item.id === questionId) || {};
    return cleanEditorialText(q.content_snapshot_version || q.record_version || q.app_reference_version) || APP_VERSION;
  }

  function reviewFlagButton(q) {
    const existing = reviewFlagFor(q?.id);
    const meta = existing ? reviewFlagMeta(existing.flag_type) : null;
    return `<button class="btn small ghost content-review-flag-btn ${existing?'active':''}" type="button" data-question-review-flag="${esc(q?.id || '')}" aria-haspopup="dialog">${existing ? `${meta.icon} ${esc(meta.label)}` : '⚐ Marcar para revisar'}</button>`;
  }

  function refreshReviewFlagButtons(questionId) {
    const existing = reviewFlagFor(questionId);
    const meta = existing ? reviewFlagMeta(existing.flag_type) : null;
    document.querySelectorAll('[data-question-review-flag]').forEach(btn => {
      if (btn.dataset.questionReviewFlag !== questionId) return;
      btn.classList.toggle('active', Boolean(existing));
      btn.textContent = existing ? `${meta.icon} ${meta.label}` : '⚐ Marcar para revisar';
    });
    document.querySelectorAll('[data-review-flags-count]').forEach(node => {
      node.textContent = String(reviewFlags.length);
    });
  }

  function reviewLearningScopeMeta(scope) {
    return REVIEW_LEARNING_SCOPES[scope] || REVIEW_LEARNING_SCOPES.UNCLASSIFIED;
  }

  function reviewLearningScopeUnavailableMessage() {
    return `La clasificación Contenido/Editorial requiere ejecutar ${REVIEW_LEARNING_SCOPE_MIGRATION} en Supabase.${reviewLearningScopeLoadError ? `\n\nDetalle: ${reviewLearningScopeLoadError}` : ''}`;
  }

  async function probeReviewLearningScopeAvailability() {
    if (!cloudConfigured) {
      reviewLearningScopeAvailable = true;
      reviewLearningScopeLoadError = '';
      return true;
    }
    const { error } = await supa.from('question_review_flags').select('learning_scope').limit(1);
    reviewLearningScopeAvailable = !error;
    reviewLearningScopeLoadError = error?.message || '';
    return reviewLearningScopeAvailable;
  }

  async function saveQuestionReviewFlag(questionId, flagType, userNote = '', learningScope = 'CONTENT') {
    if (!REVIEW_FLAG_TYPES[flagType]) return null;
    if (!REVIEW_LEARNING_SCOPES[learningScope]) learningScope = 'CONTENT';
    if (cloudConfigured && !reviewLearningScopeAvailable) {
      alert(reviewLearningScopeUnavailableMessage());
      return null;
    }
    const now = new Date().toISOString();
    const note = String(userNote ?? '').replace(/\r/g, '').trim().slice(0, 2000) || null;
    const previous = reviewFlagFor(questionId);
    const previousClosed = latestClosedFlagFor(questionId);
    let row = null;

    if (cloudConfigured) {
      if (previous) {
        const { data, error } = await supa.from('question_review_flags')
          .update({ flag_type:flagType, user_note:note, learning_scope:learningScope, client_app_version:APP_VERSION, status:'OPEN', updated_at:now })
          .eq('id', previous.id)
          .eq('user_id', user.id)
          .select('*')
          .single();
        if (error) {
          alert(`No se pudo actualizar el flag de revisión: ${error.message}`);
          return null;
        }
        row = data;
      } else {
        const payload = {
          user_id:user.id,
          question_id:questionId,
          flag_type:flagType,
          user_note:note,
          learning_scope:learningScope,
          client_app_version:APP_VERSION,
          status:'OPEN',
          content_revision:questionContentRevision(questionId),
          previous_flag_id:previousClosed?.id || null,
          updated_at:now,
        };
        const { data, error } = await supa.from('question_review_flags')
          .insert(payload)
          .select('*')
          .single();
        if (error) {
          alert(`No se pudo guardar el flag de revisión: ${error.message}`);
          return null;
        }
        row = data;
      }
    } else {
      row = previous ? {
        ...previous,
        flag_type:flagType,
        user_note:note,
        learning_scope:learningScope,
        client_app_version:APP_VERSION,
        status:'OPEN',
        updated_at:now,
      } : {
        id: makeUuid(),
        user_id: 'demo',
        question_id: questionId,
        flag_type: flagType,
        user_note:note,
        learning_scope:learningScope,
        client_app_version:APP_VERSION,
        status:'OPEN',
        content_revision:questionContentRevision(questionId),
        previous_flag_id:previousClosed?.id || null,
        created_at: now,
        updated_at: now,
      };
    }

    mergeReviewFlagHistoryRow(row);
    refreshReviewFlagButtons(questionId);
    return row;
  }

  async function closeQuestionReviewFlag(questionId, status, details = {}) {
    const existing = reviewFlagFor(questionId);
    if (!existing) return false;
    const now = new Date().toISOString();
    const normalizedStatus = status === 'RESOLVED' ? 'RESOLVED' : 'DISMISSED';
    const patchId = normalizedStatus === 'RESOLVED' ? cleanEditorialText(details.patchId) : '';
    const summary = cleanEditorialText(details.summary) || (normalizedStatus === 'RESOLVED'
      ? 'Pregunta corregida y asumida como válida hasta una nueva observación.'
      : 'Flag retirado por el usuario sin parche asociado.');
    if (normalizedStatus === 'RESOLVED' && !patchId) return false;

    const changes = {
      status:normalizedStatus,
      resolved_at:now,
      resolved_by_patch_id:patchId || null,
      resolution_summary:summary,
      updated_at:now,
    };
    let row = null;
    if (cloudConfigured) {
      const { data, error } = await supa.from('question_review_flags')
        .update(changes)
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select('*')
        .single();
      if (error) {
        alert(`No se pudo cerrar el flag de revisión: ${error.message}`);
        return false;
      }
      row = data;
    } else row = { ...existing, ...changes };

    mergeReviewFlagHistoryRow(row);
    refreshReviewFlagButtons(questionId);
    return true;
  }

  async function removeQuestionReviewFlag(questionId) {
    return closeQuestionReviewFlag(questionId, 'DISMISSED');
  }

  async function resolveQuestionReviewFlag(questionId, patchId, summary = '') {
    return closeQuestionReviewFlag(questionId, 'RESOLVED', { patchId, summary });
  }

  function closeReviewFlagDialog() {
    const modal = document.getElementById('question-review-flag-modal');
    if (!modal) return;
    if (modal._escapeHandler) document.removeEventListener('keydown', modal._escapeHandler);
    modal.remove();
  }

  function showReviewFlagDialog(questionId) {
    closeReviewFlagDialog();
    const q = questions.find(item => item.id === questionId);
    if (!q) return;
    const existing = reviewFlagFor(questionId);
    let selectedType = existing?.flag_type || 'general';
    let selectedScope = ['CONTENT','EDITORIAL_TECHNICAL'].includes(existing?.learning_scope) ? existing.learning_scope : 'CONTENT';
    if (cloudConfigured && !reviewLearningScopeAvailable) {
      alert(reviewLearningScopeUnavailableMessage());
      return;
    }
    const modal = document.createElement('div');
    modal.id = 'question-review-flag-modal';
    modal.className = 'review-flag-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'review-flag-modal-title');
    modal.innerHTML = `<form class="review-flag-dialog" id="review-flag-form">
      <div class="review-flag-dialog-head">
        <div><h2 id="review-flag-modal-title">Marcar para auditoría</h2><p class="muted">${esc(q.id)} · ${esc(questionSourceLabel(q))}</p></div>
        <button class="btn small ghost" type="button" data-close-review-flag aria-label="Cerrar">✕</button>
      </div>
      <p>Selecciona el tipo, el alcance y describe qué debe revisarse. Los flags son observaciones del banco/presentación; una <strong>Nota de aprendizaje</strong> solo se crea cuando la registras explícitamente.</p>
      <div class="review-flag-choice-grid" role="radiogroup" aria-label="Tipo de observación">
        <button class="review-flag-choice ${selectedType==='statement'?'selected':''}" type="button" data-set-review-flag="statement" role="radio" aria-checked="${selectedType==='statement'}"><strong>📝 Revisar enunciado</strong><span>Redacción, datos clínicos, alternativas o ambigüedad.</span></button>
        <button class="review-flag-choice ${selectedType==='explanation'?'selected':''}" type="button" data-set-review-flag="explanation" role="radio" aria-checked="${selectedType==='explanation'}"><strong>💬 Revisar explicación</strong><span>Explicación insuficiente, confusa, desactualizada o tautológica.</span></button>
        <button class="review-flag-choice ${selectedType==='general'?'selected':''}" type="button" data-set-review-flag="general" role="radio" aria-checked="${selectedType==='general'}"><strong>⚑ Revisar</strong><span>Observación general o motivo todavía no definido.</span></button>
      </div>
      <div class="review-learning-scope" role="radiogroup" aria-label="Alcance de la observación">
        <button class="review-flag-choice ${selectedScope==='CONTENT'?'selected':''}" type="button" data-set-review-scope="CONTENT" role="radio" aria-checked="${selectedScope==='CONTENT'}"><strong>🧠 Contenido clínico</strong><span>Auditoría del contenido, clave, explicación o criterio médico. No crea una Nota ni obliga una acción Anki.</span></button>
        <button class="review-flag-choice ${selectedScope==='EDITORIAL_TECHNICAL'?'selected':''}" type="button" data-set-review-scope="EDITORIAL_TECHNICAL" role="radio" aria-checked="${selectedScope==='EDITORIAL_TECHNICAL'}"><strong>🛠 Editorial / técnico</strong><span>Solo auditoría: typo, formato, texto cortado, duplicación o interfaz.</span></button>
      </div>
      <label class="review-flag-note-label" for="review-flag-note"><strong>Describe el problema</strong><span class="muted">Opcional · máximo 2000 caracteres</span></label>
      <textarea id="review-flag-note" class="input review-flag-note" maxlength="2000" rows="5" placeholder="Ejemplo: la explicación no diferencia este diagnóstico de la alternativa C.">${esc(existing?.user_note || '')}</textarea>
      <div id="review-flag-save-error" class="error-msg"></div>
      <div class="review-flag-close-actions"><button class="btn primary" type="submit">Guardar observación</button><button class="btn ghost" type="button" data-close-review-flag>Cancelar</button></div>
      ${existing ? `<div class="review-flag-existing-actions"><button class="btn small" type="button" data-resolve-review-flag-dialog>✓ Registrar parche</button><button class="btn small danger ghost-danger" type="button" data-remove-review-flag-dialog>Quitar sin parche</button></div>` : ''}
    </form>`;
    document.body.appendChild(modal);

    const close = () => closeReviewFlagDialog();
    modal.querySelectorAll('[data-close-review-flag]').forEach(btn => btn.onclick = close);
    modal.onclick = ev => { if (ev.target === modal) close(); };
    const escapeHandler = ev => {
      if (ev.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    modal._escapeHandler = escapeHandler;
    document.addEventListener('keydown', escapeHandler);

    modal.querySelectorAll('[data-set-review-flag]').forEach(btn => {
      btn.onclick = () => {
        selectedType = btn.dataset.setReviewFlag;
        modal.querySelectorAll('[data-set-review-flag]').forEach(node => {
          const active = node.dataset.setReviewFlag === selectedType;
          node.classList.toggle('selected', active);
          node.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      };
    });
    modal.querySelectorAll('[data-set-review-scope]').forEach(btn => {
      btn.onclick = () => {
        selectedScope = btn.dataset.setReviewScope;
        modal.querySelectorAll('[data-set-review-scope]').forEach(node => {
          const active = node.dataset.setReviewScope === selectedScope;
          node.classList.toggle('selected', active);
          node.setAttribute('aria-checked', active ? 'true' : 'false');
        });
      };
    });
    modal.querySelector('#review-flag-form').onsubmit = async ev => {
      ev.preventDefault();
      const errorNode = modal.querySelector('#review-flag-save-error');
      const note = modal.querySelector('#review-flag-note').value;
      errorNode.textContent = 'Guardando…';
      modal.querySelectorAll('button, textarea').forEach(node => node.disabled = true);
      const saved = await saveQuestionReviewFlag(questionId, selectedType, note, selectedScope);
      if (saved) close();
      else {
        errorNode.textContent = 'No se pudo guardar. Revisa la conexión e inténtalo nuevamente.';
        modal.querySelectorAll('button, textarea').forEach(node => node.disabled = false);
      }
    };
    const resolveBtn = modal.querySelector('[data-resolve-review-flag-dialog]');
    if (resolveBtn) resolveBtn.onclick = () => {
      close();
      showResolveReviewFlagDialog(questionId);
    };
    const removeBtn = modal.querySelector('[data-remove-review-flag-dialog]');
    if (removeBtn) removeBtn.onclick = async () => {
      if (!confirm(`¿Quitar el flag de ${questionId} sin registrarlo como parche? El retiro quedará en el historial.`)) return;
      modal.querySelectorAll('button, textarea').forEach(node => node.disabled = true);
      if (await removeQuestionReviewFlag(questionId)) close();
      else modal.querySelectorAll('button, textarea').forEach(node => node.disabled = false);
    };
  }

  function showResolveReviewFlagDialog(questionId, onResolved = null) {
    closeReviewFlagDialog();
    const q = questions.find(item => item.id === questionId);
    const existing = reviewFlagFor(questionId);
    if (!q || !existing) return;
    const modal = document.createElement('div');
    modal.id = 'question-review-flag-modal';
    modal.className = 'review-flag-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'review-flag-modal-title');
    modal.innerHTML = `<form class="review-flag-dialog" id="resolve-review-flag-form">
      <div class="review-flag-dialog-head">
        <div><h2 id="review-flag-modal-title">Registrar pregunta parchada</h2><p class="muted">${esc(q.id)} · ${esc(questionSourceLabel(q))}</p></div>
        <button class="btn small ghost" type="button" data-close-review-flag aria-label="Cerrar">✕</button>
      </div>
      <p>La observación saldrá de la cola activa, pero se conservará en el historial. Si vuelves a encontrar un problema, se creará un nuevo registro enlazado.</p>
      <label class="form-row"><span>Identificador del parche</span><input id="review-patch-id" class="input" required maxlength="80" placeholder="DBPATCH-2026-07-24-01"></label>
      <label class="form-row"><span>Resumen de la corrección</span><textarea id="review-resolution-summary" class="input review-resolution-textarea" rows="4" maxlength="1000" placeholder="Qué se corrigió o verificó"></textarea></label>
      <div class="review-flag-close-actions"><button class="btn primary" type="submit">Guardar como parchada</button><button class="btn ghost" type="button" data-close-review-flag>Cancelar</button></div>
      <div id="resolve-review-flag-error" class="error-msg"></div>
    </form>`;
    document.body.appendChild(modal);
    const close = () => closeReviewFlagDialog();
    modal.querySelectorAll('[data-close-review-flag]').forEach(btn => btn.onclick = close);
    modal.onclick = ev => { if (ev.target === modal) close(); };
    const escapeHandler = ev => { if (ev.key === 'Escape') close(); };
    modal._escapeHandler = escapeHandler;
    document.addEventListener('keydown', escapeHandler);
    modal.querySelector('#resolve-review-flag-form').onsubmit = async ev => {
      ev.preventDefault();
      const patchId = modal.querySelector('#review-patch-id').value.trim();
      const summary = modal.querySelector('#review-resolution-summary').value.trim();
      const errorNode = modal.querySelector('#resolve-review-flag-error');
      if (!patchId) { errorNode.textContent = 'Escribe el identificador del parche.'; return; }
      modal.querySelectorAll('button,input,textarea').forEach(node => node.disabled = true);
      const ok = await resolveQuestionReviewFlag(questionId, patchId, summary);
      if (!ok) {
        modal.querySelectorAll('button,input,textarea').forEach(node => node.disabled = false);
        errorNode.textContent = 'No se pudo registrar el parche.';
        return;
      }
      close();
      if (typeof onResolved === 'function') onResolved();
    };
    setTimeout(() => modal.querySelector('#review-patch-id')?.focus(), 0);
  }

  function bindReviewFlagButtons(root = document) {
    root.querySelectorAll('[data-question-review-flag]').forEach(btn => {
      btn.onclick = () => showReviewFlagDialog(btn.dataset.questionReviewFlag);
    });
  }

  function rebuildMemoryMap() { memoryByQuestion = new Map(memoryStates.map(s => [s.question_id, s])); }

  function isoDateLocal(value = new Date()) {
    const d = value instanceof Date ? value : new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function sessionStartLocalDate(row = {}) {
    const explicit = row.config?.recovery?.sourceLocalDate || row.config?.planDate || null;
    return explicit && /^\d{4}-\d{2}-\d{2}$/.test(String(explicit))
      ? String(explicit)
      : isoDateLocal(row.created_at || row.updated_at || new Date());
  }

  function sessionExpiredByLocalDay(row = {}, today = isoDateLocal()) {
    return row.status === 'active' && sessionStartLocalDate(row) < today;
  }

  function endOfSessionLocalDayIso(row = {}) {
    const [year, month, day] = sessionStartLocalDate(row).split('-').map(Number);
    const localEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
    return localEnd.toISOString();
  }

  async function expireActiveSessionAtDayBoundary(rawRow) {
    const row = SessionCore.normalizeSessionRow ? SessionCore.normalizeSessionRow(rawRow) : rawRow;
    if (!sessionExpiredByLocalDay(row)) return row;
    const state = normalizeSessionState(row.state || {});
    const answeredCount = answeredIdsFor(row, state).length;
    const hasAnswers = answeredCount > 0;
    const now = sessionNowIso();
    const expectedRevision = Number(row.state_revision || 0);
    const nextRevision = expectedRevision + 1;
    const nextStatus = hasAnswers ? 'completed' : 'abandoned';
    const updatePayload = {
      status:nextStatus,
      is_partial:hasAnswers,
      closed_reason:hasAnswers ? 'day_expired_partial' : 'day_expired_empty',
      answered_count:answeredCount,
      planned_count:Number(row.planned_count || row.question_ids?.length || 0),
      completed_at:hasAnswers ? endOfSessionLocalDayIso(row) : null,
      updated_at:now,
      last_synced_at:cloudConfigured ? now : (row.last_synced_at || null),
      client_app_version:APP_VERSION,
      state_revision:nextRevision,
    };
    const localClosed = { ...row, ...updatePayload, state, syncStatus:cloudConfigured ? 'pending' : 'local', syncError:null };
    await saveSessionShadow(localClosed, cloudConfigured ? 'pending' : 'local');

    if (!cloudConfigured) {
      saveLocalSessions();
      return localClosed;
    }

    if (!navigator.onLine) {
      await sessionStore?.queueOperation('CLOSE_SESSION', {
        sessionId:row.id,
        expectedRevision,
        updatePayload,
        statusOnly:true,
      }, `CLOSE_SESSION:${row.id}`);
      const offline = { ...localClosed, syncStatus:'offline', syncError:'DAY_BOUNDARY_OFFLINE' };
      await saveSessionShadow(offline, 'offline');
      return offline;
    }

    let { data, error } = await supa.from('practice_sessions')
      .update(updatePayload)
      .eq('id', row.id)
      .eq('status', 'active')
      .eq('state_revision', expectedRevision)
      .select('*')
      .maybeSingle();

    if (!error && !data) {
      const read = await supa.from('practice_sessions').select('*').eq('id', row.id).maybeSingle();
      if (!read.error && read.data?.status === 'active') {
        const remoteRevision = Number(read.data.state_revision || 0);
        const retryPayload = { ...updatePayload, state_revision:remoteRevision + 1, updated_at:sessionNowIso(), last_synced_at:sessionNowIso() };
        const retry = await supa.from('practice_sessions')
          .update(retryPayload)
          .eq('id', row.id)
          .eq('status', 'active')
          .eq('state_revision', remoteRevision)
          .select('*')
          .maybeSingle();
        data = retry.data;
        error = retry.error;
      } else if (!read.error && read.data) {
        data = read.data;
      } else if (read.error) error = read.error;
    }

    if (error) {
      await sessionStore?.queueOperation('CLOSE_SESSION', {
        sessionId:row.id,
        expectedRevision,
        updatePayload,
        statusOnly:true,
      }, `CLOSE_SESSION:${row.id}`);
      const offline = { ...localClosed, syncStatus:'offline', syncError:error.message || 'DAY_BOUNDARY_CLOSE_FAILED' };
      await saveSessionShadow(offline, 'offline');
      return offline;
    }

    const synced = { ...(data || localClosed), syncStatus:'synced', syncError:null };
    await saveSessionShadow(synced, 'synced');
    return synced;
  }

  async function expireStaleActiveSessions() {
    if (dayBoundarySweepInProgress) return [];
    dayBoundarySweepInProgress = true;
    const closed = [];
    try {
      const stale = [...activeSessions].filter(row => sessionExpiredByLocalDay(row));
      for (const row of stale) {
        const result = await expireActiveSessionAtDayBoundary(row);
        if (result && result.status !== 'active') closed.push(result);
      }
      return closed;
    } finally {
      dayBoundarySweepInProgress = false;
    }
  }

  async function handleCurrentSessionDayBoundary() {
    const owner = currentSessionOwner();
    if (!owner?.row || !sessionExpiredByLocalDay(owner.row)) return false;
    clearTimer();
    accumulateSessionActivity();
    const shadow = await persistCurrentSessionShadow(owner).catch(() => owner.row);
    endSessionActivity();
    const closed = await expireActiveSessionAtDayBoundary(shadow || owner.row);
    const returnDate = sessionStartLocalDate(owner.row);
    currentStudy = null;
    currentExam = null;
    deactivateSessionNavigationGuard();
    releaseActiveSessionLease();
    if (closed?.status === 'completed') await openHistorySession(closed.id, returnDate);
    else renderDashboard();
    return true;
  }

  function parseLocalDate(iso) {
    const [y,m,d] = String(iso).split('-').map(Number);
    return new Date(y, m-1, d, 12, 0, 0, 0);
  }

  function questionSourceLabel(q = {}) {
    const parts = [];
    if (q.year != null && String(q.year).trim()) parts.push(String(q.year).trim());
    const test = String(q.test || '').trim().toUpperCase();
    if (test) parts.push(`Prueba ${test}`);
    const number = q.question_number != null && String(q.question_number).trim()
      ? String(q.question_number).trim()
      : '';
    if (number) parts.push(`Pregunta ${number}`);
    return parts.join(' · ') || String(q.id || 'Fuente no disponible');
  }

  function questionSourceTag(q) {
    return `<span class="tag source-tag">📄 ${esc(questionSourceLabel(q))}</span>`;
  }

  function daysBetween(a, b) { return (parseLocalDate(b) - parseLocalDate(a)) / 86400000; }
  function daysUntil(iso) { return Math.ceil((parseLocalDate(iso) - new Date()) / 86400000); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function currentPhase(date = isoDateLocal()) {
    return PHASES.find(p => date >= p.start && date <= p.end)
      || (date < PHASES[0].start ? PHASES[0] : PHASES[PHASES.length-1]);
  }

  function targetRetention(date = isoDateLocal(), q = null) {
    const phase = currentPhase(date);

    // v1.3.3 — retención por etapa y rentabilidad.
    // Se preserva exactamente el comportamiento histórico hasta 2026-08-17 para que
    // la reconstrucción determinista de memoria no reescriba el pasado.
    if (date >= '2026-08-18') {
      const tier = explicitRentabilityTier(q);
      const high = tier.includes('MUY_ALTA') || tier.includes('MUY ALTA') || tier.startsWith('ALTA');

      // Cobertura intensiva: proteger lo más rentable sin inflar todavía todos los repasos.
      if (date <= '2026-08-27') {
        if (high) return 0.93;
        if (tier.includes('MEDIA')) return 0.91;
        return 0.90;
      }

      // Últimos 9 días: máxima exigencia en MUY_ALTA/ALTA, intermedia en MEDIA.
      if (date <= '2026-09-05') {
        if (high) return 0.95;
        if (tier.includes('MEDIA')) return 0.93;
        return 0.90;
      }
    }

    if (phase.key === 'preexam') return 0.95;
    if (phase.key === 'close_gaps') return 0.93;
    return 0.90;
  }

  function questionReadingLoad(q) {
    return String(q?.question || '').length
      + optionList(q).reduce((sum, o) => sum + String(o?.text || '').length, 0);
  }

  function effectiveTargetSeconds(q, baseOverride = null) {
    const base = Number(baseOverride || profile?.target_response_seconds || 25);
    const load = questionReadingLoad(q);
    const fullText = `${q?.question || ''} ${optionList(q).map(o => o.text || '').join(' ')}`;
    const numericTokens = fullText.match(/\b\d+(?:[.,]\d+)?\b/g) || [];
    const complexCue = /(calcula|calcule|cálculo|ecuación|fórmula|riesgo relativo|odds ratio|depuración|clearance|score|puntaje|dosis|mg\/?kg|ml\/?kg|mEq|clasificación|estadio|grado|criterios de ranson|glasgow)/i.test(fullText);

    // Objetivo adaptable: las preguntas directas deben resolverse más rápido y
    // las largas reciben margen adicional. Con una base de 25 s, los escalones
    // habituales son 15 / 20 / 25 / 30 / 35 s.
    let factor = load <= 170 ? 0.60
      : load <= 260 ? 0.80
      : load <= 380 ? 1.00
      : load <= 520 ? 1.20
      : 1.40;

    // Guardia de complejidad: una pregunta corta que exige cálculo, puntuación,
    // dosis o clasificación no recibe un objetivo agresivo de 15–20 s.
    if (factor < 1 && (complexCue || numericTokens.length >= 4)) factor = 1.00;

    return Math.round(clamp(base * factor, 8, 60));
  }

  function speedBucket(q, responseMs, correct, timedOut = false, targetOverride = null) {
    if (timedOut) return 'timed_out';
    const sec = Number(responseMs || 0) / 1000;
    const target = Number(targetOverride || effectiveTargetSeconds(q));
    if (!correct && sec <= target) return 'wrong_fast';
    if (!correct) return 'incorrect';
    if (sec <= target) return 'fluent';
    if (sec <= target * 1.6) return 'slow_correct';
    return 'very_slow_correct';
  }

  function memoryRating(q, responseMs, correct, timedOut = false, targetOverride = null) {
    if (!correct || timedOut) return 1;
    const sec = Number(responseMs || 0) / 1000;
    const target = Number(targetOverride || effectiveTargetSeconds(q));
    if (sec <= target) return 4;
    if (sec <= target * 1.6) return 3;
    return 2;
  }

  function estimateRecall(state, at = new Date()) {
    if (!state || !Number(state.stability_days) || !state.last_attempt_at) return 0;
    const elapsedDays = Math.max(0, (new Date(at) - new Date(state.last_attempt_at)) / 86400000);
    return clamp(Math.pow(0.9, elapsedDays / Number(state.stability_days)), 0, 1);
  }

  function evolveMemory(prev, attempt, q) {
    const now = new Date(attempt.answered_at || new Date());
    const rating = Number(attempt.memory_rating || memoryRating(q, attempt.response_time_ms, attempt.is_correct, attempt.timed_out));
    const oldS = Number(prev?.stability_days || 0);
    const oldD = Number(prev?.difficulty || 5);
    const recallBefore = estimateRecall(prev, now);
    let stability = oldS;
    let difficulty = oldD;
    let consecutive = Number(prev?.consecutive_correct || 0);
    let lapses = Number(prev?.lapses || 0);

    if (rating === 1) {
      const wrongAndUncertain = Boolean(attempt.was_uncertain) && !attempt.is_correct;
      stability = oldS > 0
        ? Math.max(0.18, oldS * (wrongAndUncertain ? 0.25 : 0.35))
        : (wrongAndUncertain ? 0.18 : 0.25);
      difficulty = clamp(oldD + (wrongAndUncertain ? 1.1 : 0.8), 1, 10);
      consecutive = 0;
      lapses += 1;
    } else {
      const initial = rating === 2 ? 1 : rating === 3 ? 2.5 : 4.5;
      if (oldS <= 0) stability = initial;
      else {
        const baseGrowth = rating === 2 ? 1.45 : rating === 3 ? 2.05 : 2.8;
        const retrievalBonus = 1 + Math.max(0, 0.9 - recallBefore) * 1.5;
        const difficultyFactor = clamp(1.18 - oldD * 0.035, 0.82, 1.15);
        stability = Math.max(oldS + 0.25, oldS * baseGrowth * retrievalBonus * difficultyFactor);
      }
      difficulty = clamp(oldD + (rating === 2 ? 0.2 : rating === 3 ? -0.05 : -0.25), 1, 10);
      consecutive += 1;
    }

    const retention = targetRetention(isoDateLocal(now), q);
    let intervalDays = stability * (Math.log(retention) / Math.log(0.9));
    if (rating === 1) {
      const wrongAndUncertain = Boolean(attempt.was_uncertain) && !attempt.is_correct;
      intervalDays = Math.min(intervalDays, wrongAndUncertain ? 0.12 : 0.25);
    }
    intervalDays = clamp(intervalDays, 0.08, 180);
    const due = new Date(now.getTime() + intervalDays * 86400000);

    return {
      user_id: user?.id || null,
      question_id: q.id,
      difficulty: Number(difficulty.toFixed(3)),
      stability_days: Number(stability.toFixed(4)),
      estimated_recall: Number(estimateRecall({ stability_days: stability, last_attempt_at: now.toISOString() }, now).toFixed(4)),
      due_at: due.toISOString(),
      consecutive_correct: consecutive,
      lapses,
      last_result: Boolean(attempt.is_correct),
      last_response_time_ms: Number(attempt.response_time_ms || 0),
      speed_state: attempt.speed_bucket || speedBucket(q, attempt.response_time_ms, attempt.is_correct, attempt.timed_out),
      last_attempt_at: now.toISOString(),
      last_interval_days: Number(intervalDays.toFixed(4)),
      updated_at: new Date().toISOString(),
    };
  }

  async function upsertMemoryRows(rows) {
    if (!rows.length) return;
    for (const row of rows) memoryByQuestion.set(row.question_id, row);
    memoryStates = [...memoryByQuestion.values()];
    if (cloudConfigured) {
      const payload = rows.map(r => ({ ...r, user_id: user.id }));
      const { error } = await supa.from('question_memory_state').upsert(payload, { onConflict:'user_id,question_id' });
      if (error) console.warn('No se pudo actualizar memoria:', error.message);
    } else saveLocalMemory();
  }

  function memoryStateComparable(state = {}) {
    const dueMs = new Date(state.due_at || 0).getTime();
    const lastMs = new Date(state.last_attempt_at || 0).getTime();
    return {
      difficulty:Number(state.difficulty || 0).toFixed(3),
      stability_days:Number(state.stability_days || 0).toFixed(4),
      due_at:Number.isFinite(dueMs) ? dueMs : 0,
      consecutive_correct:Number(state.consecutive_correct || 0),
      lapses:Number(state.lapses || 0),
      last_result:state.last_result === true || state.last_result === 'true',
      last_response_time_ms:Number(state.last_response_time_ms || 0),
      speed_state:String(state.speed_state || ''),
      last_attempt_at:Number.isFinite(lastMs) ? lastMs : 0,
      last_interval_days:Number(state.last_interval_days || 0).toFixed(4),
    };
  }

  function memoryStatesMateriallyDiffer(a, b) {
    return JSON.stringify(memoryStateComparable(a)) !== JSON.stringify(memoryStateComparable(b));
  }

  async function reconcileMemoryFromAttempts() {
    // v1.3.3 — attempts es la fuente de verdad del scheduler.
    // Reconstruye cada pregunta de forma determinista y corrige también drift con la
    // misma last_attempt_at (el reconciliador previo solo detectaba memoria atrasada).
    rebuildMemoryMap();
    const byQ = new Map();
    for (const a of attempts) {
      if (!byQ.has(a.question_id)) byQ.set(a.question_id, []);
      byQ.get(a.question_id).push(a);
    }

    const rebuilt = [];
    for (const [qid, list] of byQ.entries()) {
      const q = questions.find(x => x.id === qid);
      if (!q) continue;
      list.sort((a,b) => new Date(a.answered_at) - new Date(b.answered_at));

      let state = null;
      for (const a of list) {
        const normalized = {
          ...a,
          memory_rating: a.memory_rating || memoryRating(q, a.response_time_ms, a.is_correct, a.timed_out, a.target_seconds),
          speed_bucket: a.speed_bucket || speedBucket(q, a.response_time_ms, a.is_correct, a.timed_out, a.target_seconds),
        };
        state = evolveMemory(state, normalized, q);
      }

      const existing = memoryByQuestion.get(qid);
      if (state && (!existing || memoryStatesMateriallyDiffer(existing, state))) rebuilt.push(state);
    }

    // Chunk pequeño y único al cargar. Evita 922 escrituras individuales.
    const CHUNK = 250;
    for (let i = 0; i < rebuilt.length; i += CHUNK) {
      await upsertMemoryRows(rebuilt.slice(i, i + CHUNK));
    }
    if (rebuilt.length) console.info(`Memoria reconciliada desde intentos: ${rebuilt.length} pregunta(s).`);
  }

  function applyTtsCatalog(raw, source = 'unknown') {
    ttsCatalog = W4Data.normalizeCatalog ? W4Data.normalizeCatalog(raw) : raw;
    ttsCatalogByTopic = W4Data.catalogMap
      ? W4Data.catalogMap(ttsCatalog)
      : new Map((ttsCatalog.topics || []).map(item => [item.topicId, item]));
    ttsCatalogSource = source;
    ttsCatalogLoadError = '';
  }

  async function loadStaticTtsCatalog() {
    try {
      const response = await fetch('./tts_catalog.json', { cache:'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      applyTtsCatalog(await response.json(), 'static-fallback');
    } catch (error) {
      console.warn('TTS static catalog unavailable.', error);
      ttsCatalog = { catalogVersion:'unavailable', topics:[] };
      ttsCatalogByTopic = new Map();
      ttsCatalogSource = 'unavailable';
      ttsCatalogLoadError = error?.message || String(error);
    }
  }

  async function loadCloudTtsCatalog() {
    if (!supa || !user) return { data:ttsCatalog, error:null, source:ttsCatalogSource };
    const { data, error } = await supa.from(TTS_CATALOG_TABLE)
      .select('rentability_topic_id,topic_label,canonical_area,main_specialty,rentability_tier,rentability_score,status,primary_code,tts_version,catalog_version,part_count,part_codes,estimated_minutes,package_relative_folder,complete_txt_file,complete_markdown_file,source_status,source_package,source_package_sha256,reviewed_as_of,available_at,updated_at')
      .order('primary_code', { ascending:true });
    if (error) {
      console.warn('No se pudo cargar el catálogo TTS desde Supabase; se conserva el respaldo local.', error.message);
      ttsCatalogLoadError = error.message;
      return { data:ttsCatalog, error, source:ttsCatalogSource, usedFallback:true };
    }
    const rows = data || [];
    if (!rows.length) {
      const errorMessage = 'El catálogo TTS remoto respondió sin filas; se conserva el respaldo local.';
      console.warn(errorMessage);
      ttsCatalogLoadError = errorMessage;
      return { data:ttsCatalog, error:null, source:ttsCatalogSource, usedFallback:true };
    }
    applyTtsCatalog({
      catalogVersion:rows[0]?.catalog_version || 'EMPTY',
      generatedAt:rows.reduce((latest, row) => String(row.updated_at || row.available_at || '') > String(latest || '') ? (row.updated_at || row.available_at) : latest, null),
      taxonomyVersion:rows[0]?.taxonomy_version || 'TTS_CATALOG_LEGACY_MAPPING',
      topics:rows,
    }, 'supabase');
    return { data:ttsCatalog, error:null, source:'supabase' };
  }

  async function fetchDatasetManifest() {
    const { data, error } = await supa.from('app_dataset_versions')
      .select('*')
      .eq('dataset_key', 'questions')
      .maybeSingle();
    if (error) return { data:null, error };
    return { data:data || null, error:null };
  }

  function manifestMetadata(manifest = {}) {
    const raw = manifest?.metadata;
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
  }

  function activeTopicRows(rows = []) {
    return (rows || []).filter(row => {
      if (row?.is_active === false || String(row?.is_active || '').toLowerCase() === 'false') return false;
      const status = String(row?.topic_status || row?.status || '').toUpperCase();
      return !status.startsWith('DEPRECATED');
    });
  }

  function validateCorpusBundle(questionRows = [], topicRows = [], manifest = {}) {
    const metadata = manifestMetadata(manifest);
    const expectedQuestions = Number(manifest?.row_count ?? metadata.question_row_count ?? questionRows.length);
    const expectedActiveTopics = Number(metadata.active_topic_count ?? metadata.topic_row_count_active ?? topicRows.length);
    const ids = questionRows.map(row => String(row?.id || '')).filter(Boolean);
    if (!questionRows.length || new Set(ids).size !== questionRows.length) return { ok:false, reason:'question_ids_not_unique' };
    if (Number.isFinite(expectedQuestions) && expectedQuestions >= 0 && questionRows.length !== expectedQuestions) return { ok:false, reason:`question_count_${questionRows.length}_expected_${expectedQuestions}` };

    const activeTopics = activeTopicRows(topicRows);
    if (Number.isFinite(expectedActiveTopics) && expectedActiveTopics >= 0 && activeTopics.length !== expectedActiveTopics) return { ok:false, reason:`active_topic_count_${activeTopics.length}_expected_${expectedActiveTopics}` };
    const topicIds = new Set(activeTopics.map(row => String(row?.id || '')).filter(Boolean));
    if (topicIds.size !== activeTopics.length) return { ok:false, reason:'active_topic_ids_not_unique' };
    const orphan = questionRows.find(row => !topicIds.has(String(row?.rentability_topic_id || '')));
    if (orphan) return { ok:false, reason:`orphan_topic_${orphan.id}_${orphan.rentability_topic_id}` };

    const counts = new Map();
    for (const row of questionRows) {
      const id = String(row?.rentability_topic_id || '');
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    const mismatched = activeTopics.find(row => Number.isFinite(Number(row?.n_questions)) && Number(row.n_questions) !== Number(counts.get(String(row.id)) || 0));
    if (mismatched) return { ok:false, reason:`topic_count_mismatch_${mismatched.id}` };

    const expectedTaxonomy = String(metadata.taxonomy_version || '').trim();
    if (expectedTaxonomy) {
      const badQuestion = questionRows.find(row => String(row?.taxonomy_version || '') !== expectedTaxonomy);
      const badTopic = activeTopics.find(row => String(row?.taxonomy_version || '') !== expectedTaxonomy);
      if (badQuestion || badTopic) return { ok:false, reason:'taxonomy_version_mismatch' };
    }
    return { ok:true, activeTopics };
  }

  async function fetchAllRentabilityTopics() {
    const pageSize = 500;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supa.from('rentability_topics').select('*').order('id').range(from, from + pageSize - 1);
      if (error) return { data:null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data:all, error:null };
  }

  async function fetchTopicAliasesOptional() {
    const { data, error } = await supa.from('taxonomy_topic_aliases').select('*').order('source_topic_id');
    if (error) return { data:[], error:null, unavailable:true };
    return { data:data || [], error:null, unavailable:false };
  }

  async function loadCorpusWithCache() {
    const cached = sessionStore?.getCachedCorpus ? await sessionStore.getCachedCorpus() : null;
    const manifestRes = await fetchDatasetManifest();
    const remoteManifest = manifestRes.data;
    datasetManifest = remoteManifest || cached?.manifest || null;
    const cachedQuestions = cached?.questions || [];
    const cachedTopics = cached?.topics || [];
    const cachedMetadata = manifestMetadata(cached?.manifest || {});
    const cachedValid = cachedQuestions.length > 0 && cachedTopics.length > 0 && (
      remoteManifest
        ? (W4Data.manifestMatchesBundle
            ? W4Data.manifestMatchesBundle(cached?.manifest || { dataset_revision:cached?.revision }, remoteManifest, cachedQuestions.length, activeTopicRows(cachedTopics).length)
            : W4Data.manifestMatches(cached?.manifest || { dataset_revision:cached?.revision }, remoteManifest, cachedQuestions.length))
        : cachedQuestions.length === Number(cached?.manifest?.row_count || cachedQuestions.length)
    );

    if (cachedValid) {
      const aliases = await fetchTopicAliasesOptional();
      return { data:cachedQuestions, topics:activeTopicRows(cachedTopics), aliases:aliases.data || [], source:'indexeddb', manifest:datasetManifest, error:null };
    }

    const [remoteQuestions, remoteTopics, aliases] = await Promise.all([
      fetchAllQuestions(),
      fetchAllRentabilityTopics(),
      fetchTopicAliasesOptional(),
    ]);
    if (remoteQuestions.error || remoteTopics.error) {
      if (cachedQuestions.length && cachedTopics.length) return { data:cachedQuestions, topics:activeTopicRows(cachedTopics), aliases:aliases.data || [], source:'indexeddb-stale', manifest:datasetManifest, error:null };
      return { data:null, topics:null, aliases:aliases.data || [], source:'none', manifest:datasetManifest, error:remoteQuestions.error || remoteTopics.error };
    }

    const normalized = normalizeQuestionCorpus(remoteQuestions.data || []);
    const allTopics = remoteTopics.data || [];
    const manifest = remoteManifest || {
      dataset_key:'questions',
      dataset_revision:`fallback-${normalized.length}-${new Date().toISOString().slice(0,10)}`,
      row_count:normalized.length,
      metadata:{ taxonomy_version:'unknown', active_topic_count:activeTopicRows(allTopics).length, source:'client-fallback' },
      updated_at:new Date().toISOString(),
    };
    const validation = validateCorpusBundle(normalized, allTopics, manifest);
    if (!validation.ok) {
      console.error('Se rechazó un bundle de taxonomía incompatible; se conserva la caché previa.', validation.reason);
      if (cachedQuestions.length && cachedTopics.length) return { data:cachedQuestions, topics:activeTopicRows(cachedTopics), aliases:aliases.data || [], source:'indexeddb-stale-invalid-remote', manifest:cached?.manifest || datasetManifest, error:null, validationError:validation.reason };
      return { data:null, topics:null, aliases:aliases.data || [], source:'none', manifest, error:new Error(`Dataset incompatible: ${validation.reason}`) };
    }
    if (sessionStore?.replaceCorpus) await sessionStore.replaceCorpus(normalized, validation.activeTopics, manifest);
    datasetManifest = manifest;
    return { data:normalized, topics:validation.activeTopics, aliases:aliases.data || [], source:'supabase', manifest, error:null };
  }

  async function fetchAttemptsUpdatedSince(since = null) {
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      let query = supa.from('attempts').select('*').eq('user_id', user.id).order('updated_at', { ascending:true });
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) return { data:null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data:all, error:null };
  }

  async function loadAttemptsIncremental() {
    const cached = sessionStore?.getAttemptsForUser ? await sessionStore.getAttemptsForUser(user.id) : [];
    const markerKey = `attemptsLastSync:${user.id}`;
    const marker = sessionStore ? await sessionStore.getMetadata(markerKey) : null;
    const since = cached.length ? marker?.value || null : null;
    const remote = await fetchAttemptsUpdatedSince(since);
    if (remote.error) {
      if (cached.length) return { data:cached, error:null, source:'indexeddb-stale' };
      return { data:null, error:remote.error, source:'none' };
    }
    if (sessionStore?.bulkPutAttempts && remote.data?.length) await sessionStore.bulkPutAttempts(remote.data, 'synced');
    const merged = W4Data.mergeRows
      ? W4Data.mergeRows(cached, remote.data || [], W4Data.attemptKey || (row => row.client_attempt_id || row.id))
      : [...cached, ...(remote.data || [])];
    const last = W4Data.maxUpdatedAt ? W4Data.maxUpdatedAt(merged, ['updated_at','answered_at']) : null;
    if (last && sessionStore) await sessionStore.setMetadata(markerKey, last);
    return { data:merged, error:null, source:since ? 'incremental' : 'initial' };
  }

  async function fetchMemoryUpdatedSince(since = null) {
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      let query = supa.from('question_memory_state').select('*').eq('user_id', user.id).order('updated_at', { ascending:true });
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) return { data:null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data:all, error:null };
  }

  async function loadMemoryIncremental() {
    const key = `memory:${user.id}`;
    const snapshot = sessionStore?.getUserSnapshot ? await sessionStore.getUserSnapshot(key) : null;
    const cached = snapshot?.rows || [];
    const since = cached.length ? snapshot?.metadata?.lastSyncAt || null : null;
    const remote = await fetchMemoryUpdatedSince(since);
    if (remote.error) {
      if (cached.length) return { data:cached, error:null, source:'indexeddb-stale' };
      return { data:null, error:remote.error, source:'none' };
    }
    const merged = W4Data.mergeRows
      ? W4Data.mergeRows(cached, remote.data || [], row => row.question_id)
      : [...cached, ...(remote.data || [])];
    const last = W4Data.maxUpdatedAt ? W4Data.maxUpdatedAt(merged, ['updated_at','last_attempt_at']) : null;
    if (sessionStore?.setUserSnapshot) await sessionStore.setUserSnapshot(key, merged, { lastSyncAt:last });
    return { data:merged, error:null, source:since ? 'incremental' : 'initial' };
  }

  async function fetchFlagsUpdatedSince(since = null) {
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      let query = supa.from('question_review_flags').select('*').eq('user_id', user.id).order('updated_at', { ascending:true });
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) return { data:null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data:all, error:null };
  }

  async function loadFlagsIncremental() {
    const key = `flags:${user.id}`;
    const snapshot = sessionStore?.getUserSnapshot ? await sessionStore.getUserSnapshot(key) : null;
    const cached = snapshot?.rows || [];
    const since = cached.length ? snapshot?.metadata?.lastSyncAt || null : null;
    const remote = await fetchFlagsUpdatedSince(since);
    if (remote.error) {
      if (cached.length) return { data:cached, error:null, source:'indexeddb-stale' };
      return { data:null, error:remote.error, source:'none' };
    }
    const merged = W4Data.mergeRows
      ? W4Data.mergeRows(cached, remote.data || [], row => row.id || `${row.question_id}:${row.created_at || row.updated_at}`)
      : [...cached, ...(remote.data || [])];
    const last = W4Data.maxUpdatedAt ? W4Data.maxUpdatedAt(merged, ['updated_at','created_at']) : null;
    if (sessionStore?.setUserSnapshot) await sessionStore.setUserSnapshot(key, merged, { lastSyncAt:last });
    return { data:merged, error:null, source:since ? 'incremental' : 'initial' };
  }


  async function fetchLearningNotesUpdatedSince(since = null) {
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      let query = supa.from('question_learning_notes').select('*').eq('user_id', user.id).order('updated_at', { ascending:true });
      if (since) query = query.gt('updated_at', since);
      const { data, error } = await query.range(from, from + pageSize - 1);
      if (error) return { data:null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data:all, error:null };
  }

  async function loadLearningNotesIncremental() {
    const key = `learning-notes:${user.id}`;
    const snapshot = sessionStore?.getUserSnapshot ? await sessionStore.getUserSnapshot(key) : null;
    const cached = snapshot?.rows || [];
    const since = cached.length ? snapshot?.metadata?.lastSyncAt || null : null;
    const remote = await fetchLearningNotesUpdatedSince(since);
    if (remote.error) {
      return { data:cached, error:null, unavailable:true, reason:remote.error.message || 'Tabla no disponible' };
    }
    const merged = W4Data.mergeRows
      ? W4Data.mergeRows(cached, remote.data || [], row => row.id || `${row.question_id}:${row.updated_at}`)
      : [...cached, ...(remote.data || [])];
    const last = W4Data.maxUpdatedAt ? W4Data.maxUpdatedAt(merged, ['updated_at','created_at']) : null;
    if (sessionStore?.setUserSnapshot) await sessionStore.setUserSnapshot(key, merged, { lastSyncAt:last });
    return { data:merged, error:null, unavailable:false, source:since ? 'incremental' : 'initial' };
  }

  async function fetchCompletedSessionsPage(page = 0) {
    const range = W4Data.pageRange ? W4Data.pageRange(page, HISTORY_PAGE_SIZE) : { from:page*HISTORY_PAGE_SIZE, to:(page+1)*HISTORY_PAGE_SIZE-1 };
    const { data, error } = await supa.from('practice_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending:false })
      .range(range.from, range.to);
    return { data:data || [], error, page, hasMore:!error && (data || []).length === HISTORY_PAGE_SIZE };
  }

  async function ensureHistoryDateLoaded(dateIso) {
    if (!cloudConfigured || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso))) return;
    const start = parseLocalDate(dateIso);
    const end = new Date(start.getTime() + 86400000);
    const { data, error } = await supa.from('practice_sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .gte('completed_at', start.toISOString())
      .lt('completed_at', end.toISOString())
      .order('completed_at', { ascending:false });
    if (error) return;
    completedSessions = SessionCore.mergeSessionRows
      ? SessionCore.mergeSessionRows(data || [], completedSessions).filter(row => row.status === 'completed')
      : [...completedSessions, ...(data || [])];
    if (sessionStore) for (const row of data || []) await sessionStore.putSession(row, 'synced');
  }

  async function loadMoreCompletedSessions() {
    if (!cloudConfigured || !historyHasMore) return false;
    const nextPage = historyPage + 1;
    const page = await fetchCompletedSessionsPage(nextPage);
    if (page.error) return false;
    completedSessions = SessionCore.mergeSessionRows
      ? SessionCore.mergeSessionRows(page.data || [], completedSessions).filter(row => row.status === 'completed')
      : [...completedSessions, ...(page.data || [])];
    historyPage = nextPage;
    historyHasMore = page.hasMore;
    if (sessionStore) for (const row of page.data || []) await sessionStore.putSession(row, 'synced');
    return true;
  }

  async function ensureHistorySessionAttempts(sessionId) {
    if (!cloudConfigured || attemptsForSessionId(sessionId).length) return attemptsForSessionId(sessionId);
    const { data, error } = await supa.from('attempts')
      .select('*')
      .eq('user_id', user.id)
      .eq('session_id', sessionId)
      .order('session_question_index', { ascending:true });
    if (error) return [];
    if (sessionStore?.bulkPutAttempts) await sessionStore.bulkPutAttempts(data || [], 'synced');
    attempts = W4Data.mergeRows
      ? W4Data.mergeRows(attempts, data || [], W4Data.attemptKey || (row => row.client_attempt_id || row.id))
      : [...attempts, ...(data || [])];
    return attemptsForSessionId(sessionId);
  }

  async function init() {
    registerServiceWorker();
    await initializeSessionStorage();
    await loadStaticTtsCatalog();
    installSessionLifecycleHooks();
    if (!cloudConfigured) {
      questions = normalizeQuestionCorpus((window.PILOT_QUESTIONS || []).filter(q => String(q.active).toLowerCase() !== 'false'));
      rebuildCorpusRentability();
      const legacyAttempts = localAttempts();
      const shadowAttempts = sessionStore ? await sessionStore.getAllAttempts() : [];
      const attemptsByClient = new Map();
      for (const row of [...legacyAttempts, ...shadowAttempts]) attemptsByClient.set(row.client_attempt_id || row.id, row);
      attempts = [...attemptsByClient.values()];
      const localSessionRows = sessionStore ? await sessionStore.getAllSessions() : localSessions();
      activeSessions = localSessionRows.filter(s => s.status === 'active');
      completedSessions = localSessionRows.filter(s => s.status === 'completed');
      profile = localProfile();
      memoryStates = localMemory();
      reviewFlagHistory = localReviewFlags();
      reviewFlags = activeReviewFlagRows(reviewFlagHistory);
      rebuildReviewFlagMap();
      learningNoteHistory = localLearningNotes();
      learningNotes = activeLearningNoteRows(learningNoteHistory);
      rebuildLearningNoteMap();
      rebuildMemoryMap();
      await expireStaleActiveSessions();
      await reconcileMemoryFromAttempts();
      renderDashboard();
      return;
    }

    if (!window.supabase?.createClient) {
      renderFatal('No se pudo cargar la librería de Supabase. Comprueba tu conexión y recarga.');
      return;
    }

    supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    const { data } = await supa.auth.getSession();
    user = data.session?.user || null;
    supa.auth.onAuthStateChange((_event, session) => { user = session?.user || null; });
    if (!user) renderLogin();
    else await loadCloudData();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
  }

  function renderFatal(message) {
    app.innerHTML = `<div class="login-wrap"><div class="panel login-card"><h2>Error</h2><p>${esc(message)}</p></div></div>`;
  }

  function renderLogin(message = '') {
    clearTimer();
    app.innerHTML = `
      <div class="login-wrap">
        <div class="panel login-card">
          <div class="logo-mark">R</div>
          <h1>Residentado</h1>
          <div class="app-version app-version-login">v${APP_VERSION}</div>
          <p class="muted">Banco personal de preguntas. Tu progreso se guarda en tu cuenta.</p>
          <form id="login-form">
            <div class="form-row"><label for="email">Correo</label><input class="input" id="email" type="email" autocomplete="email" required></div>
            <div class="form-row"><label for="password">Contraseña</label><input class="input" id="password" type="password" autocomplete="current-password" minlength="6" required></div>
            <button class="btn primary" type="submit" style="width:100%">Iniciar sesión</button>
            <div id="login-error" class="error-msg">${esc(message)}</div>
          </form>
        </div>
      </div>`;

    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errorEl = document.getElementById('login-error');
      errorEl.textContent = 'Entrando…';
      const { error } = await supa.auth.signInWithPassword({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('password').value,
      });
      if (error) { errorEl.textContent = error.message; return; }
      const { data } = await supa.auth.getSession();
      user = data.session?.user || null;
      await loadCloudData();
    });
  }

  async function fetchAllQuestions() {
    const pageSize = 500;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supa.from('questions')
        .select('*')
        .eq('active', true)
        .order('year', { ascending: false })
        .order('test')
        .order('question_number')
        .range(from, from + pageSize - 1);
      if (error) return { data: null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data: all, error: null };
  }

  async function fetchAllAttempts() {
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supa.from('attempts')
        .select('*')
        .order('answered_at', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return { data: null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data: all, error: null };
  }

  async function fetchAllMemoryStates() {
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supa.from('question_memory_state')
        .select('*')
        .range(from, from + pageSize - 1);
      if (error) return { data: null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data: all, error: null };
  }

  async function fetchAllReviewFlags() {
    const pageSize = 1000;
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supa.from('question_review_flags')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending:false })
        .range(from, from + pageSize - 1);
      if (error) return { data:null, error };
      all.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return { data:all, error:null };
  }

  async function resolveClosedRemoteConflictShadows(localRows = []) {
    if (!cloudConfigured || !user || !sessionStore) return localRows;
    const conflictRows = localRows.filter(row => row.status === 'active' && row.syncStatus === 'conflict' && row.id);
    if (!conflictRows.length) return localRows;

    const ids = [...new Set(conflictRows.map(row => row.id))];
    const { data, error } = await supa.from('practice_sessions').select('*').in('id', ids);
    if (error) return localRows;

    const remoteById = new Map((data || []).map(row => [row.id, row]));
    const resolved = new Set();
    for (const local of conflictRows) {
      const remote = remoteById.get(local.id);

      if (!remote) {
        // FIX-SESSION-013: una sombra `conflict` sin fila remota es un huérfano.
        // Antes de retirarla se exige evidencia persistente de recuperación equivalente;
        // si no existe, se crea una sola copia con UUID nuevo. Luego se elimina también
        // cualquier operación obsoleta del outbox para que el fantasma no resucite.
        let preserved = await localRecoveryFor(local, { allowCompleted:true, equivalentState:true });
        if (!preserved) preserved = await persistRecoverySession(local, 'orphan_conflict_shadow');
        if (preserved) {
          await retireLocalConflictShadow(local);
          resolved.add(local.id);
        }
        continue;
      }

      if (remote.status !== 'active') {
        // Si el servidor ya cerró la sesión, la sombra local conflictiva no debe seguir
        // apareciendo como reanudable. Los intentos respondidos se guardan aparte.
        await saveSessionShadow({ ...remote, syncStatus:'synced', syncError:null }, 'synced');
        await clearSessionOutbox(local.id);
        resolved.add(local.id);
        sessionSyncBlocked.delete(local.id);
        continue;
      }

      // Si la fuente remota continúa activa pero ya existe una recuperación completada
      // equivalente, el usuario ya cerró explícitamente la copia preservada. Retiramos
      // de forma optimista la fuente remota para impedir que vuelva a aparecer.
      const completedRecovery = await localRecoveryFor(local, { allowCompleted:true, equivalentState:true });
      if (completedRecovery?.status === 'completed') {
        await retireRecoverySourceAfterClose(completedRecovery);
        const { data:refetched } = await supa.from('practice_sessions').select('*').eq('id', local.id).maybeSingle();
        if (!refetched || refetched.status !== 'active') {
          await retireLocalConflictShadow(local);
          resolved.add(local.id);
        }
      }
    }

    return localRows.filter(row => !(resolved.has(row.id) && row.status === 'active' && row.syncStatus === 'conflict'));
  }

  async function loadCloudData() {
    clearTimer();
    app.innerHTML = `<div class="splash"><div class="logo-mark">R</div><p>Sincronizando cambios…</p></div>`;

    await loadCloudTtsCatalog();

    const [qRes, aRes, pRes, mRes, fRes, nRes] = await Promise.all([
      loadCorpusWithCache(),
      loadAttemptsIncremental(),
      supa.from('user_learning_profile').select('*').eq('user_id', user.id).maybeSingle(),
      loadMemoryIncremental(),
      loadFlagsIncremental(),
      loadLearningNotesIncremental(),
    ]);

    if (qRes.error) { renderLogin(`Error al cargar preguntas: ${qRes.error.message}`); return; }
    if (aRes.error) { renderLogin(`Error al cargar progreso: ${aRes.error.message}`); return; }
    if (pRes.error) { renderFatal(`Falta aplicar la migración v0.5 en Supabase: ${pRes.error.message}`); return; }
    if (mRes.error) { renderFatal(`No se pudo sincronizar la memoria: ${mRes.error.message}`); return; }
    if (fRes.error) { renderFatal(`No se pudieron sincronizar las observaciones: ${fRes.error.message}`); return; }
    await probeReviewLearningScopeAvailability();

    questions = normalizeQuestionCorpus(qRes.data || []);
    rentabilityTopics = qRes.topics || (W4Data.topicsFromQuestions ? W4Data.topicsFromQuestions(questions) : []);
    rentabilityTopicsById = new Map(rentabilityTopics.map(row => [String(row.id), row]));
    topicAliases = qRes.aliases || [];
    topicAliasBySourceId = new Map(topicAliases.map(row => [String(row.source_topic_id || ''), row]).filter(([key]) => key));
    topicAliasesBySourceLabel = new Map();
    for (const row of topicAliases) {
      const key = normalizeTopicSearch(row?.source_label || '');
      if (!key) continue;
      if (!topicAliasesBySourceLabel.has(key)) topicAliasesBySourceLabel.set(key, []);
      topicAliasesBySourceLabel.get(key).push(row);
    }
    rebuildCorpusRentability();
    const remoteAttempts = aRes.data || [];
    const shadowAttempts = sessionStore?.getAttemptsForUser
      ? await sessionStore.getAttemptsForUser(user.id)
      : (sessionStore ? await sessionStore.getAllAttempts() : []);
    const attemptsByClient = new Map();
    for (const row of remoteAttempts) attemptsByClient.set(row.client_attempt_id || row.id, row);
    for (const row of shadowAttempts) {
      const key = row.client_attempt_id || row.id;
      if (!attemptsByClient.has(key) || ['pending','offline','conflict'].includes(row.syncStatus)) attemptsByClient.set(key, row);
    }
    attempts = [...attemptsByClient.values()].sort((a,b) => new Date(a.answered_at || 0) - new Date(b.answered_at || 0));
    memoryStates = mRes.data || [];
    reviewFlagHistory = fRes.data || [];
    reviewFlags = activeReviewFlagRows(reviewFlagHistory);
    rebuildReviewFlagMap();
    learningNotesAvailable = !nRes.unavailable;
    learningNotesLoadError = nRes.reason || '';
    learningNoteHistory = nRes.data || [];
    learningNotes = activeLearningNoteRows(learningNoteHistory);
    rebuildLearningNoteMap();
    rebuildMemoryMap();

    if (pRes.data) profile = { ...DEFAULT_PROFILE, ...pRes.data };
    else {
      const profileRow = { ...DEFAULT_PROFILE, user_id:user.id, updated_at:new Date().toISOString() };
      const { data, error } = await supa.from('user_learning_profile').insert(profileRow).select().single();
      if (error) { renderFatal(`No se pudo crear tu perfil de aprendizaje: ${error.message}`); return; }
      profile = { ...DEFAULT_PROFILE, ...data };
    }

    historyPage = 0;
    const [sRes, firstHistoryPage] = await Promise.all([
      supa.from('practice_sessions').select('*').eq('user_id', user.id).eq('status', 'active').order('updated_at', { ascending:false }),
      fetchCompletedSessionsPage(0),
    ]);
    historyHasMore = firstHistoryPage.hasMore;
    const localSessionRowsRaw = sessionStore?.getSessionsForUser
      ? await sessionStore.getSessionsForUser(user.id)
      : (sessionStore ? await sessionStore.getAllSessions() : []);
    const localSessionRows = await resolveClosedRemoteConflictShadows(localSessionRowsRaw);
    const recoveryRows = await preserveStaleLocalSessionCopies(sRes.error ? [] : (sRes.data || []), localSessionRows);
    const localRowsWithRecoveries = [...localSessionRows, ...recoveryRows];
    const localActive = localRowsWithRecoveries.filter(row => row.status === 'active');
    const localCompleted = localRowsWithRecoveries.filter(row => row.status === 'completed');
    activeSessions = SessionCore.mergeSessionRows
      ? SessionCore.mergeSessionRows(sRes.error ? [] : (sRes.data || []), localActive).filter(row => row.status === 'active')
      : (sRes.error ? localActive : (sRes.data || []));
    completedSessions = SessionCore.mergeSessionRows
      ? SessionCore.mergeSessionRows(firstHistoryPage.error ? [] : (firstHistoryPage.data || []), localCompleted).filter(row => row.status === 'completed')
      : (firstHistoryPage.error ? localCompleted : (firstHistoryPage.data || []));
    await expireStaleActiveSessions();
    if (sessionStore) {
      // FIX-SESSION-004: persistir la fila elegida por reconciliacion, no sobrescribirla luego con el remoto bruto.
      for (const row of [...activeSessions, ...completedSessions]) {
        await sessionStore.putSession(row, row.syncStatus || 'synced');
      }
      await processSessionOutbox();
    }
    await reconcileMemoryFromAttempts();
    renderDashboard();
  }

  function topbar(title = 'Residentado', showHome = false) {
    return `<div class="topbar">
      <div class="logo-mark">R</div><div class="topbar-title-wrap"><h1>${esc(title)}</h1><small class="app-version">v${APP_VERSION}</small></div><div class="spacer"></div>
      ${showHome ? `<button class="btn small ghost" data-home>Inicio</button>` : ''}
      <div class="topbar-menu-wrap">
        <button id="account-menu-btn" class="btn small ghost icon-menu-btn" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="account-menu">⋮</button>
        <div id="account-menu" class="topbar-menu-popover" hidden>
          <button id="learning-notes-menu-btn" class="topbar-menu-item" type="button">🗒 Mis notas de aprendizaje <span class="menu-count" data-learning-notes-count>${learningNotes.length}</span></button>
          <button id="review-flags-menu-btn" class="topbar-menu-item" type="button">⚑ Preguntas para revisar <span class="menu-count" data-review-flags-count>${reviewFlags.length}</span></button>
          ${cloudConfigured ? '<button id="logout-btn" class="topbar-menu-item danger-menu-item" type="button">Salir de la cuenta</button>' : ''}
        </div>
      </div>
    </div>`;
  }

  function attachTopbar() {
    document.querySelectorAll('[data-home]').forEach(b => b.onclick = renderDashboard);

    const menuBtn = document.getElementById('account-menu-btn');
    const menu = document.getElementById('account-menu');
    if (menuBtn && menu) {
      menuBtn.onclick = (ev) => {
        ev.stopPropagation();
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        menuBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen) {
          setTimeout(() => {
            document.addEventListener('click', () => {
              menu.hidden = true;
              menuBtn.setAttribute('aria-expanded', 'false');
            }, { once:true });
          }, 0);
        }
      };
      menu.onclick = ev => ev.stopPropagation();
    }

    const learningNotesMenu = document.getElementById('learning-notes-menu-btn');
    if (learningNotesMenu) learningNotesMenu.onclick = () => renderLearningNotesPage();
    const reviewFlagsMenu = document.getElementById('review-flags-menu-btn');
    if (reviewFlagsMenu) reviewFlagsMenu.onclick = () => renderReviewFlagsPage();

    const logout = document.getElementById('logout-btn');
    if (logout) logout.onclick = async () => {
      if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
      releaseActiveSessionLease();
      await supa.auth.signOut();
      user = null;
      renderLogin();
    };
  }

  function percentile(values, p = 0.7) {
    const sorted = values.filter(Number.isFinite).slice().sort((a,b) => a-b);
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[idx];
  }

  function normalizeCorpusLabel(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function corpusTopicKey(q) {
    const topic = normalizeCorpusLabel(q.topic || q.subtopic || '');
    if (!topic) return null;
    return [
      normalizeCorpusLabel(q.area || 'Sin área'),
      normalizeCorpusLabel(q.specialty || 'Sin especialidad'),
      topic,
    ].join('|||');
  }

  function rebuildCorpusRentability() {
    const valid = questions.filter(q => !observed(q));
    const corpusYears = new Set(valid.map(q => Number(q.year)).filter(Number.isFinite));
    const yearsCount = Math.max(1, corpusYears.size);

    // v0.6.10: la taxonomía editorial usa temas muy granulares y, por tanto,
    // muchos temas exactos aparecen una sola vez. La rentabilidad combina
    // recurrencia de tema + especialidad + área, en lugar de exigir que el
    // nombre exacto del tema se repita varias veces.
    const levels = [
      { name: 'topic', field: q => q.topic || q.subtopic || '', frequencyWeight: 0.62, breadthWeight: 0.38 },
      { name: 'specialty', field: q => q.specialty || '', frequencyWeight: 0.65, breadthWeight: 0.35 },
      { name: 'area', field: q => q.area || '', frequencyWeight: 0.70, breadthWeight: 0.30 },
    ];

    const statsByLevel = new Map();
    for (const level of levels) {
      const groups = new Map();
      for (const q of valid) {
        const key = normalizeCorpusLabel(level.field(q));
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, { count: 0, years: new Set() });
        const g = groups.get(key);
        g.count += 1;
        if (Number.isFinite(Number(q.year))) g.years.add(Number(q.year));
      }
      const maxCount = Math.max(1, ...[...groups.values()].map(g => g.count));
      statsByLevel.set(level.name, { groups, maxCount });
    }

    const scoredQuestions = valid.map(q => {
      const components = {};
      for (const level of levels) {
        const key = normalizeCorpusLabel(level.field(q));
        const { groups, maxCount } = statsByLevel.get(level.name);
        const g = key ? groups.get(key) : null;
        if (!g) {
          components[level.name] = 0;
          continue;
        }
        const frequency = Math.sqrt(g.count / maxCount);
        const breadth = g.years.size / yearsCount;
        components[level.name] = clamp(
          level.frequencyWeight * frequency + level.breadthWeight * breadth,
          0,
          1
        );
      }

      const score = clamp(
        0.50 * components.topic +
        0.35 * components.specialty +
        0.15 * components.area,
        0,
        1
      );

      return { q, score, components };
    });

    // Selecciona aproximadamente el 30% superior del corpus cargado.
    // Es una estimación histórica provisional hasta la auditoría final de las 2.180 preguntas.
    const threshold = percentile(scoredQuestions.map(x => x.score), 0.70);
    const effectiveThreshold = threshold == null ? 1.1 : Math.max(0.42, threshold);

    corpusRentabilityByQuestion = new Map();
    for (const item of scoredQuestions) {
      const explicit = explicitRentabilityTier(item.q);
      const explicitHigh =
        explicit.includes('MUY_ALTA') ||
        explicit.includes('MUY ALTA') ||
        explicit.startsWith('ALTA');

      const high = explicitHigh || item.score >= effectiveThreshold;
      corpusRentabilityByQuestion.set(item.q.id, {
        score: explicitHigh ? 1 : item.score,
        high,
        topicScore: item.components.topic,
        specialtyScore: item.components.specialty,
        areaScore: item.components.area,
        source: explicitHigh ? 'explicit' : 'corpus_runtime_v2',
      });
    }

    corpusRentabilityMeta = {
      highCount: [...corpusRentabilityByQuestion.values()].filter(x => x.high).length,
      groupCount: statsByLevel.get('topic')?.groups?.size || 0,
      yearsCount: corpusYears.size,
      threshold: Number.isFinite(effectiveThreshold) ? Number(effectiveThreshold.toFixed(3)) : null,
    };
  }

  function explicitRentabilityTier(q) {
    const tier = String(q.rentability_tier || q.rentability_status || '').toUpperCase().trim();
    if (!tier || tier.includes('PENDIENTE')) return '';
    return tier;
  }

  function isHighRentability(q) {
    const explicit = explicitRentabilityTier(q);
    if (explicit.includes('MUY_ALTA') || explicit.includes('MUY ALTA') || explicit.startsWith('ALTA')) return true;
    return Boolean(corpusRentabilityByQuestion.get(q.id)?.high);
  }

  function normalizedExplicitRentabilityTier(q) {
    return explicitRentabilityTier(q).replace(/\s+/g, '_');
  }

  function matchesRentabilityFilter(q, filter = 'all') {
    if (!filter || filter === 'all') return true;
    if (filter === 'high') return isHighRentability(q);
    const explicit = normalizedExplicitRentabilityTier(q);
    if (filter === 'muy_alta') return explicit === 'MUY_ALTA';
    if (filter === 'alta') return explicit === 'ALTA';
    if (filter === 'media') return explicit === 'MEDIA';
    if (filter === 'baja') return explicit === 'BAJA';
    return true;
  }

  function sortByPriority(list, now = new Date(), { diversifyYears = false, tolerance = 0.75 } = {}) {
    const scored = list.map(q => ({ q, score: questionPriority(q, now), year: String(q.year || '') }))
      .sort((a,b) => b.score - a.score || a.q.id.localeCompare(b.q.id));
    if (!diversifyYears || scored.length < 2) return scored.map(x => x.q);

    const queues = new Map();
    for (const item of scored) {
      if (!queues.has(item.year)) queues.set(item.year, []);
      queues.get(item.year).push(item);
    }

    const result = [];
    let lastYear = null;
    while (result.length < scored.length) {
      const heads = [...queues.entries()]
        .filter(([,queue]) => queue.length)
        .map(([year,queue]) => ({ year, item:queue[0] }))
        .sort((a,b) => b.item.score - a.item.score || a.item.q.id.localeCompare(b.item.q.id));
      if (!heads.length) break;

      let chosen = heads[0];
      if (chosen.year === lastYear) {
        const alternative = heads.find(h => h.year !== lastYear && h.item.score >= chosen.item.score - tolerance);
        if (alternative) chosen = alternative;
      }

      result.push(queues.get(chosen.year).shift().q);
      lastYear = chosen.year;
    }
    return result;
  }

  function questionStats(qid) {
    const qa = attempts.filter(a => a.question_id === qid);
    return {
      seen: qa.length,
      correct: qa.filter(a => a.is_correct).length,
      wrong: qa.filter(a => !a.is_correct).length,
    };
  }

  function overallStats() {
    const answeredIds = new Set(attempts.map(a => a.question_id));
    const correct = attempts.filter(a => a.is_correct).length;
    const audited = attempts.filter(a => {
      const q = questions.find(x => x.id === a.question_id);
      return q && !observed(q);
    });
    const auditedCorrect = audited.filter(a => a.is_correct).length;
    const positiveTimes = attempts.map(a => Number(a.response_time_ms || 0)).filter(v => v > 0);
    const avg = positiveTimes.length ? positiveTimes.reduce((s,v) => s + v, 0) / positiveTimes.length : null;
    return { answered: answeredIds.size, correct, audited, auditedCorrect, avg };
  }


  function attemptsForQuestion(qid) { return attempts.filter(a => a.question_id === qid); }

  function extendedQuestionStats(q) {
    const qa = attemptsForQuestion(q.id)
      .slice()
      .sort((a,b) => new Date(a.answered_at) - new Date(b.answered_at));
    const recent = qa.slice(-5);
    const positive = recent.map(a => Number(a.response_time_ms || 0)).filter(v => v > 0);
    const correct = recent.filter(a => a.is_correct).length;
    const wrong = recent.length - correct;
    const avgMs = positive.length ? positive.reduce((s,v)=>s+v,0)/positive.length : null;
    const targetMs = effectiveTargetSeconds(q) * 1000;
    const fluent = recent.filter(a => a.is_correct && Number(a.response_time_ms || 0) <= Number(a.target_seconds || targetMs / 1000) * 1000).length;
    return { seen:qa.length, recentN:recent.length, correct, wrong, avgMs, fluent };
  }

  function rentabilityWeight(q) {
    if (Number.isFinite(Number(q.exam_rentability_score))) {
      return clamp(Number(q.exam_rentability_score) / 100, 0, 1);
    }
    if (Number.isFinite(Number(q.rentability_score))) return clamp(Number(q.rentability_score), 0, 1);
    const tier = explicitRentabilityTier(q);
    if (tier.includes('MUY_ALTA') || tier.includes('MUY ALTA')) return 1;
    if (tier.includes('ALTA')) return 0.85;
    if (tier.includes('MEDIA')) return 0.6;
    if (tier.includes('BAJA')) return 0.35;
    return corpusRentabilityByQuestion.get(q.id)?.score ?? 0.55;
  }

  function questionPriority(q, now = new Date()) {
    const s = extendedQuestionStats(q);
    const state = memoryByQuestion.get(q.id);
    const recall = estimateRecall(state, now);
    const qAttempts = attemptsForQuestion(q.id);
    const latestAttempt = qAttempts.length
      ? qAttempts.slice().sort((a,b) => new Date(b.answered_at) - new Date(a.answered_at))[0]
      : null;
    const retention = targetRetention(isoDateLocal(now), q);
    const duePressure = state
      ? Math.max(0, retention - recall) * 8 + Math.max(0, (now - new Date(state.due_at)) / 86400000) * 0.35
      : 2.2;
    const weakness = s.seen ? (s.wrong / s.seen) * 3.2 : 1.4;
    const targetSeconds = effectiveTargetSeconds(q);
    const speed = s.avgMs ? Math.max(0, (s.avgMs / 1000 - targetSeconds) / 15) : 0.8;
    const rent = rentabilityWeight(q) * 2.6;
    const unseen = s.seen ? 0 : 1.2;
    const wrongFast = qAttempts.slice(-3).some(a => a.speed_bucket === 'wrong_fast') ? 1.2 : 0;
    const uncertainty = latestAttempt?.was_uncertain
      ? (latestAttempt.is_correct ? 1.4 : 2.6)
      : 0;
    const wrongUncertainBoost = latestAttempt?.was_uncertain && !latestAttempt?.is_correct ? 1.4 : 0;
    const observedPenalty = observed(q) ? -2.5 : 0;
    return duePressure + weakness + speed + rent + unseen + wrongFast + uncertainty + wrongUncertainBoost + observedPenalty;
  }

  function rentabilityTierRank(q) {
    const tier = explicitRentabilityTier(q);
    if (tier.includes('MUY_ALTA') || tier.includes('MUY ALTA')) return 4;
    if (tier.startsWith('ALTA')) return 3;
    if (tier.includes('MEDIA')) return 2;
    if (tier.includes('BAJA')) return 1;
    return 0;
  }

  function overdueDays(q, now = new Date()) {
    const state = memoryByQuestion.get(q?.id);
    if (!state?.due_at) return 0;
    const dueMs = new Date(state.due_at).getTime();
    if (!Number.isFinite(dueMs)) return 0;
    return Math.max(0, (now.getTime() - dueMs) / 86400000);
  }

  function reviewEligible(q, now = new Date()) {
    if (!q || observed(q)) return false;
    const state = memoryByQuestion.get(q.id);
    if (!state?.due_at || !state?.last_attempt_at || !Number(state?.stability_days)) return false;
    const dueMs = new Date(state.due_at).getTime();
    if (Number.isFinite(dueMs) && dueMs <= now.getTime()) return true;

    // v1.5.2 — al cambiar la retención objetivo no reescribimos due_at histórico,
    // pero la selección debe respetar el objetivo vigente. Esto equivale a un
    // reschedule virtual: si el recuerdo estimado ya cayó bajo targetRetention,
    // la pregunta entra al pool aunque su due_at antiguo aún esté en el futuro.
    const recall = estimateRecall(state, now);
    const retention = targetRetention(isoDateLocal(now), q);
    return recall < retention;
  }

  function dueReviewPool(now = new Date()) {
    const due = questions.filter(q => reviewEligible(q, now));
    const priority = sortByPriority(due, now, { diversifyYears:true, tolerance:0.35 });
    const staleHigh = due
      .filter(q => rentabilityTierRank(q) >= 3)
      .slice()
      .sort((a,b) => {
        const ageDiff = overdueDays(b, now) - overdueDays(a, now);
        if (Math.abs(ageDiff) > 1e-9) return ageDiff;
        return questionPriority(b, now) - questionPriority(a, now) || a.id.localeCompare(b.id);
      });

    // v1.5.1 — anti-starvation preexamen.
    // Una cola que se responde parcialmente no puede esconder indefinidamente preguntas
    // MUY_ALTA/ALTA antiguamente vencidas detrás de las mismas preguntas de score alto.
    // Aproximadamente una de cada dos posiciones iniciales se reserva para la vencida
    // MUY_ALTA/ALTA más antigua todavía no incluida; el resto conserva prioridad adaptativa.
    if (!staleHigh.length) return priority;
    const result = [];
    const used = new Set();
    let staleIndex = 0;
    let priorityIndex = 0;
    const take = q => {
      if (!q || used.has(q.id)) return false;
      used.add(q.id);
      result.push(q);
      return true;
    };
    while (result.length < due.length) {
      const preferStale = result.length % 2 === 0;
      if (preferStale) {
        while (staleIndex < staleHigh.length && !take(staleHigh[staleIndex])) staleIndex += 1;
        if (staleIndex < staleHigh.length) staleIndex += 1;
      }
      while (priorityIndex < priority.length && !take(priority[priorityIndex])) priorityIndex += 1;
      if (priorityIndex < priority.length) priorityIndex += 1;
      if (result.length >= due.length) break;
      if (!preferStale) {
        while (staleIndex < staleHigh.length && !take(staleHigh[staleIndex])) staleIndex += 1;
        if (staleIndex < staleHigh.length) staleIndex += 1;
      }
      if (staleIndex >= staleHigh.length && priorityIndex >= priority.length) break;
    }
    for (const q of priority) take(q);
    return result;
  }

  function unseenCoveragePool(now = new Date()) {
    const seen = new Set(attempts.map(a => a.question_id));
    const unseen = questions.filter(q => !observed(q) && !seen.has(q.id));
    const ordered = [];
    for (const rank of [4,3,2,1,0]) {
      ordered.push(...sortByPriority(unseen.filter(q => rentabilityTierRank(q) === rank), now, { diversifyYears:true, tolerance:0.75 }));
    }
    return ordered;
  }

  function latestAttemptsMap() {
    const latest = new Map();
    for (const attempt of attempts) {
      const prev = latest.get(attempt.question_id);
      if (!prev || new Date(attempt.answered_at) > new Date(prev.answered_at)) latest.set(attempt.question_id, attempt);
    }
    return latest;
  }

  function attemptedTodayIds(dateIso = isoDateLocal()) {
    return new Set(attempts.filter(a => isoDateLocal(a.answered_at) === dateIso).map(a => a.question_id));
  }

  function smartPool(kind = 'priority') {
    const now = new Date();
    const nonObserved = questions.filter(q => !observed(q));
    if (kind === 'due') {
      // Incluye vencidas por due_at y, desde v1.5.2, preguntas cuyo recuerdo estimado
      // ya cayó bajo la retención objetivo vigente. No reescribe due_at ni memoria.
      return dueReviewPool(now);
    }
    if (kind === 'new') {
      const unseen = nonObserved.filter(q => !attempts.some(a => a.question_id === q.id));
      return sortByPriority(unseen, now, { diversifyYears:true, tolerance:0.75 });
    }
    if (kind === 'new_coverage') {
      // Primera vuelta: MUY_ALTA → ALTA → MEDIA → BAJA, y dentro de cada tier
      // conserva el orden adaptativo por prioridad/rentabilidad.
      return unseenCoveragePool(now);
    }
    if (kind === 'fragile') {
      const latest = latestAttemptsMap();
      const fragile = nonObserved.filter(q => {
        const a = latest.get(q.id);
        if (!a) return false;
        if (!a.is_correct || a.was_uncertain) return true;
        const qa = attemptsForQuestion(q.id).slice(-3);
        return qa.length >= 2 && qa.filter(x => x.is_correct).length / qa.length < 0.67;
      });
      return sortByPriority(fragile, now, { diversifyYears:true, tolerance:0.45 });
    }
    if (kind === 'errors') {
      const ids = new Set(attempts.filter(a => !a.is_correct).map(a => a.question_id));
      return sortByPriority(nonObserved.filter(q => ids.has(q.id)), now, { diversifyYears:true, tolerance:0.5 });
    }
    if (kind === 'uncertain') {
      const latestByQuestion = new Map();
      for (const a of attempts) {
        const prev = latestByQuestion.get(a.question_id);
        if (!prev || new Date(a.answered_at) > new Date(prev.answered_at)) latestByQuestion.set(a.question_id, a);
      }
      return sortByPriority(
        nonObserved.filter(q => latestByQuestion.get(q.id)?.was_uncertain),
        now,
        { diversifyYears:true, tolerance:0.5 }
      );
    }
    if (kind === 'speed') {
      const latest = latestAttemptsMap();
      const ratio = q => {
        const a = latest.get(q.id);
        const target = Number(a?.target_seconds || effectiveTargetSeconds(q));
        return target > 0 ? (Number(a?.response_time_ms || 0) / 1000) / target : 0;
      };
      return nonObserved.filter(q => {
        const a = latest.get(q.id);
        if (!a || !a.is_correct || a.was_uncertain) return false;
        return ratio(q) > 1;
      }).sort((a,b) => ratio(b) - ratio(a));
    }
    if (kind === 'high') {
      const high = nonObserved.filter(isHighRentability);
      return sortByPriority(high.length ? high : nonObserved, now, { diversifyYears:true, tolerance:0.7 });
    }
    return sortByPriority(nonObserved, now, { diversifyYears:true, tolerance:0.75 });
  }


  function weaknessReportData() {
    const now = new Date();
    const groups = new Map();
    const validQuestions = questions.filter(q => !observed(q));

    for (const q of validQuestions) {
      const topicId = q.rentability_topic_id || `LEGACY:${q.area || ''}:${q.specialty || ''}:${q.topic || q.subtopic || ''}`;
      const area = q.canonical_area || q.area || 'Sin área';
      const specialty = q.canonical_specialty || q.specialty || 'Sin especialidad';
      const topic = q.rentability_topic_label || q.topic || q.subtopic || 'Sin clasificar';
      const key = String(topicId);

      if (!groups.has(key)) {
        groups.set(key, {
          key, topicId, area, specialty, topic,
          rentabilityTier:q.rentability_tier || null,
          rentabilityScore:q.exam_rentability_score == null ? null : Number(q.exam_rentability_score),
          totalQuestions:0, seenQuestions:0, attempts:0,
          latestWrong:0, latestUncertain:0, latestWrongUncertain:0,
          latestSlow:0, dueQuestions:0, allAttempts:[], questionIds:[],
        });
      }

      const g = groups.get(key);
      g.totalQuestions += 1;
      g.questionIds.push(q.id);

      const qa = attemptsForQuestion(q.id)
        .slice()
        .sort((a,b) => new Date(b.answered_at) - new Date(a.answered_at));

      if (!qa.length) continue;

      g.seenQuestions += 1;
      g.attempts += qa.length;
      g.allAttempts.push(...qa);

      const latest = qa[0];
      if (!latest.is_correct) g.latestWrong += 1;
      if (latest.was_uncertain) g.latestUncertain += 1;
      if (latest.was_uncertain && !latest.is_correct) g.latestWrongUncertain += 1;

      const targetMs = effectiveTargetSeconds(q) * 1000;
      if (Number(latest.response_time_ms || 0) > targetMs) g.latestSlow += 1;

      const state = memoryByQuestion.get(q.id);
      if (state?.due_at && new Date(state.due_at) <= now) g.dueQuestions += 1;
    }

    return [...groups.values()].map(g => {
      const seen = Math.max(1, g.seenQuestions);
      const latestWrongRate = g.latestWrong / seen;
      const latestUncertaintyRate = g.latestUncertain / seen;
      const latestWrongUncertainRate = g.latestWrongUncertain / seen;
      const latestSlowRate = g.latestSlow / seen;
      const dueRate = g.dueQuestions / seen;

      const recent = g.allAttempts
        .slice()
        .sort((a,b) => new Date(b.answered_at) - new Date(a.answered_at))
        .slice(0, 10);

      const recentErrorRate = recent.length
        ? recent.filter(a => !a.is_correct).length / recent.length
        : 0;

      const score = g.seenQuestions
        ? Math.round(100 * clamp(
            0.35 * latestWrongRate +
            0.20 * latestUncertaintyRate +
            0.15 * latestWrongUncertainRate +
            0.10 * latestSlowRate +
            0.10 * recentErrorRate +
            0.10 * dueRate,
            0, 1
          ))
        : 0;

      const evidence =
        (g.seenQuestions >= 10 || g.attempts >= 20) ? 'Alta' :
        (g.seenQuestions >= 5 || g.attempts >= 8) ? 'Media' : 'Baja';

      const level =
        score >= 60 ? 'Crítica' :
        score >= 45 ? 'Alta' :
        score >= 30 ? 'Moderada' :
        score >= 15 ? 'Vigilancia' : 'Controlada';
      const tts = ttsCatalogByTopic.get(g.topicId) || null;

      return {
        ...g,
        score,
        evidence,
        level,
        latestAccuracy: 1 - latestWrongRate,
        latestUncertaintyRate,
        latestWrongUncertainRate,
        latestSlowRate,
        dueRate,
        recentErrorRate,
        coverage: g.totalQuestions ? g.seenQuestions / g.totalQuestions : 0,
        tts,
        ttsStatusLabel: W4Data.catalogCompactLabel ? W4Data.catalogCompactLabel(tts) : (W4Data.catalogStatusLabel ? W4Data.catalogStatusLabel(tts) : (tts?.status || 'Pendiente')),
      };
    }).sort((a,b) =>
      b.score - a.score ||
      b.latestWrongUncertainRate - a.latestWrongUncertainRate ||
      Number(b.rentabilityScore || 0) - Number(a.rentabilityScore || 0) ||
      b.attempts - a.attempts
    );
  }


  function priorityReadingAlertData() {
    const report = weaknessReportData().filter(x => x.seenQuestions > 0);
    if (!report.length) return null;

    const strongSignal = report.find(x =>
      (x.level === 'Crítica' || x.level === 'Alta') &&
      (x.evidence === 'Media' || x.evidence === 'Alta')
    );

    const earlyCritical = report.find(x => x.level === 'Crítica');
    const moderateStrong = report.find(x =>
      x.level === 'Moderada' &&
      (x.evidence === 'Media' || x.evidence === 'Alta')
    );

    const item = strongSignal || earlyCritical || moderateStrong || null;
    if (!item) return null;

    const qs = questions.filter(q => item.questionIds.includes(q.id));
    const focus = [...new Set(qs.flatMap(q => [
      q.subtopic,
      q.comparison_title,
      q.topic !== item.topic ? q.topic : null,
    ].filter(Boolean)))].slice(0, 4);

    const reasons = [];
    if (item.latestAccuracy < 0.7) reasons.push(`dominio actual ${Math.round(item.latestAccuracy * 100)}%`);
    if (item.latestWrongUncertainRate >= 0.15) reasons.push(`error + duda ${Math.round(item.latestWrongUncertainRate * 100)}%`);
    else if (item.latestUncertaintyRate >= 0.2) reasons.push(`duda ${Math.round(item.latestUncertaintyRate * 100)}%`);
    if (item.latestSlowRate >= 0.3) reasons.push(`respuestas lentas ${Math.round(item.latestSlowRate * 100)}%`);
    if (item.dueQuestions > 0) reasons.push(`${item.dueQuestions} repaso${item.dueQuestions === 1 ? '' : 's'} vencido${item.dueQuestions === 1 ? '' : 's'}`);

    return {
      ...item,
      focus,
      reasonText: reasons.length ? reasons.join(' · ') : `prioridad adaptativa ${item.score}/100`,
    };
  }

  function priorityReadingPrompt(item) {
    if (W4Data.ttsRequestForTopic) {
      return W4Data.ttsRequestForTopic(
        { topicId:item.topicId, label:item.topic, area:item.area, specialty:item.specialty },
        item.tts || null,
        item
      );
    }
    const focus = item.focus?.length
      ? `Enfócate especialmente en: ${item.focus.join(', ')}.`
      : 'Enfócate en diagnóstico, criterios, manejo, puntos de corte y trampas de examen.';
    return [
      'Necesito un repaso de lectura prioritaria para el Residentado Médico Perú.',
      `Tema crítico: ${item.topic}.`,
      `Área: ${item.area}. Especialidad: ${item.specialty}.`,
      `Motivo de prioridad: ${item.reasonText}.`,
      focus,
      'Haz un resumen de 15–25 minutos de lectura, orientado al examen.',
    ].join('\n');
  }


  function priorityReadingAlertMarkup(item, prefix = 'priority-reading') {
    if (!item) return '';
    const focus = item.focus?.length
      ? `<ul>${item.focus.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '<p class="muted">Repasa diagnóstico, criterios, manejo, puntos de corte y trampas frecuentes.</p>';

    return `<section class="panel priority-reading-alert">
      <div class="priority-reading-copy">
        <span class="roadmap-kicker">🚨 ALERTA DE LECTURA PRIORITARIA</span>
        <h2>${esc(item.topic)}</h2>
        <p>${esc(item.reasonText)} · evidencia ${esc(item.evidence.toLowerCase())}</p>
        <div class="priority-reading-metrics">
          <span>Dominio <strong>${Math.round(item.latestAccuracy * 100)}%</strong></span>
          <span>Prioridad <strong>${item.score}/100</strong></span>
          <span>Cobertura <strong>${item.seenQuestions}/${item.totalQuestions}</strong></span>
          <span>TTS <strong>${esc(item.ttsStatusLabel || 'Pendiente')}</strong></span>
        </div>
        <div class="priority-reading-focus">
          <strong>Lee primero:</strong>
          ${focus}
        </div>
      </div>
      <div class="priority-reading-actions">
        <button id="${prefix}-copy" class="btn primary">📋 ${item.tts && item.tts.status !== 'PENDING' ? 'Copiar pedido de suplemento' : 'Copiar pedido TTS'}</button>
        <button id="${prefix}-practice" class="btn">🔥 Practicar este tema</button>
      </div>
    </section>`;
  }

  function attachPriorityReadingAlert(item, prefix = 'priority-reading') {
    if (!item) return;

    const copyBtn = document.getElementById(`${prefix}-copy`);
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const prompt = priorityReadingPrompt(item);
        try {
          await navigator.clipboard.writeText(prompt);
        } catch {
          const box = document.createElement('textarea');
          box.value = prompt;
          box.style.position = 'fixed';
          box.style.left = '-9999px';
          document.body.appendChild(box);
          box.select();
          document.execCommand('copy');
          box.remove();
        }
        const original = copyBtn.textContent;
        copyBtn.textContent = '✓ Pedido copiado';
        setTimeout(() => { copyBtn.textContent = original; }, 1800);
      };
    }

    const practiceBtn = document.getElementById(`${prefix}-practice`);
    if (practiceBtn) practiceBtn.onclick = () => launchWeakTopicPractice(item, 10);
  }

  function weaknessLevelClass(level) {
    if (level === 'Crítica' || level === 'Alta') return 'bad';
    if (level === 'Moderada') return 'warn';
    return 'ok';
  }

  function weaknessReportText(report) {
    const generated = new Date().toLocaleString();
    const top = report.filter(x => x.seenQuestions > 0).slice(0, 20);
    const lowCoverage = report
      .filter(x => x.totalQuestions >= 3 && x.coverage < 0.35)
      .sort((a,b) => a.coverage - b.coverage || b.totalQuestions - a.totalQuestions)
      .slice(0, 10);

    const lines = [
      'INFORME DINÁMICO DE DEBILIDADES — RESIDENTADO',
      `Generado: ${generated}`,
      `Banco cargado: ${questions.length} preguntas`,
      `Intentos acumulados: ${attempts.length}`,
      '',
      'Nota: la prioridad es un indicador adaptativo heurístico, no una predicción de puntaje.',
      'Se recalcula con respuestas más recientes, dudas (?), error+duda, lentitud, errores recientes y repasos vencidos.',
      '',
      'TOP DEBILIDADES ACTUALES',
    ];

    if (!top.length) lines.push('Aún no hay suficientes respuestas para identificar debilidades.');

    top.forEach((x, i) => {
      lines.push(
        `${i+1}. ${x.topic} — ${x.level} (${x.score}/100, evidencia ${x.evidence})`,
        `   Área: ${x.area} | Especialidad: ${x.specialty}`,
        `   Dominio actual: ${Math.round(x.latestAccuracy*100)}% | Duda ?: ${Math.round(x.latestUncertaintyRate*100)}% | Error+?: ${Math.round(x.latestWrongUncertainRate*100)}% | Lentas: ${Math.round(x.latestSlowRate*100)}%`,
        `   Cobertura: ${x.seenQuestions}/${x.totalQuestions} | Intentos: ${x.attempts} | Repasos vencidos: ${x.dueQuestions}`,
        `   Rentabilidad: ${x.rentabilityTier || 'sin clasificar'}${x.rentabilityScore == null ? '' : ` (${Math.round(x.rentabilityScore)})`} | TTS: ${x.ttsStatusLabel || 'Pendiente'}`,
      );
    });

    lines.push('', 'TEMAS POCO EXPLORADOS (NO NECESARIAMENTE DÉBILES)');
    if (!lowCoverage.length) lines.push('Sin brechas de cobertura destacables con el banco actual.');
    lowCoverage.forEach((x, i) => {
      lines.push(`${i+1}. ${x.topic} — cobertura ${x.seenQuestions}/${x.totalQuestions} (${Math.round(x.coverage*100)}%)`);
    });

    lines.push(
      '',
      'SOLICITUD PARA REPASO',
      'Usa este informe para priorizar un repaso dirigido al Residentado Médico Perú.',
      'Primero trabaja los temas con prioridad Crítica/Alta y evidencia Media/Alta.',
      'En cada tema, enfócate en los conceptos que expliquen errores y alternativas marcadas con ?.',
      'Distingue claramente lo que debo memorizar, las trampas de examen y los algoritmos/puntos de corte relevantes.'
    );

    return lines.join('\n');
  }

  async function copyWeaknessReport(report) {
    const text = weaknessReportText(report);
    try {
      await navigator.clipboard.writeText(text);
      alert('Informe copiado. Ya puedes pegarlo directamente en el chat.');
    } catch {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.position = 'fixed';
      box.style.left = '-9999px';
      document.body.appendChild(box);
      box.select();
      document.execCommand('copy');
      box.remove();
      alert('Informe copiado. Ya puedes pegarlo directamente en el chat.');
    }
  }

  function launchWeakTopicPractice(item, count = 10) {
    const pool = questions
      .filter(q => !observed(q) && item.questionIds.includes(q.id))
      .sort((a,b) => questionPriority(b) - questionPriority(a));

    const selected = pool.slice(0, Math.min(count, pool.length));
    if (!selected.length) return renderMessage('Tema débil', 'No hay preguntas disponibles para este tema.');

    launchStudy(selected, {
      mode:'study',
      count:selected.length,
      randomize:false,
      feedback:'immediate',
      timeMode:'none',
      secondsPerQuestion:Number(profile?.target_response_seconds || 25),
      totalSeconds:0,
      title:`Refuerzo · ${item.topic}`,
      studyMode:'weakness_report',
    });
  }

  function renderWeaknessReport() {
    clearTimer();
    const report = weaknessReportData();
    const withData = report.filter(x => x.seenQuestions > 0);
    const top = withData.slice(0, 20);
    const lowCoverage = report
      .filter(x => x.totalQuestions >= 3 && x.coverage < 0.35)
      .sort((a,b) => a.coverage - b.coverage || b.totalQuestions - a.totalQuestions)
      .slice(0, 12);

    const critical = withData.filter(x => x.level === 'Crítica').length;
    const high = withData.filter(x => x.level === 'Alta').length;
    const uncertainTopics = withData.filter(x => x.latestUncertaintyRate > 0).length;

    app.innerHTML = `<main class="shell">${topbar('Informe dinámico de debilidades', true)}
      <section class="panel weakness-report-hero">
        <div>
          <span class="roadmap-kicker">SE RECALCULA CON CADA RESPUESTA</span>
          <h1>Tu mapa actual de debilidades</h1>
          <p class="muted">Usa el estado más reciente de cada pregunta: errores, dudas <strong>?</strong>, error+duda, lentitud, errores recientes y repasos vencidos. Una pregunta incorrecta con <strong>?</strong> recibe prioridad adicional.</p>
          <small class="tts-catalog-meta">Disponibilidad TTS: ${availableTtsCount(rentabilityTopics.length ? rentabilityTopics : null)} temas · catálogo ${esc(ttsCatalog.catalogVersion || '—')} · ${ttsCatalogSource === 'supabase' ? 'Supabase' : 'respaldo local'}</small>
        </div>
        <div class="actions">
          <button id="copy-weakness-report" class="btn primary">📋 Copiar informe para ChatGPT</button>
          <button id="practice-top-weakness" class="btn">🔥 Practicar lo más débil</button>
        </div>
      </section>

      <section class="kpis">
        <div class="kpi"><div class="value">${critical}</div><div class="label">Temas críticos</div></div>
        <div class="kpi"><div class="value">${high}</div><div class="label">Prioridad alta</div></div>
        <div class="kpi"><div class="value">${uncertainTopics}</div><div class="label">Temas con duda ?</div></div>
        <div class="kpi"><div class="value">${withData.length}</div><div class="label">Temas con evidencia</div></div>
      </section>

      <section class="panel">
        <div class="section-head"><div><h2>Prioridades actuales</h2><p class="muted">El índice 0–100 es interno y adaptativo; no equivale a tu porcentaje de aciertos ni predice tu nota.</p></div></div>
        ${top.length ? `<div class="table-wrap"><table class="weakness-table">
          <thead><tr>
            <th>Prioridad</th><th>Tema</th><th>Área</th>
            <th class="num">Dominio actual</th><th class="num">Duda ?</th>
            <th class="num">Error + ?</th><th class="num">Lentas</th>
            <th class="num">Cobertura</th><th>Rentabilidad</th><th>TTS</th><th>Evidencia</th><th></th>
          </tr></thead>
          <tbody>${top.map((x,i) => `<tr>
            <td><span class="status ${weaknessLevelClass(x.level)}">${x.level}</span><small class="weakness-score">${x.score}/100</small></td>
            <td><strong>${esc(x.topic)}</strong><small>${esc(x.specialty)}</small></td>
            <td>${esc(x.area)}</td>
            <td class="num">${Math.round(x.latestAccuracy*100)}%</td>
            <td class="num">${Math.round(x.latestUncertaintyRate*100)}%</td>
            <td class="num">${Math.round(x.latestWrongUncertainRate*100)}%</td>
            <td class="num">${Math.round(x.latestSlowRate*100)}%</td>
            <td class="num">${x.seenQuestions}/${x.totalQuestions}</td>
            <td>${esc(String(x.rentabilityTier || '—').replaceAll('_',' '))}</td>
            <td><button class="btn small ghost" data-weak-tts="${i}">${esc(x.ttsStatusLabel || 'Pendiente')}</button></td>
            <td>${x.evidence}</td>
            <td><button class="btn small" data-weak-practice="${i}">Practicar</button></td>
          </tr>`).join('')}</tbody>
        </table></div>` : `<div class="empty"><p>Aún no hay suficientes respuestas para detectar temas débiles.</p><p class="muted">Sigue practicando y este informe aparecerá automáticamente.</p></div>`}
      </section>

      <section class="panel" style="margin-top:14px">
        <h2>Brechas de cobertura</h2>
        <p class="muted">Estos temas todavía tienen pocas preguntas vistas. No se clasifican automáticamente como “débiles”.</p>
        ${lowCoverage.length ? `<div class="coverage-gap-grid">${lowCoverage.map(x => `<div class="coverage-gap-card">
          <strong>${esc(x.topic)}</strong><span>${esc(x.area)}</span>
          <div class="progress"><div style="width:${Math.round(x.coverage*100)}%"></div></div>
          <small>${x.seenQuestions}/${x.totalQuestions} preguntas vistas</small>
        </div>`).join('')}</div>` : `<p class="muted">No hay brechas destacables con el banco actual.</p>`}
      </section>
    </main>`;

    attachTopbar();
    document.getElementById('copy-weakness-report').onclick = () => copyWeaknessReport(report);
    document.getElementById('practice-top-weakness').onclick = () => {
      const first = top[0];
      if (first) launchWeakTopicPractice(first, 15);
      else renderMessage('Informe de debilidades', 'Aún no hay suficientes datos.');
    };
    document.querySelectorAll('[data-weak-practice]').forEach(btn => {
      btn.onclick = () => {
        const item = top[Number(btn.dataset.weakPractice)];
        if (item) launchWeakTopicPractice(item, 10);
      };
    });
    document.querySelectorAll('[data-weak-tts]').forEach(btn => {
      btn.onclick = async () => {
        const item = top[Number(btn.dataset.weakTts)];
        if (!item) return;
        const text = priorityReadingPrompt(item);
        try { await navigator.clipboard.writeText(text); }
        catch {
          const box = document.createElement('textarea'); box.value = text; box.style.position='fixed'; box.style.left='-9999px';
          document.body.appendChild(box); box.select(); document.execCommand('copy'); box.remove();
        }
        const original = btn.textContent; btn.textContent = '✓ Solicitud copiada'; setTimeout(() => { btn.textContent = original; }, 1800);
      };
    });
  }

  function dailyActual(dateIso) { return attempts.filter(a => isoDateLocal(a.answered_at) === dateIso).length; }

  function planCoverageSnapshot(now = new Date()) {
    const valid = questions.filter(q => !observed(q));
    const seen = new Set(attempts.map(a => a.question_id));
    const unseen = valid.filter(q => !seen.has(q.id));
    const due = valid.filter(q => reviewEligible(q, now));
    const highDue = due.filter(q => rentabilityTierRank(q) >= 3);
    const highUnseen = unseen.filter(q => rentabilityTierRank(q) >= 3);
    const valuableUnseen = unseen.filter(q => rentabilityTierRank(q) >= 2);
    return {
      validTotal:valid.length,
      seenValid:valid.length - unseen.length,
      unseenTotal:unseen.length,
      highUnseen:highUnseen.length,
      valuableUnseen:valuableUnseen.length,
      dueTotal:due.length,
      highDue:highDue.length,
    };
  }

  function coverageDeadlineIso() {
    const exam = profile?.exam_date || DEFAULT_PROFILE.exam_date;
    return shiftLocalDate(exam, -10);
  }

  function highCoverageGoalIso() {
    const exam = profile?.exam_date || DEFAULT_PROFILE.exam_date;
    return shiftLocalDate(exam, -9);
  }

  function valuableCoverageGoalIso() {
    const exam = profile?.exam_date || DEFAULT_PROFILE.exam_date;
    return shiftLocalDate(exam, -5);
  }

  function highCoverageCutoffIso() {
    const exam = profile?.exam_date || DEFAULT_PROFILE.exam_date;
    return shiftLocalDate(exam, -3);
  }

  function buildTodayPlan() {
    const today = isoDateLocal();
    const now = new Date();
    const stats = planCoverageSnapshot(now);
    const exam = profile?.exam_date || DEFAULT_PROFILE.exam_date;
    const daysExam = Math.max(0, daysUntil(exam));
    const legacyDeadline = coverageDeadlineIso();
    const highGoal = highCoverageGoalIso();
    const valuableGoal = valuableCoverageGoalIso();
    const highCutoff = highCoverageCutoffIso();

    // v1.5.1 — el cambio de fase depende de cobertura útil real, no de una fecha rígida.
    // MUY_ALTA/ALTA pueden seguir entrando como nuevas hasta 3 días antes del examen si
    // aún quedan; MEDIA se intenta cerrar hasta 5 días antes. BAJA no prolonga la fase.
    const highCoverageSprint = stats.highUnseen > 0 && today <= highCutoff;
    const valuableCoverageSprint = !highCoverageSprint && stats.valuableUnseen > 0 && today <= valuableGoal;
    const coverageSprint = highCoverageSprint || valuableCoverageSprint;
    const coverageGoal = highCoverageSprint ? highGoal : valuableGoal;
    const coverageRemaining = highCoverageSprint ? stats.highUnseen : stats.valuableUnseen;
    const coverageDaysLeft = Math.max(1, Math.floor(daysBetween(today, coverageGoal)) + 1);

    let specs = [];
    let phase;

    if (daysExam <= 0) {
      phase = { key:'exam', name:'Día del examen', objective:'Ejecutar. No aprender temas grandes nuevos.' };
    } else if (coverageSprint) {
      // Primera exposición de alto retorno: objetivo relativo al examen y a lo que falta.
      // El tope de 120 evita que la cobertura nueva destruya la recuperación espaciada.
      const newTarget = Math.min(120, Math.max(1, Math.ceil(coverageRemaining / coverageDaysLeft)));

      // El backlog vencido se recupera en paralelo. La cola `due` reserva posiciones
      // tempranas para MUY_ALTA/ALTA antiguas, de modo que sesiones parciales no las oculten.
      const dueTarget = stats.dueTotal
        ? Math.min(140, Math.max(90, Math.ceil((stats.highDue + Math.max(0, stats.dueTotal - stats.highDue) * 0.35) / 3)))
        : 0;

      const fragileTarget = Math.min(25, smartPool('fragile').length);
      const speedTarget = Math.min(20, smartPool('speed').length);

      specs = [
        ['due', dueTarget, '🧠 Repasos rentables'],
        ['new_coverage', newTarget, '🚀 Cobertura nueva'],
        ['fragile', fragileTarget, '🧩 Errores y dudas'],
        ['speed', speedTarget, '⚡ Automatización'],
      ];
      phase = {
        key:'coverage_sprint',
        name:highCoverageSprint ? 'Rescate ALTA + memoria' : 'Cobertura MEDIA rentable',
        objective:highCoverageSprint
          ? `Cerrar MUY_ALTA/ALTA nuevas idealmente antes del ${new Date(parseLocalDate(highGoal)).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit'})}, sin abandonar vencidas antiguas.`
          : `Cerrar cobertura MUY_ALTA/ALTA y avanzar MEDIA rentable idealmente antes del ${new Date(parseLocalDate(valuableGoal)).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit'})}.`,
      };
    } else {
      const residualNew = stats.valuableUnseen > 0
        ? Math.min(60, stats.valuableUnseen)
        : Math.min(20, stats.unseenTotal);
      const dueTarget = stats.dueTotal ? Math.min(120, Math.max(70, Math.ceil(stats.dueTotal / 3))) : 0;
      const fragileTarget = Math.min(40, smartPool('fragile').length);
      const speedTarget = Math.min(20, smartPool('speed').length);
      const mixedTarget = residualNew > 0 ? 60 : 80;

      specs = [
        ['due', dueTarget, '🧠 Mantener memoria'],
        ['mixed', mixedTarget, '📝 Bloque mixto tipo examen'],
        ['fragile', fragileTarget, '🔥 Errores y dudas'],
        ['speed', speedTarget, '⚡ Automatización'],
        ['new_coverage', residualNew, '📚 Cobertura residual'],
      ];
      phase = {
        key:'final_consolidation',
        name:'Consolidación final',
        objective:'Convertir cobertura en rendimiento: memoria rentable, errores/dudas, velocidad y bloques tipo examen.',
      };
    }

    const pilotLimited = questions.length < 200;
    const tasks = specs.filter(([,plannedCount]) => plannedCount > 0).map(([kind,plannedCount,label], idx) => {
      const mode = `auto_${kind}`;
      const completed = attempts.filter(a => isoDateLocal(a.answered_at) === today && a.study_mode === mode).length;
      const poolKind = kind === 'mixed' ? 'priority' : kind;
      const available = smartPool(poolKind).filter(q => !attemptedTodayIds(today).has(q.id)).length;
      const count = pilotLimited ? Math.min(plannedCount, completed + available) : plannedCount;
      return { id:`task_${idx}`, kind, mode, label, count, completed:Math.min(completed,count), remaining:Math.max(0,count-completed) };
    }).filter(t => t.count > 0);

    const adjustedTarget = tasks.reduce((sum,t)=>sum+t.count,0);
    const done = tasks.reduce((sum,t)=>sum+t.completed,0);
    const otherToday = Math.max(0, dailyActual(today) - done);
    const next = tasks.find(t => t.remaining > 0) || null;
    const maxCoverageCapacity = coverageDaysLeft * 120;
    const coverageRisk = coverageSprint && coverageRemaining > maxCoverageCapacity;

    return {
      today, phase, done, otherToday, adjustedTarget, tasks, next,
      coverageDeadline:coverageSprint ? coverageGoal : legacyDeadline,
      coverageDaysLeft,
      coverageRisk,
      stats,
      daysExam,
    };
  }

  function topicRoadmap() {
    const grouped = new Map();
    for (const q of questions.filter(x => !observed(x))) {
      const key = q.topic || q.subtopic || q.area || 'Sin clasificar';
      if (!grouped.has(key)) grouped.set(key, { topic:key, qs:[], score:0 });
      const g = grouped.get(key); g.qs.push(q); g.score += questionPriority(q);
    }
    const list = [...grouped.values()].map(g => ({ ...g, score:g.score/Math.max(1,g.qs.length) })).sort((a,b)=>b.score-a.score);
    const sliceNames = (from,to) => list.slice(from,to).map(x=>x.topic);
    const tomorrow = list[2] || list[0];
    const focus = tomorrow ? [...new Set(tomorrow.qs.flatMap(q => [q.subtopic, q.comparison_title].filter(Boolean)))].slice(0,4) : [];
    return { today:sliceNames(0,2), tomorrow:sliceNames(2,5), soon:sliceNames(5,8), preRead:tomorrow?.topic || null, focus };
  }

  function readinessIndicator() {
    const validQuestions = questions.filter(q => !observed(q));
    const validIds = new Set(validQuestions.map(q => q.id));
    const recent = attempts.filter(a => validIds.has(a.question_id)).slice(-100);
    const acc = recent.length ? recent.filter(a=>a.is_correct).length/recent.length : 0;
    const speed = recent.length ? recent.filter(a=>a.is_correct && Number(a.response_time_ms||0) <= Number(a.target_seconds || profile?.target_response_seconds||25)*1000).length/recent.length : 0;

    const seen = new Set(attempts.filter(a => validIds.has(a.question_id)).map(a=>a.question_id));
    const high = validQuestions.filter(q => rentabilityTierRank(q) >= 3);
    const medium = validQuestions.filter(q => rentabilityTierRank(q) === 2);
    const highCoverage = high.length ? high.filter(q => seen.has(q.id)).length / high.length : 1;
    const mediumCoverage = medium.length ? medium.filter(q => seen.has(q.id)).length / medium.length : 1;
    const usefulCoverage = 0.72 * highCoverage + 0.28 * mediumCoverage;

    const relevantStates = memoryStates.filter(s => {
      const q = questions.find(q => q.id === s.question_id);
      return q && !observed(q) && rentabilityTierRank(q) >= 2;
    });
    const overdue = relevantStates.filter(s=>new Date(s.due_at)<=new Date()).length;
    const reviewControl = relevantStates.length ? 1-overdue/relevantStates.length : 0;

    const value = Math.round(100*(0.35*acc + 0.15*speed + 0.30*usefulCoverage + 0.20*reviewControl));
    return { value, acc, speed, coverage:usefulCoverage, highCoverage, mediumCoverage, reviewControl, recentN:recent.length };
  }

  function sevenDayPace() {
    const today = parseLocalDate(isoDateLocal());
    const start = new Date(today.getTime()-6*86400000);
    const count = attempts.filter(a => new Date(a.answered_at) >= start).length;
    return count/7;
  }

  function pressureStatus(plan) {
    if (!plan.adjustedTarget) return { cls:'ok', label:'DÍA DEL EXAMEN' };
    if (plan.coverageRisk) return { cls:'bad', label:'COBERTURA EN RIESGO' };
    if (plan.done >= plan.adjustedTarget) return { cls:'ok', label:'META CUMPLIDA' };

    const hour = new Date().getHours() + new Date().getMinutes()/60;
    const expectedFraction = clamp((hour - 8) / 12, 0, 1);
    const expectedNow = plan.adjustedTarget * expectedFraction;
    if (expectedFraction > 0.35 && plan.done < expectedNow * 0.55) return { cls:'warn', label:'RITMO BAJO HOY' };
    return { cls:'ok', label:plan.phase.key === 'coverage_sprint' ? 'COBERTURA INTENSIVA' : 'CONSOLIDACIÓN' };
  }

  function activeSessionUpdatedAt(row = {}) {
    const value = new Date(row.updated_at || row.created_at || 0).valueOf();
    return Number.isFinite(value) ? value : 0;
  }

  function latestActiveSession(rows = activeSessions) {
    return [...(rows || [])]
      .filter(row => row?.status === 'active')
      .sort((a,b) => activeSessionUpdatedAt(b) - activeSessionUpdatedAt(a))[0] || null;
  }

  function activeSessionModeKey(row = {}) {
    return String(row?.config?.studyMode || row?.config?.examType || `${row?.mode || 'session'}:${row?.title || ''}`);
  }

  function isDailyAutoSession(row = {}) {
    const studyMode = String(row?.config?.studyMode || '');
    return row?.mode === 'study' && studyMode.startsWith('auto_');
  }

  function sessionPlanDate(row = {}) {
    const configured = String(row?.config?.planDate || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(configured)) return configured;
    // Compatibilidad con sesiones auto creadas antes de v1.3.2: su fecha de creación
    // identifica el día del checklist al que pertenecían.
    if (isDailyAutoSession(row) && (row.created_at || row.updated_at)) {
      return isoDateLocal(row.created_at || row.updated_at);
    }
    return null;
  }

  function activeSessionForTask(task) {
    if (!task?.mode) return null;
    const today = isoDateLocal();
    return latestActiveSession(activeSessions.filter(row =>
      row?.mode === 'study'
      && row?.config?.studyMode === task.mode
      && sessionPlanDate(row) === today
    ));
  }

  function similarActiveSessionCount(row) {
    const key = activeSessionModeKey(row);
    return activeSessions.filter(item => activeSessionModeKey(item) === key).length;
  }

  function launchAutoTask(task) {
    if (!task) return renderMessage('Plan de hoy', 'La checklist principal está completa. Puedes adelantar trabajo desde Practicar.');
    const poolKind = task.kind === 'mixed' ? 'priority' : task.kind;
    const usedToday = attemptedTodayIds();
    let pool = smartPool(poolKind).filter(q => !usedToday.has(q.id));

    // Una cola especializada vacía no debe degradar silenciosamente a "priority":
    // eso era una fuente de repeticiones inesperadas. Solo mixed puede usar priority.
    if (!pool.length && task.kind === 'mixed') pool = smartPool('priority').filter(q => !usedToday.has(q.id));

    const count = Math.min(task.remaining, pool.length);
    if (!count) return renderMessage('Sin preguntas disponibles', 'No quedan preguntas elegibles para este bloque hoy. Continúa con la siguiente tarea o usa Practicar.');
    const selected = pool.slice(0, count);
    const feedback = task.kind === 'mixed' ? 'end' : 'immediate';
    launchStudy(selected, {
      mode:'study', count:selected.length, randomize:false, feedback,
      timeMode: task.kind === 'speed' ? 'per_question' : 'none',
      secondsPerQuestion:Number(profile?.target_response_seconds||25), totalSeconds:0,
      title:task.label, studyMode:task.mode, planDate:isoDateLocal(),
    });
  }

  function launchOrResumeAutoTask(task) {
    const existing = activeSessionForTask(task);
    if (existing) return resumePersistentSession(existing);
    return launchAutoTask(task);
  }

  function renderPracticeHub() {
    clearTimer();
    const target = Number(profile?.target_response_seconds || 25);
    const cards = [
      { id:'recommended', title:'🔥 Lo que más necesitas', detail:`15 preguntas · ${target} s/pregunta`, kind:'priority', count:15, timed:true },
      { id:'speed', title:'⚡ Entrenamiento de velocidad', detail:`20 preguntas · objetivo ≤${target} s`, kind:'speed', count:20, timed:true },
      { id:'high', title:'🎯 Temas rentables', detail:'30 preguntas · selección automática', kind:'high', count:30, timed:false },
      { id:'weak', title:'🧠 Puntos débiles', detail:'15 preguntas · prioridad personal', kind:'priority', count:15, timed:false },
      { id:'errors', title:'❌ Errores recientes', detail:'10 preguntas', kind:'errors', count:10, timed:false },
      { id:'uncertain', title:'❓ Dudé / no dominaba una alternativa', detail:'10 preguntas · vuelve antes al repaso', kind:'uncertain', count:10, timed:false },
    ];
    app.innerHTML = `<main class="shell">${topbar('Practicar', true)}
      <section class="panel"><h2>Práctica rápida</h2><p class="muted">La primera opción usa memoria, errores, lentitud y rentabilidad para decidir por ti.</p>
      <div class="practice-grid">${cards.map(c=>`<button class="practice-card" data-practice="${c.id}"><strong>${c.title}</strong><span>${c.detail}</span></button>`).join('')}</div>
      <div class="sprint-row"><button class="btn sprint" data-sprint="10">⚡ Sprint 10</button><button class="btn sprint" data-sprint="15">⚡ Sprint 15</button><button class="btn sprint" data-sprint="30">⚡ Sprint 30</button></div>
      <div class="footer-actions"><button id="custom-practice" class="btn">⚙ Personalizar práctica</button><button id="weakness-report-btn" class="btn">📊 Informe dinámico de debilidades</button><button id="practice-history" class="btn">🕘 Historial y ritmo</button><button id="practice-exam" class="btn">📝 Crear simulacro</button></div></section>
    </main>`;
    attachTopbar();
    cards.forEach(c => {
      document.querySelector(`[data-practice="${c.id}"]`).onclick = () => {
        let pool = smartPool(c.kind); if (!pool.length) pool = smartPool('priority');
        const selected = pool.slice(0, Math.min(c.count, pool.length));
        if (!selected.length) return renderMessage('Práctica', 'No hay preguntas disponibles con ese criterio todavía.');
        launchStudy(selected, { mode:'study', count:selected.length, randomize:false, feedback:'immediate', timeMode:c.timed?'per_question':'none', secondsPerQuestion:target, totalSeconds:0, title:c.title, studyMode:`practice_${c.kind}` });
      };
    });
    document.querySelectorAll('[data-sprint]').forEach(btn => btn.onclick = () => {
      const count = Number(btn.dataset.sprint); const pool = smartPool('priority'); const selected = pool.slice(0, Math.min(count,pool.length));
      launchStudy(selected, { mode:'study', count:selected.length, randomize:false, feedback:'immediate', timeMode:'per_question', secondsPerQuestion:target, totalSeconds:0, title:`Sprint ${count}`, studyMode:'practice_sprint' });
    });
    document.getElementById('custom-practice').onclick = () => renderSessionBuilder('study');
    document.getElementById('weakness-report-btn').onclick = renderWeaknessReport;
    document.getElementById('practice-history').onclick = () => renderHistory();
    document.getElementById('practice-exam').onclick = renderExamHub;
  }


  function expectedHistoricalCount(year) {
    return Number(year) === 2020 ? 90 : 100;
  }

  function historicalSeriesComplete(list = [], expected = 100) {
    if (!Array.isArray(list) || list.length !== expected) return false;
    const numbers = list.map(q => Number(q.question_number)).sort((a,b) => a-b);
    return numbers.every((value, index) => value === index + 1);
  }

  function historicalExamCatalog() {
    const grouped = new Map();
    for (const q of questions) {
      const year = Number(q.year);
      const test = String(q.test || '').toUpperCase();
      if (!year || !['A','B'].includes(test)) continue;
      const key = `${year}-${test}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(q);
    }

    for (const list of grouped.values()) {
      list.sort((a,b) => Number(a.question_number) - Number(b.question_number));
    }

    const years = [...new Set([...grouped.keys()].map(k => Number(k.split('-')[0])))]
      .sort((a,b) => b-a);

    const catalog = [];
    for (const year of years) {
      const expected = expectedHistoricalCount(year);
      const a = grouped.get(`${year}-A`) || [];
      const b = grouped.get(`${year}-B`) || [];
      const completeA = historicalSeriesComplete(a, expected);
      const completeB = historicalSeriesComplete(b, expected);
      if (completeA) {
        catalog.push({ year, kind:'single', test:'A', count:expected, questions:[...a], title:`${year} · Prueba A` });
      }
      if (completeB) {
        catalog.push({ year, kind:'single', test:'B', count:expected, questions:[...b], title:`${year} · Prueba B` });
      }
      if (completeA && completeB) {
        catalog.push({
          year, kind:'combined', test:'A+B', count:expected*2,
          questions:[...a, ...b],
          title:`${year} · Pruebas A+B`,
        });
      }
    }
    return catalog;
  }

  function renderExamHub() {
    clearTimer();
    const catalog = historicalExamCatalog();
    const groupedByYear = new Map();
    for (const item of catalog) {
      if (!groupedByYear.has(item.year)) groupedByYear.set(item.year, []);
      groupedByYear.get(item.year).push(item);
    }

    const historicalHtml = groupedByYear.size
      ? [...groupedByYear.entries()].map(([year, items]) => `
          <div class="historical-year-group">
            <h3>${year}</h3>
            <div class="historical-cards">
              ${items.map(item => `
                <button class="historical-card ${item.kind==='combined'?'combined':''}"
                  data-historical-year="${item.year}"
                  data-historical-test="${item.test}">
                  <strong>${esc(item.title)}</strong>
                  <span>${item.count} preguntas · orden original · hoja de respuestas separada</span>
                  <small>${item.kind==='combined' ? 'A → intermedio → B · cada parte queda aislada' : 'Reproducción de esa prueba histórica'}</small>
                </button>`).join('')}
            </div>
          </div>`).join('')
      : `<div class="empty"><p>Aún no hay un examen histórico completo cargado.</p><p class="muted">Cuando una prueba tenga todas sus preguntas en la base, aparecerá aquí automáticamente.</p></div>`;

    app.innerHTML = `<main class="shell">${topbar('Simulacros', true)}
      <section class="panel official-exam-card">
        <div class="builder-head">
          <div><span class="roadmap-kicker">FORMATO ACTUAL</span><h2>🎯 Simulacro realista 2026</h2><p class="muted">200 preguntas en dos partes independientes: 100 preguntas / 120 min → intermedio oficial de 60 min → 100 preguntas / 120 min. La Parte B permanece bloqueada hasta cerrar la Parte A.</p></div>
        </div>
        <button id="official-2026-exam" class="btn primary">Configurar simulacro realista 2026</button>
      </section>
      <section class="panel" style="margin-top:14px">
        <div class="builder-head">
          <div><h2>🗂 Simulacros históricos</h2><p class="muted">Cuadernillo en orden original y hoja de respuestas independiente. Las combinaciones A+B respetan el corte entre partes y bloquean B hasta cerrar A.</p></div>
        </div>
        ${historicalHtml}
      </section>
      <section class="panel" style="margin-top:14px">
        <h2>🧪 Entrenamiento personalizado</h2>
        <p class="muted">Construye una prueba flexible según número de preguntas, filtros, tiempo y descanso. No se presenta como réplica oficial salvo que uses el preset realista 2026.</p>
        <button id="custom-exam-builder" class="btn">Crear entrenamiento personalizado</button>
      </section>
    </main>`;

    attachTopbar();
    document.querySelectorAll('[data-historical-year]').forEach(btn => {
      btn.onclick = () => {
        const year = Number(btn.dataset.historicalYear);
        const test = btn.dataset.historicalTest;
        const item = catalog.find(x => x.year === year && x.test === test);
        if (item) launchHistoricalExam(item);
      };
    });
    document.getElementById('official-2026-exam').onclick = () => renderSessionBuilder('exam', 'official2026');
    document.getElementById('custom-exam-builder').onclick = () => renderSessionBuilder('exam');
  }

  function launchHistoricalExam(item) {
    const firstBlockCount = item.kind === 'combined'
      ? item.questions.filter(q => String(q.test).toUpperCase() === 'A').length
      : 0;
    const singleSeconds = Math.round(item.count * 72); // 1,2 min/pregunta como ritmo de referencia actual.
    const partSeconds = item.kind === 'combined' ? Math.round(firstBlockCount * 72) : singleSeconds;

    launchExam(item.questions, {
      mode:'exam',
      title:`Histórico · ${item.title}`,
      count:item.count,
      randomize:false,
      feedback:'end',
      timeMode:'total',
      totalSeconds:partSeconds,
      partSeconds,
      secondsPerQuestion:0,
      breakAfter:firstBlockCount,
      pauseDuringBreak:true,
      twoPartExam:item.kind === 'combined',
      official2026:false,
      breakDurationSeconds:3600,
      allowEarlyBreak:true,
      studyMode:'historical_exam',
      examLayout:'paper',
      historicalYear:item.year,
      historicalTest:item.test,
      historicalKind:item.kind,
      shuffleOptions:false,
    });
  }

  function twoPartExamEnabled(exam = currentExam) {
    return Boolean(exam?.config?.twoPartExam && Number(exam?.config?.breakAfter || 0) > 0);
  }

  function examBreakPending(exam = currentExam) {
    return twoPartExamEnabled(exam)
      && !exam.state.breakTaken
      && Number(exam.state.currentIndex || 0) >= Number(exam.config.breakAfter || 0);
  }

  function activeExamBounds(exam = currentExam) {
    if (!exam?.questions?.length) return { start:0, end:0 };
    const splitRaw = Number(exam?.config?.breakAfter || 0);
    if (twoPartExamEnabled(exam)) {
      const split = Math.min(exam.questions.length, Math.max(1, splitRaw));
      return exam.state.breakTaken ? { start:split, end:exam.questions.length } : { start:0, end:split };
    }
    if (splitRaw > 0 && !exam.state.breakTaken) {
      const split = Math.min(exam.questions.length, Math.max(1, splitRaw));
      return { start:0, end:split };
    }
    return { start:0, end:exam.questions.length };
  }

  function activeExamEntries(exam = currentExam) {
    const { start, end } = activeExamBounds(exam);
    return exam.questions.slice(start, end).map((q, offset) => ({ q, index:start + offset }));
  }

  function examPartLabel(exam = currentExam) {
    if (!twoPartExamEnabled(exam)) return '';
    if (exam.config.examLayout === 'paper' && exam.config.historicalKind === 'combined') {
      return exam.state.breakTaken ? 'Prueba B' : 'Prueba A';
    }
    return exam.state.breakTaken ? 'Parte B' : 'Parte A';
  }

  function examPartSeconds(exam = currentExam) {
    return Math.max(60, Number(exam?.config?.partSeconds || exam?.config?.totalSeconds || 0));
  }

  function historicalDisplayNumber(q, index) {
    const combined = currentExam?.config?.historicalKind === 'combined';
    return combined ? `${String(q.test).toUpperCase()}-${q.question_number}` : String(q.question_number);
  }


  function scratchOptionState(qId, letter) {
    return currentExam?.state?.scratch?.[qId]?.[letter] || 'neutral';
  }

  function scratchStateLabel(state) {
    if (state === 'crossed') return 'Tachada';
    return 'Sin marca';
  }

  function cycleScratchState(qId, letter) {
    currentExam.state.scratch ||= {};
    currentExam.state.scratch[qId] ||= {};
    const current = currentExam.state.scratch[qId][letter] || 'neutral';
    const next = current === 'crossed' ? 'neutral' : 'crossed';
    if (next === 'neutral') delete currentExam.state.scratch[qId][letter];
    else currentExam.state.scratch[qId][letter] = next;
    if (!Object.keys(currentExam.state.scratch[qId]).length) delete currentExam.state.scratch[qId];
    return next;
  }

  function paperOptionHtml(q, index, o) {
    const state = scratchOptionState(q.id, o.letter);
    const icon = state === 'crossed' ? '×' : '';
    return `<button class="paper-option scratch-${state}"
      data-scratch-index="${index}" data-scratch-letter="${o.letter}"
      aria-label="${esc(historicalDisplayNumber(q,index))} ${o.letter}: ${scratchStateLabel(state)}">
      <span class="paper-option-letter">${o.letter}.</span>
      <span class="paper-option-text">${esc(o.text)}</span>
      <span class="paper-option-mark" aria-hidden="true">${icon}</span>
    </button>`;
  }

  function historicalPaperQuestionsHtml() {
    return activeExamEntries().map(({ q, index }) => {
      const test = String(q.test || '').toUpperCase();
      const flagged = Boolean(currentExam.state.marked[q.id]);
      return `<article class="paper-question" id="paper-question-${index}">
        <div class="paper-question-head">
          <span class="paper-qnum">${esc(historicalDisplayNumber(q,index))}</span>
          <span class="muted">${esc(q.year)} · Prueba ${esc(test)}</span>
          ${questionDoubtButton(q.id, questionHasDoubt(currentExam.state.scratch, q.id), 'paper-doubt')}
          <button class="paper-flag ${flagged?'active':''}" data-paper-flag-index="${index}">${flagged?'⚑ Revisar':'⚐ Marcar para revisar'}</button>
        </div>
        <p class="paper-question-text">${esc(q.question)}</p>
        ${questionMediaHtml(q, 'question-media paper-question-media')}
        <div class="paper-options">
          ${optionList(q).map(o => paperOptionHtml(q, index, o)).join('')}
        </div>
      </article>`;
    }).join('');
  }

  function historicalAnswerSheetHtml() {
    let lastTest = null;
    return activeExamEntries().map(({ q, index }) => {
      const test = String(q.test || '').toUpperCase();
      const heading = test !== lastTest
        ? `<div class="answer-sheet-section">Prueba ${esc(test)}</div>`
        : '';
      lastTest = test;
      const selected = sessionSelected(currentExam.state, q.id);
      const uncertain = questionHasDoubt(currentExam.state.scratch, q.id);
      const flagged = Boolean(currentExam.state.marked?.[q.id]);
      return `${heading}<div class="answer-row ${selected?'answered':''} ${uncertain?'uncertain':''} ${flagged?'flagged':''}" data-answer-row="${index}">
        <button class="answer-number" data-scroll-question="${index}" title="Ir a la pregunta">${flagged?'⚑ ':''}${esc(historicalDisplayNumber(q,index))}${uncertain?' ?':''}</button>
        <div class="answer-bubbles">
          ${optionList(q).map(o => `<button class="answer-bubble ${selected===o.letter?'selected':''}"
            data-answer-index="${index}" data-answer-letter="${o.letter}" aria-label="${esc(historicalDisplayNumber(q,index))} ${o.letter}">${o.letter}</button>`).join('')}
        </div>
      </div>`;
    }).join('');
  }

  function historicalAnsweredCount() {
    return activeExamEntries().filter(({ q }) => sessionSelected(currentExam.state, q.id) != null).length;
  }

  function refreshHistoricalAnswerSheet() {
    const count = historicalAnsweredCount();
    const countEl = document.getElementById('historical-answered-count');
    if (countEl) countEl.textContent = String(count);
    for (let i = 0; i < currentExam.questions.length; i++) {
      const q = currentExam.questions[i];
      const selected = sessionSelected(currentExam.state, q.id);
      const row = document.querySelector(`[data-answer-row="${i}"]`);
      const uncertain = questionHasDoubt(currentExam.state.scratch, q.id);
      const flagged = Boolean(currentExam.state.marked?.[q.id]);
      if (row) {
        row.classList.toggle('answered', Boolean(selected));
        row.classList.toggle('uncertain', uncertain);
        row.classList.toggle('flagged', flagged);
      }
      const numberBtn = document.querySelector(`[data-scroll-question="${i}"]`);
      if (numberBtn) numberBtn.textContent = `${flagged?'⚑ ':''}${historicalDisplayNumber(q,i)}${uncertain?' ?':''}`;
      document.querySelectorAll(`[data-answer-index="${i}"]`).forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.answerLetter === selected);
      });
    }
  }

  function renderHistoricalExamPaper() {
    if (currentExam?.row && sessionExpiredByLocalDay(currentExam.row)) {
      handleCurrentSessionDayBoundary().catch(error => console.warn('Day-boundary close failed.', error));
      return;
    }
    clearTimer();
    examQuestionEnteredAt = 0;
    if (examBreakPending()) return renderBreakScreen();
    const answered = historicalAnsweredCount();
    const activeEntries = activeExamEntries();
    const partLabel = examPartLabel();

    app.innerHTML = `<main class="historical-shell">
      ${topbar(currentExam.config.title || 'Simulacro histórico', false)}
      <section class="historical-toolbar panel">
        <div>
          <span class="tag">Modo histórico realista</span>
          <strong>${esc(currentExam.config.historicalYear)} · ${esc(currentExam.config.historicalTest)}</strong>
          ${partLabel ? `<span class="tag ok">${esc(partLabel)}</span>` : ''}
          <span><strong id="historical-answered-count">${answered}</strong>/${activeEntries.length} marcadas en este bloque</span>
        </div>
        <div class="historical-toolbar-actions">
          <button id="jump-answer-sheet" class="btn small">📋 Hoja de respuestas</button>
          <button id="historical-session-exit" class="btn small ghost">Cerrar o continuar después</button>
          <div id="timer" class="timer">${formatTime(currentExam.state.remainingSeconds)}</div>
          <button id="historical-finish" class="btn danger small">${twoPartExamEnabled() && !currentExam.state.breakTaken ? 'Finalizar Parte A' : 'Entregar'}</button>
        </div>
      </section>

      <section class="historical-layout">
        <div class="historical-paper panel">
          <div class="paper-cover">
            <span class="roadmap-kicker">CUADERNILLO</span>
            <h1>${esc(currentExam.config.title)}</h1>
            <p>Lee el cuadernillo y marca tu respuesta definitiva únicamente en la hoja lateral. En el cuadernillo puedes tachar distractores; usa el botón <strong>?</strong> de la cabecera para marcar la pregunta completa como dudosa.</p>
            <div class="scratch-legend"><span><b>?</b> duda de la pregunta</span><span><b>×</b> alternativa descartada</span><span>La hoja de respuestas es la que cuenta.</span></div>
          </div>
          ${historicalPaperQuestionsHtml()}
        </div>

        <aside class="answer-sheet panel" id="historical-answer-sheet">
          <div class="answer-sheet-header">
            <div><span class="roadmap-kicker">HOJA DE RESPUESTAS</span><h2>${partLabel ? esc(partLabel) : 'Marca cuando estés seguro'}</h2></div>
            <span class="tag">${answered}/${activeEntries.length}</span>
          </div>
          <div class="answer-sheet-scroll">${historicalAnswerSheetHtml()}</div>
        </aside>
      </section>
    </main>`;

    attachTopbar();

    document.querySelectorAll('[data-scratch-index]').forEach(btn => {
      btn.onclick = async () => {
        const index = Number(btn.dataset.scratchIndex);
        const q = currentExam.questions[index];
        const letter = btn.dataset.scratchLetter;
        const next = cycleScratchState(q.id, letter);
        btn.classList.remove('scratch-neutral', 'scratch-tentative', 'scratch-crossed');
        btn.classList.add(`scratch-${next}`);
        const mark = btn.querySelector('.paper-option-mark');
        if (mark) mark.textContent = next === 'crossed' ? '×' : '';
        btn.setAttribute('aria-label', `${historicalDisplayNumber(q,index)} ${letter}: ${scratchStateLabel(next)}`);
        refreshHistoricalAnswerSheet();
        await persistExamState();
      };
    });

    document.querySelectorAll('[data-question-doubt-top]').forEach(btn => {
      const q = currentExam.questions.find(item => item.id === btn.dataset.questionDoubt);
      if (!q) return;
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const active = !questionHasDoubt(currentExam.state.scratch || {}, q.id);
        currentExam.state.scratch = setQuestionDoubt(currentExam.state.scratch || {}, q.id, active);
        refreshQuestionDoubtButtons(q.id, active);
        refreshHistoricalAnswerSheet();
        await persistExamState();
      };
    });

    document.querySelectorAll('[data-paper-flag-index]').forEach(btn => {
      btn.onclick = async () => {
        const index = Number(btn.dataset.paperFlagIndex);
        const q = currentExam.questions[index];
        currentExam.state.marked[q.id] = !currentExam.state.marked[q.id];
        btn.classList.toggle('active', Boolean(currentExam.state.marked[q.id]));
        btn.textContent = currentExam.state.marked[q.id] ? '⚑ Revisar' : '⚐ Marcar para revisar';
        refreshHistoricalAnswerSheet();
        await persistExamState();
      };
    });

    document.querySelectorAll('[data-answer-index]').forEach(btn => {
      btn.onclick = async () => {
        const index = Number(btn.dataset.answerIndex);
        const q = currentExam.questions[index];
        const letter = btn.dataset.answerLetter;
        detachInheritedAttemptIdentity(currentExam, q.id);
        if (sessionSelected(currentExam.state, q.id) === letter) delete currentExam.state.responses[q.id];
        else currentExam.state.responses[q.id] = { ...sessionResponse(currentExam.state, q.id), selected:letter, didNotKnow:false, timedOut:false };
        refreshHistoricalAnswerSheet();
        await persistExamState();
      };
    });

    document.querySelectorAll('[data-scroll-question]').forEach(btn => {
      btn.onclick = () => {
        const index = Number(btn.dataset.scrollQuestion);
        document.getElementById(`paper-question-${index}`)?.scrollIntoView({ behavior:'smooth', block:'start' });
      };
    });

    document.getElementById('jump-answer-sheet').onclick = () => {
      document.getElementById('historical-answer-sheet')?.scrollIntoView({ behavior:'smooth', block:'start' });
    };

    document.getElementById('historical-session-exit').onclick = cancelCurrentExam;

    document.getElementById('historical-finish').onclick = renderExamOverview;
    startExamTimer();
  }

  function renderRoadmap() {
    clearTimer();
    const road = topicRoadmap();
    const readingAlert = priorityReadingAlertData();
    const list = items => items.length ? items.map(x=>`<li>${esc(x)}</li>`).join('') : '<li>Se completará al clasificar el banco completo.</li>';
    app.innerHTML = `<main class="shell">${topbar('Qué viene después', true)}
      ${priorityReadingAlertMarkup(readingAlert, 'roadmap-reading')}
      <section class="roadmap-grid">
        <div class="panel roadmap-card"><span class="roadmap-kicker">HOY</span><h2>Prioridad actual</h2><ul>${list(road.today)}</ul></div>
        <div class="panel roadmap-card highlighted"><span class="roadmap-kicker">MAÑANA</span><h2>Prelectura recomendada</h2><ul>${list(road.tomorrow)}</ul></div>
        <div class="panel roadmap-card"><span class="roadmap-kicker">EN 2–3 DÍAS</span><h2>Próxima ola</h2><ul>${list(road.soon)}</ul></div>
      </section>
      <section class="panel preread"><h2>📖 Qué leer antes</h2>${road.preRead ? `<p><strong>${esc(road.preRead)}</strong> · 20–30 minutos de prelectura ligera.</p><p class="muted">Enfócate en:</p><ul>${road.focus.map(x=>`<li>${esc(x)}</li>`).join('') || '<li>diagnóstico, criterios, manejo y trampas frecuentes</li>'}</ul>` : '<p>Aún no hay suficiente clasificación temática.</p>'}<p class="muted">La finalidad es activar el esquema mental, no dominar el tema antes de banquearlo.</p></section>
    </main>`;
    attachTopbar();
    attachPriorityReadingAlert(readingAlert, 'roadmap-reading');
  }

  function renderDashboard() {
    clearTimer();
    currentStudy = null;
    currentExam = null;
    reviewContext = null;
    const s = overallStats();
    const plan = buildTodayPlan();
    const status = pressureStatus(plan);
    const ready = readinessIndicator();
    const road = topicRoadmap();
    const readingAlert = priorityReadingAlertData();
    const dueCount = smartPool('due').length;
    const slowCount = smartPool('speed').length;
    const daysExam = daysUntil(profile?.exam_date || DEFAULT_PROFILE.exam_date);
    const daysReady = daysUntil(plan.coverageDeadline || coverageDeadlineIso());
    const pace7 = sevenDayPace();
    const completion = plan.adjustedTarget ? Math.min(100, Math.round(plan.done/plan.adjustedTarget*100)) : 100;
    // Las sesiones automáticas pertenecen al checklist del día en que se crearon.
    // Una sesión auto antigua sigue disponible abajo para recuperación/cierre, pero no
    // desplaza la siguiente tarea de hoy ni congela una selección calculada días atrás.
    const primaryActiveSession = latestActiveSession(activeSessions.filter(row =>
      !isDailyAutoSession(row) || sessionPlanDate(row) === plan.today
    ));
    const primaryAnswered = primaryActiveSession ? (primaryActiveSession.answered_count || answeredIdsFor(primaryActiveSession, primaryActiveSession.state || {}).length) : 0;
    const primaryPlanned = primaryActiveSession ? (primaryActiveSession.planned_count || primaryActiveSession.question_ids?.length || 0) : 0;

    app.innerHTML = `<main class="shell">
      ${topbar()}
      ${!cloudConfigured ? `<div class="banner"><strong>Modo demo:</strong> el progreso se guarda solo en este navegador.</div>` : ''}
      ${cloudConfigured && !learningNotesAvailable ? `<div class="banner"><strong>Notas de aprendizaje pendientes de activar:</strong> ejecuta <code>${LEARNING_NOTES_MIGRATION}</code>. La práctica sigue funcionando normalmente.</div>` : ''}
      ${cloudConfigured && !reviewLearningScopeAvailable ? `<div class="banner"><strong>Actualización v1.5.0 pendiente en Supabase:</strong> ejecuta <code>${REVIEW_LEARNING_SCOPE_MIGRATION}</code> antes de guardar nuevas observaciones de “Revisar pregunta”.</div>` : ''}
      ${questions.length < 200 ? `<div class="banner"><strong>Piloto de 20 preguntas:</strong> la carga diaria se escala temporalmente al contenido disponible. Las metas completas se activarán al importar el banco maestro.</div>` : ''}

      <section class="briefing panel">
        <div class="briefing-main"><span class="status-pill ${status.cls}">${status.label}</span><h2>Plan 75+/80 · ${esc(plan.phase.name)}</h2><p>${esc(plan.phase.objective)}</p><div class="briefing-dates"><span><strong>${Math.max(0,daysExam)}</strong> días al examen</span><span><strong>${Math.max(0,daysReady)}</strong> días para cerrar primera vuelta útil</span></div></div>
        <div class="goal compact-goal"><small>Preparación operativa*</small><div class="big">${ready.value}%</div><small>*indicador interno, no predicción de nota</small></div>
      </section>

      <section class="plan-progress panel">
        <div class="plan-progress-head"><div><strong>HOY</strong><div class="muted">${plan.done} de ${plan.adjustedTarget} preguntas planificadas${plan.otherToday?` · ${plan.otherToday} adicionales ya hechas`:''}</div></div><div class="plan-percent">${completion}%</div></div>
        <div class="meter"><div style="width:${completion}%"></div></div>
        <div class="plan-meta"><span>Por ver válidas: <strong>${plan.stats.unseenTotal}</strong></span><span>ALTA/MUY_ALTA por ver: <strong>${plan.stats.highUnseen}</strong></span><span>Vencidas rentables: <strong>${plan.stats.highDue}</strong></span><span>Ritmo 7 días: <strong>${pace7.toFixed(0)}/día</strong></span><span>Lentas: <strong>${slowCount}</strong></span></div>
      </section>

      ${priorityReadingAlertMarkup(readingAlert, 'dashboard-reading')}

      ${primaryActiveSession
        ? `<button id="next-task-btn" class="next-task resume-task"><span><small>CONTINUAR SESIÓN</small><strong>${esc(primaryActiveSession.title || (primaryActiveSession.mode === 'exam' ? 'Simulacro' : 'Práctica'))}</strong><em>${primaryAnswered}/${primaryPlanned} respondidas · continúa exactamente donde quedaste</em></span><b>▶</b></button>`
        : plan.next
          ? `<button id="next-task-btn" class="next-task"><span><small>SIGUIENTE TAREA</small><strong>${esc(plan.next.label)}</strong><em>${plan.next.remaining} pendientes de este bloque</em></span><b>▶</b></button>`
          : `<div class="banner"><strong>Checklist principal completa.</strong> Usa Practicar para adelantar trabajo de mañana.</div>`}

      <section class="checklist panel"><div class="section-head"><div><h2>Checklist de hoy</h2><p class="muted">La app decide el orden. Si un bloque quedó abierto, el botón continúa esa sesión y no crea otra.</p></div></div>
        <div class="checklist-items">${plan.tasks.map(t => {
          const openSession = activeSessionForTask(t);
          return `<div class="check-item ${t.remaining===0?'done':''} ${openSession?'has-active-session':''}"><span class="checkmark">${t.remaining===0?'✓':openSession?'↻':'○'}</span><div><strong>${esc(t.label)}</strong><small>${t.completed}/${t.count} completadas${openSession?' · sesión en curso':''}</small></div><button class="btn small ${openSession?'primary':''}" data-task="${t.id}" ${t.remaining===0?'disabled':''}>${t.remaining===0?'Hecho':openSession?'Continuar':'Empezar'}</button></div>`;
        }).join('')}</div>
      </section>

      ${activeSessions.length ? `<section class="panel active-sessions-panel">
        <div class="section-head"><div><h2>Sesiones en curso</h2><p class="muted">Reanuda para continuar exactamente donde quedaste. El cierre parcial se realiza dentro de la sesión para poder revisar lo respondido.</p></div></div>
        <div class="active-session-list">
          ${activeSessions.map(s => {
            const similarCount = similarActiveSessionCount(s);
            return `<div class="active-session-row">
              <div><strong>${esc(s.title || (s.mode === 'exam' ? 'Simulacro' : 'Práctica'))}${similarCount > 1 ? ` <span class="tag warn">${similarCount} sesiones similares</span>` : ''}</strong><small>${s.answered_count || answeredIdsFor(s, s.state || {}).length}/${s.planned_count || s.question_ids?.length || 0} respondidas · guardado ${new Date(s.updated_at || s.created_at || Date.now()).toLocaleString()}${s.syncStatus && s.syncStatus !== 'synced' ? ` · ${s.syncStatus === 'conflict' ? 'conflicto local' : 'pendiente de sincronizar'}` : ''}</small></div>
              <div class="active-session-actions"><button class="btn small primary" data-resume-session="${esc(s.id)}">Reanudar</button></div>
            </div>`;
          }).join('')}
        </div>
      </section>` : ''}

      <section class="actions actions-main v05-actions">
        <button id="practice-btn" class="btn primary">⚡ PRACTICAR</button>
        <button id="review-btn" class="btn">🧠 REPASO INTELIGENTE</button>
        <button id="exam-btn" class="btn">📝 SIMULACRO</button>
        <button id="roadmap-btn" class="btn">📖 QUÉ VIENE DESPUÉS</button>
        <button id="stats-btn" class="btn">📊 MI ESTADO</button>
        <button id="history-btn" class="btn">🕘 HISTORIAL Y RITMO</button>
        <button id="specific-btn" class="btn">🔎 PREGUNTAS ESPECÍFICAS</button>
      </section>

      <section class="panel next-roadmap"><div><span class="roadmap-kicker">PRÓXIMAMENTE</span><strong>${esc(road.preRead || 'Clasificando próximos temas')}</strong><small>Prelectura ligera sugerida antes de que entre en el banqueo.</small></div><button id="roadmap-mini" class="btn small">Ver hoja de ruta</button></section>
    </main>`;

    attachTopbar();
    attachPriorityReadingAlert(readingAlert, 'dashboard-reading');
    const nextTaskButton = document.getElementById('next-task-btn');
    if (nextTaskButton) nextTaskButton.onclick = () => primaryActiveSession
      ? resumePersistentSession(primaryActiveSession)
      : launchOrResumeAutoTask(plan.next);
    document.querySelectorAll('[data-task]').forEach(btn => {
      const task = plan.tasks.find(t => t.id === btn.dataset.task);
      btn.onclick = () => launchOrResumeAutoTask(task);
    });
    document.getElementById('practice-btn').onclick = renderPracticeHub;
    document.getElementById('review-btn').onclick = () => {
      let pool = smartPool('due'); if (!pool.length) pool = smartPool('priority');
      const selected = pool.slice(0, Math.min(20,pool.length));
      launchStudy(selected, { mode:'study', count:selected.length, randomize:false, feedback:'immediate', timeMode:'none', secondsPerQuestion:Number(profile?.target_response_seconds||25), totalSeconds:0, title:'Repaso inteligente', studyMode:'smart_review' });
    };
    document.getElementById('exam-btn').onclick = renderExamHub;
    document.getElementById('roadmap-btn').onclick = renderRoadmap;
    document.getElementById('roadmap-mini').onclick = renderRoadmap;
    document.getElementById('stats-btn').onclick = renderStats;
    document.getElementById('history-btn').onclick = () => renderHistory();
    document.getElementById('specific-btn').onclick = renderSpecificQuestions;
    document.querySelectorAll('[data-resume-session]').forEach(btn => {
      btn.onclick = () => {
        const row = activeSessions.find(s => s.id === btn.dataset.resumeSession);
        if (row) resumePersistentSession(row);
      };
    });
  }

  function renderMessage(title, message) {
    app.innerHTML = `<main class="shell">${topbar(title, true)}<div class="panel empty"><h2>${esc(title)}</h2><p>${esc(message)}</p></div></main>`;
    attachTopbar();
  }

  function buildContinueQueue() {
    return [...questions].sort((a,b) => {
      const sa = questionStats(a.id), sb = questionStats(b.id);
      if (sa.seen !== sb.seen) return sa.seen - sb.seen;
      const ra = sa.seen ? sa.wrong/sa.seen : 0;
      const rb = sb.seen ? sb.wrong/sb.seen : 0;
      if (ra !== rb) return rb - ra;
      return a.id.localeCompare(b.id);
    });
  }

  function renderSpecificQuestions(draft = specificQueryDraft) {
    clearTimer();
    scrollPageTop();
    const years = [...new Set(questions.map(q => Number(q.year)).filter(Number.isFinite))].sort((a,b) => b-a);
    const defaultYear = Number(draft?.defaultYear || years[0] || 2025);
    const defaultTest = String(draft?.defaultTest || 'A');
    const defaultFeedback = String(draft?.feedback || 'end');
    const defaultInput = String(draft?.input || '');
    const availableIds = questions.map(q => q.id);

    app.innerHTML = `<main class="shell">${topbar('Preguntas específicas', true)}
      <section class="panel specific-question-panel">
        <div class="section-head"><div><h2>Consultar o crear una sesión por código</h2><p class="muted">Acepta códigos como 2024A48, 2024-A-48, listas separadas por coma o rangos como 2021A1-20. Los rangos sin año usan los valores por defecto.</p></div></div>
        <div class="specific-defaults"><label>Año por defecto<select id="specific-default-year" class="input">${years.map(year => `<option value="${year}" ${year===defaultYear?'selected':''}>${year}</option>`).join('')}</select></label><label>Prueba<select id="specific-default-test" class="input"><option value="A" ${defaultTest==='A'?'selected':''}>A</option><option value="B" ${defaultTest==='B'?'selected':''}>B</option></select></label><label>Corrección de la sesión<select id="specific-feedback" class="input"><option value="end" ${defaultFeedback==='end'?'selected':''}>Solo al terminar</option><option value="immediate" ${defaultFeedback==='immediate'?'selected':''}>Después de cada pregunta</option></select></label></div>
        <label for="specific-question-input"><strong>Códigos o rangos</strong></label>
        <textarea id="specific-question-input" class="input specific-question-input" rows="5" placeholder="2024A48, 2023B12, 2021A1-20">${esc(defaultInput)}</textarea>
        <div id="specific-question-summary" class="specific-question-summary" aria-live="polite"></div>
        <div id="specific-question-preview" class="specific-question-preview"></div>
        <div class="footer-actions"><button id="specific-consult" class="btn" type="button" disabled>Ver para consulta</button><button id="specific-session" class="btn primary" type="button" disabled>Crear sesión</button></div>
        <p class="muted specific-session-help"><strong>Consulta:</strong> no registra respuestas. <strong>Crear sesión:</strong> permite responder y, al salir, ofrece Continuar después o Cerrar sesión parcial y revisar respondidas.</p>
      </section>
    </main>`;
    attachTopbar();

    const input = document.getElementById('specific-question-input');
    const yearNode = document.getElementById('specific-default-year');
    const testNode = document.getElementById('specific-default-test');
    const summary = document.getElementById('specific-question-summary');
    const preview = document.getElementById('specific-question-preview');
    const consult = document.getElementById('specific-consult');
    const create = document.getElementById('specific-session');
    const feedbackNode = document.getElementById('specific-feedback');
    let parsed = null;

    const saveDraft = () => {
      specificQueryDraft = {
        input:input.value,
        defaultYear:Number(yearNode.value),
        defaultTest:testNode.value,
        feedback:feedbackNode.value,
      };
      return specificQueryDraft;
    };

    const refresh = () => {
      saveDraft();
      if (!QuestionParser.parseQuestionSpec) {
        summary.innerHTML = '<div class="error-msg">No se cargó el parser de códigos. No inicies la sesión.</div>';
        consult.disabled = true;
        create.disabled = true;
        return;
      }
      parsed = QuestionParser.parseQuestionSpec(input.value, {
        defaultYear:Number(yearNode.value),
        defaultTest:testNode.value,
        availableIds,
        minYear:Math.min(...years),
        maxYear:Math.max(...years),
        maxRange:500,
      });
      const errors = [
        ...parsed.invalidTokens.map(item => `${item.token}: ${item.reason}`),
        ...(parsed.notFound.length ? [`No existen: ${parsed.notFound.join(', ')}`] : []),
      ];
      summary.innerHTML = `<div class="specific-kpis"><span><strong>${parsed.ids.length}</strong> encontradas</span><span><strong>${parsed.duplicates.length}</strong> duplicadas retiradas</span><span class="${errors.length?'bad-text':''}"><strong>${errors.length}</strong> incidencias</span></div>${errors.length ? `<ul class="specific-errors">${errors.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}`;
      preview.innerHTML = parsed.ids.length ? `<ol>${parsed.ids.map(id => {
        const q = questions.find(item => item.id === id);
        return `<li><strong>${esc(id)}</strong><span>${esc(String(q?.question || '').slice(0, 150))}${String(q?.question || '').length > 150 ? '…' : ''}</span></li>`;
      }).join('')}</ol>` : '<div class="empty compact">Escribe al menos un código válido.</div>';
      consult.disabled = parsed.ids.length === 0 || errors.length > 0;
      create.disabled = parsed.ids.length === 0 || errors.length > 0;
    };
    [input, yearNode, testNode, feedbackNode].forEach(node => node.addEventListener('input', refresh));
    refresh();

    consult.onclick = () => {
      saveDraft();
      const selected = parsed.ids.map(id => questions.find(q => q.id === id)).filter(Boolean);
      if (!selected.length) return;
      reviewContext = {
        type:'specific_query',
        questions:selected,
        index:0,
        responses:Object.fromEntries(selected.map(q => [q.id, null])),
        scratch:{},
        optionOrders:{},
        shuffleOptions:false,
      };
      renderReviewQuestion();
    };
    create.onclick = () => {
      saveDraft();
      const selected = parsed.ids.map(id => questions.find(q => q.id === id)).filter(Boolean);
      if (!selected.length) return;
      launchStudy(selected, {
        mode:'study',
        count:selected.length,
        randomize:false,
        feedback:feedbackNode.value,
        timeMode:'none',
        secondsPerQuestion:Number(profile?.target_response_seconds || 25),
        totalSeconds:0,
        title:'Preguntas específicas',
        studyMode:'specific_questions',
        shuffleOptions:false,
      });
    };
  }

  function renderSessionBuilder(mode, initialPreset = '') {
    clearTimer();
    const areas = [...new Set(questions.map(q => q.area).filter(Boolean))].sort(localeSort);
    const topicHierarchy = buildTopicHierarchy();
    const years = [...new Set(questions.map(q => Number(q.year)))].sort((a,b) => a-b);
    const tierCounts = {
      muy_alta:questions.filter(q => matchesRentabilityFilter(q, 'muy_alta')).length,
      alta:questions.filter(q => matchesRentabilityFilter(q, 'alta')).length,
      media:questions.filter(q => matchesRentabilityFilter(q, 'media')).length,
      baja:questions.filter(q => matchesRentabilityFilter(q, 'baja')).length,
    };
    const highCount = questions.filter(isHighRentability).length;
    const isExam = mode === 'exam';

    app.innerHTML = `<main class="shell">
      ${topbar(isExam ? 'Crear simulacro' : 'Crear sesión', true)}
      <section class="panel builder">
        <div class="builder-head"><div><h2>${isExam ? 'Simulacro personalizado' : 'Sesión de práctica personalizada'}</h2><p class="muted">Filtra el contenido y define tamaño, tiempo y forma de corrección.</p></div></div>

        <div class="preset-row">
          ${isExam
            ? `<button class="btn small preset" data-preset="80">80 · entrenamiento</button><button class="btn small preset primary" data-preset="200">200 · realista 2026</button>`
            : `<button class="btn small preset" data-preset="10">10 rápidas</button><button class="btn small preset" data-preset="15">15 caminando</button><button class="btn small preset" data-preset="40">40 entrenamiento</button>`}
        </div>

        <form id="builder-form">
          <div class="builder-grid">
            <fieldset><legend>Contenido</legend>
              <label>Estado previo<select id="pool-type" class="input"><option value="all">Todas</option><option value="unseen">Nunca vistas</option><option value="errors">Solo errores</option><option value="correct">Ya acertadas</option></select></label>
              <label>Rentabilidad<select id="rentability" class="input"><option value="all">Todas</option><option value="high" ${highCount ? '' : 'disabled'}>MUY_ALTA + ALTA · ${highCount}</option><option value="muy_alta" ${tierCounts.muy_alta ? '' : 'disabled'}>MUY_ALTA · ${tierCounts.muy_alta}</option><option value="alta" ${tierCounts.alta ? '' : 'disabled'}>ALTA · ${tierCounts.alta}</option><option value="media" ${tierCounts.media ? '' : 'disabled'}>MEDIA · ${tierCounts.media}</option><option value="baja" ${tierCounts.baja ? '' : 'disabled'}>BAJA · ${tierCounts.baja}</option></select></label>
              <small class="muted">La rentabilidad usa el tier y score auditados del topic primario cuando están disponibles. Si la base aún no fue migrada, la app conserva temporalmente el cálculo automático por corpus. No depende de cuántas preguntas hayas respondido.</small>
            </fieldset>

            <fieldset><legend>Cantidad</legend>
              <label>Número de preguntas<input id="question-count" class="input" type="number" min="1" max="2000" value="${isExam && initialPreset === 'official2026' ? 200 : (isExam ? 80 : 15)}" required></label>
              ${isExam ? `<label class="inline-check"><input id="randomize" type="checkbox" checked> <span>Orden aleatorio de preguntas</span></label>` : `
                <label>Seleccionar preguntas por<select id="selection-order" class="input"><option value="RANDOM" selected>Aleatorio</option><option value="RENTABILITY">Más rentables primero</option></select></label>
                <label>Orden dentro de la sesión<select id="presentation-order" class="input"><option value="RANDOM" selected>Aleatorio</option><option value="QUEUE">Respetar selección</option></select></label>
                <small class="muted">Más rentables primero: MUY_ALTA → ALTA → MEDIA → BAJA y, dentro de cada tier, mayor score. El orden de presentación se configura aparte.</small>
              `}
              <label class="inline-check"><input id="shuffle-options" type="checkbox" checked> <span>Mezclar alternativas</span></label>
            </fieldset>

            <fieldset><legend>Áreas</legend><div class="check-list" id="areas-list">${areas.map(a => `<label><input type="checkbox" name="area" value="${esc(a)}" checked> ${esc(a)}</label>`).join('')}</div></fieldset>
            <fieldset><legend>Años</legend><div class="check-list compact">${years.map(y => `<label><input type="checkbox" name="year" value="${y}" checked> ${y}</label>`).join('')}</div></fieldset>

            <fieldset class="wide"><legend>Temas específicos</legend>
              <div class="topic-browser-toolbar">
                <input id="topic-search" class="input topic-search" type="search" placeholder="Buscar tema o especialidad: exantemas, cardiología, sepsis…" autocomplete="off">
                <div class="topic-tools"><button type="button" id="topics-all" class="btn small">Todos</button><button type="button" id="topics-none" class="btn small ghost">Ninguno</button></div>
              </div>
              <div class="topic-browser-help">Navega por Área → Especialidad primaria → Tema clínico primario o usa el buscador. La entidad clínica se conserva como nivel fino dentro de cada pregunta.</div>
              <div id="topic-search-status" class="topic-search-status muted"></div>
              <div class="topic-browser" id="topic-browser">${topicHierarchyHtml(topicHierarchy)}</div>
            </fieldset>

            ${isExam ? `
              <fieldset><legend>Tiempo</legend><label>Minutos del bloque activo<input id="total-minutes" class="input" type="number" min="1" value="${initialPreset === 'official2026' ? 120 : 180}"></label><small class="muted">En formato realista 2026 son 120 min para A y otros 120 min independientes para B.</small></fieldset>
              <fieldset><legend>Descanso por bloques</legend><label>Descanso después de la pregunta<input id="break-after" class="input" type="number" min="0" value="${initialPreset === 'official2026' ? 100 : 0}"></label><label><input id="pause-break" type="checkbox" checked> Pausar cronómetro durante el descanso</label><small class="muted" id="official-format-hint">${initialPreset === 'official2026' ? 'Formato realista 2026 activo: A 100/120 min → 60 min de intermedio → B 100/120 min.' : 'Entrenamiento flexible.'}</small></fieldset>
              <input type="hidden" id="official-two-part" value="${initialPreset === 'official2026' ? '1' : '0'}">
              <input type="hidden" id="feedback-mode" value="end">
            ` : `
              <fieldset><legend>Tiempo</legend>
                <label>Modo<select id="time-mode" class="input"><option value="none">Sin límite</option><option value="per_question">Por pregunta</option><option value="total">Total de sesión</option></select></label>
                <label>Segundos por pregunta<input id="seconds-per-question" class="input" type="number" min="5" value="25"></label>
                <label>Minutos totales<input id="study-total-minutes" class="input" type="number" min="1" value="25"></label>
              </fieldset>
              <fieldset><legend>Corrección</legend><label><select id="feedback-mode" class="input"><option value="immediate">Después de cada pregunta</option><option value="end">Solo al terminar</option></select></label></fieldset>
            `}
          </div>
          <div id="builder-error" class="error-msg"></div>
          <div class="footer-actions"><button type="button" class="btn ghost" data-home>Cancelar</button><button type="submit" class="btn primary">${isExam ? 'Iniciar simulacro' : 'Crear sesión'}</button></div>
        </form>
      </section>
    </main>`;

    attachTopbar();
    const allTopics = () => document.querySelectorAll('input[name="topicPath"]');
    document.getElementById('topics-all').onclick = () => allTopics().forEach(c => c.checked = true);
    document.getElementById('topics-none').onclick = () => allTopics().forEach(c => c.checked = false);

    const setTopicScope = (selector, checked) => document.querySelectorAll(selector).forEach(c => c.checked = checked);
    document.querySelectorAll('[data-topic-select-area]').forEach(btn => {
      btn.onclick = () => setTopicScope(`input[data-topic-area-id="${btn.dataset.topicSelectArea}"]`, true);
    });
    document.querySelectorAll('[data-topic-clear-area]').forEach(btn => {
      btn.onclick = () => setTopicScope(`input[data-topic-area-id="${btn.dataset.topicClearArea}"]`, false);
    });
    document.querySelectorAll('[data-topic-select-specialty]').forEach(btn => {
      btn.onclick = () => setTopicScope(`input[data-topic-specialty-id="${btn.dataset.topicSelectSpecialty}"]`, true);
    });
    document.querySelectorAll('[data-topic-clear-specialty]').forEach(btn => {
      btn.onclick = () => setTopicScope(`input[data-topic-specialty-id="${btn.dataset.topicClearSpecialty}"]`, false);
    });

    const topicSearch = document.getElementById('topic-search');
    const topicSearchStatus = document.getElementById('topic-search-status');
    const applyTopicSearch = () => {
      const query = normalizeTopicSearch(topicSearch.value);
      const leaves = [...document.querySelectorAll('.topic-leaf')];
      let visibleCount = 0;

      leaves.forEach(leaf => {
        const visible = !query || String(leaf.dataset.topicSearch || '').includes(query);
        leaf.hidden = !visible;
        if (visible) visibleCount += 1;
      });

      document.querySelectorAll('.topic-specialty-group').forEach(group => {
        const hasVisible = [...group.querySelectorAll('.topic-leaf')].some(leaf => !leaf.hidden);
        group.hidden = !hasVisible;
        if (query && hasVisible) group.open = true;
      });

      document.querySelectorAll('.topic-area-group').forEach(group => {
        const hasVisible = [...group.querySelectorAll('.topic-leaf')].some(leaf => !leaf.hidden);
        group.hidden = !hasVisible;
        if (query && hasVisible) group.open = true;
      });

      topicSearchStatus.textContent = query
        ? `${visibleCount} tema${visibleCount === 1 ? '' : 's'} coincide${visibleCount === 1 ? '' : 'n'} con la búsqueda.`
        : `${leaves.length} temas disponibles en el corpus cargado.`;
    };
    topicSearch.addEventListener('input', applyTopicSearch);
    applyTopicSearch();

    document.querySelectorAll('.preset').forEach(btn => btn.onclick = () => {
      const p = Number(btn.dataset.preset);
      document.getElementById('question-count').value = p;
      if (isExam && p === 200) {
        document.getElementById('total-minutes').value = 120;
        document.getElementById('break-after').value = 100;
        document.getElementById('official-two-part').value = '1';
        document.getElementById('official-format-hint').textContent = 'Formato realista 2026 activo: A 100/120 min → 60 min de intermedio → B 100/120 min.';
      }
      if (isExam && p === 80) {
        document.getElementById('total-minutes').value = 180;
        document.getElementById('break-after').value = 0;
        document.getElementById('official-two-part').value = '0';
        document.getElementById('official-format-hint').textContent = 'Entrenamiento flexible.';
      }
      if (!isExam && p === 10) {
        document.getElementById('time-mode').value = 'per_question';
        document.getElementById('seconds-per-question').value = 25;
      }
      if (!isExam && p === 15) {
        document.getElementById('time-mode').value = 'per_question';
        document.getElementById('seconds-per-question').value = 25;
      }
      if (!isExam && p === 40) {
        document.getElementById('time-mode').value = 'per_question';
        document.getElementById('seconds-per-question').value = 25;
      }
    });

    if (isExam) {
      const refreshOfficialPresetState = () => {
        const official = Number(document.getElementById('question-count').value) === 200
          && Number(document.getElementById('total-minutes').value) === 120
          && Number(document.getElementById('break-after').value) === 100;
        document.getElementById('official-two-part').value = official ? '1' : '0';
        document.getElementById('official-format-hint').textContent = official
          ? 'Formato realista 2026 activo: A 100/120 min → 60 min de intermedio → B 100/120 min.'
          : 'Entrenamiento flexible.';
      };
      ['question-count','total-minutes','break-after'].forEach(id => document.getElementById(id).addEventListener('input', refreshOfficialPresetState));
    }

    document.getElementById('builder-form').addEventListener('submit', async e => {
      e.preventDefault();
      const config = readBuilderConfig(mode);
      const errorEl = document.getElementById('builder-error');
      if (!config.areas.length) { errorEl.textContent = 'Selecciona al menos un área.'; return; }
      if (!config.years.length) { errorEl.textContent = 'Selecciona al menos un año.'; return; }
      if (document.querySelectorAll('input[name="topicPath"]').length && !config.topicPaths.length) {
        errorEl.textContent = 'Selecciona al menos un tema. Usa “Todos” para incluirlos todos.';
        return;
      }
      const pool = filterPool(config);
      if (!pool.length) { errorEl.textContent = 'No hay preguntas que cumplan esos filtros.'; return; }
      if (config.count > pool.length) {
        errorEl.textContent = `Pediste ${config.count}, pero con estos filtros solo hay ${pool.length}. Reduce la cantidad o amplía los filtros.`;
        return;
      }
      if (mode === 'exam') {
        const selected = (config.randomize ? shuffle(pool) : pool).slice(0, config.count);
        await launchExam(selected, config);
      } else {
        const queue = orderSelectionPool(pool, config.selectionOrder);
        const chosen = queue.slice(0, config.count);
        const presented = orderSessionQuestions(chosen, config.presentationOrder);
        launchStudy(presented, config);
      }
    });
  }

  function readBuilderConfig(mode) {
    const checked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x => x.value);
    const base = {
      mode,
      count: Number(document.getElementById('question-count').value),
      shuffleOptions: document.getElementById('shuffle-options').checked,
      poolType: document.getElementById('pool-type').value,
      rentability: document.getElementById('rentability').value,
      areas: checked('area'),
      years: checked('year').map(Number),
      topicPaths: checked('topicPath'),
      feedback: document.getElementById('feedback-mode').value,
    };
    if (mode === 'exam') {
      // Simulacro: contrato legacy v1.5.2 preservado deliberadamente.
      base.randomize = document.getElementById('randomize').checked;
    } else {
      base.selectionOrder = document.getElementById('selection-order').value === 'RENTABILITY' ? 'RENTABILITY' : 'RANDOM';
      base.presentationOrder = document.getElementById('presentation-order').value === 'QUEUE' ? 'QUEUE' : 'RANDOM';
      // Campo legacy informativo: true solo cuando la combinación reproduce el comportamiento clásico completo.
      base.randomize = base.selectionOrder === 'RANDOM' && base.presentationOrder === 'RANDOM';
    }
    if (mode === 'exam') {
      base.totalSeconds = Math.max(60, Number(document.getElementById('total-minutes').value) * 60);
      base.breakAfter = Math.max(0, Number(document.getElementById('break-after').value || 0));
      base.pauseDuringBreak = document.getElementById('pause-break').checked;
      base.official2026 = document.getElementById('official-two-part')?.value === '1';
      base.twoPartExam = base.official2026;
      base.partSeconds = base.official2026 ? 120 * 60 : base.totalSeconds;
      base.breakDurationSeconds = base.official2026 ? 60 * 60 : 0;
      base.allowEarlyBreak = true;
      base.title = base.official2026 ? 'Simulacro realista 2026 · 200 preguntas' : `Simulacro de ${base.count} preguntas`;
    } else {
      base.timeMode = document.getElementById('time-mode').value;
      base.secondsPerQuestion = Number(document.getElementById('seconds-per-question').value || 25);
      base.totalSeconds = Number(document.getElementById('study-total-minutes').value || 20) * 60;
      base.title = `Sesión de ${base.count} preguntas`;
    }
    return base;
  }

  function canonicalRentabilityScore(q = {}) {
    const explicit = [q.exam_rentability_score, q.rentability_score]
      .map(value => value === null || value === undefined || value === '' ? NaN : Number(value))
      .find(Number.isFinite);
    if (Number.isFinite(explicit)) return explicit <= 1 ? explicit * 100 : explicit;
    const runtime = Number(corpusRentabilityByQuestion.get(q.id)?.score);
    if (Number.isFinite(runtime)) return runtime <= 1 ? runtime * 100 : runtime;
    return Number.NEGATIVE_INFINITY;
  }

  function compareCanonicalRentability(a, b) {
    const tierDelta = rentabilityTierRank(b) - rentabilityTierRank(a);
    if (tierDelta) return tierDelta;
    const aScore = canonicalRentabilityScore(a);
    const bScore = canonicalRentabilityScore(b);
    if (aScore !== bScore) return bScore > aScore ? 1 : -1;
    return localeSort(a?.id, b?.id);
  }

  function orderSelectionPool(pool = [], selectionOrder = 'RANDOM') {
    if (selectionOrder === 'RENTABILITY') return [...pool].sort(compareCanonicalRentability);
    return shuffle(pool);
  }

  function orderSessionQuestions(chosen = [], presentationOrder = 'RANDOM') {
    return presentationOrder === 'QUEUE' ? [...chosen] : shuffle(chosen);
  }

  function filterPool(config) {
    const wrongIds = new Set(attempts.filter(a => !a.is_correct).map(a => a.question_id));
    const correctIds = new Set(attempts.filter(a => a.is_correct).map(a => a.question_id));
    const seenIds = new Set(attempts.map(a => a.question_id));
    return questions.filter(q => {
      if (config.areas.length && !config.areas.includes(q.area)) return false;
      if (config.years.length && !config.years.includes(Number(q.year))) return false;
      if (config.topicPaths.length && !topicSelectionMatches(q, config.topicPaths)) return false;
      if (!matchesRentabilityFilter(q, config.rentability)) return false;
      if (config.poolType === 'unseen' && seenIds.has(q.id)) return false;
      if (config.poolType === 'errors' && !wrongIds.has(q.id)) return false;
      if (config.poolType === 'correct' && !correctIds.has(q.id)) return false;
      return true;
    });
  }

  function launchSimpleStudy(pool, overrides) {
    const config = {
      mode: 'study', count: pool.length, randomize: false, feedback: 'immediate', timeMode: 'none',
      secondsPerQuestion: Number(profile?.target_response_seconds || 25), totalSeconds: 0, title: 'Práctica', ...overrides,
    };
    launchStudy(pool, config);
  }

  async function launchStudy(selected, config) {
    clearTimer();
    if (!selected?.length) return renderMessage('Sin preguntas', 'No se encontraron preguntas para iniciar esta sesión.');
    config = { shuffleOptions: true, ...config, datasetRevision:config?.datasetRevision || datasetManifest?.dataset_revision || null };
    currentExam = null;
    currentStudy = {
      row:null,
      config,
      questions:selected,
      index:0,
      responses:{},
      scratch:{},
      marked:{},
      durations:{},
      answerTimes:{},
      timeSpent:{},
      optionOrders:createOptionOrders(selected, config.shuffleOptions !== false),
      totalRemaining:config.timeMode === 'total' ? config.totalSeconds : null,
      attemptIdsByQuestion:{},
      clientAttemptIdsByQuestion:{},
      activeTimeMs:0,
      pausedTimeMs:0,
      lastVisibleAt:sessionNowIso(),
      deviceInstanceId,
    };
    const state = studyStateSnapshot();
    const row = await createPersistentSession('study', selected, config, state);
    if (!currentStudy) return;
    currentStudy.row = row;
    claimSessionLease(row.id);
    beginSessionActivity();
    activateSessionNavigationGuard();
    renderStudyQuestion();
  }

  function studyCurrentQuestion() { return currentStudy?.questions[currentStudy.index]; }

  function cancelCurrentStudy() {
    requestCurrentSessionExit();
  }

  async function continueStudyLater() {
    if (!currentStudy || sessionActionInProgress) return;
    sessionActionInProgress = true;
    try {
      clearTimer();
      saveStudyDuration();
      endSessionActivity();
      await flushCurrentSessionSave();
      currentStudy = null;
      deactivateSessionNavigationGuard();
      renderDashboard();
    } finally {
      sessionActionInProgress = false;
    }
  }


  function studyQuestionTargetMs(q) {
    const baseTargetSeconds = Number(currentStudy?.config?.secondsPerQuestion || profile?.target_response_seconds || 25);
    return effectiveTargetSeconds(q, baseTargetSeconds) * 1000;
  }

  function studyQuestionRemainingSeconds(q) {
    const targetMs = studyQuestionTargetMs(q);
    const usedMs = Number(currentStudy?.durations?.[q.id] || 0);
    return Math.max(0, Math.ceil((targetMs - usedMs) / 1000));
  }

  function studyQuestionLocked(q) {
    return Boolean(currentStudy?.responses?.[q.id]?.locked);
  }

  function renderStudyQuestion() {
    if (currentStudy?.row && sessionExpiredByLocalDay(currentStudy.row)) {
      handleCurrentSessionDayBoundary().catch(error => console.warn('Day-boundary close failed.', error));
      return;
    }
    clearTimer();
    scrollPageTop();
    const q = studyCurrentQuestion();
    if (!q) return finishStudy();
    questionStartedAt = performance.now();
    const responseState = currentStudy.responses[q.id] || {};
    const selected = responseState.selected ?? null;
    const locked = Boolean(responseState.locked);
    currentStudy.scratch ||= {};
    const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
    const questionDoubt = questionHasDoubt(currentStudy.scratch, q.id);
    const opts = displayOptionList(q, currentStudy.optionOrders, currentStudy.config.shuffleOptions !== false);
    const baseTargetSeconds = Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25);
    const adaptiveTargetSeconds = effectiveTargetSeconds(q, baseTargetSeconds);
    const remainingQuestionSeconds = currentStudy.config.timeMode === 'per_question'
      ? (locked ? 0 : studyQuestionRemainingSeconds(q))
      : null;
    const timerHtml = currentStudy.config.timeMode === 'per_question'
      ? `<div id="timer" class="timer ${locked?'urgent':''}">${formatTime(remainingQuestionSeconds)}</div>`
      : currentStudy.config.timeMode === 'total'
        ? `<div id="timer" class="timer">${formatTime(currentStudy.totalRemaining)}</div>` : '';
    const targetTag = currentStudy.config.timeMode === 'none'
      ? `<span class="tag target-tag">🎯 ${adaptiveTargetSeconds} s objetivo</span>`
      : '';
    const metadataVisible = Boolean(responseState.metadataRevealed);

    app.innerHTML = `<main class="shell">
      ${topbar(currentStudy.config.title, false)}
      <div class="question-step-nav" aria-label="Navegación superior de la sesión">
        <button id="prev-study-top" class="btn small ghost" ${currentStudy.config.feedback !== 'end' || currentStudy.index===0?'disabled':''}>← Anterior</button>
        <strong>${currentStudy.index+1}/${currentStudy.questions.length}</strong>
        <button id="next-study-top" class="btn small primary" ${currentStudy.config.feedback === 'immediate' ? 'hidden disabled' : ''}>${currentStudy.index+1===currentStudy.questions.length?'Terminar':'Siguiente →'}</button>
      </div>
      <section class="panel question-card">
        <div class="progress"><div style="width:${(currentStudy.index/currentStudy.questions.length)*100}%"></div></div>
        <div class="q-head"><span class="tag">${currentStudy.index+1}/${currentStudy.questions.length}</span>${questionDoubtButton(q.id, questionDoubt)}<span id="study-question-metadata" class="question-meta-tags" ${metadataVisible?'':'hidden'} aria-hidden="${metadataVisible?'false':'true'}">${metadataVisible?studyQuestionMetadataTags(q):''}</span>${targetTag}${timerHtml}</div>
        <div class="q-body"><p class="q-text">${esc(q.question)}</p>
          ${questionMediaHtml(q)}
          ${locked ? `<div class="banner compact"><strong>⏱ Pregunta cerrada.</strong> ${responseState.timedOut ? 'El tiempo terminó sin respuesta; contará como un único intento fallido por tiempo.' : 'El tiempo terminó después de que respondiste; se conserva esa respuesta y ya no puede modificarse.'}</div>` : ''}
          <div class="options">${opts.map(o => optionButton(o, selected)).join('')}</div>
          <div class="dont-know-row"><button id="dont-know-study" class="btn ghost dont-know-btn" type="button">${currentStudy.config.feedback === 'immediate' ? '🤷 No sé · mostrar respuesta' : '🤷 No sé · continuar'}</button><span class="muted">Cuenta como respuesta incorrecta explícita; no como pregunta en blanco ni como tiempo agotado.</span></div>
        </div>
        <div id="feedback"></div>
      </section>
      ${currentStudy.config.feedback === 'end' ? `<div class="footer-actions"><button id="prev-study" class="btn ghost" ${currentStudy.index===0?'disabled':''}>← Anterior</button><button id="cancel-study" class="btn danger ghost-danger">Cerrar o continuar después</button><button id="next-study" class="btn primary">${currentStudy.index+1===currentStudy.questions.length?'Terminar':'Siguiente →'}</button></div>` : `<div class="footer-actions"><button id="cancel-study" class="btn danger ghost-danger">Cerrar o continuar después</button></div>`}
    </main>`;
    attachTopbar();

    document.querySelectorAll('.option').forEach(btn => {
      if (locked) btn.disabled = true;
      else btn.onclick = () => handleStudyAnswer(btn.dataset.letter);
    });
    const dontKnowBtn = document.getElementById('dont-know-study');
    if (dontKnowBtn) {
      if (locked) dontKnowBtn.disabled = true;
      else dontKnowBtn.onclick = handleStudyDontKnow;
    }
    document.querySelectorAll('[data-question-doubt-top]').forEach(btn => {
      if (btn.dataset.questionDoubt !== q.id) return;
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const active = !questionHasDoubt(currentStudy.scratch || {}, q.id);
        currentStudy.scratch = setQuestionDoubt(currentStudy.scratch || {}, q.id, active);
        refreshQuestionDoubtButtons(q.id, active);
        scheduleCurrentSessionSave();
        const attemptId = currentStudy.attemptIdsByQuestion?.[q.id];
        if (attemptId) await setAttemptQuestionDoubtAfterFeedback(attemptId, q, active);
      };
    });
    document.getElementById('cancel-study').onclick = cancelCurrentStudy;
    if (currentStudy.config.feedback === 'end') {
      const goPrev = () => {
        saveStudyDuration();
        currentStudy.index--;
        scheduleCurrentSessionSave({ delayMs:SESSION_NAVIGATION_CHECKPOINT_MS });
        renderStudyQuestion();
      };
      const goNext = () => {
        saveStudyDuration();
        if (currentStudy.index + 1 >= currentStudy.questions.length) finishStudy();
        else {
          currentStudy.index++;
          scheduleCurrentSessionSave({ delayMs:SESSION_NAVIGATION_CHECKPOINT_MS });
          renderStudyQuestion();
        }
      };
      document.getElementById('prev-study').onclick = goPrev;
      document.getElementById('prev-study-top').onclick = goPrev;
      document.getElementById('next-study').onclick = goNext;
      document.getElementById('next-study-top').onclick = goNext;
    }
    startStudyTimer();
  }

  function startStudyTimer() {
    if (currentStudy.config.timeMode === 'per_question') {
      const q = studyCurrentQuestion();
      if (!q) return;
      if (studyQuestionLocked(q)) {
        updateTimer(0);
        return;
      }
      let remaining = studyQuestionRemainingSeconds(q);
      updateTimer(remaining);
      if (remaining <= 0) {
        handleStudyTimeout();
        return;
      }
      timerId = setInterval(() => {
        remaining--;
        updateTimer(remaining);
        if (remaining <= 0) {
          clearTimer();
          handleStudyTimeout();
        }
      }, 1000);
    } else if (currentStudy.config.timeMode === 'total') {
      updateTimer(currentStudy.totalRemaining);
      timerId = setInterval(() => {
        currentStudy.totalRemaining--;
        updateTimer(currentStudy.totalRemaining);
        if (currentStudy.totalRemaining % 30 === 0) scheduleCurrentSessionSave();
        if (currentStudy.totalRemaining <= 0) {
          clearTimer();
          finishStudy(true);
        }
      }, 1000);
    }
  }

  function updateTimer(seconds) {
    const el = document.getElementById('timer');
    if (!el) return;
    el.textContent = formatTime(seconds);
    el.classList.toggle('urgent', seconds <= 10);
  }

  function saveStudyDuration() {
    if (!currentStudy) return;
    const q = studyCurrentQuestion();
    if (!q || studyQuestionLocked(q)) return;
    const elapsed = Math.max(0, Math.round(performance.now() - questionStartedAt));
    currentStudy.durations[q.id] = (currentStudy.durations[q.id] || 0) + elapsed;
    questionStartedAt = performance.now();
  }

  async function handleStudyAnswer(letter) {
    const q = studyCurrentQuestion();
    if (!q || studyQuestionLocked(q)) return;
    saveStudyDuration();
    detachInheritedAttemptIdentity(currentStudy, q.id);
    const previousResponse = currentStudy.responses[q.id] || {};
    currentStudy.responses[q.id] = { ...previousResponse, selected: letter, didNotKnow: false, timedOut: false };
    currentStudy.answerTimes[q.id] = Number(currentStudy.durations[q.id] || 0);
    scheduleCurrentSessionSave({ localOnly:currentStudy.config.feedback === 'immediate' });

    if (currentStudy.config.feedback === 'immediate') {
      clearTimer();
      const isCorrect = letter === q.official_answer;
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      const savedAttempt = await recordSingleAttempt(
        q, letter, isCorrect, currentStudy.durations[q.id] || 0,
        currentStudy.config.studyMode || 'custom_study', false,
        {
          uncertainOptions,
          questionDoubt:questionHasDoubt(currentStudy.scratch, q.id),
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25),
          ...sessionAttemptMeta(currentStudy, q.id),
        }
      );
      if (savedAttempt?.id) currentStudy.attemptIdsByQuestion[q.id] = savedAttempt.id;
      currentStudy.responses[q.id] = { ...currentStudy.responses[q.id], metadataRevealed: true };
      scheduleCurrentSessionSave();
      disableOptionsAndPaint(q, letter);
      revealStudyQuestionMetadata(q);
      renderFeedback(q, letter, isCorrect, () => {
        currentStudy.index++;
        scheduleCurrentSessionSave({ delayMs:SESSION_NAVIGATION_CHECKPOINT_MS });
        renderStudyQuestion();
      }, false, false, uncertainOptions, {
        attemptId: savedAttempt?.id || null,
        responseTimeMs: currentStudy.durations[q.id] || 0,
        targetSeconds: Number(savedAttempt?.target_seconds || effectiveTargetSeconds(q, currentStudy.config.secondsPerQuestion)),
        wasUncertainAtAnswer: Boolean(savedAttempt?.was_uncertain),
      });
    } else {
      document.querySelectorAll('.option').forEach(btn => btn.classList.toggle('selected', btn.dataset.letter === letter));
    }
  }

  async function handleStudyDontKnow() {
    const q = studyCurrentQuestion();
    if (!q || !currentStudy || studyQuestionLocked(q)) return;

    saveStudyDuration();
    detachInheritedAttemptIdentity(currentStudy, q.id);
    currentStudy.responses[q.id] = { selected: null, didNotKnow: true };
    scheduleCurrentSessionSave({ localOnly:currentStudy.config.feedback === 'immediate' });

    if (currentStudy.config.feedback === 'immediate') {
      clearTimer();
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      const savedAttempt = await recordSingleAttempt(
        q, null, false, currentStudy.durations[q.id] || 0,
        currentStudy.config.studyMode || 'custom_study', false,
        {
          uncertainOptions,
          questionDoubt:questionHasDoubt(currentStudy.scratch, q.id),
          dontKnow: true,
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25),
          ...sessionAttemptMeta(currentStudy, q.id),
        }
      );
      if (savedAttempt?.id) currentStudy.attemptIdsByQuestion[q.id] = savedAttempt.id;
      currentStudy.responses[q.id] = { ...currentStudy.responses[q.id], metadataRevealed: true };
      scheduleCurrentSessionSave();
      disableOptionsAndPaint(q, null);
      revealStudyQuestionMetadata(q);
      const dontKnowBtn = document.getElementById('dont-know-study');
      if (dontKnowBtn) dontKnowBtn.disabled = true;
      renderFeedback(
        q, null, false,
        () => { currentStudy.index++; scheduleCurrentSessionSave({ delayMs:SESSION_NAVIGATION_CHECKPOINT_MS }); renderStudyQuestion(); },
        false, false, uncertainOptions,
        {
          attemptId: savedAttempt?.id || null,
          responseTimeMs: currentStudy.durations[q.id] || 0,
          targetSeconds: Number(savedAttempt?.target_seconds || effectiveTargetSeconds(q, currentStudy.config.secondsPerQuestion)),
          wasUncertainAtAnswer: Boolean(savedAttempt?.was_uncertain),
          didNotKnow: true,
        }
      );
    } else {
      currentStudy.index++;
      scheduleCurrentSessionSave({ delayMs:SESSION_NAVIGATION_CHECKPOINT_MS });
      if (currentStudy.index >= currentStudy.questions.length) finishStudy();
      else renderStudyQuestion();
    }
  }

  function handleStudyTimeout() {
    const q = studyCurrentQuestion();
    if (!q || !currentStudy || studyQuestionLocked(q)) return;
    saveStudyDuration();
    detachInheritedAttemptIdentity(currentStudy, q.id);
    const targetMs = studyQuestionTargetMs(q);
    currentStudy.durations[q.id] = targetMs;
    const prior = currentStudy.responses[q.id] || {};
    const hadAnswer = prior.selected != null;

    if (currentStudy.config.feedback === 'immediate') {
      currentStudy.responses[q.id] = { selected: null, timedOut: true, locked: true, lockedByTimeout: true };
      scheduleCurrentSessionSave({ localOnly:true });
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      recordSingleAttempt(
        q, null, false, targetMs,
        currentStudy.config.studyMode || 'custom_study', true,
        {
          uncertainOptions,
          questionDoubt:questionHasDoubt(currentStudy.scratch, q.id),
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25),
          ...sessionAttemptMeta(currentStudy, q.id),
        }
      ).then((savedAttempt) => {
        if (savedAttempt?.id) currentStudy.attemptIdsByQuestion[q.id] = savedAttempt.id;
        currentStudy.responses[q.id] = { ...currentStudy.responses[q.id], metadataRevealed: true };
        scheduleCurrentSessionSave();
        disableOptionsAndPaint(q, null);
        revealStudyQuestionMetadata(q);
          renderFeedback(
          q, null, false,
          () => { currentStudy.index++; scheduleCurrentSessionSave({ delayMs:SESSION_NAVIGATION_CHECKPOINT_MS }); renderStudyQuestion(); },
          true, false, uncertainOptions,
          {
            attemptId: savedAttempt?.id || null,
            responseTimeMs: targetMs,
            targetSeconds: Number(savedAttempt?.target_seconds || effectiveTargetSeconds(q, currentStudy.config.secondsPerQuestion)),
            wasUncertainAtAnswer: Boolean(savedAttempt?.was_uncertain),
          }
        );
      });
      return;
    }

    // Corrección al final + tiempo por pregunta:
    // - si no hubo respuesta, el tiempo agotado cierra la pregunta como fallo por tiempo;
    // - si ya había una respuesta, se conserva y se cierra para impedir cambios posteriores;
    // - volver atrás nunca reinicia el reloj ni crea un segundo intento.
    currentStudy.responses[q.id] = {
      ...prior,
      selected: prior.selected ?? null,
      timedOut: !hadAnswer,
      locked: true,
      lockedByTimeout: true,
    };

    currentStudy.index++;
    scheduleCurrentSessionSave({ delayMs:SESSION_NAVIGATION_CHECKPOINT_MS });
    if (currentStudy.index >= currentStudy.questions.length) finishStudy();
    else renderStudyQuestion();
  }

  function attemptsForSession(sessionId) {
    return attempts.filter(attempt => String(attempt.session_id || '') === String(sessionId || ''));
  }

  function studyAttemptPayload(study, q) {
    const response = study.responses[q.id] || {};
    const selected = response.selected ?? null;
    const didNotKnow = Boolean(response.didNotKnow);
    const timedOut = Boolean(response.timedOut);
    const uncertainOptions = uncertaintyOptionsFor(study.scratch, q.id);
    const responseTimeMs = timedOut
      ? effectiveTargetSeconds(q, Number(study.config.secondsPerQuestion || profile?.target_response_seconds || 25)) * 1000
      : Number(study.answerTimes?.[q.id] ?? study.durations?.[q.id] ?? 0);
    return makeAttempt(
      q,
      selected,
      !didNotKnow && !timedOut && selected === q.official_answer,
      responseTimeMs,
      study.config.studyMode || (study.config.feedback === 'end' ? 'custom_study_end' : 'custom_study_immediate'),
      timedOut,
      {
        uncertainOptions,
        questionDoubt:questionHasDoubt(study.scratch, q.id),
        dontKnow:didNotKnow,
        baseTargetSeconds:Number(study.config.secondsPerQuestion || profile?.target_response_seconds || 25),
        ...sessionAttemptMeta(study, q.id),
      }
    );
  }

  async function ensureStudyAttempts(study, questionList) {
    const sessionId = study?.row?.id;
    const existing = new Map(attemptsForSession(sessionId).map(attempt => [attempt.question_id, attempt]));
    const missingPayload = [];

    for (const q of questionList) {
      if (existing.has(q.id)) continue;
      const persisted = persistedAttemptForIdentity(study, q.id);
      if (persisted) {
        // Un client_attempt_id identifica un attempt global, no "un attempt por sesión".
        // En una recuperación puede apuntar al attempt histórico de la sesión fuente.
        existing.set(q.id, persisted);
        continue;
      }

      const hasPersistedIdentity = Boolean(
        study?.attemptIdsByQuestion?.[q.id]
        || study?.clientAttemptIdsByQuestion?.[q.id]
      );
      if (study?.row?.config?.recovery && hasPersistedIdentity) {
        console.warn('Recovery attempt identity not loaded; refusing to fabricate a duplicate.', study.row.id, q.id);
        continue;
      }
      missingPayload.push(studyAttemptPayload(study, q));
    }

    const saved = missingPayload.length ? await recordAttemptsBatch(missingPayload) : [];
    for (const attempt of saved) existing.set(attempt.question_id, attempt);
    for (const [questionId, attempt] of existing.entries()) {
      if (attempt?.id) study.attemptIdsByQuestion[questionId] = attempt.id;
    }
    return [...existing.values()].filter(attempt => questionList.some(q => q.id === attempt.question_id));
  }

  async function finalizeSessionRow(holder, state, { partial = false, retryAfterConflict = true } = {}) {
    const row = holder?.row;
    if (!row?.id) return null;
    const normalizedState = normalizeSessionState(state);
    const answeredCount = answeredIdsFor(row, normalizedState).length;
    const now = sessionNowIso();
    const expectedRevision = Number(row.state_revision || 0);
    const completed = {
      ...row,
      state:normalizedState,
      status:'completed',
      is_partial:Boolean(partial),
      closed_reason:partial ? 'completed_partial' : 'completed_full',
      answered_count:answeredCount,
      planned_count:row.planned_count || row.question_ids?.length || 0,
      active_time_ms:normalizedState.activeTimeMs || 0,
      paused_time_ms:normalizedState.pausedTimeMs || 0,
      completed_at:now,
      updated_at:now,
      client_app_version:APP_VERSION,
      state_schema_version:1,
      state_revision:expectedRevision + 1,
    };
    await saveSessionShadow(completed, cloudConfigured ? 'pending' : 'local');
    removeActiveSessionInMemory(row.id);
    upsertSessionInMemory(completed);

    if (cloudConfigured) {
      const updatePayload = {
        state:normalizedState,
        status:'completed',
        is_partial:Boolean(partial),
        closed_reason:partial ? 'completed_partial' : 'completed_full',
        answered_count:answeredCount,
        planned_count:completed.planned_count,
        active_time_ms:completed.active_time_ms,
        paused_time_ms:completed.paused_time_ms,
        completed_at:now,
        updated_at:now,
        last_synced_at:now,
        client_app_version:APP_VERSION,
        state_schema_version:1,
        state_revision:completed.state_revision,
      };
      const { data, error } = await supa.from('practice_sessions')
        .update(updatePayload)
        .eq('id', row.id)
        .eq('status', 'active')
        // FIX-SESSION-008: cierre optimista; nunca sobrescribir una revision nueva.
        .eq('state_revision', expectedRevision)
        .select()
        .maybeSingle();
      if (error) {
        await sessionStore?.queueOperation('CLOSE_SESSION', { sessionId:row.id, expectedRevision, updatePayload }, `CLOSE_SESSION:${row.id}`);
        const pending = { ...completed, syncStatus:'offline', syncError:error.message };
        await saveSessionShadow(pending, 'offline');
        upsertSessionInMemory(pending);
        return pending;
      }
      if (!data) {
        const conflictSource = { ...row, state:normalizedState, answered_count:answeredCount, active_time_ms:completed.active_time_ms, paused_time_ms:completed.paused_time_ms };
        const recovered = await handleSessionRevisionConflict(
          { kind:holder === currentExam ? 'exam' : 'study', holder, row, state:normalizedState },
          conflictSource,
          { message:'SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE', code:'PT409' },
          { duringClose:true }
        );
        if (retryAfterConflict && recovered?.id && holder?.row?.id === recovered.id) {
          return finalizeSessionRow(holder, normalizedState, { partial, retryAfterConflict:false });
        }
        return recovered || completed;
      }
      const synced = { ...data, syncStatus:'synced' };
      await saveSessionShadow(synced, 'synced');
      upsertSessionInMemory(synced);
      if (synced.config?.recovery) await retireRecoverySourceAfterClose(synced);
      return synced;
    }

    saveLocalSessions();
    if (completed.config?.recovery) await retireRecoverySourceAfterClose(completed);
    return completed;
  }

  async function closeStudyPartial() {
    if (!currentStudy || sessionActionInProgress) return;
    const answeredQuestions = currentStudy.questions.filter(q => responseCountsAsAnswered(currentStudy.responses?.[q.id]));
    if (!answeredQuestions.length) return;
    sessionActionInProgress = true;
    try {
      clearTimer();
      saveStudyDuration();
      endSessionActivity();
      await drainPendingSessionSaveWithoutWrite();
      const savedAttempts = await ensureStudyAttempts(currentStudy, answeredQuestions);
      const state = studyStateSnapshot();
      await finalizeSessionRow(currentStudy, state, { partial:true });
      reviewContext = {
        type:'study_session',
        sessionId:currentStudy.row.id,
        partial:true,
        questions:answeredQuestions,
        allQuestions:answeredQuestions,
        sessionTitle:currentStudy.config.title || 'Práctica',
        originalQuestionIds:currentStudy.questions.map(question => question.id),
        responses:currentStudy.responses,
        scratch:currentStudy.scratch || {},
        optionOrders:currentStudy.optionOrders || {},
        shuffleOptions:currentStudy.config.shuffleOptions !== false,
        attemptsByQuestion:Object.fromEntries(savedAttempts.map(attempt => [attempt.question_id, attempt])),
        index:0,
      };
      currentStudy = null;
      deactivateSessionNavigationGuard();
      renderReviewSummary();
    } finally {
      sessionActionInProgress = false;
    }
  }

  async function finishStudy(timeExpired = false) {
    clearTimer();
    if (!currentStudy || sessionActionInProgress) return currentStudy ? null : renderDashboard();
    sessionActionInProgress = true;
    try {
      saveStudyDuration();
      endSessionActivity();
      await drainPendingSessionSaveWithoutWrite();
      const study = currentStudy;
      const answeredQuestions = study.questions.filter(q => responseCountsAsAnswered(study.responses?.[q.id]));
      const savedStudyAttempts = await ensureStudyAttempts(study, answeredQuestions);
      const state = studyStateSnapshot();
      await finalizeSessionRow(study, state, { partial:false });

      const result = study.questions.map(q => {
        const response = study.responses[q.id] || {};
        const selected = response.selected ?? null;
        const timedOut = Boolean(response.timedOut);
        return {
          q,
          selected,
          didNotKnow:Boolean(response.didNotKnow),
          timedOut,
          correct:!response.didNotKnow && !timedOut && selected === q.official_answer,
        };
      });
      const correct = result.filter(row => row.correct).length;
      const uncertainCount = study.questions.filter(q => questionHasDoubt(study.scratch, q.id)).length;
      reviewContext = {
        type:'study_session',
        sessionId:study.row.id,
        partial:false,
        questions:study.questions,
        allQuestions:study.questions,
        sessionTitle:study.config.title || 'Práctica',
        originalQuestionIds:study.questions.map(question => question.id),
        responses:study.responses,
        scratch:study.scratch || {},
        optionOrders:study.optionOrders || {},
        shuffleOptions:study.config.shuffleOptions !== false,
        attemptsByQuestion:Object.fromEntries(savedStudyAttempts.map(attempt => [attempt.question_id, attempt])),
        index:0,
      };
      currentStudy = null;
      deactivateSessionNavigationGuard();

      app.innerHTML = `<main class="shell">${topbar('Sesión terminada', true)}<section class="panel empty"><h2>${timeExpired ? 'Tiempo terminado' : 'Sesión completada'}</h2><p class="score-big">${correct}/${result.length}</p><p>${pct(correct, result.length)} de aciertos · ${answeredQuestions.length} respondidas · ${uncertainCount} preguntas con duda registrada</p><div class="actions"><button id="review-btn" class="btn">Revisar respuestas</button><button class="btn primary" data-home>Volver al inicio</button></div></section></main>`;
      attachTopbar();
      document.getElementById('review-btn').onclick = () => renderReviewSummary();
    } finally {
      sessionActionInProgress = false;
    }
  }

  async function launchExam(selected, config) {
    clearTimer();
    if (!selected?.length) return renderMessage('Sin preguntas', 'No se encontraron preguntas para iniciar este simulacro.');
    config = { shuffleOptions:true, ...config, datasetRevision:config?.datasetRevision || datasetManifest?.dataset_revision || null };
    currentStudy = null;
    const state = normalizeSessionState({
      schemaVersion:1,
      currentIndex:0,
      responses:{},
      marked:{},
      scratch:{},
      timeSpent:{},
      optionOrders:createOptionOrders(
        selected,
        config.shuffleOptions !== false && config.examLayout !== 'paper'
      ),
      remainingSeconds:config.partSeconds || config.totalSeconds,
      totalRemaining:null,
      breakTaken:false,
      activeTimeMs:0,
      pausedTimeMs:0,
      lastVisibleAt:sessionNowIso(),
      lastSavedAt:sessionNowIso(),
      deviceInstanceId,
    });
    const sessionRow = await createPersistentSession('exam', selected, config, state);
    currentExam = { row:sessionRow, config, questions:selected, state };
    claimSessionLease(sessionRow.id);
    beginSessionActivity();
    activateSessionNavigationGuard();
    if (config.examLayout === 'paper') renderHistoricalExamPaper();
    else renderExamQuestion();
  }

  async function resumePersistentSession(rawRow) {
    const row = SessionCore.normalizeSessionRow ? SessionCore.normalizeSessionRow(rawRow) : rawRow;
    if (sessionExpiredByLocalDay(row)) {
      const closed = await expireActiveSessionAtDayBoundary(row);
      if (closed?.status === 'completed') await openHistorySession(closed.id, sessionStartLocalDate(row));
      else renderDashboard();
      return;
    }
    if (!claimSessionLease(row.id)) {
      alert('Esta sesión ya está abierta en otra pestaña. Ciérrala allí o espera unos 18 segundos para que venza el bloqueo antes de reanudarla aquí.');
      return;
    }
    const selected = (row.question_ids || []).map(id => questions.find(q => q.id === id)).filter(Boolean);
    if (!selected.length) { releaseActiveSessionLease(); return renderMessage('No se pudo reanudar', 'Las preguntas de la sesión ya no están disponibles.'); }

    if (row.mode === 'study') {
      currentExam = null;
      const study = {
        row,
        config:row.config || {},
        questions:selected,
      };
      currentStudy = SessionCore.stateToStudy
        ? SessionCore.stateToStudy(row, selected, createOptionOrders)
        : applyStateToStudy(study, row.state || {});
      currentStudy.row = row;
      currentStudy.config = row.config || {};
      currentStudy.questions = selected;
      applyStateToStudy(currentStudy, row.state || {});
      beginSessionActivity();
      activateSessionNavigationGuard();
      renderStudyQuestion();
      return;
    }

    currentStudy = null;
    const state = normalizeSessionState(row.state || {});
    const config = row.config || {};
    state.optionOrders = Object.keys(state.optionOrders || {}).length
      ? state.optionOrders
      : createOptionOrders(selected, config.shuffleOptions !== false && config.examLayout !== 'paper');
    state.currentIndex = Math.min(Math.max(0, state.currentIndex || 0), Math.max(0, selected.length - 1));
    state.remainingSeconds ??= config.partSeconds || config.totalSeconds || 0;
    currentExam = { row, config, questions:selected, state };
    beginSessionActivity();
    activateSessionNavigationGuard();
    if (examBreakPending()) { endSessionActivity(); renderBreakScreen(); }
    else if (config.examLayout === 'paper') renderHistoricalExamPaper();
    else renderExamQuestion();
  }

  function accumulateExamTime() {
    if (!currentExam || !examQuestionEnteredAt) return;
    const q = currentExam.questions[currentExam.state.currentIndex];
    if (!q) return;
    const elapsed = Math.max(0, Math.round(performance.now() - examQuestionEnteredAt));
    currentExam.state.timeSpent[q.id] = (currentExam.state.timeSpent[q.id] || 0) + elapsed;
    examQuestionEnteredAt = performance.now();
  }

  async function persistExamState() {
    if (!currentExam) return null;
    currentExam.state = normalizeSessionState(currentExam.state);
    return scheduleCurrentSessionSave();
  }

  async function continueExamLater() {
    if (!currentExam || sessionActionInProgress) return;
    sessionActionInProgress = true;
    try {
      clearTimer();
      accumulateExamTime();
      endSessionActivity();
      await flushCurrentSessionSave();
      currentExam = null;
      deactivateSessionNavigationGuard();
      renderDashboard();
    } finally {
      sessionActionInProgress = false;
    }
  }

  async function exitCurrentExam() {
    return continueExamLater();
  }

  async function cancelCurrentExam() {
    requestCurrentSessionExit();
  }

  function renderExamQuestion() {
    if (currentExam?.row && sessionExpiredByLocalDay(currentExam.row)) {
      handleCurrentSessionDayBoundary().catch(error => console.warn('Day-boundary close failed.', error));
      return;
    }
    if (examBreakPending()) return renderBreakScreen();
    clearTimer();
    scrollPageTop();
    const { start:activeStart, end:activeEnd } = activeExamBounds();
    if (currentExam.state.currentIndex < activeStart || currentExam.state.currentIndex >= activeEnd) currentExam.state.currentIndex = activeStart;
    const q = currentExam.questions[currentExam.state.currentIndex];
    const selected = sessionSelected(currentExam.state, q.id);
    const marked = Boolean(currentExam.state.marked[q.id]);
    currentExam.state.scratch ||= {};
    const questionDoubt = questionHasDoubt(currentExam.state.scratch, q.id);
    examQuestionEnteredAt = performance.now();
    const partLabel = examPartLabel();
    const position = currentExam.state.currentIndex - activeStart + 1;
    const blockCount = activeEnd - activeStart;
    const nextLabel = currentExam.state.currentIndex + 1 === activeEnd
      ? (twoPartExamEnabled() && !currentExam.state.breakTaken ? 'Revisar Parte A' : 'Ir al final')
      : 'Siguiente →';

    app.innerHTML = `<main class="shell exam-shell">
      ${topbar(currentExam.config.title || 'Simulacro', false)}
      <div class="question-step-nav exam-question-step-nav" aria-label="Navegación superior del simulacro">
        <button class="btn small ghost" data-exam-prev ${currentExam.state.currentIndex===activeStart?'disabled':''}>← Anterior</button>
        <strong>${position}/${blockCount}${partLabel?` · ${esc(partLabel)}`:''}</strong>
        <button class="btn small ${marked?'warn-btn':'ghost'}" data-exam-mark>${marked?'⚑ Marcada':'⚐ Marcar'}</button>
        <button class="btn small primary" data-exam-next>${nextLabel}</button>
      </div>
      <section class="exam-layout">
        <div class="panel question-card">
          <div class="progress"><div style="width:${((position-1)/Math.max(1,blockCount))*100}%"></div></div>
          <div class="q-head"><span class="tag">${position}/${blockCount}${partLabel?` · ${esc(partLabel)}`:''}</span>${questionDoubtButton(q.id, questionDoubt)}<div id="timer" class="timer">${formatTime(currentExam.state.remainingSeconds)}</div></div>
          <div class="q-body"><p class="q-text">${esc(q.question)}</p>
            ${questionMediaHtml(q)}
            <div class="options">${displayOptionList(
              q,
              currentExam.state.optionOrders,
              currentExam.config.shuffleOptions !== false && currentExam.config.examLayout !== 'paper'
            ).map(o => optionButton(o, selected)).join('')}</div>
          </div>
        </div>
        <aside class="panel exam-nav"><div class="exam-nav-head"><strong>Navegación${partLabel?` · ${esc(partLabel)}`:''}</strong><button class="btn small ${marked?'warn-btn':''}" data-exam-mark>${marked?'⚑ Marcada':'⚐ Marcar'}</button></div><div class="question-grid">${activeExamEntries().map(({q:x,index:i}) => examGridButton(x,i)).join('')}</div><div class="legend"><span>● respondida</span><span>⚑ revisar</span></div></aside>
      </section>
      <div class="exam-controls">
        <button class="btn ghost" data-exam-prev ${currentExam.state.currentIndex===activeStart?'disabled':''}>← Anterior</button>
        <button id="session-exit-exam" class="btn ghost">Cerrar o continuar después</button>
        <button id="finish-exam" class="btn danger">${twoPartExamEnabled()&&!currentExam.state.breakTaken?'Finalizar Parte A':'Entregar examen'}</button>
        <button class="btn primary" data-exam-next>${nextLabel}</button>
      </div>
    </main>`;
    attachTopbar();

    document.querySelectorAll('.option').forEach(btn => btn.onclick = async () => {
      detachInheritedAttemptIdentity(currentExam, q.id);
      currentExam.state.responses[q.id] = { ...sessionResponse(currentExam.state, q.id), selected:btn.dataset.letter, didNotKnow:false, timedOut:false };
      document.querySelectorAll('.option').forEach(b => b.classList.toggle('selected', b.dataset.letter === btn.dataset.letter));
      await persistExamState();
      refreshExamGridOnly();
    });
    document.querySelectorAll('[data-question-doubt-top]').forEach(btn => {
      if (btn.dataset.questionDoubt !== q.id) return;
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const active = !questionHasDoubt(currentExam.state.scratch || {}, q.id);
        currentExam.state.scratch = setQuestionDoubt(currentExam.state.scratch || {}, q.id, active);
        refreshQuestionDoubtButtons(q.id, active);
        await persistExamState();
      };
    });
    document.querySelectorAll('[data-qindex]').forEach(btn => btn.onclick = async () => {
      const targetIndex = Number(btn.dataset.qindex);
      if (targetIndex < activeStart || targetIndex >= activeEnd) return;
      accumulateExamTime();
      currentExam.state.currentIndex = targetIndex;
      await persistExamState();
      renderExamQuestion();
    });
    const toggleExamMark = async () => {
      currentExam.state.marked[q.id] = !currentExam.state.marked[q.id];
      await persistExamState();
      renderExamQuestion();
    };
    const goExamPrev = async () => {
      if (currentExam.state.currentIndex <= activeStart) return;
      accumulateExamTime();
      currentExam.state.currentIndex--;
      await persistExamState(); renderExamQuestion();
    };
    const goExamNext = async () => {
      accumulateExamTime();
      const nextIndex = currentExam.state.currentIndex + 1;
      if (!twoPartExamEnabled() && currentExam.config.breakAfter > 0 && nextIndex === currentExam.config.breakAfter && !currentExam.state.breakTaken && nextIndex < currentExam.questions.length) {
        currentExam.state.breakTaken = true;
        currentExam.state.currentIndex = nextIndex;
        await persistExamState();
        return renderBreakScreen();
      }
      if (nextIndex < activeEnd) {
        currentExam.state.currentIndex = nextIndex;
        await persistExamState(); renderExamQuestion();
      } else renderExamOverview();
    };
    document.querySelectorAll('[data-exam-mark]').forEach(btn => btn.onclick = toggleExamMark);
    document.querySelectorAll('[data-exam-prev]').forEach(btn => btn.onclick = goExamPrev);
    document.querySelectorAll('[data-exam-next]').forEach(btn => btn.onclick = goExamNext);
    document.getElementById('session-exit-exam').onclick = cancelCurrentExam;
    document.getElementById('finish-exam').onclick = renderExamOverview;
    startExamTimer();
  }

  function startExamTimer() {
    clearTimer();
    updateTimer(currentExam.state.remainingSeconds);
    timerId = setInterval(async () => {
      if (!currentExam) return clearTimer();
      currentExam.state.remainingSeconds--;
      updateTimer(currentExam.state.remainingSeconds);
      if (currentExam.state.remainingSeconds % 30 === 0) await persistExamState();
      if (currentExam.state.remainingSeconds <= 0) {
        clearTimer();
        if (twoPartExamEnabled() && !currentExam.state.breakTaken) await beginExamBreak(true);
        else await finishExam(true);
      }
    }, 1000);
  }

  function examGridButton(q, i) {
    const answered = sessionSelected(currentExam.state, q.id) != null;
    const marked = Boolean(currentExam.state.marked[q.id]);
    const current = i === currentExam.state.currentIndex;
    const bounds = activeExamBounds();
    const label = currentExam?.config?.examLayout === 'paper'
      ? historicalDisplayNumber(q, i)
      : String(twoPartExamEnabled() ? i - bounds.start + 1 : i + 1);
    return `<button class="qnav ${answered?'answered':''} ${marked?'marked':''} ${current?'current':''}" data-qindex="${i}">${esc(label)}${marked?'⚑':''}</button>`;
  }

  function refreshExamGridOnly() {
    const grid = document.querySelector('.question-grid');
    const { start, end } = activeExamBounds();
    if (grid) grid.innerHTML = activeExamEntries().map(({q:x,index:i}) => examGridButton(x,i)).join('');
    document.querySelectorAll('[data-qindex]').forEach(btn => btn.onclick = async () => {
      const targetIndex = Number(btn.dataset.qindex);
      if (targetIndex < start || targetIndex >= end) return;
      accumulateExamTime(); currentExam.state.currentIndex = targetIndex; await persistExamState(); renderExamQuestion();
    });
  }

  async function beginExamBreak(timeExpired = false) {
    if (!currentExam) return;
    clearTimer();
    accumulateExamTime();
    examQuestionEnteredAt = 0;
    const split = Number(currentExam.config.breakAfter || 0);
    currentExam.state.currentIndex = split;
    currentExam.state.breakTaken = false;
    currentExam.state.remainingSeconds = 0;
    currentExam.state.totalRemaining = Math.max(0, Number(currentExam.config.breakDurationSeconds || 0));
    endSessionActivity();
    await persistExamState();
    renderBreakScreen(timeExpired);
  }

  function startBreakTimer() {
    if (!currentExam || !twoPartExamEnabled()) return;
    const timer = document.getElementById('break-timer');
    if (timer) timer.textContent = formatTime(currentExam.state.totalRemaining || 0);
    if (!Number(currentExam.state.totalRemaining || 0)) return;
    clearTimer();
    timerId = setInterval(async () => {
      if (!currentExam) return clearTimer();
      currentExam.state.totalRemaining = Math.max(0, Number(currentExam.state.totalRemaining || 0) - 1);
      const el = document.getElementById('break-timer');
      if (el) el.textContent = formatTime(currentExam.state.totalRemaining);
      if (currentExam.state.totalRemaining % 30 === 0) await persistExamState();
      if (currentExam.state.totalRemaining <= 0) {
        clearTimer();
        await continueAfterExamBreak();
      }
    }, 1000);
  }

  async function continueAfterExamBreak() {
    if (!currentExam) return;
    clearTimer();
    currentExam.state.breakTaken = true;
    currentExam.state.currentIndex = Number(currentExam.config.breakAfter || 0);
    currentExam.state.remainingSeconds = examPartSeconds();
    currentExam.state.totalRemaining = null;
    beginSessionActivity();
    await persistExamState();
    if (currentExam.config.examLayout === 'paper') renderHistoricalExamPaper();
    else renderExamQuestion();
  }

  function renderBreakScreen(timeExpired = false) {
    clearTimer();
    const done = currentExam.config.breakAfter;
    const twoPart = twoPartExamEnabled();
    const officialBreakSeconds = Number(currentExam.config.breakDurationSeconds || 0);
    if (twoPart && currentExam.state.totalRemaining == null) currentExam.state.totalRemaining = officialBreakSeconds;
    const heading = twoPart ? 'Parte A cerrada' : 'Bloque 1 completado';
    const detail = twoPart
      ? `${timeExpired ? 'El tiempo de la Parte A terminó.' : 'La Parte A quedó cerrada.'} Sus respuestas ya no pueden modificarse. La Parte B permanece bloqueada hasta iniciar el siguiente bloque.`
      : `Has llegado a la pregunta ${done}. Tu progreso está guardado.`;
    const breakInfo = twoPart
      ? `<p><strong>Intermedio oficial: 60 minutos</strong></p><div id="break-timer" class="timer break-timer">${formatTime(currentExam.state.totalRemaining || 0)}</div><p class="muted">Puedes continuar antes si estás entrenando; hacerlo acorta voluntariamente el intermedio.</p>`
      : `<p class="muted">${currentExam.config.pauseDuringBreak ? 'El cronómetro está pausado durante este descanso.' : 'El cronómetro continúa corriendo.'}</p>`;
    app.innerHTML = `<main class="shell">${topbar('Intermedio', false)}<section class="panel empty"><h2>${heading}</h2><p>${detail}</p>${breakInfo}<div class="actions"><button id="continue-block" class="btn primary">${twoPart?'Iniciar Parte B':'Continuar con el siguiente bloque'}</button><button id="session-exit-break" class="btn ghost">Cerrar o continuar después</button></div></section></main>`;
    attachTopbar();
    if (twoPart) startBreakTimer();
    else if (!currentExam.config.pauseDuringBreak) startExamTimer();
    document.getElementById('continue-block').onclick = twoPart
      ? continueAfterExamBreak
      : () => currentExam.config.examLayout === 'paper' ? renderHistoricalExamPaper() : renderExamQuestion();
    document.getElementById('session-exit-break').onclick = cancelCurrentExam;
  }

  function renderExamOverview() {
    clearTimer();
    accumulateExamTime();
    examQuestionEnteredAt = 0;
    if (examBreakPending()) return renderBreakScreen();
    const entries = activeExamEntries();
    const questionsInScope = entries.map(({q}) => q);
    const answered = questionsInScope.filter(q => sessionSelected(currentExam.state, q.id) != null).length;
    const marked = questionsInScope.filter(q => currentExam.state.marked[q.id]).length;
    const uncertain = questionsInScope.filter(q => questionHasDoubt(currentExam.state.scratch, q.id)).length;
    const isPartA = twoPartExamEnabled() && !currentExam.state.breakTaken;
    const title = isPartA ? 'Revisión de Parte A' : 'Revisión antes de entregar';
    const submitLabel = isPartA ? 'Finalizar Parte A' : 'Entregar y corregir';
    app.innerHTML = `<main class="shell">${topbar(title, false)}<section class="panel"><h2>${isPartA?'Resumen de la Parte A':'Resumen del simulacro'}</h2><div class="kpis"><div class="kpi"><div class="value">${answered}</div><div class="label">Respondidas</div></div><div class="kpi"><div class="value">${questionsInScope.length-answered}</div><div class="label">Sin responder</div></div><div class="kpi"><div class="value">${marked}</div><div class="label">Marcadas para revisar</div></div><div class="kpi"><div class="value">${uncertain}</div><div class="label">Dudosas (?)</div></div><div class="kpi"><div id="timer" class="value">${formatTime(currentExam.state.remainingSeconds)}</div><div class="label">Tiempo restante</div></div></div><div class="question-grid overview-grid">${entries.map(({q:x,index:i}) => examGridButton(x,i)).join('')}</div><div class="footer-actions"><button id="back-exam" class="btn ghost">Volver al examen</button><button id="cancel-overview" class="btn ghost">Cerrar o continuar después</button><button id="submit-exam" class="btn danger">${submitLabel}</button></div></section></main>`;
    attachTopbar();
    startExamTimer();
    const { start, end } = activeExamBounds();
    document.querySelectorAll('[data-qindex]').forEach(btn => btn.onclick = () => {
      const targetIndex = Number(btn.dataset.qindex);
      if (targetIndex < start || targetIndex >= end) return;
      currentExam.state.currentIndex = targetIndex;
      if (currentExam.config.examLayout === 'paper') {
        const index = currentExam.state.currentIndex;
        renderHistoricalExamPaper();
        setTimeout(() => document.getElementById(`paper-question-${index}`)?.scrollIntoView({ behavior:'smooth', block:'start' }), 0);
      } else renderExamQuestion();
    });
    document.getElementById('back-exam').onclick = () => currentExam.config.examLayout === 'paper' ? renderHistoricalExamPaper() : renderExamQuestion();
    document.getElementById('cancel-overview').onclick = cancelCurrentExam;
    document.getElementById('submit-exam').onclick = async () => {
      const missing = questionsInScope.length - answered;
      const warning = isPartA
        ? `¿Finalizar la Parte A?\n\nRespondidas: ${answered}\nSin responder: ${missing}\nDudosas (?): ${uncertain}\nMarcadas para revisar: ${marked}\n\nDespués de cerrar A no podrás volver a modificarla. Pasarás al intermedio antes de la Parte B.`
        : `¿Entregar el simulacro?\n\nRespondidas en este bloque: ${answered}\nSin responder: ${missing}\nDudosas (?): ${uncertain}\nMarcadas para revisar: ${marked}\n\nDespués se mostrarán las respuestas y explicaciones.`;
      if (!confirm(warning)) return;
      if (isPartA) await beginExamBreak(false);
      else await finishExam(false);
    };
  }

  function examAttemptPayload(exam, q, historicalAverageMs = 0) {
    const selected = sessionSelected(exam.state, q.id);
    const measuredMs = exam.state.timeSpent?.[q.id] || (exam.config.examLayout === 'paper' ? historicalAverageMs : 0);
    const uncertainOptions = uncertaintyOptionsFor(exam.state.scratch, q.id);
    const questionDoubt = questionHasDoubt(exam.state.scratch, q.id);
    return makeAttempt(
      q,
      selected,
      selected === q.official_answer,
      measuredMs,
      exam.config.studyMode || 'exam',
      false,
      {
        uncertainOptions,
        questionDoubt,
        ...sessionAttemptMeta(exam, q.id),
      }
    );
  }

  async function ensureExamAttempts(exam, questionList) {
    const existing = new Map(attemptsForSession(exam?.row?.id).map(attempt => [attempt.question_id, attempt]));
    const answeredForTiming = questionList.length;
    const elapsedSessionMs = exam.config.examLayout === 'paper' && Number(exam.state.activeTimeMs || 0) > 0
      ? Number(exam.state.activeTimeMs || 0)
      : Math.max(0, (Number(exam.config.totalSeconds || 0) - Number(exam.state.remainingSeconds || 0)) * 1000);
    const historicalAverageMs = answeredForTiming ? Math.round(elapsedSessionMs / answeredForTiming) : 0;
    const payload = [];

    for (const q of questionList) {
      if (existing.has(q.id)) continue;
      const persisted = persistedAttemptForIdentity(exam, q.id);
      if (persisted) {
        existing.set(q.id, persisted);
        continue;
      }
      const hasPersistedIdentity = Boolean(
        exam?.state?.attemptIdsByQuestion?.[q.id]
        || exam?.state?.clientAttemptIdsByQuestion?.[q.id]
      );
      if (exam?.row?.config?.recovery && hasPersistedIdentity) {
        console.warn('Recovery exam attempt identity not loaded; refusing to fabricate a duplicate.', exam.row.id, q.id);
        continue;
      }
      payload.push(examAttemptPayload(exam, q, historicalAverageMs));
    }

    const saved = payload.length ? await recordAttemptsBatch(payload) : [];
    for (const attempt of saved) existing.set(attempt.question_id, attempt);
    return [...existing.values()].filter(attempt => questionList.some(q => q.id === attempt.question_id));
  }

  async function closeExamPartial() {
    if (!currentExam || sessionActionInProgress) return;
    const answeredQuestions = currentExam.questions.filter(q => sessionSelected(currentExam.state, q.id) != null);
    if (!answeredQuestions.length) return;
    sessionActionInProgress = true;
    try {
      clearTimer();
      accumulateExamTime();
      endSessionActivity();
      await flushCurrentSessionSave();
      const exam = currentExam;
      const savedAttempts = await ensureExamAttempts(exam, answeredQuestions);
      const state = normalizeSessionState(exam.state);
      await finalizeSessionRow(exam, state, { partial:true });
      reviewContext = {
        type:'exam_session',
        sessionId:exam.row.id,
        partial:true,
        questions:answeredQuestions,
        allQuestions:answeredQuestions,
        sessionTitle:exam.config.title || 'Simulacro',
        originalQuestionIds:exam.questions.map(question => question.id),
        responses:state.responses,
        scratch:state.scratch || {},
        marked:state.marked || {},
        optionOrders:state.optionOrders || {},
        shuffleOptions:exam.config.shuffleOptions !== false && exam.config.examLayout !== 'paper',
        attemptsByQuestion:Object.fromEntries(savedAttempts.map(attempt => [attempt.question_id, attempt])),
        index:0,
      };
      currentExam = null;
      deactivateSessionNavigationGuard();
      renderReviewSummary();
    } finally {
      sessionActionInProgress = false;
    }
  }

  async function finishExam(timeExpired = false) {
    clearTimer();
    if (!currentExam || sessionActionInProgress) return;
    sessionActionInProgress = true;
    try {
      accumulateExamTime();
      endSessionActivity();
      await flushCurrentSessionSave();
      const exam = currentExam;
      const answeredQuestions = exam.questions.filter(q => sessionSelected(exam.state, q.id) != null);
      const savedExamAttempts = await ensureExamAttempts(exam, answeredQuestions);
      const state = normalizeSessionState(exam.state);
      await finalizeSessionRow(exam, state, { partial:false });

      const result = exam.questions.map(q => {
        const selected = sessionSelected(state, q.id);
        return { q, selected, correct:selected === q.official_answer };
      });
      const correct = result.filter(row => row.correct).length;
      const answered = result.filter(row => row.selected != null).length;
      reviewContext = {
        type:'exam_session',
        sessionId:exam.row.id,
        partial:false,
        questions:exam.questions,
        allQuestions:exam.questions,
        sessionTitle:exam.config.title || 'Simulacro',
        originalQuestionIds:exam.questions.map(question => question.id),
        responses:state.responses,
        scratch:state.scratch || {},
        marked:state.marked || {},
        optionOrders:state.optionOrders || {},
        shuffleOptions:exam.config.shuffleOptions !== false && exam.config.examLayout !== 'paper',
        attemptsByQuestion:Object.fromEntries(savedExamAttempts.map(attempt => [attempt.question_id, attempt])),
        index:0,
      };
      currentExam = null;
      deactivateSessionNavigationGuard();

      app.innerHTML = `<main class="shell">${topbar('Resultado del simulacro', true)}<section class="panel empty"><h2>${timeExpired ? 'Tiempo agotado' : 'Simulacro entregado'}</h2><p class="score-big">${correct}/${result.length}</p><p>${pct(correct, result.length)} · ${answered} respondidas · ${result.length - answered} omitidas</p><div class="actions"><button id="review-btn" class="btn">Revisar pregunta por pregunta</button><button class="btn primary" data-home>Volver al inicio</button></div></section></main>`;
      attachTopbar();
      document.getElementById('review-btn').onclick = renderReviewSummary;
    } finally {
      sessionActionInProgress = false;
    }
  }

  function reviewAllQuestions() {
    if (!reviewContext) return [];
    if (!Array.isArray(reviewContext.allQuestions) || !reviewContext.allQuestions.length) {
      reviewContext.allQuestions = [...(reviewContext.questions || [])];
    }
    return reviewContext.allQuestions;
  }

  function reviewResponseMeta(q) {
    const responseValue = reviewContext?.responses?.[q.id];
    const selected = responseValue?.selected ?? responseValue ?? null;
    const didNotKnow = Boolean(responseValue?.didNotKnow);
    const timedOut = Boolean(responseValue?.timedOut);
    const omitted = selected == null && !didNotKnow && !timedOut;
    const correct = !didNotKnow && !timedOut && selected === q.official_answer;
    const attempt = reviewContext?.attemptsByQuestion?.[q.id] || null;
    const doubt = questionHasDoubt(reviewContext?.scratch || {}, q.id) || Boolean(attempt?.was_uncertain);
    const note = Boolean(learningNoteFor(q.id));
    const flag = Boolean(reviewFlagFor(q.id));
    const marked = Boolean(reviewContext?.marked?.[q.id]);
    const audit = observed(q) || caveat(q);
    return { selected, didNotKnow, timedOut, omitted, correct, doubt, note, flag, marked, audit, attempt };
  }

  const REVIEW_FILTERS = [
    ['all','Todas'],
    ['incorrect','Incorrectas'],
    ['dont_know','No sé'],
    ['doubt','? Duda'],
    ['notes','Notas'],
    ['marked','Marcadas'],
    ['review_flag','Revisar'],
    ['audit','Auditoría'],
  ];

  function reviewFilterMatch(q, filter = 'all') {
    const meta = reviewResponseMeta(q);
    if (filter === 'incorrect') return !meta.correct && !meta.omitted;
    if (filter === 'dont_know') return meta.didNotKnow;
    if (filter === 'doubt') return meta.doubt;
    if (filter === 'notes') return meta.note;
    if (filter === 'marked') return meta.marked;
    if (filter === 'review_flag') return meta.flag;
    if (filter === 'audit') return meta.audit;
    return true;
  }

  function reviewFilterLabel(filter = reviewContext?.filter || 'all') {
    return REVIEW_FILTERS.find(([key]) => key === filter)?.[1] || 'Todas';
  }

  function reviewVisibleQuestions() {
    const filter = reviewContext?.filter || 'all';
    const sort = reviewContext?.sort || 'session';
    const originalIds = reviewContext?.originalQuestionIds || reviewAllQuestions().map(q => q.id);
    const rows = reviewAllQuestions().filter(q => reviewFilterMatch(q, filter));
    if (sort === 'topic') {
      return rows.sort((a,b) => {
        const topic = String(a.rentability_topic_label || a.topic || '').localeCompare(String(b.rentability_topic_label || b.topic || ''), 'es');
        if (topic) return topic;
        return originalIds.indexOf(a.id) - originalIds.indexOf(b.id);
      });
    }
    return rows.sort((a,b) => originalIds.indexOf(a.id) - originalIds.indexOf(b.id));
  }

  function reviewStatusMarkup(q) {
    const meta = reviewResponseMeta(q);
    const result = meta.didNotKnow
      ? '<span class="review-state bad">🤷 No sé</span>'
      : meta.timedOut
        ? '<span class="review-state bad">⏱ Tiempo</span>'
        : meta.omitted
          ? '<span class="review-state">— Omitida</span>'
          : meta.correct
            ? '<span class="review-state ok">✓ Correcta</span>'
            : '<span class="review-state bad">✕ Incorrecta</span>';
    return `${result}${meta.doubt?'<span class="review-mini-state warn">?</span>':''}${meta.note?'<span class="review-mini-state">🗒</span>':''}${meta.marked?'<span class="review-mini-state warn">⚑</span>':''}${meta.flag?'<span class="review-mini-state warn">⚐</span>':''}${meta.audit?'<span class="review-mini-state bad">⚠</span>':''}`;
  }

  function reviewQuestionRow(q) {
    const originalIds = reviewContext.originalQuestionIds || reviewAllQuestions().map(item => item.id);
    const originalIndex = originalIds.indexOf(q.id);
    const topic = cleanTaxonomyLabel(q.rentability_topic_label || q.topic) || 'Sin tema';
    const entity = cleanTaxonomyLabel(q.canonical_entity || q.subtopic);
    return `<button class="review-question-row" type="button" data-review-open="${esc(q.id)}">
      <div class="review-question-number">${originalIndex >= 0 ? originalIndex + 1 : '—'}</div>
      <div class="review-question-info">
        <div class="review-question-line"><strong>${esc(topic)}</strong><span class="review-question-states">${reviewStatusMarkup(q)}</span></div>
        ${entity && taxonomyKey(entity) !== taxonomyKey(topic) ? `<small>${esc(entity)}</small>` : ''}
      </div>
    </button>`;
  }

  function renderReviewSummary() {
    if (!reviewContext) return renderDashboard();
    if (reviewContext.type === 'specific_query') return renderReviewQuestion();
    clearTimer();
    scrollPageTop();
    const all = reviewAllQuestions();
    const visible = reviewVisibleQuestions();
    const metas = all.map(reviewResponseMeta);
    const correct = metas.filter(meta => meta.correct).length;
    const answered = metas.filter(meta => !meta.omitted).length;
    const planned = Number(reviewContext.originalQuestionIds?.length || all.length);
    const partial = Boolean(reviewContext.partial);
    const filterCounts = Object.fromEntries(REVIEW_FILTERS.map(([key]) => [key, all.filter(q => reviewFilterMatch(q,key)).length]));
    const title = reviewContext.sessionTitle || (partial ? 'Sesión parcial' : 'Sesión completada');
    const historyReview = String(reviewContext.type || '').startsWith('history_');
    const accuracy = answered ? Math.round(correct / answered * 100) : 0;
    const currentDatasetRevision = datasetManifest?.dataset_revision || null;
    const corpusChangedSinceSession = Boolean(
      historyReview
      && reviewContext.sessionDatasetRevision
      && currentDatasetRevision
      && String(reviewContext.sessionDatasetRevision) !== String(currentDatasetRevision)
    );

    app.innerHTML = `<main class="shell">${topbar('Centro de revisión', true)}
      ${corpusChangedSinceSession ? `<div class="banner"><strong>Corpus actualizado desde esta sesión.</strong> La revisión muestra el contenido vigente; el resultado histórico de tu intento se conserva. No se atribuye retroactivamente el texto actual a la versión que viste entonces.</div>` : ''}
      <section class="panel review-summary-hero">
        <div><span class="roadmap-kicker">${partial?'CIERRE PARCIAL':'REVISIÓN DE SESIÓN'}</span><h2>${esc(title)}</h2><p class="muted">${answered} respondidas${partial ? ` de ${planned} planificadas` : ''} · ${correct} correctas · ${accuracy}% de acierto</p></div>
        <div class="review-summary-score"><strong>${correct}/${answered || 0}</strong><small>correctas / respondidas</small></div>
      </section>
      <section class="panel review-center-panel">
        <div class="review-filter-bar" aria-label="Filtros de revisión">
          ${REVIEW_FILTERS.map(([key,label]) => `<button class="review-filter-chip ${reviewContext.filter===key || (!reviewContext.filter && key==='all')?'active':''}" data-review-filter="${key}" type="button">${esc(label)} <strong>${filterCounts[key]}</strong></button>`).join('')}
        </div>
        <div class="review-sort-bar"><span><strong>${esc(reviewFilterLabel())}</strong> · ${visible.length} pregunta${visible.length===1?'':'s'}</span><div><button class="btn small ${reviewContext.sort!=='topic'?'primary':'ghost'}" data-review-sort="session" type="button">Orden de sesión</button><button class="btn small ${reviewContext.sort==='topic'?'primary':'ghost'}" data-review-sort="topic" type="button">Tema</button></div></div>
        <div class="review-question-list">${visible.length ? visible.map(reviewQuestionRow).join('') : '<div class="empty">No hay preguntas con este filtro.</div>'}</div>
      </section>
      <div class="footer-actions"><button class="btn primary" data-review-summary-exit type="button">${historyReview?'Volver al historial':'Volver al inicio'}</button></div>
    </main>`;
    attachTopbar();
    document.querySelectorAll('[data-review-filter]').forEach(btn => btn.onclick = () => {
      reviewContext.filter = btn.dataset.reviewFilter;
      renderReviewSummary();
    });
    document.querySelectorAll('[data-review-sort]').forEach(btn => btn.onclick = () => {
      reviewContext.sort = btn.dataset.reviewSort;
      renderReviewSummary();
    });
    document.querySelectorAll('[data-review-open]').forEach(btn => btn.onclick = () => {
      const list = reviewVisibleQuestions();
      reviewContext.questions = list;
      reviewContext.index = Math.max(0, list.findIndex(q => q.id === btn.dataset.reviewOpen));
      renderReviewQuestion();
    });
    document.querySelector('[data-review-summary-exit]')?.addEventListener('click', () => {
      const context = reviewContext;
      reviewContext = null;
      if (String(context?.type || '').startsWith('history_')) renderHistory(context.returnDate || isoDateLocal());
      else renderDashboard();
    });
  }

  function renderReviewQuestion() {
    clearTimer();
    scrollPageTop();
    if (!reviewContext?.questions?.length) return renderReviewSummary();
    const q = reviewContext.questions[reviewContext.index];
    if (!q) return renderReviewSummary();
    const historyReview = String(reviewContext?.type || '').startsWith('history_');
    const historySessionReview = reviewContext?.type === 'history_session';
    const specificQueryReview = reviewContext?.type === 'specific_query';
    const meta = reviewResponseMeta(q);
    const { selected, didNotKnow, timedOut, omitted, correct } = meta;
    const uncertainOptions = uncertaintyOptionsFor(reviewContext.scratch || {}, q.id);
    const questionDoubt = meta.doubt;
    const reviewOptions = displayOptionList(q, reviewContext.optionOrders || {}, reviewContext.shuffleOptions !== false);
    const reviewTitle = specificQueryReview ? 'Consulta' : 'Revisión';
    const originalIds = reviewContext.originalQuestionIds || reviewAllQuestions().map(question => question.id);
    const originalIndex = originalIds.indexOf(q.id);
    const filterPosition = `${reviewFilterLabel()} ${reviewContext.index+1} de ${reviewContext.questions.length}`;
    const originalPositionMarkup = originalIndex >= 0 && !specificQueryReview
      ? `<small class="review-original-position">${esc(filterPosition)} · pregunta ${originalIndex+1} de ${originalIds.length} de la sesión original</small>`
      : '';
    const sessionAttempt = reviewContext?.attemptsByQuestion?.[q.id] || null;
    const sessionScopedReview = Boolean(reviewContext?.sessionId);
    const latestAttempt = sessionAttempt || (sessionScopedReview
      ? null
      : attemptsForQuestion(q.id).slice().sort((a,b) => new Date(b.answered_at) - new Date(a.answered_at))[0] || null);

    app.innerHTML = `<main class="shell">${topbar(reviewTitle, true)}
      <div class="review-navigation-wrap">
        <div class="question-step-nav review-step-primary" aria-label="Navegación superior de la revisión">
          <button class="btn small ghost" data-review-prev ${reviewContext.index===0?'disabled':''}>← Anterior</button>
          <strong>${reviewContext.index+1}/${reviewContext.questions.length}</strong>
          ${!specificQueryReview?'<button class="btn small ghost" data-review-summary type="button">Resumen</button>':''}
          <button class="btn small primary" data-review-next>${reviewContext.index+1===reviewContext.questions.length?(specificQueryReview?'Volver al selector':'Volver al resumen'):'Siguiente →'}</button>
        </div>
        <div class="review-jump-actions" aria-label="Salto y salida de la revisión">
          <label>Ir a <input id="review-jump-input" class="input review-jump-input" type="number" min="1" max="${reviewContext.questions.length}" value="${reviewContext.index+1}" inputmode="numeric"></label>
          <button class="btn small ghost" data-review-jump type="button">Ir</button>
          <button class="btn small ghost" data-review-last type="button" ${reviewContext.index+1===reviewContext.questions.length?'disabled':''}>Última</button>
          ${specificQueryReview?'<button class="btn small ghost" data-review-selector type="button">Selector</button>':''}
          <button class="btn small danger ghost-danger" data-review-exit type="button">Salir</button>
        </div>
        ${originalPositionMarkup}
      </div>
      <section class="panel question-card"><div class="q-head"><span class="tag">${reviewContext.index+1}/${reviewContext.questions.length}</span>${questionDoubtButton(q.id, questionDoubt)}${questionSourceTag(q)}<span class="tag">${esc(q.topic)}</span>${taxonomyEntityTag(q)}${auditBadge(q)}${didNotKnow?'<span class="tag warn">🤷 No sé</span>':''}${timedOut?'<span class="tag bad">⏱ Tiempo agotado</span>':''}${omitted?'<span class="tag">Sin respuesta</span>':''}${questionDoubt?'<span class="tag warn">❓ Duda registrada</span>':''}${meta.note?'<span class="tag">🗒 Nota</span>':''}${meta.marked?'<span class="tag warn">⚑ Marcada</span>':''}${meta.flag?'<span class="tag warn">⚐ Revisar</span>':''}</div><div class="q-body"><p class="q-text">${esc(q.question)}</p>${questionMediaHtml(q)}<div class="options">${reviewOptions.map(o => {
        const sourceLetter = o.sourceLetter || o.letter;
        return `<div class="option ${sourceLetter===q.official_answer?'correct':sourceLetter===selected?'wrong':'dimmed'}"><span class="letter">${o.letter}</span><span>${esc(o.text)}</span></div>`;
      }).join('')}</div></div><div id="feedback"></div></section>
      <div class="footer-actions review-footer-actions"><button class="btn ghost" data-review-prev ${historyReview && !historySessionReview?'style="visibility:hidden"':(reviewContext.index===0?'disabled':'')}>← Anterior</button>${!specificQueryReview?'<button class="btn ghost" data-review-summary>Volver al resumen</button>':''}<button class="btn danger ghost-danger" data-review-exit>Salir</button><button class="btn primary" data-review-next>${specificQueryReview?(reviewContext.index+1===reviewContext.questions.length?'Volver al selector':'Siguiente →'):(reviewContext.index+1===reviewContext.questions.length?'Volver al resumen':'Siguiente →')}</button></div>
    </main>`;
    attachTopbar();
    const reviewFeedbackMeta = {
      attemptId:latestAttempt?.id || null,
      responseTimeMs:Number(latestAttempt?.response_time_ms || 0),
      targetSeconds:Number(latestAttempt?.target_seconds || effectiveTargetSeconds(q)),
      wasUncertainAtAnswer:Boolean(latestAttempt?.was_uncertain),
      questionDoubt,
      allowPostMark:!omitted,
      didNotKnow,
      omitted,
    };
    try { renderFeedback(q, selected, correct, null, timedOut, true, uncertainOptions, reviewFeedbackMeta); }
    catch (error) { console.error('Error al renderizar la explicación de revisión:', error); }
    const reviewFeedbackNode = document.getElementById('feedback');
    if (reviewFeedbackNode && !reviewFeedbackNode.innerHTML.trim()) renderReviewFeedbackFallback(q, selected, correct, timedOut, uncertainOptions, reviewFeedbackMeta);

    document.querySelectorAll('[data-question-doubt-top]').forEach(btn => {
      if (btn.dataset.questionDoubt !== q.id) return;
      btn.onclick = async () => {
        const active = !questionHasDoubt(reviewContext.scratch || {}, q.id);
        reviewContext.scratch = setQuestionDoubt(reviewContext.scratch || {}, q.id, active);
        const attemptId = latestAttempt?.id || null;
        if (attemptId) {
          const updated = await setAttemptQuestionDoubtAfterFeedback(attemptId, q, active);
          if (!updated) {
            reviewContext.scratch = setQuestionDoubt(reviewContext.scratch || {}, q.id, !active);
            return;
          }
          if (reviewContext.attemptsByQuestion) reviewContext.attemptsByQuestion[q.id] = updated;
        }
        refreshQuestionDoubtButtons(q.id, active);
      };
    });

    const goReviewPrev = () => {
      if (reviewContext.index <= 0) return;
      reviewContext.index--;
      renderReviewQuestion();
    };
    const goReviewNext = () => {
      if (specificQueryReview) {
        if (reviewContext.index + 1 < reviewContext.questions.length) { reviewContext.index++; renderReviewQuestion(); }
        else renderSpecificQuestions();
        return;
      }
      if (reviewContext.index + 1 >= reviewContext.questions.length) renderReviewSummary();
      else { reviewContext.index++; renderReviewQuestion(); }
    };
    const exitReview = () => {
      const context = reviewContext;
      reviewContext = null;
      if (String(context?.type || '').startsWith('history_')) renderHistory(context.returnDate || isoDateLocal());
      else renderDashboard();
    };
    const jumpReview = () => {
      const input = document.getElementById('review-jump-input');
      const value = Number(input?.value);
      if (!Number.isInteger(value) || value < 1 || value > reviewContext.questions.length) {
        input?.focus();
        alert(`Escribe un número entre 1 y ${reviewContext.questions.length}.`);
        return;
      }
      reviewContext.index = value - 1;
      renderReviewQuestion();
    };
    if (!historyReview || historySessionReview) document.querySelectorAll('[data-review-prev]').forEach(btn => btn.onclick = goReviewPrev);
    document.querySelectorAll('[data-review-next]').forEach(btn => btn.onclick = goReviewNext);
    document.querySelectorAll('[data-review-last]').forEach(btn => btn.onclick = () => { reviewContext.index = reviewContext.questions.length - 1; renderReviewQuestion(); });
    document.querySelectorAll('[data-review-exit]').forEach(btn => btn.onclick = exitReview);
    document.querySelectorAll('[data-review-jump]').forEach(btn => btn.onclick = jumpReview);
    document.querySelectorAll('[data-review-summary]').forEach(btn => btn.onclick = renderReviewSummary);
    const jumpInput = document.getElementById('review-jump-input');
    if (jumpInput) jumpInput.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); jumpReview(); } };
    if (specificQueryReview) document.querySelectorAll('[data-review-selector]').forEach(btn => btn.onclick = () => renderSpecificQuestions(specificQueryDraft));
  }


  // v1.5.0 — la duda pertenece a la pregunta, no a una alternativa.
  // Las marcas `tentative` antiguas se interpretan como duda de pregunta para mantener compatibilidad.
  function uncertaintyOptionsFor(scratch, qId) {
    return Object.entries(scratch?.[qId] || {})
      .filter(([key,state]) => key !== '__questionDoubt' && state === 'tentative')
      .map(([letter]) => letter);
  }

  function questionHasDoubt(scratch, qId) {
    const row = scratch?.[qId] || {};
    return row.__questionDoubt === true || Object.entries(row).some(([key,state]) => key !== '__questionDoubt' && state === 'tentative');
  }

  function setQuestionDoubt(scratch, qId, active) {
    scratch ||= {};
    scratch[qId] ||= {};
    if (active) scratch[qId].__questionDoubt = true;
    else {
      delete scratch[qId].__questionDoubt;
      // Al desmarcar una duda nueva también se limpian marcas `tentative` legacy.
      for (const [key,state] of Object.entries(scratch[qId])) if (state === 'tentative') delete scratch[qId][key];
    }
    if (!Object.keys(scratch[qId]).length) delete scratch[qId];
    return scratch;
  }

  function questionDoubtButton(questionId, active = false, extraClass = '') {
    return `<button class="question-doubt-toggle ${active?'active':''} ${extraClass}" data-question-doubt="${esc(questionId)}" data-question-doubt-top type="button" aria-pressed="${active?'true':'false'}" title="${active?'Quitar duda':'Marcar pregunta con duda'}">?</button>`;
  }

  function refreshQuestionDoubtButtons(questionId, active) {
    document.querySelectorAll('[data-question-doubt]').forEach(btn => {
      if (btn.dataset.questionDoubt !== questionId) return;
      btn.classList.toggle('active', Boolean(active));
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.title = active ? 'Quitar duda' : 'Marcar pregunta con duda';
      if (btn.dataset.questionDoubtLabel != null) btn.textContent = active ? '✓ Duda registrada' : '? Marcar duda';
    });
  }

  function optionList(q) {
    return ['A','B','C','D','E']
      .map(letter => ({ letter, text:cleanOptionText(q?.[`option_${letter.toLowerCase()}`]) }))
      .filter(option => option.text);
  }

  function optionButton(o, selected) {
    const sourceLetter = o.sourceLetter || o.letter;
    return `<button class="option ${selected===sourceLetter?'selected':''}" data-letter="${sourceLetter}"><span class="letter">${o.letter}</span><span>${esc(o.text)}</span></button>`;
  }

  function auditBadge(q) {
    if (observed(q)) return `<span class="tag bad">Observada</span>`;
    if (caveat(q)) return `<span class="tag warn">Con caveat</span>`;
    return `<span class="tag ok">Auditada</span>`;
  }

  function disableOptionsAndPaint(q, selected) {
    document.querySelectorAll('.option').forEach(btn => {
      btn.disabled = true;
      const l = btn.dataset.letter;
      btn.classList.remove('selected');
      if (l === q.official_answer) btn.classList.add('correct');
      else if (l === selected) btn.classList.add('wrong');
      else btn.classList.add('dimmed');
    });
  }

  function frameworkHtml(text) {
    const content = cleanEditorialText(text);
    if (!content) return '';
    const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
    return lines.length ? `<div class="framework">${lines.map(line => `<div>${esc(line)}</div>`).join('')}</div>` : '';
  }

  function setContextQuestionDoubt(questionId, active) {
    if (currentStudy?.scratch) {
      currentStudy.scratch = setQuestionDoubt(currentStudy.scratch, questionId, active);
      scheduleCurrentSessionSave();
    } else if (currentExam?.state?.scratch) {
      currentExam.state.scratch = setQuestionDoubt(currentExam.state.scratch, questionId, active);
      persistExamState();
    } else if (reviewContext?.scratch) {
      reviewContext.scratch = setQuestionDoubt(reviewContext.scratch, questionId, active);
    }
  }

  function bindPostAnswerUncertainButton(feedbackMeta, q) {
    const postBtn = document.getElementById('post-answer-uncertain');
    if (!postBtn) return;
    postBtn.onclick = async () => {
      const active = postBtn.dataset.active !== 'true';
      postBtn.disabled = true;
      const status = document.getElementById('post-answer-uncertain-status');
      if (status) status.textContent = 'Guardando…';
      setContextQuestionDoubt(q.id, active);
      const updated = await setAttemptQuestionDoubtAfterFeedback(feedbackMeta.attemptId, q, active);
      if (!updated) {
        setContextQuestionDoubt(q.id, !active);
        postBtn.disabled = false;
        if (status) status.textContent = 'No se pudo guardar. Intenta nuevamente.';
        return;
      }
      feedbackMeta.questionDoubt = active;
      feedbackMeta.wasUncertainAtAnswer = active;
      if (reviewContext?.attemptsByQuestion) reviewContext.attemptsByQuestion[q.id] = updated;
      refreshQuestionDoubtButtons(q.id, active);
      postBtn.dataset.active = active ? 'true' : 'false';
      postBtn.textContent = active ? '✓ Duda registrada' : '? Marcar duda';
      postBtn.classList.toggle('warn-btn', !active);
      postBtn.classList.toggle('ghost', active);
      postBtn.disabled = false;
      if (status) status.textContent = active
        ? 'Duda registrada. Se conserva tu resultado y la pregunta volverá antes al repaso.'
        : 'Duda retirada. Se recalculó la memoria desde tus intentos.';
    };
  }

  function renderReviewFeedbackFallback(q, selected, isCorrect, timedOut = false, uncertainOptions = [], feedbackMeta = {}) {
    const target = document.getElementById('feedback');
    if (!target) return;

    const optionOrderStore = reviewContext?.optionOrders || {};
    const shouldShuffleOptions = reviewContext?.shuffleOptions !== false;
    const feedbackOptions = displayOptionList(q, optionOrderStore, shouldShuffleOptions);
    const displayLetterFor = sourceLetter =>
      feedbackOptions.find(o => (o.sourceLetter || o.letter) === sourceLetter)?.letter || sourceLetter || '—';
    const optionTextFor = sourceLetter => {
      const key = typeof sourceLetter === 'string' ? sourceLetter.toLowerCase() : '';
      return key ? (q?.[`option_${key}`] || '') : '';
    };

    const selectedDisplayLetter = selected ? displayLetterFor(selected) : null;
    const officialDisplayLetter = displayLetterFor(q?.official_answer);
    const correctText = cleanEditorialText(q?.correct_explanation);
    const distractors = feedbackOptions
      .filter(o => (o.sourceLetter || o.letter) !== q?.official_answer)
      .map(o => {
        const sourceLetter = o.sourceLetter || o.letter;
        const key = typeof sourceLetter === 'string' ? sourceLetter.toLowerCase() : '';
        const reason = cleanEditorialText(key ? q?.[`why_not_${key}`] : '');
        return reason ? `<p><strong>${esc(o.letter)}. ${esc(o.text)}:</strong> ${esc(reason)}</p>` : '';
      }).filter(Boolean).join('');
    const quickReference = referenceQuickHtml(q);

    const postMarkAvailable = Boolean(feedbackMeta.attemptId) && feedbackMeta.omitted !== true && feedbackMeta.allowPostMark !== false;
    const alreadyUncertain = Boolean(feedbackMeta.questionDoubt ?? feedbackMeta.wasUncertainAtAnswer) || uncertainOptions.length > 0;
    const targetSeconds = Number(feedbackMeta.targetSeconds || effectiveTargetSeconds(q));
    const responseTimeMs = Number(feedbackMeta.responseTimeMs || 0);
    const responseSeconds = responseTimeMs > 0 ? responseTimeMs / 1000 : null;
    const timeLabel = responseSeconds == null ? '' : `${responseSeconds < 10 ? responseSeconds.toFixed(1) : Math.round(responseSeconds)} s`;

    target.innerHTML = `<div class="feedback">
      <h3>${feedbackMeta.didNotKnow ? '🤷 No sabía' : timedOut ? '⏱ Tiempo agotado' : feedbackMeta.omitted ? '— Sin respuesta' : isCorrect ? '✅ Correcto' : '❌ Incorrecto'}</h3>
      ${selected ? `<p>Tu respuesta: <strong>${esc(selectedDisplayLetter)}. ${esc(optionTextFor(selected))}</strong></p>` : ''}
      <p class="answer-line">Respuesta correcta: ${esc(officialDisplayLetter)}. ${esc(q?.official_answer_text || optionTextFor(q?.official_answer))}</p>
      ${responseSeconds != null ? `<div class="feedback-time ${responseSeconds <= targetSeconds ? 'ok' : responseSeconds <= targetSeconds * 1.6 ? 'warn' : 'bad'}">⏱ <strong>${esc(timeLabel)}</strong> · objetivo ${targetSeconds} s${responseSeconds <= targetSeconds ? ' · dentro del objetivo' : ' · el algoritmo registró la lentitud'}</div>` : ''}
      ${auditEditorialHtml(q)}
      ${alreadyUncertain ? `<div class="explain-block uncertainty-box"><h4>❓ Duda registrada</h4><p>Marcaste la pregunta completa como dudosa. El marcador no genera contenido ni una nota por sí solo.</p></div>` : ''}
      ${correctText ? `<details class="explain-block" open><summary><strong>Por qué la clave es correcta</strong></summary><p>${esc(correctText)}</p></details>` : ''}
      ${distractors ? `<details class="explain-block"><summary><strong>Por qué no las otras</strong></summary>${distractors}</details>` : ''}
      ${hasEditorialText(q?.common_trap) ? `<div class="explain-block trap"><h4>⚠ Trampa frecuente</h4><p>${esc(cleanEditorialText(q.common_trap))}</p></div>` : ''}
      ${hasEditorialText(q?.exam_pearl) ? `<div class="explain-block pearl"><h4>💡 Perla de examen</h4><p>${esc(cleanEditorialText(q.exam_pearl))}</p></div>` : ''}
      ${hasEditorialText(q?.memory_hook) ? `<div class="explain-block memory"><h4>🪝 Gancho de memoria</h4><p>${esc(cleanEditorialText(q.memory_hook))}</p></div>` : ''}
      ${quickReference}
      <div class="learning-note-action"><div><strong>¿Qué te falta entender o recordar?</strong><p class="muted">Guarda una duda personal para resolverla después y compararla con tu Anki. Es independiente de los flags de auditoría.</p></div>${learningNoteButton(q)}</div>
      <div class="content-review-action"><div><strong>¿Hay algo que corregir en esta pregunta?</strong><p class="muted">Guárdala en tu lista de auditoría sin alterar tu resultado ni el repaso.</p></div>${reviewFlagButton(q)}</div>
      ${postMarkAvailable ? `<div class="post-answer-reflection">
        <div>
          <strong>¿Quieres conservar esta pregunta como duda?</strong>
          <p class="muted">El ? es solo un marcador ligero de la pregunta: no crea notas ni observaciones. Si necesitas registrar qué falta aprender, usa Nota.</p>
        </div>
        <button id="post-answer-uncertain" data-active="${alreadyUncertain?'true':'false'}" data-question-doubt="${esc(q.id)}" data-question-doubt-label class="btn ${alreadyUncertain ? 'ghost' : 'warn-btn'}" type="button">
          ${alreadyUncertain ? '✓ Duda registrada' : '? Marcar duda'}
        </button>
        <div id="post-answer-uncertain-status" class="muted post-answer-status"></div>
      </div>` : ''}
    </div>`;

    bindPostAnswerUncertainButton(feedbackMeta, q);
    bindReviewFlagButtons(target);
    bindLearningNoteButtons(target);
  }

  function renderFeedback(q, selected, isCorrect, onNext, timedOut = false, reviewOnly = false, uncertainOptions = [], feedbackMeta = {}) {
    const target = document.getElementById('feedback');
    if (!target) return;

    const optionOrderStore = reviewOnly
      ? (reviewContext?.optionOrders || {})
      : currentStudy
        ? (currentStudy.optionOrders || {})
        : (currentExam?.state?.optionOrders || {});
    const shouldShuffleOptions = reviewOnly
      ? reviewContext?.shuffleOptions !== false
      : currentStudy
        ? currentStudy.config.shuffleOptions !== false
        : currentExam
          ? currentExam.config.shuffleOptions !== false && currentExam.config.examLayout !== 'paper'
          : false;
    const feedbackOptions = displayOptionList(q, optionOrderStore, shouldShuffleOptions);
    const displayLetterFor = sourceLetter =>
      feedbackOptions.find(o => (o.sourceLetter || o.letter) === sourceLetter)?.letter || sourceLetter;
    const selectedDisplayLetter = selected ? displayLetterFor(selected) : null;
    const officialDisplayLetter = displayLetterFor(q.official_answer);

    const targetSeconds = Number(feedbackMeta.targetSeconds || effectiveTargetSeconds(q));
    const responseTimeMs = Number(feedbackMeta.responseTimeMs || 0);
    const responseSeconds = responseTimeMs > 0 ? responseTimeMs / 1000 : null;
    const timeState = responseSeconds == null
      ? ''
      : responseSeconds <= targetSeconds
        ? 'ok'
        : responseSeconds <= targetSeconds * 1.6
          ? 'warn'
          : 'bad';
    const timeLabel = responseSeconds == null
      ? ''
      : `${responseSeconds < 10 ? responseSeconds.toFixed(1) : Math.round(responseSeconds)} s`;
    const postMarkAvailable = Boolean(feedbackMeta.attemptId) && feedbackMeta.omitted !== true && (!reviewOnly || feedbackMeta.allowPostMark !== false);
    const alreadyUncertain = Boolean(feedbackMeta.questionDoubt ?? feedbackMeta.wasUncertainAtAnswer) || uncertainOptions.length > 0;
    const correctText = cleanEditorialText(q.correct_explanation);
    const distractors = feedbackOptions
      .filter(o => (o.sourceLetter || o.letter) !== q.official_answer)
      .map(o => {
        const sourceLetter = o.sourceLetter || o.letter;
        const reason = cleanEditorialText(q[`why_not_${sourceLetter.toLowerCase()}`]);
        return reason ? `<p><strong>${esc(o.letter)}. ${esc(o.text)}:</strong> ${esc(reason)}</p>` : '';
      }).filter(Boolean).join('');
    const quickReference = referenceQuickHtml(q);

    target.innerHTML = `<div class="feedback">
      <h3>${feedbackMeta.didNotKnow ? '🤷 No sabía' : timedOut ? '⏱ Tiempo agotado' : feedbackMeta.omitted ? '— Sin respuesta' : isCorrect ? '✅ Correcto' : '❌ Incorrecto'}</h3>
      ${selected ? `<p>Tu respuesta: <strong>${esc(selectedDisplayLetter)}. ${esc(q[`option_${selected.toLowerCase()}`])}</strong></p>` : ''}
      <p class="answer-line">Respuesta correcta: ${esc(officialDisplayLetter)}. ${esc(q.official_answer_text)}</p>
      ${responseSeconds != null ? `<div class="feedback-time ${timeState}">⏱ <strong>${esc(timeLabel)}</strong> · objetivo ${targetSeconds} s${responseSeconds <= targetSeconds ? ' · dentro del objetivo' : ' · el algoritmo registró la lentitud'}</div>` : ''}

      ${auditEditorialHtml(q)}

      ${alreadyUncertain ? `<div class="explain-block uncertainty-box"><h4>❓ Duda registrada</h4><p>Marcaste la pregunta completa como dudosa. El marcador no genera contenido ni una nota por sí solo.</p></div>` : ''}
      ${correctText ? `<details class="explain-block" open><summary><strong>Por qué la clave es correcta</strong></summary><p>${esc(correctText)}</p></details>` : ''}
      ${distractors ? `<details class="explain-block"><summary><strong>Por qué no las otras</strong></summary>${distractors}</details>` : ''}
      ${hasEditorialText(q.common_trap) ? `<div class="explain-block trap"><h4>⚠ Trampa frecuente</h4><p>${esc(cleanEditorialText(q.common_trap))}</p></div>` : ''}
      ${hasEditorialText(q.exam_pearl) ? `<div class="explain-block pearl"><h4>💡 Perla de examen</h4><p>${esc(cleanEditorialText(q.exam_pearl))}</p></div>` : ''}
      ${hasEditorialText(q.memory_hook) ? `<div class="explain-block memory"><h4>🪝 Gancho de memoria</h4><p>${esc(cleanEditorialText(q.memory_hook))}</p></div>` : ''}
      ${quickReference}
      <div class="learning-note-action"><div><strong>¿Qué te falta entender o recordar?</strong><p class="muted">Guarda una duda personal para resolverla después y compararla con tu Anki. Es independiente de los flags de auditoría.</p></div>${learningNoteButton(q)}</div>
      <div class="content-review-action"><div><strong>¿Hay algo que corregir en esta pregunta?</strong><p class="muted">Guárdala en tu lista de auditoría sin alterar tu resultado ni el repaso.</p></div>${reviewFlagButton(q)}</div>
      ${postMarkAvailable ? `<div class="post-answer-reflection">
        <div>
          <strong>¿Quieres conservar esta pregunta como duda?</strong>
          <p class="muted">El ? es solo un marcador ligero de la pregunta: no crea notas ni observaciones. Si necesitas registrar qué falta aprender, usa Nota.</p>
        </div>
        <button id="post-answer-uncertain" data-active="${alreadyUncertain?'true':'false'}" data-question-doubt="${esc(q.id)}" data-question-doubt-label class="btn ${alreadyUncertain ? 'ghost' : 'warn-btn'}" type="button">
          ${alreadyUncertain ? '✓ Duda registrada' : '? Marcar duda'}
        </button>
        <div id="post-answer-uncertain-status" class="muted post-answer-status"></div>
      </div>` : ''}
      ${!reviewOnly && onNext ? `<div class="footer-actions feedback-next-actions"><button id="next-feedback" class="btn primary">Siguiente pregunta →</button></div>` : ''}
    </div>`;

    bindPostAnswerUncertainButton(feedbackMeta, q);
    bindReviewFlagButtons(target);
    bindLearningNoteButtons(target);
    if (!reviewOnly && onNext) {
      document.getElementById('next-feedback').onclick = onNext;
      const topNext = document.getElementById('next-study-top');
      if (topNext) { topNext.hidden = false; topNext.disabled = false; topNext.onclick = onNext; }
    }
  }

  function makeAttempt(q, selected, isCorrect, responseTimeMs, studyMode, timedOut, meta = {}) {
    const baseTarget = Number(meta.baseTargetSeconds || profile?.target_response_seconds || 25);
    const normalizedTarget = effectiveTargetSeconds(q, baseTarget);
    const state = memoryByQuestion.get(q.id);
    const answeredAt = new Date().toISOString();
    const uncertainOptions = [...new Set((meta.uncertainOptions || []).filter(x => ['A','B','C','D','E'].includes(x)))];
    const questionDoubt = Boolean(meta.questionDoubt) || uncertainOptions.length > 0;
    const wasUncertain = questionDoubt;
    const didNotKnow = Boolean(meta.dontKnow);
    const baseMemoryRating = memoryRating(q, responseTimeMs, isCorrect, timedOut, normalizedTarget);
    const adjustedMemoryRating = wasUncertain && isCorrect ? Math.min(baseMemoryRating, 2) : baseMemoryRating;
    const baseSpeedBucket = didNotKnow ? 'dont_know' : speedBucket(q, responseTimeMs, isCorrect, timedOut, normalizedTarget);
    return {
      question_id: q.id,
      selected_answer: selected,
      is_correct: Boolean(isCorrect),
      response_time_ms: Math.max(0, Math.round(responseTimeMs || 0)),
      study_mode: studyMode,
      timed_out: Boolean(timedOut),
      memory_rating: adjustedMemoryRating,
      speed_bucket: wasUncertain ? (isCorrect ? 'uncertain_correct' : 'uncertain_incorrect') : baseSpeedBucket,
      was_uncertain: wasUncertain,
      uncertain_options: uncertainOptions,
      uncertainty_note: didNotKnow
        ? 'NO_SE_EXPLICITO'
        : wasUncertain
          ? 'QUESTION_DOUBT'
          : null,
      normalized_speed: Number(((Number(responseTimeMs||0)/1000) / Math.max(1, normalizedTarget)).toFixed(4)),
      target_seconds: normalizedTarget,
      was_due: Boolean(state && new Date(state.due_at) <= new Date(answeredAt)),
      answered_at: answeredAt,
      updated_at: answeredAt,
      session_id: meta.sessionId || null,
      session_question_index: Number.isInteger(meta.sessionQuestionIndex) ? meta.sessionQuestionIndex : null,
      client_attempt_id: meta.clientAttemptId || makeUuid(),
    };
  }

  async function applyAttemptsToMemory(savedAttempts) {
    const nextRows = [];
    for (const attempt of savedAttempts) {
      const q = questions.find(x => x.id === attempt.question_id);
      if (!q) continue;
      const prev = memoryByQuestion.get(q.id) || null;
      const attemptAt = new Date(attempt.answered_at || 0);
      const prevAt = prev?.last_attempt_at ? new Date(prev.last_attempt_at) : null;

      // v1.3.3 — idempotencia: un upsert/reintento del mismo intento no puede
      // volver a hacer evolucionar la memoria. Los intentos tardíos se reparan
      // determinísticamente en reconcileMemoryFromAttempts().
      if (prevAt && Number.isFinite(prevAt.getTime()) && Number.isFinite(attemptAt.getTime()) && attemptAt <= prevAt) continue;

      const evolved = evolveMemory(prev, attempt, q);
      memoryByQuestion.set(q.id, evolved);
      nextRows.push(evolved);
    }
    memoryStates = [...memoryByQuestion.values()];
    await upsertMemoryRows(nextRows);
  }

  async function rebuildMemoryForQuestion(questionId) {
    const q = questions.find(x => x.id === questionId);
    if (!q) return null;
    const list = attemptsForQuestion(questionId)
      .slice()
      .sort((a,b) => new Date(a.answered_at) - new Date(b.answered_at));
    if (!list.length) return null;

    let state = null;
    for (const a of list) {
      const normalized = {
        ...a,
        memory_rating: a.memory_rating || memoryRating(q, a.response_time_ms, a.is_correct, a.timed_out, a.target_seconds),
        speed_bucket: a.speed_bucket || speedBucket(q, a.response_time_ms, a.is_correct, a.timed_out, a.target_seconds),
      };
      state = evolveMemory(state, normalized, q);
    }
    if (state) await upsertMemoryRows([state]);
    return state;
  }

  async function setAttemptQuestionDoubtAfterFeedback(attemptId, q, active) {
    if (!attemptId) return null;
    const idx = attempts.findIndex(a => String(a.id) === String(attemptId));
    if (idx < 0) return null;

    const current = attempts[idx];
    const didNotKnow = String(current.uncertainty_note || '').includes('NO_SE_EXPLICITO');

    const noteParts = String(current.uncertainty_note || '')
      .split('|')
      .map(part => part.trim())
      .filter(Boolean)
      .filter(part => !part.startsWith('Alternativas marcadas con ?:'))
      .filter(part => !['QUESTION_DOUBT','POST_ANSWER_REASONING_MISMATCH'].includes(part));
    if (active) noteParts.push('QUESTION_DOUBT');

    const baseMemoryRating = memoryRating(q, current.response_time_ms, current.is_correct, current.timed_out, current.target_seconds);
    const baseSpeedBucket = speedBucket(q, current.response_time_ms, current.is_correct, current.timed_out, current.target_seconds);
    const changes = {
      was_uncertain:Boolean(active),
      uncertain_options:[],
      uncertainty_note:noteParts.length ? noteParts.join(' | ') : null,
      memory_rating:didNotKnow ? current.memory_rating : (active && current.is_correct ? Math.min(baseMemoryRating, 2) : baseMemoryRating),
      speed_bucket:didNotKnow ? current.speed_bucket : (active ? (current.is_correct ? 'uncertain_correct' : 'uncertain_incorrect') : baseSpeedBucket),
      updated_at:new Date().toISOString(),
    };

    let updated = { ...current, ...changes };
    const localOnly = !cloudConfigured || String(current.id || '').startsWith('local-');
    if (!localOnly) {
      const { data, error } = await supa.from('attempts')
        .update(changes)
        .eq('id', attemptId)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) {
        console.warn('No se pudo actualizar la duda de la pregunta:', error.message);
        return null;
      }
      updated = data;
    } else if (cloudConfigured) {
      const payload = { ...updated, id:undefined, syncStatus:undefined, user_id:user.id };
      await sessionStore?.queueOperation('INSERT_ATTEMPT', payload, `INSERT_ATTEMPT:${updated.client_attempt_id}`);
    }

    attempts[idx] = updated;
    await saveAttemptShadow(updated, localOnly ? (cloudConfigured ? 'pending' : 'local') : 'synced');
    if (!cloudConfigured) saveLocalAttempts();
    await rebuildMemoryForQuestion(q.id);
    return updated;
  }

  function upsertAttemptInMemory(row) {
    if (!row) return null;
    const index = attempts.findIndex(item =>
      (row.client_attempt_id && item.client_attempt_id === row.client_attempt_id) ||
      (row.id && String(item.id) === String(row.id))
    );
    if (index >= 0) attempts[index] = row;
    else attempts.push(row);
    return row;
  }

  async function saveAttemptShadow(row, syncStatus = 'pending') {
    if (!row?.client_attempt_id) return;
    try { await sessionStore?.putAttempt(row, syncStatus); }
    catch (error) { console.warn('Could not save attempt shadow.', error); }
  }

  async function recordSingleAttempt(q, selected, isCorrect, ms, mode, timedOut, meta = {}) {
    const attempt = makeAttempt(q, selected, isCorrect, ms, mode, timedOut, meta);
    const localRow = {
      id: `local-${attempt.client_attempt_id}`,
      ...attempt,
      user_id:user?.id || 'local-user',
      syncStatus:cloudConfigured ? 'pending' : 'local',
    };
    await saveAttemptShadow(localRow, localRow.syncStatus);

    let saved = localRow;
    if (cloudConfigured) {
      const { data, error } = await supa.from('attempts')
        .upsert({ ...attempt, user_id:user.id }, { onConflict:'user_id,client_attempt_id' })
        .select()
        .single();
      if (error) {
        await sessionStore?.queueOperation('INSERT_ATTEMPT', { ...attempt, user_id:user.id }, `INSERT_ATTEMPT:${attempt.client_attempt_id}`);
        console.warn('Attempt queued for synchronization.', error);
      } else {
        saved = { ...data, syncStatus:'synced' };
        await saveAttemptShadow(saved, 'synced');
      }
    } else {
      saved = { ...localRow, id:makeUuid() };
      await saveAttemptShadow(saved, 'local');
    }

    upsertAttemptInMemory(saved);
    if (!cloudConfigured) saveLocalAttempts();
    await applyAttemptsToMemory([saved]);
    return saved;
  }

  async function recordAttemptsBatch(payload) {
    if (!payload.length) return [];
    const rows = payload.map(row => ({
      ...row,
      client_attempt_id:row.client_attempt_id || makeUuid(),
      user_id:user?.id || 'local-user',
    }));

    for (const row of rows) {
      await saveAttemptShadow({ id:`local-${row.client_attempt_id}`, ...row }, cloudConfigured ? 'pending' : 'local');
    }

    let saved = rows.map(row => ({ id:`local-${row.client_attempt_id}`, ...row, syncStatus:cloudConfigured ? 'pending' : 'local' }));
    if (cloudConfigured) {
      const { data, error } = await supa.from('attempts')
        .upsert(rows, { onConflict:'user_id,client_attempt_id' })
        .select();
      if (error) {
        for (const row of rows) {
          await sessionStore?.queueOperation('INSERT_ATTEMPT', row, `INSERT_ATTEMPT:${row.client_attempt_id}`);
        }
        console.warn('Attempt batch queued for synchronization.', error);
      } else {
        saved = (data || []).map(row => ({ ...row, syncStatus:'synced' }));
        for (const row of saved) await saveAttemptShadow(row, 'synced');
      }
    } else {
      saved = rows.map(row => ({ id:makeUuid(), ...row, syncStatus:'local' }));
      for (const row of saved) await saveAttemptShadow(row, 'local');
    }

    saved.forEach(upsertAttemptInMemory);
    if (!cloudConfigured) saveLocalAttempts();
    await applyAttemptsToMemory(saved);
    return saved;
  }

  const HISTORY_BLOCK_GAP_MS = 20 * 60 * 1000;

  function studyModeLabel(mode = '') {
    const labels = {
      smart_review:'Repaso inteligente',
      historical_exam:'Simulacro histórico',
      exam:'Simulacro personalizado',
      custom_study_end:'Práctica · corrección al final',
      custom_study_immediate:'Práctica · corrección inmediata',
      practice_priority:'Práctica prioritaria',
      practice_speed:'Velocidad',
      practice_high:'Alta rentabilidad',
      practice_errors:'Errores',
      practice_uncertain:'Dudas',
      practice_sprint:'Sprint',
      specific_questions:'Preguntas específicas',
      topic_coverage:'Cobertura por tema',
      topic_unseen:'No vistas del tema',
      auto_due:'Plan · repasos',
      auto_new_coverage:'Plan · cobertura nueva',
      auto_fragile:'Plan · errores y dudas',
      auto_speed:'Plan · automatización',
      auto_mixed:'Plan · bloque mixto',
    };
    if (labels[mode]) return labels[mode];
    if (String(mode).startsWith('practice_')) return `Práctica · ${String(mode).replace('practice_','').replaceAll('_',' ')}`;
    return String(mode || 'Práctica').replaceAll('_',' ');
  }

  function formatDurationCompact(ms = 0) {
    const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const minRest = minutes % 60;
    return minRest ? `${hours} h ${minRest} min` : `${hours} h`;
  }

  function formatClock(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' });
  }

  function formatHistoryDate(dateIso) {
    const d = parseLocalDate(dateIso);
    const text = d.toLocaleDateString('es-PE', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function shiftLocalDate(dateIso, amount) {
    const d = parseLocalDate(dateIso);
    d.setDate(d.getDate() + Number(amount || 0));
    return isoDateLocal(d);
  }

  function halfDayKey(attempt) {
    const d = new Date(attempt.answered_at);
    return d.getHours() < 13 ? 'morning' : 'afternoon';
  }

  function summarizeAttemptList(list = []) {
    const sorted = [...list].sort((a,b) => new Date(a.answered_at) - new Date(b.answered_at));
    const validTimes = sorted.map(a => Number(a.response_time_ms || 0)).filter(v => v > 0);
    let blocks = sorted.length ? 1 : 0;
    let longestGapMs = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gap = Math.max(0, new Date(sorted[i].answered_at) - new Date(sorted[i-1].answered_at));
      longestGapMs = Math.max(longestGapMs, gap);
      if (gap > HISTORY_BLOCK_GAP_MS) blocks += 1;
    }
    return {
      total: sorted.length,
      correct: sorted.filter(a => a.is_correct).length,
      uncertain: sorted.filter(a => a.was_uncertain).length,
      timedOut: sorted.filter(a => a.timed_out).length,
      avgMs: validTimes.length ? validTimes.reduce((sum,v) => sum+v, 0) / validTimes.length : 0,
      responseMs: validTimes.reduce((sum,v) => sum+v, 0),
      firstAt: sorted[0]?.answered_at || null,
      lastAt: sorted[sorted.length-1]?.answered_at || null,
      blocks,
      longestGapMs,
    };
  }

  function halfDayReportMarkup(title, subtitle, list) {
    const s = summarizeAttemptList(list);
    if (!s.total) return `<article class="history-half-card panel"><div class="history-half-title"><div><h3>${esc(title)}</h3><small>${esc(subtitle)}</small></div><span class="tag">Sin actividad</span></div><p class="muted">Todavía no hay intentos registrados en este periodo.</p></article>`;
    const longPause = s.longestGapMs > HISTORY_BLOCK_GAP_MS;
    return `<article class="history-half-card panel">
      <div class="history-half-title"><div><h3>${esc(title)}</h3><small>${esc(subtitle)}</small></div><span class="tag ${longPause?'warn':'ok'}">${s.blocks} bloque${s.blocks===1?'':'s'}</span></div>
      <div class="history-metrics">
        <div><strong>${s.total}</strong><small>preguntas</small></div>
        <div><strong>${pct(s.correct,s.total)}</strong><small>acierto</small></div>
        <div><strong>${s.avgMs?`${(s.avgMs/1000).toFixed(1)} s`:'—'}</strong><small>tiempo medio</small></div>
        <div><strong>${s.uncertain}</strong><small>con duda</small></div>
        <div><strong>${s.timedOut}</strong><small>por tiempo</small></div>
      </div>
      <div class="history-period-meta">
        <span>Actividad: <strong>${formatClock(s.firstAt)}–${formatClock(s.lastAt)}</strong></span>
        <span>Tiempo respondiendo: <strong>${formatDurationCompact(s.responseMs)}</strong></span>
        <span class="${longPause?'history-gap-warn':''}">Pausa mayor entre respuestas: <strong>${s.longestGapMs?formatDurationCompact(s.longestGapMs):'—'}</strong></span>
      </div>
    </article>`;
  }

  function attemptStatusMarkup(a) {
    if (a.timed_out) return '<span class="tag bad">⏱ Tiempo</span>';
    if (String(a.uncertainty_note || '').includes('NO_SE_EXPLICITO')) return '<span class="tag bad">🤷 No sabía</span>';
    if (a.is_correct && a.was_uncertain) return '<span class="tag warn">✅ + ?</span>';
    if (a.is_correct) return '<span class="tag ok">✅ Correcta</span>';
    if (a.was_uncertain) return '<span class="tag bad">❌ + ?</span>';
    return '<span class="tag bad">❌ Incorrecta</span>';
  }

  function renderAttemptHistoryRow(a, q) {
    const source = q ? questionSourceLabel(q) : a.question_id;
    const target = Number(a.target_seconds || profile?.target_response_seconds || 25);
    const time = Number(a.response_time_ms || 0);
    return `<article class="history-attempt-row">
      <div class="history-attempt-time"><strong>${formatClock(a.answered_at)}</strong><small>${time?`${(time/1000).toFixed(time<10000?1:0)} s / ${target} s`:'sin tiempo'}</small></div>
      <div class="history-attempt-main">
        <div class="history-attempt-tags">${attemptStatusMarkup(a)}<span class="tag">${esc(studyModeLabel(a.study_mode))}</span></div>
        <strong>${esc(source)}</strong>
        <p>${esc(q?.topic || 'Pregunta no disponible')} · ${esc(q?.area || '')}</p>
        <small>Marcaste: ${esc(a.selected_answer || '—')} · Clave oficial: ${esc(q?.official_answer || '—')}</small>
      </div>
      <button class="btn small" data-history-attempt="${esc(a.id)}">Revisar</button>
    </article>`;
  }

  function openHistoryAttempt(attemptId, returnDate) {
    const attempt = attempts.find(a => String(a.id) === String(attemptId));
    if (!attempt) return renderMessage('Historial', 'No se encontró ese intento.');
    const q = questions.find(x => x.id === attempt.question_id);
    if (!q) return renderMessage('Historial', 'La pregunta vinculada a ese intento no está disponible en el corpus cargado.');
    const didNotKnow = String(attempt.uncertainty_note || '').includes('NO_SE_EXPLICITO');
    const scratch = {};
    const uncertainOptions = Array.isArray(attempt.uncertain_options) ? attempt.uncertain_options : [];
    if (uncertainOptions.length) {
      scratch[q.id] = Object.fromEntries(uncertainOptions.map(letter => [letter, 'tentative']));
    }
    reviewContext = {
      type:'history_legacy_attempt',
      questions:[q],
      index:0,
      responses:{ [q.id]: { selected:attempt.selected_answer || null, timedOut:Boolean(attempt.timed_out), didNotKnow } },
      scratch,
      optionOrders:{},
      shuffleOptions:false,
      attemptsByQuestion:{ [q.id]:attempt },
      returnDate:returnDate || isoDateLocal(attempt.answered_at),
    };
    renderReviewQuestion();
  }

  function completedSessionsForDate(dateIso) {
    return completedSessions
      .filter(row => isoDateLocal(row.completed_at || row.updated_at || row.created_at) === dateIso)
      .sort((a,b) => new Date(b.completed_at || b.updated_at || 0) - new Date(a.completed_at || a.updated_at || 0));
  }

  function attemptsForSessionId(sessionId) {
    return attempts
      .filter(attempt => String(attempt.session_id || '') === String(sessionId || ''))
      .sort((a,b) => {
        const indexA = Number.isFinite(Number(a.session_question_index)) ? Number(a.session_question_index) : Number.MAX_SAFE_INTEGER;
        const indexB = Number.isFinite(Number(b.session_question_index)) ? Number(b.session_question_index) : Number.MAX_SAFE_INTEGER;
        if (indexA !== indexB) return indexA - indexB;
        return new Date(a.answered_at || 0) - new Date(b.answered_at || 0);
      });
  }

  function sessionStateResultSummary(row) {
    const state = normalizeSessionState(row?.state || {});
    const answeredIds = answeredIdsFor(row, state);
    let correct = 0;
    for (const questionId of answeredIds) {
      const q = questions.find(item => item.id === questionId);
      if (!q) continue;
      const response = sessionResponse(state, questionId);
      if (!response.didNotKnow && !response.timedOut && response.selected === q.official_answer) correct += 1;
    }
    return {
      answered:answeredIds.length,
      correct,
      accuracy:answeredIds.length ? Math.round(correct / answeredIds.length * 100) : null,
    };
  }

  function renderSessionHistoryCard(row) {
    const list = attemptsForSessionId(row.id);
    const summary = SessionCore.buildSessionSummary
      ? SessionCore.buildSessionSummary(row, list)
      : {
          title:row.title || studyModeLabel(row.config?.studyMode || row.config?.examType || row.mode),
          partial:Boolean(row.is_partial),
          planned:Number(row.planned_count || row.question_ids?.length || 0),
          answered:list.length || Number(row.answered_count || 0),
          correct:list.filter(attempt => attempt.is_correct).length,
          accuracy:list.length ? Math.round(list.filter(attempt => attempt.is_correct).length / list.length * 100) : null,
          activeTimeMs:Number(row.active_time_ms || 0),
          completedAt:row.completed_at || row.updated_at,
        };
    const stateSummary = sessionStateResultSummary(row);
    if (stateSummary.answered > list.length) {
      summary.answered = stateSummary.answered;
      summary.correct = stateSummary.correct;
      summary.accuracy = stateSummary.accuracy;
    }
    const label = summary.title || studyModeLabel(row.config?.studyMode || row.config?.examType || row.mode);
    const completion = summary.partial ? '<span class="tag warn">Sesión parcial</span>' : '<span class="tag ok">Sesión completa</span>';
    const accuracy = summary.accuracy == null ? '—' : `${summary.accuracy}%`;
    const syncTag = ['pending','offline','conflict'].includes(row.syncStatus)
      ? '<span class="tag warn">Pendiente de sincronizar</span>'
      : '';
    return `<article class="history-session-card">
      <div class="history-session-head">
        <div><div class="history-attempt-tags">${completion}${syncTag}<span class="tag">${esc(row.mode === 'exam' ? 'Simulacro' : 'Práctica')}</span></div><h3>${esc(label)}</h3><small>${formatClock(summary.completedAt)} · ${formatDurationCompact(summary.activeTimeMs)}</small></div>
        <button class="btn small" data-history-session="${esc(row.id)}">Revisar sesión</button>
      </div>
      <div class="history-metrics compact">
        <div><strong>${summary.answered}</strong><small>respondidas</small></div>
        <div><strong>${summary.planned}</strong><small>planificadas</small></div>
        <div><strong>${summary.correct}</strong><small>correctas</small></div>
        <div><strong>${accuracy}</strong><small>acierto</small></div>
      </div>
    </article>`;
  }

  function responseFromAttempt(attempt) {
    return {
      selected:attempt?.selected_answer || null,
      didNotKnow:String(attempt?.uncertainty_note || '').includes('NO_SE_EXPLICITO'),
      timedOut:Boolean(attempt?.timed_out),
      locked:true,
      lockedByTimeout:Boolean(attempt?.timed_out),
      metadataRevealed:true,
    };
  }

  async function openHistorySession(sessionId, returnDate) {
    const row = completedSessions.find(item => String(item.id) === String(sessionId));
    if (!row) return renderMessage('Historial', 'No se encontró esa sesión.');
    const state = normalizeSessionState(row.state || {});
    await ensureHistorySessionAttempts(row.id);
    const sessionAttempts = attemptsForSessionId(row.id);
    const attemptsByQuestion = Object.fromEntries(sessionAttempts.map(attempt => [attempt.question_id, attempt]));
    const answeredSet = new Set(sessionAttempts.map(attempt => attempt.question_id));
    const orderedIds = (row.question_ids || []).filter(id => !row.is_partial || answeredSet.has(id) || responseCountsAsAnswered(state.responses?.[id]));
    for (const attempt of sessionAttempts) if (!orderedIds.includes(attempt.question_id)) orderedIds.push(attempt.question_id);
    const selectedQuestions = orderedIds.map(id => questions.find(question => question.id === id)).filter(Boolean);
    if (!selectedQuestions.length) return renderMessage('Historial', 'La sesión no contiene preguntas revisables en el corpus actual.');
    const responses = { ...(state.responses || {}) };
    for (const attempt of sessionAttempts) {
      if (!responseCountsAsAnswered(responses[attempt.question_id])) responses[attempt.question_id] = responseFromAttempt(attempt);
    }
    reviewContext = {
      type:'history_session',
      sessionId:row.id,
      partial:Boolean(row.is_partial),
      questions:selectedQuestions,
      allQuestions:selectedQuestions,
      sessionTitle:row.title || studyModeLabel(row.config?.studyMode || row.config?.examType || row.mode),
      originalQuestionIds:row.question_ids || selectedQuestions.map(question => question.id),
      index:0,
      responses,
      scratch:state.scratch || {},
      marked:state.marked || {},
      optionOrders:state.optionOrders || {},
      shuffleOptions:row.config?.shuffleOptions !== false && row.config?.examLayout !== 'paper',
      attemptsByQuestion,
      sessionDatasetRevision:row.config?.datasetRevision || null,
      returnDate:returnDate || isoDateLocal(row.completed_at || row.updated_at),
    };
    renderReviewSummary();
  }

  async function renderHistory(selectedDate = isoDateLocal()) {
    clearTimer();
    const dateIso = /^\d{4}-\d{2}-\d{2}$/.test(String(selectedDate)) ? String(selectedDate) : isoDateLocal();
    await ensureHistoryDateLoaded(dateIso);
    const qById = new Map(questions.map(q => [q.id, q]));
    const daySessions = completedSessionsForDate(dateIso);
    const dayAttempts = attempts
      .filter(attempt => isoDateLocal(attempt.answered_at) === dateIso)
      .sort((a,b) => new Date(b.answered_at) - new Date(a.answered_at));
    const legacyDayAttempts = dayAttempts.filter(attempt => !attempt.session_id);
    const morning = dayAttempts.filter(a => halfDayKey(a) === 'morning');
    const afternoon = dayAttempts.filter(a => halfDayKey(a) === 'afternoon');
    const daySummary = summarizeAttemptList(dayAttempts);
    const today = isoDateLocal();
    const recentDates = Array.from({length:14}, (_,i) => shiftLocalDate(today, -i));

    app.innerHTML = `<main class="shell">${topbar('Historial por sesiones', true)}
      <section class="panel history-date-panel">
        <div><h2>${esc(formatHistoryDate(dateIso))}</h2><p class="muted">Las sesiones nuevas se muestran como unidades completas. Los intentos anteriores a la actualización que no poseen identificador de sesión permanecen separados y no se presentan como sesiones exactas.</p></div>
        <div class="history-date-controls">
          <button id="history-prev-day" class="btn small ghost" type="button">← Día anterior</button>
          <input id="history-date" class="input history-date-input" type="date" value="${esc(dateIso)}" max="${esc(today)}">
          <button id="history-next-day" class="btn small ghost" type="button" ${dateIso>=today?'disabled':''}>Día siguiente →</button>
        </div>
      </section>

      <section class="kpis history-kpis">
        <div class="kpi"><div class="value">${daySessions.length}</div><div class="label">Sesiones</div></div>
        <div class="kpi"><div class="value">${daySummary.total}</div><div class="label">Preguntas</div></div>
        <div class="kpi"><div class="value">${pct(daySummary.correct,daySummary.total)}</div><div class="label">Acierto</div></div>
        <div class="kpi"><div class="value">${daySummary.avgMs?`${(daySummary.avgMs/1000).toFixed(1)} s`:'—'}</div><div class="label">Tiempo medio</div></div>
        <div class="kpi"><div class="value">${daySummary.uncertain}</div><div class="label">Con duda</div></div>
      </section>

      <section class="history-half-grid">
        ${halfDayReportMarkup('Informe de la mañana', '00:00–12:59', morning)}
        ${halfDayReportMarkup('Informe de la tarde/noche', '13:00–23:59', afternoon)}
      </section>

      <section class="panel history-list-panel">
        <div class="section-head"><div><h2>Sesiones del día</h2><p class="muted">Cada tarjeta conserva el orden original, el cierre completo o parcial y el acceso a la revisión pregunta por pregunta.</p></div></div>
        <div class="history-session-list">${daySessions.length
          ? daySessions.map(renderSessionHistoryCard).join('')
          : '<div class="empty">No hay sesiones finalizadas en esta fecha.</div>'}</div>
      </section>

      ${legacyDayAttempts.length ? `<details class="panel history-list-panel legacy-history-panel">
        <summary class="legacy-history-summary"><span><strong>Actividad anterior sin sesión exacta</strong><small>${legacyDayAttempts.length} intento${legacyDayAttempts.length===1?'':'s'} heredado${legacyDayAttempts.length===1?'':'s'} · abrir solo si necesitas revisarlos</small></span><span class="tag">Colapsado</span></summary>
        <div class="legacy-history-content"><p class="muted">Estos intentos fueron creados antes de guardar un identificador de sesión. Se conservan individualmente para no inventar agrupaciones.</p><div class="history-attempt-list">${legacyDayAttempts.map(a => renderAttemptHistoryRow(a, qById.get(a.question_id))).join('')}</div></div>
      </details>` : ''}

      <section class="panel history-days-panel">
        <h2>Últimos 14 días</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th class="num">Sesiones</th><th class="num">Preguntas</th><th class="num">Acierto</th><th class="num">Actividad heredada</th><th></th></tr></thead>
          <tbody>${recentDates.map(date => {
            const sessions = completedSessionsForDate(date);
            const list = attempts.filter(attempt => isoDateLocal(attempt.answered_at) === date);
            const legacy = list.filter(attempt => !attempt.session_id);
            const summary = summarizeAttemptList(list);
            return `<tr><td>${esc(parseLocalDate(date).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit'}))}</td><td class="num">${sessions.length}</td><td class="num">${summary.total}</td><td class="num">${pct(summary.correct,summary.total)}</td><td class="num">${legacy.length}</td><td><button class="btn small ghost" data-history-date="${esc(date)}">Ver</button></td></tr>`;
          }).join('')}</tbody>
        </table></div>
        ${cloudConfigured && historyHasMore ? '<div class="footer-actions"><button id="history-load-more" class="btn ghost" type="button">Cargar historial anterior</button></div>' : ''}
      </section>
    </main>`;

    attachTopbar();
    document.getElementById('history-prev-day').onclick = () => renderHistory(shiftLocalDate(dateIso,-1));
    document.getElementById('history-next-day').onclick = () => renderHistory(shiftLocalDate(dateIso,1));
    document.getElementById('history-date').onchange = ev => renderHistory(ev.target.value);
    document.querySelectorAll('[data-history-date]').forEach(btn => btn.onclick = () => renderHistory(btn.dataset.historyDate));
    document.querySelectorAll('[data-history-session]').forEach(btn => btn.onclick = () => openHistorySession(btn.dataset.historySession,dateIso));
    document.querySelectorAll('[data-history-attempt]').forEach(btn => btn.onclick = () => openHistoryAttempt(btn.dataset.historyAttempt,dateIso));
    const loadMore = document.getElementById('history-load-more');
    if (loadMore) loadMore.onclick = async () => {
      loadMore.disabled = true;
      loadMore.textContent = 'Cargando…';
      await loadMoreCompletedSessions();
      renderHistory(dateIso);
    };
  }

  function reviewFlagEntries(type = 'all', view = 'open') {
    const source = view === 'history'
      ? reviewFlagHistory.filter(flag => reviewFlagStatus(flag) !== 'OPEN')
      : reviewFlags;
    return source
      .map(flag => ({ flag, q:questions.find(item => item.id === flag.question_id) }))
      .filter(item => item.q && (type === 'all' || item.flag.flag_type === type))
      .sort((a,b) => new Date(b.flag.resolved_at || b.flag.updated_at || 0) - new Date(a.flag.resolved_at || a.flag.updated_at || 0));
  }

  function reviewFlagStateMeta(flag = {}) {
    const status = reviewFlagStatus(flag);
    if (status === 'RESOLVED') return { label:'Parchada', icon:'✓', className:'ok' };
    if (status === 'DISMISSED') return { label:'Retirada sin parche', icon:'—', className:'' };
    return { label:'Pendiente', icon:'⚑', className:'warn' };
  }

  function reviewFlagsReportText(type = 'all', view = 'open') {
    const entries = reviewFlagEntries(type, view);
    const lines = [
      view === 'history' ? '# Historial de observaciones cerradas' : '# Preguntas marcadas para revisión',
      `Total: ${entries.length}`,
      `Versión de la app: ${APP_VERSION}`,
      '',
    ];
    entries.forEach(({ flag, q }, index) => {
      const meta = reviewFlagMeta(flag.flag_type);
      const state = reviewFlagStateMeta(flag);
      const taxonomy = [q.area, q.specialty, q.topic, q.subtopic]
        .filter(Boolean)
        .filter((value, idx, arr) => idx === 0 || taxonomyKey(value) !== taxonomyKey(arr[idx-1]))
        .join(' → ');
      lines.push(`${index + 1}. ${meta.label} — ${q.id}`);
      lines.push(`   Estado: ${state.label}`);
      lines.push(`   Alcance: ${reviewLearningScopeMeta(flag.learning_scope).label}`);
      lines.push(`   Fuente: ${questionSourceLabel(q)}`);
      lines.push(`   Taxonomía: ${taxonomy || 'Sin taxonomía'}`);
      lines.push(`   Revisión de contenido al marcar: ${flag.content_revision || 'No registrada'}`);
      lines.push(`   Marcada: ${flag.created_at || flag.updated_at || 'No registrado'}`);
      if (reviewFlagStatus(flag) === 'RESOLVED') {
        lines.push(`   Parche: ${flag.resolved_by_patch_id || 'No registrado'}`);
        lines.push(`   Resolución: ${flag.resolution_summary || 'Sin resumen'}`);
        lines.push(`   Cerrada: ${flag.resolved_at || flag.updated_at || 'No registrado'}`);
      }
      if (flag.user_note) lines.push(`   Observación: ${String(flag.user_note).replace(/\s+/g, ' ').trim()}`);
      lines.push(`   Enunciado: ${String(q.question || '').replace(/\s+/g, ' ').trim()}`);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  async function copyReviewFlagsReport(type = 'all', view = 'open') {
    const text = reviewFlagsReportText(type, view);
    if (!text || !reviewFlagEntries(type, view).length) return;
    try {
      await navigator.clipboard.writeText(text);
      alert(view === 'history' ? 'Historial copiado.' : 'Lista copiada. Ya puedes pegarla directamente en el chat.');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      alert(view === 'history' ? 'Historial copiado.' : 'Lista copiada. Ya puedes pegarla directamente en el chat.');
    }
  }

  function csvCell(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
    return `"${text.replaceAll('"', '""')}"`;
  }

  function patchCsvValue(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); }
      catch { return String(value); }
    }
    return String(value);
  }

  function patchCsvCell(value) {
    const text = patchCsvValue(value).replace(/\r\n/g, '\n');
    return `"${text.replaceAll('"', '""')}"`;
  }

  function orderedUnionKeys(rows = []) {
    const keys = [];
    const seen = new Set();
    (rows || []).forEach(row => Object.keys(row || {}).forEach(key => {
      if (seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    }));
    return keys;
  }

  function uniqueNonEmpty(values = []) {
    return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
  }

  async function fetchAuthoritativeRowsByIds(table, idColumn, ids, chunkSize = 100) {
    const wanted = uniqueNonEmpty(ids);
    const rows = [];
    for (let index = 0; index < wanted.length; index += chunkSize) {
      const chunk = wanted.slice(index, index + chunkSize);
      const { data, error } = await supa.from(table).select('*').in(idColumn, chunk);
      if (error) return { data:null, error };
      rows.push(...(data || []));
    }
    return { data:rows, error:null };
  }

  function compactExportTimestamp(date = new Date()) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  async function downloadReviewFlagsCsv(type = 'all', view = 'open') {
    const entries = reviewFlagEntries(type, view);
    if (!entries.length) return;
    if (!cloudConfigured || !supa || !user) {
      alert('La exportación completa requiere conexión autenticada a Supabase. No se generó un archivo basado solo en caché local.');
      return;
    }

    const button = document.getElementById('download-review-flags');
    const previousLabel = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Consultando Supabase…';
    }

    try {
      const flagIds = uniqueNonEmpty(entries.map(({ flag }) => flag?.id));
      const questionIds = uniqueNonEmpty(entries.map(({ q, flag }) => q?.id || flag?.question_id));
      if (flagIds.length !== entries.length) throw new Error('Uno o más flags no tienen identificador persistente.');

      const [flagsResult, questionsResult] = await Promise.all([
        fetchAuthoritativeRowsByIds('question_review_flags', 'id', flagIds),
        fetchAuthoritativeRowsByIds('questions', 'id', questionIds),
      ]);
      if (flagsResult.error) throw new Error(`No se pudieron descargar los flags actuales: ${flagsResult.error.message}`);
      if (questionsResult.error) throw new Error(`No se pudieron descargar las preguntas actuales: ${questionsResult.error.message}`);

      const authoritativeFlags = flagsResult.data || [];
      const authoritativeQuestions = questionsResult.data || [];
      const flagsById = new Map(authoritativeFlags.map(row => [String(row.id), row]));
      const questionsById = new Map(authoritativeQuestions.map(row => [String(row.id), row]));
      const missingFlagIds = flagIds.filter(id => !flagsById.has(id));
      const missingQuestionIds = questionIds.filter(id => !questionsById.has(id));
      if (missingFlagIds.length || missingQuestionIds.length) {
        const details = [
          missingFlagIds.length ? `flags faltantes: ${missingFlagIds.join(', ')}` : '',
          missingQuestionIds.length ? `preguntas faltantes: ${missingQuestionIds.join(', ')}` : '',
        ].filter(Boolean).join(' · ');
        throw new Error(`Supabase devolvió un conjunto incompleto (${details}).`);
      }

      const exportedAt = new Date();
      const exportBatchId = `REVIEW-PATCH-${compactExportTimestamp(exportedAt)}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
      const orderedFlags = flagIds.map(id => flagsById.get(id));
      const orderedQuestions = questionIds.map(id => questionsById.get(id));
      const flagColumns = orderedUnionKeys(orderedFlags);
      const questionColumns = orderedUnionKeys(orderedQuestions);
      const metadataColumns = [
        'export__schema_version',
        'export__batch_id',
        'export__generated_at',
        'export__app_version',
        'export__source',
        'export__view',
        'export__filter',
        'export__is_complete',
        'export__requested_flag_count',
        'export__exported_flag_count',
        'export__requested_question_count',
        'export__exported_question_count',
        'export__dataset_revision',
        'export__flag_question_revision_match',
        'export__flag_content_revision',
        'export__question_record_version',
        'export__question_content_sha256',
        'export__question_updated_at',
      ];
      const headers = [
        ...metadataColumns,
        ...flagColumns.map(column => `flag__${column}`),
        ...questionColumns.map(column => `question__${column}`),
      ];

      const rows = entries.map(({ flag:localFlag, q:localQuestion }) => {
        const flag = flagsById.get(String(localFlag.id));
        const question = questionsById.get(String(flag.question_id || localQuestion.id));
        const flagRevision = String(flag.content_revision || '');
        const questionRevision = String(question.record_version || question.content_revision || '');
        const revisionMatch = flagRevision && questionRevision
          ? (flagRevision === questionRevision ? 'SI' : 'NO')
          : 'NO_DETERMINABLE';
        const metadata = {
          export__schema_version:'residentado-review-patch-csv-v1',
          export__batch_id:exportBatchId,
          export__generated_at:exportedAt.toISOString(),
          export__app_version:APP_VERSION,
          export__source:'SUPABASE_AUTHORITATIVE',
          export__view:view,
          export__filter:type,
          export__is_complete:'SI',
          export__requested_flag_count:flagIds.length,
          export__exported_flag_count:authoritativeFlags.length,
          export__requested_question_count:questionIds.length,
          export__exported_question_count:authoritativeQuestions.length,
          export__dataset_revision:datasetManifest?.dataset_revision || '',
          export__flag_question_revision_match:revisionMatch,
          export__flag_content_revision:flagRevision,
          export__question_record_version:questionRevision,
          export__question_content_sha256:question.content_sha256 || '',
          export__question_updated_at:question.updated_at || '',
        };
        return [
          ...metadataColumns.map(column => metadata[column]),
          ...flagColumns.map(column => flag[column]),
          ...questionColumns.map(column => question[column]),
        ];
      });

      const csv = '\ufeff' + [headers, ...rows]
        .map(row => row.map(patchCsvCell).join(','))
        .join('\r\n');
      const filename = `${view === 'history' ? 'residentado_historial_auditoria_completo' : 'residentado_revision_para_patch'}_${isoDateLocal()}_${compactExportTimestamp(exportedAt).slice(9,15)}.csv`;
      downloadTextFile(filename, csv, 'text/csv;charset=utf-8');
      alert(`CSV completo generado desde Supabase: ${rows.length} flags y ${questionIds.length} preguntas. Fuente: SUPABASE_AUTHORITATIVE.`);
    } catch (error) {
      console.error('No se pudo generar el CSV completo para auditoría y parche.', error);
      alert(`No se generó el CSV: ${error?.message || error}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousLabel;
      }
    }
  }


  function learningNoteEntries(type = 'all', view = 'open') {
    const source = view === 'history'
      ? learningNoteHistory.filter(row => learningNoteStatus(row) !== 'OPEN')
      : learningNotes;
    return source
      .filter(row => type === 'all' || row.note_type === type)
      .map(note => ({ note, q:questions.find(question => question.id === note.question_id) }))
      .filter(entry => entry.q);
  }

  function questionAttemptSummary(questionId) {
    const rows = attemptsForQuestion(questionId).slice().sort((a,b) => new Date(b.answered_at || 0) - new Date(a.answered_at || 0));
    const latest = rows[0] || null;
    return {
      count:rows.length,
      correct:rows.filter(row => row.is_correct).length,
      latest,
      everUncertain:rows.some(row => row.was_uncertain || String(row.uncertainty_note || '').includes('NO_SE_EXPLICITO')),
    };
  }

  function topicLearningContext(q) {
    const sameTopic = questions.filter(item => String(item.rentability_topic_id || item.topic || '') === String(q.rentability_topic_id || q.topic || ''));
    const ids = new Set(sameTopic.map(item => item.id));
    const seenIds = new Set(attempts.filter(attempt => ids.has(attempt.question_id)).map(attempt => attempt.question_id));
    const coverage = sameTopic.length ? seenIds.size / sameTopic.length : 0;
    return {
      seen:seenIds.size,
      total:sameTopic.length,
      coverage,
      started:seenIds.size > 0,
      completed:sameTopic.length > 0 && seenIds.size >= sameTopic.length,
    };
  }

  function learningNoteExportRows(type = 'all') {
    return learningNoteEntries(type, 'open').map(({ note, q }) => {
      const attempt = questionAttemptSummary(q.id);
      const topic = topicLearningContext(q);
      const latest = attempt.latest;
      const tier = topicTierLabel(q.rentability_tier || q.rentability_status || 'SIN_CLASIFICAR');
      const scoreRaw = q.exam_rentability_score ?? q.rentability_score ?? q.topic_score ?? q.rentability_topic_score;
      const score = scoreRaw == null || scoreRaw === '' ? NaN : Number(scoreRaw);
      const orderHint = topic.started
        ? 'PRIMERAS_NUEVAS_DEL_MAZO_DENTRO_DE_SU_TIER; si ya existe tarjeta, conservar GUID e historial y priorizar mediante mazo filtrado o reposicionamiento seguro'
        : 'UBICAR_SEGUN_RENTABILIDAD_Y_PUNTAJE_DEL_TEMA';
      return {
        note_id:note.id,
        note_type:note.note_type,
        note_type_label:learningNoteMeta(note.note_type).label,
        note_text:note.note_text,
        question_id:q.id,
        year:q.year,
        test:q.test,
        question_number:q.question_number,
        area:canonicalArea(q.canonical_area || q.area),
        specialty:cleanTaxonomyLabel(q.canonical_specialty || q.specialty) || 'General',
        topic:cleanTaxonomyLabel(q.rentability_topic_label || q.topic) || 'Sin tema',
        canonical_entity:cleanTaxonomyLabel(q.canonical_entity || q.subtopic),
        rentability_tier:tier,
        rentability_score:Number.isFinite(score) ? score : '',
        topic_seen_questions:topic.seen,
        topic_total_questions:topic.total,
        topic_coverage_pct:Math.round(topic.coverage * 100),
        topic_already_started:topic.started ? 'SI' : 'NO',
        anki_order_hint:orderHint,
        anki_position_strategy:topic.started
          ? 'EARLY_NEW_WITHIN_TIER; CONCEPT_NEIGHBOR_ONLY_WITH_VERIFIED_COLPKG'
          : 'RENTABILITY_TIER_THEN_SCORE',
        question_has_open_review_flag:reviewFlagFor(q.id) ? 'SI' : 'NO',
        attempts_count:attempt.count,
        attempts_correct:attempt.correct,
        latest_selected_answer:latest?.selected_answer || '',
        latest_is_correct:latest ? (latest.is_correct ? 'SI' : 'NO') : '',
        latest_response_time_ms:latest?.response_time_ms || '',
        latest_was_uncertain:latest?.was_uncertain ? 'SI' : 'NO',
        latest_uncertainty_note:latest?.uncertainty_note || '',
        question:q.question,
        official_answer:q.official_answer,
        official_answer_text:q.official_answer_text,
        option_a:q.option_a,
        option_b:q.option_b,
        option_c:q.option_c,
        option_d:q.option_d,
        option_e:q.option_e,
        why_not_a:cleanEditorialText(q.why_not_a),
        why_not_b:cleanEditorialText(q.why_not_b),
        why_not_c:cleanEditorialText(q.why_not_c),
        why_not_d:cleanEditorialText(q.why_not_d),
        why_not_e:cleanEditorialText(q.why_not_e),
        audit_status:q.audit_status || q.medical_review_status || '',
        audit_current_assessment:cleanEditorialText(q.audit_current_assessment),
        audit_current_answer:cleanEditorialText(q.audit_current_answer),
        correct_explanation:cleanEditorialText(q.correct_explanation),
        comparison_framework:cleanEditorialText(q.comparison_framework),
        abbreviations:cleanEditorialText(q.abbreviations),
        common_trap:cleanEditorialText(q.common_trap),
        exam_pearl:cleanEditorialText(q.exam_pearl),
        content_revision:note.content_revision || questionContentRevision(q.id),
        note_created_at:note.created_at,
        note_updated_at:note.updated_at,
      };
    });
  }

  function learningNotesProtocolText() {
    return `# PROTOCOLO DE RESOLUCIÓN DE NOTAS Y DELTA ANKI\n\n` +
      `Aplicación exportadora: Residentado v${APP_VERSION}\nFecha de exportación: ${new Date().toISOString()}\n\n` +
      `## Objetivo\nResolver cada duda personal, verificar si el conocimiento ya está cubierto en la exportación Anki más reciente y producir solo las tarjetas o actualizaciones realmente necesarias.\n\n` +
      `## Fuentes y vigencia\n1. Aplicar las instrucciones vigentes del Contexto Maestro del proyecto; si son posteriores a este protocolo, prevalecen.\n2. Para medicina: normativa peruana vigente → CONAREME/ASPEFAM más reciente sobre el mismo concepto → guía internacional vigente → literatura científica → academias auditadas.\n3. Conservar separadas la clave histórica y el criterio médico actual.\n4. Toda dosis, valor normal, punto de corte, esquema o norma temporal debe verificarse y registrar fecha/fuente.\n\n` +
      `## Entradas obligatorias\n- Este paquete de notas.\n- La exportación más reciente de todos los mazos con GUID para deduplicar y preservar cambios personales.\n- Un .colpkg actualizado cuando se requiera modificar de forma segura el orden real de nuevas, la programación o tarjetas ya estudiadas.\n\n` +
      `## Decisión por nota\nClasificar cada nota como: ALREADY_COVERED, UPDATE_EXISTING_CARD, CREATE_NEW_CARD o RESOLVED_WITHOUT_ANKI. No crear una tarjeta por nota de forma automática. Deduplicar semánticamente contra todos los mazos por concepto, dato pivote y regla decisoria.\n\n` +
      `## Estándar de tarjeta\n- Una sola decisión recuperable; contexto mínimo; respuesta nuclear primero.\n- No copiar el caso histórico ni las alternativas.\n- Debe ser transferible y normalmente respondible en 5–15 segundos.\n- Clasificar individualmente como RM_2026::Nuclear o RM_2026::General.\n- Conservar GUID y programación al actualizar tarjetas existentes.\n\n` +
      `## Orden de incorporación\n- Respetar rentabilidad: MUY ALTA → ALTA → MEDIA → BAJA y, dentro del tier, puntaje descendente.\n- Si topic_already_started=SI, las tarjetas nuevas deben quedar entre las primeras nuevas pendientes del mazo/tier correspondiente, no al final global.\n- Cuando exista un orden conceptual estable en la colección, ubicarlas cerca de las tarjetas relacionadas solo si puede verificarse y aplicarse de forma segura sobre un .colpkg actualizado; si no, usar la prioridad temprana dentro del tier.\n- Si ya existe una tarjeta estudiada, no reiniciarla ni destruir FSRS/historial; actualizar conservando GUID y usar una prioridad segura (etiqueta/mazo filtrado o reposicionamiento compatible).\n- Para manipular programación u orden real con seguridad, solicitar y trabajar sobre un .colpkg actualizado; nunca asumir que una importación fue aplicada sin una exportación posterior de verificación.\n\n` +
      `## Entregables esperados\n1. Resolución breve y verificable de cada duda.\n2. Matriz por note_id con decisión Anki, GUID relacionado, mazo, prioridad y fuente.\n3. Delta importable o .colpkg modificado, según el alcance.\n4. Informe de duplicados/actualizaciones/nuevas y control de calidad.\n5. Archivo de cierre con note_id, outcome, batch_id, summary, anki_guid y anki_deck para trazabilidad.\n`;
  }

  function learningNotesPackageText(type = 'all') {
    const rows = learningNoteExportRows(type);
    const lines = [learningNotesProtocolText(), `\n## NOTAS ABIERTAS (${rows.length})\n`];
    rows.forEach((row,index) => {
      lines.push(`### ${index+1}. ${row.question_id} — ${row.note_type_label}`);
      lines.push(`- note_id: ${row.note_id}`);
      lines.push(`- Duda: ${String(row.note_text || '').replace(/\s+/g,' ').trim()}`);
      lines.push(`- Tema: ${row.area} → ${row.specialty} → ${row.topic}${row.canonical_entity ? ` → ${row.canonical_entity}` : ''}`);
      lines.push(`- Flag de auditoría abierto en paralelo: ${row.question_has_open_review_flag}`);
      lines.push(`- Rentabilidad: ${row.rentability_tier}${row.rentability_score === '' ? '' : ` (${row.rentability_score})`}`);
      lines.push(`- Cobertura personal del tema: ${row.topic_seen_questions}/${row.topic_total_questions} (${row.topic_coverage_pct}%) · tema iniciado: ${row.topic_already_started}`);
      lines.push(`- Indicación preliminar de orden: ${row.anki_order_hint}`);
      lines.push(`- Historial personal: ${row.attempts_count} intentos; ${row.attempts_correct} correctos${row.latest_was_uncertain==='SI'?' · última recuperación dudosa':''}`);
      lines.push(`- Enunciado fuente: ${String(row.question || '').replace(/\s+/g,' ').trim()}`);
      lines.push(`- Alternativas: ${['A','B','C','D','E'].map(letter => `${letter}. ${row[`option_${letter.toLowerCase()}`] || '—'}`).join(' | ')}`);
      lines.push(`- Clave histórica: ${row.official_answer}. ${row.official_answer_text}`);
      if (row.audit_status) lines.push(`- Estado de auditoría: ${row.audit_status}`);
      if (row.audit_current_answer) lines.push(`- Criterio actual auditado: ${row.audit_current_answer}`);
      if (row.audit_current_assessment) lines.push(`- Caveat/valoración vigente: ${row.audit_current_assessment.replace(/\s+/g,' ').trim()}`);
      if (row.correct_explanation) lines.push(`- Explicación disponible: ${row.correct_explanation.replace(/\s+/g,' ').trim()}`);
      if (row.comparison_framework) lines.push(`- Comparación/referencia: ${row.comparison_framework.replace(/\s+/g,' ').trim()}`);
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  function downloadTextFile(filename, text, mime = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type:mime }));
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  async function copyLearningNotesPackage(type = 'all') {
    const text = learningNotesPackageText(type);
    if (!learningNoteExportRows(type).length) return;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    alert('Paquete de notas copiado. Incluye el protocolo Anki y el contexto de cada duda.');
  }

  function downloadLearningNotesMarkdown(type = 'all') {
    if (!learningNoteExportRows(type).length) return;
    downloadTextFile(`notas_aprendizaje_anki_${isoDateLocal()}.md`, '\ufeff' + learningNotesPackageText(type), 'text/markdown;charset=utf-8');
  }

  function downloadLearningNotesCsv(type = 'all') {
    const data = learningNoteExportRows(type);
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csv = '\ufeff' + [headers, ...data.map(row => headers.map(header => row[header]))]
      .map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadTextFile(`notas_aprendizaje_${isoDateLocal()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function showResolveLearningNoteDialog(questionId, afterSave = null) {
    const note = learningNoteFor(questionId);
    const q = questions.find(item => item.id === questionId);
    if (!note || !q) return;
    const modal = document.createElement('div');
    modal.className = 'review-flag-modal';
    modal.innerHTML = `<div class="review-flag-dialog" role="dialog" aria-modal="true"><div class="review-flag-dialog-head"><div><h2>Registrar resolución</h2><p class="muted">Toda nota conceptual se cierra con acción Anki. Si ya estaba bien cubierta, reexpón la tarjeta existente en vez de duplicarla.</p></div><button class="btn small ghost" data-resolve-note-close>✕</button></div>
      <label class="learning-note-label">Resultado<select id="resolve-note-action" class="input">${ACTIVE_LEARNING_NOTE_OUTCOMES.map(key => `<option value="${key}">${esc(LEARNING_NOTE_OUTCOMES[key])}</option>`).join('')}</select></label>
      <label class="learning-note-label">Identificador del lote<input id="resolve-note-batch" class="input" placeholder="Ejemplo: NOTAS_ANKI_20260805_01"></label>
      <label class="learning-note-label">GUID Anki relacionado, si existe<input id="resolve-note-guid" class="input"></label>
      <label class="learning-note-label">Mazo<input id="resolve-note-deck" class="input" placeholder="RM_2026::Nuclear o RM_2026::General"></label>
      <label class="learning-note-label">Resumen<textarea id="resolve-note-summary" class="input review-flag-note" maxlength="3000" placeholder="Qué se aclaró y qué acción se tomó."></textarea></label>
      <div class="dialog-actions"><button class="btn ghost" data-resolve-note-close>Cancelar</button><button id="resolve-note-save" class="btn primary">Guardar y cerrar</button></div></div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelectorAll('[data-resolve-note-close]').forEach(btn => btn.onclick = close);
    modal.onclick = ev => { if (ev.target === modal) close(); };
    document.getElementById('resolve-note-save').onclick = async () => {
      const ok = await closeQuestionLearningNote(questionId, 'RESOLVED', {
        ankiAction:document.getElementById('resolve-note-action').value,
        batchId:document.getElementById('resolve-note-batch').value,
        ankiGuid:document.getElementById('resolve-note-guid').value,
        ankiDeck:document.getElementById('resolve-note-deck').value,
        summary:document.getElementById('resolve-note-summary').value,
      });
      if (ok) { close(); if (typeof afterSave === 'function') afterSave(); }
    };
  }

  function renderLearningNotesPage(type = 'all', view = 'open') {
    clearTimer(); scrollPageTop();
    const entries = learningNoteEntries(type, view);
    const isHistory = view === 'history';
    const closedCount = learningNoteHistory.filter(row => learningNoteStatus(row) !== 'OPEN').length;
    const counts = Object.fromEntries(Object.keys(LEARNING_NOTE_TYPES).map(key => [key, learningNotes.filter(row => row.note_type === key).length]));
    app.innerHTML = `<main class="shell">${topbar('Notas de aprendizaje', true)}
      <section class="panel review-flags-hero learning-notes-hero"><div><h2>${isHistory?'Historial de notas':'Dudas personales para resolver'}</h2><p class="muted">Estas notas no indican que la pregunta esté mal. Cada nota conceptual debe resolverse en Anki creando, actualizando o reexponiendo una tarjeta tras deduplicar.</p></div>${isHistory?'':`<div class="review-flags-actions"><button id="copy-learning-notes" class="btn primary" ${entries.length?'':'disabled'}>Copiar paquete</button><button id="download-learning-notes-md" class="btn" ${entries.length?'':'disabled'}>Descargar paquete .md</button><button id="download-learning-notes-csv" class="btn" ${entries.length?'':'disabled'}>CSV</button></div>`}</section>
      ${cloudConfigured && !learningNotesAvailable ? `<div class="banner"><strong>Activa esta función:</strong> ejecuta <code>${LEARNING_NOTES_MIGRATION}</code> en Supabase.</div>` : ''}
      <div class="review-flags-tabs"><button class="btn ${isHistory?'ghost':'primary'}" data-learning-notes-view="open">Pendientes (${learningNotes.length})</button><button class="btn ${isHistory?'primary':'ghost'}" data-learning-notes-view="history">Historial (${closedCount})</button></div>
      <section class="kpis review-flags-kpis"><div class="kpi"><div class="value">${learningNotes.length}</div><div class="label">Pendientes</div></div><div class="kpi"><div class="value">${counts.drug||0}</div><div class="label">Fármacos</div></div><div class="kpi"><div class="value">${counts.cutoff||0}</div><div class="label">Valores/dosis</div></div><div class="kpi"><div class="value">${closedCount}</div><div class="label">Cerradas</div></div></section>
      <section class="panel review-flags-list-panel"><div class="section-head review-flags-filter-head"><div><h2>${isHistory?'Notas cerradas':'Notas abiertas'}</h2><p class="muted">Al exportar se adjuntan el contexto de la pregunta, tu progreso, la rentabilidad y el protocolo para crear o actualizar tarjetas.</p></div><label class="review-flags-filter"><span>Mostrar</span><select id="learning-notes-type" class="input"><option value="all">Todos</option>${Object.entries(LEARNING_NOTE_TYPES).map(([key,meta]) => `<option value="${key}" ${type===key?'selected':''}>${meta.icon} ${esc(meta.label)}</option>`).join('')}</select></label></div>
        <div class="review-flag-card-list">${entries.length ? entries.map(({note,q}) => {
          const meta = learningNoteMeta(note.note_type); const topic = topicLearningContext(q);
          return `<article class="review-flag-card learning-note-card ${isHistory?'closed':''}"><div class="review-flag-card-head"><div class="meta-line"><span class="tag ${isHistory?'':'warn'}">${meta.icon} ${esc(meta.label)}</span>${questionSourceTag(q)}<span class="tag">${esc(q.id)}</span><span class="tag">${esc(topicTierLabel(q.rentability_tier || q.rentability_status || 'SIN_CLASIFICAR'))}</span></div>${isHistory?'':`<div class="review-flag-card-actions"><button class="btn small" data-edit-learning-note="${esc(q.id)}">Editar</button><button class="btn small primary" data-resolve-learning-note="${esc(q.id)}">Registrar resolución</button><button class="btn small danger ghost-danger" data-dismiss-learning-note="${esc(q.id)}">Quitar</button></div>`}</div><div class="review-flag-user-note"><strong>Tu duda</strong><p>${esc(note.note_text)}</p></div><p class="review-flag-question">${esc(q.question)}</p><p class="muted review-flag-taxonomy">${esc([q.area,q.specialty,q.topic].filter(Boolean).join(' → '))} · cobertura personal ${topic.seen}/${topic.total} (${Math.round(topic.coverage*100)}%)</p>${isHistory?`<div class="review-flag-resolution"><div><span>Resultado</span><strong>${esc(LEARNING_NOTE_OUTCOMES[note.anki_action] || learningNoteStatus(note))}</strong></div>${note.resolved_by_batch_id?`<div><span>Lote</span><strong>${esc(note.resolved_by_batch_id)}</strong></div>`:''}${note.anki_guid?`<div><span>GUID</span><strong>${esc(note.anki_guid)}</strong></div>`:''}${note.resolution_summary?`<p>${esc(note.resolution_summary)}</p>`:''}</div>`:''}</article>`;
        }).join('') : `<div class="empty">${isHistory?'No hay notas cerradas con este filtro.':'No hay notas pendientes con este filtro.'}</div>`}</div>
      </section></main>`;
    attachTopbar();
    document.querySelectorAll('[data-learning-notes-view]').forEach(btn => btn.onclick = () => renderLearningNotesPage(type, btn.dataset.learningNotesView));
    document.getElementById('learning-notes-type').onchange = ev => renderLearningNotesPage(ev.target.value, view);
    document.getElementById('copy-learning-notes')?.addEventListener('click', () => copyLearningNotesPackage(type));
    document.getElementById('download-learning-notes-md')?.addEventListener('click', () => downloadLearningNotesMarkdown(type));
    document.getElementById('download-learning-notes-csv')?.addEventListener('click', () => downloadLearningNotesCsv(type));
    document.querySelectorAll('[data-edit-learning-note]').forEach(btn => btn.onclick = () => showLearningNoteDialog(btn.dataset.editLearningNote, () => renderLearningNotesPage(type, view)));
    document.querySelectorAll('[data-resolve-learning-note]').forEach(btn => btn.onclick = () => showResolveLearningNoteDialog(btn.dataset.resolveLearningNote, () => renderLearningNotesPage(type, view)));
    document.querySelectorAll('[data-dismiss-learning-note]').forEach(btn => btn.onclick = async () => {
      if (!confirm('¿Quitar esta nota? Quedará en el historial como descartada.')) return;
      if (await closeQuestionLearningNote(btn.dataset.dismissLearningNote, 'DISMISSED')) renderLearningNotesPage(type, view);
    });
  }

  function renderReviewFlagsPage(type = 'all', view = 'open') {
    clearTimer();
    scrollPageTop();
    const entries = reviewFlagEntries(type, view);
    const counts = Object.fromEntries(Object.keys(REVIEW_FLAG_TYPES).map(key => [key, reviewFlags.filter(row => row.flag_type === key).length]));
    const closedCount = reviewFlagHistory.filter(row => reviewFlagStatus(row) !== 'OPEN').length;
    const isHistory = view === 'history';

    app.innerHTML = `<main class="shell">${topbar('Preguntas para revisar', true)}
      <section class="panel review-flags-hero">
        <div><h2>${isHistory ? 'Historial de auditoría' : 'Auditoría personal del banco'}</h2><p class="muted">${isHistory ? 'Las observaciones cerradas se conservan para saber qué se parchó, cuándo y con qué identificador.' : 'Los flags son independientes de tus respuestas y memoria. Al registrar un parche salen de esta cola, pero no se borran.'}</p></div>
        <div class="review-flags-actions"><button id="download-review-flags" class="btn primary" type="button" ${entries.length?'':'disabled'}>${isHistory ? 'Exportar historial completo CSV' : 'Exportar CSV completo para auditoría y parche'}</button></div>
      </section>
      <div class="review-flags-tabs" role="tablist" aria-label="Estado de observaciones">
        <button class="btn ${isHistory ? 'ghost' : 'primary'}" type="button" data-review-view="open">Pendientes (${reviewFlags.length})</button>
        <button class="btn ${isHistory ? 'primary' : 'ghost'}" type="button" data-review-view="history">Historial (${closedCount})</button>
      </div>
      <section class="kpis review-flags-kpis">
        <div class="kpi"><div class="value">${reviewFlags.length}</div><div class="label">Pendientes</div></div>
        <div class="kpi"><div class="value">${counts.statement || 0}</div><div class="label">Enunciado</div></div>
        <div class="kpi"><div class="value">${counts.explanation || 0}</div><div class="label">Explicación</div></div>
        <div class="kpi"><div class="value">${counts.general || 0}</div><div class="label">General</div></div>
        <div class="kpi"><div class="value">${closedCount}</div><div class="label">Historial</div></div>
      </section>
      <section class="panel review-flags-list-panel">
        <div class="section-head review-flags-filter-head"><div><h2>${isHistory ? 'Observaciones cerradas' : 'Lista marcada'}</h2><p class="muted">${isHistory ? 'La exportación consulta Supabase e incluye cada flag y la fila completa vigente de su pregunta.' : 'El CSV consulta Supabase al descargar, incluye todas las columnas actuales de flags y preguntas y no usa solo la caché local.'}</p></div>
          <label class="review-flags-filter"><span>Mostrar</span><select id="review-flags-type" class="input"><option value="all" ${type==='all'?'selected':''}>Todos</option><option value="statement" ${type==='statement'?'selected':''}>Revisar enunciado</option><option value="explanation" ${type==='explanation'?'selected':''}>Revisar explicación</option><option value="general" ${type==='general'?'selected':''}>Revisar</option></select></label>
        </div>
        <div class="review-flag-card-list">${entries.length ? entries.map(({ flag, q }) => {
          const meta = reviewFlagMeta(flag.flag_type);
          const state = reviewFlagStateMeta(flag);
          const entity = cleanTaxonomyLabel(q.canonical_entity || q.subtopic);
          const historyHtml = isHistory ? `<div class="review-flag-resolution">
            <div><span>Estado</span><strong>${state.icon} ${esc(state.label)}</strong></div>
            ${flag.resolved_by_patch_id ? `<div><span>Parche</span><strong>${esc(flag.resolved_by_patch_id)}</strong></div>` : ''}
            ${flag.content_revision ? `<div><span>Revisión marcada</span><strong>${esc(flag.content_revision)}</strong></div>` : ''}
            <div><span>Cierre</span><strong>${esc(flag.resolved_at ? new Date(flag.resolved_at).toLocaleString('es-PE') : 'Sin fecha')}</strong></div>
            ${flag.resolution_summary ? `<p>${esc(flag.resolution_summary)}</p>` : ''}
          </div>` : '';
          return `<article class="review-flag-card ${isHistory ? 'closed' : ''}">
            <div class="review-flag-card-head"><div class="meta-line"><span class="tag ${state.className}">${state.icon} ${esc(state.label)}</span><span class="tag warn">${meta.icon} ${esc(meta.label)}</span><span class="tag">${reviewLearningScopeMeta(flag.learning_scope).icon} ${esc(reviewLearningScopeMeta(flag.learning_scope).label)}</span>${questionSourceTag(q)}<span class="tag">${esc(q.id)}</span></div>${isHistory ? '' : `<div class="review-flag-card-actions"><button class="btn small primary" type="button" data-resolve-review-flag-list="${esc(q.id)}">Registrar parche</button><button class="btn small danger ghost-danger" type="button" data-remove-review-flag-list="${esc(q.id)}">Quitar</button></div>`}</div>
            ${flag.user_note ? `<div class="review-flag-user-note"><strong>Tu observación</strong><p>${esc(flag.user_note)}</p></div>` : ''}
            <p class="review-flag-question">${esc(q.question)}</p>
            <p class="muted review-flag-taxonomy">${esc([q.area, q.specialty, q.topic, entity].filter(Boolean).join(' → '))}</p>
            ${historyHtml}
          </article>`;
        }).join('') : `<div class="empty">${isHistory ? 'Todavía no hay observaciones cerradas con este filtro.' : 'No hay preguntas pendientes con este filtro.'}</div>`}</div>
      </section>
    </main>`;
    attachTopbar();
    document.querySelectorAll('[data-review-view]').forEach(btn => btn.onclick = () => renderReviewFlagsPage(type, btn.dataset.reviewView));
    document.getElementById('review-flags-type').onchange = ev => renderReviewFlagsPage(ev.target.value, view);
    document.getElementById('download-review-flags').onclick = () => downloadReviewFlagsCsv(type, view);
    document.querySelectorAll('[data-resolve-review-flag-list]').forEach(btn => {
      btn.onclick = () => showResolveReviewFlagDialog(btn.dataset.resolveReviewFlagList, () => renderReviewFlagsPage(type, view));
    });
    document.querySelectorAll('[data-remove-review-flag-list]').forEach(btn => {
      btn.onclick = async () => {
        const questionId = btn.dataset.removeReviewFlagList;
        if (!confirm(`¿Quitar el flag de ${questionId} sin parche? El retiro quedará en el historial.`)) return;
        if (await removeQuestionReviewFlag(questionId)) renderReviewFlagsPage(type, view);
      };
    });
  }

  function formatHoursMinutes(ms = 0) {
    const minutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours} h${rest ? ` ${rest} min` : ''}`;
  }

  function topicTierLabel(tier = '') {
    return String(tier || 'SIN_CLASIFICAR').replaceAll('_', ' ');
  }

  function ttsForCoverageTopic(topic = {}) {
    const topicId = topic.id || topic.topicId || topic.key || null;
    return topicId ? (ttsCatalogByTopic.get(topicId) || null) : null;
  }

  function availableTtsCount(activeTopics = null) {
    const activeIds = Array.isArray(activeTopics) ? new Set(activeTopics.map(topic => String(topic.id || topic.key || ''))) : null;
    return [...ttsCatalogByTopic.values()].filter(item => item && item.status !== 'PENDING' && (!activeIds || activeIds.has(String(item.topicId)))).length;
  }

  function enrichCoverageTopics(topics = []) {
    return topics.map(topic => {
      const tts = ttsForCoverageTopic(topic);
      const ttsStatusLabel = W4Data.catalogCompactLabel
        ? W4Data.catalogCompactLabel(tts)
        : (W4Data.catalogStatusLabel ? W4Data.catalogStatusLabel(tts) : (tts?.status || 'Pendiente'));
      const canonical = rentabilityTopicsById.get(String(topic.id || topic.key || '')) || {};
      return {
        ...topic,
        tierConfidence:canonical.tier_confidence || topic.tierConfidence || topic.scoreConfidence || null,
        sampleBand:canonical.sample_band || null,
        scoringReliabilityPolicy:canonical.scoring_reliability_policy || null,
        freezeStatus:canonical.freeze_status || null,
        tts, ttsStatusLabel, ttsAvailable:Boolean(tts && tts.status !== 'PENDING'),
      };
    });
  }

  function coverageTopicTtsPrompt(topic = {}) {
    if (W4Data.ttsRequestForTopic) {
      return W4Data.ttsRequestForTopic(
        { topicId:topic.id || topic.key, label:topic.label, area:topic.area, specialty:topic.specialty },
        topic.tts || ttsForCoverageTopic(topic),
        null
      );
    }
    return `Necesito una lectura TTS del tema canónico: ${topic.label || 'tema no especificado'}.`;
  }

  async function copyTextSafely(text) {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Continúa con el respaldo compatible con PWA/offline.
      }
    }
    const box = document.createElement('textarea');
    box.value = text;
    box.style.position = 'fixed';
    box.style.left = '-9999px';
    document.body.appendChild(box);
    box.select();
    if (typeof document.execCommand === 'function') document.execCommand('copy');
    box.remove();
  }

  async function copyCoverageTtsRequest(topic, button = null) {
    const original = button?.textContent || '';
    if (button) button.textContent = '✓ Solicitud copiada';
    try {
      await copyTextSafely(coverageTopicTtsPrompt(topic));
    } finally {
      if (button) setTimeout(() => { button.textContent = original; }, 1800);
    }
  }

  function renderTopicCoverageDetail(topicKey, returnSort = 'rentability', returnView = 'topics') {
    clearTimer();
    const coverage = W3Tools.buildCoverageSnapshot
      ? W3Tools.buildCoverageSnapshot(questions, attempts, memoryStates, new Date())
      : { topics:[] };
    const baseTopic = coverage.topics.find(item => item.key === topicKey);
    if (!baseTopic) return renderStats(returnSort, returnView);
    const topic = enrichCoverageTopics([baseTopic])[0];
    const topicQuestions = topic.questionIds.map(id => questions.find(q => q.id === id)).filter(Boolean);
    const seen = new Set(attempts.map(a => a.question_id));
    const correctEver = new Set(attempts.filter(a => a.is_correct).map(a => a.question_id));

    app.innerHTML = `<main class="shell">${topbar('Detalle de tema', true)}
      <section class="panel topic-coverage-detail-head">
        <button id="coverage-back" class="btn small ghost" type="button">← Volver a Mi estado</button>
        <div class="meta-line"><span class="tag">${esc(topicTierLabel(topic.tier))}</span>${topic.score != null ? `<span class="tag">Rentabilidad ${Math.round(topic.score)}</span>` : ''}${String(topic.tierConfidence||'').toUpperCase()==='BORDERLINE'?'<span class="tag warn">Tier cerca del corte</span>':''}<span class="tag ${topic.ttsAvailable?'ok':''}">TTS ${esc(topic.ttsStatusLabel)}</span></div>${topic.scoringReliabilityPolicy==='PARENT_AWARE_INTERPRETATION_REQUIRED'?'<p class="muted">Score con muestra pequeña: interprétalo junto con su especialidad; el topic permanece congelado y contable de forma exclusiva.</p>':''}
        <h2>${esc(topic.label)}</h2><p class="muted">${esc(topic.area)} → ${esc(topic.specialty)}</p>
        <div class="coverage-detail-kpis"><span><strong>${topic.seen}/${topic.total}</strong> vistas</span><span><strong>${topic.correctEver}/${topic.total}</strong> acertadas alguna vez</span><span><strong>${topic.overdue}</strong> vencidas</span><span><strong>${topic.uncertainAttempts}</strong> intentos dudosos</span></div>
        <div class="footer-actions"><button id="topic-unseen-session" class="btn primary" ${topic.seen===topic.total?'disabled':''}>Practicar no vistas</button><button id="topic-all-session" class="btn">Crear sesión del tema</button><button id="topic-tts-request" class="btn ghost">📋 ${topic.ttsAvailable?'Pedir suplemento TTS':'Pedir TTS'}</button></div>
      </section>
      <section class="panel"><h2>Preguntas del tema</h2><div class="topic-question-list">${topicQuestions.map(q => `<article><div><strong>${esc(q.id)}</strong><span class="tag ${!seen.has(q.id)?'':'ok'}">${!seen.has(q.id)?'No vista':correctEver.has(q.id)?'Acertada alguna vez':'Vista sin acierto'}</span></div><p>${esc(q.question)}</p></article>`).join('')}</div></section>
    </main>`;
    attachTopbar();
    document.getElementById('coverage-back').onclick = () => renderStats(returnSort, returnView);
    document.getElementById('topic-all-session').onclick = () => launchStudy(topicQuestions, { mode:'study', count:topicQuestions.length, randomize:false, feedback:'end', timeMode:'none', secondsPerQuestion:Number(profile?.target_response_seconds||25), totalSeconds:0, title:topic.label, studyMode:'topic_coverage', shuffleOptions:true });
    document.getElementById('topic-tts-request').onclick = ev => copyCoverageTtsRequest(topic, ev.currentTarget);
    const unseenButton = document.getElementById('topic-unseen-session');
    if (unseenButton) unseenButton.onclick = () => {
      const pool = topicQuestions.filter(q => !seen.has(q.id));
      if (pool.length) launchStudy(pool, { mode:'study', count:pool.length, randomize:false, feedback:'end', timeMode:'none', secondsPerQuestion:Number(profile?.target_response_seconds||25), totalSeconds:0, title:`No vistas · ${topic.label}`, studyMode:'topic_unseen', shuffleOptions:true });
    };
  }

  function buildSpecialtyCoverageGroups(topics = []) {
    const groups = new Map();
    for (const topic of topics) {
      const key = `${topic.area}|||${topic.specialty}`;
      if (!groups.has(key)) groups.set(key, {
        key, area:topic.area, specialty:topic.specialty, topics:[], total:0, seen:0,
        correctEver:0, attempts:0, correctAttempts:0, uncertainAttempts:0, overdue:0,
        ttsAvailable:0, scoreWeight:0, scoreTotal:0,
      });
      const group = groups.get(key);
      group.topics.push(topic);
      group.total += Number(topic.total || 0);
      group.seen += Number(topic.seen || 0);
      group.correctEver += Number(topic.correctEver || 0);
      group.attempts += Number(topic.attempts || 0);
      group.correctAttempts += Number(topic.correctAttempts || 0);
      group.uncertainAttempts += Number(topic.uncertainAttempts || 0);
      group.overdue += Number(topic.overdue || 0);
      if (topic.ttsAvailable) group.ttsAvailable += 1;
      if (Number.isFinite(topic.score)) {
        const weight = Math.max(1, Number(topic.total || 0));
        group.scoreWeight += topic.score * weight;
        group.scoreTotal += weight;
      }
    }
    return [...groups.values()].map(group => {
      const score = group.scoreTotal ? group.scoreWeight / group.scoreTotal : null;
      const orderedTopics = W3Tools.sortTopics ? W3Tools.sortTopics(group.topics, 'rentability') : group.topics;
      return {
        ...group,
        topics:orderedTopics,
        score,
        coverage:group.total ? group.seen / group.total : 0,
        accuracy:group.attempts ? group.correctAttempts / group.attempts : null,
      };
    }).sort((a,b) => localeSort(a.area,b.area) || (b.score ?? -1) - (a.score ?? -1) || localeSort(a.specialty,b.specialty));
  }

  function topicCoverageTableMarkup(topics = []) {
    return `<div class="table-wrap"><table class="topic-coverage-table"><thead><tr><th class="num coverage-rank">N.º</th><th>Tema</th><th>Rentabilidad</th><th>TTS</th><th class="num">Vistas</th><th class="num">Total</th><th class="num">Cobertura</th><th class="num">Dudas</th><th class="num">Vencidas</th></tr></thead><tbody>${topics.map((topic,index) => `<tr class="clickable-row" data-topic-coverage-key="${esc(topic.key)}" tabindex="0"><td class="num coverage-rank">${index+1}</td><td><strong>${esc(topic.label)}</strong><small>${esc(topic.area)} · ${esc(topic.specialty)}</small></td><td><span class="tag">${esc(topicTierLabel(topic.tier))}</span>${topic.score != null ? `<small>${Math.round(topic.score)}${String(topic.tierConfidence||'').toUpperCase()==='BORDERLINE'?' · cerca del corte':''}</small>` : ''}</td><td><button class="btn small ghost tts-availability ${topic.ttsAvailable?'available':''}" type="button" data-topic-tts-key="${esc(topic.key)}" title="${topic.ttsAvailable?'La lectura existe; copiar pedido de suplemento':'La lectura todavía no existe; copiar pedido TTS'}">${esc(topic.ttsStatusLabel || 'Pendiente')}</button></td><td class="num">${topic.seen}</td><td class="num">${topic.total}</td><td class="num">${Math.round(topic.coverage*100)}%</td><td class="num">${topic.uncertainAttempts}</td><td class="num">${topic.overdue}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function specialtyCoverageMarkup(groups = []) {
    return `<p class="muted specialty-coverage-note">La especialidad es la columna vertebral de navegación. El número mostrado es un promedio descriptivo ponderado de los scores de sus temas; no crea un tier canónico nuevo ni modifica los tiers A16.</p><div class="specialty-coverage-list">${groups.map(group => `<details class="specialty-coverage-group"><summary><div><strong>${esc(group.specialty)}</strong><small>${esc(group.area)} · ${group.topics.length} tema${group.topics.length===1?'':'s'} · ${group.total} preguntas</small></div><div class="specialty-summary-metrics"><span class="tag">${group.score == null?'Sin promedio':`Promedio descriptivo ${Math.round(group.score)}`}</span><span>${group.seen}/${group.total} vistas · ${Math.round(group.coverage*100)}%</span><span>${group.overdue} vencidas</span><span>${group.ttsAvailable}/${group.topics.length} TTS</span></div></summary>${topicCoverageTableMarkup(group.topics)}</details>`).join('')}</div>`;
  }

  function renderStats(topicSort = 'rentability', coverageView = 'topics') {
    clearTimer();
    // Coverage is a corpus-membership metric: A16 requires all 2,180 stable question IDs
    // to count exactly once, including questions whose audit status may exclude them from
    // adaptive accuracy/weakness calculations. Other performance metrics remain restricted
    // to non-observed questions below.
    const corpusIds = new Set(questions.map(q => q.id));
    const coverageAttempts = attempts.filter(a => corpusIds.has(a.question_id));
    const coverageMemory = memoryStates.filter(row => corpusIds.has(row.question_id));
    const coverage = W3Tools.buildCoverageSnapshot
      ? W3Tools.buildCoverageSnapshot(questions, coverageAttempts, coverageMemory, new Date())
      : { totalQuestions:questions.length, seenQuestions:new Set(coverageAttempts.map(a=>a.question_id)).size, correctEverQuestions:new Set(coverageAttempts.filter(a=>a.is_correct).map(a=>a.question_id)).size, totalTopics:0, touchedTopics:0, completeTopics:0, topics:[] };

    const statsQuestions = questions.filter(q => !observed(q));
    const statsIds = new Set(statsQuestions.map(q => q.id));
    const statsAttempts = attempts.filter(a => statsIds.has(a.question_id));
    const statsMemory = memoryStates.filter(row => statsIds.has(row.question_id));
    const timeSummary = W3Tools.buildTimeSummary
      ? W3Tools.buildTimeSummary(statsAttempts, completedSessions, statsQuestions.length, new Date())
      : { todayQuestions:dailyActual(isoDateLocal()), activeMsToday:statsAttempts.filter(a=>isoDateLocal(a.answered_at)===isoDateLocal()).reduce((sum,a)=>sum+Number(a.response_time_ms||0),0), pacePerDay:sevenDayPace(), unseenQuestions:Math.max(0,statsQuestions.length-new Set(statsAttempts.map(a=>a.question_id)).size), projectedDays:null };
    const coverageTopics = enrichCoverageTopics(coverage.topics);
    const availableTts = availableTtsCount(coverageTopics);
    const sortedTopics = W3Tools.sortTopics ? W3Tools.sortTopics(coverageTopics, topicSort) : coverageTopics;
    const specialtyGroups = buildSpecialtyCoverageGroups(coverageTopics);
    const normalizedCoverageView = coverageView === 'specialties' ? 'specialties' : 'topics';
    const byArea = new Map();
    for (const q of statsQuestions) {
      const area = q.canonical_area || q.area || 'Sin área';
      if (!byArea.has(area)) byArea.set(area, { questions:0, attempts:0, correct:0 });
      byArea.get(area).questions++;
    }
    for (const a of statsAttempts) {
      const q = questions.find(x => x.id === a.question_id); if (!q) continue;
      const area = q.canonical_area || q.area || 'Sin área';
      const g = byArea.get(area); g.attempts++; if (a.is_correct) g.correct++;
    }
    const hard = statsQuestions.map(q => ({ q, s:questionStats(q.id) })).filter(x => x.s.seen).sort((a,b) => (b.s.wrong/b.s.seen)-(a.s.wrong/a.s.seen)).slice(0,10);
    const s = overallStats();
    const overdueCount = statsMemory.filter(row => row.due_at && new Date(row.due_at) <= new Date()).length;

    app.innerHTML = `<main class="shell">${topbar('Mi estado', true)}
      <section class="panel stats-report-link"><div><h2>Informe dinámico de debilidades</h2><p class="muted">Separa cobertura, debilidad y rentabilidad. La cobertura se calcula localmente con el corpus y los intentos ya cargados.</p></div><div class="stats-link-actions"><button id="stats-weakness-report" class="btn primary">Ver informe</button><button id="stats-history" class="btn">🕘 Historial y ritmo</button></div></section>

      <section class="kpis coverage-kpis">
        <div class="kpi"><div class="value">${coverage.seenQuestions}/${coverage.totalQuestions}</div><div class="label">Preguntas del corpus vistas ≥1 vez</div><small>La cobertura taxonómica incluye las ${coverage.totalQuestions} preguntas; ${questions.length-statsQuestions.length} observadas se excluyen solo de métricas adaptativas de precisión/debilidad.</small></div>
        <div class="kpi"><div class="value">${coverage.correctEverQuestions}/${coverage.totalQuestions}</div><div class="label">Acertadas ≥1 vez</div></div>
        <div class="kpi"><div class="value">${coverage.touchedTopics}/${coverage.totalTopics}</div><div class="label">Temas tocados</div></div>
        <div class="kpi"><div class="value">${coverage.completeTopics}/${coverage.totalTopics}</div><div class="label">Temas con cobertura completa</div></div>
      </section>

      <section class="panel compact-time-panel"><div class="section-head"><div><h2>Ritmo útil</h2><p class="muted">Panel reducido para apoyar el banqueo, no para sustituir las proyecciones de Anki.</p></div></div><div class="compact-time-grid"><div><strong>${timeSummary.todayQuestions}</strong><span>preguntas hoy</span></div><div><strong>${formatHoursMinutes(timeSummary.activeMsToday)}</strong><span>tiempo activo hoy</span></div><div><strong>${timeSummary.pacePerDay.toFixed(1)}/día</strong><span>ritmo de 7 días</span></div><div><strong>${timeSummary.unseenQuestions}</strong><span>por ver</span></div><div><strong>${timeSummary.projectedDays == null ? '—' : `${timeSummary.projectedDays} días`}</strong><span>primera vuelta al ritmo actual</span></div><div><strong>${overdueCount}</strong><span>repasos vencidos</span></div></div></section>

      <section class="kpis secondary-stats-kpis"><div class="kpi"><div class="value">${attempts.length}</div><div class="label">Intentos</div></div><div class="kpi"><div class="value">${pct(s.correct,attempts.length)}</div><div class="label">Precisión oficial</div></div><div class="kpi"><div class="value">${pct(s.auditedCorrect,s.audited.length)}</div><div class="label">Dominio auditado</div></div><div class="kpi"><div class="value">${s.avg?`${(s.avg/1000).toFixed(1)} s`:'—'}</div><div class="label">Tiempo medio</div></div></section>

      <section class="stats-grid"><div class="panel"><h2>Por área</h2><div class="table-wrap"><table><thead><tr><th>Área</th><th class="num">Preg.</th><th class="num">Intentos</th><th class="num">Acierto</th></tr></thead><tbody>${[...byArea.entries()].sort().map(([area,g])=>`<tr><td>${esc(area)}</td><td class="num">${g.questions}</td><td class="num">${g.attempts}</td><td class="num">${pct(g.correct,g.attempts)}</td></tr>`).join('')}</tbody></table></div></div><div class="panel"><h2>Más difíciles</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Tema</th><th class="num">Fallos</th><th class="num">Vistas</th></tr></thead><tbody>${hard.map(({q,s})=>`<tr><td>${esc(q.id)}</td><td>${esc(q.rentability_topic_label || q.topic)}</td><td class="num">${s.wrong}</td><td class="num">${s.seen}</td></tr>`).join('')}</tbody></table></div></div></section>

      <section class="panel topic-coverage-panel"><div class="section-head topic-coverage-head"><div><h2>Cobertura canónica</h2><p class="muted">Este bloque queda al final de Mi estado. Puedes ver los ${coverage.totalTopics} temas activos individualmente o agruparlos por especialidad. La disponibilidad TTS se carga una sola vez desde Supabase y usa el respaldo local si no hay conexión.</p><small class="tts-catalog-meta">Catálogo ${esc(ttsCatalog.catalogVersion || '—')} · ${availableTts} TTS disponibles · fuente ${ttsCatalogSource === 'supabase' ? 'Supabase' : 'respaldo local'}${ttsCatalogLoadError ? ' · sincronización remota no disponible' : ''}</small></div><div class="topic-coverage-controls"><label>Vista<select id="topic-coverage-view" class="input"><option value="topics" ${normalizedCoverageView==='topics'?'selected':''}>Temas individuales</option><option value="specialties" ${normalizedCoverageView==='specialties'?'selected':''}>Agrupado por especialidad</option></select></label>${normalizedCoverageView==='topics'?`<label>Orden<select id="topic-coverage-sort" class="input"><option value="rentability" ${topicSort==='rentability'?'selected':''}>Rentabilidad</option><option value="coverage" ${topicSort==='coverage'?'selected':''}>Menor cobertura</option><option value="weakness" ${topicSort==='weakness'?'selected':''}>Mayor debilidad</option><option value="alphabetical" ${topicSort==='alphabetical'?'selected':''}>Alfabético</option></select></label>`:''}</div></div>
        ${normalizedCoverageView==='specialties' ? specialtyCoverageMarkup(specialtyGroups) : topicCoverageTableMarkup(sortedTopics)}
      </section>
    </main>`;

    attachTopbar();
    document.getElementById('stats-weakness-report').onclick = renderWeaknessReport;
    document.getElementById('stats-history').onclick = () => renderHistory();
    const coverageSortNode = document.getElementById('topic-coverage-sort');
    if (coverageSortNode) coverageSortNode.onchange = ev => renderStats(ev.target.value, normalizedCoverageView);
    document.getElementById('topic-coverage-view').onchange = ev => renderStats(topicSort, ev.target.value);
    document.querySelectorAll('[data-topic-coverage-key]').forEach(row => {
      const open = () => renderTopicCoverageDetail(row.dataset.topicCoverageKey, topicSort, normalizedCoverageView);
      row.onclick = open;
      row.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } };
    });
    document.querySelectorAll('[data-topic-tts-key]').forEach(button => {
      button.onclick = ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const topic = coverageTopics.find(item => item.key === button.dataset.topicTtsKey);
        if (topic) copyCoverageTtsRequest(topic, button);
      };
      button.onkeydown = ev => ev.stopPropagation();
    });
  }

  init();
})();
