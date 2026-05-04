# ADR-0007: Ńé½Ńâ╝Ńâëš«íšÉć (Hand Management)

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core |
| **Knowledge Risk** | LOW (standard data structures) |
| **References Consulted** | None |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Hand slot count must never exceed 3; unit test all edge cases |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0002 (Singleton vs Node), ADR-0004 (Card data), ADR-0005 (Qi resource), ADR-0006 (Card pool) |
| **Enables** | TurnFlow (player actions), Scoring (sell scoring) |
| **Blocks** | None |
| **Ordering Note** | None |

## Context

### Problem Statement
šö▓ňşÉš║¬ requires a hand management system that holds the player's cards (max 3 slots). Cards can be bought (from public pool) or sold (to gain score). Each slot stores the card, its purchase score, leverage multiplier, and cumulative hold earnings. The hand directly affects scoring calculations each turn.

### Constraints
- Max hand size: 3 cards
- Cannot buy if hand full
- Cannot sell if hand empty
- Sell costs 3 qi, recovers 8 qi immediately
- Hold score and qi cost are calculated each turn based on current season and leverage

### Requirements
- Enforce hand size limits
- Store card + metadata (buyScore, leverage, buyRound, holdEarnings)
- Provide buy/sell operations
- Expose hand data for UI and scoring systems
- Support forced sells (margin call)

## Decision

### HandManager as Scene Node

`HandManager` will be a child of the game scene (not an Autoload) because its state is session-specific and must reset between games.

### Data Structures

```gdscript
# HandSlot.gd (custom resource or simple class)
class_name HandSlot
extends RefCounted

var card: JiaziCard
var buy_score: float      # card score at purchase time (for sell calculation)
var leverage: float       # leverage multiplier used at purchase (1.0 = no leverage)
var buy_round: int        # turn number when bought (for display/statistics)
var hold_earnings: float  # cumulative hold score earned so far (for statistics)
```

### Public Interface

```gdscript
# HandManager.gd
extends Node

signal hand_updated(hand: Array)
signal card_bought(card: JiaziCard, slot: int)
signal card_sold(card: JiaziCard, slot: int, profit: float)

const MAX_HAND_SIZE: int = 3

var _hand: Array[HandSlot] = []   # fixed size MAX_HAND_SIZE, null = empty

func _ready() -> void:
    clear_hand()

func clear_hand() -> void:
    _hand.clear()
    _hand.resize(MAX_HAND_SIZE)
    for i in range(MAX_HAND_SIZE):
        _hand[i] = null

func get_hand() -> Array[HandSlot]:
    return _hand.duplicate()

func get_hand_size() -> int:
    var count = 0
    for slot in _hand:
        if slot != null:
            count += 1
    return count

func can_buy() -> bool:
    return get_hand_size() < MAX_HAND_SIZE

func can_sell() -> bool:
    return get_hand_size() > 0

# Buy a card; returns true if successful
func buy(card: JiaziCard, leverage: float, buy_score: float, turn: int) -> bool:
    if not can_buy():
        return false
    var slot = HandSlot.new()
    slot.card = card
    slot.buy_score = buy_score
    slot.leverage = leverage
    slot.buy_round = turn
    slot.hold_earnings = 0.0
    # Add to first empty slot
    for i in range(MAX_HAND_SIZE):
        if _hand[i] == null:
            _hand[i] = slot
            break
    hand_updated.emit(get_hand())
    card_bought.emit(card, i)
    return true

# Sell card from slot; returns the sold card and its slot index
func sell(slot_index: int) -> JiaziCard:
    if slot_index < 0 or slot_index >= MAX_HAND_SIZE:
        return null
    if _hand[slot_index] == null:
        return null
    var slot = _hand[slot_index]
    _hand[slot_index] = null
    hand_updated.emit(get_hand())
    card_sold.emit(slot.card, slot_index, 0.0)  # profit calculated by caller
    return slot.card

# Get card at slot (null if empty)
func get_card_at(slot_index: int) -> HandSlot:
    if slot_index < 0 or slot_index >= MAX_HAND_SIZE:
        return null
    return _hand[slot_index]

# For margin call: get random slot that has a leveraged card
func get_random_leverage_slot() -> int:
    var leverage_slots: Array[int] = []
    for i in range(MAX_HAND_SIZE):
        if _hand[i] != null and _hand[i].leverage > 1.0:
            leverage_slots.append(i)
    if leverage_slots.is_empty():
        return -1
    return leverage_slots[randi() % leverage_slots.size()]

func has_leverage_cards() -> bool:
    for slot in _hand:
        if slot != null and slot.leverage > 1.0:
            return true
    return false
```

