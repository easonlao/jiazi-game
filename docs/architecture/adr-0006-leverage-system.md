# ADR-0006: 杠杆系统

## 状态
已接受

## 日期
2026-05-04

## 引擎兼容性

| 字段 | 值 |
|-------|-------|
| **引擎** | Phaser 3.90.0 |
| **领域** | 核心 |
| **知识风险** | 低（数学计算，无引擎 API） |
| **参考文档** | 无 |
| **后续版本 API** | 无 |
| **验证需求** | 倍数表必须匹配 GDD；测试多张杠杆牌的强制平仓逻辑 |

## ADR 依赖关系

| 字段 | 值 |
|-------|-------|
| **依赖** | ADR-0004（气资源）、ADR-0007（手牌管理） |
| **启用** | TurnManager（持仓成本计算、强制平仓） |
| **阻塞** | 无 |
| **顺序说明** | 应在手牌管理 ADR 之后创建，以获得完整上下文 |

## 背景

### 问题陈述
甲子纪具有杠杆系统，用于放大使用杠杆购买的卡牌的收益和损失。倍数随着季节的进展而增加（1.0x → 3.0x），创造风险/回报的权衡。当持有杠杆牌时气归零，强制平仓会强制随机出售一张杠杆牌。

### 约束条件
- 倍数表：季节回合 1-3 → 1.0x，4-6 → 1.5x，7-9 → 2.0x，10-11 → 2.5x，12 → 3.0x
- 杠杆额外气成本：LQC = 10（固定，不乘以倍数）
- 持仓气成本 = max(0.5, 1.5 + 0.4 × 评分) × 杠杆
- 强制平仓：气 = 0 时随机强制卖出

### 需求
- 根据季节回合计算当前杠杆倍数
- 提供持仓气成本计算
- 支持强制平仓检测（实际的强制卖出由 TurnManager 编排）
- 无持久状态（无状态计算器）

## Decision

### LeverageCalculator as Autoload (Stateless)

`LeverageCalculator` will be an Autoload singleton because it has no state — it only provides calculation functions. This follows the stateless utility pattern from ADR-0002.

### Public Interface

```gdscript
# LeverageCalculator.gd
extends Node

# Multiplier table: key = max round for this tier
const MULTIPLIER_TABLE: Array[Dictionary] = [
    {"max_round": 3, "multiplier": 1.0},
    {"max_round": 6, "multiplier": 1.5},
    {"max_round": 9, "multiplier": 2.0},
    {"max_round": 11, "multiplier": 2.5},
    {"max_round": 12, "multiplier": 3.0}
]

const LEVERAGE_EXTRA_COST: int = 10  # LQC

# Returns leverage multiplier for given season round (1-12)
func get_multiplier(season_round: int) -> float:
    for tier in MULTIPLIER_TABLE:
        if season_round <= tier["max_round"]:
            return tier["multiplier"]
    return 1.0  # fallback

# Returns the extra Qi cost for using leverage
func get_extra_qi_cost() -> int:
    return LEVERAGE_EXTRA_COST

# Returns the hold Qi cost per turn for a card
func calculate_hold_qi_cost(card_score: float, leverage: float) -> float:
    var base = max(0.5, 1.5 + 0.4 * card_score)
    return base * leverage

# Returns whether leverage is available at this season round
func is_leverage_available(season_round: int) -> bool:
    return get_multiplier(season_round) > 1.0
```

### Integration Example

```gdscript
# TurnFlow.gd (during hold settlement)
func _settle_holdings() -> void:
    var total_hold_score: float = 0.0
    var total_qi_cost: float = 0.0
    for slot in hand_manager.get_hand():
        if slot == null:
            continue
        var card_score = scoring.calculate_card_score(slot.card, season_cycle.get_current_season())
        var hold_score = scoring.HOLD_BONUS * card_score * slot.leverage
        var qi_cost = leverage_calculator.calculate_hold_qi_cost(card_score, slot.leverage)
        total_hold_score += hold_score
        total_qi_cost += qi_cost
        slot.hold_earnings += hold_score
    scoring.add_score(total_hold_score)
    qi_manager.spend(int(total_qi_cost))  # Qi cost deducted after hold scoring
    _check_margin_call()
```

## Alternatives Considered

### Alternative 1: Store multiplier logic in SeasonCycle

- **Description**: Put multiplier calculation inside SeasonCycle.
- **Pros**: One fewer file.
- **Cons**: SeasonCycle already manages season state; adding multiplier logic violates single responsibility.
- **Rejection Reason**: Leverage is a distinct system with its own rules (margin call, extra cost).

### Alternative 2: Hardcode multiplier in TurnFlow

- **Description**: TurnFlow contains if-else chain for multiplier.
- **Pros**: Simplest, no extra class.
- **Cons**: Violates separation of concerns; duplication if multiple systems need multiplier.
- **Rejection Reason**: Scoring and Qi cost both need multiplier; centralizing avoids duplication.

## Consequences

### Positive
- Stateless, easy to test.
- Centralized multiplier logic; changes affect all consumers.
- Clear separation from season management.

### Negative
- One more Autoload (but trivial).

### Risks
- None significant.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-leverage.md | Multiplier table (1.0→1.5→2.0→2.5→3.0) | `MULTIPLIER_TABLE` and `get_multiplier()` |
| system-leverage.md | LQC fixed extra cost | `LEVERAGE_EXTRA_COST` constant |
| system-leverage.md | Hold Qi cost formula | `calculate_hold_qi_cost()` |
| system-leverage.md | Margin call on Qi=0 | TurnFlow uses `has_leverage_cards()` and `get_random_leverage_slot()` from HandManager |

## Performance Implications
- **CPU**: O(5) table lookup per multiplier request; negligible.
- **Memory**: Negligible.

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] Unit test: get_multiplier(1) == 1.0, get_multiplier(3) == 1.0
- [ ] Unit test: get_multiplier(4) == 1.5, get_multiplier(6) == 1.5
- [ ] Unit test: get_multiplier(7) == 2.0, get_multiplier(9) == 2.0
- [ ] Unit test: get_multiplier(10) == 2.5, get_multiplier(11) == 2.5
- [ ] Unit test: get_multiplier(12) == 3.0
- [ ] Unit test: calculate_hold_qi_cost(4.0, 2.0) == max(0.5, 1.5+1.6)*2.0 = 3.1*2.0 = 6.2
- [ ] Unit test: calculate_hold_qi_cost(-3.0, 2.0) == max(0.5, 1.5-1.2)*2.0 = 0.5*2.0 = 1.0

## Related Decisions
- ADR-0002: Singleton vs Node design (LeverageCalculator as Autoload)
- ADR-0005: Qi resource management (integrates hold cost)
- ADR-0007: Hand management (provides leverage cards for margin call)
