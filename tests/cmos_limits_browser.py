"""Check depth-limit guidance through real preview, playback and exported records."""
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    output = ROOT / '.test-tools' / 'cmos-limits'
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT / '.test-tools' / 'site-source' / 'dist')))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    results, errors = [], []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            for width in [1440, 390]:
                context = browser.new_context(viewport={'width': width, 'height': 1000}, accept_downloads=True)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/cmos-lab.html', wait_until='load')
                page.locator('[data-workspace=all]').click()
                page.evaluate('''() => {
                    let wafer=FabEngine.createWafer('DEPTH_LIMIT');
                    while(FabEngine.route[wafer.cursor].id!=='OP022')wafer=FabEngine.execute(wafer).wafer;
                    FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:wafer.id,records:wafer.records}]});
                }''')
                initial = page.evaluate('JSON.stringify(FabApp.snapshot().wafers.find(w=>w.id==="DEPTH_LIMIT").records)')
                page.locator('#recipe-time').fill('150')
                page.locator('#previewButton').click()
                warning = page.locator('#metricsPanel .warning-list')
                expect(warning).to_contain_text('600')
                expect(warning).to_contain_text('64')
                assert page.evaluate('JSON.stringify(FabApp.snapshot().wafers.find(w=>w.id==="DEPTH_LIMIT").records)') == initial

                page.locator('#autoRun').check()
                page.locator('#runButton').click()
                page.locator('#runButton').click()
                expect(page.locator('#runState')).to_have_text('일시정지')

                def seek(value):
                    page.locator('#observationSeek').evaluate('(el,value)=>{el.value=value;el.dispatchEvent(new Event("input",{bubbles:true}));}', str(value))

                seek(100)
                expect(warning).to_contain_text('600')
                seek(0)
                expect(warning).to_have_count(0)
                seek(100)
                expect(warning).to_contain_text('64')
                assert page.evaluate('JSON.stringify(FabApp.snapshot().wafers.find(w=>w.id==="DEPTH_LIMIT").records)') == initial
                page.locator('#runButton').click()
                page.wait_for_function('() => FabApp.snapshot().wafers.find(w=>w.id==="DEPTH_LIMIT").records.length===22')
                expect(page.locator('#autoRun')).not_to_be_checked()
                expect(page.locator('#observationSeek')).to_be_disabled()
                expect(warning).to_contain_text('600')

                with page.expect_download() as downloaded:
                    page.locator('#exportButton').click()
                package = json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8'))
                records = next(w for w in package['wafers'] if w['id'] == 'DEPTH_LIMIT')['records']
                limits = [w for w in records[-1]['warnings'] if w.get('category') == 'model-limit']
                assert len(records) == 22 and len(limits) == 1
                assert '600' in limits[0]['message'] and '64' in limits[0]['message']
                with page.expect_download() as downloaded:
                    page.locator('#reportButton').click()
                report = Path(downloaded.value.path()).read_text(encoding='utf-8')
                assert limits[0]['code'] in report and limits[0]['message'] in report
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                warning.scroll_into_view_if_needed()
                page.screenshot(path=str(output / f'warning-{width}.png'))
                results.append({'width': width, 'preview_and_seek_guidance': True, 'uncommitted_history_preserved': True, 'automatic_run_stops_at_limit': True, 'json_and_report_preserve_guidance': True})
                context.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    assert not errors, errors
    payload = {'results': results, 'page_errors': errors}
    (output / 'results.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    main()
