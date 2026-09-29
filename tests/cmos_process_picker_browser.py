"""Visible 117-step CMOS picker and reachable route drawer in isolated Chrome."""
import argparse
import functools
import json
import sys
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from waitress import create_server

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.app import create_app

OUTPUT = ROOT / '.test-tools' / 'stratum' / 'process-picker'
DIMENSIONS = [(1440,900),(820,900),(390,844),(360,800)]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


HIT = """el=>{
  const r=el.getBoundingClientRect();let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),p=el.parentElement;
  while(p){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(['auto','scroll','hidden','clip'].includes(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}if(['auto','scroll','hidden','clip'].includes(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}p=p.parentElement}
  const hit=right>left&&bottom>top?document.elementFromPoint((left+right)/2,(top+bottom)/2):null;
  return {height:bottom-top,width:right-left,clickable:!!hit&&el.contains(hit),top,bottom};
}"""

ROUTE_SIZE = """()=>{
  const dialog=document.querySelector('#routeDialog'),box=dialog.open?dialog:document.querySelector('#routeDock'),list=document.querySelector('#routeList'),d=box.getBoundingClientRect(),r=list.getBoundingClientRect();
  return {dialog_height:box.clientHeight,dialog_scroll:box.scrollHeight,list_height:list.clientHeight,list_scroll:list.scrollHeight,list_top:r.top,list_bottom:r.bottom,dialog_top:d.top,dialog_bottom:d.bottom};
}"""

CONTRAST = """selectors=>{
  const parse=s=>{const v=s.match(/[\\d.]+/g)?.map(Number)||[0,0,0,0];return [v[0],v[1],v[2],v[3]??1]},blend=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3]));
  const lum=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  return selectors.filter(selector=>document.querySelector(selector)?.getClientRects().length).map(selector=>{const el=document.querySelector(selector),parents=[];for(let p=el;p;p=p.parentElement)parents.push(p);let bg=[255,255,255];for(const p of parents.reverse())bg=blend(parse(getComputedStyle(p).backgroundColor),bg);const fg=blend(parse(getComputedStyle(el).color),bg),a=lum(fg),b=lum(bg);return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),foreground:fg,background:bg}});
}"""


def unchanged_records(page):
    assert page.evaluate('FabApp.snapshot().wafers.every(w=>w.records.length===0)')


def synced(page, step, route):
    assert page.evaluate('FabApp.snapshot().selected') == step['index']
    expect(page.locator('#operationSelect')).to_have_value(str(step['index']))
    expect(page.locator('#operationName')).to_have_text(step['name'])
    expect(page.locator('#operationId')).to_contain_text(step['id'])
    expect(page.locator(f'#routeList [data-step="{step["index"]}"]')).to_have_attribute('aria-current','step')
    first = next(s['index'] for s in route if s['module']==step['module'])
    expect(page.locator(f'#moduleRail [data-route-jump="{first}"]')).to_have_attribute('aria-current','step')
    unchanged_records(page)


def row_click(page, index):
    row=page.locator(f'#routeList [data-step="{index}"]')
    row.scroll_into_view_if_needed()
    hit=row.evaluate(HIT)
    assert hit['height']>=40 and hit['width']>=150 and hit['clickable'],(index,hit)
    row.click()
    expect(page.locator('#routeDialog')).not_to_be_visible()
    return hit


def docked(page):
    return page.evaluate("document.body.classList.contains('route-docked')")


def open_route(page, opener='#openDetailedRoute'):
    """Show the full route with search and status filter reset (dialog, or the docked tree)."""
    if docked(page):
        page.evaluate("""()=>{const s=document.querySelector('#routeSearch'),f=document.querySelector('#routeFilter');
          s.value='';f.value='all';f.dispatchEvent(new Event('change',{bubbles:true}));s.focus()}""")
        expect(page.locator('#routeDock .route-panel')).to_be_visible()
    else:
        page.locator(opener).click()
        expect(page.locator('#routeDialog')).to_be_visible()


def route_shown(page):
    return docked(page) or page.locator('#routeDialog').is_visible()


