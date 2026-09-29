"""Real-browser CMOS equipment snapshots; isolated DB, optional Playwright + Chrome."""
import json
import sys
import tempfile
import threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.sync_api import sync_playwright
from waitress import create_server
from server.app import create_app
ROOT = Path(__file__).resolve().parent.parent

def main():
    output = ROOT / '.test-tools' / 'cmos-motion'
    output.mkdir(parents=True, exist_ok=True)
    errors, captures = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary)/'scene.sqlite3', testing=True),host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome',headless=True)
                page = browser.new_page(viewport={'width':1400,'height':900}, device_scale_factor=1)
                page.on('pageerror',lambda error: errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.effective_port}/cmos-lab.html',wait_until='load')
                assert page.evaluate('!!FabApp.viewport.renderer'), 'WebGL viewport did not initialize'
                page.evaluate("""() => {const h=document.querySelector('#fabViewport');Object.assign(h.style,{position:'fixed',left:'0',top:'0',width:'1200px',height:'740px',zIndex:'9999'});for(const el of h.children)if(el.tagName!=='CANVAS')el.style.display='none';}""")
                tools = page.evaluate('Object.keys(FabEngine.tools)')
                for tool in tools:
                    phases=[('idle',0),('load',.4),('load',.84),('condition',.15),('process',.5)]
                    if tool in ['bake','rtp','clean','oxidation','cmp','implant','coat']:
                        phases += [('load',.28),('load',.7),('condition',.25),('condition',.8),('unload',.18),('unload',.6)]
                    if tool in ['clean','wetetch']:
                        phases += [('condition',.1),('condition',.6),('condition',.72),('process',.7),('process',.95),('unload',.18),('unload',.35),('unload',.48),('unload',.535)]
                    phases=list(dict.fromkeys(phases))
                    for phase,progress in phases:
                        page.evaluate("""({tool,phase,progress})=>{const step=FabEngine.route.find(s=>s.tool===tool),timeline=FabViewport.playback(FabEngine.tools[tool].family,0),index=['load','condition','process','unload'].indexOf(phase),elapsed=index<0?0:timeline.seconds*(timeline.bounds[index]+(timeline.bounds[index+1]-timeline.bounds[index])*progress);FabApp.viewport.select(step);FabApp.viewport.update({wafer:FabEngine.createWafer('VISUAL'),running:false,phase,progress,elapsed,recipe:step.recipe});}""",dict(tool=tool,phase=phase,progress=progress))
                        page.wait_for_timeout(130 if captures else 600)
                        name=f'{tool}-{phase}-{progress}.png'
                        page.locator('#fabViewport canvas').screenshot(path=str(output/name))
                        captures.append(name)
                    print(tool+' inspected',flush=True)
                # Run the real UI as well as deterministic equipment poses.
                page.reload(wait_until='load')
                page.locator('#runButton').click()
                page.wait_for_timeout(800)
                page.locator('#runButton').click()
                assert page.locator('#runState').inner_text()=='일시정지'
                page.locator('#runButton').click()
                for _ in range(60):
                    if page.evaluate('FabApp.snapshot().wafers[0].records.length') == 1:
                        break
                    page.wait_for_timeout(500)
                assert page.evaluate('FabApp.snapshot().wafers[0].records.length') == 1
                # Exercise the real app's elapsed-time contract while paused.
                page.evaluate("FabApp.select(FabEngine.route.find(s=>s.tool==='coat').index)")
                page.locator('#runButton').click()
                page.locator('#runButton').click()
                angles=[]
                for percent in [65,100,0,65]:
                    page.locator('#observationSeek').evaluate('(el,value)=>{el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));}',str(percent))
                    page.wait_for_timeout(100)
                    angles.append(page.evaluate('FabApp.viewport.wafer.rotation.y'))
                assert angles[0] == angles[-1] and angles[0] != angles[2],angles
                assert page.evaluate('FabApp.snapshot().wafers[0].records.length') == 1
                page.wait_for_timeout(1800)
                page.evaluate('()=>{const renderer=FabApp.viewport.renderer,render=renderer.render.bind(renderer);window.pausedDraws=0;renderer.render=(...args)=>{window.pausedDraws++;return render(...args);};}')
                page.wait_for_timeout(250)
                assert page.evaluate('window.pausedDraws') == 0,'Paused scene kept consuming GPU draws'
                browser.close()
        finally:
            server.close()
    (output/'results.json').write_text(json.dumps(dict(captures=captures,page_errors=errors),indent=2),encoding='utf-8')
    assert not errors, errors
    print(f'{len(captures)} equipment snapshots; no page errors; live run/pause/resume, deterministic scrubbing and paused rendering passed')

if __name__=='__main__':
    main()
