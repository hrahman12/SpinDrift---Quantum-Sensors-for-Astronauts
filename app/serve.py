"""Serve the fresh UI and shared data: python app/serve.py."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent.parent
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        if self.path in ('/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', '/app/')
            self.end_headers()
        else:
            super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    port = int(os.environ.get('SPINDRIFT_APP_PORT', '8080'))
    print(f'SpinDrift: http://localhost:{port}/app/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
