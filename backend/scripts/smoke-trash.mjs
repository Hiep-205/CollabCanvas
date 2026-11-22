import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/collabcanvas') throw new Error('Expected local collabcanvas URL');
url.pathname = '/collabcanvas_test';
const testUrl = url.toString();
const port = '3105';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const emails = Array.from({ length: 3 }, () => `trash-${randomUUID()}@example.test`);
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
    body: JSON.stringify({ email, password: 'Long-test-password-123!', displayName: 'Trash Tester' }) });
  assert.equal(response.status, 201);
  return { ...(await response.json()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const request = (method, path, cookie, body) => fetch(`${base}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { origin, 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const json = async (response, status) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const taskNode = (id, taskId, x) => ({ id, type: 'task', taskId, text: null, color: null, x, y: 0, hidden: false });
try {
  await ready();
  await client.connect(); connected = true;
  const [owner, viewer, outsider] = await Promise.all(emails.map(register));
  const workspaceId = (await json(await request('POST', '/workspaces', owner.cookie, { name: 'Trash smoke' }), 201)).id;
  workspaceIds.push(workspaceId);
  const otherId = (await json(await request('POST', '/workspaces', outsider.cookie, { name: 'Other trash' }), 201)).id;
  workspaceIds.push(otherId);
  await client.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [workspaceId, viewer.id, 'viewer']);
  const prefix = `/workspaces/${workspaceId}`;
  const a = await json(await request('POST', `${prefix}/tasks`, owner.cookie, { title: 'A' }), 201);
  const b = await json(await request('POST', `${prefix}/tasks`, owner.cookie, { title: 'B' }), 201);
  const na = taskNode(randomUUID(), a.id, 0);
  const nb = taskNode(randomUUID(), b.id, 250);
  const note = { id: randomUUID(), type: 'note', taskId: a.id, text: 'Recover me', color: 'yellow', x: 100, y: 80, hidden: false };
  const edges = [{ source: na.id, target: nb.id, kind: 'dependency' }, { source: note.id, target: na.id, kind: 'association' }];
  await json(await request('PUT', `${prefix}/canvas`, owner.cookie, { version: '1', nodes: [na, nb, note], edges }), 200);
  assert.equal((await request('GET', `${prefix}/trash?type=tasks`, outsider.cookie)).status, 404);
  assert.equal((await request('PATCH', `${prefix}/trash/tasks/${a.id}`, viewer.cookie, { version: a.version, deleted: true })).status, 403);
  const trashed = await json(await request('PATCH', `${prefix}/trash/tasks/${a.id}`, owner.cookie, { version: a.version, deleted: true }), 200);
  assert.equal((await request('PATCH', `${prefix}/trash/tasks/${a.id}`, owner.cookie, { version: a.version, deleted: true })).status, 409);
  assert.equal((await request('GET', `${prefix}/tasks/${a.id}`, owner.cookie)).status, 404);
  const hidden = await json(await request('GET', `${prefix}/canvas`, owner.cookie), 200);
  assert.deepEqual(hidden.nodes.map((item) => item.id), [nb.id]);
  assert.equal(hidden.edges.length, 0);
  assert.equal((await request('PUT', `${prefix}/canvas`, owner.cookie, { version: '2', nodes: [na, nb, note], edges })).status, 409);
  const list = await json(await request('GET', `${prefix}/trash?type=tasks`, owner.cookie), 200);
  assert.equal(list.items[0].id, a.id);
  await json(await request('PUT', `${prefix}/canvas`, owner.cookie, { version: hidden.version, nodes: [nb], edges: [] }), 200);
  await json(await request('PATCH', `${prefix}/trash/tasks/${a.id}`, owner.cookie, { version: trashed.version, deleted: false }), 200);
  const recovered = await json(await request('GET', `${prefix}/canvas`, owner.cookie), 200);
  assert.equal(recovered.nodes.length, 3);
  assert.equal(recovered.edges.length, 2);
  const noteTrashed = await json(await request('PATCH', `${prefix}/trash/notes/${note.id}`, owner.cookie, { version: recovered.version, deleted: true }), 200);
  assert.equal((await request('PATCH', `${prefix}/trash/notes/${note.id}`, owner.cookie, { version: recovered.version, deleted: true })).status, 409);
  const noteList = await json(await request('GET', `${prefix}/trash?type=notes`, viewer.cookie), 200);
  assert.equal(noteList.items[0].id, note.id);
  assert.equal((await request('PATCH', `${prefix}/trash/notes/${note.id}`, viewer.cookie, { version: noteTrashed.canvasVersion, deleted: false })).status, 403);
  await json(await request('PATCH', `${prefix}/trash/notes/${note.id}`, owner.cookie, { version: noteTrashed.canvasVersion, deleted: false }), 200);
  const final = await json(await request('GET', `${prefix}/canvas`, owner.cookie), 200);
  assert.equal(final.nodes.length, 3);
  assert.equal(final.edges.length, 2);
  console.log('Trash smoke passed against collabcanvas_test');
} finally {
  if (connected) {
    for (const id of workspaceIds) await client.query('DELETE FROM workspaces WHERE id=$1', [id]);
    await client.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
    await client.end();
  }
  server.kill();
}
