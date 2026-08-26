#!/usr/bin/env python3
"""Smoke UI sin red para v1.5.3: práctica personalizada + QRV2 + no regresión A16. Requiere Python Playwright y Chromium."""
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
html += 'if(window.PILOT_QUESTIONS){window.PILOT_QUESTIONS.forEach((q,i)=>Object.assign(q,{rentability_topic_id:' + json.dumps(FIRST['topicId']) + ',rentability_topic_label:' + json.dumps(FIRST['topicLabel'],ensure_ascii=False) + ',rentability_tier:"MUY_ALTA",exam_rentability_score:10+i,canonical_area:"Medicina Interna",canonical_specialty:"Endocrinología y Metabolismo"}));const g=window.PILOT_QUESTIONS[window.PILOT_QUESTIONS.length-1];Object.assign(g,{comparison_title:"Fluoroquinolonas — lesión tendinosa",comparison_framework:"Evento: tendinitis o rotura del Aquiles. Riesgo mayor: edad y corticoides. Conducta: suspender y evaluar rotura.",canonical_entity:"Tendinopatía por fluoroquinolonas",tested_aspect_primary:"Toxicidad, reacción adversa o interacción",pivot_text:"Tendinopatía y rotura de Aquiles",exam_logic:"Quinolona + dolor del talón = pensar en lesión del Aquiles.",abbreviations:"FQ: fluoroquinolonas.",reference_notes:"Contenido legacy preservado.",audit_source_urls:"https://example.org/source"});window.__EXPECTED_RENT_QUESTION__=g.question;}</script>'
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

    assert 'v1.5.3' in page.locator('body').inner_text()

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

    # v1.5.3: selección RENTABILITY + presentación QUEUE debe escoger primero la pregunta con mayor score.
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
    assert 'Núcleo rápido' in feedback_text and 'Detalle útil' in feedback_text
    assert 'Siglas, epónimos y términos' in feedback_text
    assert page.locator('#feedback details', has_text='Notas generales').count() == 1
    assert page.locator('#feedback details', has_text='Fuentes y trazabilidad').count() == 1
    assert page.locator('[data-question-doubt-label]').count() == 1
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

    browser.close()

print('QA navegador v1.5.3 CUSTOM QUEUE + QRV2: OK')
