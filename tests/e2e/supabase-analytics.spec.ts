import { test, expect } from '@playwright/test';

test.describe('Supabase 匿名身份与遥测', () => {
  test.skip(
    process.env.E2E_SUPABASE !== '1',
    '需要设置 E2E_SUPABASE=1，并提供 app/.env.local 后运行真实云端验收',
  );

  test('同意记录、生成身份、修改名称并上传一回合行动', async ({ page }) => {
    await page.goto('/?volatility=1');

    await expect(page.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '同意并生成玩家 ID' }).click();

    await expect(page.getByText('恢复码，请妥善保存', { exact: true })).toBeVisible({ timeout: 20_000 });
    const nameInput = page.getByLabel('修改玩家名称');
    await nameInput.fill('E2E测试');
    await page.getByRole('button', { name: '保存玩家名称' }).click();
    await expect(page.getByText('E2E测试', { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '开始游戏' }).click();
    const publicCardContainer = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..');
    await publicCardContainer.locator('.card-in').first().click();
    await page.getByRole('button', { name: /纳灵/ }).click();
    await page.getByRole('button', { name: '确认结束本回合' }).click();
    await expect(page.getByText('纳灵成功', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 让队列完成一次 best-effort 上传；SQL 级别的行校验在发布验收中执行。
    await page.waitForTimeout(2_000);
  });
});
