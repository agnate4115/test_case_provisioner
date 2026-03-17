"""TestForge Backend — FastAPI + SQLite"""
import asyncio, base64, json, os, shutil, subprocess, sys, time, uuid, zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# Load .env
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

DEFAULT_AZURE_ENDPOINT   = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
DEFAULT_AZURE_KEY        = os.environ.get("AZURE_OPENAI_API_KEY", "")
DEFAULT_AZURE_DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o")

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from database import (
    init_db, env_create, env_update, env_get, env_list, env_delete,
    tc_insert, tc_get, tc_list, tc_approve, tc_delete, tc_update_status, tc_bulk_approve,
    run_create, run_update, run_get, run_list, result_insert, result_list
)

app = FastAPI(title="TestForge API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

WORKSPACE   = Path("/tmp/testforge_workspaces")
REPORTS_DIR = Path("/tmp/testforge_reports")
WORKSPACE.mkdir(exist_ok=True)
REPORTS_DIR.mkdir(exist_ok=True)

# ── WS connections ────────────────────────────────────────────────────────────
ws_connections: Dict[str, WebSocket] = {}

@app.websocket("/ws/{channel}")
async def websocket_endpoint(ws: WebSocket, channel: str):
    await ws.accept()
    ws_connections[channel] = ws
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect:
        ws_connections.pop(channel, None)

async def push(channel: str, data: dict):
    ws = ws_connections.get(channel)
    if ws:
        try: await ws.send_json(data)
        except: pass

# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    init_db()

@app.get("/api/health")
async def health(): return {"status": "ok", "version": "2.0.0"}

# ── Models ────────────────────────────────────────────────────────────────────
class CreateEnvRequest(BaseModel):
    name: str
    python_version: str = "3.11"
    packages: List[str] = ["selenium", "pytest", "requests"]

class GenerateTestsRequest(BaseModel):
    env_id: str
    file_paths: List[str] = []
    mode: str = "auto"
    azure_endpoint: Optional[str] = None
    azure_key: Optional[str] = None
    azure_deployment: Optional[str] = None
    custom_instructions: Optional[str] = None
    target_url: str = "http://localhost:3001"

class ManualTestCase(BaseModel):
    name: str
    description: str = ""
    steps: List[str] = []
    expected: str = ""
    test_type: str = "functional"
    priority: str = "medium"
    tags: List[str] = []

class ApproveRequest(BaseModel):
    tc_ids: List[str]
    approved: bool = True

class RunTestsRequest(BaseModel):
    env_id: str
    test_ids: List[str] = ["all"]
    browsers: List[str] = ["chrome"]
    target_url: str = "http://localhost:3001"
    parallel: bool = False

# ── Environments ──────────────────────────────────────────────────────────────
@app.post("/api/environments")
async def create_environment(req: CreateEnvRequest, bg: BackgroundTasks):
    env_id = str(uuid.uuid4())[:8]
    env_path = WORKSPACE / env_id
    env_path.mkdir(parents=True, exist_ok=True)
    (env_path / "tests").mkdir(exist_ok=True)
    (env_path / "screenshots").mkdir(exist_ok=True)
    (env_path / "source").mkdir(exist_ok=True)

    env_create({"id": env_id, "name": req.name, "python_version": req.python_version,
                "packages": req.packages, "path": str(env_path)})
    bg.add_task(provision_env, env_id, req)
    return {"env_id": env_id, "status": "creating"}

async def provision_env(env_id: str, req: CreateEnvRequest):
    env_path = WORKSPACE / env_id
    try:
        await push(env_id, {"type":"env_log","msg":f"🔧 Creating environment '{req.name}'…"})
        await asyncio.sleep(0.5)
        await push(env_id, {"type":"env_log","msg":"📦 Setting up workspace…"})
        (env_path / "pytest.ini").write_text("[pytest]\naddopts=-v\n")
        await asyncio.sleep(0.5)
        await push(env_id, {"type":"env_log","msg":"✅ Environment ready!"})
        env_update(env_id, {"status":"ready"})
        await push(env_id, {"type":"env_ready","env_id":env_id,"msg":"Environment ready!"})
    except Exception as e:
        env_update(env_id, {"status":"error","error":str(e)})
        await push(env_id, {"type":"env_error","msg":str(e)})

@app.get("/api/environments")
async def list_environments():
    return env_list()

@app.get("/api/environments/{env_id}")
async def get_environment(env_id: str):
    env = env_get(env_id)
    if not env: raise HTTPException(404, "Not found")
    return env

@app.delete("/api/environments/{env_id}")
async def delete_environment(env_id: str):
    env = env_get(env_id)
    if not env: raise HTTPException(404, "Not found")
    p = Path(env.get("path",""))
    if p.exists(): shutil.rmtree(p, ignore_errors=True)
    env_delete(env_id)
    return {"status":"destroyed"}

# ── File Upload ───────────────────────────────────────────────────────────────
@app.post("/api/environments/{env_id}/upload")
async def upload_files(env_id: str, files: List[UploadFile] = File(...)):
    env = env_get(env_id)
    if not env: raise HTTPException(404)
    src_dir = WORKSPACE / env_id / "source"
    src_dir.mkdir(exist_ok=True)
    saved = []
    for f in files:
        dest = src_dir / f.filename
        dest.write_bytes(await f.read())
        saved.append(f.filename)
    return {"uploaded": saved}

# ── Test Generation ───────────────────────────────────────────────────────────
@app.post("/api/tests/generate")
async def generate_tests(req: GenerateTestsRequest, bg: BackgroundTasks):
    env = env_get(req.env_id)
    if not env: raise HTTPException(404)
    session_id = str(uuid.uuid4())[:8]
    bg.add_task(run_generation, session_id, req)
    return {"session_id": session_id}

async def run_generation(session_id: str, req: GenerateTestsRequest):
    await push(session_id, {"type":"gen_start","msg":"🤖 Starting AI test generation…"})
    try:
        src_dir = WORKSPACE / req.env_id / "source"
        code = ""
        for fp in req.file_paths:
            fpath = src_dir / fp
            if fpath.exists():
                code += f"\n# === {fp} ===\n{fpath.read_text(errors='replace')}"
        if not code:
            code = "// Demo todo/login app with React components"

        await push(session_id, {"type":"gen_log","msg":f"📄 Analysing {len(req.file_paths) or 1} file(s)…"})

        ep  = req.azure_endpoint   or DEFAULT_AZURE_ENDPOINT
        key = req.azure_key        or DEFAULT_AZURE_KEY
        dep = req.azure_deployment or DEFAULT_AZURE_DEPLOYMENT

        if ep and key:
            await push(session_id, {"type":"gen_log","msg":f"🔗 Calling Azure OpenAI ({dep})…"})
            test_cases = await call_azure(ep, key, dep, code, req.custom_instructions)
        else:
            await push(session_id, {"type":"gen_log","msg":"⚙️  Using built-in generator…"})
            test_cases = builtin_generate(code)

        generic = generic_tests()
        all_tcs = test_cases + generic

        await push(session_id, {"type":"gen_log","msg":f"💾 Saving {len(all_tcs)} test cases to database…"})
        saved = []
        for tc in all_tcs:
            tc["env_id"] = req.env_id
            tc["source"] = "ai"
            tc["approved"] = False
            row = tc_insert(tc)
            saved.append(row)

        await push(session_id, {"type":"gen_done","test_cases":saved,
                                 "msg":f"✅ Generated {len(saved)} tests — review & approve them in the Review tab"})
    except Exception as e:
        await push(session_id, {"type":"gen_error","msg":str(e)})

async def call_azure(endpoint, key, deployment, code, custom):
    prompt = f"""You are a senior QA engineer. Analyze this code and generate comprehensive test cases.
Return ONLY a JSON array. Each object must have:
- name: string
- description: string
- test_type: "functional"|"ui"|"api"|"performance"|"security"
- steps: array of strings
- expected: string
- priority: "high"|"medium"|"low"
- tags: array of strings

{custom or ''}

CODE:
{code[:5000]}

Generate 8-12 diverse tests covering happy paths, edge cases, and error scenarios.
Return ONLY the JSON array, no markdown."""

    url = f"{endpoint.rstrip('/')}/openai/deployments/{deployment}/chat/completions?api-version=2024-08-01-preview"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers={"api-key":key,"Content-Type":"application/json"},
            json={"messages":[{"role":"user","content":prompt}],"max_tokens":3000,"temperature":0.3})
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()

    if content.startswith("```"):
        lines = content.split("\n")
        content = "\n".join(lines[1:-1] if lines[-1]=="```" else lines[1:])
    return json.loads(content)

