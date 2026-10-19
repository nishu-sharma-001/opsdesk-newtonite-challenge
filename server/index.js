const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Seed demo accounts and sample work items on first run.
const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (!count) {
  const hash = bcrypt.hashSync('demo1234', 10);
  const addUser = db.prepare('INSERT INTO users(name,email,password_hash,role,team_id) VALUES(?,?,?,?,?)');
  addUser.run('Aarav Admin', 'admin@opsdesk.local', hash, 'admin', 1);
  addUser.run('Maya Manager', 'manager@opsdesk.local', hash, 'manager', 1);
  addUser.run('Riya Member', 'member@opsdesk.local', hash, 'member', 1);
  addUser.run('Vikram Viewer', 'viewer@opsdesk.local', hash, 'viewer', 1);
  const addItem = db.prepare(`INSERT INTO work_items(title,description,type,status,priority,owner_id,team_id,created_by)
    VALUES(?,?,?,?,?,?,1,1)`);
  const samples = [
    ['Investigate elevated API latency','Latency increased after the latest deployment. Check traces and report findings.','Investigation','In Progress','Critical',2],
    ['Resolve failed invoice sync','Some invoice events are retrying without completing.','Issue','Open','High',3],
    ['Prepare weekly operations report','Summarize incidents, blocked work, and unresolved risks.','Task','Open','Medium',2],
    ['Review access for contractor accounts','Confirm least-privilege access and remove obsolete grants.','Task','Blocked','High',null],
    ['Document service restart procedure','Add safe recovery steps and verification checks.','Task','Done','Low',3]
  ];
  for (const s of samples) {
    const info = addItem.run(...s);
    db.prepare('INSERT INTO activity(item_id,actor_id,action,details) VALUES(?,?,?,?)')
      .run(info.lastInsertRowid, 1, 'created', `Created ${s[2].toLowerCase()} "${s[0]}"`);
  }
}

function safeUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, teamId: row.team_id };
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id,name,email,role,team_id FROM users WHERE id=?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    req.user = safeUser(user); next();
  } catch { return res.status(401).json({ error: 'Session expired or invalid' }); }
}
function allow(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission to perform this action' });
}
function getItem(id) {
  return db.prepare(`SELECT w.*, u.name AS owner_name, c.name AS creator_name
    FROM work_items w LEFT JOIN users u ON u.id=w.owner_id
    JOIN users c ON c.id=w.created_by WHERE w.id=?`).get(id);
}
function canAccess(user, item) {
  return !!item && (user.role === 'admin' || user.teamId === item.team_id);
}
function logActivity(itemId, actorId, action, details) {
  db.prepare('INSERT INTO activity(item_id,actor_id,action,details) VALUES(?,?,?,?)').run(itemId, actorId, action, details);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const row = db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) return res.status(401).json({ error: 'Incorrect email or password' });
  const user = safeUser(row);
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user });
});
app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));
app.get('/api/users', auth, (req, res) => {
  const users = db.prepare('SELECT id,name,email,role,team_id AS teamId FROM users WHERE team_id=? ORDER BY name').all(req.user.teamId);
  res.json({ users });
});

