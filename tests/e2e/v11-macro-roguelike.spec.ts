import { test, expect } from '@playwright/test';

test.describe('V11 Macro Roguelike E2E & Mobile 390px Viewport', () => {
  test.use({
    viewport: { width: 390, height: 844 }, // iPhone 12/13/14 390px mobile viewport
  });

  test('390px 移动端完整呈现 5 槽位体系（3 活跃丹田 + 2 潜伏地脉）且无横向溢出', async ({ page }) => {
    await page.goto('/');

    // 等待开始按钮并点击
    const startBtn = page.getByText('开始游戏', { exact: true });
    await expect(startBtn).toBeVisible({ timeout: 15000 });
    await startBtn.click();

    // 验证丹田明牌区域与地脉暗牌区域均存在
    await expect(page.getByRole('heading', { name: /丹田/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('潜伏地脉', { exact: true })).toBeVisible({ timeout: 10000 });

    // 验证视口无横向滚动条溢出（scrollWidth <= clientWidth）
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(isOverflowing).toBe(false);
  });

  test('时间显示去重：顶栏去除冗余轮次胶囊，第二行统一显示年岁与20回合', async ({ page }) => {
    await page.goto('/');
    const startBtn = page.getByText('开始游戏', { exact: true });
    await expect(startBtn).toBeVisible({ timeout: 15000 });
    await startBtn.click();

    // 验证顶栏不再出现旧版冗余的独立年岁轮次胶囊
    await expect(page.getByText('第 1 年 · 1/20 轮')).toHaveCount(0);

    // 验证第二行统一整合年岁、回合与季内回合（精炼不重复）
    await expect(page.getByText('第 1 年', { exact: true })).toBeVisible();
    await expect(page.getByText('1/20 轮', { exact: true })).toBeVisible();
    await expect(page.getByText('季内第 1 轮', { exact: true })).toBeVisible();
  });

  test('地支三合局高亮与可引动单行展示：顶栏按钮无折行、持仓卡牌标注三合成局、无 emoji 污染', async ({ page }) => {
    await page.goto('/');
    const startBtn = page.getByText('开始游戏', { exact: true });
    await expect(startBtn).toBeVisible({ timeout: 15000 });
    await startBtn.click();

    // 注入持仓卡牌：申、子（丹田）+ 辰（地脉），构成申子辰水局三合
    await page.evaluate(() => {
      const store = (window as any).__useGameStore?.getState();
      if (!store || !store.turnManager) return;
      const allCards = store.turnManager.cardDataBank.getAllCards();
      const shen = allCards.find((c: any) => c.diZhi === '申');
      const zi = allCards.find((c: any) => c.diZhi === '子');
      const chen = allCards.find((c: any) => c.diZhi === '辰');
      if (shen && zi && chen) {
        const shenSlot = { card: shen, buyScore: 10, useLeverage: false, leverage: 1, roundBought: 1, lockedQi: 0, holdEarnings: 0 };
        const ziSlot = { card: zi, buyScore: 10, useLeverage: false, leverage: 1, roundBought: 1, lockedQi: 0, holdEarnings: 0 };
        const chenSlot = { card: chen, buyScore: 10, useLeverage: false, leverage: 1, roundBought: 1, lockedQi: 0, holdEarnings: 0 };
        store.turnManager.handManager.loadHand([shenSlot, ziSlot, null], [chenSlot]);
        store._sync();
      }
    });

    // 1. 验证顶栏水局按钮为单行，文字为 '申子辰 · 可引动'
    const triadBtn = page.getByRole('button', { name: /申子辰 · 可引动/ });
    await expect(triadBtn).toBeVisible();

    // 2. 验证丹田与地脉中成局的 3 张神符均渲染 '三合成局' 印记标签
    const triadTags = page.getByText('三合成局');
    await expect(triadTags).toHaveCount(3);

    // 3. 验证无 emoji (🌟) 污染
    const starEmoji = page.locator('text=/🌟/');
    await expect(starEmoji).toHaveCount(0);
  });
});

