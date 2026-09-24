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

    // 验证第二行统一整合年岁、回合与季内回合
    await expect(page.getByText('第 1 年', { exact: true })).toBeVisible();
    await expect(page.getByText('第 1 回合 / 20', { exact: true })).toBeVisible();
    await expect(page.getByText('季内第 1 回合', { exact: true })).toBeVisible();
  });
});
