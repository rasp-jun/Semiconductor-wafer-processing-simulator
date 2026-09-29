"""Whole-equipment execution: real Chrome/GPU, 18 tools and both viewing modes."""
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

FIT="""()=>{
  const v=FabApp.viewport,c=v.viewCamera,point=new THREE.Vector3();let maximum=0,count=0;
  v.scene.updateMatrixWorld(true);
  const model=v.scene.children.find(o=>o.getObjectByName('axis-live-mechanisms'));
  function walk(o){if(!o.visible)return;if(o.isMesh){const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).project(c);maximum=Math.max(maximum,Math.abs(point.x),Math.abs(point.y));if(point.z<=-1||point.z>=1)throw Error('Depth clipping');count++}}o.children.forEach(walk)}
  walk(model);return {maximum,count};
}"""
POSE="""()=>{const v=FabApp.viewport;return {position:v.wafer.position.toArray(),rotation:v.wafer.rotation.toArray(),seek:document.querySelector('#observationSeek').value,records:FabApp.snapshot().wafers.map(w=>w.records)}}"""
PIXELS="""async()=>{
  const blob=await FabApp.viewport.capture(),bytes=await blob.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  const host=document.querySelector('#fabViewport'),frame=document.querySelector('.wafer-detail-frame'),scale=c.width/host.clientWidth;
  const size=Math.floor(frame.clientWidth*.5*scale),d=ctx.getImageData(Math.floor((frame.offsetLeft+frame.clientWidth*.25)*scale),Math.floor((frame.offsetTop+frame.clientHeight*.3)*scale),size,size).data;
  let min=255,max=0,opaque=0;for(let i=0;i<d.length;i+=4){const value=(d[i]+d[i+1]+d[i+2])/3;min=Math.min(min,value);max=Math.max(max,value);opaque+=d[i+3]===255}
  const railY=host.clientHeight-(host.clientWidth<600?124:0)-82;
  const rail=ctx.getImageData(0,Math.ceil(railY*scale),c.width,Math.floor(80*scale)).data;
  const railHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rail)),v=>v.toString(16).padStart(2,'0')).join('');
  const railEdges=[4,c.width-5].map(x=>Array.from(ctx.getImageData(x,Math.floor((railY+76)*scale),1,1).data));
  return {hash,railHash,railEdges,variation:max-min,opaque,total:size*size};
}"""

def seek(page,value):
    page.locator('#observationSeek').evaluate('(el,v)=>{el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))}',value)
    page.wait_for_timeout(80)

MAIN_WAFER="""async()=>{
  const v=FabApp.viewport,wafer=v.scene.getObjectByName('exterior-active-wafer'),host=document.querySelector('#fabViewport');
  if(!wafer.visible)throw Error('Exterior wafer hidden');
  const point=wafer.position.clone().project(v.viewCamera),w=host.clientWidth-(host.clientWidth<600?0:184),h=host.clientHeight-(host.clientWidth<600?124:0)-82-40;
  const x=(point.x+1)*w/2,y=40+(1-point.y)*h/2;
  const capture=async()=>{const b=await createImageBitmap(await v.capture()),c=document.createElement('canvas');c.width=b.width;c.height=b.height;const ctx=c.getContext('2d');ctx.drawImage(b,0,0);b.close();const scale=c.width/host.clientWidth;return ctx.getImageData(Math.round((x-16)*scale),Math.round((y-16)*scale),Math.round(32*scale),Math.round(32*scale)).data};
  let off,on;try{wafer.visible=false;off=await capture();wafer.visible=true;on=await capture()}finally{wafer.visible=true}
  let changed=0,maximum=0;for(let i=0;i<on.length;i+=4){const delta=Math.max(...[0,1,2].map(k=>Math.abs(on[i+k]-off[i+k])));maximum=Math.max(maximum,delta);if(delta>24)changed++}
  return {changed,maximum,position:wafer.position.toArray(),projection:point.toArray()};
}"""

