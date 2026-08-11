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
import type { ScoreVolatilitySnapshot } from './ScoreVolatility';
import type { ScoreRules } from './ScoreManager';

/** 读档失败分类原因：GameSaveService.load 最近一次失败的原因（成功或尚未 load 时为 null）。 */
export type GameSaveLoadError =
  /** 存档 schemaVersion 高于当前支持版本：拒绝读档、保留存档（PRD §5 Q6） */
  | 'schema_too_new'
  /** 存档声明未知 rulesVersion：拒绝读档、保留存档 */
  | 'rules_version_unsupported'
  /** 已完成的终局存档：拒绝继续并清除历史终局快照 */
  | 'game_over'
  /** 格式损坏 / 无效坏档 / importSnapshot 抛错：拒绝读档（qi 无效、Round 1 坏档会清理存档） */
  | 'invalid_or_import_failed';

/**
 * 存档结构版本（schemaVersion）：描述 GameSnapshot 的字段布局 / 类型 / 必填性。
 * 新增字段、字段改名/改类型、必填性变化时递增。阶段 1 初始化 = 1（当前协议结构）。
 * 缺该字段的旧档 → 按字段缺失回退默认值（save_compat 既有模式）。
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * 游戏规则语义版本（rulesVersion）：描述"这一局按哪套结算规则运行"
 * （评分模型 / 机制启用集，如是否启用季内评分波动）。
 * 阶段 1 只有 base 规则（无季内波动），产品默认路径只能产出本版本。
 */
export const RULES_BASE = 1;

/**
 * 预留的波动规则版本：季内评分波动规则集，波动模型冻结后启用。
 * 阶段 1 产品默认路径不产出该版本档（产品默认 base）；
 * 仅测试 / 显式实验模式（构造函数 volatility 开启 + volatilityRandom）
 * 可经 round-trip 验证其读档还原，见 tests/unit/score_volatility_save.test.ts。
 */
export const RULES_VERSION_VOLATILE = 2;

/** 交易主导波动规则：局部冲突波动 + 独立卖出收益倍率。 */
export const RULES_VERSION_TRADE = 3;

/** 平衡版交易规则：降低冲突牌波动与释灵倍率，并与 V3 排行榜隔离。 */
export const RULES_VERSION_BALANCED_TRADE = 4;

/** 新局默认规则版本；旧存档仍按自身 rulesVersion 继续运行。 */
export const CURRENT_RULES_VERSION = RULES_VERSION_BALANCED_TRADE;

/** 当前代码可解释的规则版本集合；存档层与引擎层共用，避免两处规则门控漂移。 */
export type SupportedRulesVersion =
  | typeof RULES_BASE
  | typeof RULES_VERSION_VOLATILE
  | typeof RULES_VERSION_TRADE
  | typeof RULES_VERSION_BALANCED_TRADE;

export function isSupportedRulesVersion(version: unknown): version is SupportedRulesVersion {
  return version === RULES_BASE ||
    version === RULES_VERSION_VOLATILE ||
    version === RULES_VERSION_TRADE ||
    version === RULES_VERSION_BALANCED_TRADE;
}

export function isTradeRulesVersion(version: unknown): version is typeof RULES_VERSION_TRADE | typeof RULES_VERSION_BALANCED_TRADE {
  return version === RULES_VERSION_TRADE || version === RULES_VERSION_BALANCED_TRADE;
}

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
  /** 存档结构版本。新档必写，旧档可缺；缺失按字段级回退解析。 */
  schemaVersion?: number;
  /** 游戏规则语义版本。新档必写，旧档可缺；缺失按 base 规则读档（写时归属）。 */
  rulesVersion?: number;
  /** 回合数据留存（交易看板数据源）。可选：老存档无此字段，读档时空数组。 */
  roundLog?: RoundLogEntry[];
  /** 实验性季内评分波动状态；老存档无此字段时视为未启用。 */
  scoreVolatility?: ScoreVolatilitySnapshot;
  /** 交易规则的计分参数；v1/v2 不写入，保持旧档形状与语义。 */
  scoreRules?: ScoreRules;
}

const SAVE_KEY = 'jiazi_game_save';

/**
 * 存档服务：负责持久化读写、格式校验与坏档清理。
 * 实际的状态还原委托给 TurnManager.importSnapshot。
 */
