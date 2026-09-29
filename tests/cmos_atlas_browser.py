"""Exercise the CMOS atlas workspace and capture real calculated states in Chrome."""
import json
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from waitress import create_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.app import create_app


def snapshot(page):
    return page.evaluate('() => {const s=FabApp.snapshot();delete s.exportedAt;return s;}')


def main():
    output = ROOT / '.test-tools' / 'cmos-atlas'
    output.mkdir(parents=True, exist_ok=True)
    errors, checks = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'atlas.sqlite3', testing=True),
                               host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                page = browser.new_page(viewport={'width': 1600, 'height': 1200})
                page.set_default_timeout(10000)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{server.effective_port}/cmos-lab.html', wait_until='networkidle')
                original = snapshot(page)
                for width in [1600, 1280, 1024, 820, 390, 360]:
                    page.set_viewport_size({'width': width, 'height': 1100})
                    for view, target in [('equipment', '#processWorkspace'), ('wafer', '#waferSection'), ('analysis', '#processResults')]:
                        page.locator(f'[data-workspace="{view}"]').click()
                        expect(page.locator(target)).to_be_visible()
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), (width, view)
                    if width <= 680:
                        assert not page.locator('#routeSearch').is_visible()
                        page.locator('#openRoute').click()
                        expect(page.locator('#routeSearch')).to_be_visible()
                        page.keyboard.press('Escape')
                assert snapshot(page) == original
                checks.append('3 workspaces × 6 widths; navigation never changes experiment data')

                page.set_viewport_size({'width': 1600, 'height': 1200})
                page.locator('[data-workspace=equipment]').click()
                page.locator('#focusStage').click()
                assert not page.locator('.route-panel').is_visible()
                page.keyboard.press('Escape')
                # Leaving focus mode restores the docked route beside the equipment.
                expect(page.locator('#routeDock .route-panel')).to_be_visible()
                assert page.locator('#focusStage').get_attribute('aria-pressed')=='false'
                # Desktop runs from the recipe inspector in the equipment view; the transport
                # bar carries the controls in the section / analysis views.
                expect(page.locator('#consoleRun')).to_be_hidden()
                page.locator('#runButton').click()
                expect(page.locator('#nextOperation')).to_be_disabled()
                page.locator('[data-workspace=wafer]').click()
                page.locator('#consoleRun').click()
                expect(page.locator('#runState')).to_have_text('일시정지')
                assert len(snapshot(page)['wafers'][0]['records']) == 0
                page.locator('#consoleCancel').click()
                assert snapshot(page)['wafers'][0]['records'] == []
                checks.append('focus/Escape and cross-workspace run/pause/cancel preserve committed history')

                page.locator('[data-workspace=equipment]').click()
                page.locator('#speedSelect').select_option('8')
                page.locator('#runButton').click()
                expect(page.locator('#runState')).to_have_text('기록 완료', timeout=20000)
                expect(page.locator('#consoleCompleted')).to_have_text('1 / 117')
                assert page.locator('[data-route-jump]').first.get_attribute('title').endswith('1/14 완료')
                checks.append('completed process synchronizes actual summary and module progress')

                page.evaluate('''() => {
                    let base=FabEngine.createWafer('BASE');
                    while(base.cursor<117)base=FabEngine.execute(base).wafer;
                    let variant=FabEngine.replay('VARIANT',base.records,36);
                    variant=FabEngine.execute(variant,{time:85}).wafer;
                    FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,
                      active:'BASE',selected:36,wafers:[
                        {id:'BASE',title:'CMOS 기준 공정',records:base.records},
                        {id:'VARIANT',title:'게이트 식각 시간 비교',records:variant.records,parent:{id:'BASE',from:36}}
                      ]});
                    FabApp.select(36);
                }''')
                history = snapshot(page)['wafers']
                # Every equipment family must still have a functioning, visible model.
                tools = page.evaluate('() => [...new Set(FabEngine.route.map(s=>s.tool))].map(tool=>FabEngine.route.find(s=>s.tool===tool).index)')
                for index in tools:
                    page.evaluate('i=>FabApp.select(i)', index)
                    tool = page.evaluate('FabEngine.route[FabApp.snapshot().selected].tool')
                    expect(page.locator('#fabViewport')).to_have_attribute('data-precision-tool', tool, timeout=20000)
                    assert page.locator('#fabViewport canvas').is_visible()
                    assert page.locator('#partButtons button').count() > 0
                    assert page.locator('#consoleSectionPreview svg').count() == 1
                assert snapshot(page)['wafers'] == history
                checks.append('all 18 equipment families, parts and live section preview; immutable original histories')

                page.locator('#openEquipmentAtlas').click()
                expect(page.locator('#equipmentAtlasDialog')).to_be_visible()
                assert page.locator('[data-atlas-tool]').count() == 18
                page.locator('#atlasSearch').fill('ICP')
                assert page.locator('[data-atlas-tool]').count() == 1
                page.locator('[data-atlas-tool=etch]').click()
                expect(page.locator('#equipmentAtlasDialog')).not_to_be_visible()
                assert page.evaluate('FabEngine.route[FabApp.snapshot().selected].tool') == 'etch'
                assert snapshot(page)['wafers'] == history
                page.locator('#openEquipmentAtlas').click()
                page.locator('#atlasGrid').evaluate('e=>e.scrollTop=0')
                page.wait_for_timeout(600)
                assert page.locator('#atlasGrid').evaluate('e=>e.scrollHeight>e.clientHeight')
                assert page.locator('[data-atlas-tool]').evaluate_all('els=>els.every(e=>e.scrollHeight<=e.clientHeight+1)'), 'Equipment names or models clipped'
                page.screenshot(path=str(output / 'equipment-atlas.png'))
                page.keyboard.press('Escape')
                checks.append('18 Blender models and searchable catalogue; opening equipment never advances the process')

                page.evaluate('FabApp.select(36)')
                page.wait_for_timeout(5500)  # Let the import notice and camera transition finish for captures.
                page.evaluate('scrollTo(0,0)')
                page.screenshot(path=str(output / 'equipment.png'))
                page.locator('#equipmentHelpButton').click()
                expect(page.locator('#equipmentDialog')).to_be_visible()
                page.screenshot(path=str(output / 'equipment-guide.png'))
                page.keyboard.press('Escape')
                page.locator('#openSection').click()
                expect(page.locator('#waferSection')).to_be_visible()
                page.locator('#crossSection').press('ArrowRight')
                assert page.locator('#consoleSectionPreview').inner_html() == page.locator('#crossSection').inner_html()
                page.locator('#beforeButton').click()
                assert '공정 전' in page.locator('#previewSource').inner_text()
                page.locator('#beforeButton').click()
                page.evaluate('scrollTo(0,0)')
                page.screenshot(path=str(output / 'material-section.png'), full_page=True)
                checks.append('live preview, keyboard probe and before/after inspection share the actual section')

                page.locator('[data-workspace=analysis]').click()
                page.screenshot(path=str(output / 'analysis.png'), full_page=True)
                page.locator('#tab-history').click()
                assert page.locator('#historyPanel [data-history]').count() == 117
                page.locator('#tab-sweep').click()
                page.locator('#sweepRun').click()
                assert page.locator('#sweepResults [data-sweep-row]').count() >= 2
                page.screenshot(path=str(output / 'sweep.png'), full_page=True)
                page.locator('#tab-compare').click()
                page.locator('#compareSelect').select_option('VARIANT')
                page.locator('#compareOperation').select_option('37')
                expect(page.locator('.compare-chart')).to_be_visible()
                assert '식각 시간' in page.locator('.comparison-differences').inner_text()
                page.screenshot(path=str(output / 'comparison.png'), full_page=True)
                assert snapshot(page)['wafers'] == history
                checks.append('117-row history, actual parameter sweep and branch comparison; no record mutations')

                # Native dialogs and the full layout also remain usable on a narrow device.
                page.set_viewport_size({'width':390,'height':900})
                for view in ['equipment','wafer','analysis','all']:
                    page.locator(f'[data-workspace="{view}"]').click()
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), view
                    page.evaluate('scrollTo(0,0)')
                    page.screenshot(path=str(output / f'mobile-{view}.png'), full_page=True)
                page.locator('#aboutButton').click()
                expect(page.locator('#infoDialog')).to_be_visible()
                page.keyboard.press('Escape')
                assert snapshot(page)['wafers'] == history
                assert not errors, errors
                checks.append('mobile views, full-layout option, model dialog and original-history preservation')
                browser.close()
        finally:
            server.close()
    (output / 'results.json').write_text(json.dumps({'checks': checks, 'page_errors': errors},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(checks),'checks':checks,'page_errors':errors},ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
