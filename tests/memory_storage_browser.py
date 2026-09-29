"""Verify memory-plan recovery and concurrent saves in isolated Chrome contexts."""
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

KEY = 'waferflow-memory-fab-v1'
NOTE = '''value => {
    const input=document.querySelector('[data-review-field="question"]');
    input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
}'''
DIRTY = '''() => {
    const event=new Event('beforeunload',{cancelable:true});
    dispatchEvent(event);return event.defaultPrevented;
}'''


def downloaded_text(page, selector):
    with page.expect_download() as pending:
        page.locator(selector).click()
    return Path(pending.value.path()).read_text(encoding='utf-8')


def main():
    output = ROOT / '.test-tools/memory-storage'
    output.mkdir(parents=True, exist_ok=True)
    errors, results = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'review.sqlite3', testing=True), host='127.0.0.1', port=0, threads=8)
        threading.Thread(target=server.run, daemon=True).start()
        origin = f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                for width in [1440, 390]:
                    context = browser.new_context(viewport={'width': width, 'height': 1000}, accept_downloads=True)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/index.html', wait_until='load')
                    original = '{previous lesson: broken JSON · 이전 기록\n'
                    page.evaluate('(raw)=>localStorage.setItem("'+KEY+'",raw)', original)
                    page.reload(wait_until='load')
                    expect(page.locator('#memoryStorageStatus')).to_be_visible()
                    page.evaluate(NOTE, '현재 화면의 검토를 별도로 보관')
                    page.evaluate('MemoryFabApp.isolate()')
                    assert page.evaluate('localStorage.getItem("'+KEY+'")') == original
                    assert downloaded_text(page, '#downloadOriginalPlan') == original
                    assert page.evaluate(DIRTY)
                    exported = json.loads(downloaded_text(page, '#downloadCurrentPlan'))
                    assert exported['options']['review']['question'] == '현재 화면의 검토를 별도로 보관'
                    assert not page.evaluate(DIRTY)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    page.locator('#memoryStorageStatus').scroll_into_view_if_needed()
                    page.screenshot(path=str(output / f'recovery-{width}.png'))
                    results.append({'width': width, 'originalPreserved': True, 'currentExportedSeparately': True, 'noOverflow': True})
                    context.close()

                context = browser.new_context(accept_downloads=True)
                left, right = context.new_page(), context.new_page()
                for page, route in [(left, 'index.html'), (right, 'memory-fab.html')]:
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/' + route, wait_until='load')
                left.evaluate('''() => {
                    window.lockHeld=false;
                    navigator.locks.request('waferflow-memory-fab-v1-write',async()=>{
                        window.lockHeld=true;await new Promise(resolve=>window.releaseMemoryLock=resolve);
                    });
                }''')
                left.wait_for_function('window.lockHeld===true')
                left.evaluate(NOTE, 'first queued plan')
                right.evaluate(NOTE, 'second queued plan')
                expect(left.locator('#memoryStorageMessage')).to_contain_text('저장 중')
                expect(right.locator('#memoryStorageMessage')).to_contain_text('저장 중')
                assert left.evaluate('localStorage.getItem("'+KEY+'")') is None
                left.wait_for_function('''async()=> (await navigator.locks.query()).pending.filter(lock=>lock.name==='waferflow-memory-fab-v1-write').length===2''')
                left.evaluate('window.releaseMemoryLock()')
                expect(left.locator('#memoryStorageMessage')).to_contain_text('저장했습니다')
                expect(right.locator('#memoryStorageMessage')).to_contain_text('다른 탭')
                saved = left.evaluate('localStorage.getItem("'+KEY+'")')
                assert json.loads(saved)['options']['review']['question'] == 'first queued plan'
                assert right.evaluate('MemoryFabApp.snapshot().result.options.review.question') == 'second queued plan'
                assert right.evaluate(DIRTY)
                assert downloaded_text(right, '#downloadOriginalPlan') == saved
                exported = json.loads(downloaded_text(right, '#downloadCurrentPlan'))
                assert exported['options']['review']['question'] == 'second queued plan'
                assert not right.evaluate(DIRTY)
                assert not left.evaluate(DIRTY)
                results.append({'twoTabs': True, 'queuedExclusiveLock': True, 'firstPlanPreserved': True, 'secondPlanExportable': True})
                context.close()

                context = browser.new_context(accept_downloads=True)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/index.html', wait_until='load')
                page.evaluate('''() => {
                    window.storageSet=Storage.prototype.setItem;
                    Storage.prototype.setItem=function(key,value){if(key==='waferflow-memory-fab-v1')throw new DOMException('quota','QuotaExceededError');return window.storageSet.call(this,key,value);};
                }''')
                page.evaluate(NOTE, 'quota preserves this note')
                expect(page.locator('#memoryStorageMessage')).to_contain_text('저장하지 못했습니다')
                page.locator('#jumpIncident').click()
                expect(page.locator('#memoryStorageMessage')).to_contain_text('저장하지 못했습니다')
                assert page.evaluate(DIRTY)
                page.evaluate('() => {Storage.prototype.setItem=window.storageSet;}')
                page.evaluate(NOTE, 'retry after quota is released')
                expect(page.locator('#memoryStorageMessage')).to_contain_text('저장했습니다')
                assert not page.evaluate(DIRTY)
                page.reload(wait_until='load')
                assert page.evaluate('MemoryFabApp.snapshot().result.options.review.question') == 'retry after quota is released'
                results.append({'quotaNoticePersistent': True, 'retrySaved': True, 'reloadRestored': True})
                context.close()
                browser.close()
        finally:
            server.close()
    assert not errors, errors
    report = {'results': results, 'pageErrors': errors}
    (output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
