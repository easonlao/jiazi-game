# ADR-0002: EventEmitter 驱动的模块间通信

## 状态
已接受

## 日期
2026-05-04

## 引擎兼容性

| 字段 | 值 |
|-------|-------|
| **引擎** | Phaser 3.90.0 |
| **领域** | 核心 / 架构 |
| **知识风险** | 低（事件是标准 TypeScript 模式） |
| **参考文档** | Phaser 3 EventEmitter 文档，TypeScript EventEmitter 模式 |
| **后续版本 API** | 无 |
| **验证需求** | 事件连接必须在事件触发前建立（在构造函数中测试） |

## ADR 依赖关系

| 字段 | 值 |
|-------|-------|
| **依赖** | ADR-0001（回合流程架构） |
| **启用** | 所有模块实现 |
| **阻塞** | 无 |
| **顺序说明** | 无 |

## 背景

### 问题陈述
甲子纪有多个模块（TurnManager、HandManager、CardPoolManager、GameScene、QiManager 等）需要在不紧密耦合的情况下通信。直接的方法调用会创建硬依赖，使测试变得困难并降低灵活性。我们需要一个一致的通信模式来解耦生产者和消费者。

### 约束条件
- 模块必须能够独立测试
- 新功能（如音效、成就）应该能够监听游戏事件，而无需修改现有代码
- 性能必须保持在预算内（EventEmitter 是轻量级的）
- 必须支持 Web 导出（事件在所有平台上工作方式相同）

### 需求
- 模块间低耦合
- 易于添加新的观察者，无需修改被观察的模块
- 清晰、文档化的事件签名
- 事件必须有类型（TypeScript）

## 决策

### EventEmitter 驱动架构

**所有跨模块通信将使用 TypeScript EventEmitter。** 模块在状态变化或事件发生时发出事件。其他模块订阅这些事件以做出反应。

**原则:**
- 数据流向: 生产者 → 事件 → 消费者
- 生产者不知道消费者的存在
- 消费者在构造函数中订阅事件
- 事件在生产者模块中定义为类型安全的接口

### 核心事件定义

#### TurnManager (事件源)
```typescript
// TurnManager.ts
export interface TurnManagerEvents {
  turnStarted: (turnNumber: number) => void;
  turnEnded: (turnNumber: number) => void;
  seasonChanged: (newSeason: string, oldSeason: string) => void;
  seasonChecked: (season: string, seasonRound: number) => void;
  settlementCompleted: (holdScore: number, qiCost: number) => void;
  cardsDrawn: (publicCards: JiaziCard[]) => void;
  qiRecovered: (newQi: number, recovered: number) => void;
  playerActionRequired: () => void;
  gameEnded: (finalScore: number, stats: any) => void;
}
```

#### QiManager (事件源)
```typescript
// QiManager.ts
export interface QiManagerEvents {
  qiChanged: (newQi: number, oldQi: number) => void;
  qiDepleted: () => void;
  marginCallTriggered: (cardName: string, slot: number) => void;
}
```

#### ScoreManager (事件源)
```typescript
// ScoreManager.ts
export interface ScoreManagerEvents {
  scoreChanged: (newScore: number, delta: number) => void;
}
```

#### HandManager (事件源)
```typescript
// HandManager.ts
export interface HandManagerEvents {
  handUpdated: (hand: HandSlot[]) => void;
  cardBought: (card: JiaziCard, slot: number) => void;
  cardSold: (card: JiaziCard, slot: number, profit: number) => void;
}
```

#### CardPoolManager (事件源)
```typescript
// CardPoolManager.ts
export interface CardPoolManagerEvents {
  cardsDrawn: (cards: JiaziCard[]) => void;
  deckEmptied: () => void;
}
```

#### SeasonCycle (事件源)
```typescript
// SeasonCycle.ts
export interface SeasonCycleEvents {
  seasonChanged: (newSeason: string, oldSeason: string) => void;
}
```

### 订阅策略

