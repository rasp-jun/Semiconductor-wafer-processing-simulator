"""End-to-end shadow review, stale-result reset and integrity verification."""
import functools,json,sys,threading,csv,io,hashlib
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
server=None
if len(sys.argv)>1:origin=sys.argv[1].rstrip('/')
else:
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(SimpleHTTPRequestHandler,directory=str(ROOT/'.test-tools/site-source/dist')))
    threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        for width in [1440,390]:
            page=browser.new_page(viewport={'width':width,'height':1000},accept_downloads=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(origin+'/fab-pilot.html');page.locator('#pilotDemo').click();assert page.locator('#pilotRun').is_disabled()
            page.locator('#pilotDeclaration').check();page.locator('#pilotRun').click();page.wait_for_selector('#pilotResults:visible')
            assert '검증 이탈 1건' in page.locator('#pilotSpcInfo').inner_text();assert page.locator('#pilotRunTable tbody tr').count()==32
            assert page.locator('#pilotCompareInputs tbody tr').count()==2
            assert page.locator('#pilotCompareChart path').count()==2
            with page.expect_download() as comparison_info:page.locator('#pilotCompareExport').click()
            comparison=json.loads(Path(comparison_info.value.path()).read_text(encoding='utf-8'))
            assert comparison['leftRunId']=='DEMO-001' and comparison['rightRunId']=='DEMO-032'
            assert comparison['predicted']['delta']==0 and comparison['measured']['delta']!=0
            page.locator('#pilotCompareRight').select_option('1');assert page.locator('#pilotCompareExport').is_disabled()
            assert page.locator('#pilotCompareChart path').count()==0
            page.locator('#pilotCompareRight').select_option('32');assert not page.locator('#pilotCompareExport').is_disabled()
            page.locator('#pilotFilter').select_option('alarm');assert page.locator('#pilotRunTable tbody tr').count()==1
            with page.expect_download() as csv_info:page.locator('#pilotCsv').click()
            visible=list(csv.DictReader(io.StringIO(Path(csv_info.value.path()).read_text(encoding='utf-8-sig'))))
            assert len(visible)==1 and visible[0]['run_id']=='DEMO-032'
            assert '내려받지 않은' in page.locator('#pilotSaveState').inner_text()
            assert not page.evaluate("window.dispatchEvent(new Event('beforeunload',{cancelable:true}))")
            page.locator('#pilotSearch').fill('not-found');assert page.locator('#pilotRunTable tbody tr').count()==0
            page.locator('#pilotSearch').fill('');page.locator('#pilotFilter').select_option('all')
            page.locator('#pilotDetailRun').select_option('32');page.locator('#pilotCaseState').select_option('resolved');page.locator('#pilotCaseSave').click()
            assert '담당자와 조치 내용' in page.locator('#pilotCaseMessage').inner_text()
            page.locator('#pilotDetailRun').select_option('1');assert page.locator('#pilotDetailRun').input_value()=='32'
            page.locator('#pilotExport').click();assert '반영하지 않은' in page.locator('#pilotStatus').inner_text()
            page.locator('#pilotCaseOwner').fill('검토 담당');page.locator('#pilotCaseAction').fill('계측 재확인 요청');page.locator('#pilotCaseSave').click()
            assert '검증 이탈 1건' in page.locator('#pilotSpcInfo').inner_text()
            page.locator('#pilotNotes').fill('현장 계측 재확인 필요')
            with page.expect_download() as info:page.locator('#pilotExport').click()
            assert '다운로드를 요청' in page.locator('#pilotSaveState').inner_text()
            assert page.evaluate("window.dispatchEvent(new Event('beforeunload',{cancelable:true}))")
            data=json.loads(Path(info.value.path()).read_text(encoding='utf-8'));assert data['report']['counts']['paired']==32;assert data['report']['productionAuthorized'] is False
            assert data['caseNotes'][0]['rowIndex']==32 and data['caseNotes'][0]['status']=='resolved'
            data['report']['counts']['paired']=999
            data['sourceFiles']=[{'kind':'profile','name':'<profile>.json','sha256':'a'*64,'hashKind':'original-file-bytes','verification':'current-file-bytes'},{'kind':'batch','name':'원본 로그.json','sha256':'b'*64,'hashKind':'original-file-bytes','verification':'current-file-bytes'}]
            restored_bytes=json.dumps(data).encode()
            page.locator('#pilotBatchFile').set_input_files({'name':'restored.json','mimeType':'application/json','buffer':restored_bytes})
            page.wait_for_function("!document.getElementById('pilotBatchFile').disabled");assert page.locator('#pilotResults').is_hidden()
            page.locator('#pilotRun').click();page.wait_for_selector('#pilotResults:visible');assert page.locator('#pilotRunTable tbody tr').count()==32
            page.locator('#pilotDetailRun').select_option('32');assert page.locator('#pilotCaseOwner').input_value()=='검토 담당'
            assert page.locator('#pilotNotes').input_value()=='현장 계측 재확인 필요'
            with page.expect_download() as restored_info:page.locator('#pilotExport').click()
            restored=json.loads(Path(restored_info.value.path()).read_text(encoding='utf-8'))
            assert restored['report']['counts']['paired']==32 and restored['report']['productionAuthorized'] is False
            assert restored['sourceFiles'][:2]==[{**source,'verification':'imported-declaration'} for source in data['sourceFiles']]
            assert restored['sourceFiles'][2]=={'kind':'package','name':'restored.json','sha256':hashlib.sha256(restored_bytes).hexdigest(),'hashKind':'original-file-bytes','verification':'current-file-bytes'}
            assert restored['caseNotes'][0]['action']=='계측 재확인 요청'
            with page.expect_download() as inputs_info:page.locator('#pilotInputs').click()
            inputs=json.loads(Path(inputs_info.value.path()).read_text(encoding='utf-8'))
            assert inputs['sourceFiles']==restored['sourceFiles']
            without_actions={k:v for k,v in restored.items() if k not in ('caseNotes','notes')}
            page.locator('#pilotBatchFile').set_input_files({'name':'input-only.json','mimeType':'application/json','buffer':json.dumps(without_actions).encode()})
            page.wait_for_function("!document.getElementById('pilotBatchFile').disabled")
            page.locator('#pilotRun').click();page.wait_for_selector('#pilotResults:visible')
            page.locator('#pilotDetailRun').select_option('32')
            assert page.locator('#pilotCaseOwner').input_value()=='' and page.locator('#pilotCaseAction').input_value()==''
            assert page.locator('#pilotCaseState').input_value()=='open' and page.locator('#pilotNotes').input_value()==''
            with page.expect_download() as cleared_info:page.locator('#pilotExport').click()
            cleared=json.loads(Path(cleared_info.value.path()).read_text(encoding='utf-8'))
            assert cleared['caseNotes']==[] and cleared['notes']=='' and len(cleared['sourceFiles'])==4
            assert all(source['verification']=='imported-declaration' for source in cleared['sourceFiles'][:3])
            page.locator('details summary').click();profile=page.locator('#pilotProfile').input_value();page.locator('#pilotProfile').fill(profile+' ');assert page.locator('#pilotExport').is_disabled();assert page.locator('#pilotResults').is_hidden()
            data['input']['profile']['revision']='tampered'
            page.locator('#pilotBatchFile').set_input_files({'name':'tampered.json','mimeType':'application/json','buffer':json.dumps(data).encode()})
            page.wait_for_function("!document.getElementById('pilotBatchFile').disabled");assert '해시가 일치하지' in page.locator('#pilotStatus').inner_text();assert page.locator('#pilotRun').is_enabled()
            assert page.locator('#pilotProfile').input_value()==profile+' '
            page.locator('#pilotRun').click();page.wait_for_selector('#pilotResults:visible')
            with page.expect_download() as preserved_info:page.locator('#pilotExport').click()
            preserved=json.loads(Path(preserved_info.value.path()).read_text(encoding='utf-8'))
            assert preserved['input']==cleared['input'] and preserved['sourceFiles']==cleared['sourceFiles']
            page.locator('#pilotDemo').click();page.locator('#pilotRun').click();page.wait_for_selector('#pilotResults:visible')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.screenshot(path=str(ROOT/f'.test-tools/fab-pilot-{width}.png'),full_page=True)
            assert not errors,errors;page.close()
        browser.close()
    print(json.dumps({'origin':origin,'desktop_mobile':'passed','recalculation':'passed','tamper_rejection':'passed','stale_result_reset':'passed','source_provenance_round_trip':'passed','absent_action_reset':'passed'}))
finally:
    if server:server.shutdown();server.server_close()
