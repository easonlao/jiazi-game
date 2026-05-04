# ADR-0006: 牌池机制 (Card Pool Management)

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core |
| **Knowledge Risk** | LOW (standard array operations) |
| **References Consulted** | None |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Random insertion must be uniform; unit test 1000 iterations |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0002 (Singleton vs Node design), ADR-0004 (Card data structure) |
| **Enables** | TurnFlow (drawing cards), HandManagement (buying cards) |
| **Blocks** | None |
| **Ordering Note** | None |

## Context

### Problem Statement
甲子纪 requires a card pool that manages the deck of 60 Jiazi cards. Each turn, 2 cards are drawn from the deck and displayed to the player. The player buys 1 card (removing it permanently) or returns unselected cards to random positions in the deck.

### Constraints
- 60 cards total, each appears exactly once per game
- Drawn cards are removed from deck
- Unselected cards return to random deck positions (not predictable)
- Deck depletion handling (when fewer than 2 cards remain)

### Requirements
- Shuffle deck at game start (Fisher-Yates)
- Draw cards from deck (pop from front)
- Return cards to random positions
- Track deck size for UI
- No card duplication

## Decision

### CardPoolManager as Scene Node

`CardPoolManager` will be a child of the game scene (not an Autoload) because its state (remaining deck, public cards) is tied to the current session and must reset between games.

### Public Interface

```gdscript
# CardPoolManager.gd
extends Node

signal cards_drawn(public_cards: Array)
signal deck_emptied()

var deck: Array[JiaziCard] = []     # remaining cards (order matters)
var public_cards: Array[JiaziCard] = []   # currently displayed (0-2 cards)

# Called once at game start
func initialize(all_cards: Array[JiaziCard]) -> void:
    deck = all_cards.duplicate()
    shuffle_deck()
    public_cards.clear()

func shuffle_deck() -> void:
    # Fisher-Yates shuffle
    for i in range(deck.size() - 1, 0, -1):
        var j = randi() % (i + 1)
        var temp = deck[i]
        deck[i] = deck[j]
        deck[j] = temp

# Draw up to 2 cards; returns array of drawn cards
func draw_cards() -> Array[JiaziCard]:
    var drawn: Array[JiaziCard] = []
    var count = min(2, deck.size())
    for i in range(count):
        drawn.append(deck.pop_front())
    public_cards = drawn
    cards_drawn.emit(public_cards)
    if deck.is_empty():
        deck_emptied.emit()
    return drawn

# Player buys card at index (0 or 1)
func buy_card(index: int) -> JiaziCard:
    if index < 0 or index >= public_cards.size():
        return null
    var card = public_cards[index]
    public_cards.clear()  # both cards are gone after buy
    return card

# Return unselected cards to random deck positions
func return_public_cards() -> void:
    for card in public_cards:
        var pos = randi() % (deck.size() + 1)  # 0 to deck.size() inclusive
        deck.insert(pos, card)
    public_cards.clear()

func get_public_cards() -> Array[JiaziCard]:
    return public_cards.duplicate()

func get_deck_size() -> int:
    return deck.size()
```

### Usage in TurnFlow

```gdscript
# TurnFlow.gd (excerpt)
func _draw_cards() -> void:
    var drawn = card_pool_manager.draw_cards()
    emit_signal("cards_drawn", drawn)
```

## Alternatives Considered

### Alternative 1: Autoload CardPoolManager

- **Description**: Make CardPoolManager an Autoload singleton.
- **Pros**: Easy access from anywhere.
- **Cons**: State persists between game sessions; requires manual reset.
- **Rejection Reason**: Violates session-state principle (ADR-0002).

### Alternative 2: Use Godot's Array + RNG directly in TurnFlow

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
- Slightly more boilerplate (one extra node).

### Risks
- **Randomness quality**: `randi()` is deterministic but not cryptographically secure — fine for game RNG.
- **Performance**: Array insert at random position is O(N); deck size is 60, negligible.

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-card-pool.md | 60 cards shuffled at start | `initialize()` + `shuffle_deck()` |
| system-card-pool.md | Draw 2 cards per turn | `draw_cards()` returns 2 |
| system-card-pool.md | Unselected cards return to random position | `return_public_cards()` with random insert |
| system-card-pool.md | Deck depletion handling | `deck_emptied` signal, `draw_cards()` handles 0-1 cards |
| system-card-pool.md | Bought cards removed permanently | `buy_card()` removes from public, not returned to deck |

## Performance Implications
- **CPU**: Fisher-Yates O(n) = 60 swaps at start; each insert O(n) = up to 60 operations; negligible.
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
- ADR-0002: Singleton vs Node design (CardPoolManager as scene node)
- ADR-0004: Card data structure (JiaziCard)