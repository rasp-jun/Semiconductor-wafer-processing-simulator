"""Server recomputation of the existing illustrative model, never a fab predictor."""
import base64
import binascii
import csv
import hashlib
import hmac
import io
import json
import math
import statistics
from pathlib import Path

CATALOG = json.loads((Path(__file__).with_name('model-catalog.json')).read_text(encoding='utf-8'))


class ValidationError(ValueError):
    pass


def number(value, name, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not minimum <= value <= maximum or not math.isfinite(value):
        raise ValidationError(f'{name}: 유한한 숫자가 필요합니다.')
    if not minimum <= value <= maximum:
        raise ValidationError(f'{name}: {minimum}–{maximum} 범위가 필요합니다.')
    return value


def validate_params(params):
    if not isinstance(params, dict) or set(params) != set(CATALOG['fields']):
        raise ValidationError('레시피에는 정의된 12개 파라미터가 모두 필요합니다.')
    result = {}
    for k, f in CATALOG['fields'].items():
        value = number(params[k], f['label'], f['min'], f['max'])
        increments = (value-f['min'])/f['step']
        if abs(increments-round(increments)) > 1e-7:
            raise ValidationError(f"{f['label']}: 모델 입력 간격 {f['step']} {f['unit']}에 맞춰 입력하세요.")
        result[k] = round(value, 3)
    return result


def noise(x, y, seed):
    n = ((x + 43) * 374761393) ^ ((y + 47) * 668265263) ^ (seed * 1274126177)
    n &= 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffffffff) / 4294967296


def simulate(params, scenario, seed=None):
    p = validate_params(params)
    mission = next((m for m in CATALOG['missions'] if m['id'] == scenario), None)
    if not mission:
        raise ValidationError('알 수 없는 모델 시나리오입니다.')
    seed = mission['seed'] if seed is None else number(seed, 'seed', 0, 2147483647)
    if int(seed) != seed:
        raise ValidationError('seed는 정수여야 합니다.')
    seed = int(seed)
    oxide = (math.sqrt(180**2 + 4 * 700 * math.exp((p['temperature'] - 1000) / 90) * p['oxidationTime']) - 180) / 2
    pr = 850 * math.sqrt(3000 / p['rpm'])
    rate = 1.25 * (p['power'] / 220)**.72 * (30 / p['pressure'])**.12
    depth = rate * p['etchTime']
    bake = abs(p['bakeTemp'] - 100)/80 + abs(p['bakeTime'] - 60)/200 + abs(p['pebTemp'] - 110)/120
    develop = p['dose']/100 * p['developTime']/60 * max(.5, 1-bake*.3)
    cd = 500 + (p['dose']-100)*1.4 + 40*p['focus']**2 + (p['developTime']-60)*.5
    residue = max(0, 1-develop)*pr*.18
    edge = max(0, p['power']-240)/130
    uniformity = 1.4 + abs(p['pressure']-30)*.11 + abs(p['rpm']-3000)*.0015
    dies = []
    clamp = lambda x, a, b: max(a, min(b, x))
    kinds = ['과식각', '잔류막', '패턴 편차', '배경 결함']
    for y in range(-13, 14):
        for x in range(-13, 14):
            radius = math.hypot(x, y)/13.5
            if radius > .965 or (y == 13 and abs(x) < 2):
                continue
            local_noise = noise(x, y, seed)
            local_depth = depth * (1 + radius**3*(uniformity/100+edge*.3)+(local_noise-.5)*.04)
            local_oxide = oxide * (1+(radius**2-.5)*uniformity/100)
            local_residue = max(0, local_oxide-local_depth)+residue
            damage = max(0, local_depth-local_oxide*1.16)
            local_cd = cd+(local_noise-.5)*(8+abs(p['focus'])*85)+x/13*p['focus']*18
            risks = sorted(zip(kinds, [clamp(damage/65+edge*radius**3*.65, 0, .96), clamp(local_residue/55, 0, .97), clamp(max(0, abs(local_cd-500)-30)/90+abs(p['focus'])**2*.3+bake*.2, 0, .96), .018]), key=lambda k: -k[1])
            probability = 1 - math.prod(1-r for _, r in risks)
            failed = noise(x+73, y-31, seed) < probability
            dies.append(dict(x=x, y=y, failed=failed, kind=risks[0][0] if failed else '정상', depth=round(local_depth, 2), residue=round(local_residue, 2), cd=round(local_cd, 2)))
    bad = sum(d['failed'] for d in dies)
    return dict(version=CATALOG['version'], source='synthetic-educational-model', scenario=scenario, seed=seed, params=p, dies=dies, total=len(dies), bad=bad,
                yield_percent=round((len(dies)-bad)/len(dies)*100, 1), cd_nm=round(cd, 2), oxide_nm=round(oxide, 2), pr_nm=round(pr, 2), etch_depth_nm=round(depth, 2), residue_nm=round(residue, 2),
                model_notice='공개 원리 기반의 미보정 합성 모델. 양산 예측·공정 출하 판정에 사용하지 않습니다.')


