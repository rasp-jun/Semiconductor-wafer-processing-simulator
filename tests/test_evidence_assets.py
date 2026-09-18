import json
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from server.app import create_app


class PageReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.urls.append(attrs['src'])
        if tag in ('a', 'link') and attrs.get('href'):
            self.urls.append(attrs['href'])


class EvidenceAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(Path(self.temp.name) / 'review.sqlite3', testing=True)
        self.allowed = json.loads(Path(self.app.config['PUBLIC_ASSET_MANIFEST']).read_text(encoding='utf-8'))
        self.manifest = Path(self.temp.name) / 'public-assets.json'
        self.manifest.write_text(json.dumps(self.allowed), encoding='utf-8')
        self.app.config['PUBLIC_ASSET_MANIFEST'] = self.manifest
        self.client = self.app.test_client()

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
        for url in ['/evidence-data/private.json', '/.data/waferflow.sqlite3', '/.git/config', '/server/app.py', '/server/public-assets.json', '/tests/test_evidence_assets.py']:
            self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get('/api/equipment/capabilities').status_code, 401)

    def test_published_page_references_are_reachable(self):
        for page in [name for name in self.allowed if name.endswith('.html')]:
            with self.client.get('/' + page) as response:
                parser = PageReferences()
                parser.feed(response.get_data(as_text=True))
            for url in parser.urls:
                parsed = urlsplit(url)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                with self.subTest(page=page, url=url):
                    with self.client.get(urljoin('/' + page, url)) as response:
                        self.assertEqual(response.status_code, 200)

    def test_manifest_changes_apply_without_restarting_the_app(self):
        previous = [name for name in self.allowed if not name.startswith('evidence')]
        self.manifest.write_text(json.dumps(previous), encoding='utf-8')
        self.assertEqual(self.client.get('/evidence.html').status_code, 404)
        self.manifest.write_text(json.dumps(self.allowed), encoding='utf-8')
        for filename in ['evidence.html?profile=har', 'evidence.css', 'evidence-engine.js', 'evidence-app.js']:
            with self.client.get('/' + filename) as response:
                self.assertEqual(response.status_code, 200)
        self.manifest.write_text(json.dumps(previous), encoding='utf-8')
        self.assertEqual(self.client.get('/evidence.html').status_code, 404)

    def test_invalid_manifest_fails_closed_and_recovers_when_repaired(self):
        for invalid in ['{broken', '{}', '["evidence.html", null]']:
            self.manifest.write_text(invalid, encoding='utf-8')
            with self.assertLogs(self.app.logger, level='ERROR'):
                response = self.client.get('/evidence.html')
            self.assertEqual(response.status_code, 503)
            self.assertIn('public-assets.json', response.get_json()['error'])
        self.manifest.write_text(json.dumps(self.allowed), encoding='utf-8')
        with self.client.get('/evidence.html') as response:
            self.assertEqual(response.status_code, 200)

    def test_missing_manifest_fails_closed_for_home_and_assets(self):
        self.manifest.unlink()
        for url in ['/', '/evidence.html', '/server/app.py']:
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.client.get(url).status_code, 503)


if __name__ == '__main__':
    unittest.main()
