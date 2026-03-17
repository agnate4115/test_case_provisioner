import React, { useState, useEffect, useRef, useCallback } from 'react';

const API = 'http://localhost:8000';
const safeArr = x => Array.isArray(x) ? x : [];

// ── WS hook ───────────────────────────────────────────────────────────────────
function useWS(channel, onMsg) {
  const ws = useRef(null);
  useEffect(() => {
    if (!channel) return;
    try {
      ws.current = new WebSocket(`ws://localhost:8000/ws/${channel}`);
      ws.current.onmessage = e => { try { onMsg(JSON.parse(e.data)); } catch {} };
    } catch {}
    return () => { try { ws.current?.close(); } catch {} };
  }, [channel]);
}

// ── Mini components ───────────────────────────────────────────────────────────
const sc = s => ({ passed:'#10b981',failed:'#ef4444',running:'#f59e0b',
  pending:'#6b7280',ready:'#10b981',creating:'#f59e0b',error:'#ef4444',approved:'#10b981' }[s]||'#6b7280');

function Spinner({ size=14 }) {
  return <span className="spin" style={{width:size,height:size}}/>;
}

function Badge({ label, color }) {
  return <span className="badge" style={{'--bc': color||sc(label)}}>{label}</span>;
}

function Toast({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{t.type==='success'?'✓':t.type==='error'?'✕':'i'}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

function Terminal({ lines=[], maxH=200 }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [lines]);
  return (
    <div className="terminal" style={{maxHeight:maxH}} ref={ref}>
      {lines.length===0
        ? <span className="t-muted">Waiting…</span>
        : lines.map((l,i)=>(
          <div key={i} className={`t-line ${l.includes('✅')||l.includes('✓')||l.includes('PASS')?'ok':l.includes('❌')||l.includes('✗')||l.includes('FAIL')?'bad':''}`}>
            <span className="t-prompt">›</span> {l}
          </div>
        ))
      }
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]         = useState('dashboard');
  const [envs, setEnvs]         = useState([]);
  const [selEnv, setSelEnv]     = useState(null);
  const [toasts, setToasts]     = useState([]);
  const [runs, setRuns]         = useState([]);
  const [backendOk, setBk]      = useState(null);
  const [dark, setDark]         = useState(true);

  const toast = useCallback((msg, type='info') => {
    const id = Date.now()+Math.random();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),4000);
  },[]);

  const loadEnvs = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/environments`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const list = safeArr(data);
      setEnvs(list); setBk(true);
      if (list.length>0) setSelEnv(s => s ? (list.find(e=>e.id===s.id)||list[0]) : list[0]);
    } catch { setBk(false); }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/runs`);
      if (r.ok) setRuns(await r.json());
    } catch {}
  },[]);

  useEffect(() => {
    loadEnvs(); loadRuns();
    const t1 = setInterval(loadEnvs, 5000);
    const t2 = setInterval(loadRuns, 8000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark?'dark':'light');
  }, [dark]);

  const navItems = [
    { id:'dashboard',    icon:'◈', label:'Dashboard' },
    { id:'environments', icon:'⬡', label:'Environments', n: envs.length },
    { id:'generate',     icon:'🤖', label:'Generate Tests' },
    { id:'review',       icon:'✦', label:'Review & Approve' },
    { id:'run',          icon:'▶', label:'Run Tests' },
    { id:'live',         icon:'⊡', label:'Live View' },
    { id:'reports',      icon:'◉', label:'Reports', n: safeArr(runs).length||null },
    { id:'settings',     icon:'⊙', label:'Settings' },
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo-wrap">
          <div className="logo-mark">TF</div>
          <div><div className="logo-name">TestForge</div><div className="logo-ver">v2.0</div></div>
        </div>
        <nav className="snav">
          {navItems.map(n=>(
            <button key={n.id} className={`snav-btn ${page===n.id?'on':''}`} onClick={()=>setPage(n.id)}>
              <span className="snav-icon">{n.icon}</span>
              <span className="snav-lbl">{n.label}</span>
              {n.n ? <span className="snav-badge">{n.n}</span> : null}
            </button>
          ))}
        </nav>
        {selEnv && (
          <div className="sel-env">
            <span className="sel-dot" style={{background:sc(selEnv.status)}}/>
            <div><div className="sel-name">{selEnv.name}</div><div className="sel-st">{selEnv.status}</div></div>
          </div>
        )}
        <div className="sb-footer">
          <button className="theme-btn" onClick={()=>setDark(d=>!d)}>
            {dark?'☀ Light':'◑ Dark'}
          </button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <div>
            <h1 className="tb-title">{{
              dashboard:'Mission Control',environments:'Environments',
              generate:'Generate Tests',review:'Review & Approve',
              run:'Run Tests',live:'Live Execution',
              reports:'Reports',settings:'Settings'
            }[page]}</h1>
            <p className="tb-sub">{new Date().toDateString()}</p>
          </div>
          <div className="tb-right">
            <div className={`bk-dot ${backendOk===null?'chk':backendOk?'ok':'bad'}`}>
              {backendOk===null?'Connecting…':backendOk?'Backend connected':'Backend offline'}
            </div>
            {selEnv && <div className="env-pill"><span style={{color:sc(selEnv.status)}}>●</span> {selEnv.name}</div>}
          </div>
        </header>

        {backendOk===false && (
          <div className="offline-bar">
            ⚠ Backend offline — run <code>cd ~/Downloads/testforge/backend && python3 -m uvicorn main:app --reload --port 8000</code>
          </div>
        )}

        <div className="pg-body">
          {page==='dashboard'    && <DashboardPage    envs={envs} setPage={setPage} setSelEnv={setSelEnv} runs={runs} toast={toast}/>}
          {page==='environments' && <EnvironmentsPage envs={envs} selEnv={selEnv}   setSelEnv={setSelEnv} toast={toast} onRefresh={loadEnvs}/>}
          {page==='generate'     && <GeneratePage     selEnv={selEnv} toast={toast} onRefresh={loadEnvs}/>}
          {page==='review'       && <ReviewPage       selEnv={selEnv} toast={toast} onRefresh={loadEnvs}/>}
          {page==='run'          && <RunPage          selEnv={selEnv} toast={toast} onRefresh={()=>{loadEnvs();loadRuns();}} onRunDone={loadRuns}/>}
          {page==='live'         && <LivePage         runs={runs}/>}
          {page==='reports'      && <ReportsPage      runs={runs}    toast={toast}/>}
          {page==='settings'     && <SettingsPage     toast={toast}/>}
        </div>
      </div>
      <Toast toasts={toasts}/>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardPage({ envs, setPage, setSelEnv, runs, toast }) {
  const envList   = safeArr(envs);
  const runList   = safeArr(runs);
  const allTests  = envList.flatMap(e=>safeArr(e.test_cases));
  const approved  = allTests.filter(t=>t.approved).length;
  const allRes    = runList.flatMap(r=>safeArr(r.results));
  const passed    = allRes.filter(r=>r.status==='passed').length;
  const rate      = allRes.length ? Math.round(passed/allRes.length*100) : 0;

  return (
    <div className="fade-in">
      <div className="stats-grid">
        {[
          {icon:'⬡',  label:'Environments', val:envList.length,        color:'#3b82f6', sub:`${envList.filter(e=>e.status==='ready').length} ready`},
          {icon:'🧪', label:'Test Cases',   val:allTests.length,       color:'#8b5cf6', sub:`${approved} approved`},
          {icon:'▶',  label:'Runs',         val:runList.length,        color:'#f59e0b', sub:'total executions'},
          {icon:'◉',  label:'Pass Rate',    val:`${rate}%`,            color:rate>=70?'#10b981':'#ef4444', sub:`${allRes.length} results`},
        ].map((s,i)=>(
          <div key={i} className="stat-card" style={{'--ac':s.color}}>
            <div className="sc-icon">{s.icon}</div>
            <div className="sc-val" style={{color:s.color}}>{s.val}</div>
            <div className="sc-lbl">{s.label}</div>
            <div className="sc-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="sec-title">Workflow</div>
      <div className="workflow-grid">
        {[
          {n:1,icon:'⬡',  title:'Create Env',      desc:'Provision isolated environment', page:'environments',color:'#3b82f6'},
          {n:2,icon:'🤖', title:'Generate Tests',  desc:'AI scans your code with GPT-4o',  page:'generate',    color:'#8b5cf6'},
          {n:3,icon:'✦',  title:'Review & Approve',desc:'Curate the test suite',           page:'review',      color:'#f59e0b'},
          {n:4,icon:'▶',  title:'Run Tests',       desc:'Multi-browser execution',         page:'run',         color:'#10b981'},
          {n:5,icon:'⊡',  title:'Live View',       desc:'4-browser side-by-side',          page:'live',        color:'#06b6d4'},
          {n:6,icon:'◉',  title:'Reports',         desc:'Download HTML + ZIP',             page:'reports',     color:'#f43f5e'},
        ].map(a=>(
          <button key={a.n} className="wf-card" onClick={()=>setPage(a.page)} style={{'--ac':a.color}}>
            <div className="wf-num" style={{color:a.color}}>{a.n}</div>
            <div className="wf-icon">{a.icon}</div>
            <div className="wf-title">{a.title}</div>
            <div className="wf-desc">{a.desc}</div>
          </button>
        ))}
      </div>

      {envList.length>0 && (
        <>
          <div className="sec-title">Environments</div>
          <div className="env-rows">
            {envList.map(e=>(
              <div key={e.id} className="env-row" onClick={()=>{setSelEnv(e);setPage('generate');}}>
                <span className="er-dot" style={{background:sc(e.status)}}/>
                <div className="er-info">
                  <span className="er-name">{e.name}</span>
                  <span className="er-meta">
                    {safeArr(e.test_cases).length} tests · {safeArr(e.test_cases).filter(t=>t.approved).length} approved
                  </span>
                </div>
                <Badge label={e.status}/>
                <span className="er-arrow">→</span>
              </div>
            ))}
          </div>
        </>
      )}
      {envList.length===0 && (
        <div className="empty">
          <div className="empty-icon">⬡</div>
          <h3>No environments yet</h3>
          <p>Create your first environment to get started</p>
          <button className="btn-primary" onClick={()=>setPage('environments')}>Create Environment</button>
        </div>
      )}
    </div>
  );
}

// ── Environments ──────────────────────────────────────────────────────────────
function EnvironmentsPage({ envs, selEnv, setSelEnv, toast, onRefresh }) {
  const [form,setForm]         = useState({name:'',python_version:'3.11',packages:'selenium,pytest,requests'});
  const [creating,setCreating] = useState(false);
  const [wsId,setWsId]         = useState(null);
  const [logs,setLogs]         = useState([]);

  useWS(wsId, msg => {
    if (msg.type==='env_log')   setLogs(p=>[...p,msg.msg]);
    if (msg.type==='env_ready') { toast('Environment ready!','success'); onRefresh(); setCreating(false); }
    if (msg.type==='env_error') { toast(msg.msg,'error'); setCreating(false); }
  });

  const create = async () => {
    if (!form.name.trim()) return toast('Enter a name','error');
    setCreating(true); setLogs([]);
    const r = await fetch(`${API}/api/environments`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:form.name,python_version:form.python_version,
        packages:form.packages.split(',').map(p=>p.trim()).filter(Boolean)})});
    const d = await r.json();
    setWsId(d.env_id); onRefresh();
  };

  const destroy = async (id,e) => {
    e.stopPropagation();
    if (!confirm('Destroy this environment and all its tests?')) return;
    await fetch(`${API}/api/environments/${id}`,{method:'DELETE'});
    toast('Destroyed','info'); onRefresh();
  };

  return (
    <div className="fade-in two-col">
      <div className="panel">
        <div className="ph"><h3>New Environment</h3></div>
        <div className="pb">
          <div className="field"><label>Name</label>
            <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="my-test-env"/></div>
          <div className="field"><label>Python Version</label>
            <select value={form.python_version} onChange={e=>setForm({...form,python_version:e.target.value})}>
              <option>3.11</option><option>3.12</option><option>3.13</option>
            </select></div>
          <div className="field"><label>Packages</label>
            <input value={form.packages} onChange={e=>setForm({...form,packages:e.target.value})}/></div>
          <button className="btn-primary full" onClick={create} disabled={creating}>
            {creating?<><Spinner/> Provisioning…</>:'⬡ Provision Environment'}
          </button>
          {logs.length>0 && <Terminal lines={logs}/>}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><h3>Environments <span className="ph-n">{safeArr(envs).length}</span></h3></div>
        <div className="pb">
          {safeArr(envs).length===0 && <div className="empty-sm">No environments yet</div>}
          {safeArr(envs).map(env=>(
            <div key={env.id} className={`env-card ${selEnv?.id===env.id?'sel':''}`} onClick={()=>setSelEnv(env)}>
              <div className="ec-head">
                <span className="ec-dot" style={{background:sc(env.status)}}/>
                <span className="ec-name">{env.name}</span>
                <Badge label={env.status}/>
              </div>
              <div className="ec-meta">
                Python {env.python_version} · {safeArr(env.packages).length} pkgs ·{' '}
                {safeArr(env.test_cases).length} tests ({safeArr(env.test_cases).filter(t=>t.approved).length} approved)
              </div>
              <div className="ec-id">{env.id}</div>
              <div className="ec-acts">
                <button className="btn-danger-sm" onClick={e=>destroy(env.id,e)}>🗑 Destroy</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Generate ──────────────────────────────────────────────────────────────────
function GeneratePage({ selEnv, toast, onRefresh }) {
  const [cfg,setCfg]       = useState({mode:'auto',azure_endpoint:'',azure_key:'',azure_deployment:'gpt-4o',custom_instructions:''});
  const [loading,setLoad]  = useState(false);
  const [logs,setLogs]     = useState([]);
  const [wsId,setWsId]     = useState(null);
  const [uploaded,setUploaded] = useState([]);
  const fileRef            = useRef();

  useWS(wsId, msg=>{
    if (['gen_start','gen_log'].includes(msg.type)) setLogs(p=>[...p,msg.msg]);
    if (msg.type==='gen_done')  { setLogs(p=>[...p,msg.msg]); toast(`Generated ${safeArr(msg.test_cases).length} tests — go to Review tab to approve`,'success'); onRefresh(); setLoad(false); }
    if (msg.type==='gen_error') { toast(msg.msg,'error'); setLoad(false); }
  });

  const upload = async files => {
    if (!selEnv) return toast('Select environment first','error');
    const fd = new FormData();
    Array.from(files).forEach(f=>fd.append('files',f));
    await fetch(`${API}/api/environments/${selEnv.id}/upload`,{method:'POST',body:fd});
    setUploaded(Array.from(files).map(f=>f.name));
    toast('Files uploaded','success');
  };

  const generate = async () => {
    if (!selEnv) return toast('Select environment first','error');
    setLoad(true); setLogs([]);
    const sid = Math.random().toString(36).slice(2,10);
    setWsId(sid);
    const r = await fetch(`${API}/api/tests/generate`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({env_id:selEnv.id,file_paths:uploaded.length?uploaded:[],session_id:sid,...cfg})});
    const d = await r.json();
    setWsId(d.session_id||sid);
  };

  if (!selEnv) return <NoEnv/>;

  return (
    <div className="fade-in">
      <div className="panel" style={{maxWidth:680}}>
        <div className="ph"><h3>🤖 AI Test Generation for <em>{selEnv.name}</em></h3></div>
        <div className="pb">
          <div className="info-box">
            Tests are generated then saved to the database. Go to <strong>Review & Approve</strong> to curate them before running.
          </div>

          <div className="field"><label>Mode</label>
            <div className="chip-row">
              {['auto','changes','scan'].map(m=>(
                <label key={m} className={`chip ${cfg.mode===m?'on':''}`}>
                  <input type="radio" name="mode" checked={cfg.mode===m} onChange={()=>setCfg({...cfg,mode:m})}/>
                  {m==='auto'?'🤖 Full Auto':m==='changes'?'📝 Changes Only':'📋 File Scan'}
                </label>
              ))}
            </div>
          </div>

          <div className="field"><label>Upload Source Files (optional)</label>
            <div className="upload-box" onClick={()=>fileRef.current?.click()}>
              <input ref={fileRef} type="file" multiple style={{display:'none'}} onChange={e=>upload(e.target.files)}/>
              <span className="ub-icon">📁</span>
              <span>{uploaded.length>0?`${uploaded.length} file(s) uploaded`:' Drop files or click to upload'}</span>
            </div>
            {uploaded.map(f=><span key={f} className="file-tag">{f}</span>)}
          </div>

          <details className="det-box">
            <summary>Azure OpenAI Config (pre-loaded from .env)</summary>
            <div className="det-body">
              {[{l:'Endpoint',k:'azure_endpoint',p:'https://…'},{l:'API Key',k:'azure_key',p:'••••',t:'password'},{l:'Deployment',k:'azure_deployment',p:'gpt-4o'}].map(f=>(
                <div className="field" key={f.k}><label>{f.l}</label>
                  <input type={f.t||'text'} placeholder={f.p} value={cfg[f.k]} onChange={e=>setCfg({...cfg,[f.k]:e.target.value})}/></div>
              ))}
              <div className="field"><label>Custom Instructions</label>
                <textarea rows={3} value={cfg.custom_instructions} onChange={e=>setCfg({...cfg,custom_instructions:e.target.value})}
                  placeholder="Focus on edge cases, security, and error handling…"/></div>
            </div>
          </details>

          <button className="btn-primary full" onClick={generate} disabled={loading}>
            {loading?<><Spinner/> Generating with GPT-4o…</>:'🤖 Generate Tests'}
          </button>
          {logs.length>0 && <Terminal lines={logs} maxH={220}/>}
        </div>
      </div>
    </div>
  );
}

// ── Review & Approve ──────────────────────────────────────────────────────────
function ReviewPage({ selEnv, toast, onRefresh }) {
  const [tests,setTests]   = useState([]);
  const [filter,setFilter] = useState('all'); // all | pending | approved
  const [loading,setLoading] = useState(false);
  const [manualMode,setManualMode] = useState(false);
  const [manual,setManual] = useState({name:'',description:'',steps:'',expected:'',test_type:'functional',priority:'medium'});

  const load = useCallback(async () => {
    if (!selEnv) return;
    setLoading(true);
    const r = await fetch(`${API}/api/environments/${selEnv.id}/tests`);
    if (r.ok) setTests(await r.json());
    setLoading(false);
  },[selEnv]);

  useEffect(()=>{ load(); },[load]);

  const approve = async (id, val) => {
    await fetch(`${API}/api/tests/${id}/approve`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({approved:val})});
    setTests(p=>p.map(t=>t.id===id?{...t,approved:val}:t));
    toast(val?'Test approved ✓':'Test unapproved','success');
    onRefresh();
  };

  const remove = async id => {
    if (!confirm('Remove this test case?')) return;
    await fetch(`${API}/api/tests/${id}`,{method:'DELETE'});
    setTests(p=>p.filter(t=>t.id!==id));
    toast('Test removed','info'); onRefresh();
  };

  const bulkApprove = async val => {
    const ids = shown.map(t=>t.id);
    await fetch(`${API}/api/environments/${selEnv.id}/tests/bulk-approve`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tc_ids:ids,approved:val})});
    setTests(p=>p.map(t=>ids.includes(t.id)?{...t,approved:val}:t));
    toast(`${ids.length} tests ${val?'approved':'unapproved'}`, 'success');
    onRefresh();
  };

  const addManual = async () => {
    if (!selEnv||!manual.name) return toast('Fill in test name','error');
    await fetch(`${API}/api/environments/${selEnv.id}/tests/manual`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...manual,steps:manual.steps.split('\n').filter(Boolean)})});
    toast('Manual test added & approved','success');
    setManual({name:'',description:'',steps:'',expected:'',test_type:'functional',priority:'medium'});
    setManualMode(false); load(); onRefresh();
  };

  if (!selEnv) return <NoEnv/>;

  const shown = tests.filter(t =>
    filter==='all'     ? true :
    filter==='pending' ? !t.approved :
    filter==='approved'? t.approved : true
  );

  const pendingCount  = tests.filter(t=>!t.approved).length;
  const approvedCount = tests.filter(t=>t.approved).length;

  const prioColor = p=>({high:'#ef4444',medium:'#f59e0b',low:'#10b981'}[p]||'#6b7280');
  const typeIcon  = t=>({functional:'⚙',ui:'🖥',api:'🔗',performance:'⚡',security:'🔒'}[t]||'🧪');

  return (
    <div className="fade-in">
      {/* Summary bar */}
      <div className="review-bar">
        <div className="rb-stat"><span className="rb-n rb-total">{tests.length}</span><span className="rb-l">Total</span></div>
        <div className="rb-stat"><span className="rb-n rb-pend">{pendingCount}</span><span className="rb-l">Pending Review</span></div>
        <div className="rb-stat"><span className="rb-n rb-ok">{approvedCount}</span><span className="rb-l">Approved</span></div>
        <div className="rb-actions">
          <button className="btn-primary btn-sm" onClick={()=>bulkApprove(true)}>✓ Approve All</button>
          <button className="btn-outline btn-sm" onClick={()=>bulkApprove(false)}>✕ Unapprove All</button>
          <button className="btn-outline btn-sm" onClick={()=>setManualMode(m=>!m)}>+ Add Manual</button>
          <button className="btn-ghost-sm" onClick={load}>↺ Refresh</button>
        </div>
      </div>

      {/* Manual add form */}
      {manualMode && (
        <div className="panel" style={{marginBottom:16}}>
          <div className="ph"><h3>✏ Add Manual Test Case</h3></div>
          <div className="pb" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="field"><label>Name</label><input value={manual.name} onChange={e=>setManual({...manual,name:e.target.value})} placeholder="Login with valid credentials"/></div>
            <div className="field"><label>Description</label><input value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})} placeholder="Verify user can…"/></div>
            <div className="field"><label>Expected Result</label><input value={manual.expected} onChange={e=>setManual({...manual,expected:e.target.value})} placeholder="User is redirected to…"/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <div className="field"><label>Type</label>
                <select value={manual.test_type} onChange={e=>setManual({...manual,test_type:e.target.value})}>
                  {['functional','ui','api','performance','security'].map(t=><option key={t}>{t}</option>)}
                </select></div>
              <div className="field"><label>Priority</label>
                <select value={manual.priority} onChange={e=>setManual({...manual,priority:e.target.value})}>
                  {['high','medium','low'].map(p=><option key={p}>{p}</option>)}
                </select></div>
            </div>
            <div className="field" style={{gridColumn:'1/-1'}}><label>Steps (one per line)</label>
              <textarea rows={4} value={manual.steps} onChange={e=>setManual({...manual,steps:e.target.value})}
                placeholder={"Navigate to login page\nEnter email and password\nClick submit"}/></div>
            <div style={{gridColumn:'1/-1',display:'flex',gap:8}}>
              <button className="btn-primary" onClick={addManual}>➕ Add Test</button>
              <button className="btn-outline" onClick={()=>setManualMode(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="filter-tabs">
        {[['all','All Tests'],['pending','Pending Review'],['approved','Approved']].map(([v,l])=>(
          <button key={v} className={`ftab ${filter===v?'on':''}`} onClick={()=>setFilter(v)}>
            {l} <span className="ftab-n">{
              v==='all'?tests.length:v==='pending'?pendingCount:approvedCount
            }</span>
          </button>
        ))}
      </div>

      {loading && <div className="empty-sm"><Spinner/> Loading…</div>}
      {!loading && shown.length===0 && (
        <div className="empty">
          <div className="empty-icon">🧪</div>
          <h3>{filter==='pending'?'All tests reviewed!':filter==='approved'?'No approved tests yet':'No test cases yet'}</h3>
          <p>{filter==='pending'?'All tests have been reviewed.':filter==='approved'?'Go to Generate to create tests.':'Generate tests or add manually.'}</p>
        </div>
      )}

      <div className="tc-grid">
        {shown.map(tc=>(
          <div key={tc.id} className={`tc-card ${tc.approved?'approved':''}`}>
            <div className="tc-head">
              <span className="tc-type-icon">{typeIcon(tc.test_type)}</span>
              <div className="tc-title-wrap">
                <div className="tc-name">{tc.name}</div>
                <div className="tc-meta">{tc.test_type} · <span style={{color:prioColor(tc.priority)}}>{tc.priority}</span> · <span className="tc-src">{tc.source}</span></div>
              </div>
              <div className="tc-status-wrap">
                {tc.approved
                  ? <span className="approved-badge">✓ Approved</span>
                  : <span className="pending-badge">Pending</span>}
              </div>
            </div>

            {tc.description && <div className="tc-desc">{tc.description}</div>}

            {safeArr(tc.steps).length>0 && (
              <div className="tc-steps">
                {tc.steps.map((s,i)=><div key={i} className="tc-step"><span className="step-n">{i+1}</span>{s}</div>)}
              </div>
            )}

            {tc.expected && (
              <div className="tc-expected"><span className="exp-label">Expected:</span> {tc.expected}</div>
            )}

            {safeArr(tc.tags).length>0 && (
              <div className="tc-tags">{tc.tags.map(t=><span key={t} className="tag">{t}</span>)}</div>
            )}

            <div className="tc-actions">
              {tc.approved
                ? <button className="btn-unapprove" onClick={()=>approve(tc.id,false)}>✕ Unapprove</button>
                : <button className="btn-approve" onClick={()=>approve(tc.id,true)}>✓ Approve</button>}
              <button className="btn-remove" onClick={()=>remove(tc.id)}>🗑 Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Run Tests ─────────────────────────────────────────────────────────────────
function RunPage({ selEnv, toast, onRefresh, onRunDone }) {
  const [tests,setTests]     = useState([]);
  const [selIds,setSelIds]   = useState([]);
  const [cfg,setCfg]         = useState({browsers:['chrome'],target_url:'http://localhost:3001',parallel:false});
  const [running,setRunning] = useState(false);
  const [wsId,setWsId]       = useState(null);
  const [logs,setLogs]       = useState([]);
  const [liveRes,setLiveRes] = useState([]);
  const [summary,setSummary] = useState(null);
  const [currentRunId,setCurRun] = useState(null);

  const load = useCallback(async () => {
    if (!selEnv) return;
    const r = await fetch(`${API}/api/environments/${selEnv.id}/tests?approved_only=true`);
    if (r.ok) { const d = await r.json(); setTests(safeArr(d)); }
  },[selEnv]);

  useEffect(()=>{ load(); },[load]);

  useWS(wsId, msg=>{
    if (['run_start','run_log','browser_start'].includes(msg.type)) setLogs(p=>[...p, msg.msg||'']);
    if (msg.type==='test_result') {
      const r = msg.result;
      setLiveRes(p=>[...p,r]);
      setLogs(p=>[...p,`[${r.browser}] ${r.status==='passed'?'✅':'❌'} ${r.test_name} (${msg.duration_ms}ms)`]);
    }
    if (msg.type==='run_done') {
      setSummary({passed:msg.passed,failed:msg.failed,total:msg.total,run_id:msg.run_id});
      setLogs(p=>[...p,msg.msg]);
      setRunning(false); onRunDone();
      toast(`${msg.passed} passed · ${msg.failed} failed`, msg.failed>0?'error':'success');
    }
    if (msg.type==='run_error') { toast(msg.msg,'error'); setRunning(false); }
  });

  const run = async () => {
    if (!selEnv) return toast('Select environment','error');
    const approvedTests = tests.filter(t=>t.approved);
    if (approvedTests.length===0) return toast('No approved tests — go to Review & Approve first','error');
    setRunning(true); setLiveRes([]); setLogs([]); setSummary(null);
    const rid = Math.random().toString(36).slice(2,10);
    setWsId(rid); setCurRun(rid);
    const ids = selIds.length>0 ? selIds : ['all'];
    const r = await fetch(`${API}/api/tests/run`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({env_id:selEnv.id,test_ids:ids,...cfg})});
    const d = await r.json();
    setWsId(d.run_id||rid); setCurRun(d.run_id||rid);
  };

  const toggleBrowser = b => setCfg(p=>({...p,browsers:p.browsers.includes(b)?p.browsers.filter(x=>x!==b):[...p.browsers,b]}));
  const toggleTest    = id => setSelIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  if (!selEnv) return <NoEnv/>;

  const approved = tests.filter(t=>t.approved);
  const shown    = selIds.length>0 ? tests.filter(t=>selIds.includes(t.id)) : approved;

  return (
    <div className="fade-in">
      <div className="run-layout">
        {/* Left: config */}
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div className="panel">
            <div className="ph"><h3>Run Configuration</h3></div>
            <div className="pb">
              <div className="info-box">
                Only <strong>approved</strong> tests will run. Select specific tests or run all approved.
              </div>
              <div className="field"><label>Target URL</label>
                <input value={cfg.target_url} onChange={e=>setCfg({...cfg,target_url:e.target.value})}/></div>
              <div className="field"><label>Browsers</label>
                <div className="browser-row">
                  {['chrome','firefox','edge','safari'].map(b=>(
                    <button key={b} className={`br-btn ${cfg.browsers.includes(b)?'on':''}`} onClick={()=>toggleBrowser(b)}>
                      {{'chrome':'🟡','firefox':'🦊','edge':'🔵','safari':'🍎'}[b]} {b}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label className="toggle-lbl">
                  <div className={`tog ${cfg.parallel?'on':''}`} onClick={()=>setCfg(p=>({...p,parallel:!p.parallel}))}>
                    <div className="tog-thumb"/>
                  </div>
                  Parallel execution
                </label>
              </div>
              <button className="btn-primary full" onClick={run} disabled={running||approved.length===0}>
                {running?<><Spinner/> Running…</>:`▶ Run ${selIds.length>0?selIds.length:approved.length} Tests × ${cfg.browsers.length} Browser(s)`}
              </button>
              {approved.length===0 && <div className="warn-box">⚠ No approved tests. Go to Review & Approve first.</div>}
            </div>
          </div>

          {summary && (
            <div className={`summary-card ${summary.failed>0?'has-fail':'all-pass'}`}>
              <div className="sum-title">Run Complete</div>
              <div className="sum-stats">
                <span className="sum-pass">✅ {summary.passed} passed</span>
                <span className="sum-fail">❌ {summary.failed} failed</span>
                <span className="sum-total">{summary.total} total</span>
              </div>
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button className="btn-primary btn-sm" onClick={()=>window.open(`${API}/api/runs/${summary.run_id}/report`)}>📊 Report</button>
                <button className="btn-outline btn-sm" onClick={()=>window.open(`${API}/api/runs/${summary.run_id}/zip`)}>📦 ZIP</button>
              </div>
            </div>
          )}
        </div>

        {/* Center: test list */}
        <div className="panel">
          <div className="ph">
            <h3>Approved Tests <span className="ph-n">{approved.length}</span></h3>
            <div style={{display:'flex',gap:6}}>
              <button className="btn-ghost-sm" onClick={()=>setSelIds(approved.map(t=>t.id))}>All</button>
              <button className="btn-ghost-sm" onClick={()=>setSelIds([])}>None</button>
              <button className="btn-ghost-sm" onClick={load}>↺</button>
            </div>
          </div>
          <div className="pb run-test-list">
            {approved.length===0 && <div className="empty-sm">No approved tests yet</div>}
            {approved.map(tc=>(
              <div key={tc.id} className={`run-tc ${selIds.includes(tc.id)?'sel':''}`} onClick={()=>toggleTest(tc.id)}>
                <span className="rtc-check">{selIds.includes(tc.id)?'☑':'☐'}</span>
                <div className="rtc-info">
                  <div className="rtc-name">{tc.name}</div>
                  <div className="rtc-meta">{tc.test_type} · {tc.priority}</div>
                </div>
                <span className="rtc-dot" style={{background:sc(tc.status)}}/>
              </div>
            ))}
          </div>
        </div>

        {/* Right: live terminal */}
        <div className="panel">
          <div className="ph">
            <h3>Live Results</h3>
            {liveRes.length>0 && (
              <div className="live-score">
                <span style={{color:'#10b981'}}>✅ {liveRes.filter(r=>r.status==='passed').length}</span>
                <span style={{color:'#ef4444'}}>❌ {liveRes.filter(r=>r.status==='failed').length}</span>
              </div>
            )}
          </div>
          <div className="pb">
            <Terminal lines={logs} maxH={300}/>
            <div className="lr-list">
              {liveRes.slice(-10).map((r,i)=>(
                <div key={i} className={`lr-row ${r.status}`}>
                  <span>{r.status==='passed'?'✅':'❌'}</span>
                  <span className="lr-name">{r.test_name}</span>
                  <span className="lr-br">{r.browser}</span>
                  <span className="lr-dur">{r.duration_ms}ms</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Live 4-Browser View ───────────────────────────────────────────────────────
function LivePage({ runs }) {
  const runList    = safeArr(runs);
  const lastRun    = runList[0];
  const [selRun,setSelRun] = useState(null);
  const [panes,setPanes]   = useState({'chrome':[],'firefox':[],'edge':[],'safari':[]});
  const [wsIds,setWsIds]   = useState({});
  const BROWSERS = ['chrome','firefox','edge','safari'];

  const attachRun = run => {
    setSelRun(run);
    setPanes({'chrome':[],'firefox':[],'edge':[],'safari':[]});
    // seed from existing results
    const res = safeArr(run.results);
    const byBrowser = {};
    BROWSERS.forEach(b=>{ byBrowser[b]=res.filter(r=>r.browser===b); });
    setPanes(byBrowser);
    // set up WS channels for each browser
    const ids = {};
    BROWSERS.forEach(b=>{ ids[b]=`${run.id}_${b}`; });
    setWsIds(ids);
  };

  // WS for each browser pane
  useWS(wsIds.chrome,  msg=>{ if(msg.type==='test_result') setPanes(p=>({...p,chrome:[...p.chrome,msg.result]})); });
  useWS(wsIds.firefox, msg=>{ if(msg.type==='test_result') setPanes(p=>({...p,firefox:[...p.firefox,msg.result]})); });
  useWS(wsIds.edge,    msg=>{ if(msg.type==='test_result') setPanes(p=>({...p,edge:[...p.edge,msg.result]})); });
  useWS(wsIds.safari,  msg=>{ if(msg.type==='test_result') setPanes(p=>({...p,safari:[...p.safari,msg.result]})); });

  return (
    <div className="fade-in">
      <div className="live-toolbar">
        <div>
          <div className="sec-title" style={{marginBottom:0}}>Live 4-Browser Execution View</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:3}}>Watch each browser execute tests in real-time</div>
        </div>
        <select className="run-select" value={selRun?.id||''} onChange={e=>{
          const run=runList.find(r=>r.id===e.target.value);
          if(run) attachRun(run);
        }}>
          <option value="">Select a run…</option>
          {runList.map(r=><option key={r.id} value={r.id}>Run #{r.id} · {new Date(r.started_at||Date.now()).toLocaleString()}</option>)}
        </select>
        {lastRun && !selRun && (
          <button className="btn-primary btn-sm" onClick={()=>attachRun(lastRun)}>Load Latest Run</button>
        )}
      </div>

      {!selRun && (
        <div className="empty">
          <div className="empty-icon">⊡</div>
          <h3>No run selected</h3>
          <p>Run tests first, then come back here to watch the 4-browser live view</p>
        </div>
      )}

      {selRun && (
        <div className="quad-grid">
          {BROWSERS.map(browser=>{
            const results = safeArr(panes[browser]);
            const passed  = results.filter(r=>r.status==='passed').length;
            const failed  = results.filter(r=>r.status==='failed').length;
            const isActive = safeArr(selRun.browsers||[]).includes(browser);

            return (
              <div key={browser} className={`quad-pane ${!isActive?'inactive':''}`}>
                <div className="qp-header">
                  <span className="qp-browser-icon">
                    {{'chrome':'🟡','firefox':'🦊','edge':'🔵','safari':'🍎'}[browser]}
                  </span>
                  <span className="qp-name">{browser.charAt(0).toUpperCase()+browser.slice(1)}</span>
                  {isActive ? (
                    <div className="qp-scores">
                      <span className="qp-pass">✅{passed}</span>
                      <span className="qp-fail">❌{failed}</span>
                    </div>
                  ) : <span className="qp-inactive-label">not selected</span>}
                </div>

                {!isActive ? (
                  <div className="qp-body qp-disabled">
                    <div className="qp-dis-msg">Browser not included in this run</div>
                  </div>
                ) : (
                  <div className="qp-body">
                    {results.length===0 && <div className="qp-waiting">Waiting for results…</div>}
                    {results.map((r,i)=>(
                      <div key={i} className={`qp-result ${r.status}`}>
                        <span className="qpr-icon">{r.status==='passed'?'✅':'❌'}</span>
                        <div className="qpr-info">
                          <div className="qpr-name">{r.test_name}</div>
                          <div className="qpr-meta">{r.duration_ms}ms{r.error?` · ${r.error.slice(0,40)}…`:''}</div>
                        </div>
                      </div>
                    ))}
                    {results.length>0 && (
                      <div className="qp-progress">
                        <div className="qp-prog-fill" style={{
                          width: `${results.length>0?Math.round(passed/results.length*100):0}%`,
                          background: failed>0?'#ef4444':'#10b981'}}/>
                      </div>
                    )}
                  </div>
                )}

                {/* Failed screenshots */}
                {results.filter(r=>r.screenshot).slice(0,1).map((r,i)=>(
                  <div key={i} className="qp-screenshot">
                    <img src={`data:image/svg+xml;base64,${r.screenshot}`} alt="error"/>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────
function ReportsPage({ runs, toast }) {
  const runList = safeArr(runs);
  if (runList.length===0) return (
    <div className="empty">
      <div className="empty-icon">◉</div>
      <h3>No reports yet</h3>
      <p>Run your tests to generate reports</p>
    </div>
  );
  return (
    <div className="fade-in">
      {runList.map(run=>{
        const res    = safeArr(run.results);
        const passed = res.filter(r=>r.status==='passed').length;
        const total  = res.length;
        const rate   = total?Math.round(passed/total*100):0;
        const brs    = [...new Set(res.map(r=>r.browser))].filter(Boolean);
        return (
          <div key={run.id} className="report-card">
            <div className="rc-top">
              <div>
                <div className="rc-id">Run #{run.id}</div>
                <div className="rc-meta">{brs.join(', ')||'—'} · {run.started_at?new Date(run.started_at).toLocaleString():''}</div>
              </div>
              <Badge label={run.status||'pending'}/>
            </div>
            <div className="rc-stats">
              <span style={{color:'#10b981'}}>✅ {passed}</span>
              <span style={{color:'#ef4444'}}>❌ {total-passed}</span>
              <span style={{color:rate>=70?'#10b981':'#ef4444'}}>{rate}% pass rate</span>
              <span style={{color:'var(--t3)'}}>{total} total</span>
            </div>
            <div className="rc-bar"><div className="rc-fill" style={{width:`${rate}%`,background:rate>=70?'#10b981':'#ef4444'}}/></div>
            {run.status==='completed' && (
              <div className="rc-acts">
                <button className="btn-primary btn-sm" onClick={()=>window.open(`${API}/api/runs/${run.id}/report`)}>📊 View Report</button>
                <button className="btn-outline btn-sm" onClick={()=>{window.open(`${API}/api/runs/${run.id}/zip`);toast('Downloading…','info');}}>📦 Download ZIP</button>
              </div>
            )}
            {res.filter(r=>r.screenshot).slice(0,2).map((r,i)=>(
              <div key={i} className="rc-ss">
                <div className="rc-ss-lbl">❌ {r.test_name} ({r.browser})</div>
                <img src={`data:image/svg+xml;base64,${r.screenshot}`} alt="error"/>
                {r.error && <div className="rc-ss-err">{r.error}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────
function SettingsPage({ toast }) {
  return (
    <div className="fade-in">
      <div className="panel" style={{maxWidth:560}}>
        <div className="ph"><h3>⊙ Azure OpenAI</h3></div>
        <div className="pb">
          <div className="info-box">Credentials are pre-loaded from <code>.env</code> — no action needed.</div>
          <div className="cred-tbl">
            <div className="cr"><span>Endpoint</span><code>https://argusllm.openai.azure.com/</code></div>
            <div className="cr"><span>Deployment</span><code>gpt-4o</code></div>
            <div className="cr"><span>API Key</span><code>4qWaLXeR… (hidden)</code></div>
          </div>
        </div>
      </div>
      <div className="panel" style={{maxWidth:560,marginTop:16}}>
        <div className="ph"><h3>⊙ Demo App</h3></div>
        <div className="pb">
          <div className="cred-tbl">
            <div className="cr"><span>URL</span><code>http://localhost:3001</code></div>
            <div className="cr"><span>Email</span><code>demo@test.com</code></div>
            <div className="cr"><span>Password</span><code>password123</code></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoEnv() {
  return (
    <div className="empty">
      <div className="empty-icon">⬡</div>
      <h3>No environment selected</h3>
      <p>Create or select an environment from the Environments page</p>
    </div>
  );
}
