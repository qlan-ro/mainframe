import os
import shutil
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
LISTEN = 'import socket,sys,time; s=socket.socket(); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(); print("up",flush=True); time.sleep(60)'

# Connects to a port and reads until the server goes away.
APP = r"""
#include <arpa/inet.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>
int main(int argc, char **argv) {
  struct sockaddr_in to = {.sin_family = AF_INET, .sin_port = htons(atoi(argv[1]))};
  inet_pton(AF_INET, "127.0.0.1", &to.sin_addr);
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  char c;
  return connect(fd, (struct sockaddr *)&to, sizeof to) || read(fd, &c, 1) > 0;
}
"""


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class TeardownTests(unittest.TestCase):
    """Every process here is the test's own, on a port the system handed out."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name).resolve()
        for name in ['checkout', 'checkout/.worktrees/nested', 'elsewhere']:
            (self.root / name).mkdir(parents=True)
            subprocess.run(['git', 'init', '-q', str(self.root / name)], check=True)

    def listen(self, cwd, port):
        child = subprocess.Popen([sys.executable, '-c', LISTEN, str(port)], cwd=self.root / cwd, stdout=subprocess.PIPE)
        self.addCleanup(child.wait)
        self.addCleanup(child.kill)
        self.addCleanup(child.stdout.close)
        child.stdout.readline()
        return child

    def script(self, name, *args):
        env = dict(os.environ, MF_TARGET=str(self.root / 'checkout'))
        return subprocess.run(['bash', str(SCRIPTS / name), *map(str, args)], env=env, capture_output=True, text=True, timeout=60)

    def assert_survives(self, child):
        time.sleep(0.4)  # a signal lands after kill returns
        self.assertIsNone(child.poll())

    def test_stops_a_listener_of_this_checkout(self):
        port = free_port()
        child = self.listen('checkout', port)
        result = self.script('stop-test.sh', port)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(child.wait(5), -9)

    def test_names_and_leaves_a_listener_of_another_checkout(self):
        for cwd in ['elsewhere', 'checkout/.worktrees/nested']:
            port = free_port()
            child = self.listen(cwd, port)
            result = self.script('stop-test.sh', port)
            self.assertEqual(result.returncode, 1)
            self.assertIn(f'port {port} is held by pid {child.pid}', result.stderr)
            self.assert_survives(child)

    def test_leaves_a_client_of_the_port(self):
        port = free_port()
        self.listen('checkout', port)
        client = subprocess.Popen(
            [sys.executable, '-c', f'import socket,time; s=socket.create_connection(("127.0.0.1",{port})); print("up",flush=True); time.sleep(60)'],
            cwd=self.root / 'checkout', stdout=subprocess.PIPE,
        )
        self.addCleanup(client.wait)
        self.addCleanup(client.kill)
        self.addCleanup(client.stdout.close)
        client.stdout.readline()
        self.script('stop-test.sh', port)
        self.assert_survives(client)

    @unittest.skipUnless(shutil.which('cc'), 'needs a C compiler')
    def test_takes_the_app_of_this_checkout_that_is_connected_to_its_daemon_and_no_other(self):
        for checkout, survives in [('checkout', False), ('checkout/.worktrees/nested', True), ('elsewhere', True)]:
            port = free_port()
            self.listen('checkout', port)
            app = self.root / checkout / 'app'
            subprocess.run(['cc', '-x', 'c', '-', '-o', str(app)], input=APP, text=True, check=True)
            child = subprocess.Popen([str(app), str(port)], cwd=self.root / 'checkout')
            self.addCleanup(child.wait)
            self.addCleanup(child.kill)
            deadline = time.time() + 5
            while not self.connected(child.pid) and time.time() < deadline:
                time.sleep(0.1)
            self.assertTrue(self.connected(child.pid))
            self.script('stop-test.sh', port)
            # Left alone, it ends by itself when its server closes the connection.
            self.assertEqual(child.wait(5) == -9, not survives, checkout)

    def connected(self, pid):
        out = subprocess.run(['lsof', '-a', '-nP', '-p', str(pid), '-iTCP', '-sTCP:ESTABLISHED'], capture_output=True, text=True)
        return out.returncode == 0

    def test_reset_stops_this_checkouts_ports_and_leaves_its_neighbours(self):
        daemon, vite, other = free_port(), free_port(), free_port()
        (self.root / 'checkout/.env').write_text(f'DAEMON_PORT={daemon}\nVITE_PORT={vite}\n')
        own = self.listen('checkout', daemon)
        foreign = self.listen('elsewhere', vite)
        neighbour = self.listen('elsewhere', other)
        self.script('cleanup-test.sh')
        self.assertEqual(own.wait(5), -9)
        self.assert_survives(foreign)
        self.assert_survives(neighbour)

    def test_demo_never_stops_another_checkouts_demo(self):
        daemon, vite = free_port(), free_port()
        child = self.listen('elsewhere', daemon)
        data = self.root / 'data'
        data.mkdir()
        env = dict(os.environ, MF_DEMO_DAEMON_PORT=str(daemon), MF_DEMO_VITE_PORT=str(vite), MF_DEMO_DATA_DIR=str(data), MF_DEMO_WORKSPACE=str(self.root / 'demo'))
        result = subprocess.run(['bash', str(SCRIPTS / 'demo-env.sh'), 'down'], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 1)
        self.assert_survives(child)
        self.assertTrue(data.exists())

    def test_refuses_the_installed_apps_port(self):
        # Refused before any lookup, so nothing looks at that port.
        result = subprocess.run(
            ['bash', '-c', f'. "{SCRIPTS}/own-ports.sh"; lsof() {{ echo LOOKED; }}; stop_port 31415 "{self.root}/checkout"'],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn('REFUSED', result.stderr)
        self.assertNotIn('LOOKED', result.stdout)


if __name__ == '__main__':
    unittest.main()
