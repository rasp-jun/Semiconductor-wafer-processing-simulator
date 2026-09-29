"""Exercise the shared evidence ledger in isolated real Chrome tabs."""
import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
KEY = 'waferflow-evidence-ledger-v1'
LOCK = KEY + '-write'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def prepare(page, kind='har'):
    assert page.evaluate('kind=>EvidenceApp.loadData(EvidenceEngine.demo(kind))', kind)
    assert page.evaluate('EvidenceApp.freezePlan()')


def hold(page):
    page.evaluate('''name => {
        window.ledgerLockHeld=false;
        navigator.locks.request(name,{mode:'exclusive'},()=>new Promise(resolve=>{
            window.releaseLedgerLock=resolve;window.ledgerLockHeld=true;
        }));
    }''', LOCK)
    page.wait_for_function('window.ledgerLockHeld')


def start(page):
    page.evaluate('''() => {
        window.evaluationDone=false;window.evaluationReturn=null;
        EvidenceApp.evaluate().then(value=>{window.evaluationReturn=value;window.evaluationDone=true;});
    }''')


def wait_pending(page, count):
    page.wait_for_function('''async ({name,count}) => {
        const locks=await navigator.locks.query();
        return locks.pending.filter(lock=>lock.name===name).length===count;
    }''', arg={'name': LOCK, 'count': count})


def finish(page, expected=True):
    page.wait_for_function('window.evaluationDone')
    assert page.evaluate('window.evaluationReturn') is expected
    return page.evaluate('EvidenceApp.snapshot()')


def read_ledger(page):
    return page.evaluate('key=>JSON.parse(localStorage.getItem(key))', KEY)


def main():
    output = ROOT / '.test-tools' / 'evidence-storage'
    output.mkdir(parents=True, exist_ok=True)
    results, errors = [], []
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)

            def page_for(context):
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/evidence.html', wait_until='load')
                return page

            for width in [1440, 390]:
                context = browser.new_context(viewport={'width': width, 'height': 1000})
                left, right = page_for(context), page_for(context)
                prepare(left)
                prepare(right)
                hold(left)
                start(left)
                start(right)
                wait_pending(left, 2)
                assert read_ledger(left) is None
                for page in [left, right]:
                    assert page.evaluate('EvidenceApp.snapshot().result') is None
                    expect(page.locator('#downloadReport')).to_be_disabled()
                left.evaluate('window.releaseLedgerLock()')
                snapshots = [finish(left), finish(right)]
                assert sorted(item['result']['priorEvaluations'] for item in snapshots) == [0, 1]
                assert sorted(item['result']['exploratory'] for item in snapshots) == [False, True]
                assert snapshots[0]['result']['after'] == snapshots[1]['result']['after']
                ledger = read_ledger(left)
                assert len(ledger) == 6 and all(value['count'] == 2 for value in ledger.values())
                for page in [left, right]:
                    bundle = page.evaluate('EvidenceApp.bundle()')
                    assert bundle['manufacturingRelease'] is False and bundle['previouslyEvaluated'] is True
                    assert bundle['historyAvailable'] is True
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                right.locator('#resultNotice').scroll_into_view_if_needed()
                right.screenshot(path=str(output / f'shared-holdout-{width}.png'))
                results.append({'width': width, 'same_data_priors': [0, 1], 'ledger_count': 2, 'numeric_results_unchanged': True})
                context.close()

            context = browser.new_context()
            left, right = page_for(context), page_for(context)
            prepare(left, 'har')
            prepare(right, 'cvd')
            hold(left)
            start(left)
            start(right)
            wait_pending(left, 2)
            left.evaluate('window.releaseLedgerLock()')
            assert finish(left)['result']['priorEvaluations'] == 0
            assert finish(right)['result']['priorEvaluations'] == 0
            ledger = read_ledger(left)
            assert len(ledger) == 12 and all(value['count'] == 1 for value in ledger.values())
            for page, kind in [(left, 'har'), (right, 'cvd')]:
                page.reload(wait_until='load')
                prepare(page, kind)
                assert page.evaluate('EvidenceApp.evaluate()')
                assert page.evaluate('EvidenceApp.snapshot().result.exploratory')
            assert all(value['count'] == 2 for value in read_ledger(left).values())
            results.append({'different_datasets_preserved': 12, 'reuse_detected_after_reload': True})
            context.close()

            context = browser.new_context()
            page = page_for(context)
            prepare(page)
            hold(page)
            start(page)
            wait_pending(page, 1)
            assert page.evaluate("EvidenceApp.loadData(EvidenceEngine.demo('cvd'))")
            page.evaluate('window.releaseLedgerLock()')
            snapshot = finish(page, expected=False)
            assert snapshot['dataset']['profile'] == 'cvd' and snapshot['result'] is None
            assert read_ledger(page) is None and snapshot['busy'] is False
            results.append({'superseded_pending_evaluation_cancelled': True})
            context.close()

            for mode in ['missing', 'rejected', 'corrupt', 'quota']:
                context = browser.new_context()
                if mode == 'missing':
                    context.add_init_script("Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});")
                elif mode == 'rejected':
                    context.add_init_script("Object.defineProperty(navigator,'locks',{configurable:true,value:{request:()=>Promise.reject(new Error('test lock rejected'))}});")
                page = page_for(context)
                raw = 'broken original ledger' if mode == 'corrupt' else json.dumps({'data:' + 'a' * 64: {'count': 7, 'at': '2026-09-24T00:00:00.000Z'}})
                page.evaluate('({key,raw})=>localStorage.setItem(key,raw)', {'key': KEY, 'raw': raw})
                if mode == 'quota':
                    page.evaluate('''key=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('test quota','QuotaExceededError');return original.call(this,name,value);};}''', KEY)
                prepare(page)
                reference = page.evaluate('EvidenceEngine.evaluate(EvidenceApp.snapshot().plan)')
                assert page.evaluate('EvidenceApp.evaluate()')
                snapshot, bundle = page.evaluate('EvidenceApp.snapshot()'), page.evaluate('EvidenceApp.bundle()')
                assert snapshot['historyAvailable'] is False and snapshot['result']['exploratory'] is True
                assert snapshot['result']['after'] == reference['after']
                assert snapshot['result']['criteriaMet'] == reference['criteriaMet']
                assert bundle['manufacturingRelease'] is False and bundle['previouslyEvaluated'] is True
                assert page.evaluate('key=>localStorage.getItem(key)', KEY) == raw
                expect(page.locator('#resultNotice')).to_contain_text('이력 확인이 불가능')
                assert '이력 확인이 불가능' in page.evaluate('EvidenceApp.reportHTML()')
                results.append({'mode': mode, 'raw_preserved': True, 'exploratory': True, 'numeric_results_unchanged': True})
                context.close()

            browser.close()
        assert not errors, errors
        report = {'checks': results, 'page_errors': errors}
        (output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
