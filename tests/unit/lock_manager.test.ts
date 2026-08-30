/**
 * LockManager 直接单测（Phase 3 抽取后，此前仅经 TurnManager 间接覆盖）。
 *
 * LockManager 依赖 QiManager / CardPoolManager / getCardScore 回调——
 * 这里用轻量 mock 隔离，聚焦锁定/解锁/锁定费结算的领域逻辑。
 */
import { describe, it, expect, vi } from 'vitest';
import { LockManager } from '../../src/core/LockManager';
import { JiaziCard, Element, YinYang } from '../../src/core/JiaziCard';

function makeCard(id: number, name: string, scoreInSeason: number): JiaziCard {
  const card = new JiaziCard({
    id, name,
    tianGan: '甲', diZhi: '子',
    tianGanElement: Element.WOOD, diZhiElement: Element.WATER,
    mainElement: Element.WOOD, yinYang: YinYang.YANG,
  });
  // 用 getCardScore 回调模拟季节评分，不依赖真实评分表
  (card as any)._testScore = scoreInSeason;
  return card;
}

interface MockQi {
  getQi: () => number;
  deductQi: (n: number) => void;
  recover: (n: number) => void;
}

interface MockPool {
  getPublicCards: () => JiaziCard[];
  returnCards: (cards: JiaziCard[]) => void;
}

function makeDeps(initialQi: number) {
  let qi = initialQi;
  const returned: JiaziCard[] = [];
  let publicCards: JiaziCard[] = [];

  const qiManager: MockQi = {
    getQi: () => qi,
    deductQi: (n: number) => { qi -= n; },
    recover: (n: number) => { qi += n; },
  };
  const cardPoolManager: MockPool = {
    getPublicCards: () => publicCards,
    returnCards: (cards: JiaziCard[]) => { returned.push(...cards); },
  };
  const getCardScore = vi.fn((card: JiaziCard) => (card as any)._testScore ?? 0);

  const lockManager = new LockManager({
    qiManager: qiManager as any,
    cardPoolManager: cardPoolManager as any,
    getCardScore: getCardScore as any,
  });

  return {
    lockManager, qiManager, cardPoolManager, getCardScore,
    getReturned: () => returned,
    setPublicCards: (cards: JiaziCard[]) => { publicCards = cards; },
  };
}

/** 公共牌：一张高评分、一张低评分、一张中等评分 */
function makePublicCards(): JiaziCard[] {
  return [makeCard(1, '甲子', 10), makeCard(2, '乙丑', 1), makeCard(3, '丙寅', 5)];
}

