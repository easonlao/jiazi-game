/**
 * V5 空亡规则·集成测试：一局内空亡触发 → 季节跳转 → 终局 60 回合完成；
 * V4/base 路径回归不受影响。
 *
 * 覆盖（票 03 验收 + 一审 P1-①/P1-②）：
 * 1. V5 整局：开局强制空亡触发后，一局正常打完 60 回合终局（game_over），不崩；
 * 2. V5 牌守恒：deck + 公共区 + 手牌 = 63；
 * 3. V5 存档往返：base 构造读 V5 档 → 声明版本还原、V4 计分形状（scoreRules/scoreVolatility）、
 *    懒生成继续生效、续玩不崩；
 * 4. V5 季节时钟无界：整局季节段数平均 ≈15（30 局统计宽区间，不再被 60 总长 clamp 成 ~8）；
 * 5. V1-V4（base）回归：牌堆 60 张、无空亡牌、整局照常终局。
 */
import { describe, it, expect } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { isVoidCard } from '../../src/core/VoidCard';
import {
  RULES_VERSION_VOID,
  type SupportedRulesVersion,
} from '../../src/core/GameSaveService';
import { BAND_FACTOR } from '../../src/core/ScoreVolatility';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as any).localStorage = new (class {
  store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
})();

async function makeTm(seed: number, rulesVersion?: SupportedRulesVersion) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  (globalThis as any).fetch = async () => ({ json: async () => cardData });
  // V5 是波动规则版本：主随机与波动流分离，避免吞噬回合刷新波动扰动固定 seed 的主流行为。
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), rulesVersion !== undefined
    ? { rulesVersion, volatilityRandom: new SeededRandomSource(seed + 1) }
    : undefined);
  await tm.initialize();
  return tm;
}

/** V5 按 V4 生产方式接线（计分 = V4：conflict_banded 波动 + 释灵 6），存档可完整往返。 */
async function makeWiredVoidTm(seed: number) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  (globalThis as any).fetch = async () => ({ json: async () => cardData });
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    rulesVersion: RULES_VERSION_VOID,
    scoreRules: { holdBonus: 1.2, sellMultiplier: 6 },
    volatility: {
      enabled: true,
      model: 'conflict_banded',
      scale: 4,
      minDuration: 1,
      maxDuration: 3,
      maxScoreDelta: 2,
      bandFactors: { ...BAND_FACTOR, conflict: 3 },
    },
    volatilityRandom: new SeededRandomSource(7),
  });
  await tm.initialize();
  return tm;
}

/** 把一张空亡牌放到牌堆顶，保证第一回合必触发。 */
function forceVoidOnTop(tm: TurnManager): void {
  const pool = (tm as any).cardPoolManager;
  const deck = pool.getDeck();
  const jiazi = deck.filter((c: any) => !isVoidCard(c));
  const voids = deck.filter((c: any) => isVoidCard(c));
  deck.length = 0;
  deck.push(voids[0], ...jiazi, ...voids.slice(1));
}

function totalCards(tm: TurnManager): number {
  const deck = (tm as any).cardPoolManager.getDeck().length;
  const pub = tm.getPublicCards().length;
  const hand = tm.getHand().filter(Boolean).length;
  return deck + pub + hand;
}

