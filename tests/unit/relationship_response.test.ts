/** V10 干支关系响应：本地引擎、存档与历史 V9 隔离。 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CURRENT_REPLAY_RULES,
  RELATIONSHIP_RESPONSE_REPLAY_RULES,
  RULES_VERSION_RELATIONSHIP_RESPONSE,
  SeededRandomSource,
  TurnManager,
  replayGame,
} from '../../src/core';

const CARD_DATA = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));

async function makeV10(seed = 42, voidCardCount = 0): Promise<TurnManager> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => CARD_DATA }));
  const random = new SeededRandomSource(seed);
  const tm = new TurnManager(undefined, random, {
    rulesVersion: RULES_VERSION_RELATIONSHIP_RESPONSE,
    scoreRules: RELATIONSHIP_RESPONSE_REPLAY_RULES.scoreRules,
    volatility: RELATIONSHIP_RESPONSE_REPLAY_RULES.volatility,
    volatilityRandom: random,
    branchRollRandom: random,
    voidConfig: {
      voidCardCount,
      voidKMin: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidKMin,
      voidKMax: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidKMax,
    },
  });
  await tm.initialize();
  return tm;
}

describe('V10 干支关系响应', () => {
  it('V10 是生产默认规则，V9 仍保留给历史对局解释', () => {
    expect(RELATIONSHIP_RESPONSE_REPLAY_RULES.rulesVersion).toBe(RULES_VERSION_RELATIONSHIP_RESPONSE);
    expect(RELATIONSHIP_RESPONSE_REPLAY_RULES.volatility.model).toBe('relationship_response');
    expect(RELATIONSHIP_RESPONSE_REPLAY_RULES.relationshipResponse).toEqual({ enabled: true, formulaVersion: 1 });
    expect(CURRENT_REPLAY_RULES.rulesVersion).toBe(RULES_VERSION_RELATIONSHIP_RESPONSE);
  });

  it('首季建立 60 张冻结 entry/target，季末精确收敛到 target', async () => {
    const tm = await makeV10(11);
    tm.startGame();
    const card = tm.getPublicCards()[0]!;
    const state = tm.getScoreVolatilityState()!;
    expect(state.model).toBe('relationship_response');
    expect(Object.keys(state.relationshipResponseByCardId ?? {})).toHaveLength(60);

    let guard = 0;
    while (tm.getCurrentRoundInSeason() < tm.getCurrentSeasonLength()) {
      expect(tm.executeWait()).toBe(true);
      guard++;
      expect(guard).toBeLessThan(20);
    }
    const closing = tm.getCardScore(card, tm.getCurrentSeason());
    expect(closing).toBe(state.relationshipResponseByCardId![card.id]!.targetScore);
  });

  it('换季以旧季实际收盘作为下一季 entry，不另掷独立趋势随机数', async () => {
    const tm = await makeV10(99);
    tm.startGame();
    const card = tm.getPublicCards()[0]!;
    let guard = 0;
    while (tm.getCurrentRoundInSeason() < tm.getCurrentSeasonLength()) {
      expect(tm.executeWait()).toBe(true);
      guard++;
      expect(guard).toBeLessThan(20);
    }
    const closing = tm.getCardScore(card, tm.getCurrentSeason());
    expect(tm.executeWait()).toBe(true);
    const nextState = tm.getScoreVolatilityState()!;
    expect(nextState.relationshipResponseByCardId![card.id]!.entryScore).toBe(closing);
    expect(nextState.trendWindowByCardId).toBeUndefined();
  });

  it('存档往返后当前分与 V10 响应状态逐字段保持一致', async () => {
    const source = await makeV10(123);
    source.startGame();
    expect(source.executeWait()).toBe(true);
    expect(source.executeWait()).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(source.exportSnapshot()));

    const restored = await makeV10(456);
    restored.importSnapshot(snapshot);
    expect(restored.getRulesVersion()).toBe(RULES_VERSION_RELATIONSHIP_RESPONSE);
    expect(restored.exportSnapshot()).toEqual(source.exportSnapshot());
  });

  it('中途存档后跨换季与空亡吞噬继续，逐回合评分与不中断对局一致', async () => {
    const seed = 20260831;
    const uninterrupted = await makeV10(seed, 1);
    uninterrupted.startGame();
    const actions: Array<{ type: 'wait' }> = [];
    while (actions.length < 5) {
      actions.push({ type: 'wait' });
      expect(uninterrupted.executeWait()).toBe(true);
    }
    const snapshot = JSON.parse(JSON.stringify(uninterrupted.exportSnapshot()));
    const restored = await makeV10(1, 1);
    restored.importSnapshot(snapshot);

    const trail = (tm: TurnManager) => ({
      round: tm.getCurrentRound(),
      season: tm.getCurrentSeason(),
      seasonRound: tm.getCurrentRoundInSeason(),
      score: tm.getScore(),
      publicScores: tm.getPublicCards().map((card) => tm.getCardScore(card, tm.getCurrentSeason())),
      void: tm.getVoidStats(),
    });
    for (let index = 0; index < 55 && uninterrupted.getState() === 'player_action'; index += 1) {
      actions.push({ type: 'wait' });
      expect(uninterrupted.executeWait()).toBe(true);
      expect(restored.executeWait()).toBe(true);
      expect(trail(restored)).toEqual(trail(uninterrupted));
    }
    expect(uninterrupted.getState()).toBe('game_over');
    expect(restored.getState()).toBe('game_over');
    expect(uninterrupted.getVoidStats().triggers).toBeGreaterThan(0);

    const replayed = await replayGame({
      seed,
      actions,
      rulesVersion: RELATIONSHIP_RESPONSE_REPLAY_RULES.rulesVersion,
      volatility: RELATIONSHIP_RESPONSE_REPLAY_RULES.volatility,
      scoreRules: RELATIONSHIP_RESPONSE_REPLAY_RULES.scoreRules,
      voidCardCount: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidCardCount,
      voidKMin: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidKMin,
      voidKMax: RELATIONSHIP_RESPONSE_REPLAY_RULES.voidKMax,
    });
    expect(replayed.score).toBe(uninterrupted.getScore());
    expect(replayed.rounds).toBe(60);
  });

  it('读取评分纯粹，买卖、锁定与完整 60 回合结算共用同一 V10 评分入口', async () => {
    const tm = await makeV10(2026);
    tm.startGame();
    const initialCard = tm.getPublicCards()[0]!;
    const beforeState = tm.getScoreVolatilityState();
    const first = tm.getCardScore(initialCard, tm.getCurrentSeason());
    const second = tm.getCardScore(initialCard, tm.getCurrentSeason());
    expect(second).toBe(first);
    expect(tm.getScoreVolatilityState()).toEqual(beforeState);

    expect(tm.executeLockCard(0).ok).toBe(true);
    expect(tm.executeUnlockCard(0)).toBe(true);
    expect(tm.executeBuy(0, false)).toBe(true);
    expect(tm.executeSell(0)).toBe(true);

    let guard = 0;
    while (tm.getState() === 'player_action') {
      expect(tm.executeWait()).toBe(true);
      guard++;
      expect(guard).toBeLessThan(61);
    }
    expect(tm.getState()).toBe('game_over');
    expect(tm.getCurrentRound()).toBeGreaterThanOrEqual(60);
    expect(tm.getRoundLog().length).toBeGreaterThanOrEqual(60);
  });

  it('拒绝缺少任一甲子响应状态的 V10 存档，避免读档后评分漂移', async () => {
    const source = await makeV10(321);
    source.startGame();
    const snapshot = source.exportSnapshot();
    delete snapshot.scoreVolatility!.relationshipResponseByCardId![1];

    const target = await makeV10(777);
    expect(() => target.importSnapshot(snapshot)).toThrow(/必须包含 60 张甲子牌/);
  });
});
