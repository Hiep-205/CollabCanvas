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
const port = process.env.TEST_PORT ?? '3107';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const socketUrl = `http://127.0.0.1:${port}/realtime`;

console.log(`[INIT] Starting E2E Realtime Invalidation test suite on port ${port}...`);

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
    if (server.exitCode !== null) throw new Error(`Server exited unexpectedly:\n${output.slice(-1500)}`);
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // Waiting for startup
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server startup timed out:\n${output.slice(-1500)}`);
}

const client = new pg.Client({ connectionString: testUrl });
const workspaceIds = [];
const createdEmails = [];
let clientConnected = false;

async function register(email, displayName) {
  const response = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Long-test-password-123!', displayName }),
  });
  assert.equal(response.status, 201, `Failed to register ${email}: ${await response.clone().text()}`);
  const data = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const token = cookie?.split('=')[1];
  createdEmails.push(email);
  return { ...data, email, displayName, cookie, token };
}

async function request(method, path, cookie, body) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.origin = origin;
    headers['content-type'] = 'application/json';
  }
  const options = { method, headers };
  if (body !== undefined) options.body = JSON.stringify(body);
  return fetch(`${base}${path}`, options);
}

async function jsonRequest(method, path, cookie, body, expectedStatus = 200) {
  const res = await request(method, path, cookie, body);
  const text = await res.clone().text();
  assert.equal(res.status, expectedStatus, `Expected ${expectedStatus} for ${method} ${path}, got ${res.status}: ${text}`);
  return res.json();
}

const activeSockets = new Set();

function connectSocket(user) {
  const socket = io(socketUrl, {
    transports: ['websocket'],
    extraHeaders: { cookie: user.cookie },
    auth: { token: user.token },
    reconnection: false,
    timeout: 3000,
  });
  activeSockets.add(socket);
  socket.on('disconnect', () => {
    activeSockets.delete(socket);
  });
  return socket;
}

function waitForEvent(socket, eventName, timeoutMs = 5000, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, listener);
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for '${eventName}' on socket ${socket.id}`));
    }, timeoutMs);

    function listener(data) {
      try {
        if (predicate(data)) {
          clearTimeout(timer);
          socket.off(eventName, listener);
          resolve(data);
        }
      } catch (err) {
        clearTimeout(timer);
        socket.off(eventName, listener);
        reject(err);
      }
    }
    socket.on(eventName, listener);
  });
}

function assertNoEvent(socket, eventName, windowMs = 600, predicate = () => true) {
  return new Promise((resolve, reject) => {
    function listener(data) {
      if (predicate(data)) {
        clearTimeout(timer);
        socket.off(eventName, listener);
        reject(new Error(`Forbidden event '${eventName}' received on socket ${socket.id}: ${JSON.stringify(data)}`));
      }
    }
    const timer = setTimeout(() => {
      socket.off(eventName, listener);
      resolve();
    }, windowMs);
    socket.on(eventName, listener);
  });
}

function listenForForbiddenEvents(socket, eventNames, predicate = () => true) {
  const received = [];
  const listeners = [];
  for (const name of eventNames) {
    const listener = (data) => {
      if (predicate(data, name)) {
        received.push({ eventName: name, data });
      }
    };
    socket.on(name, listener);
    listeners.push({ name, listener });
  }
  return {
    assertClean() {
      for (const { name, listener } of listeners) {
        socket.off(name, listener);
      }
      assert.equal(received.length, 0, `Forbidden events received on socket ${socket.id}: ${JSON.stringify(received)}`);
    },
  };
}

