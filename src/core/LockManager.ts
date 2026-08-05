/**
 * 卡牌锁定管理器。
 *
 * 负责公共牌的锁定/解锁动作与锁定费结算。领域术语「卡牌锁定」指公共牌的保留动作，
 * 与「锁定气」（仓位上的气量，见 CONTEXT.md）是两个不同概念，勿混用。
 *
 * 锁定费不在锁定动作时扣——在回合结束统一结算（settleLockCost，按当回合锁定张数 × LOCK_COST），
 * 因此同一回合内锁定再解锁不产生任何费用。
 */

import type { JiaziCard } from './JiaziCard';
import type { CardPoolManager } from './CardPoolManager';
import type { QiManager } from './QiManager';

/** 锁定失败原因（供 UI 按具体状态提示，避免"多种可能混合展示"） */
export type LockFailure =
  | 'no_card'          // 公共牌不存在
  | 'already_locked'   // 该牌已在锁定列表
  | 'max_reached'      // 已达锁定张数上限
  | 'qi_insufficient'; // 心神不足（付不起至少 1 回合锁定费）

/** tryLock 的结果：成功无额外信息；失败携带具体原因 */
export type LockResult = { ok: true } | { ok: false; reason: LockFailure };

export interface LockManagerDeps {
  qiManager: QiManager;
  cardPoolManager: CardPoolManager;
  /** 外部注入的季节评分入口（TurnManager.getCardScore），避免重复实现评分逻辑 */
  getCardScore: (card: JiaziCard, season: string) => number;
}

export class LockManager {
  /** 锁定费常量：每张锁定牌每回合消耗气 */
  static readonly LOCK_COST_PER_CARD = 5;
  /** 锁定张数上限：展示牌数 - 1（锁满则公共位全占，每回合 0 张新牌，游戏僵死） */
  static readonly MAX_LOCKED_CARDS = 2;

  /** 锁定中的公共牌 ID 列表（锁定机制：占公共位，每张每回合扣 5 气） */
  private lockedCardIds: number[] = [];
  private readonly deps: LockManagerDeps;

  constructor(deps: LockManagerDeps) {
    this.deps = deps;
  }

  /** 获取当前锁定的公共牌 ID 列表（副本，防止外部篡改） */
  getLockedCardIds(): number[] {
    return [...this.lockedCardIds];
  }

  /** 判断一张公共牌是否处于锁定状态 */
  isCardLocked(cardId: number): boolean {
    return this.lockedCardIds.includes(cardId);
  }

  /** 当前锁定张数 */
  get lockedCount(): number {
    return this.lockedCardIds.length;
  }

  /** 读档还原时覆盖锁定列表（仅由 TurnManager.importSnapshot 调用） */
  restoreLockedCardIds(ids: number[]): void {
    this.lockedCardIds = [...ids];
  }

  /** 重置锁定状态（新一局开始时调用） */
  reset(): void {
    this.lockedCardIds = [];
  }

  /**
   * 尝试锁定一张公共牌（占公共位）。
   * 本方法只做领域动作：检查上限、锁定、记录；state 检查由调用方（TurnManager）负责。
   * @returns 锁定结果：成功或携带具体失败原因（供 UI 区分提示，如"心神不足"vs"最多锁定 2 张"）
   */
  tryLock(publicCards: JiaziCard[], cardIndex: number, currentQi: number): LockResult {
    const card = publicCards[cardIndex];
    if (!card) return { ok: false, reason: 'no_card' };
    if (this.lockedCardIds.includes(card.id)) return { ok: false, reason: 'already_locked' };
    if (this.lockedCardIds.length >= LockManager.MAX_LOCKED_CARDS) return { ok: false, reason: 'max_reached' };
    // 心神不足至少 1 回合锁定费时拒绝锁定（防止锁定后结算必然自动解锁的无效操作）
    if (currentQi < LockManager.LOCK_COST_PER_CARD) return { ok: false, reason: 'qi_insufficient' };

    this.lockedCardIds.push(card.id);
    return { ok: true };
  }

  /**
   * 尝试解锁一张公共牌（牌回牌堆）。
   * 本动作不扣气也不退气（锁定费只在回合结束结算，锁→解锁无费用）。
   * @returns 是否解锁成功；解锁时牌回牌堆由本方法处理
   */
  tryUnlock(publicCards: JiaziCard[], cardIndex: number): boolean {
    const card = publicCards[cardIndex];
    if (!card) return false;
    if (!this.lockedCardIds.includes(card.id)) return false;

    this.lockedCardIds = this.lockedCardIds.filter((id) => id !== card.id);
    this.deps.cardPoolManager.returnCards([card]);
    return true;
  }

  /**
   * 买走一张锁定牌时调用：牌已入手，不再占用公共位，从锁定列表移除。
   */
  onCardBought(cardId: number): void {
    this.lockedCardIds = this.lockedCardIds.filter((id) => id !== cardId);
  }

  /**
   * 把公共牌分成「锁定中」与「未锁定」两组（未锁定的回合末回牌堆，锁定的保留在公共区）。
   */
  partitionLocked(publicCards: JiaziCard[]): { locked: JiaziCard[]; unlocked: JiaziCard[] } {
    const locked: JiaziCard[] = [];
    const unlocked: JiaziCard[] = [];
    for (const card of publicCards) {
      (this.lockedCardIds.includes(card.id) ? locked : unlocked).push(card);
    }
    return { locked, unlocked };
  }

  /**
   * 锁定费结算：每张锁定牌每回合扣 LOCK_COST_PER_CARD 气。
   * 气不足时自动解锁（先解评分最低的），锁定牌回牌堆。
   * @returns 被自动解锁的牌 ID 列表（未触发自动解锁时为空数组）。
   *           调用方应据此向玩家给出明确提示，避免"锁定牌无故消失"的体验。
   */
  settleLockCost(currentSeason: string): number[] {
    if (this.lockedCardIds.length === 0) return [];
    const totalCost = this.lockedCardIds.length * LockManager.LOCK_COST_PER_CARD;

    // 扣锁定费（允许扣到负数，随后检查解锁）
    this.deps.qiManager.deductQi(totalCost);

    const autoUnlockedIds: number[] = [];
    // 气不足：从评分最低的锁定牌开始自动解锁，直到气回正
    while (this.lockedCardIds.length > 0 && this.deps.qiManager.getQi() <= 0) {
      const publicCards = this.deps.cardPoolManager.getPublicCards();
      let worstId: number | null = null;
      let worstScore = Number.POSITIVE_INFINITY;
      for (const id of this.lockedCardIds) {
        const card = publicCards.find((c) => c.id === id);
        if (!card) continue;
        const score = this.deps.getCardScore(card, currentSeason);
        if (score < worstScore) {
          worstScore = score;
          worstId = id;
        }
      }
      if (worstId === null) break;
      this.lockedCardIds = this.lockedCardIds.filter((id) => id !== worstId);
      autoUnlockedIds.push(worstId);
      const card = publicCards.find((c) => c.id === worstId);
      if (card) this.deps.cardPoolManager.returnCards([card]);
      this.deps.qiManager.recover(LockManager.LOCK_COST_PER_CARD);
    }
    return autoUnlockedIds;
  }
}
