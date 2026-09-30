"""STRATUM responsive navigation and CMOS operation UI, in isolated real Chrome.

Uses an owned temporary database by default. --public-dir serves a built static
artifact; neither mode reads a user's browser profile or production database.
"""
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

OUTPUT = ROOT / '.test-tools' / 'stratum'
WIDTHS = [1440, 820, 390, 360]
PAGES = [name for name in json.loads((ROOT / 'server' / 'public-assets.json').read_text(encoding='utf-8'))
         if name.endswith('.html') and '/' not in name]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


LAYOUT = """() => {
  const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  const outside = [...document.querySelectorAll('body *')].flatMap(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (!rect.width || !rect.height || style.position === 'fixed' || rect.right <= innerWidth + 1 || rect.left < -1) return [];
    let p = el.parentElement;
    while (p && p !== document.body) {
      if (['auto','scroll','hidden','clip'].includes(getComputedStyle(p).overflowX)) return [];
      p = p.parentElement;
    }
    return [{element: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + [...el.classList].slice(0,2).join('.')), right: Math.round(rect.right)}];
  }).slice(0,12);
  return {width:innerWidth, document_width:document.documentElement.scrollWidth,
    duplicates, outside, title:document.title,
    broken_images:[...document.images].filter(i => !i.closest('dialog:not([open])') && i.complete && !i.naturalWidth).map(i => i.getAttribute('src'))};
}"""


def inspect_layout(page, route, width, problems):
    result = page.evaluate(LAYOUT)
    for key, broken in [('overflow', result['document_width'] > width + 1),
                        ('duplicate_ids', bool(result['duplicates'])),
                        ('broken_images', bool(result['broken_images']))]:
        if broken:
            problems.append({'page': route, 'width': width, 'problem': key, 'detail': result})
    return result


def check_navigation(page, route, width, prefix):
    switcher = page.locator('details.stratum-switcher:visible')
    expect(switcher).to_have_count(1)
    summary = switcher.locator('summary')
    summary.focus()
    page.keyboard.press('Enter')
    expect(switcher).to_have_attribute('open', '')
    links = switcher.locator('a[href]')
    expect(links).to_have_count(10)
    for link in links.all():
        expect(link).to_be_visible()
        link.scroll_into_view_if_needed()
        reachable = link.evaluate('''el=>{
          const r=el.getBoundingClientRect();let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom),p=el.parentElement;
          while(p){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(['auto','scroll','hidden','clip'].includes(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}if(['auto','scroll','hidden','clip'].includes(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}p=p.parentElement}
          const hit=right>left&&bottom>top?document.elementFromPoint((left+right)/2,(top+bottom)/2):null;
          return {name:el.textContent,height:bottom-top,width:right-left,clickable:!!hit&&el.contains(hit)};
        }''')
        assert reachable['height'] >= 38 and reachable['width'] >= 100 and reachable['clickable'], reachable
    links.first.scroll_into_view_if_needed()
    page.keyboard.press('Tab')
    assert links.evaluate_all('(els)=>els.some(el=>el===document.activeElement)'), 'Keyboard cannot enter workspace links'
    page.keyboard.press('Escape')
    expect(switcher).not_to_have_attribute('open', '')
    expect(summary).to_be_focused()
    summary.click()
    bounds = switcher.evaluate('(el)=>{const panel=el.querySelector("nav")||el.lastElementChild;const r=panel.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth}}')
    assert bounds['left'] >= -1 and bounds['right'] <= bounds['width'] + 1, bounds
    if route == 'cmos-lab.html' and width in [1440,390]:
        switcher.locator('.stratum-space-panel').screenshot(path=str(OUTPUT/f'{prefix}cmos-workspace-menu-{width}.png'))
    summary.click()
    return {'keyboard_open_close': True, 'workspace_links': links.count()}


