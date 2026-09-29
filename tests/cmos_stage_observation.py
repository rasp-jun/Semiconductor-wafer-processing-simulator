"""Verify scanning observation landmarks, captions and pause behavior in real Chrome."""
import json
import re
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from waitress import create_server
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from server.app import create_app
ROOT=Path(__file__).resolve().parent.parent

def main():
    results=[]
    output=ROOT/'.test-tools'/'stage-observation'
    output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        server=None
        if len(sys.argv)>1:
            origin=sys.argv[1].rstrip('/')
        else:
            server=create_server(create_app(Path(temporary)/'review.sqlite3',testing=True),host='127.0.0.1',port=0)
            threading.Thread(target=server.run,daemon=True).start()
            origin=f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                for tool,width in [('scanner',1440),('metrology',1440),('probe',1440),('probe',390)]:
                    page=browser.new_page(viewport={'width':width,'height':1000})
                    errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(origin+'/cmos-lab.html',wait_until='load')
                    initial=page.evaluate("""tool=>{let w=FabEngine.createWafer('SCAN');const step=FabEngine.route.find(s=>s.tool===tool);while(w.cursor<step.index)w=FabEngine.execute(w).wafer;FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:'SCAN',records:w.records}]});return w.cursor;}""",tool)
                    assert '계산 표본 수와 별개' in page.locator('#equipmentCaption').inner_text()
                    page.locator('#observeStops').check()
                    page.locator('#speedSelect').select_option('8')
                    page.locator('#runButton').click()
                    poses=[];positions=[]
                    for _ in range(45):
                        expect(page.locator('#runState')).to_have_text(re.compile('^(일시정지|기록 완료)$'),timeout=10000)
                        if page.locator('#runState').inner_text()=='기록 완료':break
                        assert page.evaluate("FabApp.snapshot().wafers.find(w=>w.id==='SCAN').records.length")==initial
                        percent=page.locator('#phaseProgress').evaluate('el=>parseFloat(el.style.width)')
                        positions.append(percent)
                        pose=page.evaluate("""percent=>{const t=FabViewport.playback(FabEngine.tools[FabEngine.route[FabApp.snapshot().selected].tool].family,percent/100*12);return {...t,...FabViewport.stageMotion(t.progress)};}""",percent)
                        if pose['phase']=='process' and pose['progress']>1e-8:
                            caption=page.locator('#motionAction').inner_text()
                            assert f"대표 위치 {pose['site']}/4" in caption,caption
                            pose['caption']=caption
                            poses.append(pose)
                            if tool=='probe' and pose['action']=='hold':
                                assert '접촉 상태' in caption
                                assert pose['contact']>.999999
                                if pose['site']==1:
                                    page.locator('#motionAction').scroll_into_view_if_needed()
                                    page.screenshot(path=str(output/f'{tool}-{width}.png'))
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                        page.locator('#stepMotionButton').click()
                    assert [p['action'] for p in poses]==['settle','hold','ready']*4,poses
                    assert [p['site'] for p in poses]==[1,1,1,2,2,2,3,3,3,4,4,4]
                    assert page.evaluate("FabApp.snapshot().wafers.find(w=>w.id==='SCAN').records.length")==initial+1
                    assert not errors,errors
                    results.append({'tool':tool,'width':width,'observed_sites':4,'process_stops':len(poses),'all_stops':len(positions),'page_errors':errors})
                    page.close()
                browser.close()
        finally:
            if server:server.close()
    (output/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(results,ensure_ascii=False))
if __name__=='__main__':main()
