"""Equipment evidence validation and review. No hardware or manufacturing release."""
import hashlib
import json
import math

from flask import abort, g, jsonify, request
from .model import ValidationError

UNITS = {'pressurePa': 'Pa', 'beamVoltageV': 'V', 'beamCurrentMa': 'mA', 'heliumPressurePa': 'Pa', 'rotationRpm': 'rpm', 'tiltDeg': '°'}
STAGES = ('load', 'pump', 'stabilize', 'process', 'cooldown', 'vent', 'unload', 'unknown')
SCHEMA = 'waferflow-equipment-trace-v1'


def number(value, label):
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1e12:
        raise ValidationError(f'{label}: 유한한 숫자가 필요합니다.')
    return value


def string(value, label, limit=200):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 and c not in '\n\t' for c in value):
        raise ValidationError(f'{label}: 1–{limit}자 텍스트가 필요합니다.')
    return value.strip()


def validate_trace(data):
    def obj(v, label):
        if not isinstance(v, dict):
            raise ValidationError(f'{label}: 객체가 필요합니다.')
        return v

    obj(data, '운전 기록')
    if data.get('schema') != SCHEMA:
        raise ValidationError('지원하지 않는 장비 로그 형식입니다.')
    unit_map = obj(data.get('units'), '단위표')
    if not unit_map or any(k not in UNITS or UNITS[k] != v for k, v in unit_map.items()):
        raise ValidationError('단위표를 확인하세요. 단위를 추정하거나 자동 변환하지 않습니다.')

    def channels(value, label):
        result = {}
        for k, v in obj(value, label).items():
            if k not in unit_map:
                raise ValidationError(f'{label}: 인식 가능한 채널과 단위 선언이 필요합니다.')
            result[k] = number(v, label)
        return result

    rows = data.get('samples')
    if not isinstance(rows, list) or not 2 <= len(rows) <= 15000:
        raise ValidationError('샘플은 2–15000개여야 합니다.')
    samples, previous = [], -1
    for row in rows:
        obj(row, '샘플')
        t = number(row.get('t'), '샘플 시각')
        if not 0 <= t <= 1800 or t <= previous or (previous == -1 and t != 0):
            raise ValidationError('시간은 0초부터 중복 없이 증가해야 하며 최대 1800초입니다.')
        previous = t
        if row.get('stage') not in STAGES:
            raise ValidationError('인식할 수 없는 공정 단계입니다.')
        values = channels(row.get('values'), '센서 값')
        if not values:
            raise ValidationError('샘플에 센서 값이 하나 이상 필요합니다.')
        sample = dict(t=t, stage=row['stage'], values=values)
        if 'targets' in row:
            sample['targets'] = channels(row['targets'], '설정값')
        if 'digital' in row:
            digital = obj(row['digital'], '구동 신호')
            if any(k not in ('beam', 'shutter', 'pump', 'gate', 'wafer', 'robot') for k in digital):
                raise ValidationError('인식할 수 없는 구동 신호입니다.')
            for k, v in digital.items():
                if k == 'robot':
                    if not 0 <= number(v, '이송 위치') <= 1:
                        raise ValidationError('이송 위치는 0–1이어야 합니다.')
                elif type(v) is not bool:
                    raise ValidationError('구동 신호는 true 또는 false여야 합니다.')
            sample['digital'] = dict(digital)
        samples.append(sample)
    duration = samples[-1]['t']
    if 'duration' in data and abs(number(data['duration'], '종료 시각') - duration) > 1e-6:
        raise ValidationError('종료 시각과 마지막 샘플이 일치하지 않습니다.')
    events = data.get('events')
    if not isinstance(events, list) or len(events) > 5000:
        raise ValidationError('이벤트는 최대 5000개 배열이어야 합니다.')
    normalized_events, previous = [], -1
    for event in events:
        obj(event, '이벤트')
        t = number(event.get('t'), '이벤트 시각')
        if t < previous or not 0 <= t <= duration or event.get('level') not in ('info', 'warning', 'alarm'):
            raise ValidationError('이벤트 시각·순서·수준을 확인하세요.')
        previous = t
        normalized_events.append(dict(t=t, level=event['level'], code=string(event.get('code'), '이벤트 코드', 80), message=string(event.get('message'), '이벤트 설명', 1000)))
    outcome = obj(data.get('outcome'), '결과')
    if outcome.get('status') not in ('completed', 'aborted'):
        raise ValidationError('운전 결과 상태를 확인하세요.')
    result = dict(schema=SCHEMA, modelVersion=string(data.get('modelVersion'), '모델 버전', 80), profileId=string(data.get('profileId'), '프로필', 100),
                  provenance=dict(kind='unverified', label='서버 보관된 제출 기록 · 장비 실측 검증 전', source='사용자 제출 · 원출처 미검증'),
                  units=dict(unit_map), samples=samples, events=normalized_events, duration=duration,
                  outcome=dict(status=outcome['status'], reason=string(outcome.get('reason'), '결과 설명', 1000)))
    if 'recipe' in data:
        recipe = obj(data['recipe'], '레시피')
        if any(k not in UNITS and k != 'processSeconds' for k in recipe):
            raise ValidationError('인식할 수 없는 레시피 항목입니다.')
        if any(k != 'processSeconds' and k not in unit_map for k in recipe):
            raise ValidationError('레시피 항목의 단위 선언이 필요합니다.')
        result['recipe'] = {k: number(v, '레시피') for k, v in recipe.items()}
    if 'fault' in data:
        result['fault'] = string(data['fault'], '이상 조건', 80)
    return result


