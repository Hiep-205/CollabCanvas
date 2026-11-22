import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.addInitScript(() => {
  localStorage.setItem('collabcanvas.active_ws.11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const user = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Hoàng Hiệp', email: 'hiep@example.test' };
const workspaces = [
  { id: '22222222-2222-4222-8222-222222222222', name: 'Đồ án CollabCanvas', description: 'Từ ý tưởng đến sản phẩm. Cùng nhóm xây dựng không gian làm việc trực quan.', role: 'owner' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Thiết kế trải nghiệm', description: 'Nghiên cứu người dùng, phác thảo luồng và hoàn thiện giao diện.', role: 'editor' },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Kế hoạch học kỳ', description: 'Theo dõi các mốc học tập và chuẩn bị nội dung báo cáo.', role: 'viewer' },
];
const task = { id: '55555555-5555-4555-8555-555555555555', workspaceId: workspaces[1].id, title: 'Hoàn thiện luồng điều hướng', status: 'in_progress', priority: 'high', description: null, blockedReason: null, dueAt: '2099-12-01T00:00:00Z', sortOrder: '0', version: '1', assigneeIds: [user.id], checklist: [] };
const unassignedTask = { ...task, id: '99999999-9999-4999-8999-999999999999', title: 'Chuẩn bị bản khảo sát', status: 'todo', assigneeIds: [] };
let invitations = [{ id: '66666666-6666-4666-8666-666666666666', workspaceId: '77777777-7777-4777-8777-777777777777', workspaceName: 'Nhóm nghiên cứu', role: 'editor', status: 'pending', createdAt: new Date().toISOString(), expiresAt: '2099-01-01T00:00:00Z' }];
let failSummary = true;
let failCreate = true;
let managedMembers = [user, { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'An', email: 'an@example.test', role: 'editor' }];
const respond = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  if (path === '/api/auth/me') return respond(route, 200, user);
  if (path === '/api/workspaces' && request.method() === 'GET') {
    const second = url.searchParams.get('page') === '2';
    return respond(route, 200, { items: second ? workspaces.slice(2) : workspaces.slice(0, 2), nextPage: second ? null : 2 });
  }
  if (path === '/api/dashboard') {
    if (failSummary) return respond(route, 503, {});
    return respond(route, 200, { summary: { workspaceCount: workspaces.length, taskCount: 8, completedCount: 3, myOpenCount: 2, myOverdueCount: 1 }, tasks: [{ ...task, workspaceName: workspaces[1].name }], page: 1, nextPage: null, asOf: new Date().toISOString() });
  }
  if (path === '/api/invitations') return respond(route, 200, { items: invitations, nextPage: null });
  if (path.endsWith('/accept')) {
    workspaces.push({ id: invitations[0].workspaceId, name: invitations[0].workspaceName, role: 'editor' });
    invitations = [];
    return respond(route, 200, {});
  }
  if (path === '/api/workspaces' && request.method() === 'POST') {
    if (failCreate) { failCreate = false; return respond(route, 503, {}); }
    const created = { id: '88888888-8888-4888-8888-888888888888', ...request.postDataJSON(), role: 'owner' };
    workspaces.unshift(created);
    return respond(route, 201, created);
  }
  if (path.endsWith('/tasks')) return respond(route, 200, { items: path.includes(task.workspaceId) ? [task, unassignedTask].filter((item) => item.status === url.searchParams.get('status')) : [], nextPage: null });
  if (path.endsWith(`/tasks/${task.id}`)) return respond(route, 200, task);
  if (path.endsWith('/canvas')) return respond(route, 200, { version: '1', nodes: [], edges: [] });
  if (/^\/api\/workspaces\/[^/]+\/members\/[^/]+$/.test(path)) {
    const memberId = path.split('/').at(-1);
    if (request.method() === 'PATCH') {
      managedMembers = managedMembers.map((member) => member.id === memberId ? { ...member, role: request.postDataJSON().role } : member);
      return respond(route, 200, { id: memberId, role: request.postDataJSON().role });
    }
    if (request.method() === 'DELETE') {
      managedMembers = managedMembers.filter((member) => member.id !== memberId);
      return respond(route, 200, { success: true });
    }
  }
  if (/^\/api\/workspaces\/[^/]+\/invitations$/.test(path) && request.method() === 'POST') return respond(route, 202, { status: 'processed' });
  if (path.endsWith('/members')) return respond(route, 200, { items: managedMembers.map((member) => ({ ...member, role: member.id === user.id ? 'owner' : member.role })), nextPage: null });
  return respond(route, 404, {});
});

