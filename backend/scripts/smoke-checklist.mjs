import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' || url.pathname !== '/collabcanvas') throw new Error('Expected local collabcanvas database');
url.pathname = '/collabcanvas_test';
const port = '3110';
const base = `http://127.0.0.1:${port}/api`;
const origin = 'http://localhost:5173';
const emails = Array.from({ length: 3 }, () => `checklist-${randomUUID()}@example.test`);
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

async function write(method, path, cookie, body) {
  return fetch(`${base}${path}`, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function register(email) {
  const response = await write('POST', '/auth/register', '', { email, password: 'Long-test-password-123!', displayName: 'Checklist Tester' });
  assert.equal(response.status, 201);
  return { id: (await response.json()).id, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const client = new pg.Client({ connectionString: url.toString() });
const workspaces = [];
let connected = false;
try {
  await ready();
  await client.connect();
  connected = true;
  const [owner, viewer, outsider] = await Promise.all(emails.map(register));
  const workspaceResponse = await write('POST', '/workspaces', owner.cookie, { name: 'Checklist test' });
  assert.equal(workspaceResponse.status, 201);
  const workspaceId = (await workspaceResponse.json()).id;
  workspaces.push(workspaceId);
  await client.query('INSERT INTO workspace_members(workspace_id, user_id, role) VALUES($1, $2, $3)', [workspaceId, viewer.id, 'viewer']);
  const taskResponse = await write('POST', `/workspaces/${workspaceId}/tasks`, owner.cookie, { title: 'Plan demo' });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json();
  const path = `/workspaces/${workspaceId}/tasks/${task.id}/checklist`;
  assert.equal((await write('POST', path, viewer.cookie, { version: '1', title: 'Denied' })).status, 403);
  assert.equal((await write('POST', path, outsider.cookie, { version: '1', title: 'Hidden' })).status, 404);
  assert.equal((await write('POST', path, owner.cookie, { version: '1', title: "' OR 1=1 --" })).status, 201);
  const next = await write('POST', path, owner.cookie, { version: '2', title: 'Write report' });
  assert.equal(next.status, 201);
  const withItems = await next.json();
  assert.equal(withItems.checklist.length, 2);
  assert.equal(withItems.checklist[0].title, "' OR 1=1 --");
  assert.equal((await write('POST', path, owner.cookie, { version: '2', title: 'Stale' })).status, 409);
  assert.equal((await write('POST', path, owner.cookie, { version: '3', title: '  ' })).status, 400);
  const itemPath = `${path}/${withItems.checklist[0].id}`;
  assert.equal((await write('PATCH', itemPath, viewer.cookie, { version: '3', isDone: true })).status, 403);
  const completed = await write('PATCH', itemPath, owner.cookie, { version: '3', isDone: true });
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).checklist[0].isDone, true);
  const list = await fetch(`${base}/workspaces/${workspaceId}/tasks?status=todo`, { headers: { cookie: viewer.cookie } });
  assert.equal((await list.json()).items[0].checklist[0].isDone, true);
  assert.equal((await write('DELETE', itemPath, owner.cookie, { version: '3' })).status, 409);
  const removed = await write('DELETE', itemPath, owner.cookie, { version: '4' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).checklist.length, 1);
  console.log('Checklist smoke test passed against collabcanvas_test');
} finally {
  if (connected) {
    for (const id of workspaces) await client.query('DELETE FROM workspaces WHERE id = $1', [id]);
    await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
    await client.end();
  }
  server.kill();
}
