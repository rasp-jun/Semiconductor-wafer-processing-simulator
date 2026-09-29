"""Check keyboard focus, native dialogs and live reduced camera motion in real Chrome."""
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


def positions(page, camera, action=''):
    return page.evaluate('''async()=>{
        ''' + action + ''';
        const poses=[];
        for(let i=0;i<16;i++){
            await new Promise(requestAnimationFrame);
            poses.push(''' + camera + '''.position.toArray().map(v=>Number(v.toFixed(8))));
        }
        return new Set(poses.map(JSON.stringify)).size;
    }''')


def camera_check(page, camera, first_action, second_action):
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_function("()=>matchMedia('(prefers-reduced-motion: reduce)').matches")
    assert positions(page, camera, first_action) == 1, 'Reduced motion still animates the camera'
    page.emulate_media(reduced_motion='no-preference')
    page.wait_for_function("()=>!matchMedia('(prefers-reduced-motion: reduce)').matches")
    assert positions(page, camera, second_action) > 1, 'Normal camera transitions stopped working'
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_function("()=>matchMedia('(prefers-reduced-motion: reduce)').matches")
    assert positions(page, camera) == 1, 'Live reduced-motion change did not stop an ongoing transition'


def dialog_check(page, button, dialog, name=None):
    page.locator(button).focus()
    page.keyboard.press('Enter')
    expect(page.locator(dialog)).to_be_visible()
    if name:
        expect(page.get_by_role('dialog', name=name, exact=True)).to_be_visible()
    assert page.evaluate('selector=>!!document.activeElement.closest(selector)', dialog)
    page.keyboard.press('Escape')
    expect(page.locator(dialog)).not_to_be_visible()
    assert page.evaluate('selector=>document.activeElement===document.querySelector(selector)', button)


def photo_keyboard_navigation_check(page):
    checked = []

    def restore_without_running(flow, selector, label):
        count = page.locator('#noteCount').inner_text()
        page.locator(selector).first.focus()
        page.keyboard.press('Enter')
        expect(page.locator('#page-lab')).to_be_visible()
        expect(page.locator('#runLabel')).to_have_text(label)
        restored = page.evaluate('WaferAppBridge.snapshot()')
        page.keyboard.press('Enter')
        # A second Enter after the source button is replaced/hidden must not run.
        page.wait_for_timeout(750)
        expect(page.locator('#noteCount')).to_have_text(count)
        expect(page.locator('#runLabel')).to_have_text(label)
        assert page.evaluate('WaferAppBridge.snapshot()') == restored
        checked.append(flow)

    restore_without_running('baseline', '#historyBody [data-restore="baseline"]', 'BASELINE')
    page.locator('#runSimulation').focus()
    page.keyboard.press('Enter')
    expect(page.locator('#runLabel')).to_have_text('RUN 001')
    expect(page.locator('#noteCount')).to_have_text('1')
    restore_without_running('history', '#historyBody [data-restore]:not([data-restore="baseline"])', 'RUN 001')
    page.locator('.nav-item[data-page="missions"]').click()
    restore_without_running('mission', '[data-mission="edge"]', 'BASELINE')
    assert page.evaluate('WaferAppBridge.snapshot().missionId') == 'edge'
    page.locator('#saveRecipe').click()
    expect(page.get_by_role('dialog', name='다음 실험을 위한 레시피', exact=True)).to_be_visible()
    page.locator('#recipeName').fill('키보드로 불러올 레시피')
    page.locator('#saveForm button[type="submit"]').click()
    page.locator('.nav-item[data-page="notebook"]').click()
    restore_without_running('recipe', '#savedRecipes [data-load-recipe]', 'BASELINE')
    page.locator('#runSimulation').focus()
    page.keyboard.press('Space')
    expect(page.locator('#noteCount')).to_have_text('2')
    return {'navigationWithoutAccidentalRun': checked, 'nativeRunKeys': ['Enter', 'Space']}


