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
const port = '3101';
const origin = 'http://localhost:5173';
const base = `http://127.0.0.1:${port}/api`;
const email = `smoke-${randomUUID()}@example.test`;
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

async function post(path, body, cookie, requestOrigin = origin) {
  return fetch(`${base}/auth/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const client = new pg.Client({ connectionString: testUrl });
let clientConnected = false;
try {
  await ready();
  await client.connect();
  clientConnected = true;
  const registration = await post('register', { email, password, displayName: 'Smoke Tester' });
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).email, email);
  const firstCookie = registration.headers.get('set-cookie')?.split(';')[0];
  assert.match(firstCookie, /^cc_session=/);
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/);

  const me = await fetch(`${base}/auth/me`, { headers: { cookie: firstCookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).email, email);

  assert.equal((await post('login', { email, password: 'Wrong-password-123!' })).status, 401);
  assert.equal((await post('login', { email: "x'OR'1'='1@example.test", password })).status, 401);
  assert.equal((await post('login', { email, password }, undefined, 'http://evil.example')).status, 403);
  assert.equal((await post('register', { email, password, displayName: 'Again' })).status, 409);

  const login = await post('login', { email, password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.match(cookie, /^cc_session=/);
  assert.equal((await post('logout', {}, cookie)).status, 204);
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie } })).status, 401);
  assert.equal((await post('login', { email, password: 'Wrong-password-123!' })).status, 401);
  assert.equal((await post('login', { email, password: 'Wrong-password-123!' })).status, 401);
  assert.equal((await post('login', { email, password: 'Wrong-password-123!' })).status, 429);
  assert.equal((await fetch(`${base}/auth/logout`, {
    method: 'POST',
    headers: { cookie: firstCookie, 'content-type': 'application/json' },
    body: '{}',
  })).status, 403);
  const oversized = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: 'x'.repeat(20_000) }),
  });
  assert.equal(oversized.status, 413);
  console.log('Auth smoke test passed against collabcanvas_test');
} finally {
  if (clientConnected) {
    await client.query('DELETE FROM users WHERE email = $1', [email]);
    await client.end();
  }
  server.kill();
}