def main():
    output=ROOT/'.test-tools'/'exterior-operation';output.mkdir(parents=True,exist_ok=True)
    errors,results,checks=[],[],[]
    with tempfile.TemporaryDirectory() as temporary:
        server=create_server(create_app(Path(temporary)/'exterior.sqlite3',testing=True),host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        url=f'http://127.0.0.1:{server.effective_port}/cmos-lab.html'
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                page=browser.new_page(viewport={'width':1500,'height':1100},reduced_motion='reduce')
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('console',lambda m:errors.append(m.text) if m.type=='error' or 'GL_INVALID' in m.text else None)
                page.goto(url,wait_until='networkidle')
                baseline=page.evaluate('()=>{let w=FabEngine.createWafer("REFERENCE");while(w.cursor<117)w=FabEngine.execute(w).wafer;return w.records}')
                tools=page.evaluate('()=>Object.keys(FabEngine.tools)')
                assert page.evaluate('()=>Object.keys(CmosOperationView.profiles).length')==len(tools)
                for tool in tools:
                    page.evaluate('''({tool,records})=>{const i=FabEngine.route.findIndex(s=>s.tool===tool);FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:'EXTERIOR-'+tool,records:records.slice(0,i)}]})}''',{'tool':tool,'records':baseline})
                    expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool',tool,timeout=20000)
                    page.locator('#cutaway').uncheck()
                    initial=page.evaluate(POSE)['records']
                    page.locator('#runButton').click()
                    expect(page.locator('#cutaway')).not_to_be_checked()
                    page.locator('#runButton').click()
                    expect(page.locator('#runState')).to_have_text('일시정지')
                    phases=set();hashes=[];maximum=0;wafer_pixels=[]
                    for value in [4,20,40,55,75,95]:
                        seek(page,value)
                        expect(page.locator('#fabViewport')).to_have_attribute('data-equipment-view','exterior')
                        expect(page.locator('#fabViewport')).to_have_attribute('data-operation-active','true')
                        assert page.evaluate('()=>{const v=FabApp.viewport;return !v.scene.getObjectByName("transfer-robot").visible&&!v.scene.getObjectByName("axis-live-mechanisms").visible&&v.scene.getObjectByName("axis-exterior-operation").visible}')
                        phases.add(page.locator('.equipment-operation-status').get_attribute('data-phase'))
                        fit=page.evaluate(FIT);maximum=max(maximum,fit['maximum'])
                        assert fit['count']>1000 and fit['maximum']<.98,(tool,value,fit)
                        pixels=page.evaluate(PIXELS);hashes.append(pixels['hash'])
                        primary=page.evaluate(MAIN_WAFER);wafer_pixels.append(primary)
                        assert primary['changed']>8 and primary['maximum']>50,(tool,value,'Main-view wafer is occluded',primary)
                        assert all(abs(p)<.98 for p in primary['projection'][:2]),(tool,value,primary)
                        assert pixels['opaque']==pixels['total'] and pixels['variation']>8,(tool,value,pixels)
                        assert page.evaluate(POSE)['records']==initial
                        if value==55:
                            before=page.evaluate(POSE)
                            page.wait_for_timeout(140)
                            stable=page.evaluate(PIXELS)
                            # The operation strip and poses must be exactly frozen.
                            # Transparent GPU hardware can differ at antialiased edges.
                            assert stable['railHash']==pixels['railHash'],(tool,'paused strip moved')
                            assert page.evaluate(POSE)==before
                            page.locator('.equipment-panel').screenshot(path=str(output/(tool+'-exterior.png')))
                            page.locator('#cutaway').check();page.wait_for_timeout(100)
                            assert page.evaluate('()=>FabApp.viewport.wafer.visible')
                            assert page.evaluate(POSE)==before,(tool,'switch changed simulation')
                            page.locator('[data-camera=wafer]').click()
                            page.locator('#cutaway').uncheck();page.wait_for_timeout(100)
                            expect(page.locator('[data-camera=equipment]')).to_have_class('active')
                            assert page.evaluate(FIT)['maximum']<.98
                            assert page.evaluate(POSE)==before
                    assert len(phases)==4 and len(set(hashes))==6,(tool,phases,hashes)
                    seek(page,40)
                    page.locator('#stepMotionButton').click()
                    expect(page.locator('#runState')).to_have_text('일시정지',timeout=15000)
                    expect(page.locator('#cutaway')).not_to_be_checked()
                    assert float(page.locator('#observationSeek').input_value())>40
                    page.locator('#runButton').click();expect(page.locator('#cutaway')).not_to_be_checked();page.locator('#runButton').click()
                    page.locator('#cancelRunButton').click()
                    assert page.evaluate(POSE)['records']==initial
                    assert len({tuple(p['position']) for p in wafer_pixels})>=3,(tool,'Exterior wafer did not travel')
                    results.append({'tool':tool,'positions':6,'phases':sorted(phases),'max_clip_coordinate':maximum,'surface_variation':pixels['variation'],'main_wafer_pixels':wafer_pixels,'pause_toggle_resume_step':True})
                    print('PASS',tool,flush=True)
                # Independent fresh storage for responsive and committed-run checks.
                page.close();page=browser.new_page(viewport={'width':1500,'height':1100},reduced_motion='reduce')
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('console',lambda m:errors.append(m.text) if m.type=='error' or 'GL_INVALID' in m.text else None)
                page.goto(url,wait_until='networkidle')
                expect(page.locator('#fabViewport')).to_have_attribute('data-asset-status','ready',timeout=20000)
                page.locator('#runButton').click();page.locator('#runButton').click();seek(page,55)
                for width in [820,390,360]:
                    page.set_viewport_size({'width':width,'height':1100});page.wait_for_timeout(150)
                    assert page.evaluate(FIT)['maximum']<.98
                    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
                    pixels=page.evaluate(PIXELS);assert pixels['variation']>8
                    assert all(15<=p[0]<=18 and 24<=p[1]<=27 and 32<=p[2]<=36 for p in pixels['railEdges']),pixels
                    page.locator('.equipment-panel').screenshot(path=str(output/f'responsive-{width}.png'))
                    # Use actual visible geometry with the exterior's reserved
                    # header, operation strip and surface-monitor column.
                    point=page.evaluate('''()=>{
                      const v=FabApp.viewport,h=document.querySelector('#fabViewport'),w=h.clientWidth-(h.clientWidth<600?0:184),height=h.clientHeight-(h.clientWidth<600?124:0)-82-40;
                      const model=v.scene.children.find(o=>o.getObjectByName('axis-live-mechanisms')),ray=new THREE.Raycaster(),p=new THREE.Vector2();
                      for(let y=height*.35;y<height*.8;y+=8)for(let x=w*.3;x<w*.7;x+=8){ray.setFromCamera(p.set(x/w*2-1,1-y/height*2),v.viewCamera);if(ray.intersectObject(model,true).some(hit=>{for(let o=hit.object;o;o=o.parent)if(!o.visible)return false;return true}))return {x,y:y+40}}return null;
                    }''')
                    assert point
                    canvas=page.locator('#fabViewport canvas');canvas.click(position=point)
                    expect(page.locator('#equipmentDialog')).to_be_visible();page.keyboard.press('Escape')
                    inset=page.locator('.wafer-detail-frame').evaluate('(el)=>({x:el.offsetLeft+el.clientWidth/2,y:el.offsetTop+el.clientHeight/2})')
                    canvas.click(position=inset);expect(page.locator('#equipmentDialog')).to_be_visible();page.keyboard.press('Escape')
                    rail=page.locator('#fabViewport').evaluate('(el)=>({x:20,y:el.clientHeight-(el.clientWidth<600?124:0)-40})')
                    canvas.click(position=rail);expect(page.locator('#equipmentDialog')).not_to_be_visible()
                checks.append('820/390/360 px whole-machine framing and live wafer surface')
                page.set_viewport_size({'width':1500,'height':1100})
                # Completing a run really commits once, then automatic continuation
                # preserves the unchecked exterior preference on the next operation.
                page.locator('#autoRun').check();page.locator('#speedSelect').select_option('8');seek(page,95)
                page.locator('#runButton').click()
                page.wait_for_function('()=>FabApp.snapshot().wafers[0].records.length>=1',timeout=10000)
                page.locator('#runButton').click()
                expect(page.locator('#cutaway')).not_to_be_checked()
                expect(page.locator('#fabViewport')).to_have_attribute('data-equipment-view','exterior')
                assert page.evaluate('()=>FabApp.snapshot().wafers[0].records.length')==1
                page.locator('#cancelRunButton').click()
                checks.append('Completion commits once; automatic next process preserves exterior')
                # Explicitly selected mechanism view must survive start and resume too.
                page.locator('#cutaway').check();page.locator('#runButton').click();page.locator('#runButton').click()
                expect(page.locator('#cutaway')).to_be_checked()
                page.locator('#runButton').click();expect(page.locator('#cutaway')).to_be_checked();page.locator('#runButton').click()
                checks.append('Explicit internal view persists during start and resume')
                page.locator('#cancelRunButton').click()
                browser.close()
        finally:server.close()
    assert not errors,errors
    (output/'results.json').write_text(json.dumps({'equipment':results,'checks':checks,'page_errors':errors},ensure_ascii=False,indent=2),encoding='utf8')
    print(f'{len(results)} tools × 6 positions; 4 phases; exterior/internal, actual pixels, immutable records, step/resume, responsive and committed continuation: passed.')

if __name__=='__main__':main()
