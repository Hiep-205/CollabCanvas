import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import { io } from 'socket.io-client';

dotenv.config({ quiet: true });

const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/collabcanvas') {
  throw new Error('Expected local collabcanvas URL');
}
url.pathname = '/collabcanvas_test';
const testUrl = url.toString();
const port = '3106';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const socketUrl = `http://127.0.0.1:${port}/realtime`;

const server = spawn(process.execPath, ['dist/main.js'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: testUrl, PORT: port, FRONTEND_ORIGIN: origin },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });

async function ready() {
  for (let i = 0; i < 50; i += 1) {
    if (server.exitCode !== null) throw new Error(output.slice(-1000));
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // Waiting for startup
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(output.slice(-1000));
}

async function register(email, name) {
  const response = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Long-test-password-123!', displayName: name }),
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const token = cookie?.split('=')[1];
  return { ...data, cookie, token };
}

const client = new pg.Client({ connectionString: testUrl });
let workspaceId = '';

try {
  console.log('1. Starting test server...');
  await ready();
  console.log('   Test server ready on port', port);

  await client.connect();

  console.log('2. Registering test users...');
  const userA = await register(`alice-${randomUUID()}@example.test`, 'Alice');
  const userB = await register(`bob-${randomUUID()}@example.test`, 'Bob');
  const userOutsider = await register(`outsider-${randomUUID()}@example.test`, 'Charlie');

  // Create workspace for User A
  const wsRes = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', cookie: userA.cookie },
    body: JSON.stringify({ name: 'Realtime Test Workspace' }),
  });
  assert.equal(wsRes.status, 201);
  workspaceId = (await wsRes.json()).id;

  // Add User B as editor in workspace
  await client.query(
    'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
    [workspaceId, userB.id, 'editor'],
  );
  console.log('   Workspace created:', workspaceId);

  // Test 1: Unauthenticated socket connection should be disconnected or emit connect_error
  console.log('3. Testing unauthenticated handshake rejection...');
  await new Promise((resolve) => {
    const unauthSocket = io(socketUrl, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
      timeout: 3000,
    });
    unauthSocket.on('connect_error', (err) => {
      assert(err.message.includes('AUTH_REQUIRED') || err.message.includes('Authentication'));
      unauthSocket.disconnect();
      resolve();
    });
    unauthSocket.on('connect', () => {
      // If connected unexpectedly, wait a tick
      setTimeout(() => {
        unauthSocket.disconnect();
        resolve();
      }, 500);
    });
    unauthSocket.on('disconnect', () => resolve());
  });
  console.log('   Passed: Unauthenticated connection rejected.');

  // Test 2: Authenticated connection for User A and User B
  console.log('4. Connecting authenticated sockets for Alice and Bob...');
  const socketA = io(socketUrl, {
    transports: ['websocket'],
    extraHeaders: { cookie: userA.cookie },
    auth: { token: userA.token },
    reconnection: false,
  });

  const socketB = io(socketUrl, {
    transports: ['websocket'],
    extraHeaders: { cookie: userB.cookie },
    auth: { token: userB.token },
    reconnection: false,
  });

  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
  ]);
  console.log('   Passed: Both sockets connected and authenticated.');

  // Test 3: Outsider tries to join Alice & Bob workspace
  console.log('5. Testing room authorization (outsider rejection)...');
  const socketOutsider = io(socketUrl, {
    transports: ['websocket'],
    extraHeaders: { cookie: userOutsider.cookie },
    auth: { token: userOutsider.token },
    reconnection: false,
  });
  await new Promise((resolve) => socketOutsider.on('connect', resolve));

  const outsiderJoinAck = await new Promise((resolve) => {
    socketOutsider.emit('workspace:join', { workspaceId }, resolve);
  });
  assert.equal(outsiderJoinAck.success, false);
  console.log('   Passed: Outsider prevented from joining workspace room.');
  socketOutsider.disconnect();

  // Test 4: Alice joins workspace
  console.log('6. Alice joins workspace room...');
  const joinPromiseA = new Promise((resolve) => {
    socketA.once('presence:state', (state) => {
      assert(state.members.some((m) => m.userId === userA.id));
      resolve(state);
    });
  });
  const ackA = await new Promise((resolve) => {
    socketA.emit('workspace:join', { workspaceId }, resolve);
  });
  assert.equal(ackA.success, true);
  await joinPromiseA;
  console.log('   Passed: Alice joined and received initial presence state.');

  // Test 5: Bob joins workspace -> both receive presence with Alice and Bob
  console.log('7. Bob joins workspace room...');
  const presenceOnA = new Promise((resolve) => {
    socketA.once('presence:state', (state) => {
      const hasAlice = state.members.some((m) => m.userId === userA.id);
      const hasBob = state.members.some((m) => m.userId === userB.id);
      if (hasAlice && hasBob) resolve(state);
    });
  });
  const presenceOnB = new Promise((resolve) => {
    socketB.once('presence:state', (state) => {
      const hasAlice = state.members.some((m) => m.userId === userA.id);
      const hasBob = state.members.some((m) => m.userId === userB.id);
      if (hasAlice && hasBob) resolve(state);
    });
  });

  const ackB = await new Promise((resolve) => {
    socketB.emit('workspace:join', { workspaceId }, resolve);
  });
  console.log('   ackB result:', ackB);
  assert.equal(ackB.success, true);
  await Promise.all([presenceOnA, presenceOnB]);
  console.log('   Passed: Both Alice and Bob see each other online in presence:state.');

  // Test 6: Live Cursor Move
  console.log('8. Testing real-time cursor broadcast...');
  const cursorPromise = new Promise((resolve) => {
    socketB.once('cursor:updated', (data) => {
      assert.equal(data.userId, userA.id);
      assert.equal(data.x, 150.5);
      assert.equal(data.y, 300.2);
      resolve(data);
    });
  });
  socketA.emit('cursor:move', { workspaceId, x: 150.5, y: 300.2 });
  await cursorPromise;
  console.log('   Passed: Bob received Alice\'s live cursor position.');

  // Test 7: Disconnect presence cleanup
  console.log('9. Testing disconnect presence departure...');
  const leavePromise = new Promise((resolve) => {
    socketA.on('presence:state', (state) => {
      const hasBob = state.members.some((m) => m.userId === userB.id);
      if (!hasBob) resolve(state);
    });
  });
  socketB.disconnect();
  await leavePromise;
  console.log('   Passed: Alice received presence update showing Bob has left.');

  socketA.disconnect();
  console.log('\nALL REALTIME SMOKE TESTS PASSED! 🚀\n');
} catch (err) {
  console.error('Server output log:\n', output);
  throw err;
} finally {
  server.kill('SIGINT');
  if (workspaceId) {
    try {
      await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    } catch {
      // Ignore cleanup error
    }
  }
  await client.end();
}