// Cursor pagination: the cursor is the last returned item ID; never load the entire table.
app.get('/api/items', auth, (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 50);
  const cursor = Math.max(Number.parseInt(req.query.cursor, 10) || 0, 0);
  const q = String(req.query.q || '').trim().slice(0, 120);
  const status = String(req.query.status || '');
  const priority = String(req.query.priority || '');
  const clauses = ['w.team_id = ?', 'w.id < ?'];
  const params = [req.user.teamId, cursor || 2147483647];
  if (q) { clauses.push('(w.title LIKE ? OR w.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (['Open','In Progress','Blocked','Done'].includes(status)) { clauses.push('w.status = ?'); params.push(status); }
  if (['Low','Medium','High','Critical'].includes(priority)) { clauses.push('w.priority = ?'); params.push(priority); }
  const rows = db.prepare(`SELECT w.*, u.name AS owner_name FROM work_items w LEFT JOIN users u ON u.id=w.owner_id
    WHERE ${clauses.join(' AND ')} ORDER BY w.id DESC LIMIT ?`).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  res.json({ items: rows, nextCursor: hasMore ? rows[rows.length - 1].id : null, hasMore });
});

app.post('/api/items', auth, allow('admin','manager','member'), (req, res) => {
  const idem = String(req.get('Idempotency-Key') || '').slice(0, 100);
  if (idem) {
    const previous = db.prepare('SELECT response_json FROM idempotency_keys WHERE key=?').get(`${req.user.id}:${idem}`);
    if (previous) return res.status(200).json(JSON.parse(previous.response_json));
  }
  const { title, description = '', type = 'Task', priority = 'Medium', ownerId = null } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (String(title).length > 160) return res.status(400).json({ error: 'Title must be 160 characters or fewer' });
  if (!['Task','Issue','Investigation'].includes(type)) return res.status(400).json({ error: 'Invalid work item type' });
  if (!['Low','Medium','High','Critical'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
  if (ownerId !== null && !db.prepare('SELECT id FROM users WHERE id=? AND team_id=?').get(ownerId, req.user.teamId))
    return res.status(400).json({ error: 'Owner must belong to your team' });
  const create = db.transaction(() => {
    const info = db.prepare(`INSERT INTO work_items(title,description,type,priority,owner_id,team_id,created_by)
      VALUES(?,?,?,?,?,?,?)`).run(String(title).trim(), String(description).slice(0, 4000), type, priority, ownerId, req.user.teamId, req.user.id);
    logActivity(info.lastInsertRowid, req.user.id, 'created', `Created ${type.toLowerCase()} "${String(title).trim()}"`);
    return getItem(info.lastInsertRowid);
  });
  const item = create();
  const response = { item };
  if (idem) db.prepare('INSERT OR IGNORE INTO idempotency_keys(key,response_json) VALUES(?,?)').run(`${req.user.id}:${idem}`, JSON.stringify(response));
  res.status(201).json(response);
});

app.get('/api/items/:id', auth, (req, res) => {
  const item = getItem(Number(req.params.id));
  if (!canAccess(req.user, item)) return res.status(item ? 403 : 404).json({ error: item ? 'Access denied' : 'Work item not found' });
  res.json({ item });
});
app.patch('/api/items/:id', auth, allow('admin','manager','member'), (req, res) => {
  const id = Number(req.params.id);
  const item = getItem(id);
  if (!canAccess(req.user, item)) return res.status(item ? 403 : 404).json({ error: item ? 'Access denied' : 'Work item not found' });
  const { version, status, priority, ownerId, title, description } = req.body || {};
  if (!Number.isInteger(version)) return res.status(400).json({ error: 'Current item version is required' });
  if (version !== item.version) return res.status(409).json({ error: 'This item changed since you opened it. Refresh and try again.', currentItem: item });
  const changes = {};
  if (status !== undefined) {
    if (!['Open','In Progress','Blocked','Done'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const allowedTransitions = { 'Open':['In Progress','Blocked','Done'], 'In Progress':['Open','Blocked','Done'], 'Blocked':['Open','In Progress'], 'Done':['Open'] };
    if (status !== item.status && !allowedTransitions[item.status].includes(status))
      return res.status(422).json({ error: `Workflow transition from ${item.status} to ${status} is not allowed` });
    if (status !== item.status) changes.status = status;
  }
  if (priority !== undefined) {
    if (!['Low','Medium','High','Critical'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
    if (priority !== item.priority) changes.priority = priority;
  }
  if (ownerId !== undefined) {
    if (ownerId !== null && !db.prepare('SELECT id FROM users WHERE id=? AND team_id=?').get(ownerId, req.user.teamId))
      return res.status(400).json({ error: 'Owner must belong to your team' });
    if (ownerId !== item.owner_id) changes.owner_id = ownerId;
  }
  if (title !== undefined) {
    if (!String(title).trim() || String(title).length > 160) return res.status(400).json({ error: 'Title is required and must be 160 characters or fewer' });
    if (String(title).trim() !== item.title) changes.title = String(title).trim();
  }
  if (description !== undefined && String(description) !== item.description) changes.description = String(description).slice(0,4000);
  if (!Object.keys(changes).length) return res.json({ item, unchanged: true });
  const update = db.transaction(() => {
    const assignments = Object.keys(changes).map(k => `${k} = ?`).concat(['version = version + 1', "updated_at = datetime('now')"]).join(', ');
    const vals = Object.values(changes);
    const result = db.prepare(`UPDATE work_items SET ${assignments} WHERE id=? AND version=?`).run(...vals, id, version);
    if (result.changes !== 1) throw new Error('CONFLICT');
    for (const [key, value] of Object.entries(changes)) {
      const label = ({ owner_id: 'assignee', status: 'status', priority: 'priority', title: 'title', description: 'description' })[key];
      const oldValue = key === 'owner_id' ? (item.owner_name || 'Unassigned') : item[key];
      const newValue = key === 'owner_id' ? (value === null ? 'Unassigned' : db.prepare('SELECT name FROM users WHERE id=?').get(value).name) : value;
      logActivity(id, req.user.id, 'updated', `Changed ${label} from "${oldValue}" to "${newValue}"`);
    }
  });
  try { update(); } catch (e) {
    if (e.message === 'CONFLICT') return res.status(409).json({ error: 'A concurrent update won. Refresh the item before editing.' });
    throw e;
  }
  res.json({ item: getItem(id) });
});
app.get('/api/items/:id/activity', auth, (req, res) => {
  const item = getItem(Number(req.params.id));
  if (!canAccess(req.user, item)) return res.status(item ? 403 : 404).json({ error: item ? 'Access denied' : 'Work item not found' });
  const events = db.prepare(`SELECT a.id,a.action,a.details,a.created_at,u.name AS actor_name
    FROM activity a JOIN users u ON u.id=a.actor_id WHERE a.item_id=? ORDER BY a.id DESC LIMIT 100`).all(item.id);
  res.json({ activity: events });
});

if (require.main === module) app.listen(PORT, () => console.log(`OpsDesk API listening on http://localhost:${PORT}`));
module.exports = app;