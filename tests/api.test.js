const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/index');
const http = require('node:http');

let server, base;
test.before(async () => {
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, data: await response.json() };
}
async function login(email = 'admin@opsdesk.local') {
  const r = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'demo1234' }) });
  assert.equal(r.status, 200);
  return r.data.token;
}
test('health endpoint responds', async () => {
  const r = await request('/api/health');
  assert.equal(r.status, 200); assert.equal(r.data.ok, true);
});
test('server enforces viewer read-only access', async () => {
  const token = await login('viewer@opsdesk.local');
  const r = await request('/api/items', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const create = await request('/api/items', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: 'Should not be created' }) });
  assert.equal(create.status, 403);
});
test('idempotency key prevents duplicate create on retry', async () => {
  const token = await login();
  const headers = { Authorization: `Bearer ${token}`, 'Idempotency-Key': 'test-repeat-key-1' };
  const body = JSON.stringify({ title: 'Idempotency test item', type: 'Task', priority: 'Low' });
  const a = await request('/api/items', { method: 'POST', headers, body });
  const b = await request('/api/items', { method: 'POST', headers, body });
  assert.ok([200,201].includes(a.status)); assert.equal(b.status, 200);
  assert.equal(a.data.item.id, b.data.item.id);
});
test('stale version is rejected with conflict', async () => {
  const token = await login();
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request('/api/items', { method: 'POST', headers, body: JSON.stringify({ title: 'Version test item' }) });
  assert.equal(created.status, 201);
  const item = created.data.item;
  const first = await request(`/api/items/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ version: item.version, priority: 'High' }) });
  assert.equal(first.status, 200);
  const stale = await request(`/api/items/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ version: item.version, priority: 'Critical' }) });
  assert.equal(stale.status, 409);
});
test('workflow rejects blocked-to-done transition', async () => {
  const token = await login();
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request('/api/items', { method: 'POST', headers, body: JSON.stringify({ title: 'Workflow test item' }) });
  const item = created.data.item;
  const blocked = await request(`/api/items/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ version: item.version, status: 'Blocked' }) });
  assert.equal(blocked.status, 200);
  const invalid = await request(`/api/items/${item.id}`, { method: 'PATCH', headers, body: JSON.stringify({ version: blocked.data.item.version, status: 'Done' }) });
  assert.equal(invalid.status, 422);
});