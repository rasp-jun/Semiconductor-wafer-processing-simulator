"""Smoke-test the exact browser-only artifact or a supplied public URL."""
import functools
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def main():
    server=None
    if len(sys.argv)>1:
        origin=sys.argv[1].rstrip('/')
    else:
        handler=functools.partial(QuietHandler,directory=str(ROOT/'.test-tools'/'site-source'/'dist'))
        server=ThreadingHTTPServer(('127.0.0.1',0),handler)
        threading.Thread(target=server.serve_forever,daemon=True).start()
        origin=f'http://127.0.0.1:{server.server_port}'
    errors,api_calls,checked,external_requests,asset_failures=[],[],[],[],[]
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='chrome',headless=True)
            page=browser.new_page(viewport={'width':1440,'height':1000})
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.on('request',lambda req:api_calls.append(req.url) if '/api/' in req.url else None)
            page.on('request',lambda req:external_requests.append(req.url) if req.url.startswith(('https://','http://')) and not req.url.startswith(origin+'/') else None)
            page.on('response',lambda response:asset_failures.append({'url':response.url,'status':response.status}) if response.status>=400 else None)
            for route in ['index.html','memory-fab.html','cmos-lab.html','equipment.html','photo-lab.html','evidence.html','workbench.html','fab-data.html','public-study.html','fab-pilot.html']:
                response=page.goto(origin+'/'+route,wait_until='load')
                assert response.status==200,(route,response.status)
                page.wait_for_timeout(250)
                if route=='cmos-lab.html':
                    assert page.evaluate('!!FabApp.viewport.renderer')
                    assert page.locator('[data-step]').count()==117
                    assert page.evaluate("!!FabApp.viewport.scene.getObjectByName('wet-tilt-cradle')")
                    assert page.locator('#runState').inner_text()=='대기'
                if route=='equipment.html':
                    assert not page.locator('#reviewConnect').is_visible()
                    assert not page.locator('#archiveRun').is_visible()
                    assert page.locator('#pinBaseline').is_visible()
                if route=='workbench.html':
                    assert '근거를 남기는 작업 공간.' in page.locator('h1').inner_text()
                    assert page.title()=='STRATUM · 공개 버전 안내'
                checked.append(route)
            for name in ['fab-observe.js','fab-pilot-review.js','public-mode.js','fab-pilot.html','fab-pilot-core.js','fab-pilot-app.js','public-study.html','public-study-core.js','public-study-app.js','public-data/spts-study.json','fab-data.html','fab-data-core.js','fab-data-app.js','fab-data.css','fab.css','fab-view.js','fab-app.js','fab-guide.js','fab-engine.js','cmos-lab.html']:
                local=(ROOT/'.test-tools'/'site-source'/'dist'/name).read_text(encoding='utf-8')
                live=page.evaluate('async name => {const r=await fetch(name);if(!r.ok)throw Error(r.status);return await r.text();}',name)
                assert local.replace('\r\n','\n')==live.replace('\r\n','\n'),name+' differs from verified build'
            for private in ['server/app.py','server/fab_data.py','server/fab-data-schema.sql','tools/push_fab_data.py','.data/waferflow.sqlite3','.git/config']:
                response=page.request.get(origin+'/'+private)
                assert response.status==404,(private,response.status)
            browser.close()
        assert not errors,errors
        assert not api_calls,api_calls
        assert not external_requests,external_requests
        assert not asset_failures,asset_failures
        result=dict(origin=origin,pages=checked,page_errors=errors,api_calls=api_calls,external_requests=external_requests,asset_failures=asset_failures)
        print(json.dumps(result,ensure_ascii=False,indent=2))
        (ROOT/'.test-tools'/'public-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    finally:
        if server:
            server.shutdown();server.server_close()

if __name__=='__main__':main()
