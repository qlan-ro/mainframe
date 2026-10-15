import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "seed-qa-project.py"


class ProjectSeedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir="/tmp/live-qa")
        self.addCleanup(self.tmp.cleanup)
        self.run_dir = Path(self.tmp.name)
        data = self.run_dir / "data"
        data.mkdir()
        self.db = data / "mainframe.db"
        self.project = self.run_dir / "checkout"
        self.project.mkdir()
        self.env = dict(os.environ, MF_QA_RUN_DIR=str(self.run_dir),
                        MF_QA_PROJECT_PATH=str(self.project))
        with sqlite3.connect(self.db) as conn:
            conn.executescript("""
                PRAGMA foreign_keys=ON;
                CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, path TEXT,
                    created_at TEXT, last_opened_at TEXT);
                CREATE TABLE chats (id TEXT PRIMARY KEY, project_id TEXT
                    REFERENCES projects(id));
                CREATE TABLE chat_native_sessions (chat_id TEXT
                    REFERENCES chats(id) ON DELETE CASCADE);
            """)
            conn.execute("INSERT INTO projects VALUES (?, ?, ?, ?, ?)",
                         ("existing", "existing", "/unrelated", "now", "now"))

    def invoke(self, *args, env=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args],
                              env=env or self.env, capture_output=True,
                              text=True, timeout=10)

    def seed(self):
        result = self.invoke("seed")
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def rows(self, table):
        with sqlite3.connect(self.db) as conn:
            return conn.execute(f"SELECT * FROM {table}").fetchall()

    def test_seed_and_restore_only_owned_rows(self):
        fixture = self.seed()
        self.assertEqual(fixture["path"], str(self.project.resolve()))
        self.assertEqual(json.loads((self.run_dir / "project-fixture.json").read_text()),
                         fixture)
        with sqlite3.connect(self.db) as conn:
            conn.execute("INSERT INTO chats VALUES (?, ?)", ("imported", fixture["id"]))
            conn.execute("INSERT INTO chat_native_sessions VALUES (?)", ("imported",))
        result = self.invoke("restore", "imported")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([row[0] for row in self.rows("projects")], ["existing"])
        self.assertEqual(self.rows("chats"), [])
        self.assertEqual(self.rows("chat_native_sessions"), [])

    def test_unrecorded_chat_rolls_back(self):
        fixture = self.seed()
        with sqlite3.connect(self.db) as conn:
            conn.execute("INSERT INTO chats VALUES (?, ?)", ("unrecorded", fixture["id"]))
        result = self.invoke("restore")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unrecorded chats", result.stderr)
        self.assertEqual([row[0] for row in self.rows("chats")], ["unrecorded"])
        self.assertIn(fixture["id"], [row[0] for row in self.rows("projects")])

    def test_refuses_symlinked_database_directory(self):
        other = self.run_dir / "other"
        other.mkdir()
        (other / "mainframe.db").write_bytes(self.db.read_bytes())
        (self.run_dir / "data/mainframe.db").unlink()
        (self.run_dir / "data").rmdir()
        (self.run_dir / "data").symlink_to(other, target_is_directory=True)
        result = self.invoke("seed")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unexpected database path", result.stderr)

    def test_refuses_missing_database_and_outside_run(self):
        self.db.unlink()
        self.assertNotEqual(self.invoke("seed").returncode, 0)
        with tempfile.TemporaryDirectory() as outside_dir:
            outside = dict(self.env, MF_QA_RUN_DIR=outside_dir)
            result = self.invoke("seed", env=outside)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("dedicated /tmp/live-qa", result.stderr)


if __name__ == "__main__":
    unittest.main()
