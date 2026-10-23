#!/usr/bin/env python3
"""Read-only, secret-free Codespaces recovery UI; never reports application readiness."""
from __future__ import annotations
import argparse
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
REASONS = {
    'configuration': 'Startup configuration is missing or invalid. Check the terminal diagnostic and Codespaces secret names.',
    'startup': 'The application could not finish starting. Check the last startup error in the Codespaces terminal.',
}


def handler(reason: str):
    description = REASONS[reason]
    page = ('''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Genithm - startup recovery</title>
<style>body{font:18px system-ui;max-width:780px;margin:8vh auto;padding:24px;line-height:1.6}code{overflow-wrap:anywhere}h1{line-height:1.2}</style>
<main><p>GENITHM / DEVELOPMENT RECOVERY</p><h1>The application needs attention</h1><p>'''
        + description + '''</p><p>This is a recovery screen, not the research application.
No AI answer or scientific result is being generated here.</p>
<h2>Restore the web application</h2><p>In the Codespaces terminal, from the repository root, run:</p>
<p><code>git switch main &amp;&amp; git pull --ff-only &amp;&amp; GENITHM_CODESPACES_MODE=chat bash .devcontainer/start.sh</code></p>
<p>Check that GEMINI_API_KEY, GROQ_API_KEY and SUPABASE_SECRET_KEY are Codespaces secrets, not only Actions secrets.
Stop and start the Codespace after changing secrets. Never paste their values into chat or commit them.</p>
<p>If startup reports a dependency or version error, fix that error rather than bypassing the security check.
The web application must pass its own health check before it is ready.</p>
<p>Port 3000 must use HTTP forwarding in the Ports panel. The external browser address still uses HTTPS.
Full scientific services are started explicitly with <code>GENITHM_CODESPACES_MODE=full bash .devcontainer/start.sh</code>.</p></main></html>''').encode()

    class RecoveryHandler(BaseHTTPRequestHandler):
        server_version = 'GenithmRecovery/1'
        sys_version = ''

        def log_message(self, *_args):
            pass  # Do not log URLs, headers, cookies, credentials or request bodies.

        def do_GET(self):
            api = self.path.split('?', 1)[0].startswith('/api/')
            body = json.dumps({'service': 'genithm-recovery', 'status': 'setup_required'}).encode() if api else page
            self.send_response(503 if api else 200)
            self.send_header('Content-Type', 'application/json' if api else 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            self.send_response(405)
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.close_connection = True

    return RecoveryHandler


def start(reason: str) -> bool:
    # Never terminate or replace an existing port owner, including a healthy app.
    try:
        with socket.create_connection(('127.0.0.1', 3000), timeout=0.5):
            print('[Genithm] Port 3000 already has a listener; recovery did not replace it.')
            return False
    except OSError:
        pass
    child = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), '--serve', '--reason', reason],
        cwd=ROOT / 'apps/web', stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True,
        env={'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'CODESPACE_NAME': os.environ['CODESPACE_NAME']},
    )
    for _ in range(30):
        if child.poll() is not None:
            return False
        connection = http.client.HTTPConnection('127.0.0.1', 3000, timeout=0.5)
        try:
            connection.request('GET', '/api/health')
            response = connection.getresponse()
            data = response.read(1024)
            if response.status == 503 and json.loads(data).get('service') == 'genithm-recovery':
                print('[Genithm] Recovery screen: http://localhost:3000 (application is NOT ready).')
                return True
        except (OSError, http.client.HTTPException, ValueError):
            pass
        finally:
            connection.close()
        time.sleep(0.1)
    child.terminate()
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--start', action='store_true')
    mode.add_argument('--serve', action='store_true')
    parser.add_argument('--reason', choices=REASONS, default='startup')
    args = parser.parse_args()
    if not os.environ.get('CODESPACE_NAME'):
        print('Recovery is only available inside a development Codespace.', file=sys.stderr)
        return 2
    if args.start:
        return 0 if start(args.reason) else 1
    with ThreadingHTTPServer(('0.0.0.0', 3000), handler(args.reason)) as server:
        server.serve_forever()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
