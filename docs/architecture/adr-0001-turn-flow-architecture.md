# ADR-0001: 游戏状态管理与回合流程架构

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core |
| **Knowledge Risk** | LOW (core state machine logic, no post-cutoff API dependencies) |
| **References Consulted** | `docs/engine-reference/godot/current-best-practices.md` (signal-driven architecture, state machines) |
| **Post-Cutoff APIs Used** | None (uses signals, Timer, SceneTree — all stable pre-4.3) |
| **Verification Required** | Season length generation (random 3-12 per season) must fill exactly 60 turns; verify turn order matches GDD |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | None |
| **Enables** | ADR-0002 (Singleton vs Node-based Module Design), ADR-0003 (Signal-Based Communication) |
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
- 必须通过信号通知 UI 更新，避免 UI 模块直接轮询状态
- 必须支持保存/加载游戏状态（未来扩展）
- 必须正确处理边缘情况：牌堆为空、手牌为空、气归零爆仓等
- 性能：回合状态转换开销 < 1ms per turn

## Decision

### 核心架构

**TurnManager** 作为游戏主循环的根节点，采用有限状态机管理回合流程。它不是一个全局单例（Autoload），而是作为场景树根节点存在，通过 `_ready()` 初始化所有依赖模块，并通过信号向外通信。

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

### 状态转换与信号

| 当前状态 | 触发条件 | 下一状态 | 发出的信号 |
|----------|----------|----------|------------|
| INIT | `start_game()` 调用 | SEASON_CHECK | `game_started()` |
| TURN_START | 回合计数器 ≤ 60 | SEASON_CHECK | `turn_started(turn_number)` |
| TURN_START | 回合计数器 > 60 | GAME_OVER | `game_over(final_score)` |
| SEASON_CHECK | 季节未结束 | SETTLEMENT | `season_checked(season, season_round)` |
| SEASON_CHECK | 季节结束，切换后 | SETTLEMENT | `season_changed(new_season)` |
| SETTLEMENT | 结算完成 | DRAW | `settlement_completed(hold_score, qi_cost)` |
| DRAW | 刷牌完成 | QI_RECOVER | `cards_drawn(public_cards)` |
| QI_RECOVER | 回气完成 | PLAYER_ACTION | `qi_recovered(new_qi)` |
| PLAYER_ACTION | 玩家选择操作 | TURN_END | `player_action(action, data)` |
| TURN_END | 回合计数增加 | TURN_START | `turn_ended(turn_number)` |
| GAME_OVER | — | — | `game_ended(final_score, stats)` |

### 依赖注入方式

TurnManager 通过 `@onready var` 引用场景树中的子节点（HandManager, CardPoolManager, UIManager 等），以及通过 `get_node("/root/QiManager")` 获取全局单例（Qi, Scoring, SeasonCycle, JiaziCardsData）。

```gdscript
# TurnManager.gd
extends Node

# 依赖的全局单例
@onready var qi_manager: QiManager = get_node("/root/QiManager")
@onready var scoring: ScoreManager = get_node("/root/ScoreManager")
@onready var season: SeasonCycle = get_node("/root/SeasonCycle")
@onready var card_data: CardDataBank = get_node("/root/CardDataBank")

# 依赖的场景子节点（由场景树提供）
@onready var hand_manager: HandManager = $HandManager
@onready var card_pool: CardPoolManager = $CardPoolManager
@onready var ui_manager: UIManager = $UIManager
@onready var leverage: LeverageCalculator = get_node("/root/LeverageCalculator")
```

### 回合推进核心逻辑

