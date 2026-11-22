import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/collabcanvas') throw new Error('Expected local collabcanvas database');
url.pathname = '/collabcanvas_test';
const origin = 'http://localhost:5173';
const base = 'http://127.0.0.1:3112/api';
const server = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, DATABASE_URL: url.toString(), PORT: '3112', FRONTEND_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
const db = new pg.Client({ connectionString: url.toString() });
const emails = Array.from({ length: 3 }, () => `dashboard-${randomUUID()}@example.test`);
const workspaceIds = [];
let connected = false;

async function request(method, path, cookie = '', body) {
  return fetch(`${base}${path}`, { method, headers: { origin, cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(output.slice(-800));
    try { if ((await request('GET', '/health')).ok) { ready = true; break; } } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output.slice(-800));
  await db.connect();
  connected = true;
  const users = [];
  for (const email of emails) {
    const response = await request('POST', '/auth/register', '', { email, displayName: 'Dashboard Tester', password: 'Long-test-password-123!' });
    assert.equal(response.status, 201);
    users.push({ id: (await response.json()).id, cookie: response.headers.get('set-cookie').split(';')[0] });
  }
  const [owner, viewer, outsider] = users;
  assert.equal((await request('GET', '/dashboard')).status, 401);
  const empty = await (await request('GET', '/dashboard', owner.cookie)).json();
  assert.deepEqual(empty.summary, { workspaceCount: 0, taskCount: 0, completedCount: 0, myOpenCount: 0, myOverdueCount: 0 });
  for (const [index, actor] of [owner, owner, outsider].entries()) {
    const response = await request('POST', '/workspaces', actor.cookie, { name: `Dashboard ${index}` });
    assert.equal(response.status, 201);
    workspaceIds.push((await response.json()).id);
  }
  await db.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [workspaceIds[0], viewer.id, 'viewer']);
  for (let index = 0; index < 16; index += 1) {
    const privateTask = index === 15;
    const workspaceId = privateTask ? workspaceIds[2] : index === 14 ? workspaceIds[1] : workspaceIds[0];
    const actorId = privateTask ? outsider.id : owner.id;
    const status = index === 11 ? 'done' : 'todo';
    const task = await db.query('INSERT INTO tasks(workspace_id,title,status,created_by_user_id,due_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [
      workspaceId, privateTask ? 'Private task' : `Dashboard task ${index}`, status, actorId,
      index === 0 ? '2000-01-01T00:00:00Z' : index < 11 ? '2099-01-01T00:00:00Z' : null,
      index === 12 ? new Date() : null,
    ]);
    if (index !== 13) await db.query('INSERT INTO task_assignees(workspace_id,task_id,user_id,assigned_by_user_id) VALUES($1,$2,$3,$3)', [workspaceId, task.rows[0].id, actorId]);
  }
  for (const page of ['0', '-1', '1001', '1.5', 'abc', "1' OR 1=1"]) {
    assert.equal((await request('GET', `/dashboard?page=${encodeURIComponent(page)}`, owner.cookie)).status, 400);
  }
  const first = await (await request('GET', '/dashboard', owner.cookie)).json();
  assert.deepEqual(first.summary, { workspaceCount: 2, taskCount: 14, completedCount: 1, myOpenCount: 12, myOverdueCount: 1 });
  assert.equal(first.tasks.length, 10);
  assert.equal(first.tasks[0].title, 'Dashboard task 0');
  assert.equal(first.nextPage, 2);
  const second = await (await request('GET', '/dashboard?page=2', owner.cookie)).json();
  assert.equal(second.tasks.length, 2);
  assert.equal(second.nextPage, null);
  assert.equal(new Set([...first.tasks, ...second.tasks].map((task) => task.id)).size, 12);
  assert.ok([...first.tasks, ...second.tasks].every((task) => workspaceIds.slice(0, 2).includes(task.workspaceId)));
  const readOnly = await (await request('GET', '/dashboard', viewer.cookie)).json();
  assert.equal(readOnly.summary.taskCount, 13);
  assert.equal(readOnly.summary.myOpenCount, 0);
  assert.deepEqual(readOnly.tasks, []);
  await db.query('DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceIds[0], viewer.id]);
  const revoked = await (await request('GET', '/dashboard', viewer.cookie)).json();
  assert.equal(revoked.summary.taskCount, 0);
  assert.equal(revoked.summary.workspaceCount, 0);
  console.log('Dashboard smoke passed: cross-workspace counts, assignments, trash, isolation, viewer, revocation, pagination and input validation');
} finally {
  if (connected) {
    try {
      await db.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [workspaceIds]);
      await db.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
    } finally { await db.end(); }
  }
  server.kill();
}
