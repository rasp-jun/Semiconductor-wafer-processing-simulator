"""A published directory contains only the current allowlist, even on rebuild."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import build_public


class PublicBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dest = self.root / '.test-tools' / 'site-source'
        (self.root / 'server').mkdir()
        (self.root / 'index.html').write_text('<body><script src="workspace-bridge.js" defer></script></body>', encoding='utf-8')
        self.manifest = self.root / 'server' / 'public-assets.json'
        self.manifest.write_text(json.dumps(['index.html', 'workspace-bridge.js']), encoding='utf-8')
        (self.root / 'workspace-bridge.js').write_text('private server bridge', encoding='utf-8')

    def build(self):
        with patch.object(build_public, 'ROOT', self.root), patch.object(build_public, 'DEST', self.dest), contextlib.redirect_stdout(io.StringIO()):
            return build_public.build()

    def write_hosting(self, value):
        directory = self.root / '.openai'
        directory.mkdir(exist_ok=True)
        (directory / 'hosting.json').write_text(json.dumps({'project_id': value}), encoding='utf-8')

    def junction(self, target, link):
        if os.name != 'nt':
            link.symlink_to(target, target_is_directory=True)
        else:
            import _winapi
            _winapi.CreateJunction(str(target), str(link))

    def test_rebuild_removes_stale_private_files_and_old_assets(self):
        public = self.build()
        (public / 'server').mkdir()
        (public / 'server' / 'private.py').write_text('private', encoding='utf-8')
        (public / 'obsolete.js').write_text('stale', encoding='utf-8')
        self.build()
        self.assertEqual({str(p.relative_to(public)) for p in public.rglob('*') if p.is_file()}, {'index.html', 'workbench.html', 'public-mode.js'})
        self.assertNotIn('workspace-bridge.js', (public / 'index.html').read_text(encoding='utf-8'))
        self.assertTrue((self.root / 'workspace-bridge.js').exists())

    def test_failed_build_keeps_the_previous_complete_artifact(self):
        public = self.build()
        original = (public / 'index.html').read_bytes()
        (self.root / 'index.html').write_text('new version', encoding='utf-8')
        self.manifest.write_text(json.dumps(['index.html', 'missing.js']), encoding='utf-8')
        with self.assertRaises(ValueError):
            self.build()
        self.assertEqual((public / 'index.html').read_bytes(), original)
        self.assertEqual([p.name for p in self.dest.iterdir()], ['dist'])

    def test_invalid_manifest_paths_cannot_write_outside_staging(self):
        for names in [['../index.html'], [str(self.root / 'index.html')], ['nested/../index.html'], ['index.html', 'index.html'], [None], {}]:
            with self.subTest(names=names):
                self.manifest.write_text(json.dumps(names), encoding='utf-8')
                with self.assertRaises(ValueError):
                    self.build()
                self.assertIn('workspace-bridge', (self.root / 'index.html').read_text(encoding='utf-8'))

    def test_output_root_cannot_be_the_project_or_its_parent(self):
        for dest in [self.root, self.root.parent / 'unrelated-build']:
            with self.subTest(dest=dest), patch.object(build_public, 'ROOT', self.root), patch.object(build_public, 'DEST', dest):
                with self.assertRaises(ValueError):
                    build_public.build()
        self.assertTrue((self.root / 'index.html').exists())

    def test_output_junctions_cannot_delete_sibling_user_files(self):
        self.dest.mkdir(parents=True)
        kept = self.dest / 'user-kept-artifact'
        kept.mkdir()
        sentinel = kept / 'sentinel.txt'
        sentinel.write_text('keep', encoding='utf-8')
        for name in ['dist', '.openai']:
            with self.subTest(name=name):
                link = self.dest / name
                self.junction(kept, link)
                try:
                    with self.assertRaisesRegex(ValueError, 'links or reparse'):
                        self.build()
                    self.assertEqual(sentinel.read_text(encoding='utf-8'), 'keep')
                finally:
                    if os.name == 'nt':
                        link.rmdir()
                    else:
                        link.unlink()

    def test_output_ancestor_junction_is_rejected_before_any_write(self):
        kept = self.root / 'user-area'
        kept.mkdir()
        sentinel = kept / 'sentinel.txt'
        sentinel.write_text('keep', encoding='utf-8')
        self.junction(kept, self.root / '.test-tools')
        with self.assertRaisesRegex(ValueError, 'links or reparse'):
            self.build()
        self.assertEqual(sentinel.read_text(encoding='utf-8'), 'keep')
        self.assertFalse((kept / 'site-source').exists())

    def test_internal_junction_cleanup_preserves_external_and_sibling_targets(self):
        public = self.build()
        external = tempfile.TemporaryDirectory()
        self.addCleanup(external.cleanup)
        sibling = self.dest / 'user-kept-artifact'
        sibling.mkdir()
        for target in [Path(external.name), sibling]:
            (target / 'sentinel.txt').write_text('keep', encoding='utf-8')
        self.junction(Path(external.name), public / 'external-link')
        self.junction(sibling, public / 'sibling-link')
        self.build()
        for target in [Path(external.name), sibling]:
            self.assertEqual((target / 'sentinel.txt').read_text(encoding='utf-8'), 'keep')
        self.assertFalse((public / 'external-link').exists())
        self.assertFalse((public / 'sibling-link').exists())
        self.assertFalse(any(p.name.startswith('.public-') for p in self.dest.iterdir()))

    def test_cleanup_requires_registered_direct_temporary_directory(self):
        self.dest.mkdir(parents=True)
        kept = self.dest / 'user-kept-artifact'
        kept.mkdir()
        generated = self.dest / '.public-build-pretend'
        generated.mkdir()
        nested = generated / '.public-build-nested'
        nested.mkdir()
        with patch.object(build_public, 'ROOT', self.root), patch.object(build_public, 'DEST', self.dest):
            for target, owned in [(kept, {kept}), (generated, set()), (nested, {nested})]:
                with self.subTest(target=target), self.assertRaises(ValueError):
                    build_public._remove_generated(target, owned)
                self.assertTrue(target.exists())

    def test_failed_publication_restores_assets_and_hosting_metadata(self):
        self.write_hosting('original-project')
        public = self.build()
        original = (public / 'index.html').read_bytes()
        original_config = (self.dest / '.openai' / 'hosting.json').read_bytes()
        (self.root / 'index.html').write_text('<body>replacement</body>', encoding='utf-8')
        self.write_hosting('new-project')
        actual_rename = Path.rename
        for failing_name in ['dist', '.openai']:
            def fail_staged_publish(path, target):
                if path.parent.name.startswith('.public-build-') and path.name == failing_name:
                    raise PermissionError('injected publication failure')
                return actual_rename(path, target)
            with self.subTest(failing_name=failing_name), patch.object(Path, 'rename', fail_staged_publish):
                with self.assertRaises(PermissionError):
                    self.build()
            self.assertEqual((public / 'index.html').read_bytes(), original)
            self.assertEqual((self.dest / '.openai' / 'hosting.json').read_bytes(), original_config)
            self.assertEqual({p.name for p in self.dest.iterdir()}, {'dist', '.openai'})

    def test_absent_source_hosting_removes_previous_deployment_target(self):
        self.write_hosting('old-project')
        self.build()
        (self.root / '.openai' / 'hosting.json').unlink()
        self.build()
        self.assertFalse((self.dest / '.openai').exists())
        self.assertTrue((self.dest / 'dist' / 'index.html').is_file())

    def test_copy_failure_cannot_change_published_hosting_metadata(self):
        self.write_hosting('original-project')
        public = self.build()
        original = (public / 'index.html').read_bytes()
        original_config = (self.dest / '.openai' / 'hosting.json').read_bytes()
        self.write_hosting('new-project')
        actual_copy = build_public.shutil.copyfile
        def fail_config_copy(source, destination, *args, **kwargs):
            if Path(source).name == 'hosting.json':
                raise OSError('injected copy failure')
            return actual_copy(source, destination, *args, **kwargs)
        with patch.object(build_public.shutil, 'copyfile', fail_config_copy), self.assertRaises(OSError):
            self.build()
        self.assertEqual((public / 'index.html').read_bytes(), original)
        self.assertEqual((self.dest / '.openai' / 'hosting.json').read_bytes(), original_config)

    def test_failure_while_backing_up_metadata_restores_the_prior_assets(self):
        self.write_hosting('original-project')
        public = self.build()
        original = (public / 'index.html').read_bytes()
        original_config = (self.dest / '.openai' / 'hosting.json').read_bytes()
        actual_rename = Path.rename
        def fail_metadata_backup(path, target):
            if path == self.dest / '.openai':
                raise PermissionError('injected metadata backup failure')
            return actual_rename(path, target)
        with patch.object(Path, 'rename', fail_metadata_backup), self.assertRaises(PermissionError):
            self.build()
        self.assertEqual((public / 'index.html').read_bytes(), original)
        self.assertEqual((self.dest / '.openai' / 'hosting.json').read_bytes(), original_config)

    def test_failed_rollback_keeps_the_original_backup(self):
        self.write_hosting('original-project')
        public = self.build()
        original = (public / 'index.html').read_bytes()
        original_config = (self.dest / '.openai' / 'hosting.json').read_bytes()
        self.write_hosting('new-project')
        actual_rename = Path.rename
        def fail_publish_and_restore(path, target):
            if path.parent.name.startswith('.public-build-') and path.name == '.openai':
                raise PermissionError('injected publication failure')
            if path.parent.name.startswith('.public-previous-') and path.name == 'dist':
                raise PermissionError('injected restoration failure')
            return actual_rename(path, target)
        with patch.object(Path, 'rename', fail_publish_and_restore), self.assertRaisesRegex(RuntimeError, 'preserved originals'):
            self.build()
        backups = list(self.dest.glob('.public-previous-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / 'dist' / 'index.html').read_bytes(), original)
        self.assertEqual((self.dest / '.openai' / 'hosting.json').read_bytes(), original_config)

    def test_cleanup_error_keeps_the_complete_new_publication_and_old_backup(self):
        self.write_hosting('original-project')
        self.build()
        self.write_hosting('new-project')
        actual_remove = build_public._remove_generated
        def fail_previous_cleanup(directory, owned):
            if directory.name.startswith('.public-previous-'):
                raise PermissionError('injected cleanup failure')
            return actual_remove(directory, owned)
        with patch.object(build_public, '_remove_generated', fail_previous_cleanup), self.assertWarnsRegex(UserWarning, 'Site published'):
            public = self.build()
        self.assertTrue((public / 'index.html').is_file())
        self.assertEqual(json.loads((self.dest / '.openai' / 'hosting.json').read_text(encoding='utf-8'))['project_id'], 'new-project')
        backups = list(self.dest.glob('.public-previous-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads((backups[0] / '.openai' / 'hosting.json').read_text(encoding='utf-8'))['project_id'], 'original-project')

    def test_staging_cleanup_error_does_not_report_a_complete_publication_as_failed(self):
        self.write_hosting('new-project')
        actual_remove = build_public._remove_generated
        def fail_staging_cleanup(directory, owned):
            if directory.name.startswith('.public-build-'):
                raise PermissionError('injected staging cleanup failure')
            return actual_remove(directory, owned)
        with patch.object(build_public, '_remove_generated', fail_staging_cleanup), self.assertWarnsRegex(UserWarning, 'staging cleanup deferred'):
            public = self.build()
        self.assertTrue((public / 'index.html').is_file())
        self.assertEqual(json.loads((self.dest / '.openai' / 'hosting.json').read_text(encoding='utf-8'))['project_id'], 'new-project')


if __name__ == '__main__':
    unittest.main()
