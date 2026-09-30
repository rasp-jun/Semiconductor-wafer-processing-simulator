"""Candidate screening through real controls, downloads and verified imports."""
import argparse
import csv
import functools
import io
import json
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from waitress import create_server
from cmos_process_picker_browser import ROOT, QuietHandler, HIT
from cmos_window_browser import snapshot, idle, run, upload, assert_width
from server.app import create_app

OUTPUT = ROOT / '.test-tools' / 'stratum' / 'candidates'


def download(page, kind):
    with page.expect_download(timeout=90000) as pending:
        page.locator('#window' + kind).click()
    return Path(pending.value.path()).read_text(encoding='utf8')


def candidate_ids(page):
    return page.locator('[data-screen-row]').evaluate_all('(els)=>els.map(el=>el.dataset.screenRow)')


def expected_ids(rows, rules):
    selected = [r for r in rows if all(r['metrics'][c['metric']] is not None and
                c['min'] <= r['metrics'][c['metric']] <= c['max'] for c in rules['limits'])
                and not (rules['excludeWarnings'] and r['warnings'])]
    metric = rules['sort']['metric']
    def value(row):
        return row['seconds'] if metric == 'seconds' else row['metrics'][metric]
    present = [r for r in selected if value(r) is not None]
    present.sort(key=value, reverse=rules['sort']['direction'] == 'desc')
    return [r['id'] for r in present + [r for r in selected if value(r) is None]]