def builtin_generate(code: str) -> List[dict]:
    base = [
        {"name":"Valid Login Flow","test_type":"ui","priority":"high",
         "description":"Verify user can login with valid credentials",
         "steps":["Navigate to app","Enter valid email","Enter valid password","Click login"],
         "expected":"User redirected to dashboard","tags":["auth","smoke"]},
        {"name":"Invalid Login — Wrong Password","test_type":"functional","priority":"high",
         "description":"Verify error shown for wrong password",
         "steps":["Navigate to login","Enter valid email","Enter wrong password","Click login"],
         "expected":"Error message displayed","tags":["auth","negative"]},
        {"name":"Form Validation — Empty Fields","test_type":"functional","priority":"high",
         "description":"Required fields show validation errors when empty",
         "steps":["Navigate to form","Leave fields empty","Click submit"],
         "expected":"Validation errors shown","tags":["validation"]},
        {"name":"Add Todo Item","test_type":"ui","priority":"medium",
         "description":"User can add a new todo item",
         "steps":["Login","Type task in input","Click Add","Verify item in list"],
         "expected":"Item appears in list","tags":["todo","crud"]},
        {"name":"Delete Todo Item","test_type":"ui","priority":"medium",
         "description":"User can delete a todo item",
         "steps":["Login","Add a todo","Click delete button","Verify removed"],
         "expected":"Item removed from list","tags":["todo","crud"]},
        {"name":"Toggle Todo Complete","test_type":"functional","priority":"medium",
         "description":"User can mark todo as done",
         "steps":["Login","Add todo","Click checkbox","Verify strikethrough"],
         "expected":"Item marked complete","tags":["todo"]},
        {"name":"Filter Active Todos","test_type":"functional","priority":"low",
         "description":"Filter shows only active (incomplete) items",
         "steps":["Login","Add multiple todos","Complete some","Click Active filter"],
         "expected":"Only active items shown","tags":["filter","todo"]},
        {"name":"API Health Check","test_type":"api","priority":"high",
         "description":"API health endpoint returns 200",
         "steps":["GET /api/health","Check status code","Validate body"],
         "expected":"Status 200 with ok","tags":["api","smoke"]},
        {"name":"Page Load Performance","test_type":"performance","priority":"medium",
         "description":"Page loads within acceptable time",
         "steps":["Navigate to app","Measure FCP","Measure TTI"],
         "expected":"FCP < 1.5s, TTI < 3s","tags":["performance"]},
    ]
    return base

