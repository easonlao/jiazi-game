import { JiaziCard, Element, YinYang } from './JiaziCard.ts';
import { CardDataBank } from './CardDataBank.ts';
import { SeasonCycle, Season } from './SeasonCycle.ts';
import { QiManager } from './QiManager.ts';
import {
  BALANCED_TRADE_SCORE_RULES,
  DEFAULT_SCORE_RULES,
  ScoreManager,
  TRADE_SCORE_RULES,
  type ScoreRules,
} from './ScoreManager.ts';
import { LeverageCalculator } from './LeverageCalculator.ts';
import { HandManager } from './HandManager.ts';
import { HandSlot } from './HandSlot.ts';
import { CardPoolManager } from './CardPoolManager.ts';
import { BalanceConfig, DEFAULT_BALANCE_CONFIG } from './BalanceConfig.ts';
import { MathRandomSource, RandomSource } from './RandomSource.ts';
import { calculateHoldingSettlement } from './SettlementPreviewCalculator.ts';
import {
  GameSaveService,
  CURRENT_SCHEMA_VERSION,
  isSupportedRulesVersion,
  isTradeRulesVersion,
  RULES_BASE,
  RULES_VERSION_BALANCED_TRADE,
  RULES_VERSION_BRANCH_ROLL,
  RULES_VERSION_CLEAN_POOL,
  RULES_VERSION_TREND_WINDOW,
  RULES_VERSION_VOLATILE,
  RULES_VERSION_TRADE,
  RULES_VERSION_VOID,
  type GameSnapshot,
  type GameSaveLoadError,
  type PublicCardHistorySnapshot,
  type SupportedRulesVersion,
} from './GameSaveService.ts';
import {
  BRANCH_ROLL_DI_ZHI,
  BRANCH_ROLL_EARTH_COEF,
  BRANCH_ROLL_NON_EARTH_BASE_COEF,
  createBranchRollState,
  isValidBranchRollState,
  type BranchRollState,
} from './BranchRoll.ts';
import { isVoidCard, VoidCard, VOID_CARD_COUNT } from './VoidCard.ts';
import type { StorageProvider } from './StorageProvider.ts';
import { LockManager, type LockResult } from './LockManager.ts';
import { MarginCallEngine } from './MarginCallEngine.ts';
import {
  cardAmplitude,
  createScoreVolatilityState,
  createTrendWindowState,
  pickTrendDirection,
  pickWindowLength,
  getTrendDecayFactor,
  computeTrendDelta,
  DEFAULT_SCORE_VOLATILITY_CONFIG,
  isSupportedVolatilityModel,
  type ScoreVolatilityConfig,
  type ScoreVolatilitySnapshot,
  type VolatilityTrend,
} from './ScoreVolatility.ts';

/** 游戏主状态 */
export type GameState = 'init' | 'settlement' | 'draw' | 'qi_recover' | 'player_action' | 'void_round' | 'game_over';

/**
 * V5 空亡触发信息（onVoidTrigger 回调载荷；供 UI Toast 提示 / 批 2 动画消费）。
 * 每张空亡牌掷 K 后调用一次；prevSeason/nextSeason 为吞噬前后季节。
 */
export interface VoidStep {
  /** 第 index 步推进后所在的季节（spring/summer/autumn/winter） */
  season: string;
  /** 第 index 步推进后的季内回合数（1 起） */
  roundInSeason: number;
}

export interface VoidTriggerInfo {
  /** 本次吞噬的季节步数 K（缺省 uniform 2~8，可注入调整） */
  k: number;
  /** 吞噬前的季节（spring/summer/autumn/winter） */
  prevSeason: string;
  /**
   * 吞噬前的季内回合数（1 起，与 prevSeason 配套）。
   * 批 2 动画倒数序列据此插入「起点帧」——倒数大数字从 K 开始、位置从该张触发前
   * （当前回合）开始，不再从已走 1 步后的 path[0] 开始（起点跳跃修复）。
   */
  prevRoundInSeason: number;
  /** 吞噬后的季节 */
  nextSeason: string;
  /**
   * K 步推进的完整轨迹（每步一个位置，长度 = k；含起点后每一步，终点 = nextSeason 当前季内回合）。
   * 供批 2 动画做「剩余 K 逐回合倒数 + 当前位置逐回合递增」展示——引擎逐步 advance 采集，
   * 与 advanceBy(k) 结果完全一致（不额外消耗随机数，不改变引擎推进的最终状态）。
   */
  path: VoidStep[];
}

/** 玩家操作类型（settle = 终局出清：系统强制平仓，非玩家主动操作，不计入行为统计） */
export type ActionType = 'buy' | 'sell' | 'wait' | 'lock' | 'unlock' | 'settle';

export interface MarginCallDetail {
  cardName: string;
  /** 被反噬牌在丹田的槽位索引 0/1/2（供"来源感"动画定位；2026-08-05 结构化） */
  slotIndex: number;
  /** 反噬罚分 = round(杠杆 × |评分| × 系数)。2026-08-05 起被反噬牌无卖出收益 */
  penaltyScore: number;
  /** 被反噬时实际杠杆倍率 */
  leverage: number;
  /** 被反噬时卡牌评分 */
  cardScore: number;
  /** 兜底描述（含完整计算式） */
  reason: string;
}

export interface SettlementDetail {
  round: number;
  season: string;
  holdEarnings: number;
  holdQiCost: number;
  holdItems: {
    cardName: string;
    earning: number;
    qiCost: number;
    leverage: number;
  }[];
  baseQiRecover: number;
  waitQiRecover: number;
  marginCallTriggered: boolean;
  marginCallDetails: MarginCallDetail[];
  finalQi: number;
  finalScore: number;
}

/**
 * 回合数据留存记录（交易看板数据源）。
 *
 * 每回合结算完成后 push 一条，是"已发生事实"的完整快照——不含任何预测/推演
 * 字段，天然满足 docs/ui-information-boundary.md 的展示边界（看板只能回顾，
 * 不能泄露"下一回合"信息）。
 *
 * 与 SettlementDetail 的关系：settlement 是引擎内部结算明细（lastSettlementDetail），
 * RoundLogEntry 在其上补充行动层信息（本回合玩家执行了什么操作、涉及哪张卡），
 * 合并成一条自包含的回合记录，供 UI 直接消费。
 */
export interface RoundLogEntry {
  /** 回合序号（1-60） */
  round: number;
  /** 真实行动发生回合（买/卖/等候时与 round 可能不同；终局出清回退到当前回合） */
  actionRound?: number | null;
  /** 旧存档兼容补录，只有近似事实，不得冒充真实交易记录。 */
  compatReconstructed?: boolean;
  /** 该回合所处季节（spring/summer/autumn/winter） */
  season: string;
  /** 季内第几回合 */
  roundInSeason: number;
  /** 本回合玩家执行的操作（buy/sell/wait/lock/unlock；首回合无行动为 null） */
  action: ActionType | null;
  /** 行动涉及的卡牌名（调息/等待为 null） */
  actionCardName: string | null;
  /** 行动时该卡的季节评分（买入时=买入评分；卖出时=卖出评分；其余 null） */
  actionCardScore: number | null;
  /** 卖出专属：买入时记录的评分（价差 = actionCardScore - buyScore） */
  buyScore: number | null;
  /** 卖出专属：卖出收益（(卖出评分-买入评分)×4×杠杆） */
  sellScore: number | null;
  /** 行动消耗或变动的神识（买入=纳灵耗神；卖出=归还锁气；调息=0） */
  actionQiChange: number;
  /**
   * V5 空亡吞噬回合标记：该回合被空亡牌吞噬时为吞噬详情；非空亡回合/旧存档缺省
   * （V1-V4 恒无，存档协议保持旧形状——只有空亡回合记录才带本字段）。
   */
  voidSwallow?: {
    /** 该回合空亡触发次数（抽入的空亡牌张数） */
    count: number;
    /** 该回合季节时钟累计吞噬步数（各触发 K 之和） */
    totalK: number;
    /** 该回合单次最大吞噬 K */
    maxK: number;
    /** 该回合「整季吞掉」事件次数（触发中一次吞噬跨过至少一个完整季节；旧存档缺省为 0） */
    swallowed?: number;
  } | null;
  /**
   * 本回合抽牌后玩家可见的公共牌池快照（含锁定保留牌）。
   * 供后续分析体系使用：验证牌池随机性、评估玩家在"当时可选牌"下的决策质量、
   * 复盘"这张牌当时在不在池里"。只存卡牌核心标识，不存动态评分（评分随季节变化，
   * 需要时由引擎按 roundLog.round 反查，避免快照与计算口径漂移）。
   */
  publicCards: { id: number; name: string; mainElement: Element; yinYang: YinYang }[];
  /** 本回合结算明细（持仓炼化/耗神/回神/反噬，来自 lastSettlementDetail） */
  settlement: SettlementDetail;
  /** 该回合结束时的总分数 */
  scoreAfter: number;
  /** 该回合结束时的神识 */
  qiAfter: number;
}

/** 行动尚未提交时的可序列化描述。 */
export type SettlementPreviewAction =
  | { type: 'buy'; cardIndex: number; leverage: boolean }
  | { type: 'sell'; slotIndex: number }
  | { type: 'wait' };

/**
 * 决策情境类型（局终行为评价用）。
 * 玩家每次行动时，用行动前的状态判定当前属于哪个情境。
 */
export type DecisionScenario =
  /** 好牌当前：神识充足 + 公共牌有高分牌（>=15） */
  | 'good_card_available'
  /** 坏牌在手：手牌有评分转负且下季不反弹 */
  | 'bad_card_holding'
  /** 未来好牌：公共牌未来2季评分高且当前便宜 */
  | 'future_good_card'
  /** 神识告急：神识低 + 持仓耗神大 */
  | 'qi_low'
  /** 强牌杠杆：神识充足（>=25，够付杠杆成本）+ 评分高（>=15）且下季不崩 */
  | 'strong_card_leverage';

/** 决策日志条目：某回合玩家面对某情境做出的选择 */
export interface DecisionEntry {
  /** 回合序号 */
  round: number;
  /** 情境（行动前判定） */
  scenario: DecisionScenario;
  /** 实际动作：buy / sell / wait / lock / unlock */
  action: string;
}


/** 主动卖出时的价差与神识流转明细。 */
export interface SalePreviewBreakdown {
  buyScore: number;
  currentScore: number;
  leverage: number;
  scoreChange: number;
  /** 锁定气返还受神识上限截断后的实际到账量。 */
  lockedQiReturn: number;
  qiChange: number;
}

/**
 * 行动确认前的下一回合结算预览。
 *
 * 预览只读取现有状态和计算器；它不调用抽牌、回牌或随机强平，因此不会改变游戏状态
 * 或推进注入的随机源。发生强平时，随机选择的仓位会影响最终神识和分数，相关字段保持
 * null，避免把不确定结果伪装成确定值。
 */
export interface SettlementPreview {
  action: SettlementPreviewAction;
  /** 本次行动明确指向的卡牌；等待行动为 null。 */
  actionCardName: string | null;
  /** 目标卡牌是否为杠杆仓位；等待行动为 false。 */
  actionUsesLeverage: boolean;
  actionQiChange: number;
  actionScoreChange: number;
  saleBreakdown: SalePreviewBreakdown | null;
  qiAfterAction: number;
  scoreAfterAction: number;
  endsGame: boolean;
  nextRound: number | null;
  nextSeason: string | null;
  nextRoundInSeason: number | null;
  settlementLeverage: number | null;
  holdItems: SettlementDetail['holdItems'];
  holdEarnings: number;
  holdQiCost: number;
  qiAfterHold: number | null;
  baseQiRecover: number;
  waitQiRecover: number;
  willMarginCall: boolean;
  marginCallCandidateNames: string[];
  finalQi: number | null;
  finalScore: number | null;
}

/**
 * 最后行动的卡牌信息快照（回合数据留存用）。
 *
 * executeBuy/executeSell 在结算时同步写入；buildRoundLogEntry 在 processRound
 * 归档时读取——由于行动→advanceTurn→processRound 是同步链，读取时必然是最新行动。
 * lock/unlock 不推进回合，不写此字段（它们不产生独立回合记录）。
 */
interface LastActionCardInfo {
  card: JiaziCard;
  /** buy: 买入时评分；sell: 买入时记录的评分 */
  buyScore: number;
  /** sell: 卖出时评分；buy: 与 buyScore 相同 */
  currentScore: number;
  /** sell: 卖出收益（(卖出-买入)×4×杠杆）；buy: 0 */
  sellScore: number;
  /** buy: 纳灵耗神（负值）；sell: 0 */
  buyCost: number;
  /** sell: 归还锁气（正值）；buy: 0 */
  qiReturn: number;
}

/** 判断是否为非 null 且非数组的对象（Record 形状）。 */
function isNonNilRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 回合管理器
 * 
 * 游戏最核心的控制器与状态机骨架。负责流程控制、状态维护和各个子模块（神识、计分、手牌、牌池、季节）的协调工作。
 * 单局限制 60 个回合。管理完整的游戏生命周期以及一键存档/读档机制。
 * 
 * @see {@link design/gdd/system-turn-flow.md} 回合流程设计文档
 */
export class TurnManager {
  private static readonly TOTAL_ROUNDS = 60;

  // 注入的配置与随机源（固定 seed 可复现依赖）
  private readonly balanceConfig: BalanceConfig;
  private readonly random: RandomSource;
  private readonly volatilityRandom: RandomSource;
  /** V6 地支波动独立随机源（同 volatilityRandom 模式）：不消耗主随机流。 */
  private readonly branchRollRandom: RandomSource;
  private readonly scoreVolatilityConfig: ScoreVolatilityConfig;
  private scoreVolatilityState: ScoreVolatilitySnapshot | null;
  /** V6 地支波动状态（仅 rulesVersion=6 创建；V5 及以下恒 null，不消耗随机数）。 */
  private branchRollState: BranchRollState | null = null;
  private readonly initialRulesVersion: SupportedRulesVersion;
  private readonly initialScoreRules: ScoreRules;
  /**
   * 当前生效的波动配置（= 存档声明优先）。
   *
     * 新局/重置 = 构造函数配置；读档后 = 存档 scoreVolatility 携带的 model/scale/bandFactors
   * （base 构造读 conflict_banded 档也按存档模型刷新，不依赖构造函数默认）。
   * getCardScore 模型分支、refreshScoreVolatility 重建一律以本字段为准。
   */
  private activeVolatilityConfig: ScoreVolatilityConfig;
  /**
   * 当前生效的规则版本（active rules state）。
   * - 新局默认：由构造函数 volatility 决定（enabled → 波动规则，否则 base）。
   * - 读档后：以存档声明的 rulesVersion 为准（缺省 = base），覆盖构造默认。
   * 波动是否生效（getCardScore / refreshScoreVolatility / reset）一律以本字段为门，
   * 不能只靠 scoreVolatilityConfig.enabled——否则旧档会被构造时的全局开关解释成
   * 其他规则，且换季时会被静默重新启用（旧档安全原则，见 PRD §8/§9）。
   */
  private rulesVersion: SupportedRulesVersion;

  // 子系统
  private cardDataBank: CardDataBank;
  private seasonCycle: SeasonCycle;
  private qiManager: QiManager;
  private scoreManager: ScoreManager;
  private leverageCalculator: LeverageCalculator;
  private handManager: HandManager;
  private cardPoolManager: CardPoolManager;

  // 游戏状态
  private currentRound: number;
  private state: GameState;
  private lastAction: ActionType | null;
  private selectedCardIndex: number;
  private useLeverage: boolean;
  private marginCallCount: number;

