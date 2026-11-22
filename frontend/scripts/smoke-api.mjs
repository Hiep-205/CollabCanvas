import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let loggedIn = false;
let workspace = null;
let tasks = [];
let canvasSnapshot = { version: '1', nodes: [], edges: [] };
let failNextPatch = false;
let failNextCreate = false;
let failNextCanvasPut = false;
let conflictNextPatch = false;
const respond = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

await page.route('**/api/**', async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  const body = request.postDataJSON?.() ?? {};
  if (path === '/api/auth/me') return respond(route, loggedIn ? 200 : 401, loggedIn ? { id: 'user-1', email: 'demo@example.com' } : {});
  if (path === '/api/auth/register' && method === 'POST') { if (!body.displayName || body.password.length < 12) return respond(route, 400, {}); loggedIn = true; return respond(route, 201, { id: 'user-1', email: body.email }); }
  if (path === '/api/dashboard') return respond(route, 200, { summary: { workspaceCount: workspace ? 1 : 0, taskCount: tasks.length, completedCount: 0, myOpenCount: 0, myOverdueCount: 0 }, tasks: [], page: 1, nextPage: null, asOf: new Date().toISOString() });
  if (path === '/api/invitations') return respond(route, 200, { items: [], nextPage: null });
  if (path === '/api/workspaces' && method === 'GET') return respond(route, 200, { items: workspace ? [workspace] : [], nextPage: null });
  if (path === '/api/workspaces' && method === 'POST') { workspace = { id: '11111111-1111-4111-8111-111111111111', name: body.name, role: 'owner' }; return respond(route, 201, workspace); }
  if (path.endsWith('/canvas') && method === 'GET') return respond(route, 200, canvasSnapshot);
  if (path.endsWith('/canvas') && method === 'PUT') {
    if (failNextCanvasPut) { failNextCanvasPut = false; return respond(route, 503, {}); }
    if (body.version !== canvasSnapshot.version) return respond(route, 409, {});
    canvasSnapshot = { ...body, version: String(Number(body.version) + 1) };
    return respond(route, 200, canvasSnapshot);
  }
  if (path.endsWith('/tasks') && method === 'GET') {
    const url = new URL(request.url());
    return respond(route, 200, { items: tasks.filter((task) => task.status === url.searchParams.get('status')), nextPage: null });
  }
  if (path.endsWith('/tasks') && method === 'POST') {
    if (failNextCreate) { failNextCreate = false; return respond(route, 503, {}); }
    const task = { id: randomUUID(), workspaceId: workspace.id, title: body.title, description: null, blockedReason: null, status: body.status, priority: 'normal', dueAt: null, sortOrder: '0', version: '1' };
    tasks.push(task); return respond(route, 201, task);
  }
  const task = tasks.find((item) => path.endsWith(`/tasks/${item.id}`));
  if (task && method === 'GET') return respond(route, 200, task);
  if (task && method === 'PATCH') {
    if (failNextPatch) { failNextPatch = false; return respond(route, 503, {}); }
    if (conflictNextPatch) { conflictNextPatch = false; task.title = 'Changed remotely'; task.version = String(Number(task.version) + 1); return respond(route, 409, {}); }
    if (body.version !== task.version) return respond(route, 409, {});
    Object.assign(task, body, { version: String(Number(task.version) + 1) });
    if (body.status === 'done') task.blockedReason = null;
    return respond(route, 200, task);
  }
  return respond(route, 404, {});
});

