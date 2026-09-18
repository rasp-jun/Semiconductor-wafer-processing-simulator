"""Consistent SQLite snapshot. Run on the server host; restore only while stopped."""
import argparse
import sqlite3
from contextlib import closing
from pathlib import Path


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_file():
        raise ValueError('Source database does not exist')
    if source == destination or destination.exists():
        raise ValueError('Destination must be a new file different from the source')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # The backup API includes committed WAL contents consistently.
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)) as src:
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity verification failed')
            if dst.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeError('Backup foreign key verification failed')
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=str(Path(__file__).resolve().parent.parent/'.data'/'waferflow.sqlite3'))
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(backup(args.source, args.output))
