import { test, expect } from '@playwright/test';
import { selectPublicCard } from './public-card-history';

test.describe('Supabase 匿名身份与遥测', () => {
  test.skip(
    process.env.E2E_SUPABASE !== '1',
    '需要设置 E2E_SUPABASE=1，并提供 app/.env.local 后运行真实云端验收',
  );

  test('V7 新局等待服务端 seed，并在完整 60 回合后校验入榜（2026-08-17 生产默认翻转为 V7 trend_window）', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/?rules=v7');

    await expect(page.getByRole('button', { name: '查看修行档案' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '查看修行档案' }).first().click();

    await expect(page.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '同意并生成玩家 ID' }).click();

    await expect(page.getByText('恢复码（换设备找回凭据，请妥善保存）')).toBeVisible({ timeout: 20_000 });
    const nameInput = page.getByPlaceholder('修改道号（1-12 字）');
    await nameInput.fill('E2E测试');
    const nameUpdateResponse = page.waitForResponse(
      (response) => response.url().includes('/rest/v1/player_profiles') &&
        response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存' }).click();
    const nameUpdateResult = await nameUpdateResponse;
    expect(nameUpdateResult.ok()).toBe(true);
    // 服务端确认：PATCH 返回 DB 触发器重算后的资格，必须已具备云端上榜资格。
    const nameUpdateJson = await nameUpdateResult.json() as { leaderboard_eligible?: boolean };
    expect(nameUpdateJson.leaderboard_eligible).toBe(true);
    await expect(page.getByText('E2E测试', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('可进入云端榜')).toBeVisible({ timeout: 10_000 });

    // 关闭修行档案弹窗返回开始页
    await page.getByRole('button', { name: '关闭' }).click();

    // 延迟真实 start-verified-session 响应，验证 UI 会等待 server seed，
    // 而不是在请求未完成时静默开启不可校验的本地局。
    await page.route('**/functions/v1/start-verified-session', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    const verifiedStartResponse = page.waitForResponse(
      (response) => response.url().includes('/functions/v1/start-verified-session'),
    );
    await page.getByRole('button', { name: '开始游戏' }).click();
    await expect(page.getByRole('button', { name: '正在连接云端…' })).toBeDisabled();
    await expect(page.getByText('周遭灵气')).toHaveCount(0);
    const startResponse = await verifiedStartResponse;
    expect(startResponse.ok()).toBe(true);
    const startResult = await startResponse.json() as { session_id?: string };
    expect(startResult.session_id).toBeTruthy();

    await selectPublicCard(page);
    await page.getByRole('button', { name: /纳灵/ }).click();
    const actionUploadResponse = page.waitForResponse(
      (response) => response.url().includes('/rest/v1/game_events') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '确认结束本回合' }).click();
    // V5/V6：若本回合恰好抽入空亡，空亡 Toast 覆盖纳灵 Toast（P1-1 语义空亡最后写入）
    await expect(page.getByText(/纳灵成功|空亡触发/).first()).toBeVisible({ timeout: 10_000 });
    expect((await actionUploadResponse).ok()).toBe(true);

    // 推进到终局：V6/V7 循环调息直到「结束游戏」按钮出现（第 60 回合终局）。
    for (let round = 2; round <= 60; round++) {
      const endBtn = page.getByRole('button', { name: '结束游戏' });
      if (await endBtn.isVisible({ timeout: 2_000 }).catch(() => false)) break;
      const waitButton = page.getByRole('button', { name: /调息/ });
      const canWait = await waitButton.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!canWait) {
        if (await endBtn.isVisible({ timeout: 10_000 }).catch(() => false)) break;
      }
      await waitButton.click();
      const confirmButton = page.getByRole('button', { name: '确认结束本回合' });
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });
      await confirmButton.click();
      await page.waitForTimeout(50);
    }

    // 第 60 回合触发终局，并等待真实 submit-verified-score 返回。
    const submitResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/functions/v1/submit-verified-score') &&
        response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    const endButton = page.getByRole('button', { name: '结束游戏' });
    await expect(endButton).toBeVisible({ timeout: 10_000 });
    await endButton.click();
    const finalConfirmButton = page.getByRole('button', { name: '确认结束本回合' });
    await expect(finalConfirmButton).toBeVisible({ timeout: 10_000 });
    await finalConfirmButton.click();

    const submitResponse = await submitResponsePromise;
    expect(submitResponse.ok()).toBe(true);
    const result = await submitResponse.json() as {
      verified?: boolean;
      leaderboard_submitted?: boolean;
      rules_version?: string;
    };
    expect(result).toMatchObject({
      verified: true,
      leaderboard_submitted: true,
      rules_version: '7',
    });

    // 终局后，GameOverModal 会展示校验结果
    await expect(page.getByText(/已校验.*已计入云端榜/)).toBeVisible({ timeout: 15_000 });

    // 点击「排行榜」，验证已成功写入并渲染
    await page.getByRole('button', { name: '排行榜' }).click();
    await expect(page.getByRole('dialog', { name: '排行榜' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '排行榜' }).getByText('E2E测试').first()).toBeVisible({ timeout: 10_000 });
  });
});
