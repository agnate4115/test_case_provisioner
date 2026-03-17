"""
TestForge SQLite Database Layer
Persistent storage for environments, test cases, runs, and results
"""
import sqlite3
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

DB_PATH = Path("/tmp/testforge.db")

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS environments (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            status      TEXT DEFAULT 'creating',
            python_version TEXT DEFAULT '3.11',
            packages    TEXT DEFAULT '[]',
            path        TEXT,
            created_at  TEXT,
            error       TEXT,
            venv_python TEXT
        );

        CREATE TABLE IF NOT EXISTS test_cases (
            id          TEXT PRIMARY KEY,
            env_id      TEXT NOT NULL,
            name        TEXT NOT NULL,
            description TEXT,
            test_type   TEXT DEFAULT 'functional',
            steps       TEXT DEFAULT '[]',
            expected    TEXT,
            priority    TEXT DEFAULT 'medium',
            tags        TEXT DEFAULT '[]',
            source      TEXT DEFAULT 'ai',
            status      TEXT DEFAULT 'pending',
            approved    INTEGER DEFAULT 0,
            created_at  TEXT,
            FOREIGN KEY(env_id) REFERENCES environments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS test_runs (
            id          TEXT PRIMARY KEY,
            env_id      TEXT NOT NULL,
            status      TEXT DEFAULT 'running',
            browsers    TEXT DEFAULT '["chrome"]',
            target_url  TEXT DEFAULT 'http://localhost:3001',
            parallel    INTEGER DEFAULT 0,
            started_at  TEXT,
            completed_at TEXT,
            FOREIGN KEY(env_id) REFERENCES environments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS test_results (
            id          TEXT PRIMARY KEY,
            run_id      TEXT NOT NULL,
            test_id     TEXT NOT NULL,
            test_name   TEXT,
            browser     TEXT,
            status      TEXT,
            duration_ms INTEGER,
            error       TEXT,
            screenshot  TEXT,
            logs        TEXT DEFAULT '[]',
            metrics     TEXT DEFAULT '{}',
            FOREIGN KEY(run_id) REFERENCES test_runs(id) ON DELETE CASCADE
        );
        """)
    print(f"[DB] Initialized at {DB_PATH}")

# ── Environments ──────────────────────────────────────────────────────────────
def env_create(data: dict) -> dict:
    with get_db() as conn:
        conn.execute("""
            INSERT INTO environments (id,name,status,python_version,packages,path,created_at)
            VALUES (?,?,?,?,?,?,?)
        """, (data['id'], data['name'], data.get('status','creating'),
              data.get('python_version','3.11'), json.dumps(data.get('packages',[])),
              data.get('path',''), datetime.now().isoformat()))
    return env_get(data['id'])

def env_update(env_id: str, fields: dict):
    allowed = {'status','error','venv_python','path'}
    sets, vals = [], []
    for k,v in fields.items():
        if k in allowed:
            sets.append(f"{k}=?")
            vals.append(v)
    if sets:
        vals.append(env_id)
        with get_db() as conn:
            conn.execute(f"UPDATE environments SET {','.join(sets)} WHERE id=?", vals)

def env_get(env_id: str) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM environments WHERE id=?", (env_id,)).fetchone()
    if not row: return None
    d = dict(row)
    d['packages']    = json.loads(d['packages'] or '[]')
    d['test_cases']  = tc_list(env_id, approved_only=False)
    return d

def env_list() -> List[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT id FROM environments ORDER BY created_at DESC").fetchall()
    return [env_get(r['id']) for r in rows]

def env_delete(env_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM environments WHERE id=?", (env_id,))

# ── Test Cases ────────────────────────────────────────────────────────────────
def tc_insert(tc: dict) -> dict:
    tid = tc.get('id') or str(uuid.uuid4())[:8]
    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO test_cases
              (id,env_id,name,description,test_type,steps,expected,priority,tags,source,status,approved,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (tid, tc['env_id'], tc['name'], tc.get('description',''),
              tc.get('test_type','functional'), json.dumps(tc.get('steps',[])),
              tc.get('expected',''), tc.get('priority','medium'),
              json.dumps(tc.get('tags',[])), tc.get('source','ai'),
              tc.get('status','pending'), int(tc.get('approved',0)),
              datetime.now().isoformat()))
    return tc_get(tid)

def tc_get(tc_id: str) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM test_cases WHERE id=?", (tc_id,)).fetchone()
    if not row: return None
    d = dict(row)
    d['steps'] = json.loads(d['steps'] or '[]')
    d['tags']  = json.loads(d['tags']  or '[]')
    d['approved'] = bool(d['approved'])
    return d

def tc_list(env_id: str, approved_only=False) -> List[dict]:
    q = "SELECT id FROM test_cases WHERE env_id=?"
    if approved_only: q += " AND approved=1"
    q += " ORDER BY created_at ASC"
    with get_db() as conn:
        rows = conn.execute(q, (env_id,)).fetchall()
    return [tc_get(r['id']) for r in rows]

def tc_approve(tc_id: str, approved: bool):
    with get_db() as conn:
        conn.execute("UPDATE test_cases SET approved=? WHERE id=?", (int(approved), tc_id))

def tc_delete(tc_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM test_cases WHERE id=?", (tc_id,))

def tc_update_status(tc_id: str, status: str):
    with get_db() as conn:
        conn.execute("UPDATE test_cases SET status=? WHERE id=?", (status, tc_id))

def tc_bulk_approve(env_id: str, tc_ids: List[str], approved: bool):
    with get_db() as conn:
        for tid in tc_ids:
            conn.execute("UPDATE test_cases SET approved=? WHERE id=? AND env_id=?",
                         (int(approved), tid, env_id))

# ── Runs ──────────────────────────────────────────────────────────────────────
def run_create(data: dict) -> dict:
    with get_db() as conn:
        conn.execute("""
            INSERT INTO test_runs (id,env_id,status,browsers,target_url,parallel,started_at)
            VALUES (?,?,?,?,?,?,?)
        """, (data['id'], data['env_id'], 'running',
              json.dumps(data.get('browsers',['chrome'])),
              data.get('target_url','http://localhost:3001'),
              int(data.get('parallel',False)),
              datetime.now().isoformat()))
    return run_get(data['id'])

def run_update(run_id: str, fields: dict):
    allowed = {'status','completed_at'}
    sets, vals = [], []
    for k,v in fields.items():
        if k in allowed:
            sets.append(f"{k}=?")
            vals.append(v)
    if sets:
        vals.append(run_id)
        with get_db() as conn:
            conn.execute(f"UPDATE test_runs SET {','.join(sets)} WHERE id=?", vals)

def run_get(run_id: str) -> Optional[dict]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM test_runs WHERE id=?", (run_id,)).fetchone()
    if not row: return None
    d = dict(row)
    d['browsers'] = json.loads(d['browsers'] or '["chrome"]')
    d['results']  = result_list(run_id)
    return d

def run_list(env_id: str = None) -> List[dict]:
    with get_db() as conn:
        if env_id:
            rows = conn.execute("SELECT id FROM test_runs WHERE env_id=? ORDER BY started_at DESC", (env_id,)).fetchall()
        else:
            rows = conn.execute("SELECT id FROM test_runs ORDER BY started_at DESC").fetchall()
    return [run_get(r['id']) for r in rows]

# ── Results ───────────────────────────────────────────────────────────────────
def result_insert(data: dict):
    rid = str(uuid.uuid4())[:8]
    with get_db() as conn:
        conn.execute("""
            INSERT INTO test_results
              (id,run_id,test_id,test_name,browser,status,duration_ms,error,screenshot,logs,metrics)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (rid, data['run_id'], data['test_id'], data.get('test_name',''),
              data.get('browser','chrome'), data.get('status','pending'),
              data.get('duration_ms',0), data.get('error'),
              data.get('screenshot'), json.dumps(data.get('logs',[])),
              json.dumps(data.get('metrics',{}))))

def result_list(run_id: str) -> List[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM test_results WHERE run_id=? ORDER BY rowid", (run_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d['logs']    = json.loads(d['logs']    or '[]')
        d['metrics'] = json.loads(d['metrics'] or '{}')
        out.append(d)
    return out