describe('LockManager 直接单测', () => {
  describe('tryLock / tryUnlock 领域逻辑', () => {
    it('锁定成功：加入锁定列表', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      expect(lockManager.tryLock(cards, 0, 80)).toEqual({ ok: true });
      expect(lockManager.getLockedCardIds()).toEqual([1]);
      expect(lockManager.lockedCount).toBe(1);
    });

    it('重复锁定同一张：拒绝', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      lockManager.tryLock(cards, 0, 80);
      expect(lockManager.tryLock(cards, 0, 80)).toEqual({ ok: false, reason: 'already_locked' });
    });

    it('超过上限（MAX_LOCKED_CARDS=2）：第 3 张拒绝', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      expect(lockManager.tryLock(cards, 0, 80)).toEqual({ ok: true });
      expect(lockManager.tryLock(cards, 1, 80)).toEqual({ ok: true });
      expect(lockManager.tryLock(cards, 2, 80)).toEqual({ ok: false, reason: 'max_reached' });
      expect(lockManager.lockedCount).toBe(2);
    });

    it('气不足锁定费：拒绝（防止锁定后必然自动解锁的无效操作）', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      expect(lockManager.tryLock(cards, 0, 4)).toEqual({ ok: false, reason: 'qi_insufficient' }); // 锁定费 5
      expect(lockManager.lockedCount).toBe(0);
    });

    it('非法索引 / 空牌：拒绝且不崩溃', () => {
      const { lockManager } = makeDeps(80);
      expect(lockManager.tryLock([], 0, 80)).toEqual({ ok: false, reason: 'no_card' });
      expect(lockManager.tryLock(makePublicCards(), 99, 80)).toEqual({ ok: false, reason: 'no_card' });
    });

    it('解锁：移除锁定并在回合内保留在公共区（不提前回牌堆，避免牌堆污染）', () => {
      const { lockManager, getReturned } = makeDeps(80);
      const cards = makePublicCards();
      lockManager.tryLock(cards, 0, 80);
      expect(lockManager.tryUnlock(cards, 0)).toBe(true);
      expect(lockManager.getLockedCardIds()).toEqual([]);
      expect(getReturned()).toEqual([]); // 牌留在公共区，回合结束才随其余未选牌统一回牌堆
    });

    it('解锁未锁定的牌：拒绝', () => {
      const { lockManager } = makeDeps(80);
      expect(lockManager.tryUnlock(makePublicCards(), 0)).toBe(false);
    });
  });

  describe('onCardBought / partitionLocked / restore / reset', () => {
    it('买走锁定牌：从锁定列表移除', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      lockManager.tryLock(cards, 0, 80);
      lockManager.onCardBought(1);
      expect(lockManager.getLockedCardIds()).toEqual([]);
    });

    it('partitionLocked：正确分锁定/未锁定两组', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      lockManager.tryLock(cards, 1, 80); // 锁定 2 号
      const { locked, unlocked } = lockManager.partitionLocked(cards);
      expect(locked.map(c => c.id)).toEqual([2]);
      expect(unlocked.map(c => c.id)).toEqual([1, 3]);
    });

    it('restoreLockedCardIds：读档还原锁定列表', () => {
      const { lockManager } = makeDeps(80);
      lockManager.restoreLockedCardIds([5, 9]);
      expect(lockManager.getLockedCardIds()).toEqual([5, 9]);
    });

    it('reset：清空锁定列表（新一局）', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      lockManager.tryLock(cards, 0, 80);
      lockManager.reset();
      expect(lockManager.getLockedCardIds()).toEqual([]);
    });

    it('getLockedCardIds 返回副本，外部修改不影响内部', () => {
      const { lockManager } = makeDeps(80);
      const cards = makePublicCards();
      lockManager.tryLock(cards, 0, 80);
      const got = lockManager.getLockedCardIds();
      got.push(999);
      expect(lockManager.getLockedCardIds()).toEqual([1]);
    });
  });

  describe('settleLockCost 锁定费结算', () => {
    it('气充足：扣锁定费并保留锁定', () => {
      const { lockManager, qiManager, setPublicCards } = makeDeps(80);
      const cards = makePublicCards();
      setPublicCards(cards);
      lockManager.tryLock(cards, 0, 80);
      lockManager.tryLock(cards, 1, 80);
      lockManager.settleLockCost('spring');
      expect(qiManager.getQi()).toBe(80 - 2 * LockManager.LOCK_COST_PER_CARD); // 80 - 10 = 70
      expect(lockManager.getLockedCardIds()).toHaveLength(2);
    });

    it('气不足：自动解锁评分最低的锁定牌，直到气回正', () => {
      const { lockManager, qiManager, getReturned, getCardScore, setPublicCards } = makeDeps(8);
      const cards = makePublicCards();
      setPublicCards(cards);
      // 锁定两张：高分(10) + 低分(1)，气 8 不够付两张锁定费（2×5=10）
      lockManager.tryLock(cards, 0, 8);
      lockManager.tryLock(cards, 1, 8);
      lockManager.settleLockCost('spring');
      // 扣 10 → 气 -2 → 未回正，解锁最低分牌(1 号)并返 5 气 → 气 3
      expect(getCardScore).toHaveBeenCalled();
      expect(lockManager.getLockedCardIds()).toEqual([1]); // 保留高分牌
      expect(getReturned().map((c) => c.id)).toEqual([2]); // 欠费自动解锁后从公共区移出并归还牌堆，确保抽牌不丢牌
      expect(qiManager.getQi()).toBe(3);
    });

    it('无锁定：不扣气不崩溃', () => {
      const { lockManager, qiManager } = makeDeps(80);
      lockManager.settleLockCost('spring');
      expect(qiManager.getQi()).toBe(80);
    });

    it('气极度不足且多张锁定：循环解锁直到无牌可解或气回正', () => {
      const { lockManager, qiManager, setPublicCards } = makeDeps(3);
      const cards = makePublicCards();
      setPublicCards(cards);
      lockManager.tryLock(cards, 0, 3);
      lockManager.tryLock(cards, 1, 3);
      lockManager.settleLockCost('spring');
      // 扣 10 → 气 -7 → 解锁一张 +5 → 气 -2 → 再解锁一张 +5 → 气 3，全部解锁
      expect(lockManager.getLockedCardIds()).toEqual([]);
      expect(qiManager.getQi()).toBe(3);
    });

    it('公共牌含 undefined 占位（executeBuy 影子牌修复副作用）：自动解锁不崩溃', () => {
      // 回归：113f731 给三处遍历加了 undefined 守卫，但 settleLockCost 漏了——
      // executeBuy 买入后公共牌数组存在占位空位，锁定牌 + 气不足触发自动解锁时
      // find(c => c.id === id) 遇 undefined 抛错（expert-lock 蒙特卡罗撞出）
      const { lockManager, qiManager, setPublicCards } = makeDeps(3);
      const cards = makePublicCards();
      const withHoles = [undefined, cards[1], undefined];
      setPublicCards(withHoles as any);
      lockManager.tryLock(cards, 1, 3); // 锁定乙丑（公共池位置 1，保留）
      expect(() => lockManager.settleLockCost('spring')).not.toThrow();
      // 扣 5 → 气 -2 → 自动解锁乙丑并返 5 气 → 气 3
      expect(lockManager.getLockedCardIds()).toEqual([]);
      expect(qiManager.getQi()).toBe(3);
    });
  });
});
