"""Check rebuilt geometry, distinct silhouettes and actual camera framing.

The silhouette metric detects near-identical enclosures; the saved contact sheets
are still manually reviewed for recognisable equipment architecture.
"""
import hashlib
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
    output=ROOT/'.test-tools'/'axis3';output.mkdir(exist_ok=True,parents=True)
    results,errors,architectures,hashes,masks=[],[],set(),set(),{}
    with tempfile.TemporaryDirectory() as temporary:
        server=create_server(create_app(Path(temporary)/'identity.sqlite3',testing=True),host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        origin=f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                page=browser.new_page(viewport={'width':1500,'height':1100},reduced_motion='reduce')
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(origin+'/cmos-lab.html',wait_until='networkidle')
                original=page.evaluate('()=>JSON.stringify(FabApp.snapshot().wafers)')
                ids=page.evaluate('()=>Object.keys(FabEngine.tools)')
                for tool in ids:
                    stem='icp-chamber' if tool=='etch' else 'equipment-'+tool
                    data=json.loads((ROOT/'assets/cmos'/(stem+'.json')).read_text(encoding='utf8'))
                    binary=(ROOT/'assets/cmos'/(stem+'.bin')).read_bytes()
                    identity=data['object']['userData']['identity']
                    assert data['object']['userData']['revision']=='axis-3'
                    assert identity['tool']==tool and len(identity['features'])==3
                    assert identity['architecture'] not in architectures
                    architectures.add(identity['architecture'])
                    digest=hashlib.sha256(binary).hexdigest()
                    assert digest==data['metadata']['bufferSha256'] and len(binary)==data['metadata']['bufferByteLength']
                    assert digest not in hashes;hashes.add(digest)
                    page.evaluate('(id)=>FabApp.select(FabEngine.route.findIndex(s=>s.tool===id))',tool)
                    expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool',tool,timeout=30000)
                    page.locator('#cutaway').uncheck()
                    page.locator('[data-camera=equipment]').click()
                    page.wait_for_timeout(80)
                    assert page.evaluate('()=>document.querySelector("#equipmentCaption").textContent.includes(CmosEquipmentCatalog[FabEngine.route[FabApp.snapshot().selected].tool].features[0])')
                    # Every actual visible mesh vertex must fit; box corners would
                    # incorrectly reject the intentionally tight camera fit.
                    def framing():
                        return page.evaluate('''() => {
                          const v=FabApp.viewport,model=v.scene.getObjectByName('blender-'+(FabEngine.route[FabApp.snapshot().selected].tool==='etch'?'icp-chamber':'equipment-'+FabEngine.route[FabApp.snapshot().selected].tool)),p=new THREE.Vector3();let max=0,count=0;
                          model.updateMatrixWorld(true);v.viewCamera.updateMatrixWorld(true);
                          model.traverse(o=>{if(!o.isMesh)return;for(let parent=o;parent;parent=parent.parent)if(!parent.visible)return;
                            const positions=o.geometry.attributes.position;
                            for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld).project(v.viewCamera);max=Math.max(max,Math.abs(p.x),Math.abs(p.y));count++;}
                          });return {max,count};
                        }''')
                    frame=framing();assert frame['count']>1000 and frame['max']<.98,(tool,frame)
                    page.locator('.equipment-panel').screenshot(path=str(output/(tool+'-live.png')))
                    packed=page.evaluate('''() => {
                      const v=FabApp.viewport,id=FabEngine.route[FabApp.snapshot().selected].tool,source=v.scene.getObjectByName('blender-'+(id==='etch'?'icp-chamber':'equipment-'+id));
                      const r=window.identityRenderer||(window.identityRenderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}));r.setSize(128,128);r.setClearColor(0x000000,1);r.toneMapping=THREE.NoToneMapping;
                      const scene=new THREE.Scene(),model=source.clone(true);scene.add(model);scene.overrideMaterial=new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide});
                      const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()).length(),camera=new THREE.OrthographicCamera(-size/2,size/2,size/2,-size/2,.1,200);
                      camera.position.copy(center).add(new THREE.Vector3(.55,.52,.8).normalize().multiplyScalar(30));camera.lookAt(center);camera.updateMatrixWorld(true);
                      // Consistent camera direction and independently centered scale.
                      let loX=Infinity,hiX=-Infinity,loY=Infinity,hiY=-Infinity;const p=new THREE.Vector3();model.updateMatrixWorld(true);
                      model.traverse(o=>{if(!o.isMesh||!o.visible)return;const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i++){p.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse);loX=Math.min(loX,p.x);hiX=Math.max(hiX,p.x);loY=Math.min(loY,p.y);hiY=Math.max(hiY,p.y);}});
                      const span=Math.max(hiX-loX,hiY-loY)*1.13;camera.left=(loX+hiX-span)/2;camera.right=(loX+hiX+span)/2;camera.bottom=(loY+hiY-span)/2;camera.top=(loY+hiY+span)/2;camera.updateProjectionMatrix();r.render(scene,camera);
                      const gl=r.getContext(),pixels=new Uint8Array(128*128*4),packed=new Uint8Array(128*128/8);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
                      for(let i=0;i<128*128;i++)if(pixels[i*4]>128)packed[i>>3]|=1<<(i%8);
                      scene.overrideMaterial.dispose();return Array.from(packed);
                    }''')
                    masks[tool]=int.from_bytes(bytes(packed),'little')
                    page.locator('#cutaway').check()
                    page.wait_for_timeout(60)
                    page.locator('.equipment-panel').screenshot(path=str(output/(tool+'-internal-live.png')))
                    assert page.evaluate('()=>JSON.stringify(FabApp.snapshot().wafers)')==original
                    results.append({'tool':tool,'architecture':identity['architecture'],'bytes':len(binary),'max_camera_coordinate':frame['max']})
                pairs=[]
                for i,a in enumerate(ids):
                    for b in ids[i+1:]:
                        union=(masks[a]|masks[b]).bit_count();iou=(masks[a]&masks[b]).bit_count()/union
                        pairs.append({'a':a,'b':b,'silhouette_iou':round(iou,4)})
                        assert iou<.96,('Near identical exterior silhouettes',a,b,iou)
                # Characteristic-based catalogue search must work too.
                page.locator('#cutaway').uncheck();page.locator('#openEquipmentAtlas').click()
                page.locator('#atlasSearch').fill('빔라인')
                expect(page.locator('.atlas-machine')).to_have_count(1)
                expect(page.locator('.atlas-machine')).to_have_attribute('data-atlas-tool','implant')
                page.locator('#atlasSearch').fill('')
                page.locator('.atlas-machine img').evaluate_all('(images)=>images.forEach(img=>img.loading="eager")')
                page.wait_for_function('()=>[...document.querySelectorAll(".atlas-machine img")].every(img=>img.complete&&img.naturalWidth>=850)')
                page.locator('#equipmentAtlasDialog').screenshot(path=str(output/'atlas-live.png'))
                page.keyboard.press('Escape')
                for width in [820,390,360]:
                    page.set_viewport_size({'width':width,'height':1100})
                    for tool in ['implant','lpcvd','pvd','scanner']:
                        page.evaluate('(id)=>FabApp.select(FabEngine.route.findIndex(s=>s.tool===id))',tool)
                        expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool',tool,timeout=30000)
                        page.wait_for_timeout(60)
                        frame=framing();assert frame['max']<.98,(width,tool,frame)
                    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1')
                    page.locator('.equipment-panel').screenshot(path=str(output/f'mobile-{width}.png'))
                assert not errors,errors
                browser.close()
        finally:server.close()
    payload={'tools':results,'most_similar_silhouettes':sorted(pairs,key=lambda p:p['silhouette_iou'],reverse=True)[:10],'page_errors':errors}
    (output/'identity-results.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(payload,ensure_ascii=False))


if __name__=='__main__':main()
