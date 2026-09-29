"""Verify raw equipment drafts, preserved log files and real cross-tab locks."""
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

KEY = 'waferflow-equipment-draft-v1'


def downloaded_json(page, selector):
    with page.expect_download() as pending:
        page.locator(selector).click()
    return json.loads(Path(pending.value.path()).read_text(encoding='utf-8'))


def import_json(page, selector, data):
    page.locator(selector).set_input_files({
        'name': 'equipment-audit.json', 'mimeType': 'application/json',
        'buffer': json.dumps(data, ensure_ascii=False).encode('utf-8'),
    })


def unload_blocked(page):
    return page.evaluate("""() => {
        const event = new Event('beforeunload', {cancelable:true});
        window.dispatchEvent(event); return event.defaultPrevented;
    }""")


def main():
    output = ROOT / '.test-tools' / 'equipment-storage'
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
                    page.goto(origin + '/equipment.html', wait_until='load')
                    page.locator('#recipe-beamVoltageV').fill('830')
                    page.locator('#recipe-pressurePa').fill('1e')
                    expect(page.locator('#draftStatus')).to_contain_text('저장됨')
                    page.reload(wait_until='load')
                    expect(page.locator('#recipe-beamVoltageV')).to_have_value('830')
                    expect(page.locator('#recipe-pressurePa')).to_have_value('1e')
                    expect(page.locator('#runButton')).to_be_disabled()
                    expect(page.locator('#draftContext')).to_contain_text('미실행')
                    log = downloaded_json(page, '#exportButton')
                    draft = downloaded_json(page, '#exportDraftButton')
                    assert log['recipe']['beamVoltageV'] == 700
                    assert draft['recipe']['beamVoltageV'] == '830'
                    assert draft['recipe']['pressurePa'] == '1e'
                    assert 'samples' not in draft and 'draft' not in log

                    log['recipe']['beamVoltageV'] = 910
                    log['playback'] = {'t': 3}
                    import_json(page, '#importFile', log)
                    expect(page.locator('#recipeMode')).to_have_text('LOG REPLAY')
                    expect(page.locator('#recipe-beamVoltageV')).to_have_value('910')
                    trace_before = page.evaluate('JSON.stringify(EquipmentApp.snapshot().trace)')
                    import_json(page, '#importDraftFile', draft)
                    expect(page.locator('#feedback')).to_contain_text('현재 로그와 재생 위치는 유지')
                    assert page.evaluate('JSON.stringify(EquipmentApp.snapshot().trace)') == trace_before
                    assert page.evaluate('EquipmentApp.snapshot().time') == 3
                    assert downloaded_json(page, '#exportDraftButton')['recipe']['pressurePa'] == '1e'
                    restored_log = downloaded_json(page, '#exportButton')
                    assert restored_log['recipe']['beamVoltageV'] == 910
                    assert restored_log['playback']['t'] == 3
                    page.locator('#returnSimulation').click()
                    expect(page.locator('#recipe-pressurePa')).to_have_value('1e')
                    expect(page.locator('#recipe-beamVoltageV')).to_have_value('830')

                    raw = '{BROKEN\n원본 초안 보존'
                    page.evaluate('([key, raw])=>localStorage.setItem(key, raw)', [KEY, raw])
                    page.reload(wait_until='load')
                    expect(page.locator('#draftRecovery')).to_be_visible()
                    page.locator('#recipe-beamVoltageV').fill('870')
                    assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw
                    assert unload_blocked(page)
                    downloaded_json(page, '#exportButton')
                    assert unload_blocked(page)
                    with page.expect_download() as pending:
                        page.locator('#downloadDraftRecovery').click()
                    assert Path(pending.value.path()).read_text(encoding='utf-8') == raw
                    assert unload_blocked(page)
                    assert downloaded_json(page, '#exportDraftButton')['recipe']['beamVoltageV'] == '870'
                    assert not unload_blocked(page)
                    expect(page.locator('#draftRecovery')).to_be_visible()
                    page.locator('#recipe-beamVoltageV').fill('880')
                    assert unload_blocked(page)
                    assert page.evaluate('(key)=>localStorage.getItem(key)', KEY) == raw
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    page.locator('#draftRecovery').scroll_into_view_if_needed()
                    page.screenshot(path=str(output / f'draft-recovery-{width}.png'))
                    downloaded_json(page, '#exportDraftButton')
                    results.append({'width': width, 'raw_draft_restore': True, 'trace_and_draft_separate': True,
                                    'corrupt_original_preserved': True, 'export_guard': True, 'horizontal_overflow': False})
                    context.close()

                context = browser.new_context(accept_downloads=True)
                a, b = context.new_page(), context.new_page()
                for page in [a, b]:
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/equipment.html', wait_until='load')
                a.locator('#recipe-beamVoltageV').fill('820')
                expect(a.locator('#draftStatus')).to_contain_text('저장됨')
                expect(b.locator('#draftStorageMessage')).to_contain_text('다른 탭')
                saved = a.evaluate('(key)=>localStorage.getItem(key)', KEY)
                b.locator('#recipe-pressurePa').fill('.4')
                assert a.evaluate('(key)=>localStorage.getItem(key)', KEY) == saved
                assert unload_blocked(b)
                assert downloaded_json(b, '#exportDraftButton')['recipe']['pressurePa'] == '.4'
                assert not unload_blocked(b)
                results.append({'storage_event_conflict': True, 'stale_tab_draft_download': True})
                context.close()

                context = browser.new_context(accept_downloads=True)
                a, b = context.new_page(), context.new_page()
                for page in [a, b]:
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/equipment.html', wait_until='load')
                a.evaluate("""key => {
                    window.lockAcquired=false;
                    navigator.locks.request(key+'-write', {mode:'exclusive'}, () => new Promise(resolve => {
                        window.releaseStorageLock=resolve; window.lockAcquired=true;
                    }));
                }""", KEY)
                a.wait_for_function('window.lockAcquired')
                a.locator('#recipe-beamVoltageV').fill('810')
                a.locator('#recipe-beamVoltageV').fill('820')
                b.locator('#recipe-pressurePa').fill('.4')
                assert a.evaluate('(key)=>localStorage.getItem(key)', KEY) is None
                a.evaluate('window.releaseStorageLock()')
                expect(a.locator('#draftStatus')).to_contain_text('저장됨')
                expect(b.locator('#draftStorageMessage')).to_contain_text('다른 탭')
                saved = json.loads(a.evaluate('(key)=>localStorage.getItem(key)', KEY))
                assert saved['recipe']['beamVoltageV'] == '820'
                assert saved['recipe']['pressurePa'] == '0.3'
                downloaded_json(b, '#exportDraftButton')
                results.append({'simultaneous_writes_serialized': True, 'obsolete_queued_write_skipped': True})
                context.close()
                browser.close()
        finally:
            server.close()
    report = {'passed': len(results), 'results': results, 'page_errors': errors}
    (output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert not errors, errors
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
