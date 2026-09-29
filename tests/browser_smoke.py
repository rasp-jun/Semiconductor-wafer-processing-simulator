"""Optional real Chromium smoke test; pip install playwright, use installed Chrome.
Runs an isolated temporary database and never opens the user's production database.
"""
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
    output = ROOT / '.test-tools'
    output.mkdir(exist_ok=True)
    results, errors = [], []
    equipment_roundtrip = None
    with tempfile.TemporaryDirectory() as temporary:
        app = create_app(Path(temporary) / 'browser.sqlite3', testing=True)
        server = create_server(app, host='127.0.0.1', port=0)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        origin = f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                context = browser.new_context(accept_downloads=True)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                for width, height in [(1440, 1000), (390, 844)]:
                    page.set_viewport_size(dict(width=width, height=height))
                    for route in ['index.html','cmos-lab.html','equipment.html','photo-lab.html','evidence.html','workbench.html']:
                        response = page.goto(origin + '/' + route, wait_until='load')
                        assert response.status == 200, route
                        page.wait_for_timeout(350)
                        overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth + 2')
                        results.append(dict(page=route,width=width,horizontal_overflow=overflow))
                        if route == 'index.html':
                            assert page.locator('[data-chamber]').count() == 48
                            assert page.locator('#kpiLots').inner_text() != '—'
                            page.screenshot(path=str(output / f'memory-{width}.png'), full_page=True)
                page.set_viewport_size(dict(width=1440, height=1000))
                page.goto(origin + '/index.html')
                page.locator('.study-panel summary').click()
                page.locator('[data-review-field="hypothesis"]').fill('HAR chamber exclusion: compare completed lots and wait.')
                page.locator('#isolateButton').click()
                assert page.locator('#comparison').inner_text().find('HAR-01') >= 0
                with page.expect_download() as downloaded:
                    page.locator('#exportButton').click()
                plan = json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8'))
                assert plan['options']['review']['hypothesis'].startswith('HAR chamber')
                with page.expect_download() as downloaded:
                    page.locator('#traceCSV').click()
                csv = Path(downloaded.value.path()).read_text(encoding='utf-8-sig')
                assert len(csv.splitlines()) > 100 and 'model_version' in csv
                page.locator('#restoreBaseline').click()
                page.goto(origin + '/equipment.html', wait_until='load')
                page.locator('#scrubber').focus()
                page.keyboard.press('End')
                page.keyboard.press('ArrowLeft')
                equipment_before = page.evaluate('EquipmentApp.snapshot()')
                bookmark = equipment_before['time']
                assert 0 < bookmark < equipment_before['trace']['duration']
                with page.expect_download() as downloaded:
                    page.locator('#exportButton').click()
                equipment_file = Path(temporary) / 'equipment-bookmark.json'
                downloaded.value.save_as(str(equipment_file))
                exported_equipment = json.loads(equipment_file.read_text(encoding='utf-8'))
                assert exported_equipment['playback']['t'] == bookmark
                assert exported_equipment['fault'] == 'none'
                page.locator('#rewindButton').click()
                assert page.evaluate('EquipmentApp.snapshot().time') == 0
                page.locator('#importFile').set_input_files(str(equipment_file))
                page.wait_for_function('(time)=>{const s=EquipmentApp.snapshot();return s.imported&&Math.abs(s.time-time)<1e-9&&!s.playing;}', arg=bookmark)
                restored_equipment = page.evaluate('EquipmentApp.snapshot()')
                assert not restored_equipment['activeRun']
                assert page.locator('#runState').inner_text() == 'LOG PAUSED'
                assert page.locator('#importedFaultOption').inner_text() == '파일 표기: 정상 운전'
                assert restored_equipment['trace']['samples'] == exported_equipment['samples']
                assert restored_equipment['trace']['recipe'] == exported_equipment['recipe']
                page.wait_for_timeout(250)
                assert page.evaluate('EquipmentApp.snapshot().time') == bookmark
                equipment_roundtrip = dict(bookmark_seconds=bookmark, restored_seconds=restored_equipment['time'], paused=True, fault_label='파일 표기: 정상 운전', original_samples_preserved=True)
                page.goto(origin + '/evidence.html')
                page.locator('#loadDemo').click()
                page.locator('#freezePlan').click()
                page.locator('#evaluateButton').click()
                page.locator('#resultContent').wait_for(state='visible')
                assert page.locator('#lotResults tr').count() == 5
                page.locator('#downloadBundle').click()
                page.screenshot(path=str(output / 'evidence-desktop.png'), full_page=True)
                context.close()
                browser.close()
        finally:
            server.close()
        payload=dict(pages=results, page_errors=errors, equipment_file_roundtrip=equipment_roundtrip)
        (output / 'browser-results.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(payload,ensure_ascii=False,indent=2))
        assert not errors, errors
        assert not any(r['horizontal_overflow'] for r in results), 'Page overflow; see browser-results.json'

if __name__ == '__main__':
    main()
