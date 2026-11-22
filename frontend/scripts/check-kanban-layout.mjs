import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const workspace = { id: randomUUID(), name: 'Design workspace', role: 'owner' };
const tasks = [
  { id: randomUUID(), workspaceId: workspace.id, title: 'Lên ý tưởng', description: 'Khảo sát các luồng tương tác và thống nhất nội dung công việc.', blockedReason: null, status: 'todo', priority: 'high', dueAt: null, assigneeIds: [], sortOrder: '0', version: '1' },
  { id: randomUUID(), workspaceId: workspace.id, title: 'Thiết kế giao diện', description: 'Xây dựng bố cục Kanban và Canvas theo cùng dữ liệu.', blockedReason: null, status: 'in_progress', priority: 'normal', dueAt: null, assigneeIds: [], sortOrder: '0', version: '1' },
];
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const respond = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/auth/me') return respond(route, { id: randomUUID(), email: 'demo@example.com' });
  if (path === '/api/workspaces') return respond(route, { items: [workspace], nextPage: null });
  if (path.endsWith('/members')) return respond(route, { items: [], nextPage: null });
  if (path.endsWith('/canvas')) return respond(route, { version: '1', nodes: [], edges: [] });
  if (path.endsWith('/tasks')) {
    const status = new URL(route.request().url()).searchParams.get('status');
    return respond(route, { items: tasks.filter((task) => task.status === status), nextPage: null });
  }
  return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
});

try {
  await page.goto(process.env.FRONTEND_URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.locator('.kanban-card').first().waitFor();
  const geometry = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
    const nav = box('.primary-nav');
    const topbar = box('.topbar');
    const title = box('.pane-heading-text h1');
    const filter = box('.board-filter-bar');
    const column = box('.kanban-column');
    const card = box('.kanban-card');
    return { nav: nav?.width, topbar: topbar?.height, titleSize: getComputedStyle(document.querySelector('.pane-heading-text h1')).fontSize,
      cardTitleSize: getComputedStyle(document.querySelector('.kanban-card-title')).fontSize,
      filterBottom: filter?.bottom, columnTop: column?.top, cardRight: card?.right, viewport: window.innerWidth,
      titleLeft: title?.left };
  });
  assert.equal(geometry.nav, 256);
  assert.equal(geometry.topbar, 64);
  assert.equal(geometry.titleSize, '28px');
  assert.equal(geometry.cardTitleSize, '18px');
  assert.ok(geometry.columnTop > geometry.filterBottom);
  assert.ok(geometry.cardRight < geometry.viewport);
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-kanban-1600-dark.png') });
  await page.getByRole('button', { name: 'Chế độ sáng' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-kanban-1600-light.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-kanban-1280-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-kanban-390-light.png') });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole('tab', { name: 'Canvas' }).click();
  const canvasShell = await page.evaluate(() => ({
    nav: document.querySelector('.primary-nav')?.getBoundingClientRect().width,
    topbar: document.querySelector('.topbar')?.getBoundingClientRect().height,
  }));
  assert.deepEqual(canvasShell, { nav: 256, topbar: 64 });
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-canvas-1600-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCanvasShell = await page.evaluate(() => ({
    nav: document.querySelector('.primary-nav')?.getBoundingClientRect().width,
    topbar: document.querySelector('.topbar')?.getBoundingClientRect().height,
  }));
  assert.deepEqual(mobileCanvasShell, { nav: 52, topbar: 58 });
  await page.screenshot({ path: join(tmpdir(), 'collabcanvas-canvas-390-light.png') });
  assert.deepEqual(errors, []);
  console.log('Workspace layout check passed:', geometry);
} finally { await browser.close(); }
