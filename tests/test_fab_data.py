import copy
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from waitress import create_server
from server.app import create_app
from server.fab_data import validate_packet
from server.model import ValidationError

ROOT=Path(__file__).resolve().parent.parent

def example(run='RUN'):
    return dict(schema='waferflow-fab-telemetry-v1',equipmentId='EQ01',chamberId='A',runId=run,lotId='LOT01',waferId='W01',tool='clean',startedAt='2026-09-21T00:00:00Z',processStart=0,processEnd=10,status='completed',source='synthetic',channels={'TEMP':{'unit':'K'}},samples=[{'t':t,'quality':'good','values':{'TEMP':333.15}} for t in [0,5,10]])

class FabDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.app=create_app(Path(cls.tmp.name)/'review.sqlite3',testing=True)
        cls.admin=cls.app.test_client()
        cls.password='temporary-fab-data-test-1234'
        me=cls.admin.post('/api/bootstrap',json={'username':'dataadmin','display_name':'Admin','password':cls.password},headers={'X-WaferFlow':'review'}).json
        cls.headers={'X-WaferFlow':'review','X-CSRF-Token':me['csrf']}
        cls.reader=cls.app.test_client()
        cls.admin.post('/api/users',json={'username':'datareader','display_name':'Reader','password':cls.password,'role':'reviewer'},headers=cls.headers)
        me=cls.reader.post('/api/login',json={'username':'datareader','password':cls.password},headers={'X-WaferFlow':'review'}).json
        cls.reader_headers={'X-WaferFlow':'review','X-CSRF-Token':me['csrf']}
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def post(self,packet):return self.admin.post('/api/fab-data/runs',json=packet,headers=self.headers)
    def test_round_trip_dedup_conflict_and_audit(self):
        p=example(self._testMethodName);created=self.post(p)
        self.assertEqual(created.status_code,201)
        duplicate=self.post(copy.deepcopy(p));self.assertEqual(duplicate.status_code,200);self.assertTrue(duplicate.json['duplicate'])
        self.assertEqual(created.json['sha256'],duplicate.json['sha256'])
        fetched=self.admin.get('/api/fab-data/runs/'+created.json['id']).json
        self.assertEqual(fetched['packet'],p);self.assertFalse(fetched['source_verified'])
        p['samples'][0]['values']['TEMP']=334
        self.assertEqual(self.post(p).status_code,409)
        self.assertNotEqual(self.admin.get('/api/fab-data/runs/'+created.json['id']).json['packet'],p)
        self.assertTrue(any(a['action']=='fab_data.ingested' for a in self.admin.get('/api/audit').json))
    def test_authentication_csrf_and_role(self):
        p=example(self._testMethodName)
        self.assertEqual(self.app.test_client().get('/api/fab-data/runs').status_code,401)
        self.assertEqual(self.admin.post('/api/fab-data/runs',json=p,headers={'X-WaferFlow':'review'}).status_code,403)
        self.assertEqual(self.reader.post('/api/fab-data/runs',json=p,headers=self.reader_headers).status_code,403)
        self.assertEqual(self.reader.get('/api/fab-data/runs').status_code,200)
    def test_invalid_samples_timestamps_and_metadata(self):
        cases=[lambda p:p.update(startedAt='2026-02-31T00:00:00Z'),lambda p:p.update(startedAt='2026-09-21T00:00:00'),lambda p:p.update(processEnd=11),lambda p:p['samples'][1].update(t=0),lambda p:p['samples'][1].update(values={'UNKNOWN':1}),lambda p:p['samples'][1].update(quality='ok'),lambda p:p['samples'][1]['values'].update(TEMP=True),lambda p:p.update(tool='unknown'),lambda p:p.update(samples=[]),lambda p:p.update(unknown=float('nan')),lambda p:p.update(equipmentId=' EQ01')]
        for change in cases:
            p=example(self._testMethodName);change(p)
            with self.subTest(packet=p):self.assertEqual(self.post(p).status_code,422)
    def test_raw_bad_quality_is_retained_for_review_not_marked_validated(self):
        p=example(self._testMethodName);p['samples'][1]['quality']='bad';p['source']='equipment-export'
        created=self.post(p);self.assertEqual(created.status_code,201)
        data=self.admin.get('/api/fab-data/runs/'+created.json['id']).json
        self.assertEqual(data['packet']['samples'][1]['quality'],'bad');self.assertFalse(data['source_verified'])
    def test_size_limit_and_invalid_numeric_values(self):
        p=example();p['samples'][0]['values']['TEMP']=float('nan')
        with self.assertRaises(ValidationError):validate_packet(p)
        response=self.admin.post('/api/fab-data/runs',data=' '*1500001,content_type='application/json',headers=self.headers)
        self.assertEqual(response.status_code,413)
    def test_overflowing_integers_are_validation_errors_without_partial_history(self):
        original=example(self._testMethodName+'-original')
        saved=self.post(original);self.assertEqual(saved.status_code,201)
        before=self.admin.get('/api/fab-data/runs').json
        audit=self.admin.get('/api/audit').json
        changes=[lambda p:p.update(processStart=10**400),lambda p:p.update(processEnd=10**400),
                 lambda p:p['samples'][1].update(t=10**400),
                 lambda p:p['samples'][0]['values'].update(TEMP=10**400),
                 lambda p:p['samples'][0]['values'].update(TEMP=-(10**400))]
        for index,change in enumerate(changes):
            packet=example(self._testMethodName+'-'+str(index));change(packet)
            with self.subTest(index=index):
                response=self.post(packet)
                self.assertEqual(response.status_code,422)
                self.assertIn('유한한 숫자',response.json['error'])
        self.assertEqual(self.admin.get('/api/fab-data/runs').json,before)
        self.assertEqual(self.admin.get('/api/audit').json,audit)
        self.assertEqual(self.admin.get('/api/fab-data/runs/'+saved.json['id']).json['packet'],original)
        # Rejected input did not reserve the identity or leave a partial row.
        self.assertEqual(self.post(example(self._testMethodName+'-0')).status_code,201)
        finite=example();finite['samples'][0]['values']['TEMP']=1e308
        self.assertEqual(validate_packet(finite),finite)
    def test_invalid_offset_components_cannot_be_normalized_into_saved_runs(self):
        before=self.admin.get('/api/fab-data/runs').json
        audit=self.admin.get('/api/audit').json
        for offset in ['+00:60','-00:60','+09:99','-09:99','+24:00','-24:00']:
            packet=example(self._testMethodName);packet['startedAt']='2026-09-21T00:00:00'+offset
            with self.subTest(offset=offset):self.assertEqual(self.post(packet).status_code,422)
        self.assertEqual(self.admin.get('/api/fab-data/runs').json,before)
        self.assertEqual(self.admin.get('/api/audit').json,audit)
        valid=example(self._testMethodName);valid['startedAt']='2026-09-21T00:00:00.123+09:30'
        saved=self.post(valid);self.assertEqual(saved.status_code,201)
        self.assertEqual(self.admin.get('/api/fab-data/runs/'+saved.json['id']).json['packet'],valid)
        self.assertTrue(self.post(copy.deepcopy(valid)).json['duplicate'])
    def test_collector_script_against_real_local_server(self):
        server=create_server(self.app,host='127.0.0.1',port=0)
        threading.Thread(target=server.run,daemon=True).start()
        path=Path(self.tmp.name)/'collector.json';path.write_text(json.dumps(example(self._testMethodName)),encoding='utf-8')
        try:
            env=os.environ.copy();env['WF_COLLECTOR_PASSWORD']=self.password
            args=[sys.executable,str(ROOT/'tools/push_fab_data.py'),'--url',f'http://127.0.0.1:{server.effective_port}','--username','dataadmin','--file',str(path)]
            a=subprocess.run(args,env=env,capture_output=True,text=True,check=True,timeout=30)
            first=json.loads(a.stdout);self.assertFalse(first['duplicate'])
            b=subprocess.run(args,env=env,capture_output=True,text=True,check=True,timeout=30)
            self.assertTrue(json.loads(b.stdout)['duplicate'])
            self.assertEqual(self.admin.get('/api/fab-data/runs/'+first['id']).status_code,200)
        finally:server.close()

if __name__=='__main__':unittest.main()
