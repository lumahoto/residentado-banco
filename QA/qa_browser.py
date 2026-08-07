#!/usr/bin/env python3
"""Smoke UI sin red para v1.3.1. Requiere Python Playwright y Chromium."""
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
html += 'if(window.PILOT_QUESTIONS){window.PILOT_QUESTIONS.forEach(q=>Object.assign(q,{rentability_topic_id:' + json.dumps(FIRST['topicId']) + ',rentability_topic_label:' + json.dumps(FIRST['topicLabel'],ensure_ascii=False) + ',rentability_tier:"MUY_ALTA",exam_rentability_score:90.53,canonical_area:"Medicina Interna",canonical_specialty:"Endocrinología y Metabolismo"}));}</script>'
html += '<script>' + (ROOT/'app.js').read_text(encoding='utf-8').replace('</script>', '<\\/script>') + '</script></body></html>'

with sync_playwright() as p:
    launch_args = {'headless': True, 'args': ['--no-sandbox']}
    if Path('/usr/bin/chromium').exists():
        launch_args['executable_path'] = '/usr/bin/chromium'
    browser = p.chromium.launch(**launch_args)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content(html)
    page.wait_for_timeout(700)

    assert 'v1.3.1' in page.locator('body').inner_text()

    page.get_by_role('button', name='📊 MI ESTADO').click()
    page.wait_for_timeout(150)
    header = page.locator('.topic-coverage-table thead').first.inner_text()
    assert 'N.º' in header and 'TTS' in header
    assert '89 TTS disponibles' in page.locator('.tts-catalog-meta').last.inner_text()
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
    page.get_by_role('button', name='Empezar').first.click()
    page.locator('.option[data-letter]').first.click()
    page.wait_for_timeout(250)
    page.locator('#cancel-study').click()
    page.get_by_role('button', name='Cerrar sesión parcial y revisar respondidas').click()
    page.wait_for_timeout(250)
    page.locator('[data-review-exit]').first.click()

    page.get_by_role('button', name='📊 MI ESTADO').click()
    page.locator('#stats-weakness-report').click()
    page.wait_for_timeout(100)
    assert 'Disponibilidad TTS: 89 temas' in page.locator('.tts-catalog-meta').first.inner_text()
    assert page.locator('[data-weak-tts]', has_text='TTS_001').count() == 1

    browser.close()

print('QA navegador v1.3.1: OK')
