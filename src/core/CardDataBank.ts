import { JiaziCard, type JiaziCardData, Element, YinYang } from './JiaziCard.ts';
import { VOID_CARD_COUNT, VOID_CARD_ID_START, VoidCard } from './VoidCard.ts';

/** 卡牌数据银行 - 加载和管理所有甲子卡牌 */
export class CardDataBank {
  private cards: Map<number, JiaziCard> = new Map();
  /** 空亡牌张数（可选注入；缺省 = VOID_CARD_COUNT）。 */
  private voidCardCount: number;

  constructor(voidCardCount: number = VOID_CARD_COUNT) {
    this.voidCardCount = Math.max(0, Math.floor(voidCardCount));
  }

  /** 更新/确保空亡牌张数（读档时同步，保留已加载的 60 甲子牌） */
  setVoidCardCount(count: number): void {
    this.voidCardCount = Math.max(0, Math.floor(count));
    if (this.cards.size > 0) {
      for (let id = VOID_CARD_ID_START; ; id++) {
        if (!this.cards.has(id)) break;
        if (id >= VOID_CARD_ID_START + this.voidCardCount) {
          this.cards.delete(id);
        }
      }
      for (let i = 0; i < this.voidCardCount; i++) {
        const id = VOID_CARD_ID_START + i;
        if (!this.cards.has(id)) {
          this.cards.set(id, new VoidCard(id));
        }
      }
    }
  }

  /** 从 JSON 数据初始化 */
  async initialize(): Promise<void> {
    try {
      const response = await fetch('assets/data/jiazi_cards.json');
      const data: JiaziCardData[] = await response.json();

      for (const cardData of data) {
        const card = new JiaziCard(cardData);
        this.cards.set(card.id, card);
      }

      console.log(`[CardDataBank] 已加载 ${this.cards.size} 张卡牌`);
    } catch (error) {
      // 测试环境（Node.js）下 fetch 相对 URL 会失败，属于正常现象；
      // 使用默认数据可保证 60 张甲子循环卡牌完整可用。
      this.loadDefaultCards();
    }
    // 追加同名空亡纯事件牌（V5 牌堆专用）。V1-V4 是否入堆由 TurnManager
    // 按规则版本门控（buildDeckCards 过滤），本库始终持有它们以便读档按 id 还原。
    this.addVoidCards();
  }

  /**
   * 追加同名空亡纯事件牌（id 61 起，张数 = voidCardCount）。
   * initialize 可能被重复调用（幂等守卫：已存在则跳过）。
   */
  private addVoidCards(): void {
    for (let i = 0; i < this.voidCardCount; i++) {
      const id = VOID_CARD_ID_START + i;
      if (!this.cards.has(id)) {
        this.cards.set(id, new VoidCard(id));
      }
    }
  }

  /** 获取指定 ID 的卡牌 */
  getCard(id: number): JiaziCard | undefined {
    return this.cards.get(id);
  }

  /** 获取所有卡牌 */
  getAllCards(): JiaziCard[] {
    return Array.from(this.cards.values());
  }

  /** 获取卡牌总数 */
  getCardCount(): number {
    return this.cards.size;
  }

  /** 加载默认卡牌数据（当 JSON 加载失败时使用）：生成正确的 60 张甲子循环 */
  private loadDefaultCards(): void {
    const tianGan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const diZhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

    const tianGanElementMap: Record<string, Element> = {
      '甲': Element.WOOD, '乙': Element.WOOD,
      '丙': Element.FIRE, '丁': Element.FIRE,
      '戊': Element.EARTH, '己': Element.EARTH,
      '庚': Element.METAL, '辛': Element.METAL,
      '壬': Element.WATER, '癸': Element.WATER,
    };

    const diZhiElementMap: Record<string, Element> = {
      '子': Element.WATER, '丑': Element.EARTH,
      '寅': Element.WOOD, '卯': Element.WOOD,
      '辰': Element.EARTH, '巳': Element.FIRE,
      '午': Element.FIRE, '未': Element.EARTH,
      '申': Element.METAL, '酉': Element.METAL,
      '戌': Element.EARTH, '亥': Element.WATER,
    };

    let tgIdx = 0;
    let dzIdx = 0;
    for (let id = 1; id <= 60; id++) {
      const tg = tianGan[tgIdx];
      const dz = diZhi[dzIdx];
      const cardData: JiaziCardData = {
        id,
        name: `${tg}${dz}`,
        tianGan: tg,
        diZhi: dz,
        tianGanElement: tianGanElementMap[tg],
        diZhiElement: diZhiElementMap[dz],
        mainElement: tianGanElementMap[tg],
        yinYang: id % 2 === 0 ? YinYang.YIN : YinYang.YANG,
      };
      this.cards.set(id, new JiaziCard(cardData));
      tgIdx = (tgIdx + 1) % tianGan.length;
      dzIdx = (dzIdx + 1) % diZhi.length;
    }

    console.log(`[CardDataBank] 已加载 ${this.cards.size} 张默认卡牌`);
  }
}
