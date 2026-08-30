/**
 * 票 04：V5 重放快照与服务端校验同步的共享核心测试。
 *
 * 覆盖（验收标准 1/2/4，票面修正：V5 为增量支持、生产默认仍 V4）：
 * 1. V5 规则快照 VOID_REPLAY_RULES 定义完整且可序列化进会话快照（JSON 往返）；
 * 2. V5 会话快照（GameSnapshot）序列化/往返：export → JSON → import → re-export 一致；
 * 3. V5 重放确定性：同种子本地对局逐字段一致于服务端重放（含空亡吞噬回合）；
 * 4. 函数层 V5 路径（共享核心）：start-verified-session / submit-verified-score
 *    经 getReplayRulesByVersion 门控 V4/V5、未注册版本拒绝，重放复用 V4 校验路径。
 *
 * 引擎空亡语义（吞噬回合、+10 神识、季节跳 K）由 tests/unit/void_engine.test.ts 覆盖，
 * 本文件只验证「重放链路」对空亡语义的确定性复现。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BALANCED_TRADE_REPLAY_RULES,
  BRANCH_ROLL_REPLAY_RULES,
  cloneReplayRulesSnapshot,
  CURRENT_REPLAY_RULES,
  getReplayRulesByVersion,
  replayGame,
  RULES_VERSION_VOID,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_TREND_WINDOW,
  RULES_VERSION_CLEAN_POOL,
  RULES_VERSION_SINGLE_VOID,
  TREND_WINDOW_REPLAY_RULES,
  CLEAN_POOL_REPLAY_RULES,
  SeededRandomSource,
  SUPPORTED_REPLAY_RULES,
  TurnManager,
  VOID_REPLAY_RULES,
  type ReplayAction,
  type VoidReplayRulesSnapshot,
} from '../../src/core';
import type { GameSnapshot } from '../../src/core/GameSaveService';

(globalThis as any).localStorage = new (class {
  store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
})();

/** 与 ReplayRunner.replayGame / store.ts 云端 seed 局完全一致的 V5 TurnManager 构造。 */
async function makeVoidTm(seed: number): Promise<TurnManager> {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  (globalThis as any).fetch = async () => ({ json: async () => cardData });
  const random = new SeededRandomSource(seed);
  const tm = new TurnManager(undefined, random, {
    rulesVersion: RULES_VERSION_VOID,
    volatility: VOID_REPLAY_RULES.volatility,
    scoreRules: VOID_REPLAY_RULES.scoreRules,
    volatilityRandom: random,
  });
  await tm.initialize();
  return tm;
}

/** 对局全量可观测状态指纹：本地局与服务端重放必须逐字段一致。 */
interface GameFingerprint {
  state: string;
  score: number;
  qi: number;
  currentRound: number;
  season: string;
  roundInSeason: number;
  deckSize: number;
  totalBuys: number;
  totalSells: number;
  totalWaits: number;
  totalLeverageBuys: number;
  roundLog: string;
  decisionLog: string;
}

function capture(tm: TurnManager): GameFingerprint {
  return {
    state: tm.getState(),
    score: tm.getScore(),
    qi: tm.getQi(),
    currentRound: tm.getCurrentRound(),
    season: tm.getCurrentSeason(),
    roundInSeason: tm.getCurrentRoundInSeason(),
    deckSize: tm.getDeckSize(),
    totalBuys: tm.getTotalBuys(),
    totalSells: tm.getTotalSells(),
    totalWaits: tm.getTotalWaits(),
    totalLeverageBuys: tm.getTotalLeverageBuys(),
    roundLog: JSON.stringify(tm.getRoundLog()),
    decisionLog: JSON.stringify(tm.getDecisionLog()),
  };
}