def parse_measurements(text, lower, upper):
    lower = number(lower, 'CD 하한', 0, 100000)
    upper = number(upper, 'CD 상한', 0, 100000)
    if lower >= upper:
        raise ValidationError('CD 하한은 상한보다 작아야 합니다.')
    if not isinstance(text, str) or not text.strip() or len(text.encode('utf-8')) > 1000000:
        raise ValidationError('CSV는 비어 있지 않은 UTF-8 텍스트, 최대 1 MB여야 합니다.')
    reader = csv.DictReader(io.StringIO(text.lstrip('\ufeff')), strict=True)
    columns = ['wafer_id', 'site_id', 'cd_nm', 'etch_depth_nm']
    try:
        headers = reader.fieldnames
    except csv.Error as error:
        raise ValidationError(f'CSV 헤더 형식 오류: {error}') from error
    if headers != columns:
        raise ValidationError('CSV 헤더 순서: wafer_id,site_id,cd_nm,etch_depth_nm (단위 nm)')
    rows, seen = [], set()
    try:
        for row in reader:
            if len(rows) >= 2000 or None in row or any(v is None for v in row.values()):
                raise ValidationError('CSV는 최대 2,000행이며 각 행에 4개 열이 필요합니다.')
            wafer, site = row['wafer_id'].strip(), row['site_id'].strip()
            if not wafer or not site or max(len(wafer), len(site)) > 80 or any(ord(c) < 32 for c in wafer+site):
                raise ValidationError(f'{reader.line_num}행: wafer_id/site_id를 확인하세요.')
            key = (wafer, site)
            if key in seen:
                raise ValidationError(f'{reader.line_num}행: 웨이퍼·사이트 조합이 중복됩니다.')
            seen.add(key)
            cd = number(float(row['cd_nm']), 'CD', .000001, 100000)
            depth = number(float(row['etch_depth_nm']), '식각 깊이', 0, 100000)
            rows.append(dict(wafer_id=wafer, site_id=site, cd_nm=cd, etch_depth_nm=depth))
    except (csv.Error, ValueError) as error:
        raise ValidationError(f'CSV {reader.line_num}행: {error}') from error
    if not rows:
        raise ValidationError('CSV에 측정 행이 없습니다.')
    values = [r['cd_nm'] for r in rows]
    inside = sum(lower <= v <= upper for v in values)
    return dict(rows=rows, count=len(rows), wafer_count=len({r['wafer_id'] for r in rows}), cd_mean_nm=statistics.mean(values), cd_stdev_nm=statistics.stdev(values) if len(values)>1 else None,
                cd_min_nm=min(values), cd_max_nm=max(values), etch_depth_mean_nm=statistics.mean(r['etch_depth_nm'] for r in rows), within_spec_count=inside,
                within_spec_percent=inside/len(rows)*100, limits=dict(cd_lsl_nm=lower, cd_usl_nm=upper),
                interpretation='표본 사이트의 규격 충족 비율입니다. 웨이퍼 수율·공정 능력·공정 안정성 판정이 아닙니다.')


