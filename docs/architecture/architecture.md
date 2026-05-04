# 甲子纪 — 主架构文档

## Document Status
- Version: 1
- Last Updated: 2026-05-04
- Engine: Godot 4.6 (GDScript)
- GDDs Covered: game-concept, systems-index, jiazi-cards, season, qi-resource, card-pool, hand-cards, scoring, turn-flow, leverage, ui-rendering
- ADRs Referenced: (none yet — Phase 5/6 will populate)

## Engine Knowledge Gap Summary

**Engine**: Godot 4.6
**LLM Training Covers**: up to ~4.3
**Post-Cutoff Versions**: 4.4 (MEDIUM), 4.5 (HIGH), 4.6 (HIGH)

### HIGH RISK Domains (must verify before implementation)
- **UI**: Dual-focus system (mouse/touch separate from keyboard/gamepad) — affects input handling across all UI.
- **GDScript**: Variadic arguments (`...`) and `@abstract` decorator — language features available but not required.

### MEDIUM RISK Domains
- **Rendering**: Glow before tonemapping, D3D12 default, SSR overhaul.
- **Resources**: `duplicate_deep()` for nested resource copies.

### Systems from GDD that touch HIGH/MEDIUM risk domains:
- UI Rendering → UI (Control nodes, focus handling) → HIGH
- All GDScript code → GDScript features (static typing recommended) → LOW

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
| TR-turn-001 | system-turn-flow.md | Turn | Fixed 7-step turn sequence | Engine |
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
| TR-turn-002 | system-turn-flow.md | Turn | 60 total turns | Engine |
| TR-scoring-003 | system-scoring.md | Scoring | SELL_BASE(8) + (sellScore - buyScore)*4 | Core |
| TR-hand-003 | system-hand-cards.md | Hand | Sell cost: 3 qi, recovers 8 qi immediately | Core |
| TR-ui-004 | system-ui-rendering.md | UI | Card flight animation (buy/sell) | Presentation |
| TR-leverage-003 | system-leverage.md | Leverage | Holding qi cost = max(0.5, 1.5+0.4*score) | Core |
| TR-jiazi-002 | system-jiazi-cards.md | Data | 12 cards per element (wood, fire, earth, metal, water) | Data |
| TR-turn-003 | system-turn-flow.md | Turn | Preseason length array generation to fill 60 turns | Engine |

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
│   - Godot Engine API (built-in)                            │
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
| JiaziCardsData | Card array (60), element mapping, season scoring table | `get_card(id)`, `get_score(cardId, season)` | None | None (pure data) |
| SeasonCycle | Current season, season round, season lengths array | `get_current_season()`, `get_season_round()`, `advance_season()` | None | None (pure data) |
| QiResource | Current qi, max qi (80), recovery logic | `get_qi()`, `spend(amount)`, `recover(amount)`, `can_afford(amount)` | None | None (pure data) |

### Core Layer

| Module | Owns | Exposes | Consumes | Engine APIs |
|--------|------|---------|----------|-------------|
| TurnFlow | Game state, turn number (1-60), phase machine | `start_game()`, `execute_turn()`, `end_game()`, `get_game_state()` | All Core modules | `Timer` (for animations), `SceneTree` (scene mgmt) — LOW RISK |
| CardPool | Deck array (shuffled), public cards (2) | `draw_cards()`, `buy_card(index)`, `return_card(card)`, `get_public_cards()` | JiaziCardsData | None |
| HandManagement | Hand slots (3), buy/sell operations | `buy(card, leverage)`, `sell(slot)`, `get_hand()`, `can_buy()`, `can_sell()` | JiaziCardsData, SeasonCycle, QiResource | None |
| Scoring | Score accumulation, hold/sell calculation | `calculate_hold_score(hand)`, `calculate_sell_score(card, buyScore)`, `add_score(value)` | JiaziCardsData, SeasonCycle, HandManagement | None |
| Leverage | Multiplier calculation, margin call | `get_current_multiplier(seasonRound)`, `apply_margin_call(hand, qi)` | SeasonCycle, QiResource, HandManagement | None |

### Presentation Layer

| Module | Owns | Exposes | Consumes | Engine APIs |
|--------|------|---------|----------|-------------|
| UIRendering | All UI nodes, screens, animations, input events | `update_qi_bar()`, `update_score()`, `show_cards()`, `handle_input()` | All Core modules, Foundation modules | `Control` (UI nodes) — HIGH RISK (dual-focus), `Input` (mouse/touch) — LOW RISK, `Tween` (animations) — LOW RISK |

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
UIRendering._input(event)               # Presentation layer
    ↓ (signal emit)
