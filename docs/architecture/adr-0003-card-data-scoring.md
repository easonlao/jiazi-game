# ADR-0003: 卡牌数据结构和评分公式实现

## 状态
已接受

## 日期
2026-05-04

## 引擎兼容性

| 字段 | 值 |
|-------|-------|
| **引擎** | Phaser 3.90.0 |
| **领域** | 核心 / 数据 |
| **知识风险** | 低（数据结构，无后续版本 API） |
| **参考文档** | TypeScript 接口，JSON 加载模式 |
| **后续版本 API** | 无 |
| **验证需求** | 确保 JSON 加载优雅地处理缺失字段 |

## ADR 依赖关系

| 字段 | 值 |
|-------|-------|
| **依赖** | 无 |
| **启用** | 所有计分、牌池、手牌管理实现 |
| **阻塞** | 无 |
| **顺序说明** | ADR-0003 应在实现任何卡牌相关逻辑之前被接受 |

## 背景

### 问题陈述
甲子纪需要所有 60 张甲子牌的数据定义，包括它们的名称、元素和每季节的评分规则。评分公式将天干基础分与藏干贡献相结合。我们需要一个易于编写、加载和在运行时查询的数据结构。

### 约束条件
- 卡牌数据必须可以在不重新编译游戏的情况下编辑（设计师可能会调整值）
- 性能：卡牌数据查找必须是 O(1)（无线性搜索）
- 内存：60 张牌 × ~200 字节 = ~12KB — 很小
- 必须高效支持季节性评分查询

### 需求
- 定义所有 60 张甲子牌（id、name、tian_gan、di_zhi、elements）
- 提供按 ID 查找
- 计算给定季节的卡牌评分（天干基础 + 藏干加权和）
- 支持未来扩展（组合加成、阴阳修正）

## Decision

### Data Storage Format

**JSON resource file** (`src/data/cards/jiazi_cards.json`):

```json
{
  "version": 1,
  "cards": [
    {
      "id": 1,
      "name": "甲子",
      "tianGan": "甲",
      "diZhi": "子",
      "tianGanElement": "wood",
      "diZhiElement": "water",
      "mainElement": "wood",
      "yinYang": "yang"
    }
  ]
}
```

### Data Class Definition (TypeScript)

```typescript
// CardDataBank.ts
export interface JiaziCard {
  id: number;
  name: string;
  tianGan: string;
  diZhi: string;
  tianGanElement: string;
  diZhiElement: string;
  mainElement: string;
  yinYang: string;  // "yang" or "yin"
}

export interface CangGanEntry {
  gan: string;
  weight: number;
}

// Cang gan mapping (di_zhi → array of [gan, weight])
export const CANG_GAN_DICT: Record<string, CangGanEntry[]> = {
  "子": [{ gan: "癸", weight: 1.0 }],
  "丑": [{ gan: "己", weight: 0.6 }, { gan: "癸", weight: 0.2 }, { gan: "辛", weight: 0.2 }],
  "寅": [{ gan: "甲", weight: 0.6 }, { gan: "丙", weight: 0.3 }, { gan: "戊", weight: 0.1 }],
  "卯": [{ gan: "乙", weight: 1.0 }],
  "辰": [{ gan: "戊", weight: 0.6 }, { gan: "乙", weight: 0.3 }, { gan: "癸", weight: 0.1 }],
  "巳": [{ gan: "丙", weight: 0.6 }, { gan: "庚", weight: 0.3 }, { gan: "戊", weight: 0.1 }],
  "午": [{ gan: "丁", weight: 0.7 }, { gan: "己", weight: 0.3 }],
  "未": [{ gan: "己", weight: 0.6 }, { gan: "丁", weight: 0.2 }, { gan: "乙", weight: 0.2 }],
  "申": [{ gan: "庚", weight: 0.6 }, { gan: "壬", weight: 0.3 }, { gan: "戊", weight: 0.1 }],
  "酉": [{ gan: "辛", weight: 1.0 }],
  "戌": [{ gan: "戊", weight: 0.6 }, { gan: "辛", weight: 0.3 }, { gan: "丁", weight: 0.1 }],
  "亥": [{ gan: "壬", weight: 0.7 }, { gan: "甲", weight: 0.3 }]
};

// Element to season score mapping (season values: -3, -1, +2, +4)
export const ELEMENT_SEASON_SCORE: Record<string, Record<string, number>> = {
  wood: { spring: 4, summer: 2, autumn: -3, winter: -1 },
  fire: { spring: 2, summer: 4, autumn: -1, winter: -3 },
  earth: { spring: 1, summer: 1, autumn: 1, winter: 1 },
  metal: { spring: -3, summer: -1, autumn: 4, winter: 2 },
  water: { spring: -1, summer: -3, autumn: 2, winter: 4 }
};

export class CardDataBank {
  private cards: JiaziCard[] = [];
  private cardsById: Map<number, JiaziCard> = new Map();

  constructor() {
    this.loadCardsFromJson();
  }

  private loadCardsFromJson(): void {
    // Load from JSON (Phaser scene.load.json or fetch)
    const jsonData = require('../data/cards/jiazi_cards.json');
    for (const cardData of jsonData.cards) {
      const card: JiaziCard = {
        id: cardData.id,
        name: cardData.name,
        tianGan: cardData.tianGan,
        diZhi: cardData.diZhi,
        tianGanElement: cardData.tianGanElement,
        diZhiElement: cardData.diZhiElement,
        mainElement: cardData.mainElement,
        yinYang: cardData.yinYang || ''
      };
      this.cards.push(card);
      this.cardsById.set(card.id, card);
    }
  }

  getCard(id: number): JiaziCard | undefined {
    return this.cardsById.get(id);
  }

  getAllCards(): JiaziCard[] {
    return [...this.cards];
  }
}
```

