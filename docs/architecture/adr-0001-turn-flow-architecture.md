# ADR-0001: 游戏状态管理与回合流程架构

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Phaser 3 |
| **Domain** | Core |
| **Knowledge Risk** | LOW (core state machine logic, no post-cutoff API dependencies) |
| **References Consulted** | Phaser 3 documentation (scene management, events) |
| **Post-Cutoff APIs Used** | None (uses standard EventEmitter, Scene management — all stable) |
| **Verification Required** | Season length generation (random 3-12 per season) must fill exactly 60 turns; verify turn order matches GDD |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | None |
| **Enables** | ADR-0003 (EventEmitter-Based Communication) |
| **Blocks** | Epic: Core Loop Implementation |
| **Ordering Note** | TurnFlow depends on QiResource, HandManagement, CardPool, Scoring, Leverage. Those modules should have their interfaces defined before TurnFlow implementation, but their ADRs can be created in parallel. |

## Context

### Problem Statement
甲子纪是一个回合制策略卡牌游戏，每局固定60回合，每回合需要按固定顺序执行多个步骤：季节检查、持仓结算、刷牌、气回复、玩家操作（买入/卖出/等待）等。需要一个可靠的状态机来管理回合流程，确保步骤顺序正确、状态转换清晰、各系统之间解耦。

### Constraints
- 回合流程必须严格遵循 `system-turn-flow.md` 定义的7步顺序
- 玩家操作期间，游戏必须等待输入，不能自动推进
- 季节切换必须在持仓结算之前完成
- 60回合结束后必须触发游戏结束流程
- 支持 Web 和 PC 平台，无网络同步要求

### Requirements
- 必须提供清晰的状态机，每个状态对应回合流程的一个阶段
- 必须通过事件通知 UI 更新，避免 UI 模块直接轮询状态
- 必须支持保存/加载游戏状态（未来扩展）
- 必须正确处理边缘情况：牌堆为空、手牌为空、气归零爆仓等
- 性能：回合状态转换开销 < 1ms per turn

## Decision

### 核心架构

**TurnManager** 作为游戏主循环的根节点，采用有限状态机管理回合流程。它不是一个全局单例，而是作为场景根组件存在，通过构造函数初始化所有依赖模块，并通过 EventEmitter 事件向外通信。

### 状态机定义

```
┌─────────────┐
│   INIT      │ ← 游戏开始，初始化牌堆、季节、气等
└──────┬──────┘
       ↓
┌─────────────┐
│  TURN_START │ ← 回合开始，检查游戏结束、推进回合计数
└──────┬──────┘
       ↓
┌─────────────┐
│SEASON_CHECK │ ← 检查季节是否结束，必要时切换季节
└──────┬──────┘
       ↓
┌─────────────┐
│ SETTLEMENT  │ ← 持仓结算（Scoring）+ 持仓气耗扣除（Qi）
└──────┬──────┘
       ↓
┌─────────────┐
│    DRAW     │ ← 刷牌（CardPool）
└──────┬──────┘
       ↓
┌─────────────┐
│  QI_RECOVER │ ← 气回复（Qi）
└──────┬──────┘
       ↓
┌─────────────┐
│PLAYER_ACTION│ ← 等待玩家输入（买入/卖出/等待）
└──────┬──────┘
       ↓
┌─────────────┐
│  TURN_END   │ ← 推进回合索引，循环回 TURN_START 或触发 GAME_OVER
└─────────────┘
```

### 状态转换与事件

| 当前状态 | 触发条件 | 下一状态 | 发出的事件 |
|----------|----------|----------|------------|
| INIT | `startGame()` 调用 | SEASON_CHECK | `gameStarted` |
| TURN_START | 回合计数器 ≤ 60 | SEASON_CHECK | `turnStarted(turnNumber)` |
| TURN_START | 回合计数器 > 60 | GAME_OVER | `gameOver(finalScore)` |
| SEASON_CHECK | 季节未结束 | SETTLEMENT | `seasonChecked(season, seasonRound)` |
| SEASON_CHECK | 季节结束，切换后 | SETTLEMENT | `seasonChanged(newSeason)` |
| SETTLEMENT | 结算完成 | DRAW | `settlementCompleted(holdScore, qiCost)` |
| DRAW | 刷牌完成 | QI_RECOVER | `cardsDrawn(publicCards)` |
| QI_RECOVER | 回气完成 | PLAYER_ACTION | `qiRecovered(newQi)` |
| PLAYER_ACTION | 玩家选择操作 | TURN_END | `playerAction(action, data)` |
| TURN_END | 回合计数增加 | TURN_START | `turnEnded(turnNumber)` |
| GAME_OVER | — | — | `gameEnded(finalScore, stats)` |

### 依赖注入方式

TurnManager 通过构造函数参数接收依赖模块，不使用全局单例。

