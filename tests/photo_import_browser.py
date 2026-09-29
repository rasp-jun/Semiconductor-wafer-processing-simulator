"""Round-trip complete photo lessons through actual Chrome downloads and file inputs."""
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

KEY = 'waferflow-v2'


def download_json(page, selector):
    with page.expect_download() as pending:
        page.locator(selector).click()
    return json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))


def select_records(page, data):
    page.locator('#importPhotoFile').set_input_files({
        'name': 'photo-lesson.json', 'mimeType': 'application/json',
        'buffer': json.dumps(data, ensure_ascii=False).encode('utf-8'),
    })


def core(data):
    return {key: value for key, value in data.items() if key != 'exportedAt'}


def main():
    output = ROOT / '.test-tools/photo-import'
    output.mkdir(parents=True, exist_ok=True)
    errors, results = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'photo.sqlite3', testing=True), host='127.0.0.1', port=0, threads=8)
        threading.Thread(target=server.run, daemon=True).start()
        origin = f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                for width in [1440, 390]:
                    source_context = browser.new_context(viewport={'width': width, 'height': 1000}, accept_downloads=True)
                    source = source_context.new_page()
                    source.on('pageerror', lambda error: errors.append(str(error)))
                    source.goto(origin + '/photo-lab.html', wait_until='load')
                    source.locator('#hypothesis').fill('원본 실행의 가설')
                    source.locator('#runSimulation').click()
                    expect(source.locator('#runLabel')).to_have_text('RUN 001')
                    source.locator('#saveRecipe').click()
                    source.locator('#recipeName').fill('다른 브라우저에서 복원할 조건')
                    source.locator('#saveForm button[type="submit"]').click()
                    source.locator('[data-stage="3"]').click()
                    source.locator('#param-dose').evaluate("el=>{el.value='145';el.dispatchEvent(new Event('input',{bubbles:true}));}")
                    source.locator('#hypothesis').fill('마지막 실행 이후 바꾼 조건')
                    incoming = download_json(source, '#exportPhotoState')
                    assert incoming['params']['dose'] != incoming['lastResult']['params']['dose']
                    source_context.close()

                    context = browser.new_context(viewport={'width': width, 'height': 1000}, accept_downloads=True)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/photo-lab.html', wait_until='load')
                    page.locator('#hypothesis').fill('교체 전에 보관할 현재 가설')
                    current = download_json(page, '#exportPhotoState')
                    select_records(page, incoming)
                    expect(page.locator('#importPhotoDialog')).to_be_visible()
                    expect(page.locator('#hypothesis')).to_have_value(current['hypothesis'])
                    expect(page.locator('#cancelPhotoImport')).to_be_focused()
                    page.keyboard.press('Escape')
                    expect(page.locator('#importPhotoDialog')).not_to_be_visible()
                    assert core(download_json(page, '#exportPhotoState')) == core(current)

                    select_records(page, incoming)
                    expect(page.locator('#importPhotoSummary')).to_contain_text('실험 1개 · 레시피 1개')
                    page.screenshot(path=str(output / f'confirm-{width}.png'), full_page=True)
                    backup = download_json(page, '#confirmPhotoImport')
                    assert core(backup) == core(current)
                    expect(page.locator('#importPhotoDialog')).not_to_be_visible()
                    expect(page.locator('#hypothesis')).to_have_value(incoming['hypothesis'])
                    expect(page.locator('#draftStatus')).to_contain_text('변경됨')
                    assert core(download_json(page, '#exportPhotoState')) == core(incoming)
                    page.wait_for_function('(key)=>JSON.parse(localStorage.getItem(key)).params.dose===145', arg=KEY)
                    page.reload(wait_until='load')
                    assert core(download_json(page, '#exportPhotoState')) == core(incoming)

                    select_records(page, {**incoming, 'modelVersion': 'unsupported-future-model'})
                    expect(page.locator('#toast')).to_contain_text('지원하지 않는')
                    expect(page.locator('#importPhotoDialog')).not_to_be_visible()
                    assert core(download_json(page, '#exportPhotoState')) == core(incoming)
                    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth+2')
                    page.locator('.nav-item[data-page="notebook"]').click()
                    expect(page.locator('.report-card')).to_have_count(1)
                    expect(page.locator('.saved-recipe')).to_have_count(1)
                    page.screenshot(path=str(output / f'restored-{width}.png'), full_page=True)
                    results.append({'width': width, 'separate_browser_contexts': True, 'draft_and_last_run_preserved': True, 'prior_records_downloaded': True, 'reload_restored': True, 'invalid_version_rejected': True})
                    context.close()
                browser.close()
            assert not errors, errors
            result = {'passed': len(results), 'checks': results, 'page_errors': errors}
            (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            server.close()


if __name__ == '__main__':
    main()