**UIManager** 订阅所有相关事件以更新界面：
```typescript
// UIManager constructor
constructor(
  private turnManager: TurnManager,
  private qiManager: QiManager,
  private scoreManager: ScoreManager,
  private handManager: HandManager
) {
  this.turnManager.on('turnStarted', this.updateTurnDisplay);
  this.turnManager.on('seasonChanged', this.updateSeasonDisplay);
  this.turnManager.on('settlementCompleted', this.updateSettlementDisplay);
  this.turnManager.on('cardsDrawn', this.updatePublicCards);
  this.turnManager.on('qiRecovered', this.updateQiBar);
  this.turnManager.on('playerActionRequired', this.enableActionButtons);
  this.turnManager.on('gameEnded', this.showGameOver);
  this.qiManager.on('qiChanged', this.updateQiBar);
  this.qiManager.on('marginCallTriggered', this.showMarginCallWarning);
  this.scoreManager.on('scoreChanged', this.updateScoreDisplay);
  this.handManager.on('handUpdated', this.updateHandDisplay);
}
```

### 直接方法调用 vs 事件

| 场景 | 使用方式 | 示例 |
|------|----------|------|
| 请求/操作 (需要返回值) | 直接方法调用 | `handManager.canBuy()` |
| 状态变化通知 (无返回值) | 事件 | `turnStarted` |
| UI 更新 (单向通知) | 事件 | `scoreChanged` |
| 模块间解耦的通知 | 事件 | `marginCallTriggered` |

TurnManager 作为主控制器，直接调用子模块的方法来执行操作，但通过事件通知外界状态变化。这保持了控制流的清晰和可测试性。

## Alternatives Considered

### Alternative 1: 全局事件总线

- **Description**: 创建一个 `EventBus` 单例，所有模块通过它发射和监听事件。
- **Pros**: 完全解耦，模块不需要知道事件来源。
- **Cons**: 全局命名空间冲突；事件定义散落在各处；调试困难（不知道谁发射了事件）。
- **Rejection Reason**: 模块自身的 EventEmitter 已经足够，添加额外抽象层增加复杂度。

### Alternative 2: 直接方法调用 + 回调

- **Description**: 模块间通过直接方法调用通信，使用回调函数处理异步通知。
- **Pros**: 简单直接，类型安全。
- **Cons**: 导致紧耦合；新增观察者需要修改被调用代码。
- **Rejection Reason**: 违反开闭原则，不利于扩展（如添加音效、成就）。

## Consequences

### Positive
- 模块解耦，易于单独测试。
- 易于添加新的监听器（如成就系统、音效系统）而不修改现有代码。
- TypeScript 接口提供编译时类型检查。

### Negative
- 事件订阅代码需要写在构造函数中，增加样板代码。
- 过多的事件可能导致性能轻微下降（但在本项目中可忽略）。

### Risks
- **事件订阅顺序风险**: 如果消费者在生产者发射事件后才订阅，会错过事件。缓解：确保所有订阅在构造函数中完成，TurnManager 在场景准备好后才开始游戏。
- **事件滥用风险**: 过度使用事件会使数据流难以追踪。缓解：仅将事件用于"通知"而非"请求"；保持事件命名清晰。

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-ui-rendering.md | UI updates on score, qi, hand changes | UIManager subscribes to events and updates display |
| system-turn-flow.md | Player action required event | `playerActionRequired` event enables UI buttons |
| system-leverage.md | Margin call notification | `marginCallTriggered` event for UI warning |
| system-qi-resource.md | Qi depletion event | `qiDepleted` event for game over check |

## Performance Implications
- **CPU**: EventEmitter emissions are function calls with minimal overhead (~50-100ns per event).
- **Memory**: Each event subscription stores a function reference (negligible).
- **Load Time**: Subscriptions established during constructor add negligible startup cost.

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] All cross-module notifications use events (no direct method calls for one-way notifications).
- [ ] All events are subscribed before game starts (test: disable a module and verify event is still emitted).
- [ ] Adding a new listener (e.g., sound system) requires no changes to existing event emitters.

## Related Decisions
- ADR-0001: 游戏状态管理与回合流程架构 (TurnManager as event source)
