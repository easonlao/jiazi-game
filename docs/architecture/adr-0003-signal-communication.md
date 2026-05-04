# ADR-0003: 信号驱动的模块间通信

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core / Architecture |
| **Knowledge Risk** | LOW (signals are stable pre-4.3) |
| **References Consulted** | `docs/engine-reference/godot/current-best-practices.md` (signal-driven architecture) |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Signal connections must be established before they are emitted (test in `_ready()`) |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0001 (TurnFlow architecture), ADR-0002 (Singleton vs Node design) |
| **Enables** | All module implementation |
| **Blocks** | None |
| **Ordering Note** | None |

## Context

### Problem Statement
甲子纪 has multiple modules (TurnManager, HandManager, CardPoolManager, UIManager, QiManager, etc.) that need to communicate without tight coupling. Direct method calls create hard dependencies that make testing difficult and reduce flexibility. We need a consistent communication pattern that decouples producers from consumers.

### Constraints
- Modules must be testable in isolation
- New features (e.g., sound effects, achievements) should be able to listen to game events without modifying existing code
- Performance must remain within budget (signals are lightweight in Godot)
- Must support Web export (signals work identically across platforms)

### Requirements
- Low coupling between modules
- Easy to add new observers without changing observed modules
- Clear, documented signal signatures
- Signals must be defined before they can be connected

## Decision

### Signal-Driven Architecture

**All cross-module communication will use Godot signals.** Modules emit signals when their state changes or when events occur. Other modules connect to these signals to react.

**原则:**
- 数据流向: 生产者 → 信号 → 消费者
- 生产者不知道消费者的存在
- 消费者在 `_ready()` 中连接信号
- 信号在生产者模块中定义为 `signal`

### 核心信号定义

#### TurnManager (信号源)
```gdscript
# TurnManager.gd
signal turn_started(turn_number: int)
signal turn_ended(turn_number: int)
signal season_changed(new_season: String, old_season: String)
signal season_checked(season: String, season_round: int)
signal settlement_completed(hold_score: float, qi_cost: float)
signal cards_drawn(public_cards: Array)
signal qi_recovered(new_qi: int, recovered: int)
signal player_action_required()
signal game_ended(final_score: float, stats: Dictionary)
```

#### QiManager (信号源)
```gdscript
# QiManager.gd
signal qi_changed(new_qi: int, old_qi: int)
signal qi_depleted()  # Qi reaches 0
signal margin_call_triggered(card_name: String, slot: int)
```

#### ScoreManager (信号源)
```gdscript
# ScoreManager.gd
signal score_changed(new_score: float, delta: float)
```

#### HandManager (信号源)
```gdscript
# HandManager.gd
signal hand_updated(hand: Array)
signal card_bought(card_id: int, slot: int)
signal card_sold(card_id: int, slot: int, profit: float)
```

#### CardPoolManager (信号源)
```gdscript
# CardPoolManager.gd
signal cards_drawn(cards: Array)
signal deck_emptied()
```

#### SeasonCycle (信号源)
```gdscript
# SeasonCycle.gd
signal season_changed(new_season: String, old_season: String)
```

### 连接策略

**UIManager** 监听所有相关信号以更新界面：
```gdscript
# UIManager._ready()
TurnManager.turn_started.connect(_on_turn_started)
TurnManager.season_changed.connect(_on_season_changed)
TurnManager.settlement_completed.connect(_on_settlement_completed)
TurnManager.cards_drawn.connect(_update_public_cards)
TurnManager.qi_recovered.connect(_update_qi_bar)
TurnManager.player_action_required.connect(_enable_action_buttons)
TurnManager.game_ended.connect(_show_game_over)
QiManager.qi_changed.connect(_update_qi_bar)
QiManager.margin_call_triggered.connect(_show_margin_call_warning)
ScoreManager.score_changed.connect(_update_score_display)
HandManager.hand_updated.connect(_update_hand_display)
```

**其他模块间的信号连接:** (如果需要)
- `CardPoolManager` 可能监听 `TurnManager.cards_drawn` 来触发动画，但当前设计 TurnManager 直接调用 `CardPoolManager.draw_cards()` —— 这是直接方法调用，不是解耦。信号用于**通知**而非**请求**。

### 直接方法调用 vs 信号

| 场景 | 使用方式 | 示例 |
|------|----------|------|
| 请求/操作 (需要返回值) | 直接方法调用 | `hand_manager.can_buy()` |
| 状态变化通知 (无返回值) | 信号 | `turn_started` |
| UI 更新 (单向通知) | 信号 | `score_changed` |
| 模块间解耦的通知 | 信号 | `margin_call_triggered` |

TurnManager 作为主控制器，直接调用子模块的方法来执行操作，但通过信号通知外界状态变化。这保持了控制流的清晰和可测试性。

## Alternatives Considered

### Alternative 1: 全局事件总线

- **Description**: 创建一个 `EventBus` Autoload 单例，所有模块通过它发射和监听事件。
- **Pros**: 完全解耦，模块不需要知道信号来源。
- **Cons**: 全局命名空间冲突；信号定义散落在各处；调试困难（不知道谁发射了信号）。
- **Rejection Reason**: Godot 原生信号已经足够，添加额外抽象层增加复杂度。

### Alternative 2: 直接方法调用 + 回调

- **Description**: 模块间通过直接方法调用通信，使用回调函数处理异步通知。
- **Pros**: 简单直接，类型安全。
- **Cons**: 导致紧耦合；新增观察者需要修改被调用代码。
- **Rejection Reason**: 违反开闭原则，不利于扩展（如添加音效、成就）。

## Consequences

### Positive
- 模块解耦，易于单独测试。
- 易于添加新的监听器（如成就系统、音效系统）而不修改现有代码。
- 符合 Godot 推荐的架构模式。

### Negative
- 信号连接代码需要写在 `_ready()` 中，增加样板代码。
- 信号参数类型没有编译时检查（运行时检查）。
- 过多的信号可能导致性能轻微下降（但在本项目中可忽略）。

### Risks
- **信号连接顺序风险**: 如果消费者在生产者发射信号后才连接，会错过信号。缓解：确保所有连接在 `_ready()` 中完成，TurnManager 在场景树准备好后才开始游戏。
- **信号滥用风险**: 过度使用信号会使数据流难以追踪。缓解：仅将信号用于“通知”而非“请求”；保持信号命名清晰。

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-ui-rendering.md | UI updates on score, qi, hand changes | UIManager listens to signals and updates display |
| system-turn-flow.md | Player action required signal | `player_action_required()` signal enables UI buttons |
| system-leverage.md | Margin call notification | `margin_call_triggered()` signal for UI warning |
| system-qi-resource.md | Qi depletion event | `qi_depleted()` signal for game over check |

## Performance Implications
- **CPU**: Signal emissions are function calls with minimal overhead (~50-100ns per signal).  
- **Memory**: Each signal connection stores a Callable object (negligible).
- **Load Time**: Connections established during `_ready()` add negligible startup cost.

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] All cross-module notifications use signals (no direct method calls for one-way notifications).
- [ ] All signals are connected before game starts (test: disable a module and verify signal is still emitted).
- [ ] Adding a new listener (e.g., sound system) requires no changes to existing signal emitters.

## Related Decisions
- ADR-0001: 游戏状态管理与回合流程架构 (TurnManager as signal source)
- ADR-0002: 单例与节点式模块设计 (which modules are Autoloads vs scene nodes)