/** 本地打一局 V5 全 wait 局：仅在实际可行动的回合记录动作（空亡吞噬回合不记录）。 */
async function playLocalVoidGame(seed: number): Promise<{ actions: ReplayAction[]; fingerprint: GameFingerprint }> {
  const tm = await makeVoidTm(seed);
  tm.startGame();
  const actions: ReplayAction[] = [];
  let guard = 0;
  while (tm.getState() === 'player_action' && guard < 200) {
    actions.push({ type: 'wait' });
    expect(tm.executeWait()).toBe(true);
    guard++;
  }
  expect(tm.getState()).toBe('game_over');
  return { actions, fingerprint: capture(tm) };
}

/** 用与 replayGame 相同的构造，把动作链重放一遍并取指纹（replayGame 不暴露引擎内部状态）。 */
async function replayVoidGameViaTm(seed: number, actions: readonly ReplayAction[]): Promise<GameFingerprint> {
  const tm = await makeVoidTm(seed);
  tm.startGame();
  for (const action of actions) {
    expect(action.type).toBe('wait');
    expect(tm.executeWait()).toBe(true);
  }
  expect(tm.getState()).toBe('game_over');
  return capture(tm);
}

describe('V5 重放规则快照（VOID_REPLAY_RULES）', () => {
  it('rulesVersion=5、gameMode/volatility/scoreRules 与 V4 同形、附加空亡字段', () => {
    expect(VOID_REPLAY_RULES.rulesVersion).toBe(RULES_VERSION_VOID);
    expect(VOID_REPLAY_RULES.gameMode).toBe('volatility_trade');
    expect(VOID_REPLAY_RULES.volatilityEnabled).toBe(true);
    // 与 V4 完全同形（V5 计分 = V4 计分，一审 P1-① 定案）
    expect(VOID_REPLAY_RULES.volatility).toEqual(BALANCED_TRADE_REPLAY_RULES.volatility);
    expect(VOID_REPLAY_RULES.scoreRules).toEqual(BALANCED_TRADE_REPLAY_RULES.scoreRules);
    // 空亡字段
    expect(VOID_REPLAY_RULES.voidCardCount).toBe(3);
    expect(VOID_REPLAY_RULES.voidKMin).toBe(2);
    expect(VOID_REPLAY_RULES.voidKMax).toBe(8);
    expect(VOID_REPLAY_RULES.lazySeason).toBe(true);
  });

  it('可序列化进会话快照：JSON 往返逐字段不变', () => {
    const revived = JSON.parse(JSON.stringify(VOID_REPLAY_RULES)) as VoidReplayRulesSnapshot;
    expect(revived).toEqual(VOID_REPLAY_RULES);
    expect(revived.voidCardCount).toBe(3);
    expect(revived.lazySeason).toBe(true);
  });

  it('cloneReplayRulesSnapshot 保留空亡字段（start-verified-session 落库形状）', () => {
    const cloned = cloneReplayRulesSnapshot(VOID_REPLAY_RULES);
    expect(cloned).toEqual(VOID_REPLAY_RULES);
    expect(cloned.voidCardCount).toBe(3);
    expect(cloned.voidKMax).toBe(8);
    expect(cloned.lazySeason).toBe(true);
  });
});

describe('V5 会话快照（GameSnapshot）序列化/往返', () => {
  it('export → JSON → import → re-export 一致，rulesVersion 保持 5', async () => {
    const tm = await makeVoidTm(11);
    tm.startGame();
    expect(tm.executeWait()).toBe(true);
    expect(tm.executeWait()).toBe(true);
    const original = tm.exportSnapshot();
    expect(original.rulesVersion).toBe(RULES_VERSION_VOID);

    const revived = JSON.parse(JSON.stringify(original)) as GameSnapshot;
    const tm2 = await makeVoidTm(11);
    tm2.importSnapshot(revived);

    expect(tm2.getRulesVersion()).toBe(RULES_VERSION_VOID);
    expect(tm2.exportSnapshot()).toEqual(tm.exportSnapshot());
  });
});

