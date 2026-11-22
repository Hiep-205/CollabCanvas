import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/collabcanvas') throw new Error('Expected local collabcanvas database');
url.pathname = '/collabcanvas_test';
const port = '3111';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const emails = Array.from({ length: 3 }, () => `activity-${randomUUID()}@example.test`);
const server = spawn(process.execPath, ['dist/main.js'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url.toString(), PORT: port, FRONTEND_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });

async function ready() {
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) throw new Error(`API exited: ${output.slice(-800)}`);
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not start: ${output.slice(-800)}`);
}

async function request(method, path, cookie, body) {
  return fetch(`${base}${path}`, { method, headers: { origin, cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

async function register(email) {
  const response = await request('POST', '/auth/register', '', { email, password: 'Long-test-password-123!', displayName: 'Activity Tester' });
  assert.equal(response.status, 201);
  return { id: (await response.json()).id, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const db = new pg.Client({ connectionString: url.toString() });
let connected = false;
let workspaceId;
try {
  await ready();
  await db.connect();
  connected = true;
  const [owner, viewer, outsider] = await Promise.all(emails.map(register));
  const workspace = await request('POST', '/workspaces', owner.cookie, { name: 'Activity test workspace' });
  assert.equal(workspace.status, 201);
  workspaceId = (await workspace.json()).id;
  await db.query('INSERT INTO workspace_members(workspace_id, user_id, role) VALUES($1, $2, $3)', [workspaceId, viewer.id, 'viewer']);
  const tasksPath = `/workspaces/${workspaceId}/tasks`;
  const activityPath = `/workspaces/${workspaceId}/activity`;
  const createdResponse = await request('POST', tasksPath, owner.cookie, { title: 'Activity demo task' });
  assert.equal(createdResponse.status, 201);
  const task = await createdResponse.json();
  const taskPath = `${tasksPath}/${task.id}`;
  const changed = await request('PATCH', taskPath, owner.cookie, { version: '1', status: 'in_progress' });
  assert.equal(changed.status, 200);
  assert.equal((await request('PATCH', taskPath, owner.cookie, { version: '1', title: 'Stale' })).status, 409);
  const assigned = await request('PUT', `${taskPath}/assignees`, owner.cookie, { version: '2', userIds: [owner.id] });
  assert.equal(assigned.status, 200);
  const checked = await request('POST', `${taskPath}/checklist`, owner.cookie, { version: '3', title: 'Prepare evidence' });
  assert.equal(checked.status, 201);
  const trashed = await request('PATCH', `/workspaces/${workspaceId}/trash/tasks/${task.id}`, owner.cookie, { version: '4', deleted: true });
  assert.equal(trashed.status, 200);
  const restored = await request('PATCH', `/workspaces/${workspaceId}/trash/tasks/${task.id}`, owner.cookie, { version: '5', deleted: false });
  assert.equal(restored.status, 200);

  assert.equal((await request('GET', activityPath, '', null)).status, 401);
  assert.equal((await request('GET', activityPath, outsider.cookie, null)).status, 404);
  assert.equal((await request('GET', `${activityPath}?page=0`, owner.cookie, null)).status, 400);
  assert.equal((await request('GET', `${activityPath}?taskId=bad`, owner.cookie, null)).status, 400);
  const response = await request('GET', `${activityPath}?taskId=${task.id}`, viewer.cookie, null);
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.deepEqual(history.items.map((event) => event.action), [
    'task_restored', 'task_trashed', 'checklist_changed', 'task_assignees_changed', 'task_status_changed', 'task_created',
  ]);
  assert.equal(history.items[4].fromStatus, 'todo');
  assert.equal(history.items[4].toStatus, 'in_progress');
  assert.ok(history.items.every((event) => event.taskId === task.id && event.actorUserId === owner.id && event.actorName === 'Activity Tester'));
  assert.equal(history.nextPage, null);
  for (let i = 0; i < 15; i += 1) assert.equal((await request('POST', tasksPath, owner.cookie, { title: `Another task ${i}` })).status, 201);
  const firstPage = await (await request('GET', activityPath, owner.cookie, null)).json();
  assert.equal(firstPage.items.length, 20);
  assert.equal(firstPage.nextPage, 2);
  const secondPage = await (await request('GET', `${activityPath}?page=2`, owner.cookie, null)).json();
  assert.equal(secondPage.items.length, 1);
  console.log('Activity smoke test passed against collabcanvas_test');
} finally {
  if (connected) {
    if (workspaceId) await db.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await db.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
    await db.end();
  }
  server.kill();
}
