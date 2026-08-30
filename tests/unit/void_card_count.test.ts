import { describe, expect, it } from 'vitest';
import {
  TurnManager,
  VOID_CARD_COUNT,
  VOID_REPLAY_RULES,
  BRANCH_ROLL_REPLAY_RULES,
  TREND_WINDOW_REPLAY_RULES,
  CLEAN_POOL_REPLAY_RULES,
  CURRENT_REPLAY_RULES,
  RULES_VERSION_VOID,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_TREND_WINDOW,
  RULES_VERSION_SINGLE_VOID,
  RULES_BASE,
  replayGame,
  type ReplayAction,
  SeededRandomSource,
} from '../../src/core/index.ts';

describe('空亡牌数量固化与 V9 新局默认 1 张', () => {
  it('新局当前规则集（V9）默认使用 1 张空亡牌（总牌堆 61 张）', async () => {
    const tm = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_VERSION_SINGLE_VOID,
    });
    await tm.initialize();
    tm.startGame();

    expect(tm.getVoidCardCount()).toBe(1);
    expect(VOID_CARD_COUNT).toBe(1);

    const totalDeckAndPublic = tm.getDeckSize() + tm.getPublicCards().length;
    // 60 甲子 + 1 空亡 = 61 张
    expect(totalDeckAndPublic).toBe(61);
  });

  it('历史规则集快照冻结值：V5/V6 为 3 张，V7/V8 为 2 张，V9 为 1 张', () => {
    expect(VOID_REPLAY_RULES.voidCardCount).toBe(3);
    expect(BRANCH_ROLL_REPLAY_RULES.voidCardCount).toBe(3);
    expect(TREND_WINDOW_REPLAY_RULES.voidCardCount).toBe(2);
    expect(CLEAN_POOL_REPLAY_RULES.voidCardCount).toBe(2);
    expect(CURRENT_REPLAY_RULES.voidCardCount).toBe(1);
  });

  it('GameSnapshot 导出并固化 voidCardCount 字段', async () => {
    const tm2 = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_VERSION_SINGLE_VOID,
      voidConfig: { voidCardCount: 1 },
    });
    await tm2.initialize();
    tm2.startGame();

    const snapshot2 = tm2.exportSnapshot();
    expect(snapshot2.voidCardCount).toBe(1);

    const tm3 = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_VERSION_VOID,
      voidConfig: { voidCardCount: 3 },
    });
    await tm3.initialize();
    tm3.startGame();

    const snapshot3 = tm3.exportSnapshot();
    expect(snapshot3.voidCardCount).toBe(3);
  });

  it('旧存档缺失 voidCardCount 字段时，按 rulesVersion 安全回退（V5/V6/V7 回退 3，V1-V4 回退 0）', async () => {
    const tmV5 = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_VERSION_VOID,
      volatility: VOID_REPLAY_RULES.volatility,
      scoreRules: VOID_REPLAY_RULES.scoreRules,
    });
    await tmV5.initialize();
    tmV5.startGame();

    // 构造缺失 voidCardCount 的 V5 旧档
    const legacyV5Snapshot = tmV5.exportSnapshot();
    delete legacyV5Snapshot.voidCardCount;

    const restoredTm = new TurnManager();
    await restoredTm.initialize();
    restoredTm.importSnapshot(legacyV5Snapshot);
    expect(restoredTm.getVoidCardCount()).toBe(3);
    // 可获取到第 3 张空亡牌 ID 63
    expect(restoredTm.getCardById(63)).toBeDefined();

    // 构造缺失 voidCardCount 的 V1 (base) 旧档
    const tmBase = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_BASE,
    });
    await tmBase.initialize();
    tmBase.startGame();

    const legacyBaseSnapshot = tmBase.exportSnapshot();
    delete legacyBaseSnapshot.voidCardCount;

    const restoredBase = new TurnManager();
    await restoredBase.initialize();
    restoredBase.importSnapshot(legacyBaseSnapshot);
    expect(restoredBase.getVoidCardCount()).toBe(0);
  });

  it('旧局读档后调用 reset()，空亡牌数量正确重置为初始默认值（V9 新局 1 张，总牌堆 61 张）', async () => {
    // 1. 创建默认当前规则局（V9 默认 1 张空亡）
    const tm = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_VERSION_SINGLE_VOID,
    });
    await tm.initialize();
    tm.startGame();
    expect(tm.getVoidCardCount()).toBe(1);

    // 2. 模拟读取 3 张空亡的旧局存档
    const tmV5 = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_VERSION_VOID,
      voidConfig: { voidCardCount: 3 },
      volatility: VOID_REPLAY_RULES.volatility,
      scoreRules: VOID_REPLAY_RULES.scoreRules,
    });
    await tmV5.initialize();
    tmV5.startGame();
    const oldSnapshot = tmV5.exportSnapshot();

    tm.importSnapshot(oldSnapshot);
    expect(tm.getVoidCardCount()).toBe(3);
    expect(tm.getDeckSize() + tm.getPublicCards().length).toBe(63);

    // 3. 点击“新局”/ 调用 reset()
    tm.reset();
    expect(tm.getVoidCardCount()).toBe(1);
    expect(tm.getRulesVersion()).toBe(RULES_VERSION_SINGLE_VOID);
    expect(tm.getDeckSize() + tm.getPublicCards().length).toBe(61);
    expect(tm.getCardById(63)).toBeUndefined();
  });

  it('确定性重放：3 张空亡旧局与 1 张空亡 V9 新局均可准确重放', async () => {
    // 1. 1 张空亡 V9 新局
    const seedNew = 7788;
    const rngNew = new SeededRandomSource(seedNew);
    const tmNew = new TurnManager(undefined, rngNew, {
      rulesVersion: RULES_VERSION_SINGLE_VOID,
      voidConfig: { voidCardCount: 1 },
    });
    await tmNew.initialize();
    tmNew.startGame();

    const actionsNew: ReplayAction[] = [];
    while (tmNew.getState() === 'player_action') {
      tmNew.executeWait();
      actionsNew.push({ type: 'wait' });
    }

    const replayNew = await replayGame({
      seed: seedNew,
      actions: actionsNew,
      rulesVersion: RULES_VERSION_SINGLE_VOID,
      voidCardCount: 1,
    });
    expect(replayNew.completed).toBe(true);
    expect(replayNew.rounds).toBe(60);
    expect(replayNew.score).toBe(tmNew.getScore());

    // 2. 3 张空亡旧局
    const seedOld = 9988;
    const rngOld = new SeededRandomSource(seedOld);
    const tmOld = new TurnManager(undefined, rngOld, {
      rulesVersion: RULES_VERSION_VOID,
      voidConfig: { voidCardCount: 3 },
      volatility: VOID_REPLAY_RULES.volatility,
      scoreRules: VOID_REPLAY_RULES.scoreRules,
      volatilityRandom: rngOld,
    });
    await tmOld.initialize();
    tmOld.startGame();

    const actionsOld: ReplayAction[] = [];
    while (tmOld.getState() === 'player_action') {
      tmOld.executeWait();
      actionsOld.push({ type: 'wait' });
    }

    const replayOld = await replayGame({
      seed: seedOld,
      actions: actionsOld,
      rulesVersion: RULES_VERSION_VOID,
      voidCardCount: 3,
      volatility: VOID_REPLAY_RULES.volatility,
      scoreRules: VOID_REPLAY_RULES.scoreRules,
    });
    expect(replayOld.completed).toBe(true);
    expect(replayOld.rounds).toBe(60);
    expect(replayOld.score).toBe(tmOld.getScore());
  });

  it('旧 V7 存档缺失 voidCardCount 时，安全回退到 3 张空亡牌（历史既有局事实）', async () => {
    const tmV7Old = new TurnManager(undefined, undefined, {
      rulesVersion: RULES_VERSION_TREND_WINDOW,
      voidConfig: { voidCardCount: 3 },
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
    });
    await tmV7Old.initialize();
    tmV7Old.startGame();

    // 构造缺失 voidCardCount 的 V7 旧档
    const legacyV7Snapshot = tmV7Old.exportSnapshot();
    delete legacyV7Snapshot.voidCardCount;

    const restoredV7 = new TurnManager();
    await restoredV7.initialize();
    restoredV7.importSnapshot(legacyV7Snapshot);
    expect(restoredV7.getVoidCardCount()).toBe(3);
    expect(restoredV7.getCardById(63)).toBeDefined();
    expect(restoredV7.getDeckSize() + restoredV7.getPublicCards().length).toBe(63);
  });

  it('旧 V7 云端对局缺失 voidCardCount 时，replayGame 安全回退到 3 张空亡牌完成重放校验', async () => {
    const seed = 5566;
    const rng = new SeededRandomSource(seed);
    const tm = new TurnManager(undefined, rng, {
      rulesVersion: RULES_VERSION_TREND_WINDOW,
      voidConfig: { voidCardCount: 3 },
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatilityRandom: rng,
      branchRollRandom: rng,
    });
    await tm.initialize();
    tm.startGame();

    const actions: ReplayAction[] = [];
    while (tm.getState() === 'player_action') {
      if (tm.getPublicCards().length > 0 && tm.getQi() >= 20 && tm.getHand().filter(Boolean).length < 3) {
        const ok = tm.executeBuy(0, false);
        if (ok) {
          actions.push({ type: 'buy', cardIndex: 0, leverage: false });
          continue;
        }
      }
      tm.executeWait();
      actions.push({ type: 'wait' });
    }

    // 构造缺失 voidCardCount 的旧 V7 云端会话重放请求
    const replayResult = await replayGame({
      seed,
      actions,
      rulesVersion: RULES_VERSION_TREND_WINDOW,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      // voidCardCount 故意不传（模拟旧 V7 云端会话快照）
    });

    expect(replayResult.completed).toBe(true);
    expect(replayResult.rounds).toBe(60);
    expect(replayResult.score).toBe(tm.getScore());
  });
});
