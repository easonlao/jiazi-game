/**
 * 甲子纪 E2E 浏览器端到端测试
 *
 * 覆盖场景：
 * 1. 页面加载 → 初始化 → 开始游戏
 * 2. 买入/卖出/等待操作流
 * 3. 杠杆开关
 * 4. 行动前结算确认
 * 5. 游戏结束与重新开始
 */
import { test, expect } from '@playwright/test';

/** 确认行动；确认后直接进入下一回合，不再等待实际结算弹窗。 */
async function dismissSettlement(page: import('@playwright/test').Page) {
  // 普通流程统一确认行动前预览；确认后回合直接推进。
  const previewConfirm = page.getByRole('button', { name: '确认结束本回合' });
  if (await previewConfirm.isVisible({ timeout: 1_000 })) {
    await previewConfirm.click();
  }
  await expect(page.getByRole('heading', { name: '本回合结算预览' })).toBeHidden({ timeout: 5_000 });
}

/** 行动先打开预览；只有确认后才会进入实际结算。 */
async function confirmSettlementPreview(page: import('@playwright/test').Page) {
  const confirmBtn = page.getByRole('button', { name: '确认结束本回合' });
  await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
  await confirmBtn.click();
}

/** 开始游戏并进入可操作状态 */
async function startGameAndDismiss(page: import('@playwright/test').Page) {
  const startBtn = page.getByText('开始游戏', { exact: true });
  await expect(startBtn).toBeVisible({ timeout: 15_000 });
  await startBtn.click();
  // 当前版本开始游戏后不再弹出开局结算画面。
  await dismissSettlement(page);
}

