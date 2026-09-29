"""Real Chrome coverage for the AXIS review room, portable packages and cancellation."""
import json
import sys
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from waitress import create_server

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from server.app import create_app


def snapshot(page):
    return page.evaluate('()=>{const {wafers,active,selected}=FabApp.snapshot();return {wafers,active,selected}}')


def completed(page):
    expect(page.locator('#reviewTitleInput')).to_be_visible(timeout=90000)
    expect(page.locator('#reviewDialog')).not_to_have_attribute('aria-busy','true')
    expect(page.locator('.review-seal strong')).to_have_text('확인 완료')


def upload(page,name,data):
    payload=data if isinstance(data,str) else json.dumps(data,ensure_ascii=False)
    page.locator('#reviewFile').set_input_files({'name':name,'mimeType':'application/json','buffer':payload.encode('utf8')})


def heading_contrast(page):
    values=page.evaluate('''()=>{
      const rgb=value=>(value.match(/[\\d.]+/g)||[]).map(Number);
      const luminance=color=>color.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      return [...document.querySelectorAll('#reviewDialog .review-welcome h3, #reviewDialog .review-welcome h3 em, #reviewDialog .review-entry h4, #reviewDialog .review-section-heading h4, #reviewDialog .review-overline')].map(el=>{
        let parent=el,background=[255,255,255];
        while(parent){const color=rgb(getComputedStyle(parent).backgroundColor);if(color.length===3||color[3]===1){background=color;break}parent=parent.parentElement}
        const foreground=rgb(getComputedStyle(el).color),a=luminance(foreground),b=luminance(background);
        return {heading:el.textContent.trim(),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),color:foreground,background};
      });
    }''')
    assert values and all(value['ratio']>=4.5 for value in values),values
    return values


