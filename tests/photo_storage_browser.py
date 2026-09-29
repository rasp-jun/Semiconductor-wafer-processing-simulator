"""Verify photo record preservation, complete downloads and real Web Locks in Chrome."""
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
DIRTY = '''() => {
    const event=new Event('beforeunload',{cancelable:true});
    dispatchEvent(event);return event.defaultPrevented;
}'''


def downloaded_text(page, selector):
    with page.expect_download() as pending:
        page.locator(selector).click()
    return Path(pending.value.path()).read_text(encoding='utf-8')


def main():
    output = ROOT / '.test-tools/photo-storage'
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
                    context = browser.new_context(viewport={'width': width, 'height': 1000}, accept_downloads=True)
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/photo-lab.html', wait_until='load')
                    original = '{previous photo lesson: broken JSON · 이전 포토 기록\n'
                    page.evaluate('(raw)=>localStorage.setItem("'+KEY+'",raw)', original)
                    page.reload(wait_until='load')
                    expect(page.locator('#photoStorageMessage')).to_contain_text('자동 저장을 중지')
                    page.locator('#hypothesis').fill('원본을 보존하며 새 조건을 비교한다.')
                    page.locator('#runSimulation').click()
                    expect(page.locator('#runLabel')).to_have_text('RUN 001')
                    page.locator('#saveRecipe').click()
                    page.locator('#recipeName').fill('보존 점검용 레시피')
                    page.locator('#saveForm button[type="submit"]').click()
                    assert page.evaluate('localStorage.getItem("'+KEY+'")') == original
                    assert downloaded_text(page, '#downloadPhotoOriginal') == original
                    assert page.evaluate(DIRTY)
                    current = json.loads(downloaded_text(page, '#exportPhotoState'))
                    assert current['hypothesis'] == '원본을 보존하며 새 조건을 비교한다.'
                    assert len(current['history']) == len(current['recipes']) == 1
                    assert current['history'][0]['hypothesis'] == current['hypothesis']
                    assert current['recipes'][0]['name'] == '보존 점검용 레시피'
                    assert current['params'] == current['lastResult']['params']
                    assert current['modelVersion'] == page.evaluate('WaferEngine.version')
                    assert not page.evaluate(DIRTY)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    assert page.evaluate('''() => {
                        const header=document.querySelector('.st-pagehead').getBoundingClientRect();
                        const badge=document.querySelector('.model-badge').getBoundingClientRect();
                        return badge.height<24 && [...document.querySelectorAll('.st-pagehead-title,.st-pagehead-actions>*')].filter(el=>getComputedStyle(el).display!=='none').every(el=>{const box=el.getBoundingClientRect();return box.top>=header.top&&box.bottom<=header.bottom+1&&box.left>=header.left&&box.right<=header.right+1;});
                    }''')
                    page.screenshot(path=str(output / f'recovery-{width}.png'))
                    results.append({'width': width, 'exactOriginalDownload': True, 'completeCurrentDownload': True, 'noOverflow': True})
                    context.close()

                context = browser.new_context(accept_downloads=True)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/photo-lab.html', wait_until='load')
                legacy = {key: value for key, value in current.items() if key not in ['schema', 'modelVersion', 'exportedAt']}
                original = json.dumps(legacy, ensure_ascii=False)
                page.evaluate('(raw)=>localStorage.setItem("'+KEY+'",raw)', original)
                page.reload(wait_until='load')
                expect(page.locator('#hypothesis')).to_have_value(legacy['hypothesis'])
                expect(page.locator('#downloadPhotoOriginal')).to_be_hidden()
                assert page.evaluate('localStorage.getItem("'+KEY+'")') == original
                page.locator('.nav-item[data-page="notebook"]').click()
                expect(page.locator('.report-card')).to_have_count(1)
                expect(page.locator('.saved-recipe')).to_have_count(1)
                page.locator('.nav-item[data-page="lab"]').click()
                page.evaluate('''() => {
                    window.storageSet=Storage.prototype.setItem;
                    Storage.prototype.setItem=function(key,value){if(key==='waferflow-v2')throw new DOMException('quota','QuotaExceededError');return window.storageSet.call(this,key,value);};
                }''')
                page.locator('#hypothesis').fill('저장 공간 부족 중에도 유지할 가설')
                expect(page.locator('#photoStorageMessage')).to_contain_text('저장하지 못했습니다')
                page.locator('.nav-item[data-page="notebook"]').click()
                expect(page.locator('#photoStorageMessage')).to_contain_text('저장하지 못했습니다')
                assert page.evaluate('localStorage.getItem("'+KEY+'")') == original
                assert page.evaluate(DIRTY)
                exported = json.loads(downloaded_text(page, '#exportPhotoState'))
                assert exported['hypothesis'] == '저장 공간 부족 중에도 유지할 가설'
                assert exported['history'] == legacy['history']
                assert exported['recipes'] == legacy['recipes']
                assert not page.evaluate(DIRTY)
                page.evaluate('() => {Storage.prototype.setItem=window.storageSet;}')
                page.locator('.nav-item[data-page="lab"]').click()
                page.locator('#hypothesis').fill('저장 공간 복구 후 다시 보관')
                expect(page.locator('#photoStorageMessage')).to_contain_text('저장했습니다')
                page.reload(wait_until='load')
                expect(page.locator('#hypothesis')).to_have_value('저장 공간 복구 후 다시 보관')
                results.append({'legacyRestored': True, 'quotaNoticePersistent': True, 'quotaExportComplete': True, 'retryReloaded': True})
                context.close()

                context = browser.new_context(accept_downloads=True)
                left, right = context.new_page(), context.new_page()
                for page in [left, right]:
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin + '/photo-lab.html', wait_until='load')
                left.evaluate('''() => {
                    window.lockHeld=false;
                    navigator.locks.request('waferflow-v2-write',async()=>{
                        window.lockHeld=true;await new Promise(resolve=>window.releasePhotoLock=resolve);
                    });
                }''')
                left.wait_for_function('()=>window.lockHeld===true')
                left.locator('#hypothesis').fill('first queued photo hypothesis')
                right.locator('#hypothesis').fill('second queued photo hypothesis')
                expect(left.locator('#photoStorageMessage')).to_contain_text('저장 중')
                expect(right.locator('#photoStorageMessage')).to_contain_text('저장 중')
                left.wait_for_function('''async()=> (await navigator.locks.query()).pending.filter(lock=>lock.name==='waferflow-v2-write').length===2''')
                assert left.evaluate('localStorage.getItem("'+KEY+'")') is None
                left.evaluate('window.releasePhotoLock()')
                expect(left.locator('#photoStorageMessage')).to_contain_text('저장했습니다')
                expect(right.locator('#photoStorageMessage')).to_contain_text('다른 탭')
                saved = left.evaluate('localStorage.getItem("'+KEY+'")')
                assert json.loads(saved)['hypothesis'] == 'first queued photo hypothesis'
                assert downloaded_text(right, '#downloadPhotoOriginal') == saved
                assert right.evaluate(DIRTY)
                exported = json.loads(downloaded_text(right, '#exportPhotoState'))
                assert exported['hypothesis'] == 'second queued photo hypothesis'
                assert not right.evaluate(DIRTY)
                assert not left.evaluate(DIRTY)
                results.append({'twoTabs': True, 'realQueuedExclusiveLocks': True, 'firstSavePreserved': True, 'secondDraftExported': True})
                context.close()

                context = browser.new_context(accept_downloads=True)
                context.add_init_script("Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});")
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/photo-lab.html', wait_until='load')
                expect(page.locator('#photoStorageMessage')).to_contain_text('HTTPS')
                page.locator('#hypothesis').fill('잠금 없는 환경의 실습 가설')
                assert page.evaluate('localStorage.getItem("'+KEY+'")') is None
                exported = json.loads(downloaded_text(page, '#exportPhotoState'))
                assert exported['hypothesis'] == '잠금 없는 환경의 실습 가설'
                assert not page.evaluate(DIRTY)
                results.append({'missingLocksProtected': True, 'manualJSONAvailable': True})
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
