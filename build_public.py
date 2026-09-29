"""Build the public browser-only site from the explicit asset allowlist."""
import json
import shutil
import stat
import tempfile
import warnings
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
DEST = ROOT / '.test-tools' / 'site-source'

def _populate(public):
    public.mkdir(parents=True,exist_ok=True)
    manifest = json.loads((ROOT/'server'/'public-assets.json').read_text(encoding='utf-8'))
    if not isinstance(manifest, list) or not manifest or any(not isinstance(name, str) for name in manifest):
        raise ValueError('Public asset manifest must be a nonempty list of paths')
    if len(set(manifest)) != len(manifest):
        raise ValueError('Public asset manifest contains duplicate paths')
    excluded = {'workbench.html','review.js','review.css','workspace-bridge.js'}
    for name in manifest:
        relative = PurePosixPath(name)
        if (not name or relative.is_absolute() or ':' in name or '\\' in name
                or '..' in relative.parts or str(relative) != name):
            raise ValueError('Invalid public asset path: ' + name)
        if name in excluded:
            continue
        source = (ROOT/name).resolve()
        if not source.is_relative_to(ROOT.resolve()) or not source.is_file():
            raise ValueError('Missing or out-of-project public asset: ' + name)
        destination = public/name
        destination.parent.mkdir(parents=True,exist_ok=True)
        if source.suffix=='.html':
            text = source.read_text(encoding='utf-8')
            text = text.replace('<script src="workspace-bridge.js" defer></script>','')
            text = text.replace('서버 검토 기록','공개 버전 안내').replace('레시피 검토 ↗','사용 안내 ↗').replace('엔지니어링 워크스페이스 ↗','공개 버전 안내 ↗')
            text = text.replace('</body>','<script src="public-mode.js"></script></body>')
            destination.write_text(text,encoding='utf-8')
        else:
            shutil.copyfile(source,destination)
    (public/'public-mode.js').write_text("""(()=>{
      document.body.dataset.stratumEdition='public';
      const notice=document.createElement('div');notice.setAttribute('role','note');notice.className='stratum-public-notice';notice.textContent=['fab-data.html','fab-pilot.html','public-study.html','evidence.html'].some(name=>location.pathname.endsWith(name))?'STRATUM / 공개 검토 버전 · 입력과 메모는 자동 저장되지 않습니다. 화면을 닫기 전에 패키지를 내려받으세요.':'STRATUM / 공개 교육 버전 · 기록은 이 브라우저에 저장됩니다. JSON으로 내보내면 다른 기기에서 이어갈 수 있습니다.';document.body.append(notice);
      for(const id of ['reviewConnect','reviewLogout','archiveRun','createReviewProject','fabDataServer']){const el=document.getElementById(id);if(el){el.hidden=true;el.disabled=true;}}
      const state=document.getElementById('reviewConnection');if(state)state.textContent='브라우저 내 비교 · 파일로 보관';
      const msg=document.getElementById('reviewMessage');if(msg)msg.textContent='현재 기록 비교와 보고서 다운로드를 사용할 수 있습니다. 공개 버전은 서버 계정을 사용하지 않습니다.';
    })();""",encoding='utf-8')
    (public/'workbench.html').write_text("""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111622"><title>STRATUM · 공개 버전 안내</title><link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="fab-data.css"><link rel="stylesheet" href="stratum.css"><script src="stratum-shell.js" defer></script></head><body class="stratum stratum-data stratum-public"><header><a class="stratum-brand" href="index.html" aria-label="STRATUM 메모리 팹"><svg class="stratum-symbol" viewBox="0 0 40 44" aria-hidden="true"><path d="m2 12 18-9 18 9-18 9z" fill="currentColor"/><path d="m2 24 18 9 18-9v7l-18 9-18-9z" fill="#375cf6"/><path d="m2 17 18 9 18-9v4l-18 9-18-9z" fill="#f2f1ec"/></svg><span class="stratum-wordmark">STRATUM<small>PROCESS INTELLIGENCE</small></span></a><nav aria-label="공개 작업 공간"><a href="cmos-lab.html">공정 스튜디오</a><a href="index.html">메모리 팹</a><a href="fab-data.html">데이터 연동</a><a href="workbench.html" aria-current="page">공개 버전 안내</a></nav><div data-stratum-switcher></div></header><main><div class="stratum-page-intro" data-index="09 / PUBLIC EDITION"><p class="eyebrow">STRATUM / PROCESS INTELLIGENCE</p><h1>공정을 실험하고,<br>근거를 남기는 작업 공간.</h1><p class="lead">장비의 움직임에서 LOT의 흐름까지. CMOS 공정, 메모리 팹, 장비 운전과 데이터 검증을 브라우저에서 이어갑니다.</p><p class="scope">공개 원리를 축약한 교육·검토용 모델입니다. 실측 보정·실장비 제어·양산 판정을 제공하지 않습니다.</p></div><section><h2>작업 기록을 이어가려면</h2><p>시뮬레이터 기록은 현재 브라우저에 보관됩니다. 다른 기기에서 작업하거나 브라우저 기록을 정리하기 전에 JSON으로 내보내세요.</p><p>데이터 연동·파일럿 검토·모델 검증의 입력과 메모는 자동 저장되지 않습니다. 화면을 닫기 전에 각 작업 공간의 검토 패키지를 내려받으세요.</p><p class="hint">서버 로그인·공동 저장·검토 승인 기능은 공개 버전에 포함되지 않습니다. 계정 기반 검토 기록은 별도로 운영하는 현장 서버에서 사용할 수 있습니다.</p></section><section><h2>작업 공간 선택</h2><div class="stratum-public-links"><a href="cmos-lab.html"><span>01</span><b>공정 스튜디오</b><small>18종 장비와 웨이퍼의 공정 흐름</small><i>↗</i></a><a href="index.html"><span>02</span><b>메모리 팹</b><small>DRAM · NAND · HBM의 LOT 통합 검토</small><i>↗</i></a><a href="equipment.html"><span>03</span><b>장비 운전</b><small>운전 조건과 응답·이상 비교</small><i>↗</i></a><a href="photo-lab.html"><span>04</span><b>포토 실험</b><small>패터닝 실험과 실습 기록</small><i>↗</i></a><a href="fab-data.html"><span>05</span><b>데이터 연동</b><small>운전 로그와 태그 매핑</small><i>↗</i></a><a href="fab-pilot.html"><span>06</span><b>파일럿 검토</b><small>운전 묶음의 비교와 후속 조치</small><i>↗</i></a><a href="evidence.html"><span>07</span><b>모델 검증</b><small>모델 보정과 검증 오차의 근거</small><i>↗</i></a><a href="public-study.html"><span>08</span><b>공개 데이터</b><small>공개 실장비 로그와 측정 결과</small><i>↗</i></a></div></section></main></body></html>""",encoding='utf-8')
