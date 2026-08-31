import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { selectPublicCard } from './public-card-history';

test.describe('Supabase 匿名身份与遥测', () => {
  test.skip(
    process.env.E2E_SUPABASE !== '1',
    '需要设置 E2E_SUPABASE=1，并提供 app/.env.local 后运行真实云端验收',
  );

  test.beforeEach(async ({ page, context }) => {
    // 注入 E2E 标记以允许客户端测试钩子暴露 window.__SUPABASE_CLIENT__
    await page.addInitScript(() => {
      (window as any).__JIAZI_E2E__ = true;
    });
    await context.clearCookies();
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test('V10 新局等待服务端 seed，并在完整 60 回合后校验入榜（干支关系响应生产默认）', async ({ page }) => {
    // 真实云端的 60 回合会串行上传事件；跨区域网络下 240 秒不足以覆盖最慢一次完整链路。
    test.setTimeout(420_000);
    await page.goto('/');

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

    // 关闭修行档案弹窗返回开始页
    await page.getByRole('button', { name: '关闭' }).click();

    const startVerifiedResponse = page.waitForResponse(
      (response) => response.url().includes('/functions/v1/start-verified-session') &&
        response.request().method() === 'POST',
      { timeout: 60_000 },
    );

    const startButton = page.getByRole('button', { name: '开始游戏' });
    await expect(startButton).toBeVisible({ timeout: 10_000 });
    await startButton.click();

    const confirmOverrideBtn = page.getByRole('button', { name: '确定开启新局' });
    if (await confirmOverrideBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirmOverrideBtn.click();
    }

    // 关键断言 1：客户端等待并成功接收 start-verified-session 返回的 V10 规则快照与 seed。
    const startRes = await startVerifiedResponse;
    if (!startRes.ok()) {
      console.error('startVerifiedResponse failed:', startRes.status(), await startRes.text());
    }
    expect(startRes.ok()).toBe(true);
    const startPayload = await startRes.json();
    expect(startPayload.session_id).toBeTruthy();
    expect(typeof startPayload.seed).toBe('number');
    expect(startPayload.rules_snapshot).toMatchObject({
      rulesVersion: 10,
    });

    // 关键断言 2：进入对局界面，买入第一张牌并验证遥测事件上传。
    const actionUploadResponse = page.waitForResponse(
      (response) => (response.url().includes('append_game_events') || response.url().includes('/game_events')) && response.request().method() === 'POST',
      { timeout: 30_000 },
    );

    await selectPublicCard(page);
    await page.getByRole('button', { name: /纳灵/ }).click();
    await page.getByRole('button', { name: '确认结束本回合' }).click();

    const uploadRes = await actionUploadResponse;
    if (!uploadRes.ok()) {
      console.error('actionUploadResponse failed:', uploadRes.status(), await uploadRes.text());
    }
    expect(uploadRes.ok()).toBe(true);

    // 推进到终局：V10 循环调息直到「结束游戏」按钮出现（第 60 回合终局）。
    while (true) {
      const endBtn = page.getByRole('button', { name: '结束游戏' });
      if (await endBtn.isVisible().catch(() => false)) break;
      const waitButton = page.getByRole('button', { name: /调息/ });
      await Promise.race([
        waitButton.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
        endBtn.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}),
      ]);
      if (await endBtn.isVisible().catch(() => false)) break;
      if (await waitButton.isVisible().catch(() => false)) {
        await waitButton.click().catch(() => {});
        const confirmButton = page.getByRole('button', { name: '确认结束本回合' });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click().catch(() => {});
        }
      }
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
      rules_version: '10',
    });

    // 终局后，GameOverModal 会展示校验结果
    await expect(page.getByText(/已校验.*已计入云端榜/)).toBeVisible({ timeout: 15_000 });

    // 点击「排行榜」，验证已成功写入并渲染
    await page.getByRole('button', { name: '排行榜' }).click();
    await expect(page.getByRole('dialog', { name: '排行榜' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '排行榜' }).getByText('E2E测试').first()).toBeVisible({ timeout: 10_000 });
  });

  test('真实 Supabase：受损 V10 局跨设备恢复与免惩罚重置闭环（验证真实 DB 会话、事件表、RLS 与 ledger 完整性）', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');

    // 1. 同意授权并生成玩家 ID
    await expect(page.getByRole('button', { name: '查看修行档案' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '查看修行档案' }).first().click();
    await expect(page.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '同意并生成玩家 ID' }).click();

    await expect(page.getByText('恢复码（换设备找回凭据，请妥善保存）')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '关闭' }).click();

    // 2. 在真实 Supabase 中为该玩家通过 start-verified-session 真实创建 V10 会话，并写入破坏牌池守恒的动作链
    const setupResult = await page.evaluate(async () => {
      const client = (window as any).__SUPABASE_CLIENT__;
      if (!client) throw new Error('window.__SUPABASE_CLIENT__ not found');

      const identityStr = localStorage.getItem('jiazi_player_identity');
      if (!identityStr) throw new Error('player identity not found');
      const identity = JSON.parse(identityStr);
      const playerId = identity.player_id;

      // 真实调用 start-verified-session 服务端接口创建会话
      const { data: startData, error: startError } = await client.functions.invoke('start-verified-session', {
        body: {
          client_session_id: `client-v10-${Date.now()}`,
          requested_rules_version: '10',
          app_version: '0.2.0',
          consent_version: '1',
        },
      });
      if (startError || !startData?.session_id) throw (startError || new Error('start-verified-session failed'));
      const realSessionId = startData.session_id;

      // 真实写入破坏规则的受损动作事件（非法 card_index）
      const { error: eventsError } = await client.rpc('append_game_events', {
        p_player_id: playerId,
        p_events: [
          {
            session_id: realSessionId,
            client_event_id: crypto.randomUUID(),
            sequence: 1,
            event_type: 'action_buy',
            payload: { card_index: 999, use_leverage: false },
            occurred_at: new Date(Date.now() - 30000).toISOString(),
          },
        ],
      });
      if (eventsError) throw eventsError;

      return { playerId, sessionId: realSessionId };
    });

    const corruptedSessionId = setupResult.sessionId;

    // 3. 监听向 Supabase Edge Function 发送的 recover-corrupted-session 验证请求
    const corruptedRecoveryResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/functions/v1/recover-corrupted-session'),
      { timeout: 30_000 },
    );

    // 4. 刷新页面，从真实 Supabase 拉取该活跃云端局，并点击「继续修行」
    await page.reload();
    const continueBtn = page.getByRole('button', { name: /继续(修行|游戏)/ });
    await expect(continueBtn).toBeVisible({ timeout: 15_000 });
    await continueBtn.click();

    // 5. 验证免惩罚技术重置 Toast 和云端终态更新确认
    await expect(page.getByText(/检测到历史对局牌池数据异常，已为您安全重置/).first()).toBeVisible({ timeout: 15_000 });
    const edgeFuncResponse = await corruptedRecoveryResponsePromise;
    if (!edgeFuncResponse.ok()) {
      const errBody = await edgeFuncResponse.text();
      console.error(`recover-corrupted-session non-2xx [status: ${edgeFuncResponse.status()}]: ${errBody}`);
    }
    expect(edgeFuncResponse.ok()).toBe(true);

    // 6. 从真实 Supabase 查询该 session 记录，验证 status 已确实落库为 corrupted_recovery
    const dbVerification = await page.evaluate(async (sessionId) => {
      const client = (window as any).__SUPABASE_CLIENT__;
      const { data: sessionRow, error: sessionErr } = await client
        .from('game_sessions')
        .select('id, status, rounds_completed, final_score')
        .eq('id', sessionId)
        .single();
      if (sessionErr) throw sessionErr;

      const identityStr = localStorage.getItem('jiazi_player_identity');
      const identity = identityStr ? JSON.parse(identityStr) : null;
      const { data: ledgerRows, error: ledgerErr } = await client
        .from('cultivation_ledger_entries')
        .select('*')
        .eq('player_id', identity?.player_id)
        .eq('game_session_id', sessionId);
      if (ledgerErr) throw ledgerErr;

      return { sessionRow, ledgerRows };
    }, corruptedSessionId);

    expect(dbVerification.sessionRow.status).toBe('corrupted_recovery');
    // 关键验证：账本绝对不能有该局的 abandoned 记录
    const abandonedLedger = (dbVerification.ledgerRows ?? []).find((r: any) => r.outcome === 'abandoned');
    expect(abandonedLedger).toBeUndefined();
  });

  test('真实 Supabase：公共 upsert_game_session RPC 严格拒绝客户端直接传入 corrupted_recovery（防伪安全闸门）', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');

    await expect(page.getByRole('button', { name: '查看修行档案' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '查看修行档案' }).first().click();
    await expect(page.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '同意并生成玩家 ID' }).click();
    await expect(page.getByText('恢复码（换设备找回凭据，请妥善保存）')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '关闭' }).click();

    const forgeAttemptResult = await page.evaluate(async () => {
      const client = (window as any).__SUPABASE_CLIENT__;
      const identityStr = localStorage.getItem('jiazi_player_identity');
      const identity = identityStr ? JSON.parse(identityStr) : null;

      const fakeSessionId = crypto.randomUUID();
      const { error } = await client.rpc('upsert_game_session', {
        p_player_id: identity.player_id,
        p_session_id: fakeSessionId,
        p_client_session_id: `forge-${Date.now()}`,
        p_started_at: new Date().toISOString(),
        p_status: 'corrupted_recovery',
        p_rounds_completed: 1,
        p_final_score: 0,
        p_rules_version: '8',
        p_game_mode: 'clean_pool',
        p_app_version: '0.2.0',
        p_consent_version: '1',
      });

      return {
        hasError: Boolean(error),
        errorMessage: error?.message ?? '',
      };
    });

    // 关键断言：公共 RPC 必须抛出异常拒绝写入 corrupted_recovery
    expect(forgeAttemptResult.hasError).toBe(true);
    expect(forgeAttemptResult.errorMessage).toContain('invalid session status');
  });

  test('真实 Supabase：离线终止重连，自动同步 abandoned 并在账本记录坚持度中断', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    await expect(page.getByRole('button', { name: '查看修行档案' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '查看修行档案' }).first().click();
    await expect(page.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '同意并生成玩家 ID' }).click();
    await expect(page.getByText('恢复码（换设备找回凭据，请妥善保存）')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '关闭' }).click();

    const sessionId = randomUUID();
    // 写入一个 started 局到 DB，并在 localStorage 中写入 pending voluntary_termination
    await page.evaluate(async (sessId) => {
      const client = (window as any).__SUPABASE_CLIENT__;
      const identityStr = localStorage.getItem('jiazi_player_identity');
      const identity = identityStr ? JSON.parse(identityStr) : null;
      const playerId = identity.player_id;

      await client.rpc('upsert_game_session', {
        p_player_id: playerId,
        p_session_id: sessId,
        p_client_session_id: `client-${Date.now()}`,
        p_started_at: new Date(Date.now() - 60000).toISOString(),
        p_status: 'started',
        p_rounds_completed: 2,
        p_final_score: 20,
        p_rules_version: '8',
        p_game_mode: 'clean_pool',
        p_app_version: '0.2.0',
        p_consent_version: '1',
      });

      // 写入 pending 终止意图
      const pendingList = [
        {
          sessionId: sessId,
          playerId,
          clientSessionId: `client-${Date.now()}`,
          reason: 'voluntary_termination',
          roundsCompleted: 2,
          finalScore: 20,
          occurredAt: new Date().toISOString(),
          status: 'pending',
          clientActionCount: 2,
          kind: 'voluntary_termination',
          expectedLastEventSequence: 2,
        },
      ];
      localStorage.setItem('jiazi_pending_terminations', JSON.stringify({ [playerId]: pendingList }));
    }, sessionId);

    // 监听自动同步的 upsert_game_session 请求
    const syncResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/rest/v1/rpc/upsert_game_session') && response.request().postData()?.includes('abandoned'),
      { timeout: 30_000 },
    );

    await page.reload();
    const syncRes = await syncResponsePromise;
    if (!syncRes.ok()) {
      const errBody = await syncRes.text();
      console.error(`upsert_game_session non-2xx [status: ${syncRes.status()}]: ${errBody}`);
    }
    expect(syncRes.ok()).toBe(true);

    // 验证 DB 中的 status 为 abandoned，且账本中有一条 abandoned 记录
    const verification = await page.evaluate(async (sessId) => {
      const client = (window as any).__SUPABASE_CLIENT__;
      const identityStr = localStorage.getItem('jiazi_player_identity');
      const identity = identityStr ? JSON.parse(identityStr) : null;

      const { data: sessionRow } = await client.from('game_sessions').select('*').eq('id', sessId).single();
      const { data: ledgerRows } = await client.from('cultivation_ledger_entries').select('*').eq('game_session_id', sessId);
      return { sessionRow, ledgerRows };
    }, sessionId);

    expect(verification.sessionRow.status).toBe('abandoned');
    expect((verification.ledgerRows ?? []).some((r: any) => r.outcome === 'abandoned')).toBe(true);
  });

  test('真实 Supabase：跨设备行动冲突（并发 sequence 竞态），弹窗选择「继续最新云端对局」成功接续', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    await expect(page.getByRole('button', { name: '查看修行档案' }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '查看修行档案' }).first().click();
    await expect(page.getByRole('button', { name: '同意并生成玩家 ID' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '同意并生成玩家 ID' }).click();
    await expect(page.getByText('恢复码（换设备找回凭据，请妥善保存）')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '关闭' }).click();

    const setupResult = await page.evaluate(async () => {
      const client = (window as any).__SUPABASE_CLIENT__;
      const identityStr = localStorage.getItem('jiazi_player_identity');
      const identity = identityStr ? JSON.parse(identityStr) : null;
      const playerId = identity.player_id;

      // 真实调用 start-verified-session 服务端接口创建会话
      const { data: startData, error: startError } = await client.functions.invoke('start-verified-session', {
        body: {
          client_session_id: `client-v10-${Date.now()}`,
          requested_rules_version: '10',
          app_version: '0.2.0',
          consent_version: '1',
        },
      });
      if (startError || !startData?.session_id) throw (startError || new Error('start-verified-session failed'));
      const sessId = startData.session_id;

      await client.rpc('append_game_events', {
        p_player_id: playerId,
        p_events: [
          { session_id: sessId, client_event_id: crypto.randomUUID(), sequence: 1, event_type: 'action_wait', payload: {}, occurred_at: new Date().toISOString() },
          { session_id: sessId, client_event_id: crypto.randomUUID(), sequence: 2, event_type: 'action_wait', payload: {}, occurred_at: new Date().toISOString() },
          { session_id: sessId, client_event_id: crypto.randomUUID(), sequence: 3, event_type: 'action_wait', payload: {}, occurred_at: new Date().toISOString() },
        ],
      });

      // 本机写入第 1 轮（sequence 1）时的离线终止意图
      const pendingList = [
        {
          sessionId: sessId,
          playerId,
          clientSessionId: `client-${Date.now()}`,
          reason: 'voluntary_termination',
          roundsCompleted: 1,
          finalScore: 10,
          occurredAt: new Date().toISOString(),
          status: 'pending',
          clientActionCount: 1,
          kind: 'voluntary_termination',
          expectedSessionRevision: 1,
          expectedLastEventSequence: 1,
        },
      ];
      localStorage.setItem('jiazi_pending_terminations', JSON.stringify({ [playerId]: pendingList }));
      return { sessId };
    });

    const sessionId = setupResult.sessId;

    // 刷新页面，触发同步检测到冲突
    await page.reload();

    // 验证冲突弹窗展示
    await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('对局进度冲突')).toBeVisible();
    await expect(page.getByText(/云端最新进度：.*3 步行动/)).toBeVisible();

    // 点击「继续最新云端对局」
    await page.getByRole('button', { name: '继续最新云端对局' }).click();

    // 验证弹窗关闭并进入对局
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText(/已.*恢复/)).toBeVisible({ timeout: 10_000 });
  });
});