def summarize(trace):
    stages, channels = {}, {}
    for i, row in enumerate(trace['samples']):
        dt = trace['samples'][i + 1]['t'] - row['t'] if i + 1 < len(trace['samples']) else 0
        stages[row['stage']] = stages.get(row['stage'], 0) + dt
        for key, value in row['values'].items():
            c = channels.setdefault(key, dict(min=value, max=value, count=0, covered_seconds=0, area=0))
            c['min'], c['max'] = min(c['min'], value), max(c['max'], value)
            c['count'] += 1
            c['covered_seconds'] += dt
            c['area'] += value * dt
    for channel in channels.values():
        channel['time_weighted_mean'] = channel.pop('area') / channel['covered_seconds'] if channel['covered_seconds'] else None
    return dict(duration=trace['duration'], sample_count=len(trace['samples']), stage_seconds=stages, channels=channels,
                alarm_count=sum(e['level'] == 'alarm' for e in trace['events']), declared_outcome=trace['outcome']['status'],
                equipment_validation='not_validated', manufacturing_release=False)


def register_equipment(app, db, one, rows, body, require_roles, audit, uid, now, encoded):
    def digest(value):
        return hashlib.sha256(value.encode('utf-8')).hexdigest()

    def public(row, full=False):
        item = dict(row)
        item['summary'] = json.loads(item.pop('summary_json'))
        trace_json = item.pop('trace_json', None)
        if full:
            item['trace'] = json.loads(trace_json)
        item.pop('request_key', None)
        item.pop('request_sha256', None)
        item['equipment_validation'] = 'not_validated'
        item['manufacturing_release'] = False
        return item

    def get(run_id):
        return one('SELECT e.*,u.display_name AS author,v.display_name AS reviewer FROM equipment_runs e JOIN users u ON u.id=e.created_by LEFT JOIN users v ON v.id=e.reviewer_id WHERE e.id=?', (run_id,))

    @app.get('/api/equipment/capabilities')
    def capabilities():
        return jsonify(version='wf-equipment-review-0.1', scope='single-organization-review', max_archive_bytes=1400000,
                       equipment_validation='not_validated', manufacturing_release=False, units=UNITS)

    @app.get('/api/equipment/runs')
    def list_runs():
        project_id = request.args.get('project_id', '')
        one('SELECT id FROM projects WHERE id=?', (project_id,))
        try:
            offset = int(request.args.get('offset', '0'))
        except ValueError:
            raise ValidationError('목록 위치가 올바르지 않습니다.')
        if not 0 <= offset <= 1000000:
            raise ValidationError('목록 위치가 올바르지 않습니다.')
        count = one('SELECT COUNT(*) AS n FROM equipment_runs WHERE project_id=?', (project_id,))['n']
        # Do not pull large trace JSON blobs when listing records.
        selected = 'e.id,e.project_id,e.series_id,e.revision,e.parent_id,e.baseline_id,e.title,e.lot_id,e.change_reason,e.source_name,e.trace_sha256,e.summary_json,e.created_by,e.created_at,e.status,e.reviewer_id,e.review_note,e.reviewed_at,e.lock_version,u.display_name AS author,v.display_name AS reviewer'
        found = rows(f'SELECT {selected} FROM equipment_runs e JOIN users u ON u.id=e.created_by LEFT JOIN users v ON v.id=e.reviewer_id WHERE e.project_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 30 OFFSET ?', (project_id, offset))
        return jsonify(items=[public(r) for r in found], total=count, offset=offset, limit=30)

    @app.post('/api/equipment/runs')
    def save_run():
        require_roles('admin', 'engineer')
        data = body()
        try:
            request_json = encoded(data)
        except (ValueError, RecursionError):
            raise ValidationError('기록은 유한한 숫자를 포함하는 JSON이어야 합니다.')
        if len(request_json.encode('utf-8')) > 1400000:
            raise ValidationError('서버 보관은 요청당 최대 1.4 MB입니다. 원본 JSON은 별도로 보관하세요.')
        project_id = string(data.get('project_id'), '프로젝트 ID', 80)
        one('SELECT id FROM projects WHERE id=?', (project_id,))
        key = string(data.get('request_key'), '요청 식별자', 100)
        request_digest = digest(request_json)
        existing = db().execute('SELECT id,request_sha256 FROM equipment_runs WHERE created_by=? AND request_key=?', (g.user['id'], key)).fetchone()
        if existing:
            if existing['request_sha256'] != request_digest:
                abort(409, description='같은 요청 식별자로 다른 내용을 저장할 수 없습니다.')
            return jsonify(public(get(existing['id']), True))
        trace = validate_trace(data.get('trace'))
        run_id, base_id, baseline_id = uid(), data.get('base_revision_id'), data.get('baseline_id')
        parent = None
        if base_id:
            parent = get(string(base_id, '기준 버전 ID', 80))
            if parent['project_id'] != project_id:
                raise ValidationError('다른 프로젝트의 버전에서 변경안을 만들 수 없습니다.')
            latest = one('SELECT id FROM equipment_runs WHERE series_id=? ORDER BY revision DESC LIMIT 1', (parent['series_id'],))
            if latest['id'] != base_id:
                abort(409, description='새 버전이 먼저 저장되었습니다. 최신 버전을 불러온 뒤 다시 작성하세요.')
        if baseline_id:
            baseline = get(string(baseline_id, '비교 기준 ID', 80))
            baseline_trace = json.loads(baseline['trace_json'])
            if baseline['project_id'] != project_id:
                raise ValidationError('비교 기준은 같은 프로젝트의 기록이어야 합니다.')
            if baseline_trace['profileId'] != trace['profileId'] or baseline_trace['modelVersion'] != trace['modelVersion']:
                raise ValidationError('비교 기준의 장비 프로필·모델 버전이 다릅니다.')
        payload, summary = encoded(trace), summarize(trace)
        db().execute('INSERT INTO equipment_runs(id,project_id,series_id,revision,parent_id,baseline_id,title,lot_id,change_reason,source_name,trace_json,trace_sha256,summary_json,created_by,created_at,request_key,request_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                     (run_id, project_id, parent['series_id'] if parent else run_id, parent['revision'] + 1 if parent else 1, base_id or None, baseline_id or None,
                      string(data.get('title'), '검토 이름', 100), string(data.get('lot_id'), 'Lot / 시편', 80), string(data.get('change_reason'), '변경 사유', 2000),
                      string(data.get('source_name'), '데이터 출처', 200), payload, digest(payload), encoded(summary), g.user['id'], now(), key, request_digest))
        audit('equipment.run_saved', run_id, dict(project_id=project_id, parent_id=base_id, baseline_id=baseline_id, sha256=digest(payload)))
        return jsonify(public(get(run_id), True)), 201

    @app.get('/api/equipment/runs/<run_id>')
    def detail(run_id):
        return jsonify(public(get(run_id), True))

    @app.post('/api/equipment/runs/<run_id>/transition')
    def equipment_transition(run_id):
        data, record = body(), get(run_id)
        if type(data.get('lock_version')) is not int or data['lock_version'] != record['lock_version']:
            abort(409, description='검토 상태가 변경되었습니다. 목록을 새로고침하세요.')
        action = data.get('action')
        if action == 'submit':
            require_roles('admin', 'engineer')
            if record['created_by'] != g.user['id'] or record['status'] != 'draft':
                abort(409, description='본인이 작성한 초안만 검토 요청할 수 있습니다.')
            db().execute("UPDATE equipment_runs SET status='submitted',lock_version=lock_version+1 WHERE id=?", (run_id,))
        elif action in ('review', 'reject'):
            require_roles('admin', 'reviewer')
            if record['created_by'] == g.user['id']:
                abort(403, description='작성자는 자신의 기록을 검토 완료·반려할 수 없습니다.')
            if record['status'] != 'submitted':
                abort(409, description='검토 요청된 기록만 판정할 수 있습니다.')
            note = string(data.get('note'), '검토 의견', 2000)
            db().execute('UPDATE equipment_runs SET status=?,reviewer_id=?,review_note=?,reviewed_at=?,lock_version=lock_version+1 WHERE id=?', ('reviewed' if action == 'review' else 'rejected', g.user['id'], note, now(), run_id))
        else:
            raise ValidationError('지원하지 않는 검토 동작입니다.')
        audit('equipment.' + action, run_id, dict(previous_status=record['status'], note=data.get('note', ''), manufacturing_release=False))
        return jsonify(public(get(run_id), True))
