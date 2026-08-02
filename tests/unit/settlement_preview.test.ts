import { describe, expect, it } from 'vitest';
import { SeededRandomSource, TurnManager } from '../../src/core/index';

async function startedGame(seed: number) {
  const manager = new TurnManager(undefined, new SeededRandomSource(seed));
  await manager.initialize();
  manager.startGame();
  return manager;
}

function visibleState(manager: TurnManager) {
  return {
    round: manager.getCurrentRound(),
    qi: manager.getQi(),
    score: manager.getScore(),
    deckSize: manager.getDeckSize(),
    hand: manager.getHand().map((slot) => slot?.card.name ?? null),
    publicCards: manager.getPublicCards().map((card) => card.name),
  };
}

describe('TurnManager 行动前结算预览', () => {
  it('季内第5回合卡面当前倍率与下一回合结算倍率口径明确', async () => {
    const manager = await startedGame(99);
    (manager as any).seasonCycle.loadState(2, 5, [12, 12, 12, 12]);
    expect(manager.getLeverageMultiplier()).toBe(2.0);
    expect(manager.getSettlementLeverageMultiplier()).toBe(2.5);

    // 若第5回合恰为季末，卡面仍显示当前2.0x，同时明确下一回合已换季重置为1.0x。
    (manager as any).seasonCycle.loadState(2, 5, [12, 12, 5, 12]);
    expect(manager.getLeverageMultiplier()).toBe(2.0);
    expect(manager.getSettlementLeverageMultiplier()).toBe(1.0);
  });

  it('卡面趋势季固定取下一季，结算预览仍取下一回合季节', async () => {
    const manager = await startedGame(100);
    (manager as any).seasonCycle.loadState(0, 1, [12, 12, 12, 12]);
    expect(manager.getFollowingSeason()).toBe('summer');
    expect(manager.getSettlementSeason()).toBe('spring');

    (manager as any).seasonCycle.loadState(3, 1, [12, 12, 12, 12]);
    expect(manager.getFollowingSeason()).toBe('spring');
    expect(manager.getSettlementSeason()).toBe('winter');
  });

  it('非季末持仓预览使用下一回合实际季节评分，而非固定下一季趋势评分', async () => {
    const manager = await startedGame(111);
    (manager as any).seasonCycle.loadState(0, 1, [12, 12, 12, 12]);
    const cardIndex = manager.getPublicCards().findIndex((card) =>
      card.getSeasonScore('spring') !== card.getSeasonScore('summer'),
    );
    expect(cardIndex).toBeGreaterThanOrEqual(0);
    const card = manager.getPublicCards()[cardIndex]!;
    const settlementScore = card.getSeasonScore('spring');
    const trendScore = card.getSeasonScore('summer');

    expect(manager.executeBuy(cardIndex, false)).toBe(true);
    const preview = manager.previewSettlement({ type: 'wait' });
    expect(preview).not.toBeNull();
    expect(preview!.nextSeason).toBe('spring');
    expect(preview!.holdItems[0]!.earning).toBeCloseTo(manager.previewHoldEarning(settlementScore, 1));
    expect(preview!.holdItems[0]!.earning).not.toBeCloseTo(manager.previewHoldEarning(trendScore, 1));
  });

  it('等待预览不改变状态或消耗随机源，普通结算与实际逐项一致', async () => {
    const previewed = await startedGame(101);
    const baseline = await startedGame(101);
    const before = visibleState(previewed);

    const preview = previewed.previewSettlement({ type: 'wait' });

    expect(preview).not.toBeNull();
    expect(visibleState(previewed)).toEqual(before);
    expect(preview!.willMarginCall).toBe(false);
    expect(preview!.finalQi).not.toBeNull();
    expect(preview!.finalScore).not.toBeNull();

    expect(previewed.executeWait()).toBe(true);
    expect(baseline.executeWait()).toBe(true);
    expect(visibleState(previewed)).toEqual(visibleState(baseline));

    const actual = previewed.getLastSettlementDetail()!;
    expect(preview!.holdItems).toEqual(actual.holdItems);
    expect(preview!.holdEarnings).toBe(actual.holdEarnings);
    expect(preview!.holdQiCost).toBe(actual.holdQiCost);
    expect(preview!.finalQi).toBe(actual.finalQi);
    expect(preview!.finalScore).toBe(actual.finalScore);
  });

  it('买入和卖出均将即时变化纳入下回合的同源预览', async () => {
    const buyManager = await startedGame(102);
    const buyPreview = buyManager.previewSettlement({ type: 'buy', cardIndex: 0, leverage: false });
    expect(buyPreview).not.toBeNull();
    expect(buyPreview!.actionQiChange).toBeLessThan(0);
    expect(buyManager.executeBuy(0, false)).toBe(true);
    const buyActual = buyManager.getLastSettlementDetail()!;
    expect(buyPreview!.finalQi).toBe(buyActual.finalQi);
    expect(buyPreview!.finalScore).toBe(buyActual.finalScore);

    const sellPreview = buyManager.previewSettlement({ type: 'sell', slotIndex: 0 });
    expect(sellPreview).not.toBeNull();
    expect(sellPreview!.actionScoreChange).toBe(buyManager.previewSellScore(buyManager.getHand()[0]!));
    expect(buyManager.executeSell(0)).toBe(true);
    const sellActual = buyManager.getLastSettlementDetail()!;
    expect(sellPreview!.finalQi).toBe(sellActual.finalQi);
    expect(sellPreview!.finalScore).toBe(sellActual.finalScore);
  });

  it('高气量卖出返还先封顶再扣费，且仍有持仓时预览与实际一致', async () => {
    const manager = await startedGame(105);
    expect(manager.executeBuy(0, false)).toBe(true);
    (manager as any).qiManager.setQi(80);
    expect(manager.executeBuy(0, true)).toBe(true);

    const hand = manager.getHand();
    const soldSlot = hand[0]!;
    const remainingSlot = hand[1]!;
    (manager as any).qiManager.setQi(75);

    const preview = manager.previewSettlement({ type: 'sell', slotIndex: 0 });
    expect(preview).not.toBeNull();
    expect(preview!.actionCardName).toBe(soldSlot.card.name);
    expect(preview!.actionUsesLeverage).toBe(false);
    expect(preview!.actionQiChange).toBe(
      Math.min(80, 75 + soldSlot.lockedQi) - 4 - 75,
    );
    expect(preview!.saleBreakdown).toEqual({
      buyScore: soldSlot.buyScore,
      currentScore: soldSlot.card.getSeasonScore(manager.getCurrentSeason()),
      leverage: 1,
      scoreChange: manager.previewSellScore(soldSlot),
      lockedQiReturn: Math.min(80, 75 + soldSlot.lockedQi) - 75,
      exitCost: 4,
      qiChange: Math.min(80, 75 + soldSlot.lockedQi) - 4 - 75,
    });
    expect(preview!.holdItems.map((item) => item.cardName)).toContain(remainingSlot.card.name);

    expect(manager.executeSell(0)).toBe(true);
    const actual = manager.getLastSettlementDetail()!;
    expect(preview!.holdItems).toEqual(actual.holdItems);
    expect(preview!.finalQi).toBe(actual.finalQi);
    expect(preview!.finalScore).toBe(actual.finalScore);
  });

  it('买入预览明确显示目标卡牌和杠杆属性', async () => {
    const manager = await startedGame(106);
    const card = manager.getPublicCards()[0];
    const preview = manager.previewSettlement({ type: 'buy', cardIndex: 0, leverage: true });
    expect(preview!.actionCardName).toBe(card.name);
    expect(preview!.actionUsesLeverage).toBe(true);
  });

  it('预埋杠杆在季内升档时同时放大收益和气耗，并在换季后重置', async () => {
    const manager = await startedGame(107);
    // 固定为最短季，验证 3 回合季也能在季末升至下一档。
    (manager as any).seasonCycle.loadState(0, 1, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const boughtCard = manager.getPublicCards()[0]!;
    const cardScore = boughtCard.getSeasonScore(manager.getCurrentSeason());
    const baseQiCost = Math.max(0.5, 1.5 + 0.4 * cardScore);
    expect(manager.executeBuy(0, true)).toBe(true);

    // 买入发生在季内第 1 回合；买入推进到下一回合时仍为预埋 1.0x。
    const embedded = manager.getLastSettlementDetail()!.holdItems[0]!;
    expect(embedded.leverage).toBe(1.0);
    expect(embedded.earning).toBeCloseTo(1.2 * cardScore);
    expect(embedded.qiCost).toBeCloseTo(baseQiCost);

    // 第 3 回合升至 2.0x，收益和气耗都随之变化。
    expect(manager.executeWait()).toBe(true); // season round 3
    const upgraded = manager.getLastSettlementDetail()!.holdItems[0]!;
    expect(upgraded.leverage).toBe(2.0);
    expect(upgraded.earning).toBeCloseTo(1.2 * cardScore * 2.0);
    expect(upgraded.qiCost).toBeCloseTo(baseQiCost + 2.0 * 1);

    // 换季后重新从季内第 1 回合开始，杠杆回到 1.0x。
    expect(manager.executeWait()).toBe(true); // next season round 1
    expect(manager.getCurrentRoundInSeason()).toBe(1);
    expect(manager.getLastSettlementDetail()!.holdItems[0]!.leverage).toBe(1.0);
  });

  it('真实买入链路保留杠杆开关，并在升档结算时产生额外气耗', async () => {
    const normal = await startedGame(112);
    const leveraged = await startedGame(112);
    const seasonLengths = [12, 12, 12, 12];
    (normal as any).seasonCycle.loadState(0, 1, seasonLengths);
    (leveraged as any).seasonCycle.loadState(0, 1, seasonLengths);
    const card = normal.getPublicCards()[0]!;
    expect(leveraged.getPublicCards()[0]!.name).toBe(card.name);

    expect(normal.executeBuy(0, false)).toBe(true);
    expect(leveraged.executeBuy(0, true)).toBe(true);
    expect(normal.getHand()[0]!.useLeverage).toBe(false);
    expect(leveraged.getHand()[0]!.useLeverage).toBe(true);

    // 买入后已结算第 2 回合（倍率 1.0x），再等待到第 3 回合验证升档 2.0x。
    expect(normal.executeWait()).toBe(true);
    expect(leveraged.executeWait()).toBe(true);
    const normalDetail = normal.getLastSettlementDetail()!;
    const leveragedDetail = leveraged.getLastSettlementDetail()!;
    expect(normalDetail.holdItems[0]!.leverage).toBe(1.0);
    expect(leveragedDetail.holdItems[0]!.leverage).toBe(2.0);
    expect(leveragedDetail.holdItems[0]!.earning).toBeCloseTo(normalDetail.holdItems[0]!.earning * 2);
    expect(leveragedDetail.holdItems[0]!.qiCost).toBeGreaterThan(normalDetail.holdItems[0]!.qiCost);
    expect(leveraged.getQi()).toBeLessThan(normal.getQi());
  });

  it('未激活杠杆的持仓在季内升档和换季后始终保持 1.0x', async () => {
    const manager = await startedGame(108);
    (manager as any).seasonCycle.loadState(0, 1, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(manager.executeBuy(0, false)).toBe(true);
    expect(manager.getLastSettlementDetail()!.holdItems[0]!.leverage).toBe(1.0);
    expect(manager.executeWait()).toBe(true); // season round 3
    expect(manager.getLastSettlementDetail()!.holdItems[0]!.leverage).toBe(1.0);
    expect(manager.executeWait()).toBe(true); // next season round 1
    expect(manager.getCurrentRoundInSeason()).toBe(1);
    expect(manager.getLastSettlementDetail()!.holdItems[0]!.leverage).toBe(1.0);
  });

  it('跨季行动前预览按下一季第 1 回合的 1.0x 计算', async () => {
    const manager = await startedGame(109);
    (manager as any).seasonCycle.loadState(1, 3, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(manager.executeBuy(0, true)).toBe(true);

    // 买入后把当前季推进到季末，下一回合预览应明确显示新季第 1 回合。
    (manager as any).seasonCycle.loadState(1, 3, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const preview = manager.previewSettlement({ type: 'wait' });
    expect(preview).not.toBeNull();
    expect(preview!.nextRoundInSeason).toBe(1);
    expect(preview!.settlementLeverage).toBe(1.0);
  });

  it('季内升档时卖出预览与实际卖出收益使用同一杠杆倍率', async () => {
    const manager = await startedGame(110);
    expect(manager.executeBuy(0, true)).toBe(true);
    // 切到另一季的季末，既能验证 1.5x，也能产生真实差价。
    (manager as any).seasonCycle.loadState(1, 3, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    const slot = manager.getHand()[0]!;
    const beforeScore = manager.getScore();
    const previewScore = manager.previewSellScore(slot);

    expect(manager.executeSell(0)).toBe(true);
    expect(manager.getScore() - beforeScore).toBeCloseTo(previewScore, 8);
  });

  it('强平与第 60 回合不伪造确定的结算结果', async () => {
    const manager = await startedGame(103);
    expect(manager.executeBuy(0, true)).toBe(true);
    (manager as any).qiManager.setQi(0.1);

    const riskyPreview = manager.previewSettlement({ type: 'wait' });
    expect(riskyPreview!.willMarginCall).toBe(true);
    expect(riskyPreview!.marginCallCandidateNames.length).toBeGreaterThan(0);
    expect(riskyPreview!.finalQi).toBeNull();
    expect(riskyPreview!.finalScore).toBeNull();

    expect(manager.executeWait()).toBe(true);
    expect(manager.getLastSettlementDetail()!.marginCallTriggered).toBe(true);

    const finalRound = await startedGame(104);
    (finalRound as any).currentRound = 60;
    const finalPreview = finalRound.previewSettlement({ type: 'wait' });
    expect(finalPreview!.endsGame).toBe(true);
    expect(finalPreview!.nextRound).toBeNull();
    expect(finalPreview!.finalQi).toBeNull();
    expect(finalPreview!.finalScore).toBeNull();
  });
});
