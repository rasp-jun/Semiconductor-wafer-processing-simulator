"""Real-browser process studies: input boundaries, exports, races and small screens."""
import argparse
import csv
import functools
import io
import json
import re
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from waitress import create_server
from cmos_process_picker_browser import ROOT, QuietHandler, HIT
from server.app import create_app

OUTPUT = ROOT / '.test-tools' / 'stratum' / 'process-window'


def snapshot(page):
    return page.evaluate('()=>{const {wafers,active,selected}=FabApp.snapshot();return {wafers,active,selected}}')


def idle(page):
    expect(page.locator('#windowDialog')).to_have_attribute('aria-busy', 'false', timeout=90000)


def run(page, count=25):
    page.locator('#windowRun').click()
    idle(page)
    expect(page.locator('#windowStatus')).to_contain_text('계산 완료')
    expect(page.locator('[data-window-row]')).to_have_count(count)


def upload(page, name, data):
    raw = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    page.locator('#windowFile').set_input_files({'name': name, 'mimeType': 'application/json', 'buffer': raw.encode('utf8')})


def assert_width(page, selector):
    measured = page.locator(selector).evaluate('(el)=>({width:el.clientWidth,scroll:el.scrollWidth})')
    assert measured['scroll'] <= measured['width'] + 1, (selector, measured)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public-dir', type=Path)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    prefix = 'public-' if args.public_dir else ''
    checks, errors, assets = [], [], []
    with tempfile.TemporaryDirectory(prefix='stratum-window-') as temporary:
        if args.public_dir:
            server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(args.public_dir.resolve())))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            port = server.server_port
        else:
            server = create_server(create_app(Path(temporary) / 'window.sqlite3', testing=True), host='127.0.0.1', port=0, threads=8)
            threading.Thread(target=server.run, daemon=True).start()
            port = server.effective_port
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                context = browser.new_context(viewport={'width':1440, 'height':1000}, reduced_motion='reduce', accept_downloads=True)
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('response', lambda r: assets.append({'url':r.url,'status':r.status}) if r.status>=400 and '/api/' not in r.url else None)
                page.goto(f'http://127.0.0.1:{port}/cmos-lab.html#window-oxidation', wait_until='networkidle')
                expect(page.locator('#windowDialog')).to_be_visible()
                idle(page)
                initial = snapshot(page)
                for preset in ['oxidation', 'gate-etch', 'cmp']:
                    page.locator(f'[data-window-preset="{preset}"]').click()
                    idle(page)
                    run(page)
                    assert snapshot(page) == initial
                    expect(page.locator('#windowApply')).to_have_count(0)
                checks.append('Three independent presets produce 25 conditions and preserve every live record and draft')

                cells = page.locator('[data-window-row]')
                page.locator('[data-window-row="0"]').focus()
                page.keyboard.press('ArrowUp')
                expect(page.locator('[data-window-row="5"]')).to_be_focused()
                page.keyboard.press('ArrowRight')
                expect(page.locator('[data-window-row="6"]')).to_be_focused()
                page.keyboard.press('Control+Home')
                expect(page.locator('[data-window-row="20"]')).to_be_focused()
                page.keyboard.press('Control+End')
                expect(page.locator('[data-window-row="4"]')).to_be_focused()
                expect(page.locator('[data-window-row][tabindex="0"]')).to_have_count(1)
                page.locator('#windowPin').click()
                page.locator('[data-window-row="0"]').click()
                expect(page.locator('#windowPairTitle')).to_contain_text('R05 → R01')
                expect(page.locator('[data-window-row="4"]')).to_have_class('window-cell is-reference')
                expect(page.locator('[data-window-row="4"]')).to_have_attribute('aria-label',re.compile('비교 기준'))
                expect(page.locator('#windowPair tbody tr')).to_have_count(6)
                page.locator('#windowMetric').select_option('oxideMean')
                expect(page.locator('#windowPairTitle')).to_contain_text('R05 → R01')
                page.locator('#windowMetric').select_option('topography')
                page.locator('#windowClose').click()
                page.locator('#openWindow').click()
                expect(page.locator('#windowPairTitle')).to_contain_text('R05 → R01')
                page.locator('#windowTargetMin').fill('0')
                page.locator('#windowTargetMax').fill('0')
                page.locator('#windowAssess').click()
                expect(page.locator('#windowAssessment')).to_contain_text('목표 범위 안')
                title, note = 'CMP 두 변수 비교', '연마 시간과 압력의 차이를 검토합니다.\n다음 확인 <script>alert(1)</script>'
                page.locator('#windowReportTitle').fill(title)
                page.locator('#windowNote').fill(note)
                page.locator('#windowPairNote').click()
                note = page.locator('#windowNote').input_value()
                assert '고정 R05 → 선택 R01' in note and 'CMP 두 변수 비교' not in note
                page.locator('#windowNote').fill('x'*3000)
                page.locator('#windowPairNote').click()
                expect(page.locator('#windowStatus')).to_contain_text('3,000자 한도')
                expect(page.locator('#windowNote')).to_have_value('x'*3000)
                page.locator('#windowNote').fill(note)
                downloads = {}
                for kind in ['JSON', 'CSV', 'HTML']:
                    with page.expect_download(timeout=90000) as download:
                        page.locator('#window'+kind).click()
                    downloads[kind] = Path(download.value.path()).read_text(encoding='utf8')
                    download.value.save_as(OUTPUT / (prefix+'study.'+kind.lower()))
                package = json.loads(downloads['JSON'])
                pair_rows = package['payload']['result']['rows']
                for metric in package['payload']['result']['metricDefinitions']:
                    a,b = pair_rows[4]['metrics'][metric['id']],pair_rows[0]['metrics'][metric['id']]
                    delta = page.locator(f'[data-pair-metric="{metric["id"]}"] [data-pair-delta]').get_attribute('data-pair-delta')
                    assert delta=='' if a is None or b is None else abs(float(delta)-(b-a))<1e-9
                assert package['payload']['title'] == title and package['payload']['note'] == note
                assert package['payload']['criteria'] == {'metric':'topography','min':0,'max':0}
                csv_text = downloads['CSV']
                assert csv_text.startswith('\ufeff') and not csv_text.startswith('\ufeff\ufeff')
                csv_rows = list(csv.reader(io.StringIO(csv_text.lstrip('\ufeff'))))
                assert len([row for row in csv_rows if row[0].startswith('R') and row[0][1:].isdigit()]) == 25
                assert '<script>alert(1)</script>' not in downloads['HTML'] and '&lt;script&gt;' in downloads['HTML']
                checks.append('Pinned pair survives metric and dialog changes; six numeric deltas and appended comparison notes export correctly; note limit preserves text')
                checks.append('Map keyboard navigation, criteria and actual JSON/CSV/HTML downloads preserve metadata and escape text')

                report = context.new_page()
                report.goto((OUTPUT / (prefix+'study.html')).as_uri())
                report.set_viewport_size({'width':360,'height':800})
                assert_width(report, 'html')
                expect(report.locator('h1')).to_have_text(title)
                report.emulate_media(media='print')
                report.pdf(path=str(OUTPUT / (prefix+'study.pdf')), landscape=True)
                report.close()
                upload(page, 'roundtrip.json', package)
                idle(page)
                expect(page.locator('#windowPair')).to_have_count(0)
                expect(page.locator('#windowStatus')).to_contain_text('전체 계산 일치')
                expect(page.locator('#windowNote')).to_have_value(note)
                expect(page.locator('#windowApply')).to_have_count(0)
                page.locator('#windowResolution').select_option('3')
                expect(page.locator('#windowStale')).to_be_visible()
                run(page, 9)
                expect(page.locator('#windowNote')).to_have_value(note)
                expect(page.locator('#windowReportTitle')).to_have_value(title)
                broken = json.loads(json.dumps(package))
                broken['payload']['note'] = 'tampered'
                upload(page, 'tampered.json', broken)
                idle(page)
                expect(page.locator('#windowStatus')).to_contain_text('체크섬이 일치하지')
                expect(page.locator('#windowNote')).to_have_value(note)
                expect(cells).to_have_count(9)
                assert snapshot(page) == initial
                checks.append('Standalone report prints; package replays; rerun keeps notes; tampered imports preserve previous results')

                # Hold an actual file read, then cancel it, edit, or choose a later file.
                page.evaluate('''()=>{window.originalWindowFileText=File.prototype.text;File.prototype.text=function(){
                  if(this.name==='slow.json')return new Promise(resolve=>{window.releaseWindowRead=()=>originalWindowFileText.call(this).then(resolve)});
                  return originalWindowFileText.call(this);
                }}''')
                upload(page, 'slow.json', package)
                expect(page.locator('#windowNote')).to_be_disabled()
                page.wait_for_function('typeof releaseWindowRead === "function"')
                page.locator('#windowCancel').click()
                page.locator('#windowNote').fill('취소 후 보존할 메모')
                page.evaluate('releaseWindowRead()')
                idle(page)
                expect(page.locator('#windowNote')).to_have_value('취소 후 보존할 메모')
                expect(cells).to_have_count(9)
                upload(page, 'slow.json', broken)
                upload(page, 'latest.json', package)
                idle(page)
                expect(page.locator('#windowStatus')).to_contain_text('전체 계산 일치')
                page.evaluate('releaseWindowRead()')
                expect(page.locator('#windowStatus')).to_contain_text('전체 계산 일치')
                expect(cells).to_have_count(25)
                upload(page, 'slow.json', package)
                page.evaluate('''()=>{const el=document.querySelector('#windowNote');el.value='읽기 중 변경 보존';el.dispatchEvent(new Event('input',{bubbles:true}));}''')
                page.evaluate('releaseWindowRead()')
                idle(page)
                expect(page.locator('#windowNote')).to_have_value('읽기 중 변경 보존')
                upload(page, 'slow.json', package)
                page.locator('#windowClose').click()
                page.locator('#openWindow').click()
                page.evaluate('releaseWindowRead()')
                idle(page)
                expect(page.locator('#windowNote')).to_have_value('읽기 중 변경 보존')
                page.evaluate('()=>{File.prototype.text=originalWindowFileText}')
                checks.append('Cancel, later-file wins, edit during read, and close/reopen all discard stale file completions')

                page.locator('#windowClose').click()
                fixture = page.evaluate('''async()=>{const c=await CmosWindowCore.preparePreset('oxidation');
                  FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:'WINDOW-ACTIVE',title:'작업 중인 산화',records:c.input.records}]});
                  const index=FabEngine.route.find(s=>s.id===c.stepId).index;
                  return {index,stepId:c.stepId,completedIndex:FabEngine.route.findLast(s=>s.index<index&&Object.keys(FabEngine.tools[s.tool].fields).length>=2).index};}''')
                page.locator('#recipe-time').fill('4.4')
                current = snapshot(page)
                page.locator('#openWindow').click()
                page.locator('#windowCapture').click()
                expect(page.locator('#windowContext')).to_contain_text('현재 작업에서')
                run(page, 9)
                assert snapshot(page) == current
                expect(page.locator('#windowApply')).to_be_visible()
                with page.expect_download() as download:
                    page.locator('#windowJSON').click()
                current_package = json.loads(Path(download.value.path()).read_text(encoding='utf8'))
                assert current_package['payload']['result']['baseRecipe']['time'] == 4.4
                page.locator('[data-window-row="8"]').click()
                expected_recipe = current_package['payload']['result']['rows'][8]['recipe']
                page.locator('#windowApply').click()
                expect(page.locator('#windowDialog')).not_to_be_visible()
                after = snapshot(page)
                assert [w['records'] for w in after['wafers']] == [w['records'] for w in current['wafers']]
                active = next(w for w in after['wafers'] if w['id']==after['active'])
                assert active['overrides'][fixture['stepId']] == expected_recipe
                checks.append('Current input uses the edited recipe; applying one row changes only its draft, never completed records')

                page.locator('#openWindow').click()
                page.locator('#windowApply').click()
                expect(page.locator('#windowStatus')).to_contain_text('변경되었습니다')
                page.locator('#windowCapture').click()
                run(page, 9)
                page.locator('#windowClose').click()
                page.locator('#recipe-time').fill('')
                page.locator('#openWindow').click()
                page.locator('#windowApply').click()
                expect(page.locator('#windowStatus')).to_contain_text('변경되었습니다')
                page.locator('#windowCapture').click()
                expect(page.locator('#windowStatus')).to_contain_text('입력하세요')
                expect(page.locator('#recipe-time')).to_have_value('')
                page.locator('#windowClose').click()
                page.locator('#operationSelect').select_option('116')
                future = snapshot(page)
                page.locator('#openWindow').click()
                page.locator('#windowCapture').click()
                expect(page.locator('#windowStatus')).to_contain_text('직전까지의 완료 기록')
                assert snapshot(page) == future
                page.locator('#windowClose').click()
                page.locator('#operationSelect').select_option(str(fixture['index']-1))
                single_variable = snapshot(page)
                page.locator('#openWindow').click()
                page.locator('#windowCapture').click()
                expect(page.locator('#windowStatus')).to_contain_text('두 변수 이상')
                assert snapshot(page) == single_variable
                page.locator('#windowClose').click()
                page.locator('#operationSelect').select_option(str(fixture['completedIndex']))
                completed = snapshot(page)
                page.locator('#openWindow').click()
                page.locator('#windowCapture').click()
                expect(page.locator('#windowContext')).to_contain_text('완료 공정')
                run(page, 9)
                expect(page.locator('#windowApply')).to_have_text('선택 조건으로 새 실험 만들기 ↗')
                assert snapshot(page) == completed
                with page.expect_download() as download:
                    page.locator('#windowJSON').click()
                past = json.loads(Path(download.value.path()).read_text(encoding='utf8'))['payload']['result']
                past_wafer = next(w for w in completed['wafers'] if w['id']==completed['active'])
                assert past['input']['records'] == past_wafer['records'][:fixture['completedIndex']]
                page.locator('[data-window-row="8"]').click()
                page.locator('#windowApply').click()
                expect(page.locator('#windowDialog')).not_to_be_visible()
                branch_state = snapshot(page)
                branch = next(w for w in branch_state['wafers'] if w['id']==branch_state['active'])
                assert branch_state['wafers'][:-1] == completed['wafers']
                assert branch['records'] == past['input']['records']
                assert branch['parent'] == {'id':past_wafer['id'],'from':fixture['completedIndex']}
                assert branch['overrides'][past['stepId']] == past['rows'][8]['recipe']
                assert branch_state['selected'] == fixture['completedIndex']
                expect(page.locator('#operationSelectionStatus')).to_have_attribute('data-state','ready')
                expect(page.locator('#recipeFields input').first).to_be_focused()
                checks.append('Stale source and blank drafts are protected; future and single-variable inputs are rejected; completed input creates a branch without changing any original wafer')

                # Persist the new branch and reload the actual application.
                page.wait_for_function('''()=>{const s=FabApp.snapshot(),stored=JSON.parse(localStorage.getItem('waferflow-fab-'+FabEngine.VERSION));return stored?.active===s.active&&stored.wafers.length===s.wafers.length}''')
                page.goto(f'http://127.0.0.1:{port}/cmos-lab.html',wait_until='networkidle')
                assert snapshot(page) == branch_state
                page.locator('#operationSelect').select_option('0')
                page.locator('#openWindow').click()
                idle(page)
                checks.append('A created branch survives page reload with the exact source, parent, pre-process history and chosen draft')

                page.locator('[data-window-preset="oxidation"]').click()
                idle(page)
                page.locator('#windowRun').evaluate('(el)=>el.click()')
                expect(page.locator('#windowCancel')).to_be_visible()
                page.locator('#windowCancel').evaluate('(el)=>el.click()')
                idle(page)
                expect(page.locator('#windowStatus')).to_contain_text('취소')
                expect(page.locator('#windowResults')).to_be_hidden()
                run(page)
                page.locator('#windowPin').click()
                page.locator('[data-window-row="24"]').click()
                for width, height in [(1440,1000),(820,800),(390,844),(360,640),(390,430)]:
                    page.set_viewport_size({'width':width,'height':height})
                    assert_width(page, '#windowDialog')
                    for selector in ['#windowClose','#windowRun','[data-window-row="0"]','#windowHTML','#windowUnpin','#windowPairNote']:
                        element = page.locator(selector)
                        element.scroll_into_view_if_needed()
                        assert element.evaluate(HIT)['clickable'], (width, height, selector)
                    page.locator('#windowMap').scroll_into_view_if_needed()
                    page.screenshot(path=str(OUTPUT / f'{prefix}map-{width}-{height}.png'))
                    page.locator('#windowPair').scroll_into_view_if_needed()
                    page.screenshot(path=str(OUTPUT / f'{prefix}pair-{width}-{height}.png'))
                page.locator('#windowUnpin').click()
                expect(page.locator('#windowPair')).to_have_count(0)
                expect(page.locator('.window-cell.is-reference')).to_have_count(0)
                page.locator('#windowClose').focus()
                page.keyboard.press('Escape')
                expect(page.locator('#windowDialog')).not_to_be_visible()
                expect(page.locator('#openWindow')).to_be_focused()
                page.set_viewport_size({'width':1440,'height':1000})
                page.locator('#returnToCurrent').click()
                page.locator('#runButton').click()
                page.locator('#openWindow').click()
                expect(page.locator('#runState')).to_have_text('일시정지')
                page.locator('#windowCapture').click()
                expect(page.locator('#windowStatus')).to_contain_text('실행을 완료하거나 취소')
                page.locator('#windowClose').click()
                page.locator('#cancelRunButton').click()
                checks.append('Calculation cancel, five screen sizes, map hit targets, Escape focus and live playback pause')

                history = page.evaluate('FabApp.snapshot()')
                before_read = snapshot(page)
                page.evaluate('''()=>{window.originalWindowFileText=File.prototype.text;File.prototype.text=function(){return new Promise(resolve=>{
                  window.releaseHistoryRead=()=>originalWindowFileText.call(this).then(resolve);
                })}}''')
                page.locator('#importFile').set_input_files({'name':'late-history.json','mimeType':'application/json','buffer':json.dumps(history).encode('utf8')})
                page.locator('#openWindow').click()
                page.locator('#windowClose').click()
                page.evaluate('releaseHistoryRead()')
                expect(page.locator('#toast')).to_contain_text('다른 작업을 시작하여')
                assert snapshot(page) == before_read
                page.evaluate('()=>{File.prototype.text=originalWindowFileText}')
                checks.append('Opening and closing a study invalidates an older pending live-history import')

                page.goto(f'http://127.0.0.1:{port}/briefing.html',wait_until='networkidle')
                for choice, suffix in [('observe','cmos-lab.html'),('data','fab-data.html'),('window','cmos-lab.html#window-oxidation')]:
                    page.locator(f'[data-brief-choice="{choice}"]').click()
                    expect(page.locator('#briefHeroAction')).to_have_attribute('href',suffix)
                    expect(page.locator(f'[data-brief-choice="{choice}"]')).to_have_attribute('aria-pressed','true')
                # A slow new image must not undo a later return to the active choice.
                page.evaluate('''()=>{window.originalDecode=Image.prototype.decode;Image.prototype.decode=function(){return new Promise(resolve=>window.releaseBriefImage=resolve)}}''')
                page.locator('[data-brief-choice="observe"]').click()
                page.locator('[data-brief-choice="window"]').click()
                page.evaluate('()=>{releaseBriefImage();Image.prototype.decode=originalDecode}')
                expect(page.locator('#briefHeroAction')).to_have_attribute('href','cmos-lab.html#window-oxidation')
                for width in [1440,820,390,360]:
                    page.set_viewport_size({'width':width,'height':900})
                    assert_width(page,'html')
                    page.screenshot(path=str(OUTPUT / f'{prefix}briefing-{width}.png'))
                page.locator('#briefHeroAction').click()
                expect(page.locator('#windowDialog')).to_be_visible()
                idle(page)
                expect(page.locator('#windowContext')).to_contain_text('게이트 산화막 성장')
                checks.append('Briefing choices, image-read race, four widths and deep link into the oxidation study')
                assert not errors, errors
                assert not assets, assets
                context.close()
                browser.close()
        finally:
            if args.public_dir:
                server.shutdown(); server.server_close()
            else:
                server.close()
    result = {'checks':checks,'groups':len(checks),'pageErrors':errors,'assetErrors':assets}
    (OUTPUT / (prefix+'results.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'groups':len(checks),'pageErrors':errors,'assetErrors':assets}))


if __name__ == '__main__':
    main()
