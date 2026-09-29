"""Exercise the backup CLI in an isolated package; never open the user's database."""
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class BackupCLITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='waferflow-backup-cli-')
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        # If source selection regresses, its default path must also be isolated.
        self.cli = self.folder / 'cli'
        package = self.cli / 'server'
        package.mkdir(parents=True)
        (package / '__init__.py').write_text('', encoding='utf-8')
        shutil.copyfile(ROOT / 'server' / 'backup.py', package / 'backup.py')
        self.configured = self.folder / 'configured.sqlite3'
        self.explicit = self.folder / 'explicit.sqlite3'
        for source, marker in [(self.configured, 'configured source'), (self.explicit, 'explicit source')]:
            with closing(sqlite3.connect(source)) as connection:
                connection.execute('CREATE TABLE evidence (value TEXT NOT NULL)')
                connection.execute('INSERT INTO evidence VALUES (?)', (marker,))
                connection.commit()
        self.before = {source: source.read_bytes() for source in [self.configured, self.explicit]}

    def invoke(self, *arguments):
        environment = {**os.environ, 'WF_DATABASE': str(self.configured)}
        environment.pop('PYTHONPATH', None)
        result = subprocess.run(
            [sys.executable, '-m', 'server.backup', *map(str, arguments)],
            cwd=self.cli, env=environment, capture_output=True, text=True,
            timeout=15, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for source, original in self.before.items():
            self.assertEqual(source.read_bytes(), original, f'Original source changed: {source.name}')
        self.assertFalse((self.cli / '.data').exists(), 'CLI unexpectedly used the default database directory')

    def assert_snapshot(self, path, expected):
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as connection:
            self.assertEqual(connection.execute('SELECT value FROM evidence').fetchall(), [(expected,)])
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_environment_database_is_the_default_backup_source(self):
        destination = self.folder / 'environment-backup.sqlite3'
        self.invoke('--output', destination)
        self.assert_snapshot(destination, 'configured source')

    def test_explicit_source_overrides_the_environment_without_modifying_either(self):
        destination = self.folder / 'explicit-backup.sqlite3'
        self.invoke('--source', self.explicit, '--output', destination)
        self.assert_snapshot(destination, 'explicit source')


if __name__ == '__main__':
    unittest.main(verbosity=2)