UIRendering.action_selected(action, data)
    ↓ (signal to TurnFlow)
TurnFlow._on_player_action(action, data)
    ↓ (call)
TurnFlow.execute_action(action, data)
    ├─ if Buy: HandManagement.buy(card, leverage)
    │     ├─ QiResource.spend(cost)
    │     ├─ CardPool.buy_card(index)
    │     └─ HandManagement.add_card(card, buyScore, leverage)
    ├─ if Sell: HandManagement.sell(slot)
    │     ├─ Scoring.calculate_sell_score(card, buyScore)
    │     ├─ Scoring.add_score(sellScore)
    │     ├─ QiResource.spend(3)
    │     ├─ QiResource.recover(8)  # immediate
    │     └─ HandManagement.remove_card(slot)
    └─ if Wait: CardPool.return_public_cards()
    ↓
TurnFlow.advance_turn()
    └─ emit signals → UIRendering updates all displays
```

### 2. Event/Signal Path (Decoupled Communication)

```
# Signals defined in TurnFlow (orchestrator)
signal turn_started(turn_number)
signal season_changed(new_season)
signal qi_changed(new_qi, old_qi)
signal score_changed(new_score, delta)
signal hand_updated(hand_slots)
signal cards_drawn(public_cards)
signal game_ended(final_score)

# Connections (set up in UIRendering._ready())
TurnFlow.turn_started.connect(_on_turn_started)      # update turn display
TurnFlow.season_changed.connect(_on_season_changed)  # update HUD, animate
TurnFlow.qi_changed.connect(_update_qi_bar)
TurnFlow.score_changed.connect(_update_score_display)
TurnFlow.hand_updated.connect(_update_hand_display)
TurnFlow.cards_drawn.connect(_update_public_cards)
TurnFlow.game_ended.connect(_show_game_over)
```

### 3. Save/Load Path (Future — MVP not required)

```
Save triggered (user action)
    ↓
TurnFlow.save_game_state()
    ↓ collect state from each module
    ├─ GameState {
    │    turn: turn_number,
    │    season: season_cycle.get_state(),
    │    qi: qi_resource.get_qi(),
    │    score: scoring.get_score(),
    │    hand: hand_management.get_hand_data(),
    │    deck_state: card_pool.get_deck_state(),
    │    season_lengths: season_cycle.get_lengths(),
    │    season_index: season_cycle.get_index()
    │  }
    ↓
ResourceSaver.save(game_state, "user://savegame.tres")
    └─ for Web export: uses IndexedDB via Godot's FileAccess
```

### 4. Initialisation Order

```
1. JiaziCardsData._ready()          # load card data (no dependencies)
2. SeasonCycle._ready()             # generate random season lengths
3. QiResource._ready()              # set qi = 50
4. Scoring._ready()                 # set score = 0
5. CardPool._init(jiazi_cards)      # shuffle 60 cards
6. HandManagement._ready()          # clear hand slots
7. Leverage._ready()                # (no state)
8. TurnFlow._ready()                # set turn = 1
9. UIRendering._ready()             # connect signals, build UI
   └── TurnFlow.start_game()        # start first turn
```

## API Boundaries

### Foundation Layer

**JiaziCardsData** (global singleton `CardDataBank`)
```gdscript
# Public methods
func get_card(id: int) -> JiaziCard
func get_tian_gan_element(card: JiaziCard) -> String
func get_di_zhi_element(card: JiaziCard) -> String
func get_season_score(card: JiaziCard, season: String) -> float  # -3 to +4
func get_cang_gan(card: JiaziCard) -> Dictionary

# Data structures
class JiaziCard:
    var id: int
    var name: String
    var tian_gan: String
    var di_zhi: String
    var tian_gan_element: String
    var di_zhi_element: String
    var main_element: String
```

**SeasonCycle** (global singleton `SeasonCycle`)
```gdscript
# Public methods
func get_current_season() -> String      # "spring"/"summer"/"autumn"/"winter"
func get_season_round() -> int           # 1..12
func get_season_lengths() -> Array[int]  # full schedule
func advance_season() -> void
func is_season_end() -> bool

# Signals
signal season_changed(new_season: String, old_season: String)
```

**QiResource** (global singleton `QiManager`)
```gdscript
# Public methods
func get_qi() -> int
func get_max_qi() -> int                  # always 80
func spend(amount: int) -> bool           # returns success
func recover(amount: int) -> void         # caps at max_qi
func can_afford(amount: int) -> bool

# State
var qi: int = 50                          # private
const MAX_QI: int = 80

