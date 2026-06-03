# 甲子纪 — 主架构文档

## Document Status
- Version: 2
- Last Updated: 2026-05-04
- Engine: Phaser 3 (TypeScript)
- GDDs Covered: game-concept, systems-index, jiazi-cards, season, qi-resource, card-pool, hand-cards, scoring, turn-flow, leverage, ui-rendering
- ADRs Referenced: ADR-0001 through ADR-0008

## Technical Requirements Baseline

Extracted from 10 GDDs | 24 total requirements

| Req ID | GDD | System | Requirement | Domain |
|--------|-----|--------|-------------|--------|
| TR-jiazi-001 | system-jiazi-cards.md | Data | 60 card data objects with defined structure | Data |
| TR-season-001 | system-season.md | Season | Season cycle with random length 3-12 | Core |
| TR-qi-001 | system-qi-resource.md | Qi | Resource management with max=80, start=50 | Core |
| TR-cardpool-001 | system-card-pool.md | Card Pool | Draw 2 cards per turn from shuffled deck | Core |
| TR-hand-001 | system-hand-cards.md | Hand | 3-card hand limit | Core |
| TR-scoring-001 | system-scoring.md | Scoring | Per-turn hold scoring + sell scoring | Core |
| TR-turn-001 | system-turn-flow.md | Turn | Fixed 7-step turn sequence | Core |
| TR-leverage-001 | system-leverage.md | Leverage | Tiered multiplier by season round (1.0-3.0) | Core |
| TR-ui-001 | system-ui-rendering.md | UI | Full HUD layout, card flights, animations | Presentation |
| TR-ui-002 | system-ui-rendering.md | UI | Touch + mouse/keyboard input | Presentation |
| TR-ui-003 | system-ui-rendering.md | UI | 428x760 design base, scalable | Presentation |
| TR-hand-002 | system-hand-cards.md | Hand | Buy/sell/wait actions (3 choices per turn) | Core |
| TR-qi-002 | system-qi-resource.md | Qi | Qi recovery: 7 base + 10 if waited previous turn | Core |
| TR-scoring-002 | system-scoring.md | Scoring | Card score = tianGan + cangGan*0.5 (range -6 to +6) | Core |
| TR-leverage-002 | system-leverage.md | Leverage | Margin call when Qi=0 | Core |
| TR-cardpool-002 | system-card-pool.md | Card Pool | Unselected cards return to random deck position | Core |
| TR-season-002 | system-season.md | Season | Season switch at random length (hidden total) | Core |
| TR-turn-002 | system-turn-flow.md | Turn | 60 total turns | Core |
| TR-scoring-003 | system-scoring.md | Scoring | SELL_BASE(8) + (sellScore - buyScore)*4 | Core |
| TR-hand-003 | system-hand-cards.md | Hand | Sell cost: 3 qi, recovers 8 qi immediately | Core |
| TR-ui-004 | system-ui-rendering.md | UI | Card flight animation (buy/sell) | Presentation |
| TR-leverage-003 | system-leverage.md | Leverage | Holding qi cost = max(0.5, 1.5+0.4*score) | Core |
| TR-jiazi-002 | system-jiazi-cards.md | Data | 12 cards per element (wood, fire, earth, metal, water) | Data |
| TR-turn-003 | system-turn-flow.md | Turn | Preseason length array generation to fill 60 turns | Core |

## System Layer Map

```
┌─────────────────────────────────────────────────────────────┐
│ PRESENTATION LAYER                                          │
│   - UI Rendering (system-ui-rendering)                     │
│     └─ Controls UI, card visuals, animations, HUD          │
├─────────────────────────────────────────────────────────────┤
│ FEATURE LAYER                                               │
│   (None in MVP — future expansion for special cards, etc.) │
├─────────────────────────────────────────────────────────────┤
│ CORE LAYER                                                  │
│   - Turn Flow (system-turn-flow) — engine                   │
│   - Card Pool (system-card-pool) — deck mgmt                │
│   - Hand Management (system-hand-cards) — player hand       │
│   - Scoring (system-scoring) — hold + sell calculation      │
│   - Leverage (system-leverage) — multiplier + margin call   │
├─────────────────────────────────────────────────────────────┤
│ FOUNDATION LAYER                                            │
│   - Jiazi Cards (system-jiazi-cards) — data definitions     │
│   - Season Cycle (system-season) — season state             │
│   - Qi Resource (system-qi-resource) — resource pool        │
├─────────────────────────────────────────────────────────────┤
│ PLATFORM LAYER                                              │
│   - Phaser 3 Engine API (built-in)                         │
│     └─ Input (mouse/touch/Keyboard), Rendering, Audio       │
└─────────────────────────────────────────────────────────────┘
```

