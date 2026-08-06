import { describe, expect, it } from 'vitest';
import {
  SeededRandomSource,
  TurnManager,
  HandSlot,
  buildProjectedHoldings,
} from '../../src/core/index';

async function startedGame(seed: number) {
  const manager = new TurnManager(undefined, new SeededRandomSource(seed));
  await manager.initialize();
  manager.startGame();
  return manager;
}

describe('buildProjectedHoldings（预测层持仓明细 · issue 05）', () => {
  it('纳灵预览：蓝框并入将入手的新牌，标记为 isNewBuy', async () => {
    const tm = await startedGame(99);
    (tm as any).seasonCycle.loadState(0, 1, [12, 12, 12, 12]);
    const publicCards = tm.getPublicCards();
    const hand = tm.getHand().filter((s): s is HandSlot => s !== null);
    const before = hand.length;

    const projected = buildProjectedHoldings(
      tm,
      tm.getHand(),
      { type: 'buy', cardIndex: 0, leverage: true },
      publicCards,
      true,
    );

    expect(projected.length).toBe(before + 1);
    const newCard = projected[projected.length - 1];
    expect(newCard.isNewBuy).toBe(true);
    expect(newCard.name).toBe(publicCards[0].name);
    expect(newCard.isLeverage).toBe(true);
  });

  it('释灵预览：蓝框剔除将卖出的牌', async () => {
    const tm = await startedGame(99);
    (tm as any).seasonCycle.loadState(0, 1, [12, 12, 12, 12]);
    const publicCards = tm.getPublicCards();
    const card = publicCards[0];
    const held: (HandSlot | null)[] = [
      new HandSlot(card, tm.getCardScore(card, tm.getCurrentSeason()), false, 1, 1, 0),
      null,
      null,
    ];

    const projectedBefore = buildProjectedHoldings(tm, held, { type: 'wait' }, publicCards, false);
    expect(projectedBefore.length).toBe(1);

    const projectedAfter = buildProjectedHoldings(tm, held, { type: 'sell', slotIndex: 0 }, publicCards, false);
    expect(projectedAfter.length).toBe(0);
  });

  it('季末时新买入牌用假设不换季的幻影杠杆（不泄露换季）', async () => {
    const tm = await startedGame(99);
    // 季末：roundInSeason === seasonLength（season 2 长度 5）
    (tm as any).seasonCycle.loadState(2, 5, [12, 12, 5, 12]);
    const publicCards = tm.getPublicCards();
    const card = publicCards[0];

    const projected = buildProjectedHoldings(
      tm,
      [],
      { type: 'buy', cardIndex: 0, leverage: true },
      publicCards,
      true,
    );
    expect(projected.length).toBe(1);
    const newCard = projected[0];

    const score = tm.getCardScore(card, tm.getCurrentSeason());
    const phantomLev = tm.getNextLeverageNoSeasonChange();
    const realSettleLev = tm.getSettlementLeverageMultiplier();

    // 真实下回合倍数在季末重置为 1.0x；假设不换季的幻影倍数与之不同 → 不泄露换季
    expect(realSettleLev).toBe(1.0);
    expect(phantomLev).not.toBe(realSettleLev);

    // 投影 earning 必须用幻影杠杆计算，而非真实结算杠杆
    expect(newCard.earning).toBeCloseTo(tm.previewHoldEarning(score, phantomLev));
    expect(newCard.earning).not.toBeCloseTo(tm.previewHoldEarning(score, realSettleLev));
  });
});