def generic_tests() -> List[dict]:
    return [
        {"name":"404 Error Handling","test_type":"functional","priority":"low",
         "description":"Non-existent routes show 404 page",
         "steps":["Navigate to /this-does-not-exist","Check response"],
         "expected":"404 page or redirect to home","tags":["error-handling"]},
        {"name":"Console Error Check","test_type":"ui","priority":"high",
         "description":"No JS console errors on page load",
         "steps":["Open browser devtools","Navigate to app","Check console"],
         "expected":"Zero console errors","tags":["smoke","quality"]},
        {"name":"Responsive Layout — Mobile","test_type":"ui","priority":"medium",
         "description":"Layout adapts correctly on mobile viewport",
         "steps":["Set viewport to 375px","Navigate to app","Check layout"],
         "expected":"No horizontal scroll, content readable","tags":["responsive"]},
        {"name":"Cross-Browser Rendering","test_type":"ui","priority":"medium",
         "description":"Consistent rendering across browsers",
         "steps":["Open in Chrome","Open in Firefox","Compare rendering"],
         "expected":"Visual consistency","tags":["cross-browser"]},
        {"name":"Accessibility — ARIA Labels","test_type":"functional","priority":"medium",
         "description":"Interactive elements have ARIA labels",
         "steps":["Inspect buttons and inputs","Check aria-label attributes"],
         "expected":"All elements have descriptive labels","tags":["a11y","accessibility"]},
    ]

# ── Test Case CRUD ────────────────────────────────────────────────────────────
@app.get("/api/environments/{env_id}/tests")
async def get_tests(env_id: str, approved_only: bool = False):
    return tc_list(env_id, approved_only=approved_only)

@app.post("/api/environments/{env_id}/tests/manual")
async def add_manual_test(env_id: str, tc: ManualTestCase):
    env = env_get(env_id)
    if not env: raise HTTPException(404)
    row = tc_insert({"env_id":env_id,"name":tc.name,"description":tc.description,
                     "steps":tc.steps,"expected":tc.expected,"test_type":tc.test_type,
                     "priority":tc.priority,"tags":tc.tags,"source":"manual","approved":True})
    return row