### Layer Assignment Rationale

| System | Layer | Reason |
|--------|-------|--------|
| Jiazi Cards | Foundation | Pure data — no behavior, no dependencies |
| Season Cycle | Foundation | Basic state — no dependencies on other systems |
| Qi Resource | Foundation | Basic resource — used by Core systems |
| Turn Flow | Core | Orchestrates all other systems |
| Card Pool | Core | Card fetching logic — depends on Foundation |
| Hand Management | Core | Player state — depends on Foundation |
| Scoring | Core | Calculation — depends on Foundation |
| Leverage | Core | Multiplier — depends on Season and Qi |
| UI Rendering | Presentation | Visualization — depends on all Core/Foundation |

## Module Ownership

### Foundation Layer

| Module | Owns | Exposes | Consumes | Engine APIs |
|--------|------|---------|----------|-------------|
| JiaziCardsData | Card array (60), element mapping, season scoring table | `getCard(id)`, `getScore(cardId, season)` | None | None (pure data) |
| SeasonCycle | Current season, season round, season lengths array | `getCurrentSeason()`, `getSeasonRound()`, `advanceSeason()` | None | None (pure data) |
| QiResource | Current qi, max qi (80), recovery logic | `getQi()`, `spend(amount)`, `recover(amount)`, `canAfford(amount)` | None | None (pure data) |

### Core Layer

| Module | Owns | Exposes | Consumes | Engine APIs |
|--------|------|---------|----------|-------------|
| TurnFlow | Game state, turn number (1-60), phase machine | `startGame()`, `executeTurn()`, `endGame()`, `getGameState()` | All Core modules | `Phaser.Time` (for animations), Scene management — LOW RISK |
| CardPool | Deck array (shuffled), public cards (2) | `drawCards()`, `buyCard(index)`, `returnCard(card)`, `getPublicCards()` | JiaziCardsData | None |
| HandManagement | Hand slots (3), buy/sell operations | `buy(card, leverage)`, `sell(slot)`, `getHand()`, `canBuy()`, `canSell()` | JiaziCardsData, SeasonCycle, QiResource | None |
| Scoring | Score accumulation, hold/sell calculation | `calculateHoldScore(hand)`, `calculateSellScore(card, buyScore)`, `addScore(value)` | JiaziCardsData, SeasonCycle, HandManagement | None |
| Leverage | Multiplier calculation, margin call | `getCurrentMultiplier(seasonRound)`, `applyMarginCall(hand, qi)` | SeasonCycle, QiResource, HandManagement | None |

### Presentation Layer

| Module | Owns | Exposes | Consumes | Engine APIs |
|--------|------|---------|----------|-------------|
| UIRendering | All UI elements, screens, animations, input events | `updateQiBar()`, `updateScore()`, `showCards()`, `handleInput()` | All Core modules, Foundation modules | `Phaser.GameObjects` (UI elements) — LOW RISK, `Phaser.Input` (mouse/touch) — LOW RISK, `Phaser.Tweens` (animations) — LOW RISK |

### Dependency Diagram

```
[UIRendering] ──depends on──→ [TurnFlow]
       │                           │
       └──depends on──→ [Scoring]  │
       └──depends on──→ [HandManagement]
       └──depends on──→ [CardPool]
       └──depends on──→ [QiResource]
       └──depends on──→ [SeasonCycle]
       └──depends on──→ [JiaziCardsData]

[TurnFlow] ──calls──→ [CardPool] ──depends on──→ [JiaziCardsData]
          ──calls──→ [HandManagement] ──depends on──→ [JiaziCardsData]
          ──calls──→ [Scoring] ──depends on──→ [JiaziCardsData]
          ──calls──→ [Leverage]
          
[HandManagement] ──depends on──→ [QiResource]
[HandManagement] ──depends on──→ [SeasonCycle]
[Scoring] ──depends on──→ [SeasonCycle]
[Leverage] ──depends on──→ [SeasonCycle]
```

## Data Flow

### 1. Frame Update Path (User Input → UI → Core → State)

```
User clicks/taps
    ↓
UIRendering.handleInput(event)               # Presentation layer
    ↓ (EventEmitter emit)
UIRendering.actionSelected(action, data)
    ↓ (EventEmitter to TurnFlow)
TurnFlow.onPlayerAction(action, data)
    ↓ (call)
TurnFlow.executeAction(action, data)
    ├─ if Buy: HandManagement.buy(card, leverage)
    │     ├─ QiResource.spend(cost)
    │     ├─ CardPool.buyCard(index)
    │     └─ HandManagement.addCard(card, buyScore, leverage)
    ├─ if Sell: HandManagement.sell(slot)
    │     ├─ Scoring.calculateSellScore(card, buyScore)
    │     ├─ Scoring.addScore(sellScore)
    │     ├─ QiResource.spend(3)
    │     ├─ QiResource.recover(8)  # immediate
    │     └─ HandManagement.removeCard(slot)
    └─ if Wait: CardPool.returnPublicCards()
    ↓
TurnFlow.advanceTurn()
    └─ emit events → UIRendering updates all displays
```

