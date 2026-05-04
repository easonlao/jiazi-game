extends GutTest

var card_data_bank: CardDataBank

func before_all() -> void:
	card_data_bank = CardDataBank.new()
	card_data_bank.load_cards()

func test_load_all_cards() -> void:
	var all_cards: Array[JiaziCard] = card_data_bank.get_all_cards()
	assert_eq(all_cards.size(), 60, "Should load exactly 60 cards")

func test_get_card_by_id() -> void:
	var card: JiaziCard = card_data_bank.get_card(1)
	assert_not_null(card, "Card with id 1 should exist")
	assert_eq(card.name, "甲子", "First card name should be 甲子")
	assert_eq(card.main_element, JiaziCard.Element.WOOD, "Main element should be wood")

func test_get_nonexistent_card() -> void:
	var card: JiaziCard = card_data_bank.get_card(999)
	assert_null(card, "Should return null for non-existent id")

func test_get_cards_by_main_element() -> void:
	var wood_cards: Array[JiaziCard] = card_data_bank.get_cards_by_main_element(JiaziCard.Element.WOOD)
	assert_eq(wood_cards.size(), 12, "There should be 12 wood cards")

	for card in wood_cards:
		assert_eq(card.main_element, JiaziCard.Element.WOOD)

func test_card_properties() -> void:
	var card: JiaziCard = card_data_bank.get_card(5)
	assert_not_null(card)
	assert_eq(card.name, "戊辰")
	assert_eq(card.tian_gan, "戊")
	assert_eq(card.di_zhi, "辰")
	assert_eq(card.main_element, JiaziCard.Element.EARTH)
	assert_eq(card.yin_yang, JiaziCard.YinYang.YANG)

func test_yin_yang_distribution() -> void:
	var all_cards: Array[JiaziCard] = card_data_bank.get_all_cards()
	var yang_count: int = 0
	var yin_count: int = 0

	for card in all_cards:
		match card.yin_yang:
			JiaziCard.YinYang.YANG:
				yang_count += 1
			JiaziCard.YinYang.YIN:
				yin_count += 1

	assert_eq(yang_count, 30, "Should have 30 yang cards")
	assert_eq(yin_count, 30, "Should have 30 yin cards")