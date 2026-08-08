/**
 * 存档序列化与持久化边界。
 *
 * TurnManager 只暴露 exportSnapshot / importSnapshot 两个原子方法负责状态还原，
 * 不关心序列化格式与存储介质；GameSaveService 负责可序列化快照的读写、格式校验
 * 与坏档清理，使存档协议与游戏状态机解耦。
 *
 * 存储介质通过构造注入 StorageProvider（平台无关）；未注入时回退到浏览器
 * globalThis.localStorage（web 平台默认）。微信小游戏等无 localStorage 的平台
 * 需显式传入对应实现。
 */

import type { StorageProvider } from './StorageProvider';
import type { RoundLogEntry } from './TurnManager';

/** 可序列化的手牌槽位快照。 */
export interface HandSlotSnapshot {
  cardId: number;
  buyScore: number;
  useLeverage: boolean;
  leverage: number;
  buyRound: number;
  lockedQi: number;
  holdEarnings: number;
}

/** 可序列化的季节周期快照。 */
export interface SeasonSnapshot {
  index: number;
  roundInSeason: number;
  lengths: number[];
}

/** 可序列化的牌池快照。 */
export interface CardPoolSnapshot {
  deckIds: number[];
  publicIds: number[];
}

/** 完整的存档快照。 */
export interface GameSnapshot {
  currentRound: number;
  state: string;
  lastAction: string | null;
  qi: number;
  score: number;
  totalHoldEarnings: number;
  totalSellEarnings: number;
  /** 反噬罚分累计。可选：老存档无此字段，读档时按 0 处理（历史数据不完整）。 */
  totalMarginCallPenalty?: number;
  /** 终局出清收益累计。可选：老存档无此字段，读档时按 0 处理。 */
  totalSettleEarnings?: number;
  totalBuys: number;
  totalSells: number;
  totalWaits: number;
  totalLeverageBuys: number;
  season: SeasonSnapshot;
  hand: (HandSlotSnapshot | null)[];
  pool: CardPoolSnapshot;
  /** 锁定中的公共牌 ID 列表（锁定机制） */
  lockedCardIds?: number[];
  /** 回合数据留存（交易看板数据源）。可选：老存档无此字段，读档时空数组。 */
  roundLog?: RoundLogEntry[];
}

const SAVE_KEY = 'jiazi_game_save';

/**
 * 存档服务：负责持久化读写、格式校验与坏档清理。
 * 实际的状态还原委托给 TurnManager.importSnapshot。
 */
export class GameSaveService {
  private readonly storage: StorageProvider;

  /**
   * @param provider 存储实现；省略时回退浏览器 localStorage（web 平台）
   */
  constructor(provider?: StorageProvider) {
    // globalThis 引用而非裸标识符：测试环境通过 mock globalThis.localStorage 提供实现
    this.storage = provider ?? (globalThis as { localStorage?: StorageProvider }).localStorage!;
  }

  /**
   * 一键保存游戏状态。
   * @returns 是否保存成功
   */
  save(exporter: () => GameSnapshot): boolean {
    try {
      const snapshot = exporter();
      this.storage.setItem(SAVE_KEY, JSON.stringify(snapshot));
      console.log('[GameSaveService] 存档成功');
      return true;
    } catch (e) {
      console.error('[GameSaveService] 存档失败:', e);
      return false;
    }
  }

  /**
   * 读取并还原存档。
   * @returns 是否读档成功
   */
  load(
    importer: (data: GameSnapshot) => void,
    onStateRestore?: () => void,
  ): boolean {
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) {
        console.log('[GameSaveService] 找不到存档');
        return false;
      }
      const data = JSON.parse(raw) as GameSnapshot;

      // 1. 基础字段验证，确保 qi 是有效数值
      if (
        data.currentRound === undefined ||
        data.qi === undefined ||
        typeof data.qi !== 'number' ||
        isNaN(data.qi)
      ) {
        console.warn('[GameSaveService] 存档数据格式不正确，qi 为无效数值');
        this.clear();
        return false;
      }

      // 2. 校验无效存档（Round 1 且无手牌且神识 <= 0 视为无效坏档）
      const isHandEmpty = !data.hand || data.hand.every((slot) => slot === null);
      if (data.currentRound <= 1 && isHandEmpty && data.qi <= 0) {
        console.warn('[GameSaveService] 检测到 Round 1 的无效坏档');
        this.clear();
        return false;
      }

      importer(data);

      console.log('[GameSaveService] 读档还原成功');
      onStateRestore?.();
      return true;
    } catch (e) {
      console.error('[GameSaveService] 读档失败:', e);
      return false;
    }
  }

  /**
   * 检查是否已存在有游戏存档。
   * @returns 是否有存档
   */
  hasSave(): boolean {
    return this.storage.getItem(SAVE_KEY) !== null;
  }

  /**
   * 清除已有的存档。
   */
  clear(): void {
    this.storage.removeItem(SAVE_KEY);
  }
}