```typescript
// TurnManager.ts
import { QiManager } from '../qi/QiManager';
import { ScoreManager } from '../scoring/ScoreManager';
import { SeasonCycle } from '../season/SeasonCycle';
import { CardDataBank } from '../data/CardDataBank';
import { HandManager } from './HandManager';
import { CardPoolManager } from './CardPoolManager';
import { LeverageCalculator } from '../leverage/LeverageCalculator';

export class TurnManager {
  private state: State = State.INIT;
  private turn: number = 1;
  private lastAction: string = '';

  constructor(
    private qiManager: QiManager,
    private scoring: ScoreManager,
    private season: SeasonCycle,
    private cardData: CardDataBank,
    private handManager: HandManager,
    private cardPool: CardPoolManager,
    private leverage: LeverageCalculator
  ) {}
```

### 回合推进核心逻辑

```typescript
private advanceTurn(): void {
  switch (this.state) {
    case State.INIT:
      this.initGame();
      this.setState(State.SEASON_CHECK);
      break;
    
    case State.TURN_START:
      if (this.turn > MAX_TURNS) {
        this.setState(State.GAME_OVER);
        return;
      }
      this.emit('turnStarted', this.turn);
      this.setState(State.SEASON_CHECK);
      break;
    
    case State.SEASON_CHECK:
      if (this.season.isSeasonEnd()) {
        this.season.advanceSeason();
        this.emit('seasonChanged', this.season.getCurrentSeason());
      }
      this.emit('seasonChecked', this.season.getCurrentSeason(), this.season.getSeasonRound());
      this.setState(State.SETTLEMENT);
      break;
    
    case State.SETTLEMENT:
      const holdScore = this.scoring.calculateHoldScore(
        this.handManager.getHand(),
        this.season.getCurrentSeason()
      );
      const qiCost = this.calculateHoldQiCost(
        this.handManager.getHand(),
        this.season.getCurrentSeason()
      );
      this.qiManager.spend(qiCost);
      this.checkMarginCall();
      this.emit('settlementCompleted', holdScore, qiCost);
      this.setState(State.DRAW);
      break;
    
    case State.DRAW:
      const publicCards = this.cardPool.drawCards();
      this.emit('cardsDrawn', publicCards);
      this.setState(State.QI_RECOVER);
      break;
    
    case State.QI_RECOVER:
      const recovered = this.qiManager.recoverTurn(this.lastAction === 'wait');
      this.emit('qiRecovered', this.qiManager.getQi(), recovered);
      this.setState(State.PLAYER_ACTION);
      break;
    
    case State.PLAYER_ACTION:
      this.emit('playerActionRequired');
      // 等待 UI 调用 onPlayerAction() 后推进
      break;
    
    case State.TURN_END:
      this.turn += 1;
      this.season.advanceRound();
      this.lastAction = '';
      this.emit('turnEnded', this.turn);
      this.setState(State.TURN_START);
      break;
  }
}
```

### 玩家操作处理

UI 通过事件 `actionSelected` 将操作传回 TurnManager，TurnManager 验证后调用对应模块，然后调用 `advanceTurn()` 继续。

```typescript
onPlayerAction(action: string, data: any): void {
  if (this.state !== State.PLAYER_ACTION) {
    return;
  }
  
  switch (action) {
    case 'buy':
      if (this.handManager.canBuy() && this.qiManager.canAfford(this.getBuyCost(data.card))) {
        const leverageMult = this.leverage.getCurrentMultiplier(this.season.getSeasonRound());
        this.handManager.buy(data.card, leverageMult, data.buyScore);
        this.cardPool.buyCard(data.index);
        this.lastAction = 'buy';
      }
      break;
    
    case 'sell':
      if (this.handManager.canSell() && this.qiManager.canAfford(3)) {
        const card = this.handManager.getHand()[data.slot];
        const sellScore = this.scoring.calculateSellScore(
          card.card,
          card.buyScore,
          this.season.getCurrentSeason()
        );
        this.scoring.addScore(sellScore);
        this.handManager.sell(data.slot);
        this.qiManager.spend(3);
        this.qiManager.recover(8);  // 卖出即时回气
        this.lastAction = 'sell';
      }
      break;
    
    case 'wait':
      this.cardPool.returnPublicCards();
      this.lastAction = 'wait';
      break;
  }
  
  this.advanceTurn();  // 进入下一回合
}
```

### 关键接口

```typescript
// 公共方法（供外部调用）
startGame(): void;
getCurrentState(): State;
getTurn(): number;
isGameOver(): boolean;

// 事件 (via EventEmitter)
on(event: 'gameStarted', callback: () => void): void;
on(event: 'turnStarted', callback: (turn: number) => void): void;
on(event: 'turnEnded', callback: (turn: number) => void): void;
on(event: 'seasonChanged', callback: (season: string) => void): void;
on(event: 'seasonChecked', callback: (season: string, seasonRound: number) => void): void;
on(event: 'settlementCompleted', callback: (holdScore: number, qiCost: number) => void): void;
on(event: 'cardsDrawn', callback: (publicCards: JiaziCard[]) => void): void;
on(event: 'qiRecovered', callback: (newQi: number, recovered: number) => void): void;
on(event: 'playerActionRequired', callback: () => void): void;
on(event: 'gameEnded', callback: (finalScore: number, stats: any) => void): void;

// 私有状态
enum State { INIT, TURN_START, SEASON_CHECK, SETTLEMENT, DRAW, QI_RECOVER, PLAYER_ACTION, TURN_END, GAME_OVER }
private state: State = State.INIT;
private lastAction: string = '';
private turn: number = 1;
```