# Signals
signal qi_changed(new_qi: int, old_qi: int)
```

### Core Layer

**CardPool** (node `CardPoolManager`)
```gdscript
# Public methods
func initialize(deck: Array[JiaziCard]) -> void   # call once at game start
func draw_cards() -> Array[JiaziCard]             # returns 2 cards (or fewer if deck depleted)
func buy_card(index: int) -> JiaziCard            # removes card from public, returns it
func return_card(card: JiaziCard) -> void         # inserts card randomly into deck
func get_public_cards() -> Array[JiaziCard]
func get_deck_size() -> int

# Private
var deck: Array[JiaziCard]                        # remaining cards
var public_cards: Array[JiaziCard]                # current 2 cards on display

# Signals
signal cards_drawn(cards: Array[JiaziCard])
signal deck_emptied()
```

**HandManagement** (node `HandManager`)
```gdscript
# Public methods
func buy(card: JiaziCard, leverage: float, buy_score: float) -> bool   # true if success
func sell(slot: int) -> bool                                           # true if success
func get_hand() -> Array[HandSlot]
func can_buy() -> bool                          # hand size < 3
func can_sell() -> bool                         # hand not empty
func get_hand_display_data() -> Array[Dictionary]

# Data structures
class HandSlot:
    var card: JiaziCard
    var buy_score: float
    var leverage: float                         # 1.0 if no leverage
    var buy_round: int
    var hold_earnings: float

# Private
var hand: Array[HandSlot]                       # max 3 slots, null = empty

# Signals
signal hand_updated(hand: Array[HandSlot])
signal card_bought(card: JiaziCard, slot: int)
signal card_sold(card: JiaziCard, slot: int)
```

**Scoring** (global singleton `ScoreManager`)
```gdscript
# Public methods
func calculate_hold_score(hand: Array[HandSlot]) -> float          # total for this turn
func calculate_sell_score(card: JiaziCard, buy_score: float, season: String) -> float
func add_score(value: float) -> void
func get_score() -> float
func get_total_hold_earnings() -> float
func get_total_sell_earnings() -> float

# Private
var total_score: float = 0.0
const HOLD_BONUS: float = 1.2
const SELL_BASE: float = 8.0
const SPREAD_MULTIPLIER: float = 4.0

# Signals
signal score_changed(new_score: float, delta: float)
```

**Leverage** (global singleton `LeverageCalculator`)
```gdscript
# Public methods
func get_current_multiplier(season_round: int) -> float            # 1.0, 1.5, 2.0, 2.5, 3.0
func apply_margin_call(hand: Array[HandSlot], current_qi: int) -> Array[HandSlot]  # returns remaining hand after forced sells
func calculate_hold_qi_cost(card_score: float, leverage: float) -> float

# Constants
const MULTIPLIER_TABLE: Dictionary = {
    "1-3": 1.0,
    "4-6": 1.5,
    "7-9": 2.0,
    "10-11": 2.5,
    "12": 3.0
}
const LQC: int = 10                            # leverage extra qi cost

# Signals
signal margin_call_triggered(sold_card: JiaziCard, slot: int)
```

**TurnFlow** (node `TurnManager`, root of game scene)
```gdscript
# Public methods
func start_game() -> void
func advance_turn() -> void
func get_game_state() -> GameState
func end_game() -> void

# Private methods (called by advance_turn in sequence)
func _check_game_over() -> bool
func _check_season() -> void
func _settle_holdings() -> void              # call Scoring + QiResource
func _draw_cards() -> void                   # call CardPool.draw_cards
func _recover_qi() -> void                   # call QiResource.recover
func _wait_for_player_action() -> void       # emit signal, UI handles input
func _execute_action(action, data) -> void   # call HandManagement.buy/sell or CardPool.return_card
func _increment_turn() -> void

# Signals
signal turn_started(turn_number: int)
signal player_action_required()               # UI should enable buttons
signal game_ended(final_score: float)
```

### Presentation Layer

**UIRendering** (node `UIManager`, root of UI scene tree)
```gdscript
# Public methods (mostly internal, called by signals)
func _ready() -> void                         # connect signals, build initial UI
func _update_qi_bar(new_qi: int) -> void
func _update_score_display(new_score: float, delta: float) -> void
func _update_hand_display(hand: Array[HandSlot]) -> void
func _update_public_cards(cards: Array[JiaziCard]) -> void
func _update_turn_display(turn: int) -> void
func _update_season_display(season: String) -> void
func _on_player_action(action: String, data: Variant) -> void
func animate_card_buy(card: JiaziCard, from_pos: Vector2, to_pos: Vector2) -> void
func animate_card_sell(card: JiaziCard, from_pos: Vector2) -> void
func animate_season_change(new_season: String) -> void
func show_game_over(final_score: float) -> void

