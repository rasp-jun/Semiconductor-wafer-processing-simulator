"""Exercise model-update recovery, real tab conflicts and expanded learning UI."""
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

REVEAL = "el=>{const menu=el.closest('details.st-more');if(menu)menu.open=true}"  # actions in the page overflow menu


def main():
    output = ROOT / '.test-tools' / 'cmos-storage'
    output.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'review.sqlite3', testing=True), host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        origin = f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                for width in [1440, 390]:
                    context = browser.new_context(viewport={'width': width, 'height': 1000}, accept_downloads=True)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/cmos-lab.html', wait_until='load')
                    original = json.dumps({'schema': 'waferflow-fab-history-v1', 'modelVersion': 'wf-fab-0.5.0', 'wafers': [{'id': 'LEGACY', 'title': '이전 수업 실험', 'records': []}]}, ensure_ascii=False, indent=2)
                    page.evaluate('(raw)=>localStorage.setItem("waferflow-fab-v05",raw)', original)
                    page.reload(wait_until='load')
                    expect(page.locator('#storageRecovery')).to_be_visible()
                    with page.expect_download() as downloaded:
                        page.locator('#downloadRecovery').click()
                    assert Path(downloaded.value.path()).read_text(encoding='utf-8') == original
                    page.locator('#recipe-time').fill('210')
                    expect(page.locator('#saveStatus')).to_contain_text('저장됨')
                    assert page.evaluate('localStorage.getItem("waferflow-fab-v05")') == original
                    page.reload(wait_until='load')
                    expect(page.locator('#recipe-time')).to_have_value('210')
                    expect(page.locator('#storageRecovery')).to_be_visible()
                    page.locator('.learning-guide summary').click()
                    assert page.locator('.learning-grid section').count() == 4
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    page.locator('.learning-guide').scroll_into_view_if_needed()
                    page.screenshot(path=str(output / f'learning-recovery-{width}.png'))

                    other = context.new_page()
                    other.on('pageerror', lambda error: errors.append(str(error)))
                    other.goto(origin + '/cmos-lab.html', wait_until='load')
                    page.locator('#recipe-time').fill('220')
                    expect(other.locator('#storageRecoveryMessage')).to_contain_text('다른 탭')
                    before = page.evaluate('localStorage.getItem("waferflow-fab-"+FabEngine.VERSION)')
                    other.locator('#recipe-time').fill('230')
                    assert page.evaluate('localStorage.getItem("waferflow-fab-"+FabEngine.VERSION)') == before
                    with other.expect_download() as downloaded:
                        other.locator('#exportButton').evaluate(REVEAL);other.locator('#exportButton').click()
                    exported = json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8'))
                    assert exported['wafers'][0]['overrides']['OP001']['time'] == 230
                    results.append({'width': width, 'original_preserved': True, 'restored_draft': True, 'tab_conflict_protected': True, 'expanded_learning_overflow': False})
                    context.close()
                context = browser.new_context()
                left, right = context.new_page(), context.new_page()
                for tab in [left, right]:
                    tab.on('pageerror', lambda error: errors.append(str(error)))
                    tab.goto(origin + '/cmos-lab.html', wait_until='load')
                left.evaluate('''() => {
                    window.lockAcquired=false;
                    navigator.locks.request('waferflow-fab-'+FabEngine.VERSION+'-write', {mode:'exclusive'}, () => new Promise(resolve => {
                        window.releaseStorageLock=resolve; window.lockAcquired=true;
                    }));
                }''')
                left.wait_for_function('() => window.lockAcquired')
                left.evaluate('FabApp.select(1)')
                right.evaluate('FabApp.select(2)')
                assert left.evaluate('localStorage.getItem("waferflow-fab-"+FabEngine.VERSION)') is None
                left.evaluate('window.releaseStorageLock()')
                expect(left.locator('#saveStatus')).to_contain_text('저장됨')
                expect(right.locator('#storageRecoveryMessage')).to_contain_text('다른 탭')
                assert left.evaluate('JSON.parse(localStorage.getItem("waferflow-fab-"+FabEngine.VERSION)).selected') == 1
                results.append({'simultaneous_tab_saves_serialized': True, 'first_record_preserved': True})
                context.close()
                context = browser.new_context(viewport={'width': 390, 'height': 1000})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/cmos-lab.html', wait_until='load')
                page.locator('[data-workspace=all]').click()
                page.locator('#openRoute').click()
                module = page.locator('[data-module="well"]')
                module.focus()
                module.press('Enter')
                expect(module).to_have_attribute('aria-expanded', 'false')
                expect(module).to_be_focused()
                module.press('Enter')
                expect(module).to_have_attribute('aria-expanded', 'true')
                operation = page.locator('[data-step="1"]')
                operation.focus()
                operation.press('Enter')
                expect(page.locator('#openRoute')).to_be_focused()
                expect(operation).to_have_attribute('aria-current', 'step')
                page.evaluate('''() => {const wafer=FabEngine.execute(FabEngine.createWafer('KEYBOARD')).wafer;FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:wafer.id,records:wafer.records}]});}''')
                page.locator('#tab-history').click()
                history = page.locator('[data-history="0"]')
                history.focus()
                history.press('Enter')
                expect(history).to_be_focused()
                page.locator('#tab-compare').click()
                comparison = page.locator('#compareOperation')
                comparison.focus()
                comparison.select_option('0')
                expect(comparison).to_be_focused()
                expect(comparison).to_have_value('0')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                results.append({'keyboard_focus_after_route_history_comparison_updates': True})
                page.evaluate('''() => {let wafer=FabEngine.createWafer('DEPTH');const count=FabEngine.route.findIndex(step=>step.op==='anneal')+1;while(wafer.cursor<count)wafer=FabEngine.execute(wafer).wafer;FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:wafer.id,records:wafer.records}]});}''')
                history_before = page.evaluate('JSON.stringify(FabApp.snapshot().wafers.map(wafer=>wafer.records))')
                depth = page.locator('#probeDepth')
                depth.focus()
                depth.press('Home')
                expect(page.locator('#probeDepthValue')).to_have_text('0 nm')
                surface_value = page.locator('#dopantValue').inner_text()
                depth.press('End')
                expect(page.locator('#probeDepthValue')).to_have_text('600 nm')
                expect(depth).to_be_focused()
                assert page.locator('#dopantValue').inner_text() != surface_value
                assert page.evaluate('JSON.stringify(FabApp.snapshot().wafers.map(wafer=>wafer.records))') == history_before
                ticks = page.locator('#filmProfile [data-profile-tick]').all_text_contents()
                assert len(ticks) == len(set(ticks)) == 5, ticks
                assert '× 10' in page.locator('#dopantValue').inner_text()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                page.locator('.section-inspector').scroll_into_view_if_needed()
                page.screenshot(path=str(output / 'depth-inspection-390.png'))
                results.append({'depth_inspection_keyboard_and_record_preservation': True})
                context.close()
                browser.close()
        finally:
            server.close()
    assert not errors, errors
    payload = {'results': results, 'page_errors': errors}
    (output / 'results.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    main()
