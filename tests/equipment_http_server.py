"""Short-lived loopback fixture; never uses the workspace database."""
import json
import tempfile
import time
from pathlib import Path
from werkzeug.serving import make_server
from server.app import create_app


def main():
    with tempfile.TemporaryDirectory(prefix='wf-equipment-http-') as folder:
        app = create_app(Path(folder) / 'fixture.sqlite3', testing=True)
        client = app.test_client()
        headers = {'X-WaferFlow': 'review'}
        password = 'ephemeral-equipment-test-1234'
        response = client.post('/api/bootstrap',json={'username':'testadmin','password':password,'display_name':'HTTP test admin'},headers=headers)
        headers['X-CSRF-Token'] = response.json['csrf']
        for role in ('engineer','reviewer'):
            result = client.post('/api/users',json={'username':'test'+role,'password':password,'display_name':'HTTP test '+role,'role':role},headers=headers)
            assert result.status_code == 201
        result = client.post('/api/projects',json={'name':'Equipment HTTP fixture','description':'Temporary test data only'},headers=headers)
        assert result.status_code == 201
        server = make_server('127.0.0.1',8771,app)
        server.timeout = .2
        deadline = time.monotonic() + 45
        print(json.dumps({'ready':True,'url':'http://127.0.0.1:8771','expires_seconds':45}),flush=True)
        try:
            while time.monotonic() < deadline:
                server.handle_request()
        finally:
            server.server_close()


if __name__ == '__main__':
    main()
