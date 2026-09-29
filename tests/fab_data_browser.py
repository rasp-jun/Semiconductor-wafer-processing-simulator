"""Exercise public telemetry ingestion, mapping, simulation and provenance export."""
import functools
import hashlib
import json
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parent.parent
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def main():
    server=None
    if len(sys.argv)>1:origin=sys.argv[1].rstrip('/')
    else:
        server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT/'.test-tools/site-source/dist')))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        origin=f'http://127.0.0.1:{server.server_port}'
    output=ROOT/'.test-tools/fab-data'
    output.mkdir(parents=True,exist_ok=True)
    results=[]
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='chrome',headless=True)
            for width in [1440,390]:
                page=browser.new_page(viewport={'width':width,'height':1000},accept_downloads=True)
                errors=[];calls=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('request',lambda r:calls.append(r.url) if '/api/' in r.url else None)
                page.goto(origin+'/fab-data.html',wait_until='load')
                assert not page.locator('#fabDataServer').is_visible()
                page.locator('#demoButton').click()
                assert '합성 예제' in page.locator('#sourceInfo').inner_text()
                page.locator('#simulateButton').click()
                expect(page.locator('#results')).to_be_visible()
                assert '시간 가중 평균' in page.locator('#mappingSummary').inner_text()
                assert 'NaN' not in page.locator('#metricResults').inner_text()
                page.locator('#results').scroll_into_view_if_needed()
                page.screenshot(path=str(output/f'result-{width}.png'))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                page.locator('#maxGap').fill('1')
                assert page.locator('#exportResult').is_disabled()
                page.locator('#simulateButton').click()
                expect(page.locator('#dataStatus')).to_contain_text('공백')
                assert not page.locator('#results').is_visible()
                page.locator('#maxGap').fill('5')
                raw=json.dumps(page.evaluate('FabData.example()'),ensure_ascii=False).encode()
                page.locator('#dataFile').set_input_files({'name':'equipment.json','mimeType':'application/json','buffer':raw})
                expect(page.locator('#dataStatus')).to_contain_text('불러왔습니다')
                page.locator('#simulateButton').click()
                expect(page.locator('#dataStatus')).to_contain_text('태그를 지정')
                page.locator('[data-map=temperature]').select_option('BathTemperature')
                page.locator('#simulateButton').click()
                expect(page.locator('#exportResult')).to_be_enabled()
                with page.expect_download() as event:page.locator('#exportResult').click()
                package=json.loads(Path(event.value.path()).read_text(encoding='utf-8'))
                assert package['sourceSha256']==hashlib.sha256(raw).hexdigest()
                assert package['sourceHashKind']=='original-file-bytes'
                assert package['sourceVerified'] is False
                assert package['result']['records'][0]['recipe']['time']==90
                with page.expect_download() as event:page.locator('#csvDownload').click()
                csv=Path(event.value.path()).read_bytes()
                page.locator('#dataFile').set_input_files({'name':'equipment.csv','mimeType':'text/csv','buffer':csv})
                expect(page.locator('#dataStatus')).to_contain_text('불러왔습니다')
                page.locator('[data-map=temperature]').select_option('BathTemperature')
                page.locator('#simulateButton').click()
                expect(page.locator('#results')).to_be_visible()
                assert not errors,errors
                assert not calls,calls
                assert page.evaluate('localStorage.length')==0
                results.append({'width':width,'json_csv_mapping_simulation_export':True,'exact_source_hash':True,'api_calls':calls,'page_errors':errors})
                page.close()
            browser.close()
    finally:
        if server:server.shutdown();server.server_close()
    (output/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=False))
if __name__=='__main__':main()
