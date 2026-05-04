# ADR-0008: 杠杆系统 (Leverage System)

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core |
| **Knowledge Risk** | LOW (mathematical calculations, no engine APIs) |
| **References Consulted** | None |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Multiplier table must match GDD; test margin call logic with multiple leveraged cards |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0002 (Singleton vs Node), ADR-0005 (Qi resource), ADR-0007 (Hand management) |
| **Enables** | TurnFlow (hold cost calculation, margin call) |
| **Blocks** | None |
| **Ordering Note** | None |

## Context

### Problem Statement
šö▓ňşÉš║¬ features a leverage system that multiplies both gains and losses for cards bought with leverage. The multiplier increases as the season progresses (1.0x → 3.0x), creating a risk/reward trade-off. When Qi reaches zero while holding leveraged cards, a margin call forces a random leveraged card to be sold.

### Constraints
- Multiplier table: season round 1-3 → 1.0x, 4-6 → 1.5x, 7-9 → 2.0x, 10-11 → 2.5x, 12 → 3.0x
- Extra Qi cost for leverage: LQC = 10 (fixed, not multiplied)
- Hold Qi cost = max(0.5, 1.5 + 0.4 × score) × leverage
- Margin call: random forced sell when Qi = 0

### Requirements
- Calculate current leverage multiplier based on season round
- Provide hold Qi cost calculation
- Support margin call detection (actual forced sell orchestrated by TurnFlow)
- No persistent state (stateless calculator)

## Decision

### LeverageCalculator as Autoload (Stateless)

`LeverageCalculator` will be an Autoload singleton because it has no state — it only provides calculation functions. This follows the stateless utility pattern from ADR-0002.

### Public Interface

```gdscript
# LeverageCalculator.gd
extends Node

# Multiplier table: key = max round for that tier
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
    return 1.0

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