try {
  await page.goto(process.env.FRONTEND_URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'Đăng ký' }).click();
  await page.getByRole('textbox', { name: 'Tên hiển thị' }).fill('Demo User');
  await page.getByRole('textbox', { name: 'Email của bạn' }).fill('demo@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('strong-password-123');
  await page.locator('form').getByRole('button', { name: 'Tạo tài khoản' }).click();
  await page.getByRole('heading', { name: /Chào bạn,/ }).waitFor();
  await page.getByRole('button', { name: 'Tạo không gian làm việc', exact: true }).click();
  await page.getByLabel('Tên không gian').fill('Demo workspace');
  await page.locator('form').getByRole('button', { name: 'Tạo không gian & Bắt đầu' }).click();
  await page.locator('.kanban-column[aria-label="Cần làm"]').getByRole('button', { name: 'Thêm công việc vào Cần làm' }).click();
  const composer = page.locator('.kanban-column[aria-label="Cần làm"] .kanban-task-composer');
  await composer.getByRole('textbox', { name: 'Tiêu đề' }).fill('Discarded draft');
  await composer.getByRole('textbox', { name: 'Tiêu đề' }).press('Escape');
  await composer.waitFor({ state: 'detached' });
  await page.locator('.kanban-column[aria-label="Cần làm"]').getByRole('button', { name: 'Thêm công việc vào Cần làm' }).click();
  await composer.getByRole('button', { name: 'Thêm thẻ' }).click();
  await composer.getByText('Nhập tiêu đề công việc trước khi thêm.').waitFor();
  if (process.env.COLLABCANVAS_SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.TEMP ?? '.'}/collabcanvas-composer-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.TEMP ?? '.'}/collabcanvas-composer-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Chế độ sáng' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${process.env.TEMP ?? '.'}/collabcanvas-composer-light.png` });
    await page.getByRole('button', { name: 'Chế độ tối' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  }
  await composer.getByRole('textbox', { name: 'Tiêu đề' }).fill('API task');
  await page.getByText('Nhập tiêu đề công việc trước khi thêm.').waitFor({ state: 'detached' });
  failNextCreate = true;
  await composer.getByRole('textbox', { name: 'Tiêu đề' }).press('Enter');
  await composer.getByText('Lưu thất bại').waitFor();
  if (await composer.getByRole('textbox', { name: 'Tiêu đề' }).inputValue() !== 'API task') throw new Error('Failed create lost the draft');
  await composer.getByRole('textbox', { name: 'Tiêu đề' }).press('Enter');
  await page.locator('.kanban-column[aria-label="Cần làm"] .kanban-card', { hasText: 'API task' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.kanban-card', { hasText: 'API task' }).waitFor();
  await page.locator('.kanban-card', { hasText: 'API task' }).dragTo(page.locator('.kanban-column[aria-label="Đang làm"]'));
  await page.locator('.kanban-column[aria-label="Đang làm"] .kanban-card', { hasText: 'API task' }).waitFor();
  await page.locator('.kanban-card', { hasText: 'API task' }).click();
  const description = page.getByRole('textbox', { name: 'Mô tả chi tiết' });
  await description.fill('Live description preview');
  await page.locator('.kanban-card-description', { hasText: 'Live description preview' }).waitFor();
  if (tasks[0].description !== null) throw new Error('Description saved before leaving the editor');
  await page.getByRole('textbox', { name: 'Tiêu đề' }).click();
  await page.waitForFunction(() => document.querySelector('.kanban-card-description')?.textContent === 'Live description preview');
  if (tasks[0].description !== 'Live description preview') throw new Error('Description was not saved on blur');
  const blockedReason = page.getByRole('textbox', { name: 'Lý do vướng mắc (Nghẽn tiến độ)' });
  await blockedReason.fill('Need a design review');
  await page.locator('.kanban-card .kanban-block-reason', { hasText: 'Need a design review' }).waitFor();
  const blockedSaved = page.waitForResponse((response) => response.url().includes('/tasks/') && response.request().method() === 'PATCH' && response.ok());
  await page.getByRole('textbox', { name: 'Tiêu đề' }).click();
  await blockedSaved;
  if (tasks[0].blockedReason !== 'Need a design review') throw new Error('Blocked reason was not saved');
  await page.locator('.kanban-block-reason', { hasText: 'Need a design review' }).waitFor();
  failNextPatch = true;
  await blockedReason.fill('Still waiting for review');
  await page.getByRole('textbox', { name: 'Tiêu đề' }).click();
  await page.getByRole('alert').getByText('Lưu thất bại').waitFor();
  if (await blockedReason.inputValue() !== 'Still waiting for review') throw new Error('Failed save lost the block reason');
  await page.getByRole('alert').getByRole('button', { name: 'Thử lại' }).click();
  await page.waitForFunction(() => document.querySelector('.kanban-block-reason') !== null);
  if (tasks[0].blockedReason !== 'Still waiting for review') throw new Error('Retry did not save the block reason');
  const title = page.getByRole('textbox', { name: 'Tiêu đề' });
  await title.fill('Updated API task');
  await page.locator('.kanban-card', { hasText: 'Updated API task' }).waitFor();
  failNextPatch = true;
  await title.fill('Retry API task');
  await page.getByRole('alert').getByText('Lưu thất bại').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.kanban-card', { hasText: 'Updated API task' }).click();
  if (await title.inputValue() !== 'Retry API task') throw new Error('Reload lost the unsaved draft');
  await page.locator('.kanban-card', { hasText: 'Retry API task' }).waitFor();
  conflictNextPatch = true;
  await title.fill('Conflict draft');
  await page.getByRole('alert').getByText(/Công việc đã thay đổi/).waitFor();
  if (await title.inputValue() !== 'Conflict draft') throw new Error('Conflict lost the draft');
  await page.getByRole('alert').getByRole('button', { name: 'Thử lại' }).click();
  await page.locator('.kanban-card', { hasText: 'Conflict draft' }).waitFor();
  await page.screenshot({ path: 'smoke-api-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.canvas-tool-dock').getByRole('button', { name: 'Mở bảng chi tiết' }).click();
  await page.getByRole('button', { name: 'Conflict draft' }).click();
  await page.locator('.react-flow__node', { hasText: 'Conflict draft' }).waitFor();
  await page.locator('.react-flow__node .task-card-description', { hasText: 'Live description preview' }).waitFor();
  await page.locator('.react-flow__node .manual-blocked-badge', { hasText: 'Bị vướng' }).waitFor();
  await page.setViewportSize({ width: 1200, height: 700 });
  const panelLayout = await page.evaluate(() => {
    const panel = document.querySelector('aside[aria-label]');
    const header = panel?.firstElementChild?.getBoundingClientRect();
    const body = panel?.children[1]?.getBoundingClientRect();
    return { headerBottom: header?.bottom, bodyTop: body?.top };
  });
  if (!panelLayout.bodyTop || panelLayout.bodyTop < panelLayout.headerBottom) throw new Error('Inspector sections overlap at laptop height');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  await page.locator('.canvas-tool-dock').getByRole('button', { name: 'Thêm ghi chú' }).click();
  const noteSaved = page.waitForResponse((response) => response.url().endsWith('/canvas') && response.request().method() === 'PUT' && response.ok());
  await page.getByRole('textbox', { name: 'Nội dung ghi chú' }).fill('Saved idea');
  await noteSaved;
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  const relationSaved = page.waitForResponse((response) => response.url().endsWith('/canvas') && response.request().method() === 'PUT' && response.ok());
  await page.locator('.react-flow__node', { hasText: 'Saved idea' }).locator('.react-flow__handle-right').dragTo(
    page.locator('.react-flow__node', { hasText: 'Conflict draft' }).locator('.react-flow__handle-left'), { force: true },
  );
  await relationSaved;
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node', { hasText: 'Conflict draft' }).waitFor();
  await page.locator('.react-flow__node', { hasText: 'Saved idea' }).waitFor();
  if (await page.locator('.react-flow__edge.relation-association').count() !== 1) throw new Error('Canvas association did not persist');
  const dependent = { ...tasks[0], id: randomUUID(), title: 'Dependent task', status: 'todo', blockedReason: null, dueAt: null, version: '1' };
  tasks.push(dependent);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  for (const [trigger, heading] of [
    [page.getByTitle('Bấm để đổi hoặc quản lý không gian làm việc'), 'CHỌN KHÔNG GIAN LÀM VIỆC'],
    [page.getByRole('button', { name: 'Tài khoản', exact: true }), 'Tài khoản cá nhân'],
  ]) {
    await trigger.click();
    const menu = page.locator('.workspace-header-menu:popover-open');
    const content = menu.getByText(heading, { exact: true });
    await content.waitFor();
    const box = await content.boundingBox();
    if (!box || !await page.evaluate(({ x, y }) =>
      Boolean(document.elementFromPoint(x, y)?.closest('.workspace-header-menu')),
    { x: box.x + 2, y: box.y + 2 })) {
      throw new Error('Header menu was clipped');
    }
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: 'Lời mời', exact: true }).click();
  await page.getByRole('heading', { name: 'Lời mời', exact: true, level: 1 }).waitFor();
  await page.goBack();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node', { hasText: 'Conflict draft' }).waitFor();
  const addFromKanban = page.getByRole('button', { name: 'Thêm từ Kanban' });
  const addButtonBox = await addFromKanban.boundingBox();
  if (!addButtonBox || !await page.evaluate(({ x, y }) =>
    Boolean(document.elementFromPoint(x, y)?.closest('.canvas-add-existing')),
  { x: addButtonBox.x + addButtonBox.width / 2, y: addButtonBox.y + addButtonBox.height / 2 })) {
    throw new Error('Canvas toolbar button was outside the visible workspace');
  }
  await addFromKanban.click();
  const kanbanPicker = page.getByRole('region', { name: 'Thêm từ Kanban' });
  if (await kanbanPicker.getByRole('button', { name: 'Conflict draft' }).count()) {
    throw new Error('Canvas picker listed a task already on the canvas');
  }
  await kanbanPicker.getByRole('button', { name: 'Dependent task' }).click();
  await page.locator('.react-flow__node-task', { hasText: 'Dependent task' }).waitFor();
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const dependencySaved = page.waitForResponse((response) => response.url().endsWith('/canvas') && response.request().method() === 'PUT' && response.ok()
    && response.request().postDataJSON()?.edges?.some((edge) => edge.kind === 'dependency'), { timeout: 8000 });
  await page.locator('.react-flow__node-task', { hasText: 'Conflict draft' }).locator('.react-flow__handle-right').dragTo(
    page.locator('.react-flow__node-task', { hasText: 'Dependent task' }).locator('.react-flow__handle-left'), { force: true },
  );
  try { await dependencySaved; } catch (error) {
    console.error('Dependency debug', JSON.stringify({ nodes: canvasSnapshot.nodes, edges: canvasSnapshot.edges, errors }));
    throw error;
  }
  await page.locator('.react-flow__edge.relation-bottleneck').waitFor();
  await page.locator('.react-flow__node-task .is-bottleneck', { hasText: 'Conflict draft' }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  await page.locator('.kanban-card', { hasText: 'Dependent task' }).getByRole('button', { name: /Chờ 1 việc/ }).waitFor();
  await page.locator('.kanban-card', { hasText: 'Dependent task' }).dragTo(page.locator('.kanban-column[aria-label="Hoàn thành"]'));
  await page.getByRole('dialog', { name: 'Công việc tiên quyết chưa hoàn thành!' }).waitFor();
  await page.getByRole('dialog', { name: 'Công việc tiên quyết chưa hoàn thành!' }).getByRole('button', { name: 'Hủy' }).click();
  if (dependent.status !== 'todo') throw new Error('Canceled dependency warning changed task status');
  await page.locator('.kanban-card', { hasText: 'Dependent task' }).click();
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('DONE');
  await page.getByRole('dialog', { name: 'Công việc tiên quyết chưa hoàn thành!' }).getByRole('button', { name: 'Vẫn hoàn thành' }).click();
  await page.locator('.kanban-column[aria-label="Hoàn thành"] .kanban-card', { hasText: 'Dependent task' }).waitFor();
  if (dependent.status !== 'done') throw new Error('Confirmed dependency override did not save');
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node', { hasText: 'Conflict draft' }).click();
  await page.getByRole('combobox', { name: 'Trạng thái' }).selectOption('DONE');
  await page.locator('.react-flow__node .manual-blocked-badge').waitFor({ state: 'detached' });
  await page.locator('.react-flow__edge.relation-bottleneck').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  await page.locator('.kanban-column[aria-label="Hoàn thành"] .kanban-card', { hasText: 'Conflict draft' }).waitFor();
  if (await page.locator('.kanban-card', { hasText: 'Dependent task' }).getByRole('button', { name: /Chờ 1 việc/ }).count()) {
    throw new Error('Dependency warning remained after prerequisite completed');
  }
  dependent.status = 'todo';
  dependent.dueAt = '2000-01-01T00:00:00.000Z';
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node-task .is-bottleneck', { hasText: 'Dependent task' }).waitFor();
  dependent.dueAt = '2099-01-01T00:00:00.000Z';
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.locator('.react-flow__node-task', { hasText: 'Dependent task' }).waitFor();
  if (await page.locator('.react-flow__node-task .is-bottleneck', { hasText: 'Dependent task' }).count()) {
    throw new Error('Bottleneck remained after due date moved into the future');
  }
  await page.locator('.react-flow__node-sticky', { hasText: 'Saved idea' }).click();
  failNextCanvasPut = true;
  await page.getByRole('textbox', { name: 'Nội dung ghi chú' }).fill('Saved idea recovered');
  await page.getByRole('alert').getByText('Lưu thất bại').waitFor();
  const recoveredCanvas = page.waitForResponse((response) => response.url().endsWith('/canvas') && response.request().method() === 'PUT' && response.ok()
    && response.request().postDataJSON()?.nodes?.some((node) => node.type === 'note' && node.text === 'Saved idea recovered'));
  await page.getByRole('alert').getByRole('button', { name: 'Thử lại' }).click();
  await recoveredCanvas;
  if (!canvasSnapshot.nodes.some((node) => node.type === 'note' && node.text === 'Saved idea recovered')) {
    throw new Error('Canvas retry did not preserve the note draft');
  }
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  workspace.role = 'viewer';
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.locator('.kanban-column[aria-label="Cần làm"]').getByRole('button', { name: 'Thêm công việc vào Cần làm' }).count()) throw new Error('Viewer can create');
  await page.locator('.kanban-card').first().click();
  if (await page.getByRole('textbox', { name: 'Tiêu đề' }).isEnabled()) throw new Error('Viewer can edit');
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  if (await page.getByRole('button', { name: 'Thêm ghi chú' }).count()) throw new Error('Viewer can add notes');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Mở điều hướng', exact: true }).click();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'smoke-api-mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('Mobile horizontal overflow');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Frontend API smoke passed: auth, workspace, create, reload, move, autosave, retry, conflict, viewer');
} finally { await browser.close(); }
