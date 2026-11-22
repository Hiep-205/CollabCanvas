import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const databaseUrl = new URL(process.env.DATABASE_URL);
if (databaseUrl.pathname !== '/collabcanvas') throw new Error('Expected the local collabcanvas URL');
databaseUrl.pathname = '/collabcanvas_test';
const testUrl = databaseUrl.toString();
const port = '3103';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const emails = [0, 1, 2, 3].map(() => `task-${randomUUID()}@example.test`);
const password = 'Long-test-password-123!';
const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: testUrl, PORT: port, FRONTEND_ORIGIN: origin },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });

async function ready() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`API exited: ${output.slice(-1000)}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch { /* Startup still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not start: ${output.slice(-1000)}`);
}

async function register(email) {
  const response = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'Task Tester' }),
  });
  assert.equal(response.status, 201);
  const user = await response.json();
  return { id: user.id, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function createWorkspace(cookie) {
  const response = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Task test workspace' }),
  });
  assert.equal(response.status, 201);
  return (await response.json()).id;
}

function taskUrl(workspaceId, taskId = '') {
  return `${base}/workspaces/${workspaceId}/tasks${taskId ? `/${taskId}` : ''}`;
}

async function write(method, url, cookie, body) {
  return fetch(url, {
    method,
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const client = new pg.Client({ connectionString: testUrl });
const workspaceIds = [];
let connected = false;
try {
  await ready();
  await client.connect();
  connected = true;
  const [owner, editor, viewer, outsider] = await Promise.all(emails.map(register));
  const workspaceId = await createWorkspace(owner.cookie);
  workspaceIds.push(workspaceId);
  const otherWorkspaceId = await createWorkspace(outsider.cookie);
  workspaceIds.push(otherWorkspaceId);
  for (const [user, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
    await client.query(
      'INSERT INTO workspace_members(workspace_id, user_id, role) VALUES($1, $2, $3)',
      [workspaceId, user.id, role],
    );
  }

  assert.equal((await fetch(`${taskUrl(workspaceId)}?status=todo`)).status, 401);
  assert.equal((await fetch(`${taskUrl(workspaceId)}?status=todo`, { headers: { cookie: outsider.cookie } })).status, 404);
  assert.equal((await write('POST', taskUrl(workspaceId), viewer.cookie, { title: 'Denied' })).status, 403);
  assert.equal((await write('POST', taskUrl(workspaceId), owner.cookie, { title: '  ' })).status, 400);
  assert.equal((await write('POST', taskUrl(workspaceId), owner.cookie, { title: 'Invalid', status: 'blocked' })).status, 400);

  const firstResponse = await write('POST', taskUrl(workspaceId), owner.cookie, {
    title: '  First task  ', sortOrder: '10', priority: 'high', dueAt: '2099-12-01T12:00:00Z',
  });
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.equal(first.title, 'First task');
  assert.equal(first.status, 'todo');
  assert.equal(first.priority, 'high');
  assert.equal(first.version, '1');
  assert.equal(first.sortOrder, '10');

  const secondResponse = await write('POST', taskUrl(workspaceId), editor.cookie, {
    title: 'Second task', sortOrder: '2',
  });
  assert.equal(secondResponse.status, 201);
  const second = await secondResponse.json();
  const viewerList = await fetch(`${taskUrl(workspaceId)}?status=todo`, { headers: { cookie: viewer.cookie } });
  assert.equal(viewerList.status, 200);
  assert.deepEqual((await viewerList.json()).items.map((item) => item.id), [second.id, first.id]);
  const filteredList = await fetch(`${taskUrl(workspaceId)}?query=FIRST&priority=high&due=upcoming`, { headers: { cookie: viewer.cookie } });
  assert.equal(filteredList.status, 200);
  assert.deepEqual((await filteredList.json()).items.map((item) => item.id), [first.id]);
  const noDueList = await fetch(`${taskUrl(workspaceId)}?due=none`, { headers: { cookie: owner.cookie } });
  assert.equal(noDueList.status, 200);
  assert.deepEqual((await noDueList.json()).items.map((item) => item.id), [second.id]);
  assert.equal((await fetch(`${taskUrl(workspaceId)}?priority=urgent`, { headers: { cookie: owner.cookie } })).status, 400);
  assert.equal((await fetch(`${taskUrl(workspaceId)}?due=all-time`, { headers: { cookie: owner.cookie } })).status, 400);
  const injectionSearch = await fetch(`${taskUrl(workspaceId)}?query=${encodeURIComponent("' OR 1=1 --")}`, { headers: { cookie: owner.cookie } });
  assert.equal(injectionSearch.status, 200);
  assert.deepEqual((await injectionSearch.json()).items, []);
  assert.equal((await fetch(`${taskUrl(workspaceId)}?status=invalid`, { headers: { cookie: owner.cookie } })).status, 400);
  assert.equal((await fetch(taskUrl(workspaceId, first.id), { headers: { cookie: viewer.cookie } })).status, 200);
  assert.equal((await fetch(taskUrl(workspaceId, first.id), { headers: { cookie: outsider.cookie } })).status, 404);
  assert.equal((await fetch(taskUrl(otherWorkspaceId, first.id), { headers: { cookie: outsider.cookie } })).status, 404);

  assert.equal((await write('PATCH', taskUrl(workspaceId, first.id), viewer.cookie, { version: '1', status: 'done' })).status, 403);
  assert.equal((await write('PATCH', taskUrl(workspaceId, first.id), editor.cookie, { status: 'done' })).status, 400);
  const moved = await write('PATCH', taskUrl(workspaceId, first.id), editor.cookie, {
    version: '1', status: 'in_progress', description: 'Started',
  });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).version, '2');
  assert.equal((await write('PATCH', taskUrl(workspaceId, first.id), owner.cookie, { version: '1', title: 'Stale' })).status, 409);
  assert.equal((await write('PATCH', taskUrl(otherWorkspaceId, first.id), outsider.cookie, { version: '2', title: 'Wrong' })).status, 404);

  const [concurrentA, concurrentB] = await Promise.all([
    write('PATCH', taskUrl(workspaceId, first.id), owner.cookie, { version: '2', title: 'Owner edit' }),
    write('PATCH', taskUrl(workspaceId, first.id), editor.cookie, { version: '2', title: 'Editor edit' }),
  ]);
  assert.deepEqual([concurrentA.status, concurrentB.status].sort(), [200, 409]);
  const finalResponse = await fetch(taskUrl(workspaceId, first.id), { headers: { cookie: owner.cookie } });
  assert.equal((await finalResponse.json()).version, '3');
  const todoList = await fetch(`${taskUrl(workspaceId)}?status=todo`, { headers: { cookie: owner.cookie } });
  assert.deepEqual((await todoList.json()).items.map((item) => item.id), [second.id]);
  const membersUrl = `${base}/workspaces/${workspaceId}/members`;
  const membersResponse = await fetch(membersUrl, { headers: { cookie: viewer.cookie } });
  assert.equal(membersResponse.status, 200);
  assert.equal((await membersResponse.json()).items.length, 3);
  assert.equal((await fetch(membersUrl, { headers: { cookie: outsider.cookie } })).status, 404);
  const assigneesUrl = `${taskUrl(workspaceId, first.id)}/assignees`;
  assert.equal((await write('PUT', assigneesUrl, viewer.cookie, { version: '3', userIds: [editor.id] })).status, 403);
  assert.equal((await write('PUT', assigneesUrl, owner.cookie, { version: '3', userIds: [outsider.id] })).status, 400);
  assert.equal((await write('PUT', assigneesUrl, owner.cookie, { version: '3', userIds: [viewer.id] })).status, 400);
  const assigned = await write('PUT', assigneesUrl, owner.cookie, { version: '3', userIds: [owner.id, editor.id] });
  assert.equal(assigned.status, 200);
  assert.deepEqual((await assigned.json()).assigneeIds.sort(), [owner.id, editor.id].sort());
  assert.equal((await write('PUT', assigneesUrl, editor.cookie, { version: '3', userIds: [] })).status, 409);
  const assignedList = await fetch(`${taskUrl(workspaceId)}?assigneeId=${editor.id}`, { headers: { cookie: viewer.cookie } });
  assert.deepEqual((await assignedList.json()).items.map((item) => item.id), [first.id]);
  const blockedUrl = taskUrl(workspaceId, first.id);
  assert.equal((await write('PATCH', blockedUrl, viewer.cookie, { version: '4', blockedReason: 'Waiting for review' })).status, 403);
  assert.equal((await write('PATCH', blockedUrl, owner.cookie, { version: '4', blockedReason: 'x'.repeat(501) })).status, 400);
  const blockedResponse = await write('PATCH', blockedUrl, editor.cookie, { version: '4', blockedReason: '  Waiting for review  ' });
  assert.equal(blockedResponse.status, 200);
  assert.equal((await blockedResponse.json()).blockedReason, 'Waiting for review');
  assert.equal((await write('PATCH', blockedUrl, owner.cookie, { version: '4', blockedReason: null })).status, 409);
  const blockedList = await fetch(`${taskUrl(workspaceId)}?status=in_progress`, { headers: { cookie: viewer.cookie } });
  assert.equal((await blockedList.json()).items[0].blockedReason, 'Waiting for review');
  const completedResponse = await write('PATCH', blockedUrl, owner.cookie, { version: '5', status: 'done' });
  assert.equal(completedResponse.status, 200);
  assert.equal((await completedResponse.json()).blockedReason, null);
  assert.equal((await write('PATCH', blockedUrl, editor.cookie, { version: '6', blockedReason: 'Still blocked' })).status, 400);
  const reopenedResponse = await write('PATCH', blockedUrl, editor.cookie, { version: '6', status: 'in_progress', blockedReason: 'Needs approval' });
  assert.equal(reopenedResponse.status, 200);
  assert.equal((await reopenedResponse.json()).blockedReason, 'Needs approval');
  const clearedResponse = await write('PATCH', blockedUrl, owner.cookie, { version: '7', blockedReason: null });
  assert.equal(clearedResponse.status, 200);
  assert.equal((await clearedResponse.json()).blockedReason, null);
  console.log('Task smoke test passed against collabcanvas_test');
} finally {
  if (connected) {
    for (const workspaceId of workspaceIds) await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
    await client.end();
  }
  server.kill();
}