### 2. Event/Signal Path (Decoupled Communication)

```typescript
// Events defined in TurnFlow (orchestrator)
interface TurnFlowEvents {
  turnStarted: (turnNumber: number) => void;
  seasonChanged: (newSeason: string, oldSeason: string) => void;
  qiChanged: (newQi: number, oldQi: number) => void;
  scoreChanged: (newScore: number, delta: number) => void;
  handUpdated: (handSlots: HandSlot[]) => void;
  cardsDrawn: (publicCards: JiaziCard[]) => void;
  gameEnded: (finalScore: number) => void;
}

// Connections (set up in UIRendering constructor)
turnFlow.on('turnStarted', this.updateTurnDisplay);
turnFlow.on('seasonChanged', this.updateSeasonDisplay);
turnFlow.on('qiChanged', this.updateQiBar);
turnFlow.on('scoreChanged', this.updateScoreDisplay);
turnFlow.on('handUpdated', this.updateHandDisplay);
turnFlow.on('cardsDrawn', this.updatePublicCards);
turnFlow.on('gameEnded', this.showGameOver);
```

### 3. Save/Load Path (Future — MVP not required)

```
Save triggered (user action)
    ↓
TurnFlow.saveGameState()
    ↓ collect state from each module
    ├─ GameState {
    │    turn: turnNumber,
    │    season: seasonCycle.getState(),
    │    qi: qiResource.getQi(),
    │    score: scoring.getScore(),
    │    hand: handManagement.getHandData(),
    │    deckState: cardPool.getDeckState(),
    │    seasonLengths: seasonCycle.getLengths(),
    │    seasonIndex: seasonCycle.getIndex()
    │  }
    ↓
localStorage.setItem('savegame', JSON.stringify(gameState))
    └─ for Web export: uses localStorage
```

### 4. Initialisation Order

```
1. JiaziCardsData constructor()          # load card data (no dependencies)
2. SeasonCycle constructor()             # generate random season lengths
3. QiResource constructor()              # set qi = 50
4. Scoring constructor()                 # set score = 0
5. CardPool.init(jiaziCards)             # shuffle 60 cards
6. HandManagement constructor()          # clear hand slots
7. Leverage constructor()                # (no state)
8. TurnFlow constructor()                # set turn = 1
9. UIRendering constructor()             # connect events, build initial UI
   └── TurnFlow.startGame()              # start first turn
```

## API Boundaries

### Foundation Layer

**JiaziCardsData** (singleton)
```typescript
// Public methods
getCard(id: number): JiaziCard;
getTianGanElement(card: JiaziCard): string;
getDiZhiElement(card: JiaziCard): string;
getSeasonScore(card: JiaziCard, season: string): number;  // -3 to +4
getCangGan(card: JiaziCard): CangGanEntry[];

// Data structures
interface JiaziCard {
  id: number;
  name: string;
  tianGan: string;
  diZhi: string;
  tianGanElement: string;
  diZhiElement: string;
  mainElement: string;
  yinYang: string;
}

interface CangGanEntry {
  gan: string;
  weight: number;
}
```

**SeasonCycle** (singleton)
```typescript
// Public methods
getCurrentSeason(): string;      // "spring"/"summer"/"autumn"/"winter"
getSeasonRound(): number;        // 1..12
getSeasonLengths(): number[];    // full schedule
advanceSeason(): void;
isSeasonEnd(): boolean;

// Events (via EventEmitter)
on('seasonChanged', (newSeason: string, oldSeason: string) => void): void;
```

**QiResource** (singleton)
```typescript
// Public methods
getQi(): number;
getMaxQi(): number;                  // always 80
spend(amount: number): boolean;      // returns success
recover(amount: number): void;       // caps at maxQi
canAfford(amount: number): boolean;

// State
private qi: number = 50;
private static readonly MAX_QI: number = 80;

// Events (via EventEmitter)
on('qiChanged', (newQi: number, oldQi: number) => void): void;
on('qiDepleted', () => void): void;
on('marginCallTriggered', (cardName: string, slot: number) => void): void;
```

### Core Layer