def _is_link(path):
    """Windows junctions and other reparse points are not ordinary directories."""
    try:
        status = path.lstat()
    except FileNotFoundError:
        return False
    return (stat.S_ISLNK(status.st_mode)
            or bool(getattr(status, 'st_file_attributes', 0)
                    & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0)))


def _reject_link_ancestors(path):
    # Inspect the lexical path before resolve() can hide a junction or symlink.
    absolute = path.absolute()
    for part in (absolute, *absolute.parents):
        if _is_link(part):
            raise ValueError('Build paths cannot contain links or reparse points: ' + str(part))


def _output_root():
    _reject_link_ancestors(ROOT)
    _reject_link_ancestors(DEST)
    root, destination = ROOT.resolve(), DEST.resolve()
    if destination == root or not destination.is_relative_to(root):
        raise ValueError('Build output must stay inside the project')
    return destination


def _remove_generated(directory, owned):
    """Remove only this invocation's registered, direct staging/backup directory."""
    output_root = _output_root()
    target = directory.absolute()
    if (target not in owned or target.parent != output_root
            or not target.name.startswith(('.public-build-', '.public-previous-'))):
        raise ValueError('Refusing to remove an unowned build directory')
    _reject_link_ancestors(target)
    # Do not resolve the deletion target. shutil.rmtree unlinks internal symlinks
    # and, on Windows/Python 3.8+, junctions without traversing their targets.
    shutil.rmtree(target)
    owned.remove(target)


def build():
    output_root = _output_root()
    output_root.mkdir(parents=True, exist_ok=True)
    targets = ('dist', '.openai')
    for name in targets:
        target = output_root / name
        _reject_link_ancestors(target)
        if target.exists() and not target.is_dir():
            raise ValueError('Build output must be a regular directory: ' + name)
    owned = set()

    def temporary(prefix):
        _output_root()
        directory = Path(tempfile.mkdtemp(prefix=prefix, dir=output_root)).absolute()
        owned.add(directory)
        return directory

    staged, previous = temporary('.public-build-'), None
    old_names, new_names = [], []
    try:
        _populate(staged / 'dist')
        config = ROOT / '.openai' / 'hosting.json'
        _reject_link_ancestors(config)
        if config.exists():
            (staged / '.openai').mkdir()
            shutil.copyfile(config, staged / '.openai' / 'hosting.json')
        previous = temporary('.public-previous-')
        try:
            # The HTML tree and deployment metadata belong to the same build.
            # Save both originals before publishing either staged replacement.
            for name in targets:
                target = output_root / name
                _reject_link_ancestors(target)
                if target.exists():
                    target.rename(previous / name)
                    old_names.append(name)
            for name in targets:
                if (staged / name).exists():
                    (staged / name).rename(output_root / name)
                    new_names.append(name)
        except BaseException as error:
            try:
                for name in reversed(new_names):
                    (output_root / name).rename(staged / name)
                for name in reversed(old_names):
                    (previous / name).rename(output_root / name)
            except BaseException as restore_error:
                # Keep all remaining originals if a filesystem fault also blocks
                # rollback; the outer cleanup must never erase this backup.
                raise RuntimeError('Build rollback failed; preserved originals: ' + str(previous)) from restore_error
            _remove_generated(previous, owned)
            previous = None
            raise error
        # No source hosting.json means no published .openai directory. This
        # avoids retaining the previous deployment's project identifier.
        try:
            _remove_generated(previous, owned)
        except (OSError, ValueError) as error:
            warnings.warn('Site published; old build cleanup deferred at ' + str(previous) + ': ' + str(error))
        previous = None
    finally:
        if staged.exists():
            try:
                _remove_generated(staged, owned)
            except (OSError, ValueError) as error:
                warnings.warn('Build staging cleanup deferred at ' + str(staged) + ': ' + str(error))
    public = output_root / 'dist'
    print(str(output_root))
    print('Public assets:', sum(path.is_file() for path in public.rglob('*')))
    return public

if __name__=='__main__':
    build()
