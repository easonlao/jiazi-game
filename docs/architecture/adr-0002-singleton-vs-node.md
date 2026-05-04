# ADR-0002: 单例与节点式模块设计

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core / Architecture |
| **Knowledge Risk** | LOW (principles based on best practices, not post-cutoff APIs) |
| **References Consulted** | `docs/engine-reference/godot/current-best-practices.md` (signal-driven architecture, lazy loading) |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Autoload load order (Godot processes in editor order) must ensure data providers before consumers |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | None |
| **Enables** | ADR-0003 (Signal-Based Communication), ADR-0004 (Card Data Structure) |
| **Blocks** | Implementation of all modules |
| **Ordering Note** | This ADR should be Accepted before any module implementation begins, as it determines how modules are instantiated and referenced. |

## Context

### Problem Statement
Godot offers two primary ways to create globally accessible modules: Autoloads (global singletons) and scene-attached nodes. Each has different lifecycle, testability, and coupling characteristics. 甲子纪 has modules with varied needs — some are pure data/stateless, others maintain session state tied to the game scene. We need a consistent principle for assigning each module to either pattern.

### Constraints
- Modules must be accessible where needed without excessive coupling
- Testing must be possible in isolation (unit tests) and integration
- Web export must support deterministic startup order
- Future save/load requires ability to reset or recreate some modules between sessions

### Requirements
- **Data-only modules** (card definitions, constants) must be readable from anywhere without side effects
- **Stateful core modules** (hand, deck, turn state) must be tied to game session lifetime — destroyed when game ends, recreated for new game
- **Utility modules** (leverage calculator, scoring formulas) can be stateless or pure functions
- **UI modules** are inherently scene-bound

## Decision

### 分离原则

| 模块类型 | 实现方式 | 生命周期 | 示例 |
|----------|----------|----------|------|
| **只读数据/全局状态** | Autoload (单例) | 整个应用生命周期 | JiaziCardsData, SeasonCycle, QiResource, ScoreManager, LeverageCalculator |
| **会话状态/UI绑定** | 场景节点 | 随游戏场景创建/销毁 | TurnManager, HandManager, CardPoolManager, UIManager |

### Autoload 模块（全局单例）

以下模块注册为 Godot Autoload：

```gdscript
# project.godot (Autoload section)
CardDataBank = "res://core/data/card_data_bank.gd"
SeasonCycle = "res://core/season/season_cycle.gd"
QiManager = "res://core/qi/qi_manager.gd"
ScoreManager = "res://core/scoring/score_manager.gd"
LeverageCalculator = "res://core/leverage/leverage_calculator.gd"
```

**职责与理由：**

| Autoload | 理由 |
|----------|------|
| `CardDataBank` | 纯数据，60张卡牌定义，无状态变化，全局只读 |
| `SeasonCycle` | 季节是全局状态，与具体场景无关；保存/加载时需要持久化 |
| `QiManager` | 气是全局资源；保存/加载时需要持久化 |
| `ScoreManager` | 分数是全局累计；保存/加载时需要持久化 |
| `LeverageCalculator` | 无状态计算器，纯函数，方便的全局工具 |

### 场景节点模块

以下模块作为场景树的一部分存在，位于游戏场景根节点下：

```
GameScene (Node2D)
├── TurnManager (Node)
├── HandManager (Node)
├── CardPoolManager (Node)
├── UIManager (CanvasLayer)
└── (其他UI节点)
```

**职责与理由：**

| 节点模块 | 理由 |
|----------|------|
| `TurnManager` | 游戏主循环状态机，生命周期绑定到当前对局 |
| `HandManager` | 手牌状态，每局独立，不应跨会话存活 |
| `CardPoolManager` | 牌堆状态，每局独立，不应跨会话存活 |
| `UIManager` | UI元素，绑定到当前游戏画面 |

### 访问方式

**Autoload 访问：**
```gdscript
# 从任何地方直接访问
var card = CardDataBank.get_card(1)
var season = SeasonCycle.get_current_season()
qi_manager.spend(10)
```

**场景节点访问：**
```gdscript
# TurnManager 持有子节点引用
@onready var hand_manager: HandManager = $HandManager
@onready var card_pool: CardPoolManager = $CardPoolManager

# UI 通过信号与 TurnManager 通信，不直接引用
# TurnManager 发出信号，UIManager 监听
```

