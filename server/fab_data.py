"""Authenticated, append-only intake for completed-run telemetry. No equipment commands."""
import hashlib
import json
import math
import re
from datetime import datetime
from flask import abort, jsonify, g
from .model import ValidationError

SCHEMA='waferflow-fab-telemetry-v1'
TOOLS={'clean','oxidation','lpcvd','pecvd','coat','bake','scanner','developer','etch','strip','wetetch','implant','rtp','cmp','pvd','ald','metrology','probe'}

def validate_packet(p):
    def fail(message):raise ValidationError(message)
    def number(v,label):
        if type(v) not in (int,float):fail(label+': 유한한 숫자가 필요합니다.')
        try:finite=math.isfinite(v)
        except OverflowError:finite=False
        if not finite:fail(label+': 유한한 숫자가 필요합니다.')
        return v
    if not isinstance(p,dict) or p.get('schema')!=SCHEMA:fail('지원하지 않는 장비 데이터 형식입니다.')
    if set(p)-{'schema','equipmentId','chamberId','runId','lotId','waferId','tool','startedAt','processStart','processEnd','status','source','channels','samples'}:fail('공통 형식에 정의되지 않은 필드가 있습니다.')
    for key in ['equipmentId','chamberId','runId','lotId','waferId','tool']:
        v=p.get(key)
        if not isinstance(v,str) or not v.strip() or v!=v.strip() or len(v)>100 or any(ord(c)<32 for c in v):fail('장비/운전 식별자를 확인하세요.')
    if p['tool'] not in TOOLS:fail('지원하지 않는 장비 모델입니다.')
    stamp=p.get('startedAt')
    if not isinstance(stamp,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})',stamp):fail('시간대가 포함된 ISO 시각이 필요합니다.')
    if int(stamp[:4])<1970:fail('시작 날짜는 1970년 이후여야 합니다.')
    # fromisoformat normalizes offsets such as +00:60; the browser rejects
    # those malformed ISO components, so validate them before parsing.
    if not stamp.endswith('Z') and (int(stamp[-5:-3])>23 or int(stamp[-2:])>59):fail('유효하지 않은 시간대 오프셋입니다.')
    try:datetime.fromisoformat(stamp.replace('Z','+00:00'))
    except ValueError:fail('유효하지 않은 시작 시각입니다.')
    if p.get('status') not in ('completed','aborted') or p.get('source') not in ('equipment-export','synthetic'):fail('운전 상태와 출처 구분이 필요합니다.')
    start,end=number(p.get('processStart'),'처리 시작'),number(p.get('processEnd'),'처리 종료')
    if not 0<=start<end<=86400:fail('처리 구간을 확인하세요.')
    channels=p.get('channels')
    if not isinstance(channels,dict) or not 1<=len(channels)<=32:fail('채널은 1–32개입니다.')
    for tag,c in channels.items():
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,79}',tag) or tag in ('constructor','prototype','__proto__') or not isinstance(c,dict) or set(c)-{'unit'} or not isinstance(c.get('unit'),str) or not 1<=len(c['unit'])<=24:fail('채널명과 단위를 확인하세요.')
    samples=p.get('samples')
    if not isinstance(samples,list) or not 2<=len(samples)<=5000:fail('샘플은 2–5000개입니다.')
    previous=-1
    for sample in samples:
        if not isinstance(sample,dict) or set(sample)-{'t','quality','values'}:fail('샘플 객체의 형식을 확인하세요.')
        t=number(sample.get('t'),'샘플 시각')
        if not 0<=t<=86400 or t<=previous:fail('샘플 시각은 중복 없이 증가해야 합니다.')
        previous=t
        values=sample.get('values')
        if sample.get('quality') not in ('good','bad','uncertain') or not isinstance(values,dict) or not values:fail('샘플 품질과 값이 필요합니다.')
        for tag,value in values.items():
            if tag not in channels:fail('등록되지 않은 채널입니다.')
            number(value,tag)
    if samples[0]['t']>start or samples[-1]['t']<end:fail('샘플이 처리 구간을 모두 포함해야 합니다.')
    return p

def register_fab_data(app,db,one,rows,body,require_roles,audit,uid,now,encoded):
    @app.post('/api/fab-data/runs')
    def ingest():
        require_roles('admin','engineer')
        packet=validate_packet(body())
        payload=encoded(packet)
        sha=hashlib.sha256(payload.encode()).hexdigest()
        existing=db().execute('SELECT id,sha256 FROM fab_data_runs WHERE equipment_id=? AND chamber_id=? AND run_id=?',(packet['equipmentId'],packet['chamberId'],packet['runId'])).fetchone()
        if existing:
            if existing['sha256']!=sha:abort(409,description='동일 장비·챔버·운전 ID의 다른 데이터가 이미 있습니다. 기존 기록은 유지됩니다.')
            return jsonify(id=existing['id'],sha256=sha,duplicate=True,source_verified=False)
        identifier=uid()
        db().execute('INSERT INTO fab_data_runs VALUES(?,?,?,?,?,?,?,?,?)',(identifier,packet['equipmentId'],packet['chamberId'],packet['runId'],payload,sha,g.user['id'],now(),packet['source']))
        audit('fab_data.ingested',identifier,{'sha256':sha,'equipment_id':packet['equipmentId'],'run_id':packet['runId']})
        return jsonify(id=identifier,sha256=sha,duplicate=False,source_verified=False),201

    @app.get('/api/fab-data/runs')
    def listing():
        return jsonify(rows('SELECT id,equipment_id,chamber_id,run_id,sha256,received_at,source FROM fab_data_runs ORDER BY received_at DESC LIMIT 100'))

    @app.get('/api/fab-data/runs/<identifier>')
    def retrieve(identifier):
        record=one('SELECT * FROM fab_data_runs WHERE id=?',(identifier,))
        return jsonify(id=record['id'],sha256=record['sha256'],received_at=record['received_at'],source_verified=False,packet=json.loads(record['payload_json']))
