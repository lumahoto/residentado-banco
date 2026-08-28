#!/usr/bin/env python3
"""Smoke UI sin red para v1.5.9: cuadernillo universal, scratch reversible, Dashboard, revisión del día read-only y QRV2. Requiere Python Playwright y Chromium."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ['version.js','pilot-data.js','session-core.js','session-storage.js','question-parser.js','w3-tools.js','w4-data.js']
CATALOG = json.loads((ROOT/'tts_catalog.json').read_text(encoding='utf-8'))
FIRST = next(row for row in CATALOG['topics'] if row.get('primaryCode') == 'TTS_001')
POLYFILL = """<script>(()=>{const make=()=>{const m=new Map();return {getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][i]||null,get length(){return m.size}}};Object.defineProperty(window,'localStorage',{value:make(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:make(),configurable:true});window.APP_CONFIG={SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',ALLOW_SIGNUP:false};document.execCommand=cmd=>{window.__COPY_CALLED__=cmd;return true;};})();</script>"""

html = '<!doctype html><html><head><meta charset="utf-8"><style>' + (ROOT/'styles.css').read_text(encoding='utf-8') + '</style></head><body><div id="app"></div>' + POLYFILL
for filename in SCRIPTS:
    html += '<script>' + (ROOT/filename).read_text(encoding='utf-8').replace('</script>', '<\\/script>') + '</script>'
html += '<script>window.__TTS_CATALOG__=' + json.dumps(CATALOG, ensure_ascii=False) + ';window.fetch=async input=>{if(String(input).includes("tts_catalog.json"))return {ok:true,status:200,json:async()=>window.__TTS_CATALOG__};throw new Error("offline smoke");};'
html += 'if(window.PILOT_QUESTIONS){window.PILOT_QUESTIONS.forEach((q,i)=>Object.assign(q,{rentability_topic_id:' + json.dumps(FIRST['topicId']) + ',rentability_topic_label:' + json.dumps(FIRST['topicLabel'],ensure_ascii=False) + ',rentability_tier:"MUY_ALTA",exam_rentability_score:10+i,canonical_area:"Medicina Interna",canonical_specialty:"Endocrinología y Metabolismo"}));const g=window.PILOT_QUESTIONS[window.PILOT_QUESTIONS.length-1];Object.assign(g,{comparison_title:"Fluoroquinolonas — lesión tendinosa",comparison_framework:"Evento: tendinitis o rotura del Aquiles. Riesgo mayor: edad y corticoides. Conducta: suspender y evaluar rotura.",canonical_entity:"Tendinopatía por fluoroquinolonas",tested_aspect_primary:"Toxicidad, reacción adversa o interacción",pivot_text:"Tendinopatía y rotura de Aquiles",exam_logic:"Quinolona + dolor del talón = pensar en lesión del Aquiles.",abbreviations:"FQ: fluoroquinolonas.",memory_hook:"Gancho QA: quinolona + Aquiles.",reference_notes:"Contenido legacy preservado.",audit_source_urls:"https://example.org/source | [ACOG. Gestational Hypertension and Preeclampsia. Practice Bulletin No. 222. 2020.](https://example.org/source) | https://legacy.example.net/guideline | [<img src=x onerror=window.__XSS_EXECUTED__=true>NICE. NG133.](https://safe.example.org/ng133) | [No permitido](javascript:alert(1))"});window.__EXPECTED_RENT_QUESTION__=g.question;const seeds=[...window.PILOT_QUESTIONS];for(const test of ["A","B"]){for(let n=1;n<=90;n++){const base=seeds[(n-1)%seeds.length];window.PILOT_QUESTIONS.push({...base,id:`QA-2020-${test}-${String(n).padStart(3,"0")}`,year:2020,test,question_number:n,question:`QA histórico ${test}-${n}: ${base.question}`,exam_rentability_score:0.01});}}}</script>'
html += r'''<script>(()=>{
  const qs=window.PILOT_QUESTIONS||[];
  const byId=id=>qs.find(q=>q.id===id);
  const now=Date.now();
  const at=min=>new Date(now-min*60000).toISOString();
  const wrong=q=>['A','B','C','D','E'].find(x=>q && q[`option_${x.toLowerCase()}`] && x!==q.official_answer) || 'A';
  const base=(id,q,minutes,extra={})=>({id,client_attempt_id:id,user_id:'local-user',question_id:q.id,selected_answer:q.official_answer,is_correct:true,response_time_ms:6000,study_mode:'practice_high',timed_out:false,was_uncertain:false,uncertain_options:[],uncertainty_note:'',target_seconds:20,answered_at:at(minutes),updated_at:at(minutes),...extra});
  const q0=qs[0],q1=qs[1],q2=qs[2],q3=qs[3],q4=qs[4],qh=byId('QA-2020-A-090');
  const seeded=[
    base('seed-wrong-q0',q0,60,{selected_answer:wrong(q0),is_correct:false,response_time_ms:7000}),
    base('seed-correct-q0',q0,5),
    base('seed-doubt-q1',q1,50,{was_uncertain:true,response_time_ms:9000}),
    base('seed-dontknow-q2',q2,40,{selected_answer:null,is_correct:false,was_uncertain:true,uncertainty_note:'NO_SE_EXPLICITO',response_time_ms:5000}),
    base('seed-slow-q3',q3,30,{response_time_ms:26000,target_seconds:10}),
    base('seed-normal-q4',q4,20),
    base('seed-flagged-historical',qh,10),
  ];
  localStorage.setItem('residentado_piloto_attempts_v3',JSON.stringify(seeded));
  localStorage.setItem('residentado_question_review_flags_v1',JSON.stringify([{id:'seed-review-flag',question_id:qh.id,user_id:'local-user',flag_type:'CONTENT',learning_scope:'CONTENT',status:'OPEN',user_note:'Flag QA',created_at:at(9),updated_at:at(9)}]));
})();</script>'''
html += '<script>' + (ROOT/'app.js').read_text(encoding='utf-8').replace('</script>', '<\\/script>') + '</script></body></html>'

with sync_playwright() as p:
    launch_args = {'headless': True, 'args': ['--no-sandbox']}
    if Path('/usr/bin/chromium').exists():
        launch_args['executable_path'] = '/usr/bin/chromium'
    browser = p.chromium.launch(**launch_args)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.set_default_timeout(5000)
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content(html)
    page.wait_for_timeout(700)

    assert 'v1.5.9' in page.locator('body').inner_text()


    # Dashboard heredado de v1.5.8: la acción operativa va antes de cualquier alerta académica.
    assert page.locator('#next-task-btn').count() == 1
    if page.locator('.priority-reading-alert').count():
        assert page.evaluate("""() => { const task=document.querySelector('#next-task-btn'); const alert=document.querySelector('.priority-reading-alert'); return Boolean(task && alert && (task.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING)); }""")

    # Revisión del día: conteos deterministas, deduplicación y cero escritura por navegación.
    page.get_by_role('button', name='🕘 HISTORIAL Y RITMO').click()
    page.wait_for_timeout(120)
    assert page.locator('.history-day-review-panel').count() == 1
    expected_counts = {'all':'6','incorrect':'2','doubt':'2','dont_know':'1','slow':'1','review_flag':'1'}
    for key, expected in expected_counts.items():
        btn = page.locator(f'[data-history-day-review="{key}"]')
        assert btn.count() == 1
        assert btn.locator('strong').inner_text() == expected
    attempts_before = page.evaluate("JSON.parse(localStorage.getItem('residentado_piloto_attempts_v3')||'[]').length")
    sessions_before = page.evaluate("JSON.parse(localStorage.getItem('residentado_piloto_sessions_v2')||'[]').length")
    memory_before = page.evaluate("localStorage.getItem('residentado_memory_state_v1')||'[]'")
    flags_before = page.evaluate("JSON.parse(localStorage.getItem('residentado_question_review_flags_v1')||'[]').length")
    notes_before = page.evaluate("JSON.parse(localStorage.getItem('residentado_question_learning_notes_v1')||'[]').length")
    page.locator('[data-history-day-review="incorrect"]').click()
    page.wait_for_timeout(100)
    assert 'Revisión del día · Erradas' in page.locator('body').inner_text()
    assert page.locator('.review-question-row').count() == 2
    assert page.locator('[data-review-filter]').count() == 0
    page.locator('.review-question-row').first.click()
    page.wait_for_timeout(80)
    assert page.locator('[data-question-doubt-top]').count() == 0
    assert page.locator('#post-answer-uncertain').count() == 0
    # Acciones personales explícitas permanecen disponibles, pero no se disparan al navegar.
    assert page.locator('[data-question-learning-note]').count() == 1
    assert page.locator('[data-question-review-flag]').count() == 1
    assert 'del filtro del día' in page.locator('.review-original-position').inner_text()
    page.locator('[data-review-next]').first.click()
    page.wait_for_timeout(60)
    assert page.locator('[data-review-prev]').first.is_enabled()
    page.locator('[data-review-prev]').first.click()
    page.wait_for_timeout(60)
    page.locator('[data-review-summary]').first.click()
    page.wait_for_timeout(60)
    page.locator('[data-review-summary-exit]').click()
    page.wait_for_timeout(80)
    assert page.locator('.history-day-review-panel').count() == 1
    assert page.evaluate("JSON.parse(localStorage.getItem('residentado_piloto_attempts_v3')||'[]').length") == attempts_before
    assert page.evaluate("JSON.parse(localStorage.getItem('residentado_piloto_sessions_v2')||'[]').length") == sessions_before
    assert page.evaluate("localStorage.getItem('residentado_memory_state_v1')||'[]'") == memory_before
    assert page.evaluate("JSON.parse(localStorage.getItem('residentado_question_review_flags_v1')||'[]').length") == flags_before
    assert page.evaluate("JSON.parse(localStorage.getItem('residentado_question_learning_notes_v1')||'[]').length") == notes_before
    for width, height in [(320,700),(360,800),(390,844),(430,932),(768,1024),(1024,768),(1440,900)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(20)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.get_by_role('button', name='Inicio').click()

    page.get_by_role('button', name='📊 MI ESTADO').click()
    page.wait_for_timeout(150)
    header = page.locator('.topic-coverage-table thead').first.inner_text()
    assert 'N.º' in header and 'TTS' in header
    assert '1 TTS disponibles' in page.locator('.tts-catalog-meta').last.inner_text()
    available = page.locator('[data-topic-tts-key]', has_text='TTS_001')
    assert available.count() == 1
    available.click()
    page.wait_for_timeout(150)
    assert 'Solicitud copiada' in page.evaluate("document.querySelector('[data-topic-tts-key]').textContent")
    assert page.evaluate('window.__COPY_CALLED__') == 'copy'
    assert 'Mi estado' in page.locator('body').inner_text()

    page.locator('#topic-coverage-view').select_option('specialties')
    page.wait_for_timeout(100)
    assert page.locator('.specialty-coverage-group').count() > 0
    assert 'TTS' in page.locator('.specialty-summary-metrics').first.inner_text()

    page.get_by_role('button', name='Inicio').click()
    page.get_by_role('button', name='⚡ PRACTICAR').click()
    page.get_by_role('button', name='⚙ Personalizar práctica').click()
    page.wait_for_timeout(100)
    assert page.locator('#rentability option[value="muy_alta"]').count() == 1
    assert page.locator('input[name="topicPath"]').first.get_attribute('value').startswith('TOPIC_ID:')
    assert page.locator('#selection-order').input_value() == 'RANDOM'
    assert page.locator('#presentation-order').input_value() == 'RANDOM'
    assert page.locator('#randomize').count() == 0

    # Selección RENTABILITY + presentación QUEUE heredada debe seguir escogiendo mayor score.
    page.locator('#selection-order').select_option('RENTABILITY')
    page.locator('#presentation-order').select_option('QUEUE')
    page.locator('#question-count').fill('1')
    page.locator('#time-mode').select_option('per_question')
    page.locator('#seconds-per-question').fill('30')
    page.locator('#feedback-mode').select_option('immediate')
    page.locator('#builder-form').evaluate('(form) => form.requestSubmit()')
    page.wait_for_timeout(150)
    assert page.locator('.q-text').inner_text() == page.evaluate('window.__EXPECTED_RENT_QUESTION__')
    assert page.locator('#dont-know-study').count() == 1
    assert 'No sé · mostrar respuesta' in page.locator('#dont-know-study').inner_text()
    assert page.locator('.uncertainty-toggle').count() == 0
    assert page.locator('[data-question-doubt-top]').count() == 1
    page.locator('[data-question-doubt-top]').click()
    assert 'active' in (page.locator('[data-question-doubt-top]').get_attribute('class') or '')
    page.locator('#dont-know-study').click()
    page.wait_for_timeout(250)
    assert 'No sabía' in page.locator('#feedback').inner_text()
    assert 'Tiempo agotado' not in page.locator('#feedback').inner_text()
    feedback_text = page.locator('#feedback').inner_text()
    assert 'Fluoroquinolonas — lesión tendinosa' in feedback_text
    quick = page.locator('#feedback details.qrv2-reference')
    assert quick.count() == 1 and not quick.get_attribute('open')
    quick.locator('summary.qrv2-reference-summary').click()
    feedback_text = page.locator('#feedback').inner_text()
    assert 'Núcleo rápido' in feedback_text and 'Detalle útil' in feedback_text
    assert 'Siglas, epónimos y términos' in feedback_text
    assert page.locator('#feedback details', has_text='Notas generales').count() == 0
    assert 'Contenido legacy preservado.' not in feedback_text
    sources = page.locator('#feedback details.qrv2-collapsible', has_text='Fuentes y trazabilidad')
    assert sources.count() == 1 and not sources.get_attribute('open')
    sources.locator('summary').click()
    source_links = sources.locator('a')
    assert source_links.count() == 3
    assert source_links.nth(0).inner_text() == 'ACOG. Gestational Hypertension and Preeclampsia. Practice Bulletin No. 222. 2020.'
    assert source_links.nth(1).inner_text() == '<img src=x onerror=window.__XSS_EXECUTED__=true>NICE. NG133.'
    assert source_links.nth(2).inner_text().startswith('legacy.example.net')
    assert source_links.nth(0).get_attribute('href') == 'https://example.org/source'
    assert source_links.nth(0).get_attribute('rel') == 'noopener noreferrer'
    assert page.evaluate('window.__XSS_EXECUTED__ === true') is False
    assert 'No permitido' not in sources.inner_text()
    assert page.evaluate("""() => { const memory=document.querySelector('#feedback .memory'); const ref=document.querySelector('#feedback .qrv2-reference'); const note=document.querySelector('#feedback .learning-note-action'); return Boolean(memory && ref && note && (memory.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING) && (ref.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)); }""")
    assert page.locator('[data-question-doubt-label]').count() == 1
    assert page.evaluate("""() => getComputedStyle(document.querySelector('#post-answer-uncertain')).justifySelf === 'end'""")
    assert page.locator('.feedback-next-actions #next-feedback').count() == 1
    assert page.evaluate("""() => getComputedStyle(document.querySelector('.feedback-next-actions')).justifyContent === 'flex-end'""")
    assert 'Duda registrada' in page.locator('[data-question-doubt-label]').inner_text()
    page.locator('#cancel-study').click()
    page.get_by_role('button', name='Cerrar sesión parcial y revisar respondidas').click()
    page.wait_for_timeout(200)
    assert 'Centro de revisión' in page.locator('body').inner_text()
    assert page.locator('.review-question-row').count() >= 1
    page.locator('[data-review-summary-exit]').click()

    page.get_by_role('button', name='Empezar').first.click()
    page.locator('.option[data-letter]').first.click()
    page.wait_for_timeout(250)
    page.locator('[data-question-review-flag]').click()
    page.wait_for_timeout(100)
    assert page.locator('[data-set-review-scope="CONTENT"]').count() == 1
    assert 'Contenido clínico' in page.locator('[data-set-review-scope="CONTENT"]').inner_text()
    page.locator('#review-flag-note').fill('Revisar el contenido clínico de esta pregunta.')
    page.locator('#review-flag-form').evaluate('(form) => form.requestSubmit()')
    page.wait_for_timeout(200)
    assert page.locator('[data-question-learning-note]').count() == 1
    assert 'Añadir nota' in page.locator('[data-question-learning-note]').inner_text()
    # La Nota solo aparece tras una acción explícita del usuario.
    page.locator('[data-question-learning-note]').click()
    page.locator('#learning-note-text').fill('Necesito consolidar el concepto evaluado.')
    page.locator('#learning-note-save').click()
    page.wait_for_timeout(150)
    assert 'Editar nota' in page.locator('[data-question-learning-note]').inner_text()
    page.locator('#cancel-study').click()
    page.get_by_role('button', name='Cerrar sesión parcial y revisar respondidas').click()
    page.wait_for_timeout(250)
    assert 'Centro de revisión' in page.locator('body').inner_text()
    assert page.locator('.review-filter-chip').count() >= 8
    assert page.locator('[data-review-filter="notes"] strong').inner_text() == '1'
    assert page.locator('[data-review-filter="review_flag"] strong').inner_text() == '1'
    page.locator('[data-review-summary-exit]').click()

    page.get_by_role('button', name='📊 MI ESTADO').click()
    page.locator('#stats-weakness-report').click()
    page.wait_for_timeout(100)
    assert 'Disponibilidad TTS: 89 temas' in page.locator('.tts-catalog-meta').first.inner_text()
    assert page.locator('[data-weak-tts]', has_text='TTS_001').count() == 1

    # Regresión de simulacro personalizado: 2 preguntas, descanso, duda/marcado, entrega y revisión.
    page.get_by_role('button', name='Inicio').click()
    page.get_by_role('button', name='⚡ PRACTICAR').click()
    page.get_by_role('button', name='📝 Crear simulacro').click()
    page.get_by_role('button', name='Crear entrenamiento personalizado').click()
    page.wait_for_timeout(100)
    assert page.locator('#question-count').input_value() == '80'
    assert page.locator('#total-minutes').input_value() == '180'
    assert page.locator('#feedback-mode').input_value() == 'end'
    page.locator('#question-count').fill('2')
    page.locator('#total-minutes').fill('3')
    page.locator('#break-after').fill('1')
    page.locator('#randomize').uncheck()
    page.locator('#builder-form').evaluate('(form) => form.requestSubmit()')
    page.wait_for_timeout(180)
    assert 'Simulacro de 2 preguntas' in page.locator('body').inner_text()
    assert 'Modo simulacro · cuadernillo' in page.locator('body').inner_text()
    assert page.locator('.historical-layout').count() == 1
    assert page.locator('.answer-sheet').count() == 1
    assert page.locator('.paper-question').count() == 1
    assert 'Respuesta correcta:' not in page.locator('body').inner_text()

    # v1.5.9: dos candidatas tentativas simultáneas sin convertir la pregunta en duda.
    page.locator('[data-candidate-index="0"]').nth(0).click()
    page.locator('[data-candidate-index="0"]').nth(1).click()
    assert page.locator('.paper-option-wrap.scratch-candidate').count() == 2
    assert 'uncertain' not in (page.locator('[data-answer-row="0"]').get_attribute('class') or '')

    # Tachado reversible por × y también recuperable al pulsar la alternativa tachada.
    discard = page.locator('[data-discard-index="0"]').nth(2)
    discard.click()
    assert page.locator('.paper-option-wrap').nth(2).evaluate("el => el.classList.contains('scratch-crossed')")
    discard.click()
    assert page.locator('.paper-option-wrap').nth(2).evaluate("el => el.classList.contains('scratch-neutral')")
    discard.click()
    page.locator('[data-candidate-index="0"]').nth(2).click()
    assert page.locator('.paper-option-wrap').nth(2).evaluate("el => el.classList.contains('scratch-neutral')")

    # La hoja es la respuesta definitiva; duda y flag siguen siendo acciones independientes.
    page.locator('[data-answer-index="0"]').first.click()
    page.locator('[data-question-doubt-top]').first.click()
    page.locator('[data-paper-flag-index="0"]').click()
    page.wait_for_timeout(80)
    assert 'uncertain' in (page.locator('[data-answer-row="0"]').get_attribute('class') or '')
    page.locator('#historical-finish').click()
    page.wait_for_timeout(120)
    assert 'Revisión de bloque 1' in page.locator('body').inner_text()
    page.locator('#submit-exam').click()
    page.wait_for_timeout(150)
    assert 'Bloque 1 completado' in page.locator('body').inner_text()
    page.locator('#continue-block').click()
    page.wait_for_timeout(120)
    assert page.locator('.paper-question').count() == 2
    page.locator('[data-answer-index="1"]').first.click()
    page.locator('#historical-finish').click()
    page.wait_for_timeout(150)
    assert 'Resumen del simulacro' in page.locator('body').inner_text()
    assert '2' in page.locator('.kpi').first.inner_text()
    overview_time_1 = page.locator('#timer').inner_text()
    page.wait_for_timeout(1150)
    overview_time_2 = page.locator('#timer').inner_text()
    assert overview_time_2 != overview_time_1
    page.locator('#submit-exam').click()
    page.wait_for_timeout(220)
    assert 'Simulacro entregado' in page.locator('body').inner_text()
    page.locator('#review-btn').click()
    page.wait_for_timeout(150)
    assert 'Centro de revisión' in page.locator('body').inner_text()
    page.locator('[data-review-summary-exit]').click()

    # Builder oficial 2026: 200 / 120 por parte / corte 100.
    page.get_by_role('button', name='⚡ PRACTICAR').click()
    page.get_by_role('button', name='📝 Crear simulacro').click()
    assert page.get_by_role('button', name='Configurar simulacro realista 2026').count() == 1
    page.get_by_role('button', name='Configurar simulacro realista 2026').click()
    page.wait_for_timeout(100)
    assert page.locator('#question-count').input_value() == '200'
    assert page.locator('#total-minutes').input_value() == '120'
    assert page.locator('#break-after').input_value() == '100'
    assert page.locator('#official-two-part').input_value() == '1'
    assert 'A 100/120 min' in page.locator('#official-format-hint').inner_text()

    # Responsive del builder/hub: sin overflow horizontal entre 320 y 1440 px.
    for width, height in [(320,700),(360,800),(390,844),(430,932),(768,1024),(1024,768),(1440,900)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(30)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    page.set_viewport_size({'width': 1440, 'height': 1000})

    # Volver al hub y probar histórico A+B: B oculta, A revisable, intermedio persistente, B aislada.
    page.get_by_role('button', name='Inicio').click()
    page.get_by_role('button', name='⚡ PRACTICAR').click()
    page.get_by_role('button', name='📝 Crear simulacro').click()
    assert page.locator('[data-historical-year="2020"][data-historical-test="A"]').count() == 1
    assert page.locator('[data-historical-year="2020"][data-historical-test="A+B"]').count() == 1
    page.locator('[data-historical-year="2020"][data-historical-test="A+B"]').click()
    page.wait_for_timeout(180)
    assert 'Modo histórico realista' in page.locator('body').inner_text()
    assert 'Prueba A' in page.locator('.historical-toolbar').inner_text()
    assert page.locator('.paper-question').count() == 90
    assert page.locator('[data-answer-index="0"]').count() >= 4
    assert page.locator('[data-answer-index="90"]').count() == 0
    assert 'QA histórico B-1' not in page.locator('.historical-paper').inner_text()
    assert page.locator('#timer').inner_text().startswith('01:47') or page.locator('#timer').inner_text().startswith('01:48')
    for width, height in [(320,700),(360,800),(390,844),(430,932),(768,1024),(1024,768),(1440,900)]:
        page.set_viewport_size({'width': width, 'height': height})
        page.wait_for_timeout(25)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.locator('[data-candidate-index="0"]').first.click()
    hist_discard = page.locator('[data-discard-index="0"]').nth(1)
    hist_discard.click()
    assert page.locator('.paper-option-wrap').nth(1).evaluate("el => el.classList.contains('scratch-crossed')")
    hist_discard.click()
    assert page.locator('.paper-option-wrap').nth(1).evaluate("el => el.classList.contains('scratch-neutral')")
    page.locator('[data-question-doubt-top]').first.click()
    page.locator('[data-paper-flag-index="0"]').click()
    page.wait_for_timeout(80)
    assert 'uncertain' in (page.locator('[data-answer-row="0"]').get_attribute('class') or '')
    page.locator('[data-answer-index="0"]').first.click()
    page.locator('#historical-finish').click()
    page.wait_for_timeout(100)
    assert 'Revisión de Parte A' in page.locator('body').inner_text()
    assert page.locator('.overview-grid [data-qindex]').count() == 90
    review_a_1 = page.locator('#timer').inner_text()
    page.wait_for_timeout(1100)
    review_a_2 = page.locator('#timer').inner_text()
    assert review_a_1 != review_a_2
    page.locator('#submit-exam').click()
    page.wait_for_timeout(150)
    assert 'Parte A cerrada' in page.locator('body').inner_text()
    assert 'Intermedio oficial: 60 minutos' in page.locator('body').inner_text()
    assert page.locator('#break-timer').inner_text().startswith('01:00') or page.locator('#break-timer').inner_text().startswith('59:')

    # Cerrar durante el intermedio y reanudar: debe regresar al intermedio, no abrir B automáticamente.
    page.locator('#session-exit-break').click()
    page.locator('#session-continue-later').click()
    page.wait_for_timeout(180)
    assert 'Sesiones en curso' in page.locator('body').inner_text()
    page.locator('[data-resume-session]').first.click()
    page.wait_for_timeout(150)
    assert 'Parte A cerrada' in page.locator('body').inner_text()
    assert page.locator('#continue-block').inner_text() == 'Iniciar Parte B'
    page.locator('#continue-block').click()
    page.wait_for_timeout(160)
    assert 'Prueba B' in page.locator('.historical-toolbar').inner_text()
    assert page.locator('.paper-question').count() == 90
    assert page.locator('[data-answer-index="0"]').count() == 0
    assert page.locator('[data-answer-index="90"]').count() >= 4
    assert 'QA histórico A-1' not in page.locator('.historical-paper').inner_text()
    assert 'QA histórico B-1' in page.locator('.historical-paper').inner_text()
    assert page.locator('#timer').inner_text().startswith('01:47') or page.locator('#timer').inner_text().startswith('01:48')
    page.locator('[data-answer-index="90"]').first.click()
    page.locator('#historical-finish').click()
    page.wait_for_timeout(100)
    assert 'Revisión antes de entregar' in page.locator('body').inner_text()
    assert page.locator('.overview-grid [data-qindex]').count() == 90

    # Footer de revisión debe envolver sin overflow incluso a 320 px.
    page.set_viewport_size({'width': 320, 'height': 700})
    page.wait_for_timeout(40)
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.locator('#submit-exam').click()
    page.wait_for_timeout(260)
    assert 'Simulacro entregado' in page.locator('body').inner_text()
    assert '2 respondidas' in page.locator('body').inner_text()
    page.locator('#review-btn').click()
    page.wait_for_timeout(160)
    assert 'Centro de revisión' in page.locator('body').inner_text()

    browser.close()

print('QA navegador v1.5.9 UNIVERSAL EXAM PAPER + SCRATCH + REGRESSIONS: OK')