def measurement_source(data):
    """Preserve submitted text or exact UTF-8 file bytes without doubling the request."""
    original = data.get('original_csv')
    if 'csv_utf8_base64' in data and 'original_csv' in data:
        raise ValidationError('제출 CSV 텍스트와 원본 파일 전송을 혼합할 수 없습니다.')
    if original is None:
        if 'csv_utf8_base64' in data:
            content = data['csv_utf8_base64']
            if not isinstance(content, str) or len(content) > 1333336:
                raise ValidationError('제출 CSV는 UTF-8 최대 1 MB의 base64 텍스트여야 합니다.')
            try:
                raw = base64.b64decode(content, validate=True)
                # Transport only: retain the submitted BOM and CR/LF exactly.
                text = raw.decode('utf-8')
            except (binascii.Error, ValueError, UnicodeError) as error:
                raise ValidationError('제출 CSV의 base64 또는 UTF-8 인코딩이 올바르지 않습니다.') from error
            if 'csv' in data and data['csv'] != text:
                raise ValidationError('제출 CSV 텍스트와 base64 내용이 일치하지 않습니다.')
        else:
            text = data.get('csv')
            try:
                raw = text.encode('utf-8') if isinstance(text, str) else None
            except UnicodeError as error:
                raise ValidationError('CSV에 UTF-8로 표현할 수 없는 문자가 있습니다.') from error
        if raw is None or len(raw) > 1000000:
            raise ValidationError('CSV는 UTF-8 텍스트, 최대 1 MB여야 합니다.')
        sha = hashlib.sha256(raw).hexdigest()
        return text, dict(schema='waferflow-measurement-source-v1', kind='submitted-text',
                          encoding='utf-8', text=text, sha256=sha, hash_scope='submitted-csv-text-utf8')
    if not isinstance(original, dict) or original.get('encoding') != 'base64':
        raise ValidationError('CSV 원본은 base64 바이트 형식이어야 합니다.')
    content = original.get('bytes_base64')
    if not isinstance(content, str) or len(content) > 1333336:
        raise ValidationError('CSV 원본 파일은 최대 1 MB입니다.')
    try:
        raw = base64.b64decode(content, validate=True)
        # File.text/TextDecoder removes an initial BOM; textarea values use LF.
        text = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    except (binascii.Error, ValueError, UnicodeError) as error:
        raise ValidationError('CSV 원본의 base64 또는 UTF-8 인코딩이 올바르지 않습니다.') from error
    if not raw or len(raw) > 1000000:
        raise ValidationError('CSV 원본 파일은 비어 있지 않아야 하며 최대 1 MB입니다.')
    sha = hashlib.sha256(raw).hexdigest()
    text_sha = hashlib.sha256(text.encode('utf-8')).hexdigest()
    for actual, supplied, label in [(sha, original.get('sha256'), '파일 바이트'), (text_sha, data.get('csv_text_sha256'), '제출 CSV 텍스트')]:
        if not isinstance(supplied, str) or len(supplied) != 64 or any(c not in '0123456789abcdef' for c in supplied) or not hmac.compare_digest(actual, supplied):
            raise ValidationError(f'{label} SHA-256이 일치하지 않습니다. 파일을 다시 선택하세요.')
    if 'csv' in data and data['csv'] != text:
        raise ValidationError('CSV 텍스트와 원본 파일 내용이 일치하지 않습니다.')
    filename = original.get('filename')
    if not isinstance(filename, str) or not 1 <= len(filename) <= 255 or any(ord(c) < 32 for c in filename):
        raise ValidationError('CSV 원본 파일 이름을 확인하세요.')
    return text, dict(schema='waferflow-measurement-source-v1', kind='original-file', encoding='base64',
                      bytes_base64=base64.b64encode(raw).decode('ascii'), byte_length=len(raw), filename=filename,
                      sha256=sha, hash_scope='original-file-bytes', submitted_text_sha256=text_sha,
                      submitted_text_transform='utf8-strip-initial-bom-normalize-crlf-cr-to-lf')
