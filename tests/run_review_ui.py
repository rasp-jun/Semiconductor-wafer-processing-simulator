"""Run the review DOM/HTTP workflow against an owned, temporary test database."""
import importlib.util
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from waitress import create_server
from server.app import create_app


def find_node():
    installed = shutil.which('node')
    if installed:
        return installed
    spec = importlib.util.find_spec('playwright')
    if spec and spec.origin:
        driver = Path(spec.origin).parent / 'driver'
        for name in ('node.exe', 'node'):
            candidate = driver / name
            if candidate.is_file():
                return str(candidate)
    raise RuntimeError('Node.js 22 이상 또는 이 Python 환경의 Playwright가 필요합니다.')


def main():
    node = find_node()
    with tempfile.TemporaryDirectory(prefix='waferflow-review-ui-') as temporary:
        # The JS suite permits only this dedicated port. If occupied, fail here;
        # never send test writes to a service we did not start ourselves.
        server = create_server(
            create_app(Path(temporary) / 'review-ui.sqlite3', testing=True),
            host='127.0.0.1', port=8767,
        )
        threading.Thread(target=server.run, daemon=True).start()
        try:
            result = subprocess.run([
                node, '--input-type=module', '-e',
                "import {runReviewUITests} from './tests/review-ui.mjs'; "
                "const result=await runReviewUITests(process.cwd()); "
                "console.log(JSON.stringify({passed:result.passed,scope:result.scope}));",
            ], cwd=ROOT, timeout=90, check=False)
            return result.returncode
        finally:
            server.close()


if __name__ == '__main__':
    raise SystemExit(main())
