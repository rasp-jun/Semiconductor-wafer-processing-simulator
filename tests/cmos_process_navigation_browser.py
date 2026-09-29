"""Search, return-to-current and short-screen CMOS navigation in isolated Chrome."""
import argparse
import functools
import json
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from waitress import create_server
from cmos_process_picker_browser import ROOT, QuietHandler, HIT, ROUTE_SIZE, CONTRAST
from server.app import create_app

OUTPUT=ROOT/'.test-tools'/'stratum'/'process-navigation'
SIZES=[(1440,900),(1280,600),(820,600),(390,568),(360,568),(390,430)]


def record_state(page):
    return page.evaluate('()=>FabApp.snapshot().wafers.map(w=>({id:w.id,records:w.records}))')


def assert_records(page, expected):
    assert record_state(page)==expected,'Navigation changed completed scientific records'


def selected(page,index,state=None):
    assert page.evaluate('FabApp.snapshot().selected')==index
    expect(page.locator('#operationSelect')).to_have_value(str(index))
    expect(page.locator('#operationId')).to_contain_text(f'OP{index+1:03}')
    if state:
        expect(page.locator('#operationSelectionStatus')).to_have_attribute('data-state',state)


def search(page,query,expected):
    page.locator('#routeSearch').fill(query)
    actual=page.locator('#routeList [data-step]').evaluate_all('(els)=>els.map(el=>Number(el.dataset.step))')
    assert actual==expected,(query,expected,actual)
    expect(page.locator('#routeFilterCount')).to_have_text(f'{len(expected)} / 117개 표시')


