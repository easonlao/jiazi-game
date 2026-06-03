# ADR-0005: 牌池机制

## 状态
已接受

## 日期
2026-05-04

## 引擎兼容性

| 字段 | 值 |
|-------|-------|
| **引擎** | Phaser 3.90.0 |
| **领域** | 核心 |
| **知识风险** | 低（标准数组操作） |
| **参考文档** | 无 |
| **后续版本 API** | 无 |
| **验证需求** | 随机插入必须均匀；单元测试 1000 次迭代 |

## ADR 依赖关系

| 字段 | 值 |
|-------|-------|
| **依赖** | ADR-0003（卡牌数据结构） |
| **启用** | TurnManager（抽牌）、HandManager（买牌） |
| **阻塞** | 无 |
| **顺序说明** | 无 |

## 背景

### 问题陈述
甲子纪需要一个管理 60 张甲子牌牌堆的牌池系统。每回合从牌堆中抽取 2 张牌展示给玩家。玩家购买 1 张牌（永久移除）或将未选的牌返回牌堆的随机位置。

### 约束条件
- 总共 60 张牌，每局每张牌恰好出现一次
- 抽取的牌从牌堆中移除
- 未选的牌返回牌堆的随机位置（不可预测）
- 牌堆耗尽处理（剩余少于 2 张牌时）

### 需求
- 游戏开始时洗牌（Fisher-Yates）
- 从牌堆抽牌（从前面弹出）
- 将牌返回随机位置
- 跟踪牌堆大小用于 UI
- 不允许牌重复

## Decision

### CardPoolManager as Scene Component

`CardPoolManager` will be a child of the game scene (not a singleton) because its state (remaining deck, public cards) is tied to the current session and must reset between games.

### Public Interface

```typescript
// CardPoolManager.ts
import { JiaziCard } from '../data/CardDataBank';
import { EventEmitter } from 'events';

export interface CardPoolManagerEvents {
  cardsDrawn: (publicCards: JiaziCard[]) => void;
  deckEmptied: () => void;
}

export class CardPoolManager extends EventEmitter {
  private deck: JiaziCard[] = [];           // remaining cards (order matters)
  private publicCards: JiaziCard[] = [];    // currently displayed (0-2 cards)

  // Called once at game start
  initialize(allCards: JiaziCard[]): void {
    this.deck = [...allCards];
    this.shuffleDeck();
    this.publicCards = [];
  }

  private shuffleDeck(): void {
    // Fisher-Yates shuffle
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  // Draw up to 2 cards; returns array of drawn cards
  drawCards(): JiaziCard[] {
    const drawn: JiaziCard[] = [];
    const count = Math.min(2, this.deck.length);
    for (let i = 0; i < count; i++) {
      drawn.push(this.deck.shift()!);
    }
    this.publicCards = drawn;
    this.emit('cardsDrawn', this.publicCards);
    if (this.deck.length === 0) {
      this.emit('deckEmptied');
    }
    return drawn;
  }

  // Player buys card at index (0 or 1)
  buyCard(index: number): JiaziCard | null {
    if (index < 0 || index >= this.publicCards.length) {
      return null;
    }
    const card = this.publicCards[index];
    this.publicCards = [];  // both cards are gone after buy
    return card;
  }

  // Return unselected cards to random deck positions
  returnPublicCards(): void {
    for (const card of this.publicCards) {
      const pos = Math.floor(Math.random() * (this.deck.length + 1));  // 0 to deck.length inclusive
      this.deck.splice(pos, 0, card);
    }
    this.publicCards = [];
  }

  getPublicCards(): JiaziCard[] {
    return [...this.publicCards];
  }

  getDeckSize(): number {
    return this.deck.length;
  }
}
```

### Usage in TurnFlow

```typescript
// TurnFlow.ts (excerpt)
private drawCards(): void {
  const drawn = this.cardPool.drawCards();
  this.emit('cardsDrawn', drawn);
}
```

## Alternatives Considered

### Alternative 1: Singleton CardPoolManager

- **Description**: Make CardPoolManager a global singleton.
- **Pros**: Easy access from anywhere.
- **Cons**: State persists between game sessions; requires manual reset.
- **Rejection Reason**: Violates session-state principle.

### Alternative 2: Use Phaser's RandomDataGenerator directly in TurnFlow

- **Description**: No separate manager; TurnFlow manages deck directly.
- **Pros**: Simpler, fewer files.
- **Cons**: Violates separation of concerns; deck logic spread across TurnFlow.
- **Rejection Reason**: CardPoolManager encapsulates deck-specific logic.

## Consequences

### Positive
- Clear ownership: deck management in one place.
- Easy to unit test in isolation (no scene tree required).
- Deck state reset naturally when game scene is recreated.

### Negative
- Slightly more boilerplate (one extra component).

### Risks
- **Randomness quality**: `Math.random()` is suitable for game RNG.
- **Performance**: Array splice at random position is O(N); deck size is 60, negligible.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-card-pool.md | 60 cards shuffled at start | `initialize()` + `shuffleDeck()` |
| system-card-pool.md | Draw 2 cards per turn | `drawCards()` returns 2 |
| system-card-pool.md | Unselected cards return to random position | `returnPublicCards()` with random insert |
| system-card-pool.md | Deck depletion handling | `deckEmptied` event, `drawCards()` handles 0-1 cards |
| system-card-pool.md | Bought cards removed permanently | `buyCard()` removes from public, not returned to deck |

## Performance Implications
- **CPU**: Fisher-Yates O(n) = 60 swaps at start; each splice O(n) = up to 60 operations; negligible.
- **Memory**: Deck array stores 60 references (~480 bytes).

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] Unit test: Deck has 60 cards after initialize.
- [ ] Unit test: Draw reduces deck by 2 (or less if depleted).
- [ ] Unit test: Returning cards increases deck size by number returned.
- [ ] Unit test: Cards are not duplicated (deck size = 60 - bought cards).
- [ ] Unit test: Random insertion position is within valid range.

## Related Decisions
- ADR-0004: Card data structure (JiaziCard)
