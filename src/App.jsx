import React, { useCallback, useEffect, useMemo, useState } from 'react';

const DEMOS = [
  ['admin@opsdesk.local','Admin'],
  ['manager@opsdesk.local','Manager'],
  ['member@opsdesk.local','Member'],
  ['viewer@opsdesk.local','Viewer']
];
const STATUSES = ['Open','In Progress','Blocked','Done'];
const PRIORITIES = ['Low','Medium','High','Critical'];

async function api(path, options = {}) {
  const token = localStorage.getItem('opsdesk_token');
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status; error.data = data; throw error;
  }
  return data;
}

export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('opsdesk_user') || 'null'); } catch { return null; }
  });
  const [email, setEmail] = useState('admin@opsdesk.local');
  const [password, setPassword] = useState('demo1234');
  const [loginError, setLoginError] = useState('');
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activity, setActivity] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', type: 'Task', priority: 'Medium', ownerId: '' });

  const canEdit = user && ['admin','manager','member'].includes(user.role);
  const loadItems = useCallback(async (append = false) => {
    if (!user) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (append && cursor) params.set('cursor', String(cursor));
      if (query.trim()) params.set('q', query.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      const data = await api(`/api/items?${params}`);
      setItems(old => append ? [...old, ...data.items] : data.items);
      setCursor(data.nextCursor); setHasMore(data.hasMore);
    } catch (e) { setNotice(e.message); }
    finally { setLoading(false); }
  }, [user, cursor, query, statusFilter, priorityFilter]);

  useEffect(() => {
    if (user) {
      loadItems(false);
      api('/api/users').then(d => setUsers(d.users)).catch(e => setNotice(e.message));
    }
  }, [user, query, statusFilter, priorityFilter]); // intentionally reset pagination when filters change

  const counts = useMemo(() => ({
    total: items.length,
    open: items.filter(i => i.status === 'Open').length,
    active: items.filter(i => i.status === 'In Progress').length,
    blocked: items.filter(i => i.status === 'Blocked').length
  }), [items]);

  async function login(e) {
    e.preventDefault(); setLoginError('');
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      localStorage.setItem('opsdesk_token', data.token);
      localStorage.setItem('opsdesk_user', JSON.stringify(data.user));
      setUser(data.user); setNotice(`Welcome back, ${data.user.name}`);
    } catch (err) { setLoginError(err.message); }
  }
  function logout() {
    localStorage.removeItem('opsdesk_token'); localStorage.removeItem('opsdesk_user');
    setUser(null); setItems([]); setSelected(null);
  }
  async function openItem(item) {
    try {
      const [detail, events] = await Promise.all([api(`/api/items/${item.id}`), api(`/api/items/${item.id}/activity`)]);
      setSelected(detail.item); setActivity(events.activity); setNotice('');
    } catch (e) { setNotice(e.message); }
  }
  async function refreshSelected() {
    if (!selected) return;
    await openItem(selected);
    await loadItems(false);
  }
  async function createItem(e) {
    e.preventDefault();
    try {
      const data = await api('/api/items', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ ...form, ownerId: form.ownerId ? Number(form.ownerId) : null })
      });
      setShowCreate(false); setForm({ title: '', description: '', type: 'Task', priority: 'Medium', ownerId: '' });
      setNotice('Work item created'); await loadItems(false); await openItem(data.item);
    } catch (e) { setNotice(e.message); }
  }
  async function updateField(field, value) {
    if (!selected) return;
    try {
      const data = await api(`/api/items/${selected.id}`, {
        method: 'PATCH', body: JSON.stringify({ version: selected.version, [field]: value === '' ? null : value })
      });
      setSelected(data.item); setNotice('Changes saved'); await loadItems(false);
      const events = await api(`/api/items/${selected.id}/activity`); setActivity(events.activity);
    } catch (e) {
      if (e.status === 409) {
        setNotice('Conflict detected: another update changed this item. Latest version loaded.');
        await refreshSelected();
      } else setNotice(e.message);
    }
  }

  if (!user) return <main className="login-shell">
    <section className="login-card">
      <div className="brand-mark">O</div><p className="eyebrow">OPERATIONS CONTROL CENTER</p>
      <h1>OpsDesk</h1><p className="muted">Keep critical work visible, owned, and moving.</p>
      <form onSubmit={login} className="stack">
        <label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required /></label>
        <label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" required /></label>
        {loginError && <p className="error">{loginError}</p>}
        <button className="primary full">Sign in</button>
      </form>
      <div className="demo-box"><b>Demo accounts</b><p>Password for all: <code>demo1234</code></p>
        {DEMOS.map(([em, role])=><button key={em} className="demo-user" onClick={()=>{setEmail(em);setPassword('demo1234')}}><span>{role}</span><small>{em}</small></button>)}
      </div>
    </section>
  </main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark small">O</div><div><b>OpsDesk</b><small>OPERATIONS</small></div></div>
      <div className="nav-label">WORKSPACE</div><div className="nav-item active"><span>▦</span> Work items <span className="nav-count">{items.length}</span></div>
      <div className="sidebar-bottom"><div className="avatar">{user.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div className="user-meta"><b>{user.name}</b><small>{user.role}</small></div><button className="icon-btn" title="Sign out" onClick={logout}>↗</button></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><p className="eyebrow">TEAM WORKSPACE / TEAM 1</p><h1>Work overview</h1></div><div className="top-actions"><span className="role-chip">{user.role}</span><button className="secondary" onClick={()=>loadItems(false)}>↻ Refresh</button>{canEdit && <button className="primary" onClick={()=>setShowCreate(true)}>＋ New work item</button>}</div></header>
      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}
      <section className="stats-grid">
        <Stat label="Loaded items" value={counts.total} icon="▦" hint="Current result page" />
        <Stat label="Open" value={counts.open} icon="◷" hint="Awaiting action" />
        <Stat label="In progress" value={counts.active} icon="↗" hint="Actively being worked" />
        <Stat label="Blocked" value={counts.blocked} icon="⚑" hint="Needs attention" />
      </section>
      <section className="work-layout">
        <div className="panel work-panel">
          <div className="panel-heading"><div><h2>Work items</h2><p>Search and focus on the next thing that needs attention.</p></div><span className="count-pill">{items.length} shown</span></div>
          <div className="filters"><div className="search"><span>⌕</span><input placeholder="Search title or description..." value={query} onChange={e=>{setQuery(e.target.value);setCursor(null)}} /></div>
            <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setCursor(null)}}><option value="">All statuses</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>
            <select value={priorityFilter} onChange={e=>{setPriorityFilter(e.target.value);setCursor(null)}}><option value="">All priorities</option>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select>
          </div>
          <div className="table-wrap"><table><thead><tr><th>WORK ITEM</th><th>STATUS</th><th>PRIORITY</th><th>OWNER</th></tr></thead>
            <tbody>{items.map(item=><tr key={item.id} onClick={()=>openItem(item)} className={selected?.id===item.id?'selected':''}>
              <td><div className="item-title"><span className={`type-icon ${item.type.toLowerCase()}`}>{item.type==='Issue'?'!':item.type==='Investigation'?'⌕':'✓'}</span><div><b>{item.title}</b><small>OPS-{item.id} · {item.type}</small></div></div></td>
              <td><span className={`status status-${item.status.toLowerCase().replace(' ','-')}`}>{item.status}</span></td>
              <td><span className={`priority priority-${item.priority.toLowerCase()}`}><i />{item.priority}</span></td>
              <td><span className="owner">{item.owner_name || 'Unassigned'}</span></td>
            </tr>)}
            {!items.length && <tr><td colSpan="4" className="empty">{loading?'Loading work items...':'No matching work items. Try changing the filters.'}</td></tr>}
            </tbody></table></div>
          <div className="pagination"><span>{loading?'Loading…':`Showing ${items.length} item${items.length===1?'':'s'} in this result`}</span>{hasMore && <button className="secondary" disabled={loading} onClick={()=>loadItems(true)}>Load more →</button>}</div>
        </div>
        <aside className="panel detail-panel">
          {!selected ? <div className="detail-empty"><div className="empty-icon">↖</div><h3>Select a work item</h3><p>See its context, ownership, current state, and activity history.</p></div> :
          <><div className="detail-head"><div><span className="eyebrow">OPS-{selected.id} / {selected.type.toUpperCase()}</span><h2>{selected.title}</h2></div><button className="icon-btn" onClick={()=>setSelected(null)}>×</button></div>
            <p className="detail-description">{selected.description || 'No description provided.'}</p>
            <div className="detail-field"><label>Status</label>{canEdit?<select value={selected.status} onChange={e=>updateField('status',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>:<span className={`status status-${selected.status.toLowerCase().replace(' ','-')}`}>{selected.status}</span>}</div>
            <div className="detail-field"><label>Priority</label>{canEdit?<select value={selected.priority} onChange={e=>updateField('priority',e.target.value)}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select>:<span className={`priority priority-${selected.priority.toLowerCase()}`}><i />{selected.priority}</span>}</div>
            <div className="detail-field"><label>Assignee</label>{canEdit?<select value={selected.owner_id ?? ''} onChange={e=>updateField('ownerId',e.target.value)}><option value="">Unassigned</option>{users.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select>:<span>{selected.owner_name || 'Unassigned'}</span>}</div>
            <div className="detail-field"><label>Last updated</label><span>{new Date(selected.updated_at.replace(' ','T')+'Z').toLocaleString()}</span></div>
            <div className="activity-heading"><h3>Activity history</h3><span>{activity.length}</span></div>
            <div className="timeline">{activity.map(a=><div className="event" key={a.id}><div className="event-dot" /><div><p><b>{a.actor_name}</b> {a.details}</p><small>{new Date(a.created_at.replace(' ','T')+'Z').toLocaleString()}</small></div></div>)}{!activity.length&&<p className="muted">No activity recorded.</p>}</div>
            <div className="version-note">Version {selected.version} · Concurrent edits are checked by the server.</div>
          </>}
        </aside>
      </section>
      <footer>OpsDesk · Internal operations workspace <span>Built for correctness under pressure</span></footer>
    </main>
    {showCreate && <div className="modal-backdrop" onClick={()=>setShowCreate(false)}><section className="modal" onClick={e=>e.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">NEW RECORD</p><h2>Create work item</h2></div><button className="icon-btn" onClick={()=>setShowCreate(false)}>×</button></div>
      <form onSubmit={createItem} className="stack"><label>Title *<input maxLength="160" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} required placeholder="What needs to be done?" /></label>
        <label>Description<textarea rows="3" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Why does this work exist? What is the next action?" /></label>
        <div className="form-row"><label>Type<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})}><option>Task</option><option>Issue</option><option>Investigation</option></select></label><label>Priority<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></label></div>
        <label>Assignee<select value={form.ownerId} onChange={e=>setForm({...form,ownerId:e.target.value})}><option value="">Unassigned</option>{users.map(u=><option value={u.id} key={u.id}>{u.name}</option>)}</select></label>
        <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setShowCreate(false)}>Cancel</button><button className="primary">Create item</button></div>
      </form>
    </section></div>}
  </div>;
}

function Stat({label,value,icon,hint}) { return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{hint}</small></div>; }