def close_route(page):
    # Native search inputs consume Escape themselves; test modal dismissal with
    # focus on its close button instead of confusing two browser behaviors.
    page.locator('#closeRoute').focus();page.keyboard.press('Escape')
    expect(page.locator('#routeDialog')).not_to_be_visible()


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--public-dir',type=Path);args=parser.parse_args()
    OUTPUT.mkdir(parents=True,exist_ok=True);prefix='public-' if args.public_dir else ''
    errors,assets,checks,searches,sizes=[],[],[],[],[]
    with tempfile.TemporaryDirectory(prefix='stratum-navigation-') as temporary:
        if args.public_dir:
            server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(args.public_dir.resolve())))
            threading.Thread(target=server.serve_forever,daemon=True).start();port=server.server_port
        else:
            server=create_server(create_app(Path(temporary)/'navigation.sqlite3',testing=True),host='127.0.0.1',port=0,threads=8)
            threading.Thread(target=server.run,daemon=True).start();port=server.effective_port
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                page=browser.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce')
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('response',lambda response:assets.append({'url':response.url,'status':response.status}) if response.status>=400 and '/api/' not in response.url else None)
                page.goto(f'http://127.0.0.1:{port}/cmos-lab.html',wait_until='networkidle')
                expect(page.locator('#fabViewport')).to_have_attribute('data-asset-status','ready',timeout=30000)
                expect(page.locator('#operationSelect option')).to_have_count(117)
                expect(page.locator('#operationSelect optgroup')).to_have_count(8)
                original=record_state(page)
                selected(page,0,'ready');expect(page.locator('#returnToCurrent')).not_to_be_visible()
                page.locator('#operationSelect').select_option('116');selected(page,116,'future')
                expect(page.locator('#returnToCurrent')).to_be_visible()
                expect(page.locator('#returnToCurrent')).to_contain_text('OP001')
                page.locator('#returnToCurrent').click();selected(page,0,'ready')
                expect(page.locator('#operationSelect')).to_be_focused()
                assert_records(page,original)
                checks.append('Future preview returns to the real cursor with focus and preserved records')

                page.locator('#openDetailedRoute').click()
                cases=[('1',[0]),('7',[6]),('117',[116]),('OP117',[116]),('OP 117',[116]),('op7',[6]),('OP 7',[6]),('OP-7',[6]),('OP007',[6]),('  Op   117  ',[116]),('ＯＰ １１７',[116]),('０７',[6]),('0',[]),('118',[]),('OP0',[]),('OP118',[]),('STI etch',[20,27]),('etch STI',[20,27]),('STI   ETCH',[20,27]),('OP 21 STI etch',[20]),('OP117 etch',[])]
                for query,expected in cases:
                    search(page,query,expected);searches.append({'query':query,'matches':expected})
                search(page,'   ',list(range(117)))
                assert_records(page,original)
                checks.append('21 numeric / normalized / AND search cases; whitespace restores all117')

                search(page,'STI etch',[20,27])
                page.keyboard.press('Enter');expect(page.locator('#routeDialog')).to_be_visible();selected(page,0)
                page.keyboard.press('ArrowDown');expect(page.locator('#routeList [data-step="20"]')).to_be_focused()
                page.keyboard.press('Enter');expect(page.locator('#routeDialog')).not_to_be_visible();selected(page,20,'future')
                page.locator('#openDetailedRoute').click();search(page,'OP 117',[116])
                page.locator('#routeSearch').evaluate('(el)=>el.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true,isComposing:true}))')
                expect(page.locator('#routeDialog')).to_be_visible();selected(page,20)
                page.keyboard.press('Enter');expect(page.locator('#routeDialog')).not_to_be_visible();selected(page,116,'future')
                assert_records(page,original)
                checks.append('Multiple results stay open; ArrowDown reaches first row; unique Enter selects; composing Enter ignored')

                # Use actual engine output for nonempty and complete histories;
                # navigation must preserve every record, not just its count.
                fixtures=page.evaluate('''()=>{let wafer=FabEngine.createWafer('NAV-REFERENCE');while(wafer.cursor<117)wafer=FabEngine.execute(wafer).wafer;return {modelVersion:FabEngine.VERSION,records:wafer.records}}''')
                page.evaluate('data=>FabApp.importData({schema:"waferflow-fab-history-v1",modelVersion:data.modelVersion,wafers:[{id:"NAV3",records:data.records.slice(0,3)}]})',fixtures)
                baseline=record_state(page);selected(page,3,'ready')
                page.locator('#operationSelect').select_option('1');selected(page,1,'done')
                expect(page.locator('#returnToCurrent')).to_contain_text('OP004')
                expect(page.locator('#previousOperation')).to_have_attribute('aria-label','이전 공정: OP001 · 입고 웨이퍼 세정')
                expect(page.locator('#nextOperation')).to_have_attribute('aria-label','다음 공정: OP003 · N-WELL · 소프트베이크')
                page.locator('#returnToCurrent').click();selected(page,3,'ready')
                page.locator('#operationSelect').select_option('116');selected(page,116,'future')
                page.locator('#returnToCurrent').click();selected(page,3,'ready')
                assert_records(page,baseline)
                checks.append('Three committed processes distinguish done / ready / future and return exactly to OP004')

                page.locator('#openDetailedRoute').click()
                page.locator('#routeFilter').select_option('done');search(page,'OP002',[1])
                page.locator('#clearRouteSearch').click()
                expect(page.locator('#routeSearch')).to_be_focused();expect(page.locator('#routeSearch')).to_have_value('')
                expect(page.locator('#routeFilter')).to_have_value('done');expect(page.locator('#routeList [data-step]')).to_have_count(3)
                expect(page.locator('#clearRouteSearch')).not_to_be_visible()
                search(page,'OP117',[]);page.locator('[data-reset-route]').click()
                expect(page.locator('#routeSearch')).to_be_focused();expect(page.locator('#routeFilter')).to_have_value('all')
                expect(page.locator('#routeList [data-step]')).to_have_count(117)
                page.locator('#routeFilter').select_option('pending');search(page,'OP117',[116])
                page.locator('#resetRouteFilters').click()
                expect(page.locator('#routeSearch')).to_be_focused();expect(page.locator('#routeFilter')).to_have_value('all')
                expect(page.locator('#resetRouteFilters')).not_to_be_visible()
                search(page,'ZZZ nonexistent',[])
                page.locator('.route-no-results').screenshot(path=str(OUTPUT/f'{prefix}empty-results.png'))
                page.locator('[data-reset-route]').click();assert_records(page,baseline)
                close_route(page)
                checks.append('Clear preserves state filter; empty and toolbar reset clear both; all restore search focus')

                for width,height in SIZES:
                    page.set_viewport_size({'width':width,'height':height});page.locator('#openDetailedRoute').click()
                    page.locator('#routeSearch').fill('OP')
                    expect(page.locator('#routeList [data-step]')).to_have_count(117)
                    layout=page.evaluate(ROUTE_SIZE)
                    assert layout['list_height'] >= (110 if height<500 else 160),(width,height,layout)
                    assert layout['list_bottom']<=layout['dialog_bottom']+1,(width,height,layout)
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    hits=[]
                    for index in [0,116]:
                        row=page.locator(f'#routeList [data-step="{index}"]');row.scroll_into_view_if_needed();hit=row.evaluate(HIT)
                        assert hit['clickable'] and hit['height']>=40,(width,height,index,hit);hits.append(hit)
                    page.screenshot(path=str(OUTPUT/f'{prefix}route-{width}x{height}.png'))
                    # Search itself and its explicit clear action remain usable
                    # while the visual viewport is short.
                    page.locator('#routeSearch').fill('117');page.locator('#clearRouteSearch').click()
                    expect(page.locator('#routeSearch')).to_be_focused()
                    close_route(page);assert_records(page,baseline)
                    sizes.append({'width':width,'height':height,'route':layout,'hits':hits})
                checks.append('Six sizes including430/568/600px height retain readable, reachable first/last rows and search controls')
                print('PASS search, committed history, reset focus and six screen sizes',flush=True)

                page.set_viewport_size({'width':1440,'height':900})
                page.locator('#speedSelect').select_option('0.5');page.locator('#consoleRun').click()
                for paused in [False,True]:
                    selected(page,3,'running');expect(page.locator('#operationSelect')).to_be_disabled()
                    expect(page.locator('#returnToCurrent')).to_be_disabled()
                    page.locator('#openDetailedRoute').click();search(page,'OP117',[116])
                    expect(page.locator('#routeList [data-step="116"]')).to_be_disabled()
                    page.keyboard.press('Enter');expect(page.locator('#routeDialog')).to_be_visible();selected(page,3)
                    page.locator('#clearRouteSearch').click()
                    assert page.locator('#routeList [data-step]:disabled').count()==117
                    page.locator('#routeFilter').select_option('done');page.locator('#resetRouteFilters').click()
                    assert page.locator('#routeList [data-step]:disabled').count()==117
                    search(page,'not a process',[]);page.locator('[data-reset-route]').click()
                    assert page.locator('#routeList [data-step]:disabled').count()==117
                    close_route(page);assert_records(page,baseline)
                    if not paused:
                        page.locator('#consoleRun').click();expect(page.locator('#runState')).to_have_text('일시정지')
                page.locator('#consoleCancel').click();selected(page,3,'ready');assert_records(page,baseline)
                checks.append('Search and all reset paths keep rows disabled during running and pause; Enter cannot switch; cancellation preserves history')

                page.evaluate('data=>FabApp.importData({schema:"waferflow-fab-history-v1",modelVersion:data.modelVersion,wafers:[{id:"NAV117",records:data.records}]})',fixtures)
                complete=record_state(page);selected(page,116,'done')
                expect(page.locator('#returnToCurrent')).not_to_be_visible()
                expect(page.locator('#operationSelectionHint')).to_contain_text('117개 공정 완료')
                page.locator('#operationSelect').select_option('0');selected(page,0,'done')
                expect(page.locator('#returnToCurrent')).not_to_be_visible()
                page.locator('#openDetailedRoute').click();expect(page.locator('#jumpCurrent')).to_contain_text('전체 공정 완료')
                page.locator('#jumpCurrent').click();selected(page,116,'done');close_route(page)
                assert_records(page,complete)
                checks.append('A complete117-step wafer has no nonexistent next step; last-record navigation remains correct')
                page.locator('#operationSelect').select_option('1')
                page.locator('.process-selector').screenshot(path=str(OUTPUT/f'{prefix}completed-selector.png'))
                contrasts=page.evaluate(CONTRAST,['#operationSelectionStatus','#operationSelectionHint'])
                assert all(item['ratio']>=4.5 for item in contrasts),contrasts
                browser.close()
        finally:
            if args.public_dir:server.shutdown();server.server_close()
            else:server.close()
    result={'checks':checks,'searches':searches,'sizes':sizes,'contrast':contrasts,'page_errors':errors,'failed_assets':assets}
    (OUTPUT/f'{prefix}results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    assert not errors and not assets,(errors,assets)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
