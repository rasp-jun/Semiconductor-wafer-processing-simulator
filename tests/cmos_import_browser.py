"""Exercise delayed CMOS file reads against real browser events and form edits."""
import json
import sys
import tempfile
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright, expect
from waitress import create_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.app import create_app


def main():
    output = ROOT / '.test-tools' / 'cmos-import'
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
                    context = browser.new_context(viewport={'width': width, 'height': 1000})
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))

                    def reset():
                        page.goto(origin + '/cmos-lab.html', wait_until='load')
                        page.evaluate('localStorage.clear()')
                        page.reload(wait_until='load')
                        page.locator('[data-workspace=all]').click()
                        page.evaluate('''() => {
                            window.pendingReads={};
                            File.prototype.text=function(){return new Promise((resolve,reject)=>{
                                window.pendingReads[this.name]={resolve,reject};
                            });};
                        }''')

                    def choose(name):
                        page.locator('#importFile').set_input_files({'name': name, 'mimeType': 'application/json', 'buffer': b'{}'})
                        page.wait_for_function('(name)=>!!window.pendingReads[name]', arg=name)
                        assert page.locator('#importFile').input_value() == ''

                    def release(name, wafer_id, failure=False):
                        page.evaluate('''([name,id,failure])=>{
                            const item=window.pendingReads[name];delete window.pendingReads[name];
                            if(failure)item.reject(new Error('obsolete read failure'));
                            else item.resolve('\uFEFF'+JSON.stringify({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id,records:[]}]}));
                        }''', [name, wafer_id, failure])
                        page.wait_for_function('(name)=>!window.pendingReads[name]', arg=name)

                    reset()
                    choose('old.json')
                    choose('latest.json')
                    release('latest.json', 'LATEST')
                    expect(page.locator('#waferSelect')).to_have_value('LATEST')
                    release('old.json', 'OBSOLETE')
                    assert page.evaluate('FabApp.snapshot().wafers.map(w=>w.id)') == ['W01', 'LATEST']
                    expect(page.locator('#waferSelect')).to_have_value('LATEST')
                    results.append({'width': width, 'latest_selection_and_bom_import': True})

                    reset()
                    choose('draft.json')
                    page.locator('#recipe-time').fill('241')
                    release('draft.json', 'OTHER')
                    expect(page.locator('#recipe-time')).to_have_value('241')
                    expect(page.locator('#waferSelect')).to_have_value('W01')
                    assert len(page.evaluate('FabApp.snapshot().wafers')) == 1
                    assert page.evaluate("FabApp.snapshot().wafers[0].overrides.OP001.time") == 241
                    results.append({'width': width, 'recipe_edit_preserved': True})

                    for value in ['', '99999']:
                        reset()
                        choose('invalid-draft.json')
                        page.locator('#recipe-time').fill(value)
                        release('invalid-draft.json', 'OTHER')
                        expect(page.locator('#recipe-time')).to_have_value(value)
                        expect(page.locator('#waferSelect')).to_have_value('W01')
                    results.append({'width': width, 'invalid_recipe_edits_preserved': True})

                    reset()
                    page.locator('#tab-sweep').click()
                    choose('sweep.json')
                    page.locator('#sweepLow').fill('100')
                    page.locator('#sweepHigh').fill('140')
                    release('sweep.json', 'OTHER')
                    expect(page.locator('#waferSelect')).to_have_value('W01')
                    expect(page.locator('#sweepLow')).to_have_value('100')
                    expect(page.locator('#sweepHigh')).to_have_value('140')
                    results.append({'width': width, 'uncalculated_sweep_bounds_preserved': True})

                    reset()
                    choose('dialog.json')
                    page.locator('#openRoute').click()
                    page.locator('#editExperiment').click()
                    page.locator('#experimentNameInput').fill('원래 웨이퍼의 실험')
                    page.locator('#experimentNoteInput').fill('파일을 기다리는 동안 기록한 관찰')
                    release('dialog.json', 'OTHER')
                    expect(page.locator('#experimentDialog')).to_be_visible()
                    page.locator('#experimentForm button[type=submit]').click()
                    snapshot = page.evaluate('FabApp.snapshot()')
                    assert snapshot['active'] == 'W01' and len(snapshot['wafers']) == 1
                    assert snapshot['wafers'][0]['title'] == '원래 웨이퍼의 실험'
                    assert snapshot['wafers'][0]['note'] == '파일을 기다리는 동안 기록한 관찰'
                    results.append({'width': width, 'experiment_dialog_identity_preserved': True})

                    reset()
                    choose('error.json')
                    choose('success.json')
                    release('success.json', 'LATEST')
                    expect(page.locator('#waferSelect')).to_have_value('LATEST')
                    notice = page.locator('#toast').inner_text()
                    release('error.json', '', True)
                    expect(page.locator('#toast')).to_have_text(notice)
                    assert 'obsolete' not in notice
                    results.append({'width': width, 'obsolete_error_ignored': True})
                    context.close()
                browser.close()
        finally:
            server.close()
    assert not errors, errors
    payload = {'results': results, 'page_errors': errors}
    (output / 'results.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    main()