def main():
    output = ROOT / '.test-tools/accessibility-review'
    output.mkdir(parents=True, exist_ok=True)
    errors, results = [], []
    with tempfile.TemporaryDirectory() as temporary:
        server = create_server(create_app(Path(temporary) / 'a11y.sqlite3', testing=True), host='127.0.0.1', port=0, threads=8)
        threading.Thread(target=server.run, daemon=True).start()
        origin = f'http://127.0.0.1:{server.effective_port}'
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(channel='chrome', headless=True)
                context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')

                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/photo-lab.html', wait_until='load')
                page.wait_for_function('()=>!!window.WaferMachine')
                stage = '.ribbon-step[data-stage="1"]'
                page.locator(stage).focus()
                page.keyboard.press('Enter')
                assert page.evaluate('selector=>document.activeElement===document.querySelector(selector)', stage)
                page.keyboard.press('Enter')
                page.wait_for_timeout(700)
                expect(page.locator('#runLabel')).to_have_text('BASELINE')
                assert page.evaluate('()=>JSON.parse(localStorage.getItem("waferflow-v2"))?.history?.length??0') == 0
                keyboard = photo_keyboard_navigation_check(page)
                page.locator('#machineViewport').scroll_into_view_if_needed()
                # Let IntersectionObserver report the viewport's return before
                # measuring the camera's first rendered response to a new view.
                page.evaluate('async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);}')
                camera_check(page, 'WaferMachine.camera', "document.querySelector('[data-camera=top]').click()", "document.querySelector('[data-camera=overview]').click()")
                start = page.evaluate('WaferMachine.getState().elapsed')
                page.locator('#machinePlay').click()
                page.wait_for_function('start=>WaferMachine.getState().playing&&WaferMachine.getState().elapsed>start', arg=start)
                page.locator('#machinePlay').click()
                dialog_check(page, '#modelInfo', '#infoDialog', '관찰을 위한 모델, 재현 가능한 실험')
                dialog_check(page, '#guideButton', '#infoDialog', '웨이퍼 위에서 시작하는 첫 실험')
                dialog_check(page, '#saveRecipe', '#saveDialog', '다음 실험을 위한 레시피')
                results.append({'page': 'photo', 'stageFocusPreserved': True, 'noAccidentalRun': True, **keyboard, 'liveReducedCameraMotion': True, 'explicitPlayback': True, 'namedDialogs': True, 'dialogFocusRestored': True})
                page.close()

                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/cmos-lab.html', wait_until='load')
                page.wait_for_function('()=>!!window.FabApp?.viewport?.viewCamera')
                camera_check(page, 'FabApp.viewport.viewCamera', "FabApp.viewport.camera('top')", "FabApp.viewport.camera('equipment')")
                page.locator('#observeStops').uncheck()
                page.locator('#runButton').click()
                page.wait_for_function('()=>parseFloat(document.querySelector("#observationSeek").value)>0')
                progress = page.locator('#observationSeek').input_value()
                page.wait_for_function('before=>Number(document.querySelector("#observationSeek").value)>Number(before)', arg=progress)
                page.locator('#runButton').click()
                expect(page.locator('#runState')).to_have_text('일시정지')
                page.locator('#cancelRunButton').click()
                dialog_check(page, '#equipmentHelpButton', '#equipmentDialog')
                results.append({'page': 'CMOS', 'liveReducedCameraMotion': True, 'explicitPlayback': True, 'dialogFocusRestored': True})
                page.close()

                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/memory-fab.html', wait_until='load')
                page.evaluate('''()=>{
                    const mount=FabViewport.mount;
                    FabViewport.mount=(...args)=>{const viewport=mount(...args);window.accessibilityViewport=viewport;return viewport;};
                    const chamber=MemoryFab.chambers.find(c=>MemoryFab.tools[c.type].view);
                    MemoryFabApp.selectChamber(chamber.id);
                }''')
                page.locator('#openEquipment').click()
                page.wait_for_function('()=>!!window.accessibilityViewport?.viewCamera')
                camera_check(page, 'accessibilityViewport.viewCamera', 'document.querySelector("#cameraButton").click()', 'document.querySelector("#cameraButton").click()')
                page.locator('#motionButton').click()
                page.wait_for_function('()=>MemoryFabApp.snapshot().motion&&MemoryFabApp.snapshot().motionTime>0')
                page.locator('#motionButton').click()
                page.keyboard.press('Escape')
                expect(page.locator('#equipmentDialog')).not_to_be_visible()
                assert page.evaluate('document.activeElement.id') == 'openEquipment'
                results.append({'page': 'memory', 'sharedReducedCameraMotion': True, 'explicitPlayback': True, 'dialogFocusRestored': True})
                page.close()

                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(origin + '/equipment.html', wait_until='load')
                dialog_check(page, '#sourceButton', '#sourceDialog')
                results.append({'page': 'equipment', 'dialogFocusRestored': True})
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
