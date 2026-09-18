import copy
import hashlib
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from server.app import create_app, encoded
from server.equipment import summarize, validate_trace
from server.model import ValidationError


def trace():
    return {
        'schema': 'waferflow-equipment-trace-v1', 'modelVersion': 'wf-equipment-0.1.0', 'profileId': 'generic-ion-mill-synthetic-v1',
        'provenance': {'kind': 'measured', 'label': 'Untrusted claim'}, 'units': {'pressurePa': 'Pa', 'beamVoltageV': 'V'},
        'recipe': {'pressurePa': .3, 'beamVoltageV': 700, 'processSeconds': 5},
        'samples': [
            {'t': 0, 'stage': 'pump', 'values': {'pressurePa': 1000}},
            {'t': 2, 'stage': 'process', 'values': {'pressurePa': .3, 'beamVoltageV': 680}, 'targets': {'beamVoltageV': 700}, 'digital': {'beam': True, 'shutter': True}},
            {'t': 7, 'stage': 'cooldown', 'values': {'pressurePa': .3, 'beamVoltageV': 680}, 'digital': {'beam': False, 'shutter': False}},
            {'t': 8, 'stage': 'cooldown', 'values': {'pressurePa': .3, 'beamVoltageV': 10}, 'digital': {'beam': False, 'shutter': False}}
        ],
        'events': [{'t': 0, 'level': 'info', 'code': 'EXAMPLE', 'message': 'Synthetic test only'}],
        'outcome': {'status': 'completed', 'reason': 'Example log ended'}, 'duration': 8,
        'manufacturing_release': True, 'equipment_validation': 'validated'
    }


class EquipmentReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.database = Path(cls.tmp.name) / 'test.sqlite3'
        cls.app = create_app(cls.database, testing=True)
        cls.clients = {k: cls.app.test_client() for k in ('admin', 'engineer', 'reviewer')}
        cls.tokens = {}
        cls.password = 'test-equipment-only-1234'
        def post(client, path, value, csrf=''):
            return client.post('/api' + path, json=value, headers={'X-WaferFlow': 'review', 'X-CSRF-Token': csrf})
        admin = cls.clients['admin']
        me = post(admin, '/bootstrap', {'username': 'eqadmin', 'password': cls.password, 'display_name': 'Admin'}).json
        cls.tokens['admin'] = me['csrf']
        for role in ('engineer', 'reviewer'):
            created = post(admin, '/users', {'username': 'eq' + role, 'password': cls.password, 'display_name': role, 'role': role}, me['csrf'])
            assert created.status_code == 201
            logged = post(cls.clients[role], '/login', {'username': 'eq' + role, 'password': cls.password})
            cls.tokens[role] = logged.json['csrf']

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.project = self.post('engineer', '/projects', {'name': self._testMethodName, 'description': 'test'}).json['id']
        self.sequence = 0

    def post(self, role, path, value):
        return self.clients[role].post('/api' + path, json=value, headers={'X-WaferFlow': 'review', 'X-CSRF-Token': self.tokens[role]})

    def payload(self, **overrides):
        self.sequence += 1
        value = dict(project_id=self.project, title='Etch review', lot_id='SIM-1', change_reason='Compare recipe', source_name='Synthetic test fixture', trace=trace(), request_key=self.project + '-' + str(self.sequence))
        value.update(overrides)
        return value

    def save(self, **overrides):
        result = self.post('engineer', '/equipment/runs', self.payload(**overrides))
        self.assertEqual(result.status_code, 201, result.json)
        return result.json

    def transition(self, role, record, action, **values):
        return self.post(role, '/equipment/runs/' + record['id'] + '/transition', dict(action=action, lock_version=record['lock_version'], **values))

    def test_trace_normalization_and_server_summary(self):
        record = self.save()
        self.assertEqual(record['trace']['provenance']['kind'], 'unverified')
        self.assertFalse(record['manufacturing_release'])
        self.assertEqual(record['equipment_validation'], 'not_validated')
        self.assertNotIn('manufacturing_release', record['trace'])
        self.assertEqual(record['trace_sha256'], hashlib.sha256(encoded(record['trace']).encode()).hexdigest())
        self.assertEqual(record['summary']['stage_seconds']['process'], 5)
        self.assertEqual(record['summary']['channels']['beamVoltageV']['covered_seconds'], 6)
        self.assertAlmostEqual(record['summary']['channels']['beamVoltageV']['time_weighted_mean'], 680)

    def test_authentication_csrf_roles_and_cross_origin(self):
        guest = self.app.test_client()
        self.assertEqual(guest.get('/api/equipment/capabilities').status_code, 401)
        self.assertEqual(self.post('reviewer', '/equipment/runs', self.payload()).status_code, 403)
        self.assertEqual(self.clients['engineer'].post('/api/equipment/runs', json=self.payload(), headers={'X-WaferFlow':'review'}).status_code, 403)
        self.assertEqual(self.clients['engineer'].post('/api/equipment/runs', json=self.payload(), headers={'X-WaferFlow':'review','X-CSRF-Token':self.tokens['engineer'],'Origin':'https://external.invalid'}).status_code, 403)

    def test_duplicate_request_is_idempotent_and_changed_payload_conflicts(self):
        payload = self.payload()
        first = self.post('engineer', '/equipment/runs', payload)
        retry = self.post('engineer', '/equipment/runs', payload)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(first.json['id'], retry.json['id'])
        payload['title'] = 'Different request'
        self.assertEqual(self.post('engineer', '/equipment/runs', payload).status_code, 409)

    def test_revision_lineage_immutable_old_content_and_stale_base(self):
        old = self.save()
        changed = trace(); changed['recipe']['beamVoltageV'] = 720
        new = self.save(base_revision_id=old['id'], trace=changed)
        self.assertEqual(new['revision'], 2)
        self.assertEqual(new['series_id'], old['id'])
        self.assertEqual(self.clients['engineer'].get('/api/equipment/runs/' + old['id']).json['trace'], old['trace'])
        self.assertEqual(self.post('engineer', '/equipment/runs', self.payload(base_revision_id=old['id'])).status_code, 409)

    def test_peer_review_workflow_does_not_grant_manufacturing_release(self):
        record = self.save()
        submitted = self.transition('engineer', record, 'submit')
        self.assertEqual(submitted.status_code, 200)
        record = submitted.json
        self.assertEqual(self.transition('engineer', record, 'review', note='self').status_code, 403)
        self.assertEqual(self.transition('reviewer', record, 'review', note='').status_code, 422)
        reviewed = self.transition('reviewer', record, 'review', note='Recipe evidence inspected')
        self.assertEqual(reviewed.status_code, 200)
        self.assertEqual(reviewed.json['status'], 'reviewed')
        self.assertFalse(reviewed.json['manufacturing_release'])
        self.assertEqual(reviewed.json['trace_sha256'], record['trace_sha256'])
        self.assertEqual(self.transition('admin', record, 'reject', note='stale').status_code, 409)

    def test_author_cannot_review_own_record_even_as_admin(self):
        record = self.post('admin','/equipment/runs',self.payload()).json
        submitted = self.transition('admin', record, 'submit').json
        self.assertEqual(self.transition('admin', submitted, 'review', note='self').status_code, 403)

    def test_rejection_requires_new_revision(self):
        first = self.save()
        record = self.transition('engineer', first, 'submit').json
        rejected = self.transition('reviewer', record, 'reject', note='More evidence needed').json
        self.assertEqual(self.transition('engineer', rejected, 'submit').status_code, 409)
        self.assertEqual(self.save(base_revision_id=first['id'])['status'], 'draft')

    def test_baseline_must_match_project_and_profile(self):
        baseline = self.save()
        record = self.save(baseline_id=baseline['id'])
        self.assertEqual(record['baseline_id'], baseline['id'])
        other_project = self.post('engineer','/projects',dict(name='Other',description='Other')).json['id']
        self.assertEqual(self.post('engineer','/equipment/runs',self.payload(project_id=other_project,baseline_id=baseline['id'])).status_code, 422)
        bad = trace(); bad['profileId'] = 'different'
        self.assertEqual(self.post('engineer','/equipment/runs',self.payload(trace=bad,baseline_id=baseline['id'])).status_code, 422)
        self.assertEqual(self.post('engineer','/equipment/runs',self.payload(project_id=other_project,base_revision_id=baseline['id'])).status_code, 422)

    def test_invalid_logs_roll_back_without_partial_records(self):
        mutations = [lambda t:t['units'].update(pressurePa='Torr'), lambda t:t['samples'][1].update(t=0), lambda t:t['samples'][1]['digital'].update(beam=1), lambda t:t.update(duration=9), lambda t:t['samples'][1]['values'].update(pressurePa=float('nan')), lambda t:t['recipe'].update(rotationRpm=20)]
        for mutate in mutations:
            invalid = trace(); mutate(invalid)
            response = self.post('engineer','/equipment/runs',self.payload(trace=invalid))
            self.assertEqual(response.status_code, 422, response.json)
        result = self.clients['engineer'].get('/api/equipment/runs?project_id=' + self.project)
        self.assertEqual(result.json['total'], 0)

    def test_database_content_and_audit_cannot_be_updated_or_deleted(self):
        record = self.save()
        with closing(sqlite3.connect(self.database)) as connection:
            for statement in ("UPDATE equipment_runs SET title='tampered' WHERE id=?", 'DELETE FROM equipment_runs WHERE id=?'):
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute(statement,(record['id'],))
            audit = connection.execute("SELECT details_json FROM audit WHERE entity_id=? AND action='equipment.run_saved'", (record['id'],)).fetchone()
            self.assertEqual(json.loads(audit[0])['sha256'], record['trace_sha256'])

    def test_list_pagination_omits_trace_payload_and_reports_count(self):
        for i in range(32):
            self.save(title=f'Record {i}')
        first = self.clients['engineer'].get('/api/equipment/runs?project_id=' + self.project).json
        second = self.clients['engineer'].get('/api/equipment/runs?project_id=' + self.project + '&offset=30').json
        self.assertEqual(first['total'], 32)
        self.assertEqual(len(first['items']), 30)
        self.assertEqual(len(second['items']), 2)
        self.assertNotIn('trace', first['items'][0])
        self.assertNotIn('request_sha256', first['items'][0])
        self.assertFalse({r['id'] for r in first['items']} & {r['id'] for r in second['items']})

    def test_schema_reopen_keeps_old_and_new_data(self):
        record = self.save()
        reopened = create_app(self.database, testing=True)
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute('SELECT title FROM equipment_runs WHERE id=?', (record['id'],)).fetchone()[0], record['title'])
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM users').fetchone()[0], 3)
            self.assertEqual(connection.execute('SELECT MAX(version) FROM schema_version').fetchone()[0], 1)
        response = reopened.test_client().get('/equipment-review.js')
        self.assertEqual(response.status_code, 200)
        response.close()
        self.assertEqual(reopened.test_client().get('/server/equipment-schema.sql').status_code, 404)


if __name__ == '__main__':
    unittest.main()
