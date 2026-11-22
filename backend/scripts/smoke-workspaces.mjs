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
const port = '3102';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const emails = [0, 1, 2, 3].map(() => `workspace-${randomUUID()}@example.test`);
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
    body: JSON.stringify({ email, password, displayName: 'Workspace Tester' }),
  });
  assert.equal(response.status, 201);
  return response.headers.get('set-cookie')?.split(';')[0];
}

async function createWorkspace(cookie, body, requestOrigin = origin) {
  return fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { origin: requestOrigin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function invite(cookie, workspaceId, email, role) {
  return fetch(`${base}/workspaces/${workspaceId}/invitations`, {
    method: 'POST',
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
}

async function respond(cookie, invitationId, action) {
  return fetch(`${base}/invitations/${invitationId}/${action}`, {
    method: 'POST',
    headers: { origin, cookie },
  });
}

async function inboxItems(cookie) {
  const response = await fetch(`${base}/invitations`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return (await response.json()).items;
}

const client = new pg.Client({ connectionString: testUrl });
let connected = false;
let workspaceId;
try {
  await ready();
  await client.connect();
  connected = true;
  assert.equal((await fetch(`${base}/workspaces`)).status, 401);
  assert.equal((await fetch(`${base}/invitations`)).status, 401);
  const ownerCookie = await register(emails[0]);
  const outsiderCookie = await register(emails[1]);
  const viewerCookie = await register(emails[2]);
  const expiringCookie = await register(emails[3]);
  assert.equal((await createWorkspace(ownerCookie, { name: '   ' })).status, 400);
  assert.equal((await createWorkspace(ownerCookie, { name: 'Secret', description: 'Private' }, 'http://evil.example')).status, 403);

  const created = await createWorkspace(ownerCookie, { name: '  Demo project  ', description: '  Notes  ' });
  assert.equal(created.status, 201);
  const workspace = await created.json();
  workspaceId = workspace.id;
  assert.equal(workspace.name, 'Demo project');
  assert.equal(workspace.description, 'Notes');
  assert.equal(workspace.role, 'owner');

  const ownerList = await fetch(`${base}/workspaces`, { headers: { cookie: ownerCookie } });
  assert.equal(ownerList.status, 200);
  assert.equal((await ownerList.json()).items.some((item) => item.id === workspaceId), true);
  const outsiderList = await fetch(`${base}/workspaces`, { headers: { cookie: outsiderCookie } });
  assert.equal(outsiderList.status, 200);
  assert.equal((await outsiderList.json()).items.some((item) => item.id === workspaceId), false);

  assert.equal((await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: ownerCookie } })).status, 200);
  assert.equal((await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: outsiderCookie } })).status, 404);
  assert.equal((await fetch(`${base}/workspaces?page=0`, { headers: { cookie: ownerCookie } })).status, 400);
  assert.equal((await fetch(`${base}/workspaces?page=1e2`, { headers: { cookie: ownerCookie } })).status, 400);
  assert.equal((await fetch(`${base}/workspaces/not-a-uuid`, { headers: { cookie: ownerCookie } })).status, 400);

  assert.equal((await invite(outsiderCookie, workspaceId, emails[2], 'viewer')).status, 404);
  assert.equal((await invite(ownerCookie, workspaceId, emails[1], 'owner')).status, 400);
  assert.equal((await invite(ownerCookie, workspaceId, `missing-${randomUUID()}@example.test`, 'editor')).status, 202);
  const editorInvite = await invite(ownerCookie, workspaceId, emails[1], 'editor');
  assert.equal(editorInvite.status, 202);
  assert.equal((await editorInvite.json()).status, 'processed');
  const editorInviteId = (await inboxItems(outsiderCookie)).find((item) => item.workspace.id === workspaceId)?.id;
  assert.ok(editorInviteId);
  assert.equal((await invite(ownerCookie, workspaceId, emails[1], 'editor')).status, 202);
  assert.equal((await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: outsiderCookie } })).status, 404);
  assert.equal((await inboxItems(outsiderCookie)).some((item) => item.id === editorInviteId), true);
  assert.equal((await respond(viewerCookie, editorInviteId, 'accept')).status, 404);
  assert.equal((await respond(outsiderCookie, editorInviteId, 'accept')).status, 200);
  assert.equal((await respond(outsiderCookie, editorInviteId, 'accept')).status, 409);
  const editorWorkspace = await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: outsiderCookie } });
  assert.equal(editorWorkspace.status, 200);
  assert.equal((await editorWorkspace.json()).role, 'editor');
  assert.equal((await invite(outsiderCookie, workspaceId, emails[2], 'viewer')).status, 403);
  assert.equal((await invite(ownerCookie, workspaceId, emails[1], 'editor')).status, 202);

  const viewerInvite = await invite(ownerCookie, workspaceId, emails[2], 'viewer');
  assert.equal(viewerInvite.status, 202);
  const viewerInviteId = (await inboxItems(viewerCookie)).find((item) => item.workspace.id === workspaceId)?.id;
  assert.ok(viewerInviteId);
  assert.equal((await respond(viewerCookie, viewerInviteId, 'decline')).status, 200);
  assert.equal((await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: viewerCookie } })).status, 404);
  const newViewerInvite = await invite(ownerCookie, workspaceId, emails[2], 'viewer');
  assert.equal(newViewerInvite.status, 202);
  const newViewerInviteId = (await inboxItems(viewerCookie)).find((item) => item.workspace.id === workspaceId)?.id;
  assert.ok(newViewerInviteId);
  assert.equal((await respond(viewerCookie, newViewerInviteId, 'accept')).status, 200);
  const viewerWorkspace = await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: viewerCookie } });
  assert.equal((await viewerWorkspace.json()).role, 'viewer');
  assert.equal((await invite(viewerCookie, workspaceId, emails[3], 'editor')).status, 403);

  const expiringInvite = await invite(ownerCookie, workspaceId, emails[3], 'viewer');
  assert.equal(expiringInvite.status, 202);
  const expiringInviteId = (await inboxItems(expiringCookie)).find((item) => item.workspace.id === workspaceId)?.id;
  assert.ok(expiringInviteId);
  await client.query(
    "UPDATE workspace_invitations SET expires_at = created_at + interval '1 microsecond' WHERE id = $1",
    [expiringInviteId],
  );
  assert.equal((await respond(expiringCookie, expiringInviteId, 'accept')).status, 409);
  const reinvited = await invite(ownerCookie, workspaceId, emails[3], 'viewer');
  assert.equal(reinvited.status, 202);
  const reinvitedId = (await inboxItems(expiringCookie)).find((item) => item.workspace.id === workspaceId)?.id;
  assert.ok(reinvitedId);
  assert.notEqual(reinvitedId, expiringInviteId);
  const oldStatus = await client.query('SELECT status FROM workspace_invitations WHERE id = $1', [expiringInviteId]);
  assert.equal(oldStatus.rows[0].status, 'expired');

  const membersPath = `/workspaces/${workspaceId}/members`;
  assert.equal((await fetch(`${base}${membersPath}`, { headers: { cookie: ownerCookie } })).status, 200);
  assert.equal((await fetch(`${base}${membersPath}`, { headers: { cookie: outsiderCookie } })).status, 200);
  const rolePath = `${membersPath}/${(await client.query('SELECT id FROM users WHERE email = $1', [emails[1]])).rows[0].id}`;
  const ownerRolePath = `${membersPath}/${(await client.query('SELECT id FROM users WHERE email = $1', [emails[0]])).rows[0].id}`;
  assert.equal((await fetch(`${base}${ownerRolePath}`, { method: 'PATCH', headers: { origin, cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }) })).status, 400);
  assert.equal((await fetch(`${base}${ownerRolePath}`, { method: 'DELETE', headers: { origin, cookie: ownerCookie } })).status, 400);
  assert.equal((await fetch(`${base}${rolePath}`, { method: 'PATCH', headers: { origin, cookie: outsiderCookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }) })).status, 403);
  assert.equal((await fetch(`${base}${rolePath}`, { method: 'PATCH', headers: { origin, cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'owner' }) })).status, 400);
  assert.equal((await fetch(`${base}${rolePath}`, { method: 'PATCH', headers: { origin, cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }) })).status, 200);
  assert.equal((await (await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: outsiderCookie } })).json()).role, 'viewer');
  assert.equal((await fetch(`${base}${rolePath}`, { method: 'PATCH', headers: { origin, cookie: ownerCookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'editor' }) })).status, 200);
  assert.equal((await fetch(`${base}${rolePath}`, { method: 'DELETE', headers: { origin, cookie: viewerCookie } })).status, 403);
  assert.equal((await fetch(`${base}${rolePath}`, { method: 'DELETE', headers: { origin, cookie: ownerCookie } })).status, 200);
  assert.equal((await fetch(`${base}${rolePath}`, { method: 'DELETE', headers: { origin, cookie: ownerCookie } })).status, 404);
  assert.equal((await fetch(`${base}/workspaces/${workspaceId}`, { headers: { cookie: outsiderCookie } })).status, 404);
  console.log('Workspace smoke test passed against collabcanvas_test');
} finally {
  if (connected) {
    if (workspaceId) await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
    await client.end();
  }
  server.kill();
}
