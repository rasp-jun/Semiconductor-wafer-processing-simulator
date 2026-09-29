"""Regression: explicit internal observation renders the actual moving wafer."""
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
    output=ROOT/'.test-tools'/'wafer-visibility'
    output.mkdir(parents=True,exist_ok=True)
    results,errors=[],[]
    with tempfile.TemporaryDirectory() as temporary:
        server=create_server(create_app(Path(temporary)/'visibility.sqlite3',testing=True),host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        url=f'http://127.0.0.1:{server.effective_port}/cmos-lab.html'
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                page=browser.new_page(viewport={'width':1500,'height':1100},reduced_motion='reduce')
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(url,wait_until='networkidle')
                baseline=page.evaluate('()=>{let w=FabEngine.createWafer("REFERENCE");while(w.cursor<117)w=FabEngine.execute(w).wafer;return w.records}')
                tools=page.evaluate('()=>Object.keys(FabEngine.tools)')
                for tool in tools:
                    page.evaluate('''({tool,records})=>{const index=FabEngine.route.findIndex(s=>s.tool===tool);FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:'VISIBLE-'+tool,records:records.slice(0,index)}]})}''',{'tool':tool,'records':baseline})
                    expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool',tool,timeout=20000)
                    page.locator('#cutaway').check()
                    initial=page.evaluate('()=>JSON.stringify(FabApp.snapshot().wafers.map(w=>w.records))')
                    page.locator('#runButton').click()
                    expect(page.locator('#cutaway')).to_be_checked()
                    page.locator('#runButton').click()
                    expect(page.locator('#runState')).to_have_text('일시정지')
                    for percent in [4,20,40,55,75,95]:
                        page.locator('#observationSeek').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))}',percent)
                        page.wait_for_timeout(70)
                        visible=page.evaluate('''()=>{
                          const v=FabApp.viewport,p=v.wafer.position.clone().project(v.viewCamera);let glass=true;
                          v.scene.traverse(o=>{if(o.isMesh&&o.userData.equipmentRole&&o.material.transparent&&o.material.opacity<1&&o.material.depthWrite)glass=false});
                          return {wafer:v.wafer.visible,robot:v.scene.getObjectByName('transfer-robot').visible,mechanisms:v.scene.getObjectByName('axis-live-mechanisms').visible,projection:p.toArray(),glass};
                        }''')
                        assert visible['wafer'] and visible['robot'] and visible['mechanisms'] and visible['glass'],(tool,percent,visible)
                        assert all(-1<v<1 for v in visible['projection']),(tool,percent,visible)
                        expect(page.locator('.wafer-detail-frame')).to_be_visible()
                        assert page.evaluate('()=>JSON.stringify(FabApp.snapshot().wafers.map(w=>w.records))')==initial
                        if percent==55:
                            # Read actual rendered PNG pixels, not just object.visible flags.
                            pixels=page.evaluate('''async()=>{
                              const png=await FabApp.viewport.capture(),bitmap=await createImageBitmap(png),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
                              const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
                              const host=document.querySelector('#fabViewport'),frame=document.querySelector('.wafer-detail-frame'),scale=canvas.width/host.clientWidth;
                              const x=Math.floor((frame.offsetLeft+frame.clientWidth*.25)*scale),y=Math.floor((frame.offsetTop+frame.clientHeight*.3)*scale),size=Math.floor(frame.clientWidth*.5*scale);
                              const data=ctx.getImageData(x,y,size,size).data;let opaque=0,min=255,max=0;
                              for(let i=0;i<data.length;i+=4){opaque+=data[i+3]===255;const value=(data[i]+data[i+1]+data[i+2])/3;min=Math.min(min,value);max=Math.max(max,value)}
                              return {opaque,total:size*size,variation:max-min,averageMin:min};
                            }''')
                            assert pixels['opaque']==pixels['total'] and pixels['variation']>8,(tool,pixels)
                            page.locator('.equipment-panel').screenshot(path=str(output/(tool+'-process.png')))
                    # A deliberate exterior inspection still leaves the surface monitor visible;
                    # resuming preserves the selected exterior without resetting the run.
                    page.locator('#observationSeek').evaluate('(el)=>{el.value=40;el.dispatchEvent(new Event("input",{bubbles:true}))}')
                    page.locator('#cutaway').uncheck()
                    expect(page.locator('.wafer-detail-frame')).to_be_visible()
                    page.locator('#runButton').click()
                    expect(page.locator('#cutaway')).not_to_be_checked()
                    page.locator('#runButton').click()
                    page.locator('#cancelRunButton').click()
                    assert page.evaluate('()=>JSON.stringify(FabApp.snapshot().wafers.map(w=>w.records))')==initial
                    results.append({'tool':tool,'positions':6,'rendered_surface':pixels,'records_preserved':True})
                for width in [820,390,360]:
                    page.set_viewport_size({'width':width,'height':1100})
                    page.evaluate('()=>FabApp.select(0)')
                    page.locator('#cutaway').check()
                    page.locator('#runButton').click();page.locator('#runButton').click()
                    page.locator('#observationSeek').evaluate('(el)=>{el.value=40;el.dispatchEvent(new Event("input",{bubbles:true}))}')
                    page.wait_for_timeout(100)
                    assert page.evaluate('()=>{const p=FabApp.viewport.wafer.position.clone().project(FabApp.viewport.viewCamera);return Math.abs(p.x)<1&&Math.abs(p.y)<1}')
                    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
                    page.locator('.equipment-panel').screenshot(path=str(output/f'mobile-{width}.png'))
                    page.locator('#cancelRunButton').click()
                browser.close()
        finally:server.close()
    assert not errors,errors
    (output/'results.json').write_text(json.dumps({'equipment':results,'page_errors':errors},ensure_ascii=False,indent=2),encoding='utf8')
    print(f'{len(results)} tools × 6 positions: selected internal view, wafer/robot projection, live surface pixels, exterior resume, immutable records; 3 responsive widths; no page errors.')


if __name__=='__main__':main()
