(() => {
  const app = document.getElementById('app');
  const cfg = window.APP_CONFIG || {};
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

  function effectiveTargetSeconds(q) {
    const base = Number(profile?.target_response_seconds || 25);
    const len = String(q?.question || '').length;
    const readingFactor = clamp(Math.sqrt(Math.max(80, len) / 260), 0.85, 1.35);
    return base * readingFactor;
  }

  function speedBucket(q, responseMs, correct, timedOut = false) {
    if (timedOut) return 'timed_out';
    const sec = Number(responseMs || 0) / 1000;
    const target = Number(profile?.target_response_seconds || 25);
    if (!correct && sec <= target) return 'wrong_fast';
    if (!correct) return 'incorrect';
    if (sec <= target) return 'fluent';
    if (sec <= target * 1.6) return 'slow_correct';
    return 'very_slow_correct';
  }

  function memoryRating(q, responseMs, correct, timedOut = false) {
    if (!correct || timedOut) return 1;
    const sec = Number(responseMs || 0) / 1000;
    const target = Number(profile?.target_response_seconds || 25);
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
      stability = oldS > 0 ? Math.max(0.25, oldS * 0.35) : 0.25;
      difficulty = clamp(oldD + 0.8, 1, 10);
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
    if (rating === 1) intervalDays = Math.min(intervalDays, 0.25);
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
          memory_rating: a.memory_rating || memoryRating(q, a.response_time_ms, a.is_correct, a.timed_out),
          speed_bucket: a.speed_bucket || speedBucket(q, a.response_time_ms, a.is_correct, a.timed_out),
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

  async function loadCloudData() {
    clearTimer();
    app.innerHTML = `<div class="splash"><div class="logo-mark">R</div><p>Sincronizando…</p></div>`;

    const [qRes, aRes, pRes, mRes] = await Promise.all([
      supa.from('questions').select('*').eq('active', true).order('year', { ascending: false }).order('test').order('question_number'),
      supa.from('attempts').select('*').order('answered_at', { ascending: true }),
      supa.from('user_learning_profile').select('*').eq('user_id', user.id).maybeSingle(),
      supa.from('question_memory_state').select('*'),
    ]);

    if (qRes.error) { renderLogin(`Error al cargar preguntas: ${qRes.error.message}`); return; }
    if (aRes.error) { renderLogin(`Error al cargar progreso: ${aRes.error.message}`); return; }
    if (pRes.error) { renderFatal(`Falta aplicar la migración v0.5 en Supabase: ${pRes.error.message}`); return; }
    if (mRes.error) { renderFatal(`Falta aplicar la migración v0.5 en Supabase: ${mRes.error.message}`); return; }

    questions = qRes.data || [];
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
      <div class="logo-mark">R</div><h1>${esc(title)}</h1><div class="spacer"></div>
      ${showHome ? `<button class="btn small ghost" data-home>Inicio</button>` : ''}
      ${cloudConfigured ? `<button id="logout-btn" class="btn small ghost">Salir</button>` : ''}
    </div>`;
  }

  function attachTopbar() {
    document.querySelectorAll('[data-home]').forEach(b => b.onclick = renderDashboard);
    const logout = document.getElementById('logout-btn');
    if (logout) logout.onclick = async () => { await supa.auth.signOut(); user = null; renderLogin(); };
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
    const fluent = qa.filter(a => a.is_correct && Number(a.response_time_ms || 0) <= Number(profile?.target_response_seconds || 25)*1000).length;
    return { seen:qa.length, correct, wrong, avgMs, fluent };
  }

  function rentabilityWeight(q) {
    if (Number.isFinite(Number(q.rentability_score))) return clamp(Number(q.rentability_score), 0, 1);
    const tier = String(q.rentability_tier || q.rentability_status || '').toUpperCase();
    if (tier.includes('MUY_ALTA') || tier.includes('MUY ALTA')) return 1;
    if (tier.includes('ALTA')) return 0.85;
    if (tier.includes('MEDIA')) return 0.6;
    if (tier.includes('BAJA')) return 0.35;
    return 0.55;
  }

  function questionPriority(q, now = new Date()) {
    const s = extendedQuestionStats(q);
    const state = memoryByQuestion.get(q.id);
    const recall = estimateRecall(state, now);
    const retention = targetRetention(isoDateLocal(now));
    const duePressure = state
      ? Math.max(0, retention - recall) * 8 + Math.max(0, (now - new Date(state.due_at)) / 86400000) * 0.35
      : 2.2;
    const weakness = s.seen ? (s.wrong / s.seen) * 3.2 : 1.4;
    const speed = s.avgMs ? Math.max(0, (s.avgMs / 1000 - Number(profile?.target_response_seconds || 25)) / 15) : 0.8;
    const rent = rentabilityWeight(q) * 2.6;
    const unseen = s.seen ? 0 : 1.2;
    const wrongFast = attemptsForQuestion(q.id).some(a => a.speed_bucket === 'wrong_fast') ? 1.2 : 0;
    const observedPenalty = observed(q) ? -2.5 : 0;
    return duePressure + weakness + speed + rent + unseen + wrongFast + observedPenalty;
  }

  function smartPool(kind = 'priority') {
    const now = new Date();
    const nonObserved = questions.filter(q => !observed(q));
    if (kind === 'due') {
      return nonObserved.filter(q => {
        const st = memoryByQuestion.get(q.id);
        return st && new Date(st.due_at) <= now;
      }).sort((a,b)=>questionPriority(b,now)-questionPriority(a,now));
    }
    if (kind === 'new') return nonObserved.filter(q => !attempts.some(a => a.question_id === q.id)).sort((a,b)=>questionPriority(b,now)-questionPriority(a,now));
    if (kind === 'errors') {
      const ids = new Set(attempts.filter(a => !a.is_correct).map(a => a.question_id));
      return nonObserved.filter(q => ids.has(q.id)).sort((a,b)=>questionPriority(b,now)-questionPriority(a,now));
    }
    if (kind === 'speed') {
      return nonObserved.filter(q => {
        const s = extendedQuestionStats(q);
        return s.seen && (s.avgMs || 0) > Number(profile?.target_response_seconds || 25)*1000;
      }).sort((a,b) => (extendedQuestionStats(b).avgMs||0) - (extendedQuestionStats(a).avgMs||0));
    }
    if (kind === 'high') {
      const high = nonObserved.filter(q => rentabilityWeight(q) >= 0.8);
      return (high.length ? high : nonObserved).sort((a,b)=>questionPriority(b,now)-questionPriority(a,now));
    }
    return nonObserved.sort((a,b)=>questionPriority(b,now)-questionPriority(a,now));
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
    ];
    app.innerHTML = `<main class="shell">${topbar('Practicar', true)}
      <section class="panel"><h2>Práctica rápida</h2><p class="muted">La primera opción usa memoria, errores, lentitud y rentabilidad para decidir por ti.</p>
      <div class="practice-grid">${cards.map(c=>`<button class="practice-card" data-practice="${c.id}"><strong>${c.title}</strong><span>${c.detail}</span></button>`).join('')}</div>
      <div class="sprint-row"><button class="btn sprint" data-sprint="10">⚡ Sprint 10</button><button class="btn sprint" data-sprint="15">⚡ Sprint 15</button><button class="btn sprint" data-sprint="30">⚡ Sprint 30</button></div>
      <div class="footer-actions"><button id="custom-practice" class="btn">⚙ Personalizar práctica</button><button id="practice-exam" class="btn">📝 Crear simulacro</button></div></section>
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
    document.getElementById('practice-exam').onclick = () => renderSessionBuilder('exam');
  }

  function renderRoadmap() {
    clearTimer();
    const road = topicRoadmap();
    const list = items => items.length ? items.map(x=>`<li>${esc(x)}</li>`).join('') : '<li>Se completará al clasificar el banco completo.</li>';
    app.innerHTML = `<main class="shell">${topbar('Qué viene después', true)}
      <section class="roadmap-grid">
        <div class="panel roadmap-card"><span class="roadmap-kicker">HOY</span><h2>Prioridad actual</h2><ul>${list(road.today)}</ul></div>
        <div class="panel roadmap-card highlighted"><span class="roadmap-kicker">MAÑANA</span><h2>Prelectura recomendada</h2><ul>${list(road.tomorrow)}</ul></div>
        <div class="panel roadmap-card"><span class="roadmap-kicker">EN 2–3 DÍAS</span><h2>Próxima ola</h2><ul>${list(road.soon)}</ul></div>
      </section>
      <section class="panel preread"><h2>📖 Qué leer antes</h2>${road.preRead ? `<p><strong>${esc(road.preRead)}</strong> · 20–30 minutos de prelectura ligera.</p><p class="muted">Enfócate en:</p><ul>${road.focus.map(x=>`<li>${esc(x)}</li>`).join('') || '<li>diagnóstico, criterios, manejo y trampas frecuentes</li>'}</ul>` : '<p>Aún no hay suficiente clasificación temática.</p>'}<p class="muted">La finalidad es activar el esquema mental, no dominar el tema antes de banquearlo.</p></section>
    </main>`;
    attachTopbar();
  }

  function renderDashboard() {
    clearTimer();
    currentStudy = null;
    currentExam = null;
    reviewContext = null;
    const s = overallStats();
    const resumable = activeSessions[0] || null;
    const plan = buildTodayPlan();
    const status = pressureStatus(plan);
    const ready = readinessIndicator();
    const road = topicRoadmap();
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

      ${plan.next ? `<button id="next-task-btn" class="next-task"><span><small>SIGUIENTE TAREA</small><strong>${esc(plan.next.label)}</strong><em>${plan.next.remaining} pendientes de este bloque</em></span><b>▶</b></button>` : `<div class="banner"><strong>Checklist principal completa.</strong> Usa Practicar para adelantar trabajo de mañana.</div>`}

      <section class="checklist panel"><div class="section-head"><div><h2>Checklist de hoy</h2><p class="muted">La app decide el orden. Tú solo ejecutas.</p></div></div>
        <div class="checklist-items">${plan.tasks.map(t => `<div class="check-item ${t.remaining===0?'done':''}"><span class="checkmark">${t.remaining===0?'✓':'○'}</span><div><strong>${esc(t.label)}</strong><small>${t.completed}/${t.count} completadas</small></div><button class="btn small" data-task="${t.id}" ${t.remaining===0?'disabled':''}>${t.remaining===0?'Hecho':'Empezar'}</button></div>`).join('')}</div>
      </section>

      ${resumable ? `<section class="panel resume-card"><div><strong>Simulacro en curso</strong><div class="muted">${esc(resumable.title || 'Sesión')} · ${resumable.question_ids?.length || 0} preguntas</div></div><button id="resume-btn" class="btn primary">Reanudar</button></section>` : ''}

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
    document.getElementById('exam-btn').onclick = () => renderSessionBuilder('exam');
    document.getElementById('roadmap-btn').onclick = renderRoadmap;
    document.getElementById('roadmap-mini').onclick = renderRoadmap;
    document.getElementById('stats-btn').onclick = renderStats;
    if (resumable) document.getElementById('resume-btn').onclick = () => resumePersistentSession(resumable);
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
    const areas = [...new Set(questions.map(q => q.area).filter(Boolean))].sort();
    const topics = [...new Set(questions.map(q => q.topic).filter(Boolean))].sort();
    const years = [...new Set(questions.map(q => Number(q.year)))].sort((a,b) => a-b);
    const highCount = questions.filter(q => String(q.rentability_status || '').startsWith('ALTA')).length;
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
              <label>Rentabilidad<select id="rentability" class="input"><option value="all">Todas</option><option value="high" ${highCount ? '' : 'disabled'}>Alta rentabilidad${highCount ? '' : ' — disponible al analizar corpus'}</option></select></label>
            </fieldset>

            <fieldset><legend>Cantidad</legend>
              <label>Número de preguntas<input id="question-count" class="input" type="number" min="1" max="2000" value="${isExam ? 80 : 15}" required></label>
              <label><input id="randomize" type="checkbox" checked> Orden aleatorio</label>
            </fieldset>

            <fieldset><legend>Áreas</legend><div class="check-list" id="areas-list">${areas.map(a => `<label><input type="checkbox" name="area" value="${esc(a)}" checked> ${esc(a)}</label>`).join('')}</div></fieldset>
            <fieldset><legend>Años</legend><div class="check-list compact">${years.map(y => `<label><input type="checkbox" name="year" value="${y}" checked> ${y}</label>`).join('')}</div></fieldset>

            <fieldset class="wide"><legend>Temas específicos</legend>
              <div class="topic-tools"><button type="button" id="topics-all" class="btn small">Todos</button><button type="button" id="topics-none" class="btn small ghost">Ninguno</button></div>
              <div class="check-list topics">${topics.map(t => `<label><input type="checkbox" name="topic" value="${esc(t)}" checked> ${esc(t)}</label>`).join('')}</div>
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
    const allTopics = () => document.querySelectorAll('input[name="topic"]');
    document.getElementById('topics-all').onclick = () => allTopics().forEach(c => c.checked = true);
    document.getElementById('topics-none').onclick = () => allTopics().forEach(c => c.checked = false);

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
      poolType: document.getElementById('pool-type').value,
      rentability: document.getElementById('rentability').value,
      areas: checked('area'),
      years: checked('year').map(Number),
      topics: checked('topic'),
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
      if (config.topics.length && !config.topics.includes(q.topic)) return false;
      if (config.rentability === 'high' && !String(q.rentability_status || '').startsWith('ALTA')) return false;
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
    currentStudy = {
      config,
      questions: selected,
      index: 0,
      responses: {},
      durations: {},
      totalRemaining: config.timeMode === 'total' ? config.totalSeconds : null,
    };
    renderStudyQuestion();
  }

  function studyCurrentQuestion() { return currentStudy?.questions[currentStudy.index]; }

  function renderStudyQuestion() {
    clearTimer();
    const q = studyCurrentQuestion();
    if (!q) return finishStudy();
    questionStartedAt = performance.now();
    const selected = currentStudy.responses[q.id]?.selected || null;
    const opts = optionList(q);
    const timerHtml = currentStudy.config.timeMode === 'per_question'
      ? `<div id="timer" class="timer">${formatTime(currentStudy.config.secondsPerQuestion)}</div>`
      : currentStudy.config.timeMode === 'total'
        ? `<div id="timer" class="timer">${formatTime(currentStudy.totalRemaining)}</div>` : '';

    app.innerHTML = `<main class="shell">
      ${topbar(currentStudy.config.title, true)}
      <section class="panel question-card">
        <div class="progress"><div style="width:${(currentStudy.index/currentStudy.questions.length)*100}%"></div></div>
        <div class="q-head"><span class="tag">${currentStudy.index+1}/${currentStudy.questions.length}</span><span class="tag">${esc(q.year)} · ${esc(q.area)}</span><span class="tag">${esc(q.topic)}</span>${auditBadge(q)}${timerHtml}</div>
        <div class="q-body"><p class="q-text">${esc(q.question)}</p><div class="options">${opts.map(o => optionButton(o, selected)).join('')}</div></div>
        <div id="feedback"></div>
      </section>
      ${currentStudy.config.feedback === 'end' ? `<div class="footer-actions"><button id="prev-study" class="btn ghost" ${currentStudy.index===0?'disabled':''}>← Anterior</button><button id="next-study" class="btn primary">${currentStudy.index+1===currentStudy.questions.length?'Terminar':'Siguiente →'}</button></div>` : ''}
    </main>`;
    attachTopbar();

    document.querySelectorAll('.option').forEach(btn => btn.onclick = () => handleStudyAnswer(btn.dataset.letter));
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
      let remaining = currentStudy.config.secondsPerQuestion;
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
      await recordSingleAttempt(q, letter, isCorrect, currentStudy.durations[q.id] || 0, currentStudy.config.studyMode || 'custom_study', false);
      disableOptionsAndPaint(q, letter);
      renderFeedback(q, letter, isCorrect, () => {
        currentStudy.index++;
        renderStudyQuestion();
      });
    } else {
      document.querySelectorAll('.option').forEach(btn => btn.classList.toggle('selected', btn.dataset.letter === letter));
    }
  }

  function handleStudyTimeout() {
    const q = studyCurrentQuestion();
    saveStudyDuration();
    currentStudy.responses[q.id] = { selected: null };
    if (currentStudy.config.feedback === 'immediate') {
      recordSingleAttempt(q, null, false, currentStudy.durations[q.id] || 0, currentStudy.config.studyMode || 'custom_study', true).then(() => {
        disableOptionsAndPaint(q, null);
        renderFeedback(q, null, false, () => { currentStudy.index++; renderStudyQuestion(); }, true);
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
      const payload = currentStudy.questions.map(q => {
        const selected = currentStudy.responses[q.id]?.selected ?? null;
        return makeAttempt(q, selected, selected === q.official_answer, currentStudy.durations[q.id] || 0, currentStudy.config.studyMode || 'custom_study_end', selected == null);
      });
      await recordAttemptsBatch(payload);
    }

    const result = currentStudy.questions.map(q => {
      const selected = currentStudy.responses[q.id]?.selected ?? null;
      return { q, selected, correct: selected === q.official_answer };
    });
    const correct = result.filter(r => r.correct).length;
    reviewContext = { type: 'study', questions: currentStudy.questions, responses: currentStudy.responses, index: 0 };

    app.innerHTML = `<main class="shell">${topbar('Sesión terminada', true)}<section class="panel empty"><h2>${timeExpired ? 'Tiempo terminado' : 'Sesión completada'}</h2><p class="score-big">${correct}/${result.length}</p><p>${pct(correct, result.length)} de aciertos</p><div class="actions"><button id="review-btn" class="btn">Revisar respuestas</button><button class="btn primary" data-home>Volver al inicio</button></div></section></main>`;
    attachTopbar();
    document.getElementById('review-btn').onclick = () => renderReviewQuestion();
  }

  async function launchExam(selected, config) {
    clearTimer();
    const state = {
      currentIndex: 0,
      responses: {},
      marked: {},
      timeSpent: {},
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
    renderExamQuestion();
  }

  async function resumePersistentSession(row) {
    const selected = (row.question_ids || []).map(id => questions.find(q => q.id === id)).filter(Boolean);
    if (!selected.length) return renderMessage('No se pudo reanudar', 'Las preguntas de la sesión ya no están disponibles.');
    currentExam = { row, config: row.config || {}, questions: selected, state: row.state || {} };
    currentExam.state.responses ||= {};
    currentExam.state.marked ||= {};
    currentExam.state.timeSpent ||= {};
    currentExam.state.currentIndex ||= 0;
    currentExam.state.remainingSeconds ??= currentExam.config.totalSeconds || 0;
    renderExamQuestion();
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

  function renderExamQuestion() {
    clearTimer();
    const q = currentExam.questions[currentExam.state.currentIndex];
    const selected = currentExam.state.responses[q.id] ?? null;
    const marked = Boolean(currentExam.state.marked[q.id]);
    examQuestionEnteredAt = performance.now();

    app.innerHTML = `<main class="shell exam-shell">
      ${topbar(currentExam.config.title || 'Simulacro', false)}
      <section class="exam-layout">
        <div class="panel question-card">
          <div class="progress"><div style="width:${(currentExam.state.currentIndex/currentExam.questions.length)*100}%"></div></div>
          <div class="q-head"><span class="tag">${currentExam.state.currentIndex+1}/${currentExam.questions.length}</span><span class="tag">${esc(q.year)} · ${esc(q.area)}</span><div id="timer" class="timer">${formatTime(currentExam.state.remainingSeconds)}</div></div>
          <div class="q-body"><p class="q-text">${esc(q.question)}</p><div class="options">${optionList(q).map(o => optionButton(o, selected)).join('')}</div></div>
        </div>
        <aside class="panel exam-nav"><div class="exam-nav-head"><strong>Navegación</strong><button id="mark-btn" class="btn small ${marked?'warn-btn':''}">${marked?'⚑ Marcada':'⚐ Marcar'}</button></div><div class="question-grid">${currentExam.questions.map((x,i) => examGridButton(x,i)).join('')}</div><div class="legend"><span>● respondida</span><span>⚑ revisar</span></div></aside>
      </section>
      <div class="exam-controls"><button id="prev-exam" class="btn ghost" ${currentExam.state.currentIndex===0?'disabled':''}>← Anterior</button><button id="finish-exam" class="btn danger">Entregar examen</button><button id="next-exam" class="btn primary">${currentExam.state.currentIndex+1===currentExam.questions.length?'Ir al final':'Siguiente →'}</button></div>
    </main>`;
    attachTopbar();

    document.querySelectorAll('.option').forEach(btn => btn.onclick = async () => {
      currentExam.state.responses[q.id] = btn.dataset.letter;
      document.querySelectorAll('.option').forEach(b => b.classList.toggle('selected', b.dataset.letter === btn.dataset.letter));
      await persistExamState();
      refreshExamGridOnly();
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
    return `<button class="qnav ${answered?'answered':''} ${marked?'marked':''} ${current?'current':''}" data-qindex="${i}">${i+1}${marked?'⚑':''}</button>`;
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
    app.innerHTML = `<main class="shell">${topbar('Descanso', false)}<section class="panel empty"><h2>Bloque 1 completado</h2><p>Has llegado a la pregunta ${done}. Tu progreso está guardado.</p><p class="muted">${currentExam.config.pauseDuringBreak ? 'El cronómetro está pausado durante este descanso.' : 'El cronómetro continúa corriendo.'}</p><button id="continue-block" class="btn primary">Continuar con el siguiente bloque</button></section></main>`;
    attachTopbar();
    if (!currentExam.config.pauseDuringBreak) startExamTimer();
    document.getElementById('continue-block').onclick = () => renderExamQuestion();
  }

  function renderExamOverview() {
    clearTimer();
    accumulateExamTime();
    const answered = currentExam.questions.filter(q => currentExam.state.responses[q.id] != null).length;
    const marked = currentExam.questions.filter(q => currentExam.state.marked[q.id]).length;
    app.innerHTML = `<main class="shell">${topbar('Revisión antes de entregar', false)}<section class="panel"><h2>Resumen del simulacro</h2><div class="kpis"><div class="kpi"><div class="value">${answered}</div><div class="label">Respondidas</div></div><div class="kpi"><div class="value">${currentExam.questions.length-answered}</div><div class="label">Sin responder</div></div><div class="kpi"><div class="value">${marked}</div><div class="label">Marcadas</div></div><div class="kpi"><div class="value">${formatTime(currentExam.state.remainingSeconds)}</div><div class="label">Tiempo restante</div></div></div><div class="question-grid overview-grid">${currentExam.questions.map((x,i) => examGridButton(x,i)).join('')}</div><div class="footer-actions"><button id="back-exam" class="btn ghost">Volver al examen</button><button id="submit-exam" class="btn danger">Entregar y corregir</button></div></section></main>`;
    attachTopbar();
    document.querySelectorAll('[data-qindex]').forEach(btn => btn.onclick = () => { currentExam.state.currentIndex = Number(btn.dataset.qindex); renderExamQuestion(); });
    document.getElementById('back-exam').onclick = renderExamQuestion;
    document.getElementById('submit-exam').onclick = async () => {
      if (confirm('¿Entregar el simulacro? Después se mostrarán las respuestas y explicaciones.')) await finishExam(false);
    };
  }

  async function finishExam(timeExpired = false) {
    clearTimer();
    accumulateExamTime();
    const payload = currentExam.questions.map(q => {
      const selected = currentExam.state.responses[q.id] ?? null;
      return makeAttempt(q, selected, selected === q.official_answer, currentExam.state.timeSpent[q.id] || 0, 'exam', selected == null);
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
    reviewContext = { type:'exam', questions:currentExam.questions, responses:currentExam.state.responses, index:0 };

    app.innerHTML = `<main class="shell">${topbar('Resultado del simulacro', true)}<section class="panel empty"><h2>${timeExpired?'Tiempo agotado':'Simulacro entregado'}</h2><p class="score-big">${correct}/${result.length}</p><p>${pct(correct,result.length)} · ${answered} respondidas · ${result.length-answered} omitidas</p><div class="actions"><button id="review-btn" class="btn">Revisar pregunta por pregunta</button><button class="btn primary" data-home>Volver al inicio</button></div></section></main>`;
    attachTopbar();
    document.getElementById('review-btn').onclick = renderReviewQuestion;
  }

  function renderReviewQuestion() {
    clearTimer();
    const q = reviewContext.questions[reviewContext.index];
    const selected = reviewContext.responses[q.id]?.selected ?? reviewContext.responses[q.id] ?? null;
    const correct = selected === q.official_answer;
    app.innerHTML = `<main class="shell">${topbar('Revisión', true)}<section class="panel question-card"><div class="q-head"><span class="tag">${reviewContext.index+1}/${reviewContext.questions.length}</span><span class="tag">${esc(q.topic)}</span>${auditBadge(q)}</div><div class="q-body"><p class="q-text">${esc(q.question)}</p><div class="options">${optionList(q).map(o => `<div class="option ${o.letter===q.official_answer?'correct':o.letter===selected?'wrong':'dimmed'}"><span class="letter">${o.letter}</span><span>${esc(o.text)}</span></div>`).join('')}</div></div><div id="feedback"></div></section><div class="footer-actions"><button id="prev-review" class="btn ghost" ${reviewContext.index===0?'disabled':''}>← Anterior</button><button id="next-review" class="btn primary">${reviewContext.index+1===reviewContext.questions.length?'Terminar revisión':'Siguiente →'}</button></div></main>`;
    attachTopbar();
    renderFeedback(q, selected, correct, null, selected == null, true);
    document.getElementById('prev-review').onclick = () => { reviewContext.index--; renderReviewQuestion(); };
    document.getElementById('next-review').onclick = () => {
      if (reviewContext.index + 1 >= reviewContext.questions.length) renderDashboard();
      else { reviewContext.index++; renderReviewQuestion(); }
    };
  }

  function optionList(q) {
    return ['A','B','C','D','E'].filter(l => q[`option_${l.toLowerCase()}`]).map(l => ({ letter:l, text:q[`option_${l.toLowerCase()}`] }));
  }

  function optionButton(o, selected) {
    return `<button class="option ${selected===o.letter?'selected':''}" data-letter="${o.letter}"><span class="letter">${o.letter}</span><span>${esc(o.text)}</span></button>`;
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

  function renderFeedback(q, selected, isCorrect, onNext, timedOut = false, reviewOnly = false) {
    const target = document.getElementById('feedback');
    if (!target) return;
    const distractors = optionList(q).filter(o => o.letter !== q.official_answer).map(o => {
      const reason = q[`why_not_${o.letter.toLowerCase()}`];
      return reason ? `<p><strong>${o.letter}. ${esc(o.text)}:</strong> ${esc(reason)}</p>` : '';
    }).join('');

    target.innerHTML = `<div class="feedback">
      <h3>${timedOut ? '⏱ Sin respuesta' : isCorrect ? '✅ Correcto' : '❌ Incorrecto'}</h3>
      ${selected ? `<p>Tu respuesta: <strong>${esc(selected)}. ${esc(q[`option_${selected.toLowerCase()}`])}</strong></p>` : ''}
      <p class="answer-line">Clave oficial: ${esc(q.official_answer)}. ${esc(q.official_answer_text)}</p>

      ${observed(q) ? `<div class="explain-block audit-box"><h4>⚠ Auditoría médica</h4><p><strong>Pregunta histórica observada: se conserva la clave oficial, pero no cuenta en dominio por defecto.</strong></p><p>${esc(q.audit_current_assessment || q.update_alert || '')}</p><p><strong>Criterio actual:</strong> ${esc(q.audit_current_answer || '')}</p></div>` : caveat(q) ? `<div class="explain-block"><h4>⚠ Precisión clínica</h4><p>${esc(q.audit_current_assessment || q.update_alert || '')}</p></div>` : ''}

      ${q.exam_logic ? `<div class="explain-block quick-logic"><h4>🧠 Lógica rápida</h4><p>${esc(q.exam_logic)}</p></div>` : ''}
      ${q.comparison_framework ? `<div class="explain-block"><h4>📊 ${esc(q.comparison_title || 'Comparación clave')}</h4>${frameworkHtml(q.comparison_framework)}</div>` : ''}
      <details class="explain-block" open><summary><strong>Por qué la clave es correcta</strong></summary><p>${esc(q.correct_explanation || '')}</p></details>
      <details class="explain-block"><summary><strong>Por qué no las otras</strong></summary>${distractors}</details>
      ${q.common_trap ? `<div class="explain-block trap"><h4>⚠ Trampa frecuente</h4><p>${esc(q.common_trap)}</p></div>` : ''}
      ${q.abbreviations ? `<div class="explain-block"><h4>🔤 Siglas y términos</h4><p>${esc(q.abbreviations)}</p></div>` : ''}
      ${q.exam_pearl ? `<div class="explain-block pearl"><h4>💡 Perla de examen</h4><p>${esc(q.exam_pearl)}</p></div>` : ''}
      ${q.memory_hook ? `<div class="explain-block memory"><h4>🪝 Gancho de memoria</h4><p>${esc(q.memory_hook)}</p></div>` : ''}
      ${!reviewOnly && onNext ? `<div class="footer-actions"><button id="next-feedback" class="btn primary">Siguiente pregunta →</button></div>` : ''}
    </div>`;
    if (!reviewOnly && onNext) document.getElementById('next-feedback').onclick = onNext;
  }

  function makeAttempt(q, selected, isCorrect, responseTimeMs, studyMode, timedOut) {
    const target = Number(profile?.target_response_seconds || 25);
    const normalizedTarget = effectiveTargetSeconds(q);
    const state = memoryByQuestion.get(q.id);
    const answeredAt = new Date().toISOString();
    return {
      question_id: q.id,
      selected_answer: selected,
      is_correct: Boolean(isCorrect),
      response_time_ms: Math.max(0, Math.round(responseTimeMs || 0)),
      study_mode: studyMode,
      timed_out: Boolean(timedOut),
      memory_rating: memoryRating(q, responseTimeMs, isCorrect, timedOut),
      speed_bucket: speedBucket(q, responseTimeMs, isCorrect, timedOut),
      normalized_speed: Number(((Number(responseTimeMs||0)/1000) / Math.max(1, normalizedTarget)).toFixed(4)),
      target_seconds: target,
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

  async function recordSingleAttempt(q, selected, isCorrect, ms, mode, timedOut) {
    const attempt = makeAttempt(q, selected, isCorrect, ms, mode, timedOut);
    let saved;
    if (cloudConfigured) {
      const { data, error } = await supa.from('attempts').insert({ ...attempt, user_id:user.id }).select().single();
      if (error) { alert(`No se pudo guardar el intento: ${error.message}`); return; }
      saved = data; attempts.push(data);
    } else {
      saved = { id: crypto.randomUUID(), ...attempt };
      attempts.push(saved); saveLocalAttempts();
    }
    await applyAttemptsToMemory([saved]);
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
    const hard = questions.map(q => ({ q, s:questionStats(q.id) })).filter(x => x.s.seen).sort((a,b) => (b.s.wrong/b.s.seen)-(a.s.wrong/a.s.seen)).slice(0,10);
    const s = overallStats();
    app.innerHTML = `<main class="shell">${topbar('Estadísticas', true)}<section class="kpis"><div class="kpi"><div class="value">${attempts.length}</div><div class="label">Intentos</div></div><div class="kpi"><div class="value">${pct(s.correct,attempts.length)}</div><div class="label">Precisión oficial</div></div><div class="kpi"><div class="value">${pct(s.auditedCorrect,s.audited.length)}</div><div class="label">Dominio auditado</div></div><div class="kpi"><div class="value">${s.avg?`${(s.avg/1000).toFixed(1)} s`:'—'}</div><div class="label">Tiempo medio</div></div></section><section class="stats-grid"><div class="panel"><h2>Por área</h2><div class="table-wrap"><table><thead><tr><th>Área</th><th class="num">Preg.</th><th class="num">Intentos</th><th class="num">Acierto</th></tr></thead><tbody>${[...byArea.entries()].sort().map(([area,g])=>`<tr><td>${esc(area)}</td><td class="num">${g.questions}</td><td class="num">${g.attempts}</td><td class="num">${pct(g.correct,g.attempts)}</td></tr>`).join('')}</tbody></table></div></div><div class="panel"><h2>Más difíciles</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>Tema</th><th class="num">Fallos</th><th class="num">Vistas</th></tr></thead><tbody>${hard.map(({q,s})=>`<tr><td>${esc(q.id)}</td><td>${esc(q.topic)}</td><td class="num">${s.wrong}</td><td class="num">${s.seen}</td></tr>`).join('')}</tbody></table></div></div></section></main>`;
    attachTopbar();
  }

  init();
})();
