extends Node

signal score_changed(new_score: float, delta: float)

var current_score: float = 0.0

# Constants from ADR-0004
const BASE_CARD_SCORE: float = 10.0
const ELEMENT_BONUS: float = 1.5
const YIN_YANG_BONUS: float = 1.2
const HOLD_BONUS: float = 1.2
const SELL_BASE: float = 8.0
const SPREAD_MULTIPLIER: float = 4.0
const CANG_GAN_WEIGHT: float = 0.5

func _ready() -> void:
    reset_score()

func reset_score() -> void:
    current_score = 0.0
    score_changed.emit(current_score, 0.0)

func add_score(amount: float) -> void:
    var delta = amount
    current_score += amount
    score_changed.emit(current_score, delta)

func subtract_score(amount: float) -> void:
    add_score(-amount)

func get_current_score() -> float:
    return current_score

func calculate_card_score(card: JiaziCard, context: Dictionary = {}) -> float:
    var score = BASE_CARD_SCORE
    var season_element = context.get("season_element", "")
    if not season_element.is_empty() and card.get_element_string(card.main_element) == season_element:
        score *= ELEMENT_BONUS
    var required_yin_yang = context.get("required_yin_yang", "")
    if not required_yin_yang.is_empty() and card.get_yin_yang_string() == required_yin_yang:
        score *= YIN_YANG_BONUS
    return score

func calculate_hold_score(slot: HandSlot, current_round: int, current_leverage: float, season_element: String = "") -> float:
    if slot.is_empty():
        return 0.0
    var rounds_held = current_round - slot.buy_round
    if rounds_held <= 0:
        return 0.0
    var base_score = calculate_card_score(slot.card, {"season_element": season_element})
    var time_bonus = 1.0 + (rounds_held * 0.1)
    return base_score * time_bonus * slot.leverage

func calculate_sell_score(slot: HandSlot, current_round: int, current_leverage: float, season_element: String = "") -> float:
    var hold_value = calculate_hold_score(slot, current_round, current_leverage, season_element)
    return hold_value

# Legacy compatibility with existing TurnManager methods
func calc_card_score(card: JiaziCard, season) -> float:
    # Simplified season parameter handling
    var season_str = ""
    if season is SeasonCycle.Season:
        match season:
            SeasonCycle.Season.SPRING: season_str = "wood"
            SeasonCycle.Season.SUMMER: season_str = "fire"
            SeasonCycle.Season.AUTUMN: season_str = "metal"
            SeasonCycle.Season.WINTER: season_str = "water"
    return calculate_card_score(card, {"season_element": season_str})

func settle_hold_score(hand_slots: Array, season) -> Dictionary:
    var round_score: float = 0.0
    var details: Array = []
    for slot in hand_slots:
        if slot == null or slot.is_empty():
            continue
        var earned = calculate_hold_score(slot, slot.buy_round + 1, slot.leverage, "")  # Simplified
        round_score += earned
        details.append({"card_name": slot.card.name, "score": earned})
    return {"round_score": round_score, "details": details}

func settle_sell_score(card: JiaziCard, buy_score: float, season, leverage: float = 1.0) -> Dictionary:
    var sell_score = calc_card_score(card, season)
    var profit = (sell_score - buy_score) * SPREAD_MULTIPLIER * leverage
    return {"card_name": card.name, "score": profit}

func get_total_score() -> float:
    return current_score
