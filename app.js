(() => {
  const app = document.getElementById('app');
  const cfg = window.APP_CONFIG || {};
  const APP_VERSION = window.RESIDENTADO_BUILD?.version || '1.1.1';
  const cloudConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  const DEMO_KEY = 'residentado_piloto_attempts_v3';
  const DEMO_SESSIONS_KEY = 'residentado_piloto_sessions_v2';
  const DEMO_MEMORY_KEY = 'residentado_memory_state_v1';
  const DEMO_PROFILE_KEY = 'residentado_learning_profile_v1';
  const DEMO_REVIEW_FLAGS_KEY = 'residentado_question_review_flags_v1';

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

  const SessionCore = window.ResidentadoSessionCore || {};
  const QuestionParser = window.ResidentadoQuestionParser || {};
  const W3Tools = window.ResidentadoW3Tools || {};
  const W4Data = window.ResidentadoW4Data || {};
  let ttsCatalog = { catalogVersion:'unloaded', topics:[] };
  let ttsCatalogByTopic = new Map();
  let datasetManifest = null;
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

  function sessionStateFingerprint(state = {}) {
    return SessionCore.sessionStateFingerprint
      ? SessionCore.sessionStateFingerprint(state)
      : JSON.stringify(normalizeSessionState(state));
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
    return {
      ...sourceRow,
      id:makeUuid(),
      title:`${String(sourceRow.title || 'Sesión').replace(/ · recuperación local$/i, '')} · recuperación local`,
      config:{
        ...(sourceRow.config || {}),
        recovery:{
          rootSessionId:previousRecovery.rootSessionId || previousRecovery.sourceSessionId || sourceId,
          sourceSessionId:sourceId,
          reason,
          createdAt:now,
          sourceRevision:Number(sourceRow.state_revision || 0),
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

  async function persistRecoverySession(sourceRow, reason = 'revision_conflict') {
    if (!sourceRow?.id) return null;
    const existingId = recoveryCreatedForSession.get(sourceRow.id);
    if (existingId) return sessionStore?.getSession ? sessionStore.getSession(existingId) : activeSessions.find(row => row.id === existingId);

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
      if (stateDiffers && (local.syncStatus === 'conflict' || (riskyStatus && localRevision < remoteRevision))) {
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

  async function processSessionOutbox() {
    if (!cloudConfigured || !user || !sessionStore || !navigator.onLine) return { processed:0, remaining:0 };
    const rows = (await sessionStore.listOutbox()).slice().sort((a,b) => Number(a.id || 0) - Number(b.id || 0));
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
            if (local) await persistRecoverySession(local, 'outbox_revision_conflict');
            const { data:remote } = await supa.from('practice_sessions').select('*').eq('id', p.sessionId).maybeSingle();
            if (remote) await saveSessionShadow({ ...remote, syncStatus:'synced' }, 'synced');
            ok = true;
          }
        } else if (item.type === 'INSERT_ATTEMPT') {
          const payload = { ...item.payload, user_id:user.id };
          const { data, error } = await supa.from('attempts')
            .upsert(payload, { onConflict:'user_id,client_attempt_id' })
            .select()
            .single();
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
          const { data, error } = await request.select().maybeSingle();
          if (!error && data) {
            await saveSessionShadow({ ...data, syncStatus:'synced' }, 'synced');
            ok = true;
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
      if (restartRequested) break;
    }
    const remaining = (await sessionStore.listOutbox()).length;
    if (restartRequested && remaining) {
      const next = await processSessionOutbox();
      return { processed:processed + next.processed, remaining:next.remaining };
    }
    return { processed, remaining };
  }

  function updateHolderFromSavedRow(owner, savedRow) {
    if (!owner || !savedRow) return;
    owner.holder.row = savedRow;
    if (owner.kind === 'exam') owner.holder.state = normalizeSessionState(savedRow.state || owner.holder.state);
  }

  async function handleSessionRevisionConflict(owner, row, error) {
    // FIX-SESSION-002/003/004: stop stale writes, preserve local progress, and continue on a new revision-safe session.
    sessionSyncBlocked.add(row.id);
    const conflicted = { ...row, syncStatus:'conflict', syncError:error?.message || 'SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE' };
    await saveSessionShadow(conflicted, 'conflict');
    const recovery = await persistRecoverySession(conflicted, 'revision_conflict');

    const { data:remote } = await supa.from('practice_sessions').select('*').eq('id', row.id).maybeSingle();
    if (remote) await saveSessionShadow({ ...remote, syncStatus:'synced' }, 'synced');

    if (owner && recovery) {
      releaseActiveSessionLease();
      updateHolderFromSavedRow(owner, recovery);
      claimSessionLease(recovery.id);
      sessionSyncBlocked.delete(recovery.id);
    }

    if (!conflictNoticeShown.has(row.id)) {
      conflictNoticeShown.add(row.id);
      alert(recovery
        ? 'Se detectó una revisión distinta de esta sesión. Tu progreso local se conservó en una copia de recuperación y continuarás allí sin sobrescribir la otra copia.'
        : 'Se detectó una revisión distinta. El progreso local quedó conservado, pero la sincronización de esta sesión fue detenida para evitar una sobrescritura.');
    }
    return recovery || conflicted;
  }

  async function syncSessionOwner(owner) {
    if (!owner?.row?.id) return owner?.row || null;
    const state = normalizeSessionState(owner.kind === 'study' ? studyStateSnapshot() : owner.holder.state);
    const now = sessionNowIso();
    const answeredCount = answeredIdsFor(owner.row, state).length;
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
    owner.holder.row = row;
    await saveSessionShadow(row, cloudConfigured ? (row.syncStatus || 'pending') : 'local');
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
    await saveSessionShadow(synced, 'synced');
    return synced;
  }

  function scheduleCurrentSessionSave({ immediate = false } = {}) {
    const owner = currentSessionOwner();
    if (!owner) return Promise.resolve(null);
    clearTimeout(sessionSaveTimer);
    const run = () => {
      sessionSaveChain = sessionSaveChain
        .catch(() => null)
        .then(() => syncSessionOwner(currentSessionOwner() || owner));
      return sessionSaveChain;
    };
    if (immediate) return run();
    // OPT-SAVE-001: consolidar rafagas de respuesta/navegacion en un unico guardado.
    sessionSaveTimer = setTimeout(run, 1000);
    return Promise.resolve(owner.row);
  }

  async function flushCurrentSessionSave() {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
    const owner = currentSessionOwner();
    if (!owner) return null;
    sessionSaveChain = sessionSaveChain.catch(() => null).then(() => syncSessionOwner(currentSessionOwner() || owner));
    return sessionSaveChain;
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
    ['Toxicidad o reacción adversa', /\b(?:toxicidad|t[oó]xico|advers[ao]|nefrotoxic|ototoxic|hepatotoxic|prolonga el qt|hiperpotasemia|hipopotasemia)\b/i],
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

  function referenceQuickHtml(q = {}) {
    const comparison = cleanEditorialText(q.comparison_framework);
    const abbreviations = cleanEditorialText(q.abbreviations);
    const sections = [];

    if (comparison) {
      if (pharmacologyRelevant(q)) {
        const structured = pharmacologyFrameworkHtml(comparison);
        if (structured) sections.push(`<div class="reference-section pharmacology-section"><h4>💊 Fármacos y antibióticos</h4>${structured}</div>`);
      } else {
        sections.push(`<div class="reference-section"><h4>📊 ${esc(cleanEditorialText(q.comparison_title) || 'Comparación y criterios')}</h4>${frameworkHtml(comparison)}</div>`);
      }
    }
    if (abbreviations) {
      sections.push(`<div class="reference-section"><h4>🔤 Siglas, epónimos y términos</h4><p>${esc(abbreviations)}</p></div>`);
    }
    if (!sections.length) return '';
    return `<details class="explain-block quick-reference"><summary><strong>📚 Referencia rápida</strong><span>criterios, escalas, valores, dosis y comparaciones</span></summary><div class="quick-reference-body">${sections.join('')}</div></details>`;
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
    // v0.6.16: usa la taxonomía global V2 cuando está disponible y conserva
    // compatibilidad automática con la estructura histórica.
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
      taxonomy_runtime_source: q?.rentability_topic_label ? 'GLOBAL_V2' : 'LEGACY_FALLBACK',
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
    const { area, specialty, topic } = topicPathParts(q);
    return encodeURIComponent([area, specialty, topic].join('\u001f'));
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

  const REVIEW_FLAG_TYPES = {
    statement: { label:'Revisar enunciado', icon:'📝' },
    explanation: { label:'Revisar explicación', icon:'💬' },
    general: { label:'Revisar', icon:'⚑' },
  };

  function reviewFlagMeta(type) {
    return REVIEW_FLAG_TYPES[type] || REVIEW_FLAG_TYPES.general;
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

  async function saveQuestionReviewFlag(questionId, flagType, userNote = '') {
    if (!REVIEW_FLAG_TYPES[flagType]) return null;
    const now = new Date().toISOString();
    const note = String(userNote ?? '').replace(/\r/g, '').trim().slice(0, 2000) || null;
    const previous = reviewFlagFor(questionId);
    const previousClosed = latestClosedFlagFor(questionId);
    let row = null;

    if (cloudConfigured) {
      if (previous) {
        const { data, error } = await supa.from('question_review_flags')
          .update({ flag_type:flagType, user_note:note, client_app_version:APP_VERSION, status:'OPEN', updated_at:now })
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
        client_app_version:APP_VERSION,
        status:'OPEN',
        updated_at:now,
      } : {
        id: makeUuid(),
        user_id: 'demo',
        question_id: questionId,
        flag_type: flagType,
        user_note:note,
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
      <p>Selecciona el tipo y describe, si lo deseas, qué debe revisarse. La nota no modifica tu respuesta ni tu memoria.</p>
      <div class="review-flag-choice-grid" role="radiogroup" aria-label="Tipo de observación">
        <button class="review-flag-choice ${selectedType==='statement'?'selected':''}" type="button" data-set-review-flag="statement" role="radio" aria-checked="${selectedType==='statement'}"><strong>📝 Revisar enunciado</strong><span>Redacción, datos clínicos, alternativas o ambigüedad.</span></button>
        <button class="review-flag-choice ${selectedType==='explanation'?'selected':''}" type="button" data-set-review-flag="explanation" role="radio" aria-checked="${selectedType==='explanation'}"><strong>💬 Revisar explicación</strong><span>Explicación insuficiente, confusa, desactualizada o tautológica.</span></button>
        <button class="review-flag-choice ${selectedType==='general'?'selected':''}" type="button" data-set-review-flag="general" role="radio" aria-checked="${selectedType==='general'}"><strong>⚑ Revisar</strong><span>Observación general o motivo todavía no definido.</span></button>
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
    modal.querySelector('#review-flag-form').onsubmit = async ev => {
      ev.preventDefault();
      const errorNode = modal.querySelector('#review-flag-save-error');
      const note = modal.querySelector('#review-flag-note').value;
      errorNode.textContent = 'Guardando…';
      modal.querySelectorAll('button, textarea').forEach(node => node.disabled = true);
      const saved = await saveQuestionReviewFlag(questionId, selectedType, note);
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

  function targetRetention(date = isoDateLocal()) {
    const phase = currentPhase(date);
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

    const retention = targetRetention(isoDateLocal(now));
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

  async function reconcileMemoryFromAttempts() {
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
      const existing = memoryByQuestion.get(qid);
      const latest = list[list.length-1];
      if (existing?.last_attempt_at && new Date(existing.last_attempt_at) >= new Date(latest.answered_at)) continue;
      let state = null;
      for (const a of list) {
        const normalized = {
          ...a,
          memory_rating: a.memory_rating || memoryRating(q, a.response_time_ms, a.is_correct, a.timed_out, a.target_seconds),
          speed_bucket: a.speed_bucket || speedBucket(q, a.response_time_ms, a.is_correct, a.timed_out, a.target_seconds),
        };
        state = evolveMemory(state, normalized, q);
      }
      if (state) rebuilt.push(state);
    }
    await upsertMemoryRows(rebuilt);
  }

  async function loadStaticTtsCatalog() {
    try {
      const response = await fetch('./tts_catalog.json', { cache:'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      ttsCatalog = W4Data.normalizeCatalog ? W4Data.normalizeCatalog(raw) : raw;
      ttsCatalogByTopic = W4Data.catalogMap
        ? W4Data.catalogMap(ttsCatalog)
        : new Map((ttsCatalog.topics || []).map(item => [item.topicId, item]));
    } catch (error) {
      console.warn('TTS catalog unavailable.', error);
      ttsCatalog = { catalogVersion:'unavailable', topics:[] };
      ttsCatalogByTopic = new Map();
    }
  }

  async function fetchDatasetManifest() {
    const { data, error } = await supa.from('app_dataset_versions')
      .select('*')
      .eq('dataset_key', 'questions')
      .maybeSingle();
    if (error) return { data:null, error };
    return { data:data || null, error:null };
  }

  async function loadCorpusWithCache() {
    const cached = sessionStore?.getCachedCorpus ? await sessionStore.getCachedCorpus() : null;
    const manifestRes = await fetchDatasetManifest();
    const remoteManifest = manifestRes.data;
    datasetManifest = remoteManifest || cached?.manifest || null;
    const cachedQuestions = cached?.questions || [];
    const cachedValid = cachedQuestions.length > 0 && (
      remoteManifest
        ? (W4Data.manifestMatches ? W4Data.manifestMatches(cached?.manifest || { dataset_revision:cached?.revision }, remoteManifest, cachedQuestions.length) : cached?.revision === remoteManifest.dataset_revision)
        : cachedQuestions.length === Number(cached?.manifest?.row_count || cachedQuestions.length)
    );

    if (cachedValid) return { data:cachedQuestions, source:'indexeddb', manifest:datasetManifest, error:null };

    const remote = await fetchAllQuestions();
    if (remote.error) {
      if (cachedQuestions.length) return { data:cachedQuestions, source:'indexeddb-stale', manifest:datasetManifest, error:null };
      return { data:null, source:'none', manifest:datasetManifest, error:remote.error };
    }

    const normalized = normalizeQuestionCorpus(remote.data || []);
    const topics = W4Data.topicsFromQuestions ? W4Data.topicsFromQuestions(normalized) : [];
    const manifest = remoteManifest || {
      dataset_key:'questions',
      dataset_revision:`fallback-${normalized.length}-${new Date().toISOString().slice(0,10)}`,
      row_count:normalized.length,
      metadata:{ taxonomy_version:'unknown', source:'client-fallback' },
      updated_at:new Date().toISOString(),
    };
    if (sessionStore?.replaceCorpus) await sessionStore.replaceCorpus(normalized, topics, manifest);
    datasetManifest = manifest;
    return { data:normalized, source:'supabase', manifest, error:null };
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
      rebuildMemoryMap();
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

  async function loadCloudData() {
    clearTimer();
    app.innerHTML = `<div class="splash"><div class="logo-mark">R</div><p>Sincronizando cambios…</p></div>`;

    const [qRes, aRes, pRes, mRes, fRes] = await Promise.all([
      loadCorpusWithCache(),
      loadAttemptsIncremental(),
      supa.from('user_learning_profile').select('*').eq('user_id', user.id).maybeSingle(),
      loadMemoryIncremental(),
      loadFlagsIncremental(),
    ]);

    if (qRes.error) { renderLogin(`Error al cargar preguntas: ${qRes.error.message}`); return; }
    if (aRes.error) { renderLogin(`Error al cargar progreso: ${aRes.error.message}`); return; }
    if (pRes.error) { renderFatal(`Falta aplicar la migración v0.5 en Supabase: ${pRes.error.message}`); return; }
    if (mRes.error) { renderFatal(`No se pudo sincronizar la memoria: ${mRes.error.message}`); return; }
    if (fRes.error) { renderFatal(`No se pudieron sincronizar las observaciones: ${fRes.error.message}`); return; }

    questions = normalizeQuestionCorpus(qRes.data || []);
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
    const localSessionRows = sessionStore?.getSessionsForUser
      ? await sessionStore.getSessionsForUser(user.id)
      : (sessionStore ? await sessionStore.getAllSessions() : []);
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
    const qa = attemptsForQuestion(q.id);
    const positive = qa.map(a => Number(a.response_time_ms || 0)).filter(v => v > 0);
    const correct = qa.filter(a => a.is_correct).length;
    const wrong = qa.length - correct;
    const avgMs = positive.length ? positive.reduce((s,v)=>s+v,0)/positive.length : null;
    const targetMs = effectiveTargetSeconds(q) * 1000;
    const fluent = qa.filter(a => a.is_correct && Number(a.response_time_ms || 0) <= Number(a.target_seconds || targetMs / 1000) * 1000).length;
    return { seen:qa.length, correct, wrong, avgMs, fluent };
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
    const retention = targetRetention(isoDateLocal(now));
    const duePressure = state
      ? Math.max(0, retention - recall) * 8 + Math.max(0, (now - new Date(state.due_at)) / 86400000) * 0.35
      : 2.2;
    const weakness = s.seen ? (s.wrong / s.seen) * 3.2 : 1.4;
    const targetSeconds = effectiveTargetSeconds(q);
    const speed = s.avgMs ? Math.max(0, (s.avgMs / 1000 - targetSeconds) / 15) : 0.8;
    const rent = rentabilityWeight(q) * 2.6;
    const unseen = s.seen ? 0 : 1.2;
    const wrongFast = qAttempts.some(a => a.speed_bucket === 'wrong_fast') ? 1.2 : 0;
    const uncertainty = latestAttempt?.was_uncertain
      ? (latestAttempt.is_correct ? 1.4 : 2.6)
      : 0;
    const wrongUncertainBoost = latestAttempt?.was_uncertain && !latestAttempt?.is_correct ? 1.4 : 0;
    const observedPenalty = observed(q) ? -2.5 : 0;
    return duePressure + weakness + speed + rent + unseen + wrongFast + uncertainty + wrongUncertainBoost + observedPenalty;
  }

  function smartPool(kind = 'priority') {
    const now = new Date();
    const nonObserved = questions.filter(q => !observed(q));
    if (kind === 'due') {
      const due = nonObserved.filter(q => {
        const st = memoryByQuestion.get(q.id);
        return st && new Date(st.due_at) <= now;
      });
      // Solo mezcla años entre repasos ya vencidos y de prioridad muy parecida:
      // nunca introduce preguntas no vencidas para "diversificar".
      return sortByPriority(due, now, { diversifyYears:true, tolerance:0.35 });
    }
    if (kind === 'new') {
      const unseen = nonObserved.filter(q => !attempts.some(a => a.question_id === q.id));
      return sortByPriority(unseen, now, { diversifyYears:true, tolerance:0.75 });
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
      return nonObserved.filter(q => {
        const s = extendedQuestionStats(q);
        return s.seen && (s.avgMs || 0) > effectiveTargetSeconds(q) * 1000;
      }).sort((a,b) => (extendedQuestionStats(b).avgMs||0) - (extendedQuestionStats(a).avgMs||0));
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
        ttsStatusLabel: W4Data.catalogStatusLabel ? W4Data.catalogStatusLabel(tts) : (tts?.status || 'Pendiente'),
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

  function cumulativeDebt(todayIso = isoDateLocal()) {
    const start = profile?.plan_start_date || DEFAULT_PROFILE.plan_start_date;
    const yesterday = new Date(parseLocalDate(todayIso).getTime() - 86400000);
    const endIso = isoDateLocal(yesterday);
    if (endIso < start) return 0;
    let expected = 0;
    for (let d = parseLocalDate(start); d <= parseLocalDate(endIso); d = new Date(d.getTime()+86400000)) expected += currentPhase(isoDateLocal(d)).target;
    const actual = attempts.filter(a => {
      const ad = isoDateLocal(a.answered_at);
      return ad >= start && ad <= endIso;
    }).length;
    return Math.max(0, expected - actual);
  }

  function buildTodayPlan() {
    const today = isoDateLocal();
    const phase = currentPhase(today);
    const debt = cumulativeDebt(today);
    const recovery = Math.min(60, Math.ceil(debt / 4));
    const done = dailyActual(today);
    let specs;
    if (phase.key === 'expansion') specs = [['due',35,'🧠 Repasos prioritarios'],['priority',35,'🎯 Alta prioridad personal'],['new',90,'📚 Preguntas nuevas'],['speed',20,'⚡ Velocidad ≤25 s']];
    else if (phase.key === 'travel_review') specs = [['due',45,'🧠 Repasos vencidos'],['errors',35,'❌ Errores y conceptos frágiles'],['speed',20,'⚡ Velocidad'],['new',20,'📚 Nuevas si queda capacidad']];
    else if (phase.key === 'max_expansion') specs = [['due',45,'🧠 Repasos'],['priority',45,'🎯 Alta prioridad'],['new',110,'📚 Preguntas nuevas'],['speed',20,'⚡ Velocidad']];
    else if (phase.key === 'travel_maintenance') specs = [['due',40,'🧠 Repasos que no pueden esperar'],['priority',30,'🎯 Alta prioridad'],['speed',20,'⚡ Velocidad'],['new',10,'📚 Nuevas opcionales']];
    else if (phase.key === 'close_gaps') specs = [['due',50,'🧠 Repasos'],['priority',80,'🔥 Cierre de brechas'],['speed',30,'⚡ Automatización'],['high',60,'🎯 Temas rentables']];
    else if (phase.key === 'preexam') specs = [['due',50,'🧠 Mantener memoria'],['priority',40,'🔥 Debilidades críticas'],['speed',30,'⚡ Velocidad'],['mixed',40,'📝 Bloque mixto tipo examen']];
    else specs = [];
    if (recovery && specs.length) specs[1][1] += recovery;

    const pilotLimited = questions.length < 200;
    const tasks = specs.map(([kind,plannedCount,label], idx) => {
      const mode = `auto_${kind}`;
      const completed = attempts.filter(a => isoDateLocal(a.answered_at) === today && a.study_mode === mode).length;
      const poolKind = kind === 'mixed' ? 'priority' : kind;
      const available = smartPool(poolKind).length;
      const count = pilotLimited ? Math.min(plannedCount, completed + available) : plannedCount;
      return { id:`task_${idx}`, kind, mode, label, count, completed:Math.min(completed,count), remaining:Math.max(0,count-completed) };
    }).filter(t => t.count > 0);
    const adjustedTarget = pilotLimited ? tasks.reduce((sum,t)=>sum+t.count,0) : phase.target + recovery;
    const next = tasks.find(t => t.remaining > 0) || null;
    return { today, phase, debt, recovery, done, adjustedTarget, tasks, next };
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
    const recent = attempts.filter(a => {
      const q = questions.find(x=>x.id===a.question_id); return q && !observed(q);
    }).slice(-100);
    const acc = recent.length ? recent.filter(a=>a.is_correct).length/recent.length : 0;
    const speed = recent.length ? recent.filter(a=>a.is_correct && Number(a.response_time_ms||0) <= Number(profile?.target_response_seconds||25)*1000).length/recent.length : 0;
    const coverage = questions.length ? new Set(attempts.map(a=>a.question_id)).size/questions.length : 0;
    const relevantStates = memoryStates.filter(s => questions.some(q=>q.id===s.question_id && !observed(q)));
    const overdue = relevantStates.filter(s=>new Date(s.due_at)<=new Date()).length;
    const reviewControl = relevantStates.length ? 1-overdue/relevantStates.length : 0;
    const value = Math.round(100*(0.40*acc + 0.25*speed + 0.20*coverage + 0.15*reviewControl));
    return { value, acc, speed, coverage, reviewControl, recentN:recent.length };
  }

  function sevenDayPace() {
    const today = parseLocalDate(isoDateLocal());
    const start = new Date(today.getTime()-6*86400000);
    const count = attempts.filter(a => new Date(a.answered_at) >= start).length;
    return count/7;
  }

  function pressureStatus(plan) {
    if (!plan.adjustedTarget) return { cls:'ok', label:'DÍA DEL EXAMEN' };
    const hour = new Date().getHours() + new Date().getMinutes()/60;
    const expectedFraction = clamp((hour-8)/14, 0.05, 1);
    const expectedNow = plan.adjustedTarget * expectedFraction;
    if (plan.done >= plan.adjustedTarget) return { cls:'ok', label:'META CUMPLIDA' };
    if (plan.debt > plan.phase.target*1.5 || plan.done < expectedNow*0.65) return { cls:'bad', label:'PLAN EN RIESGO' };
    return { cls:'warn', label:'EN RUTA, PERO EXIGENTE' };
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

  function activeSessionForTask(task) {
    if (!task?.mode) return null;
    return latestActiveSession(activeSessions.filter(row => row?.mode === 'study' && row?.config?.studyMode === task.mode));
  }

  function similarActiveSessionCount(row) {
    const key = activeSessionModeKey(row);
    return activeSessions.filter(item => activeSessionModeKey(item) === key).length;
  }

  function launchAutoTask(task) {
    if (!task) return renderMessage('Plan de hoy', 'La checklist principal está completa. Puedes adelantar trabajo desde Practicar.');
    const poolKind = task.kind === 'mixed' ? 'priority' : task.kind;
    let pool = smartPool(poolKind);
    if (!pool.length) pool = smartPool('priority');
    const count = Math.min(task.remaining, pool.length);
    if (!count) return renderMessage('Sin preguntas disponibles', 'El piloto actual no tiene suficientes preguntas para esta tarea. El motor funcionará con el banco completo.');
    const selected = pool.slice(0, count);
    const feedback = task.kind === 'mixed' ? 'end' : 'immediate';
    launchStudy(selected, {
      mode:'study', count:selected.length, randomize:false, feedback,
      timeMode: task.kind === 'speed' ? 'per_question' : 'none',
      secondsPerQuestion:Number(profile?.target_response_seconds||25), totalSeconds:0,
      title:task.label, studyMode:task.mode,
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
      if (a.length >= expected) {
        catalog.push({ year, kind:'single', test:'A', count:expected, questions:a.slice(0,expected), title:`${year} · Prueba A` });
      }
      if (b.length >= expected) {
        catalog.push({ year, kind:'single', test:'B', count:expected, questions:b.slice(0,expected), title:`${year} · Prueba B` });
      }
      if (a.length >= expected && b.length >= expected) {
        catalog.push({
          year, kind:'combined', test:'A+B', count:expected*2,
          questions:[...a.slice(0,expected), ...b.slice(0,expected)],
          title:`${year} · Maratón A+B`,
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
                  <small>${item.kind==='combined' ? 'A seguida de B · entrenamiento de resistencia' : 'Reproducción de esa prueba histórica'}</small>
                </button>`).join('')}
            </div>
          </div>`).join('')
      : `<div class="empty"><p>Aún no hay un examen histórico completo cargado.</p><p class="muted">Cuando una prueba tenga todas sus preguntas en la base, aparecerá aquí automáticamente.</p></div>`;

    app.innerHTML = `<main class="shell">${topbar('Simulacros', true)}
      <section class="panel">
        <div class="builder-head">
          <div><h2>🗂 Simulacro histórico realista</h2><p class="muted">Cuadernillo completo en orden original y hoja de respuestas independiente. No verás claves ni explicaciones hasta entregar.</p></div>
        </div>
        ${historicalHtml}
      </section>
      <section class="panel" style="margin-top:14px">
        <h2>🧪 Simulacro personalizado</h2>
        <p class="muted">La app construye una prueba aleatoria según número de preguntas, filtros, tiempo y descanso.</p>
        <button id="custom-exam-builder" class="btn primary">Crear simulacro personalizado</button>
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
    document.getElementById('custom-exam-builder').onclick = () => renderSessionBuilder('exam');
  }

  function launchHistoricalExam(item) {
    const secondsPerQuestion = 54; // Preset de entrenamiento: 3 h para 200 preguntas.
    const totalSeconds = item.count * secondsPerQuestion;
    const firstBlockCount = item.kind === 'combined'
      ? item.questions.filter(q => String(q.test).toUpperCase() === 'A').length
      : 0;

    launchExam(item.questions, {
      mode:'exam',
      title:`Histórico realista · ${item.title}`,
      count:item.count,
      randomize:false,
      feedback:'end',
      timeMode:'total',
      totalSeconds,
      secondsPerQuestion:0,
      breakAfter:firstBlockCount,
      pauseDuringBreak:true,
      studyMode:'historical_exam',
      examLayout:'paper',
      historicalYear:item.year,
      historicalTest:item.test,
      historicalKind:item.kind,
      shuffleOptions:false,
    });
  }

  function historicalDisplayNumber(q, index) {
    const combined = currentExam?.config?.historicalKind === 'combined';
    return combined ? `${String(q.test).toUpperCase()}-${q.question_number}` : String(q.question_number);
  }


  function scratchOptionState(qId, letter) {
    return currentExam?.state?.scratch?.[qId]?.[letter] || 'neutral';
  }

  function scratchStateLabel(state) {
    if (state === 'tentative') return 'Tentativa';
    if (state === 'crossed') return 'Tachada';
    return 'Sin marca';
  }

  function cycleScratchState(qId, letter) {
    currentExam.state.scratch ||= {};
    currentExam.state.scratch[qId] ||= {};
    const current = currentExam.state.scratch[qId][letter] || 'neutral';
    const next = current === 'neutral' ? 'tentative' : current === 'tentative' ? 'crossed' : 'neutral';
    if (next === 'neutral') delete currentExam.state.scratch[qId][letter];
    else currentExam.state.scratch[qId][letter] = next;
    if (!Object.keys(currentExam.state.scratch[qId]).length) delete currentExam.state.scratch[qId];
    return next;
  }

  function paperOptionHtml(q, index, o) {
    const state = scratchOptionState(q.id, o.letter);
    const icon = state === 'tentative' ? '?' : state === 'crossed' ? '×' : '';
    return `<button class="paper-option scratch-${state}"
      data-scratch-index="${index}" data-scratch-letter="${o.letter}"
      aria-label="${esc(historicalDisplayNumber(q,index))} ${o.letter}: ${scratchStateLabel(state)}">
      <span class="paper-option-letter">${o.letter}.</span>
      <span class="paper-option-text">${esc(o.text)}</span>
      <span class="paper-option-mark" aria-hidden="true">${icon}</span>
    </button>`;
  }

  function historicalPaperQuestionsHtml() {
    let lastTest = null;
    return currentExam.questions.map((q, index) => {
      const test = String(q.test || '').toUpperCase();
      let divider = '';
      if (currentExam.config.historicalKind === 'combined' && lastTest && test !== lastTest) {
        divider = `<div class="paper-section-divider">
          <div><strong>Fin de la Prueba ${esc(lastTest)}</strong><span>La siguiente sección continúa con la Prueba ${esc(test)}.</span></div>
          ${!currentExam.state.breakTaken ? `<button class="btn" id="paper-break-btn">Iniciar descanso</button>` : `<span class="tag ok">Descanso registrado</span>`}
        </div>`;
      }
      lastTest = test;
      const flagged = Boolean(currentExam.state.marked[q.id]);
      return `${divider}<article class="paper-question" id="paper-question-${index}">
        <div class="paper-question-head">
          <span class="paper-qnum">${esc(historicalDisplayNumber(q,index))}</span>
          <span class="muted">${esc(q.year)} · Prueba ${esc(test)}</span>
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
    return currentExam.questions.map((q, index) => {
      const test = String(q.test || '').toUpperCase();
      const heading = test !== lastTest
        ? `<div class="answer-sheet-section">Prueba ${esc(test)}</div>`
        : '';
      lastTest = test;
      const selected = sessionSelected(currentExam.state, q.id);
      const uncertain = Object.values(currentExam.state.scratch?.[q.id] || {}).includes('tentative');
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
    return currentExam.questions.filter(q => sessionSelected(currentExam.state, q.id) != null).length;
  }

  function refreshHistoricalAnswerSheet() {
    const count = historicalAnsweredCount();
    const countEl = document.getElementById('historical-answered-count');
    if (countEl) countEl.textContent = String(count);
    for (let i = 0; i < currentExam.questions.length; i++) {
      const q = currentExam.questions[i];
      const selected = sessionSelected(currentExam.state, q.id);
      const row = document.querySelector(`[data-answer-row="${i}"]`);
      const uncertain = Object.values(currentExam.state.scratch?.[q.id] || {}).includes('tentative');
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
    clearTimer();
    examQuestionEnteredAt = 0;
    const answered = historicalAnsweredCount();

    app.innerHTML = `<main class="historical-shell">
      ${topbar(currentExam.config.title || 'Simulacro histórico', false)}
      <section class="historical-toolbar panel">
        <div>
          <span class="tag">Modo histórico realista</span>
          <strong>${esc(currentExam.config.historicalYear)} · ${esc(currentExam.config.historicalTest)}</strong>
          <span><strong id="historical-answered-count">${answered}</strong>/${currentExam.questions.length} marcadas</span>
        </div>
        <div class="historical-toolbar-actions">
          <button id="jump-answer-sheet" class="btn small">📋 Hoja de respuestas</button>
          <button id="historical-session-exit" class="btn small ghost">Cerrar o continuar después</button>
          <div id="timer" class="timer">${formatTime(currentExam.state.remainingSeconds)}</div>
          <button id="historical-finish" class="btn danger small">Entregar</button>
        </div>
      </section>

      <section class="historical-layout">
        <div class="historical-paper panel">
          <div class="paper-cover">
            <span class="roadmap-kicker">CUADERNILLO</span>
            <h1>${esc(currentExam.config.title)}</h1>
            <p>Lee el cuadernillo y marca tu respuesta definitiva únicamente en la hoja lateral. En el cuadernillo puedes hacer anotaciones provisionales: toca una alternativa para alternar entre <strong>tentativa (?)</strong>, <strong>tachada (×)</strong> y <strong>sin marca</strong>.</p>
            <div class="scratch-legend"><span><b>?</b> tentativa</span><span><b>×</b> descartada</span><span>La hoja de respuestas es la que cuenta.</span></div>
          </div>
          ${historicalPaperQuestionsHtml()}
        </div>

        <aside class="answer-sheet panel" id="historical-answer-sheet">
          <div class="answer-sheet-header">
            <div><span class="roadmap-kicker">HOJA DE RESPUESTAS</span><h2>Marca cuando estés seguro</h2></div>
            <span class="tag">${answered}/${currentExam.questions.length}</span>
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
        if (mark) mark.textContent = next === 'tentative' ? '?' : next === 'crossed' ? '×' : '';
        btn.setAttribute('aria-label', `${historicalDisplayNumber(q,index)} ${letter}: ${scratchStateLabel(next)}`);
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

    const breakBtn = document.getElementById('paper-break-btn');
    if (breakBtn) {
      breakBtn.onclick = async () => {
        clearTimer();
        currentExam.state.breakTaken = true;
        currentExam.state.currentIndex = currentExam.config.breakAfter || 0;
        await persistExamState();
        renderBreakScreen();
      };
    }

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
    const daysReady = daysUntil(profile?.readiness_target_date || DEFAULT_PROFILE.readiness_target_date);
    const pace7 = sevenDayPace();
    const completion = plan.adjustedTarget ? Math.min(100, Math.round(plan.done/plan.adjustedTarget*100)) : 100;
    const primaryActiveSession = latestActiveSession();
    const primaryAnswered = primaryActiveSession ? (primaryActiveSession.answered_count || answeredIdsFor(primaryActiveSession, primaryActiveSession.state || {}).length) : 0;
    const primaryPlanned = primaryActiveSession ? (primaryActiveSession.planned_count || primaryActiveSession.question_ids?.length || 0) : 0;

    app.innerHTML = `<main class="shell">
      ${topbar()}
      ${!cloudConfigured ? `<div class="banner"><strong>Modo demo:</strong> el progreso se guarda solo en este navegador.</div>` : ''}
      ${questions.length < 200 ? `<div class="banner"><strong>Piloto de 20 preguntas:</strong> la carga diaria se escala temporalmente al contenido disponible. Las metas completas se activarán al importar el banco maestro.</div>` : ''}

      <section class="briefing panel">
        <div class="briefing-main"><span class="status-pill ${status.cls}">${status.label}</span><h2>Plan 75+/80 · ${esc(plan.phase.name)}</h2><p>${esc(plan.phase.objective)}</p><div class="briefing-dates"><span><strong>${Math.max(0,daysExam)}</strong> días al examen</span><span><strong>${Math.max(0,daysReady)}</strong> días a la meta de estar listo</span></div></div>
        <div class="goal compact-goal"><small>Preparación estimada*</small><div class="big">${ready.value}%</div><small>*indicador interno, no predicción de nota</small></div>
      </section>

      <section class="plan-progress panel">
        <div class="plan-progress-head"><div><strong>HOY</strong><div class="muted">${plan.done} de ${plan.adjustedTarget} preguntas objetivo${plan.recovery?` · incluye +${plan.recovery} de recuperación`:''}</div></div><div class="plan-percent">${completion}%</div></div>
        <div class="meter"><div style="width:${completion}%"></div></div>
        <div class="plan-meta"><span>Deuda acumulada: <strong>${plan.debt}</strong></span><span>Ritmo 7 días: <strong>${pace7.toFixed(0)}/día</strong></span><span>Repasos vencidos: <strong>${dueCount}</strong></span><span>Lentas: <strong>${slowCount}</strong></span></div>
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

  function renderSessionBuilder(mode) {
    clearTimer();
    const areas = [...new Set(questions.map(q => q.area).filter(Boolean))].sort(localeSort);
    const topicHierarchy = buildTopicHierarchy();
    const years = [...new Set(questions.map(q => Number(q.year)))].sort((a,b) => a-b);
    const highCount = questions.filter(isHighRentability).length;
    const isExam = mode === 'exam';

    app.innerHTML = `<main class="shell">
      ${topbar(isExam ? 'Crear simulacro' : 'Crear sesión', true)}
      <section class="panel builder">
        <div class="builder-head"><div><h2>${isExam ? 'Simulacro personalizado' : 'Sesión de práctica personalizada'}</h2><p class="muted">Filtra el contenido y define tamaño, tiempo y forma de corrección.</p></div></div>

        <div class="preset-row">
          ${isExam
            ? `<button class="btn small preset" data-preset="80">80 preguntas</button><button class="btn small preset" data-preset="200">200 · 3 h · descanso 100</button>`
            : `<button class="btn small preset" data-preset="10">10 rápidas</button><button class="btn small preset" data-preset="15">15 caminando</button><button class="btn small preset" data-preset="40">40 entrenamiento</button>`}
        </div>

        <form id="builder-form">
          <div class="builder-grid">
            <fieldset><legend>Contenido</legend>
              <label>Estado previo<select id="pool-type" class="input"><option value="all">Todas</option><option value="unseen">Nunca vistas</option><option value="errors">Solo errores</option><option value="correct">Ya acertadas</option></select></label>
              <label>Rentabilidad<select id="rentability" class="input"><option value="all">Todas</option><option value="high" ${highCount ? '' : 'disabled'}>Alta rentabilidad${highCount ? ` · ${highCount} preguntas` : ' — requiere al menos corpus suficiente y temas clasificados'}</option></select></label>
              <small class="muted">La rentabilidad usa el puntaje histórico auditado de la taxonomía global V2 cuando está disponible. Si la base aún no fue migrada, la app conserva temporalmente el cálculo automático por corpus. No depende de cuántas preguntas hayas respondido.</small>
            </fieldset>

            <fieldset><legend>Cantidad</legend>
              <label>Número de preguntas<input id="question-count" class="input" type="number" min="1" max="2000" value="${isExam ? 80 : 15}" required></label>
              <label class="inline-check"><input id="randomize" type="checkbox" checked> <span>Orden aleatorio de preguntas</span></label>
              <label class="inline-check"><input id="shuffle-options" type="checkbox" checked> <span>Mezclar alternativas</span></label>
            </fieldset>

            <fieldset><legend>Áreas</legend><div class="check-list" id="areas-list">${areas.map(a => `<label><input type="checkbox" name="area" value="${esc(a)}" checked> ${esc(a)}</label>`).join('')}</div></fieldset>
            <fieldset><legend>Años</legend><div class="check-list compact">${years.map(y => `<label><input type="checkbox" name="year" value="${y}" checked> ${y}</label>`).join('')}</div></fieldset>

            <fieldset class="wide"><legend>Temas específicos</legend>
              <div class="topic-browser-toolbar">
                <input id="topic-search" class="input topic-search" type="search" placeholder="Buscar tema o especialidad: exantemas, cardiología, sepsis…" autocomplete="off">
                <div class="topic-tools"><button type="button" id="topics-all" class="btn small">Todos</button><button type="button" id="topics-none" class="btn small ghost">Ninguno</button></div>
              </div>
              <div class="topic-browser-help">Navega por Área → Especialidad → Tema de rentabilidad o usa el buscador. La entidad clínica se conserva como nivel fino dentro de cada pregunta.</div>
              <div id="topic-search-status" class="topic-search-status muted"></div>
              <div class="topic-browser" id="topic-browser">${topicHierarchyHtml(topicHierarchy)}</div>
            </fieldset>

            ${isExam ? `
              <fieldset><legend>Tiempo total</legend><label>Minutos<input id="total-minutes" class="input" type="number" min="1" value="180"></label></fieldset>
              <fieldset><legend>Descanso por bloques</legend><label>Descanso después de la pregunta<input id="break-after" class="input" type="number" min="0" value="100"></label><label><input id="pause-break" type="checkbox" checked> Pausar cronómetro durante el descanso</label></fieldset>
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
        document.getElementById('total-minutes').value = 180;
        document.getElementById('break-after').value = 100;
      }
      if (isExam && p === 80) {
        document.getElementById('total-minutes').value = 180;
        document.getElementById('break-after').value = 0;
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
      const selected = (config.randomize ? shuffle(pool) : pool).slice(0, config.count);
      if (mode === 'exam') await launchExam(selected, config);
      else launchStudy(selected, config);
    });
  }

  function readBuilderConfig(mode) {
    const checked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x => x.value);
    const base = {
      mode,
      count: Number(document.getElementById('question-count').value),
      randomize: document.getElementById('randomize').checked,
      shuffleOptions: document.getElementById('shuffle-options').checked,
      poolType: document.getElementById('pool-type').value,
      rentability: document.getElementById('rentability').value,
      areas: checked('area'),
      years: checked('year').map(Number),
      topicPaths: checked('topicPath'),
      feedback: document.getElementById('feedback-mode').value,
    };
    if (mode === 'exam') {
      base.totalSeconds = Math.max(60, Number(document.getElementById('total-minutes').value) * 60);
      base.breakAfter = Math.max(0, Number(document.getElementById('break-after').value || 0));
      base.pauseDuringBreak = document.getElementById('pause-break').checked;
      base.title = `Simulacro de ${base.count} preguntas`;
    } else {
      base.timeMode = document.getElementById('time-mode').value;
      base.secondsPerQuestion = Number(document.getElementById('seconds-per-question').value || 25);
      base.totalSeconds = Number(document.getElementById('study-total-minutes').value || 20) * 60;
      base.title = `Sesión de ${base.count} preguntas`;
    }
    return base;
  }

  function filterPool(config) {
    const wrongIds = new Set(attempts.filter(a => !a.is_correct).map(a => a.question_id));
    const correctIds = new Set(attempts.filter(a => a.is_correct).map(a => a.question_id));
    const seenIds = new Set(attempts.map(a => a.question_id));
    return questions.filter(q => {
      if (config.areas.length && !config.areas.includes(q.area)) return false;
      if (config.years.length && !config.years.includes(Number(q.year))) return false;
      if (config.topicPaths.length && !config.topicPaths.includes(topicPathKey(q))) return false;
      if (config.rentability === 'high' && !isHighRentability(q)) return false;
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
    config = { shuffleOptions: true, ...config };
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
        <div class="q-head"><span class="tag">${currentStudy.index+1}/${currentStudy.questions.length}</span><span id="study-question-metadata" class="question-meta-tags" ${metadataVisible?'':'hidden'} aria-hidden="${metadataVisible?'false':'true'}">${metadataVisible?studyQuestionMetadataTags(q):''}</span>${targetTag}${timerHtml}</div>
        <div class="q-body"><p class="q-text">${esc(q.question)}</p>
          ${questionMediaHtml(q)}
          ${locked ? `<div class="banner compact"><strong>⏱ Pregunta cerrada.</strong> ${responseState.timedOut ? 'El tiempo terminó sin respuesta; contará como un único intento fallido por tiempo.' : 'El tiempo terminó después de que respondiste; se conserva esa respuesta y ya no puede modificarse.'}</div>` : ''}
          <div class="uncertainty-hint">Marca <strong>?</strong> en cualquier alternativa que no domines del todo. No cambia tu respuesta; sí hace que el concepto vuelva antes al repaso.</div>
          <div class="options">${opts.map(o => optionWithUncertaintyButton(o, selected, uncertainOptions.includes(o.sourceLetter || o.letter))).join('')}</div>
          ${currentStudy.config.timeMode === 'none' ? `<div class="dont-know-row"><button id="dont-know-study" class="btn ghost dont-know-btn" type="button">🤷 No sé · mostrar respuesta</button><span class="muted">Cuenta como respuesta incorrecta explícita; no como pregunta en blanco.</span></div>` : ''}
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
    document.querySelectorAll('[data-uncertain-letter]').forEach(btn => {
      if (locked) {
        btn.disabled = true;
        return;
      }
      btn.onclick = (ev) => {
        ev.stopPropagation();
        const letter = btn.dataset.uncertainLetter;
        currentStudy.scratch = toggleTentativeOption(currentStudy.scratch || {}, q.id, letter);
        const active = isOptionUncertain(currentStudy.scratch, q.id, letter);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = active ? 'Quitar marca de duda' : 'Marcar esta alternativa con ?';
        scheduleCurrentSessionSave();
      };
    });
    document.getElementById('cancel-study').onclick = cancelCurrentStudy;
    if (currentStudy.config.feedback === 'end') {
      const goPrev = () => {
        saveStudyDuration();
        currentStudy.index--;
        scheduleCurrentSessionSave();
        renderStudyQuestion();
      };
      const goNext = () => {
        saveStudyDuration();
        if (currentStudy.index + 1 >= currentStudy.questions.length) finishStudy();
        else {
          currentStudy.index++;
          scheduleCurrentSessionSave();
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
    const previousResponse = currentStudy.responses[q.id] || {};
    currentStudy.responses[q.id] = { ...previousResponse, selected: letter, didNotKnow: false, timedOut: false };
    currentStudy.answerTimes[q.id] = Number(currentStudy.durations[q.id] || 0);
    scheduleCurrentSessionSave();

    if (currentStudy.config.feedback === 'immediate') {
      clearTimer();
      const isCorrect = letter === q.official_answer;
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      const savedAttempt = await recordSingleAttempt(
        q, letter, isCorrect, currentStudy.durations[q.id] || 0,
        currentStudy.config.studyMode || 'custom_study', false,
        {
          uncertainOptions,
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25),
          ...sessionAttemptMeta(currentStudy, q.id),
        }
      );
      if (savedAttempt?.id) currentStudy.attemptIdsByQuestion[q.id] = savedAttempt.id;
      currentStudy.responses[q.id] = { ...currentStudy.responses[q.id], metadataRevealed: true };
      scheduleCurrentSessionSave();
      disableOptionsAndPaint(q, letter);
      revealStudyQuestionMetadata(q);
      document.querySelectorAll('.uncertainty-toggle').forEach(btn => btn.disabled = true);
      renderFeedback(q, letter, isCorrect, () => {
        currentStudy.index++;
        scheduleCurrentSessionSave();
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
    if (!q || !currentStudy || currentStudy.config.timeMode !== 'none') return;

    saveStudyDuration();
    currentStudy.responses[q.id] = { selected: null, didNotKnow: true };
    scheduleCurrentSessionSave();

    if (currentStudy.config.feedback === 'immediate') {
      clearTimer();
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      const savedAttempt = await recordSingleAttempt(
        q, null, false, currentStudy.durations[q.id] || 0,
        currentStudy.config.studyMode || 'custom_study', false,
        {
          uncertainOptions,
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
      document.querySelectorAll('.uncertainty-toggle').forEach(btn => btn.disabled = true);
      const dontKnowBtn = document.getElementById('dont-know-study');
      if (dontKnowBtn) dontKnowBtn.disabled = true;
      renderFeedback(
        q, null, false,
        () => { currentStudy.index++; scheduleCurrentSessionSave(); renderStudyQuestion(); },
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
      scheduleCurrentSessionSave();
      if (currentStudy.index >= currentStudy.questions.length) finishStudy();
      else renderStudyQuestion();
    }
  }

  function handleStudyTimeout() {
    const q = studyCurrentQuestion();
    if (!q || !currentStudy || studyQuestionLocked(q)) return;
    saveStudyDuration();
    const targetMs = studyQuestionTargetMs(q);
    currentStudy.durations[q.id] = targetMs;
    const prior = currentStudy.responses[q.id] || {};
    const hadAnswer = prior.selected != null;

    if (currentStudy.config.feedback === 'immediate') {
      currentStudy.responses[q.id] = { selected: null, timedOut: true, locked: true, lockedByTimeout: true };
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      recordSingleAttempt(
        q, null, false, targetMs,
        currentStudy.config.studyMode || 'custom_study', true,
        {
          uncertainOptions,
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25),
          ...sessionAttemptMeta(currentStudy, q.id),
        }
      ).then((savedAttempt) => {
        if (savedAttempt?.id) currentStudy.attemptIdsByQuestion[q.id] = savedAttempt.id;
        currentStudy.responses[q.id] = { ...currentStudy.responses[q.id], metadataRevealed: true };
        scheduleCurrentSessionSave();
        disableOptionsAndPaint(q, null);
        revealStudyQuestionMetadata(q);
        document.querySelectorAll('.uncertainty-toggle').forEach(btn => btn.disabled = true);
        renderFeedback(
          q, null, false,
          () => { currentStudy.index++; scheduleCurrentSessionSave(); renderStudyQuestion(); },
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
    scheduleCurrentSessionSave();
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
        dontKnow:didNotKnow,
        baseTargetSeconds:Number(study.config.secondsPerQuestion || profile?.target_response_seconds || 25),
        ...sessionAttemptMeta(study, q.id),
      }
    );
  }

  async function ensureStudyAttempts(study, questionList) {
    const sessionId = study?.row?.id;
    const existing = new Map(attemptsForSession(sessionId).map(attempt => [attempt.question_id, attempt]));
    const missingPayload = questionList
      .filter(q => !existing.has(q.id))
      .map(q => studyAttemptPayload(study, q));
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
        const recovered = await handleSessionRevisionConflict({ kind:holder === currentExam ? 'exam' : 'study', holder, row, state:normalizedState }, conflictSource, { message:'SESSION_REVISION_CONFLICT_OR_NOT_ACTIVE', code:'PT409' });
        if (retryAfterConflict && recovered?.id && holder?.row?.id === recovered.id) {
          return finalizeSessionRow(holder, normalizedState, { partial, retryAfterConflict:false });
        }
        return recovered || completed;
      }
      const synced = { ...data, syncStatus:'synced' };
      await saveSessionShadow(synced, 'synced');
      upsertSessionInMemory(synced);
      return synced;
    }

    saveLocalSessions();
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
      await flushCurrentSessionSave();
      const savedAttempts = await ensureStudyAttempts(currentStudy, answeredQuestions);
      const state = studyStateSnapshot();
      await finalizeSessionRow(currentStudy, state, { partial:true });
      reviewContext = {
        type:'study_session',
        sessionId:currentStudy.row.id,
        partial:true,
        questions:answeredQuestions,
        responses:currentStudy.responses,
        scratch:currentStudy.scratch || {},
        optionOrders:currentStudy.optionOrders || {},
        shuffleOptions:currentStudy.config.shuffleOptions !== false,
        attemptsByQuestion:Object.fromEntries(savedAttempts.map(attempt => [attempt.question_id, attempt])),
        index:0,
      };
      currentStudy = null;
      deactivateSessionNavigationGuard();
      renderReviewQuestion();
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
      await flushCurrentSessionSave();
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
      const uncertainCount = study.questions.filter(q => uncertaintyOptionsFor(study.scratch, q.id).length > 0).length;
      reviewContext = {
        type:'study_session',
        sessionId:study.row.id,
        partial:false,
        questions:study.questions,
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
      document.getElementById('review-btn').onclick = () => renderReviewQuestion();
    } finally {
      sessionActionInProgress = false;
    }
  }

  async function launchExam(selected, config) {
    clearTimer();
    if (!selected?.length) return renderMessage('Sin preguntas', 'No se encontraron preguntas para iniciar este simulacro.');
    config = { shuffleOptions:true, ...config };
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
      remainingSeconds:config.totalSeconds,
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
    state.remainingSeconds ??= config.totalSeconds || 0;
    currentExam = { row, config, questions:selected, state };
    beginSessionActivity();
    activateSessionNavigationGuard();
    if (config.examLayout === 'paper') renderHistoricalExamPaper();
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
    clearTimer();
    scrollPageTop();
    const q = currentExam.questions[currentExam.state.currentIndex];
    const selected = sessionSelected(currentExam.state, q.id);
    const marked = Boolean(currentExam.state.marked[q.id]);
    currentExam.state.scratch ||= {};
    const uncertainOptions = uncertaintyOptionsFor(currentExam.state.scratch, q.id);
    examQuestionEnteredAt = performance.now();

    app.innerHTML = `<main class="shell exam-shell">
      ${topbar(currentExam.config.title || 'Simulacro', false)}
      <div class="question-step-nav exam-question-step-nav" aria-label="Navegación superior del simulacro">
        <button class="btn small ghost" data-exam-prev ${currentExam.state.currentIndex===0?'disabled':''}>← Anterior</button>
        <strong>${currentExam.state.currentIndex+1}/${currentExam.questions.length}</strong>
        <button class="btn small ${marked?'warn-btn':'ghost'}" data-exam-mark>${marked?'⚑ Marcada':'⚐ Marcar'}</button>
        <button class="btn small primary" data-exam-next>${currentExam.state.currentIndex+1===currentExam.questions.length?'Ir al final':'Siguiente →'}</button>
      </div>
      <section class="exam-layout">
        <div class="panel question-card">
          <div class="progress"><div style="width:${(currentExam.state.currentIndex/currentExam.questions.length)*100}%"></div></div>
          <div class="q-head"><span class="tag">${currentExam.state.currentIndex+1}/${currentExam.questions.length}</span><div id="timer" class="timer">${formatTime(currentExam.state.remainingSeconds)}</div></div>
          <div class="q-body"><p class="q-text">${esc(q.question)}</p>
            ${questionMediaHtml(q)}
            <div class="uncertainty-hint">Puedes marcar <strong>?</strong> en una o varias alternativas sin cambiar tu respuesta definitiva.</div>
            <div class="options">${displayOptionList(
              q,
              currentExam.state.optionOrders,
              currentExam.config.shuffleOptions !== false && currentExam.config.examLayout !== 'paper'
            ).map(o => optionWithUncertaintyButton(o, selected, uncertainOptions.includes(o.sourceLetter || o.letter))).join('')}</div>
          </div>
        </div>
        <aside class="panel exam-nav"><div class="exam-nav-head"><strong>Navegación</strong><button class="btn small ${marked?'warn-btn':''}" data-exam-mark>${marked?'⚑ Marcada':'⚐ Marcar'}</button></div><div class="question-grid">${currentExam.questions.map((x,i) => examGridButton(x,i)).join('')}</div><div class="legend"><span>● respondida</span><span>⚑ revisar</span></div></aside>
      </section>
      <div class="exam-controls">
        <button class="btn ghost" data-exam-prev ${currentExam.state.currentIndex===0?'disabled':''}>← Anterior</button>
        <button id="session-exit-exam" class="btn ghost">Cerrar o continuar después</button>
        <button id="finish-exam" class="btn danger">Entregar examen</button>
        <button class="btn primary" data-exam-next>${currentExam.state.currentIndex+1===currentExam.questions.length?'Ir al final':'Siguiente →'}</button>
      </div>
    </main>`;
    attachTopbar();

    document.querySelectorAll('.option').forEach(btn => btn.onclick = async () => {
      currentExam.state.responses[q.id] = { ...sessionResponse(currentExam.state, q.id), selected:btn.dataset.letter, didNotKnow:false, timedOut:false };
      document.querySelectorAll('.option').forEach(b => b.classList.toggle('selected', b.dataset.letter === btn.dataset.letter));
      await persistExamState();
      refreshExamGridOnly();
    });
    document.querySelectorAll('[data-uncertain-letter]').forEach(btn => {
      btn.onclick = async (ev) => {
        ev.stopPropagation();
        const letter = btn.dataset.uncertainLetter;
        currentExam.state.scratch = toggleTentativeOption(currentExam.state.scratch || {}, q.id, letter);
        const active = isOptionUncertain(currentExam.state.scratch, q.id, letter);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = active ? 'Quitar marca de duda' : 'Marcar esta alternativa con ?';
        await persistExamState();
      };
    });
    document.querySelectorAll('[data-qindex]').forEach(btn => btn.onclick = async () => {
      accumulateExamTime();
      currentExam.state.currentIndex = Number(btn.dataset.qindex);
      await persistExamState();
      renderExamQuestion();
    });
    const toggleExamMark = async () => {
      currentExam.state.marked[q.id] = !currentExam.state.marked[q.id];
      await persistExamState();
      renderExamQuestion();
    };
    const goExamPrev = async () => {
      if (currentExam.state.currentIndex <= 0) return;
      accumulateExamTime();
      currentExam.state.currentIndex--;
      await persistExamState(); renderExamQuestion();
    };
    const goExamNext = async () => {
      accumulateExamTime();
      const nextIndex = currentExam.state.currentIndex + 1;
      if (currentExam.config.breakAfter > 0 && nextIndex === currentExam.config.breakAfter && !currentExam.state.breakTaken && nextIndex < currentExam.questions.length) {
        currentExam.state.breakTaken = true;
        currentExam.state.currentIndex = nextIndex;
        await persistExamState();
        return renderBreakScreen();
      }
      if (nextIndex < currentExam.questions.length) {
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
    updateTimer(currentExam.state.remainingSeconds);
    timerId = setInterval(async () => {
      currentExam.state.remainingSeconds--;
      updateTimer(currentExam.state.remainingSeconds);
      if (currentExam.state.remainingSeconds % 30 === 0) await persistExamState();
      if (currentExam.state.remainingSeconds <= 0) {
        clearTimer();
        await finishExam(true);
      }
    }, 1000);
  }

  function examGridButton(q, i) {
    const answered = sessionSelected(currentExam.state, q.id) != null;
    const marked = Boolean(currentExam.state.marked[q.id]);
    const current = i === currentExam.state.currentIndex;
    const label = currentExam?.config?.examLayout === 'paper' ? historicalDisplayNumber(q, i) : String(i + 1);
    return `<button class="qnav ${answered?'answered':''} ${marked?'marked':''} ${current?'current':''}" data-qindex="${i}">${esc(label)}${marked?'⚑':''}</button>`;
  }

  function refreshExamGridOnly() {
    const grid = document.querySelector('.question-grid');
    if (grid) grid.innerHTML = currentExam.questions.map((x,i) => examGridButton(x,i)).join('');
    document.querySelectorAll('[data-qindex]').forEach(btn => btn.onclick = async () => {
      accumulateExamTime(); currentExam.state.currentIndex = Number(btn.dataset.qindex); await persistExamState(); renderExamQuestion();
    });
  }

  function renderBreakScreen() {
    clearTimer();
    const done = currentExam.config.breakAfter;
    app.innerHTML = `<main class="shell">${topbar('Descanso', false)}<section class="panel empty"><h2>Bloque 1 completado</h2><p>Has llegado a la pregunta ${done}. Tu progreso está guardado.</p><p class="muted">${currentExam.config.pauseDuringBreak ? 'El cronómetro está pausado durante este descanso.' : 'El cronómetro continúa corriendo.'}</p><div class="actions"><button id="continue-block" class="btn primary">Continuar con el siguiente bloque</button><button id="session-exit-break" class="btn ghost">Cerrar o continuar después</button></div></section></main>`;
    attachTopbar();
    if (!currentExam.config.pauseDuringBreak) startExamTimer();
    document.getElementById('continue-block').onclick = () => currentExam.config.examLayout === 'paper' ? renderHistoricalExamPaper() : renderExamQuestion();
    document.getElementById('session-exit-break').onclick = cancelCurrentExam;
  }

  function renderExamOverview() {
    clearTimer();
    accumulateExamTime();
    const answered = currentExam.questions.filter(q => sessionSelected(currentExam.state, q.id) != null).length;
    const marked = currentExam.questions.filter(q => currentExam.state.marked[q.id]).length;
    const uncertain = currentExam.questions.filter(q => Object.values(currentExam.state.scratch?.[q.id] || {}).includes('tentative')).length;
    app.innerHTML = `<main class="shell">${topbar('Revisión antes de entregar', false)}<section class="panel"><h2>Resumen del simulacro</h2><div class="kpis"><div class="kpi"><div class="value">${answered}</div><div class="label">Respondidas</div></div><div class="kpi"><div class="value">${currentExam.questions.length-answered}</div><div class="label">Sin responder</div></div><div class="kpi"><div class="value">${marked}</div><div class="label">Marcadas para revisar</div></div><div class="kpi"><div class="value">${uncertain}</div><div class="label">Dudosas (?)</div></div><div class="kpi"><div class="value">${formatTime(currentExam.state.remainingSeconds)}</div><div class="label">Tiempo restante</div></div></div><div class="question-grid overview-grid">${currentExam.questions.map((x,i) => examGridButton(x,i)).join('')}</div><div class="footer-actions"><button id="back-exam" class="btn ghost">Volver al examen</button><button id="cancel-overview" class="btn ghost">Cerrar o continuar después</button><button id="submit-exam" class="btn danger">Entregar y corregir</button></div></section></main>`;
    attachTopbar();
    document.querySelectorAll('[data-qindex]').forEach(btn => btn.onclick = () => {
      currentExam.state.currentIndex = Number(btn.dataset.qindex);
      if (currentExam.config.examLayout === 'paper') {
        const index = currentExam.state.currentIndex;
        renderHistoricalExamPaper();
        setTimeout(() => document.getElementById(`paper-question-${index}`)?.scrollIntoView({ behavior:'smooth', block:'start' }), 0);
      } else renderExamQuestion();
    });
    document.getElementById('back-exam').onclick = () => currentExam.config.examLayout === 'paper' ? renderHistoricalExamPaper() : renderExamQuestion();
    document.getElementById('cancel-overview').onclick = cancelCurrentExam;
    document.getElementById('submit-exam').onclick = async () => {
      const missing = currentExam.questions.length - answered;
      const warning = `¿Entregar el simulacro?\n\nRespondidas: ${answered}\nSin responder: ${missing}\nDudosas (?): ${uncertain}\nMarcadas para revisar: ${marked}\n\nDespués se mostrarán las respuestas y explicaciones.`;
      if (confirm(warning)) await finishExam(false);
    };
  }

  function examAttemptPayload(exam, q, historicalAverageMs = 0) {
    const selected = sessionSelected(exam.state, q.id);
    const measuredMs = exam.state.timeSpent?.[q.id] || (exam.config.examLayout === 'paper' ? historicalAverageMs : 0);
    const uncertainOptions = Object.entries(exam.state.scratch?.[q.id] || {})
      .filter(([, state]) => state === 'tentative')
      .map(([letter]) => letter);
    return makeAttempt(
      q,
      selected,
      selected === q.official_answer,
      measuredMs,
      exam.config.studyMode || 'exam',
      false,
      {
        uncertainOptions,
        ...sessionAttemptMeta(exam, q.id),
      }
    );
  }

  async function ensureExamAttempts(exam, questionList) {
    const existing = new Map(attemptsForSession(exam?.row?.id).map(attempt => [attempt.question_id, attempt]));
    const answeredForTiming = questionList.length;
    const elapsedSessionMs = Math.max(0, (Number(exam.config.totalSeconds || 0) - Number(exam.state.remainingSeconds || 0)) * 1000);
    const historicalAverageMs = answeredForTiming ? Math.round(elapsedSessionMs / answeredForTiming) : 0;
    const payload = questionList
      .filter(q => !existing.has(q.id))
      .map(q => examAttemptPayload(exam, q, historicalAverageMs));
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
      renderReviewQuestion();
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
      document.getElementById('review-btn').onclick = renderReviewQuestion;
    } finally {
      sessionActionInProgress = false;
    }
  }

  function renderReviewQuestion() {
    clearTimer();
    scrollPageTop();
    const q = reviewContext.questions[reviewContext.index];
    const historyReview = String(reviewContext?.type || '').startsWith('history_');
    const historySessionReview = reviewContext?.type === 'history_session';
    const specificQueryReview = reviewContext?.type === 'specific_query';
    const responseValue = reviewContext.responses[q.id];
    const selected = responseValue?.selected ?? responseValue ?? null;
    const didNotKnow = Boolean(responseValue?.didNotKnow);
    const timedOut = Boolean(responseValue?.timedOut);
    const omitted = selected == null && !didNotKnow && !timedOut;
    const correct = !didNotKnow && !timedOut && selected === q.official_answer;
    const uncertainOptions = Object.entries(reviewContext.scratch?.[q.id] || {})
      .filter(([,state]) => state === 'tentative')
      .map(([letter]) => letter);
    const reviewOptions = displayOptionList(q, reviewContext.optionOrders || {}, reviewContext.shuffleOptions !== false);
    const reviewTitle = reviewContext?.type === 'specific_query' ? 'Consulta' : 'Revisión';
    app.innerHTML = `<main class="shell">${topbar(reviewTitle, true)}<div class="review-navigation-wrap"><div class="question-step-nav" aria-label="Navegación superior de la revisión"><button class="btn small ghost" data-review-prev ${reviewContext.index===0?'disabled':''}>← Anterior</button><strong>${reviewContext.index+1}/${reviewContext.questions.length}</strong><button class="btn small primary" data-review-next>${reviewContext.index+1===reviewContext.questions.length?(specificQueryReview?'Volver al selector':'Terminar revisión'):'Siguiente →'}</button></div>${specificQueryReview?`<div class="specific-review-actions" aria-label="Acciones de consulta"><button class="btn small ghost" data-review-selector type="button">← Volver al selector</button><button class="btn small danger ghost-danger" data-review-exit type="button">Salir</button></div>`:''}</div><section class="panel question-card"><div class="q-head"><span class="tag">${reviewContext.index+1}/${reviewContext.questions.length}</span>${questionSourceTag(q)}<span class="tag">${esc(q.topic)}</span>${taxonomyEntityTag(q)}${auditBadge(q)}${didNotKnow?'<span class="tag warn">🤷 No sé</span>':''}${timedOut?'<span class="tag bad">⏱ Tiempo agotado</span>':''}${omitted?'<span class="tag">Sin respuesta</span>':''}${uncertainOptions.length?'<span class="tag warn">❓ Duda registrada</span>':''}</div><div class="q-body"><p class="q-text">${esc(q.question)}</p>${questionMediaHtml(q)}<div class="options">${reviewOptions.map(o => {
      const sourceLetter = o.sourceLetter || o.letter;
      return `<div class="option ${sourceLetter===q.official_answer?'correct':sourceLetter===selected?'wrong':'dimmed'}"><span class="letter">${o.letter}</span><span>${esc(o.text)}</span></div>`;
    }).join('')}</div></div><div id="feedback"></div></section><div class="footer-actions review-footer-actions"><button class="btn ghost" data-review-prev ${historyReview && !historySessionReview?'style="visibility:hidden"':(reviewContext.index===0?'disabled':'')}>← Anterior</button>${specificQueryReview?`<button class="btn ghost" data-review-selector type="button">Volver al selector</button><button class="btn danger ghost-danger" data-review-exit type="button">Salir</button>`:''}<button class="btn primary" data-review-next>${specificQueryReview?(reviewContext.index+1===reviewContext.questions.length?'Volver al selector':'Siguiente →'):historyReview?(historySessionReview && reviewContext.index+1<reviewContext.questions.length?'Siguiente →':'Volver al historial'):(reviewContext.index+1===reviewContext.questions.length?'Terminar revisión':'Siguiente →')}</button></div></main>`;
    attachTopbar();
    const sessionAttempt = reviewContext?.attemptsByQuestion?.[q.id] || null;
    const sessionScopedReview = Boolean(reviewContext?.sessionId);
    const latestAttempt = sessionAttempt || (sessionScopedReview
      ? null
      : attemptsForQuestion(q.id)
          .slice()
          .sort((a,b) => new Date(b.answered_at) - new Date(a.answered_at))[0] || null);
    const reviewFeedbackMeta = {
      attemptId: latestAttempt?.id || null,
      responseTimeMs: Number(latestAttempt?.response_time_ms || 0),
      targetSeconds: Number(latestAttempt?.target_seconds || effectiveTargetSeconds(q)),
      wasUncertainAtAnswer: Boolean(latestAttempt?.was_uncertain),
      // En la revisión al final, cualquier pregunta respondida debe permitir
      // registrar que el razonamiento no estaba realmente dominado, incluso
      // si la alternativa final fue correcta o el tiempo terminó después de
      // haber marcado una respuesta.
      allowPostMark: !didNotKnow && selected != null,
      didNotKnow,
      omitted,
    };

    // La explicación es parte esencial de la revisión, no un extra opcional.
    // La protegemos con un fallback para que un dato editorial inesperado no
    // deje una respuesta correcta mostrando solo el color verde.
    try {
      renderFeedback(q, selected, correct, null, timedOut, true, uncertainOptions, reviewFeedbackMeta);
    } catch (error) {
      console.error('Error al renderizar la explicación de revisión:', error);
    }
    const reviewFeedbackNode = document.getElementById('feedback');
    if (reviewFeedbackNode && !reviewFeedbackNode.innerHTML.trim()) {
      renderReviewFeedbackFallback(q, selected, correct, timedOut, uncertainOptions, reviewFeedbackMeta);
    }
    const goReviewPrev = () => {
      if (reviewContext.index <= 0) return;
      reviewContext.index--;
      renderReviewQuestion();
    };
    const goReviewNext = () => {
      if (reviewContext?.type === 'specific_query') {
        if (reviewContext.index + 1 < reviewContext.questions.length) {
          reviewContext.index++;
          renderReviewQuestion();
        } else renderSpecificQuestions();
        return;
      }
      if (historyReview) {
        if (historySessionReview && reviewContext.index + 1 < reviewContext.questions.length) {
          reviewContext.index++;
          renderReviewQuestion();
          return;
        }
        const returnDate = reviewContext.returnDate || isoDateLocal();
        renderHistory(returnDate);
      } else if (reviewContext.index + 1 >= reviewContext.questions.length) renderDashboard();
      else { reviewContext.index++; renderReviewQuestion(); }
    };
    if (!historyReview || historySessionReview) document.querySelectorAll('[data-review-prev]').forEach(btn => btn.onclick = goReviewPrev);
    document.querySelectorAll('[data-review-next]').forEach(btn => btn.onclick = goReviewNext);
    if (specificQueryReview) {
      document.querySelectorAll('[data-review-selector]').forEach(btn => btn.onclick = () => renderSpecificQuestions(specificQueryDraft));
      document.querySelectorAll('[data-review-exit]').forEach(btn => btn.onclick = () => {
        reviewContext = null;
        renderDashboard();
      });
    }
  }


  function uncertaintyOptionsFor(scratch, qId) {
    return Object.entries(scratch?.[qId] || {})
      .filter(([,state]) => state === 'tentative')
      .map(([letter]) => letter);
  }

  function isOptionUncertain(scratch, qId, letter) {
    return scratch?.[qId]?.[letter] === 'tentative';
  }

  function toggleTentativeOption(scratch, qId, letter) {
    scratch ||= {};
    scratch[qId] ||= {};
    if (scratch[qId][letter] === 'tentative') delete scratch[qId][letter];
    else scratch[qId][letter] = 'tentative';
    if (!Object.keys(scratch[qId]).length) delete scratch[qId];
    return scratch;
  }

  function optionWithUncertaintyButton(o, selected, uncertain = false) {
    const sourceLetter = o.sourceLetter || o.letter;
    return `<div class="option-with-uncertainty">
      ${optionButton(o, selected)}
      <button class="uncertainty-toggle ${uncertain?'active':''}" data-uncertain-letter="${sourceLetter}"
        type="button" aria-pressed="${uncertain?'true':'false'}"
        title="${uncertain?'Quitar marca de duda':'Marcar esta alternativa con ?'}">?</button>
    </div>`;
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

  function bindPostAnswerUncertainButton(feedbackMeta, q, selected) {
    const postBtn = document.getElementById('post-answer-uncertain');
    if (!postBtn || postBtn.disabled) return;
    postBtn.onclick = async () => {
      postBtn.disabled = true;
      const status = document.getElementById('post-answer-uncertain-status');
      if (status) status.textContent = 'Guardando…';
      const updated = await markAttemptUncertainAfterFeedback(feedbackMeta.attemptId, q, selected);
      if (!updated) {
        postBtn.disabled = false;
        if (status) status.textContent = 'No se pudo guardar. Intenta nuevamente.';
        return;
      }
      postBtn.textContent = '✓ Marcada para repaso prioritario';
      postBtn.classList.remove('warn-btn');
      postBtn.classList.add('ghost');
      if (status) status.textContent = 'Registrada como duda posterior a la corrección. La memoria y la prioridad ya fueron recalculadas.';
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

    const postMarkAvailable = Boolean(feedbackMeta.attemptId) && selected != null && feedbackMeta.allowPostMark !== false;
    const alreadyUncertain = Boolean(feedbackMeta.wasUncertainAtAnswer) || uncertainOptions.length > 0;
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
      ${hasEditorialText(q?.exam_logic) ? `<div class="explain-block quick-logic"><h4>🧠 Lógica rápida</h4><p>${esc(cleanEditorialText(q.exam_logic))}</p></div>` : ''}
      ${correctText ? `<details class="explain-block" open><summary><strong>Por qué la clave es correcta</strong></summary><p>${esc(correctText)}</p></details>` : ''}
      ${distractors ? `<details class="explain-block"><summary><strong>Por qué no las otras</strong></summary>${distractors}</details>` : ''}
      ${hasEditorialText(q?.common_trap) ? `<div class="explain-block trap"><h4>⚠ Trampa frecuente</h4><p>${esc(cleanEditorialText(q.common_trap))}</p></div>` : ''}
      ${hasEditorialText(q?.exam_pearl) ? `<div class="explain-block pearl"><h4>💡 Perla de examen</h4><p>${esc(cleanEditorialText(q.exam_pearl))}</p></div>` : ''}
      ${hasEditorialText(q?.memory_hook) ? `<div class="explain-block memory"><h4>🪝 Gancho de memoria</h4><p>${esc(cleanEditorialText(q.memory_hook))}</p></div>` : ''}
      ${quickReference}
      <div class="content-review-action"><div><strong>¿Hay algo que corregir en esta pregunta?</strong><p class="muted">Guárdala en tu lista de auditoría sin alterar tu resultado ni el repaso.</p></div>${reviewFlagButton(q)}</div>
      ${postMarkAvailable ? `<div class="post-answer-reflection">
        <div>
          <strong>¿Acertaste sin dominar realmente el razonamiento?</strong>
          <p class="muted">Márcala como duda después de leer la explicación. Se conservará el acierto, pero volverá antes al repaso.</p>
        </div>
        <button id="post-answer-uncertain" class="btn ${alreadyUncertain ? 'ghost' : 'warn-btn'}" type="button" ${alreadyUncertain ? 'disabled' : ''}>
          ${alreadyUncertain ? '✓ Ya registrada como dudosa' : '❓ No dominaba el razonamiento'}
        </button>
        <div id="post-answer-uncertain-status" class="muted post-answer-status"></div>
      </div>` : ''}
    </div>`;

    bindPostAnswerUncertainButton(feedbackMeta, q, selected);
    bindReviewFlagButtons(target);
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
    const postMarkAvailable = Boolean(feedbackMeta.attemptId) && selected != null && (!reviewOnly || feedbackMeta.allowPostMark);
    const alreadyUncertain = Boolean(feedbackMeta.wasUncertainAtAnswer) || uncertainOptions.length > 0;
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

      ${uncertainOptions.length ? `<div class="explain-block uncertainty-box"><h4>❓ Alternativas que marcaste como dudosas</h4><p>Esta pregunta se programará antes en tu repaso aunque la hayas acertado.</p>${uncertainOptions.map(letter => {
        const text = q[`option_${letter.toLowerCase()}`] || '';
        const reason = cleanEditorialText(letter === q.official_answer ? q.correct_explanation : q[`why_not_${letter.toLowerCase()}`]);
        const displayLetter = displayLetterFor(letter);
        return `<p><strong>${esc(displayLetter)}. ${esc(text)}</strong>${reason ? ` — ${esc(reason)}` : ''}</p>`;
      }).join('')}</div>` : ''}
      ${hasEditorialText(q.exam_logic) ? `<div class="explain-block quick-logic"><h4>🧠 Lógica rápida</h4><p>${esc(cleanEditorialText(q.exam_logic))}</p></div>` : ''}
      ${correctText ? `<details class="explain-block" open><summary><strong>Por qué la clave es correcta</strong></summary><p>${esc(correctText)}</p></details>` : ''}
      ${distractors ? `<details class="explain-block"><summary><strong>Por qué no las otras</strong></summary>${distractors}</details>` : ''}
      ${hasEditorialText(q.common_trap) ? `<div class="explain-block trap"><h4>⚠ Trampa frecuente</h4><p>${esc(cleanEditorialText(q.common_trap))}</p></div>` : ''}
      ${hasEditorialText(q.exam_pearl) ? `<div class="explain-block pearl"><h4>💡 Perla de examen</h4><p>${esc(cleanEditorialText(q.exam_pearl))}</p></div>` : ''}
      ${hasEditorialText(q.memory_hook) ? `<div class="explain-block memory"><h4>🪝 Gancho de memoria</h4><p>${esc(cleanEditorialText(q.memory_hook))}</p></div>` : ''}
      ${quickReference}
      <div class="content-review-action"><div><strong>¿Hay algo que corregir en esta pregunta?</strong><p class="muted">Guárdala en tu lista de auditoría sin alterar tu resultado ni el repaso.</p></div>${reviewFlagButton(q)}</div>
      ${postMarkAvailable ? `<div class="post-answer-reflection">
        <div>
          <strong>¿Acertaste sin dominar realmente el razonamiento?</strong>
          <p class="muted">Puedes marcar la pregunta después de leer la corrección. Se contará como conocimiento frágil y volverá antes al repaso.</p>
        </div>
        <button id="post-answer-uncertain" class="btn ${alreadyUncertain ? 'ghost' : 'warn-btn'}" type="button" ${alreadyUncertain ? 'disabled' : ''}>
          ${alreadyUncertain ? '✓ Ya registrada como dudosa' : '❓ No dominaba el razonamiento'}
        </button>
        <div id="post-answer-uncertain-status" class="muted post-answer-status"></div>
      </div>` : ''}
      ${!reviewOnly && onNext ? `<div class="footer-actions"><button id="next-feedback" class="btn primary">Siguiente pregunta →</button></div>` : ''}
    </div>`;

    bindPostAnswerUncertainButton(feedbackMeta, q, selected);
    bindReviewFlagButtons(target);
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
    const wasUncertain = uncertainOptions.length > 0;
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
          ? `Alternativas marcadas con ?: ${uncertainOptions.join(', ')}`
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

  async function markAttemptUncertainAfterFeedback(attemptId, q, selected) {
    if (!attemptId) return null;
    const idx = attempts.findIndex(a => a.id === attemptId);
    if (idx < 0) return null;

    const current = attempts[idx];
    const existingOptions = Array.isArray(current.uncertain_options) ? current.uncertain_options : [];
    const uncertainOptions = [...new Set([...existingOptions, ...(selected ? [selected] : [])])];
    const previousNote = String(current.uncertainty_note || '').trim();
    const marker = 'POST_ANSWER_REASONING_MISMATCH';
    const uncertaintyNote = previousNote.includes(marker)
      ? previousNote
      : [previousNote, marker].filter(Boolean).join(' | ');

    const changes = {
      was_uncertain: true,
      uncertain_options: uncertainOptions,
      uncertainty_note: uncertaintyNote,
      memory_rating: current.is_correct ? Math.min(Number(current.memory_rating || 4), 2) : 1,
      speed_bucket: current.is_correct ? 'uncertain_correct' : 'uncertain_incorrect',
    };

    let updated;
    if (cloudConfigured) {
      const { data, error } = await supa.from('attempts')
        .update(changes)
        .eq('id', attemptId)
        .eq('user_id', user.id)
        .select()
        .single();
      if (error) {
        console.warn('No se pudo registrar la duda posterior:', error.message);
        return null;
      }
      updated = data;
    } else {
      updated = { ...current, ...changes };
    }

    attempts[idx] = updated;
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
      index:0,
      responses,
      scratch:state.scratch || {},
      marked:state.marked || {},
      optionOrders:state.optionOrders || {},
      shuffleOptions:row.config?.shuffleOptions !== false && row.config?.examLayout !== 'paper',
      attemptsByQuestion,
      returnDate:returnDate || isoDateLocal(row.completed_at || row.updated_at),
    };
    renderReviewQuestion();
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

  function downloadReviewFlagsCsv(type = 'all', view = 'open') {
    const entries = reviewFlagEntries(type, view);
    if (!entries.length) return;
    const rows = [
      ['estado','flag','id','año','prueba','numero_pregunta','area','especialidad','tema','entidad','observacion_usuario','enunciado','content_revision','creado_en','actualizado_en','resuelto_en','patch_id','resumen_resolucion','registro_anterior'],
      ...entries.map(({ flag, q }) => [
        reviewFlagStateMeta(flag).label,
        reviewFlagMeta(flag.flag_type).label,
        q.id,
        q.year,
        q.test,
        q.question_number,
        q.area,
        q.specialty,
        q.topic,
        q.subtopic,
        flag.user_note,
        q.question,
        flag.content_revision,
        flag.created_at,
        flag.updated_at,
        flag.resolved_at,
        flag.resolved_by_patch_id,
        flag.resolution_summary,
        flag.previous_flag_id,
      ]),
    ];
    const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${view === 'history' ? 'historial_observaciones' : 'preguntas_marcadas_revision'}_${isoDateLocal()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
        <div class="review-flags-actions"><button id="copy-review-flags" class="btn primary" type="button" ${entries.length?'':'disabled'}>Copiar ${isHistory ? 'historial' : 'lista'}</button><button id="download-review-flags" class="btn" type="button" ${entries.length?'':'disabled'}>Descargar CSV</button></div>
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
        <div class="section-head review-flags-filter-head"><div><h2>${isHistory ? 'Observaciones cerradas' : 'Lista marcada'}</h2><p class="muted">${isHistory ? 'Una nueva marca sobre la misma pregunta crea otro registro enlazado.' : 'Una pregunta conserva un solo motivo activo; puedes cambiarlo desde la corrección.'}</p></div>
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
            <div class="review-flag-card-head"><div class="meta-line"><span class="tag ${state.className}">${state.icon} ${esc(state.label)}</span><span class="tag warn">${meta.icon} ${esc(meta.label)}</span>${questionSourceTag(q)}<span class="tag">${esc(q.id)}</span></div>${isHistory ? '' : `<div class="review-flag-card-actions"><button class="btn small primary" type="button" data-resolve-review-flag-list="${esc(q.id)}">Registrar parche</button><button class="btn small danger ghost-danger" type="button" data-remove-review-flag-list="${esc(q.id)}">Quitar</button></div>`}</div>
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
    document.getElementById('copy-review-flags').onclick = () => copyReviewFlagsReport(type, view);
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

  function renderTopicCoverageDetail(topicKey, returnSort = 'rentability', returnView = 'topics') {
    clearTimer();
    const coverage = W3Tools.buildCoverageSnapshot
      ? W3Tools.buildCoverageSnapshot(questions, attempts, memoryStates, new Date())
      : { topics:[] };
    const topic = coverage.topics.find(item => item.key === topicKey);
    if (!topic) return renderStats(returnSort, returnView);
    const topicQuestions = topic.questionIds.map(id => questions.find(q => q.id === id)).filter(Boolean);
    const seen = new Set(attempts.map(a => a.question_id));
    const correctEver = new Set(attempts.filter(a => a.is_correct).map(a => a.question_id));

    app.innerHTML = `<main class="shell">${topbar('Detalle de tema', true)}
      <section class="panel topic-coverage-detail-head">
        <button id="coverage-back" class="btn small ghost" type="button">← Volver a Mi estado</button>
        <div class="meta-line"><span class="tag">${esc(topicTierLabel(topic.tier))}</span>${topic.score != null ? `<span class="tag">Rentabilidad ${Math.round(topic.score)}</span>` : ''}</div>
        <h2>${esc(topic.label)}</h2><p class="muted">${esc(topic.area)} → ${esc(topic.specialty)}</p>
        <div class="coverage-detail-kpis"><span><strong>${topic.seen}/${topic.total}</strong> vistas</span><span><strong>${topic.correctEver}/${topic.total}</strong> acertadas alguna vez</span><span><strong>${topic.overdue}</strong> vencidas</span><span><strong>${topic.uncertainAttempts}</strong> intentos dudosos</span></div>
        <div class="footer-actions"><button id="topic-unseen-session" class="btn primary" ${topic.seen===topic.total?'disabled':''}>Practicar no vistas</button><button id="topic-all-session" class="btn">Crear sesión del tema</button></div>
      </section>
      <section class="panel"><h2>Preguntas del tema</h2><div class="topic-question-list">${topicQuestions.map(q => `<article><div><strong>${esc(q.id)}</strong><span class="tag ${!seen.has(q.id)?'':'ok'}">${!seen.has(q.id)?'No vista':correctEver.has(q.id)?'Acertada alguna vez':'Vista sin acierto'}</span></div><p>${esc(q.question)}</p></article>`).join('')}</div></section>
    </main>`;
    attachTopbar();
    document.getElementById('coverage-back').onclick = () => renderStats(returnSort, returnView);
    document.getElementById('topic-all-session').onclick = () => launchStudy(topicQuestions, { mode:'study', count:topicQuestions.length, randomize:false, feedback:'end', timeMode:'none', secondsPerQuestion:Number(profile?.target_response_seconds||25), totalSeconds:0, title:topic.label, studyMode:'topic_coverage', shuffleOptions:true });
    const unseenButton = document.getElementById('topic-unseen-session');
    if (unseenButton) unseenButton.onclick = () => {
      const pool = topicQuestions.filter(q => !seen.has(q.id));
      if (pool.length) launchStudy(pool, { mode:'study', count:pool.length, randomize:false, feedback:'end', timeMode:'none', secondsPerQuestion:Number(profile?.target_response_seconds||25), totalSeconds:0, title:`No vistas · ${topic.label}`, studyMode:'topic_unseen', shuffleOptions:true });
    };
  }

  function specialtyRentabilityTier(score, topics = []) {
    if (Number.isFinite(score)) {
      if (score >= 75) return 'MUY_ALTA';
      if (score >= 60) return 'ALTA';
      if (score >= 40) return 'MEDIA';
      return 'BAJA';
    }
    const rank = W3Tools.TIER_ORDER || { MUY_ALTA:0, ALTA:1, MEDIA:2, BAJA:3, SIN_CLASIFICAR:4 };
    return [...topics].sort((a,b) => (rank[a.tier] ?? 4) - (rank[b.tier] ?? 4))[0]?.tier || 'SIN_CLASIFICAR';
  }

  function buildSpecialtyCoverageGroups(topics = []) {
    const groups = new Map();
    for (const topic of topics) {
      const key = `${topic.area}|||${topic.specialty}`;
      if (!groups.has(key)) groups.set(key, {
        key, area:topic.area, specialty:topic.specialty, topics:[], total:0, seen:0,
        correctEver:0, attempts:0, correctAttempts:0, uncertainAttempts:0, overdue:0,
        scoreWeight:0, scoreTotal:0,
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
        tier:specialtyRentabilityTier(score, orderedTopics),
        coverage:group.total ? group.seen / group.total : 0,
        accuracy:group.attempts ? group.correctAttempts / group.attempts : null,
      };
    }).sort((a,b) => localeSort(a.area,b.area) || (b.score ?? -1) - (a.score ?? -1) || localeSort(a.specialty,b.specialty));
  }

  function topicCoverageTableMarkup(topics = []) {
    return `<div class="table-wrap"><table class="topic-coverage-table"><thead><tr><th>Tema</th><th>Rentabilidad</th><th class="num">Vistas</th><th class="num">Total</th><th class="num">Cobertura</th><th class="num">Dudas</th><th class="num">Vencidas</th></tr></thead><tbody>${topics.map(topic => `<tr class="clickable-row" data-topic-coverage-key="${esc(topic.key)}" tabindex="0"><td><strong>${esc(topic.label)}</strong><small>${esc(topic.area)} · ${esc(topic.specialty)}</small></td><td><span class="tag">${esc(topicTierLabel(topic.tier))}</span>${topic.score != null ? `<small>${Math.round(topic.score)}</small>` : ''}</td><td class="num">${topic.seen}</td><td class="num">${topic.total}</td><td class="num">${Math.round(topic.coverage*100)}%</td><td class="num">${topic.uncertainAttempts}</td><td class="num">${topic.overdue}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function specialtyCoverageMarkup(groups = []) {
    return `<p class="muted specialty-coverage-note">La rentabilidad de cada especialidad es el promedio de los puntajes de sus temas, ponderado por el número de preguntas. Dentro de cada especialidad, los temas se ordenan por rentabilidad.</p><div class="specialty-coverage-list">${groups.map(group => `<details class="specialty-coverage-group"><summary><div><strong>${esc(group.specialty)}</strong><small>${esc(group.area)} · ${group.topics.length} tema${group.topics.length===1?'':'s'} · ${group.total} preguntas</small></div><div class="specialty-summary-metrics"><span class="tag">${esc(topicTierLabel(group.tier))}${group.score == null?'':` · ${Math.round(group.score)}`}</span><span>${group.seen}/${group.total} vistas · ${Math.round(group.coverage*100)}%</span><span>${group.overdue} vencidas</span></div></summary>${topicCoverageTableMarkup(group.topics)}</details>`).join('')}</div>`;
  }

  function renderStats(topicSort = 'rentability', coverageView = 'topics') {
    clearTimer();
    const coverage = W3Tools.buildCoverageSnapshot
      ? W3Tools.buildCoverageSnapshot(questions, attempts, memoryStates, new Date())
      : { totalQuestions:questions.length, seenQuestions:overallStats().answered, correctEverQuestions:new Set(attempts.filter(a=>a.is_correct).map(a=>a.question_id)).size, totalTopics:0, touchedTopics:0, completeTopics:0, topics:[] };
    const timeSummary = W3Tools.buildTimeSummary
      ? W3Tools.buildTimeSummary(attempts, completedSessions, questions.length, new Date())
      : { todayQuestions:dailyActual(isoDateLocal()), activeMsToday:attempts.filter(a=>isoDateLocal(a.answered_at)===isoDateLocal()).reduce((sum,a)=>sum+Number(a.response_time_ms||0),0), pacePerDay:sevenDayPace(), unseenQuestions:Math.max(0,questions.length-overallStats().answered), projectedDays:null };
    const sortedTopics = W3Tools.sortTopics ? W3Tools.sortTopics(coverage.topics, topicSort) : coverage.topics;
    const specialtyGroups = buildSpecialtyCoverageGroups(coverage.topics);
    const normalizedCoverageView = coverageView === 'specialties' ? 'specialties' : 'topics';
    const byArea = new Map();
    for (const q of questions) {
      const area = q.canonical_area || q.area || 'Sin área';
      if (!byArea.has(area)) byArea.set(area, { questions:0, attempts:0, correct:0 });
      byArea.get(area).questions++;
    }
    for (const a of attempts) {
      const q = questions.find(x => x.id === a.question_id); if (!q) continue;
      const area = q.canonical_area || q.area || 'Sin área';
      const g = byArea.get(area); g.attempts++; if (a.is_correct) g.correct++;
    }
    const hard = questions.map(q => ({ q, s:questionStats(q.id) })).filter(x => x.s.seen).sort((a,b) => (b.s.wrong/b.s.seen)-(a.s.wrong/a.s.seen)).slice(0,10);
    const s = overallStats();
    const overdueCount = memoryStates.filter(row => row.due_at && new Date(row.due_at) <= new Date()).length;

    app.innerHTML = `<main class="shell">${topbar('Mi estado', true)}
      <section class="panel stats-report-link"><div><h2>Informe dinámico de debilidades</h2><p class="muted">Separa cobertura, debilidad y rentabilidad. La cobertura se calcula localmente con el corpus y los intentos ya cargados.</p></div><div class="stats-link-actions"><button id="stats-weakness-report" class="btn primary">Ver informe</button><button id="stats-history" class="btn">🕘 Historial y ritmo</button></div></section>

      <section class="kpis coverage-kpis">
        <div class="kpi"><div class="value">${coverage.seenQuestions}/${coverage.totalQuestions}</div><div class="label">Preguntas vistas ≥1 vez</div></div>
        <div class="kpi"><div class="value">${coverage.correctEverQuestions}/${coverage.totalQuestions}</div><div class="label">Acertadas ≥1 vez</div></div>
        <div class="kpi"><div class="value">${coverage.touchedTopics}/${coverage.totalTopics}</div><div class="label">Temas tocados</div></div>
        <div class="kpi"><div class="value">${coverage.completeTopics}/${coverage.totalTopics}</div><div class="label">Temas con cobertura completa</div></div>
      </section>

      <section class="panel compact-time-panel"><div class="section-head"><div><h2>Ritmo útil</h2><p class="muted">Panel reducido para apoyar el banqueo, no para sustituir las proyecciones de Anki.</p></div></div><div class="compact-time-grid"><div><strong>${timeSummary.todayQuestions}</strong><span>preguntas hoy</span></div><div><strong>${formatHoursMinutes(timeSummary.activeMsToday)}</strong><span>tiempo activo hoy</span></div><div><strong>${timeSummary.pacePerDay.toFixed(1)}/día</strong><span>ritmo de 7 días</span></div><div><strong>${timeSummary.unseenQuestions}</strong><span>por ver</span></div><div><strong>${timeSummary.projectedDays == null ? '—' : `${timeSummary.projectedDays} días`}</strong><span>primera vuelta al ritmo actual</span></div><div><strong>${overdueCount}</strong><span>repasos vencidos</span></div></div></section>

      <section class="kpis secondary-stats-kpis"><div class="kpi"><div class="value">${attempts.length}</div><div class="label">Intentos</div></div><div class="kpi"><div class="value">${pct(s.correct,attempts.length)}</div><div class="label">Precisión oficial</div></div><div class="kpi"><div class="value">${pct(s.auditedCorrect,s.audited.length)}</div><div class="label">Dominio auditado</div></div><div class="kpi"><div class="value">${s.avg?`${(s.avg/1000).toFixed(1)} s`:'—'}</div><div class="label">Tiempo medio</div></div></section>

      <section class="stats-grid"><div class="panel"><h2>Por área</h2><div class="table-wrap"><table><thead><tr><th>Área</th><th class="num">Preg.</th><th class="num">Intentos</th><th class="num">Acierto</th></tr></thead><tbody>${[...byArea.entries()].sort().map(([area,g])=>`<tr><td>${esc(area)}</td><td class="num">${g.questions}</td><td class="num">${g.attempts}</td><td class="num">${pct(g.correct,g.attempts)}</td></tr>`).join('')}</tbody></table></div></div><div class="panel"><h2>Más difíciles</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Tema</th><th class="num">Fallos</th><th class="num">Vistas</th></tr></thead><tbody>${hard.map(({q,s})=>`<tr><td>${esc(q.id)}</td><td>${esc(q.rentability_topic_label || q.topic)}</td><td class="num">${s.wrong}</td><td class="num">${s.seen}</td></tr>`).join('')}</tbody></table></div></div></section>

      <section class="panel topic-coverage-panel"><div class="section-head topic-coverage-head"><div><h2>Cobertura canónica</h2><p class="muted">Este bloque queda al final de Mi estado. Puedes ver los 274 temas individualmente o agruparlos por especialidad sin perder el acceso al detalle.</p></div><div class="topic-coverage-controls"><label>Vista<select id="topic-coverage-view" class="input"><option value="topics" ${normalizedCoverageView==='topics'?'selected':''}>Temas individuales</option><option value="specialties" ${normalizedCoverageView==='specialties'?'selected':''}>Agrupado por especialidad</option></select></label>${normalizedCoverageView==='topics'?`<label>Orden<select id="topic-coverage-sort" class="input"><option value="rentability" ${topicSort==='rentability'?'selected':''}>Rentabilidad</option><option value="coverage" ${topicSort==='coverage'?'selected':''}>Menor cobertura</option><option value="weakness" ${topicSort==='weakness'?'selected':''}>Mayor debilidad</option><option value="alphabetical" ${topicSort==='alphabetical'?'selected':''}>Alfabético</option></select></label>`:''}</div></div>
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
  }

  init();
})();
