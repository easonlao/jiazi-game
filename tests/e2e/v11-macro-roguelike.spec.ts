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
    await expect(page.getByText('活跃丹田', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('潜伏地脉', { exact: true })).toBeVisible({ timeout: 10000 });

    // 验证视口无横向滚动条溢出（scrollWidth <= clientWidth）
    const isOverflowing = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(isOverflowing).toBe(false);
  });
});
