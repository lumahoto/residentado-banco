(() => {
  const app = document.getElementById("app");
  const cfg = window.APP_CONFIG || {};
  const cloudConfigured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY);
  const DEMO_KEY = "residentado_piloto_attempts_v1";

  let supa = null;
  let user = null;
  let questions = [];
  let attempts = [];
  let sessionQuestions = [];
  let sessionIndex = 0;
  let studyMode = "continue";
  let timerId = null;
  let timerStartedAt = 0;
  let timerSeconds = 20;
  let answeredCurrent = false;

  const observed = (q) => String(q.audit_status || "").startsWith("OBSERVADA");
  const caveat = (q) => q.audit_status === "VALIDADA_CON_CAVEAT";

  function esc(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pct(n, d) {
    if (!d) return "—";
    return `${Math.round((n / d) * 100)}%`;
  }

  function msToSec(ms) {
    if (ms == null) return "—";
    return `${(ms / 1000).toFixed(1)} s`;
  }

  function localAttempts() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY) || "[]"); }
    catch { return []; }
  }

  function saveLocalAttempts() {
    localStorage.setItem(DEMO_KEY, JSON.stringify(attempts));
  }

  async function init() {
    registerServiceWorker();

    if (!cloudConfigured) {
      questions = (window.PILOT_QUESTIONS || []).filter(q => String(q.active).toLowerCase() !== "false");
      attempts = localAttempts();
      renderDashboard();
      return;
    }

    if (!window.supabase?.createClient) {
      app.innerHTML = `<div class="login-wrap"><div class="panel login-card">
        <h2>No se pudo cargar Supabase</h2>
        <p class="muted">Comprueba tu conexión a internet y vuelve a cargar.</p>
      </div></div>`;
      return;
    }

    supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    const { data } = await supa.auth.getSession();
    user = data.session?.user || null;

    supa.auth.onAuthStateChange((_event, session) => {
      user = session?.user || null;
    });

    if (!user) renderLogin();
    else await loadCloudData();
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  function renderLogin(message = "") {
    app.innerHTML = `
      <div class="login-wrap">
        <div class="panel login-card">
          <div class="logo-mark">R</div>
          <h1>Residentado</h1>
          <p class="muted">Banco personal de preguntas. Tu progreso se guarda en tu cuenta.</p>
          <form id="login-form">
            <div class="form-row">
              <label for="email">Correo</label>
              <input class="input" id="email" type="email" autocomplete="email" required>
            </div>
            <div class="form-row">
              <label for="password">Contraseña</label>
              <input class="input" id="password" type="password" autocomplete="current-password" minlength="6" required>
            </div>
            <button class="btn primary" type="submit" style="width:100%">Iniciar sesión</button>
            ${cfg.ALLOW_SIGNUP ? `<button id="signup-btn" class="btn ghost" type="button" style="width:100%;margin-top:8px">Crear cuenta</button>` : ""}
            <div id="login-error" class="error-msg">${esc(message)}</div>
          </form>
        </div>
      </div>`;

    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;
      const errorEl = document.getElementById("login-error");
      errorEl.textContent = "Entrando…";
      const { error } = await supa.auth.signInWithPassword({ email, password });
      if (error) {
        errorEl.textContent = error.message;
        return;
      }
      const { data } = await supa.auth.getSession();
      user = data.session?.user || null;
      await loadCloudData();
    });

    const signup = document.getElementById("signup-btn");
    if (signup) {
      signup.addEventListener("click", async () => {
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const errorEl = document.getElementById("login-error");
        if (!email || password.length < 6) {
          errorEl.textContent = "Escribe un correo válido y una contraseña de al menos 6 caracteres.";
          return;
        }
        errorEl.textContent = "Creando cuenta…";
        const { error } = await supa.auth.signUp({ email, password });
        errorEl.textContent = error ? error.message : "Cuenta creada. Revisa tu correo si la confirmación está activada.";
      });
    }
  }

  async function loadCloudData() {
    app.innerHTML = `<div class="splash"><div class="logo-mark">R</div><p>Sincronizando…</p></div>`;
    const [qRes, aRes] = await Promise.all([
      supa.from("questions").select("*").eq("active", true).order("year", { ascending: false }).order("test").order("question_number"),
      supa.from("attempts").select("*").order("answered_at", { ascending: true })
    ]);

    if (qRes.error) {
      renderLogin(`Error al cargar preguntas: ${qRes.error.message}`);
      return;
    }
    if (aRes.error) {
      renderLogin(`Error al cargar progreso: ${aRes.error.message}`);
      return;
    }

    questions = qRes.data || [];
    attempts = aRes.data || [];
    renderDashboard();
  }

  function attemptStats() {
    const answeredIds = new Set(attempts.map(a => a.question_id));
    const correct = attempts.filter(a => a.is_correct).length;
    const masteryAttempts = attempts.filter(a => {
      const q = questions.find(x => x.id === a.question_id);
      return q && !observed(q);
    });
    const masteryCorrect = masteryAttempts.filter(a => a.is_correct).length;
    const avg = attempts.length
      ? attempts.reduce((s, a) => s + Number(a.response_time_ms || 0), 0) / attempts.length
      : null;
    return { answered: answeredIds.size, correct, masteryAttempts, masteryCorrect, avg };
  }

  function topbar(title = "Residentado") {
    return `
      <div class="topbar">
        <div class="logo-mark">R</div>
        <h1>${esc(title)}</h1>
        <div class="spacer"></div>
        ${cloudConfigured ? `<button id="logout-btn" class="btn small ghost">Salir</button>` : ""}
      </div>`;
  }

  function attachTopbar() {
    const logout = document.getElementById("logout-btn");
    if (logout) logout.addEventListener("click", async () => {
      await supa.auth.signOut();
      user = null;
      renderLogin();
    });
  }

  function renderDashboard() {
    clearTimer();
    const s = attemptStats();
    const officialAccuracy = pct(s.correct, attempts.length);
    const masteryAccuracy = pct(s.masteryCorrect, s.masteryAttempts.length);

    app.innerHTML = `
      <main class="shell">
        ${topbar()}
        ${!cloudConfigured ? `<div class="banner"><strong>Modo demo:</strong> el progreso se guarda solo en este navegador. Cuando configures Supabase, se sincronizará entre dispositivos.</div>` : ""}
        <section class="hero">
          <div class="panel">
            <h2>Banco piloto listo para practicar</h2>
            <p>20 preguntas reales, con clave oficial del PDF, auditoría médica, explicación de la correcta, análisis de distractores y perlas de examen.</p>
          </div>
          <div class="goal">
            <div>
              <small>Meta del Residentado</small>
              <div class="big">70+/80</div>
            </div>
            <small>Las preguntas observadas se excluyen del porcentaje de dominio por defecto.</small>
          </div>
        </section>

        <section class="kpis">
          <div class="kpi"><div class="value">${questions.length}</div><div class="label">Preguntas</div></div>
          <div class="kpi"><div class="value">${s.answered}</div><div class="label">Vistas</div></div>
          <div class="kpi"><div class="value">${officialAccuracy}</div><div class="label">Precisión oficial</div></div>
          <div class="kpi"><div class="value">${masteryAccuracy}</div><div class="label">Dominio auditado</div></div>
          <div class="kpi"><div class="value">${msToSec(s.avg)}</div><div class="label">Tiempo medio</div></div>
        </section>

        <section class="actions">
          <button id="continue-btn" class="btn primary">▶ Continuar práctica</button>
          <button id="timed-btn" class="btn">⏱ 20 segundos por pregunta</button>
          <button id="errors-btn" class="btn">↻ Repasar errores</button>
          <button id="stats-btn" class="btn">▥ Ver estadísticas</button>
        </section>
      </main>`;

    attachTopbar();
    document.getElementById("continue-btn").onclick = () => startSession("continue");
    document.getElementById("timed-btn").onclick = () => startSession("timed");
    document.getElementById("errors-btn").onclick = () => startSession("errors");
    document.getElementById("stats-btn").onclick = renderStats;
  }

  function questionScore(q) {
    const qa = attempts.filter(a => a.question_id === q.id);
    const wrong = qa.filter(a => !a.is_correct).length;
    const correct = qa.filter(a => a.is_correct).length;
    return { seen: qa.length, wrong, correct, ratio: qa.length ? wrong / qa.length : 0 };
  }

  function buildContinueQueue() {
    return [...questions].sort((a, b) => {
      const sa = questionScore(a), sb = questionScore(b);
      if (sa.seen !== sb.seen) return sa.seen - sb.seen;
      if (sa.ratio !== sb.ratio) return sb.ratio - sa.ratio;
      return a.id.localeCompare(b.id);
    });
  }

  function startSession(mode) {
    studyMode = mode;
    sessionIndex = 0;

    if (mode === "errors") {
      const wrongIds = new Set(attempts.filter(a => !a.is_correct).map(a => a.question_id));
      sessionQuestions = buildContinueQueue().filter(q => wrongIds.has(q.id));
      if (!sessionQuestions.length) {
        app.innerHTML = `
          <main class="shell">
            ${topbar("Repaso de errores")}
            <div class="panel empty">
              <h2>No tienes errores pendientes</h2>
              <p>Responde algunas preguntas primero o vuelve al inicio.</p>
              <button id="back-home" class="btn primary">Volver</button>
            </div>
          </main>`;
        attachTopbar();
        document.getElementById("back-home").onclick = renderDashboard;
        return;
      }
    } else {
      sessionQuestions = buildContinueQueue();
    }
    renderQuestion();
  }

  function renderQuestion() {
    clearTimer();
    answeredCurrent = false;
    const q = sessionQuestions[sessionIndex];
    if (!q) {
      renderSessionEnd();
      return;
    }

    const opts = ["A","B","C","D","E"]
      .filter(letter => q[`option_${letter.toLowerCase()}`])
      .map(letter => ({ letter, text: q[`option_${letter.toLowerCase()}`] }));

    const badge = observed(q)
      ? `<span class="tag bad">Pregunta observada</span>`
      : caveat(q)
        ? `<span class="tag warn">Con caveat</span>`
        : `<span class="tag ok">Auditada</span>`;

    app.innerHTML = `
      <main class="shell">
        ${topbar(studyMode === "timed" ? "Modo 20 segundos" : studyMode === "errors" ? "Repaso de errores" : "Práctica")}
        <section class="panel question-card">
          <div class="progress"><div style="width:${((sessionIndex) / sessionQuestions.length) * 100}%"></div></div>
          <div class="q-head">
            <span class="tag">${esc(q.year)} · Prueba ${esc(q.test)}</span>
            <span class="tag">${esc(q.area)}</span>
            <span class="tag">${esc(q.topic)}</span>
            ${badge}
            ${studyMode === "timed" ? `<div id="timer" class="timer">00:20</div>` : ""}
          </div>
          <div class="q-body">
            <div class="meta-line muted"><span>${sessionIndex + 1} de ${sessionQuestions.length}</span><span>•</span><span>${esc(q.id)}</span></div>
            <p class="q-text">${esc(q.question)}</p>
            <div class="options">
              ${opts.map(o => `
                <button class="option" data-letter="${o.letter}">
                  <span class="letter">${o.letter}</span>
                  <span>${esc(o.text)}</span>
                </button>`).join("")}
            </div>
          </div>
          <div id="feedback"></div>
        </section>
        <div class="footer-actions">
          <button id="home-btn" class="btn ghost">← Inicio</button>
        </div>
      </main>`;

    attachTopbar();
    document.getElementById("home-btn").onclick = renderDashboard;
    document.querySelectorAll(".option").forEach(btn => {
      btn.addEventListener("click", () => answerQuestion(btn.dataset.letter, false));
    });

    timerStartedAt = performance.now();
    if (studyMode === "timed") startTimer();
  }

  function startTimer() {
    let remaining = timerSeconds;
    const timer = document.getElementById("timer");
    const paint = () => {
      if (!timer) return;
      timer.textContent = `00:${String(remaining).padStart(2, "0")}`;
      timer.classList.toggle("urgent", remaining <= 5);
    };
    paint();
    timerId = setInterval(() => {
      remaining -= 1;
      paint();
      if (remaining <= 0) {
        clearTimer();
        answerQuestion(null, true);
      }
    }, 1000);
  }

  function clearTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  async function answerQuestion(letter, timedOut) {
    if (answeredCurrent) return;
    answeredCurrent = true;
    clearTimer();

    const q = sessionQuestions[sessionIndex];
    const elapsed = Math.max(0, Math.round(performance.now() - timerStartedAt));
    const isCorrect = !timedOut && letter === q.official_answer;

    const attempt = {
      question_id: q.id,
      selected_answer: letter,
      is_correct: isCorrect,
      response_time_ms: elapsed,
      study_mode: studyMode,
      timed_out: timedOut,
      answered_at: new Date().toISOString()
    };

    if (cloudConfigured) {
      const payload = { ...attempt, user_id: user.id };
      const { data, error } = await supa.from("attempts").insert(payload).select().single();
      if (error) {
        alert(`No se pudo guardar el intento: ${error.message}`);
      } else {
        attempts.push(data);
      }
    } else {
      attempts.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, ...attempt });
      saveLocalAttempts();
    }

    showFeedback(q, letter, timedOut, isCorrect);
  }

  function showFeedback(q, selected, timedOut, isCorrect) {
    document.querySelectorAll(".option").forEach(btn => {
      btn.disabled = true;
      const letter = btn.dataset.letter;
      if (letter === q.official_answer) btn.classList.add("correct");
      else if (letter === selected) btn.classList.add("wrong");
      else btn.classList.add("dimmed");
    });

    const opts = ["A","B","C","D","E"].filter(l => q[`option_${l.toLowerCase()}`]);
    const distractorBlocks = opts
      .filter(l => l !== q.official_answer)
      .map(l => {
        const reason = q[`why_not_${l.toLowerCase()}`];
        if (!reason) return "";
        return `<p><strong>${l}. ${esc(q[`option_${l.toLowerCase()}`])}:</strong> ${esc(reason)}</p>`;
      }).join("");

    const resultTitle = timedOut ? "⏱ Tiempo agotado" : isCorrect ? "✅ Correcto" : "❌ Incorrecto";
    const resultClass = isCorrect ? "ok" : "bad";

    document.getElementById("feedback").innerHTML = `
      <div class="feedback">
        <h3 class="${resultClass}">${resultTitle}</h3>
        ${selected ? `<p>Tu respuesta: <strong>${esc(selected)}. ${esc(q[`option_${selected.toLowerCase()}`])}</strong></p>` : ""}
        <p class="answer-line">Clave oficial: ${esc(q.official_answer)}. ${esc(q.official_answer_text)}</p>

        ${observed(q) ? `
          <div class="explain-block audit-box">
            <h4>⚠ Auditoría médica</h4>
            <p><strong>Esta pregunta se conserva como pregunta histórica, pero se excluye del dominio por defecto.</strong></p>
            <p>${esc(q.audit_current_assessment || q.update_alert)}</p>
            <p><strong>Criterio actual:</strong> ${esc(q.audit_current_answer || "")}</p>
          </div>` : caveat(q) ? `
          <div class="explain-block">
            <h4>⚠ Precisión clínica</h4>
            <p>${esc(q.audit_current_assessment || q.update_alert)}</p>
          </div>` : ""}

        <div class="explain-block">
          <h4>Por qué la clave es correcta</h4>
          <p>${esc(q.correct_explanation)}</p>
        </div>

        <div class="explain-block">
          <h4>Por qué no las otras</h4>
          ${distractorBlocks}
        </div>

        <div class="explain-block pearl">
          <h4>💡 Perla de examen</h4>
          <p>${esc(q.exam_pearl)}</p>
        </div>

        <div class="footer-actions">
          <button id="feedback-home" class="btn ghost">Inicio</button>
          <button id="next-btn" class="btn primary">${sessionIndex + 1 < sessionQuestions.length ? "Siguiente pregunta →" : "Terminar sesión"}</button>
        </div>
      </div>`;

    document.getElementById("feedback-home").onclick = renderDashboard;
    document.getElementById("next-btn").onclick = () => {
      sessionIndex += 1;
      renderQuestion();
    };
  }

  function renderSessionEnd() {
    const ids = new Set(sessionQuestions.map(q => q.id));
    const sessionAttempts = attempts.filter(a => ids.has(a.question_id));
    const recent = sessionAttempts.slice(-sessionQuestions.length);
    const correct = recent.filter(a => a.is_correct).length;

    app.innerHTML = `
      <main class="shell">
        ${topbar("Sesión terminada")}
        <section class="panel empty">
          <h2>Sesión completada</h2>
          <p>Resultado reciente: <strong>${correct}/${recent.length}</strong> (${pct(correct, recent.length)})</p>
          <div class="actions" style="margin-top:18px">
            <button id="again-btn" class="btn">Repetir modo</button>
            <button id="home-btn" class="btn primary">Volver al inicio</button>
          </div>
        </section>
      </main>`;
    attachTopbar();
    document.getElementById("again-btn").onclick = () => startSession(studyMode);
    document.getElementById("home-btn").onclick = renderDashboard;
  }

  function renderStats() {
    clearTimer();
    const byArea = new Map();
    for (const q of questions) {
      if (!byArea.has(q.area)) byArea.set(q.area, { questions: 0, attempts: 0, correct: 0 });
      byArea.get(q.area).questions += 1;
    }
    for (const a of attempts) {
      const q = questions.find(x => x.id === a.question_id);
      if (!q) continue;
      const g = byArea.get(q.area);
      g.attempts += 1;
      if (a.is_correct) g.correct += 1;
    }

    const hard = questions
      .map(q => ({ q, s: questionScore(q) }))
      .filter(x => x.s.seen > 0)
      .sort((a,b) => (b.s.ratio - a.s.ratio) || (b.s.seen - a.s.seen))
      .slice(0, 8);

    const s = attemptStats();

    app.innerHTML = `
      <main class="shell">
        ${topbar("Estadísticas")}
        <section class="kpis">
          <div class="kpi"><div class="value">${attempts.length}</div><div class="label">Intentos</div></div>
          <div class="kpi"><div class="value">${pct(s.correct, attempts.length)}</div><div class="label">Precisión oficial</div></div>
          <div class="kpi"><div class="value">${pct(s.masteryCorrect, s.masteryAttempts.length)}</div><div class="label">Dominio auditado</div></div>
          <div class="kpi"><div class="value">${msToSec(s.avg)}</div><div class="label">Tiempo medio</div></div>
          <div class="kpi"><div class="value">${attempts.filter(a => a.timed_out).length}</div><div class="label">Sin respuesta</div></div>
        </section>

        <section class="stats-grid">
          <div class="panel">
            <h2>Por área</h2>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Área</th><th class="num">Preg.</th><th class="num">Intentos</th><th class="num">Acierto</th></tr></thead>
                <tbody>
                  ${[...byArea.entries()].sort().map(([area, g]) => `
                    <tr><td>${esc(area)}</td><td class="num">${g.questions}</td><td class="num">${g.attempts}</td><td class="num">${pct(g.correct, g.attempts)}</td></tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </div>

          <div class="panel">
            <h2>Preguntas más difíciles</h2>
            ${hard.length ? `<div class="table-wrap">
              <table>
                <thead><tr><th>ID</th><th>Tema</th><th class="num">Fallos</th><th class="num">Vistas</th></tr></thead>
                <tbody>
                  ${hard.map(({q,s}) => `<tr><td>${esc(q.id)}</td><td>${esc(q.topic)}</td><td class="num">${s.wrong}</td><td class="num">${s.seen}</td></tr>`).join("")}
                </tbody>
              </table></div>` : `<div class="empty">Aún no hay intentos.</div>`}
          </div>
        </section>

        <div class="footer-actions">
          <button id="clear-demo" class="btn danger" ${cloudConfigured ? "style='visibility:hidden'" : ""}>Borrar progreso demo</button>
          <button id="home-btn" class="btn primary">Volver al inicio</button>
        </div>
      </main>`;

    attachTopbar();
    document.getElementById("home-btn").onclick = renderDashboard;
    const clear = document.getElementById("clear-demo");
    if (clear && !cloudConfigured) clear.onclick = () => {
      if (confirm("¿Borrar todo el progreso guardado en este navegador?")) {
        attempts = [];
        saveLocalAttempts();
        renderStats();
      }
    };
  }

  init();
})();
