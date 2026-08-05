#!/usr/bin/env python3
"""Smoke UI sin red. Requiere Python Playwright y Chromium en /usr/bin/chromium."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ['version.js','pilot-data.js','session-core.js','session-storage.js','question-parser.js','w3-tools.js','w4-data.js','app.js']
POLYFILL = """<script>(()=>{const make=()=>{const m=new Map();return {getItem:k=>m.has(String(k))?m.get(String(k)):null,setItem:(k,v)=>m.set(String(k),String(v)),removeItem:k=>m.delete(String(k)),clear:()=>m.clear(),key:i=>[...m.keys()][i]||null,get length(){return m.size}}};Object.defineProperty(window,'localStorage',{value:make(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:make(),configurable:true});window.APP_CONFIG={SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',ALLOW_SIGNUP:false};})();</script>"""

html = '<!doctype html><html><head><meta charset="utf-8"><style>' + (ROOT/'styles.css').read_text(encoding='utf-8') + '</style></head><body><div id="app"></div>' + POLYFILL
for filename in SCRIPTS:
    html += '<script>' + (ROOT/filename).read_text(encoding='utf-8').replace('</script>', '<\\/script>') + '</script>'
html += '</body></html>'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content(html)
    page.wait_for_timeout(500)

    assert 'v1.2.0' in page.locator('body').inner_text()

    page.get_by_role('button', name='📊 MI ESTADO').click()
    assert 'N.º' in page.locator('.topic-coverage-table thead').first.inner_text()
    assert page.locator('.topic-coverage-table tbody tr').first.locator('td').first.inner_text().strip() == '1'
    page.get_by_role('button', name='Inicio').click()

    page.get_by_role('button', name='Empezar').first.click()
    page.locator('.option[data-letter]').first.click()
    page.wait_for_timeout(300)
    assert page.locator('[data-question-learning-note]').count() == 1
    page.locator('[data-question-learning-note]').click()
    page.locator('#learning-note-save').click()
    assert 'Escribe la duda' in page.locator('#learning-note-save-status').inner_text()
    page.locator('#learning-note-text').fill('No sé qué es este concepto ni cómo se diferencia de la alternativa vecina.')
    page.locator('#learning-note-type').select_option('differential')
    page.locator('#learning-note-save').click()
    page.wait_for_timeout(100)
    assert page.locator('#learning-notes-menu-btn').inner_text().strip().endswith('1')

    page.locator('#cancel-study').click()
    page.get_by_role('button', name='Cerrar sesión parcial y revisar respondidas').click()
    page.wait_for_timeout(250)
    assert page.locator('#review-jump-input').count() == 1
    assert page.locator('[data-review-last]').count() >= 1
    assert page.locator('[data-review-exit]').count() >= 1
    assert 'pregunta 1 de la sesión original' in page.locator('body').inner_text()
    page.locator('[data-review-exit]').first.click()

    page.locator('#account-menu-btn').click()
    page.locator('#learning-notes-menu-btn').click()
    assert 'Dudas personales para resolver' in page.locator('body').inner_text()
    assert page.locator('#download-learning-notes-md').count() == 1
    assert page.locator('#download-learning-notes-csv').count() == 1

    browser.close()

print('QA navegador v1.2.0: OK')