## Alternatives Considered

### Alternative 1: 全局单例 TurnManager

- **Description**: 将 TurnManager 注册为全局单例，所有模块直接访问 `TurnManager.instance`。
- **Pros**: 访问方便，不需要依赖传递。
- **Cons**: 测试困难（难以隔离），状态全局化，场景切换时生命周期管理复杂，违反"偏好场景组件而非单例"的通用原则。
- **Rejection Reason**: 游戏主循环是场景相关的，应该随游戏场景存在和销毁。单例模式会增加测试复杂度和场景切换时的状态残留风险。

### Alternative 2: 使用 Phaser 的定时器驱动回合

- **Description**: 不使用显式状态机，而是在 `update()` 中根据时间自动推进回合。
- **Pros**: 实现简单，自动定时。
- **Cons**: 无法处理玩家操作等待；回合步骤复杂（需要等待 UI 响应），时间驱动不适合回合制游戏；状态管理混乱。
- **Rejection Reason**: 甲子纪需要等待玩家输入，时间驱动无法实现"等待操作完成再继续"的流程。

### Alternative 3: 使用 XState 状态机库

- **Description**: 使用第三方状态机库如 XState。
- **Pros**: 可视化编辑，便于复杂状态机管理。
- **Cons**: 引入外部依赖，学习成本。本项目状态机只有 9 个状态，手动实现足够简单可靠。
- **Rejection Reason**: 不增加不必要的依赖；手动状态机代码清晰可控。

## Consequences

### Positive
- 状态转换逻辑集中在一个文件中，易于理解和调试。
- 通过 EventEmitter 与 UI 和其他系统解耦，支持未来扩展（如重播、调试工具）。
- 回合步骤顺序与 GDD 完全一致，通过代码可读性保证正确性。
- 不依赖第三方库，减少维护负担。

### Negative
- TurnManager 需要知道所有依赖模块的接口，耦合度较高（但这是回合制游戏主循环的本质）。
- 需要在多处手动 emit 事件，可能遗漏事件（通过单元测试覆盖）。
- 如果未来加入双人模式或联机，当前状态机需要较大的重构（但 MVP 不要求）。

### Risks
- **边缘情况处理不足风险**: 牌堆为空、手牌为空、气归零等场景需要额外逻辑。缓解：在 GDD 中已定义，单元测试覆盖每个状态转换。
- **性能风险**: 每回合多次事件发射和模块调用，但在 Phaser 中开销可以忽略不计（< 100μs）。
- **状态不一致风险**: 如果某个模块在 `SETTLEMENT` 阶段抛出异常，状态机可能卡住。缓解：使用 `try-catch` 确保状态转换前后状态一致。

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-turn-flow.md | 7步回合流程顺序 | 状态机严格按照 GDD 定义的顺序执行 |
| system-turn-flow.md | 季节检查在持仓结算之前 | SEASON_CHECK → SETTLEMENT 顺序强制执行 |
| system-turn-flow.md | 60 回合后游戏结束 | TURN_START 检查 turn > 60 时转到 GAME_OVER |
| system-turn-flow.md | 玩家操作三选一 | PLAYER_ACTION 状态等待 UI 事件，只处理 buy/sell/wait |
| system-hand-cards.md | 买入/卖出前提条件 | `onPlayerAction` 中显式检查 `canBuy()`/`canSell()` |
| system-qi-resource.md | 气回复逻辑 | QI_RECOVER 状态调用 `qiManager.recoverTurn(lastAction === 'wait')` |
| system-scoring.md | 持仓结算每回合自动执行 | SETTLEMENT 状态调用 `scoring.calculateHoldScore()` |
| system-leverage.md | 气归零爆仓 | SETTLEMENT 后调用 `checkMarginCall()` |
| system-card-pool.md | 每回合刷牌 | DRAW 状态调用 `cardPool.drawCards()` |

## Performance Implications
- **CPU**: 每回合约 20-30 次函数调用 + 事件发射，远低于 16.6ms 预算。
- **Memory**: 无额外分配，仅存储当前状态和回合计数。
- **Load Time**: 无影响。

## Migration Plan
不适用（首次实现）。

## Validation Criteria
- [ ] 单元测试：状态机按正确顺序执行所有 9 个状态。
- [ ] 单元测试：第 60 回合结束后触发 `gameEnded` 事件。
- [ ] 集成测试：玩家选择"买入"后，回合推进到下一回合。
- [ ] 集成测试：季节检查正确触发 `seasonChanged` 事件。
- [ ] 集成测试：气归零时调用 `checkMarginCall()`。
- [ ] 手动测试：完整运行一局 60 回合，无报错，分数累计正确。

## Related Decisions
- ADR-0003: EventEmitter 模块间通信架构（TurnManager 作为事件源）
