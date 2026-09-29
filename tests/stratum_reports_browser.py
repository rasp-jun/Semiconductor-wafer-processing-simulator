"""Render actual downloaded reports independently, including narrow tables and print."""
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


def main():
    output = ROOT / '.test-tools' / 'stratum-reports'
    output.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'reports.sqlite3', testing=True),
                               host='127.0.0.1', port=0)
        threading.Thread(target=server.run, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                app_context = browser.new_context(viewport={'width': 1440, 'height': 1100},
                                                  accept_downloads=True, reduced_motion='reduce')
                page = app_context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                for kind, route, button, api in [
                    ('memory', 'memory-fab.html', '#reportButton', 'MemoryFabApp'),
                    ('evidence', 'evidence.html', '#downloadReport', 'EvidenceApp'),
                ]:
                    page.goto(f'http://127.0.0.1:{server.effective_port}/{route}', wait_until='load')
                    page.wait_for_function(f'()=>!!window.{api}')
                    if kind == 'evidence':
                        assert page.evaluate("EvidenceApp.loadData(EvidenceEngine.demo('har'))")
                        assert page.evaluate('EvidenceApp.freezePlan()')
                        assert page.evaluate('EvidenceApp.evaluate()')
                    else:
                        page.locator('.study-panel > summary').click()
                        page.locator('[data-review-field="question"]').fill(
                            '내부 검토 — ' + 'long_reference_identifier_' * 5)
                        page.locator('#isolateButton').click()
                    before = page.evaluate(f'{api}.snapshot()')
                    with page.expect_download() as pending:
                        page.locator(button).click()
                    html = Path(pending.value.path()).read_text(encoding='utf-8')
                    (output / f'{kind}-report.html').write_text(html, encoding='utf-8')
                    assert page.evaluate(f'{api}.snapshot()') == before, 'Export changed application state'

                    # The downloaded HTML must work without the original app, CSS or JS.
                    context = browser.new_context(viewport={'width': 390, 'height': 844},
                                                  is_mobile=True, device_scale_factor=1)
                    report = context.new_page()
                    requests = []
                    report.on('request', lambda request: requests.append(request.url))
                    report.on('pageerror', lambda error: errors.append(str(error)))
                    report.set_content(html, wait_until='load')
                    expect(report).to_have_title('STRATUM 메모리 팹 검토' if kind == 'memory'
                                                 else 'STRATUM 모델 근거 검토')
                    assert report.locator('table tr').count() > 10
                    assert report.locator('.report-table > table').count() == report.locator('table').count()
                    assert report.locator('pre').count() >= 1
                    for width in [390, 1440]:
                        report.set_viewport_size({'width': width, 'height': 844})
                        dimensions = report.evaluate('''()=>{
                            const body=document.body, heading=document.querySelector('h1');
                            const box=heading.getBoundingClientRect(), style=getComputedStyle(body);
                            return {viewport:innerWidth, page:document.documentElement.scrollWidth,
                                left:box.left, right:box.right, font:parseFloat(style.fontSize),
                                padding:parseFloat(style.paddingLeft), tables:document.querySelectorAll('table').length};
                        }''')
                        assert dimensions['viewport'] == width, dimensions
                        assert dimensions['page'] <= width + 1, dimensions
                        assert dimensions['left'] >= 16 and dimensions['right'] <= width - 16, dimensions
                        assert dimensions['font'] >= 14, dimensions
                        report.screenshot(path=str(output / f'{kind}-{width}.png'))
                        results.append({'report': kind, 'width': width, **dimensions})
                        if width == 390:
                            table = report.locator('.report-table').first
                            assert table.evaluate('el=>el.scrollWidth>el.clientWidth')
                            table.focus()
                            table.press('ArrowRight')
                            report.wait_for_function("document.querySelector('.report-table').scrollLeft>0")
                            report.screenshot(path=str(output / f'{kind}-table-390.png'))
                    report.emulate_media(media='print')
                    assert report.locator('.report-table').evaluate_all(
                        "els=>els.every(el=>getComputedStyle(el).overflowX==='visible')")
                    assert report.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    assert not requests, requests
                    context.close()
                app_context.close()
                browser.close()
        finally:
            server.close()
    assert not errors, errors
    record = {'checks': results, 'actualDownloads': 2, 'isolatedRendering': True,
              'keyboardTableScroll': True, 'printTablesUnclipped': True, 'pageErrors': errors}
    (output / 'results.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