def configure(page, rules):
    page.locator('#windowCandidates').evaluate('(el)=>el.open=true')
    page.locator('#windowScreenReset').click()
    for i, limit in enumerate(rules['limits']):
        if i:
            page.locator('#windowScreenAdd').click()
        row = page.locator('[data-screen-limit]').nth(i)
        row.locator('[data-screen-metric]').select_option(limit['metric'])
        row.locator('[data-screen-min]').fill(str(limit['min']))
        row.locator('[data-screen-max]').fill(str(limit['max']))
    page.locator('#windowScreenWarnings').set_checked(rules['excludeWarnings'])
    page.locator('#windowScreenSort').select_option(rules['sort']['metric'])
    page.locator('#windowScreenDirection').select_option(rules['sort']['direction'])
    page.locator('#windowScreenApply').click()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public-dir', type=Path)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    prefix = 'public-' if args.public_dir else ''
    checks, errors, assets, responsive = [], [], [], []
    with tempfile.TemporaryDirectory(prefix='stratum-candidates-') as temporary:
        if args.public_dir:
            server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(args.public_dir.resolve())))
            threading.Thread(target=server.serve_forever, daemon=True).start()
            port = server.server_port
        else:
            server = create_server(create_app(Path(temporary) / 'candidates.sqlite3', testing=True), host='127.0.0.1', port=0, threads=8)
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
                idle(page)
                initial = snapshot(page)
                run(page)
                original = json.loads(download(page, 'JSON'))
                assert original['schema'] == 'stratum-cmos-window-package-v1'
                rows = original['payload']['result']['rows']
                rules = {'limits':[
                    {'metric':'oxideMean','min':rows[12]['metrics']['oxideMean'],'max':rows[24]['metrics']['oxideMean']},
                    {'metric':'topography','min':0,'max':rows[12]['metrics']['topography']}
                ], 'excludeWarnings':False, 'sort':{'metric':'seconds','direction':'asc'}}
                expected = expected_ids(rows, rules)
                assert 0 < len(expected) < 25
                # Filtering should never ask the model to execute a process.
                page.evaluate('()=>{window.screenExecutions=0;window.screenExecute=FabEngine.execute;FabEngine.execute=function(...args){screenExecutions++;return screenExecute.apply(this,args)}}')
                configure(page, rules)
                assert candidate_ids(page) == expected
                expect(page.locator('.window-cell.is-candidate')).to_have_count(len(expected))
                expect(page.locator('#windowTable')).to_contain_text('후보 판정')
                page.locator('[data-screen-row]').first.focus()
                page.keyboard.press('Enter')
                selected_index = next(i for i,r in enumerate(rows) if r['id'] == expected[0])
                expect(page.locator(f'[data-window-row="{selected_index}"]')).to_be_focused()
                page.locator('#windowPin').click()
                page.locator('[data-screen-row]').last.click()
                expect(page.locator('#windowPairTitle')).to_contain_text(expected[0] + ' → ' + expected[-1])
                page.locator('#windowMetric').select_option('polyMean')
                assert candidate_ids(page) == expected
                page.locator('#windowClose').click()
                page.locator('#openWindow').click()
                assert candidate_ids(page) == expected
                assert snapshot(page) == initial
                assert page.evaluate('screenExecutions') == 0
                page.evaluate('()=>{FabEngine.execute=screenExecute}')
                checks.append('AND targets match independent arithmetic; candidate map, keyboard, pinned comparison and reopen work without executing or modifying the wafer')

                page.locator('#windowScreenDirection').select_option('desc')
                expect(page.locator('#windowCandidateCount')).to_have_text('기준 설정')
                expect(page.locator('.window-cell.is-candidate')).to_have_count(0)
                page.locator('#windowScreenApply').click()
                rules['sort']['direction'] = 'desc'
                expected = expected_ids(rows, rules)
                assert candidate_ids(page) == expected
                lower = page.locator('[data-screen-min]').first
                lower.fill('')
                page.locator('#windowScreenApply').click()
                expect(page.locator('#windowScreenStatus')).to_contain_text('모두 입력')
                expect(lower).to_have_value('')
                for _ in range(3):
                    page.locator('#windowScreenAdd').click()
                expect(page.locator('#windowScreenAdd')).to_be_disabled()
                choices = page.locator('[data-screen-metric]').evaluate_all('(els)=>els.map(el=>({value:el.value,disabled:[...el.options].filter(o=>o.disabled).map(o=>o.value)}))')
                assert 'oxideMean' in choices[1]['disabled'], choices
                page.locator('[data-screen-remove]').last.click()
                expect(page.locator('[data-screen-min]').first).to_have_value('')
                no_value = {'limits':[{'metric':'gateCD','min':0,'max':100000}], 'excludeWarnings':False, 'sort':{'metric':'seconds','direction':'asc'}}
                configure(page, no_value)
                expect(page.locator('#windowScreenStatus')).to_contain_text('지표 없음 25')
                expect(page.locator('#windowCandidateList')).to_contain_text('후보가 없습니다')
                checks.append('Changed settings invalidate badges; descending ties, empty input preservation, unique five-metric limit and missing-value exclusion are enforced')

                configure(page, rules)
                exports = {kind:download(page,kind) for kind in ['JSON','CSV','HTML']}
                for kind, content in exports.items():
                    (OUTPUT / (prefix+'candidates.'+kind.lower())).write_text(content,encoding='utf8')
                package = json.loads(exports['JSON'])
                assert package['schema'] == 'stratum-cmos-window-package-v2'
                assert package['payload']['screening'] == rules
                csv_rows = list(csv.reader(io.StringIO(exports['CSV'].lstrip('\ufeff'))))
                header = next(r for r in csv_rows if '후보 선택' in r)
                data = [r for r in csv_rows if r and r[0] in [x['id'] for x in rows]]
                assert len(data) == 25 and all(len(r)==len(header) for r in data)
                rank_column, decision_column = header.index('정렬 순서'), header.index('후보 선택')
                csv_candidates = sorted([r for r in data if r[rank_column]],key=lambda r:int(r[rank_column]))
                assert [r[0] for r in csv_candidates] == expected
                assert all(r[decision_column]=='후보' for r in csv_candidates)
                report = context.new_page()
                report.goto((OUTPUT / (prefix+'candidates.html')).as_uri())
                report.set_viewport_size({'width':360,'height':800})
                assert_width(report,'html')
                expect(report.locator('[aria-label="후보 조건 목록"] tbody tr')).to_have_count(len(expected))
                expect(report.locator('[aria-label="후보 판정 근거"] tbody tr')).to_have_count(25)
                report.emulate_media(media='print')
                report.pdf(path=str(OUTPUT / (prefix+'candidates.pdf')), landscape=True)
                report.close()
                upload(page,'candidates-v2.json',package)
                idle(page)
                assert candidate_ids(page) == expected
                expect(page.locator('#windowScreenDirection')).to_have_value('desc')
                expect(page.locator('[data-screen-metric]').nth(1)).to_have_value('topography')
                broken = json.loads(exports['JSON'])
                broken['payload']['screening']['limits'][0]['min'] += 1
                upload(page,'edited-v2.json',broken)
                idle(page)
                expect(page.locator('#windowStatus')).to_contain_text('체크섬이 일치하지')
                assert candidate_ids(page) == expected
                upload(page,'original-v1.json',original)
                idle(page)
                expect(page.locator('#windowCandidateCount')).to_have_text('기준 설정')
                assert not candidate_ids(page)
                checks.append('Actual v2 JSON/CSV/HTML preserve rules, rank and every decision; standalone report prints, verified v2 restores, tampering preserves state and v1 stays compatible')

                upload(page,'rerun-v2.json',package)
                idle(page)
                page.locator('#windowResolution').select_option('3')
                run(page,9)
                rerun = json.loads(download(page,'JSON'))
                assert rerun['payload']['screening'] == rules
                assert candidate_ids(page) == expected_ids(rerun['payload']['result']['rows'],rules)
                page.locator('[data-window-preset="cmp"]').click()
                idle(page)
                expect(page.locator('#windowCandidateCount')).to_have_text('기준 설정')
                page.locator('#windowResolution').select_option('5')
                run(page)
                cmp_rows = json.loads(download(page,'JSON'))['payload']['result']['rows']
                warnings = sum(bool(r['warnings']) for r in cmp_rows)
                assert warnings > 0
                warning_rules = {'limits':[{'metric':'topography','min':0,'max':100000}], 'excludeWarnings':True, 'sort':{'metric':'oxideMean','direction':'asc'}}
                configure(page,warning_rules)
                assert candidate_ids(page) == expected_ids(cmp_rows,warning_rules)
                expect(page.locator('#windowScreenStatus')).to_contain_text('경고로 제외 ' + str(warnings))
                page.locator('#windowScreenWarnings').uncheck()
                page.locator('#windowScreenApply').click()
                expect(page.locator('[data-screen-row]')).to_have_count(25)
                checks.append('Rerun re-evaluates saved rules for nine rows; new preset resets rules; real CMP warnings can be excluded and metric sorting works')

                page.evaluate('''()=>{window.screenFileText=File.prototype.text;File.prototype.text=function(){
                  if(this.name==='slow-screen.json')return new Promise(resolve=>{window.releaseScreenRead=()=>screenFileText.call(this).then(resolve)});
                  return screenFileText.call(this);
                }}''')
                upload(page,'slow-screen.json',package)
                expect(page.locator('[data-screen-min]').first).to_be_disabled()
                page.wait_for_function('typeof releaseScreenRead==="function"')
                page.locator('[data-screen-min]').first.evaluate("el=>{el.value='17';el.dispatchEvent(new Event('input',{bubbles:true}))}")
                idle(page)
                page.evaluate('releaseScreenRead()')
                page.wait_for_timeout(250)
                expect(page.locator('[data-screen-min]').first).to_have_value('17')
                expect(page.locator('#windowContext')).to_contain_text('ILD 평탄화')
                page.evaluate('()=>{File.prototype.text=screenFileText}')
                checks.append('Editing screening during an older file read cancels its application and preserves the newer input')

                configure(page,{'limits':[{'metric':'topography','min':0,'max':100000},{'metric':'oxideMean','min':0,'max':100000}], 'excludeWarnings':False, 'sort':{'metric':'seconds','direction':'asc'}})
                for width,height in [(1440,1000),(820,900),(390,844),(360,800),(820,430)]:
                    page.set_viewport_size({'width':width,'height':height})
                    for selector in ['html','#windowDialog','.window-screen-body']:
                        assert_width(page,selector)
                    for selector in ['#windowScreenApply','[data-screen-row]:last-child']:
                        element=page.locator(selector)
                        element.scroll_into_view_if_needed()
                        hit=element.evaluate(HIT)
                        assert hit['clickable'] and hit['height']>=30, (width,height,selector,hit)
                    page.locator('#windowCandidates').evaluate("el=>el.scrollIntoView({block:'start'})")
                    page.screenshot(path=str(OUTPUT / f'{prefix}candidates-{width}-{height}.png'))
                    responsive.append({'width':width,'height':height})
                assert snapshot(page) == initial
                checks.append('Four widths and 430px height have reachable controls and final candidate, no outer overflow, and unchanged wafer records and drafts')
                assert not errors, errors
                assert not assets, assets
                context.close()
                browser.close()
        finally:
            if args.public_dir:
                server.shutdown()
                server.server_close()
            else:
                server.close()
    result={'checks':checks,'groups':len(checks),'responsive':responsive,'pageErrors':errors,'assetErrors':assets}
    (OUTPUT / (prefix+'results.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(result,ensure_ascii=False))


if __name__ == '__main__':
    main()