# Private
var buy_mode: bool = false
var selected_card_index: int = -1
var leverage_enabled: bool = false

# Nodes
@onready var qi_bar: ProgressBar = $HUD/QiBar
@onready var score_label: Label = $HUD/ScoreLabel
@onready var hand_container: GridContainer = $HUD/HandContainer
@onready var public_card_container: GridContainer = $HUD/PublicCardContainer
@onready var buy_button: Button = $HUD/Actions/BuyButton
@onready var sell_button: Button = $HUD/Actions/SellButton
@onready var wait_button: Button = $HUD/Actions/WaitButton
@onready var leverage_button: Button = $HUD/Actions/LeverageButton

# Signals
signal action_selected(action: String, data: Variant)  # emitted to TurnFlow
```

## ADR Audit

**No ADRs found in `docs/architecture/`.**

All technical decisions from this architecture session must be documented as ADRs before implementation begins.

## Required ADRs

### Must have before coding starts (Foundation & Core decisions)

| Priority | ADR Title | Covers TR IDs |
|----------|-----------|---------------|
| 1 | Game State Management and Turn Flow Architecture | TR-turn-001, TR-turn-002, TR-turn-003 |
| 2 | Singleton vs Node-Based Module Design | TR-all (cross-cutting) |
| 3 | Signal-Based Communication Between Modules | TR-all (cross-cutting) |
| 4 | Card Data Structure and Scoring Formula Implementation | TR-jiazi-001, TR-jiazi-002, TR-scoring-001, TR-scoring-002 |
| 5 | Resource Management (Qi) with Recovery Rules | TR-qi-001, TR-qi-002 |

### Should have before the relevant system is built

| Priority | ADR Title | Covers TR IDs |
|----------|-----------|---------------|
| 6 | Leverage System: Multiplier Tiers and Margin Call Logic | TR-leverage-001, TR-leverage-002, TR-leverage-003 |
| 7 | Card Pool: Shuffle, Draw, and Return-to-Deck Mechanics | TR-cardpool-001, TR-cardpool-002 |
| 8 | Hand Management: 3-Slot Limit and Buy/Sell Rules | TR-hand-001, TR-hand-002, TR-hand-003 |
| 9 | UI Rendering Architecture: Scene Tree, Input Handling, Animations | TR-ui-001, TR-ui-002, TR-ui-003, TR-ui-004 |

### Can defer to implementation

| Priority | ADR Title | Covers TR IDs |
|----------|-----------|---------------|
| 10 | Save/Load System (Future) | None in MVP |
| 11 | Web Export Configuration and Performance Tuning | TR-ui-003 |

## Architecture Principles

1. **Signal-Driven Communication**: Modules communicate via signals, not direct method calls (except TurnFlow which orchestrates). This decouples systems and supports future expansion.

2. **Singleton for Stateless/Global Systems**: Scoring, QiResource, SeasonCycle, JiaziCardsData, Leverage will be global singletons (autoloads). TurnFlow, HandManagement, CardPool, UIRendering will be scene nodes (stateful).

3. **Data-Driven Design**: Card data (60 Jiazi cards) defined in external resource (JSON/Data file), not hardcoded. Scoring formulas defined in constants, easy to tune.

4. **Mobile-First with Mixed Input**: All UI must support mouse/keyboard AND touch. Button sizes ≥ 44x44 pixels. No hover-only interactions. Designed for 428x760 base, scales to 375px minimum.

5. **Godot 4.6 Awareness**: Use latest APIs (TileMapLayer, Signal.call(), typed arrays). Avoid deprecated patterns (TileMap, yield, string signal connections). Test input handling with dual-focus system.

## Open Questions

*None — all decisions made for MVP.*

---

## Phase 7b: Technical Director Sign-Off

**Technical Director Assessment**: APPROVED

- Architecture aligns with game pillars (timing, incomplete info, simple rules, opportunity cost).
- Engine risk acknowledged (Godot 4.6 dual-focus UI).
- Technical requirements baseline covers all GDD requirements.
- Module ownership clear, data flows defined.
- ADRs identified for implementation.

**Lead Programmer Feasibility**: FEASIBLE

- Implementation complexity: LOW to MEDIUM. Core systems are data-driven with no heavy dependencies.
- No blocking technical unknowns.
- Godot 4.6 features used (signals, typed arrays, Tween) are stable.

**Sign-Off Record**:
- Technical Director Sign-Off: 2026-05-04 — APPROVED
- Lead Programmer Feasibility: FEASIBLE

---

*Document generated by `/create-architecture`*
