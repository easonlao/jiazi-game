/**
 * 浓度溢价（V7 元素浓度）引擎与投影测试。
 *
 * 覆盖（2026-08-23 浓度 UI 落地 + V6 门控修复）：
 * 1. 版本门控：getConcentrationPremiumFactor 在 V7=1、V6=0（浓度是 V7 特性，V6 保留不激活）；
 * 2. buildProjectedHoldings 投影浓度：基于投影虚拟手牌计数（含新买并入/剔除卖出），
 *    qiCost 含浓度（V7）；V6 投影不含浓度、concentration 字段缺失。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { HandSlot } from '../../src/core/HandSlot';
import { buildProjectedHoldings } from '../../src/core/settlementProjection';
import { RULES_VERSION_BRANCH_ROLL, RULES_VERSION_TREND_WINDOW } from '../../src/core/GameSaveService';
import { BRANCH_ROLL_REPLAY_RULES, TREND_WINDOW_REPLAY_RULES } from '../../src/core/ReplayRules';
import { Element } from '../../src/core/JiaziCard';

const CARD_DATA = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));

async function startManager(rulesVersion: number, seed = 7) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => CARD_DATA }));
  // 与生产路径一致：volatility 来自对应 replay 规则快照（V7=trend_window，V6=conflict_banded）。
  const snapshot = rulesVersion === RULES_VERSION_TREND_WINDOW
    ? TREND_WINDOW_REPLAY_RULES
    : BRANCH_ROLL_REPLAY_RULES;
  const tm = new TurnManager(undefined, new SeededRandomSource(seed), {
    rulesVersion,
    volatility: snapshot.volatility,
  } as never);
  await tm.initialize();
  tm.startGame();
  return tm;
}

/** 从卡表里取两张同 mainElement 的卡 id。 */
function twoSameElementCards(): [number, number] {
  const byElement = new Map<string, number[]>();
  for (const c of CARD_DATA as { id: number; mainElement: string }[]) {
    const arr = byElement.get(c.mainElement) ?? [];
    arr.push(c.id);
    byElement.set(c.mainElement, arr);
  }
  for (const ids of byElement.values()) {
    if (ids.length >= 2) return [ids[0], ids[1]];
  }
  throw new Error('卡表无同元素双卡');
}

describe('浓度溢价版本门控（V7 专属）', () => {
  it('V7（trend_window）浓度系数 = 1', async () => {
    const tm = await startManager(RULES_VERSION_TREND_WINDOW);
    expect(tm.getConcentrationPremiumFactor()).toBe(1);
  });

  it('V6（地支波动）浓度系数 = 0（V6 保留不激活）', async () => {
    const tm = await startManager(RULES_VERSION_BRANCH_ROLL);
    expect(tm.getConcentrationPremiumFactor()).toBe(0);
  });
});

describe('buildProjectedHoldings 投影浓度', () => {
  it('V7：同元素 2 张 → 每张 qiCost 含浓度溢价 +1，concentration 标注 count=2/premium=1', async () => {
    const tm = await startManager(RULES_VERSION_TREND_WINDOW);
    const [idA, idB] = twoSameElementCards();
    const cardA = tm.getCardById(idA);
    const cardB = tm.getCardById(idB);
    expect(cardA.mainElement).toBe(cardB.mainElement);
    const season = tm.getCurrentSeason();
    const hand: (HandSlot | null)[] = [
      new HandSlot(cardA, tm.getCardScore(cardA, season), false, 1, 1, 0),
      new HandSlot(cardB, tm.getCardScore(cardB, season), false, 1, 1, 0),
      null,
    ];

    const projected = buildProjectedHoldings(tm, hand, { type: 'wait' }, tm.getPublicCards(), false);
    expect(projected).toHaveLength(2);
    for (const p of projected) {
      expect(p.concentration).toEqual({ count: 2, premium: 1 });
      const score = tm.getCardScore(p.name === cardA.name ? cardA : cardB, season);
      const isEarth = (p.name === cardA.name ? cardA : cardB).tianGanElement === Element.EARTH;
      // qiCost = 基础 + 浓度溢价（count=2, factor=1）
      expect(p.qiCost).toBeCloseTo(tm.previewHoldQiCost(score, 1, isEarth, 2, 1));
      // 含浓度 ≠ 无浓度（V6 口径）
      expect(p.qiCost).not.toBeCloseTo(tm.previewHoldQiCost(score, 1, isEarth, 1, 1));
    }
  });

  it('V7：同元素 1 张 → 无浓度溢价（concentration 缺失，qiCost 用 count=1）', async () => {
    const tm = await startManager(RULES_VERSION_TREND_WINDOW);
    const [idA] = twoSameElementCards();
    const cardA = tm.getCardById(idA);
    const season = tm.getCurrentSeason();
    const hand: (HandSlot | null)[] = [
      new HandSlot(cardA, tm.getCardScore(cardA, season), false, 1, 1, 0),
      null,
      null,
    ];

    const projected = buildProjectedHoldings(tm, hand, { type: 'wait' }, tm.getPublicCards(), false);
    expect(projected).toHaveLength(1);
    expect(projected[0].concentration).toBeUndefined();
    const score = tm.getCardScore(cardA, season);
    const isEarth = cardA.tianGanElement === Element.EARTH;
    expect(projected[0].qiCost).toBeCloseTo(tm.previewHoldQiCost(score, 1, isEarth, 1, 1));
  });

  it('V6：同元素 2 张 → 浓度不激活（concentration 缺失，qiCost 不含浓度）', async () => {
    const tm = await startManager(RULES_VERSION_BRANCH_ROLL);
    const [idA, idB] = twoSameElementCards();
    const cardA = tm.getCardById(idA);
    const cardB = tm.getCardById(idB);
    const season = tm.getCurrentSeason();
    const hand: (HandSlot | null)[] = [
      new HandSlot(cardA, tm.getCardScore(cardA, season), false, 1, 1, 0),
      new HandSlot(cardB, tm.getCardScore(cardB, season), false, 1, 1, 0),
      null,
    ];

    const projected = buildProjectedHoldings(tm, hand, { type: 'wait' }, tm.getPublicCards(), false);
    expect(projected).toHaveLength(2);
    for (const p of projected) {
      expect(p.concentration).toBeUndefined();
      const card = p.name === cardA.name ? cardA : cardB;
      const score = tm.getCardScore(card, season);
      const isEarth = card.tianGanElement === Element.EARTH;
      // V6：factor=0，浓度不叠加
      expect(p.qiCost).toBeCloseTo(tm.previewHoldQiCost(score, 1, isEarth, 2, 0));
    }
  });
});
