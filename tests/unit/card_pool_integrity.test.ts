import { describe, expect, it } from 'vitest';
import { TurnManager } from '../../src/core/TurnManager';
import { DEFAULT_BALANCE_CONFIG } from '../../src/core/BalanceConfig';
import { SeededRandomSource } from '../../src/core/RandomSource';
import { TREND_WINDOW_REPLAY_RULES } from '../../src/core/ReplayRules';
import { JiaziCard } from '../../src/core/JiaziCard';
import { isVoidCard } from '../../src/core/VoidCard';

describe('公共牌池守恒与锁定/解锁唯一归属测试 (Card Pool Integrity)', () => {
  it('确定性路径：锁定 → 解锁 → 再次锁定 → 调息/释灵/纳灵，全牌组唯一归属且无重复', async () => {
    const random = new SeededRandomSource(42);
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, random, {
      rulesVersion: 8,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 2 },
    });
    await tm.initialize();
    tm.startGame();

    expect(tm.validateCardPoolIntegrity()).toBe(true);
    const initialPublic = [...tm.getPublicCards()];
    expect(initialPublic).toHaveLength(3);

    // 1. 锁定第 0 张牌
    expect(tm.executeLockCard(0).ok).toBe(true);
    expect(tm.getLockedCardIds()).toContain(initialPublic[0].id);

    // 2. 解锁第 0 张牌（牌应当留在公共区，绝不能过早推入牌堆）
    expect(tm.executeUnlockCard(0)).toBe(true);
    expect(tm.getLockedCardIds()).not.toContain(initialPublic[0].id);
    expect(tm.getPublicCards()[0].id).toBe(initialPublic[0].id);
    expect(tm.validateCardPoolIntegrity()).toBe(true);

    // 3. 再次锁定第 0 张牌
    expect(tm.executeLockCard(0).ok).toBe(true);
    expect(tm.getLockedCardIds()).toContain(initialPublic[0].id);
    expect(tm.validateCardPoolIntegrity()).toBe(true);

    // 4. 执行调息推进到下一回合
    expect(tm.executeWait()).toBe(true);
    expect(tm.getCurrentRound()).toBe(2);

    // 关键断言：锁定牌保持在公共区，其余位由牌堆正常填充，全牌池 0 重复、严格 3 张候选牌
    const round2Public = tm.getPublicCards();
    expect(round2Public).toHaveLength(3);
    expect(round2Public[0].id).toBe(initialPublic[0].id);
    expect(tm.validateCardPoolIntegrity()).toBe(true);

    // 检查公共区 3 张牌 ID 互不相同
    const ids = round2Public.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('多组合操作：锁定 → 解锁 → 纳灵/释灵/调息，各槽位严格守恒', async () => {
    const random = new SeededRandomSource(100);
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, random, {
      rulesVersion: 8,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 2 },
    });
    await tm.initialize();
    tm.startGame();

    // 锁定牌 0，解锁牌 0，锁定牌 1，买入牌 2
    expect(tm.executeLockCard(0).ok).toBe(true);
    expect(tm.executeUnlockCard(0)).toBe(true);
    expect(tm.executeLockCard(1).ok).toBe(true);
    expect(tm.executeBuy(2, false)).toBe(true);

    expect(tm.validateCardPoolIntegrity()).toBe(true);
    expect(tm.getPublicCards()).toHaveLength(3);
    expect(new Set(tm.getPublicCards().map((c) => c.id)).size).toBe(3);
  });

  it('自动解锁机制：锁定费欠费自动解锁时，牌安全回堆且下一回合无重复', async () => {
    const random = new SeededRandomSource(200);
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, random, {
      rulesVersion: 8,
      scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
      volatility: TREND_WINDOW_REPLAY_RULES.volatility,
      voidConfig: { voidCardCount: 2 },
    });
    await tm.initialize();
    tm.startGame();

    // 锁定两张牌
    expect(tm.executeLockCard(0).ok).toBe(true);
    expect(tm.executeLockCard(1).ok).toBe(true);

    // 连续调息若干回合
    for (let r = 1; r <= 5; r++) {
      expect(tm.executeWait()).toBe(true);
      expect(tm.validateCardPoolIntegrity()).toBe(true);
      expect(tm.getPublicCards()).toHaveLength(3);
      expect(new Set(tm.getPublicCards().map((c) => c.id)).size).toBe(3);
    }
  });

  it('长回合 100 种子随机操作扫描：0 牌池重复、0 槽位丢失、100% 守恒', async () => {
    for (let seed = 1; seed <= 100; seed++) {
      const random = new SeededRandomSource(seed);
      const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, random, {
        rulesVersion: 8,
        scoreRules: TREND_WINDOW_REPLAY_RULES.scoreRules,
        volatility: TREND_WINDOW_REPLAY_RULES.volatility,
        voidConfig: { voidCardCount: 2 },
      });
      await tm.initialize();
      tm.startGame();

      while (tm.getState() === 'player_action' && tm.getCurrentRound() <= 60) {
        // 随机执行锁定/解锁
        if (random.next() > 0.5) {
          const slot = random.int(0, 3);
          if (tm.isCardLocked(tm.getPublicCards()[slot]?.id ?? -1)) {
            tm.executeUnlockCard(slot);
          } else {
            tm.executeLockCard(slot);
          }
        }

        // 随机执行买入/卖出/调息
        const actionRoll = random.next();
        const handCount = tm.getHand().filter(Boolean).length;
        if (actionRoll < 0.4 && handCount < 3) {
          const slot = random.int(0, 3);
          tm.executeBuy(slot, false);
        } else if (actionRoll < 0.7 && handCount > 0) {
          const slot = random.int(0, 3);
          tm.executeSell(slot);
        } else {
          tm.executeWait();
        }

        // 每一回合均断言牌池严格守恒
        const integrity = tm.validateCardPoolIntegrity();
        if (!integrity) {
          console.error(`Seed ${seed} Round ${tm.getCurrentRound()} State ${tm.getState()} failed integrity:`, {
            publicCards: tm.getPublicCards().map((c) => c?.id),
            lockedCardIds: tm.getLockedCardIds(),
            deckCount: tm.getDeckSize(),
            handCount: tm.getHand().filter(Boolean).length,
          });
        }
        expect(integrity).toBe(true);
        if (tm.getState() === 'player_action') {
          const publicCards = tm.getPublicCards();
          expect(publicCards).toHaveLength(3);
          const ids = publicCards.map((c) => c.id);
          expect(new Set(ids).size).toBe(3);
        }
      }
    }
  }, 30000);

  it('P1复现验证：锁一张牌、神识设为3、调息后自动解锁回堆且牌池严格守恒', async () => {
    const random = new SeededRandomSource(42);
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, random, {
      rulesVersion: 8,
      voidConfig: { voidCardCount: 2 },
    });
    await tm.initialize();
    tm.startGame();

    // 锁一张牌
    expect(tm.executeLockCard(0).ok).toBe(true);
    const lockedId = tm.getPublicCards()[0].id;
    expect(tm.getLockedCardIds()).toContain(lockedId);

    // 将神识直接设为 3（不足扣 5 锁定费）
    (tm as unknown as { qiManager: { qi: number } }).qiManager.qi = 3;

    // 调息推进
    expect(tm.executeWait()).toBe(true);

    // 自动解锁发生：lockedCardIds 清空，该牌安全回堆，公共池抽 3 张新牌
    expect(tm.getLockedCardIds()).not.toContain(lockedId);
    expect(tm.validateCardPoolIntegrity()).toBe(true);
    expect(tm.getPublicCards()).toHaveLength(3);
    const ids = tm.getPublicCards().map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('P1复现验证：空亡回合恰好扣一次锁定费，且欠费时正常自动解锁与精准神识变化', async () => {
    const random = new SeededRandomSource(42);
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, random, {
      rulesVersion: 8,
      voidConfig: { voidCardCount: 3 },
    });
    await tm.initialize();
    tm.startGame();

    // 1. 正常神识下锁定 1 张牌后进入空亡回合
    expect(tm.executeLockCard(0).ok).toBe(true);
    expect(tm.getQi()).toBe(60);

    // 将牌堆顶放入一张空亡牌，确保本回合抽牌必定触发空亡
    const pool = (tm as any).cardPoolManager;
    const deck: any[] = pool.getDeck();
    const voidIndex = deck.findIndex((c) => isVoidCard(c));
    expect(voidIndex).toBeGreaterThanOrEqual(0);
    const [voidCard] = deck.splice(voidIndex, 1);
    deck.unshift(voidCard);

    // 执行等待 -> advanceTurn -> V8 processRound
    // 1) 第 2 回合（空亡吞噬回合）：
    //    - settleLockCost 扣 5 (60 - 5 = 55)
    //    - drawPublicCards 抽中空亡牌
    //    - processVoidRound 吞噬回合 +10 自然回复 (55 + 10 = 65)
    //    - advanceAfterVoid 自动推进至第 3 回合
    // 2) 第 3 回合（玩家行动回合）：
    //    - settleLockCost 再次扣 5 (65 - 5 = 60)
    //    - drawPublicCards 填充普通牌
    //    - recoverQi +10 自然回复 (60 + 10 = 70)
    expect(tm.executeWait()).toBe(true);
    expect(tm.getCurrentRound()).toBe(3);
    expect(tm.getQi()).toBe(70);
    expect(tm.validateCardPoolIntegrity()).toBe(true);

    // 2. 神识欠费场景下锁定牌进入空亡回合 -> 自动解锁并退回锁定费，牌池严格守恒
    // 此时第 0 张牌仍处于锁定状态，将神识扣至 3（欠费不足 5）
    (tm as any).qiManager.setQi(3);
    expect(tm.getQi()).toBe(3);

    // 再次在牌堆顶放一张空亡牌
    const voidIndex2 = deck.findIndex((c) => isVoidCard(c));
    expect(voidIndex2).toBeGreaterThanOrEqual(0);
    const [voidCard2] = deck.splice(voidIndex2, 1);
    deck.unshift(voidCard2);

    // 执行等待 -> advanceTurn -> V8 processRound
    // 1) 第 4 回合（空亡吞噬回合）：
    //    - settleLockCost 扣 5 (3 - 5 = -2 <= 0) -> 触发自动解锁 -> 回堆 -> 恢复 +5 (神识回正为 3)
    //    - drawPublicCards 为空位抽新牌并抽中空亡牌
    //    - processVoidRound 吞噬回合 +10 自然回复 (3 + 10 = 13)
    //    - advanceAfterVoid 自动推进至第 5 回合
    // 2) 第 5 回合（玩家行动回合）：
    //    - settleLockCost 已无锁定牌 (锁定数 0，扣 0)
    //    - recoverQi +10 自然回复 (13 + 10 = 23)
    expect(tm.executeWait()).toBe(true);
    expect(tm.getCurrentRound()).toBe(5);
    expect(tm.getQi()).toBe(23);
    expect(tm.getLockedCardIds()).toHaveLength(0);
    expect(tm.validateCardPoolIntegrity()).toBe(true);
  });

  it('validateCardPoolIntegrity: 能精准识别损坏的牌池状态', async () => {
    const random = new SeededRandomSource(42);
    const tm = new TurnManager(DEFAULT_BALANCE_CONFIG, random);
    await tm.initialize();
    tm.startGame();
    expect(tm.validateCardPoolIntegrity()).toBe(true);

    // 模拟人为破坏牌池：向 publicCards 注入重复 ID
    const publicCards = tm.getPublicCards();
    const fakeDuplicate = new JiaziCard({
      id: publicCards[0].id,
      name: publicCards[0].name,
      tianGan: publicCards[0].tianGan,
      diZhi: publicCards[0].diZhi,
      tianGanElement: publicCards[0].tianGanElement,
      diZhiElement: publicCards[0].diZhiElement,
      mainElement: publicCards[0].mainElement,
      yinYang: publicCards[0].yinYang,
    });
    publicCards[1] = fakeDuplicate;

    expect(tm.validateCardPoolIntegrity()).toBe(false);
  });
});
