"""Exercise rejected pilot file reads against an existing review in isolated Chrome."""
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def export(page):
    with page.expect_download() as event:
        page.locator('#pilotExport').click()
    data = json.loads(Path(event.value.path()).read_text(encoding='utf-8'))
    data.pop('exportedAt', None)
    return data


def choose(page, selector, name, data):
    buffer = data if isinstance(data, bytes) else json.dumps(data).encode()
    page.locator(selector).set_input_files({'name': name, 'mimeType': 'application/json', 'buffer': buffer})


def main():
    output = ROOT / '.test-tools/pilot-import'
    output.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    errors, results = [], []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            for width in [1440, 390]:
                page = browser.new_page(viewport={'width': width, 'height': 1000}, accept_downloads=True)
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/fab-pilot.html', wait_until='load')
                page.locator('#pilotDemo').click()
                page.locator('#pilotDeclaration').check()
                page.locator('#pilotRun').click()
                expect(page.locator('#pilotResults')).to_be_visible()
                page.locator('#pilotNotes').fill('기존 검토의 관찰과 원인 가설')
                before = export(page)
                profile = page.locator('#pilotProfile').input_value()
                rejected_batches = [None, b'{broken', b'\xff', {'schema': 'wrong-batch'}, {'schema': 'waferflow-pilot-batch-v1'}, {'schema': 'waferflow-pilot-batch-v1', 'runs': []}, {'schema': 'waferflow-pilot-batch-v1', 'runs': [before['input']['batch']['runs'][0]] * 101}]
                rejected_files = [('#pilotBatchFile', data) for data in rejected_batches] + [('#pilotProfileFile', {'schema': 'wrong-profile'}), ('#pilotBatchFile', {**before, 'inputSha256': '0' * 64})]
                for selector, data in rejected_files:
                    choose(page, selector, 'rejected.json', data)
                    expect(page.locator(selector)).to_be_enabled()
                    expect(page.locator('#pilotResults')).to_be_visible()
                    expect(page.locator('#pilotExport')).to_be_enabled()
                    expect(page.locator('#pilotStatus')).to_contain_text('유지')
                    assert page.locator('#pilotProfile').input_value() == profile
                    assert export(page) == before
                page.evaluate('''() => {
                    const original=File.prototype.arrayBuffer;
                    File.prototype.arrayBuffer=function(){
                        if(this.name!=='delayed.json')return original.call(this);
                        return new Promise(resolve=>{window.releasePilotRead=async()=>resolve(await original.call(this));});
                    };
                }''')
                choose(page, '#pilotBatchFile', 'delayed.json', before)
                page.wait_for_function('typeof window.releasePilotRead === "function"')
                expect(page.locator('#pilotNotes')).to_be_disabled()
                expect(page.locator('#pilotExport')).to_be_disabled()
                expect(page.locator('#pilotProfileFile')).to_be_disabled()
                page.evaluate('window.releasePilotRead()')
                expect(page.locator('#pilotBatchFile')).to_be_enabled()
                expect(page.locator('#pilotResults')).not_to_be_visible()
                expect(page.locator('#pilotExport')).to_be_disabled()
                expect(page.locator('#pilotRun')).to_be_enabled()
                page.locator('#pilotRun').click()
                expect(page.locator('#pilotResults')).to_be_visible()
                after = export(page)
                assert after['input'] == before['input']
                assert after['notes'] == before['notes']
                assert after['sourceFiles'][-1]['name'] == 'delayed.json'
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+2')
                page.screenshot(path=str(output / f'restored-{width}.png'), full_page=True)
                results.append({'width': width, 'rejected_reads_preserve_review': True, 'pending_read_protects_inputs': True, 'valid_import_requires_recalculation': True})
                page.close()
            browser.close()
        assert not errors, errors
        result = {'passed': len(results), 'checks': results, 'page_errors': errors}
        (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
