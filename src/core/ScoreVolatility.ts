import type { RandomSource } from './RandomSource';
import type { JiaziCard } from './JiaziCard';
import { Element, YinYang } from './JiaziCard';

/**
 * 季内评分波动模型。
 * - uniform（默认兼容模型）：按地支族共享一个短期整数偏移（旧行为）。
 * - conflict_banded（候选模型）：按卡牌天干/地支五行冲突分档推导牌级幅度，
 *   地支族共享方向（-1/-0.5/0/0.5/1），持续 1-3 回合后重掷。
 */
export type VolatilityModel = 'uniform' | 'conflict_banded';

/**
 * 卡牌在当前活跃波动状态下的短期趋势（实验 UI 的紧凑箭头数据源）。
 * - rising  = 当前波动方向为正（当季评分被短期推高）
 * - falling = 当前波动方向为负（当季评分被短期压低）
 * - steady  = 当前波动方向为零（无明显短期偏移）
 * 波动未启用（base 规则 / 旧档）时由 TurnManager 返回 null，UI 不渲染箭头。
 */
export type VolatilityTrend = 'rising' | 'falling' | 'steady';

/**
 * 实验性季内评分波动配置。
 *
 * 波动不是每张牌独立掷骰，而是按地支族共享一个短期偏移；这样同一地支的
 * 五张牌会一起偏旺/偏弱，保留卡牌结构上的相关性。
 */
export interface ScoreVolatilityConfig {
  enabled: boolean;
  /** 波动模型：uniform（兼容默认）或 conflict_banded（候选）。 */
  model?: VolatilityModel;
  minDuration: number;
  maxDuration: number;
  /** uniform 模型的地支整数偏移上限。 */
  maxScoreDelta: number;
  /** conflict_banded 模型全局 scale（唯一可调参数）；0 → 零偏移但仍走真实核心路径。 */
  scale?: number;
}

export const DEFAULT_SCORE_VOLATILITY_CONFIG: ScoreVolatilityConfig = {
  enabled: false,
  model: 'uniform',
  minDuration: 1,
  maxDuration: 3,
  maxScoreDelta: 2,
  scale: 2,
};

/**
 * 波动状态快照（既是运行时状态，也是存档可序列化字段）。
 *
 * 新格式自声明 model/scale/directionByDiZhi；旧格式（无新字段）缺省解释为
 * uniform（按 deltaByDiZhi 偏移）。model 出现但为未知值时读档必须明确拒绝，
 * 不静默按 uniform 解释。
 */
export interface ScoreVolatilitySnapshot {
  remainingRounds: number;
  /** uniform 模型：每个地支的整数偏移。旧格式存档必含本字段。 */
  deltaByDiZhi: Record<string, number>;
  /** 波动模型；缺省 = uniform（旧格式存档兼容）。 */
  model?: VolatilityModel;
  /** conflict_banded 全局 scale；缺省 = 配置默认。 */
  scale?: number;
  /** conflict_banded 模型：每个地支共享的方向（-1/-0.5/0/0.5/1）。 */
  directionByDiZhi?: Record<string, number>;
}

const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

/**
 * 生成一次新的波动状态（构造 / 换季 / 倒计时归零时调用）。
 *
 * conflict_banded 的随机抽取顺序与探针一致（先持续时间，再按地支抽方向），
 * 保证同一 seed 的 volatilityRandom 流产出与探针推演相同的方向序列。
 */
export function createScoreVolatilityState(
  random: RandomSource,
  config: ScoreVolatilityConfig,
): ScoreVolatilitySnapshot {
  const minDuration = Math.max(1, Math.floor(config.minDuration));
  const maxDuration = Math.max(minDuration, Math.floor(config.maxDuration));

  if (config.model === 'conflict_banded') {
    const remainingRounds = random.int(minDuration, maxDuration + 1);
    const directionByDiZhi: Record<string, number> = {};
    for (const diZhi of DI_ZHI) {
      directionByDiZhi[diZhi] = random.int(-2, 3) / 2;
    }
    return {
      model: 'conflict_banded',
      scale: config.scale ?? DEFAULT_SCORE_VOLATILITY_CONFIG.scale ?? 2,
      remainingRounds,
      deltaByDiZhi: {},
      directionByDiZhi,
    };
  }

  const maxDelta = Math.max(0, Math.floor(config.maxScoreDelta));
  const deltaByDiZhi: Record<string, number> = {};
  for (const diZhi of DI_ZHI) {
    deltaByDiZhi[diZhi] = maxDelta === 0
      ? 0
      : random.int(-maxDelta, maxDelta + 1);
  }

  // 保持旧 uniform 存档形状：新增模型字段只属于 conflict_banded 存档。
  return { remainingRounds: random.int(minDuration, maxDuration + 1), deltaByDiZhi };
}

/** 卡牌波动档位（从现有天干/地支五行关系推导，不读分数、不新增第二套牌型数据）。 */
export type RelationBand = 'stable' | 'mixed' | 'conflict' | 'earth';

/** 各档位的基础幅度系数。 */
export const BAND_FACTOR: Record<RelationBand, number> = {
  earth: 0.5,
  stable: 0.75,
  mixed: 1.0,
  conflict: 1.5,
};

function isSameGroup(a: Element, b: Element): boolean {
  const woodFire = [Element.WOOD, Element.FIRE];
  const metalWater = [Element.METAL, Element.WATER];
  return (woodFire.includes(a) && woodFire.includes(b)) || (metalWater.includes(a) && metalWater.includes(b));
}

function isOpposite(a: Element, b: Element): boolean {
  return (a === Element.WOOD && b === Element.METAL) ||
    (a === Element.METAL && b === Element.WOOD) ||
    (a === Element.FIRE && b === Element.WATER) ||
    (a === Element.WATER && b === Element.FIRE);
}

/**
 * 只从现有天干/地支五行关系推导波动档位，不读取分数、不增加第二套牌型配置。
 * 壬子属于 stable，壬午属于 conflict；土天干单独作为防守型低波动。
 */
export function relationBand(card: JiaziCard): RelationBand {
  if (card.tianGanElement === Element.EARTH) return 'earth';
  if (card.tianGanElement === card.diZhiElement) return 'stable';
  if (isOpposite(card.tianGanElement, card.diZhiElement)) return 'conflict';
  return isSameGroup(card.tianGanElement, card.diZhiElement) ? 'mixed' : 'conflict';
}

/**
 * 全局 scale 是唯一需要调的参数；其余档位是固定的通用映射。
 * 低分门控不是额外配置：由当前季节基础分归一化得到，保护当季强牌的持有稳定性。
 * Yin/yang 只复用现有 1.1/0.9 极性比例，不新增可调参数。
 */
export function cardAmplitude(card: JiaziCard, scale: number, baseScore: number): number {
  const polarity = card.yinYang === YinYang.YANG ? 1.1 : 0.9;
  // 评分上限约为 +35：强牌保留约四分之一噪声，分数越低越接近满幅度。
  // 负分牌封顶为满幅度，避免因负分继续无限放大。
  const lowScoreFactor = Math.max(0.25, Math.min(1, 1 - baseScore / 35));
  return scale * BAND_FACTOR[relationBand(card)] * polarity * lowScoreFactor;
}

/** 判断一个波动模型值是否被当前代码支持（缺省/undefined 不算未知，属旧格式）。 */
export function isSupportedVolatilityModel(model: unknown): model is VolatilityModel {
  return model === 'uniform' || model === 'conflict_banded';
}