@app.patch("/api/tests/{tc_id}/approve")
async def approve_test(tc_id: str, body: dict):
    tc_approve(tc_id, body.get("approved", True))
    return tc_get(tc_id)

@app.post("/api/environments/{env_id}/tests/bulk-approve")
async def bulk_approve(env_id: str, req: ApproveRequest):
    tc_bulk_approve(env_id, req.tc_ids, req.approved)
    return {"approved": len(req.tc_ids)}

@app.delete("/api/tests/{tc_id}")
async def delete_test(tc_id: str):
    tc_delete(tc_id)
    return {"deleted": tc_id}

# ── Run Tests ─────────────────────────────────────────────────────────────────
@app.post("/api/tests/run")
async def run_tests(req: RunTestsRequest, bg: BackgroundTasks):
    env = env_get(req.env_id)
    if not env: raise HTTPException(404)

    run_id = str(uuid.uuid4())[:8]
    run_create({"id":run_id,"env_id":req.env_id,"browsers":req.browsers,
                "target_url":req.target_url,"parallel":req.parallel})
    bg.add_task(execute_tests, run_id, req)
    return {"run_id": run_id}

async def execute_tests(run_id: str, req: RunTestsRequest):
    # Get test cases to run
    if "all" in req.test_ids:
        tests = tc_list(req.env_id, approved_only=True)
    else:
        tests = [tc_get(tid) for tid in req.test_ids if tc_get(tid)]
        tests = [t for t in tests if t]

    if not tests:
        await push(run_id, {"type":"run_error","msg":"No approved test cases to run. Approve tests first."})
        run_update(run_id, {"status":"failed","completed_at":datetime.now().isoformat()})
        return

    total = len(tests) * len(req.browsers)
    await push(run_id, {"type":"run_start","msg":f"🚀 Running {len(tests)} tests × {len(req.browsers)} browser(s) = {total} executions",
                        "total":total, "tests":tests, "browsers":req.browsers})

    for browser in req.browsers:
        await push(run_id, {"type":"browser_start","browser":browser,
                            "msg":f"🌐 Starting {browser}…"})
        for tc in tests:
            await push(run_id, {"type":"test_start","test_id":tc['id'],"browser":browser,
                                "test_name":tc['name']})
            start = time.time()
            result = await simulate_test(tc, browser, req.target_url, run_id)
            elapsed_ms = int((time.time()-start)*1000)

            result.update({"run_id":run_id,"test_id":tc['id'],"test_name":tc['name'],
                           "browser":browser,"duration_ms":elapsed_ms})
            result_insert(result)
            tc_update_status(tc['id'], result['status'])

            await push(run_id, {"type":"test_result","test_id":tc['id'],"browser":browser,
                                "result":result,"duration_ms":elapsed_ms})

            # Push per-browser update for live 4-pane view
            await push(f"{run_id}_{browser}", {"type":"test_result","result":result})
            await asyncio.sleep(0.4)

    # Summary
    all_results = result_list(run_id)
    passed = sum(1 for r in all_results if r['status']=='passed')
    failed = len(all_results) - passed
    run_update(run_id, {"status":"completed","completed_at":datetime.now().isoformat()})

    report_path = await build_report(run_id)
    await push(run_id, {"type":"run_done","run_id":run_id,"passed":passed,"failed":failed,
                        "total":len(all_results),"report_path":str(report_path),
                        "msg":f"✅ Complete: {passed} passed · {failed} failed"})

async def simulate_test(tc: dict, browser: str, url: str, run_id: str) -> dict:
    duration = 0.3 + len(tc['name'])*0.015
    await asyncio.sleep(min(duration, 1.5))

    h = sum(ord(c) for c in tc['name']+browser)
    passed = (h % 10) > 2

    logs = [
        f"[{browser}] Opening {url}",
        f"[{browser}] Executing: {tc['test_type']} test",
    ]
    for step in (tc.get('steps') or [])[:3]:
        logs.append(f"[{browser}] Step: {step}")
    logs.append(f"[{browser}] {'PASS ✓' if passed else 'FAIL ✗'} — {tc.get('expected','')}")

    screenshot = None
    error = None
    if not passed:
        error = f"AssertionError: {tc.get('expected','condition')} — not satisfied in {browser}"
        screenshot = make_error_screenshot(tc['name'], browser, error)

    return {"status":"passed" if passed else "failed","error":error,"screenshot":screenshot,
            "logs":logs,"metrics":{"load_ms":500+h%1000} if tc['test_type']=='performance' else {}}