test.describe('甲子纪 E2E 游戏流程', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('页面加载并显示开始界面', async ({ page }) => {
    // 页面标题
    await expect(page).toHaveTitle(/甲子纪/);
    // 等待初始化完成，开始游戏按钮出现
    // 注意：初始化可能极快，「加载牌库中...」仅为瞬时状态，不强制断言
    const startBtn = page.getByText('开始游戏', { exact: true });
    await expect(startBtn).toBeVisible({ timeout: 15_000 });
    // 验证玩法说明可见
    await expect(page.getByText('玩法')).toBeVisible();
    await expect(page.getByText('甲子纪')).toBeVisible();
  });

  test('点击开始游戏进入游戏界面', async ({ page }) => {
    await startGameAndDismiss(page);

    // 验证游戏 UI 组件出现
    await expect(page.getByText('公共牌池')).toBeVisible();
    await expect(page.getByText('手牌')).toBeVisible();
    await expect(page.getByText('第 1/60 回合', { exact: true })).toBeVisible();
    await expect(page.getByText('本季第 1 回合', { exact: true })).toBeVisible();
    await expect(page.getByText(/季内 \d+\//)).toHaveCount(0);
    // 验证操作按钮可见（使用 role 定位，避免子文本干扰）
    await expect(page.getByRole('button', { name: /买入/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /卖出/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /等待/ })).toBeVisible();
  });

  test('卡面显示当季到固定下一季的评分趋势', async ({ page }) => {
    await startGameAndDismiss(page);

    const cards = page.locator('.card-in');
    await expect(cards.first()).toBeVisible();
    const texts = await cards.allInnerTexts();
    const pairs = texts
      .map((text) => text.match(/([+-]?\d+\.\d)\s*→\s*([+-]?\d+\.\d)/))
      .filter((match): match is RegExpMatchArray => match !== null);
    expect(pairs.length).toBeGreaterThan(0);
    // 若错误使用“下一回合结算季”，春季非季末会普遍出现同分箭头；
    // 至少一张公开卡应能观察到春→夏的评分变化。
    expect(pairs.some((match) => match[1] !== match[2])).toBe(true);
  });

  test('买入一张卡牌流程', async ({ page }) => {
    await startGameAndDismiss(page);

    // 等待公共牌池渲染
    await expect(page.getByText('公共牌池')).toBeVisible();

    // 点击第一张公共牌（卡名会显示天干地支，如「甲子」）
    const publicCardContainer = page.locator('h3:has-text("公共牌池")').locator('..').locator('..');
    const firstPublicCard = publicCardContainer.locator('.card-in').first();
    await firstPublicCard.click();

    // 点击买入
    await page.getByRole('button', { name: /买入/ }).click();

    // 提交前先出现结算预览；返回不会执行操作。
    await expect(page.getByRole('heading', { name: '本回合结算预览' })).toBeVisible();
    await expect(page.getByText('本回合预计得分增量', { exact: true })).toBeVisible();
    await expect(page.getByText('预计累计总分', { exact: true })).toBeVisible();
    await expect(page.locator('.modal-backdrop')).toHaveCount(1);
    await page.getByRole('button', { name: '返回修改' }).click();
    await expect(page.getByRole('heading', { name: '本回合结算预览' })).toBeHidden();

    // 再次确认才真正结束回合。
    await page.getByRole('button', { name: /买入/ }).click();
    await confirmSettlementPreview(page);
    // 确认后直接进入下一回合，不再弹出第二个结算画面。
    await dismissSettlement(page);

    // 验证 Toast 出现「买入成功」
    await expect(page.getByText('买入成功', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('等待一回合', async ({ page }) => {
    await startGameAndDismiss(page);

    // 点击等待
    const waitBtn = page.getByRole('button', { name: /等待/ });
    await expect(waitBtn).toBeVisible({ timeout: 5_000 });
    await waitBtn.click();

    await expect(page.getByRole('heading', { name: '本回合结算预览' })).toBeVisible();
    await expect(page.getByText('等待奖励（下回合）')).toBeVisible();
    await confirmSettlementPreview(page);

    await dismissSettlement(page);

    // 验证 Toast 出现「等待」
    await expect(page.getByText('等待（下回合额外回气）')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('第 2/60 回合', { exact: true })).toBeVisible();
    await expect(page.getByText(/本回合 [+-]?[0-9]+\.[0-9] 分/)).toBeVisible();
  });

  test('买入+等待+卖出完整流程', async ({ page }) => {
    await startGameAndDismiss(page);

    // ===== 第 1 回合：买入一张牌 =====
    await expect(page.getByText('公共牌池')).toBeVisible();
    const publicCardContainer = page.locator('h3:has-text("公共牌池")').locator('..').locator('..');
    const firstPublicCard = publicCardContainer.locator('.card-in').first();
    await firstPublicCard.click();
    await page.getByRole('button', { name: /买入/ }).click();
    await expect(page.getByRole('heading', { name: '本回合结算预览' })).toBeVisible();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);

    // 验证手牌数增加
    const handHeader = page.getByText(/手牌/);
    await expect(handHeader).toContainText('/3');

    // ===== 第 2 回合：等待 =====
    await expect(page.getByRole('button', { name: /等待/ })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /等待/ }).click();
    await expect(page.getByRole('heading', { name: '本回合结算预览' })).toBeVisible();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);

    // ===== 第 3 回合：卖出持仓 =====
    // 点击手牌中的第一张牌
    const handCardContainer = page.locator('h3:has-text("手牌")').locator('..');
    const firstHandCard = handCardContainer.locator('.card-in').first();
    await expect(firstHandCard).toBeVisible({ timeout: 5_000 });
    await firstHandCard.click();

    // 点击卖出
    await page.getByRole('button', { name: /卖出/ }).click();
    await expect(page.getByRole('heading', { name: '本回合结算预览' })).toBeVisible();
    await expect(page.getByText('实现价差', { exact: true })).toBeVisible();
    await expect(page.getByText('气量流转', { exact: true })).toBeVisible();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);

    // 验证 Toast 出现「卖出成功」
    await expect(page.getByText('卖出成功', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('杠杆开关切换', async ({ page }) => {
    await startGameAndDismiss(page);

    // 验证杠杆按钮显示「杠杆 OFF」
    const leverageBtn = page.getByRole('button', { name: /杠杆 OFF/ });
    await expect(leverageBtn).toBeVisible({ timeout: 5_000 });

    // 点击切换
    await leverageBtn.click();

    // 验证变为「杠杆 ON」
    await expect(page.getByRole('button', { name: /杠杆 ON/ })).toBeVisible();
  });

  test('杠杆买入卡牌', async ({ page }) => {
    await startGameAndDismiss(page);

    // 开启杠杆
    await page.getByRole('button', { name: /杠杆 OFF/ }).click();
    await expect(page.getByRole('button', { name: /杠杆 ON/ })).toBeVisible();

    // 选择公共牌
    const publicCardContainer = page.locator('h3:has-text("公共牌池")').locator('..').locator('..');
    const firstPublicCard = publicCardContainer.locator('.card-in').first();
    await firstPublicCard.click();

    // 买入
    await page.getByRole('button', { name: /买入/ }).click();
    await dismissSettlement(page);

    // 验证买入成功
    await expect(page.getByText('买入成功', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 买入于第 1 回合，推进到季内第 3 回合后，手牌应显示已升至 2.0x。
    // 季节最短为 3 回合，因此这里不会跨季，且不依赖随机季长。
    for (let round = 2; round <= 2; round++) {
      await page.getByRole('button', { name: /等待/ }).click();
      await dismissSettlement(page);
    }
    const handSection = page.locator('h3:has-text("手牌")').locator('..').locator('..');
    await expect(handSection.getByLabel(/本季杠杆 2\.0×/)).toBeVisible({ timeout: 10_000 });
    await expect(handSection.getByText(/下回合结算|→[0-9]+\.[0-9]×/)).toHaveCount(0);
  });

  test('游戏结束与重新开始', async ({ page }) => {
    await startGameAndDismiss(page);

    // 快速推进到第 59 回合（全部等待）
    for (let round = 1; round <= 58; round++) {
      const waitBtn = page.getByRole('button', { name: /等待/ });
      await expect(waitBtn).toBeVisible({ timeout: 10_000 });
      await waitBtn.click();
      await dismissSettlement(page);
    }

    // 第 59 回合：等待按钮可见
    await expect(page.getByRole('button', { name: /等待/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /等待/ }).click();
    await dismissSettlement(page);

    // 第 60 回合：「结束游戏」按钮
    const endBtn = page.getByRole('button', { name: /结束游戏/ });
    await expect(endBtn).toBeVisible({ timeout: 10_000 });
    await endBtn.click();
    await confirmSettlementPreview(page);

    // 验证游戏结束弹窗（使用 role 定位标题，避免与状态文字、Toast 歧义）
    const gameOverTitle = page.getByRole('heading', { name: '游戏结束' });
    await expect(gameOverTitle).toBeVisible({ timeout: 15_000 });

    // 验证分数显示（在游戏结束弹窗内）
    const gameOverModal = page.locator('.modal-backdrop').filter({ has: page.getByRole('heading', { name: '游戏结束' }) });
    await expect(gameOverModal.getByText(/分$/)).toBeVisible();

    // 验证重新开始按钮
    const restartBtn = page.getByText('重新开始', { exact: true });
    await expect(restartBtn).toBeVisible();

    // 点击重新开始
    await restartBtn.click();

    // 验证回到开始界面
    const newStartBtn = page.getByText('开始游戏', { exact: true });
    await expect(newStartBtn).toBeVisible({ timeout: 10_000 });
  });

  test('多回合混合操作（3 轮买入+等待+卖出循环）', async ({ page }) => {
    await startGameAndDismiss(page);

    // 执行 3 轮买入+等待+卖出循环
    for (let cycle = 0; cycle < 3; cycle++) {
      // 买入
      const publicCardContainer = page.locator('h3:has-text("公共牌池")').locator('..').locator('..');
      const card = publicCardContainer.locator('.card-in').first();
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.click();
      await page.getByRole('button', { name: /买入/ }).click();
      await dismissSettlement(page);

      // 等待（让持仓产生收益）
      await expect(page.getByRole('button', { name: /等待/ })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /等待/ }).click();
      await dismissSettlement(page);

      // 等待（再等一回合，更多收益）
      await expect(page.getByRole('button', { name: /等待/ })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /等待/ }).click();
      await dismissSettlement(page);

      // 卖出
      const handCardContainer = page.locator('h3:has-text("手牌")').locator('..');
      const handCard = handCardContainer.locator('.card-in').first();
      await expect(handCard).toBeVisible({ timeout: 10_000 });
      await handCard.click();
      await page.getByRole('button', { name: /卖出/ }).click();
      await dismissSettlement(page);
    }

    // 验证游戏仍在进行中（未结束）
    await expect(page.getByText('游戏结束', { exact: true })).not.toBeVisible();
  });
});