describe('V5 重放确定性（同种子）', () => {
  it('同种子两次 replayGame 结果一致（含空亡吞噬路径）', async () => {
    const seed = 42;
    const { actions } = await playLocalVoidGame(seed);
    const first = await replayGame({
      seed,
      actions,
      rulesVersion: VOID_REPLAY_RULES.rulesVersion,
      volatility: VOID_REPLAY_RULES.volatility,
      scoreRules: VOID_REPLAY_RULES.scoreRules,
    });
    const second = await replayGame({
      seed,
      actions,
      rulesVersion: VOID_REPLAY_RULES.rulesVersion,
      volatility: VOID_REPLAY_RULES.volatility,
      scoreRules: VOID_REPLAY_RULES.scoreRules,
    });
    expect(second).toEqual(first);
    expect(first).toMatchObject({ state: 'game_over', completed: true, rounds: 60, rulesVersion: 5 });
  });

  it('同种子：本地对局与重放逐字段一致（含空亡吞噬回合）', async () => {
    const seed = 42;
    const { actions, fingerprint } = await playLocalVoidGame(seed);

    // 该局确实发生了空亡吞噬回合：玩家行动回合 = 60 - 吞噬回合数 < 60
    expect(actions.length).toBeLessThan(60);
    const localRoundLog = JSON.parse(fingerprint.roundLog) as Array<{ round: number }>;
    expect(localRoundLog.length).toBeGreaterThanOrEqual(60);

    // 服务端 replayGame 结果 = 本地最终分数（submit-verified-score 同款调用）
    const result = await replayGame({
      seed,
      actions,
      rulesVersion: VOID_REPLAY_RULES.rulesVersion,
      volatility: VOID_REPLAY_RULES.volatility,
      scoreRules: VOID_REPLAY_RULES.scoreRules,
    });
    expect(result.score).toBe(fingerprint.score);
    expect(result.rounds).toBe(60);

    // 全量可观测状态逐字段一致（score/qi/season/roundLog/decisionLog/统计）
    const replayFingerprint = await replayVoidGameViaTm(seed, actions);
    expect(replayFingerprint).toEqual(fingerprint);
  });
});