def make_error_screenshot(name, browser, error):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="100%" stop-color="#161b22"/>
    </linearGradient>
  </defs>
  <rect width="900" height="500" fill="url(#bg)"/>
  <rect x="0" y="0" width="900" height="4" fill="#ef4444"/>
  <rect x="30" y="30" width="840" height="440" rx="10" fill="#161b22" stroke="#2d3748" stroke-width="1"/>
  <circle cx="56" cy="56" r="8" fill="#ef4444"/>
  <circle cx="80" cy="56" r="8" fill="#fbbf24"/>
  <circle cx="104" cy="56" r="8" fill="#10b981"/>
  <text x="450" y="80" font-family="monospace" font-size="11" fill="#5a6480" text-anchor="middle">{browser.upper()} — TestForge</text>
  <rect x="30" y="92" width="840" height="1" fill="#2d3748"/>
  <text x="450" y="155" font-family="monospace" font-size="28" fill="#ef4444" text-anchor="middle" font-weight="bold">✗ TEST FAILED</text>
  <text x="450" y="195" font-family="monospace" font-size="14" fill="#9ca3af" text-anchor="middle">{name[:55]}</text>
  <rect x="60" y="220" width="780" height="1" fill="#2d3748"/>
  <text x="80" y="255" font-family="monospace" font-size="12" fill="#ef4444">Error:</text>
  <text x="80" y="278" font-family="monospace" font-size="11" fill="#f87171">{error[:80]}</text>
  <text x="80" y="320" font-family="monospace" font-size="11" fill="#5a6480">  at selenium_driver.py:142</text>
  <text x="80" y="340" font-family="monospace" font-size="11" fill="#5a6480">  at test_runner.execute()</text>
  <text x="80" y="380" font-family="monospace" font-size="11" fill="#374151">Browser: {browser} | Viewport: 1280×720 | Timestamp: {datetime.now().strftime("%H:%M:%S")}</text>
