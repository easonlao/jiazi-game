import { test, expect } from '@playwright/test';

test.describe('修行档案', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'jiazi_consent',
        JSON.stringify({ version: 1, granted: true, granted_at: '2026-08-26T00:00:00.000Z' }),
      );
      localStorage.setItem(
        'jiazi_player_identity',
        JSON.stringify({
          player_id: 'player-1',
          public_player_id: 'public-player-1',
          public_code: 'ABCD1234',
          display_name: '归档修士',
          leaderboard_eligible: true,
        }),
      );
      localStorage.setItem(
        'jiazi_cultivation_ledger',
        JSON.stringify({
          version: 1,
          activeGameId: null,
          records: [
            {
              id: 'local-active',
              rulesVersion: 4,
              startedAt: '2026-08-01T09:00:00.000Z',
              endedAt: null,
              outcome: 'active',
              finalScore: null,
            },
            {
              id: 'local-v4-first',
              rulesVersion: 4,
              startedAt: '2026-08-02T09:00:00.000Z',
              endedAt: '2026-08-02T09:40:00.000Z',
              outcome: 'completed',
              finalScore: 78.4,
            },
            {
              id: 'local-v4',
              rulesVersion: 4,
              startedAt: '2026-08-03T09:00:00.000Z',
              endedAt: '2026-08-03T09:40:00.000Z',
              outcome: 'completed',
              finalScore: 100.2,
            },
            {
              id: 'local-v4-latest',
              rulesVersion: 4,
              startedAt: '2026-08-04T09:00:00.000Z',
              endedAt: '2026-08-04T09:40:00.000Z',
              outcome: 'completed',
              finalScore: 96.7,
            },
            {
              id: 'local-v6',
              rulesVersion: 6,
              startedAt: '2026-08-05T09:00:00.000Z',
              endedAt: '2026-08-05T09:55:00.000Z',
              outcome: 'completed',
              finalScore: 88.8,
            },
          ],
        }),
      );
    });

    await page.goto('/?rules=v4');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('可从开始页打开面向玩家的修行档案', async ({ page }) => {
    await expect(page.getByRole('button', { name: '查看修行档案' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '查看修行档案' }).first().click();

    const modal = page.locator('.modal-backdrop').filter({ has: page.getByRole('dialog', { name: '归档修士的成长' }) });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('已走过', { exact: true })).toBeVisible();
    await expect(modal.getByText('5 局', { exact: true })).toBeVisible();
    await expect(modal.getByText('这套玩法的成绩', { exact: true })).toBeVisible();
    await expect(modal.getByText('目前最佳修为', { exact: true })).toBeVisible();
    await expect(modal.getByText('目前最佳修为', { exact: true }).locator('..').getByText('100.2', { exact: true })).toBeVisible();
    await expect(modal.getByText('最近修为走势', { exact: true })).toBeVisible();
    await expect(modal.getByRole('img', { name: '最近 3 局修为走势，从 78.4 到 100.2' })).toBeVisible();
    await expect(modal.getByText('修行印记', { exact: true })).toBeVisible();
    await expect(modal.getByText('首次开局', { exact: true })).toBeVisible();
    await expect(modal.getByText('首次完成一甲子', { exact: true })).toBeVisible();
    await expect(modal.getByText('累计完成局数', { exact: true })).toBeVisible();
    await expect(modal.getByText('当前规则个人纪录', { exact: true })).toBeVisible();
    await expect(modal.getByText('把成长带到其他设备', { exact: true })).toBeVisible();
    await expect(modal.getByRole('button', { name: /保存这 4 局成长记录/ })).toBeVisible();

    await modal.getByRole('button', { name: '关闭' }).click();
    await expect(modal).toBeHidden();
  });

  test('只存在旧版排行榜数据时自动升级并在修行档案中展示成绩与印记', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('jiazi_cultivation_ledger');
      localStorage.setItem(
        'jiazi_leaderboard',
        JSON.stringify([
          { score: 2460.0, date: '2026-08-23', rulesVersion: 4 },
        ]),
      );
    });

    await page.goto('/?rules=v4');
    await expect(page.getByRole('button', { name: '查看修行档案' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '查看修行档案' }).first().click();

    const modal = page.locator('.modal-backdrop').filter({ has: page.getByRole('dialog', { name: '归档修士的成长' }) });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('已走过', { exact: true })).toBeVisible();
    await expect(modal.getByText('1 局', { exact: true })).toBeVisible();
    await expect(modal.getByText('目前最佳修为', { exact: true }).locator('..').getByText('2460.0', { exact: true })).toBeVisible();
    await expect(modal.getByText('首次开局', { exact: true })).toBeVisible();
    await expect(modal.getByText('首次完成一甲子', { exact: true })).toBeVisible();
    await expect(modal.getByText('当前规则个人纪录', { exact: true })).toBeVisible();
  });
});
