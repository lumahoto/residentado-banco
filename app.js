(() => {
  const app = document.getElementById('app');
  const cfg = window.APP_CONFIG || {};
  const APP_VERSION = '0.6.10';
  const cloudConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  const DEMO_KEY = 'residentado_piloto_attempts_v3';
  const DEMO_SESSIONS_KEY = 'residentado_piloto_sessions_v2';
  const DEMO_MEMORY_KEY = 'residentado_memory_state_v1';
  const DEMO_PROFILE_KEY = 'residentado_learning_profile_v1';

  let supa = null;
  let user = null;
  let questions = [];
  let attempts = [];
  let activeSessions = [];
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

  const observed = q => String(q.audit_status || '').startsWith('OBSERVADA');
  const caveat = q => q.audit_status === 'VALIDADA_CON_CAVEAT';

  const esc = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const localeSort = (a, b) => String(a || '').localeCompare(String(b || ''), 'es', { sensitivity:'base' });

  function topicPathParts(q) {
    const area = String(q?.area || 'Sin área').trim() || 'Sin área';
    const specialty = String(q?.specialty || 'General').trim() || 'General';
    const topic = String(q?.topic || q?.subtopic || 'Sin tema').trim() || 'Sin tema';
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

        return `<details class="topic-specialty-group" data-topic-specialty-wrap="${specialtyId}" open>
          <summary><span>${esc(specialty.name)}</span><small>${specialty.topics.length} tema${specialty.topics.length === 1 ? '' : 's'} · ${specialty.count} pregunta${specialty.count === 1 ? '' : 's'}</small></summary>
          <div class="topic-group-actions">
            <button type="button" class="topic-scope-btn" data-topic-select-specialty="${specialtyId}">Todos</button>
            <button type="button" class="topic-scope-btn" data-topic-clear-specialty="${specialtyId}">Ninguno</button>
          </div>
          <div class="topic-leaf-list">${topicsHtml}</div>
        </details>`;
      }).join('');

      return `<details class="topic-area-group" data-topic-area-wrap="${areaId}" open>
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
  function saveLocalSessions() { localStorage.setItem(DEMO_SESSIONS_KEY, JSON.stringify(activeSessions)); }


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

  async function init() {
    registerServiceWorker();
    if (!cloudConfigured) {
      questions = (window.PILOT_QUESTIONS || []).filter(q => String(q.active).toLowerCase() !== 'false');
      rebuildCorpusRentability();
      attempts = localAttempts();
      activeSessions = localSessions().filter(s => s.status === 'active');
      profile = localProfile();
      memoryStates = localMemory();
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

  async function loadCloudData() {
    clearTimer();
    app.innerHTML = `<div class="splash"><div class="logo-mark">R</div><p>Sincronizando…</p></div>`;

    const [qRes, aRes, pRes, mRes] = await Promise.all([
      fetchAllQuestions(),
      fetchAllAttempts(),
      supa.from('user_learning_profile').select('*').eq('user_id', user.id).maybeSingle(),
      fetchAllMemoryStates(),
    ]);

    if (qRes.error) { renderLogin(`Error al cargar preguntas: ${qRes.error.message}`); return; }
    if (aRes.error) { renderLogin(`Error al cargar progreso: ${aRes.error.message}`); return; }
    if (pRes.error) { renderFatal(`Falta aplicar la migración v0.5 en Supabase: ${pRes.error.message}`); return; }
    if (mRes.error) { renderFatal(`Falta aplicar la migración v0.5 en Supabase: ${mRes.error.message}`); return; }

    questions = qRes.data || [];
    rebuildCorpusRentability();
    attempts = aRes.data || [];
    memoryStates = mRes.data || [];
    rebuildMemoryMap();

    if (pRes.data) profile = { ...DEFAULT_PROFILE, ...pRes.data };
    else {
      const profileRow = { ...DEFAULT_PROFILE, user_id:user.id, updated_at:new Date().toISOString() };
      const { data, error } = await supa.from('user_learning_profile').insert(profileRow).select().single();
      if (error) { renderFatal(`No se pudo crear tu perfil de aprendizaje: ${error.message}`); return; }
      profile = { ...DEFAULT_PROFILE, ...data };
    }

    const sRes = await supa.from('practice_sessions').select('*').eq('status', 'active').order('updated_at', { ascending: false });
    activeSessions = sRes.error ? [] : (sRes.data || []);
    await reconcileMemoryFromAttempts();
    renderDashboard();
  }

  function topbar(title = 'Residentado', showHome = false) {
    return `<div class="topbar">
      <div class="logo-mark">R</div><div class="topbar-title-wrap"><h1>${esc(title)}</h1><small class="app-version">v${APP_VERSION}</small></div><div class="spacer"></div>
      ${showHome ? `<button class="btn small ghost" data-home>Inicio</button>` : ''}
      ${cloudConfigured ? `<div class="topbar-menu-wrap">
        <button id="account-menu-btn" class="btn small ghost icon-menu-btn" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="account-menu">⋮</button>
        <div id="account-menu" class="topbar-menu-popover" hidden>
          <button id="logout-btn" class="topbar-menu-item danger-menu-item" type="button">Salir de la cuenta</button>
        </div>
      </div>` : ''}
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

    const logout = document.getElementById('logout-btn');
    if (logout) logout.onclick = async () => {
      if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
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
      const area = q.area || 'Sin área';
      const specialty = q.specialty || 'Sin especialidad';
      const topic = q.topic || q.subtopic || 'Sin clasificar';
      const key = `${area}|||${specialty}|||${topic}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key, area, specialty, topic,
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
      };
    }).sort((a,b) =>
      b.score - a.score ||
      b.latestWrongUncertainRate - a.latestWrongUncertainRate ||
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
      'Empieza por la lógica de banqueo, luego comparación clave, algoritmos o puntos de corte y termina con trampas frecuentes.',
      'Define cualquier abreviatura la primera vez que aparezca y define también los epónimos.',
      'Cuando aparezcan fármacos, resume brevemente los mecanismos de acción diferenciales relevantes para examen.',
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
        </div>
        <div class="priority-reading-focus">
          <strong>Lee primero:</strong>
          ${focus}
        </div>
      </div>
      <div class="priority-reading-actions">
        <button id="${prefix}-copy" class="btn primary">📋 Copiar pedido de repaso</button>
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
            <th class="num">Cobertura</th><th>Evidencia</th><th></th>
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
      <div class="footer-actions"><button id="custom-practice" class="btn">⚙ Personalizar práctica</button><button id="weakness-report-btn" class="btn">📊 Informe dinámico de debilidades</button><button id="practice-exam" class="btn">📝 Crear simulacro</button></div></section>
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
      const selected = currentExam.state.responses[q.id] ?? null;
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
    return currentExam.questions.filter(q => currentExam.state.responses[q.id] != null).length;
  }

  function refreshHistoricalAnswerSheet() {
    const count = historicalAnsweredCount();
    const countEl = document.getElementById('historical-answered-count');
    if (countEl) countEl.textContent = String(count);
    for (let i = 0; i < currentExam.questions.length; i++) {
      const q = currentExam.questions[i];
      const selected = currentExam.state.responses[q.id] ?? null;
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
          <button id="historical-exit" class="btn small ghost">Salir y continuar después</button>
          <button id="historical-cancel" class="btn small danger ghost-danger">Cancelar</button>
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
        if (currentExam.state.responses[q.id] === letter) delete currentExam.state.responses[q.id];
        else currentExam.state.responses[q.id] = letter;
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

    document.getElementById('historical-exit').onclick = exitCurrentExam;
    document.getElementById('historical-cancel').onclick = cancelCurrentExam;

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

      ${plan.next ? `<button id="next-task-btn" class="next-task"><span><small>SIGUIENTE TAREA</small><strong>${esc(plan.next.label)}</strong><em>${plan.next.remaining} pendientes de este bloque</em></span><b>▶</b></button>` : `<div class="banner"><strong>Checklist principal completa.</strong> Usa Practicar para adelantar trabajo de mañana.</div>`}

      <section class="checklist panel"><div class="section-head"><div><h2>Checklist de hoy</h2><p class="muted">La app decide el orden. Tú solo ejecutas.</p></div></div>
        <div class="checklist-items">${plan.tasks.map(t => `<div class="check-item ${t.remaining===0?'done':''}"><span class="checkmark">${t.remaining===0?'✓':'○'}</span><div><strong>${esc(t.label)}</strong><small>${t.completed}/${t.count} completadas</small></div><button class="btn small" data-task="${t.id}" ${t.remaining===0?'disabled':''}>${t.remaining===0?'Hecho':'Empezar'}</button></div>`).join('')}</div>
      </section>

      ${activeSessions.length ? `<section class="panel active-sessions-panel">
        <div class="section-head"><div><h2>Sesiones en curso</h2><p class="muted">Reanuda o cancela para que no queden sesiones activas olvidadas.</p></div></div>
        <div class="active-session-list">
          ${activeSessions.map(s => `<div class="active-session-row">
            <div><strong>${esc(s.title || 'Simulacro')}</strong><small>${s.question_ids?.length || 0} preguntas · guardado ${new Date(s.updated_at || s.created_at || Date.now()).toLocaleString()}</small></div>
            <div class="active-session-actions"><button class="btn small primary" data-resume-session="${esc(s.id)}">Reanudar</button><button class="btn small danger" data-cancel-session="${esc(s.id)}">Cancelar</button></div>
          </div>`).join('')}
        </div>
      </section>` : ''}

      <section class="actions actions-main v05-actions">
        <button id="practice-btn" class="btn primary">⚡ PRACTICAR</button>
        <button id="review-btn" class="btn">🧠 REPASO INTELIGENTE</button>
        <button id="exam-btn" class="btn">📝 SIMULACRO</button>
        <button id="roadmap-btn" class="btn">📖 QUÉ VIENE DESPUÉS</button>
        <button id="stats-btn" class="btn">📊 MI ESTADO</button>
      </section>

      <section class="panel next-roadmap"><div><span class="roadmap-kicker">PRÓXIMAMENTE</span><strong>${esc(road.preRead || 'Clasificando próximos temas')}</strong><small>Prelectura ligera sugerida antes de que entre en el banqueo.</small></div><button id="roadmap-mini" class="btn small">Ver hoja de ruta</button></section>
    </main>`;

    attachTopbar();
    attachPriorityReadingAlert(readingAlert, 'dashboard-reading');
    if (plan.next) document.getElementById('next-task-btn').onclick = () => launchAutoTask(plan.next);
    document.querySelectorAll('[data-task]').forEach(btn => {
      const task = plan.tasks.find(t => t.id === btn.dataset.task);
      btn.onclick = () => launchAutoTask(task);
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
    document.querySelectorAll('[data-resume-session]').forEach(btn => {
      btn.onclick = () => {
        const row = activeSessions.find(s => s.id === btn.dataset.resumeSession);
        if (row) resumePersistentSession(row);
      };
    });
    document.querySelectorAll('[data-cancel-session]').forEach(btn => {
      btn.onclick = async () => {
        const row = activeSessions.find(s => s.id === btn.dataset.cancelSession);
        if (row) await abandonSessionRow(row, true);
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
              <small class="muted">La rentabilidad se estima automáticamente por frecuencia y recurrencia histórica de tema, especialidad y área en el corpus cargado (${corpusRentabilityMeta.yearsCount} años). No depende de cuántas preguntas hayas respondido.</small>
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
              <div class="topic-browser-help">Navega por Área → Especialidad → Tema o usa el buscador. Puedes dejar solo el tema que quieras practicar.</div>
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
      const pool = filterPool(config);
      const errorEl = document.getElementById('builder-error');
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

  function launchStudy(selected, config) {
    clearTimer();
    config = { shuffleOptions: true, ...config };
    currentStudy = {
      config,
      questions: selected,
      index: 0,
      responses: {},
      scratch: {},
      durations: {},
      optionOrders: createOptionOrders(selected, config.shuffleOptions !== false),
      totalRemaining: config.timeMode === 'total' ? config.totalSeconds : null,
    };
    renderStudyQuestion();
  }

  function studyCurrentQuestion() { return currentStudy?.questions[currentStudy.index]; }

  function cancelCurrentStudy() {
    if (!currentStudy) return renderDashboard();
    const answered = Object.values(currentStudy.responses || {}).filter(x => x && x.selected != null).length;
    const immediate = currentStudy.config.feedback === 'immediate';
    const message = immediate
      ? `¿Cancelar esta sesión?\n\nLas ${answered} preguntas ya respondidas y corregidas permanecerán registradas. La cola restante se descartará.`
      : `¿Cancelar esta sesión?\n\nSe descartarán las respuestas de esta sesión porque aún no fueron entregadas. No se añadirá ningún intento nuevo.`;
    if (!confirm(message)) return;
    clearTimer();
    currentStudy = null;
    renderDashboard();
  }


  function renderStudyQuestion() {
    clearTimer();
    scrollPageTop();
    const q = studyCurrentQuestion();
    if (!q) return finishStudy();
    questionStartedAt = performance.now();
    const selected = currentStudy.responses[q.id]?.selected || null;
    currentStudy.scratch ||= {};
    const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
    const opts = displayOptionList(q, currentStudy.optionOrders, currentStudy.config.shuffleOptions !== false);
    const baseTargetSeconds = Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25);
    const adaptiveTargetSeconds = effectiveTargetSeconds(q, baseTargetSeconds);
    const timerHtml = currentStudy.config.timeMode === 'per_question'
      ? `<div id="timer" class="timer">${formatTime(adaptiveTargetSeconds)}</div>`
      : currentStudy.config.timeMode === 'total'
        ? `<div id="timer" class="timer">${formatTime(currentStudy.totalRemaining)}</div>` : '';
    const targetTag = currentStudy.config.timeMode === 'none'
      ? `<span class="tag target-tag">🎯 ${adaptiveTargetSeconds} s objetivo</span>`
      : '';

    app.innerHTML = `<main class="shell">
      ${topbar(currentStudy.config.title, false)}
      <section class="panel question-card">
        <div class="progress"><div style="width:${(currentStudy.index/currentStudy.questions.length)*100}%"></div></div>
        <div class="q-head"><span class="tag">${currentStudy.index+1}/${currentStudy.questions.length}</span><span class="tag">${esc(q.year)} · ${esc(q.area)}</span><span class="tag">${esc(q.topic)}</span>${auditBadge(q)}${targetTag}${timerHtml}</div>
        <div class="q-body"><p class="q-text">${esc(q.question)}</p>
          <div class="uncertainty-hint">Marca <strong>?</strong> en cualquier alternativa que no domines del todo. No cambia tu respuesta; sí hace que el concepto vuelva antes al repaso.</div>
          <div class="options">${opts.map(o => optionWithUncertaintyButton(o, selected, uncertainOptions.includes(o.sourceLetter || o.letter))).join('')}</div>
          ${currentStudy.config.timeMode === 'none' ? `<div class="dont-know-row"><button id="dont-know-study" class="btn ghost dont-know-btn" type="button">🤷 No sé · mostrar respuesta</button><span class="muted">Cuenta como respuesta incorrecta explícita; no como pregunta en blanco.</span></div>` : ''}
        </div>
        <div id="feedback"></div>
      </section>
      ${currentStudy.config.feedback === 'end' ? `<div class="footer-actions"><button id="prev-study" class="btn ghost" ${currentStudy.index===0?'disabled':''}>← Anterior</button><button id="cancel-study" class="btn danger ghost-danger">Cancelar sesión</button><button id="next-study" class="btn primary">${currentStudy.index+1===currentStudy.questions.length?'Terminar':'Siguiente →'}</button></div>` : `<div class="footer-actions"><button id="cancel-study" class="btn danger ghost-danger">Cancelar sesión</button></div>`}
    </main>`;
    attachTopbar();

    document.querySelectorAll('.option').forEach(btn => btn.onclick = () => handleStudyAnswer(btn.dataset.letter));
    const dontKnowBtn = document.getElementById('dont-know-study');
    if (dontKnowBtn) dontKnowBtn.onclick = handleStudyDontKnow;
    document.querySelectorAll('[data-uncertain-letter]').forEach(btn => {
      btn.onclick = (ev) => {
        ev.stopPropagation();
        const letter = btn.dataset.uncertainLetter;
        currentStudy.scratch = toggleTentativeOption(currentStudy.scratch || {}, q.id, letter);
        const active = isOptionUncertain(currentStudy.scratch, q.id, letter);
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = active ? 'Quitar marca de duda' : 'Marcar esta alternativa con ?';
      };
    });
    document.getElementById('cancel-study').onclick = cancelCurrentStudy;
    if (currentStudy.config.feedback === 'end') {
      document.getElementById('prev-study').onclick = () => { saveStudyDuration(); currentStudy.index--; renderStudyQuestion(); };
      document.getElementById('next-study').onclick = () => {
        saveStudyDuration();
        if (currentStudy.index + 1 >= currentStudy.questions.length) finishStudy();
        else { currentStudy.index++; renderStudyQuestion(); }
      };
    }
    startStudyTimer();
  }

  function startStudyTimer() {
    if (currentStudy.config.timeMode === 'per_question') {
      const q = studyCurrentQuestion();
      const baseTargetSeconds = Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25);
      let remaining = effectiveTargetSeconds(q, baseTargetSeconds);
      updateTimer(remaining);
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
    if (!q) return;
    const elapsed = Math.max(0, Math.round(performance.now() - questionStartedAt));
    currentStudy.durations[q.id] = (currentStudy.durations[q.id] || 0) + elapsed;
    questionStartedAt = performance.now();
  }

  async function handleStudyAnswer(letter) {
    const q = studyCurrentQuestion();
    if (!q) return;
    saveStudyDuration();
    currentStudy.responses[q.id] = { selected: letter };

    if (currentStudy.config.feedback === 'immediate') {
      clearTimer();
      const isCorrect = letter === q.official_answer;
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      const savedAttempt = await recordSingleAttempt(
        q, letter, isCorrect, currentStudy.durations[q.id] || 0,
        currentStudy.config.studyMode || 'custom_study', false,
        {
          uncertainOptions,
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25)
        }
      );
      disableOptionsAndPaint(q, letter);
      document.querySelectorAll('.uncertainty-toggle').forEach(btn => btn.disabled = true);
      renderFeedback(q, letter, isCorrect, () => {
        currentStudy.index++;
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

    if (currentStudy.config.feedback === 'immediate') {
      clearTimer();
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      const savedAttempt = await recordSingleAttempt(
        q, null, false, currentStudy.durations[q.id] || 0,
        currentStudy.config.studyMode || 'custom_study', false,
        {
          uncertainOptions,
          dontKnow: true,
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25)
        }
      );
      disableOptionsAndPaint(q, null);
      document.querySelectorAll('.uncertainty-toggle').forEach(btn => btn.disabled = true);
      const dontKnowBtn = document.getElementById('dont-know-study');
      if (dontKnowBtn) dontKnowBtn.disabled = true;
      renderFeedback(
        q, null, false,
        () => { currentStudy.index++; renderStudyQuestion(); },
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
      if (currentStudy.index >= currentStudy.questions.length) finishStudy();
      else renderStudyQuestion();
    }
  }

  function handleStudyTimeout() {
    const q = studyCurrentQuestion();
    saveStudyDuration();
    currentStudy.responses[q.id] = { selected: null };
    if (currentStudy.config.feedback === 'immediate') {
      const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
      recordSingleAttempt(
        q, null, false, currentStudy.durations[q.id] || 0,
        currentStudy.config.studyMode || 'custom_study', true,
        {
          uncertainOptions,
          baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25)
        }
      ).then((savedAttempt) => {
        disableOptionsAndPaint(q, null);
        document.querySelectorAll('.uncertainty-toggle').forEach(btn => btn.disabled = true);
        renderFeedback(
          q, null, false,
          () => { currentStudy.index++; renderStudyQuestion(); },
          true, false, uncertainOptions,
          {
            attemptId: savedAttempt?.id || null,
            responseTimeMs: currentStudy.durations[q.id] || 0,
            targetSeconds: Number(savedAttempt?.target_seconds || effectiveTargetSeconds(q, currentStudy.config.secondsPerQuestion)),
            wasUncertainAtAnswer: Boolean(savedAttempt?.was_uncertain),
          }
        );
      });
    } else {
      currentStudy.index++;
      if (currentStudy.index >= currentStudy.questions.length) finishStudy();
      else renderStudyQuestion();
    }
  }

  async function finishStudy(timeExpired = false) {
    clearTimer();
    if (!currentStudy) return renderDashboard();
    saveStudyDuration();

    if (currentStudy.config.feedback === 'end') {
      // En sesiones con corrección al final, las preguntas en blanco forman parte
      // del resultado de la sesión, pero no se guardan como intentos de aprendizaje.
      const payload = currentStudy.questions
        .filter(q => currentStudy.responses[q.id]?.selected != null || currentStudy.responses[q.id]?.didNotKnow)
        .map(q => {
          const selected = currentStudy.responses[q.id].selected;
          const didNotKnow = Boolean(currentStudy.responses[q.id]?.didNotKnow);
          const uncertainOptions = uncertaintyOptionsFor(currentStudy.scratch, q.id);
          return makeAttempt(
            q, selected, !didNotKnow && selected === q.official_answer,
            currentStudy.durations[q.id] || 0,
            currentStudy.config.studyMode || 'custom_study_end', false,
            {
              uncertainOptions,
              dontKnow: didNotKnow,
              baseTargetSeconds: Number(currentStudy.config.secondsPerQuestion || profile?.target_response_seconds || 25)
            }
          );
        });
      await recordAttemptsBatch(payload);
    }

    const result = currentStudy.questions.map(q => {
      const response = currentStudy.responses[q.id] || {};
      const selected = response.selected ?? null;
      return { q, selected, didNotKnow:Boolean(response.didNotKnow), correct: !response.didNotKnow && selected === q.official_answer };
    });
    const correct = result.filter(r => r.correct).length;
    const uncertainCount = currentStudy.questions.filter(q => uncertaintyOptionsFor(currentStudy.scratch, q.id).length > 0).length;
    reviewContext = {
      type: 'study',
      questions: currentStudy.questions,
      responses: currentStudy.responses,
      scratch: currentStudy.scratch || {},
      optionOrders: currentStudy.optionOrders || {},
      shuffleOptions: currentStudy.config.shuffleOptions !== false,
      index: 0
    };

    app.innerHTML = `<main class="shell">${topbar('Sesión terminada', true)}<section class="panel empty"><h2>${timeExpired ? 'Tiempo terminado' : 'Sesión completada'}</h2><p class="score-big">${correct}/${result.length}</p><p>${pct(correct, result.length)} de aciertos · ${uncertainCount} preguntas con duda registrada</p><div class="actions"><button id="review-btn" class="btn">Revisar respuestas</button><button class="btn primary" data-home>Volver al inicio</button></div></section></main>`;
    attachTopbar();
    document.getElementById('review-btn').onclick = () => renderReviewQuestion();
  }

  async function launchExam(selected, config) {
    clearTimer();
    config = { shuffleOptions: true, ...config };
    const state = {
      currentIndex: 0,
      responses: {},
      marked: {},
      scratch: {},
      timeSpent: {},
      optionOrders: createOptionOrders(
        selected,
        config.shuffleOptions !== false && config.examLayout !== 'paper'
      ),
      remainingSeconds: config.totalSeconds,
      breakTaken: false,
    };

    let sessionRow = null;
    if (cloudConfigured) {
      const { data, error } = await supa.from('practice_sessions').insert({
        user_id: user.id,
        mode: 'exam',
        title: config.title,
        config,
        question_ids: selected.map(q => q.id),
        state,
        status: 'active',
        updated_at: new Date().toISOString(),
      }).select().single();
      if (error) {
        alert(`No se pudo crear la sesión persistente: ${error.message}. Ejecuta la migración v0.4 en Supabase.`);
        return;
      }
      sessionRow = data;
      activeSessions.unshift(data);
    } else {
      sessionRow = { id: crypto.randomUUID(), mode: 'exam', title: config.title, config, question_ids: selected.map(q=>q.id), state, status:'active', updated_at:new Date().toISOString() };
      activeSessions.unshift(sessionRow); saveLocalSessions();
    }

    currentExam = { row: sessionRow, config, questions: selected, state };
    if (config.examLayout === 'paper') renderHistoricalExamPaper();
    else renderExamQuestion();
  }

  async function resumePersistentSession(row) {
    const selected = (row.question_ids || []).map(id => questions.find(q => q.id === id)).filter(Boolean);
    if (!selected.length) return renderMessage('No se pudo reanudar', 'Las preguntas de la sesión ya no están disponibles.');
    currentExam = { row, config: row.config || {}, questions: selected, state: row.state || {} };
    currentExam.state.responses ||= {};
    currentExam.state.marked ||= {};
    currentExam.state.scratch ||= {};
    currentExam.state.timeSpent ||= {};
    currentExam.state.optionOrders ||= createOptionOrders(
      selected,
      currentExam.config.shuffleOptions !== false && currentExam.config.examLayout !== 'paper'
    );
    currentExam.state.currentIndex ||= 0;
    currentExam.state.remainingSeconds ??= currentExam.config.totalSeconds || 0;
    if (currentExam.config.examLayout === 'paper') renderHistoricalExamPaper();
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
    if (!currentExam) return;
    currentExam.row.state = currentExam.state;
    currentExam.row.updated_at = new Date().toISOString();
    if (cloudConfigured) {
      await supa.from('practice_sessions').update({ state: currentExam.state, updated_at: currentExam.row.updated_at }).eq('id', currentExam.row.id);
    } else {
      const idx = activeSessions.findIndex(s => s.id === currentExam.row.id);
      if (idx >= 0) activeSessions[idx] = currentExam.row;
      saveLocalSessions();
    }
  }


  async function abandonSessionRow(row, returnHome = false) {
    if (!row) return;
    if (!confirm(`¿Cancelar "${row.title || 'esta sesión'}"?\n\nSe eliminará de las sesiones en curso. Las respuestas de este simulacro que aún no hayan sido entregadas NO contarán como intentos.`)) return;

    const now = new Date().toISOString();
    if (cloudConfigured) {
      const { error } = await supa.from('practice_sessions')
        .update({ status:'abandoned', updated_at:now })
        .eq('id', row.id);
      if (error) {
        alert(`No se pudo cancelar la sesión: ${error.message}`);
        return;
      }
    } else {
      const idx = activeSessions.findIndex(s => s.id === row.id);
      if (idx >= 0) activeSessions[idx] = { ...activeSessions[idx], status:'abandoned', updated_at:now };
      saveLocalSessions();
    }

    activeSessions = activeSessions.filter(s => s.id !== row.id);
    if (currentExam?.row?.id === row.id) currentExam = null;
    if (returnHome) renderDashboard();
  }

  async function exitCurrentExam() {
    if (!currentExam) return renderDashboard();
    clearTimer();
    accumulateExamTime();
    await persistExamState();
    currentExam = null;
    renderDashboard();
  }

  async function cancelCurrentExam() {
    if (!currentExam) return renderDashboard();
    clearTimer();
    accumulateExamTime();
    await abandonSessionRow(currentExam.row, true);
  }

  function renderExamQuestion() {
    clearTimer();
    scrollPageTop();
    const q = currentExam.questions[currentExam.state.currentIndex];
    const selected = currentExam.state.responses[q.id] ?? null;
    const marked = Boolean(currentExam.state.marked[q.id]);
    currentExam.state.scratch ||= {};
    const uncertainOptions = uncertaintyOptionsFor(currentExam.state.scratch, q.id);
    examQuestionEnteredAt = performance.now();

    app.innerHTML = `<main class="shell exam-shell">
      ${topbar(currentExam.config.title || 'Simulacro', false)}
      <section class="exam-layout">
        <div class="panel question-card">
          <div class="progress"><div style="width:${(currentExam.state.currentIndex/currentExam.questions.length)*100}%"></div></div>
          <div class="q-head"><span class="tag">${currentExam.state.currentIndex+1}/${currentExam.questions.length}</span><span class="tag">${esc(q.year)} · ${esc(q.area)}</span><div id="timer" class="timer">${formatTime(currentExam.state.remainingSeconds)}</div></div>
          <div class="q-body"><p class="q-text">${esc(q.question)}</p>
            <div class="uncertainty-hint">Puedes marcar <strong>?</strong> en una o varias alternativas sin cambiar tu respuesta definitiva.</div>
            <div class="options">${displayOptionList(
              q,
              currentExam.state.optionOrders,
              currentExam.config.shuffleOptions !== false && currentExam.config.examLayout !== 'paper'
            ).map(o => optionWithUncertaintyButton(o, selected, uncertainOptions.includes(o.sourceLetter || o.letter))).join('')}</div>
          </div>
        </div>
        <aside class="panel exam-nav"><div class="exam-nav-head"><strong>Navegación</strong><button id="mark-btn" class="btn small ${marked?'warn-btn':''}">${marked?'⚑ Marcada':'⚐ Marcar'}</button></div><div class="question-grid">${currentExam.questions.map((x,i) => examGridButton(x,i)).join('')}</div><div class="legend"><span>● respondida</span><span>⚑ revisar</span></div></aside>
      </section>
      <div class="exam-controls">
        <button id="prev-exam" class="btn ghost" ${currentExam.state.currentIndex===0?'disabled':''}>← Anterior</button>
        <button id="exit-exam" class="btn ghost">Salir y continuar después</button>
        <button id="cancel-exam" class="btn danger ghost-danger">Cancelar simulacro</button>
        <button id="finish-exam" class="btn danger">Entregar examen</button>
        <button id="next-exam" class="btn primary">${currentExam.state.currentIndex+1===currentExam.questions.length?'Ir al final':'Siguiente →'}</button>
      </div>
    </main>`;
    attachTopbar();

    document.querySelectorAll('.option').forEach(btn => btn.onclick = async () => {
      currentExam.state.responses[q.id] = btn.dataset.letter;
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
    document.getElementById('mark-btn').onclick = async () => {
      currentExam.state.marked[q.id] = !currentExam.state.marked[q.id];
      await persistExamState();
      renderExamQuestion();
    };
    document.getElementById('prev-exam').onclick = async () => {
      accumulateExamTime();
      currentExam.state.currentIndex--;
      await persistExamState(); renderExamQuestion();
    };
    document.getElementById('next-exam').onclick = async () => {
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
    document.getElementById('exit-exam').onclick = exitCurrentExam;
    document.getElementById('cancel-exam').onclick = cancelCurrentExam;
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
    const answered = currentExam.state.responses[q.id] != null;
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
    app.innerHTML = `<main class="shell">${topbar('Descanso', false)}<section class="panel empty"><h2>Bloque 1 completado</h2><p>Has llegado a la pregunta ${done}. Tu progreso está guardado.</p><p class="muted">${currentExam.config.pauseDuringBreak ? 'El cronómetro está pausado durante este descanso.' : 'El cronómetro continúa corriendo.'}</p><div class="actions"><button id="continue-block" class="btn primary">Continuar con el siguiente bloque</button><button id="exit-break" class="btn ghost">Salir y continuar después</button><button id="cancel-break" class="btn danger ghost-danger">Cancelar simulacro</button></div></section></main>`;
    attachTopbar();
    if (!currentExam.config.pauseDuringBreak) startExamTimer();
    document.getElementById('continue-block').onclick = () => currentExam.config.examLayout === 'paper' ? renderHistoricalExamPaper() : renderExamQuestion();
    document.getElementById('exit-break').onclick = exitCurrentExam;
    document.getElementById('cancel-break').onclick = cancelCurrentExam;
  }

  function renderExamOverview() {
    clearTimer();
    accumulateExamTime();
    const answered = currentExam.questions.filter(q => currentExam.state.responses[q.id] != null).length;
    const marked = currentExam.questions.filter(q => currentExam.state.marked[q.id]).length;
    const uncertain = currentExam.questions.filter(q => Object.values(currentExam.state.scratch?.[q.id] || {}).includes('tentative')).length;
    app.innerHTML = `<main class="shell">${topbar('Revisión antes de entregar', false)}<section class="panel"><h2>Resumen del simulacro</h2><div class="kpis"><div class="kpi"><div class="value">${answered}</div><div class="label">Respondidas</div></div><div class="kpi"><div class="value">${currentExam.questions.length-answered}</div><div class="label">Sin responder</div></div><div class="kpi"><div class="value">${marked}</div><div class="label">Marcadas para revisar</div></div><div class="kpi"><div class="value">${uncertain}</div><div class="label">Dudosas (?)</div></div><div class="kpi"><div class="value">${formatTime(currentExam.state.remainingSeconds)}</div><div class="label">Tiempo restante</div></div></div><div class="question-grid overview-grid">${currentExam.questions.map((x,i) => examGridButton(x,i)).join('')}</div><div class="footer-actions"><button id="back-exam" class="btn ghost">Volver al examen</button><button id="cancel-overview" class="btn danger ghost-danger">Cancelar simulacro</button><button id="submit-exam" class="btn danger">Entregar y corregir</button></div></section></main>`;
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

  async function finishExam(timeExpired = false) {
    clearTimer();
    accumulateExamTime();
    const answeredForTiming = currentExam.questions.filter(q => currentExam.state.responses[q.id] != null).length;
    const elapsedSessionMs = Math.max(0, (Number(currentExam.config.totalSeconds || 0) - Number(currentExam.state.remainingSeconds || 0)) * 1000);
    const historicalAverageMs = answeredForTiming ? Math.round(elapsedSessionMs / answeredForTiming) : 0;
    const attemptMode = currentExam.config.studyMode || 'exam';
    // Las preguntas en blanco siguen contando como omitidas en el RESULTADO del simulacro,
    // pero NO se guardan como intentos de práctica ni alimentan el repaso espaciado.
    // Así, una maratón entregada con 20 respuestas suma 20 preguntas al volumen diario, no 200.
    const payload = currentExam.questions
      .filter(q => currentExam.state.responses[q.id] != null)
      .map(q => {
        const selected = currentExam.state.responses[q.id];
        const measuredMs = currentExam.state.timeSpent[q.id] || (currentExam.config.examLayout === 'paper' ? historicalAverageMs : 0);
        const uncertainOptions = Object.entries(currentExam.state.scratch?.[q.id] || {})
          .filter(([,state]) => state === 'tentative')
          .map(([letter]) => letter);
        return makeAttempt(q, selected, selected === q.official_answer, measuredMs, attemptMode, false, { uncertainOptions });
      });
    await recordAttemptsBatch(payload);

    if (cloudConfigured) {
      await supa.from('practice_sessions').update({ status:'completed', state: currentExam.state, completed_at:new Date().toISOString(), updated_at:new Date().toISOString() }).eq('id', currentExam.row.id);
    } else {
      const idx = activeSessions.findIndex(s => s.id === currentExam.row.id);
      if (idx >= 0) activeSessions[idx].status = 'completed';
      saveLocalSessions();
    }
    activeSessions = activeSessions.filter(s => s.id !== currentExam.row.id);

    const result = currentExam.questions.map(q => {
      const selected = currentExam.state.responses[q.id] ?? null;
      return { q, selected, correct: selected === q.official_answer };
    });
    const correct = result.filter(r => r.correct).length;
    const answered = result.filter(r => r.selected != null).length;
    reviewContext = {
      type:'exam',
      questions:currentExam.questions,
      responses:currentExam.state.responses,
      scratch:currentExam.state.scratch || {},
      marked:currentExam.state.marked || {},
      optionOrders: currentExam.state.optionOrders || {},
      shuffleOptions: currentExam.config.shuffleOptions !== false && currentExam.config.examLayout !== 'paper',
      index:0
    };

    app.innerHTML = `<main class="shell">${topbar('Resultado del simulacro', true)}<section class="panel empty"><h2>${timeExpired?'Tiempo agotado':'Simulacro entregado'}</h2><p class="score-big">${correct}/${result.length}</p><p>${pct(correct,result.length)} · ${answered} respondidas · ${result.length-answered} omitidas</p><div class="actions"><button id="review-btn" class="btn">Revisar pregunta por pregunta</button><button class="btn primary" data-home>Volver al inicio</button></div></section></main>`;
    attachTopbar();
    document.getElementById('review-btn').onclick = renderReviewQuestion;
  }

  function renderReviewQuestion() {
    clearTimer();
    scrollPageTop();
    const q = reviewContext.questions[reviewContext.index];
    const responseValue = reviewContext.responses[q.id];
    const selected = responseValue?.selected ?? responseValue ?? null;
    const didNotKnow = Boolean(responseValue?.didNotKnow);
    const correct = !didNotKnow && selected === q.official_answer;
    const uncertainOptions = Object.entries(reviewContext.scratch?.[q.id] || {})
      .filter(([,state]) => state === 'tentative')
      .map(([letter]) => letter);
    const reviewOptions = displayOptionList(q, reviewContext.optionOrders || {}, reviewContext.shuffleOptions !== false);
    app.innerHTML = `<main class="shell">${topbar('Revisión', true)}<section class="panel question-card"><div class="q-head"><span class="tag">${reviewContext.index+1}/${reviewContext.questions.length}</span><span class="tag">${esc(q.topic)}</span>${auditBadge(q)}${didNotKnow?'<span class="tag warn">🤷 No sé</span>':''}${uncertainOptions.length?'<span class="tag warn">❓ Duda registrada</span>':''}</div><div class="q-body"><p class="q-text">${esc(q.question)}</p><div class="options">${reviewOptions.map(o => {
      const sourceLetter = o.sourceLetter || o.letter;
      return `<div class="option ${sourceLetter===q.official_answer?'correct':sourceLetter===selected?'wrong':'dimmed'}"><span class="letter">${o.letter}</span><span>${esc(o.text)}</span></div>`;
    }).join('')}</div></div><div id="feedback"></div></section><div class="footer-actions"><button id="prev-review" class="btn ghost" ${reviewContext.index===0?'disabled':''}>← Anterior</button><button id="next-review" class="btn primary">${reviewContext.index+1===reviewContext.questions.length?'Terminar revisión':'Siguiente →'}</button></div></main>`;
    attachTopbar();
    const latestAttempt = attemptsForQuestion(q.id)
      .slice()
      .sort((a,b) => new Date(b.answered_at) - new Date(a.answered_at))[0] || null;
    renderFeedback(q, selected, correct, null, selected == null && !didNotKnow, true, uncertainOptions, {
      attemptId: latestAttempt?.id || null,
      responseTimeMs: Number(latestAttempt?.response_time_ms || 0),
      targetSeconds: Number(latestAttempt?.target_seconds || effectiveTargetSeconds(q)),
      wasUncertainAtAnswer: Boolean(latestAttempt?.was_uncertain),
      allowPostMark: !didNotKnow,
      didNotKnow,
    });
    document.getElementById('prev-review').onclick = () => { reviewContext.index--; renderReviewQuestion(); };
    document.getElementById('next-review').onclick = () => {
      if (reviewContext.index + 1 >= reviewContext.questions.length) renderDashboard();
      else { reviewContext.index++; renderReviewQuestion(); }
    };
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
    return ['A','B','C','D','E'].filter(l => q[`option_${l.toLowerCase()}`]).map(l => ({ letter:l, text:q[`option_${l.toLowerCase()}`] }));
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
    if (!text) return '';
    return `<div class="framework">${esc(text).split('\n').map(line => `<div>${line}</div>`).join('')}</div>`;
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
    const distractors = feedbackOptions
      .filter(o => (o.sourceLetter || o.letter) !== q.official_answer)
      .map(o => {
        const sourceLetter = o.sourceLetter || o.letter;
        const reason = q[`why_not_${sourceLetter.toLowerCase()}`];
        return reason ? `<p><strong>${o.letter}. ${esc(o.text)}:</strong> ${esc(reason)}</p>` : '';
      }).join('');

    target.innerHTML = `<div class="feedback">
      <h3>${feedbackMeta.didNotKnow ? '🤷 No sabía' : timedOut ? '⏱ Sin respuesta' : isCorrect ? '✅ Correcto' : '❌ Incorrecto'}</h3>
      ${selected ? `<p>Tu respuesta: <strong>${esc(selectedDisplayLetter)}. ${esc(q[`option_${selected.toLowerCase()}`])}</strong></p>` : ''}
      <p class="answer-line">Respuesta correcta: ${esc(officialDisplayLetter)}. ${esc(q.official_answer_text)}</p>
      ${responseSeconds != null ? `<div class="feedback-time ${timeState}">⏱ <strong>${esc(timeLabel)}</strong> · objetivo ${targetSeconds} s${responseSeconds <= targetSeconds ? ' · dentro del objetivo' : ' · el algoritmo registró la lentitud'}</div>` : ''}

      ${observed(q) ? `<div class="explain-block audit-box"><h4>⚠ Auditoría médica</h4><p><strong>Pregunta histórica observada: se conserva la clave oficial, pero no cuenta en dominio por defecto.</strong></p><p>${esc(q.audit_current_assessment || q.update_alert || '')}</p><p><strong>Criterio actual:</strong> ${esc(q.audit_current_answer || '')}</p></div>` : caveat(q) ? `<div class="explain-block"><h4>⚠ Precisión clínica</h4><p>${esc(q.audit_current_assessment || q.update_alert || '')}</p></div>` : ''}

      ${uncertainOptions.length ? `<div class="explain-block uncertainty-box"><h4>❓ Alternativas que marcaste como dudosas</h4><p>Esta pregunta se programará antes en tu repaso aunque la hayas acertado.</p>${uncertainOptions.map(letter => {
        const text = q[`option_${letter.toLowerCase()}`] || '';
        const reason = letter === q.official_answer ? (q.correct_explanation || '') : (q[`why_not_${letter.toLowerCase()}`] || '');
        const displayLetter = displayLetterFor(letter);
        return `<p><strong>${esc(displayLetter)}. ${esc(text)}</strong>${reason ? ` — ${esc(reason)}` : ''}</p>`;
      }).join('')}</div>` : ''}
      ${q.exam_logic ? `<div class="explain-block quick-logic"><h4>🧠 Lógica rápida</h4><p>${esc(q.exam_logic)}</p></div>` : ''}
      ${q.comparison_framework ? `<div class="explain-block"><h4>📊 ${esc(q.comparison_title || 'Comparación clave')}</h4>${frameworkHtml(q.comparison_framework)}</div>` : ''}
      <details class="explain-block" open><summary><strong>Por qué la clave es correcta</strong></summary><p>${esc(q.correct_explanation || '')}</p></details>
      <details class="explain-block"><summary><strong>Por qué no las otras</strong></summary>${distractors}</details>
      ${q.common_trap ? `<div class="explain-block trap"><h4>⚠ Trampa frecuente</h4><p>${esc(q.common_trap)}</p></div>` : ''}
      ${q.abbreviations ? `<div class="explain-block"><h4>🔤 Siglas y términos</h4><p>${esc(q.abbreviations)}</p></div>` : ''}
      ${q.exam_pearl ? `<div class="explain-block pearl"><h4>💡 Perla de examen</h4><p>${esc(q.exam_pearl)}</p></div>` : ''}
      ${q.memory_hook ? `<div class="explain-block memory"><h4>🪝 Gancho de memoria</h4><p>${esc(q.memory_hook)}</p></div>` : ''}
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

    const postBtn = document.getElementById('post-answer-uncertain');
    if (postBtn && !postBtn.disabled) {
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
    if (!reviewOnly && onNext) document.getElementById('next-feedback').onclick = onNext;
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

  async function recordSingleAttempt(q, selected, isCorrect, ms, mode, timedOut, meta = {}) {
    const attempt = makeAttempt(q, selected, isCorrect, ms, mode, timedOut, meta);
    let saved;
    if (cloudConfigured) {
      const { data, error } = await supa.from('attempts').insert({ ...attempt, user_id:user.id }).select().single();
      if (error) { alert(`No se pudo guardar el intento: ${error.message}`); return null; }
      saved = data; attempts.push(data);
    } else {
      saved = { id: crypto.randomUUID(), ...attempt };
      attempts.push(saved); saveLocalAttempts();
    }
    await applyAttemptsToMemory([saved]);
    return saved;
  }

  async function recordAttemptsBatch(payload) {
    if (!payload.length) return;
    let saved = [];
    if (cloudConfigured) {
      const rows = payload.map(a => ({ ...a, user_id:user.id }));
      const { data, error } = await supa.from('attempts').insert(rows).select();
      if (error) { alert(`No se pudieron guardar todos los intentos: ${error.message}`); return; }
      saved = data || []; attempts.push(...saved);
    } else {
      saved = payload.map(a => ({ id:crypto.randomUUID(), ...a }));
      attempts.push(...saved); saveLocalAttempts();
    }
    await applyAttemptsToMemory(saved);
  }

  function renderStats() {
    clearTimer();
    const byArea = new Map();
    for (const q of questions) if (!byArea.has(q.area)) byArea.set(q.area, { questions:0, attempts:0, correct:0 });
    for (const q of questions) byArea.get(q.area).questions++;
    for (const a of attempts) {
      const q = questions.find(x => x.id === a.question_id); if (!q) continue;
      const g = byArea.get(q.area); g.attempts++; if (a.is_correct) g.correct++;
    }
    const hard = questions
      .map(q => ({ q, s:questionStats(q.id) }))
      .filter(x => x.s.seen)
      .sort((a,b) => (b.s.wrong/b.s.seen)-(a.s.wrong/a.s.seen))
      .slice(0,10);
    const s = overallStats();

    app.innerHTML = `<main class="shell">${topbar('Estadísticas', true)}
      <section class="panel stats-report-link">
        <div>
          <h2>Informe dinámico de debilidades</h2>
          <p class="muted">Convierte errores, dudas ?, lentitud y repasos vencidos en una lista de temas priorizados que puedes copiar y pegar directamente en el chat.</p>
        </div>
        <button id="stats-weakness-report" class="btn primary">Ver informe</button>
      </section>

      <section class="kpis">
        <div class="kpi"><div class="value">${attempts.length}</div><div class="label">Intentos</div></div>
        <div class="kpi"><div class="value">${pct(s.correct,attempts.length)}</div><div class="label">Precisión oficial</div></div>
        <div class="kpi"><div class="value">${pct(s.auditedCorrect,s.audited.length)}</div><div class="label">Dominio auditado</div></div>
        <div class="kpi"><div class="value">${s.avg?`${(s.avg/1000).toFixed(1)} s`:'—'}</div><div class="label">Tiempo medio</div></div>
      </section>

      <section class="stats-grid">
        <div class="panel">
          <h2>Por área</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Área</th><th class="num">Preg.</th><th class="num">Intentos</th><th class="num">Acierto</th></tr></thead>
            <tbody>${[...byArea.entries()].sort().map(([area,g])=>`<tr><td>${esc(area)}</td><td class="num">${g.questions}</td><td class="num">${g.attempts}</td><td class="num">${pct(g.correct,g.attempts)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>

        <div class="panel">
          <h2>Más difíciles</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>Tema</th><th class="num">Fallos</th><th class="num">Vistas</th></tr></thead>
            <tbody>${hard.map(({q,s})=>`<tr><td>${esc(q.id)}</td><td>${esc(q.topic)}</td><td class="num">${s.wrong}</td><td class="num">${s.seen}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </section>
    </main>`;

    attachTopbar();
    document.getElementById('stats-weakness-report').onclick = renderWeaknessReport;
  }

  init();
})();
