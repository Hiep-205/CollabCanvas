import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });
const url = new URL(process.env.DATABASE_URL);
if ((url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') || url.pathname !== '/collabcanvas') {
  throw new Error('Expected local collabcanvas database');
}
url.pathname = '/collabcanvas_test';
const port = '3115';
const base = `http://127.0.0.1:${port}/api`;
const origin = 'http://localhost:5173';
const emails = [
  `comm-owner-${randomUUID()}@example.test`,
  `comm-editor-${randomUUID()}@example.test`,
  `comm-viewer-${randomUUID()}@example.test`,
  `comm-outsider-${randomUUID()}@example.test`,
];

const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: url.toString(), PORT: port, FRONTEND_ORIGIN: origin },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });

async function ready() {
  for (let i = 0; i < 80; i += 1) {
    if (server.exitCode !== null) throw new Error(`API exited: ${output.slice(-800)}`);
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* Starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not start: ${output.slice(-800)}`);
}

async function write(method, path, cookie, body) {
  return fetch(`${base}${path}`, {
    method,
    headers: { origin, cookie, 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function get(path, cookie) {
  return fetch(`${base}${path}`, {
    method: 'GET',
    headers: { origin, cookie },
  });
}

async function register(email, displayName) {
  const response = await write('POST', '/auth/register', '', {
    email,
    password: 'Long-test-password-123!',
    displayName,
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  return {
    id: data.id,
    displayName,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

const client = new pg.Client({ connectionString: url.toString() });
const workspaces = [];
let connected = false;

try {
  await ready();
  await client.connect();
  connected = true;

  const [owner, editor, viewer, outsider] = await Promise.all([
    register(emails[0], 'Owner User'),
    register(emails[1], 'Editor User'),
    register(emails[2], 'Viewer User'),
    register(emails[3], 'Outsider User'),
  ]);

  // 1. Create workspace
  const workspaceResponse = await write('POST', '/workspaces', owner.cookie, { name: 'Comments Test Workspace' });
  assert.equal(workspaceResponse.status, 201);
  const workspaceId = (await workspaceResponse.json()).id;
  workspaces.push(workspaceId);

  // Add editor and viewer to workspace
  await client.query('INSERT INTO workspace_members(workspace_id, user_id, role) VALUES($1, $2, $3)', [workspaceId, editor.id, 'editor']);
  await client.query('INSERT INTO workspace_members(workspace_id, user_id, role) VALUES($1, $2, $3)', [workspaceId, viewer.id, 'viewer']);

  // 2. Create task
  const taskResponse = await write('POST', `/workspaces/${workspaceId}/tasks`, owner.cookie, { title: 'Discussion Task' });
  assert.equal(taskResponse.status, 201);
  const task = await taskResponse.json();
  const taskId = task.id;

  const commentsBasePath = `/workspaces/${workspaceId}/tasks/${taskId}/comments`;

  // 3. Test RBAC permissions
  // Outsider cannot access
  assert.equal((await get(commentsBasePath, outsider.cookie)).status, 404);
  assert.equal((await write('POST', commentsBasePath, outsider.cookie, { content: 'Denied' })).status, 404);

  // Viewer cannot create comments (403)
  assert.equal((await write('POST', commentsBasePath, viewer.cookie, { content: 'Viewer comment' })).status, 403);

  // Validation: empty content (400), too long content (400)
  assert.equal((await write('POST', commentsBasePath, owner.cookie, { content: '   ' })).status, 400);
  assert.equal((await write('POST', commentsBasePath, owner.cookie, { content: 'a'.repeat(5001) })).status, 400);

  // 4. Create root comment with @mention
  const post1 = await write('POST', commentsBasePath, owner.cookie, {
    content: 'Hello @Editor User, please review this task!',
    mentionedUserIds: [editor.id],
  });
  assert.equal(post1.status, 201);
  const comment1 = await post1.json();
  assert.equal(comment1.content, 'Hello @Editor User, please review this task!');
  assert.equal(comment1.parentCommentId, null);
  assert.equal(comment1.author.id, owner.id);
  assert.deepEqual(comment1.mentionedUserIds, [editor.id]);

  // 5. Editor creates reply to comment1
  const postReply1 = await write('POST', commentsBasePath, editor.cookie, {
    content: 'On it! Starting review.',
    parentCommentId: comment1.id,
  });
  assert.equal(postReply1.status, 201);
  const reply1 = await postReply1.json();
  assert.equal(reply1.parentCommentId, comment1.id);
  assert.equal(reply1.author.id, editor.id);

  // 6. Test 2-tier flattening: replying to reply1 automatically attaches to root comment1
  const postReply2 = await write('POST', commentsBasePath, editor.cookie, {
    content: 'Sub-reply to reply1 should flatten to comment1',
    parentCommentId: reply1.id,
  });
  assert.equal(postReply2.status, 201);
  const reply2 = await postReply2.json();
  assert.equal(reply2.parentCommentId, comment1.id);

  // 7. Viewer reads comments
  const listRes = await get(commentsBasePath, viewer.cookie);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.totalCount, 3);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, comment1.id);
  assert.equal(list.items[0].replies.length, 2);
  assert.equal(list.items[0].replies[0].id, reply1.id);
  assert.equal(list.items[0].replies[1].id, reply2.id);

  // 8. Edit comment
  const commentUrl = `/workspaces/${workspaceId}/comments/${comment1.id}`;
  // Editor cannot edit owner's comment (403)
  assert.equal((await write('PATCH', commentUrl, editor.cookie, { content: 'Hacked' })).status, 403);
  // Owner updates own comment
  const updateRes = await write('PATCH', commentUrl, owner.cookie, { content: 'Hello @Editor User, updated instructions.' });
  assert.equal(updateRes.status, 200);
  assert.equal((await updateRes.json()).content, 'Hello @Editor User, updated instructions.');

  // 9. Delete comment (soft delete)
  const reply1Url = `/workspaces/${workspaceId}/comments/${reply1.id}`;
  // Viewer cannot delete reply1 (403)
  assert.equal((await write('DELETE', reply1Url, viewer.cookie)).status, 403);
  // Editor deletes own reply1
  assert.equal((await write('DELETE', reply1Url, editor.cookie)).status, 200);

  // Check tree after deleting reply1: reply1 is hidden, totalCount is 2
  const listAfterDeleteReply = await (await get(commentsBasePath, viewer.cookie)).json();
  assert.equal(listAfterDeleteReply.totalCount, 2);
  assert.equal(listAfterDeleteReply.items[0].replies.length, 1);
  assert.equal(listAfterDeleteReply.items[0].replies[0].id, reply2.id);

  // Owner deletes root comment1
  assert.equal((await write('DELETE', commentUrl, owner.cookie)).status, 200);

  // Root comment1 is soft-deleted but has active reply2 -> placeholder shown
  const listAfterDeleteRoot = await (await get(commentsBasePath, viewer.cookie)).json();
  assert.equal(listAfterDeleteRoot.totalCount, 1);
  assert.equal(listAfterDeleteRoot.items.length, 1);
  assert.equal(listAfterDeleteRoot.items[0].isDeleted, true);
  assert.equal(listAfterDeleteRoot.items[0].content, '[Bình luận đã bị xóa]');
  assert.equal(listAfterDeleteRoot.items[0].replies.length, 1);
  assert.equal(listAfterDeleteRoot.items[0].replies[0].id, reply2.id);

  // 10. Mentions API
  const mentionsRes = await get('/me/mentions?status=unread', editor.cookie);
  assert.equal(mentionsRes.status, 200);
  const mentionsList = await mentionsRes.json();
  assert.equal(mentionsList.items.length, 1);
  assert.equal(mentionsList.items[0].commentId, comment1.id);
  assert.equal(mentionsList.items[0].isRead, false);

  // Mark mention as read
  const markReadRes = await write('PATCH', `/me/mentions/${comment1.id}/read`, editor.cookie);
  assert.equal(markReadRes.status, 200);

  // Verify no unread mentions
  const unreadAfter = await (await get('/me/mentions?status=unread', editor.cookie)).json();
  assert.equal(unreadAfter.items.length, 0);

  // Test markAllRead
  await write('POST', commentsBasePath, owner.cookie, {
    content: 'Another mention @Editor User',
    mentionedUserIds: [editor.id],
  });
  const beforeMarkAll = await (await get('/me/mentions?status=unread', editor.cookie)).json();
  assert.equal(beforeMarkAll.items.length, 1);
  const markAllRes = await write('PATCH', '/me/mentions/read-all', editor.cookie);
  assert.equal(markAllRes.status, 200);
  const afterMarkAll = await (await get('/me/mentions?status=unread', editor.cookie)).json();
  assert.equal(afterMarkAll.items.length, 0);

  assert.equal((await write('DELETE', `/workspaces/${workspaceId}/leave`, editor.cookie)).status, 200);
  assert.equal((await (await get('/me/mentions?status=all', editor.cookie)).json()).items.length, 0);
  assert.equal((await write('PATCH', `/me/mentions/${comment1.id}/read`, editor.cookie)).status, 404);

  console.log('Task comments & mentions smoke test passed against collabcanvas_test!');
} finally {
  if (connected) {
    for (const id of workspaces) await client.query('DELETE FROM workspaces WHERE id = $1', [id]);
    await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
    await client.end();
  }
  server.kill();
}
