extends GutTest

var score_manager: ScoreManager
var card_data_bank: CardDataBank

func before_all() -> void:
	score_manager = ScoreManager.new()
	card_data_bank = CardDataBank.new()
	card_data_bank.load_cards()

func test_calc_card_score_wood_in_spring() -> void:
	var card: JiaziCard = card_data_bank.get_card(1)
	assert_not_null(card)
	assert_eq(card.main_element, JiaziCard.Element.WOOD)

	var score: float = score_manager.calc_card_score(card, ScoreManager.Season.SPRING)
	assert_gt(score, 0.0, "Wood card should have positive score in spring")

func test_calc_card_score_wood_in_autumn() -> void:
	var card: JiaziCard = card_data_bank.get_card(1)
	var score: float = score_manager.calc_card_score(card, ScoreManager.Season.AUTUMN)
	assert_lt(score, 0.0, "Wood card should have negative score in autumn")

func test_calc_card_score_earth_in_all_seasons() -> void:
	var earth_card: JiaziCard = card_data_bank.get_card(5)
	assert_eq(earth_card.main_element, JiaziCard.Element.EARTH)

	var seasons: Array = [ScoreManager.Season.SPRING, ScoreManager.Season.SUMMER, ScoreManager.Season.AUTUMN, ScoreManager.Season.WINTER]
	for season in seasons:
		var score: float = score_manager.calc_card_score(earth_card, season)
		assert_eq(score, 0.5, "Earth cards should score 0.5 in all seasons")

func test_hold_settle_empty_hand() -> void:
	var hand_slots: Array = []
	var result: Dictionary = score_manager.settle_hold_score(hand_slots, ScoreManager.Season.SPRING)
	assert_eq(result["round_score"], 0.0, "Empty hand should yield 0 round score")
	assert_eq(result["details"].size(), 0, "Details should be empty")

func test_hold_settle_with_leverage() -> void:
	var wood_card: JiaziCard = card_data_bank.get_card(1)
	var hand_slots: Array = [
		{"card": wood_card, "leverage": 2.0}
	]
	var result: Dictionary = score_manager.settle_hold_score(hand_slots, ScoreManager.Season.SPRING)
	var card_score: float = score_manager.calc_card_score(wood_card, ScoreManager.Season.SPRING)
	var expected: float = ScoreManager.HOLD_BONUS * card_score * 2.0
	assert_eq(result["round_score"], expected)

func test_sell_settle() -> void:
	var wood_card: JiaziCard = card_data_bank.get_card(1)
	var result: Dictionary = score_manager.settle_sell_score(wood_card, 2.0, ScoreManager.Season.SPRING, 1.5)

	assert_eq(result["card_name"], "甲子")
	assert_eq(result["leverage"], 1.5)

	var sell_score: float = score_manager.calc_card_score(wood_card, ScoreManager.Season.SPRING)
	var expected: float = (ScoreManager.SELL_BASE + (sell_score - 2.0) * ScoreManager.SPREAD_MULTIPLIER) * 1.5
	assert_eq(result["score"], expected)

func test_sell_settle_negative_spread() -> void:
	var wood_card: JiaziCard = card_data_bank.get_card(1)
	var result: Dictionary = score_manager.settle_sell_score(wood_card, 10.0, ScoreManager.Season.AUTUMN, 1.0)

	assert_lt(result["score"], ScoreManager.SELL_BASE, "Selling at a loss should yield lower score")

func test_card_score_range() -> void:
	var all_cards: Array[JiaziCard] = card_data_bank.get_all_cards()
	var seasons: Array = [ScoreManager.Season.SPRING, ScoreManager.Season.SUMMER, ScoreManager.Season.AUTUMN, ScoreManager.Season.WINTER]

	for card in all_cards:
		for season in seasons:
			var score: float = score_manager.calc_card_score(card, season)
			assert_between(score, -6.0, 6.0, "Score should be within [-6, 6] range")