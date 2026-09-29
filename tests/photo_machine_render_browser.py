"""Count real WebGL renders while the photo machine is idle and during controls."""
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    output = ROOT / '.test-tools' / 'photo-machine-render'
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    errors, results = [], []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            for width in [1440, 390]:
                context = browser.new_context(viewport={'width': width, 'height': 1000})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/photo-lab.html', wait_until='load')
                page.wait_for_function('!!window.WaferMachine')
                page.locator('#machineViewport').scroll_into_view_if_needed()
                page.evaluate('''() => {
                    const renderer=WaferMachine.renderer,original=renderer.render.bind(renderer);
                    window.renderAudit={draws:0,statusWrites:0,lastDraw:performance.now()};
                    renderer.render=(...args)=>{renderAudit.draws++;renderAudit.lastDraw=performance.now();return original(...args);};
                    new MutationObserver(records=>renderAudit.statusWrites+=records.length).observe(document.querySelector('#machinePhase'),{childList:true,characterData:true,subtree:true});
                }''')

                def settle():
                    page.wait_for_function('!WaferMachine.getState().playing && performance.now()-renderAudit.lastDraw>400', timeout=15000)

                def idle(label):
                    settle()
                    before = page.evaluate('({...renderAudit,elapsed:WaferMachine.getState().elapsed})')
                    page.wait_for_timeout(450)
                    after = page.evaluate('({...renderAudit,elapsed:WaferMachine.getState().elapsed})')
                    assert after['draws'] == before['draws'], (label, before, after)
                    assert after['statusWrites'] == before['statusWrites'], (label, before, after)
                    assert after['elapsed'] == before['elapsed']
                    return {'operation': label, 'idle_draws': 0, 'idle_status_writes': 0}

                def redraw(label, action):
                    before = page.evaluate('renderAudit.draws')
                    action()
                    page.wait_for_function('before=>renderAudit.draws>before', arg=before)
                    checks.append(idle(label))

                checks = [idle('initial')]
                redraw('top camera', lambda: page.locator('[data-camera="top"]').click())
                redraw('cutaway', lambda: page.locator('#machineCutaway').click())
                redraw('annotations hidden', lambda: page.locator('#machineAnnotationsToggle').click())
                canvas = page.locator('#machineViewport canvas')

                def drag():
                    box = canvas.bounding_box()
                    x, y = box['x'] + 5, box['y'] + box['height'] / 2
                    page.mouse.move(x, y)
                    page.mouse.down()
                    page.mouse.move(x + 55, y + 12, steps=5)
                    page.mouse.up()

                redraw('pointer drag', drag)
                redraw('wheel zoom', lambda: page.mouse.wheel(0, 130))
                redraw('keyboard camera', lambda: canvas.press('ArrowLeft'))
                redraw('annotations shown', lambda: page.locator('#machineAnnotationsToggle').click())
                redraw('component selection', lambda: page.evaluate('WaferMachine.inspectComponent(1)'))
                redraw('recipe preview', lambda: page.evaluate("() => {const input=document.querySelector('#param-dose');input.value='135';input.dispatchEvent(new Event('input',{bubbles:true}));}"))
                assert '135' in page.locator('#machineTelemetry').inner_text()
                redraw('app stage change', lambda: page.evaluate('WaferAppBridge.selectStage(6)'))
                assert page.evaluate('WaferMachine.getState().active') == 6
                redraw('viewport resize', lambda: page.set_viewport_size({'width': width + 20, 'height': 1000}))
                page.locator('#machineViewport').scroll_into_view_if_needed()
                settle()
                redraw('reduced motion enabled', lambda: page.emulate_media(reduced_motion='reduce'))
                redraw('reduced motion camera', lambda: page.locator('[data-camera="top"]').click())
                poses = page.evaluate('''async () => {const out=[];for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);out.push(WaferMachine.camera.position.toArray());}return out;}''')
                assert all(position == poses[0] for position in poses)
                before_time = page.evaluate('WaferMachine.getState().elapsed')
                play_start = page.evaluate('() => {WaferMachine.toggle();return WaferMachine.getState().elapsed;}')
                page.wait_for_function('before=>WaferMachine.getState().playing && WaferMachine.getState().elapsed>before+0.2', arg=play_start)
                page.evaluate('WaferMachine.pause()')
                checks.append(idle('explicit playback pause'))
                assert page.evaluate('WaferMachine.getState().elapsed') != before_time
                paused_time = page.evaluate('WaferMachine.getState().elapsed')
                page.evaluate("() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}")
                before_draws = page.evaluate('renderAudit.draws')
                page.wait_for_timeout(200)
                assert page.evaluate('renderAudit.draws') == before_draws
                redraw('page visibility return', lambda: page.evaluate("() => {Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));}"))
                assert page.evaluate('WaferMachine.getState().elapsed') == paused_time
                page.locator('.nav-item[data-page="notebook"]').click()
                page.wait_for_timeout(150)
                before_draws = page.evaluate('renderAudit.draws')
                page.wait_for_timeout(200)
                assert page.evaluate('renderAudit.draws') == before_draws
                redraw('viewport intersection return', lambda: page.locator('.nav-item[data-page="lab"]').click())
                page.locator('#machineViewport').scroll_into_view_if_needed()
                redraw('reduced motion disabled', lambda: page.emulate_media(reduced_motion='no-preference'))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                page.locator('#machineViewport').screenshot(path=str(output / f'idle-machine-{width}.png'))
                results.append({'width': width, 'checks': checks, 'reduced_motion_camera_stable': True, 'explicit_playback': True})
                print(json.dumps({'width': width, 'completed_checks': len(checks)}), flush=True)
                context.close()
            browser.close()
        assert not errors, errors
        report = {'results': results, 'page_errors': errors}
        (output / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'desktop_mobile': 'passed', 'page_errors': errors}))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
