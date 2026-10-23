"""Executable startup-failure regression tests; no external accounts or secrets are used."""
import http.client
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


recovery = load('recovery52', ROOT / 'scripts/codespaces_recovery.py')
stop = load('stop52', ROOT / 'scripts/stop_codespaces_web.py')


class RecoveryHTTP(unittest.TestCase):
    def setUp(self):
        self.server = recovery.ThreadingHTTPServer(('127.0.0.1', 0), recovery.handler('configuration'))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path):
        with closing(http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)) as conn:
            conn.request(method, path)
            response = conn.getresponse()
            return response.status, response.read().decode(), dict(response.getheaders())

    def test_visible_recovery_is_not_the_app(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'private-marker-do-not-display'}):
            status, body, headers = self.request('GET', '/login?secret=private-marker-do-not-display')
        self.assertEqual(status, 200)
        self.assertIn('not the research application', body)
        self.assertNotIn('private-marker-do-not-display', body)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertIn("default-src 'none'", headers['Content-Security-Policy'])

    def test_health_is_explicitly_unready(self):
        status, body, _ = self.request('GET', '/api/health')
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(body), {'service': 'genithm-recovery', 'status': 'setup_required'})

    def test_does_not_accept_actions(self):
        self.assertEqual(self.request('POST', '/run')[0], 405)

    def test_existing_listener_is_never_replaced(self):
        with patch.object(recovery.socket, 'create_connection'), patch.object(recovery.subprocess, 'Popen') as popen:
            self.assertFalse(recovery.start('startup'))
            popen.assert_not_called()

    def test_recovery_only_targets_same_workspace(self):
        own = ['/usr/bin/python3', str(ROOT / 'scripts/codespaces_recovery.py'), '--serve', '--reason', 'startup']
        self.assertTrue(stop.is_recovery_command(own, ROOT / 'apps/web'))
        self.assertFalse(stop.is_recovery_command(own, Path('/another/workspace/apps/web')))
        self.assertFalse(stop.is_recovery_command(own[:-1] + ['untrusted'], ROOT / 'apps/web'))

    def test_outside_codespaces_refused(self):
        result = subprocess.run([os.sys.executable, str(ROOT / 'scripts/codespaces_recovery.py'), '--start'],
                                env={'PATH': os.environ['PATH']}, capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 2)


class StartupFailures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ('scripts', '.devcontainer', 'apps/web', 'bin'):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        for path in ('.devcontainer/start.sh', 'scripts/codespaces_bioai.sh'):
            shutil.copyfile(ROOT / path, self.root / path)
        self.log = self.root / 'calls'
        self.env = {'PATH': str(self.root / 'bin') + ':/usr/bin:/bin', 'HOME': str(self.root), 'CALLS': str(self.log),
                    'CODESPACE_NAME': 'fixture', 'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN': 'app.github.dev',
                    'GEMINI_API_KEY': 'synthetic-google', 'GROQ_API_KEY': 'synthetic-groq', 'SUPABASE_SECRET_KEY': 'synthetic-db'}
        scripts = {
            'python3': 'echo "python3 $*" >> "$CALLS"; case "$*" in *check_ai_provider_models.py*) exit "${PREFLIGHT_EXIT:-0}";; esac',
            'node': 'echo "node $*" >> "$CALLS"; exit "${VERSION_EXIT:-0}"',
            'npm': 'echo "npm $*" >> "$CALLS"; exit "${NPM_EXIT:-0}"',
            'curl': 'echo "curl $*" >> "$CALLS"; echo \'{"status":"ok"}\'',
            'nohup': '"$@"',
        }
        for name, body in scripts.items():
            path = self.root / 'bin' / name
            path.write_text('#!/bin/bash\n' + body + '\n')
            path.chmod(0o700)

    def launch(self):
        return subprocess.run(['bash', str(self.root / '.devcontainer/start.sh')], env=self.env,
                              capture_output=True, text=True, timeout=8)

    def test_ai_outage_occurs_after_web_health_and_keeps_web_available(self):
        self.env['PREFLIGHT_EXIT'] = '2'
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.log.read_text()
        self.assertLess(calls.index('/api/health'), calls.index('check_ai_provider_models.py'))
        self.assertIn('web app remains available', result.stdout)
        self.assertNotIn('Both AI accounts passed', result.stdout)
        self.assertNotIn('codespaces_recovery.py --start', calls)
        self.assertNotIn('synthetic-google', result.stdout + result.stderr)

    def test_missing_key_has_recovery_and_preserves_failure(self):
        del self.env['GEMINI_API_KEY']
        result = self.launch()
        self.assertEqual(result.returncode, 2)
        self.assertIn('codespaces_recovery.py --start --reason configuration', self.log.read_text())
        self.assertNotIn('synthetic-groq', result.stdout + result.stderr)

    def test_dependency_failure_is_not_bypassed(self):
        self.env['NPM_EXIT'] = '1'
        result = self.launch()
        self.assertEqual(result.returncode, 1)
        calls = self.log.read_text()
        self.assertIn('codespaces_recovery.py --start --reason startup', calls)
        self.assertNotIn('npm run dev', calls)

    def test_unsafe_installed_version_is_not_bypassed(self):
        self.env['VERSION_EXIT'] = '1'
        self.assertEqual(self.launch().returncode, 1)
        calls = self.log.read_text()
        self.assertIn('codespaces_recovery.py --start', calls)
        self.assertNotIn('npm run dev', calls)

    def test_leftover_full_config_does_not_select_docker_startup(self):
        (self.root / '.env.codespaces-preview').write_text('leftover from failed startup')
        self.assertEqual(self.launch().returncode, 0)
        self.assertIn('npm ci', self.log.read_text())

    def test_explicit_full_mode_still_selects_full_launcher(self):
        self.env['GENITHM_CODESPACES_MODE'] = 'full'
        (self.root / 'scripts/codespaces_preview.sh').write_text('#!/bin/bash\necho full-mode >> "$CALLS"\n')
        self.assertEqual(self.launch().returncode, 0)
        self.assertIn('full-mode', self.log.read_text())

    def test_full_failure_gets_recovery_not_false_chat_success(self):
        self.env['GENITHM_CODESPACES_MODE'] = 'full'
        (self.root / 'scripts/codespaces_preview.sh').write_text('#!/bin/bash\nexit 4\n')
        self.assertEqual(self.launch().returncode, 4)
        self.assertIn('codespaces_recovery.py --start', self.log.read_text())
        self.assertNotIn('npm run dev', self.log.read_text())

    def test_port_configuration_is_http_and_does_not_auto_open_early(self):
        config = json.loads((ROOT / '.devcontainer/devcontainer.json').read_text())
        port = config['portsAttributes']['3000']
        self.assertEqual(port['protocol'], 'http')
        self.assertEqual(port['visibility'], 'private')
        self.assertEqual(port['onAutoForward'], 'notify')


if __name__ == '__main__':
    unittest.main()
