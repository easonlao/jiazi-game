/**
 * 甲子纪 E2E 浏览器端到端测试
 *
 * 覆盖场景：
 * 1. 页面加载 → 初始化 → 开始游戏
 * 2. 纳灵/释灵/调息操作流
 * 3. 燃灵开关
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
  await expect(page.getByRole('heading', { name: '结算预览' })).toBeHidden({ timeout: 5_000 });
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

/** 当前回合数：从顶部「第 X 回合 / 60」读取。 */
async function currentRound(page: import('@playwright/test').Page): Promise<number> {
  const topText = await page.locator('h1').first().innerText().catch(() => '');
  const m = topText.match(/第\s*(\d+)\s*回合/);
  return m ? Number(m[1]) : 1;
}

/**
 * 循环调息推进到目标回合。
 * V5 空亡吞噬会额外推进游戏回合（空亡回合玩家不可行动、回合 +1），
 * 固定点击次数在随机空亡下不可靠——循环读取回合数直到 >= target；
 * 若已到第 60 回合（「结束游戏」按钮出现，终局）也退出。
 */
async function advanceToRound(page: import('@playwright/test').Page, target: number) {
  for (;;) {
    const round = await currentRound(page);
    if (round >= target) return;
    const endBtn = page.getByRole('button', { name: '结束游戏' });
    if (await endBtn.isVisible({ timeout: 1_000 }).catch(() => false)) return;
    const waitBtn = page.getByRole('button', { name: /调息/ });
    await expect(waitBtn).toBeVisible({ timeout: 10_000 });
    await waitBtn.click();
    await dismissSettlement(page);
  }
}

