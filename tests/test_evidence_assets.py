import tempfile
import unittest
from pathlib import Path
from server.app import create_app


class EvidenceAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.client = create_app(Path(self.temp.name) / 'review.sqlite3', testing=True).test_client()

    def tearDown(self):
        self.temp.cleanup()

    def test_evidence_assets_and_fab_navigation_are_served(self):
        with self.client.get('/') as response:
            self.assertEqual(response.status_code, 200)
            self.assertIn(b'evidence.html', response.data)
        for filename in ['evidence.html', 'evidence.css', 'evidence-engine.js', 'evidence-app.js']:
            with self.client.get('/' + filename) as response:
                self.assertEqual(response.status_code, 200)
                self.assertGreater(len(response.data), 100)
                self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])

    def test_no_upload_api_or_private_data_directory_is_exposed(self):
        for url in ['/evidence-data/private.json', '/.data/waferflow.sqlite3', '/.git/config', '/server/app.py']:
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get('/api/equipment/capabilities').status_code, 401)


if __name__ == '__main__':
    unittest.main()
