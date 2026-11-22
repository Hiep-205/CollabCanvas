import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
const fetch = globalThis.fetch;
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(frontendDir, '..', 'backend');
const backendRequire = createRequire(resolve(backendDir, 'package.json'));
const dotenv = backendRequire('dotenv');
const pg = backendRequire('pg');
const env = dotenv.config({ path: resolve(backendDir, '.env'), quiet: true }).parsed;
if (!env?.DATABASE_URL) throw new Error('Backend DATABASE_URL is missing');
const databaseUrl = new URL(env.DATABASE_URL);
if (databaseUrl.pathname !== '/collabcanvas') throw new Error('Refusing to test an unexpected database');
databaseUrl.pathname = '/collabcanvas_test';
const testUrl = databaseUrl.toString();
const frontendUrl = 'http://localhost:5173';
const apiUrl = 'http://127.0.0.1:3105';
const email = `real-flow-${randomUUID()}@example.test`;
const viewerEmail = `real-viewer-${randomUUID()}@example.test`;
const password = 'Long-test-password-123!';
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: backendDir,
  env: { ...process.env, ...env, DATABASE_URL: testUrl, PORT: '3105', FRONTEND_ORIGIN: frontendUrl },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let apiOutput = '';
api.stdout.on('data', (chunk) => { apiOutput += chunk; });
api.stderr.on('data', (chunk) => { apiOutput += chunk; });
const db = new pg.Client({ connectionString: testUrl });
let dbConnected = false;
let browser;
let page;
const httpFailures = [];
const pageErrors = [];