  /** 锁定中的公共牌管理（锁定机制见 LockManager） */
  private readonly lockManager: LockManager;
  /** 强平引擎（爆仓时对杠杆仓位强制平仓） */
  private readonly marginCallEngine: MarginCallEngine;
  /** 锁定费常量：每张锁定牌每回合消耗神识（转发 LockManager，单一真源） */
  static readonly LOCK_COST_PER_CARD = LockManager.LOCK_COST_PER_CARD;
  /** 锁定张数上限：展示牌数 - 1（锁满则公共位全占，每回合 0 张新牌，游戏僵死） */
  static readonly MAX_LOCKED_CARDS = LockManager.MAX_LOCKED_CARDS;
  /** V5 空亡时间吞噬：K ~ uniform[2, 8]（含端点）定稿默认值，走注入的种子随机源。 */
  static readonly VOID_K_MIN = 2;
  static readonly VOID_K_MAX = 8;
  /** 空亡牌张数上限（防止非法坏档导致牌堆异常膨胀） */
  static readonly VOID_CARD_COUNT_MAX = 10;

  /** 实际生效的空亡参数（options.voidConfig 覆盖，缺省 = 2 张新局 / 3 张旧局 / K 2~8）。 */
  private voidCardCount: number;
  private readonly initialVoidCardCount: number;
  private readonly voidKMin: number;
  private readonly voidKMax: number;
  /** V5 空亡观测统计（纯只读，不改变任何行为）：触发次数 / 整季吞掉事件次数 / 单次最大吞噬 K。 */
  private voidTriggers: number = 0;
  private voidSwallowedEvents: number = 0;
  private voidMaxK: number = 0;
  /** 最近一次空亡吞噬回合详情（buildRoundLogEntry 归档后清空；非空亡回合为 null）。 */
  private lastVoidSwallow: NonNullable<RoundLogEntry['voidSwallow']> | null = null;

  // 局内反馈与统计
  private lastSettlementDetail: SettlementDetail | null = null;
  private totalBuys: number = 0;
  private totalSells: number = 0;
  private totalWaits: number = 0;
  private totalLeverageBuys: number = 0;
  /** 锁定次数（executeLockCard 成功 +1；行为画像"预判"维度数据源） */
  private totalLocks: number = 0;
  /** 回合数据留存：每回合一条完整记录（交易看板/局终总结的数据源） */
  private roundLog: RoundLogEntry[] = [];
  /** 公共卡池历史：逐回合真实评分快照（不从当前状态反推）。 */
  private publicCardHistory: PublicCardHistorySnapshot[] = [];
  /** 决策日志：每次行动记录「情境 × 动作」（局终行为评价用） */
  private decisionLog: DecisionEntry[] = [];
  /** 最后行动的卡牌信息快照（buildRoundLogEntry 归档用，行动时同步更新） */
  private lastActionCard: LastActionCardInfo | null = null;
  /** 最近一次玩家行动发生的回合号（用于 roundLog 行动层） */
  private lastActionRound: number | null = null;

  // 回调
  private onStateChange?: (state: GameState) => void;
  private onTurnStart?: (round: number) => void;
  private onGameEnd?: (finalScore: number) => void;
  /** 锁定牌被自动解锁（付不起锁定费时回合末触发），携带被解锁的牌 ID 列表 */
  private onLockAutoUnlocked?: (cardIds: number[]) => void;
  /** V5 空亡触发回调：每张空亡牌掷 K 后调用一次（供 UI Toast / 批 2 动画） */
  private onVoidTrigger?: (info: VoidTriggerInfo) => void;

  // 存档服务（序列化与 LocalStorage 边界）
  private readonly saveService: GameSaveService;

  constructor(
    config?: BalanceConfig,
    random?: RandomSource,
    options?: {
      skipSeasonGenerate?: boolean;
      storage?: StorageProvider;
      volatility?: Partial<ScoreVolatilityConfig>;
      volatilityRandom?: RandomSource;
      /**
       * V6 地支波动独立随机源（同 volatilityRandom 模式，默认回退 randomSource）。
       * 仅 rulesVersion=6 读取；V5 及以下不创建不消耗（路径逐字节不变）。
       */
      branchRollRandom?: RandomSource;
       /** 新局规则语义；未指定且启用波动时保持现有 v2。 */
      rulesVersion?: SupportedRulesVersion;
      /** 交易规则的计分参数；v1/v2 使用旧默认值。 */
      scoreRules?: Partial<ScoreRules>;
      /**
       * V5 空亡参数（可选注入；缺省 = 定稿值：张数 3 / K 2~8）。
       * 仅 rulesVersion=5 时生效；V1-V4 路径完全不读取，行为逐字节不变。
       */
      voidConfig?: {
        /** 空亡牌张数（0 = 无空亡牌，V5 引擎仍走懒生成季长）。 */
        voidCardCount?: number;
        /** 空亡 K 掷骰下限（缺省 2）。 */
        voidKMin?: number;
        /** 空亡 K 掷骰上限（缺省 8）。 */
        voidKMax?: number;
      };
    },
  ) {
    const balanceConfig = config ?? DEFAULT_BALANCE_CONFIG;
    const randomSource = random ?? new MathRandomSource();
    this.balanceConfig = balanceConfig;
    this.random = randomSource;
    this.volatilityRandom = options?.volatilityRandom ?? randomSource;
    this.branchRollRandom = options?.branchRollRandom ?? randomSource;
    this.scoreVolatilityConfig = {
      ...DEFAULT_SCORE_VOLATILITY_CONFIG,
      ...options?.volatility,
    };
    this.activeVolatilityConfig = this.scoreVolatilityConfig;
    this.scoreVolatilityState = this.scoreVolatilityConfig.enabled
      ? createScoreVolatilityState(this.volatilityRandom, this.scoreVolatilityConfig)
      : null;
    // 构造默认只决定"新局/模拟"的规则；读档后由 importSnapshot 按存档声明覆盖。
    this.rulesVersion = options?.rulesVersion
      ?? (this.scoreVolatilityConfig.enabled ? RULES_VERSION_VOLATILE : RULES_BASE);
    const defaultScoreRules = this.rulesVersion === RULES_VERSION_TRADE
      ? TRADE_SCORE_RULES
      : this.rulesVersion >= RULES_VERSION_BALANCED_TRADE
        ? BALANCED_TRADE_SCORE_RULES // V5 继承 V4 计分（一审 P1-① 定案）；V6/V7/V8 继承 V5 计分 + 地支 roll 一层
        : DEFAULT_SCORE_RULES;
    this.initialRulesVersion = this.rulesVersion;
    this.initialScoreRules = {
      ...defaultScoreRules,
      ...options?.scoreRules,
    };
    // 空亡参数：可选注入（voidConfig），缺省 = 定稿值（3 张 / K 2~8）。
    // 必须在 CardDataBank 构造之前解析（后者按张数生成空亡牌）。
    // 仅 rulesVersion=5 生效；V1-V4 不读取。K 边界做归一化防止非法范围。
    this.voidKMin = Math.min(
      options?.voidConfig?.voidKMin ?? TurnManager.VOID_K_MIN,
      options?.voidConfig?.voidKMax ?? TurnManager.VOID_K_MAX,
    );
    this.voidKMax = Math.max(
      options?.voidConfig?.voidKMin ?? TurnManager.VOID_K_MIN,
      options?.voidConfig?.voidKMax ?? TurnManager.VOID_K_MAX,
    );
    const defaultVoidCards = (this.rulesVersion === RULES_VERSION_VOID || this.rulesVersion === RULES_VERSION_BRANCH_ROLL)
      ? 3
      : (this.rulesVersion >= RULES_VERSION_TREND_WINDOW ? VOID_CARD_COUNT : 0);
    this.voidCardCount = Math.max(0, Math.floor(options?.voidConfig?.voidCardCount ?? defaultVoidCards));
    this.initialVoidCardCount = this.voidCardCount;
    this.cardDataBank = new CardDataBank(this.voidCardCount);
    // V5/V6/V7/V8 空亡规则：SeasonCycle 走懒生成（换季时从种子随机源抽下一季长度）。
    this.seasonCycle = new SeasonCycle(
      randomSource,
      this.rulesVersion >= RULES_VERSION_VOID
        ? { lazy: true, skipGenerate: options?.skipSeasonGenerate ?? false }
        : (options?.skipSeasonGenerate ?? false),
    );
    // V6/V7/V8 地支波动：构造即生成首季 roll（仿 V5 懒生成季长"构造即生成"，使随机消耗时机
    // 由引擎推进决定而非外部首次访问——防客户端 UI 局与服务端纯引擎重放随机流分叉）。
    // 仅 rulesVersion>=6 创建；V5 及以下不消耗 branchRollRandom（路径逐字节不变）。
    this.branchRollState = this.rulesVersion >= RULES_VERSION_BRANCH_ROLL
      ? createBranchRollState(this.branchRollRandom, this.seasonCycle.getCurrentSeasonIndex())
      : null;
    this.qiManager = new QiManager(undefined, balanceConfig);
    this.scoreManager = new ScoreManager(this.initialScoreRules);
    this.leverageCalculator = new LeverageCalculator(balanceConfig);
    this.handManager = new HandManager();
    this.cardPoolManager = new CardPoolManager(randomSource);

    this.currentRound = 1;
    this.state = 'init';
    this.lastAction = null;
    this.selectedCardIndex = -1;
    this.useLeverage = false;
    this.marginCallCount = 0;

    this.lockManager = new LockManager({
      qiManager: this.qiManager,
      cardPoolManager: this.cardPoolManager,
      getCardScore: (card, season) => this.getCardScore(card, season),
    });
    this.marginCallEngine = new MarginCallEngine({
      qiManager: this.qiManager,
      handManager: this.handManager,
      cardPoolManager: this.cardPoolManager,
      scoreManager: this.scoreManager,
      leverageCalculator: this.leverageCalculator,
      seasonCycle: this.seasonCycle,
      balanceConfig: this.balanceConfig,
      getCardScore: (card, season) => this.getCardScore(card, season),
      getTotalLockedQi: () => this.getTotalLockedQi(),
      onMarginCall: () => {
        this.marginCallCount++;
      },
    });

    this.lastSettlementDetail = null;
    this.totalBuys = 0;
    this.totalSells = 0;
    this.totalWaits = 0;
    this.totalLeverageBuys = 0;
    this.totalLocks = 0;
    this.roundLog = [];
    this.publicCardHistory = [];
    this.decisionLog = [];
    this.lastActionCard = null;
    this.lastActionRound = null;

    this.saveService = new GameSaveService(options?.storage);
  }

  /** 所有核心结算和预览共用的最终评分入口。 */
  private isVolatilityRulesVersion(): boolean {
    return this.rulesVersion === RULES_VERSION_VOLATILE || isTradeRulesVersion(this.rulesVersion);
  }

  /**
   * 空亡机制门控：V5/V6/V7 激活双时钟吞噬/懒生成/63 张牌堆。
   * V6（地支波动）继承 V5 空亡机制（mechanics.md §10：V6 = V5 + 地支 roll 一层）。
   * V7（趋势窗口）继承 V6 空亡机制（mechanics.md §11：V7 = V6 + trend_window 波动）。
   */
  private isVoidRulesVersion(): boolean {
    return this.rulesVersion >= RULES_VERSION_VOID;
  }

  /** V6/V7 地支波动门控：rulesVersion=6/7 时激活；V5 及以下路径逐字节不变。 */
  private isBranchRollRulesVersion(): boolean {
    return this.rulesVersion >= RULES_VERSION_BRANCH_ROLL;
  }

  /** trend_window 波动模型门控：活跃波动配置 model === 'trend_window' 且波动已启用。 */
  private isTrendWindowRulesVersion(): boolean {
    return this.isVolatilityRulesVersion()
      && (this.activeVolatilityConfig.model ?? 'uniform') === 'trend_window';
  }

  /**
   * 浓度溢价系数按规则版本门控：仅 V7（trend_window）生效，V6 及以下视为 0。
   * 设计意图：浓度溢价是 V7 新增机制，V6 保留为历史兼容（design.md 第 6 节）。
   * public：core 投影层（settlementProjection）需按同一门控计算虚拟浓度。
   */
  getConcentrationPremiumFactor(): number {
    return this.isTrendWindowRulesVersion() ? this.balanceConfig.concentrationPremiumFactor : 0;
  }

  getCardScore(card: JiaziCard, season: string): number {
    const baseScore = card.getSeasonScore(season, this.balanceConfig);
    // 门控以"当前生效规则版本"为准（读档后=存档声明），而非构造函数开关；
     // 只有当前已知的波动规则版本才叠加偏移。未知未来规则版本不按波动解释，
     // 由读档门控拒绝；这里的精确版本判断避免未来规则被错误套用当前公式。
    if (!this.isVolatilityRulesVersion() || !this.scoreVolatilityState) {
      // 无波动路径（base 规则 / 旧档 / 未接线波动的规则局）：V6 地支波动在
      // 取整前分值上注入 roll（与校准基准 round(X + roll_t) 同口径）；其余版本
      // 直接返回基础评分（逐字节不变）。
      if (this.isBranchRollRulesVersion() && this.branchRollState) {
        const delta = this.getBranchRollDelta(card);
        if (delta === 0 || season !== this.seasonCycle.getCurrentSeason()) return baseScore;
        return Math.round(card.getSeasonScorePreRound(season, this.balanceConfig) + delta);
      }
      return baseScore;
    }

    // 实验阶段只把波动叠加到当前季评分；未来季节仍返回基础评分，避免把
    // 当前短期状态伪装成未来已知信息。V6 地支 roll 同样只作用当前季。
    if (season !== this.seasonCycle.getCurrentSeason()) return baseScore;

    // 按当前生效模型分支：trend_window 按牌级独立趋势窗口；
    // conflict_banded 按牌级幅度 + 地支共享方向；uniform（兼容默认）按地支整数偏移。
    let score: number;
    const effectiveModel = this.scoreVolatilityState.model ?? this.activeVolatilityConfig.model ?? 'uniform';
    if (effectiveModel === 'trend_window' && this.scoreVolatilityState.trendWindowByCardId) {
      // trend_window：每张牌独立趋势方向 + 窗口长度 + 衰减
      const cardTrend = this.scoreVolatilityState.trendWindowByCardId[card.id];
      if (!cardTrend) {
        // 懒初始化：该牌尚未生成趋势状态（旧档缺字段或新增牌）
        const direction = pickTrendDirection(this.volatilityRandom);
        const windowLength = pickWindowLength(this.volatilityRandom);
        this.scoreVolatilityState.trendWindowByCardId[card.id] = {
          direction,
          remainingRounds: windowLength,
          windowLength,
        };
      }
      const trend = this.scoreVolatilityState.trendWindowByCardId[card.id];
      const scale = this.activeVolatilityConfig.scale ?? DEFAULT_SCORE_VOLATILITY_CONFIG.scale ?? 2;
      const bandFactors = this.scoreVolatilityState.bandFactors
        ?? this.activeVolatilityConfig.bandFactors
        ?? {};
      const amplitude = cardAmplitude(card, scale, baseScore, bandFactors);
      const decayFactor = getTrendDecayFactor(trend.remainingRounds);
      const delta = computeTrendDelta(trend.direction, amplitude, decayFactor);
      score = Math.round(baseScore + delta);
    } else if (effectiveModel === 'conflict_banded') {
      const direction = this.scoreVolatilityState.directionByDiZhi?.[card.diZhi] ?? 0;
      const scale = this.scoreVolatilityState.scale ?? this.activeVolatilityConfig.scale ?? DEFAULT_SCORE_VOLATILITY_CONFIG.scale ?? 2;
      const bandFactors = this.scoreVolatilityState.bandFactors
        ?? this.activeVolatilityConfig.bandFactors
        ?? {};
      const amplitude = cardAmplitude(card, scale, baseScore, bandFactors);
      score = Math.round(baseScore + direction * amplitude);
    } else {
      score = baseScore + (this.scoreVolatilityState.deltaByDiZhi[card.diZhi] ?? 0);
    }
    // V6：波动叠加后追加地支 roll（base + 波动 + roll 顺序；V5 及以下恒等返回）。
    return this.applyBranchRoll(score, card, season);
  }

