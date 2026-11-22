import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

let loggedIn = true;
const user = { id: '11111111-1111-4111-8111-111111111111', displayName: 'Hoàng Hiệp', email: 'hiep@example.test' };

const myWorkspace = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Đồ án CollabCanvas',
  description: 'Không gian làm việc chính',
  role: 'owner',
};

const outsiderWorkspaceId = '33333333-3333-4333-8333-333333333333';

const task1 = {
  id: '55555555-5555-4555-8555-555555555555',
  workspaceId: myWorkspace.id,
  title: 'Xây dựng tính năng sao chép liên kết task',
  status: 'in_progress',
  priority: 'high',
  description: 'Chi tiết permalink deep-link',
  blockedReason: null,
  dueAt: '2099-12-01T00:00:00Z',
  sortOrder: '0',
  version: '1',
  assigneeIds: [user.id],
  checklist: [],
};

const task2 = {
  id: '66666666-6666-4666-8666-666666666666',
  workspaceId: myWorkspace.id,
  title: 'Kiểm thử toàn diện kịch bản permalink',
  status: 'todo',
  priority: 'normal',
  description: null,
  blockedReason: null,
  dueAt: null,
  sortOrder: '1',
  version: '1',
  assigneeIds: [],
  checklist: [],
};

const tasks = [task1, task2];

const respond = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

await page.route('**/api/**', async (route) => {
  const req = route.request();
  const path = new URL(req.url()).pathname;
  const method = req.method();

  if (path === '/api/auth/me') {
    return respond(route, loggedIn ? 200 : 401, loggedIn ? user : { message: 'Unauthorized' });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    loggedIn = true;
    return respond(route, 200, user);
  }

  if (path === '/api/workspaces' && method === 'GET') {
    return respond(route, 200, { items: loggedIn ? [myWorkspace] : [], nextPage: null });
  }

  if (path === '/api/dashboard') {
    return respond(route, 200, {
      summary: { workspaceCount: 1, taskCount: 2, completedCount: 0, myOpenCount: 1, myOverdueCount: 0 },
      tasks: [task1],
      page: 1,
      nextPage: null,
      asOf: new Date().toISOString(),
    });
  }

  if (path === '/api/invitations') {
    return respond(route, 200, { items: [], nextPage: null });
  }

  if (path.endsWith('/tasks') && method === 'GET') {
    const url = new URL(req.url());
    const statusFilter = url.searchParams.get('status');
    const filtered = statusFilter ? tasks.filter((t) => t.status === statusFilter) : tasks;
    return respond(route, 200, { items: filtered, nextPage: null });
  }

  if (path.endsWith(`/tasks/${task1.id}`)) return respond(route, 200, task1);
  if (path.endsWith(`/tasks/${task2.id}`)) return respond(route, 200, task2);

  if (path.endsWith('/canvas')) {
    return respond(route, 200, { version: '1', nodes: [], edges: [] });
  }

  if (path.endsWith('/members')) {
    return respond(route, 200, { items: [{ id: user.id, email: user.email, displayName: user.displayName, role: 'owner' }], nextPage: null });
  }

  return respond(route, 404, {});
});

console.log('--- BẮT ĐẦU KIỂM THỬ E2E CHO MILESTONE 1.5 ---');