```gdscript
func _advance_turn() -> void:
    match _state:
        State.INIT:
            _init_game()
            _set_state(State.SEASON_CHECK)
        
        State.TURN_START:
            if turn > MAX_TURNS:
                _set_state(State.GAME_OVER)
                return
            emit_signal("turn_started", turn)
            _set_state(State.SEASON_CHECK)
        
        State.SEASON_CHECK:
            if season.is_season_end():
                season.advance_season()
                emit_signal("season_changed", season.get_current_season())
            emit_signal("season_checked", season.get_current_season(), season.get_season_round())
            _set_state(State.SETTLEMENT)
        
        State.SETTLEMENT:
            var hold_score = scoring.calculate_hold_score(hand_manager.get_hand(), season.get_current_season())
            var qi_cost = _calculate_hold_qi_cost(hand_manager.get_hand(), season.get_current_season())
            qi_manager.spend(qi_cost)
            _check_margin_call()  # 检查爆仓
            emit_signal("settlement_completed", hold_score, qi_cost)
            _set_state(State.DRAW)
        
        State.DRAW:
            var public_cards = card_pool.draw_cards()
            emit_signal("cards_drawn", public_cards)
            _set_state(State.QI_RECOVER)
        
        State.QI_RECOVER:
            var recovered = qi_manager.recover_turn(_last_action == "wait")
            emit_signal("qi_recovered", qi_manager.get_qi(), recovered)
            _set_state(State.PLAYER_ACTION)
        
        State.PLAYER_ACTION:
            emit_signal("player_action_required")
            # 等待 UI 调用 _on_player_action() 后推进
        
        State.TURN_END:
            turn += 1
            season.advance_round()
            _last_action = null
            emit_signal("turn_ended", turn)
            _set_state(State.TURN_START)
```

### 玩家操作处理

UI 通过信号 `action_selected` 将操作传回 TurnManager，TurnManager 验证后调用对应模块，然后调用 `_advance_turn()` 继续。

```gdscript
func _on_player_action(action: String, data: Variant) -> void:
    if _state != State.PLAYER_ACTION:
        return
    
    match action:
        "buy":
            if hand_manager.can_buy() and qi_manager.can_afford(_get_buy_cost(data.card)):
                var leverage_mult = leverage.get_current_multiplier(season.get_season_round())
                hand_manager.buy(data.card, leverage_mult, data.buy_score)
                card_pool.buy_card(data.index)
                _last_action = "buy"
        
        "sell":
            if hand_manager.can_sell() and qi_manager.can_afford(3):
                var card = hand_manager.get_hand()[data.slot]
                var sell_score = scoring.calculate_sell_score(card.card, card.buy_score, season.get_current_season())
                scoring.add_score(sell_score)
                hand_manager.sell(data.slot)
                qi_manager.spend(3)
                qi_manager.recover(8)  # 卖出即时回气
                _last_action = "sell"
        
        "wait":
            card_pool.return_public_cards()
            _last_action = "wait"
    
    _advance_turn()  # 进入下一回合
```

### 关键接口

```gdscript
# 公共方法（供外部调用）
func start_game() -> void
func get_current_state() -> State
func get_turn() -> int
func is_game_over() -> bool

# 信号
signal game_started()
signal turn_started(turn: int)
signal turn_ended(turn: int)
signal season_changed(season: String)
signal season_checked(season: String, season_round: int)
signal settlement_completed(hold_score: float, qi_cost: float)
signal cards_drawn(public_cards: Array)
signal qi_recovered(new_qi: int, recovered: int)
signal player_action_required()
signal game_ended(final_score: float, stats: Dictionary)

# 私有状态
enum State { INIT, TURN_START, SEASON_CHECK, SETTLEMENT, DRAW, QI_RECOVER, PLAYER_ACTION, TURN_END, GAME_OVER }
var _state: State = State.INIT
var _last_action: String = ""
var turn: int = 1
```

## Alternatives Considered

### Alternative 1: 全局单例 TurnManager

- **Description**: 将 TurnManager 注册为 Autoload 单例，所有模块直接访问 `TurnManager.singleton`。
- **Pros**: 访问方便，不需要节点引用传递。
- **Cons**: 测试困难（难以隔离），状态全局化，场景切换时生命周期管理复杂，违反"偏好场景节点而非单例"的通用原则。
- **Rejection Reason**: 游戏主循环是场景相关的，应该随游戏场景存在和销毁。单例模式会增加测试复杂度和场景切换时的状态残留风险。

### Alternative 2: 使用 Godot 的 `SceneTree` 定时器驱动回合

