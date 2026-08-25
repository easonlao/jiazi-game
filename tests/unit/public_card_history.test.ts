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
});