try {
  // ==========================================
  // Test 1: Direct Deep-Link to existing task
  // ==========================================
  console.log('[Test 1] Truy cập trực tiếp permalink: #/workspaces/:id?task=:taskId');
  await page.goto(`http://localhost:5173/#/workspaces/${myWorkspace.id}?task=${task1.id}`, { waitUntil: 'networkidle' });

  // Verify workspace header is shown
  await page.getByText(myWorkspace.name).first().waitFor({ timeout: 5000 });

  // Verify task inspector drawer opens automatically with task1 title
  const drawer = page.locator('.detail-inspector-drawer');
  await drawer.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(await drawer.getByText(task1.title).isVisible(), 'Inspector drawer should display task title');
  console.log('  -> Đạt: Workspace mở đúng và Task Inspector tự động hiển thị task đích.');

  // ==========================================
  // Test 2: Copy Task Link button & Feedback
  // ==========================================
  console.log('[Test 2] Nút "Sao chép liên kết" và phản hồi clipboard');
  const copyBtn = drawer.getByRole('button', { name: 'Sao chép liên kết' });
  await copyBtn.waitFor({ state: 'visible', timeout: 5000 });
  await copyBtn.click();

  // Visual feedback: button text should change to "Đã sao chép!"
  await drawer.getByText('Đã sao chép!').waitFor({ state: 'visible', timeout: 2000 });
  console.log('  -> Đạt: Nút đổi trạng thái thành "Đã sao chép!".');

  // Verify clipboard content
  const clipboardText = await page.evaluate(() => window.navigator.clipboard.readText());
  const expectedUrl = `http://localhost:5173/#/workspaces/${myWorkspace.id}?task=${task1.id}`;
  assert.equal(clipboardText, expectedUrl, `Clipboard should match permalink URL: ${expectedUrl}`);
  console.log(`  -> Đạt: Clipboard lưu đúng URL permalink (${clipboardText}).`);

  // Wait 2.1s and verify it reverts to "Sao chép liên kết"
  await page.waitForTimeout(2100);
  assert.ok(await drawer.getByRole('button', { name: 'Sao chép liên kết' }).isVisible(), 'Copy button should revert to original label after 2s');
  console.log('  -> Đạt: Nút tự động trở về nhãn "Sao chép liên kết" sau 2 giây.');

  // ==========================================
  // Test 3: Invalid Task ID in Permalink
  // ==========================================
  console.log('[Test 3] Mở permalink với ID công việc không tồn tại');
  await page.goto(`http://localhost:5173/#/workspaces/${myWorkspace.id}?task=non-existent-task-999`, { waitUntil: 'networkidle' });
  await page.getByText(myWorkspace.name).first().waitFor({ timeout: 5000 });

  // Check notice banner
  const noticeBanner = page.getByText('Không tìm thấy công việc theo liên kết hoặc công việc đã bị xóa.');
  await noticeBanner.waitFor({ state: 'visible', timeout: 5000 });
  console.log('  -> Đạt: Hiển thị đúng banner thông báo "Không tìm thấy công việc theo liên kết hoặc công việc đã bị xóa."');

  // ==========================================
  // Test 4: Outsider Workspace Access Denied
  // ==========================================
  console.log('[Test 4] Truy cập workspace không có quyền truy cập');
  await page.goto(`http://localhost:5173/#/workspaces/${outsiderWorkspaceId}?task=some-task-id`, { waitUntil: 'networkidle' });

  // Should redirect to Dashboard and show accessDenied alert
  await page.waitForURL((url) => url.hash.includes('/dashboard'), { timeout: 5000 });
  console.log('  URL after redirect:', page.url());
  const alertBanner = page.getByRole('alert').getByText('Bạn không có quyền truy cập không gian này hoặc liên kết không hợp lệ.');
  await alertBanner.waitFor({ state: 'visible', timeout: 5000 });
  console.log('  -> Đạt: Tự động điều hướng về Dashboard và hiển thị alert cảnh báo từ chối truy cập.');

  // ==========================================
  // Test 5: Deep-Link Preservation Across Login
  // ==========================================
  console.log('[Test 5] Bảo toàn deep-link khi người dùng chưa đăng nhập');
  loggedIn = false; // Simulate unauthenticated
  await page.goto(`http://localhost:5173/#/workspaces/${myWorkspace.id}?task=${task2.id}`);
  await page.reload({ waitUntil: 'networkidle' });

  // Should display Login form
  await page.getByRole('heading', { name: 'Chào mừng trở lại!' }).waitFor({ state: 'visible', timeout: 5000 });
  console.log('  -> Đạt: Màn hình hiển thị form Đăng nhập ("Chào mừng trở lại!") khi chưa xác thực.');

  // Fill in email & password and log in
  await page.locator('#email').fill('hiep@example.test');
  await page.locator('#password').fill('super-secure-password-123');
  await page.getByRole('button', { name: 'Đăng nhập vào Canvas' }).click();

  // After login, should NOT go to default dashboard, but navigate directly to myWorkspace and open task2!
  await page.waitForURL((url) => url.hash.includes(myWorkspace.id), { timeout: 5000 });
  await drawer.getByText(task2.title).waitFor({ state: 'visible', timeout: 5000 });
  console.log(`  -> Đạt: Sau khi đăng nhập, hệ thống tự động đưa vào đúng Workspace và mở ngay task mục tiêu (${task2.title})!`);

  console.log('--- TẤT CẢ 5/5 KỊCH BẢN E2E ĐÃ PASS 100% ---');
} finally {
  await browser.close();
  if (errors.length > 0) {
    console.error('Page errors encountered:', errors);
    process.exit(1);
  }
}