try {
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Chào bạn, Hoàng Hiệp' }).waitFor();
  await page.getByRole('alert').getByText('Không tải được tổng quan. Hãy thử lại.').waitFor();
  failSummary = false;
  await page.getByRole('alert').getByRole('button', { name: 'Thử lại' }).click();
  await page.getByRole('button', { name: /Hoàn thiện luồng điều hướng/ }).waitFor();
  assert.equal(await page.locator('.dashboard-workspace').count(), 3);
  await page.getByRole('searchbox', { name: 'Tìm không gian làm việc' }).fill('không có tên này');
  await page.getByRole('heading', { name: 'Chưa tìm thấy không gian phù hợp' }).waitFor();
  await page.getByRole('searchbox', { name: 'Tìm không gian làm việc' }).fill('');
  await page.getByRole('link', { name: /Các không gian/ }).click();
  await page.getByRole('heading', { name: 'Các không gian', level: 1, exact: true }).waitFor();
  assert.equal(await page.locator('.dashboard-workspace').count(), 3);
  assert.equal(await page.locator('#dashboard-invitations').count(), 0);
  await page.getByRole('link', { name: 'Công việc được giao', exact: true }).click();
  await page.getByRole('heading', { name: 'Công việc được giao', level: 1, exact: true }).waitFor();
  assert.equal(await page.locator('.dashboard-workspace').count(), 0);
  await page.getByRole('link', { name: 'Lời mời', exact: true }).click();
  await page.getByRole('heading', { name: 'Lời mời', level: 1, exact: true }).waitFor();
  assert.equal(await page.locator('#dashboard-workspaces').count(), 0);
  await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-dashboard-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Chế độ sáng', exact: true }).click();
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-dashboard-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('heading', { name: 'Welcome, Hoàng Hiệp' }).waitFor();
  await page.getByRole('button', { name: 'VI', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-dashboard-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /Hoàn thiện luồng điều hướng/ }).click();
  await page.getByRole('textbox', { name: 'Tiêu đề' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Tiêu đề' }).inputValue(), task.title);
  await page.getByRole('button', { name: 'Đóng bảng chi tiết' }).click();
  const workspaceNavigation = page.getByRole('navigation', { name: 'Điều hướng không gian' });
  assert.equal(await workspaceNavigation.getByRole('button').count(), 4);
  assert.equal(await page.getByRole('button', { name: 'Tệp đính kèm', exact: true }).count(), 0);
  assert.equal(await page.getByText('5 người trực tuyến', { exact: true }).count(), 0);
  assert.equal(await page.locator('.kanban-card').count(), 2);
  const mine = page.getByRole('button', { name: 'Được giao cho tôi', exact: true });
  await mine.click();
  assert.equal(await mine.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.kanban-card').count(), 1);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  assert.equal(await page.locator('.kanban-card').count(), 1);
  await page.getByRole('button', { name: 'Xóa bộ lọc', exact: true }).click();
  assert.equal(await page.locator('.kanban-card').count(), 2);
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-navigation-workspace-light.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  const boardLink = await workspaceNavigation.getByRole('button', { name: 'Bảng công việc', exact: true }).boundingBox();
  assert.ok(boardLink && boardLink.x >= 0 && boardLink.y + boardLink.height <= 720);
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-navigation-laptop.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Bật Dark Mode', exact: true }).click();
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-navigation-workspace-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Mở điều hướng', exact: true }).click();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.workspace-sidebar').getBoundingClientRect().right <= 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  const mobileCanvas = await page.locator('.canvas-work-area').boundingBox();
  assert.ok(mobileCanvas && mobileCanvas.x + mobileCanvas.width <= 391, JSON.stringify(mobileCanvas));
  const zoomButton = await page.getByRole('button', { name: 'Phóng to', exact: true }).boundingBox();
  assert.ok(zoomButton && await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.canvas-zoom-controls')),
    { x: zoomButton.x + zoomButton.width / 2, y: zoomButton.y + zoomButton.height / 2 }));
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-navigation-mobile-canvas.png'), fullPage: true });
  await page.getByRole('button', { name: 'Mở điều hướng', exact: true }).click();
  await page.getByRole('button', { name: 'Bảng công việc', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Lời mời', exact: true }).click();
  await page.getByRole('heading', { name: 'Lời mời', level: 1, exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
  await page.getByRole('heading', { name: 'Chào bạn, Hoàng Hiệp' }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Bảng công việc', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
  await page.getByRole('button', { name: 'Chấp nhận', exact: true }).click();
  await page.getByRole('button', { name: 'Mở không gian Nhóm nghiên cứu' }).waitFor();
  await page.getByRole('button', { name: 'Tạo không gian làm việc', exact: true }).click();
  await page.getByLabel('Tên không gian').fill('Không gian mới');
  await page.getByRole('button', { name: 'Tạo không gian & Bắt đầu', exact: true }).click();
  await page.getByRole('alert').getByText('Không thể tạo. Hãy thử lại.').waitFor();
  assert.equal(await page.getByLabel('Tên không gian').inputValue(), 'Không gian mới');
  await page.getByRole('button', { name: 'Tạo không gian & Bắt đầu', exact: true }).click();
  await page.getByRole('heading', { name: 'Bảng công việc', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tổng quan', exact: true }).click();
  await page.getByRole('button', { name: 'Mở không gian Không gian mới' }).waitFor();
  await page.getByRole('link', { name: 'Tài khoản & Cài đặt', exact: true }).click();
  await page.getByRole('button', { name: 'Về tổng quan', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Về tổng quan', exact: true }).click();
  await page.getByRole('heading', { name: 'Chào bạn, Hoàng Hiệp' }).waitFor();
  await page.getByRole('button', { name: 'Mở không gian Đồ án CollabCanvas' }).click();
  await page.locator('.workspace-picker').click();
  await page.getByRole('button', { name: /Quản lý tất cả không gian làm việc/ }).click();
  await page.getByRole('button', { name: 'Quản lý thành viên' }).first().click();
  const membersDialog = page.getByRole('dialog', { name: 'Quản lý thành viên' });
  await membersDialog.getByText('An', { exact: true }).waitFor();
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-members-dialog-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: resolve(process.env.TEMP, 'collabcanvas-members-dialog-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await membersDialog.getByRole('combobox', { name: 'Vai trò: An' }).selectOption('viewer');
  await membersDialog.getByRole('status').getByText('Đã cập nhật vai trò.').waitFor();
  await membersDialog.getByRole('button', { name: 'Xóa khỏi nhóm' }).click();
  await membersDialog.getByRole('button', { name: 'Xác nhận xóa' }).click();
  await membersDialog.getByText('An', { exact: true }).waitFor({ state: 'detached' });
  await membersDialog.getByRole('textbox', { name: 'Mời thành viên' }).fill('member@example.test');
  await membersDialog.getByRole('button', { name: 'Gửi lời mời' }).click();
  await membersDialog.getByText('Đã xử lý lời mời. Tài khoản hợp lệ sẽ nhận được lời mời.').waitFor();
  assert.deepEqual(errors, []);
  console.log('Navigation UI passed: global pages, workspace sidebar, task scope and clear filters, account, drawer, canvas controls, landing, search, retry, task links, invitations, VI/EN, light/dark, desktop/laptop/mobile');
} finally {
  await browser.close();
}