### 初始化顺序保证

Autoload 按 `project.godot` 中的顺序加载。必须保证：
1. `CardDataBank` 最先加载（无依赖）
2. `SeasonCycle`, `LeverageCalculator` 次之
3. `QiManager`, `ScoreManager` 依赖以上数据，在之后加载

场景节点在 `_ready()` 中假设 Autoload 已可用（Godot 保证 Autoload 在场景 `_ready()` 之前加载）。

### 测试策略

**单元测试 Autoload：** 可直接实例化，不依赖场景树。
```gdscript
var qi_manager = QiManager.new()
qi_manager.recover(10)
assert(qi_manager.get_qi() == 60)  # 初始50 + 10
```

**集成测试场景节点：** 需要创建测试场景，实例化 HandManager 等节点，并手动注入依赖（通过属性设置）。

## Alternatives Considered

### Alternative 1: 全部使用 Autoload

- **Description**: 将所有模块（包括 HandManager, TurnManager）注册为 Autoload。
- **Pros**: 访问简单，不需要节点引用。
- **Cons**: 模块生命周期失控，无法在游戏结束后销毁状态；测试困难（全局状态残留）；Godot 推荐“尽量少用 Autoload”。
- **Rejection Reason**: 违反 Godot 最佳实践，导致多局游戏间状态无法重置。

### Alternative 2: 全部使用场景节点 + 手动依赖注入

- **Description**: 将所有模块（甚至数据模块）都作为场景节点，通过手动传递引用来连接。
- **Pros**: 完全控制生命周期，易于测试。
- **Cons**: 大量样板代码传递引用；纯数据模块不需要生命周期管理；`CardDataBank` 会在每个场景中重复实例化造成浪费。
- **Rejection Reason**: 过度工程，对只读数据模块不适合。

## Consequences

### Positive
- 职责清晰：数据/全局状态通过单例访问，会话状态通过场景节点管理。
- 游戏结束后可以销毁整个场景，确保新对局状态干净。
- Autoload 模块可以单独测试。
- 符合 Godot 社区推荐模式。

### Negative
- 需要维护 Autoload 列表和加载顺序。
- 场景节点间通过信号通信增加了设置信号连接的代码（但这是解耦的好处）。
- 新手可能困惑于何时用单例、何时用节点引用。

### Risks
- **加载顺序风险**: 如果 `QiManager` 在 `CardDataBank` 之前加载，且 `QiManager._ready()` 中尝试读取卡牌数据，会出错。缓解：在 `project.godot` 中明确排序，且不要在 Autoload 的 `_ready()` 中依赖其他 Autoload —— 改用 `_init()` 或延迟访问。
- **过度使用单例的风险**: 未来如果新需求需要多个同时存在的游戏会话（如双人、热切换），当前设计不支持。缓解：当前项目为单人单会话，若需求变更，可重构；ADR 记录了这一权衡。

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-turn-flow.md | TurnManager 作为游戏主循环 | TurnManager 作为场景节点，生命周期绑定对局 |
| system-hand-cards.md | 手牌状态每局独立 | HandManager 作为场景节点，游戏结束后销毁 |
| system-qi-resource.md | 气资源全局共享 | QiManager 作为 Autoload，跨场景保持 |
| system-scoring.md | 分数全局累计 | ScoreManager 作为 Autoload |
| system-jiazi-cards.md | 卡牌数据只读 | CardDataBank 作为 Autoload，全局只读访问 |

## Performance Implications
- **CPU**: 无额外开销；Autoload 访问是直接函数调用。
- **Memory**: Autoload 常驻内存，但数据模块很小（60张卡片数据 < 50KB）。
- **Load Time**: 场景节点在游戏开始时实例化，正常开销。

## Migration Plan
不适用（首次实现）。

## Validation Criteria
- [ ] 所有 Autoload 模块按正确顺序加载，无空引用错误。
- [ ] 游戏结束后，场景节点销毁，Autoload 模块保持状态或正确重置。
- [ ] 单元测试可以直接实例化 Autoload 模块并测试方法。
- [ ] 集成测试可以创建游戏场景，验证 HandManager 等节点正常工作。

## Related Decisions
- ADR-0001: 游戏状态管理与回合流程架构（TurnManager 作为场景节点）
- ADR-0003: 信号驱动的模块间通信（定义 Autoload 与场景节点间的信号边界）