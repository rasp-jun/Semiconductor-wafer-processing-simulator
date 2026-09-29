"""Actual Chrome file chooser/download round trip against a disposable review DB."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import threading

from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from test_review import PASSWORD, ReviewTests


def main():
    fixture = ReviewTests('test_export_contains_evidence_versions_and_audit_but_no_credentials')
    fixture.setUp()
    output = ROOT / '.test-tools' / 'review-source'
    output.mkdir(parents=True, exist_ok=True)
    server = make_server('127.0.0.1', 0, fixture.app)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    errors, posts = [], []
    raw = b'\xef\xbb\xbfwafer_id,site_id,cd_nm,etch_depth_nm\r\n" W1 ",S1,5.00e2,0.000\r\n'
    text = raw.decode('utf-8-sig').replace('\r\n', '\n')
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: posts.append(request.post_data_json) if request.method=='POST' and request.url.endswith('/experiments') else None)
            page.goto(f'http://127.0.0.1:{server.server_port}/workbench.html')
            page.locator('#authForm [name="username"]').fill('engineer')
            page.locator('#authForm [name="password"]').fill(PASSWORD)
            page.locator('#authSubmit').click()
            page.locator('[data-action="import"]').wait_for()

            def import_file(name, edited=False):
                page.locator('[data-action="import"]').click()
                for key, value in {'name':name,'lot_id':'RAW-01','cd_lsl_nm':'480','cd_usl_nm':'520'}.items():
                    page.locator(f'#workspaceForm [name="{key}"]').fill(value)
                page.locator('#csvFile').set_input_files({'name':'원본.csv','mimeType':'text/csv','buffer':raw})
                page.wait_for_function("document.querySelector('#workspaceForm').dataset.csvReading==='false'")
                assert page.locator('[name="csv"]').input_value()==text
                if edited:
                    page.locator('[name="csv"]').fill(text.replace('5.00e2','501'))
                page.locator('#workspaceForm [type="submit"]').click()
                page.locator('#reviewDialog').wait_for(state='hidden')
                page.locator('[data-experiment]').filter(has_text=name).click()
                page.locator('[data-download-source]').wait_for()

            import_file('Exact byte source')
            assert 'csv' not in posts[-1]
            assert posts[-1]['original_csv']['sha256']==hashlib.sha256(raw).hexdigest()
            with page.expect_download() as event:
                page.locator('[data-download-source]').click()
            file = output / 'original.csv'
            event.value.save_as(file)
            assert file.read_bytes()==raw
            with page.expect_download() as event:
                page.locator('[data-download-evidence]').click()
            packet_path = output / 'original-evidence.json'
            event.value.save_as(packet_path)
            packet = json.loads(packet_path.read_text(encoding='utf-8'))
            archive = packet['result']['source_archive']
            assert base64.b64decode(archive['bytes_base64'])==raw
            assert archive['sha256']==hashlib.sha256(raw).hexdigest()
            assert packet['result']['file_sha256']==hashlib.sha256(text.encode()).hexdigest()
            assert archive['hash_scope']=='original-file-bytes'
            page.locator('#reviewDialog').screenshot(path=str(output/'original-source.png'))
            page.locator('[data-close-dialog]').click()
            import_file('Edited source', edited=True)
            assert 'original_csv' not in posts[-1]
            assert 'csv' not in posts[-1]
            submitted = base64.b64decode(posts[-1]['csv_utf8_base64']).decode('utf-8')
            assert submitted==text.replace('5.00e2','501')
            with page.expect_download() as event:
                page.locator('[data-download-evidence]').click()
            edited_path = output / 'edited-evidence.json'
            event.value.save_as(edited_path)
            edited = json.loads(edited_path.read_text(encoding='utf-8'))['result']['source_archive']
            assert edited['kind']=='submitted-text' and 'bytes_base64' not in edited
            assert edited['text']==submitted
            page.locator('[data-close-dialog]').click()
            with page.expect_download() as event:
                page.locator('#exportProject').click()
            package_path = output / 'project.json'
            event.value.save_as(package_path)
            package = json.loads(package_path.read_text(encoding='utf-8'))
            assert len(package['experiments'])==2
            stored = next(e for e in package['experiments'] if e['id']==packet['id'])
            assert stored['digest']==packet['digest'] and stored['result']==packet['result']
            browser.close()
        assert not errors, errors
        result = dict(exact_file_download=True, original_and_text_hashes_verified=True,
                      edited_file_uses_submitted_text=True, project_preserves_source=True, page_errors=errors)
        (output/'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
    finally:
        server.shutdown()
        server.server_close()
        fixture.tearDown()


if __name__=='__main__':
    main()
