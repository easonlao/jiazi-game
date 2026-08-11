import { test, expect } from '@playwright/test';

test.describe('Supabase 匿名身份与遥测', () => {
  test.skip(
    process.env.E2E_SUPABASE !== '1',
    '需要设置 E2E_SUPABASE=1，并提供 app/.env.local 后运行真实云端验收',
  );

  test('V4 新局等待服务端 seed，并在完整 60 回合后校验入榜', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    await expect(page.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '同意并生成玩家 ID' }).click();

    await expect(page.getByText('恢复码，请妥善保存', { exact: true })).toBeVisible({ timeout: 20_000 });
    const nameInput = page.getByLabel('修改玩家名称');
    await nameInput.fill('E2E测试');
    const nameUpdateResponse = page.waitForResponse(
      (response) => response.url().includes('/rest/v1/player_profiles') &&
        response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: '保存玩家名称' }).click();
    expect((await nameUpdateResponse).ok()).toBe(true);
    await expect(page.getByText('E2E测试', { exact: true })).toBeVisible({ timeout: 10_000 });

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

    const publicCardContainer = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..');
    await publicCardContainer.locator('.card-in').first().click();
    await page.getByRole('button', { name: /纳灵/ }).click();
    const actionUploadResponse = page.waitForResponse(
      (response) => response.url().includes('/rest/v1/game_events') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '确认结束本回合' }).click();
    await expect(page.getByText('纳灵成功', { exact: true })).toBeVisible({ timeout: 10_000 });
    expect((await actionUploadResponse).ok()).toBe(true);

    // 第 2—59 回合全部调息；每次确认后直接推进到下一回合。
    for (let round = 2; round <= 59; round++) {
      const waitButton = page.getByRole('button', { name: /调息/ });
      await expect(waitButton).toBeVisible({ timeout: 10_000 });
      await waitButton.click();
      const confirmButton = page.getByRole('button', { name: '确认结束本回合' });
      await expect(confirmButton).toBeVisible({ timeout: 10_000 });
      await confirmButton.click();
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
      rules_version: '4',
    });

    // 响应丢失后的重复提交必须幂等成功；若首次榜单插入曾失败，服务端会在这里补插。
    const originalHeaders = submitResponse.request().headers();
    const retryResponse = await page.request.post(submitResponse.url(), {
      headers: {
        apikey: originalHeaders.apikey,
        authorization: originalHeaders.authorization,
        'content-type': 'application/json',
      },
      data: { session_id: startResult.session_id, actions: [] },
    });
    expect(retryResponse.ok()).toBe(true);
    expect(await retryResponse.json()).toMatchObject({
      verified: true,
      leaderboard_submitted: true,
      rules_version: '4',
    });

    const gameOverModal = page.locator('.modal-backdrop').filter({ hasText: '最终修为' });
    await expect(gameOverModal).toBeVisible({ timeout: 15_000 });
    await expect(gameOverModal.getByText(/已校验.*已计入云端榜/)).toBeVisible({ timeout: 20_000 });

    // 测试数据保留供链路审计，但把昵称恢复为占位名，触发资格门禁并从公共榜隐藏。
    const playerId = await page.evaluate(() => {
      const raw = localStorage.getItem('jiazi_player_identity');
      return raw ? (JSON.parse(raw) as { player_id?: string }).player_id : undefined;
    });
    expect(playerId).toBeTruthy();
    const functionUrl = new URL(submitResponse.url());
    const cleanupResponse = await page.request.patch(
      `${functionUrl.origin}/rest/v1/player_profiles?id=eq.${encodeURIComponent(playerId!)}`,
      {
        headers: {
          apikey: originalHeaders.apikey,
          authorization: originalHeaders.authorization,
          'content-type': 'application/json',
        },
        data: { display_name: '玩家' },
      },
    );
    expect(cleanupResponse.ok()).toBe(true);
  });
});
