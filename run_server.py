"""Run the review workspace with Waitress; no development server or default account."""
import argparse
import os
from waitress import serve
from server.app import create_app

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='WaferFlow engineering review workspace')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', default=8766, type=int)
    args = parser.parse_args()
    if args.host not in ('127.0.0.1', '::1', 'localhost') and os.getenv('WF_COOKIE_SECURE') != '1':
        parser.error('Remote deployment requires HTTPS and WF_COOKIE_SECURE=1. Local setup: README.md.')
    application = create_app()
    print(f'WaferFlow review workspace: http://{args.host}:{args.port}', flush=True)
    serve(application, host=args.host, port=args.port, threads=4, max_request_body_size=1500000)
