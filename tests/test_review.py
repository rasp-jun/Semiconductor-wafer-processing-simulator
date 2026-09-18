import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from server.app import create_app, encoded
from server.backup import backup
from server.model import CATALOG, ValidationError, parse_measurements, simulate

ROOT = Path(__file__).resolve().parent.parent
PASSWORD = 'test-only-password-1234'
CSV = 'wafer_id,site_id,cd_nm,etch_depth_nm\nW1,S1,490,99\nW1,S2,510,101\nW2,S1,530,100\n'


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.database = Path(self.temp.name)/'review.sqlite3'
        self.app = create_app(self.database, testing=True)
        self.admin, self.engineer, self.reviewer = [self.app.test_client() for _ in range(3)]
        self.tokens = {}
        result = self.post(self.admin, '/bootstrap', dict(username='admin', display_name='관리자', password=PASSWORD))
        self.assertEqual(result.status_code, 200)
        self.tokens[id(self.admin)] = result.json['csrf']
        for username, role, client in [('engineer','engineer',self.engineer), ('reviewer','reviewer',self.reviewer)]:
            self.assertEqual(self.post(self.admin, '/users', dict(username=username, display_name=username, role=role, password=PASSWORD)).status_code, 201)
            self.tokens[id(client)] = self.post(client, '/login', dict(username=username, password=PASSWORD)).json['csrf']
        self.project_id = self.post(self.engineer, '/projects', dict(name='PR 조건 검토', description='Regression project')).json['id']
        self.recipe_payload = dict(name='PR baseline', params=CATALOG['defaults'], scenario='residue', change_reason='노광·현상 조건 가설 검토')
        created = self.post(self.engineer, f'/projects/{self.project_id}/recipes', self.recipe_payload)
        self.recipe_id, self.revision_id = created.json['id'], created.json['revision_id']

    def tearDown(self):
        self.temp.cleanup()

    def post(self, client, path, data, **kwargs):
        return client.post('/api'+path, json=data, headers={'X-WaferFlow':'review', 'X-CSRF-Token':self.tokens.get(id(client),'')}, **kwargs)

    def simulation(self):
        result = self.post(self.engineer, f'/revisions/{self.revision_id}/experiments', dict(kind='simulation', name='재현 실행', lot_id='SIM-01', seed=902))
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def submit(self):
        self.simulation()
        result = self.post(self.engineer, f'/revisions/{self.revision_id}/transition', dict(action='submit',lock_version=1))
        self.assertEqual(result.status_code, 200, result.json)

    def test_unauthorized_api_and_server_files_are_inaccessible(self):
        anonymous = self.app.test_client()
        for path in ['/api/projects','/api/audit','/api/me', '/api/projects/'+self.project_id+'/export']:
            self.assertEqual(anonymous.get(path).status_code, 401)
        for path in ['/.data/waferflow.sqlite3','/server/app.py','/backup/pre-quality/app.js','/tests/model-fixtures.json','/.env']:
            self.assertEqual(anonymous.get(path).status_code,404)

    def test_csrf_cross_origin_and_host_validation(self):
        self.assertEqual(self.engineer.post('/api/projects',json={'name':'blocked'}).status_code,403)
        headers={'X-WaferFlow':'review','X-CSRF-Token':self.tokens[id(self.engineer)],'Origin':'https://untrusted.example'}
        self.assertEqual(self.engineer.post('/api/projects',json={'name':'blocked'},headers=headers).status_code,403)
        self.assertEqual(self.admin.get('/api/status',headers={'Host':'untrusted.example'}).status_code,400)

    def test_bootstrap_is_single_use_and_no_default_credentials(self):
        self.assertEqual(self.post(self.admin,'/bootstrap',dict(username='second',display_name='second',password=PASSWORD)).status_code,409)
        self.assertEqual(self.post(self.app.test_client(),'/login',dict(username='admin',password='admin')).status_code,401)

    def test_role_checks_are_enforced_by_server(self):
        self.assertEqual(self.post(self.reviewer,'/projects',dict(name='not permitted')).status_code,403)
        self.assertEqual(self.engineer.get('/api/users').status_code,403)
        self.assertEqual(self.post(self.reviewer,f'/revisions/{self.revision_id}/experiments',dict(kind='simulation')).status_code,403)

    def test_validated_recipe_rejects_missing_extra_nonfinite_out_of_range(self):
        invalid=[{},dict(CATALOG['defaults'],power=999),dict(CATALOG['defaults'],power=True),dict(CATALOG['defaults'],focus=float('nan')),dict(CATALOG['defaults'],unknown=1),dict(CATALOG['defaults'],dose=100.5)]
        for params in invalid:
            response=self.post(self.engineer,f'/projects/{self.project_id}/recipes',dict(self.recipe_payload,params=params))
            self.assertEqual(response.status_code,422,response.json)
        detail=self.engineer.get('/api/projects/'+self.project_id).json
        self.assertEqual(len(detail['recipes']),1,'Failed mutations must roll back partial recipe insertion')

    def test_server_recomputes_result_instead_of_trusting_client(self):
        result=self.post(self.engineer,f'/revisions/{self.revision_id}/experiments',dict(kind='simulation',name='client fake',lot_id='SIM',seed=902,result={'yield_percent':100})).json
        self.assertEqual(result['result']['yield_percent'],97.5)
        self.assertEqual(result['result']['source'],'synthetic-educational-model')
        self.assertEqual(result['digest'],hashlib.sha256(encoded(result['result']).encode()).hexdigest())
        self.assertEqual(len(result['result']['engine_sha256']),64)

    def test_revisions_are_immutable_and_change_has_new_identity(self):
        before=self.engineer.get('/api/revisions/'+self.revision_id).json
        data=dict(self.recipe_payload,params=dict(CATALOG['defaults'],dose=110),base_revision_id=self.revision_id)
        response=self.post(self.engineer,f'/recipes/{self.recipe_id}/revisions',data)
        self.assertEqual(response.status_code,201)
        self.assertNotEqual(response.json['revision_id'],self.revision_id)
        after=self.engineer.get('/api/revisions/'+self.revision_id).json
        self.assertEqual(before,after)
        with closing(sqlite3.connect(self.database)) as con:
            with self.assertRaises(sqlite3.IntegrityError):
                con.execute('UPDATE revisions SET params_json=? WHERE id=?',('{}',self.revision_id))

    def test_conflicting_writers_cannot_overwrite_or_fork_same_latest(self):
        data=dict(self.recipe_payload,base_revision_id=self.revision_id)
        clients=[self.app.test_client(),self.app.test_client()]
        for client in clients:
            self.tokens[id(client)]=self.post(client,'/login',dict(username='engineer',password=PASSWORD)).json['csrf']
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses=list(pool.map(lambda c:self.post(c,f'/recipes/{self.recipe_id}/revisions',data).status_code,clients))
        self.assertEqual(sorted(statuses),[201,409])

    def test_submit_requires_evidence_and_self_approval_is_forbidden(self):
        response=self.post(self.engineer,f'/revisions/{self.revision_id}/transition',dict(action='submit',lock_version=1))
        self.assertEqual(response.status_code,409)
        own=self.post(self.admin,f'/projects/{self.project_id}/recipes',self.recipe_payload).json['revision_id']
        self.assertEqual(self.post(self.admin,f'/revisions/{own}/experiments',dict(kind='simulation',name='evidence',lot_id='SIM')).status_code,201)
        self.assertEqual(self.post(self.admin,f'/revisions/{own}/transition',dict(action='submit',lock_version=1)).status_code,200)
        self.assertEqual(self.post(self.admin,f'/revisions/{own}/transition',dict(action='approve',lock_version=2,note='self')).status_code,403)

    def test_peer_review_freezes_evidence_and_preserves_review_notes(self):
        self.submit()
        extra=self.post(self.engineer,f'/revisions/{self.revision_id}/experiments',dict(kind='simulation',name='extra',lot_id='SIM'))
        self.assertEqual(extra.status_code,409)
        response=self.post(self.reviewer,f'/revisions/{self.revision_id}/transition',dict(action='approve',lock_version=2,note='모델 가정을 확인함. 실측 보정은 후속 검토 필요.'))
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['status'],'approved')
        self.assertIn('실측',response.json['review_note'])
        self.assertEqual(self.post(self.reviewer,f'/revisions/{self.revision_id}/transition',dict(action='reject',lock_version=2,note='stale')).status_code,409)

    def test_rejection_requires_new_revision_and_cannot_resubmit(self):
        self.submit()
        rejected=self.post(self.reviewer,f'/revisions/{self.revision_id}/transition',dict(action='reject',lock_version=2,note='근거 보완 필요'))
        self.assertEqual(rejected.json['status'],'rejected')
        self.assertEqual(self.post(self.engineer,f'/revisions/{self.revision_id}/transition',dict(action='submit',lock_version=3)).status_code,409)

    def test_measurement_import_statistics_provenance_and_original_rows(self):
        data=dict(kind='measurement',name='계측 기록',lot_id='LOT-01',source_name='User-provided CD file',csv=CSV,cd_lsl_nm=480,cd_usl_nm=520)
        response=self.post(self.engineer,f'/revisions/{self.revision_id}/experiments',data)
        self.assertEqual(response.status_code,201,response.json)
        result=response.json['result']
        self.assertEqual(result['cd_mean_nm'],510)
        self.assertEqual(result['cd_stdev_nm'],20)
        self.assertEqual(result['within_spec_count'],2)
        self.assertEqual(result['wafer_count'],2)
        self.assertEqual(len(result['rows']),3)
        self.assertEqual(result['source'],'user-supplied-measurement-unverified')
        demo=self.post(self.engineer,f'/revisions/{self.revision_id}/experiments',dict(data,kind='demo'))
        self.assertEqual(demo.json['result']['source'],'synthetic-csv-example')

    def test_export_contains_evidence_versions_and_audit_but_no_credentials(self):
        saved=self.simulation()
        exported=self.engineer.get(f'/api/projects/{self.project_id}/export').json
        self.assertEqual(exported['schema'],'waferflow-review-export-v1')
        self.assertEqual(exported['experiments'][0]['digest'],saved['digest'])
        self.assertTrue(any(a['action']=='experiment.created' for a in exported['audit']))
        for secret in ['password_hash','token_hash','csrf',PASSWORD]:
            self.assertNotIn(secret,json.dumps(exported))

    def test_backup_restores_records_and_integrity(self):
        saved=self.simulation()
        destination=backup(self.database,Path(self.temp.name)/'snapshot.sqlite3')
        restored=create_app(destination,testing=True).test_client()
        login=restored.post('/api/login',json=dict(username='engineer',password=PASSWORD),headers={'X-WaferFlow':'review'})
        self.assertEqual(login.status_code,200)
        self.assertEqual(restored.get('/api/projects/'+self.project_id).json['experiments'][0]['digest'],saved['digest'])
        with self.assertRaises(ValueError):
            backup(self.database,destination)

    def test_user_deactivation_revokes_existing_sessions(self):
        users=self.admin.get('/api/users').json
        user_id=next(u['id'] for u in users if u['username']=='engineer')
        self.assertEqual(self.post(self.admin,f'/users/{user_id}/active',dict(active=False)).status_code,200)
        self.assertEqual(self.engineer.get('/api/projects').status_code,401)
        self.assertEqual(self.post(self.engineer,'/login',dict(username='engineer',password=PASSWORD)).status_code,401)

    def test_login_rate_limit_and_cookie_flags(self):
        client=self.app.test_client()
        for _ in range(8):
            self.assertEqual(self.post(client,'/login',dict(username='missing',password='incorrect-password')).status_code,401)
        self.assertEqual(self.post(client,'/login',dict(username='missing',password='incorrect-password')).status_code,429)
        response=self.post(client,'/login',dict(username='reviewer',password=PASSWORD))
        self.assertIn('HttpOnly',response.headers['Set-Cookie'])
        self.assertIn('SameSite=Strict',response.headers['Set-Cookie'])
        self.assertEqual(response.headers['Cache-Control'],'no-store')

    def test_logout_and_password_change(self):
        second=self.app.test_client()
        self.tokens[id(second)]=self.post(second,'/login',dict(username='engineer',password=PASSWORD)).json['csrf']
        result=self.post(self.engineer,'/password',dict(current_password=PASSWORD,new_password='new-test-password-123'))
        self.assertEqual(result.status_code,200)
        self.assertEqual(second.get('/api/me').status_code,401)
        self.assertEqual(self.engineer.get('/api/me').status_code,200)
        self.assertEqual(self.post(self.engineer,'/logout',{}).status_code,200)
        self.assertEqual(self.engineer.get('/api/me').status_code,401)

    def test_audit_and_results_cannot_be_edited_or_deleted(self):
        experiment=self.simulation()
        with closing(sqlite3.connect(self.database)) as con:
            for sql,args in [('DELETE FROM experiments WHERE id=?',(experiment['id'],)),('UPDATE experiments SET result_json=? WHERE id=?',('{}',experiment['id'])),('DELETE FROM audit',())]:
                with self.assertRaises(sqlite3.IntegrityError):
                    con.execute(sql,args)