async function ready() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (api.exitCode !== null) throw new Error(`Test API exited: ${apiOutput.slice(-800)}`);
    try { if ((await fetch(`${apiUrl}/api/health`)).ok) return; } catch { /* Startup in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test API did not start: ${apiOutput.slice(-800)}`);
}

try {
  await ready();
  await db.connect();
  dbConnected = true;
  assert.equal((await fetch(frontendUrl)).status, 200);
  browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    const response = await route.fetch({
      url: `${apiUrl}${target.pathname}${target.search}`,
      headers: { ...request.headers(), origin: frontendUrl },
    });
    if (response.status() >= 400 && !(target.pathname === '/api/auth/me' && response.status() === 401)) {
      httpFailures.push(`${request.method()} ${target.pathname}: ${response.status()}`);
    }
    await route.fulfill({ response });
  });

  await page.goto(frontendUrl, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Đăng ký' }).click();
  await page.getByRole('textbox', { name: 'Tên hiển thị' }).fill('Real Flow Tester');
  await page.getByRole('textbox', { name: 'Email của bạn' }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.locator('form').getByRole('button', { name: 'Tạo tài khoản' }).click();
  await page.getByRole('heading', { name: /Chào bạn,/ }).waitFor();
  await page.getByRole('button', { name: 'Tạo không gian làm việc', exact: true }).click();
  await page.getByLabel('Tên không gian').fill('Real flow workspace');
  await page.locator('form').getByRole('button', { name: 'Tạo không gian & Bắt đầu' }).click();
  await page.locator('.kanban-column[aria-label="Cần làm"]').getByRole('button', { name: 'Thêm công việc vào Cần làm' }).click();
  await page.locator('.kanban-column[aria-label="Cần làm"] .kanban-task-composer').getByRole('textbox', { name: 'Tiêu đề' }).fill('Real database task');
  await page.locator('.kanban-column[aria-label="Cần làm"] .kanban-task-composer').getByRole('button', { name: 'Thêm thẻ' }).click();
  await page.locator('.kanban-card', { hasText: 'Real database task' }).waitFor();
  if (process.env.COLLABCANVAS_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-kanban-check.png') });

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.kanban-card', { hasText: 'Real database task' }).waitFor();
  await page.locator('.kanban-card', { hasText: 'Real database task' }).dragTo(page.locator('.kanban-column[aria-label="Đang làm"]'));
  await page.locator('.kanban-column[aria-label="Đang làm"] .kanban-card', { hasText: 'Real database task' }).waitFor();
  await page.locator('.kanban-card', { hasText: 'Real database task' }).click();
  await page.getByRole('textbox', { name: 'Tiêu đề' }).fill('Real database task updated');
  await page.locator('.kanban-card', { hasText: 'Real database task updated' }).waitFor();
  const descriptionSaved = page.waitForResponse((response) => response.url().includes('/tasks/') && response.request().method() === 'PATCH' && response.ok()
    && response.request().postDataJSON()?.description === 'Real task description');
  await page.getByRole('textbox', { name: 'Mô tả chi tiết' }).fill('Real task description');
  await page.locator('#task-priority').focus();
  await descriptionSaved;
  const prioritySaved = page.waitForResponse((response) => response.url().includes('/tasks/') && response.request().method() === 'PATCH' && response.ok()
    && response.request().postDataJSON()?.priority === 'high');
  await page.locator('#task-priority').selectOption('high');
  await prioritySaved;
  const dueSaved = page.waitForResponse((response) => response.url().includes('/tasks/') && response.request().method() === 'PATCH' && response.ok()
    && response.request().postDataJSON()?.dueAt?.startsWith('2099-12-01'));
  await page.locator('#task-due').fill('2099-12-01');
  await dueSaved;
  const assignmentSaved = page.waitForResponse((response) => response.url().endsWith('/assignees') && response.request().method() === 'PUT' && response.ok());
  await page.locator('aside[aria-label] input[type="checkbox"]').first().click();
  await assignmentSaved;
  await page.waitForFunction(() => document.querySelector('aside[aria-label] input[type="checkbox"]')?.checked);
  const checklistAdded = page.waitForResponse((response) => response.url().endsWith('/checklist') && response.request().method() === 'POST' && response.ok());
  await page.getByRole('textbox', { name: 'Thêm một bước' }).fill('Prepare demo');
  await page.getByRole('button', { name: 'Thêm bước' }).click();
  await checklistAdded;
  await page.locator('.task-checklist-item', { hasText: 'Prepare demo' }).waitFor();
  const checklistUpdated = page.waitForResponse((response) => response.url().includes('/checklist/') && response.request().method() === 'PATCH' && response.ok());
  await page.locator('.task-checklist-item input[type="checkbox"]').click();
  await checklistUpdated;
  await page.locator('.kanban-card', { hasText: 'Toàn bộ nhiệm vụ đã xong' }).waitFor();
  const blockedSaved = page.waitForResponse((response) => response.url().includes('/tasks/') && response.request().method() === 'PATCH' && response.ok()
    && response.request().postDataJSON()?.blockedReason === 'Waiting for approval');
  await page.getByRole('textbox', { name: 'Lý do vướng mắc (Nghẽn tiến độ)' }).fill('Waiting for approval');
  await page.locator('#task-due').focus();
  await blockedSaved;
  await page.locator('.kanban-card .kanban-block-reason', { hasText: 'Waiting for approval' }).waitFor();
  await page.locator('.kanban-block-reason', { hasText: 'Waiting for approval' }).waitFor();
  if (process.env.COLLABCANVAS_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-checklist-inspector-check.png') });
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-kanban-assigned-check.png') });
  }
  await page.getByRole('textbox', { name: 'Tìm công việc' }).fill('database task updated');
  await page.getByRole('combobox', { name: 'Mọi ưu tiên' }).first().selectOption('high');
  await page.getByRole('combobox', { name: 'Mọi người thực hiện' }).selectOption({ label: 'Real Flow Tester' });
  await page.getByRole('combobox', { name: 'Mọi hạn chót' }).selectOption('upcoming');
  await page.locator('.kanban-column[aria-label="Đang làm"] .kanban-card', { hasText: 'Real database task updated' }).waitFor();
  await page.getByRole('textbox', { name: 'Tìm công việc' }).fill('');
  await page.getByRole('combobox', { name: 'Mọi ưu tiên' }).first().selectOption('');
  await page.getByRole('combobox', { name: 'Mọi người thực hiện' }).selectOption('');
  await page.getByRole('combobox', { name: 'Mọi hạn chót' }).selectOption('');

  await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
  await page.getByRole('heading', { name: /Chào bạn,/ }).waitFor();
  const dashboard = await page.evaluate(async () => (await fetch('/api/dashboard')).json());
  assert.equal(dashboard.summary.workspaceCount, 1);
  assert.equal(dashboard.summary.taskCount, 1);
  assert.equal(dashboard.summary.myOpenCount, 1);
  assert.equal(dashboard.tasks[0].title, 'Real database task updated');
  await page.getByRole('button', { name: /Real database task updated.*Real flow workspace/ }).click();
  await page.getByRole('textbox', { name: 'Tiêu đề' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Tiêu đề' }).inputValue(), 'Real database task updated');
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
  await page.getByRole('button', { name: 'Mở không gian Real flow workspace', exact: true }).click();

  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Thêm từ Kanban', exact: true }).click();
  await page.getByRole('region', { name: 'Thêm từ Kanban' }).getByRole('button', { name: 'Real database task updated' }).click();
  await page.locator('.react-flow__node', { hasText: 'Real database task updated' }).waitFor();
  await page.locator('.react-flow__node-task .task-card-description', { hasText: 'Real task description' }).waitFor();
  await page.locator('.react-flow__node-task .manual-blocked-badge', { hasText: 'Bị vướng' }).waitFor();
  await page.locator('.react-flow__node-task .checklist-badge', { hasText: '1/1' }).waitFor();
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  await page.locator('.canvas-tool-dock').getByRole('button', { name: 'Thêm ghi chú' }).click();
  await page.getByRole('textbox', { name: 'Nội dung ghi chú' }).fill('Real database note');
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  const noteSaved = page.waitForResponse((response) => response.url().endsWith('/canvas') && response.request().method() === 'PUT' && response.ok()
    && response.request().postDataJSON()?.nodes?.some((node) => node.type === 'note' && node.text === 'Real database note'));
  await noteSaved;
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node-sticky', { hasText: 'Real database note' }).waitFor();
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-canvas-check.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Mở điều hướng', exact: true }).click();
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-canvas-mobile-check.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
    await page.locator('.react-flow__node-sticky', { hasText: 'Real database note' }).waitFor();
  }
  await page.locator('.react-flow__node', { hasText: 'Real database task updated' }).click();
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('DONE');
  await page.locator('.react-flow__node-task .manual-blocked-badge').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  await page.locator('.kanban-column[aria-label="Hoàn thành"] .kanban-card', { hasText: 'Real database task updated' }).waitFor();

  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node-sticky', { hasText: 'Real database note' }).click();
  const converted = page.waitForResponse((response) => response.url().endsWith('/tasks') && response.request().method() === 'POST' && response.ok());
  const convertedCanvasSaved = page.waitForResponse((response) => response.url().endsWith('/canvas') && response.request().method() === 'PUT' && response.ok()
    && response.request().postDataJSON()?.nodes?.some((node) => node.type === 'note' && node.taskId));
  await page.getByRole('button', { name: 'Chuyển thành công việc' }).click();
  await converted;
  await convertedCanvasSaved;
  await page.locator('.react-flow__node-sticky', { hasText: 'Real database note' }).waitFor();
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  await page.locator('.kanban-column[aria-label="Cần làm"] .kanban-card', { hasText: 'Real database note' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.kanban-column[aria-label="Cần làm"] .kanban-card', { hasText: 'Real database note' }).waitFor();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node-sticky', { hasText: 'Real database note' }).click();
  assert.equal(await page.getByRole('button', { name: 'Chuyển thành công việc' }).count(), 0);
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();

  // Exercise the presentation scenario against the real API and database.
  const prerequisiteNode = page.locator('.react-flow__node-task', { hasText: 'Real database task updated' });
  const dependentNode = page.locator('.react-flow__node-task', { hasText: 'Real database note' });
  await prerequisiteNode.click();
  const reopened = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && response.url().includes('/tasks/') && response.ok() && response.request().postDataJSON()?.status === 'in_progress');
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('IN_PROGRESS');
  await reopened;
  const blocked = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && response.url().includes('/tasks/') && response.ok() && response.request().postDataJSON()?.blockedReason === 'Waiting for demo approval');
  await page.getByRole('textbox', { name: 'Lý do vướng mắc (Nghẽn tiến độ)' }).fill('Waiting for demo approval');
  await page.getByRole('textbox', { name: 'Lý do vướng mắc (Nghẽn tiến độ)' }).blur();
  await blocked;
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const dependencySaved = page.waitForResponse((response) => response.url().endsWith('/canvas')
    && response.request().method() === 'PUT' && response.ok()
    && response.request().postDataJSON()?.edges?.some((edge) => edge.kind === 'dependency'));
  await prerequisiteNode.locator('.react-flow__handle-right').dragTo(dependentNode.locator('.react-flow__handle-left'), { force: true });
  await dependencySaved;
  await page.locator('.react-flow__edge.relation-bottleneck').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__edge.relation-bottleneck').waitFor();
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-demo-bottleneck.png') });
  }
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  const dependentCard = page.locator('.kanban-card', { hasText: 'Real database note' });
  await dependentCard.getByRole('button', { name: /Chờ 1 việc/ }).waitFor();
  await dependentCard.dragTo(page.locator('.kanban-column[aria-label="Hoàn thành"]'));
  const warning = page.getByRole('dialog', { name: 'Công việc tiên quyết chưa hoàn thành!' });
  await warning.waitFor();
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-demo-dependency-warning.png') });
  }
  await warning.getByRole('button', { name: 'Hủy' }).click();
  await page.locator('.kanban-column[aria-label="Cần làm"] .kanban-card', { hasText: 'Real database note' }).waitFor();
  await dependentCard.getByRole('heading', { name: 'Real database note', exact: true }).click();
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('DONE');
  const overrideSaved = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && response.url().includes('/tasks/') && response.ok() && response.request().postDataJSON()?.status === 'done');
  await warning.getByRole('button', { name: 'Vẫn hoàn thành' }).click();
  await overrideSaved;
  await page.locator('.kanban-column[aria-label="Hoàn thành"] .kanban-card', { hasText: 'Real database note' }).waitFor();
  const dependentReopened = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && response.url().includes('/tasks/') && response.ok() && response.request().postDataJSON()?.status === 'todo');
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('TODO');
  await dependentReopened;
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  await page.locator('.kanban-card', { hasText: 'Real database task updated' }).click();
  const prerequisiteDone = page.waitForResponse((response) => response.request().method() === 'PATCH'
    && response.url().includes('/tasks/') && response.ok() && response.request().postDataJSON()?.status === 'done');
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('DONE');
  await prerequisiteDone;
  await dependentCard.getByRole('button', { name: /Chờ 1 việc/ }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__edge.relation-dependency').waitFor();
  assert.equal(await page.locator('.react-flow__edge.relation-bottleneck').count(), 0);

  await page.getByRole('button', { name: 'Hoạt động' }).click();
  await page.locator('.activity-row').first().waitFor();
  const filteredActivity = page.waitForResponse((response) => response.url().includes('/activity?') && response.url().includes('taskId=') && response.ok());
  await page.getByLabel('Lọc theo công việc').selectOption({ label: 'Real database task updated' });
  const activityResponse = await filteredActivity;
  const filteredTaskId = new URL(activityResponse.url()).searchParams.get('taskId');
  const filteredEvents = (await activityResponse.json()).items;
  assert.ok(filteredEvents.length > 0 && filteredEvents.every((item) => item.taskId === filteredTaskId));
  await page.locator('.activity-row').first().waitFor();
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-activity-desktop-check.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-activity-mobile-check.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Bật Light Mode' }).click();
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-activity-light-check.png') });
    await page.getByRole('button', { name: 'Bật Dark Mode' }).click();
  }
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('heading', { name: 'Activity' }).waitFor();
  await page.getByRole('button', { name: 'VI', exact: true }).click();
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();

  const myTasksNav = page.getByRole('button', { name: 'Được giao cho tôi', exact: true });
  const workspaceNav = page.getByRole('button', { name: 'Tất cả công việc', exact: true });
  await myTasksNav.click();
  await page.getByRole('heading', { name: 'Bảng công việc', exact: true }).waitFor();
  assert.equal(await page.locator('.kanban-card').count(), 1);
  await page.locator('.kanban-card', { hasText: 'Real database task updated' }).waitFor();
  await myTasksNav.click();
  assert.equal(await page.locator('.kanban-card').count(), 1);
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-demo-my-tasks.png') });
  }
  await workspaceNav.click();
  await page.getByRole('heading', { name: 'Bảng công việc', exact: true }).waitFor();
  assert.equal(await page.locator('.kanban-card').count(), 2);
  await page.locator('.kanban-card', { hasText: 'Real database note' }).waitFor();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  await myTasksNav.click();
  await page.getByRole('heading', { name: 'Bảng công việc', exact: true }).waitFor();
  assert.equal(await page.locator('.kanban-card').count(), 1);
  await workspaceNav.click();
  assert.equal(await page.locator('.kanban-card').count(), 2);
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.screenshot({ path: resolve(process.env.TEMP ?? frontendDir, 'collabcanvas-demo-workspace-tasks.png') });
  }

  const stored = await db.query(`SELECT w.id AS workspace_id, w.canvas_version, t.id AS task_id, t.status, t.blocked_reason,
    (SELECT count(*) FROM canvas_nodes WHERE workspace_id=w.id) AS node_count,
    (SELECT count(*) FROM canvas_associations WHERE workspace_id=w.id) AS association_count,
    (SELECT count(*) FROM task_dependencies WHERE workspace_id=w.id) AS dependency_count,
    (SELECT count(*) FROM canvas_nodes n WHERE n.workspace_id=w.id AND n.node_type='note' AND n.task_id IS NOT NULL) AS attached_note_count
    FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
    JOIN users u ON u.id=m.user_id JOIN tasks t ON t.workspace_id=w.id
    WHERE u.email=$1 AND t.title=$2`, [email, 'Real database task updated']);
  assert.equal(stored.rowCount, 1);
  const diagnostic = await db.query('SELECT node_type, task_id IS NOT NULL AS attached FROM canvas_nodes WHERE workspace_id=$1 ORDER BY node_type, id', [stored.rows[0].workspace_id]);
  console.log(JSON.stringify({ diagnostic: diagnostic.rows, stored: { nodeCount: Number(stored.rows[0].node_count), associationCount: Number(stored.rows[0].association_count), attachedNoteCount: Number(stored.rows[0].attached_note_count) } }));
  assert.equal(stored.rows[0].status, 'done');
  assert.equal(stored.rows[0].blocked_reason, null);
  assert.equal(Number(stored.rows[0].node_count), 3);
  assert.equal(Number(stored.rows[0].association_count), 1);
  assert.equal(Number(stored.rows[0].dependency_count), 1);
  assert.equal(Number(stored.rows[0].attached_note_count), 1);

  await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
  await page.getByRole('button', { name: 'Đăng xuất tài khoản' }).click();
  await page.getByRole('textbox', { name: 'Email của bạn' }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.locator('form').getByRole('button', { name: 'Đăng nhập vào Canvas' }).click();
  await page.getByRole('heading', { name: /Chào bạn,/ }).waitFor();
  await page.getByRole('button', { name: 'Mở không gian Real flow workspace', exact: true }).click();
  await page.locator('.kanban-column[aria-label="Hoàn thành"] .kanban-card', { hasText: 'Real database task updated' }).waitFor();

  const viewerResponse = await fetch(`${apiUrl}/api/auth/register`, { method: 'POST', headers: { origin: frontendUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ email: viewerEmail, password, displayName: 'Real Viewer' }) });
  assert.equal(viewerResponse.status, 201);
  const viewer = await viewerResponse.json();
  await db.query('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)', [stored.rows[0].workspace_id, viewer.id, 'viewer']);
  await page.getByRole('button', { name: 'Tài khoản', exact: true }).click();
  await page.getByRole('button', { name: 'Đăng xuất tài khoản' }).click();
  await page.getByRole('textbox', { name: 'Email của bạn' }).fill(viewerEmail);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.locator('form').getByRole('button', { name: 'Đăng nhập vào Canvas' }).click();
  await page.getByRole('heading', { name: /Chào bạn,/ }).waitFor();
  await page.getByRole('button', { name: 'Mở không gian Real flow workspace', exact: true }).click();
  await page.locator('.kanban-card', { hasText: 'Real database task updated' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Thêm công việc · Cần làm' }).count(), 0);
  await page.locator('.kanban-card', { hasText: 'Real database task updated' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Tiêu đề' }).isEnabled(), false);
  assert.equal(await page.getByRole('textbox', { name: 'Lý do vướng mắc (Nghẽn tiến độ)' }).isEnabled(), false);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Thêm ghi chú' }).count(), 0);
  assert.deepEqual(httpFailures, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ passed: true, flow: 'browser -> API -> collabcanvas_test', taskStatus: stored.rows[0].status,
    nodeCount: Number(stored.rows[0].node_count), associationCount: Number(stored.rows[0].association_count), attachedNoteCount: Number(stored.rows[0].attached_note_count), viewerReadOnly: true,
    dependencyCount: Number(stored.rows[0].dependency_count), dependencyWarning: true, bottleneckCleared: true, myTasksNavigation: true, dashboardNavigation: true,
    canvasVersion: stored.rows[0].canvas_version.toString(), httpFailures, pageErrors }));
} catch (error) {
  if (page) await page.screenshot({ path: resolve(frontendDir, 'smoke-real-error.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ passed: false, reason: error.stack, httpFailures, pageErrors }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (dbConnected) {
    try {
      await db.query(`DELETE FROM workspaces WHERE id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id=(SELECT id FROM users WHERE email=$1))`, [email]);
      await db.query('DELETE FROM users WHERE email=$1', [email]);
      await db.query('DELETE FROM users WHERE email=$1', [viewerEmail]);
    } finally { await db.end(); }
  }
  api.kill();
}
