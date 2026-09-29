"""Check Blender hardware, unchanged moving mechanisms and asset fallback in real Chrome."""
import json
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from waitress import create_server

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from server.app import create_app


def main():
    output=ROOT/'.test-tools'/'blender-live'
    output.mkdir(parents=True,exist_ok=True)
    checks=[]
    with tempfile.TemporaryDirectory() as temporary:
        server=create_server(create_app(Path(temporary)/'blender.sqlite3',testing=True),host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                page=browser.new_page(viewport={'width':1500,'height':1100})
                errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                url=f'http://127.0.0.1:{server.effective_port}/cmos-lab.html'
                page.goto(url,wait_until='networkidle')
                baseline=page.evaluate('''()=>{let w=FabEngine.createWafer('REFERENCE');while(w.cursor<117)w=FabEngine.execute(w).wafer;return w.records}''')
                tool_ids=page.evaluate('Object.keys(FabEngine.tools)')
                for tool in tool_ids:
                    index=page.evaluate('''({tool,records})=>{const index=FabEngine.route.findIndex(s=>s.tool===tool);FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:'TEST-'+tool,records:records.slice(0,index)}]});return index}''',{'tool':tool,'records':baseline})
                    expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool',tool,timeout=20000)
                    page.locator('#cutaway').check()
                    initial=page.evaluate('FabApp.snapshot().wafers.find(w=>w.id===FabApp.snapshot().active).records')
                    page.locator('#runButton').click()
                    page.locator('#runButton').click()
                    expect(page.locator('#runState')).to_have_text('일시정지')
                    poses=[]
                    for percent in [30,55,75,90]:
                        page.locator('#observationSeek').evaluate('(el,value)=>{el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}))}',percent)
                        page.wait_for_timeout(60)
                        result=page.evaluate('''()=>{
                          const models=FabApp.viewport.scene.children.flatMap(g=>g.children||[]).filter(o=>o.name.startsWith('blender-'));
                          const wafer=FabApp.viewport.wafer;
                          const nodes=['wet-carrier','wet-tilt-cradle','cmp-carrier-lift','thermal-cover','chamber-gate','wafer-lift-pins','implant-transfer-door'];
                          const moving=nodes.map(name=>FabApp.viewport.scene.getObjectByName(name)).filter(Boolean).map(o=>({name:o.name,visible:o.visible,position:o.position.toArray(),rotation:o.rotation.toArray().slice(0,3)}));
                          return {models:models.length,wafer:wafer.position.toArray(),moving,triangles:FabApp.viewport.renderer.info.render.triangles};
                        }''')
                        assert result['models']==1,(tool,result)
                        assert all(item['visible'] for item in result['moving']),(tool,result)
                        assert result['triangles']>0
                        assert page.evaluate('FabApp.snapshot().wafers.find(w=>w.id===FabApp.snapshot().active).records')==initial
                        poses.append(result)
                    assert len({tuple(p['wafer']) for p in poses})>1,(tool,poses)
                    page.locator('#cutaway').uncheck()
                    assert page.evaluate('''()=>{let valid=true;FabApp.viewport.scene.traverse(o=>{if(o.userData.cutawayShell&&o.material.opacity!==1)valid=false});return valid}''')
                    page.locator('#cutaway').check()
                    page.locator('.equipment-panel').screenshot(path=str(output/f'{tool}.png'))
                    page.locator('#cancelRunButton').click()
                    assert page.evaluate('FabApp.snapshot().wafers.find(w=>w.id===FabApp.snapshot().active).records')==initial
                    checks.append({'tool':tool,'input_records':index,'observed_positions':len(poses),'committed_records_changed':False})
                assert not errors,errors

                # Failure is contained: the original procedural model stays functional.
                fallback=browser.new_page(viewport={'width':1200,'height':1000})
                fallback.route('**/assets/cmos/*',lambda route:route.fulfill(status=503,body='unavailable'))
                fallback.goto(url,wait_until='networkidle')
                expect(fallback.locator('#fabViewport')).to_have_attribute('data-precision-model','procedural')
                fallback.locator('#runButton').click();fallback.locator('#runButton').click()
                expect(fallback.locator('#runState')).to_have_text('일시정지')
                assert fallback.locator('#crossSection svg').count()==1
                fallback.locator('#cancelRunButton').click()
                browser.close()
        finally:server.close()
    (output/'results.json').write_text(json.dumps({'equipment':checks,'fallback':'passed','page_errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Blender hardware: {len(checks)} tools × 4 observation positions, cutaway, cancel, immutable histories, fallback; no page errors.')


if __name__=='__main__':main()