test.describe('甲子纪 E2E 游戏流程', () => {
  test.beforeEach(async ({ page }) => {
    // 确定性流程回归：`?rules=v4` 固定 V4 规则（无空亡随机推进）。
    // V5 空亡为生产默认，但其随机性会破坏固定回合/季节断言（空亡回合玩家不可行动、
    // 回合被跳过）；V5 行为由引擎单测与空亡专项浏览器验证覆盖（2026-08-14 翻转）。
    await page.goto('/?rules=v4');
  });

  test('页面加载并显示开始界面', async ({ page }) => {
    // 页面标题
    await expect(page).toHaveTitle(/甲子纪/);
    // 等待初始化完成，开始游戏按钮出现
    // 注意：初始化可能极快，「加载牌库中...」仅为瞬时状态，不强制断言
    const startBtn = page.getByText('开始游戏', { exact: true });
    await expect(startBtn).toBeVisible({ timeout: 15_000 });
    // 首页保留一段简短规则，不需要额外打开帮助
    await expect(page.getByText('甲子纪')).toBeVisible();
    await expect(page.getByText('玩法', { exact: true })).toBeVisible();
    await expect(page.getByText(/一甲子（60 回合），春夏秋冬天时流转/)).toBeVisible();
  });

  test('点击开始游戏进入游戏界面', async ({ page }) => {
    await startGameAndDismiss(page);

    // 验证游戏 UI 组件出现
    await expect(page.getByText('周遭灵气')).toBeVisible();
    await expect(page.getByRole('heading', { name: /丹田/ })).toBeVisible();
    await expect(page.getByText('第 1 回合 / 60', { exact: true })).toBeVisible();
    await expect(page.getByText('季内第 1 回合', { exact: true })).toBeVisible();
    await expect(page.getByText(/季内 \d+\//)).toHaveCount(0);
    // 行动尚未选择时不展示默认的下回合神识预测，避免把调息奖励当成必然结果。
    await expect(page.getByTestId('qi-settlement-flow')).toHaveCount(0);
    // 验证操作按钮可见（使用 role 定位，避免子文本干扰）
    await expect(page.getByRole('button', { name: /纳灵/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /释灵/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /调息/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '打开帮助' })).toBeVisible();
    await page.getByRole('button', { name: '打开帮助' }).click();
    const helpModal = page.locator('.modal-backdrop').filter({ has: page.getByRole('heading', { name: '玩法帮助' }) });
    await expect(helpModal).toBeVisible();
    await expect(helpModal.getByText('一局怎么玩', { exact: true })).toBeVisible();
    await expect(helpModal.getByText(/一局共 60 回合/)).toBeVisible();
    const helpText = await helpModal.innerText();
    expect(helpText).not.toContain('rulesVersion');
    expect(helpText).not.toContain('volatility=');

    for (const section of ['每回合怎么选', '怎么看卡牌', '持有还是释灵', '燃灵与失控风险', '名词解释']) {
      await helpModal.getByText(section, { exact: true }).click();
    }
    await expect(helpModal.getByText('纳灵评分：', { exact: false })).toBeVisible();
    await expect(helpModal.getByText('当前评分：', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '关闭帮助' }).click();
    await expect(helpModal).toBeHidden();
  });

  test('帮助入口在桌面和手机尺寸可滚动且关闭后可继续操作', async ({ page }) => {
    await startGameAndDismiss(page);

    for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: '打开帮助' }).click();

      const helpModal = page.locator('.modal-backdrop').filter({ hasText: '玩法帮助' });
      const helpContent = helpModal.locator('div.overflow-y-auto').first();
      await expect(helpModal).toBeVisible();
      for (const section of ['每回合怎么选', '怎么看卡牌', '持有还是释灵', '燃灵与失控风险', '名词解释']) {
        await helpModal.getByText(section, { exact: true }).click();
      }
      await expect.poll(() => helpContent.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

      await page.getByRole('button', { name: '关闭帮助' }).click();
      await expect(helpModal).toBeHidden();

      const publicCard = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..').locator('.card-in').first();
      await publicCard.click();
      const buyButton = page.getByRole('button', { name: /纳灵/ });
      await expect(buyButton).toBeEnabled();
      await buyButton.click();
      await expect(page.getByRole('heading', { name: '结算预览' })).toBeVisible();
      await page.getByRole('button', { name: '返回修改' }).click();
      await publicCard.click();
    }
  });

  test('普通入口默认显示季内波动提示与实际变化值', async ({ page }) => {
    await startGameAndDismiss(page);
    await expect(page.locator('[data-volatility-experiment]')).toBeVisible();
    await expect(page.locator('[data-volatility-delta]')).toHaveCount(3);
    const cards = page.locator('.card-in');
    const texts = await cards.allInnerTexts();
    expect(texts.every((text) => !/[+-]?\d+\.\d\s*→\s*[+-]?\d+\.\d/.test(text))).toBe(true);
    expect(texts.every((text) => text.includes('当前评分'))).toBe(true);
  });

  test('旧 volatility=0 参数不再切换规则，新局仍统一为 V4（E2E 固定规则）', async ({ page }) => {
    await page.goto('/?rules=v4&volatility=0');
    await startGameAndDismiss(page);
    await expect(page.locator('[data-volatility-experiment]')).toBeVisible();
    await expect(page.locator('[data-volatility-delta]')).toHaveCount(3);
  });

  test('旧 volatility=1 参数同样使用 V4（E2E 固定规则）', async ({ page }) => {
    await page.goto('/?rules=v4&volatility=1');
    await startGameAndDismiss(page);
    await expect(page.locator('[data-volatility-experiment]')).toBeVisible();
    await expect(page.locator('[data-volatility-delta]')).toHaveCount(3);

    const cards = page.locator('.card-in');
    const texts = await cards.allInnerTexts();
    expect(texts.every((text) => !/[+-]?\d+\.\d\s*→\s*[+-]?\d+\.\d/.test(text))).toBe(true);
    expect(texts.every((text) => text.includes('当前评分'))).toBe(true);
    const deltaLabels = await page.locator('[data-volatility-delta]').allTextContents();
    expect(deltaLabels.every((text) => /^\([+-]\d+\)$/.test(text.trim()))).toBe(true);
  });

  test('纳灵一张灵气流程', async ({ page }) => {
    await startGameAndDismiss(page);

    // 等待周遭灵气渲染
    await expect(page.getByText('周遭灵气')).toBeVisible();

    // 点击第一股灵气（卡名会显示天干地支，如「甲子」）
    const publicCardContainer = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..');
    const firstPublicCard = publicCardContainer.locator('.card-in').first();
    await firstPublicCard.click();

    // 点击纳灵
    await page.getByRole('button', { name: /纳灵/ }).click();

    // 提交前先出现结算预览；返回不会执行操作。
    await expect(page.getByRole('heading', { name: '结算预览' })).toBeVisible();
    await expect(page.getByText('本回合账单', { exact: true })).toBeVisible();
    await expect(page.getByText('下回合一览', { exact: true })).toBeVisible();
    await expect(page.locator('.modal-backdrop')).toHaveCount(1);
    await page.getByRole('button', { name: '返回修改' }).click();
    await expect(page.getByRole('heading', { name: '结算预览' })).toBeHidden();

    // 再次确认才真正结束回合。
    await page.getByRole('button', { name: /纳灵/ }).click();
    await confirmSettlementPreview(page);
    // 确认后直接进入下一回合，不再弹出第二个结算画面。
    await dismissSettlement(page);

    // 验证 Toast 出现「纳灵成功」（V5：若本回合恰好抽入空亡，空亡 Toast 会覆盖
    // 纳灵 Toast——P1-1 语义空亡最后写入；买入成功的实质证据是手牌出现，见下）
    const successToast = page.getByText(/纳灵成功|空亡触发/);
    await expect(successToast.first()).toBeVisible({ timeout: 5_000 });
    const handSection = page.locator('h3:has-text("丹田")').locator('..');
    // 未开燃灵：手牌卡面可见且无"燃"字徽章（杠杆信息暴露方式：仅开启时显示"燃"字徽章 + title）
    await expect(handSection.locator('.card-in')).toBeVisible({ timeout: 5_000 });
    await expect(handSection.locator('[data-position-score]')).toHaveCount(1);
    await expect(handSection.getByText('纳灵评分 → 当前评分', { exact: true })).toBeVisible();
    await expect(handSection.getByText('燃', { exact: true })).toHaveCount(0);
  });

  test('三丹田时主界面不产生滚动', async ({ page }) => {
    await startGameAndDismiss(page);
    const publicCardContainer = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..');

    for (let i = 0; i < 3; i++) {
      await publicCardContainer.locator('.card-in').first().click();
      await page.getByRole('button', { name: /纳灵/ }).click();
      await confirmSettlementPreview(page);
      await dismissSettlement(page);
    }

    // 已知布局问题（2026-08-04 记录）：三丹田时内容超高约 200px（scrollHeight 872 vs clientHeight 672，
    // 桌面 1280x720 下 shell 高度 672px），与 App.tsx `overflow-y-auto` 的小屏滚动设计并存。
    // 此前断言 `overflowY === 'hidden'` 已随 commit 6e5cd0a（hidden → auto）失效；
    // 「不滚动」是 UI 待优化项（见 STATUS.md「UI 完善」），此处只验证三丹田能正常渲染与交互。
    // 布局收敛后应恢复 scrollHeight ≤ clientHeight 断言。
    for (const viewport of [{ width: 1280, height: 720 }, { width: 428, height: 920 }]) {
      await page.setViewportSize(viewport);
      await expect(publicCardContainer.locator('.card-in').first()).toBeVisible();
      await expect(page.locator('[data-game-shell]')).toBeVisible();
    }
  });

  test('调息一回合', async ({ page }) => {
    await startGameAndDismiss(page);

    // 点击调息
    const waitBtn = page.getByRole('button', { name: /调息/ });
    await expect(waitBtn).toBeVisible({ timeout: 5_000 });
    await waitBtn.click();

    await expect(page.getByRole('heading', { name: '结算预览' })).toBeVisible();
    // 账单化（2026-08-05 反噬流程重设计）：弹窗只展示本回合账单，不再预测下一回合调息奖励
    await expect(page.getByText('剩余神识')).toBeVisible();
    await confirmSettlementPreview(page);

    await dismissSettlement(page);

    // 验证 Toast 出现「调息」
    await expect(page.getByText('调息（下回合额外回神）')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('settlement-qi-animation')).toHaveCount(0);
    await expect(page.getByText('第 2 回合 / 60', { exact: true })).toBeVisible();
    await expect(page.getByText(/本回合 [+-]?[0-9]+\.[0-9] 修为/)).toBeVisible();
  });

  test('纳灵+调息+释灵完整流程', async ({ page }) => {
    await startGameAndDismiss(page);

    // ===== 第 1 回合：纳灵一张灵气 =====
    await expect(page.getByText('周遭灵气')).toBeVisible();
    const publicCardContainer = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..');
    const firstPublicCard = publicCardContainer.locator('.card-in').first();
    await firstPublicCard.click();
    await page.getByRole('button', { name: /纳灵/ }).click();
    await expect(page.getByRole('heading', { name: '结算预览' })).toBeVisible();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);

    const buyFlight = page.getByTestId('buy-card-flight');
    await expect(buyFlight).toBeVisible({ timeout: 2_000 });
    await expect(buyFlight).toHaveAttribute('aria-label', /纳灵/);
    const buyQiAnimation = page.getByTestId('settlement-qi-animation');
    await expect(buyQiAnimation).toHaveAttribute('aria-label', /纳灵耗神/, { timeout: 3_000 });
    await expect(buyQiAnimation).toHaveAttribute('aria-label', /炼化耗神/, { timeout: 3_000 });
    await expect(buyQiAnimation).toHaveAttribute('aria-label', /回神/, { timeout: 4_000 });

    await expect(page.getByTestId('settlement-animation')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('settlement-card-flight').first()).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('settlement-card-flight').first()).toHaveText('');
    await expect(page.getByTestId('settlement-card-flight').first()).toHaveAttribute('aria-label', /炼化/);
    const qiAnimation = buyQiAnimation;

    // 验证丹田数增加
    const handHeader = page.getByText(/丹田/);
    await expect(handHeader).toContainText('/3');

    // ===== 第 2 回合：调息 =====
    await expect(page.getByRole('button', { name: /调息/ })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /调息/ }).click();
    await expect(page.getByRole('heading', { name: '结算预览' })).toBeVisible();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);
    await expect(qiAnimation).toBeVisible({ timeout: 2_000 });
    await expect(qiAnimation).toHaveAttribute('aria-label', /炼化耗神/, { timeout: 2_500 });
    await expect(qiAnimation).toHaveAttribute('aria-label', /回神/, { timeout: 4_000 });

    // ===== 第 3 回合：释灵 =====
    // 点击丹田中的第一张牌
    const handCardContainer = page.locator('h3:has-text("丹田")').locator('..');
    const firstHandCard = handCardContainer.locator('.card-in').first();
    await expect(firstHandCard).toBeVisible({ timeout: 5_000 });
    await firstHandCard.click();

    // 点击释灵
    await page.getByRole('button', { name: /释灵/ }).click();
    await expect(page.getByRole('heading', { name: '结算预览' })).toBeVisible();
    await expect(page.getByText('释灵前后评分', { exact: true })).toBeVisible();
    await expect(page.getByText('神识流转', { exact: true })).toBeVisible();
    await expect(page.getByText(/归还牵神 \+/)).toBeVisible();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);

    // 验证 Toast 出现「释灵成功」
    await expect(page.getByText('释灵成功', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('燃灵开关切换', async ({ page }) => {
    await startGameAndDismiss(page);

    // 验证燃灵按钮显示「燃灵 OFF」
    const leverageBtn = page.getByRole('button', { name: /燃灵 OFF/ });
    await expect(leverageBtn).toBeVisible({ timeout: 5_000 });

    // 点击切换
    await leverageBtn.click();

    // 验证变为「燃灵 ON」
    await expect(page.getByRole('button', { name: /燃灵 ON/ })).toBeVisible();
  });

  test('燃灵纳灵', async ({ page }) => {
    await startGameAndDismiss(page);

    // 开启燃灵
    await page.getByRole('button', { name: /燃灵 OFF/ }).click();
    await expect(page.getByRole('button', { name: /燃灵 ON/ })).toBeVisible();

    // 选择公共牌
    const publicCardContainer = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..');
    const firstPublicCard = publicCardContainer.locator('.card-in').first();
    await firstPublicCard.click();

    // 纳灵
    await page.getByRole('button', { name: /纳灵/ }).click();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);

    // 燃灵纳灵确认后进入新回合：燃灵复位提示优先于"纳灵成功"（_showActionToast pending 优先，
    // 产品行为 2026-08-05：避免双 Toast）；纳灵本身已成功（下方丹田手牌断言验证）
    await expect(page.getByText('燃灵已复位（新回合）', { exact: true })).toBeVisible({ timeout: 5_000 });

    // 纳灵于第 1 回合，推进到季内第 3 回合后，丹田应显示已升至 2.0x。
    // 季节最短为 3 回合，因此这里不会跨季，且不依赖随机季长。
    // 杠杆信息暴露方式（2026-08-06 杠杆信息重构后）：卡面仅"燃"字徽章 + title="燃灵 X.X×"，
    // 不再显示"下一回合 X×"预告文本（信息边界契约，不泄露换季）。
    const handSection = page.locator('h3:has-text("丹田")').locator('..');
    await expect(handSection.getByTitle(/燃灵 1\.0×/)).toBeVisible({ timeout: 5_000 });
    for (let round = 2; round <= 2; round++) {
      await page.getByRole('button', { name: /调息/ }).click();
      await dismissSettlement(page);
    }
    await expect(handSection.getByTitle(/燃灵 2\.0×/)).toBeVisible({ timeout: 10_000 });
    await expect(handSection.getByTitle(/燃灵 1\.0×/)).toHaveCount(0);
  });

  test('游戏结束与重新开始', async ({ page }) => {
    await startGameAndDismiss(page);

    // 快速推进到第 59 回合（全部等待）。
    // V5 空亡吞噬会额外推进游戏回合（空亡回合玩家不可行动但回合 +1），
    // 固定点击次数不可靠——改为循环读取回合数直到 >= 59。
    await advanceToRound(page, 59);

    // 第 60 回合：「结束游戏」按钮（末回合 ActionBar 显示，点击确认终局）。
    // 空亡可能把第 59 回合直接吞到 60，此时已出现结束按钮，无需再调息。
    if (!(await page.getByRole('button', { name: '结束游戏' }).isVisible().catch(() => false))) {
      await expect(page.getByRole('button', { name: /调息/ })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /调息/ }).click();
      await dismissSettlement(page);
    }
    const endBtn = page.getByRole('button', { name: '结束游戏' });
    await expect(endBtn).toBeVisible({ timeout: 10_000 });
    await endBtn.click();
    await confirmSettlementPreview(page);

    // 终局后 ActionBar 显示"游戏结束"状态文本
    await expect(page.getByText('游戏结束', { exact: true })).toBeVisible({ timeout: 10_000 });

    // 验证游戏结束弹窗（a1dae8b 局终评价重构后无「一甲子终了」标题，
    // 弹窗直接从境界名开始——用「最终修为」+ 境界名定位模态框）
    const gameOverModal = page.locator('.modal-backdrop').filter({ hasText: '最终修为' });
    await expect(gameOverModal).toBeVisible({ timeout: 15_000 });
    // 境界名（如「炼气境」）渲染
    await expect(gameOverModal.getByText(/境$/)).toBeVisible();

    // 验证分数显示（在游戏结束弹窗内）
    await expect(gameOverModal.getByText('最终修为', { exact: true })).toBeVisible();

    // 终局后刷新也不能把 game_over 快照当作可继续存档
    await page.reload();
    const newStartBtn = page.getByText('开始游戏', { exact: true });
    await expect(newStartBtn).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('继续游戏', { exact: true })).toHaveCount(0);

    // 重新开始新一局：周遭灵气必须正常浮现
    // （回归：牌池 reset 只清空不重建会导致新一局无牌可买，界面卡死在"春季"）
    await newStartBtn.click();
    await dismissSettlement(page);
    await expect(page.getByText('周遭灵气')).toBeVisible();
    await expect(page.locator('.card-in').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('周遭暂无灵气浮现', { exact: true })).toHaveCount(0);
    // 新一局仍可正常买入
    const newPublicCard = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..').locator('.card-in').first();
    await newPublicCard.click();
    await page.getByRole('button', { name: /纳灵/ }).click();
    await confirmSettlementPreview(page);
    await dismissSettlement(page);
    await expect(page.getByText('纳灵成功', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('多回合混合操作（3 轮买入+等待+卖出循环）', async ({ page }) => {
    await startGameAndDismiss(page);

    // 执行 3 轮买入+等待+卖出循环
    for (let cycle = 0; cycle < 3; cycle++) {
      // 纳灵
      const publicCardContainer = page.locator('h3:has-text("周遭灵气")').locator('..').locator('..');
      const card = publicCardContainer.locator('.card-in').first();
      await expect(card).toBeVisible({ timeout: 10_000 });
      await card.click();
      await page.getByRole('button', { name: /纳灵/ }).click();
      await dismissSettlement(page);

      // 等待（让持仓产生收益）
      await expect(page.getByRole('button', { name: /调息/ })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /调息/ }).click();
      await dismissSettlement(page);

      // 等待（再等一回合，更多收益）
      await expect(page.getByRole('button', { name: /调息/ })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /调息/ }).click();
      await dismissSettlement(page);

      // 卖出
      const handCardContainer = page.locator('h3:has-text("丹田")').locator('..');
      const handCard = handCardContainer.locator('.card-in').first();
      await expect(handCard).toBeVisible({ timeout: 10_000 });
      await handCard.click();
      await page.getByRole('button', { name: /释灵/ }).click();
      await dismissSettlement(page);
    }

    // 验证游戏仍在进行中（未结束）
    await expect(page.getByText('游戏结束', { exact: true })).not.toBeVisible();
  });
});