def main():
    output=ROOT/'.test-tools'/'cmos-review'
    output.mkdir(parents=True,exist_ok=True)
    errors,checks,findings,legibility=[],[],[],[]
    with tempfile.TemporaryDirectory() as temporary:
        server=create_server(create_app(Path(temporary)/'review.sqlite3',testing=True),host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='chrome',headless=True)
                page=browser.new_page(viewport={'width':1600,'height':1200},accept_downloads=True,reduced_motion='reduce')
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(f'http://127.0.0.1:{server.effective_port}/cmos-lab.html',wait_until='networkidle')
                page.evaluate('''()=>{
                  const a=FabEngine.execute(FabEngine.createWafer('REVIEW-A')).wafer;
                  const b=FabEngine.execute(FabEngine.createWafer('REVIEW-B'),{time:240}).wafer;
                  FabApp.importData({schema:'waferflow-fab-history-v1',modelVersion:FabEngine.VERSION,wafers:[{id:'REVIEW-B',title:'현재 작업',records:b.records},{id:'REVIEW-A',title:'기준 작업',records:a.records}]});
                }''')
                page.locator('[data-workspace=analysis]').click()
                page.locator('#tab-compare').click()
                page.locator('#compareSelect').select_option('REVIEW-A')
                initial=snapshot(page)
                page.locator('#openReview').click()
                expect(page.locator('#reviewDialog')).to_be_visible()
                expect(page.locator('[data-review-example]')).to_have_count(3)
                expect(page.locator('#reviewCapture')).to_be_enabled()
                legibility.append({'view':'desktop-home','headings':heading_contrast(page)})
                page.screenshot(path=str(output/'desktop-home.png'))
                page.locator('#reviewCapture').click()
                completed(page)
                expect(page.locator('.review-checkpoint b')).to_have_text('1')
                assert snapshot(page)==initial
                checks.append('Current completed comparison is captured without changing wafers, active wafer or selection')
                page.locator('#reviewHome').click()
                examples=page.evaluate('()=>CmosReviewExamples.list.map(item=>({id:item.id,title:item.title,stepId:item.stepId}))')
                for index,example in enumerate(examples):
                    page.locator(f'[data-review-example="{example["id"]}"]').click()
                    completed(page)
                    expect(page.locator('#reviewTitleInput')).to_have_value(example['title']+' · 조건 비교')
                    expect(page.locator('.review-findings>section').first.locator('tbody tr')).to_have_count(1)
                    assert snapshot(page)==initial
                    if index<len(examples)-1:page.locator('#reviewHome').click()
                checks.append('All three controlled examples calculate and preserve current application records')
                legibility.append({'view':'desktop-study','headings':heading_contrast(page)})
                chart=page.locator('#reviewProfile')
                chart.focus();chart.press('Home')
                expect(page.locator('#reviewProbe')).to_contain_text('X 0.015 µm')
                chart.press('ArrowRight')
                expect(page.locator('#reviewProbe')).to_contain_text('X 0.045 µm')
                chart.press('End')
                expect(page.locator('#reviewProbe')).to_contain_text('X 4.785 µm')
                chart.press('ArrowLeft')
                expect(page.locator('#reviewProbe')).to_contain_text('X 4.755 µm')
                page.locator('[data-review-chart=delta]').click()
                expect(page.locator('[data-review-chart=delta]')).to_have_attribute('aria-pressed','true')
                expect(page.locator('#reviewProfile .review-curve')).to_have_count(1)
                page.locator('[data-review-chart=height]').click()
                expect(page.locator('#reviewProfile .review-curve')).to_have_count(2)
                checks.append('Graph position supports Home/End/arrows and height/delta views')
                title='CMP 시간 변경 · 엔지니어링 검토'
                note='연마 시간이 짧을 때 표면 단차와 잔류 절연막을 함께 검토합니다.\n다음 실험: 동일 입력 상태에서 시간만 변경.'
                page.locator('#reviewTitleInput').fill(title)
                page.locator('#reviewNoteInput').fill(note)
                page.locator('#closeReview').click()
                page.locator('#openReview').click()
                kept=page.locator('#reviewNoteInput').input_value()==note and page.locator('#reviewTitleInput').input_value()==title
                if not kept:findings.append('Closing and reopening the review room discards unsaved title/note edits')
                page.locator('#reviewTitleInput').fill(title)
                page.locator('#reviewNoteInput').fill(note)
                page.locator('#reviewDialog').evaluate('(el)=>el.scrollTop=0')
                page.screenshot(path=str(output/'desktop-study.png'))
                with page.expect_download(timeout=90000) as download:
                    page.locator('#reviewJSON').click()
                package=json.loads(Path(download.value.path()).read_text(encoding='utf8'))
                assert package['payload']['title']==title and package['payload']['note']==note
                assert len(package['integrity']['digest'])==64
                download.value.save_as(output/'review-package.json')
                with page.expect_download(timeout=90000) as download:
                    page.locator('#reviewHTML').click()
                report=Path(download.value.path()).read_text(encoding='utf8')
                assert title in report and note in report
                report_path=output/'review-report.html'
                download.value.save_as(report_path)
                checks.append('JSON and standalone HTML downloads contain edited title and notes')
                page.locator('#reviewHome').click()
                upload(page,'review-package.json',package)
                completed(page)
                expect(page.locator('#reviewTitleInput')).to_have_value(title)
                expect(page.locator('#reviewNoteInput')).to_have_value(note)
                assert snapshot(page)==initial
                checks.append('Downloaded JSON reopens with replay verification and exact notes')
                damaged=json.loads(json.dumps(package));damaged['payload']['note']='changed without checksum'
                upload(page,'damaged-review.json',damaged)
                expect(page.locator('#reviewStatus')).to_have_class('error',timeout=90000)
                expect(page.locator('#reviewStatus')).to_contain_text('확인하지 못했습니다')
                expect(page.locator('#reviewCapture')).to_be_visible()
                assert snapshot(page)==initial
                checks.append('Modified package with stale checksum is rejected without touching application records')

                # Delay only selected file reads; closing/cancelling must invalidate
                # the pending operation even if the OS completes its read afterward.
                page.evaluate('''()=>{
                  const original=File.prototype.text;
                  File.prototype.text=function(){if(this.name.startsWith('pending-'))return new Promise(resolve=>{window.pendingReviewRead=resolve});return original.call(this)};
                }''')
                for action in ['close','cancel']:
                    page.evaluate('()=>window.pendingReviewRead=null')
                    upload(page,'pending-'+action+'.json',package)
                    page.wait_for_function('()=>typeof window.pendingReviewRead==="function"')
                    if action=='close':
                        page.locator('#closeReview').click()
                        expect(page.locator('#reviewDialog')).not_to_be_visible()
                        page.locator('#openReview').click()
                    else:page.locator('#reviewCancel').click()
                    page.evaluate('(text)=>window.pendingReviewRead(text)',json.dumps(package,ensure_ascii=False))
                    page.wait_for_timeout(180)
                    expect(page.locator('#reviewCapture')).to_be_visible()
                    expect(page.locator('#reviewTitleInput')).to_have_count(0)
                    assert snapshot(page)==initial
                checks.append('Closing and cancelling ignore late file-read completion')
                upload(page,'review-restored.json',package)
                completed(page)
                for width in [820,390,360]:
                    page.set_viewport_size({'width':width,'height':1100})
                    page.wait_for_timeout(100)
                    page.locator('#reviewDialog').evaluate('(el)=>el.scrollTop=0')
                    assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1'),width
                    assert page.locator('#reviewDialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),width
                    fonts=page.locator('#reviewProfile svg text').evaluate_all('''elements=>elements.map(el=>{
                      const matrix=el.getScreenCTM();
                      return {label:el.textContent,fontPixels:parseFloat(getComputedStyle(el).fontSize)*Math.hypot(matrix.a,matrix.b)};
                    })''')
                    assert fonts and all(label['fontPixels']>=8 for label in fonts),(width,fonts)
                    legibility.append({'view':f'study-{width}','headings':heading_contrast(page),'svg_fonts':fonts})
                    # Check controls still fit and native modal focus stays contained.
                    page.locator('#reviewProfile').focus()
                    page.keyboard.press('Tab')
                    assert page.evaluate('()=>document.querySelector("#reviewDialog").contains(document.activeElement)')
                    if width==390:
                        page.locator('#reviewDialog').evaluate('(el)=>el.scrollTop=0')
                        page.screenshot(path=str(output/'mobile-study.png'))
                checks.append('Review at 820/390/360px has no document or dialog overflow and keeps keyboard focus inside')
                checks.append('Welcome and section headings meet 4.5:1 contrast; responsive SVG labels render at least 8px')

                # The portable report is a static file: no script, no network fetch,
                # no dependence on the application server or its runtime.
                report_page=browser.new_page(viewport={'width':1280,'height':1100})
                requests=[]
                report_page.on('request',lambda request:requests.append(request.url))
                report_page.goto(report_path.as_uri(),wait_until='load')
                expect(report_page.locator('h1')).to_have_text(title)
                expect(report_page.locator('.note')).to_have_text(note)
                assert report_page.locator('script').count()==0
                assert not [url for url in requests if url.startswith(('http:','https:'))],requests
                report_page.screenshot(path=str(output/'report.png'))
                assert report_page.locator('meta[http-equiv="Content-Security-Policy"]').count()==1
                checks.append('Standalone HTML renders without scripts or external requests')
                malicious='<img src="https://example.invalid/review-probe" onerror="window.reviewInjected=1"><script>window.reviewInjected=1</script> & "quoted"'
                page.locator('#reviewNoteInput').fill(malicious)
                with page.expect_download(timeout=90000) as download:
                    page.locator('#reviewHTML').click()
                escaped_path=output/'review-escaped-note.html'
                download.value.save_as(escaped_path)
                requests.clear()
                report_page.goto(escaped_path.as_uri(),wait_until='load')
                expect(report_page.locator('.note')).to_have_text(malicious)
                assert report_page.locator('script,img').count()==0
                assert report_page.evaluate('()=>typeof window.reviewInjected')=='undefined'
                assert not [url for url in requests if url.startswith(('http:','https:'))],requests
                checks.append('User-supplied HTML in report notes remains inert text without execution or external requests')
                assert snapshot(page)==initial
                browser.close()
        finally:server.close()
    assert not errors,errors
    payload={'checks':checks,'findings':findings,'legibility':legibility,'page_errors':errors}
    (output/'browser-results.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'checks':checks,'findings':findings,'minimum_heading_contrast':min(item['ratio'] for view in legibility for item in view['headings']),'minimum_svg_font_px':min(item['fontPixels'] for view in legibility for item in view.get('svg_fonts',[])),'page_errors':errors},ensure_ascii=False))
    assert not findings,findings


if __name__=='__main__':main()