### Integration with Other Systems

**Buy flow (TurnFlow calls):**
```gdscript
# TurnFlow.gd (buy action)
func _on_player_buy(card: JiaziCard, public_index: int, use_leverage: bool) -> void:
    var card_score = scoring.calculate_card_score(card, season_cycle.get_current_season())
    var cost = qi_manager.get_buy_cost(card_score, use_leverage)
    if not qi_manager.can_afford(cost):
        return
    var leverage_mult = 1.0
    if use_leverage:
        leverage_mult = leverage.get_current_multiplier(season_cycle.get_season_round())
    qi_manager.spend(cost)
    hand_manager.buy(card, leverage_mult, card_score, turn)
    card_pool.buy_card(public_index)
```

**Sell flow:**
```gdscript
# TurnFlow.gd (sell action)
func _on_player_sell(slot: int) -> void:
    var hand_slot = hand_manager.get_card_at(slot)
    if hand_slot == null:
        return
    if not qi_manager.can_afford(3):
        return
    var sell_score = scoring.calculate_sell_score(hand_slot.card, hand_slot.buy_score, season_cycle.get_current_season(), hand_slot.leverage)
    qi_manager.spend(3)
    qi_manager.recover(8)
    scoring.add_score(sell_score)
    hand_manager.sell(slot)
```

**Margin call (forced sell):**
```gdscript
# TurnFlow.gd (after hold settlement if qi == 0)
func _check_margin_call() -> void:
    while qi_manager.get_qi() == 0 and hand_manager.has_leverage_cards():
        var slot = hand_manager.get_random_leverage_slot()
        var hand_slot = hand_manager.get_card_at(slot)
        var sell_score = scoring.calculate_sell_score(hand_slot.card, hand_slot.buy_score, season_cycle.get_current_season(), hand_slot.leverage)
        scoring.add_score(sell_score)
        # Note: forced sell does NOT cost qi or recover qi
        hand_manager.sell(slot)
        qi_manager.margin_call_triggered.emit(hand_slot.card.name, slot)
```

## Alternatives Considered

### Alternative 1: Autoload HandManager

- **Description**: Make HandManager an Autoload singleton.
- **Pros**: Easy access from anywhere.
- **Cons**: State persists between game sessions; requires manual reset.
- **Rejection Reason**: Violates session-state principle (ADR-0002).

### Alternative 2: Store hand in TurnManager

- **Description**: No separate manager; TurnManager owns hand array directly.
- **Pros**: One fewer file.
- **Cons**: Violates separation of concerns; TurnFlow becomes bloated.
- **Rejection Reason**: Hand logic is complex enough to warrant its own class.

## Consequences

### Positive
- Clear ownership of hand state.
- Easy to unit test in isolation.
- Hand state naturally resets when game scene is recreated.

### Negative
- Slightly more files, but improves maintainability.

### Risks
- None significant.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-hand-cards.md | Max hand size 3 | `MAX_HAND_SIZE = 3`, `can_buy()` checks slot availability |
| system-hand-cards.md | Buy requires qi and empty slot | `buy()` precondition check |
| system-hand-cards.md | Sell costs 3 qi, recovers 8 qi immediately | HandManager doesn't handle qi; TurnFlow enforces |
| system-hand-cards.md | Hold earnings accumulate per turn | Stored in `hold_earnings` field |
| system-hand-cards.md | Leverage cards tracked for margin call | `leverage > 1.0` detection |

## Performance Implications
- **CPU**: O(3) for any operation; negligible.
- **Memory**: Each HandSlot stores metadata; trivial.

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] Unit test: Can add up to 3 cards, rejects 4th.
- [ ] Unit test: Hand size correctly reported.
- [ ] Unit test: Sell removes card and empties slot.
- [ ] Unit test: get_random_leverage_slot returns correct slot.
- [ ] Unit test: has_leverage_cards works correctly.

## Related Decisions
- ADR-0002: Singleton vs Node design (HandManager as scene node)
- ADR-0004: Card data and scoring
- ADR-0005: Qi resource management
- ADR-0006: Card pool management
- ADR-0008: Leverage system (to be created)