describe('V5 空亡整局', () => {
  it('强制空亡触发后整局完成 60 回合终局（game_over），roundLog 完整', async () => {
    const tm = await makeTm(42, RULES_VERSION_VOID);
    forceVoidOnTop(tm);
    tm.startGame();

    // 第 1 回合被空亡吞噬：无玩家行动自动推进到第 2 回合
    expect(tm.getCurrentRound()).toBe(2);

    // 跑完整局
    let guard = 0;
    while (tm.getState() === 'player_action' && guard < 200) {
      tm.executeWait();
      guard++;
    }
    expect(tm.getState()).toBe('game_over');
    // 终局出清后 roundLog 至少覆盖完整 60 回合（含空亡回合与终局 settle 记录）
    expect(tm.getRoundLog().length).toBeGreaterThanOrEqual(60);
    // 第 1 回合空亡记录：action=null、结算落在跳跃后
    const first = tm.getRoundLog()[0];
    expect(first.round).toBe(1);
    expect(first.action).toBeNull();
    expect(first.settlement.baseQiRecover).toBe(10);
    expect(first.settlement.waitQiRecover).toBe(0);
  });

  it('V5 牌守恒：deck + 公共区 + 手牌恒为 63', async () => {
    const tm = await makeTm(7, RULES_VERSION_VOID);
    forceVoidOnTop(tm);
    tm.startGame();
    expect(totalCards(tm)).toBe(63);

    for (let i = 0; i < 10; i++) {
      if (tm.getState() !== 'player_action') break;
      tm.executeWait();
      expect(totalCards(tm)).toBe(63);
    }
    expect(tm.getPublicCards().length).toBe(3);
  });

  it('V5 存档往返：base 构造读 V5 档 → 版本还原、V4 计分形状、懒生成继续生效、续玩不崩', async () => {
    const tm = await makeWiredVoidTm(11);
    tm.startGame();
    tm.executeWait();
    tm.executeWait();
    tm.executeWait();
    const snapshot = tm.exportSnapshot();
    expect(snapshot.rulesVersion).toBe(RULES_VERSION_VOID);
    expect(snapshot.pool.deckIds.length).toBeGreaterThan(0);
    // V5 计分 = V4：存档按 V4 形状持久化 scoreRules + scoreVolatility
    expect(snapshot.scoreRules).toEqual({ holdBonus: 1.2, sellMultiplier: 6 });
    expect(snapshot.scoreVolatility?.model).toBe('conflict_banded');

    // 用 base 构造（不传 rulesVersion）读 V5 档：声明版本优先，懒生成/计分随之还原
    const base = await makeTm(99);
    base.importSnapshot(snapshot);
    expect(base.exportSnapshot().rulesVersion).toBe(RULES_VERSION_VOID);
    expect(base.exportSnapshot().scoreRules).toEqual({ holdBonus: 1.2, sellMultiplier: 6 });

    // 续玩若干回合不崩，季节时钟继续推进
    const beforeSeason = base.getCurrentSeason();
    for (let i = 0; i < 8; i++) {
      if (base.getState() === 'player_action') base.executeWait();
    }
    expect(base.getCurrentRound()).toBeGreaterThan(snapshot.currentRound);
    expect(['spring', 'summer', 'autumn', 'winter']).toContain(base.getCurrentSeason());
    expect(beforeSeason).toBeDefined();
  });

  it('V5 季节时钟无界：30 局纯等待流平均季节段数 ≈15（不再被 60 总长 clamp 成 ~8）', async () => {
    const seasonCounts: number[] = [];
    for (let g = 0; g < 30; g++) {
      const tm = await makeTm(1000 + g * 7, RULES_VERSION_VOID);
      tm.startGame();
      let guard = 0;
      while (tm.getState() === 'player_action' && guard < 200) {
        tm.executeWait();
        guard++;
      }
      expect(tm.getState()).toBe('game_over');
      seasonCounts.push(((tm as any).seasonCycle as { getSeasonLengths(): number[] }).getSeasonLengths().length);
    }
    const avg = seasonCounts.reduce((a, b) => a + b, 0) / seasonCounts.length;
    expect(avg).toBeGreaterThanOrEqual(12);
    expect(avg).toBeLessThanOrEqual(19);
  });
});

describe('V1-V4（base）路径回归', () => {
  it('base 牌堆 60 张、公共牌永不含空亡牌，整局照常终局', async () => {
    const tm = await makeTm(3);
    const pool = (tm as any).cardPoolManager;
    expect(pool.getDeck().length).toBe(60);
    expect(pool.getDeck().some((c: any) => isVoidCard(c))).toBe(false);

    tm.startGame();
    let guard = 0;
    while (tm.getState() === 'player_action' && guard < 200) {
      // 公共区不得出现空亡牌；玩家行动态守恒 = 60
      expect(tm.getPublicCards().some((c) => isVoidCard(c))).toBe(false);
      expect(totalCards(tm)).toBe(60);
      tm.executeWait();
      guard++;
    }
    expect(tm.getState()).toBe('game_over');
  });
});
