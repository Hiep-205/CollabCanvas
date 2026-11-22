import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (url.pathname !== '/collabcanvas') throw new Error('Expected local collabcanvas URL');
url.pathname = '/collabcanvas_test';
const testUrl = url.toString();
const port = '3104';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const emails = Array.from({ length: 4 }, () => `canvas-${randomUUID()}@example.test`);
const server = spawn(process.execPath, ['dist/main.js'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: testUrl, PORT: port, FRONTEND_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });
const client = new pg.Client({ connectionString: testUrl });
const workspaceIds = [];
let connected = false;
async function ready() {
  for (let i = 0; i < 50; i += 1) {
    if (server.exitCode !== null) throw new Error(output.slice(-1000));
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(output.slice(-1000));
}
async function register(email) {
  const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Long-test-password-123!', displayName: 'Canvas Tester' }) });
  assert.equal(response.status, 201);
  return { ...(await response.json()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function post(path, cookie, body) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function put(path, cookie, body) {
  return fetch(`${base}${path}`, { method: 'PUT', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} });
const node = (id, taskId, x = 0) => ({ id, type: 'task', taskId, text: null, color: null, x, y: 0, hidden: false });
try {
  await ready();
  await client.connect(); connected = true;
  const [owner, editor, viewer, outsider] = await Promise.all(emails.map(register));
  const workspaceResponse = await post('/workspaces', owner.cookie, { name: 'Canvas smoke' });
  assert.equal(workspaceResponse.status, 201);
  const workspaceId = (await workspaceResponse.json()).id;
  workspaceIds.push(workspaceId);
  const other = (await (await post('/workspaces', outsider.cookie, { name: 'Other canvas' })).json()).id;
  workspaceIds.push(other);
  for (const [user, role] of [[editor, 'editor'], [viewer, 'viewer']]) await client.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [workspaceId, user.id, role]);
  const taskA = await (await post(`/workspaces/${workspaceId}/tasks`, owner.cookie, { title: 'A' })).json();
  const taskB = await (await post(`/workspaces/${workspaceId}/tasks`, owner.cookie, { title: 'B' })).json();
  const foreignTask = await (await post(`/workspaces/${other}/tasks`, outsider.cookie, { title: 'Foreign' })).json();
  const path = `/workspaces/${workspaceId}/canvas`;
  assert.equal((await get(path)).status, 401);
  assert.equal((await get(path, outsider.cookie)).status, 404);
  assert.deepEqual(await (await get(path, viewer.cookie)).json(), { version: '1', nodes: [], edges: [] });
  const taskNodeA = node(randomUUID(), taskA.id);
  const taskNodeB = node(randomUUID(), taskB.id, 200);
  const note = { id: randomUUID(), type: 'note', taskId: null, text: 'Idea', color: 'yellow', x: 10, y: 20, hidden: false };
  const snapshot = { version: '1', nodes: [taskNodeA, taskNodeB, note], edges: [
    { source: taskNodeA.id, target: taskNodeB.id, kind: 'dependency' },
    { source: note.id, target: taskNodeA.id, kind: 'association' },
  ] };
  assert.equal((await put(path, viewer.cookie, snapshot)).status, 403);
  assert.equal((await put(path, outsider.cookie, snapshot)).status, 404);
  assert.equal((await put(path, owner.cookie, { ...snapshot, nodes: [node(randomUUID(), foreignTask.id)] })).status, 400);
  const foreignNode = node(randomUUID(), foreignTask.id);
  assert.equal((await put(`/workspaces/${other}/canvas`, outsider.cookie, { version: '1', nodes: [foreignNode], edges: [] })).status, 200);
  assert.equal((await put(path, owner.cookie, { version: '1', nodes: [node(foreignNode.id, taskA.id)], edges: [] })).status, 400);
  assert.equal((await put(path, owner.cookie, { ...snapshot, edges: [...snapshot.edges, { source: taskNodeB.id, target: taskNodeA.id, kind: 'dependency' }] })).status, 400);
  assert.equal((await put(path, owner.cookie, { ...snapshot, nodes: [{ ...note, text: 'x'.repeat(17000) }] })).status, 413);
  const savedResponse = await put(path, owner.cookie, snapshot);
  assert.equal(savedResponse.status, 200, await savedResponse.text());
  const saved = await (await get(path, viewer.cookie)).json();
  assert.equal(saved.version, '2');
  assert.equal(saved.nodes.length, 3);
  assert.equal(saved.edges.length, 2);
  assert.equal((await put(path, editor.cookie, snapshot)).status, 409);
  const moved = { version: '2', nodes: [{ ...taskNodeA, x: 50 }, taskNodeB, { ...note, text: 'Updated', taskId: taskA.id }], edges: snapshot.edges };
  assert.equal((await put(path, editor.cookie, moved)).status, 200);
  const final = await (await get(path, owner.cookie)).json();
  assert.equal(final.version, '3');
  assert.equal(final.nodes.find((item) => item.id === note.id).text, 'Updated');
  assert.equal(final.nodes.find((item) => item.id === note.id).taskId, taskA.id);
  assert.equal((await put(path, owner.cookie, { version: '3', nodes: [taskNodeA, taskNodeB], edges: [] })).status, 409);
  const [concurrentA, concurrentB] = await Promise.all([
    put(path, owner.cookie, { version: '3', nodes: moved.nodes, edges: moved.edges }),
    put(path, editor.cookie, { version: '3', nodes: moved.nodes, edges: moved.edges }),
  ]);
  assert.deepEqual([concurrentA.status, concurrentB.status].sort(), [200, 409]);
  assert.equal((await get(path, owner.cookie)).status, 200);
  console.log('Canvas smoke passed against collabcanvas_test');
} finally {
  if (connected) {
    for (const id of workspaceIds) await client.query('DELETE FROM workspaces WHERE id=$1', [id]);
    await client.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
    await client.end();
  }
  server.kill();
}