def check_cmos(page, problems, output, prefix):
    expect(page.locator('#fabViewport')).to_have_attribute('data-asset-status', 'ready', timeout=30000)
    assert page.locator('[data-step]').count() == 117
    page.locator('#openRoute').click()
    expect(page.locator('#routeDialog')).to_be_visible()
    page.locator('#routeSearch').fill('PR')
    assert page.locator('#routeList [data-step]:visible').count() > 0
    # Native search fields consume Escape to clear their text in Chrome.
    page.locator('#closeRoute').focus()
    page.keyboard.press('Escape')
    expect(page.locator('#routeDialog')).not_to_be_visible()
    expect(page.locator('#openRoute')).to_be_focused()
    for workspace, target in [('wafer','#waferSection'),('analysis','#processResults'),('equipment','#processWorkspace')]:
        page.locator(f'[data-workspace="{workspace}"]').click()
        expect(page.locator('body')).to_have_attribute('data-console-view', workspace)
        expect(page.locator(target)).to_be_visible()
        if workspace in ['wafer', 'analysis']:
            for width in [1440,390]:
                page.set_viewport_size({'width':width,'height':1000})
                page.locator(target).scroll_into_view_if_needed()
                page.wait_for_timeout(100)
                inspect_layout(page,f'cmos-lab.html:{workspace}',width,problems)
                page.screenshot(path=str(output/f'{prefix}cmos-{workspace}-{width}.png'),full_page=True)
            page.set_viewport_size({'width':1440,'height':1000})
    page.locator('#focusStage').click()
    expect(page.locator('#focusStage')).to_have_attribute('aria-pressed','true')
    page.keyboard.press('Escape')
    expect(page.locator('#focusStage')).to_have_attribute('aria-pressed','false')
    expect(page.locator('#focusStage')).to_be_focused()
    for opener, dialog in [('#equipmentHelpButton','#equipmentDialog'),('#openEquipmentAtlas','#equipmentAtlasDialog'),('#openReview','#reviewDialog')]:
        page.locator(opener).click()
        expect(page.locator(dialog)).to_be_visible()
        if dialog in ['#equipmentAtlasDialog','#reviewDialog']:
            for width in [1440,390]:
                page.set_viewport_size({'width':width,'height':1000})
                page.wait_for_timeout(120)
                if dialog == '#equipmentAtlasDialog':
                    page.wait_for_function('()=>[...document.querySelectorAll("#atlasGrid img")].filter(img=>{const r=img.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).every(img=>img.complete&&img.naturalWidth>0)')
                page.screenshot(path=str(output/f'{prefix}cmos-{dialog[1:]}-{width}.png'))
        page.keyboard.press('Escape')
        expect(page.locator(dialog)).not_to_be_visible()
        expect(page.locator(opener)).to_be_focused()
        page.set_viewport_size({'width':1440,'height':1000})
    canvas = page.locator('#fabViewport canvas').first
    canvas.focus()
    for key, camera in [('1','equipment'),('2','chamber'),('3','wafer'),('4','top')]:
        page.keyboard.press(key)
        expect(page.locator(f'[data-camera="{camera}"]')).to_have_attribute('aria-pressed','true')
        expect(page.locator('[data-camera][aria-pressed="true"]')).to_have_count(1)
    page.locator('#cutaway').uncheck()
    expect(page.locator('[data-camera="equipment"]')).to_have_attribute('aria-pressed','true')
    records = page.evaluate('FabApp.snapshot().wafers[0].records.length')
    canvas.focus()
    page.keyboard.down('Space')
    expect(page.locator('#runState')).to_have_text('처리 중')
    page.keyboard.down('Space')
    expect(page.locator('#runState')).to_have_text('처리 중')
    page.keyboard.up('Space')
    page.keyboard.press('Space')
    expect(page.locator('#runState')).to_have_text('일시정지')
    expect(page.locator('#cutaway')).not_to_be_checked()
    page.locator('#observationSeek').evaluate('(el)=>{el.value=55;el.dispatchEvent(new Event("input",{bubbles:true}))}')
    page.wait_for_timeout(100)
    expect(page.locator('#fabViewport')).to_have_attribute('data-equipment-view','exterior')
    assert page.evaluate('FabApp.viewport.scene.getObjectByName("exterior-active-wafer").visible')
    assert page.evaluate('FabApp.snapshot().wafers[0].records.length') == records
    for width in WIDTHS:
        page.set_viewport_size({'width':width,'height':1000})
        page.wait_for_timeout(120)
        inspect_layout(page, 'cmos-lab.html:paused-exterior', width, problems)
        page.locator('.equipment-panel').screenshot(path=str(output/f'{prefix}cmos-operation-{width}.png'))
    page.set_viewport_size({'width':1440,'height':1000})
    page.evaluate('window.scrollTo(0,0)')
    page.screenshot(path=str(output/'hero-cmos-operation.png'))
    page.locator('#cutaway').check()
    page.locator('#consoleRun').click()
    expect(page.locator('#cutaway')).to_be_checked()
    page.locator('#consoleRun').click()
    page.locator('#cutaway').uncheck()
    page.locator('#consoleRun').click()
    expect(page.locator('#cutaway')).not_to_be_checked()
    page.locator('#consoleRun').click()
    page.locator('#consoleCancel').click()
    assert page.evaluate('FabApp.snapshot().wafers[0].records.length') == records
    return ['Route filtering and Escape focus restoration', 'Material / analysis / equipment workspaces',
            'Focus mode and modal keyboard recovery', 'Exterior wafer visible while paused',
            'Canvas Space run / pause; held key does not repeat', 'Camera 1–4 synchronize aria-pressed; exterior reset selects whole equipment',
            'Start / resume preserve internal and exterior selection', 'Cancelled observation preserves completed records']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public-dir', type=Path)
    parser.add_argument('--baseline', action='store_true', help='Record pre-redesign layout without STRATUM requirements')
    parser.add_argument('--pages', nargs='+', choices=PAGES, help='Limit a follow-up check to affected pages')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    prefix = 'baseline-' if args.baseline else 'public-' if args.public_dir else ''
    problems, errors, asset_failures, results, interactions = [], [], [], [], []
    with tempfile.TemporaryDirectory(prefix='stratum-ui-') as temporary:
        if args.public_dir:
            directory = args.public_dir.resolve()
            assert directory.is_dir(), directory
            server = ThreadingHTTPServer(('127.0.0.1',0), functools.partial(QuietHandler,directory=str(directory)))
            threading.Thread(target=server.serve_forever,daemon=True).start()
            origin = f'http://127.0.0.1:{server.server_port}'
        else:
            server = create_server(create_app(Path(temporary)/'ui.sqlite3',testing=True),host='127.0.0.1',port=0,threads=8)
            threading.Thread(target=server.run,daemon=True).start()
            origin = f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome',headless=True)
                for route in args.pages or PAGES:
                    context = browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
                    page = context.new_page()
                    page.on('pageerror', lambda error, route=route:errors.append({'page':route,'error':str(error)}))
                    page.on('response',lambda response,route=route:asset_failures.append({'page':route,'url':response.url,'status':response.status}) if response.status>=400 and '/api/' not in response.url else None)
                    try:
                        response = page.goto(origin+'/'+route,wait_until='networkidle')
                        assert response.status==200,(route,response.status)
                        if route=='cmos-lab.html':
                            expect(page.locator('#fabViewport')).to_have_attribute('data-asset-status','ready',timeout=30000)
                        if not args.baseline:
                            assert 'STRATUM' in page.title(),page.title()
                            expect(page.locator('.stratum-brand:visible').first).to_be_visible()
                            assert 'STRATUM' in page.locator('.stratum-brand:visible').first.inner_text()
                        dimensions=[]
                        for width in WIDTHS:
                            page.set_viewport_size({'width':width,'height':1000})
                            page.wait_for_timeout(120)
                            dimensions.append(inspect_layout(page,route,width,problems))
                            if not args.baseline:
                                interactions.append({'page':route,'width':width,**check_navigation(page,route,width,prefix)})
                            if width in [1440,390]:
                                page.screenshot(path=str(OUTPUT/f'{prefix}{Path(route).stem}-{width}.png'),full_page=True)
                                if route == 'cmos-lab.html' and width == 1440:
                                    page.screenshot(path=str(OUTPUT/'hero-cmos.png'))
                        results.append({'page':route,'dimensions':dimensions})
                        if route=='cmos-lab.html' and not args.baseline:
                            page.set_viewport_size({'width':1440,'height':1000})
                            interactions.append({'page':route,'checks':check_cmos(page,problems,OUTPUT,prefix)})
                        print('CHECKED',route,flush=True)
                    except Exception as error:
                        problems.append({'page':route,'width':page.viewport_size['width'],'problem':'interaction_or_load','detail':str(error)})
                        page.screenshot(path=str(OUTPUT/f'{prefix}{Path(route).stem}-failure.png'),full_page=True)
                        print('FAILED',route,str(error),flush=True)
                    finally:
                        context.close()
                browser.close()
        finally:
            if args.public_dir:
                server.shutdown();server.server_close()
            else:
                server.close()
    result={'mode':prefix or 'local','widths':WIDTHS,'pages':results,'interactions':interactions,
            'problems':problems,'page_errors':errors,'failed_assets':asset_failures}
    report_name = f'{prefix}{"targeted-" if args.pages else ""}ui-results.json'
    (OUTPUT/report_name).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'pages':len(results),'responsive_cases':sum(len(r['dimensions']) for r in results),
                      'problems':problems,'page_errors':errors,'failed_assets':asset_failures},ensure_ascii=False,indent=2))
    return 1 if problems or errors or asset_failures else 0


if __name__=='__main__':
    raise SystemExit(main())