**CardPool** (scene component)
```typescript
// Public methods
initialize(deck: JiaziCard[]): void;   // call once at game start
drawCards(): JiaziCard[];              // returns 2 cards (or fewer if deck depleted)
buyCard(index: number): JiaziCard;     // removes card from public, returns it
returnCard(card: JiaziCard): void;     // inserts card randomly into deck
getPublicCards(): JiaziCard[];
getDeckSize(): number;

// Private
private deck: JiaziCard[];             // remaining cards
private publicCards: JiaziCard[];      // current 2 cards on display

// Events
on('cardsDrawn', (cards: JiaziCard[]) => void): void;
on('deckEmptied', () => void): void;
```

**HandManagement** (scene component)
```typescript
// Public methods
buy(card: JiaziCard, leverage: number, buyScore: number): boolean;
sell(slot: number): boolean;
getHand(): HandSlot[];
canBuy(): boolean;                     // hand size < 3
canSell(): boolean;                    // hand not empty
getHandDisplayData(): HandDisplayData[];

// Data structures
interface HandSlot {
  card: JiaziCard;
  buyScore: number;
  leverage: number;                    // 1.0 if no leverage
  buyRound: number;
  holdEarnings: number;
}

// Events
on('handUpdated', (hand: HandSlot[]) => void): void;
on('cardBought', (card: JiaziCard, slot: number) => void): void;
on('cardSold', (card: JiaziCard, slot: number) => void): void;
```

**Scoring** (singleton)
```typescript
// Public methods
calculateHoldScore(hand: HandSlot[]): number;
calculateSellScore(card: JiaziCard, buyScore: number, season: string): number;
addScore(value: number): void;
getScore(): number;

// Constants
private static readonly HOLD_BONUS: number = 1.2;
private static readonly SELL_BASE: number = 8.0;
private static readonly SPREAD_MULTIPLIER: number = 4.0;

// Events
on('scoreChanged', (newScore: number, delta: number) => void): void;
```

**Leverage** (singleton)
```typescript
// Public methods
getCurrentMultiplier(seasonRound: number): number;      // 1.0, 1.5, 2.0, 2.5, 3.0
calculateHoldQiCost(cardScore: number, leverage: number): number;
isLeverageAvailable(seasonRound: number): boolean;

// Constants
private static readonly MULTIPLIER_TABLE: { maxRound: number; multiplier: number }[];
private static readonly LEVERAGE_EXTRA_COST: number = 10;  // LQC
```

**TurnFlow** (scene root)
```typescript
// Public methods
startGame(): void;
advanceTurn(): void;
getGameState(): GameState;
endGame(): void;

// Private methods (called by advanceTurn in sequence)
private checkGameOver(): boolean;
private checkSeason(): void;
private settleHoldings(): void;
private drawCards(): void;
private recoverQi(): void;
private waitForPlayerAction(): void;
private executeAction(action: string, data: any): void;
private incrementTurn(): void;

// Events
on('turnStarted', (turnNumber: number) => void): void;
on('playerActionRequired', () => void): void;
on('gameEnded', (finalScore: number) => void): void;
```

### Presentation Layer

**UIRendering** (scene component)
```typescript
// Public methods (mostly internal, called by events)
constructor(scene: Phaser.Scene);
updateQiBar(newQi: number): void;
updateScoreDisplay(newScore: number, delta: number): void;
updateHandDisplay(hand: HandSlot[]): void;
updatePublicCards(cards: JiaziCard[]): void;
updateTurnDisplay(turn: number): void;
updateSeasonDisplay(season: string): void;
onPlayerAction(action: string, data: any): void;
animateCardBuy(card: JiaziCard, fromPos: {x: number, y: number}, toPos: {x: number, y: number}): void;
animateCardSell(card: JiaziCard, fromPos: {x: number, y: number}): void;
animateSeasonChange(newSeason: string): void;
showGameOver(finalScore: number): void;

// Events
on('actionSelected', (action: string, data: any) => void): void;  // emitted to TurnFlow
```

## Architecture Principles

1. **EventEmitter-Driven Communication**: Modules communicate via EventEmitter events, not direct method calls (except TurnFlow which orchestrates). This decouples systems and supports future expansion.

2. **Singleton for Stateless/Global Systems**: Scoring, QiResource, SeasonCycle, JiaziCardsData, Leverage will be global singletons. TurnFlow, HandManagement, CardPool, UIRendering will be scene-scoped components.

3. **Data-Driven Design**: Card data (60 Jiazi cards) defined in external resource (JSON/Data file), not hardcoded. Scoring formulas defined in constants, easy to tune.

4. **Mobile-First with Mixed Input**: All UI must support mouse/keyboard AND touch. Button sizes ≥ 44x44 pixels. No hover-only interactions. Designed for 428x760 base, scales to 375px minimum.

5. **TypeScript First**: All code written in TypeScript with strict typing. Interfaces for all data structures. No `any` types in public APIs.

## Open Questions

*None — all decisions made for MVP.*

---

*Document updated for Phaser 3/TypeScript migration.*