### Scoring Calculation

```typescript
// ScoreManager.ts
import { JiaziCard, CANG_GAN_DICT, ELEMENT_SEASON_SCORE } from '../data/CardDataBank';
import { EventEmitter } from 'events';

export interface ScoreManagerEvents {
  scoreChanged: (newScore: number, delta: number) => void;
}

export class ScoreManager extends EventEmitter {
  private totalScore: number = 0;
  private static readonly HOLD_BONUS: number = 1.2;
  private static readonly SELL_BASE: number = 8.0;
  private static readonly SPREAD_MULTIPLIER: number = 4.0;
  private static readonly CANG_GAN_WEIGHT: number = 0.5;

  calculateCardScore(card: JiaziCard, season: string): number {
    const tianGanScore = ELEMENT_SEASON_SCORE[card.tianGanElement][season];
    
    let cangGanScoreSum: number = 0;
    const cangList = CANG_GAN_DICT[card.diZhi] || [];
    for (const entry of cangList) {
      const ganElement = this.getElementFromGan(entry.gan);
      const ganSeasonScore = ELEMENT_SEASON_SCORE[ganElement][season];
      cangGanScoreSum += entry.weight * ganSeasonScore;
    }
    
    return tianGanScore + ScoreManager.CANG_GAN_WEIGHT * cangGanScoreSum;
  }

  calculateHoldScore(hand: HandSlot[], season: string): number {
    let total: number = 0;
    for (const slot of hand) {
      if (!slot || !slot.card) continue;
      const cardScore = this.calculateCardScore(slot.card, season);
      total += ScoreManager.HOLD_BONUS * cardScore * slot.leverage;
    }
    return total;
  }

  calculateSellScore(card: JiaziCard, buyScore: number, season: string): number {
    const sellScore = this.calculateCardScore(card, season);
    return (ScoreManager.SELL_BASE + (sellScore - buyScore) * ScoreManager.SPREAD_MULTIPLIER);
  }

  addScore(value: number): void {
    this.totalScore += value;
    this.emit('scoreChanged', this.totalScore, value);
  }
}
```

### Extension Points

预留扩展接口，MVP 阶段不实现但结构已就位：
- **Combination bonuses**: 天干地支配合 (如甲寅双木加成)
- **Yin-Yang modifiers**: 阳干/阴干的收益差异
- 通过配置表注入，不改核心代码

## Alternatives Considered

### Alternative 1: 硬编码卡牌数据

- **Description**: 直接在 TypeScript 中定义 60 个常量。
- **Pros**: 简单，无需文件 I/O。
- **Cons**: 修改需要重编译；不便于设计迭代。
- **Rejection Reason**: 违反数据驱动原则，不利于调参。

### Alternative 2: 使用 Phaser 的 Scene Plugin

- **Description**: 使用 Phaser 内置的数据存储机制。
- **Pros**: Phaser 原生支持。
- **Cons**: JSON 单文件更简洁，适合批量数据。
- **Rejection Reason**: JSON 更通用，便于版本控制和设计迭代。

## Consequences

### Positive
- 卡牌数据与代码分离，设计者可直接编辑 JSON。
- 评分公式集中管理，易于调参。
- 藏干数据独立于卡牌，减少数据冗余。
- TypeScript 接口提供编译时类型安全。

### Negative
- JSON 加载需要错误处理（文件缺失、格式错误）。
- 藏干到五行的映射需要手动维护（约 12 条规则）。

### Risks
- **JSON 加载失败风险**: 文件路径错误或格式错误会导致游戏无法启动。缓解：提供默认回退数据；在构造函数中捕获错误并打印日志。
- **藏干映射不完整风险**: 某些地支的藏干规则可能遗漏。缓解：与 GDD 核对；单元测试覆盖所有 60 张牌的评分。

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-jiazi-cards.md | 60 甲子牌数据完整 | JSON 包含所有卡牌的完整定义 |
| system-jiazi-cards.md | 每张牌的天干、地支、五行属性 | 数据结构包含所有字段 |
| system-scoring.md | 卡牌评分公式 (天干 + 藏干加权) | score = tianGanScore + 0.5 × Σ(藏干分) |
| system-scoring.md | 持仓收益计算公式 | `HOLD_BONUS(1.2) × 卡牌评分 × 杠杆` |
| system-scoring.md | 卖出收益计算公式 | `SELL_BASE(8) + (卖出-买入评分)×4 × 杠杆` |

## Performance Implications
- **CPU**: 每次评分计算 O(1) — 最多遍历 3 个藏干，可忽略。
- **Memory**: 所有卡牌数据约 50KB，可忽略。
- **Load Time**: JSON 加载发生在启动时，约 10-20ms。

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] JSON 文件包含 60 张完整卡牌，每张卡牌字段完整。
- [ ] 所有卡牌可以通过 ID 查询返回正确数据。
- [ ] 评分公式对每个季节返回预期值（单元测试验证）。
- [ ] 藏干权重正确影响评分。
- [ ] 持仓收益和卖出收益计算正确。

## Related Decisions
- ADR-0003: EventEmitter 通信 (ScoreManager emits scoreChanged)
