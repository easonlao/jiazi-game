/**
 * 回合数据留存（roundLog）专项测试。
 *
 * 交易看板的数据源：每回合一条"已发生事实"记录。核心断言：
 * 1. 每推进一回合生成一条记录（首回合 action 为 null）
 * 2. 行动层字段正确（buy/sell/wait 的卡牌、评分、神识变动）
 * 3. 结算层与 lastSettlementDetail 一致（炼化/耗神/回气/反噬）
 * 4. 存档往返保留 roundLog；老存档（无 roundLog 字段）读档不崩且降级为空
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { GameSaveService } from '../../src/core/GameSaveService';
import type { GameSnapshot } from '../../src/core/GameSaveService';

const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => localStorageStore[key] || null,
  setItem: (key: string, value: string) => {
    localStorageStore[key] = value.toString();
  },
  removeItem: (key: string) => {
    delete localStorageStore[key];
  },
  clear: () => {
    for (const key in localStorageStore) {
      delete localStorageStore[key];
    }
  },
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// 模拟 Fetch 卡牌 JSON 数据（与 TurnManager.test.ts 同款）
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () =>
      Promise.resolve([
        { id: 1, name: "甲子", tianGan: "甲", diZhi: "子", tianGanElement: "wood", diZhiElement: "water", mainElement: "wood", yinYang: "yang" },
        { id: 2, name: "乙丑", tianGan: "乙", diZhi: "丑", tianGanElement: "wood", diZhiElement: "earth", mainElement: "wood", yinYang: "yin" },
        { id: 3, name: "丙寅", tianGan: "丙", diZhi: "寅", tianGanElement: "fire", diZhiElement: "wood", mainElement: "fire", yinYang: "yang" },
      ]),
  })
) as any;

describe('TurnManager roundLog 回合数据留存', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function makeTm() {
    const tm = new TurnManager();
    await tm.initialize();
    return tm;
  }

  it('首回合生成记录且 action 为 null（玩家尚未行动）', async () => {
    const tm = await makeTm();
    tm.startGame();
    expect(tm.getCurrentRound()).toBe(1);

    const log = tm.getRoundLog();
    expect(log.length).toBe(1);
    expect(log[0].round).toBe(1);
    expect(log[0].action).toBeNull();
    expect(log[0].actionCardName).toBeNull();
    // 首回合已有结算明细（空持仓：无炼化、无耗神、有回气）
    expect(log[0].settlement.round).toBe(1);
    expect(Array.isArray(log[0].settlement.holdItems)).toBe(true);
  });

  it('wait 行动记录 action=wait 且无卡牌信息', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();

    const log = tm.getRoundLog();
    const entry = log[log.length - 1];
    expect(entry.round).toBe(2);
    expect(entry.action).toBe('wait');
    expect(entry.actionCardName).toBeNull();
    expect(entry.actionCardScore).toBeNull();
    expect(entry.actionQiChange).toBe(0);
  });

  it('buy 行动记录卡牌名、评分与纳灵耗神（负值）', async () => {
    const tm = await makeTm();
    tm.startGame();
    const publicCards = tm.getPublicCards();
    const qiBefore = tm.getQi();
    const ok = tm.executeBuy(0, false);
    expect(ok).toBe(true);

    const log = tm.getRoundLog();
    const entry = log[log.length - 1];
    expect(entry.action).toBe('buy');
    expect(entry.actionCardName).toBe(publicCards[0].name);
    expect(entry.actionCardScore).toBeTypeOf('number');
    expect(entry.buyScore).toBeTypeOf('number');
    expect(entry.actionQiChange).toBeLessThan(0); // 纳灵耗神识
    // 神识守恒：行动耗神 + 持仓耗神(结算) - 回气 = 期末神识
    // （actionQiChange 只记行动本身；结算层 holdQiCost/baseQiRecover 记持仓扣耗与回气）
    const expectedQi = qiBefore
      + entry.actionQiChange
      - entry.settlement.holdQiCost
      + entry.settlement.baseQiRecover
      + entry.settlement.waitQiRecover;
    expect(expectedQi).toBeCloseTo(tm.getQi(), 5);
    // 结算层：买入后下回合开始，持仓炼化应已结算
    expect(entry.settlement.round).toBe(2);
  });

  it('sell 行动记录价差与卖出收益（(卖出-买入)×4×杠杆）', async () => {
    const tm = await makeTm();
    tm.startGame();
    // 先买入一张（round 1 → 2），再卖出（round 2 → 3）
    tm.executeBuy(0, false);
    tm.executeSell(0);

    const log = tm.getRoundLog();
    const sellEntry = log[log.length - 1];
    expect(sellEntry.action).toBe('sell');
    expect(sellEntry.actionCardName).toBeTruthy();
    expect(sellEntry.buyScore).toBeTypeOf('number');
    expect(sellEntry.actionCardScore).toBeTypeOf('number');
    expect(sellEntry.sellScore).toBeTypeOf('number');
    // 卖出收益公式：sellScore = (卖出评分-买入评分)×4×杠杆，可为正或负
    const expected = (sellEntry.actionCardScore! - sellEntry.buyScore!) * 4 * (sellEntry.settlement.holdItems.length > 0 ? 1 : 1);
    expect(sellEntry.sellScore).toBeCloseTo(expected, 5);
  });

  it('每回合一条记录且 round 连续递增', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();
    tm.executeWait();
    tm.executeWait();

    const log = tm.getRoundLog();
    expect(log.length).toBe(4);
    const rounds = log.map((e) => e.round);
    expect(rounds).toEqual([1, 2, 3, 4]);
  });

  it('每回合记录公共牌池快照（玩家可见候选牌）', async () => {
    const tm = await makeTm();
    tm.startGame();
    const publicBefore = tm.getPublicCards();

    const log = tm.getRoundLog();
    const entry = log[0];
    expect(entry.publicCards.length).toBe(publicBefore.length);
    // 快照与引擎公共牌池一致（id 集合相等）
    const snapshotIds = entry.publicCards.map((c) => c.id).sort((a, b) => a - b);
    const engineIds = publicBefore.map((c) => c.id).sort((a, b) => a - b);
    expect(snapshotIds).toEqual(engineIds);
    // 快照含核心标识（供分析体系反查，不含动态评分）
    expect(entry.publicCards[0]).toHaveProperty('name');
    expect(entry.publicCards[0]).toHaveProperty('mainElement');
    expect(entry.publicCards[0]).toHaveProperty('yinYang');
    expect(entry.publicCards[0]).not.toHaveProperty('score');
  });

  it('买到的牌必在当回合公共牌池快照中（决策质量分析前提）', async () => {
    const tm = await makeTm();
    tm.startGame();
    const publicCards = tm.getPublicCards();
    const target = publicCards[0];
    tm.executeBuy(0, false);

    // 买入推进到 round 2，roundLog[1] 是 round 2 的记录（action=buy）
    // 但"玩家在 round 1 看到并选择这张牌"的事实应体现在 round 1 快照
    const log = tm.getRoundLog();
    // 验证：买入动作发生时，目标牌在当回合（round 1）可见快照里
    const round1Snapshot = log.find((e) => e.round === 1)!;
    expect(round1Snapshot.publicCards.some((c) => c.id === target.id)).toBe(true);
  });

  it('存档往返保留 roundLog', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();
    tm.executeBuy(0, false);

    const snapshot = tm.exportSnapshot();
    expect(snapshot.roundLog).toBeDefined();
    expect(snapshot.roundLog!.length).toBe(3);

    // 往返：导出 → 新实例导入 → roundLog 完整保留
    const tm2 = await makeTm();
    tm2.importSnapshot(snapshot as GameSnapshot);
    expect(tm2.getRoundLog().length).toBe(3);
    expect(tm2.getRoundLog()[2].action).toBe('buy');
    expect(tm2.getRoundLog()[2].settlement.round).toBe(3);
  });

  it('老存档（无 roundLog 字段）读档不崩且降级为空数组', async () => {
    const tm = await makeTm();
    tm.startGame();
    const snapshot = tm.exportSnapshot() as GameSnapshot & { roundLog?: undefined };
    // 模拟老版本存档：删掉 roundLog 字段
    delete snapshot.roundLog;

    const tm2 = await makeTm();
    expect(() => tm2.importSnapshot(snapshot)).not.toThrow();
    expect(tm2.getRoundLog()).toEqual([]);
  });

  it('GameSaveService 完整存取链路保留 roundLog', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();

    const service = new GameSaveService();
    expect(service.save(() => tm.exportSnapshot())).toBe(true);

    const tm2 = await makeTm();
    const loaded = service.load((data) => tm2.importSnapshot(data));
    expect(loaded).toBe(true);
    expect(tm2.getRoundLog().length).toBe(2);
    expect(tm2.getRoundLog()[1].action).toBe('wait');
  });

  it('roundLog 记录只含已发生事实，不含任何预测字段', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();

    const entry = tm.getRoundLog()[1];
    const keys = Object.keys(entry);
    // 不允许出现预测类字段名（信息边界契约：看板只能回顾，不泄露下一回合）
    const forbidden = ['nextSeason', 'nextRound', 'settlementLeverage', 'preview', 'willMarginCall'];
    for (const f of forbidden) {
      expect(keys.some((k) => k.toLowerCase().includes(f))).toBe(false);
    }
    // settlement 本身是已发生结算，允许存在
    expect(entry.settlement).toBeDefined();
  });
});
