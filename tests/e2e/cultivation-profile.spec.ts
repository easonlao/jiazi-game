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

    await page.route('**/rest/v1/cultivation_ledger_entries*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            player_id: 'player-1',
            local_game_id: 'cloud-v4-first',
            game_session_id: 'sess-1',
            rules_version: 4,
            started_at: '2026-08-02T09:00:00.000Z',
            ended_at: '2026-08-02T09:40:00.000Z',
            outcome: 'completed',
            final_score: 78.4,
            record_source: 'verified_session',
            created_at: '2026-08-02T09:40:00.000Z',
            updated_at: '2026-08-02T09:40:00.000Z',
          },
          {
            player_id: 'player-1',
            local_game_id: 'cloud-v4-mid',
            game_session_id: 'sess-2',
            rules_version: 4,
            started_at: '2026-08-03T09:00:00.000Z',
            ended_at: '2026-08-03T09:50:00.000Z',
            outcome: 'completed',
            final_score: 100.2,
            record_source: 'verified_session',
            created_at: '2026-08-03T09:50:00.000Z',
            updated_at: '2026-08-03T09:50:00.000Z',
          },
          {
            player_id: 'player-1',
            local_game_id: 'cloud-v4-latest',
            game_session_id: 'sess-3',
            rules_version: 4,
            started_at: '2026-08-04T09:00:00.000Z',
            ended_at: '2026-08-04T09:40:00.000Z',
            outcome: 'completed',
            final_score: 96.7,
            record_source: 'verified_session',
            created_at: '2026-08-04T09:40:00.000Z',
            updated_at: '2026-08-04T09:40:00.000Z',
          },
          {
            player_id: 'player-1',
            local_game_id: 'cloud-v6',
            game_session_id: 'sess-4',
            rules_version: 6,
            started_at: '2026-08-05T09:00:00.000Z',
            ended_at: '2026-08-05T09:55:00.000Z',
            outcome: 'completed',
            final_score: 88.8,
            record_source: 'verified_session',
            created_at: '2026-08-05T09:55:00.000Z',
            updated_at: '2026-08-05T09:55:00.000Z',
          },
          {
            player_id: 'player-1',
            local_game_id: 'cloud-v4-abandoned',
            game_session_id: 'sess-5',
            rules_version: 4,
            started_at: '2026-08-06T09:00:00.000Z',
            ended_at: '2026-08-06T09:10:00.000Z',
            outcome: 'abandoned',
            final_score: null,
            record_source: 'verified_session',
            created_at: '2026-08-06T09:10:00.000Z',
            updated_at: '2026-08-06T09:10:00.000Z',
          },
        ]),
      });
    });

    await page.goto('/?rules=v4');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('可从开始页打开面向已立档玩家的修行档案，且无认领按钮', async ({ page }) => {
    const profileBtn = page.getByRole('button', { name: '查看修行档案' }).first();
    await expect(profileBtn).toBeVisible({ timeout: 15_000 });
    await expect(profileBtn.getByText('归档修士的修行档案')).toBeVisible();
    await expect(profileBtn.getByText('5 局')).toBeVisible();
    await profileBtn.click();

    const modal = page.locator('.modal-backdrop').filter({ has: page.getByRole('dialog', { name: '归档修士的成长' }) });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('已立档').first()).toBeVisible();
    await expect(modal.getByText('已走过', { exact: true })).toBeVisible();
    await expect(modal.getByText('5 局', { exact: true })).toBeVisible();
    await expect(modal.getByText('这套玩法的成绩', { exact: true })).toBeVisible();
    await expect(modal.getByText('目前最佳修为', { exact: true })).toBeVisible();
    await expect(modal.getByText('修行坚持度', { exact: true })).toBeVisible();
    await expect(modal.getByText('道心坚持度', { exact: true })).toBeVisible();
    await expect(modal.getByText('当前连续完整', { exact: true })).toBeVisible();
    await expect(modal.getByText('历史最高连续', { exact: true })).toBeVisible();
    await expect(modal.getByText('最近修为走势', { exact: true })).toBeVisible();
    await expect(modal.getByRole('img', { name: '最近 3 局修为走势，从 78.4 到 100.2' })).toBeVisible();
    await expect(modal.getByText('修行印记', { exact: true })).toBeVisible();
    await expect(modal.getByText('首次开局', { exact: true })).toBeVisible();
    await expect(modal.getByText('首次完成一甲子', { exact: true })).toBeVisible();
    await expect(modal.getByText('累计完成局数', { exact: true })).toBeVisible();
    await expect(modal.getByText('当前规则个人纪录', { exact: true })).toBeVisible();
    await expect(modal.getByText('把成长带到其他设备', { exact: true })).toBeVisible();
    await expect(modal.getByText('已连接 · 自动同步')).toBeVisible();
    await expect(modal.getByRole('button', { name: /保存.*成长记录/ })).toHaveCount(0);

    await modal.getByRole('button', { name: '关闭' }).click();
    await expect(modal).toBeHidden();
  });

  test('游客未立档时开始页与弹窗明确提示本机试玩，且引导立档', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('jiazi_consent');
      localStorage.removeItem('jiazi_player_identity');
      localStorage.removeItem('jiazi_cultivation_ledger');
    });

    await page.goto('/?rules=v4');
    const profileBtn = page.getByRole('button', { name: '查看修行档案' }).first();
    await expect(profileBtn).toBeVisible({ timeout: 15_000 });
    await expect(profileBtn.getByText('本机试玩（未立档）')).toBeVisible();
    await expect(profileBtn.getByText('未立档', { exact: true })).toBeVisible();
    await profileBtn.click();

    const modal = page.locator('.modal-backdrop').filter({ has: page.getByRole('dialog', { name: '本机试玩成长' }) });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('本机试玩').first()).toBeVisible();
    await expect(modal.getByText('当前为本机试玩模式。立档后，新对局将自动累计至可跨设备查看的修行记录。')).toBeVisible();
    await expect(modal.getByText('完成立档（开启跨设备记录）')).toBeVisible();
    await expect(modal.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible();
    await expect(modal.getByRole('button', { name: /保存.*成长记录/ })).toHaveCount(0);
  });

  test('游客模式下只存在旧版排行榜数据时，本地试玩局不贡献账号成长与里程碑，弹窗引导立档', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('jiazi_consent');
      localStorage.removeItem('jiazi_player_identity');
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

    const modal = page.locator('.modal-backdrop').filter({ has: page.getByRole('dialog', { name: '本机试玩成长' }) });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('已走过', { exact: true })).toBeVisible();
    await expect(modal.getByText('0 局').first()).toBeVisible();
    await expect(modal.getByText('完成立档（开启跨设备记录）')).toBeVisible();
    await expect(modal.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible();
    await expect(modal.getByRole('button', { name: /保存.*成长记录/ })).toHaveCount(0);
  });
});
