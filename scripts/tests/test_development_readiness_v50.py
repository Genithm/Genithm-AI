"""Execute real launchers against isolated command fixtures; never contact user services."""
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SHA='a'*40
class DevelopmentReadiness(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        (self.root/'scripts').mkdir();(self.root/'apps/web/node_modules').mkdir(parents=True)
        self.bin=self.root/'bin';self.bin.mkdir()
        for name in ('codespaces_preview.sh','codespaces_bioai.sh','stop_codespaces_web.py'):
            shutil.copyfile(ROOT/'scripts'/name,self.root/'scripts'/name)
        self.log=self.root/'commands.log'
        self.env={'PATH':str(self.bin)+':/usr/bin:/bin','HOME':str(self.root),'CALLS':str(self.log),
                  'CODESPACE_NAME':'fixture','GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN':'app.github.dev',
                  'SUPABASE_SECRET_KEY':'synthetic-supabase','GEMINI_API_KEY':'synthetic-google','GROQ_API_KEY':'synthetic-groq'}
        programs={
            'git':f'case "$*" in *rev-parse*) echo {SHA};; esac\nexit 0',
            'docker':'echo "docker $*" >> "$CALLS"\ncase "$*" in "pull ghcr.io/"*) exit 1;; esac\nexit 0',
            'node':'echo "node $*" >> "$CALLS"\nexit 0',
            'npm':'echo "npm $*" >> "$CALLS"\nexit 0',
            'python3':'echo "python3 $*" >> "$CALLS"\nexit 0',
            'curl':'''printf '%s\\n' '{"status":"ready","disable_signup":false,"external":{"email":true}}'\nexit 0''',
            'nohup':'"$@"',
        }
        for name,body in programs.items():
            p=self.bin/name;p.write_text('#!/bin/bash\n'+body+'\n');p.chmod(0o700)
    def launch(self,name):
        return subprocess.run(['/bin/bash',str(self.root/'scripts'/name)],env=self.env,capture_output=True,text=True,timeout=8)
    def test_missing_key_lists_name_not_secret(self):
        del self.env['GEMINI_API_KEY']
        p=self.launch('codespaces_bioai.sh')
        self.assertEqual(p.returncode,2);self.assertIn('GEMINI_API_KEY',p.stdout)
        self.assertNotIn('synthetic-groq',p.stdout+p.stderr)
    def test_chat_refreshes_existing_node_modules_and_tests_accounts(self):
        p=self.launch('codespaces_bioai.sh')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        calls=self.log.read_text()
        self.assertIn('npm ci',calls);self.assertIn('--inference',calls)
        self.assertEqual(stat.S_IMODE((self.root/'apps/web/.env.local').stat().st_mode),0o600)
        self.assertNotIn('synthetic-google',p.stdout+p.stderr)
    def test_full_preview_builds_same_revision_when_images_missing(self):
        p=self.launch('codespaces_preview.sh')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        calls=self.log.read_text()
        self.assertEqual(calls.count('docker build '),7)
        self.assertIn('org.opencontainers.image.revision='+SHA,calls)
        self.assertIn('--pull never',calls)
        self.assertIn('--inference',calls)
        self.assertEqual(stat.S_IMODE((self.root/'.env.codespaces-preview').stat().st_mode),0o600)
        self.assertNotIn('synthetic-google',p.stdout+p.stderr)
    def test_obsolete_runtime_is_refused_before_services_start(self):
        self.env['GENITHM_PREVIEW_RUNTIME_SHA']='b'*40
        p=self.launch('codespaces_preview.sh')
        self.assertEqual(p.returncode,4)
        self.assertIn('Development runtime must match',p.stdout)
        self.assertNotIn('docker build',self.log.read_text())
    def test_cancelled_answers_are_not_saved_as_verified_evidence(self):
        source=(ROOT/'apps/web/app/api/ai/chat/route.ts').read_text()
        self.assertIn('Generation stopped before completion. No complete AI answer was saved.',source)
        self.assertNotIn('conversationalPlan(partialVisible ||',source)

if __name__=='__main__':unittest.main()
