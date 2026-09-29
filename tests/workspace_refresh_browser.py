"""Workspace readability and CMOS navigation checks with an isolated browser/DB."""
import json
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.sync_api import expect, sync_playwright
from waitress import create_server
from server.app import create_app

ROOT = Path(__file__).resolve().parent.parent


def main():
    output = ROOT / '.test-tools' / 'workspace-refresh'
    output.mkdir(parents=True, exist_ok=True)
    errors, captures = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'review.sqlite3', testing=True),
                               host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
                page.on('pageerror', lambda error: errors.append(str(error)))
                base = f'http://127.0.0.1:{server.effective_port}'
                for name in ['index', 'cmos-lab']:
                    page.goto(f'{base}/{name}.html', wait_until='networkidle')
                    for width in [1440, 1024, 820, 390, 360]:
                        page.set_viewport_size({'width': width, 'height': 1000})
                        page.wait_for_timeout(150)
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), (name, width)
                        if width in [1440, 390]:
                            path = output / f'{name}-{width}.png'
                            page.screenshot(path=str(path), full_page=True)
                            page.screenshot(path=str(output / f'{name}-{width}-viewport.png'))
                            captures.append(str(path.relative_to(ROOT)))
                    if name == 'index':
                        original = page.evaluate('MemoryFabApp.snapshot()')
                        page.locator('[data-floor-view="detail"]').click()
                        assert page.locator('#fabMap').get_attribute('data-layout') == 'detail'
                        page.locator('[data-floor-view="floor"]').click()
                        assert page.evaluate('MemoryFabApp.snapshot()') == original
                        page.get_by_role('button', name='결과', exact=True).click()
                        assert page.locator('#kpiDone').is_visible()
                        assert page.locator('#kpiBottleneck').is_visible()
                        page.get_by_role('link', name='02 LOT 진행 · 이력').click()
                        expect(page.locator('#lotOverview')).to_be_in_viewport()
                    else:
                        assert not page.locator('#routeSearch').is_visible()
                        page.locator('#routeDrawer summary').click()
                        assert page.locator('#routeSearch').is_visible()
                        page.locator('#routeDrawer summary').click()
                        assert not page.locator('#routeSearch').is_visible()
                page.set_viewport_size({'width': 1440, 'height': 1000})
                original = page.evaluate('(() => {const s=FabApp.snapshot();delete s.exportedAt;return s;})()')
                page.locator('#focusStage').click()
                assert not page.locator('.route-panel').is_visible()
                assert page.evaluate('(() => {const s=FabApp.snapshot();delete s.exportedAt;return s;})()') == original
                page.keyboard.press('Escape')
                assert page.locator('.route-panel').is_visible()
                assert page.locator('#focusStage').get_attribute('aria-pressed') == 'false'
                page.locator('.observation-deck summary').click()
                assert not page.locator('#observationSeek').is_visible()
                page.locator('.observation-deck summary').click()
                assert page.locator('#observationSeek').is_visible()
                page.locator('#routeFilter').select_option('done')
                assert page.locator('.route-no-results').is_visible()
                page.locator('#jumpCurrent').click()
                assert page.locator('#routeFilter').input_value() == 'all'
                page.locator('#nextOperation').click()
                assert 'PR 도포' in page.locator('#operationName').inner_text()
                page.locator('#previousOperation').click()
                page.locator('#runButton').click()
                assert page.locator('#nextOperation').is_disabled()
                page.locator('#runButton').click()
                assert page.locator('#runState').inner_text() == '일시정지'
                page.locator('#cancelRunButton').click()
                assert page.locator('#nextOperation').is_enabled()
                # Load committed reference history in the isolated test context.
                page.evaluate("""() => {
                    let wafer=FabEngine.createWafer('BROWSER');
                    while(wafer.cursor<40)wafer=FabEngine.execute(wafer).wafer;
                    localStorage.setItem('waferflow-fab-'+FabEngine.VERSION,JSON.stringify({
                        schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,
                        active:'BROWSER',selected:36,wafers:[{id:'BROWSER',records:wafer.records}]
                    }));
                }""")
                page.reload(wait_until='networkidle')
                page.locator('#routeFilter').select_option('done')
                assert page.locator('[data-step]').count() == 40
                page.locator('#routeSearch').fill('게이트')
                assert 0 < page.locator('[data-step]').count() < 40
                page.locator('#routeSearch').fill('')
                page.get_by_role('link', name='결과 · 비교', exact=True).click()
                assert '20 nm' in page.locator('#metricsPanel').inner_text()
                assert page.locator('#runState').inner_text() == '기록 완료'
                page.screenshot(path=str(output / 'cmos-results.png'), full_page=False)
                assert not errors, errors
                browser.close()
        finally:
            server.close()
    (output / 'results.json').write_text(json.dumps({'page_errors': errors, 'captures': captures,
        'checks': '5 viewport widths, navigation, filtering, run/pause/cancel, completed history'},
        ensure_ascii=False, indent=2), encoding='utf-8')
    print('Workspace refresh: 2 pages / 5 widths, CMOS navigation and playback checks passed; no page errors.')


if __name__ == '__main__':
    main()