export class GameSaveService {
  private readonly storage: StorageProvider;
  /** 最近一次 load() 的失败原因（成功 / 尚未调用 load / 无存档时为 null）。 */
  private lastLoadError: GameSaveLoadError | null = null;

  /**
   * @param provider 存储实现；省略时回退浏览器 localStorage（web 平台）
   */
  constructor(provider?: StorageProvider) {
    // globalThis 引用而非裸标识符：测试环境通过 mock globalThis.localStorage 提供实现
    this.storage = provider ?? (globalThis as { localStorage?: StorageProvider }).localStorage!;
  }

  /**
   * 最近一次 load() 的失败原因，供 UI 区分「存档版本过新（提示更新游戏）」
   * 与一般读档失败。成功或尚无失败时为 null。
   */
  getLastLoadError(): GameSaveLoadError | null {
    return this.lastLoadError;
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
      // 每次 load 先清空上次的失败原因：本次成功或失败后再重新写入
      this.lastLoadError = null;
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) {
        console.log('[GameSaveService] 找不到存档');
        return false;
      }
      const data = JSON.parse(raw) as GameSnapshot;

      // 0. 未来 schemaVersion（> 当前支持版本）：拒绝读档、返回 false、**不清理存档**。
      //    PRD §5 Q6 阶段 1 建议默认（TODO 待用户确认）：版本过新的档当前代码无法安全解析，
      //    保留原始存档供未来版本升级或手动迁移，绝不按坏档清理（否则老数据永久丢失）。
      if (typeof data.schemaVersion === 'number' && data.schemaVersion > CURRENT_SCHEMA_VERSION) {
        this.lastLoadError = 'schema_too_new';
        console.warn(
          `[GameSaveService] 存档 schemaVersion=${data.schemaVersion} 高于当前支持版本 ${CURRENT_SCHEMA_VERSION}，拒绝读档（保留存档，不清理）`,
        );
        return false;
      }

      // 0.5 未知规则版本（非 RULES_BASE、非 RULES_VERSION_VOLATILE）：拒绝读档、
      //     返回 false、**不清理存档**。未知规则若按 base 静默继续，会把未来规则
      //     存档用错误规则运行（写时还会把错误归属固化回档）——与 schemaVersion
      //     一样保留原始存档供升级。缺 rulesVersion 的旧档显式归属 base（兼容）。
      const declaredRules = data.rulesVersion ?? RULES_BASE;
      if (!isSupportedRulesVersion(declaredRules)) {
        this.lastLoadError = 'rules_version_unsupported';
        console.warn(
          `[GameSaveService] 存档 rulesVersion=${data.rulesVersion} 不是支持的规则版本，拒绝读档（保留存档，不清理）`,
        );
        return false;
      }

      // 终局不是可继续的活动对局。历史版本曾在终局后重新写回 game_over 快照，
      // 这里做一次安全收敛，避免刷新后再次出现「继续游戏」并回到旧结算界面。
      if (data.state === 'game_over') {
        this.lastLoadError = 'game_over';
        this.clear();
        console.warn('[GameSaveService] 检测到已结束对局存档，已清除且不再继续');
        return false;
      }

      // 1. 基础字段验证，确保 qi 是有效数值
      if (
        data.currentRound === undefined ||
        data.qi === undefined ||
        typeof data.qi !== 'number' ||
        isNaN(data.qi)
      ) {
        this.lastLoadError = 'invalid_or_import_failed';
        console.warn('[GameSaveService] 存档数据格式不正确，qi 为无效数值');
        this.clear();
        return false;
      }

      // 2. 校验无效存档（Round 1 且无手牌且神识 <= 0 视为无效坏档）
      const isHandEmpty = !data.hand || data.hand.every((slot) => slot === null);
      if (data.currentRound <= 1 && isHandEmpty && data.qi <= 0) {
        this.lastLoadError = 'invalid_or_import_failed';
        console.warn('[GameSaveService] 检测到 Round 1 的无效坏档');
        this.clear();
        return false;
      }

      importer(data);

      console.log('[GameSaveService] 读档还原成功');
      onStateRestore?.();
      return true;
    } catch (e) {
      this.lastLoadError = 'invalid_or_import_failed';
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
