"""Export provenance checks using only owned temporary SQLite databases."""
import base64
import hashlib
import json
import sqlite3
import unittest
from contextlib import closing
from uuid import uuid4

from server.app import encoded
import test_review as review_fixtures

CSV = review_fixtures.CSV


def file_payload(raw, filename='original.csv'):
    text = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    return dict(original_csv=dict(encoding='base64', filename=filename,
                                  bytes_base64=base64.b64encode(raw).decode('ascii'),
                                  sha256=hashlib.sha256(raw).hexdigest()),
                csv_text_sha256=hashlib.sha256(text.encode('utf-8')).hexdigest())


class ReviewSourceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = review_fixtures.ReviewTests('test_export_contains_evidence_versions_and_audit_but_no_credentials')
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def save(self, **source):
        f = self.fixture
        return f.post(f.engineer, '/revisions/'+f.revision_id+'/experiments',
                      dict(kind='measurement', name='Exact source', lot_id='L0', source_name='User file',
                           cd_lsl_nm=480, cd_usl_nm=520, **source))

    def test_file_bytes_and_submitted_text_hashes_survive_approved_project_export(self):
        raw = b'\xef\xbb\xbfwafer_id,site_id,cd_nm,etch_depth_nm\r\n" W1 ",S1,5.00e2,0.000\r\n'
        result = self.save(**file_payload(raw))
        self.assertEqual(result.status_code, 201, result.json)
        saved, f = result.json, self.fixture
        source = saved['result']['source_archive']
        self.assertEqual(base64.b64decode(source['bytes_base64']), raw)
        self.assertEqual(source['hash_scope'], 'original-file-bytes')
        self.assertEqual(source['sha256'], hashlib.sha256(raw).hexdigest())
        submitted = raw.decode('utf-8-sig').replace('\r\n', '\n')
        self.assertEqual(saved['result']['file_sha256'], hashlib.sha256(submitted.encode()).hexdigest())
        self.assertEqual(saved['result']['file_sha256_scope'], 'submitted-csv-text-utf8')
        self.assertNotEqual(saved['result']['file_sha256'], source['sha256'])
        self.assertEqual(saved['result']['rows'][0]['etch_depth_nm'], 0)
        f.post(f.engineer, '/revisions/'+f.revision_id+'/transition', dict(action='submit', lock_version=1))
        f.post(f.reviewer, '/revisions/'+f.revision_id+'/transition', dict(action='approve', lock_version=2, note='Source inspected'))
        package = f.engineer.get('/api/projects/'+f.project_id+'/export').json
        self.assertEqual(package['experiments'][0]['result'], saved['result'])
        self.assertEqual(package['experiments'][0]['digest'], saved['digest'])
        self.assertEqual(package['revisions'][0]['status'], 'approved')
        self.assertTrue(package['revisions'][0]['reviewed_at'])
        self.assertTrue(any(a['action']=='revision.approve' for a in package['audit']))
        detail = f.engineer.get('/api/experiments/'+saved['id']).json
        self.assertEqual(detail['result']['source_archive'], source)
        summary = f.engineer.get('/api/projects/'+f.project_id).json
        self.assertNotIn('source_archive', summary['experiments'][0]['result'])

    def test_one_megabyte_original_fits_existing_request_limit(self):
        raw = CSV.encode() + b'\n' * (1000000-len(CSV.encode()))
        source = file_payload(raw)
        self.assertLess(len(json.dumps(source).encode()), 1400000)
        response = self.save(**source)
        self.assertEqual(response.status_code, 201, response.json)
        self.assertEqual(response.json['result']['source_archive']['byte_length'], 1000000)
        self.assertEqual(base64.b64decode(response.json['result']['source_archive']['bytes_base64']), raw)

    def test_invalid_original_or_mismatched_declared_text_never_creates_evidence(self):
        existing = self.save(csv=CSV).json
        good = file_payload(CSV.encode())
        candidates = []
        for key, value in [('encoding', 'hex'), ('bytes_base64', '%%%'), ('sha256', '0'*64), ('sha256', '\uac00'*64), ('filename', '\nunsafe.csv')]:
            bad = json.loads(json.dumps(good)); bad['original_csv'][key] = value; candidates.append(bad)
        bad = json.loads(json.dumps(good)); bad['csv_text_sha256'] = '0'*64; candidates.append(bad)
        bad = json.loads(json.dumps(good)); bad['csv'] = CSV+'changed'; candidates.append(bad)
        bad = json.loads(json.dumps(good)); bad['original_csv']['bytes_base64'] = base64.b64encode(b'\xff').decode(); candidates.append(bad)
        candidates.append(file_payload(b'\n'*1000001))
        for source in candidates:
            response = self.save(**source)
            self.assertEqual(response.status_code, 422, response.json)
        f = self.fixture
        records = f.engineer.get('/api/projects/'+f.project_id+'/export').json['experiments']
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['id'], existing['id'])
        self.assertEqual(records[0]['result'], existing['result'])
        self.assertEqual(records[0]['digest'], existing['digest'])

    def test_pasted_or_edited_csv_preserves_exact_submitted_text_without_claiming_file_bytes(self):
        text = '\ufeff'+CSV.replace('\n', '\r\n')
        response = self.save(csv=text)
        self.assertEqual(response.status_code, 201, response.json)
        result = response.json['result']; source = result['source_archive']
        self.assertEqual(source['text'], text)
        self.assertEqual(source['kind'], 'submitted-text')
        self.assertEqual(source['hash_scope'], 'submitted-csv-text-utf8')
        self.assertEqual(result['file_sha256'], hashlib.sha256(text.encode()).hexdigest())
        self.assertNotIn('bytes_base64', source)
        self.assertEqual(self.save(csv='\ud800').status_code, 422)

    def test_legacy_result_and_digest_are_not_rewritten_or_given_fabricated_sources(self):
        saved = self.save(csv=CSV).json
        legacy = dict(saved['result']); legacy.pop('source_archive'); legacy.pop('file_sha256_scope')
        payload, identity = encoded(legacy), str(uuid4())
        checksum = hashlib.sha256(payload.encode()).hexdigest()
        f = self.fixture
        with closing(sqlite3.connect(f.database)) as connection:
            connection.execute('INSERT INTO experiments VALUES(?,?,?,?,?,?,?,?,?)',
                               (identity, f.revision_id, 'Legacy fixture', 'L0', 'measurement', payload, checksum, saved['created_by'], saved['created_at']))
            connection.commit()
        detail = f.engineer.get('/api/experiments/'+identity).json
        self.assertEqual(detail['result'], legacy)
        self.assertEqual(detail['digest'], checksum)
        package = f.engineer.get('/api/projects/'+f.project_id+'/export').json
        original = next(e for e in package['experiments'] if e['id']==identity)
        self.assertEqual(original['result'], legacy)
        self.assertNotIn('source_archive', original['result'])

    def test_base64_submitted_text_keeps_bom_crlf_and_legacy_hash_meaning(self):
        text = '\ufeff'+CSV.replace('\n', '\r\n')
        raw = text.encode('utf-8')
        previous = self.save(csv=text).json
        for additional in [{}, {'csv': text}]:
            response = self.save(csv_utf8_base64=base64.b64encode(raw).decode('ascii'), **additional)
            self.assertEqual(response.status_code, 201, response.json)
            result = response.json['result']
            self.assertEqual(result, previous['result'])
            self.assertEqual(response.json['digest'], previous['digest'])
            self.assertEqual(result['source_archive']['kind'], 'submitted-text')
            self.assertEqual(result['source_archive']['text'].encode('utf-8'), raw)
            self.assertEqual(result['file_sha256'], hashlib.sha256(raw).hexdigest())

    def test_malformed_oversize_or_ambiguous_submitted_base64_preserves_existing_records(self):
        previous = self.save(csv=CSV).json
        encoded_csv = base64.b64encode(CSV.encode()).decode('ascii')
        invalid = [dict(csv_utf8_base64=value) for value in [None, 3, '%%%', '\uac00', '/w==', base64.b64encode(b'\n'*1000001).decode('ascii')]]
        invalid += [dict(csv_utf8_base64=encoded_csv, csv=CSV+'changed'),
                    dict(csv_utf8_base64=encoded_csv, original_csv=None),
                    dict(csv_utf8_base64=encoded_csv, **file_payload(CSV.encode()))]
        for source in invalid:
            response = self.save(**source)
            self.assertEqual(response.status_code, 422, response.json)
        f = self.fixture
        records = f.engineer.get('/api/projects/'+f.project_id+'/export').json['experiments']
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]['result'], previous['result'])
        self.assertEqual(records[0]['digest'], previous['digest'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
