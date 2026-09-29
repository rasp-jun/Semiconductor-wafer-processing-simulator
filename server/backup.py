"""Consistent SQLite snapshot. Run on the server host; restore only while stopped."""
import argparse
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_file():
        raise ValueError('Source database does not exist')
    if source == destination or destination.exists():
        raise ValueError('Destination must be a new file different from the source')
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, staged_name = tempfile.mkstemp(prefix='.waferflow-backup-', suffix='.pending', dir=destination.parent)
    os.close(descriptor)
    staged = Path(staged_name)
    try:
        # The backup API includes committed WAL contents consistently. The final
        # path must not expose an incomplete or unverified database.
        with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)) as src:
            with closing(sqlite3.connect(staged)) as dst:
                src.backup(dst)
                if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Backup integrity verification failed')
                if dst.execute('PRAGMA foreign_key_check').fetchall():
                    raise RuntimeError('Backup foreign key verification failed')
        try:
            if os.name == 'nt':
                # Windows rename refuses an existing destination atomically.
                os.rename(staged, destination)
            else:
                # POSIX rename would replace it; a same-directory hard link
                # instead creates the final name exclusively and atomically.
                os.link(staged, destination)
        except FileExistsError as error:
            raise ValueError('Destination already exists; no file was replaced') from error
    finally:
        staged.unlink(missing_ok=True)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=os.getenv('WF_DATABASE', str(Path(__file__).resolve().parent.parent/'.data'/'waferflow.sqlite3')))
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(backup(args.source, args.output))
