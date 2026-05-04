extends Node

enum GamePhase { PLAYER_TURN, SETTLEMENT, GAME_END }
enum PlayerAction { BUY, SELL, WAIT, NONE }

signal turn_started(turn_number: int)
signal season_changed(season_name: String, season_element: String)
signal player_action_required(available_actions: Array)
signal game_ended(final_score: float)

# Legacy signals for compatibility with existing UI
turn_started_legacy(total_round: int, season_round: int):
    turn_started.emit(total_round)
    pass

signal cards_drawn(public_cards: Array)
signal qi_recovered(new_qi: float)
signal action_selected(action: PlayerAction, data: Dictionary)

var current_phase: GamePhase = GamePhase.PLAYER_TURN
var current_turn: int = 0
var is_game_active: bool = false

# Subsystem references
var season_cycle: SeasonCycle
var hand_manager: HandManager
var card_pool: CardPoolManager
var qi_manager: QiManager
var score_manager: ScoreManager
var leverage_calc: LeverageCalculator

func _ready() -> void:
    season_cycle = get_node("/root/SeasonCycle")
    hand_manager = get_node("/root/HandManager")
    card_pool = get_node("/root/CardPoolManager")
    qi_manager = get_node("/root/QiManager")
    score_manager = get_node("/root/ScoreManager")
    leverage_calc = get_node("/root/LeverageCalculator")

    if not season_cycle or not hand_manager or not card_pool or not qi_manager or not score_manager:
        printerr("TurnManager: Missing required managers")
        return

    connect_signals()
    start_game()

func connect_signals() -> void:
    if season_cycle:
        season_cycle.season_changed.connect(_on_season_changed)

func start_game() -> void:
    if is_game_active:
        return
    is_game_active = true
    current_turn = 0
    if score_manager:
        score_manager.reset_score()
    start_next_turn()

func start_next_turn() -> void:
    if not is_game_active:
        return
    current_turn += 1
    turn_started.emit(current_turn)

    # Request player action
    var available_actions = ["buy", "sell", "wait"]
    player_action_required.emit(available_actions)

func on_player_action(action: String, data: Dictionary = {}) -> void:
    if not is_game_active:
        return
    match action.to_lower():
        "buy":
            execute_buy(data)
        "sell":
            execute_sell(data)
        "wait":
            execute_wait()
        _:
            printerr("TurnManager: Unknown action ", action)

func execute_buy(data: Dictionary) -> void:
    var card_id = data.get("card_id", "")
    var leverage = data.get("leverage", 1.0)

    if card_id.is_empty():
        printerr("TurnManager: Buy action missing card_id")
        start_next_turn()
        return

    var card_data_bank: CardDataBank = get_node("/root/CardDataBank")
    if not card_data_bank:
        printerr("TurnManager: CardDataBank not found")
        start_next_turn()
        return

    var card = card_data_bank.get_card(card_id)
    if not card:
        printerr("TurnManager: Card not found: ", card_id)
        start_next_turn()
        return

    # Calculate buy cost
    var season_element = ""
    if season_cycle:
        season_element = season_cycle.get_current_element() if season_cycle.has_method("get_current_element") else ""
    var buy_score = score_manager.calculate_card_score(card, {"season_element": season_element})

    # Check if enough score
    if score_manager.get_current_score() < buy_score:
        printerr("TurnManager: Not enough score to buy ", card_id)
        start_next_turn()
        return

    # Deduct score
    score_manager.subtract_score(buy_score)

    # Add to hand
    if hand_manager:
        var success = hand_manager.add_card(card, buy_score, leverage, current_turn)
        if not success:
            score_manager.add_score(buy_score)
            printerr("TurnManager: Failed to add card to hand")

    start_next_turn()

func execute_sell(data: Dictionary) -> void:
    var slot_index = data.get("slot_index", -1)
    if slot_index < 0 or not hand_manager:
        start_next_turn()
        return

    var slot = hand_manager.get_slot(slot_index)
    if not slot or slot.is_empty():
        start_next_turn()
        return

    var season_element = ""
    if season_cycle and season_cycle.has_method("get_current_element"):
        season_element = season_cycle.get_current_element()
    var sell_value = score_manager.calculate_sell_score(slot, current_turn, slot.leverage, season_element)

    score_manager.add_score(sell_value)
    hand_manager.remove_slot(slot_index)

    start_next_turn()

func execute_wait() -> void:
    start_next_turn()

func end_game() -> void:
    if not is_game_active:
        return
    is_game_active = false
    var final_score = score_manager.get_current_score() if score_manager else 0.0
    game_ended.emit(final_score)

func _on_season_changed(season_name: String, season_element: String) -> void:
    season_changed.emit(season_name, season_element)

# Legacy compatibility methods
func get_current_leverage_multiplier() -> float:
    if leverage_calc:
        return leverage_calc.get_multiplier(current_turn)
    return 1.0

func execute_buy_with_index(card_index: int, use_leverage: bool) -> bool:
    # Simplified implementation
    var public_cards = card_pool.get_public_cards() if card_pool else []
    if card_index < 0 or card_index >= public_cards.size():
        return false
    var card = public_cards[card_index]
    execute_buy({"card_id": card.id, "leverage": 2.0 if use_leverage else 1.0})
    return true

func execute_sell_with_index(slot_index: int) -> bool:
    execute_sell({"slot_index": slot_index})
    return true
