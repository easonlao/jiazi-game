/**
 * 存档序列化与 LocalStorage 边界。
 *
 * TurnManager 只暴露 exportSnapshot / importSnapshot 两个原子方法负责状态还原，
 * 不关心序列化格式与存储介质；GameSaveService 负责可序列化快照的读写、格式校验
 * 与坏档清理，使存档协议与游戏状态机解耦。
 */

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
  totalBuys: number;
  totalSells: number;
  totalWaits: number;
  totalLeverageBuys: number;
  season: SeasonSnapshot;
  hand: (HandSlotSnapshot | null)[];
  pool: CardPoolSnapshot;
}

const SAVE_KEY = 'jiazi_game_save';

/**
 * 存档服务：负责 LocalStorage 读写、格式校验与坏档清理。
 * 实际的状态还原委托给 TurnManager.importSnapshot。
 */
export class GameSaveService {
  /**
   * 一键保存游戏状态至 LocalStorage。
   * @returns 是否保存成功
   */
  save(exporter: () => GameSnapshot): boolean {
    try {
      const snapshot = exporter();
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
      console.log('[GameSaveService] 存档成功');
      return true;
    } catch (e) {
      console.error('[GameSaveService] 存档失败:', e);
      return false;
    }
  }

  /**
   * 从 LocalStorage 读取并还原存档。
   * @returns 是否读档成功
   */
  load(
    importer: (data: GameSnapshot) => void,
    onStateRestore?: () => void,
  ): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
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

      // 2. 校验无效存档（Round 1 且无手牌且气 <= 0 视为无效坏档）
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
   * 检查 LocalStorage 中是否已存在有游戏存档。
   * @returns 是否有存档
   */
  hasSave(): boolean {
    return localStorage.getItem(SAVE_KEY) !== null;
  }

  /**
   * 清除已有的存档。
   */
  clear(): void {
    localStorage.removeItem(SAVE_KEY);
  }
}
