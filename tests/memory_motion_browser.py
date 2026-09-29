"""Check live keyboard focus and the memory equipment/CMOS animation clock contract."""
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
    output = ROOT / '.test-tools' / 'memory-motion'
    output.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'motion.sqlite3', testing=True), host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                for width in [1440, 390]:
                    page = browser.new_page(viewport={'width': width, 'height': 1000})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(f'http://127.0.0.1:{server.effective_port}/index.html', wait_until='load')
                    page.evaluate('MemoryFabApp.seek(0)')
                    page.locator('#speedSelect').select_option('2')
                    page.locator('#playButton').click()
                    page.locator('[data-lot="H-201"]').focus()
                    page.wait_for_timeout(450)
                    assert page.evaluate('document.activeElement.dataset.lot') == 'H-201'
                    page.keyboard.press('Enter')
                    assert page.evaluate('MemoryFabApp.snapshot().selectedLot') == 'H-201'
                    page.locator('[data-operation="1"]').focus()
                    page.wait_for_timeout(450)
                    assert page.evaluate('document.activeElement.dataset.operation') == '1'
                    page.keyboard.press('Enter')
                    assert not page.evaluate('MemoryFabApp.snapshot().playing')
                    expected = page.evaluate("()=>{const s=MemoryFabApp.snapshot();return s.result.records.find(r=>r.lotId===s.selectedLot&&r.operation===1).end;}")
                    assert page.evaluate('MemoryFabApp.snapshot().time') == expected
                    # Capture the actual adapter contract without changing animation state.
                    page.evaluate("""()=>{const mount=FabViewport.mount;FabViewport.mount=(...args)=>{const view=mount(...args),update=view.update.bind(view);window.motionView=view;view.update=state=>{window.motionState=state;return update(state);};return view;};}""")
                    checks = []
                    for chamber, duration, family in [('CLN-01', 20, 'wet'), ('CMP-01', 12, 'cmp')]:
                        page.evaluate('id=>MemoryFabApp.selectChamber(id)', chamber)
                        page.locator('#openEquipment').click()
                        page.locator('#motionButton').click()
                        page.wait_for_timeout(700)
                        page.locator('#motionButton').click()
                        state = page.evaluate("""family=>{const app=MemoryFabApp.snapshot(),state=window.motionState,expected=FabViewport.playback(family,state.elapsed);return {fraction:app.motionTime,elapsed:state.elapsed,phase:state.phase,expectedPhase:expected.phase,progress:state.progress,expectedProgress:expected.progress,running:state.running};}""", family)
                        assert state['fraction'] > 0
                        assert abs(state['elapsed'] - state['fraction'] * duration) < 1e-10
                        assert state['phase'] == state['expectedPhase']
                        assert abs(state['progress'] - state['expectedProgress']) < 1e-10
                        assert state['running'] is False
                        before = page.evaluate('motionView.wafer.rotation.toArray()')
                        page.wait_for_timeout(200)
                        assert page.evaluate('motionView.wafer.rotation.toArray()') == before
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                        page.locator('#equipmentDialog').screenshot(path=str(output / f'{chamber}-{width}.png'))
                        page.locator('[data-close="equipmentDialog"]').click()
                        checks.append({'chamber': chamber, 'duration': duration, 'paused': True})
                    assert not errors, errors
                    results.append({'width': width, 'keyboard_focus_and_activation': 'passed', 'equipment': checks, 'page_errors': errors})
                    page.close()
                browser.close()
        finally:
            server.close()
    (output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