  /**
   * V6 地支 roll 注入项：roll_coef × (u_S − mean_u)（docs/mechanics.md §10）。
   * - 非土：roll_coef = 3 × 阴阳因子（阳 1.1 / 阴 0.9），藏干权重 0.3 已并入（0.3×10=3）；
   * - 土牌（方案 E）：roll_coef = 5 × 0.5（减半），藏干权重 0.5 已并入再减半。
   * u_S − mean_u = 该地支当季藏干响应偏移与四季均值差（BranchRollState 携带）。
   */
  private getBranchRollDelta(card: JiaziCard): number {
    if (!this.branchRollState) return 0;
    const uS = this.branchRollState.rollByDiZhi[card.diZhi] ?? 0;
    const meanU = this.branchRollState.meanByDiZhi[card.diZhi] ?? 0;
    const shift = uS - meanU;
    if (shift === 0) return 0;
    const coef = card.tianGanElement === Element.EARTH
      ? BRANCH_ROLL_EARTH_COEF
      : BRANCH_ROLL_NON_EARTH_BASE_COEF * (card.yinYang === YinYang.YANG
          ? this.balanceConfig.yangPolarityFactor
          : this.balanceConfig.yinPolarityFactor);
    return coef * shift;
  }

  /**
   * V6 地支 roll 叠加（对已含波动的最终分值）：季内恒定、换季重掷；只作用当前季。
   * V5 及以下（非 branch roll 规则版本 / 无状态）恒等返回，路径逐字节不变。
   */
  private applyBranchRoll(score: number, card: JiaziCard, season: string): number {
    if (!this.isBranchRollRulesVersion() || !this.branchRollState) return score;
    // 未来季节不注入：该季的 roll 尚未生成（换季时才掷），泄露即为作弊信息。
    if (season !== this.seasonCycle.getCurrentSeason()) return score;
    const delta = this.getBranchRollDelta(card);
    if (delta === 0) return score;
    return Math.round(score + delta);
  }

  /**
   * V6 地支波动状态快照（返回拷贝供读取）。非 V6 / 未激活返回 null。
   * 供 UI 地支偏移条（票 03）与校准探针使用；换季重掷后经 store 同步自然刷新。
   */
  getBranchRollState(): BranchRollState | null {
    if (!this.branchRollState) return null;
    return {
      rulesVersion: this.branchRollState.rulesVersion,
      rollByDiZhi: { ...this.branchRollState.rollByDiZhi },
      meanByDiZhi: { ...this.branchRollState.meanByDiZhi },
    };
  }

  /**
   * V6 地支偏移条显示值（票 03）：12 地支的效果值 = 该族阳干非土卡的实际注入分差
   * （= 非土基数 × 阳干阴阳因子 × 偏移差，四舍五入；同族阳干非土卡注入相同——
   * 同地支共享偏移差）。土天干卡注入（2.5×偏移差）不在条上体现（卡面分已含）。
   * 口径与 getBranchRollDelta 的非土阳干分支一致；非 V6 返回 null。
   */
  getBranchRollDisplayDeltas(): Record<string, number> | null {
    if (!this.isBranchRollRulesVersion() || !this.branchRollState) return null;
    const yangFactor = this.balanceConfig.yangPolarityFactor;
    const result: Record<string, number> = {};
    for (const diZhi of BRANCH_ROLL_DI_ZHI) {
      const uS = this.branchRollState.rollByDiZhi[diZhi] ?? 0;
      const meanU = this.branchRollState.meanByDiZhi[diZhi] ?? 0;
      result[diZhi] = Math.round(BRANCH_ROLL_NON_EARTH_BASE_COEF * yangFactor * (uS - meanU));
    }
    return result;
  }

  /** 当前实际生效的规则版本；读档后以存档声明为准。 */
  getRulesVersion(): SupportedRulesVersion {
    return this.rulesVersion;
  }

  /**
   * V5 空亡观测统计（只读，不改变行为）：触发次数、整季吞掉事件次数与单次最大吞噬 K。
   * swallowedEvents = 触发中「一次吞噬跨过至少一个完整季节」的次数（事件口径，
   * 与 void-season-probe.mts 的 fullSkip 一致，供「每局 ≈1.4 次整季吞掉」对照）；
   * maxVoidK = 全局限时单次吞噬最大 K（无触发时为 0）。
   * 仅 rulesVersion=5 时有值；V1-V4 恒为 0。
   */
  getVoidStats(): { triggers: number; swallowedEvents: number; maxVoidK: number } {
    return {
      triggers: this.voidTriggers,
      swallowedEvents: this.voidSwallowedEvents,
      maxVoidK: this.voidMaxK,
    };
  }

  /** 当前实验性波动状态，供模拟器和诊断输出使用。 */
  getScoreVolatilityState(): ScoreVolatilitySnapshot | null {
    if (!this.scoreVolatilityState) return null;
    const base = {
      remainingRounds: this.scoreVolatilityState.remainingRounds,
      deltaByDiZhi: { ...this.scoreVolatilityState.deltaByDiZhi },
    };
    const model = this.scoreVolatilityState.model ?? 'uniform';
    if (model === 'trend_window') {
      const bandFactors = this.scoreVolatilityState.bandFactors ?? this.activeVolatilityConfig.bandFactors;
      return {
        ...base,
        model: 'trend_window',
        scale: this.scoreVolatilityState.scale ?? this.activeVolatilityConfig.scale ?? DEFAULT_SCORE_VOLATILITY_CONFIG.scale ?? 2,
        ...(bandFactors ? { bandFactors: { ...bandFactors } } : {}),
        ...(this.scoreVolatilityState.trendWindowByCardId
          ? { trendWindowByCardId: { ...this.scoreVolatilityState.trendWindowByCardId } }
          : {}),
      };
    }
    if (model !== 'conflict_banded') return base;
    const bandFactors = this.scoreVolatilityState.bandFactors ?? this.activeVolatilityConfig.bandFactors;
    return {
      ...base,
      model: 'conflict_banded',
      scale: this.scoreVolatilityState.scale ?? this.activeVolatilityConfig.scale ?? DEFAULT_SCORE_VOLATILITY_CONFIG.scale ?? 2,
      directionByDiZhi: { ...this.scoreVolatilityState.directionByDiZhi },
      ...(bandFactors ? { bandFactors: { ...bandFactors } } : {}),
    };
  }

  /**
   * 卡牌在当前活跃波动状态下的短期趋势（实验 UI 紧凑箭头数据源）。
   *
    * 返回 null 的条件与 getCardScore 叠加波动的门控一致：活跃规则版本必须是当前已知
    * 波动规则且波动状态存在（base 规则 / 旧档 / 未知未来版本返回 null，
   * UI 不渲染箭头）。方向来源按当前生效模型分支：
   * - conflict_banded：读 directionByDiZhi[card.diZhi]（地支共享方向）；
   * - uniform：读 deltaByDiZhi[card.diZhi]（地支整数偏移）。
   * 值 >0 → rising，<0 → falling，=0 → steady。
   */
  getCardVolatilityTrend(card: JiaziCard): VolatilityTrend | null {
    if (!this.isVolatilityRulesVersion() || !this.scoreVolatilityState) return null;

    const model = this.scoreVolatilityState.model ?? this.activeVolatilityConfig.model ?? 'uniform';
    if (model === 'trend_window') {
      const trend = this.scoreVolatilityState.trendWindowByCardId?.[card.id];
      if (!trend) return null;
      if (trend.direction > 0) return 'rising';
      if (trend.direction < 0) return 'falling';
      return 'steady';
    }
    const direction = model === 'conflict_banded'
      ? this.scoreVolatilityState.directionByDiZhi?.[card.diZhi] ?? 0
      : this.scoreVolatilityState.deltaByDiZhi[card.diZhi] ?? 0;

    if (direction > 0) return 'rising';
    if (direction < 0) return 'falling';
    return 'steady';
  }

  /**
   * 当前卡牌相对本季基础评分的实际波动值。
   *
   * 只在波动规则当前生效且卡牌处于当前季时返回数值；旧规则、旧存档和未来季节
   * 返回 null，避免把未应用的波动误显示成已知信息。
   */
  getCardVolatilityDelta(card: JiaziCard): number | null {
    if (!this.isVolatilityRulesVersion() || !this.scoreVolatilityState) return null;

    const season = this.seasonCycle.getCurrentSeason();
    return this.getCardScore(card, season) - card.getSeasonScore(season, this.balanceConfig);
  }

  /**
   * 组装开局牌堆：V5 用全套 63 张（60 甲子 + 3 空亡）；V1-V4 只装 60 张甲子牌，
   * 空亡牌不入堆（行为与旧版逐字节一致）。
   */
  private buildDeckCards(): JiaziCard[] {
    const all = this.cardDataBank.getAllCards();
    return this.isVoidRulesVersion() ? all : all.filter((card) => !isVoidCard(card));
  }

  /**
   * 初始化游戏，拉取卡牌数据，并初始化牌池
   */
  async initialize(): Promise<void> {
    await this.cardDataBank.initialize();
    this.cardPoolManager.initialize(this.buildDeckCards());

    // trend_window 模型：加载完卡牌后创建初始趋势状态
    if (this.isTrendWindowRulesVersion()) {
      const allCardIds = this.cardDataBank.getAllCards().map(c => c.id);
      this.scoreVolatilityState = createTrendWindowState(this.volatilityRandom, allCardIds);
    }

    this.currentRound = 1;
    this.state = 'init';
    this.lastAction = null;
    this.voidTriggers = 0;
    this.voidSwallowedEvents = 0;
    this.voidMaxK = 0;
    this.lastVoidSwallow = null;

    console.log('[TurnManager] 游戏初始化完成');
  }

  /**
   * 开始运行游戏，将状态流转至抽牌阶段并执行回合逻辑
   */
  startGame(): void {
    this.state = 'draw';
    this.processRound();
  }

  /**
   * 单回合的处理引擎，串联结算、抽牌、神识回复
   *
   * V5 空亡规则（rulesVersion=5）分支：抽牌先行——空亡牌抽入公共牌区当回合即触发
   * 时间吞噬（季节时钟前进 K、游戏回合只走 1、玩家不可行动、结算落在跳跃后的季节），
   * 因此必须在结算之前完成抽牌与季节跳跃。V1-V4 与 V5 未触发回合走原流程，行为一致。
   */
  private processRound(): void {
    if (this.currentRound > TurnManager.TOTAL_ROUNDS) {
      // 归档最后一回合（第 60 回合）的玩家操作：roundLog 的 round 字段是"归档回合"，
      // 第 N 回合的操作在第 N+1 回合的 processRound 里归档；但第 60 回合操作后直接
      // 进入终局分支，永远不会被归档。若不补，该操作从 roundLog 统计中丢失——
      // 若第 60 回合是卖出，聚合会虚增"持有中"（2026-08-08 数据一致性回归测试撞出）。
      // lastSettlementDetail 此时是第 60 回合的结算快照（R1 起每回合都设置，非空）。
      if (this.lastSettlementDetail) {
        this.roundLog.push(this.buildRoundLogEntry());
      }
      this.endGame();
      return;
    }

    // 初始化本轮结算明细
    this.lastSettlementDetail = {
      round: this.currentRound,
      season: this.seasonCycle.getCurrentSeason(),
      holdEarnings: 0,
      holdQiCost: 0,
      holdItems: [],
      baseQiRecover: 0,
      waitQiRecover: 0,
      marginCallTriggered: false,
      marginCallDetails: [],
      finalQi: 0,
      finalScore: 0,
    };

    if (this.rulesVersion >= RULES_VERSION_CLEAN_POOL) {
      // V8+ 牌池守恒规则：
      // 1. 先结算锁定费（若欠费自动解锁，牌立即回堆）
      const autoUnlockedIds = this.lockManager.settleLockCost(this.seasonCycle.getCurrentSeason(), true);
      if (autoUnlockedIds.length > 0) {
        this.onLockAutoUnlocked?.(autoUnlockedIds);
      }
      // 2. 抽牌（锁定牌保留在公共区，其余空位由牌堆新牌填充）
      this.drawPublicCards();
      // 3. 空亡规则：检测抽出的公共牌是否含空亡触发
      if (this.isVoidRulesVersion()) {
        const voidCards = this.collectVoidTriggers();
        if (voidCards.length > 0) {
          this.processVoidRound(voidCards);
          return;
        }
      }
      // 4. 持仓结算
      this.settleHoldings();
      // 5. 神识回复
      this.recoverQi();
    } else {
      // V7 及更早规则：严格保留历史执行时序与回放语义
      if (this.isVoidRulesVersion()) {
        this.drawPublicCards();
        const voidCards = this.collectVoidTriggers();
        if (voidCards.length > 0) {
          this.processVoidRound(voidCards);
          return;
        }
      }
      this.settleHoldings();
      const autoUnlockedIds = this.lockManager.settleLockCost(this.seasonCycle.getCurrentSeason(), false);
      if (autoUnlockedIds.length > 0) {
        this.onLockAutoUnlocked?.(autoUnlockedIds);
      }
      if (!this.isVoidRulesVersion()) {
        this.drawPublicCards();
      }
      this.recoverQi();
    }

    // 记录本回合最终分和神识数值
    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.finalQi = this.qiManager.getQi();
      this.lastSettlementDetail.finalScore = this.scoreManager.getScore();
    }

    // 回合数据留存：把本回合（已发生的行动 + 结算 + 终值）归档为一条不可变记录。
    // 首回合（round 1）玩家尚未行动，action 为 null；后续回合 action 是上一回合的操作。
    // 行动层信息从 lastAction 与 lastSettlementDetail 重建——卖出专属的 buyScore/sellScore
    // 在 executeSell 时已结算，这里直接读最后行动即可（无历史追溯需求，看板逐回合展示）。
    this.roundLog.push(this.buildRoundLogEntry());
    this.capturePublicCardHistorySnapshot();

