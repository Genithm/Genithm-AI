"""Regression coverage for old Codespaces runtimes and missing provider configuration."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('stop_web', ROOT/'scripts/stop_codespaces_web.py')
stop_web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stop_web)


class Startup(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'.devcontainer').mkdir()
        (self.root/'scripts').mkdir()
        (self.root/'apps/web').mkdir(parents=True)
        (self.root/'bin').mkdir()
        shutil.copy(ROOT/'.devcontainer/start.sh', self.root/'.devcontainer/start.sh')
        for name in ('codespaces_bioai.sh', 'codespaces_preview.sh'):
            (self.root/'scripts'/name).write_text('#!/bin/bash\necho '+name+' >> "$CALLS"\n')
        self.calls = self.root/'calls'
        self.env = {'PATH':str(self.root/'bin')+':/usr/bin:/bin', 'HOME':str(self.root),
                    'CODESPACE_NAME':'fixture', 'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN':'app.github.dev',
                    'CALLS':str(self.calls), 'GEMINI_API_KEY':'synthetic-google-private',
                    'GROQ_API_KEY':'synthetic-groq-private', 'SUPABASE_SECRET_KEY':'synthetic-db-private'}
        for name in ('node','npm','python3','curl','nohup'):
            file = self.root/'bin'/name
            # The mocked nohup runs in the background; never write to a
            # temporary fixture after the foreground startup test exits.
            if name == 'nohup':
                file.write_text('#!/bin/bash\nexit 0\n')
            else:
                file.write_text('#!/bin/bash\necho "'+name+' $*" >> "$CALLS"\nexit 0\n')
            file.chmod(0o700)

    def run_start(self):
        return subprocess.run(['bash',str(self.root/'.devcontainer/start.sh')],
                              env=self.env,text=True,capture_output=True,timeout=8)

    def test_default_is_real_chat_not_sample_even_when_curl_reports_existing_server(self):
        result = self.run_start()
        self.assertEqual(result.returncode,0,result.stderr)
        commands = self.calls.read_text()
        self.assertIn('codespaces_bioai.sh',commands)
        self.assertLess(commands.index('stop_codespaces_web.py'),commands.index('codespaces_bioai.sh'))
        self.assertNotIn('npm run dev',commands)
        self.assertNotIn('synthetic-google-private',result.stdout+result.stderr+commands)

    def test_leftover_full_environment_is_not_a_successful_runtime_marker(self):
        (self.root/'.env.codespaces-preview').write_text('not executed or sourced')
        self.assertEqual(self.run_start().returncode,0)
        self.assertIn('codespaces_bioai.sh',self.calls.read_text())
        self.assertNotIn('codespaces_preview.sh',self.calls.read_text())

    def test_explicit_chat_mode_overrides_full_marker(self):
        (self.root/'.env.codespaces-preview').write_text('marker')
        self.env['GENITHM_CODESPACES_MODE'] = 'chat'
        self.assertEqual(self.run_start().returncode,0)
        self.assertIn('codespaces_bioai.sh',self.calls.read_text())

    def test_sample_is_opt_in_and_refreshes_locked_dependencies(self):
        self.env['GENITHM_CODESPACES_MODE'] = 'sample'
        result = self.run_start()
        self.assertEqual(result.returncode,0,result.stderr)
        commands = self.calls.read_text()
        self.assertIn('npm --prefix apps/web ci',commands)
        self.assertIn('check_web_runtime.mjs',commands)
        self.assertIn('sample-only',result.stdout)

    def test_no_sample_fallback_when_real_launcher_fails(self):
        (self.root/'scripts/codespaces_bioai.sh').write_text('#!/bin/bash\nexit 2\n')
        self.assertEqual(self.run_start().returncode,2)
        self.assertNotIn('npm run dev',self.calls.read_text())

    def test_rejects_invalid_mode(self):
        self.env['GENITHM_CODESPACES_MODE'] = 'anything'
        self.assertEqual(self.run_start().returncode,2)

    def test_manual_launchers_stop_before_secrets_and_install(self):
        for name in ('codespaces_bioai.sh','codespaces_preview.sh'):
            source = (ROOT/'scripts'/name).read_text()
            self.assertLess(source.index('stop_codespaces_web.py'),source.index('missing=()'))
            self.assertLess(source.index('stop_codespaces_web.py'),source.index('npm ci'))
            self.assertIn('check_web_runtime.mjs',source)
            self.assertNotIn('fuser -k',source)


class ProcessSafety(unittest.TestCase):
    def test_does_not_treat_installs_or_builds_as_web_servers(self):
        for value in ('npm ci','python3 other.py','node /x/next/dist/bin/next build','npm run developer'):
            self.assertFalse(stop_web.is_web_command(value), value)
        for value in ('next-server (v16.4.0)','npm run dev --port 3000','node /x/next/dist/bin/next dev','npm run start'):
            self.assertTrue(stop_web.is_web_command(value), value)

    def test_foreign_port_user_is_not_killed(self):
        with patch.object(stop_web.Path,'iterdir',return_value=[]), \
             patch.object(stop_web.socket,'create_connection') as connection, \
             patch.object(stop_web.os,'kill') as kill:
            with self.assertRaisesRegex(RuntimeError,'another process'):
                stop_web.stop(ROOT)
            kill.assert_not_called()
            connection.assert_called_once()

    def test_reused_pid_is_not_killed(self):
        with tempfile.TemporaryDirectory() as temporary, \
             patch.object(stop_web.Path,'iterdir',return_value=[Path('/proc/987654')]), \
             patch.object(stop_web,'identity',side_effect=['old-start','new-start','new-start']), \
             patch.object(stop_web.socket,'create_connection',side_effect=ConnectionRefusedError), \
             patch.object(stop_web.os,'kill') as kill:
            stop_web.stop(Path(temporary))
            kill.assert_not_called()


if __name__ == '__main__': unittest.main()