def run_control(page, name='run'):
    """The transport bar carries run/cancel below 1100px; the recipe inspector above it."""
    console, inspector = {'run': ('#consoleRun', '#runButton'), 'cancel': ('#consoleCancel', '#cancelRunButton')}[name]
    return page.locator(console) if page.locator(console).is_visible() else page.locator(inspector)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--public-dir',type=Path)
    args=parser.parse_args()
    OUTPUT.mkdir(parents=True,exist_ok=True)
    prefix='public-' if args.public_dir else ''
    errors,failed_assets,checks,responsive=[],[],[],[]
    with tempfile.TemporaryDirectory(prefix='stratum-picker-') as temporary:
        if args.public_dir:
            server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(args.public_dir.resolve())))
            threading.Thread(target=server.serve_forever,daemon=True).start();port=server.server_port
        else:
            server=create_server(create_app(Path(temporary)/'picker.sqlite3',testing=True),host='127.0.0.1',port=0,threads=8)
            threading.Thread(target=server.run,daemon=True).start();port=server.effective_port
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                page=browser.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce')
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('response',lambda response:failed_assets.append({'url':response.url,'status':response.status}) if response.status>=400 and '/api/' not in response.url else None)
                page.goto(f'http://127.0.0.1:{port}/cmos-lab.html',wait_until='networkidle')
                expect(page.locator('#operationSelect')).to_be_visible()
                expect(page.locator('#fabViewport')).to_have_attribute('data-asset-status','ready',timeout=30000)
                route=page.evaluate('FabEngine.route.map(({index,id,name,module})=>({index,id,name,module}))')
                assert len(route)==117
                expect(page.locator('#operationSelect optgroup')).to_have_count(8)
                options=page.locator('#operationSelect option').evaluate_all('(els)=>els.map(e=>({value:e.value,label:e.textContent,group:e.parentElement.label}))')
                assert len(options)==117
                for option,step in zip(options,route):
                    assert option['value']==str(step['index']) and step['id'] in option['label'] and step['name'] in option['label'],(option,step)
                open_route(page)
                last_module=page.locator(f'#routeList [data-module="{route[-1]["module"]}"]')
                last_module.scroll_into_view_if_needed()
                assert last_module.evaluate(HIT)['clickable']
                last_module.click()
                row_click(page,116);synced(page,route[116],route)
                checks.append('Fresh route drawer can scroll to and expand the final module, then select OP117')
                # Every option is selected through the browser's native select;
                # future inspection must never run or commit a process.
                for step in route:
                    page.locator('#operationSelect').select_option(str(step['index']))
                    synced(page,step,route)
                    if step['index']>0:
                        expect(page.locator('#runButton')).to_be_disabled()
                checks.append('All117 native options in8groups select and synchronize without executing')
                print('PASS117 native selections and unchanged records',flush=True)
                # The module shortcut rail is the narrow-screen control; the docked tree's
                # module rows replace it on wide screens.
                if docked(page):
                    expect(page.locator('#moduleRail')).to_be_hidden()
                    page.set_viewport_size({'width':1024,'height':900})
                for module in dict.fromkeys(s['module'] for s in route):
                    step=next(s for s in route if s['module']==module)
                    page.locator(f'#moduleRail [data-route-jump="{step["index"]}"]').click()
                    synced(page,step,route)
                page.set_viewport_size({'width':1440,'height':900})
                checks.append('All8 module-rail choices synchronize the main picker and route')
                page.locator('#operationSelect').focus()
                for key,index in [('Home',0),('ArrowDown',1),('End',116)]:
                    page.keyboard.press(key)
                    synced(page,route[index],route)
                    expect(page.locator('#operationSelect')).to_be_focused()
                checks.append('Native keyboard Home / ArrowDown / End preserves focus and selection')
                contrasts=[]
                for width,height in DIMENSIONS:
                    page.set_viewport_size({'width':width,'height':height})
                    page.locator('#operationSelect').select_option('0')
                    page.evaluate('window.scrollTo(0,0)')
                    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                    picker=page.locator('#operationSelect').bounding_box()
                    assert picker['y']>=0 and picker['y']+picker['height']<=height,(width,picker)
                    page.screenshot(path=str(OUTPUT/f'{prefix}picker-{width}.png'))
                    if width==1440:
                        page.locator('.process-selector').screenshot(path=str(OUTPUT/f'{prefix}selector-control.png'))
                    open_route(page)
                    if not docked(page):
                        expect(page.locator('#routeTitle')).to_be_visible()
                    size=page.evaluate(ROUTE_SIZE)
                    assert size['list_height']>=160 and size['list_bottom']<=size['dialog_bottom']+1,(width,size)
                    assert size['list_scroll']>size['list_height']+300,(width,size)
                    page.screenshot(path=str(OUTPUT/f'{prefix}route-first-{width}.png'))
                    first_hit=row_click(page,0);synced(page,route[0],route)
                    open_route(page,'#openRoute')
                    last=page.locator('#routeList [data-step="116"]')
                    last.scroll_into_view_if_needed()
                    page.screenshot(path=str(OUTPUT/f'{prefix}route-last-{width}.png'))
                    last_hit=row_click(page,116);synced(page,route[116],route)
                    expect(page.locator('#runButton')).to_be_disabled()
                    open_route(page)
                    page.locator('#routeSearch').fill('OP117')
                    expect(page.locator('#routeList [data-step]')).to_have_count(1)
                    last_search=row_click(page,116);synced(page,route[116],route)
                    open_route(page)
                    expect(page.locator('#routeSearch')).to_have_value('')
                    expect(page.locator('#routeList [data-step]')).to_have_count(117)
                    if width==1440:
                        contrasts=page.evaluate(CONTRAST,['#routeTitle','#waferProgress','#routeFilterCount','.route-filter label','.module-number','.module-count','.route-step small','.route-subtitle'])
                        assert all(item['ratio']>=4.5 for item in contrasts),contrasts
                    if not docked(page):
                        page.keyboard.press('Escape')
                        expect(page.locator('#routeDialog')).not_to_be_visible()
                        expect(page.locator('#openDetailedRoute')).to_be_focused()
                    responsive.append({'width':width,'height':height,'route':size,'first':first_hit,'last':last_hit,'last_search':last_search})
                    print('PASS picker / route reachability',width,height,flush=True)
                checks.append('Four viewport sizes: visible picker; first/last route rows scroll and click; exact OP117 search; no overflow')
                checks.append('Opening full route clears stale search; Escape restores correct opener focus')
                page.set_viewport_size({'width':1440,'height':900})
                page.locator('#operationSelect').select_option('0')
                page.locator('#speedSelect').select_option('0.5')
                run_control(page).click()
                expect(page.locator('#runState')).to_have_text('처리 중')
                for paused in [False,True]:
                    expect(page.locator('#operationSelect')).to_be_disabled()
                    assert page.locator('#moduleRail [data-route-jump]:disabled').count()==8
                    expect(page.locator('#previousOperation')).to_be_disabled()
                    expect(page.locator('#nextOperation')).to_be_disabled()
                    open_route(page)
                    assert page.locator('#routeList [data-step]:disabled').count()==117
                    if not docked(page):
                        page.keyboard.press('Escape')
                    assert page.evaluate('FabApp.snapshot().selected')==0
                    unchanged_records(page)
                    if not paused:
                        run_control(page).click()
                        expect(page.locator('#runState')).to_have_text('일시정지')
                run_control(page,'cancel').click()
                expect(page.locator('#operationSelect')).to_be_enabled()
                page.locator('#operationSelect').select_option('116');synced(page,route[116],route)
                checks.append('Running and paused navigation is locked; cancel restores selection without adding records')
                browser.close()
        finally:
            if args.public_dir:server.shutdown();server.server_close()
            else:server.close()
    result={'checks':checks,'options':117,'groups':8,'responsive':responsive,'contrast':contrasts,'page_errors':errors,'failed_assets':failed_assets}
    (OUTPUT/f'{prefix}results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    assert not errors and not failed_assets,(errors,failed_assets)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
