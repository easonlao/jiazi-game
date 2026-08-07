/**
 * 存档版本兼容测试。
 *
 * 游戏已上线，老玩家浏览器中存着旧版本存档。新代码读取旧档时，
 * importSnapshot 有兼容逻辑：缺 lockedQi/useLeverage 时回退计算、
 * 缺 lockedCardIds 时置空。这些回退路径此前无测试——一旦破坏，
 * 老玩家更新后读档会崩溃（发布崩溃风险）。
 */
import { describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { GameSaveService } from '../../src/core/GameSaveService';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameSnapshot } from '../../src/core/GameSaveService';

class LocalStorageMock {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
(globalThis as any).localStorage = new LocalStorageMock();

async function makeTm(seed = 42) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(undefined, new SeededRandomSource(seed));
  await tm.initialize();
  return tm;
}

/** 生成一份合法存档：第 5 回合、持有 1 张牌、气 60 */
function makeValidSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    currentRound: 5,
    state: 'player_action',
    lastAction: 'buy',
    qi: 60,
    score: 120,
    totalHoldEarnings: 10,
    totalSellEarnings: 110,
    totalBuys: 1,
    totalSells: 0,
    totalWaits: 0,
    totalLeverageBuys: 0,
    season: { index: 0, roundInSeason: 5, lengths: [12, 12, 12, 12] },
    hand: [{
      cardId: 1,
      buyScore: 10,
      useLeverage: false,
      leverage: 1,
      buyRound: 1,
      lockedQi: 10,
      holdEarnings: 5,
    }, null, null],
    pool: { deckIds: [2, 3, 4], publicIds: [5, 6, 7] },
    lockedCardIds: [],
    ...overrides,
  };
}

describe('存档版本兼容（旧档 → 新代码）', () => {
  it('完整新版存档：正常还原不报错', async () => {
    const tm = await makeTm();
    expect(() => tm.importSnapshot(makeValidSnapshot())).not.toThrow();
    expect(tm.getCurrentRound()).toBe(5);
    expect(tm.getQi()).toBe(60);
    expect(tm.getScore()).toBe(120);
    expect(tm.getHand().filter(Boolean)).toHaveLength(1);
  });

  it('旧档缺 lockedQi：回退为 buyCost - entryFee，不崩溃', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    const slot = oldSave.hand[0] as any;
    delete slot.lockedQi; // 模拟旧版存档没有该字段

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    const restored = tm.getHand()[0];
    expect(restored).not.toBeNull();
    // 回退值 = max(0, buyCost(10, 无杠杆) - entryFee(2))，buyCost = ceil(11*(1+0.005*10)) = ceil(11.55) = 12 → 10
    expect(restored!.lockedQi).toBe(10);
  });

  it('旧档缺 useLeverage：按 leverage > 1 回退判断', async () => {
    const tm = await makeTm();
    // 场景 A：leverage=1 → 回退为 false（未启用杠杆）
    const plainOld = makeValidSnapshot();
    const slotA = plainOld.hand[0] as any;
    delete slotA.useLeverage;
    slotA.leverage = 1;
    tm.importSnapshot(plainOld);
    expect(tm.getHand()[0]!.useLeverage).toBe(false);

    // 场景 B：leverage=2.5 → 回退为 true（启用杠杆）
    const leverageOld = makeValidSnapshot();
    const slotB = leverageOld.hand[0] as any;
    delete slotB.useLeverage;
    slotB.leverage = 2.5;
    tm.importSnapshot(leverageOld);
    expect(tm.getHand()[0]!.useLeverage).toBe(true);
  });

  it('旧档缺 lockedCardIds：置空不崩溃', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).lockedCardIds;

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getLockedCardIds()).toEqual([]);
  });

  it('旧档缺 totalBuys 等统计字段：回退为 0 不崩溃', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).totalBuys;
    delete (oldSave as any).totalSells;
    delete (oldSave as any).totalWaits;
    delete (oldSave as any).totalLeverageBuys;

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getTotalBuys()).toBe(0);
    expect(tm.getTotalSells()).toBe(0);
  });

  it('旧档手牌含 null 槽位：安全跳过', async () => {
    const tm = await makeTm();
    const oldSave = makeValidSnapshot();
    oldSave.hand = [null, null, null]; // 空手牌存档

    expect(() => tm.importSnapshot(oldSave)).not.toThrow();
    expect(tm.getHand()).toHaveLength(3);
    expect(tm.getHand().filter(Boolean)).toHaveLength(0);
  });

  it('坏档（卡牌 ID 不存在）：importSnapshot 抛错（由 GameSaveService 捕获）', async () => {
    const tm = await makeTm();
    const badSave = makeValidSnapshot();
    (badSave.hand[0] as any).cardId = 9999; // 不存在的卡

    expect(() => tm.importSnapshot(badSave)).toThrow();
  });

  it('新档含 totalMarginCallPenalty：还原保留；老档缺该字段：回退 0', async () => {
    // 新档：含反噬罚分累计
    const tm1 = await makeTm();
    tm1.importSnapshot(makeValidSnapshot({ totalMarginCallPenalty: 42 }));
    expect(tm1.getTotalMarginCallPenalty()).toBe(42);

    // 老档：无该字段（模拟旧版本存档）
    const tm2 = await makeTm();
    const oldSave = makeValidSnapshot();
    delete (oldSave as any).totalMarginCallPenalty;
    tm2.importSnapshot(oldSave);
    expect(tm2.getTotalMarginCallPenalty()).toBe(0);
  });
});

describe('GameSaveService 坏档防护（load 路径）', () => {
  it('qi 为 NaN / 缺失：拒绝并清理存档', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    // 用 GameSaveService 的 load 直接测（注入内存 storage）
    const svc = new GameSaveService(storage as any);

    store['jiazi_game_save'] = JSON.stringify({ currentRound: 3, qi: 'not-a-number' });
    const ok = svc.load(() => {});
    expect(ok).toBe(false);
    expect(store['jiazi_game_save']).toBeUndefined(); // 坏档已清理
  });

  it('JSON 损坏：load 捕获异常返回 false 不崩溃', () => {
    const store: Record<string, string> = { 'jiazi_game_save': '{broken json' };
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: () => {},
      removeItem: (k: string) => { delete store[k]; },
    };
    const svc = new GameSaveService(storage as any);
    expect(() => svc.load(() => {})).not.toThrow();
  });
});
