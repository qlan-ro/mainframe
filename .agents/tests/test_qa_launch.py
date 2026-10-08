import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]

class LaunchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.addCleanup(self.tmp.cleanup)
        (self.root / '.env').write_text('DAEMON_PORT=32001\nVITE_PORT=5901\nMAINFRAME_DATA_DIR=/shared/from-dotenv\n')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name, body in {'pnpm': 'exit 0', 'cargo': 'exit 0', 'rustc': "echo 'host: fake-triple'"}.items():
            self.stub(name, body)
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', MF_TARGET=str(self.root), MF_MODE='prepare', MF_QA_RUN_DIR=str(self.root / 'qa-run'))

    def stub(self, name, body):
        path = self.bin / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def launch(self, script, **kw):
        return subprocess.run(['bash', str(SCRIPTS / script)], env=self.env, capture_output=True, text=True, timeout=8, **kw)

    def test_isolated_data_survives_dotenv_and_is_stable_on_resume(self):
        for script in ['launch-test-browser.sh', 'launch-test-tauri.sh', 'launch-test-tauri-qa.sh']:
            app = self.root / 'packages/app-tauri/src-tauri/target/debug/bundle/macos/Mainframe.app'
            app.mkdir(parents=True, exist_ok=True)
            first, resumed = self.launch(script), self.launch(script)
            self.assertEqual(first.returncode, 0, first.stderr)
            expected = f'DATA_DIR={self.root}/qa-run/data'
            self.assertIn(expected, first.stdout)
            self.assertIn(expected, resumed.stdout)

    def test_browser_detects_exited_daemon_without_waiting_for_readiness_deadline(self):
        daemon = self.root / 'packages/core-rs/target/debug/mainframe-daemon'
        daemon.parent.mkdir(parents=True)
        daemon.write_text('#!/bin/sh\necho "fixture startup failed"\nexit 1\n')
        daemon.chmod(0o755)
        self.stub('curl', 'exit 1')
        self.stub('lsof', 'exit 1')
        self.env['MF_MODE'] = 'up'
        result = self.launch('launch-test-browser.sh')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture startup failed', result.stderr)

if __name__ == '__main__':
    unittest.main()
