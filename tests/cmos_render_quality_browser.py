"""Responsive 3D hit tests, fitted zoom direction and bounded GPU resources in Chrome."""
import json
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from waitress import create_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.app import create_app


def camera_pose(page):
    return page.evaluate('''()=>({
      position:FabApp.viewport.viewCamera.position.toArray(),
      out:FabApp.viewport.viewCamera.getWorldDirection(new THREE.Vector3()).negate().toArray()
    })''')


def main():
    output = ROOT/'.test-tools'/'render-quality'
    output.mkdir(parents=True, exist_ok=True)
    errors, checks, resource_samples = [], [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary)/'quality.sqlite3', testing=True), host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                page = browser.new_page(viewport={'width':360,'height':1000}, reduced_motion='reduce')
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.effective_port}/cmos-lab.html', wait_until='networkidle')
                expect(page.locator('#fabViewport')).to_have_attribute('data-asset-status', 'ready', timeout=20000)
                initial = page.evaluate('()=>FabApp.snapshot().wafers.map(w=>w.records)')
                page.locator('#cutaway').check()
                page.wait_for_timeout(100)
                # Find a real visible surface missed by the old full-height coordinate mapping.
                point = page.evaluate('''()=>{
                  const v=FabApp.viewport,host=document.querySelector('#fabViewport');
                  const height=document.querySelector('.wafer-detail-frame').offsetTop-6,width=host.clientWidth;
                  const equipment=v.scene.children.find(o=>o.getObjectByName('axis-live-mechanisms'));
                  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
                  const hits=(x,y,h)=>{
                    ray.setFromCamera(pointer.set(x/width*2-1,1-y/h*2),v.viewCamera);
                    return ray.intersectObjects([equipment,v.wafer],true).some(hit=>{
                      for(let o=hit.object;o;o=o.parent)if(!o.visible)return false;
                      return hit.object.material?.opacity!==0;
                    });
                  };
                  for(let y=25;y<height-15;y+=5)for(let x=20;x<width-20;x+=5)
                    if(hits(x,y,height)&&!hits(x,y,host.clientHeight))return {x,y};
                  return null;
                }''')
                assert point, 'Expected a surface affected by the split viewport coordinate regression'
                canvas = page.locator('#fabViewport canvas')
                canvas.click(position=point)
                expect(page.locator('#equipmentDialog')).to_be_visible()
                page.keyboard.press('Escape')
                inset = page.locator('.wafer-detail-frame').evaluate('(el)=>({x:el.offsetLeft+el.clientWidth/2,y:el.offsetTop+el.clientHeight/2})')
                canvas.click(position=inset)
                expect(page.locator('#equipmentDialog')).to_be_visible()
                page.keyboard.press('Escape')
                canvas.click(position={'x':12,'y':inset['y']})
                expect(page.locator('#equipmentDialog')).not_to_be_visible()
                checks.append('Mobile equipment and actual inset wafer hit tests; empty observation strip stays inert')
                page.locator('.equipment-panel').screenshot(path=str(output/'mobile-observation.png'))

                # A scanner in portrait focus mode needs >25 units to fit. Wheel-out
                # previously snapped to a 25-unit maximum and moved toward the device.
                page.set_viewport_size({'width':820,'height':1180})
                page.locator('#focusStage').click()
                page.evaluate('()=>FabApp.select(FabEngine.route.findIndex(step=>step.tool==="scanner"))')
                expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool','scanner',timeout=20000)
                page.locator('#cutaway').uncheck()
                page.wait_for_timeout(100)
                displacements = []
                for delta in [20,-20]:
                    before = camera_pose(page)
                    canvas.hover()
                    page.mouse.wheel(0,delta)
                    page.wait_for_timeout(120)
                    after = camera_pose(page)
                    displacement = sum((a-b)*d for a,b,d in zip(after['position'],before['position'],before['out']))
                    assert displacement*delta>0, (delta,displacement)
                    displacements.append(displacement)
                checks.append('Portrait scanner fit: zoom-out and zoom-in move in the requested direction')
                page.locator('.equipment-panel').screenshot(path=str(output/'portrait-equipment.png'))

                # Repeated traversal must return GPU ownership to the same device's
                # baseline. Comparing the same tool avoids conflating its mesh complexity.
                page.locator('#focusStage').click()
                page.set_viewport_size({'width':1500,'height':1100})
                tools = page.evaluate('()=>Object.keys(FabEngine.tools)')
                for cycle in range(3):
                    samples = {}
                    for tool in tools:
                        page.evaluate('(id)=>FabApp.select(FabEngine.route.findIndex(step=>step.tool===id))',tool)
                        expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool',tool,timeout=20000)
                        # Asset attachment marks readiness before the next render.
                        # GPU allocation must be sampled after rendering, even when
                        # another browser/GPU workload delays animation frames.
                        samples[tool] = page.evaluate('async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return {...FabApp.viewport.renderer.info.memory}}')
                    resource_samples.append(samples)
                assert resource_samples[1]==resource_samples[2],resource_samples
                checks.append('18 tools × 2 measured traversals after warm-up retain stable per-tool GPU geometry and texture counts')
                frame = page.evaluate('()=>FabApp.viewport.renderer.info.render.frame')
                page.wait_for_timeout(250)
                assert page.evaluate('()=>FabApp.viewport.renderer.info.render.frame')==frame
                assert page.evaluate('()=>FabApp.snapshot().wafers.map(w=>w.records)')==initial
                checks.append('Idle viewport renders no additional frames and all inspection preserves records')
                browser.close()
        finally:
            server.close()
    assert not errors,errors
    payload = {'checks':checks,'zoom_displacements':displacements,'gpu_samples':resource_samples,'page_errors':errors}
    (output/'results.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'checks':checks,'zoom_displacements':displacements,'page_errors':errors},ensure_ascii=False))


if __name__=='__main__':
    main()
