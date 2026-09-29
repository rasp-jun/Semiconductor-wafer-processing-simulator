"""Verify simulator scrubbing cannot alter history until resume/commit."""
import functools,json,sys,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
server=None
if len(sys.argv)>1:origin=sys.argv[1].rstrip('/')
else:
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(ROOT/'.test-tools/site-source/dist')));threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        for width in [1440,390]:
            page=browser.new_page(viewport={'width':width,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(origin+'/cmos-lab.html');page.wait_for_function('!!window.FabApp')
            assert page.locator('#observationSeek').is_disabled()
            page.evaluate('async()=>{const step=FabEngine.route.find(s=>s.tool==="oxidation");FabApp.select(step.index);await FabApp.advance();}')
            initial=page.evaluate('FabApp.snapshot().wafers[0].records.length')
            page.locator('#runButton').click();page.locator('#runButton').click();assert not page.locator('#observationSeek').is_disabled()
            def seek(value):page.locator('#observationSeek').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));}',str(value))
            seek(100);assert page.evaluate('FabApp.snapshot().wafers[0].records.length')==initial
            assert page.locator('[data-before-surface]').count()==1
            assert page.locator('[data-material-change="mixed"]').count()>0
            page.locator('#profileMaterial').select_option('SiO2')
            assert page.locator('[data-profile-before]').count()==1 and page.locator('[data-profile-current]').count()==1
            page.locator('#profilePresent').check();assert '0 / 160' in page.locator('#profileStatistics').inner_text()
            page.locator('#profileMode').select_option('delta');assert page.locator('[data-profile-before]').count()==0
            page.locator('#filmProfile').focus();page.keyboard.press('End');assert '4.785' in page.locator('#probePosition').inner_text()
            page.keyboard.press('Home');assert '0.015' in page.locator('#profileContext').inner_text()
            page.locator('#profilePresent').uncheck();page.locator('#profileMode').select_option('thickness')
            final_section=page.locator('#crossSection').inner_html()
            page.locator('.section-panel').screenshot(path=str(ROOT/f'.test-tools/fab-observe-live-{width}.png'))
            seek(0);assert page.locator('[data-material-change]').count()==0
            seek(100);assert page.locator('#crossSection').inner_html()==final_section
            page.locator('#changeToggle').uncheck();assert page.locator('[data-before-surface]').count()==0;page.locator('#changeToggle').check()
            page.locator('#runButton').click();page.wait_for_function('(n)=>FabApp.snapshot().wafers[0].records.length===n+1',arg=initial)
            assert page.locator('#observationSeek').is_disabled()
            page.locator('#nextButton').click();page.locator('#runButton').click();page.locator('#runButton').click();seek(100);page.locator('#cancelRunButton').click()
            assert page.evaluate('FabApp.snapshot().wafers[0].records.length')==initial+1
            assert not errors,errors
            page.locator('.section-panel').screenshot(path=str(ROOT/f'.test-tools/fab-observe-{width}.png'))
            page.close()
        browser.close()
    print(json.dumps({'viewports':[1440,390],'scrub_rewind':'passed','commit_once':'passed','cancel_preserves_history':'passed','material_overlay':'passed'}))
finally:
    if server:server.shutdown();server.server_close()
