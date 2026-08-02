import { chromium, devices } from 'playwright';

const url = 'http://127.0.0.1:4174/';
const base = 'D:/tmp/jiazi-scroll';

console.log('Launching browser...');
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
});
const page = await ctx.newPage();
console.log('Navigating to', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(1200);

// 开始游戏
const startBtn = page.getByRole('button', { name: /开始游戏|新游戏|start/i }).first();
if (await startBtn.count()) {
  console.log('Clicking start button...');
  await startBtn.click();
  await page.waitForTimeout(800);
}

// 选中第一张公共牌
const firstCard = page.locator('.card-in').first();
if (await firstCard.count()) {
  console.log('Selecting first public card...');
  await firstCard.click();
  await page.waitForTimeout(400);
}

// 点买入 → 弹结算预览
const buyBtn = page.getByRole('button', { name: /买入/ }).first();
if (await buyBtn.isEnabled()) {
  console.log('Clicking buy...');
  await buyBtn.click();
  await page.waitForTimeout(600);
  const confirmBtn = page.getByRole('button', { name: '确认结束本回合' });
  if (await confirmBtn.count()) {
    console.log('Confirming buy...');
    await confirmBtn.click();
    await page.waitForTimeout(900);
  }
}

// 场景 1：初始视口（顶部）—— 检查 ActionBar 是否吸底可见
await page.screenshot({ path: `${base}-top.png`, fullPage: false });
console.log('saved top');

// 场景 2：滚动到底部 —— 验证内容可滚动 + ActionBar 仍吸底
const shell = page.locator('[data-game-shell]');
const scrollable = await shell.evaluate((el) => ({
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
}));
console.log('scroll info:', JSON.stringify(scrollable));
if (scrollable.scrollHeight > scrollable.clientHeight) {
  await shell.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${base}-bottom.png`, fullPage: false });
  console.log('saved bottom');
}

// 场景 3：fullPage 整体高度
await shell.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(300);
await page.screenshot({ path: `${base}-full.png`, fullPage: true });
console.log('saved full');

await browser.close();
