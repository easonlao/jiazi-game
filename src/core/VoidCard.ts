import { Element, JiaziCard, JiaziCardData, ScoreConfig, YinYang } from './JiaziCard.ts';

/** V5 空亡牌 ID 起点：60 张甲子牌（1-60）之后连续分配。 */
export const VOID_CARD_ID_START = 61;
/** 新局默认空亡牌数量：牌堆 = 60 甲子 + 1 空亡 = 61 张（历史 V5/V6 为 3 张、V7/V8 为 2 张）。 */
export const VOID_CARD_COUNT = 1;
/** 空亡牌名称：同名纯事件牌。 */
export const VOID_CARD_NAME = '空亡';

/**
 * V5 空亡牌（纯事件牌）：无元素、无分数、不可买入。
 *
 * 时间吞噬的触发与结算由 TurnManager 执行（抽入公共牌区当回合立即触发），
 * 本类只定义卡牌数据形状：
 * - 季节评分恒为 0（覆盖 getSeasonScore，任何季节都是无分数牌）；
 * - tianGan/diZhi/元素用占位值（引擎不读空亡牌的元素语义，仅满足构造签名）；
 * - 可被锁定（LockManager 按 id 操作，不排斥），锁定保留期间不重复触发
 *   （触发只针对"本轮新抽入"的空亡牌，见 TurnManager.collectVoidTriggers）。
 */
export class VoidCard extends JiaziCard {
  /** 判别属性：区分空亡纯事件牌与普通甲子牌（isVoidCard 类型守卫的判别子）。 */
  readonly isVoidCard: true;

  constructor(id: number) {
    super({
      id,
      name: VOID_CARD_NAME,
      tianGan: '空',
      diZhi: '亡',
      tianGanElement: Element.EARTH,
      diZhiElement: Element.EARTH,
      mainElement: Element.EARTH,
      yinYang: YinYang.YIN,
    } satisfies JiaziCardData);
    this.isVoidCard = true;
  }

  /** 空亡牌无季节评分：任何季节恒为 0。 */
  override getSeasonScore(_season: string, _config?: ScoreConfig): number {
    return 0;
  }
}

/** 类型守卫：判断一张卡牌是否为空亡牌（纯事件牌）。 */
export function isVoidCard(card: JiaziCard | undefined | null): card is VoidCard {
  return card instanceof VoidCard;
}