    // 4. 等待玩家操作
    this.state = 'player_action';
    this.onStateChange?.('player_action');
    this.onTurnStart?.(this.currentRound);
  }

  /** 抽牌入口：锁定牌保留在公共区，其余位由牌堆新牌填充。 */
  private drawPublicCards(): void {
    this.cardPoolManager.drawCards(this.lockManager.getLockedCardIds());
  }

  /**
   * 检测本轮"新抽入"的空亡牌（触发只针对新抽入；锁定保留期的空亡牌不重复触发）。
   * @returns 本轮新抽入的空亡牌列表（0 张 = 未触发）
   */
  private collectVoidTriggers(): VoidCard[] {
    const lockedIds = new Set(this.lockManager.getLockedCardIds());
    return this.cardPoolManager
      .getPublicCards()
      .filter((card) => !lockedIds.has(card.id))
      .filter((card): card is VoidCard => isVoidCard(card));
  }

  /**
   * V5 空亡吞噬回合：空亡牌已抽入公共牌区，立即触发。
   * 流程（mechanics.md §9）：
   * 1. 季节时钟前进 K（每张抽中的空亡牌独立掷 K，K ~ uniform[2,8]，走种子随机源）；
   * 2. 游戏回合只走 1（advanceAfterVoid），该回合玩家不可行动；
   * 3. 持仓照常结算一次，结算落在跳跃后的季节；反噬/强平照常判定；
   * 4. 仅自然回复 +10 神识（无调息 +10 加成）；
   * 5. 触发当回合结束后空亡牌回牌堆，下回合可再抽出（每张可反复触发）。
   */
  private processVoidRound(voidCards: VoidCard[]): void {
    // 0. 空亡吞噬回合状态：该回合玩家不可行动，UI 显示「空亡吞噬中...」。
    //    V1-V4 路径不进入（仅 rulesVersion=5 触发时）。吞噬回合结束后由
    //    advanceAfterVoid → processRound 恢复为 player_action（或 game_over）。
    this.state = 'void_round';
    this.onStateChange?.('void_round');

    // 1. 季节时钟吞噬：K 掷骰走注入的种子随机源（服务端重放可复现）。
    //    K 范围 = voidConfig.voidKMin/voidKMax（缺省 2~8）；观测统计只增不改行为。
    let totalK = 0;
    let maxK = 0;
    let swallowedCount = 0;
    for (const _voidCard of voidCards) {
      const idxBefore = this.seasonCycle.getCurrentSeasonIndex();
      const prevSeason = this.seasonCycle.getCurrentSeason();
      const prevRoundInSeason = this.seasonCycle.getCurrentRoundInSeason();
      const k = this.random.int(this.voidKMin, this.voidKMax + 1);
      // K 步逐步推进并采集完整轨迹（每步一个位置，长度 = k）：
      // - 逐步 advance 与 advanceBy(k) 结果完全一致（advanceBy 内部就是 k 次 advance 的
      //   while 循环，纯算术无分支），因此**不改变引擎推进的最终状态**；
      // - 不额外消耗随机数：advance 不掷骰，换季时的下一季长度已由引擎确定性预生成
      //   （懒生成修复后行为，构造生成首季 + advance 换季预生成），与 advanceBy 消耗完全一致；
      // - path 只供批 2 动画做「剩余 K 逐回合倒数 + 当前位置逐回合递增」表达（2026-08-14 用户拍板）。
      const path: VoidStep[] = [];
      for (let step = 0; step < k; step++) {
        const crossedSeason = this.seasonCycle.advance();
        // V6 空亡跨季：季节时钟每跨一季即重掷地支波动（与服务端重放随机消耗序列一致，
        // 与 advanceTurn 换季点同口径——季内恒定、每跨一季重掷）。
        if (crossedSeason) this.refreshBranchRoll();
        path.push({
          season: this.seasonCycle.getCurrentSeason(),
          roundInSeason: this.seasonCycle.getCurrentRoundInSeason(),
        });
      }
      const idxAfter = this.seasonCycle.getCurrentSeasonIndex();
      const nextSeason = this.seasonCycle.getCurrentSeason();
      this.voidTriggers++;
      totalK += k;
      if (k > maxK) maxK = k;
      if (k > this.voidMaxK) this.voidMaxK = k;
      // 整季吞掉事件：一次吞噬跨过至少一个完整季节（季索引净差 ≥ 2），
      // 与 probe 的 fullSkip 同义（连吞两季在 probe 中计入 fullSkip 事件）。
      if (idxAfter - idxBefore >= 2) {
        this.voidSwallowedEvents++;
        swallowedCount++;
      }
      // 每张空亡牌触发后立即通知（供 UI Toast 提示与批 2 动画消费）。
      // prevRoundInSeason 与该张 prevSeason 配套（触发前季内回合数）——批 2 动画
      // 倒数序列的起点帧数据源；多张连触时第一张的 prevSeason/prevRoundInSeason
      // 即吞噬批起点（后续张 prevSeason = 前一张 path 终点）。
      this.onVoidTrigger?.({ k, prevSeason, prevRoundInSeason, nextSeason, path });
    }
    this.lastVoidSwallow = { count: voidCards.length, totalK, maxK, swallowed: swallowedCount };
    // 空亡吞噬批次结束后统一刷新波动状态（V5/V6 均有 conflict_banded 波动；
    // 空亡路径的波动刷新时机与 branchRoll 重掷的相对顺序与普通换季不同，
    // 但两端走同一引擎代码路径，重放确定性不受影响——reviewer P3-3 注释修正 2026-08-16）。
    this.refreshScoreVolatility();

    // 2. 结算落点 = 跳跃后的季节（持仓结算、反噬/强平照常判定）。
    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.season = this.seasonCycle.getCurrentSeason();
    }
    this.settleHoldings();

    // 3. 锁定费结算：
    // - V8+ 规则已在 processRound 开头扣除锁定费并处理回堆，此处跳过；
    // - V7 及更早规则在空亡分支未经历 processRound 锁定费结算，需在此处保留原有时序结算锁定费（保持历史对局重放一致性）。
    if (this.rulesVersion < RULES_VERSION_CLEAN_POOL) {
      const autoUnlockedIds = this.lockManager.settleLockCost(this.seasonCycle.getCurrentSeason(), false);
      if (autoUnlockedIds.length > 0) {
        this.onLockAutoUnlocked?.(autoUnlockedIds);
      }
    }

    // 4. 仅自然回复 +10，无调息加成（该回合玩家不可行动）。
    this.recoverQi(false);

    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.finalQi = this.qiManager.getQi();
      this.lastSettlementDetail.finalScore = this.scoreManager.getScore();
    }

    // 5. 归档本回合（action = 上一回合的行动；空亡回合本身无玩家行动）。
    this.roundLog.push(this.buildRoundLogEntry());
    this.capturePublicCardHistorySnapshot();

    // 6. 触发当回合结束后牌回牌堆：空亡回合无玩家行动，公共区未锁定牌需显式回堆，
    //    否则下回合 drawCards 会把它们静默丢弃（deck 流失——"公共池缩水"同源 bug）。
    const { unlocked } = this.lockManager.partitionLocked(this.cardPoolManager.getPublicCards());
    this.cardPoolManager.returnCards(unlocked);

    // 7. 该回合玩家不可行动：直接推进游戏回合（不回调玩家行动、不应用等待加成）。
    this.lastAction = null;
    this.advanceAfterVoid();
  }

  /**
   * 吞噬回合的推进：游戏回合只走 1，季节时钟已在 processVoidRound 中跳跃 K。
   * void_round → player_action（或 game_over）的状态恢复由 processRound / endGame
   * 完成（processRound 结算完毕置 player_action；终局分支置 game_over）。
   * 第 60 回合被吞噬时直接终局（空亡回合已在归档时完成记录，跳过终局归档避免重复）。
   */
  private advanceAfterVoid(): void {
    this.currentRound++;
    if (this.currentRound > TurnManager.TOTAL_ROUNDS) {
      this.endGame();
      return;
    }
    this.processRound();
  }

  /**
   * 归档本回合记录（roundLog 数据留存）。
   *
   * ⚠️ 必须在 lastSettlementDetail.finalQi/finalScore 赋值之后调用。
   * 行动层字段全部来自"已发生事实"（lastAction + 引擎结算），不含任何预测数据。
   */
  private buildRoundLogEntry(): RoundLogEntry {
    const season = this.seasonCycle.getCurrentSeason();
    const roundInSeason = this.seasonCycle.getCurrentRoundInSeason();
    const action = this.lastAction;
    const settlement = this.lastSettlementDetail!;
    const actionRound = action && this.lastActionRound !== null ? this.lastActionRound : null;

    // 从结算明细重建行动层信息：
    // - buy/sell 涉及的卡牌名：结算明细的 holdItems 里存的是"该回合持仓结算"的卡，
    //   不等于"行动买卖的卡"。买卖的卡要额外记录，但 lastSettlementDetail 不存行动卡。
    //   看板逐回合展示"本回合操作了什么"，需要从执行路径补录——见 executeBuy/Sell/Wait 的
    //   lastActionCard 字段（2026-08-06 新增，随行动同步更新）。
    let actionCardName: string | null = null;
    let actionCardScore: number | null = null;
    let buyScore: number | null = null;
    let sellScore: number | null = null;
    let actionQiChange = 0;

    if (action === 'buy' && this.lastActionCard) {
      actionCardName = this.lastActionCard.card.name;
      actionCardScore = this.lastActionCard.buyScore;
      buyScore = this.lastActionCard.buyScore; // 买入时评分即买价（价差基准）
      actionQiChange = -this.lastActionCard.buyCost; // 纳灵耗神识（负值）
    } else if (action === 'sell' && this.lastActionCard) {
      actionCardName = this.lastActionCard.card.name;
      actionCardScore = this.lastActionCard.currentScore;
      buyScore = this.lastActionCard.buyScore;
      sellScore = this.lastActionCard.sellScore;
      actionQiChange = this.lastActionCard.qiReturn; // 归还锁气（正值）
    }

    // 空亡吞噬回合标记：processVoidRound 置入、消费后清空。
    // 非空亡回合恒为 null → 用 ?? undefined 使 V1-V4 存档不写本字段（快照协议不变形）。
    const voidSwallow = this.lastVoidSwallow;
    this.lastVoidSwallow = null;

    return {
      round: this.currentRound,
      actionRound,
      season,
      roundInSeason,
      action,
      actionCardName,
      actionCardScore,
      buyScore,
      sellScore,
      actionQiChange,
      ...(voidSwallow ? { voidSwallow } : {}),
      // 本回合抽牌后的公共牌池快照（buildRoundLogEntry 在 drawCards 之后调用，
      // getPublicCards() 即玩家本回合看到的候选牌，含锁定保留牌）
      publicCards: this.cardPoolManager.getPublicCards().map((card) => ({
        id: card.id,
        name: card.name,
        mainElement: card.mainElement,
        yinYang: card.yinYang,
      })),
      settlement,
      scoreAfter: this.scoreManager.getScore(),
      qiAfter: this.qiManager.getQi(),
    };
  }

  /** 捕获当前回合的公共牌历史事实快照（60 张普通甲子牌，按 ID 顺序）。 */
  private capturePublicCardHistorySnapshot(): void {
    const scores = this.cardDataBank
      .getAllCards()
      .filter((card) => !isVoidCard(card))
      .sort((a, b) => a.id - b.id)
      .map((card) => {
        const score = this.getCardScore(card, this.seasonCycle.getCurrentSeason());
        return Object.is(score, -0) ? 0 : score;
      });
    const snapshot = {
      round: this.currentRound,
      scores,
    };
    const existingIndex = this.publicCardHistory.findIndex((entry) => entry.round === this.currentRound);
    if (existingIndex >= 0) {
      this.publicCardHistory[existingIndex] = snapshot;
    } else {
      this.publicCardHistory.push(snapshot);
      this.publicCardHistory.sort((a, b) => a.round - b.round);
    }
  }

  /** 获取整局公共牌历史快照，只读。 */
  getPublicCardHistory(): readonly PublicCardHistorySnapshot[] {
    return this.publicCardHistory;
  }

  /** 获取指定卡牌的逐回合历史评分（若无则返回空数组）。 */
  getPublicCardHistoryForCard(cardId: number): { round: number; score: number }[] {
    const index = cardId - 1;
    if (index < 0) return [];
    return this.publicCardHistory.flatMap((entry) => {
      const score = entry.scores[index];
      if (typeof score !== 'number' || !Number.isFinite(score)) return [];
      return [{
        round: entry.round,
        score,
      }];
    });
  }

  /**
   * 计算丹田位中与指定卡牌同 mainElement 的卡牌数（含自身）。
   * 仅计数丹田位（hand slots），不含锁定牌或牌堆。
   */
  private getElementConcentration(card: JiaziCard): number {
    const hand = this.handManager.getHand();
    let count = 0;
    for (const slot of hand) {
      if (slot && slot.card.mainElement === card.mainElement) {
        count++;
      }
    }
    return count;
  }

  /**
   * 某张丹田位卡的浓度信息（UI 展示用）：count = 同 mainElement 丹田位持有数，
   * premium = 该卡当前浓度溢价（仅 V7 生效，V6 及以下恒 0）。
   */
  getConcentrationInfo(card: JiaziCard): { count: number; premium: number } {
    const count = this.getElementConcentration(card);
    const premium = this.getConcentrationPremiumFactor() * Math.max(0, count - 1);
    return { count, premium };
  }

  /**
   * 执行对玩家手牌中持仓卡牌的阶段结算（加分并扣神识，进行爆仓检查）
   */
  private settleHoldings(): void {
    const hand = this.handManager.getHand();
    const currentSeason = this.seasonCycle.getCurrentSeason();
    const activeSlots = hand.filter((slot): slot is HandSlot => slot !== null);
    // 杠杆持仓：每回合结算时取当前季内回合的实际倍数（换季从 1.0x 重置）。
    const currentLeverage = this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason());
    const concentrationPremiumFactor = this.getConcentrationPremiumFactor();
    const holdingSettlement = calculateHoldingSettlement(
      activeSlots.map((slot) => ({
        cardName: slot.card.name,
        cardScore: this.getCardScore(slot.card, currentSeason),
        useLeverage: slot.useLeverage,
        isEarth: slot.card.tianGanElement === Element.EARTH,
        concentrationCount: this.getElementConcentration(slot.card),
        concentrationPremiumFactor,
      })),
      currentLeverage,
      {
        calculateHoldEarnings: (cardScore, leverage) => this.scoreManager.calculateHoldEarnings(cardScore, leverage),
        calculateHoldQiCost: (cardScore, leverage, isEarth, concentrationCount, concentrationPremiumFactor) =>
          this.leverageCalculator.calculateHoldQiCost(cardScore, leverage, isEarth, concentrationCount, concentrationPremiumFactor),
      },
    );

    holdingSettlement.items.forEach((item, index) => {
      const slot = activeSlots[index]!;
      this.scoreManager.addHoldEarnings(item.earning);
      slot.holdEarnings += item.earning;
      this.lastSettlementDetail?.holdItems.push(item);
    });

    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.holdEarnings = holdingSettlement.holdEarnings;
      this.lastSettlementDetail.holdQiCost = holdingSettlement.holdQiCost;
    }

    // 强制扣除全部持仓耗神（支持扣成负数或0）
    if (holdingSettlement.holdQiCost > 0) {
      this.qiManager.deductQi(holdingSettlement.holdQiCost);
    }

    // 结算完成后进行爆仓判定
    if (this.leverageCalculator.checkMarginCall(this.qiManager.getQi())) {
      const details = this.marginCallEngine.execute();
      if (this.lastSettlementDetail && details.length > 0) {
        this.lastSettlementDetail.marginCallTriggered = true;
        this.lastSettlementDetail.marginCallDetails = details;
      }
    }
  }


  /**
   * 自然回复玩家的神识，若上回合选择等待则提供额外奖励。
   * @param applyWaitBonus 是否应用等待加成；V5 空亡吞噬回合传 false（该回合玩家
   *   不可行动，仅自然回复 +10，无调息 +10 加成——mechanics.md §9）。
   */
  private recoverQi(applyWaitBonus: boolean = true): void {
    const totalLocked = this.getTotalLockedQi();
    const baseRecovery = this.qiManager.getBaseRecovery();
    this.qiManager.recover(baseRecovery, totalLocked);
    if (this.lastSettlementDetail) {
      this.lastSettlementDetail.baseQiRecover = baseRecovery;
    }

    if (applyWaitBonus && this.lastAction === 'wait') {
      const waitBonus = this.qiManager.getWaitBonus();
      this.qiManager.recover(waitBonus, totalLocked);
      if (this.lastSettlementDetail) {
        this.lastSettlementDetail.waitQiRecover = waitBonus;
      }
    }
  }

  /**
   * 执行买入操作
   * @param cardIndex 刷新卡牌池的索引
   * @param leverage 是否加上倍数杠杆
   * @returns 操作是否成功
   */
  executeBuy(cardIndex: number, leverage: boolean): boolean {
    if (this.state !== 'player_action') return false;

    // 最后一回合禁止买入：买入后会推进到第 61 回合直接结束，
    // 所买卡牌没有下一回合结算、也没有锁定气返还，是纯损失操作。
    if (this.currentRound >= TurnManager.TOTAL_ROUNDS) {
      console.log('[TurnManager] 最后一回合无法买入');
      return false;
    }

    const card = this.cardPoolManager.getPublicCards()[cardIndex];
    if (!card) return false;

    // V5 空亡牌是纯事件牌，不可买入（mechanics.md §9）。
    if (isVoidCard(card)) {
      console.log('[TurnManager] 空亡牌不可买入');
      return false;
    }

    // 检查手牌是否已满
    if (!this.handManager.canBuy()) {
      console.log('[TurnManager] 手牌已满');
      return false;
    }

    // 计算买入消耗
    const buyCost = this.qiManager.calculateBuyCost(
      this.getCardScore(card, this.seasonCycle.getCurrentSeason()),
      leverage
    );

    // 检查神识是否足够
    if (!this.qiManager.canAfford(buyCost)) {
      console.log('[TurnManager] 神识不足');
      return false;
    }

    // 执行买入
    this.qiManager.spend(buyCost);
    this.totalBuys++;
    if (leverage) {
      this.totalLeverageBuys++;
    }
    const buyScore = this.getCardScore(card, this.seasonCycle.getCurrentSeason());
    const lockedQi = buyCost - this.qiManager.getBuyEntryFee();
      const initialLeverage = leverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
    const slotIndex = this.handManager.buy(
      card,
      buyScore,
      leverage,
      initialLeverage,
      this.currentRound,
      lockedQi
    );

    if (slotIndex === -1) return false;

    // 买的是锁定牌则自动解锁（牌已入手，不再占用公共位）
    this.lockManager.onCardBought(card.id);

    // 记录本回合行动的卡牌信息（回合数据留存：buildRoundLogEntry 归档用）
    this.lastActionCard = {
      card,
      buyScore,
      currentScore: buyScore,
      sellScore: 0,
      buyCost,
      qiReturn: 0,
    };

    // 未选的牌回牌堆（锁定中的牌保留）。
    // 注意：filter 回调第二个参数才是当前元素，必须用元素自身的 id 判断是否锁定，
    // 不能用外层闭包变量 `card.id`（那是要买的牌，不是当前元素）——
    // 否则当买的是非锁定牌时，`!isCardLocked(card.id)` 永远为 true，
    // 会把所有锁定的牌错误地回牌堆，导致 deck 与 publicCards 同时持有同一张锁定牌的引用，
    // 下一次 drawCards 可能从 deck 抽到这张牌的副本，使 publicCards 出现「两张同 id 锁定牌」（用户截图里的 bug）。
    //
    // 2026-08-07 修复「影子牌」：买入的牌必须立即从公共区移除（否则它残留在数组里，
    // 若下一回合调息 executeWait 把公共区未锁定牌回堆，残留的已买入牌会被一起回堆，
    // deck 出现副本，drawCards 再次抽到 → 公共区重现该牌——用户实测公共区 4 张、5 张且重复乙卯无法选中）。
    // 移除方式：非锁定牌位置置空（undefined 占位），锁定牌**保持原索引**（splice 会让锁定牌位置
    // 前移，破坏 lock-position-drift 修复）；drawCards 在下回合重建时跳过空位。
    const publicCards = this.cardPoolManager.getPublicCards();
    const unlockedToReturn: JiaziCard[] = [];
    for (let i = 0; i < publicCards.length; i++) {
      const c = publicCards[i];
      if (i === cardIndex) { publicCards[i] = undefined!; continue; } // 买入的：占位空
      if (this.lockManager.isCardLocked(c.id)) continue;              // 锁定牌：原位保留
      publicCards[i] = undefined!;                                     // 未选非锁：占位空 + 回堆
      unlockedToReturn.push(c);
    }
    if (unlockedToReturn.length > 0) this.cardPoolManager.returnCards(unlockedToReturn);

    this.lastActionRound = this.currentRound;
    this.lastAction = 'buy';
    this.recordDecision('buy');
    this.advanceTurn();
    return true;
  }

  /**
   * 执行卖出操作
   * @param slotIndex 手牌插槽索引
   * @returns 操作是否成功
   */
  executeSell(slotIndex: number): boolean {
    if (this.state !== 'player_action') return false;

    const slot = this.handManager.getSlot(slotIndex);
    if (!slot) return false;

    const currentScore = this.getCardScore(slot.card, this.seasonCycle.getCurrentSeason());
    const effectiveLeverage =
      slot.useLeverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
    const sellScore = this.scoreManager.calculateSellScore(
      currentScore,
      slot.buyScore,
      effectiveLeverage
    );

    // 移除卡牌以释放对应的锁定气额，并将卡牌回洗入牌池
    const soldSlot = this.handManager.sell(slotIndex);
    if (soldSlot) {
      this.cardPoolManager.returnCards([soldSlot.card]);
    }
    const newTotalLocked = this.getTotalLockedQi();

    // 归还全部锁定气（lockedQi 是从总神识里扣掉的子集，卖牌时退回）
    if (soldSlot) {
      this.qiManager.recover(soldSlot.lockedQi);
    }

    this.totalSells++;
    this.scoreManager.addSellEarnings(sellScore);

    // 记录本回合行动的卡牌信息（回合数据留存：buildRoundLogEntry 归档用）
    if (soldSlot) {
      this.lastActionCard = {
        card: soldSlot.card,
        buyScore: soldSlot.buyScore,
        currentScore,
        sellScore,
        buyCost: 0,
        qiReturn: soldSlot.lockedQi,
      };
    }

    this.lastActionRound = this.currentRound;
    this.lastAction = 'sell';
    this.recordDecision('sell');
    // 卖出后公共牌回牌堆（锁定中的牌保留在公共区）。
    // 2026-08-08 修复「公共池缩水」：此前 executeSell 不回堆公共池的未锁定牌，
    // 残留的旧牌会在下一回合 drawCards 重建时被直接丢弃（drawCards 只保留锁定牌+新抽牌），
    // 导致牌总量每卖一次永久 -3，deck 越玩越少，最终公共池抽不满 3 张只剩 2 张
    // （用户实测：反噬/连续卖出后公共池 2 张）。与 executeWait 对齐：未锁定牌回堆。
    const publicCards = this.cardPoolManager.getPublicCards();
    const { unlocked } = this.lockManager.partitionLocked(publicCards);
    this.cardPoolManager.returnCards(unlocked);
    this.advanceTurn();
    return true;
  }

  /**
   * 执行等待动作（本回合弃牌，无消耗且下回合额外回复神识）
   * @returns 操作是否成功
   */
  executeWait(): boolean {
    if (this.state !== 'player_action') return false;

    // 公共牌回牌堆（锁定中的牌保留在公共区）
    const publicCards = this.cardPoolManager.getPublicCards();
    const { unlocked } = this.lockManager.partitionLocked(publicCards);
    this.cardPoolManager.returnCards(unlocked);

    this.lastActionRound = this.currentRound;
    this.lastAction = 'wait';
    this.recordDecision('wait');
    this.totalWaits++;
    // 等待无卡牌行动：清空行动卡快照（buildRoundLogEntry 归档时 actionCardName 为 null）
    this.lastActionCard = null;
    this.advanceTurn();
    return true;
  }

  /**
   * 锁定一张公共牌：占公共位。
   * 锁定费不在本动作扣——在回合结束统一结算（settleLockCost，按当回合锁定张数 × LOCK_COST）。
   * 因此同一回合内锁定再解锁不产生任何费用。
   * 上限 = MAX_LOCKED_CARDS（锁满则公共位全占，每回合 0 张新牌，游戏僵死）。
   * @param cardIndex 公共牌索引
   * @returns 是否锁定成功
   */
  executeLockCard(cardIndex: number): LockResult {
    if (this.state !== 'player_action') return { ok: false, reason: 'no_card' };
    const result = this.lockManager.tryLock(
      this.cardPoolManager.getPublicCards(),
      cardIndex,
      this.qiManager.getQi(),
    );
    if (result.ok) {
      this.lastAction = 'lock';
      this.totalLocks++;
      this.recordDecision('lock');
    }
    return result;
  }

  /**
   * 解锁一张公共牌：牌回牌堆。
   * 本动作不扣神识也不退神识（锁定费只在回合结束结算，锁→解锁无费用）。
   * @param cardIndex 公共牌索引
   * @returns 是否解锁成功
   */
  executeUnlockCard(cardIndex: number): boolean {
    if (this.state !== 'player_action') return false;
    const ok = this.lockManager.tryUnlock(
      this.cardPoolManager.getPublicCards(),
      cardIndex,
      this.rulesVersion >= RULES_VERSION_CLEAN_POOL,
    );
    if (ok) {
      this.lastAction = 'unlock';
      this.recordDecision('unlock');
    }
    return ok;
  }

  /** 获取当前锁定的公共牌 ID 列表 */
  getLockedCardIds(): number[] {
    return this.lockManager.getLockedCardIds();
  }

  /** 判断一张公共牌是否处于锁定状态 */
  isCardLocked(cardId: number): boolean {
    return this.lockManager.isCardLocked(cardId);
  }

  /**
   * 推进游戏回合以及季节流转
   */
  private advanceTurn(): void {
    this.currentRound++;

    // 游戏已到终局：直接结束，不再推进季节循环。
    // 否则最后一回合恰逢季末时，终局推进会连带换季，前端 diff 会把这次
    // "换季"误判为真正的季节切换，在游戏结束画面误播季节转换动画。
    if (this.currentRound > TurnManager.TOTAL_ROUNDS) {
      this.processRound();
      return;
    }

    // 季节检查
    const seasonChanged = this.seasonCycle.advance();
    if (seasonChanged) {
      this.refreshScoreVolatility();
      // V6 换季重掷：与 refreshScoreVolatility 同点（V5 及以下恒空转，不消耗随机数）。
      this.refreshBranchRoll();
      console.log(`[TurnManager] 季节切换: ${this.seasonCycle.getCurrentSeason()}`);
    } else if (this.scoreVolatilityState) {
      if (this.isTrendWindowRulesVersion()) {
        // trend_window 模型：每张牌独立递减窗口，到期自动重置
        this.decrementTrendWindowRounds();
      } else {
        // 旧模型：全局 remainingRounds 递减
        this.scoreVolatilityState.remainingRounds--;
        if (this.scoreVolatilityState.remainingRounds <= 0) {
          this.refreshScoreVolatility();
        }
      }
    }

    // 处理下一回合
    this.processRound();
  }

  /**
   * 终局强制平仓：游戏结束时（第 60 回合结算后）对所有仍未卖出的持仓
   * 按正常卖出公式（当前季评分 vs 买入评分 + 当前动态杠杆）强制结算。
   *
   * 设计决策（2026-08-07 用户确认）：
   * - 结算价格 = 复用 executeSell 的 sellScore 公式，规则一致——强牌可能赚、垃圾牌可能亏
   * - 收益计入修为（scoreManager.addSettleEarnings），独立统计口径 totalSettleEarnings
   * - **不计入** totalSells（释灵次数）、**不写** decisionLog——系统行为非玩家主动行为，行为画像纯净
   * - roundLog 每条出清卡追加一条 action='settle' 记录，看板以「出清」徽章区分
   */
  private settleEndgameHoldings(): void {
    const hand = this.handManager.getHand();
    const currentSeason = this.seasonCycle.getCurrentSeason();
    const currentLeverage = this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason());

    for (let i = 0; i < hand.length; i++) {
      const slot = hand[i];
      if (!slot) continue;

      const currentScore = this.getCardScore(slot.card, currentSeason);
      const effectiveLeverage = slot.useLeverage ? currentLeverage : 1;
      const settleScore = this.scoreManager.calculateSellScore(currentScore, slot.buyScore, effectiveLeverage);

      // 收益计入修为（独立口径，不入 totalSellEarnings / totalSells）
      this.scoreManager.addSettleEarnings(settleScore);

      // 卡回洗入牌池 + 归还锁定气 + 清空槽位（终局后无后续玩法，但保持状态一致）
      this.cardPoolManager.returnCards([slot.card]);
      this.qiManager.recover(slot.lockedQi);
      this.handManager.sell(i);

      // 归档一条「出清」回合记录（round = 终局回合 61，供行迹看板展示）
      this.roundLog.push({
        round: this.currentRound,
        actionRound: this.currentRound - 1,
        season: currentSeason,
        roundInSeason: this.seasonCycle.getCurrentRoundInSeason(),
        action: 'settle',
        actionCardName: slot.card.name,
        actionCardScore: currentScore,
        buyScore: slot.buyScore,
        sellScore: settleScore,
        actionQiChange: 0,
        publicCards: [],
        settlement: {
          round: this.currentRound,
          season: currentSeason,
          holdEarnings: 0,
          holdQiCost: 0,
          holdItems: [],
          baseQiRecover: 0,
          waitQiRecover: 0,
          marginCallTriggered: false,
          marginCallDetails: [],
          finalQi: this.qiManager.getQi(),
          finalScore: this.scoreManager.getScore(),
        },
        scoreAfter: this.scoreManager.getScore(),
        qiAfter: this.qiManager.getQi(),
      });
    }
  }

  /**
   * 结束当前游戏并触发结算
   */
  private endGame(): void {
    // 终局强制平仓：所有未卖出持仓统一结算（用户设计决策 2026-08-07）
    this.settleEndgameHoldings();

    // 终局回收所有公共区剩余锁定牌至牌堆，并清空公共展示区，保证全牌组完整归还牌堆
    const remainingLocked = this.cardPoolManager.getPublicCards().filter((c) => c && this.lockManager.isCardLocked(c.id));
    if (remainingLocked.length > 0) {
      this.cardPoolManager.returnCards(remainingLocked);
    }
    this.lockManager.reset();
    this.cardPoolManager.loadState(this.cardPoolManager.getDeck(), []);

    this.state = 'game_over';
    this.onStateChange?.('game_over');
    this.onGameEnd?.(this.scoreManager.getScore());

    console.log(`[TurnManager] 游戏结束，最终得分: ${this.scoreManager.getScore()}`);
  }

  /**
   * 导出当前游戏状态为可序列化快照。
   * GameSaveService 负责序列化与 LocalStorage 持久化。
   */
  exportSnapshot(): GameSnapshot {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      // 写时归属：该档自声明当前生效规则（读档后 = 存档声明；新局 = 构造默认）。
      // 阶段 1 产品默认路径只能产出 RULES_BASE；波动规则档仅显式实验模式可达。
      rulesVersion: this.rulesVersion,
      currentRound: this.currentRound,
      state: this.state,
      lastAction: this.lastAction,
      qi: this.qiManager.getQi(),
      score: this.scoreManager.getScore(),
      totalHoldEarnings: this.scoreManager.getTotalHoldEarnings(),
      totalSellEarnings: this.scoreManager.getTotalSellEarnings(),
      totalMarginCallPenalty: this.scoreManager.getTotalMarginCallPenalty(),
      totalSettleEarnings: this.scoreManager.getTotalSettleEarnings(),
      totalBuys: this.totalBuys,
      totalSells: this.totalSells,
      totalWaits: this.totalWaits,
      totalLeverageBuys: this.totalLeverageBuys,
      season: {
        index: this.seasonCycle.getCurrentSeasonIndex(),
        roundInSeason: this.seasonCycle.getCurrentRoundInSeason(),
        lengths: this.seasonCycle.getSeasonLengths()
      },
      hand: this.handManager.getHand().map(slot => slot ? {
        cardId: slot.card.id,
        buyScore: slot.buyScore,
        useLeverage: slot.useLeverage,
        leverage: slot.leverage,
        buyRound: slot.buyRound,
        lockedQi: slot.lockedQi,
        holdEarnings: slot.holdEarnings
      } : null),
      pool: {
        deckIds: this.cardPoolManager.getDeck().map(c => c.id),
        publicIds: this.cardPoolManager.getPublicCards().map(c => c.id)
      },
      lockedCardIds: this.lockManager.getLockedCardIds(),
      roundLog: this.roundLog,
      publicCardHistory: this.publicCardHistory.map((entry) => ({
        round: entry.round,
        scores: [...entry.scores],
      })),
      scoreVolatility: this.getScoreVolatilityState() ?? undefined,
      scoreRules: isTradeRulesVersion(this.rulesVersion)
        ? this.scoreManager.getRules()
        : undefined,
      // V6 地支波动状态：仅 rulesVersion=6 时写入；V5 及以下为 undefined（协议不变形）。
      branchRoll: this.getBranchRollState() ?? undefined,
      voidCardCount: this.voidCardCount,
    };
  }

  /**
   * 从已校验的快照还原游戏内部状态。
   * GameSaveService 已完成格式与坏档校验，本方法只负责状态还原。
   */
  importSnapshot(data: GameSnapshot): void {
    // 0. 规则版本门控（在改动任何引擎状态之前）：不支持的规则版本（既不是
    //    RULES_BASE、RULES_VERSION_VOLATILE 也不是 RULES_VERSION_TRADE）必须在此明确失败，绝不静默
    //    按 base 继续——否则未来规则存档会被当前代码按错误规则运行且写回归档，
    //    读档失败时引擎保持原状（GameSaveService.load 已先挡一道并保留存档）。
    //    缺 rulesVersion 的旧档显式归属 base 规则（兼容路径，见下）。
    const declaredRules = data.rulesVersion ?? RULES_BASE;
    if (!isSupportedRulesVersion(declaredRules)) {
      throw new Error(
        `不支持的规则版本 rulesVersion=${data.rulesVersion}，拒绝读档`,
      );
    }
    const isVolatileRules = declaredRules === RULES_VERSION_VOLATILE || isTradeRulesVersion(declaredRules);
    // 波动模型门控（在任何状态改动之前）：volatile 档携带未知波动模型必须明确
    // 拒绝，绝不静默按 uniform 继续——否则未来模型存档会被当前代码按错误模型
    // 运行且写回归档。模型缺省（旧格式）不算未知，按 uniform 解释。
    const declaredModel = data.scoreVolatility?.model;
    if (
      isVolatileRules &&
      data.scoreVolatility &&
      declaredModel !== undefined &&
      !isSupportedVolatilityModel(declaredModel)
    ) {
      throw new Error(
        `不支持的波动模型 model=${declaredModel}（只支持 uniform / conflict_banded），拒绝读档`,
      );
    }
    if (
      isVolatileRules &&
      !data.scoreVolatility
    ) {
      throw new Error(`rulesVersion=${declaredRules} 存档缺少 scoreVolatility，拒绝读档`);
    }
     // 波动快照完整校验（在任何状态改动之前）：波动规则档的 scoreVolatility
    // 必须字段齐全且数值合法，任何一项不合格都明确拒绝，绝不带病还原。
    // 仅对 volatile 规则档生效；base 规则（rulesVersion=1 / 缺省旧档）不还原
    // scoreVolatility，故不校验（保持既有行为）。
    if (isVolatileRules) {
      // 缺省分支已在上方门控拒绝：此处 scoreVolatility 保证非空。
      this.validateVolatileScoreVolatility(data.scoreVolatility!, isTradeRulesVersion(declaredRules));
    }
    if (isTradeRulesVersion(declaredRules)) {
      this.validateScoreRules(data.scoreRules);
    }
    // V6 地支波动门控（在任何状态改动之前）：rulesVersion=6 档必须携带完整合法的
    // branchRoll 快照，否则明确拒绝——缺失/非法会让读档后的评分注入漂移。
    // 非 6 版本忽略该字段（V5 及以下路径逐字节不变）。
    if (declaredRules >= RULES_VERSION_BRANCH_ROLL && !data.branchRoll) {
      throw new Error(`rulesVersion=${declaredRules} 存档缺少 branchRoll，拒绝读档`);
    }
    if (declaredRules >= RULES_VERSION_BRANCH_ROLL && !isValidBranchRollState(data.branchRoll)) {
      throw new Error(`rulesVersion=${declaredRules} 存档的 branchRoll 快照非法，拒绝读档`);
    }
    if (data.voidCardCount !== undefined) {
      if (
        typeof data.voidCardCount !== 'number' ||
        !Number.isSafeInteger(data.voidCardCount) ||
        data.voidCardCount < 0 ||
        data.voidCardCount > TurnManager.VOID_CARD_COUNT_MAX
      ) {
        throw new Error(`存档 voidCardCount 非法: ${data.voidCardCount}，拒绝读档`);
      }
    }
    this.rulesVersion = declaredRules;
    const declaredVoidCardCount = data.voidCardCount !== undefined
      ? data.voidCardCount
      : (declaredRules >= RULES_VERSION_VOID ? 3 : 0);
    this.voidCardCount = declaredVoidCardCount;
    this.cardDataBank.setVoidCardCount(this.voidCardCount);

    // V5+ 空亡规则：SeasonCycle 懒生成模式跟随存档声明（base 构造读 V5+ 档也要懒生成）。
    this.seasonCycle.setLazy(declaredRules >= RULES_VERSION_VOID);
    this.scoreManager.setRules(
      isTradeRulesVersion(declaredRules) ? data.scoreRules! : DEFAULT_SCORE_RULES,
    );

    // 1. 还原基础状态
    this.currentRound = data.currentRound;
    this.state = data.state as GameState;
    this.lastAction = data.lastAction as ActionType | null;
    this.lastActionRound = data.lastAction && data.currentRound > 1
      ? data.currentRound - 1
      : null;

    // 2. 还原积分
    this.scoreManager.setScore(
      data.score,
      data.totalHoldEarnings,
      data.totalSellEarnings,
      data.totalMarginCallPenalty ?? 0,
      data.totalSettleEarnings ?? 0,
    );

    // 还原统计数据
    this.totalBuys = data.totalBuys !== undefined ? data.totalBuys : 0;
    this.totalSells = data.totalSells !== undefined ? data.totalSells : 0;
    this.totalWaits = data.totalWaits !== undefined ? data.totalWaits : 0;
    this.totalLeverageBuys = data.totalLeverageBuys !== undefined ? data.totalLeverageBuys : 0;

    // 3. 还原季节周期
    this.seasonCycle.loadState(data.season.index, data.season.roundInSeason, data.season.lengths);

     // 3.5 波动还原门控以存档声明的规则版本为准（read 时归属）：
     //     - 当前已知波动规则且存档含 scoreVolatility → 还原；
    //     - 其余一律不还原、不启用波动——base 规则（含缺省旧档）不还原，未知的未来
    //       规则版本（如 3/99）也不被误当成波动（规则版本只精确识别已知语义，不做
    //       >= 推断），并把构造期可能已创建的波动状态显式置 null，避免换季时
     //       refreshScoreVolatility 按构造开关静默重启
     //       （"不能只把波动 state 设 null 后又在换季时自动重新启用"）。
     //     产品默认路径仍是 base；显式实验路径与测试夹具可声明 v2/v3，
     //     并由 tests/unit/score_volatility_save.test.ts 验证 round-trip。
    if (this.isVolatilityRulesVersion() && data.scoreVolatility) {
      const savedModel = data.scoreVolatility.model ?? 'uniform';
      this.activeVolatilityConfig = {
        ...this.scoreVolatilityConfig,
        enabled: true,
        model: savedModel,
        scale: data.scoreVolatility.scale ?? this.scoreVolatilityConfig.scale,
        bandFactors: data.scoreVolatility.bandFactors ?? this.scoreVolatilityConfig.bandFactors,
      };
      this.scoreVolatilityState = {
        remainingRounds: data.scoreVolatility.remainingRounds,
        deltaByDiZhi: { ...data.scoreVolatility.deltaByDiZhi },
        ...(savedModel === 'conflict_banded'
          ? {
            model: 'conflict_banded' as const,
            scale: data.scoreVolatility.scale,
            directionByDiZhi: { ...data.scoreVolatility.directionByDiZhi },
            ...(data.scoreVolatility.bandFactors
              ? { bandFactors: { ...data.scoreVolatility.bandFactors } }
              : {}),
          }
          : {}),
        ...(savedModel === 'trend_window' && data.scoreVolatility.trendWindowByCardId
          ? {
            model: 'trend_window' as const,
            scale: data.scoreVolatility.scale,
            bandFactors: data.scoreVolatility.bandFactors
              ? { ...data.scoreVolatility.bandFactors }
              : undefined,
            trendWindowByCardId: Object.fromEntries(
              Object.entries(data.scoreVolatility.trendWindowByCardId).map(([id, entry]) => [
                Number(id),
                {
                  direction: entry.direction,
                  remainingRounds: entry.remainingRounds,
                  windowLength: entry.windowLength,
                },
              ]),
            ),
          }
          : {}),
      };
    } else {
      this.activeVolatilityConfig = { ...this.scoreVolatilityConfig, enabled: false, model: 'uniform' };
      this.scoreVolatilityState = null;
    }

    // 3.6 地支波动还原：仅 rulesVersion=6 且存档携带合法 branchRoll 时还原；
    //    其余一律置 null——V5 及以下不创建不消耗 roll 随机数，换季/空亡跨季
    //    也不会被 refreshBranchRoll 错误重建（门控按当前生效规则版本）。
    this.branchRollState = declaredRules >= RULES_VERSION_BRANCH_ROLL && isValidBranchRollState(data.branchRoll)
      ? {
          rulesVersion: RULES_VERSION_BRANCH_ROLL,
          rollByDiZhi: { ...data.branchRoll!.rollByDiZhi },
          meanByDiZhi: { ...data.branchRoll!.meanByDiZhi },
        }
      : null;

    // 4. 还原手牌
    const restoredHand = data.hand.map((slotData) => {
      if (!slotData) return null;
      const card = this.cardDataBank.getCard(slotData.cardId);
      if (!card) throw new Error(`找不到 ID 为 ${slotData.cardId} 的卡牌`);
      const lockedQi = slotData.lockedQi !== undefined ? slotData.lockedQi : Math.max(0, this.qiManager.calculateBuyCost(slotData.buyScore, slotData.useLeverage || slotData.leverage > 1) - this.qiManager.getBuyEntryFee());
      const useLeverage = slotData.useLeverage !== undefined ? slotData.useLeverage : slotData.leverage > 1;
      const slot = new HandSlot(card, slotData.buyScore, useLeverage, slotData.leverage, slotData.buyRound, lockedQi);
      slot.holdEarnings = slotData.holdEarnings;
      return slot;
    });
    this.handManager.loadHand(restoredHand);

    // 5. 还原神识值（基于最新手牌计算的 totalLockedQi）
    this.qiManager.setQi(data.qi, this.getTotalLockedQi());

    // 6. 还原公共牌池与牌堆
    const restoredDeck = data.pool.deckIds.map((id: number) => {
      const card = this.cardDataBank.getCard(id);
      if (!card) throw new Error(`找不到 ID 为 ${id} 的卡牌`);
      return card;
    });
    const restoredPublic = data.pool.publicIds.map((id: number) => {
      const card = this.cardDataBank.getCard(id);
      if (!card) throw new Error(`找不到 ID 为 ${id} 的卡牌`);
      return card;
    });
    this.cardPoolManager.loadState(restoredDeck, restoredPublic);

    // 7. 还原锁定状态（兼容旧存档：lockedCardIds 缺失则空）
    this.lockManager.restoreLockedCardIds(data.lockedCardIds ? [...data.lockedCardIds] : []);

    // 8. 还原回合数据留存（兼容旧存档：roundLog 缺失则空——老玩家读旧档不崩，
    //    但看板只能从读档后的回合开始记录，历史回合无法追溯，属可接受的降级）
    this.roundLog = data.roundLog ? [...data.roundLog] : [];
    this.publicCardHistory = data.publicCardHistory
      ? data.publicCardHistory
          .filter((entry) => Number.isInteger(entry.round) && entry.round >= 1 && entry.round <= this.currentRound && Array.isArray(entry.scores))
          .map((entry) => ({ round: entry.round, scores: [...entry.scores] }))
          .sort((a, b) => a.round - b.round)
          .filter((entry, index, entries) => index === entries.length - 1 || entry.round !== entries[index + 1]!.round)
      : [];

    // 8.5 读档降级补录：手牌中缺失 buy 记录（老存档无 roundLog 或记录不全）的卡，
    //    补录近似买入记录。否则行迹聚合会产生"幽灵卡"——有炼化收益但无买入记录的卡
    //    （buys=0），导致「经手卡牌数」虚增、「了结数」虚高（2026-08-07 数据一致性 issue）。
    //    近似字段：season/roundInSeason 用当前值，actionQiChange=0（历史耗神不可考），
    //    publicCards/settlement 用占位——只保证统计口径正确，不伪造历史细节。
    const buyNames = new Set(this.roundLog.filter((e) => e.action === 'buy').map((e) => e.actionCardName));
    for (const slot of restoredHand) {
      if (!slot || buyNames.has(slot.card.name)) continue;
      const season = this.seasonCycle.getCurrentSeason();
      this.roundLog.push({
        round: slot.buyRound,
        compatReconstructed: true,
        season,
        roundInSeason: 1,
        action: 'buy',
        actionCardName: slot.card.name,
        actionCardScore: slot.buyScore,
        buyScore: slot.buyScore,
        sellScore: null,
        actionQiChange: 0,
        publicCards: [],
        settlement: {
          round: slot.buyRound,
          season,
          holdEarnings: 0,
          holdQiCost: 0,
          holdItems: [],
          baseQiRecover: 0,
          waitQiRecover: 0,
          marginCallTriggered: false,
          marginCallDetails: [],
          finalQi: data.qi,
          finalScore: data.score,
        },
        scoreAfter: data.score,
        qiAfter: data.qi,
      });
    }
    // 补录记录 round 可能小于现有记录，统一按回合排序保证看板正序展示
    this.roundLog.sort((a, b) => a.round - b.round);

    const latestHistoryRound = this.publicCardHistory.length > 0
      ? this.publicCardHistory[this.publicCardHistory.length - 1]!.round
      : null;
    if (latestHistoryRound !== this.currentRound) {
      this.capturePublicCardHistorySnapshot();
    }

    // 8.6 空亡观测统计重建（票 P2-1）：voidTriggers/voidSwallowedEvents/voidMaxK 是
    // 纯内存计数、不入快照，但 roundLog 已持久化每回合 voidSwallow。局中存档→续局后
    // 必须从 roundLog 汇总还原，否则 GameOverModal 结算摘要只统计续局后的触发数。
    // 口径与 processVoidRound 实时累计一致：count 求和 = 触发次数、swallowed 求和 =
    // 整季吞掉事件、maxK 取最大 = 最长吞噬 K。旧存档（voidSwallow 无 swallowed 子字段）
    // 按 0 处理（历史数据不完整，可接受降级）。
    let voidTriggers = 0;
    let voidSwallowed = 0;
    let voidMaxK = 0;
    for (const entry of this.roundLog) {
      const vs = entry.voidSwallow;
      if (!vs) continue;
      voidTriggers += vs.count;
      voidSwallowed += vs.swallowed ?? 0;
      if (vs.maxK > voidMaxK) voidMaxK = vs.maxK;
    }
    this.voidTriggers = voidTriggers;
    this.voidSwallowedEvents = voidSwallowed;
    this.voidMaxK = voidMaxK;
  }

  /**
   * 完整校验 volatile 规则档的 scoreVolatility 快照。
   *
   * 必须在改动任何引擎状态之前调用：任何一项不合格都直接抛明确错误，拒绝读档。
   * - scoreVolatility 必须是非 null 对象；
   * - remainingRounds 必须是有限非负整数；
   * - deltaByDiZhi 必须是非 null 对象，且所有值都是有限数字；
   * - conflict_banded 模型还需 scale 有限非负、directionByDiZhi 非 null 对象
   *   且所有值都是 [-1, 1] 内的有限数字（模型缺省按 uniform 处理）。
   * v3 交易规则还要求 conflict_banded 与冻结的 bandFactors；v2 保持旧格式兼容。
   * base 规则（rulesVersion=1 / 缺省旧档）不调用本方法：其 scoreVolatility 不还原。
   */
  private validateVolatileScoreVolatility(vol: ScoreVolatilitySnapshot, requireTradeFields: boolean = false): void {
    if (!isNonNilRecord(vol)) {
      throw new Error('波动规则存档的 scoreVolatility 必须是对象，拒绝读档');
    }

    const { remainingRounds, deltaByDiZhi, model, scale, directionByDiZhi } = vol;

    if (
      typeof remainingRounds !== 'number' ||
      !Number.isInteger(remainingRounds) ||
      remainingRounds < 0
    ) {
      throw new Error(
        `波动规则存档的 scoreVolatility.remainingRounds=${remainingRounds} 必须是有限非负整数，拒绝读档`,
      );
    }

    if (
      !isNonNilRecord(deltaByDiZhi) ||
      !Object.values(deltaByDiZhi).every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new Error('波动规则存档的 scoreVolatility.deltaByDiZhi 必须是值为有限数字的对象，拒绝读档');
    }

    if ((model ?? 'uniform') === 'conflict_banded') {
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0) {
        throw new Error(
          `conflict_banded 存档的 scoreVolatility.scale=${scale} 必须是有限非负数字，拒绝读档`,
        );
      }
      if (
        !isNonNilRecord(directionByDiZhi) ||
        !Object.values(directionByDiZhi).every(
          (v) => typeof v === 'number' && Number.isFinite(v) && v >= -1 && v <= 1,
        )
      ) {
        throw new Error('conflict_banded 存档的 scoreVolatility.directionByDiZhi 必须是值在 [-1, 1] 的有限数字对象，拒绝读档');
      }
      if (requireTradeFields) {
        if (
          !isNonNilRecord(vol.bandFactors) ||
          !['earth', 'stable', 'mixed', 'conflict'].every((band) => {
            const value = vol.bandFactors?.[band as keyof NonNullable<ScoreVolatilitySnapshot['bandFactors']>];
            return typeof value === 'number' && Number.isFinite(value) && value >= 0;
          })
        ) {
          throw new Error('交易规则存档的 scoreVolatility.bandFactors 必须完整且为有限非负数字，拒绝读档');
        }
      }
    } else if ((model ?? 'uniform') === 'trend_window') {
      // trend_window 模型校验：trendWindowByCardId 可选；若存在必须是对象，
      // 每个条目 direction ∈ {-1,0,1}、remainingRounds ≥ 0 整数、windowLength ∈ {2,3,4}
      const { trendWindowByCardId } = vol;
      if (trendWindowByCardId !== undefined) {
        if (!isNonNilRecord(trendWindowByCardId)) {
          throw new Error('trend_window 存档的 scoreVolatility.trendWindowByCardId 必须是对象，拒绝读档');
        }
        for (const [idStr, entry] of Object.entries(trendWindowByCardId)) {
          const id = Number(idStr);
          if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
            throw new Error(`trend_window 存档的 trendWindowByCardId 键 "${idStr}" 非法，拒绝读档`);
          }
          if (!isNonNilRecord(entry)) {
            throw new Error(`trend_window 存档的 trendWindowByCardId[${id}] 必须是对象，拒绝读档`);
          }
          const { direction, remainingRounds: er, windowLength: wl } = entry as Record<string, unknown>;
          if (direction !== -1 && direction !== 0 && direction !== 1) {
            throw new Error(`trend_window 存档的 trendWindowByCardId[${id}].direction=${direction} 必须是 -1|0|1，拒绝读档`);
          }
          if (typeof er !== 'number' || !Number.isInteger(er) || er < 0) {
            throw new Error(`trend_window 存档的 trendWindowByCardId[${id}].remainingRounds=${er} 必须是非负整数，拒绝读档`);
          }
          if (wl !== 2 && wl !== 3 && wl !== 4) {
            throw new Error(`trend_window 存档的 trendWindowByCardId[${id}].windowLength=${wl} 必须是 2|3|4，拒绝读档`);
          }
        }
      }
    } else if (requireTradeFields) {
      throw new Error('交易规则存档必须使用 conflict_banded 波动模型，拒绝读档');
    }
  }

  private validateScoreRules(rules: GameSnapshot['scoreRules']): asserts rules is ScoreRules {
    if (!isNonNilRecord(rules)) {
      throw new Error('交易规则存档缺少 scoreRules，拒绝读档');
    }
    if (
      typeof rules.holdBonus !== 'number' || !Number.isFinite(rules.holdBonus) || rules.holdBonus <= 0 ||
      typeof rules.sellMultiplier !== 'number' || !Number.isFinite(rules.sellMultiplier) || rules.sellMultiplier < 0
    ) {
      throw new Error('交易规则存档的 scoreRules 参数非法，拒绝读档');
    }
  }

  /**
   * 一键保存游戏状态至 LocalStorage（委托给 GameSaveService）
   * @returns 是否保存成功
   */
  saveGame(): boolean {
    return this.saveService.save(() => this.exportSnapshot());
  }

  /**
   * 从 LocalStorage 一键读取还原存档（委托给 GameSaveService）
   * @returns 是否读档成功
   */
  loadGame(): boolean {
    return this.saveService.load(
      (data) => this.importSnapshot(data),
      () => {
        // 成功读档后手动触发一次状态广播，让 UI 自动绘制更新
        this.onStateChange?.(this.state);
        this.onTurnStart?.(this.currentRound);
      },
    );
  }

  /**
   * 最近一次 loadGame 失败的分类原因（成功 / 尚无失败时为 null）。
   * 供 UI 区分「存档版本过新（提示更新游戏）」与一般读档失败，避免无条件弹「继续游戏」。
   */
  getLastLoadError(): GameSaveLoadError | null {
    return this.saveService.getLastLoadError();
  }

  /**
   * 检查 LocalStorage 中是否已存在有游戏存档（委托给 GameSaveService）
   * @returns 是否有存档
   */
  hasSave(): boolean {
    return this.saveService.hasSave();
  }

  /**
   * 清除已有的存档（委托给 GameSaveService）
   */
  clearSave(): void {
    this.saveService.clear();
  }

  /** 设置状态变化回调 */
  setOnStateChange(callback: (state: GameState) => void): void {
    this.onStateChange = callback;
  }

  /** 设置回合开始回调 */
  setOnTurnStart(callback: (round: number) => void): void {
    this.onTurnStart = callback;
  }

  /** 设置游戏结束回调 */
  setOnGameEnd(callback: (finalScore: number) => void): void {
    this.onGameEnd = callback;
  }

  /** 设置锁定牌被自动解锁回调（付不起锁定费时回合末触发），携带被解锁的牌 ID 列表 */
  setOnLockAutoUnlocked(callback: (cardIds: number[]) => void): void {
    this.onLockAutoUnlocked = callback;
  }

  /** 设置 V5 空亡触发回调：每张空亡牌掷 K 后调用一次（供 UI Toast / 批 2 动画） */
  setOnVoidTrigger(callback: (info: VoidTriggerInfo) => void): void {
    this.onVoidTrigger = callback;
  }

  /** 按 ID 获取卡牌（供 UI 解析自动解锁牌的名称等） */
  getCardById(id: number): JiaziCard | undefined {
    return this.cardDataBank.getCard(id);
  }

  /** 获取当前状态 */
  getState(): GameState {
    return this.state;
  }

  /** 获取当前回合 */
  getCurrentRound(): number {
    return this.currentRound;
  }

  /** 获取当前季节 */
  getCurrentSeason(): Season {
    return this.seasonCycle.getCurrentSeason();
  }

  /** 获取总回合数 */
  getTotalRounds(): number {
    return TurnManager.TOTAL_ROUNDS;
  }

  /** 获取本局使用的空亡牌数量 */
  getVoidCardCount(): number {
    return this.voidCardCount;
  }

  /** 获取当前神识 */
  getQi(): number {
    return this.qiManager.getQi();
  }

  /** 每回合自然回神量 */
  getBaseRecovery(): number {
    return this.qiManager.getBaseRecovery();
  }

  /** 神识上限 */
  getMaxQi(): number {
    return this.qiManager.getMaxQi();
  }

  /** 买入入场手续费 */
  getBuyEntryFee(): number {
    return this.qiManager.getBuyEntryFee();
  }

  /** 等待动作的额外回神奖励 */
  getWaitBonus(): number {
    return this.qiManager.getWaitBonus();
  }

  /** 获取当前分数 */
  getScore(): number {
    return this.scoreManager.getScore();
  }

  /** 获取手牌 */
  getHand(): (HandSlot | null)[] {
    return this.handManager.getHand();
  }

  /** 获取公共牌 */
  getPublicCards(): JiaziCard[] {
    return this.cardPoolManager.getPublicCards();
  }

  /** 获取牌堆大小 */
  getDeckSize(): number {
    return this.cardPoolManager.getDeckSize();
  }

  /** 获取当前季节内已进行的回合数 */
  getCurrentRoundInSeason(): number {
    return this.seasonCycle.getCurrentRoundInSeason();
  }

  /** 获取当前季节的总长度 */
  getCurrentSeasonLength(): number {
    return this.seasonCycle.getCurrentSeasonLength();
  }

  /** 获取当前季内杠杆倍数；换季后从 1.0x 重新开始 */
  getLeverageMultiplier(): number {
    return this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason());
  }

  /** 获取当前回合已经生效的持仓耗神（用于 HUD/卡面，不是等待预览）。 */
  getCurrentHoldQiCost(): number {
    const currentSeason = this.getCurrentSeason();
    const currentLeverage = this.getLeverageMultiplier();
    const concentrationPremiumFactor = this.getConcentrationPremiumFactor();
    return this.handManager.getHand().reduce((total, slot) => {
      if (!slot) return total;
      const leverage = slot.useLeverage ? currentLeverage : 1;
      const concentration = this.getElementConcentration(slot.card);
      return total + this.previewHoldQiCost(
        this.getCardScore(slot.card, currentSeason),
        leverage,
        slot.card.tianGanElement === Element.EARTH,
        concentration,
        concentrationPremiumFactor,
      );
    }, 0);
  }

  /** 获取下一回合结算时会处于的季节（跨季预览用） */
  getSettlementSeason(): Season {
    return this.seasonCycle.getNextSeason();
  }

  /** 获取季节顺序中的下一季，供卡面“当季 → 下一季”趋势展示。 */
  getFollowingSeason(): Season {
    return this.seasonCycle.getFollowingSeason();
  }

  /**
   * 获取下回合结算时会实际使用的杠杆倍数（预测用）。
   * 玩家行动后结算发生在下一回合；若行动跨季，下一回合季内进度为 1，倍率随之重置。
   * ⚠️ 信息边界契约：含季末判定（isSeasonEnd），是"是否换季"的代理变量，
   * 禁止在任何"行动前 UI"（公共牌面预览、结算弹窗本回合账单层）使用。
   */
  getSettlementLeverageMultiplier(): number {
    return this.leverageCalculator.getMultiplier(this.seasonCycle.getNextRoundInSeason());
  }

  /**
   * 获取下回合杠杆倍数的"假设不换季"推演口径（供 UI 静态提示，如手牌 →2.5x 箭头）。
   * 恒定按 当前季内回合 + 1 查杠杆表，**不查 isSeasonEnd()**：
   * - 非季末：与真实下回合倍数一致（公开规则可推）
   * - 季末：返回"幻影倍数"（如季末第 12 回合 → 13 → 表末兜底 3.5x），玩家无法区分
   *   真爬升/幻影 → 不泄露换季时机
   * 这是"提醒"——预览只给公开规则模拟，不给下回合真实状态。
   * 依据：docs/ui-information-boundary.md 第三类口径。
   */
  getNextLeverageNoSeasonChange(): number {
    return this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason() + 1);
  }

  /** 获取当前爆仓强平次数 */
  getMarginCallCount(): number {
    return this.marginCallCount;
  }

  /** 获取回合数据留存（交易看板/局终总结数据源）。只读，UI 不得修改。 */
  getRoundLog(): readonly RoundLogEntry[] {
    return this.roundLog;
  }

  /** 获取决策日志（局终行为评价数据源）。只读，UI 不得修改。 */
  getDecisionLog(): readonly DecisionEntry[] {
    return this.decisionLog;
  }

  /**
   * 记录一次决策样本：判定行动前的状态属于哪个情境，记录实际动作。
   * 在 executeBuy/Sell/Wait/Lock/Unlock 成功后调用（行动前状态已读取）。
   * @param action 实际执行的动作
   */
  private recordDecision(action: string): void {
    if (this.state !== 'player_action') return;
    const qi = this.qiManager.getQi();
    const hand = this.handManager.getHand();
    // 过滤 undefined 占位：executeBuy 买入后立即调用本方法时，公共区数组含刚清空的空位
    const cards = this.cardPoolManager.getPublicCards().filter((c): c is JiaziCard => c !== undefined);
    const handCount = hand.filter((s) => s !== null).length;
    const currentSeason = this.seasonCycle.getCurrentSeason();
    const nextSeason = this.seasonCycle.getFollowingSeason();
    const afterIdx = (['spring', 'summer', 'autumn', 'winter'].indexOf(nextSeason) + 1) % 4;
    const afterNextSeason = ['spring', 'summer', 'autumn', 'winter'][afterIdx];

    const slots = hand.filter((s) => s !== null);
    const hasBadCard = slots.some((slot) => {
      const cur = this.getCardScore(slot.card, currentSeason);
      const next = this.getCardScore(slot.card, nextSeason);
      return cur < 0 && next < 0;
    });
    const bestCardCur = cards.length > 0
      ? Math.max(...cards.map((c) => this.getCardScore(c, currentSeason)))
      : -999;
    const hasFutureGood = cards.some((c) => {
      const next = this.getCardScore(c, nextSeason);
      const afterNext = this.getCardScore(c, afterNextSeason);
      const cur = this.getCardScore(c, currentSeason);
      return Math.max(next, afterNext) >= 22 && cur <= 12;
    });
    const canBuy = handCount < 3 && cards.length > 0;
    const bestCard = cards.length > 0
      ? cards.map((c) => ({ c, cur: this.getCardScore(c, currentSeason), next: this.getCardScore(c, nextSeason) }))
          .sort((a, b) => b.cur - a.cur)[0]
      : null;

    // 情境判定（优先级：坏牌 > 神识告急 > 未来好牌 > 强牌杠杆 > 好牌当前）
    // 阈值对齐 2026-08-08 参数扫描验证的高分路径（buyMinCur=13 / levThreshold=15 /
    // 杠杆只需 qi≥25 足够付成本），避免高分牌因旧阈值（qi>50/cur≥20）漏判而脱钩。
    let scenario: DecisionScenario | null = null;
    if (hasBadCard) scenario = 'bad_card_holding';
    else if (qi < 20 && slots.length > 0) scenario = 'qi_low';
    else if (hasFutureGood && qi > 30) scenario = 'future_good_card';
    else if (qi >= 25 && canBuy && bestCard && bestCard.cur >= 15 && bestCard.next - bestCard.cur >= -5) scenario = 'strong_card_leverage';
    else if (canBuy && qi > 20 && bestCardCur >= 13) scenario = 'good_card_available';

    if (scenario) {
      this.decisionLog.push({ round: this.currentRound, scenario, action });
    }
  }

  getTotalHoldEarnings(): number {
    return this.scoreManager.getTotalHoldEarnings();
  }

  getTotalSellEarnings(): number {
    return this.scoreManager.getTotalSellEarnings();
  }

  /** 获取反噬罚分累计（局终展示"反噬扣分"用） */
  getTotalMarginCallPenalty(): number {
    return this.scoreManager.getTotalMarginCallPenalty();
  }

  /** 预览买入卡牌神识消耗 */
  previewBuyCost(card: JiaziCard, useLeverage: boolean): number {
    const score = this.getCardScore(card, this.getCurrentSeason());
    return this.qiManager.calculateBuyCost(score, useLeverage);
  }

  /** 预览持仓卡牌每回合的分收益 */
  previewHoldEarning(cardScore: number, leverage: number): number {
    return this.scoreManager.calculateHoldEarnings(cardScore, leverage);
  }

  /** 预览持仓卡牌每回合的神识消耗 */
  previewHoldQiCost(
    cardScore: number,
    leverage: number,
    isEarth: boolean = false,
    concentrationCount: number = 0,
    concentrationPremiumFactor: number = 0,
  ): number {
    return this.leverageCalculator.calculateHoldQiCost(cardScore, leverage, isEarth, concentrationCount, concentrationPremiumFactor);
  }

  /** 预览卖出卡牌的得分结算 */
  previewSellScore(slot: HandSlot): number {
    const currentScore = this.getCardScore(slot.card, this.getCurrentSeason());
    const effectiveLeverage =
      slot.useLeverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
    return this.scoreManager.calculateSellScore(currentScore, slot.buyScore, effectiveLeverage);
  }

  /** 预览卖出实际神识变化：释放锁定气先封顶，即为净到账。 */
  previewSellQiChange(slot: HandSlot): number {
    const currentQi = this.qiManager.getQi();
    return Math.min(this.qiManager.getMaxQi(), currentQi + slot.lockedQi) - currentQi;
  }

  /**
   * 预测一项合法行动提交后，下回合会发生的结算。
   *
   * 与 executeBuy / executeSell / executeWait 共用同一组 qi、计分、杠杆和季节计算器，
   * 但只在本地虚拟手牌上运算，绝不调用会改变牌池或随机源的方法。
   */
  previewSettlement(action: SettlementPreviewAction): SettlementPreview | null {
    if (this.state !== 'player_action') return null;

    const currentSeason = this.seasonCycle.getCurrentSeason();
    const currentQi = this.qiManager.getQi();
    const currentScore = this.scoreManager.getScore();
    const virtualHand = this.handManager.getHand().filter((slot): slot is HandSlot => slot !== null);
    let actionCardName: string | null = null;
    let actionUsesLeverage = false;
    let actionQiChange = 0;
    let actionScoreChange = 0;
    let saleBreakdown: SalePreviewBreakdown | null = null;

    if (action.type === 'buy') {
      if (this.currentRound >= TurnManager.TOTAL_ROUNDS || !this.handManager.canBuy()) return null;
      const card = this.cardPoolManager.getPublicCards()[action.cardIndex];
      if (!card) return null;
      // V5 空亡牌不可买入，预览一致拒绝（纯事件牌）。
      if (isVoidCard(card)) return null;
      const buyScore = this.getCardScore(card, currentSeason);
      const buyCost = this.qiManager.calculateBuyCost(buyScore, action.leverage);
      if (!this.qiManager.canAfford(buyCost)) return null;

      actionCardName = card.name;
      actionUsesLeverage = action.leverage;
      actionQiChange = -buyCost;
      virtualHand.push(new HandSlot(
        card,
        buyScore,
        action.leverage,
        action.leverage
          ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
          : 1,
        this.currentRound,
        buyCost - this.qiManager.getBuyEntryFee(),
      ));
    } else if (action.type === 'sell') {
      const slot = this.handManager.getSlot(action.slotIndex);
      if (!slot) return null;

      actionCardName = slot.card.name;
      actionUsesLeverage = slot.useLeverage;
      // 与 executeSell 顺序一致：先 recover(lock) 并封顶。
      const qiAfterReturn = Math.min(this.qiManager.getMaxQi(), currentQi + slot.lockedQi);
      const lockedQiReturn = qiAfterReturn - currentQi;
      actionQiChange = qiAfterReturn - currentQi;
      actionScoreChange = this.previewSellScore(slot);
      const effectiveLeverage = slot.useLeverage
        ? this.leverageCalculator.getMultiplier(this.seasonCycle.getCurrentRoundInSeason())
        : 1;
      saleBreakdown = {
        buyScore: slot.buyScore,
        currentScore: this.getCardScore(slot.card, currentSeason),
        leverage: effectiveLeverage,
        scoreChange: actionScoreChange,
        lockedQiReturn,
        qiChange: actionQiChange,
      };
      const virtualIndex = virtualHand.indexOf(slot);
      if (virtualIndex < 0) return null;
      virtualHand.splice(virtualIndex, 1);
    }

    const qiAfterAction = currentQi + actionQiChange;
    const scoreAfterAction = currentScore + actionScoreChange;

    // 第 60 回合会在行动后直接结束；不构造虚假的下一回合持仓、回神或最终数值。
    if (this.currentRound >= TurnManager.TOTAL_ROUNDS) {
      return {
        action,
        actionCardName,
        actionUsesLeverage,
        actionQiChange,
        actionScoreChange,
        saleBreakdown,
        qiAfterAction,
        scoreAfterAction,
        endsGame: true,
        nextRound: null,
        nextSeason: null,
        nextRoundInSeason: null,
        settlementLeverage: null,
        holdItems: [],
        holdEarnings: 0,
        holdQiCost: 0,
        qiAfterHold: null,
        baseQiRecover: 0,
        waitQiRecover: 0,
        willMarginCall: false,
        marginCallCandidateNames: [],
        finalQi: null,
        finalScore: null,
      };
    }

    const nextSeason = this.getSettlementSeason();
    const nextRoundInSeason = this.seasonCycle.getNextRoundInSeason();
    const settlementLeverage = this.getSettlementLeverageMultiplier();
    const concentrationPremiumFactor = this.getConcentrationPremiumFactor();
    // 预览用 virtualHand（已移除卖出牌）计算集中度，与实际结算（sell 后 hand 已移除）一致。
    // 直接用 virtualHand 计数而非 getElementConcentration（后者读 real hand，sell 预览时
    // real hand 尚未移除卖出牌，会导致集中度偏高、holdQiCost 不一致——concentrationPremiumFactor>0 时触发）。
    const virtualConcentration = (card: JiaziCard): number => {
      let count = 0;
      for (const s of virtualHand) {
        if (s.card.mainElement === card.mainElement) count++;
      }
      return count;
    };
    const holdingSettlement = calculateHoldingSettlement(
      virtualHand.map((slot) => ({
        cardName: slot.card.name,
        cardScore: this.getCardScore(slot.card, nextSeason),
        useLeverage: slot.useLeverage,
        isEarth: slot.card.tianGanElement === Element.EARTH,
        concentrationCount: virtualConcentration(slot.card),
        concentrationPremiumFactor,
      })),
      settlementLeverage,
      {
        calculateHoldEarnings: (cardScore, leverage) => this.scoreManager.calculateHoldEarnings(cardScore, leverage),
        calculateHoldQiCost: (cardScore, leverage, isEarth, concentrationCount, concentrationPremiumFactor) =>
          this.leverageCalculator.calculateHoldQiCost(cardScore, leverage, isEarth, concentrationCount, concentrationPremiumFactor),
      },
    );
    const qiAfterHold = qiAfterAction - holdingSettlement.holdQiCost;
    const marginCallCandidateNames = virtualHand
      .filter((slot) => slot.useLeverage)
      .map((slot) => slot.card.name);
    const willMarginCall = qiAfterHold <= 0 && marginCallCandidateNames.length > 0;
    const baseQiRecover = this.qiManager.getBaseRecovery();
    const waitQiRecover = action.type === 'wait' ? this.qiManager.getWaitBonus() : 0;

    return {
      action,
      actionCardName,
      actionUsesLeverage,
      actionQiChange,
      actionScoreChange,
      saleBreakdown,
      qiAfterAction,
      scoreAfterAction,
      endsGame: false,
      nextRound: this.currentRound + 1,
      nextSeason,
      nextRoundInSeason,
      settlementLeverage,
      holdItems: holdingSettlement.items,
      holdEarnings: holdingSettlement.holdEarnings,
      holdQiCost: holdingSettlement.holdQiCost,
      qiAfterHold,
      baseQiRecover,
      waitQiRecover,
      willMarginCall,
      marginCallCandidateNames,
      finalQi: willMarginCall
        ? null
        : Math.min(this.qiManager.getMaxQi(), qiAfterHold + baseQiRecover + waitQiRecover),
      finalScore: willMarginCall ? null : scoreAfterAction + holdingSettlement.holdEarnings,
    };
  }

  getLastSettlementDetail(): SettlementDetail | null {
    return this.lastSettlementDetail;
  }

  getTotalBuys(): number {
    return this.totalBuys;
  }

  getTotalSells(): number {
    return this.totalSells;
  }

  getTotalWaits(): number {
    return this.totalWaits;
  }

  /** 终局出清收益累计（局终修为构成单独展示；独立于主动释灵收益） */
  getTotalSettleEarnings(): number {
    return this.scoreManager.getTotalSettleEarnings();
  }

  getTotalLeverageBuys(): number {
    return this.totalLeverageBuys;
  }

  /** 锁定次数（行为画像"预判"维度数据源） */
  getTotalLocks(): number {
    return this.totalLocks;
  }

  getTotalLockedQi(): number {
    let total = 0;
    this.handManager.getHand().forEach(slot => {
      if (slot) {
        total += slot.lockedQi;
      }
    });
    return total;
  }

  /** 重置游戏 */
  reset(): void {
    // 新局默认规则回到构造默认（volatility enabled → 波动规则，否则 base）。
    // 重置只用于"开新局"，规则归属不继承上一局读档的声明。
    this.activeVolatilityConfig = this.scoreVolatilityConfig;
    this.rulesVersion = this.initialRulesVersion;
    // 懒生成跟随规则版本：读档切到 V5/V6 后 reset 开新局，需先还原季节模式再重排。
    this.seasonCycle.setLazy(
      this.initialRulesVersion >= RULES_VERSION_VOID,
    );
    this.seasonCycle.reset();
    this.scoreManager.setRules(this.initialScoreRules);
    this.scoreVolatilityState = this.isVolatilityRulesVersion()
      ? (this.isTrendWindowRulesVersion()
          ? createTrendWindowState(this.volatilityRandom, this.cardDataBank.getAllCards().map(c => c.id))
          : createScoreVolatilityState(this.volatilityRandom, this.scoreVolatilityConfig))
      : null;
    // V6+ 开新局：按构造默认规则重掷首季 roll（V5 及以下置 null，不消耗 roll 随机数）。
    this.branchRollState = this.initialRulesVersion >= RULES_VERSION_BRANCH_ROLL
      ? createBranchRollState(this.branchRollRandom, this.seasonCycle.getCurrentSeasonIndex())
      : null;
    this.qiManager.reset();
    this.scoreManager.reset();
    this.handManager.reset();
    this.lockManager.reset();
    this.voidCardCount = this.initialVoidCardCount;
    this.cardDataBank.setVoidCardCount(this.voidCardCount);
    // 重置牌池后必须重新装填全套卡牌：CardPoolManager.reset 只清空牌堆，
    // 若不重建，新一局 startGame → drawCards 会从空牌堆抽不出公共牌，
    // 导致界面只剩季节、无牌可买（游戏卡死）。
    this.cardPoolManager.initialize(this.buildDeckCards());

    this.currentRound = 1;
    this.state = 'init';
    this.lastAction = null;
    this.selectedCardIndex = -1;
    this.useLeverage = false;
    this.marginCallCount = 0;

    this.lastSettlementDetail = null;
    this.totalBuys = 0;
    this.totalSells = 0;
    this.totalWaits = 0;
    this.totalLeverageBuys = 0;
    this.voidTriggers = 0;
    this.voidSwallowedEvents = 0;
    this.voidMaxK = 0;
    this.lastVoidSwallow = null;
    this.publicCardHistory = [];
    this.lastActionRound = null;
  }

  /**
   * trend_window 模型专用：递减每张牌的窗口剩余回合数。
   * 若某牌 remainingRounds 归零，则为该牌重新抽取方向与窗口长度（重置窗口）。
   * 替代旧的全局 remainingRounds-- 逻辑。
   */
  private decrementTrendWindowRounds(): void {
    if (!this.scoreVolatilityState?.trendWindowByCardId) return;
    for (const cardId of Object.keys(this.scoreVolatilityState.trendWindowByCardId).map(Number)) {
      const entry = this.scoreVolatilityState.trendWindowByCardId[cardId];
      if (!entry) continue;
      entry.remainingRounds--;
      if (entry.remainingRounds <= 0) {
        // 窗口到期：为该牌重新抽取方向与窗口长度
        entry.direction = pickTrendDirection(this.volatilityRandom);
        entry.windowLength = pickWindowLength(this.volatilityRandom);
        entry.remainingRounds = entry.windowLength;
      }
    }
  }

  private refreshScoreVolatility(): void {
    // 门控以当前生效规则版本为准：只有已知的波动规则版本才在
    // 换季/倒计时归零时重建波动状态。base 规则（含旧档）与未知未来规则版本
    // 绝不在换季/倒计时归零时静默重建波动状态——否则旧档会被当前构建的开关
    // "半开不开"地套上波动，未知版本也会被错当波动规则。
    if (!this.isVolatilityRulesVersion()) return;
    if (this.isTrendWindowRulesVersion()) {
      // trend_window 模型：为所有牌生成新的独立趋势窗口
      const allCardIds = this.cardDataBank.getAllCards().map(c => c.id);
      this.scoreVolatilityState = createTrendWindowState(this.volatilityRandom, allCardIds);
      return;
    }
    this.scoreVolatilityState = createScoreVolatilityState(
      this.volatilityRandom,
      { ...this.activeVolatilityConfig, enabled: true },
    );
  }

  /**
   * V6 地支波动重掷（换季 / 空亡跨季 / 构造首季 / reset 新局）。
   * 门控以当前生效规则版本为准：仅 rulesVersion=6 时重掷；
   * V5 及以下恒空转——不创建、不消耗 branchRollRandom 随机数（路径逐字节不变）。
   */
  private refreshBranchRoll(): void {
    if (!this.isBranchRollRulesVersion()) return;
    this.branchRollState = createBranchRollState(this.branchRollRandom, this.seasonCycle.getCurrentSeasonIndex());
  }

  /**
   * 校验当前卡牌池完整性与守恒律。
   * 检查：
   * 1. publicCards 中无重复卡牌 ID；
   * 2. deck 中无重复卡牌 ID；
   * 3. hand 中持仓卡牌无重复 ID；
   * 4. deck, publicCards, hand 三者卡牌 ID 集合严格互斥且无交集；
   * 5. 总卡牌数与预期卡牌总数严格相等（基础 60 张 + 空亡卡牌数）。
   * @returns 校验是否完全守恒
   */
  validateCardPoolIntegrity(): boolean {
    const expectedTotal = 60 + this.getVoidCardCount();
    const publicCards = this.cardPoolManager.getPublicCards().filter((c): c is JiaziCard => Boolean(c));
    const deckCards = this.cardPoolManager.getDeck();
    const handCards = this.handManager.getHand().filter((s): s is HandSlot => Boolean(s)).map((s) => s.card);

    const seenIds = new Set<number>();

    // 检查 publicCards 内部无重复
    for (const card of publicCards) {
      if (seenIds.has(card.id)) return false;
      seenIds.add(card.id);
    }

    // 检查 deck 内部无重复且与 publicCards 不重叠
    for (const card of deckCards) {
      if (seenIds.has(card.id)) return false;
      seenIds.add(card.id);
    }

    // 检查 hand 内部无重复且与 deck/publicCards 不重叠
    for (const card of handCards) {
      if (seenIds.has(card.id)) return false;
      seenIds.add(card.id);
    }

    // 检查总牌数严格守恒
    if (seenIds.size !== expectedTotal) {
      return false;
    }

    return true;
  }
}
