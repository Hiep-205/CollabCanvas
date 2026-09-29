import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ headless: true, ...(existsSync(chromePath) ? { executablePath: chromePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => {
  if (!sessionStorage.getItem('smoke-initialized')) {
    localStorage.setItem('collabcanvas.theme', 'light');
    localStorage.setItem('collabcanvas.locale', 'vi');
    sessionStorage.setItem('smoke-initialized', '1');
  }
});

await page.goto(process.env.FRONTEND_URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'smoke-desktop.png', fullPage: true });
const before = await page.locator('.react-flow__node').count();
await page.getByRole('button', { name: 'Thêm ghi chú' }).click();
await page.getByRole('textbox', { name: 'Nội dung' }).fill('Ghi chú kiểm thử');
await page.locator('.react-flow__node[data-id="task-node-demo"]').click();
await page.getByLabel('Trạng thái').selectOption('DONE');
await page.waitForTimeout(650);
await page.getByRole('button', { name: 'Chế độ tối' }).click();
await page.getByRole('button', { name: 'EN' }).click();
const theme = await page.locator('html').getAttribute('data-theme');
const language = await page.locator('html').getAttribute('lang');
await page.screenshot({ path: 'smoke-dark.png', fullPage: true });
await page.reload({ waitUntil: 'networkidle' });
const persistedTheme = await page.locator('html').getAttribute('data-theme');
const persistedLanguage = await page.locator('html').getAttribute('lang');
const after = await page.locator('.react-flow__node').count();
const persisted = await page.getByText('Ghi chú kiểm thử').count();
const taskPersisted = await page.locator('.react-flow__node[data-id="task-node-demo"] .status-DONE').count();
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const panel = await page.locator('.detail-panel').evaluate((element) => ({ className: element.className, transform: getComputedStyle(element).transform, rect: element.getBoundingClientRect().toJSON() }));
await page.screenshot({ path: 'smoke-mobile.png', fullPage: true });
await page.setViewportSize({ width: 320, height: 700 });
await page.reload({ waitUntil: 'networkidle' });
const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
await page.screenshot({ path: 'smoke-small.png', fullPage: true });
console.log(JSON.stringify({ before, after, persisted, taskPersisted, theme, language, persistedTheme, persistedLanguage, panel, horizontalOverflow, errors }));
await browser.close();
if (before !== 2 || after !== 3 || persisted < 1 || taskPersisted !== 1 || theme !== 'dark' || language !== 'en' || persistedTheme !== 'dark' || persistedLanguage !== 'en' || panel.rect.left < 390 || horizontalOverflow || errors.length) process.exitCode = 1;
