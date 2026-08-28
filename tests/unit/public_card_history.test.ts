import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { RULES_VERSION_VOID, type SupportedRulesVersion } from '../../src/core/GameSaveService';
import { isVoidCard } from '../../src/core/VoidCard';
import { cardTrace } from '../../app/src/lib/cardSummary';
import { buildPublicCardHistoryView } from '../../app/src/lib/publicCardHistory';

async function makeTm(seed = 42, rulesVersion?: SupportedRulesVersion) {
  const cardData = JSON.parse(readFileSync(resolve(process.cwd(), 'assets/data/jiazi_cards.json'), 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => cardData }));
  const tm = new TurnManager(
    undefined,
    new SeededRandomSource(seed),
    rulesVersion === undefined ? undefined : { rulesVersion },
  );
  await tm.initialize();
  return tm;
}

function forceVoidOnTop(tm: TurnManager): void {
  const deck = (tm as any).cardPoolManager.getDeck();
  const jiazi = deck.filter((card: unknown) => !isVoidCard(card as never));
  const voids = deck.filter((card: unknown) => isVoidCard(card as never));
  deck.length = 0;
  deck.push(voids[0], ...jiazi, ...voids.slice(1));
}

describe('公共卡池历史快照', () => {
  it('连续回合会记录 60 张普通甲子牌的真实评分', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();

    const history = tm.getPublicCardHistory();
    expect(history.length).toBe(2);
    expect(history[0]?.round).toBe(1);
    expect(history[1]?.round).toBe(2);
    expect(history[0]?.scores).toHaveLength(60);
    expect(history[1]?.scores).toHaveLength(60);
  });

  it('买入后牌离开公共池，但历史曲线继续追加且保持连续', async () => {
    const tm = await makeTm();
    tm.startGame();
    const card = tm.getPublicCards()[0];
    expect(card).toBeTruthy();
    expect(tm.executeBuy(0, false)).toBe(true);

    expect(tm.getPublicCards().some((c) => c.id === card.id)).toBe(false);
    const historyAfterBuy = tm.getPublicCardHistoryForCard(card.id);
    expect(historyAfterBuy).toHaveLength(2);
    expect(historyAfterBuy.map((p) => p.round)).toEqual([1, 2]);

    expect(tm.executeWait()).toBe(true);
    const historyAfterWait = tm.getPublicCardHistoryForCard(card.id);
    expect(historyAfterWait).toHaveLength(3);
    expect(historyAfterWait.map((p) => p.round)).toEqual([1, 2, 3]);
  });

  it('导出后的历史快照不会被后续回合改写', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();

    const snapshot = tm.exportSnapshot();
    const original = snapshot.publicCardHistory?.map((entry) => ({ round: entry.round, scores: [...entry.scores] })) ?? [];

    tm.executeWait();

    expect(snapshot.publicCardHistory).toEqual(original);
    expect(snapshot.publicCardHistory).not.toBe(tm.exportSnapshot().publicCardHistory);
  });

  it('历史只包含已发生回合，空亡牌不会得到伪造的零分曲线', async () => {
    const tm = await makeTm();
    tm.startGame();
    tm.executeWait();

    expect(Math.max(...tm.getPublicCardHistory().map((entry) => entry.round))).toBeLessThanOrEqual(tm.getCurrentRound());
    expect(tm.getPublicCardHistoryForCard(61)).toEqual([]);
  });

  it('空亡吞噬回合仍记录 60 张普通牌，曲线不会跳过该回合', async () => {
    const tm = await makeTm(7, RULES_VERSION_VOID);
    forceVoidOnTop(tm);
    tm.startGame();

    const history = tm.getPublicCardHistory();
    expect(history.map((entry) => entry.round)).toEqual([1, 2]);
    expect(history.every((entry) => entry.scores.length === 60)).toBe(true);
    expect(tm.getPublicCardHistoryForCard(1).map((point) => point.round)).toEqual([1, 2]);
  });

  it('卡牌行迹按真实 actionRound 排序，买入与卖出顺序正确', async () => {
    const tm = await makeTm();
    tm.startGame();
    const card = tm.getPublicCards()[0];
    const name = card.name;
    expect(tm.executeBuy(0, false)).toBe(true);
    expect(tm.executeSell(0)).toBe(true);

    const trace = cardTrace(tm.getRoundLog(), name).filter((item) => item.kind === 'buy' || item.kind === 'sell' || item.kind === 'settle');
    expect(trace.map((item) => item.kind)).toEqual(['buy', 'sell']);
    expect(trace.map((item) => item.actionRound)).toEqual([1, 2]);
    expect(trace.map((item) => item.round)).toEqual([2, 3]);
  });

  it('终局出清记录回退到实际交易回合 60', async () => {
    const tm = await makeTm();
    tm.startGame();
    expect(tm.executeBuy(0, false)).toBe(true);

    const tmAny = tm as any;
    tmAny.currentRound = 60;
    tmAny.state = 'player_action';
    tmAny.lastAction = 'wait';
    tmAny.lastActionRound = 60;

    expect(tm.executeWait()).toBe(true);
    const settleEntry = tm.getRoundLog().find((entry) => entry.action === 'settle');
    expect(settleEntry?.actionRound).toBe(60);
  });

  it('新存档续局后保留曲线与交易记录，并能继续追加', async () => {
    const source = await makeTm();
    source.startGame();
    const card = source.getPublicCards()[0]!;
    expect(source.executeBuy(0, false)).toBe(true);

    const beforeSave = buildPublicCardHistoryView(card, source, source.getRoundLog());
    const restored = await makeTm(99);
    restored.importSnapshot(source.exportSnapshot());
    const afterRestore = buildPublicCardHistoryView(card, restored, restored.getRoundLog());

    expect(afterRestore.points).toEqual(beforeSave.points);
    expect(afterRestore.transactions).toEqual(beforeSave.transactions);
    expect(afterRestore.transactions.map((item) => item.kind)).toEqual(['buy']);

    expect(restored.executeSell(0)).toBe(true);
    const afterSell = buildPublicCardHistoryView(card, restored, restored.getRoundLog());
    expect(afterSell.points.map((point) => point.round)).toEqual([1, 2, 3]);
    expect(afterSell.transactions.map((item) => item.kind)).toEqual(['buy', 'sell']);
    expect(afterSell.transactions.map((item) => item.actionRound)).toEqual([1, 2]);
  });

  it('旧存档只从续局回合开始记录，并且兼容补录不冒充真实交易', async () => {
    const source = await makeTm();
    source.startGame();
    const card = source.getPublicCards()[0]!;
    expect(source.executeBuy(0, false)).toBe(true);

    const legacySnapshot = source.exportSnapshot();
    legacySnapshot.schemaVersion = 1;
    delete legacySnapshot.publicCardHistory;
    legacySnapshot.roundLog = [];

    const restored = await makeTm(99);
    restored.importSnapshot(legacySnapshot);
    const view = buildPublicCardHistoryView(card, restored, restored.getRoundLog());

    expect(view.points).toHaveLength(1);
    expect(view.points[0]?.round).toBe(restored.getCurrentRound());
    expect(view.earlyHistoryUnavailable).toBe(true);
    expect(restored.getRoundLog().some((entry) => entry.compatReconstructed)).toBe(true);
    expect(view.transactions).toEqual([]);
  });

  it('按真实回合推进计算四季分段，支持跨季与多回合连续聚合', async () => {
    const tm = await makeTm();
    tm.startGame();
    const card = tm.getPublicCards()[0]!;

    // 推进多个回合直到产生跨季
    for (let i = 0; i < 16; i++) {
      tm.executeWait();
    }

    const view = buildPublicCardHistoryView(card, tm, tm.getRoundLog());
    expect(view.seasonBands.length).toBeGreaterThanOrEqual(2);
    expect(view.seasonBands[0]?.season).toBe('spring');
    expect(view.seasonBands[0]?.startRound).toBe(1);
    expect(view.seasonBands[1]?.season).toBe('summer');
    expect(view.seasonBands[1]?.startRound).toBe(view.seasonBands[0]!.endRound + 1);
    expect(view.points.every((p) => p.season !== null)).toBe(true);
    expect(view.hasUnknownSeasons).toBe(false);
  });

  it('V5 空亡吞噬跨季后，四季色带边界随实际跳跃而非固定 15 回合', async () => {
    const tm = await makeTm(7, RULES_VERSION_VOID);
    forceVoidOnTop(tm);
    tm.startGame(); // 吞噬后直接落在 summer（季长被吞噬缩短）

    // 推进数回合直到自然跨入 autumn
    while (tm.getCurrentSeason() === 'summer' && tm.getCurrentRound() < 25) {
      tm.executeWait();
    }

    const card = tm.getPublicCards()[0]!;
    const view = buildPublicCardHistoryView(card, tm, tm.getRoundLog());

    expect(view.seasonBands.length).toBeGreaterThanOrEqual(2);
    expect(view.seasonBands[0]?.season).toBe('summer');
    expect(view.seasonBands[1]?.season).toBe('autumn');
    // 夏季结束回合远小于常规 30 回合，证明色带按实际事实生成而非固定 15 回合推测
    expect(view.seasonBands[0]!.endRound).toBeLessThan(15);
    expect(view.seasonBands[1]!.startRound).toBe(view.seasonBands[0]!.endRound + 1);
  });

  it('旧存档未记录历史季节时安全降级，不捏造虚假季节分段', async () => {
    const source = await makeTm();
    source.startGame();
    const card = source.getPublicCards()[0]!;

    const legacySnapshot = source.exportSnapshot();
    legacySnapshot.schemaVersion = 1;
    delete legacySnapshot.publicCardHistory;
    legacySnapshot.roundLog = [];

    const restored = await makeTm(99);
    restored.importSnapshot(legacySnapshot);
    const view = buildPublicCardHistoryView(card, restored, restored.getRoundLog());

    // 续局回合有当前季节，较早历史无伪造
    expect(view.points[0]?.season).toBe(restored.getCurrentSeason());
    expect(view.seasonBands).toHaveLength(1);
    expect(view.seasonBands[0]?.season).toBe(restored.getCurrentSeason());
  });

  it('换季边界的买卖记录按实际发生的 actionRound 派生季节，与曲线色带严格一致', async () => {
    const tm = await makeTm();
    tm.startGame();

    // 推进到春季最后一回合
    while (tm.getCurrentRoundInSeason() < tm.getCurrentSeasonLength()) {
      tm.executeWait();
    }
    const springLastRound = tm.getCurrentRound();
    expect(tm.getCurrentSeason()).toBe('spring');

    const cardToBuy = tm.getPublicCards()[0]!;

    // 在春季末买入
    expect(tm.executeBuy(0, false)).toBe(true);
    // 买入结算后推进到夏季
    expect(tm.getCurrentSeason()).toBe('summer');

    const view = buildPublicCardHistoryView(cardToBuy, tm, tm.getRoundLog());
    const buyTx = view.transactions.find((t) => t.kind === 'buy' && t.actionRound === springLastRound);
    expect(buyTx).toBeDefined();
    // 即使 roundLog 归档时已跨入夏季，buyTx 的季节必须为 spring
    expect(buyTx?.season).toBe('spring');
  });

  it('买入持有至第 60 回合终局出清，能在视图中准确提取 settle 交易并匹配终局点', async () => {
    const tm = await makeTm();
    tm.startGame();
    const card = tm.getPublicCards()[0]!;

    // 回合 1 买入
    expect(tm.executeBuy(0, false)).toBe(true);

    // 一路调息直到第 60 回合终局
    while (tm.getState() === 'player_action') {
      tm.executeWait();
    }
    expect(tm.getState()).toBe('game_over');

    const view = buildPublicCardHistoryView(card, tm, tm.getRoundLog());
    const buyTx = view.transactions.find((t) => t.kind === 'buy');
    const settleTx = view.transactions.find((t) => t.kind === 'settle');

    expect(buyTx).toBeDefined();
    expect(buyTx?.actionRound).toBe(1);
    expect(buyTx?.season).toBe('spring');

    expect(settleTx).toBeDefined();
    expect(settleTx?.actionRound).toBe(60);
    expect(settleTx?.season).toBe('winter');
    expect(settleTx?.kind).toBe('settle');
    expect(typeof settleTx?.value).toBe('number');
    expect(typeof settleTx?.earnings).toBe('number');

    const round60Point = view.points.find((p) => p.round === 60);
    expect(round60Point).toBeDefined();
    expect(round60Point?.score).toBe(settleTx?.value);
    expect(round60Point?.season).toBe('winter');
  });

  it('买入与卖出均能在视图中准确提取，且与买卖记录一致', async () => {
    const tm = await makeTm();
    tm.startGame();
    const card = tm.getPublicCards()[0]!;

    // 回合 1 买入
    expect(tm.executeBuy(0, false)).toBe(true);
    // 回合 2 等待
    expect(tm.executeWait()).toBe(true);
    // 回合 3 卖出
    expect(tm.executeSell(0)).toBe(true);

    const view = buildPublicCardHistoryView(card, tm, tm.getRoundLog());
    expect(view.transactions).toHaveLength(2);
    expect(view.transactions[0]?.kind).toBe('buy');
    expect(view.transactions[0]?.actionRound).toBe(1);
    expect(view.transactions[1]?.kind).toBe('sell');
    expect(view.transactions[1]?.actionRound).toBe(3);
    expect(view.transactions[0]?.season).toBe('spring');
    expect(typeof view.transactions[0]?.value).toBe('number');
    expect(typeof view.transactions[1]?.earnings).toBe('number');
  });

  it('单牌行迹提取真实发生的空亡吞噬事件（含连触多张合并为总步数）', async () => {
    const tm = await makeTm(42, RULES_VERSION_VOID);
    // 强制牌堆顶为空亡牌
    forceVoidOnTop(tm);
    tm.startGame();

    // 触发空亡后记录 log
    const log = tm.getRoundLog();
    const voidRoundEntry = log.find((e) => e.voidSwallow && e.voidSwallow.totalK > 0);
    expect(voidRoundEntry).toBeDefined();

    const card = tm.getPublicCards()[0]!;
    const view = buildPublicCardHistoryView(card, tm, log);

    expect(view.voidEvents.length).toBeGreaterThanOrEqual(1);
    const ev = view.voidEvents.find((e) => e.round === voidRoundEntry?.round);
    expect(ev).toBeDefined();
    expect(ev?.totalK).toBe(voidRoundEntry?.voidSwallow?.totalK);
    expect(ev?.count).toBe(voidRoundEntry?.voidSwallow?.count);
    expect(typeof ev?.swallowed).toBe('number');
  });

  it('无空亡事件或旧存档降级时不伪造空亡吞噬标记', async () => {
    const tm = await makeTm();
    tm.startGame();
    // 正常等待数回合
    tm.executeWait();
    tm.executeWait();

    const card = tm.getPublicCards()[0]!;
    // 模拟无 voidSwallow 的 log
    const cleanLog = tm.getRoundLog().map((e) => ({ ...e, voidSwallow: null }));
    const view = buildPublicCardHistoryView(card, tm, cleanLog);

    expect(view.voidEvents).toHaveLength(0);

    // 模拟带有 compatReconstructed 的旧 log，即使带 voidSwallow 也不计入
    const compatLog = tm.getRoundLog().map((e) => ({
      ...e,
      compatReconstructed: true,
      voidSwallow: { count: 1, totalK: 5, maxK: 5, swallowed: 0 },
    }));
    const compatView = buildPublicCardHistoryView(card, tm, compatLog);
    expect(compatView.voidEvents).toHaveLength(0);
  });
});
