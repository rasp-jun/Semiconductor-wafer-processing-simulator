"""Exercise actual public-data inference and evidence downloads on desktop/mobile."""
import functools,json,sys,threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
server=None
if len(sys.argv)>1:origin=sys.argv[1].rstrip('/')
else:
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(ROOT/'.test-tools/site-source/dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        for width in [1440,390]:
            page=browser.new_page(viewport={'width':width,'height':1000},accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(origin+'/public-study.html');page.wait_for_function("!document.getElementById('studyPredict').disabled")
            assert page.locator('#studyRun option').count()==75
            assert '0.157' in page.locator('#metrics').inner_text()
            page.locator('#studyRun').select_option('2024-08-21_10');page.locator('#studyPredict').click()
            assert '미학습 검증용' in page.locator('#runContext').inner_text()
            page.locator('#studySensor').select_option('2');assert page.locator('#studyChart polyline').count()==1
            with page.expect_download() as info:page.locator('#studyExport').click()
            data=json.loads(Path(info.value.path()).read_text(encoding='utf-8'))
            assert data['run']['id']=='2024-08-21_10' and data['source']['doi']=='10.5281/zenodo.17122442'
            assert abs(data['result']['depthUm']-data['run']['predictedDepthUm'])<1e-9
            assert data['audit']['physicalModelConnection'].startswith('blocked:')
            page.locator('#studyRun').select_option('2024-07-02_01');assert '독립 검증 아님' in page.locator('#runContext').inner_text()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
            assert not errors,errors
            page.screenshot(path=str(ROOT/f'.test-tools/public-study-{width}.png'),full_page=True)
            page.close()
        browser.close()
    print(json.dumps({'origin':origin,'viewports':[1440,390],'inference':'passed','download':'passed','overflow':False}))
finally:
    if server:server.shutdown();server.server_close()
