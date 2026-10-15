#!/usr/bin/env python3
"""Manage one project fixture in an isolated live QA database."""

import argparse
import datetime
import json
import os
from pathlib import Path
import sqlite3
import uuid


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run_context():
    run = Path(os.environ["MF_QA_RUN_DIR"])
    require(run.is_absolute(), "Run directory must be absolute")
    run = run.resolve(strict=True)
    root = Path("/tmp/live-qa").resolve(strict=True)
    require(root in run.parents, "Use a dedicated /tmp/live-qa run directory")
    db = (run / "data/mainframe.db").resolve(strict=True)
    require(db.is_file() and db.parent == run / "data", "Unexpected database path")
    return db, run / "project-fixture.json"


def make_fixture(marker):
    project = Path(os.environ["MF_QA_PROJECT_PATH"])
    require(project.is_absolute() and project.is_dir(),
            "Project path must be an existing absolute directory")
    fixture = {"id": "qa-" + uuid.uuid4().hex,
               "path": str(project.resolve(strict=True))}
    with marker.open("x") as output:
        json.dump(fixture, output)
    return fixture


def read_fixture(marker):
    fixture = json.loads(marker.read_text())
    require(fixture["id"].startswith("qa-"), "Invalid fixture ID")
    return fixture


def seed(conn, fixture):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    conn.execute("INSERT INTO projects "
                 "(id, name, path, created_at, last_opened_at) VALUES (?, ?, ?, ?, ?)",
                 (fixture["id"], fixture["id"], fixture["path"], now, now))
    row = conn.execute("SELECT id, path FROM projects WHERE id=?",
                       (fixture["id"],)).fetchone()
    require(row == (fixture["id"], fixture["path"]), "Seed readback mismatch")


def restore(conn, fixture, chat_ids):
    row = conn.execute("SELECT name, path FROM projects WHERE id=?",
                       (fixture["id"],)).fetchone()
    require(row is None or row == (fixture["id"], fixture["path"]),
            "Project ownership mismatch")
    actual = {r[0] for r in conn.execute(
        "SELECT id FROM chats WHERE project_id=?", (fixture["id"],))}
    require(actual <= set(chat_ids), "Unrecorded chats: inspect before restoring")
    for chat_id in actual:
        conn.execute("DELETE FROM chats WHERE id=? AND project_id=?",
                     (chat_id, fixture["id"]))
        require(not conn.execute("SELECT 1 FROM chat_native_sessions WHERE chat_id=?",
                                (chat_id,)).fetchone(), "Native-session rows remain")
    conn.execute("DELETE FROM projects WHERE id=?", (fixture["id"],))
    require(not conn.execute("SELECT 1 FROM projects WHERE id=?",
                            (fixture["id"],)).fetchone(), "Project row remains")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("seed", "restore"))
    parser.add_argument("chat_ids", nargs="*")
    args = parser.parse_args()
    require(args.action == "restore" or not args.chat_ids,
            "Chat IDs are only accepted during restore")
    db, marker = run_context()
    fixture = make_fixture(marker) if args.action == "seed" else read_fixture(marker)
    require(fixture["id"].startswith("qa-"), "Invalid fixture ID")
    with sqlite3.connect(db.as_uri() + "?mode=rw", uri=True) as conn:
        conn.execute("PRAGMA foreign_keys=ON")
        require(conn.execute("PRAGMA foreign_keys").fetchone() == (1,),
                "Foreign-key enforcement is disabled")
        conn.execute("BEGIN IMMEDIATE")
        if args.action == "seed":
            seed(conn, fixture)
        else:
            restore(conn, fixture, args.chat_ids)
        require(not conn.execute("PRAGMA foreign_key_check").fetchall(),
                "Foreign-key violations remain")
    if args.action == "seed":
        print(json.dumps(fixture))


if __name__ == "__main__":
    main()
