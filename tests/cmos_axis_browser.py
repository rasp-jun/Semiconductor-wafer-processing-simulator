"""Validate AXIS product interactions, corrupted assets, recovery and real PNG exports."""
import json
import struct
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from waitress import create_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.app import create_app


def records(page):
    return page.evaluate('() => FabApp.snapshot().wafers.map(w=>w.records)')


def main():
    output = ROOT / '.test-tools' / 'cmos-axis'
    output.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary)/'axis.sqlite3', testing=True), host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        url = f'http://127.0.0.1:{server.effective_port}/cmos-lab.html'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                page = browser.new_page(viewport={'width':1600,'height':1200}, accept_downloads=True)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(url, wait_until='networkidle')
                viewport = page.locator('#fabViewport')
                expect(viewport).to_have_attribute('data-asset-status','ready',timeout=20000)
                initial = records(page)
                expect(page.locator('#cutaway')).not_to_be_checked()
                canvas = viewport.locator('canvas')
                canvas.focus()
                canvas.press('2')
                expect(page.locator('#cutaway')).to_be_checked()
                expect(page.locator('[data-camera=chamber]')).to_have_class('active')
                canvas.press('3')
                expect(page.locator('[data-camera=wafer]')).to_have_class('active')
                canvas.press('4')
                expect(page.locator('[data-camera=top]')).to_have_class('active')
                canvas.press('1')
                page.locator('#cutaway').uncheck()
                with page.expect_download() as download:
                    page.locator('#captureEquipment').click()
                png = Path(download.value.path()).read_bytes()
                assert png[:8] == b'\x89PNG\r\n\x1a\n'
                width,height = struct.unpack('>II',png[16:24])
                assert width>=600 and height>=300 and len(png)>30000
                assert download.value.suggested_filename == 'waferflow-axis-OP001-exterior.png'
                download.value.save_as(output/'equipment-export.png')
                assert records(page)==initial
                checks.append('Keyboard camera shortcuts and valid full-size PNG export preserve records')

                # All models must contain a real outer enclosure and independently visible mechanisms.
                tools = page.evaluate('() => Object.keys(FabEngine.tools)')
                samples=[]
                for tool in tools:
                    page.evaluate('(id)=>FabApp.select(FabEngine.route.findIndex(s=>s.tool===id))',tool)
                    expect(viewport).to_have_attribute('data-precision-tool',tool,timeout=20000)
                    page.locator('#cutaway').uncheck()
                    exterior=page.evaluate('''() => {
                      const v=FabApp.viewport, parts=[];
                      v.scene.traverse(o=>{if(o.userData.equipmentRole==='exterior')parts.push(o.visible)});
                      return {parts,mechanisms:v.scene.getObjectByName('axis-live-mechanisms').visible,wafer:v.wafer.visible};
                    }''')
                    assert exterior['parts'] and all(exterior['parts']) and not exterior['mechanisms'] and not exterior['wafer'],tool
                    page.locator('#cutaway').check()
                    assert page.evaluate('''() => {
                      let valid=true;FabApp.viewport.scene.traverse(o=>{if(o.userData.equipmentRole==='exterior'&&o.visible)valid=false});
                      return valid&&FabApp.viewport.scene.getObjectByName('axis-live-mechanisms').visible&&FabApp.viewport.wafer.visible;
                    }'''),tool
                    page.locator('#equipmentSources').click()
                    expect(page.locator('#equipmentSourcesDialog')).to_be_visible()
                    page.wait_for_function('() => [...document.querySelectorAll("#equipmentSourcesBody img")].every(i=>i.complete&&i.naturalWidth>0)')
                    link=page.locator('#equipmentSourcesBody .reference-link')
                    assert link.get_attribute('href').startswith('https://')
                    expect(page.locator('.reference-scope')).to_contain_text('단순화')
                    page.keyboard.press('Escape')
                    expect(page.locator('#equipmentSources')).to_be_focused()
                    assert records(page)==initial
                    samples.append({'tool':tool,'outer_mesh_groups':len(exterior['parts'])})
                checks.append('18 exterior/internal models and source dialogs; images load, focus returns, records unchanged')

                page.locator('#openEquipmentAtlas').click()
                expect(page.locator('[data-atlas-tool]')).to_have_count(18)
                page.locator('[data-atlas-view=mechanism]').click()
                assert page.locator('#atlasGrid img').evaluate_all('(els)=>els.every(i=>i.src.includes("-section.jpg"))')
                page.locator('[data-atlas-tool=scanner]').click()
                expect(viewport).to_have_attribute('data-precision-tool','scanner',timeout=20000)
                expect(page.locator('#cutaway')).to_be_checked()
                page.locator('#openEquipmentAtlas').click()
                page.locator('[data-atlas-view=exterior]').click()
                page.screenshot(path=str(output/'collection.png'))
                page.locator('[data-atlas-tool=clean]').click()
                expect(viewport).to_have_attribute('data-precision-tool','clean',timeout=20000)
                expect(page.locator('#cutaway')).not_to_be_checked()
                page.screenshot(path=str(output/'desktop.png'),full_page=True)
                page.locator('#equipmentSources').click()
                page.screenshot(path=str(output/'references.png'))
                page.keyboard.press('Escape')
                checks.append('Gallery exterior/internal choice carries through to live equipment')

                page.locator('#runButton').click()
                expect(page.locator('#cutaway')).not_to_be_checked()
                page.locator('#cutaway').check()
                expect(page.locator('#runState')).to_have_text('처리 중')
                page.locator('#cutaway').uncheck()
                expect(page.locator('#runState')).to_have_text('처리 중')
                page.locator('#runButton').click()
                expect(page.locator('#runState')).to_have_text('일시정지')
                page.locator('#cutaway').check()
                page.locator('#observationSeek').evaluate('(el)=>{el.value=55;el.dispatchEvent(new Event("input",{bubbles:true}))}')
                page.locator('#cutaway').uncheck()
                assert records(page)==initial
                # Exercise actual WebGL loss/restoration rather than synthesizing DOM events.
                assert page.evaluate('''() => {
                  window.axisContextExtension=FabApp.viewport.renderer.getContext().getExtension('WEBGL_lose_context');
                  if(!window.axisContextExtension)return false;window.axisContextExtension.loseContext();return true;
                }''')
                expect(page.locator('.webgl-recovery')).to_be_visible()
                page.wait_for_timeout(150)
                page.evaluate('() => window.axisContextExtension.restoreContext()')
                expect(page.locator('.webgl-recovery')).to_have_count(0,timeout=20000)
                assert page.evaluate('() => FabApp.viewport.renderer.getClearColor(new THREE.Color()).getHex()')==0x161b21
                assert records(page)==initial
                page.locator('#cancelRunButton').click()
                checks.append('Paused observation and actual WebGL context restoration preserve committed history')

                for width in [820,390,360]:
                    page.set_viewport_size({'width':width,'height':1100})
                    page.locator('#openRoute').click()
                    expect(page.locator('#routeDialog')).to_be_visible()
                    for _ in range(5):
                        page.keyboard.press('Tab')
                        assert page.evaluate('() => document.querySelector("#routeDialog").contains(document.activeElement)')
                    page.keyboard.press('Escape')
                    expect(page.locator('#openRoute')).to_be_focused()
                    page.locator('#openRoute').click()
                    page.locator('[data-step="1"]').press('Enter')
                    expect(page.locator('#routeDialog')).not_to_be_visible()
                    expect(page.locator('#openRoute')).to_be_focused()
                    for workspace in ['equipment','wafer','analysis']:
                        page.locator(f'[data-workspace={workspace}]').click()
                        assert page.evaluate('() => document.documentElement.scrollWidth<=innerWidth+1'),(width,workspace)
                        if workspace=='analysis':
                            contrast=page.evaluate('''() => {
                              const rgb=s=>(s.match(/[\\d.]+/g)||[]).map(Number);
                              const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
                              return ['.analysis-intro p','.metric strong','.measurement-note'].map(selector=>{
                                const el=document.querySelector(selector);let parent=el,bg;
                                while(parent){bg=rgb(getComputedStyle(parent).backgroundColor);if(bg.length===3||bg[3]>0)break;parent=parent.parentElement;}
                                const a=lum(rgb(getComputedStyle(el).color)),b=lum(bg);return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
                              });
                            }''')
                            assert all(item['ratio']>=4.5 for item in contrast),contrast
                    page.locator('[data-workspace=equipment]').click()
                    if width==390:page.screenshot(path=str(output/'mobile.png'),full_page=True)
                checks.append('Responsive workspaces and modal keyboard/focus behavior at 820/390/360px')

                broken = browser.new_page(viewport={'width':1280,'height':1000})
                broken.on('pageerror',lambda e:errors.append(str(e)))
                def corrupt(route):
                    response=route.fetch()
                    data=bytearray(response.body());data[100]^=1
                    route.fulfill(response=response,body=bytes(data))
                broken.route('**/assets/cmos/*.bin*',corrupt)
                broken.goto(url,wait_until='networkidle')
                expect(broken.locator('#fabViewport')).to_have_attribute('data-asset-status','fallback',timeout=20000)
                expect(broken.locator('#retryModel')).to_be_visible()
                expect(broken.locator('#crossSection svg')).to_have_count(1)
                broken.locator('#runButton').click();broken.locator('#runButton').click()
                broken.locator('#observationSeek').evaluate('(el)=>{el.value=55;el.dispatchEvent(new Event("input",{bubbles:true}))}')
                expect(broken.locator('#cutaway')).not_to_be_checked()
                expect(broken.locator('.equipment-operation-status')).to_contain_text('일시정지')
                broken.unroute('**/assets/cmos/*.bin*',corrupt)
                broken.locator('#retryModel').click()
                expect(broken.locator('#fabViewport')).to_have_attribute('data-asset-status','ready',timeout=20000)
                expect(broken.locator('#retryModel')).not_to_be_visible()
                expect(broken.locator('#cutaway')).not_to_be_checked()
                expect(broken.locator('#runState')).to_have_text('일시정지')
                assert broken.locator('#observationSeek').input_value()=='55'
                assert records(broken)==[[]]
                checks.append('Same-size binary corruption is rejected; retry restores detailed hardware without losing data')

                unavailable=browser.new_page()
                unavailable.on('pageerror',lambda e:errors.append(str(e)))
                unavailable.add_init_script('''(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return String(kind).startsWith('webgl')?null:original.call(this,kind,...args)}})()''')
                unavailable.goto(url,wait_until='networkidle')
                expect(unavailable.locator('#assetState')).to_have_text('3D 사용 불가')
                expect(unavailable.locator('#captureEquipment')).to_be_disabled()
                unavailable.locator('#previewButton').click()
                expect(unavailable.locator('#crossSection svg')).to_have_count(1)
                assert records(unavailable)==[[]]
                checks.append('No-WebGL fallback keeps recipe preview and section calculation available')
                browser.close()
        finally:server.close()
    assert not errors,errors
    payload={'checks':checks,'models':samples,'page_errors':errors}
    (output/'results.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(payload,ensure_ascii=False))


if __name__=='__main__':main()
