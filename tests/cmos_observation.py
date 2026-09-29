"""Exercise observation controls and readable captions in desktop/mobile Chrome."""
import json
import re
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from waitress import create_server
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.app import create_app

ROOT = Path(__file__).resolve().parent.parent

def main():
    output=ROOT/'.test-tools'/'observation'
    output.mkdir(parents=True,exist_ok=True)
    results=[]
    with tempfile.TemporaryDirectory() as temporary:
        server=create_server(create_app(Path(temporary)/'review.sqlite3',testing=True),host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                for width in [1440,390]:
                    page=browser.new_page(viewport={'width':width,'height':1000})
                    errors=[]
                    page.on('pageerror',lambda error:errors.append(str(error)))
                    page.goto(f'http://127.0.0.1:{server.effective_port}/cmos-lab.html',wait_until='load')
                    page.evaluate("""() => {window.pauseAudit=[];new MutationObserver(()=>{if(document.querySelector('#runState').textContent==='일시정지'){const n=parseFloat(document.querySelector('#phaseProgress').style.width);if(window.pauseAudit.at(-1)!==n)window.pauseAudit.push(n);}}).observe(document.querySelector('#runState'),{childList:true,subtree:true,characterData:true});}""")
                    page.locator('#observeStops').check()
                    page.locator('#speedSelect').select_option('8')
                    page.locator('#autoRun').check()
                    page.locator('#runButton').click()
                    captions=[];positions=[]
                    for checkpoint in range(30):
                        expect(page.locator('#runState')).to_have_text(re.compile('^(일시정지|기록 완료)$'),timeout=10000)
                        if page.locator('#runState').inner_text()=='기록 완료':
                            break
                        assert page.evaluate('FabApp.snapshot().wafers[0].records.length')==0
                        captions.append(page.locator('#motionAction').inner_text())
                        positions.append(page.locator('#phaseProgress').evaluate('(el)=>parseFloat(el.style.width)'))
                        assert page.evaluate("getComputedStyle(document.querySelector('#motionAction')).whiteSpace")=='normal'
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
                        if checkpoint==5:
                            page.locator('#motionAction').scroll_into_view_if_needed()
                            page.screenshot(path=str(output/f'{width}-caption.png'))
                        page.locator('#stepMotionButton').click()
                    assert page.evaluate('FabApp.snapshot().wafers[0].records.length')==1
                    page.wait_for_timeout(400)
                    assert page.locator('#runState').inner_text()=='기록 완료'
                    expected=[2,8,12.4,16.8,20,22.4,28,34,40,51,53,56,60,64.8,68.8,76,80.8,82,96.4]
                    assert len(positions)==len(expected),positions
                    assert all(abs(a-b)<1e-7 for a,b in zip(positions,expected)),positions
                    assert page.evaluate("document.querySelector('.viewport-caption').getBoundingClientRect().top >= document.querySelector('.fab-viewport').getBoundingClientRect().bottom-1")
                    assert any('클램프' in s for s in captions)
                    assert any('수직' in s for s in captions)
                    assert any('린스' in s for s in captions)
                    assert not errors,errors
                    results.append({'width':width,'checkpoints':len(captions),'page_errors':errors,'positions':positions,'pause_audit':page.evaluate('window.pauseAudit')})
                    page.close()
                browser.close()
        finally:
            server.close()
    (output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=False))

if __name__=='__main__':
    main()
