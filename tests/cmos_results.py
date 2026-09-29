"""Check result provenance, expanded metrology rows and mobile layout on the public build."""
import functools
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def main():
    server=None
    if len(sys.argv)>1:origin=sys.argv[1].rstrip('/')
    else:
        server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT/'.test-tools/site-source/dist')))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        origin=f'http://127.0.0.1:{server.server_port}'
    output=ROOT/'.test-tools/results-review'
    output.mkdir(parents=True,exist_ok=True)
    results=[]
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='chrome',headless=True)
            for width in [1440,390]:
                page=browser.new_page(viewport={'width':width,'height':1000})
                errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(origin+'/cmos-lab.html',wait_until='load')
                page.locator('#previewButton').click()
                assert page.locator('[data-change=before]').get_attribute('data-value')=='100'
                assert float(page.locator('[data-change=after]').get_attribute('data-value'))<10
                assert '예상 결과' in page.locator('.process-change-heading').inner_text()
                page.locator('.process-change').scroll_into_view_if_needed()
                page.screenshot(path=str(output/f'clean-{width}.png'))
                assert page.evaluate('FabApp.snapshot().wafers[0].records.length')==0
                page.evaluate("""()=>{let w=FabEngine.createWafer('RESULT');while(w.cursor<FabEngine.route.length)w=FabEngine.execute(w).wafer;FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:'RESULT',records:w.records}]});}""")
                doping = page.evaluate("""()=>{
                    const checks=[];
                    for(const count of [66,70]){
                        FabApp.select(count-1);
                        const snapshot=FabApp.snapshot(),entry=snapshot.wafers.find(w=>w.id===snapshot.active),wafer=FabEngine.replay(entry.id,entry.records,count);
                        const bands=[...document.querySelectorAll('#crossSection [data-doping-start]')];
                        if(!bands.length)throw Error('Missing dopant overlay');
                        for(const band of bands){
                            const start=Number(band.dataset.dopingStart),end=Number(band.dataset.dopingEnd),top=Number(band.dataset.topNm),bottom=Number(band.dataset.bottomNm);
                            if(!(bottom>=-FabEngine.BASE-1e-9&&top>bottom))throw Error('Doping band extends below silicon');
                            for(let i=start;i<end;i++){
                                const surface=wafer.columns[i].find(l=>l.material==='Si').nm-FabEngine.BASE;
                                if(top>surface+1e-9)throw Error('Doping overlay extends above local silicon at '+i);
                                const net=FabEngine.dopingAt(wafer,i,surface-(top+bottom)/2),type=net>0?'n':'p';
                                if(type!==band.dataset.dopingType||band.getAttribute('fill')!==(type==='n'?'#70d1ee':'#f5a9a2'))throw Error('Wrong visible doping polarity at '+i);
                            }
                        }
                        checks.push({completed:count,visibleBands:bands.length});
                    }
                    return checks;
                }""")
                page.locator('#crossSection').screenshot(path=str(output/f'doping-{width}.png'))
                page.evaluate('FabApp.select(FabEngine.route.length-1)')
                page.locator('.measurement-details summary').click()
                page.locator('#crossSection').click()
                assert page.locator('.measurement-details').get_attribute('open') is not None
                page.evaluate('FabApp.select(1)')
                original=page.locator('[data-change=after]').get_attribute('data-value')
                page.locator('#recipe-rpm').fill('4000')
                assert page.locator('[data-change=after]').get_attribute('data-value')==original
                page.locator('#tab-sweep').click()
                page.locator('#sweepLow').fill('2000')
                page.locator('#sweepHigh').fill('4000')
                page.locator('#sweepRun').click()
                assert 'stale' not in (page.locator('#sweepDraftNotice').get_attribute('class') or '')
                page.locator('#recipe-time').fill('50')
                assert '이전에 계산한 결과' in page.locator('#sweepDraftNotice').inner_text()
                page.locator('#sweepDraftNotice').scroll_into_view_if_needed()
                page.screenshot(path=str(output/f'sweep-{width}.png'))
                page.locator('#sweepRun').click()
                assert 'stale' not in page.locator('#sweepDraftNotice').get_attribute('class')
                assert '50 s' in page.locator('#sweepResults').inner_text()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                assert not errors,errors
                results.append({'width':width,'before_after':True,'measurement_expansion':True,'sweep_provenance':True,'doping_polarity_and_silicon_bounds':doping,'page_errors':errors})
                page.close()
            browser.close()
    finally:
        if server:server.shutdown();server.server_close()
    (output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=False))
if __name__=='__main__':main()
