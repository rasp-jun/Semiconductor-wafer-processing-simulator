"""Real Chrome UI checks; visibility events are injected because headless tabs remain visible."""
import json
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright
from waitress import create_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.app import create_app


def main():
    output = ROOT / '.test-tools' / 'photo-playback'
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'photo.sqlite3', testing=True), host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        origin = f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                context = browser.new_context(viewport={'width': 1440, 'height': 1100})
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/photo-lab.html', wait_until='load')
                page.wait_for_function('()=>!!window.WaferMachine')
                page.locator('#playProcess').click()
                page.wait_for_function('()=>WaferAppBridge.snapshot().stageIndex===1')
                page.locator('#playProcess').click()
                stage = page.evaluate('WaferAppBridge.snapshot().stageIndex')
                paused = page.locator('#visualization').inner_html()
                page.wait_for_timeout(300)
                assert page.locator('#visualization').inner_html() == paused
                assert '일시정지' in page.locator('#playbackDescription').inner_text()
                page.locator('#playProcess').click()
                page.wait_for_timeout(180)
                assert page.evaluate('WaferAppBridge.snapshot().stageIndex') == stage
                assert page.locator('#visualization').inner_html() != paused
                def visibility(hidden):
                    page.evaluate("hidden=>{Object.defineProperty(document,'hidden',{configurable:true,value:hidden});document.dispatchEvent(new Event('visibilitychange'));}", hidden)
                visibility(True)
                page.wait_for_function("()=>document.querySelector('#playbackDescription').textContent.includes('일시정지')")
                hidden_stage = page.evaluate('WaferAppBridge.snapshot().stageIndex')
                hidden_visual = page.locator('#visualization').inner_html()
                page.wait_for_timeout(2800)
                visibility(False)
                assert page.evaluate('WaferAppBridge.snapshot().stageIndex') == hidden_stage
                assert page.locator('#visualization').inner_html() == hidden_visual
                assert not page.evaluate('WaferMachine.getState().playing')
                page.locator('#playProcess').click()
                page.wait_for_timeout(150)
                assert page.evaluate('WaferAppBridge.snapshot().stageIndex') == hidden_stage
                page.locator('#playProcess').click()
                page.locator('#machinePlay').click()
                page.wait_for_timeout(250)
                assert page.evaluate('WaferMachine.getState().playing')
                visibility(True)
                page.wait_for_function('()=>document.hidden&&!WaferMachine.getState().playing')
                machine_time = page.evaluate('WaferMachine.getState().elapsed')
                page.wait_for_timeout(400)
                visibility(False)
                page.wait_for_timeout(150)
                assert page.evaluate('WaferMachine.getState().elapsed') == machine_time
                assert not page.evaluate('WaferMachine.getState().playing')
                page.locator('#machineViewport').screenshot(path=str(output / 'paused-photo-machine.png'))
                raw = page.evaluate("""()=>JSON.stringify({missionId:'residue',params:WaferEngine.defaults,lastResult:{missionId:'residue',params:WaferEngine.defaults,label:{}},history:[{id:'META_RUN',missionId:'residue',params:WaferEngine.defaults,time:42,label:{bad:true},hypothesis:[]}],recipes:[{id:'META_RECIPE',missionId:'residue',params:WaferEngine.defaults,time:{bad:true},name:{bad:true}}]})""")
                page.evaluate("raw=>localStorage.setItem('waferflow-v2',raw)", raw)
                page.reload(wait_until='load')
                assert page.locator('#runLabel').inner_text() == '저장된 실행'
                page.locator('.nav-item[data-page="notebook"]').click()
                assert page.locator('.report-card').count() == 1
                assert page.locator('.saved-recipe').count() == 1
                assert '[object Object]' not in page.locator('#page-notebook').inner_text()
                assert page.evaluate("localStorage.getItem('waferflow-v2')") == raw
                assert not errors, errors
                context.close()
                browser.close()
        finally:
            server.close()
    result = {'pause_resume': 'passed', 'injected_visibility_event_in_chrome': 'passed', 'machine_pause_on_hide': 'passed', 'invalid_optional_metadata_restore': 'passed', 'page_errors': errors}
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
