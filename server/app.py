"""Single-organization review workspace. Persisted evidence, explicit provenance."""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from flask import Flask, abort, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from .model import CATALOG, ValidationError, parse_measurements, simulate, validate_params
from .equipment import register_equipment

ROOT = Path(__file__).resolve().parent.parent
VERSION = '0.4.1'
COOKIE = 'wf_session'


def now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def uid():
    return str(uuid4())


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def create_app(database=None, testing=False):
    app = Flask(__name__, static_folder=None)
    database = Path(database or os.getenv('WF_DATABASE', str(ROOT / '.data' / 'waferflow.sqlite3')))
    database.parent.mkdir(parents=True, exist_ok=True)
    app.config.update(TESTING=testing, DATABASE=str(database), MAX_CONTENT_LENGTH=1500000,
                      PUBLIC_ASSET_MANIFEST=ROOT / 'server' / 'public-assets.json',
                      TRUSTED_HOSTS=os.getenv('WF_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]').split(','),
                      COOKIE_SECURE=os.getenv('WF_COOKIE_SECURE', '0') == '1')
    with closing(sqlite3.connect(database)) as connection:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.executescript((ROOT / 'server' / 'schema.sql').read_text(encoding='utf-8'))
        connection.executescript((ROOT / 'server' / 'equipment-schema.sql').read_text(encoding='utf-8'))
        if connection.execute('SELECT MAX(version) FROM schema_version').fetchone()[0] != 1:
            raise RuntimeError('Unsupported database schema version')

    def db():
        if 'db' not in g:
            g.db = sqlite3.connect(app.config['DATABASE'], timeout=10, isolation_level=None)
            g.db.row_factory = sqlite3.Row
            g.db.execute('PRAGMA foreign_keys=ON')
            g.db.execute('PRAGMA busy_timeout=10000')
        return g.db

    def one(sql, values=()):
        row = db().execute(sql, values).fetchone()
        if row is None:
            abort(404, description='항목을 찾을 수 없습니다.')
        return dict(row)

    def rows(sql, values=()):
        return [dict(r) for r in db().execute(sql, values).fetchall()]

    def body():
        value = request.get_json(silent=True)
        if not isinstance(value, dict):
            raise ValidationError('JSON 객체가 필요합니다.')
        return value

    def text(value, label, limit=200, required=True):
        if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
            raise ValidationError(f'{label}: {1 if required else 0}–{limit}자 텍스트가 필요합니다.')
        if any(ord(c) < 32 and c not in '\n\t' for c in value):
            raise ValidationError(f'{label}: 제어 문자는 사용할 수 없습니다.')
        return value.strip()

    def require_roles(*roles):
        if g.user['role'] not in roles:
            abort(403, description='이 작업을 수행할 권한이 없습니다.')

    def audit(action, entity, details=None):
        db().execute('INSERT INTO audit(actor_id,action,entity_id,details_json,created_at) VALUES(?,?,?,?,?)',
                     (g.user['id'] if g.get('user') else None, action, entity, encoded(details or {}), now()))

    def user_public(user):
        return {k: user[k] for k in ('id', 'username', 'display_name', 'role', 'active')}

    def add_user(data, role=None):
        username = text(data.get('username'), '아이디', 60).lower()
        if not re.fullmatch(r'[a-z0-9_.@-]{3,60}', username):
            raise ValidationError('아이디는 영문·숫자·_.@- 3–60자입니다.')
        password = data.get('password')
        if not isinstance(password, str) or not 12 <= len(password) <= 128:
            raise ValidationError('비밀번호는 12–128자여야 합니다.')
        role = role or data.get('role')
        if role not in ('admin', 'engineer', 'reviewer'):
            raise ValidationError('허용되지 않은 역할입니다.')
        if db().execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone():
            abort(409, description='이미 사용 중인 아이디입니다.')
        user_id = uid()
        db().execute('INSERT INTO users VALUES(?,?,?,?,?,?,?)', (user_id, username, text(data.get('display_name'), '이름', 60), generate_password_hash(password, method='scrypt:32768:8:1'), role, 1, now()))
        return one('SELECT * FROM users WHERE id=?', (user_id,))

    def login_response(user):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        db().execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
        db().execute('INSERT INTO sessions VALUES(?,?,?,?)', (digest(token), user['id'], csrf, time.time()+8*3600))
        response = jsonify(user=user_public(user), csrf=csrf)
        response.set_cookie(COOKIE, token, max_age=8*3600, httponly=True, secure=app.config['COOKIE_SECURE'], samesite='Strict', path='/')
        return response

    @app.before_request
    def authenticate():
        if not request.path.startswith('/api/'):
            return
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('X-WaferFlow') != 'review':
                abort(403, description='요청 검증 헤더가 필요합니다.')
            origin = request.headers.get('Origin')
            if origin and origin.rstrip('/') != request.host_url.rstrip('/'):
                abort(403, description='다른 출처의 요청은 허용하지 않습니다.')
            if not request.is_json:
                abort(415, description='application/json 요청이 필요합니다.')
        public = {'/api/status', '/api/bootstrap', '/api/login'}
        if request.path not in public:
            token = request.cookies.get(COOKIE, '')
            session = db().execute('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.active=1', (digest(token), time.time())).fetchone()
            if not session:
                abort(401, description='로그인이 필요합니다.')
            g.user = dict(session)
            if request.method not in ('GET', 'HEAD', 'OPTIONS') and not hmac.compare_digest(g.user['csrf'], request.headers.get('X-CSRF-Token', '')):
                abort(403, description='세션 검증에 실패했습니다. 다시 로그인하세요.')
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            db().execute('BEGIN IMMEDIATE')

    @app.after_request
    def finish(response):
        if 'db' in g and g.db.in_transaction:
            g.db.commit() if response.status_code < 400 else g.db.rollback()
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        if app.config['COOKIE_SECURE']:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.teardown_appcontext
    def close(_error):
        if 'db' in g:
            g.db.close()

    @app.errorhandler(ValidationError)
    def invalid(error):
        return jsonify(error=str(error)), 422

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.errorhandler(sqlite3.Error)
    def database_error(error):
        app.logger.exception('Database operation failed')
        return jsonify(error='저장하지 못했습니다. 잠시 후 다시 시도하세요.'), 503

    @app.get('/api/status')
    def status():
        return jsonify(version=VERSION, initialized=bool(db().execute('SELECT 1 FROM users LIMIT 1').fetchone()), model_version=CATALOG['version'], storage='SQLite', scope='single-organization-review')

    @app.post('/api/bootstrap')
    def bootstrap():
        if db().execute('SELECT 1 FROM users LIMIT 1').fetchone():
            abort(409, description='초기 설정이 이미 완료되었습니다.')
        if request.remote_addr not in ('127.0.0.1', '::1'):
            abort(403, description='최초 관리자 설정은 서버의 localhost에서 진행하세요.')
        g.user = add_user(body(), 'admin')
        audit('workspace.initialized', g.user['id'])
        return login_response(g.user)

    @app.post('/api/login')
    def login():
        data = body()
        username = text(data.get('username'), '아이디', 60).lower()
        password = data.get('password', '')
        if not isinstance(password, str) or len(password)>128:
            abort(401, description='아이디 또는 비밀번호를 확인하세요.')
        attempt_key = digest(str(request.remote_addr)+'|'+username)
        db().execute('DELETE FROM login_attempts WHERE attempted<?', (time.time()-900,))
        if db().execute('SELECT COUNT(*) FROM login_attempts WHERE key=?', (attempt_key,)).fetchone()[0] >= 8:
            abort(429, description='로그인 시도가 많습니다. 15분 후 다시 시도하세요.')
        user = db().execute('SELECT * FROM users WHERE username=? AND active=1', (username,)).fetchone()
        if not user or not check_password_hash(user['password_hash'], password):
            db().execute('INSERT INTO login_attempts VALUES(?,?)', (attempt_key, time.time()))
            db().commit()
            abort(401, description='아이디 또는 비밀번호를 확인하세요.')
        db().execute('DELETE FROM login_attempts WHERE key=?', (attempt_key,))
        g.user = dict(user)
        audit('session.login', user['id'])
        return login_response(user)

    @app.get('/api/me')
    def me():
        return jsonify(user=user_public(g.user), csrf=g.user['csrf'], catalog=CATALOG)

    @app.post('/api/logout')
    def logout():
        db().execute('DELETE FROM sessions WHERE token_hash=?', (digest(request.cookies.get(COOKIE, '')),))
        audit('session.logout', g.user['id'])
        response = jsonify(ok=True)
        response.delete_cookie(COOKIE, path='/', secure=app.config['COOKIE_SECURE'], httponly=True, samesite='Strict')
        return response

    @app.post('/api/password')
    def password():
        data = body()
        old, new = data.get('current_password', ''), data.get('new_password', '')
        if not isinstance(old, str) or not check_password_hash(g.user['password_hash'], old):
            abort(403, description='현재 비밀번호를 확인하세요.')
        if not isinstance(new, str) or not 12<=len(new)<=128:
            raise ValidationError('새 비밀번호는 12–128자여야 합니다.')
        db().execute('UPDATE users SET password_hash=? WHERE id=?', (generate_password_hash(new, method='scrypt:32768:8:1'), g.user['id']))
        db().execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', (g.user['id'], digest(request.cookies.get(COOKIE, ''))))
        audit('user.password_changed', g.user['id'])
        return jsonify(ok=True)

    @app.route('/api/users', methods=['GET', 'POST'])
    def users():
        require_roles('admin')
        if request.method == 'POST':
            user = add_user(body())
            audit('user.created', user['id'], {'role': user['role']})
            return jsonify(user_public(user)), 201
        return jsonify(rows('SELECT id,username,display_name,role,active,created_at FROM users ORDER BY created_at'))

    @app.post('/api/users/<user_id>/active')
    def activate(user_id):
        require_roles('admin')
        if user_id == g.user['id']:
            abort(409, description='자신의 계정은 비활성화할 수 없습니다.')
        one('SELECT id FROM users WHERE id=?', (user_id,))
        active = body().get('active')
        if not isinstance(active, bool):
            raise ValidationError('active는 true 또는 false여야 합니다.')
        db().execute('UPDATE users SET active=? WHERE id=?', (int(active), user_id))
        db().execute('DELETE FROM sessions WHERE user_id=?', (user_id,))
        audit('user.activated' if active else 'user.deactivated', user_id)
        return jsonify(ok=True)

    @app.route('/api/projects', methods=['GET', 'POST'])
    def projects():
        if request.method == 'POST':
            require_roles('admin', 'engineer')
            data, project_id = body(), uid()
            db().execute('INSERT INTO projects VALUES(?,?,?,?,?)', (project_id, text(data.get('name'), '프로젝트 이름', 100), text(data.get('description', ''), '목적', 1000, False), g.user['id'], now()))
            audit('project.created', project_id)
            return jsonify(id=project_id), 201
        return jsonify(rows('SELECT p.*,u.display_name AS author,(SELECT COUNT(*) FROM recipes WHERE project_id=p.id) AS recipe_count FROM projects p JOIN users u ON u.id=p.created_by ORDER BY p.created_at DESC'))

    def revision_public(row):
        row = dict(row)
        row['params'] = json.loads(row.pop('params_json'))
        return row

    def experiment_public(row, full=True):
        row = dict(row)
        row['result'] = json.loads(row.pop('result_json'))
        if not full:
            row['result'].pop('rows', None)
            row['result'].pop('dies', None)
        return row

    @app.get('/api/projects/<project_id>')
    def project(project_id, full=False):
        project_data = one('SELECT * FROM projects WHERE id=?', (project_id,))
        recipes_data = rows('SELECT * FROM recipes WHERE project_id=? ORDER BY created_at DESC', (project_id,))
        revisions = rows('SELECT v.*,u.display_name AS author,r.name AS recipe_name FROM revisions v JOIN recipes r ON r.id=v.recipe_id JOIN users u ON u.id=v.created_by WHERE r.project_id=? ORDER BY v.created_at DESC', (project_id,))
        experiments = rows('SELECT e.*,u.display_name AS author,v.number AS revision_number,r.name AS recipe_name FROM experiments e JOIN revisions v ON v.id=e.revision_id JOIN recipes r ON r.id=v.recipe_id JOIN users u ON u.id=e.created_by WHERE r.project_id=? ORDER BY e.created_at DESC', (project_id,))
        return jsonify(project=project_data, recipes=recipes_data, revisions=[revision_public(r) for r in revisions], experiments=[experiment_public(e, full=full) for e in experiments])

    @app.get('/api/experiments/<experiment_id>')
    def experiment_detail(experiment_id):
        return jsonify(experiment_public(one('SELECT e.*,u.display_name AS author,v.number AS revision_number,r.name AS recipe_name FROM experiments e JOIN revisions v ON v.id=e.revision_id JOIN recipes r ON r.id=v.recipe_id JOIN users u ON u.id=e.created_by WHERE e.id=?', (experiment_id,))))

    def add_revision(recipe_id, data, parent=None):
        params = validate_params(data.get('params'))
        if data.get('scenario') not in {m['id'] for m in CATALOG['missions']}:
            raise ValidationError('모델 시나리오를 선택하세요.')
        revision_id = uid()
        db().execute('INSERT INTO revisions(id,recipe_id,number,parent_id,params_json,scenario,model_version,change_reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                     (revision_id, recipe_id, parent['number']+1 if parent else 1, parent['id'] if parent else None, encoded(params), data['scenario'], CATALOG['version'], text(data.get('change_reason'), '변경 사유', 2000), g.user['id'], now()))
        audit('revision.created', revision_id, {'recipe_id': recipe_id, 'parent_id': parent['id'] if parent else None})
        return revision_id

    @app.post('/api/projects/<project_id>/recipes')
    def new_recipe(project_id):
        require_roles('admin', 'engineer')
        one('SELECT id FROM projects WHERE id=?', (project_id,))
        data, recipe_id = body(), uid()
        db().execute('INSERT INTO recipes VALUES(?,?,?,?,?)', (recipe_id, project_id, text(data.get('name'), '레시피 이름', 100), g.user['id'], now()))
        revision_id = add_revision(recipe_id, data)
        return jsonify(id=recipe_id, revision_id=revision_id), 201

    @app.post('/api/recipes/<recipe_id>/revisions')
    def revise(recipe_id):
        require_roles('admin', 'engineer')
        one('SELECT id FROM recipes WHERE id=?', (recipe_id,))
        latest = one('SELECT * FROM revisions WHERE recipe_id=? ORDER BY number DESC LIMIT 1', (recipe_id,))
        data = body()
        if data.get('base_revision_id') != latest['id']:
            abort(409, description='다른 변경안이 먼저 저장되었습니다. 새로고침 후 최신 버전을 기준으로 작성하세요.')
        revision_id = add_revision(recipe_id, data, latest)
        return jsonify(revision_id=revision_id), 201

    @app.get('/api/revisions/<revision_id>')
    def revision(revision_id):
        return jsonify(revision_public(one('SELECT v.*,r.name AS recipe_name,r.project_id,u.display_name AS author FROM revisions v JOIN recipes r ON r.id=v.recipe_id JOIN users u ON u.id=v.created_by WHERE v.id=?', (revision_id,))))

    @app.post('/api/revisions/<revision_id>/transition')
    def transition(revision_id):
        data, revision = body(), one('SELECT * FROM revisions WHERE id=?', (revision_id,))
        if type(data.get('lock_version')) is not int or data['lock_version'] != revision['lock_version']:
            abort(409, description='검토 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.')
        action = data.get('action')
        if action == 'submit':
            require_roles('admin', 'engineer')
            if revision['created_by'] != g.user['id'] or revision['status'] != 'draft':
                abort(409, description='본인이 작성한 초안만 검토 요청할 수 있습니다.')
            if not db().execute('SELECT 1 FROM experiments WHERE revision_id=?', (revision_id,)).fetchone():
                abort(409, description='검토 근거로 시뮬레이션 또는 계측 결과를 먼저 연결하세요.')
            db().execute("UPDATE revisions SET status='submitted',lock_version=lock_version+1 WHERE id=?", (revision_id,))
        elif action in ('approve', 'reject'):
            require_roles('admin', 'reviewer')
            if revision['created_by'] == g.user['id']:
                abort(403, description='작성자는 자신의 변경안을 승인·반려할 수 없습니다.')
            if revision['status'] != 'submitted':
                abort(409, description='검토 요청 상태의 버전만 판정할 수 있습니다.')
            note = text(data.get('note'), '검토 의견', 2000)
            db().execute('UPDATE revisions SET status=?,reviewer_id=?,review_note=?,reviewed_at=?,lock_version=lock_version+1 WHERE id=?', ('approved' if action=='approve' else 'rejected', g.user['id'], note, now(), revision_id))
        else:
            raise ValidationError('허용되지 않은 상태 전환입니다.')
        audit('revision.'+action, revision_id, {'note': data.get('note', ''), 'previous_status': revision['status']})
        return jsonify(revision_public(one('SELECT * FROM revisions WHERE id=?', (revision_id,))))

    @app.post('/api/revisions/<revision_id>/experiments')
    def experiment(revision_id):
        require_roles('admin', 'engineer')
        data, revision = body(), one('SELECT * FROM revisions WHERE id=?', (revision_id,))
        if revision['status'] != 'draft' or revision['created_by'] != g.user['id']:
            abort(409, description='작성 중인 본인의 초안에만 근거를 추가할 수 있습니다. 검토 이후에는 새 버전을 만드세요.')
        kind = data.get('kind')
        if kind == 'simulation':
            if revision['model_version'] != CATALOG['version']:
                abort(409, description='버전 작성 당시 모델과 현재 모델이 다릅니다. 새 레시피 버전에서 실행하세요.')
            result = simulate(json.loads(revision['params_json']), revision['scenario'], data.get('seed'))
            result['engine_sha256'] = digest((ROOT / 'server' / 'model.py').read_text(encoding='utf-8'))
            result['catalog_sha256'] = digest(encoded(CATALOG))
        elif kind in ('measurement', 'demo'):
            result = parse_measurements(data.get('csv'), data.get('cd_lsl_nm'), data.get('cd_usl_nm'))
            result['source'] = 'user-supplied-measurement-unverified' if kind=='measurement' else 'synthetic-csv-example'
            result['source_name'] = text(data.get('source_name'), '데이터 출처', 200)
            result['file_sha256'] = digest(data['csv'])
        else:
            raise ValidationError('실험 데이터 유형을 선택하세요.')
        experiment_id, payload = uid(), encoded(result)
        db().execute('INSERT INTO experiments VALUES(?,?,?,?,?,?,?,?,?)', (experiment_id, revision_id, text(data.get('name'), '실험 이름', 100), text(data.get('lot_id'), 'Lot ID', 80), kind, payload, digest(payload), g.user['id'], now()))
        audit('experiment.created', experiment_id, {'revision_id': revision_id, 'kind': kind, 'sha256': digest(payload)})
        return jsonify(experiment_public(one('SELECT * FROM experiments WHERE id=?', (experiment_id,)))), 201

    @app.get('/api/audit')
    def audit_log():
        return jsonify(rows('SELECT a.*,u.display_name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.sequence DESC LIMIT 300'))

    @app.get('/api/projects/<project_id>/export')
    def export(project_id):
        payload = project(project_id, full=True).get_json()
        ids = {project_id} | {r['id'] for r in payload['recipes']+payload['revisions']+payload['experiments']}
        events = rows('SELECT a.*,u.display_name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.sequence')
        payload.update(schema='waferflow-review-export-v1', exported_at=now(), application_version=VERSION, model_catalog=CATALOG,
                       audit=[a for a in events if a['entity_id'] in ids], notice='검토 기록의 내보내기입니다. 승인 상태는 양산 투입 허가나 실측 검증 인증이 아닙니다.')
        response = jsonify(payload)
        response.headers['Content-Disposition'] = f'attachment; filename="waferflow-{project_id}.json"'
        return response

    register_equipment(app, db, one, rows, body, require_roles, audit, uid, now, encoded)

    @app.get('/')
    def home():
        return assets('index.html')

    @app.get('/<path:filename>')
    def assets(filename):
        # Re-read the explicit public list so new pages and their dependencies
        # become available together without restarting an unchanged backend.
        try:
            allowed = json.loads(Path(app.config['PUBLIC_ASSET_MANIFEST']).read_text(encoding='utf-8'))
            if not isinstance(allowed, list) or not all(isinstance(name, str) for name in allowed):
                raise ValueError('Public asset manifest must be a list of paths')
        except (OSError, ValueError):
            app.logger.exception('Cannot load public asset manifest')
            abort(503, description='화면 파일 목록을 읽지 못했습니다. server/public-assets.json 배포 상태를 확인하세요.')
        if filename not in allowed:
            abort(404)
        return send_from_directory(ROOT, filename)

    return app
