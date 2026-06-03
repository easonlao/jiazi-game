# ADR-0006: 牌池机制 (Card Pool Management)

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Phaser 3 |
| **Domain** | Core |
| **Knowledge Risk** | LOW (standard array operations) |
| **References Consulted** | None |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Random insertion must be uniform; unit test 1000 iterations |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0004 (Card data structure) |
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
