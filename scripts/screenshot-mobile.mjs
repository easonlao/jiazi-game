import { chromium, devices } from 'playwright';

const url = 'http://127.0.0.1:4174/';
const out = 'D:/tmp/jiazi-mobile.png';

console.log('Launching browser...');
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
});
const page = await ctx.newPage();
console.log('Navigating to', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(1200);
const startBtn = page.getByRole('button', { name: /开始游戏|新游戏|start/i }).first();
if (await startBtn.count()) {
  console.log('Clicking start button...');
  await startBtn.click();
  await page.waitForTimeout(800);
}
await page.screenshot({ path: out, fullPage: false });
console.log('saved', out);
await browser.close();