class ModelAndImportTests(unittest.TestCase):
    def test_server_matches_browser_fixtures_across_missions_and_bounds(self):
        fixtures=json.loads((ROOT/'tests'/'model-fixtures.json').read_text(encoding='utf-8'))
        for fixture in fixtures:
            result=simulate(fixture['params'],fixture['scenario'])
            for key in ['total','bad','yield_percent','cd_nm','etch_depth_nm']:
                self.assertEqual(result[key],fixture['expected'][key],(fixture['scenario'],key))
            for actual,expected in zip(result['dies'],fixture['expected']['dies']):
                for key in expected:
                    self.assertEqual(actual[key],expected[key],(fixture['scenario'],actual['x'],actual['y'],key))

    def test_invalid_csv_is_rejected_without_partial_statistics(self):
        invalid=['', 'wafer,site,cd,depth\nW1,S1,500,100', CSV+'W1,S1,500,100\n', CSV.replace('490','NaN'), CSV.replace('490','-1'), CSV.replace('490','inf'), CSV.replace('490','1e309'), CSV+'W3,S1,500\n']
        for data in invalid:
            with self.assertRaises(ValidationError):
                parse_measurements(data,480,520)
        with self.assertRaises(ValidationError):
            parse_measurements(CSV,520,480)

    def test_small_sample_has_no_fabricated_standard_deviation(self):
        result=parse_measurements('wafer_id,site_id,cd_nm,etch_depth_nm\nW1,S1,500,100',480,520)
        self.assertIsNone(result['cd_stdev_nm'])
        self.assertEqual(result['within_spec_percent'],100)
        self.assertNotIn('cpk',result)


if __name__ == '__main__':
    unittest.main(verbosity=2)