try {
  // -------------------------------------------------------------------------
  // 0. Server Startup and Database Initialization
  // -------------------------------------------------------------------------
  console.log('[SETUP] Waiting for test server to be ready...');
  await ready();
  console.log(`[SETUP] Test server ready on port ${port}.`);

  await client.connect();
  clientConnected = true;

  // =========================================================================
  // TIER 1: CORE FEATURE COVERAGE
  // =========================================================================
  console.log('\n=== TIER 1: Core Feature Coverage ===');

  // Test 1.1: Handshake Auth Rejection
  console.log('Test 1.1: Handshake authentication rejection without token...');
  await new Promise((resolve, reject) => {
    const unauthSocket = io(socketUrl, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
      timeout: 3000,
    });
    activeSockets.add(unauthSocket);
    unauthSocket.on('disconnect', () => {
      activeSockets.delete(unauthSocket);
    });
    unauthSocket.on('connect_error', (err) => {
      try {
        assert(
          err.message.includes('AUTH_REQUIRED') || err.message.includes('Authentication'),
          `Unexpected error message: ${err.message}`,
        );
        unauthSocket.disconnect();
        resolve();
      } catch (e) {
        unauthSocket.disconnect();
        reject(e);
      }
    });
    unauthSocket.on('connect', () => {
      unauthSocket.disconnect();
      reject(new Error('Unauthenticated connection should not have connected'));
    });
  });
  console.log('   ✓ Test 1.1 Passed: Unauthenticated connection rejected.');

  // Test 1.2: Authenticated Connection & User Setup
  console.log('Test 1.2: Registering users and connecting authenticated sockets...');
  const alice = await register(`alice-${randomUUID()}@example.test`, 'Alice');
  const bob = await register(`bob-${randomUUID()}@example.test`, 'Bob');
  const charlie = await register(`charlie-${randomUUID()}@example.test`, 'Charlie');

  // Create Workspace A (Alice is Owner)
  const wsAData = await jsonRequest('POST', '/workspaces', alice.cookie, { name: 'Workspace Alpha' }, 201);
  const wsA = wsAData.id;
  workspaceIds.push(wsA);

  // Add Bob as 'editor' and Charlie as 'viewer' (strictly conforming to check constraint)
  await client.query(
    'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
    [wsA, bob.id, 'editor'],
  );
  await client.query(
    'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
    [wsA, charlie.id, 'viewer'],
  );

  let socketA = connectSocket(alice);
  let socketB = connectSocket(bob);

  await Promise.all([
    new Promise((resolve) => socketA.on('connect', resolve)),
    new Promise((resolve) => socketB.on('connect', resolve)),
  ]);
  assert(socketA.connected && socketB.connected, 'Sockets must be connected');
  console.log('   ✓ Test 1.2 Passed: Authenticated sockets connected.');

  // Test 1.3: Workspace Room Join & Presence State Broadcast
  console.log('Test 1.3: Workspace join and presence:state sync...');
  const alicePresencePromise = waitForEvent(socketA, 'presence:state', 4000, (state) => {
    return Array.isArray(state.members) && state.members.some((m) => m.userId === alice.id && m.isOnline);
  });
  const ackA = await new Promise((resolve) => socketA.emit('workspace:join', { workspaceId: wsA }, resolve));
  assert.equal(ackA.success, true, 'Alice workspace:join failed');
  const aliceState = await alicePresencePromise;
  assert(aliceState.members.some((m) => m.userId === alice.id && m.role === 'owner'));

  // Bob joins -> both Alice and Bob receive presence:state with Alice and Bob
  const bothPresencePromiseA = waitForEvent(socketA, 'presence:state', 4000, (state) => {
    return state.members.some((m) => m.userId === alice.id && m.isOnline) &&
           state.members.some((m) => m.userId === bob.id && m.isOnline);
  });
  const bothPresencePromiseB = waitForEvent(socketB, 'presence:state', 4000, (state) => {
    return state.members.some((m) => m.userId === alice.id && m.isOnline) &&
           state.members.some((m) => m.userId === bob.id && m.isOnline);
  });
  const ackB = await new Promise((resolve) => socketB.emit('workspace:join', { workspaceId: wsA }, resolve));
  assert.equal(ackB.success, true, 'Bob workspace:join failed');
  const [stateOnA, stateOnB] = await Promise.all([bothPresencePromiseA, bothPresencePromiseB]);
  assert.equal(stateOnA.members.find((m) => m.userId === bob.id)?.role, 'editor');
  assert.equal(stateOnB.members.find((m) => m.userId === bob.id)?.role, 'editor');
  console.log('   ✓ Test 1.3 Passed: Workspace join and presence:state verified.');

  // Test 1.4: Live Cursor Movement Broadcasting
  console.log('Test 1.4: Live cursor movement broadcasting and sender exclusion...');
  const cursorPromiseB = waitForEvent(socketB, 'cursor:updated', 4000, (data) => {
    return data.userId === alice.id && data.x === 220.5 && data.y === 440.0;
  });
  const noCursorOnA = assertNoEvent(socketA, 'cursor:updated', 400);
  socketA.emit('cursor:move', { workspaceId: wsA, x: 220.5, y: 440.0 });
  const cursorData = await cursorPromiseB;
  assert.equal(cursorData.displayName, 'Alice');
  await noCursorOnA;
  console.log('   ✓ Test 1.4 Passed: Cursor broadcast received by Bob, excluded on Alice.');

  // Test 1.5: REST Task Creation Mutation Broadcast
  console.log('Test 1.5: REST task creation mutation broadcast (task:mutated created)...');
  const taskCreatedPromise = waitForEvent(socketB, 'task:mutated', 5000, (event) => {
    return event.workspaceId === wsA && event.action === 'created' && event.updatedByUserId === alice.id;
  });
  const task1 = await jsonRequest('POST', `/workspaces/${wsA}/tasks`, alice.cookie, {
    title: 'Task Alpha',
    description: 'Initial description',
    status: 'todo',
    priority: 'high',
  }, 201);
  const createdEvent = await taskCreatedPromise;
  assert.equal(createdEvent.taskId, task1.id);
  console.log('   ✓ Test 1.5 Passed: task:mutated (action: created) received.');

  // Test 1.6: REST Task Update & Status Change Broadcast
  console.log('Test 1.6: REST task status change and field update broadcasts...');
  // Step A: Status change
  const statusChangePromise = waitForEvent(socketA, 'task:mutated', 5000, (event) => {
    return event.taskId === task1.id && event.action === 'status_changed' && event.updatedByUserId === bob.id;
  });
  const updatedTaskStatus = await jsonRequest('PATCH', `/workspaces/${wsA}/tasks/${task1.id}`, bob.cookie, {
    version: task1.version,
    status: 'in_progress',
  }, 200);
  await statusChangePromise;

  // Step B: Field update (title)
  const titleUpdatePromise = waitForEvent(socketB, 'task:mutated', 5000, (event) => {
    return event.taskId === task1.id && event.action === 'updated' && event.updatedByUserId === alice.id;
  });
  const updatedTaskTitle = await jsonRequest('PATCH', `/workspaces/${wsA}/tasks/${task1.id}`, alice.cookie, {
    version: updatedTaskStatus.version,
    title: 'Task Alpha Renamed',
  }, 200);
  await titleUpdatePromise;
  console.log('   ✓ Test 1.6 Passed: task:mutated (status_changed and updated) received.');

  // Test 1.7: REST Canvas Save Bump Broadcast
  console.log('Test 1.7: REST canvas save bump broadcast (canvas:bumped)...');
  const canvasBumpedPromise = waitForEvent(socketB, 'canvas:bumped', 5000, (event) => {
    return event.workspaceId === wsA && event.updatedByUserId === alice.id;
  });
  const taskNodeId = randomUUID();
  const noteNodeId = randomUUID();
  const canvasSaveRes = await jsonRequest('PUT', `/workspaces/${wsA}/canvas`, alice.cookie, {
    version: '1',
    nodes: [
      { id: taskNodeId, type: 'task', taskId: task1.id, text: null, color: null, x: 100, y: 150, hidden: false },
      { id: noteNodeId, type: 'note', taskId: null, text: 'Design ideas', color: 'pink', x: 300, y: 150, hidden: false },
    ],
    edges: [
      { source: noteNodeId, target: taskNodeId, kind: 'association' },
    ],
  }, 200);
  const canvasBumpedEvent = await canvasBumpedPromise;
  assert.equal(canvasBumpedEvent.canvasVersion, canvasSaveRes.version);
  console.log('   ✓ Test 1.7 Passed: canvas:bumped broadcast received with version', canvasBumpedEvent.canvasVersion);

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================
  console.log('\n=== TIER 2: Boundary & Corner Cases ===');

  // Test 2.1: Multi-Tab Presence Aggregation and Disconnect Departure Handling
  console.log('Test 2.1: Multi-tab presence deduplication and disconnect handling...');
  const socketBTab2 = connectSocket(bob);
  await new Promise((resolve) => socketBTab2.on('connect', resolve));

  const multiTabPresencePromise = waitForEvent(socketA, 'presence:state', 4000, (state) => {
    const bobEntries = state.members.filter((m) => m.userId === bob.id);
    return bobEntries.length === 1 && bobEntries[0].isOnline;
  });
  const ackBTab2 = await new Promise((resolve) => socketBTab2.emit('workspace:join', { workspaceId: wsA }, resolve));
  assert.equal(ackBTab2.success, true);
  await multiTabPresencePromise;

  // Disconnect Tab 1 of Bob -> Bob must NOT depart (Tab 2 still open)
  const tab1DepartureGuard = listenForForbiddenEvents(socketA, ['presence:state'], (state) => {
    const bobMember = state.members?.find((m) => m.userId === bob.id);
    return !bobMember || !bobMember.isOnline;
  });
  socketB.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert(socketBTab2.connected, 'Bob Tab 2 remains connected');
  tab1DepartureGuard.assertClean();

  // Disconnect Tab 2 of Bob -> Bob departure MUST be broadcast to Alice
  const bobDepartedPromise = waitForEvent(socketA, 'presence:state', 4000, (state) => {
    const bobMember = state.members.find((m) => m.userId === bob.id);
    return !bobMember || !bobMember.isOnline;
  });
  socketBTab2.disconnect();
  await bobDepartedPromise;
  console.log('   ✓ Test 2.1 Passed: Multi-tab deduplication and departure handled correctly.');

  // Reconnect Bob for subsequent tests: register presence listener BEFORE emitting workspace:join
  socketB = connectSocket(bob);
  await new Promise((resolve) => socketB.on('connect', resolve));
  const bobOnlinePromise = waitForEvent(socketA, 'presence:state', 4000, (state) => {
    return state.members.some((m) => m.userId === bob.id && m.isOnline);
  });
  const reconnectedAck = await new Promise((resolve) => socketB.emit('workspace:join', { workspaceId: wsA }, resolve));
  assert.equal(reconnectedAck.success, true);
  await bobOnlinePromise;

  // Test 2.2: Viewer Role Cursor Broadcast Suppression (RBAC)
  console.log('Test 2.2: Viewer role cursor broadcast suppression...');
  const socketC = connectSocket(charlie);
  await new Promise((resolve) => socketC.on('connect', resolve));
  const ackC = await new Promise((resolve) => socketC.emit('workspace:join', { workspaceId: wsA }, resolve));
  assert.equal(ackC.success, true);

  const viewerGuardA = listenForForbiddenEvents(socketA, ['cursor:updated']);
  const viewerGuardB = listenForForbiddenEvents(socketB, ['cursor:updated']);
  socketC.emit('cursor:move', { workspaceId: wsA, x: 999.0, y: 888.0 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  viewerGuardA.assertClean();
  viewerGuardB.assertClean();
  console.log('   ✓ Test 2.2 Passed: Viewer cursor movement strictly suppressed.');

  // Test 2.3: Soft-Delete (Trash) Dual Mutation Broadcasting
  console.log('Test 2.3: Soft-delete task dual invalidation broadcast (task:mutated trashed + canvas:bumped)...');
  const trashTaskMutatedPromise = waitForEvent(socketB, 'task:mutated', 5000, (event) => {
    return event.taskId === task1.id && event.action === 'trashed' && event.updatedByUserId === alice.id;
  });
  const trashCanvasBumpedPromise = waitForEvent(socketB, 'canvas:bumped', 5000, (event) => {
    return event.workspaceId === wsA && event.updatedByUserId === alice.id;
  });

  const trashedTaskRes = await jsonRequest(
    'PATCH',
    `/workspaces/${wsA}/trash/tasks/${task1.id}`,
    alice.cookie,
    { version: updatedTaskTitle.version, deleted: true },
    200,
  );
  const [trashedEvent, bumpedFromTrash] = await Promise.all([trashTaskMutatedPromise, trashCanvasBumpedPromise]);
  assert.equal(bumpedFromTrash.canvasVersion, trashedTaskRes.canvasVersion);
  console.log('   ✓ Test 2.3 Passed: Soft-delete dual emission verified.');

  // Test 2.4: Restore Task Dual Mutation Broadcasting
  console.log('Test 2.4: Restore task dual invalidation broadcast (task:mutated restored + canvas:bumped)...');
  const restoreTaskMutatedPromise = waitForEvent(socketB, 'task:mutated', 5000, (event) => {
    return event.taskId === task1.id && event.action === 'restored' && event.updatedByUserId === alice.id;
  });
  const restoreCanvasBumpedPromise = waitForEvent(socketB, 'canvas:bumped', 5000, (event) => {
    return event.workspaceId === wsA && event.updatedByUserId === alice.id;
  });

  const restoredTaskRes = await jsonRequest(
    'PATCH',
    `/workspaces/${wsA}/trash/tasks/${task1.id}`,
    alice.cookie,
    { version: trashedTaskRes.version, deleted: false },
    200,
  );
  const [restoredEvent, bumpedFromRestore] = await Promise.all([restoreTaskMutatedPromise, restoreCanvasBumpedPromise]);
  assert.equal(bumpedFromRestore.canvasVersion, restoredTaskRes.canvasVersion);
  console.log('   ✓ Test 2.4 Passed: Restore task dual emission verified.');

  // Test 2.5: Note Soft-Delete & Restore Invalidation Broadcasting
  console.log('Test 2.5: Note soft-delete & restore canvas:bumped broadcast...');
  const trashNoteBumpedPromise = waitForEvent(socketB, 'canvas:bumped', 5000, (e) => e.workspaceId === wsA);
  const trashNoteRes = await jsonRequest(
    'PATCH',
    `/workspaces/${wsA}/trash/notes/${noteNodeId}`,
    alice.cookie,
    { version: restoredTaskRes.canvasVersion, deleted: true },
    200,
  );
  const noteBumpedEvent = await trashNoteBumpedPromise;
  assert.equal(noteBumpedEvent.canvasVersion, trashNoteRes.canvasVersion);

  const restoreNoteBumpedPromise = waitForEvent(socketB, 'canvas:bumped', 5000, (e) => e.workspaceId === wsA);
  const restoreNoteRes = await jsonRequest(
    'PATCH',
    `/workspaces/${wsA}/trash/notes/${noteNodeId}`,
    alice.cookie,
    { version: trashNoteRes.canvasVersion, deleted: false },
    200,
  );
  const noteRestoredEvent = await restoreNoteBumpedPromise;
  assert.equal(noteRestoredEvent.canvasVersion, restoreNoteRes.canvasVersion);
  console.log('   ✓ Test 2.5 Passed: Note soft-delete & restore triggered canvas:bumped.');

  // Test 2.6: OCC Stale Version Conflict Rejection
  console.log('Test 2.6: OCC stale version conflict rejection and zero broadcast...');
  // A: Task OCC conflict verification
  const occTaskGuard = listenForForbiddenEvents(socketA, ['task:mutated']);
  const conflictTaskRes = await request(
    'PATCH',
    `/workspaces/${wsA}/tasks/${task1.id}`,
    bob.cookie,
    { version: '1', title: 'Stale Version Update' }, // version '1' is stale
  );
  assert.equal(conflictTaskRes.status, 409, 'Expected 409 Conflict for stale Task OCC version');
  await new Promise((resolve) => setTimeout(resolve, 500));
  occTaskGuard.assertClean();

  // B: Canvas OCC conflict verification
  const occCanvasGuard = listenForForbiddenEvents(socketA, ['canvas:bumped']);
  const conflictCanvasRes = await request(
    'PUT',
    `/workspaces/${wsA}/canvas`,
    alice.cookie,
    {
      version: '1', // version '1' is stale
      nodes: [
        { id: taskNodeId, type: 'task', taskId: task1.id, text: null, color: null, x: 100, y: 150, hidden: false },
        { id: noteNodeId, type: 'note', taskId: null, text: 'Design ideas', color: 'pink', x: 300, y: 150, hidden: false },
      ],
      edges: [
        { source: noteNodeId, target: taskNodeId, kind: 'association' },
      ],
    },
  );
  assert.equal(conflictCanvasRes.status, 409, 'Expected 409 Conflict for stale Canvas OCC version');
  await new Promise((resolve) => setTimeout(resolve, 500));
  occCanvasGuard.assertClean();
  console.log('   ✓ Test 2.6 Passed: OCC conflict rejected with 409 and no invalidation broadcast (Task & Canvas).');

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================
  console.log('\n=== TIER 3: Cross-Feature Combinations ===');

  // Test 3.1: Cross-Workspace Room Isolation
  console.log('Test 3.1: Cross-workspace room isolation and zero event crosstalk...');
  const david = await register(`david-${randomUUID()}@example.test`, 'David');
  const wsBData = await jsonRequest('POST', '/workspaces', david.cookie, { name: 'Workspace Beta' }, 201);
  const wsB = wsBData.id;
  workspaceIds.push(wsB);

  const socketD = connectSocket(david);
  await new Promise((resolve) => socketD.on('connect', resolve));
  const ackD = await new Promise((resolve) => socketD.emit('workspace:join', { workspaceId: wsB }, resolve));
  assert.equal(ackD.success, true);

  // Negative join attempt: David tries to join Workspace A
  const davidJoinWsAAck = await new Promise((resolve) => socketD.emit('workspace:join', { workspaceId: wsA }, resolve));
  assert.equal(davidJoinWsAAck.success, false, 'Outsider should not join Workspace A');

  // Set up isolation guard on David (must receive zero events originating from Workspace A)
  const davidGuard = listenForForbiddenEvents(socketD, ['task:mutated', 'canvas:bumped', 'cursor:updated']);

  // Bob in wsA must receive the events from Alice
  const taskOnB = waitForEvent(socketB, 'task:mutated', 5000, (d) => d.workspaceId === wsA);
  const canvasOnB = waitForEvent(socketB, 'canvas:bumped', 5000, (d) => d.workspaceId === wsA);
  const cursorOnB = waitForEvent(socketB, 'cursor:updated', 5000, (d) => d.userId === alice.id);

  // Trigger actions in Workspace A
  const wsATask2 = await jsonRequest('POST', `/workspaces/${wsA}/tasks`, alice.cookie, {
    title: 'Isolated Task wsA',
    status: 'todo',
    priority: 'low',
  }, 201);
  const wsACanvas = await jsonRequest('PUT', `/workspaces/${wsA}/canvas`, alice.cookie, {
    version: restoreNoteRes.canvasVersion,
    nodes: [
      { id: taskNodeId, type: 'task', taskId: task1.id, text: null, color: null, x: 120, y: 160, hidden: false },
      { id: noteNodeId, type: 'note', taskId: null, text: 'Design ideas', color: 'pink', x: 300, y: 150, hidden: false },
    ],
    edges: [],
  }, 200);
  socketA.emit('cursor:move', { workspaceId: wsA, x: 50.0, y: 75.0 });

  await Promise.all([taskOnB, canvasOnB, cursorOnB]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  davidGuard.assertClean();
  console.log('   ✓ Test 3.1 Passed: Complete cross-workspace room isolation verified.');

  // Test 3.2: Concurrent Cursor Moves Interleaved with REST Mutations
  console.log('Test 3.2: Concurrent cursor moves interleaved with REST mutations...');
  let receivedCursors = 0;
  const cursorCounter = (data) => {
    if (data.userId === alice.id) receivedCursors += 1;
  };
  socketB.on('cursor:updated', cursorCounter);

  const burstTaskPromise = waitForEvent(socketB, 'task:mutated', 8000, (d) => d.action === 'created');
  const burstCanvasPromise = waitForEvent(socketB, 'canvas:bumped', 8000);

  // Send continuous cursor moves concurrently while executing REST calls
  let cursorInterval = null;
  try {
    cursorInterval = setInterval(() => {
      socketA.emit('cursor:move', { workspaceId: wsA, x: Math.random() * 500, y: Math.random() * 500 });
    }, 40);

    await Promise.all([
      jsonRequest('POST', `/workspaces/${wsA}/tasks`, alice.cookie, {
        title: 'Concurrent Load Task',
        status: 'todo',
        priority: 'high',
      }, 201),
      new Promise((resolve) => setTimeout(resolve, 150)).then(() =>
        jsonRequest('PUT', `/workspaces/${wsA}/canvas`, alice.cookie, {
          version: wsACanvas.version,
          nodes: [
            { id: taskNodeId, type: 'task', taskId: task1.id, text: null, color: null, x: 150, y: 200, hidden: false },
            { id: noteNodeId, type: 'note', taskId: null, text: 'Design ideas', color: 'pink', x: 300, y: 150, hidden: false },
          ],
          edges: [],
        }, 200),
      ),
      burstTaskPromise,
      burstCanvasPromise,
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
  } finally {
    if (cursorInterval) {
      clearInterval(cursorInterval);
    }
    socketB.off('cursor:updated', cursorCounter);
  }

  assert(receivedCursors >= 5, `Expected multiple cursor updates during concurrent burst, got ${receivedCursors}`);
  console.log(`   ✓ Test 3.2 Passed: Concurrent burst handled (${receivedCursors} cursors, REST task & canvas mutations).`);

  // =========================================================================
  // TIER 4: REAL-WORLD MULTI-USER COLLABORATION WORKFLOW
  // =========================================================================
  console.log('\n=== TIER 4: Real-World Multi-User Collaboration Workflow ===');

  console.log('Test 4.1: Multi-role sprint collaboration session across Owner, Editor, Viewer...');
  // 1. Verify all 3 roles active in Workspace A
  socketA.emit('presence:heartbeat', { workspaceId: wsA });
  socketB.emit('presence:heartbeat', { workspaceId: wsA });
  socketC.emit('presence:heartbeat', { workspaceId: wsA });

  // 2. Alice (Owner) creates a feature task
  const taskCollabPromiseB = waitForEvent(socketB, 'task:mutated', 5000, (d) => d.action === 'created');
  const taskCollabPromiseC = waitForEvent(socketC, 'task:mutated', 5000, (d) => d.action === 'created');
  const collabTask = await jsonRequest('POST', `/workspaces/${wsA}/tasks`, alice.cookie, {
    title: 'Sprint 2 Release Planning',
    description: 'Coordinate all feature deliverables',
    status: 'todo',
    priority: 'high',
  }, 201);
  const [eventCollabB, eventCollabC] = await Promise.all([taskCollabPromiseB, taskCollabPromiseC]);
  assert.equal(eventCollabB.taskId, collabTask.id);
  assert.equal(eventCollabC.taskId, collabTask.id);

  // 3. Bob (Editor) transitions task to in_progress
  const statusCollabPromiseA = waitForEvent(socketA, 'task:mutated', 5000, (d) => d.action === 'status_changed');
  const statusCollabPromiseC = waitForEvent(socketC, 'task:mutated', 5000, (d) => d.action === 'status_changed');
  const collabInProgress = await jsonRequest('PATCH', `/workspaces/${wsA}/tasks/${collabTask.id}`, bob.cookie, {
    version: collabTask.version,
    status: 'in_progress',
  }, 200);
  await Promise.all([statusCollabPromiseA, statusCollabPromiseC]);

  // 4. Bob (Editor) adds checklist item
  const checklistCollabPromiseA = waitForEvent(socketA, 'task:mutated', 5000, (d) => d.action === 'updated');
  const checklistCollabPromiseC = waitForEvent(socketC, 'task:mutated', 5000, (d) => d.action === 'updated');
  const collabChecklist = await jsonRequest('POST', `/workspaces/${wsA}/tasks/${collabTask.id}/checklist`, bob.cookie, {
    version: collabInProgress.version,
    title: 'Verify mutation broadcasts',
  }, 201);
  await Promise.all([checklistCollabPromiseA, checklistCollabPromiseC]);

  // 5. Alice (Owner) adds task to canvas and updates canvas
  const canvasCollabPromiseB = waitForEvent(socketB, 'canvas:bumped', 5000);
  const canvasCollabPromiseC = waitForEvent(socketC, 'canvas:bumped', 5000);
  const currentCanvas = await jsonRequest('GET', `/workspaces/${wsA}/canvas`, alice.cookie);
  const collabNodeId = randomUUID();
  const collabCanvasRes = await jsonRequest('PUT', `/workspaces/${wsA}/canvas`, alice.cookie, {
    version: currentCanvas.version,
    nodes: [
      { id: taskNodeId, type: 'task', taskId: task1.id, text: null, color: null, x: 100, y: 100, hidden: false },
      { id: noteNodeId, type: 'note', taskId: null, text: 'Design ideas', color: 'pink', x: 300, y: 150, hidden: false },
      { id: collabNodeId, type: 'task', taskId: collabTask.id, text: null, color: null, x: 300, y: 100, hidden: false },
    ],
    edges: [],
  }, 200);
  await Promise.all([canvasCollabPromiseB, canvasCollabPromiseC]);

  // 6. Bob (Editor) soft-deletes task -> Alice and Charlie receive dual broadcast
  const trashCollabTaskPromiseA = waitForEvent(socketA, 'task:mutated', 5000, (d) => d.action === 'trashed');
  const trashCollabCanvasPromiseA = waitForEvent(socketA, 'canvas:bumped', 5000);
  const trashCollabTaskPromiseC = waitForEvent(socketC, 'task:mutated', 5000, (d) => d.action === 'trashed');
  const trashCollabCanvasPromiseC = waitForEvent(socketC, 'canvas:bumped', 5000);

  const trashedCollabRes = await jsonRequest(
    'PATCH',
    `/workspaces/${wsA}/trash/tasks/${collabTask.id}`,
    bob.cookie,
    { version: collabChecklist.version, deleted: true },
    200,
  );
  await Promise.all([
    trashCollabTaskPromiseA,
    trashCollabCanvasPromiseA,
    trashCollabTaskPromiseC,
    trashCollabCanvasPromiseC,
  ]);

  // 7. Alice (Owner) restores task -> Bob and Charlie receive dual broadcast
  const restoreCollabTaskPromiseB = waitForEvent(socketB, 'task:mutated', 5000, (d) => d.action === 'restored');
  const restoreCollabCanvasPromiseB = waitForEvent(socketB, 'canvas:bumped', 5000);
  const restoreCollabTaskPromiseC = waitForEvent(socketC, 'task:mutated', 5000, (d) => d.action === 'restored');
  const restoreCollabCanvasPromiseC = waitForEvent(socketC, 'canvas:bumped', 5000);

  await jsonRequest(
    'PATCH',
    `/workspaces/${wsA}/trash/tasks/${collabTask.id}`,
    alice.cookie,
    { version: trashedCollabRes.version, deleted: false },
    200,
  );
  await Promise.all([
    restoreCollabTaskPromiseB,
    restoreCollabCanvasPromiseB,
    restoreCollabTaskPromiseC,
    restoreCollabCanvasPromiseC,
  ]);

  // 8. Bidirectional cursor movement between Alice and Bob; suppressed for Charlie
  const cursorOnBobPromise = waitForEvent(socketB, 'cursor:updated', 4000, (d) => d.userId === alice.id);
  const cursorOnAlicePromise = waitForEvent(socketA, 'cursor:updated', 4000, (d) => d.userId === bob.id);
  const charlieViewerGuard = listenForForbiddenEvents(socketA, ['cursor:updated'], (d) => d.userId === charlie.id);

  socketA.emit('cursor:move', { workspaceId: wsA, x: 350.0, y: 550.0 });
  socketB.emit('cursor:move', { workspaceId: wsA, x: 450.0, y: 650.0 });
  socketC.emit('cursor:move', { workspaceId: wsA, x: 999.0, y: 999.0 });

  await Promise.all([cursorOnBobPromise, cursorOnAlicePromise]);
  await new Promise((resolve) => setTimeout(resolve, 400));
  charlieViewerGuard.assertClean();
  console.log('   ✓ Test 4.1 Passed: Multi-role sprint collaboration workflow completed successfully.');

  console.log('Test 4.2: Forged cursor, role downgrade and revocation across active sockets...');
  const forgedCursorGuard = listenForForbiddenEvents(socketA, ['cursor:updated'], (event) => event.userId === david.id);
  socketD.emit('cursor:move', { workspaceId: wsA, x: 5, y: 5 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  forgedCursorGuard.assertClean();

  const socketBSecondTab = connectSocket(bob);
  await new Promise((resolve) => socketBSecondTab.on('connect', resolve));
  assert.equal((await new Promise((resolve) => socketBSecondTab.emit('workspace:join', { workspaceId: wsA }, resolve))).success, true);

  const roleChanged = waitForEvent(socketB, 'workspace:role-changed', 5000, (event) => event.workspaceId === wsA && event.role === 'viewer');
  const secondRoleChanged = waitForEvent(socketBSecondTab, 'workspace:role-changed', 5000, (event) => event.workspaceId === wsA && event.role === 'viewer');
  await jsonRequest('PATCH', `/workspaces/${wsA}/members/${bob.id}`, alice.cookie, { role: 'viewer' });
  await Promise.all([roleChanged, secondRoleChanged]);
  const downgradedCursorGuard = listenForForbiddenEvents(socketA, ['cursor:updated'], (event) => event.userId === bob.id);
  socketB.emit('cursor:move', { workspaceId: wsA, x: 77, y: 88 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  downgradedCursorGuard.assertClean();
  assert.equal((await request('POST', `/workspaces/${wsA}/tasks`, bob.cookie, { title: 'Forbidden write' })).status, 403);

  const accessRevoked = waitForEvent(socketB, 'workspace:access-revoked', 5000, (event) => event.workspaceId === wsA);
  const secondAccessRevoked = waitForEvent(socketBSecondTab, 'workspace:access-revoked', 5000, (event) => event.workspaceId === wsA);
  await jsonRequest('DELETE', `/workspaces/${wsA}/members/${bob.id}`, alice.cookie);
  await Promise.all([accessRevoked, secondAccessRevoked]);
  assert.equal((await request('GET', `/workspaces/${wsA}/tasks`, bob.cookie)).status, 404);
  const revokedJoin = await new Promise((resolve) => socketB.emit('workspace:join', { workspaceId: wsA }, resolve));
  assert.equal(revokedJoin.success, false);
  const revokedEventGuard = listenForForbiddenEvents(socketB, ['task:mutated', 'canvas:bumped', 'comment:created']);
  const secondRevokedEventGuard = listenForForbiddenEvents(socketBSecondTab, ['task:mutated', 'canvas:bumped', 'comment:created']);
  await jsonRequest('POST', `/workspaces/${wsA}/tasks`, alice.cookie, { title: 'Only active members see this' }, 201);
  await new Promise((resolve) => setTimeout(resolve, 300));
  revokedEventGuard.assertClean();
  secondRevokedEventGuard.assertClean();
  console.log('   ✓ Test 4.2 Passed: forged cursor blocked, viewer downgraded, revoked socket expelled.');

  // Disconnect all sockets
  socketA.disconnect();
  socketB.disconnect();
  socketBSecondTab.disconnect();
  socketC.disconnect();
  socketD.disconnect();

  console.log('\n=============================================================');
  console.log('ALL E2E REALTIME INVALIDATION TESTS (TIERS 1-4) PASSED! 🚀🚀');
  console.log('=============================================================\n');
} catch (err) {
  console.error('\n[FAILURE] E2E Test Suite encountered an error:\n', err);
  console.error('\nServer stdout/stderr log output:\n', output.slice(-3000));
  process.exitCode = 1;
} finally {
  console.log('[CLEANUP] Disconnecting any remaining active sockets...');
  for (const s of activeSockets) {
    try {
      if (s.connected) {
        s.disconnect();
      }
    } catch {
      // Ignore error during defensive disconnect
    }
  }
  activeSockets.clear();

  console.log('[CLEANUP] Terminating test server...');
  try {
    server.kill('SIGINT');
  } catch {
    // Ignore error
  }

  if (clientConnected) {
    console.log('[CLEANUP] Purging test workspaces and users from database...');
    for (const wsId of workspaceIds) {
      try {
        await client.query('DELETE FROM workspaces WHERE id = $1', [wsId]);
      } catch (e) {
        console.error('Error deleting workspace', wsId, e.message);
      }
    }
    if (createdEmails.length > 0) {
      try {
        await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [createdEmails]);
      } catch (e) {
        console.error('Error deleting test users', e.message);
      }
    }
    await client.end();
  }
  console.log('[CLEANUP] Teardown complete.');
}
