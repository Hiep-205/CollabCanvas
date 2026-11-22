import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const workspace = { id: randomUUID(), name: 'Trash demo', role: 'owner' };
const task = { id: randomUUID(), workspaceId: workspace.id, title: 'Recoverable task', description: null, blockedReason: null, status: 'todo', priority: 'normal', dueAt: null, assigneeIds: [], sortOrder: '0', version: '1' };
let deleted = false;
let canvasVersion = 1;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const reply = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  if (path === '/api/auth/me') return reply(route, 200, { id: randomUUID(), email: 'demo@example.com' });
  if (path === '/api/workspaces') return reply(route, 200, { items: [workspace], nextPage: null });
  if (path.endsWith('/members')) return reply(route, 200, { items: [], nextPage: null });
  if (path.endsWith('/canvas')) return reply(route, 200, { version: String(canvasVersion), nodes: [], edges: [] });
  if (path.endsWith('/trash') && method === 'GET') {
    const items = deleted ? [{ type: 'task', id: task.id, title: task.title, deletedAt: new Date().toISOString(), version: task.version }] : [];
    return reply(route, 200, { items, nextPage: null, canvasVersion: String(canvasVersion) });
  }
  if (path.endsWith(`/trash/tasks/${task.id}`) && method === 'PATCH') {
    const body = request.postDataJSON();
    if (body.version !== task.version) return reply(route, 409, {});
    deleted = body.deleted; task.version = String(Number(task.version) + 1); canvasVersion += 1;
    return reply(route, 200, { id: task.id, version: task.version, canvasVersion: String(canvasVersion) });
  }
  if (path.endsWith('/tasks') && method === 'GET') {
    const status = new URL(request.url()).searchParams.get('status');
    return reply(route, 200, { items: !deleted && status === task.status ? [task] : [], nextPage: null });
  }
  return reply(route, 404, {});
});
try {
  const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173/';
  await page.goto(`${baseUrl.replace(/\/+$/, '')}/#/workspaces/${workspace.id}`, { waitUntil: 'networkidle' });
  const wsCard = page.locator('div', { hasText: workspace.name }).last();
  if (await wsCard.isVisible()) await wsCard.click();
  await page.locator('.kanban-card', { hasText: task.title }).click();
  await page.getByRole('button', { name: 'Chuyển vào thùng rác' }).click();
  await page.locator('.kanban-card', { hasText: task.title }).waitFor({ state: 'detached' });
  await page.locator('.primary-nav').getByRole('button', { name: 'Thùng rác' }).click({ force: true });
  await page.locator('.trash-list', { hasText: task.title }).waitFor();
  await page.locator('.trash-list').getByRole('button', { name: 'Khôi phục' }).click();
  await page.getByText('Chưa có mục nào trong thùng rác.').waitFor();
  await page.locator('.primary-nav').getByRole('button', { name: /Bảng công việc|Không gian làm việc/ }).click({ force: true });
  await page.locator('.kanban-card', { hasText: task.title }).waitFor();
  await page.locator('.primary-nav').getByRole('button', { name: 'Thùng rác' }).click({ force: true });
  await page.getByRole('tab', { name: 'Ghi chú' }).click();
  await page.getByText('Chưa có mục nào trong thùng rác.').waitFor();
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-trash-desktop-check.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-trash-mobile-check.png') });
  assert.deepEqual(errors, []);
  console.log('Trash UI smoke passed: task trash, restore, tabs, desktop/mobile');
} finally { await browser.close(); }
