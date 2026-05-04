class_name HandSlot
extends RefCounted

var card: JiaziCard
var buy_score: float = 0.0
var leverage: float = 1.0
var buy_round: int = 0
var hold_earnings: float = 0.0

func _init(p_card: JiaziCard = null, p_buy_score: float = 0.0, p_leverage: float = 1.0, p_buy_round: int = 0) -> void:
    card = p_card
    buy_score = p_buy_score
    leverage = p_leverage
    buy_round = p_buy_round
    hold_earnings = 0.0

func is_empty() -> bool:
    return card == null

func clear() -> void:
    card = null
    buy_score = 0.0
    leverage = 1.0
    buy_round = 0
    hold_earnings = 0.0