describe('函数层 V5 路径（共享核心；Edge Function 无法在 vitest 中导入 Deno/esm.sh 模块）', () => {
  it('版本门控：V4/V5/V6/V7/V8 接受，未注册版本（含 V1-V3、NaN）拒绝', () => {
    expect(getReplayRulesByVersion(4)).toBe(BALANCED_TRADE_REPLAY_RULES);
    expect(getReplayRulesByVersion(5)).toBe(VOID_REPLAY_RULES);
    expect(getReplayRulesByVersion(6)).toBe(BRANCH_ROLL_REPLAY_RULES);
    expect(getReplayRulesByVersion(7)).toBe(TREND_WINDOW_REPLAY_RULES);
    expect(getReplayRulesByVersion(8)).toBe(CLEAN_POOL_REPLAY_RULES);
    expect(getReplayRulesByVersion(3)).toBeUndefined();
    expect(getReplayRulesByVersion(2)).toBeUndefined();
    expect(getReplayRulesByVersion(NaN)).toBeUndefined();
    expect(SUPPORTED_REPLAY_RULES.map((rules) => rules.rulesVersion)).toEqual([4, 5, 6, 7, 8, 9]);
    // V9 为生产默认；V8 保留完整牌池历史对局的冻结快照。
    expect(CURRENT_REPLAY_RULES.rulesVersion).toBe(RULES_VERSION_SINGLE_VOID);
    expect(SUPPORTED_REPLAY_RULES[0]).toBe(BALANCED_TRADE_REPLAY_RULES);
  });

  it('start-verified-session 落库路径：V5 快照经 clone 后含空亡字段且 JSON 可序列化', () => {
    const rules = getReplayRulesByVersion(5)!;
    const snapshot = cloneReplayRulesSnapshot(rules);
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_VOID);
    expect(snapshot.gameMode).toBe('volatility_trade');
    const revived = JSON.parse(JSON.stringify(snapshot)) as VoidReplayRulesSnapshot;
    expect(revived.voidCardCount).toBe(3);
    expect(revived.lazySeason).toBe(true);
  });

  it('submit-verified-score 重放路径：V5 会话按落库快照的 volatility/scoreRules 重放通过', async () => {
    const snapshot = cloneReplayRulesSnapshot(getReplayRulesByVersion(5)!);
    const seed = 42;
    const { actions } = await playLocalVoidGame(seed);
    const result = await replayGame({
      seed,
      actions,
      rulesVersion: snapshot.rulesVersion,
      volatility: snapshot.volatility,
      scoreRules: snapshot.scoreRules,
    });
    expect(result).toMatchObject({ state: 'game_over', completed: true, rounds: 60, rulesVersion: 5 });
  });

  it('V7 历史对局回归锁定：覆盖锁牌、解锁、纳灵、释灵与空亡吞噬的复杂动作链，重放确定性完全隔离', async () => {
    const snapshotV7 = cloneReplayRulesSnapshot(getReplayRulesByVersion(7)!);
    const seed = 999;
    const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
    (globalThis as any).fetch = async () => ({ json: async () => cardData });
    const random = new SeededRandomSource(seed);
    const tm = new TurnManager(undefined, random, {
      rulesVersion: 7,
      volatility: snapshotV7.volatility,
      scoreRules: snapshotV7.scoreRules,
      volatilityRandom: random,
      branchRollRandom: random,
      voidConfig: { voidCardCount: 3 },
    });
    await tm.initialize();
    tm.startGame();

    const actions: ReplayAction[] = [];
    let step = 0;
    let guard = 0;
    while (tm.getState() === 'player_action' && guard < 200) {
      step++;
      if (step === 1) {
        // 回合 1：锁定第 0 张牌并调息
        actions.push({ type: 'lock', cardIndex: 0 });
        expect(tm.executeLockCard(0).ok).toBe(true);
        actions.push({ type: 'wait' });
        expect(tm.executeWait()).toBe(true);
      } else if (step === 2) {
        // 回合 2：纳灵第 1 张牌（推进回合）
        actions.push({ type: 'buy', cardIndex: 1, leverage: false });
        expect(tm.executeBuy(1, false)).toBe(true);
      } else if (step === 3 && tm.getHand().length > 0) {
        // 回合 3：释灵手牌并调息
        actions.push({ type: 'sell', slotIndex: 0 });
        expect(tm.executeSell(0)).toBe(true);
        actions.push({ type: 'wait' });
        expect(tm.executeWait()).toBe(true);
      } else if (step === 4) {
        // 回合 4：解锁第 0 张牌并调息
        actions.push({ type: 'unlock', cardIndex: 0 });
        expect(tm.executeUnlockCard(0)).toBe(true);
        actions.push({ type: 'wait' });
        expect(tm.executeWait()).toBe(true);
      } else {
        actions.push({ type: 'wait' });
        expect(tm.executeWait()).toBe(true);
      }
      guard++;
    }
    expect(tm.getState()).toBe('game_over');
    expect((tm as any).voidTriggers).toBeGreaterThan(0); // 确保确实遭遇并触发了空亡吞噬
    const localFinalScore = tm.getScore();

    // 服务端重放
    const resultV7 = await replayGame({
      seed,
      actions,
      rulesVersion: snapshotV7.rulesVersion,
      volatility: snapshotV7.volatility,
      scoreRules: snapshotV7.scoreRules,
    });

    expect(resultV7.rulesVersion).toBe(7);
    expect(resultV7.completed).toBe(true);
    expect(resultV7.rounds).toBe(60);
    expect(resultV7.score).toBe(localFinalScore);
  });
});