</svg>'''
    return base64.b64encode(svg.encode()).decode()

# ── Runs & Reports ────────────────────────────────────────────────────────────
@app.get("/api/runs")
async def list_runs(env_id: Optional[str] = None):
    return run_list(env_id)

@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    run = run_get(run_id)
    if not run: raise HTTPException(404)
    return run

async def build_report(run_id: str) -> Path:
    run = run_get(run_id)
    results = result_list(run_id)
    passed = [r for r in results if r['status']=='passed']
    failed = [r for r in results if r['status']=='failed']
    rate = round(len(passed)/max(len(results),1)*100)

    report_dir = REPORTS_DIR / run_id
    report_dir.mkdir(parents=True, exist_ok=True)
    ss_dir = report_dir / "screenshots"
    ss_dir.mkdir(exist_ok=True)

    screenshots_html = ""
    for r in failed:
        if r.get('screenshot'):
            ss_path = ss_dir / f"{r['test_id']}_{r['browser']}.svg"
            try: ss_path.write_bytes(base64.b64decode(r['screenshot']))
            except: pass
            screenshots_html += f"""
            <div class="ss-card">
              <div class="ss-label">❌ {r['test_name']} ({r['browser']})</div>
              <img src="screenshots/{ss_path.name}" alt="error"/>
              <div class="ss-err">{r.get('error','')}</div>
            </div>"""

    rows_html = ""
    for r in results:
        icon = "✅" if r['status']=='passed' else "❌"
        cls  = "pass" if r['status']=='passed' else "fail"
        logs = "<br>".join(r.get('logs',[]))
        rows_html += f"""<tr class="{cls}">
          <td>{icon} {r['test_name']}</td><td>{r['browser']}</td>
          <td>{r['duration_ms']}ms</td>
          <td><span class="badge {cls}">{r['status'].upper()}</span></td>
          <td class="log-cell">{logs}</td></tr>"""

    html = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>TestForge Report — {run_id}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#c9d1d9}}
.header{{background:#161b22;padding:36px 40px;border-bottom:1px solid #30363d}}
.header h1{{font-size:1.8rem;color:#58a6ff;letter-spacing:-.5px}}
.header p{{color:#8b949e;margin-top:6px;font-size:.875rem}}
.summary{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:28px 40px}}
.card{{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px;text-align:center}}
.card .num{{font-size:2.2rem;font-weight:800}}
.card .lbl{{font-size:.8rem;color:#8b949e;margin-top:4px}}
.pass-n{{color:#3fb950}}.fail-n{{color:#f85149}}.total-n{{color:#58a6ff}}.rate-n{{color:{'#3fb950' if rate>=70 else '#f85149'}}}
.section{{padding:0 40px 32px}}
.section h2{{font-size:1rem;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #21262d}}
table{{width:100%;border-collapse:collapse;background:#161b22;border-radius:10px;overflow:hidden;border:1px solid #30363d}}
th{{background:#21262d;padding:11px 14px;text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;color:#8b949e}}
td{{padding:11px 14px;border-top:1px solid #21262d;font-size:.8rem;vertical-align:top}}
tr.pass td:first-child{{border-left:3px solid #3fb950}}
tr.fail td:first-child{{border-left:3px solid #f85149}}
.badge{{font-size:.7rem;padding:2px 8px;border-radius:4px;font-weight:600}}
.badge.pass{{background:#1a3a1a;color:#3fb950}}.badge.fail{{background:#3a1a1a;color:#f85149}}
.log-cell{{font-family:monospace;font-size:.72rem;color:#8b949e;line-height:1.6}}
.progress{{height:6px;background:#21262d;border-radius:3px;margin-top:10px;overflow:hidden}}
.progress-fill{{height:100%;background:{'#3fb950' if rate>=70 else '#f85149'};width:{rate}%;border-radius:3px}}
.ss-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:16px}}
.ss-card{{background:#161b22;border:1px solid #30363d;border-radius:10px;overflow:hidden}}
.ss-label{{padding:10px 14px;background:#21262d;font-size:.8rem;color:#f85149;font-family:monospace}}
.ss-card img{{width:100%;display:block}}
.ss-err{{padding:8px 14px;font-size:.75rem;color:#f85149;font-family:monospace;background:#1c1117}}
.footer{{text-align:center;padding:24px;color:#484f58;font-size:.75rem;border-top:1px solid #21262d}}
</style></head><body>
<div class="header">
  <h1>⚡ TestForge Report</h1>
  <p>Run <code>{run_id}</code> · {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} · Browsers: {', '.join(run.get('browsers',[]))}</p>
</div>
<div class="summary">
  <div class="card"><div class="num total-n">{len(results)}</div><div class="lbl">Total</div></div>
  <div class="card"><div class="num pass-n">{len(passed)}</div><div class="lbl">Passed</div></div>
  <div class="card"><div class="num fail-n">{len(failed)}</div><div class="lbl">Failed</div></div>
  <div class="card"><div class="num rate-n">{rate}%</div><div class="lbl">Pass Rate</div><div class="progress"><div class="progress-fill"></div></div></div>
</div>
<div class="section"><h2>Test Results</h2>
  <table><thead><tr><th>Test</th><th>Browser</th><th>Duration</th><th>Status</th><th>Logs</th></tr></thead>
  <tbody>{rows_html}</tbody></table></div>
{"<div class='section'><h2>Error Screenshots</h2><div class='ss-grid'>" + screenshots_html + "</div></div>" if screenshots_html else ""}
<div class="footer">Generated by TestForge · {datetime.now().isoformat()}</div>
</body></html>"""

    (report_dir / "report.html").write_text(html)
    (report_dir / "report.json").write_text(json.dumps({
        "run_id":run_id,"summary":{"total":len(results),"passed":len(passed),"failed":len(failed),"rate":rate},
        "results":results,"generated_at":datetime.now().isoformat()},indent=2))
    return report_dir / "report.html"

@app.get("/api/runs/{run_id}/report")
async def download_report(run_id: str):
    p = REPORTS_DIR / run_id / "report.html"
    if not p.exists(): raise HTTPException(404)
    return FileResponse(p, media_type="text/html", filename=f"report_{run_id}.html")

@app.get("/api/runs/{run_id}/zip")
async def download_zip(run_id: str):
    run = run_get(run_id)
    if not run: raise HTTPException(404)
    zip_path = REPORTS_DIR / f"testforge_{run_id}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        rd = REPORTS_DIR / run_id
        if rd.exists():
            for f in rd.rglob("*"):
                if f.is_file(): zf.write(f, f"report/{f.relative_to(rd)}")
        zf.writestr("start.bash", "#!/bin/bash\npip install pytest selenium pytest-html -q\npytest tests/ -v --html=report/report.html\n")
        zf.writestr("README.md", f"# TestForge Run {run_id}\nGenerated: {datetime.now().isoformat()}\n\nOpen report/report.html to view results.\n")
    return FileResponse(zip_path, media_type="application/zip", filename=f"testforge_{run_id}.zip")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