- **Description**: 不使用显式状态机，而是在 `_process(delta)` 中根据时间自动推进回合。
- **Pros**: 实现简单，自动定时。
- **Cons**: 无法处理玩家操作等待；回合步骤复杂（需要等待 UI 响应），时间驱动不适合回合制游戏；状态管理混乱。
- **Rejection Reason**: 甲子纪需要等待玩家输入，时间驱动无法实现"等待操作完成再继续"的流程。

### Alternative 3: 使用 Plugin 提供的 StateChart 节点

- **Description**: 第三方插件如 `godot-state-machine`、`Beehave` 等提供可视化状态机节点。
- **Pros**: 可视化编辑，便于复杂状态机管理。
- **Cons**: 引入外部依赖，学习成本，版本兼容性风险。本项目状态机只有 9 个状态，手动实现足够简单可靠。
- **Rejection Reason**: 不增加不必要的依赖；手动状态机代码清晰可控。

## Consequences

### Positive
- 状态转换逻辑集中在一个文件中，易于理解和调试。
- 通过信号与 UI 和其他系统解耦，支持未来扩展（如重播、调试工具）。
- 回合步骤顺序与 GDD 完全一致，通过代码可读性保证正确性。
- 不依赖第三方库，减少维护负担。

### Negative
- TurnManager 需要知道所有依赖模块的接口，耦合度较高（但这是回合制游戏主循环的本质）。
- 需要在多处手动调用 `emit_signal`，可能遗漏信号（通过单元测试覆盖）。
- 如果未来加入双人模式或联机，当前状态机需要较大的重构（但 MVP 不要求）。

### Risks
- **边缘情况处理不足风险**: 牌堆为空、手牌为空、气归零等场景需要额外逻辑。缓解：在 GDD 中已定义，单元测试覆盖每个状态转换。
- **性能风险**: 每回合多次信号发射和模块调用，但在 Godot 中开销可以忽略不计（< 100μs）。
- **状态不一致风险**: 如果某个模块在 `SETTLEMENT` 阶段抛出异常，状态机可能卡住。缓解：使用 `try-catch` 或 `assert` 确保状态转换前后状态一致。

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-turn-flow.md | 7步回合流程顺序 | 状态机严格按照 GDD 定义的顺序执行 |
| system-turn-flow.md | 季节检查在持仓结算之前 | SEASON_CHECK → SETTLEMENT 顺序强制执行 |
| system-turn-flow.md | 60 回合后游戏结束 | TURN_START 检查 turn > 60 时转到 GAME_OVER |
| system-turn-flow.md | 玩家操作三选一 | PLAYER_ACTION 状态等待 UI 信号，只处理 buy/sell/wait |
| system-hand-cards.md | 买入/卖出前提条件 | `_on_player_action` 中显式检查 `can_buy()`/`can_sell()` |
| system-qi-resource.md | 气回复逻辑 | QI_RECOVER 状态调用 `qi_manager.recover_turn(_last_action == "wait")` |
| system-scoring.md | 持仓结算每回合自动执行 | SETTLEMENT 状态调用 `scoring.calculate_hold_score()` |
| system-leverage.md | 气归零爆仓 | SETTLEMENT 后调用 `_check_margin_call()` |
| system-card-pool.md | 每回合刷牌 | DRAW 状态调用 `card_pool.draw_cards()` |

## Performance Implications
- **CPU**: 每回合约 20-30 次函数调用 + 信号发射，远低于 16.6ms 预算。
- **Memory**: 无额外分配，仅存储当前状态和回合计数。
- **Load Time**: 无影响。

## Migration Plan
不适用（首次实现）。

## Validation Criteria
- [ ] 单元测试：状态机按正确顺序执行所有 9 个状态。
- [ ] 单元测试：第 60 回合结束后触发 `game_ended` 信号。
- [ ] 集成测试：玩家选择“买入”后，回合推进到下一回合。
- [ ] 集成测试：季节检查正确触发 `season_changed` 信号。
- [ ] 集成测试：气归零时调用 `_check_margin_call()`。
- [ ] 手动测试：完整运行一局 60 回合，无报错，分数累计正确。

## Related Decisions
- ADR-0002: 单例与节点式模块设计（TurnManager 作为场景节点）
- ADR-0003: 模块间信号通信架构（TurnManager 作为信号源）