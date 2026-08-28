#!/usr/bin/env python3
"""Smoke UI sin red para v1.5.7: QRV2 plegable + referencias nominadas + regresión de simulacros. Requiere Python Playwright y Chromium."""
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

    assert 'v1.5.7' in page.locator('body').inner_text()

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
    assert 'Respuesta correcta:' not in page.locator('body').inner_text()
    page.locator('.option[data-letter]').first.click()
    page.locator('[data-question-doubt-top]').click()
    page.locator('[data-exam-mark]').first.click()
    page.locator('[data-exam-next]').first.click()
    page.wait_for_timeout(150)
    assert 'Bloque 1 completado' in page.locator('body').inner_text()
    page.locator('#continue-block').click()
    page.locator('.option[data-letter]').first.click()
    page.locator('[data-exam-next]').first.click()
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
    page.locator('[data-scratch-index="0"]').first.click()
    page.locator('[data-question-doubt-top]').first.click()
    page.locator('[data-paper-flag-index="0"]').click()
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

print('QA navegador v1.5.7 QRV2 + REALISTIC TWO-PART EXAM: OK')
