"""Backup publication and failure regressions; all files belong to temporary fixtures."""
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import server.backup as module


class BackupIntegrityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='waferflow-backup-integrity-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.left, self.right = self.root / 'left.sqlite3', self.root / 'right.sqlite3'
        for source, value in [(self.left, 'left'), (self.right, 'right')]:
            with closing(sqlite3.connect(source)) as connection:
                connection.execute('CREATE TABLE evidence (value TEXT NOT NULL)')
                connection.execute('INSERT INTO evidence VALUES (?)', (value,))
                connection.commit()
        self.originals = {path: path.read_bytes() for path in [self.left, self.right]}

    def verify_sources(self):
        for path, original in self.originals.items():
            self.assertEqual(path.read_bytes(), original)

    def test_destination_created_after_preflight_is_never_overwritten(self):
        destination = self.root / 'snapshot.sqlite3'
        connect = sqlite3.connect
        intervened = False

        def publish_other_snapshot(*args, **kwargs):
            nonlocal intervened
            if kwargs.get('uri') and not intervened:
                # A second producer publishes after the first producer's path check.
                intervened = True
                destination.write_bytes(self.right.read_bytes())
            return connect(*args, **kwargs)

        with patch.object(module.sqlite3, 'connect', side_effect=publish_other_snapshot):
            with self.assertRaises((ValueError, FileExistsError)):
                module.backup(self.left, destination)
        self.assertTrue(intervened)
        self.assertEqual(destination.read_bytes(), self.originals[self.right])
        self.assertEqual({p.name for p in self.root.iterdir()}, {'left.sqlite3', 'right.sqlite3', 'snapshot.sqlite3'})
        self.verify_sources()

    def test_simultaneous_backups_publish_exactly_one_verified_snapshot(self):
        destination = self.root / 'shared.sqlite3'
        connect = sqlite3.connect
        barrier = threading.Barrier(2)

        def synchronize_reads(*args, **kwargs):
            if kwargs.get('uri'):
                barrier.wait(timeout=5)
            return connect(*args, **kwargs)

        def run(source):
            try:
                module.backup(source, destination)
                return 'saved'
            except (ValueError, FileExistsError):
                return 'destination-exists'

        with patch.object(module.sqlite3, 'connect', side_effect=synchronize_reads):
            with ThreadPoolExecutor(max_workers=2) as pool:
                outcomes = list(pool.map(run, [self.left, self.right]))
        self.assertCountEqual(outcomes, ['saved', 'destination-exists'])
        with closing(connect(destination.as_uri()+'?mode=ro', uri=True)) as connection:
            self.assertIn(connection.execute('SELECT value FROM evidence').fetchone()[0], ['left', 'right'])
            self.assertEqual(connection.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        self.assertEqual({p.name for p in self.root.iterdir()}, {'left.sqlite3', 'right.sqlite3', 'shared.sqlite3'})
        self.verify_sources()

    def test_unreadable_source_never_leaves_a_final_backup_file(self):
        invalid, destination = self.root / 'invalid.sqlite3', self.root / 'snapshot.sqlite3'
        invalid.write_bytes(b'not a SQLite database')
        with self.assertRaises(sqlite3.DatabaseError):
            module.backup(invalid, destination)
        self.assertFalse(destination.exists())
        self.assertEqual(invalid.read_bytes(), b'not a SQLite database')
        self.assertEqual({p.name for p in self.root.iterdir()}, {'left.sqlite3', 'right.sqlite3', 'invalid.sqlite3'})
        self.verify_sources()

    def test_foreign_key_verification_failure_does_not_publish_an_invalid_backup(self):
        source, destination = self.root / 'orphan.sqlite3', self.root / 'snapshot.sqlite3'
        with closing(sqlite3.connect(source)) as connection:
            connection.executescript('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (99);')
            connection.commit()
        original = source.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'foreign key'):
            module.backup(source, destination)
        self.assertFalse(destination.exists())
        self.assertEqual(source.read_bytes(), original)
        self.assertEqual({p.name for p in self.root.iterdir()}, {'left.sqlite3', 'right.sqlite3', 'orphan.sqlite3'})
        self.verify_sources()


if __name__ == '__main__':
    unittest.main(verbosity=2)
