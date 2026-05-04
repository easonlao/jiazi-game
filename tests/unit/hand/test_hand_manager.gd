extends GutTest

var hand_manager: HandManager
var mock_card_a: JiaziCard
var mock_card_b: JiaziCard
var mock_card_c: JiaziCard

func before_all() -> void:
	mock_card_a = JiaziCard.new()
	mock_card_a.id = 1
	mock_card_a.name = "木牌A"

	mock_card_b = JiaziCard.new()
	mock_card_b.id = 2
	mock_card_b.name = "火牌B"

	mock_card_c = JiaziCard.new()
	mock_card_c.id = 3
	mock_card_c.name = "土牌C"

func before_each() -> void:
	hand_manager = HandManager.new()
	add_child_autofree(hand_manager)

func test_initial_state() -> void:
	assert_eq(hand_manager.get_hand_size(), 0, "Initial hand size should be 0")
	assert_true(hand_manager.can_buy(), "Can buy when hand empty")
	assert_false(hand_manager.can_sell(), "Cannot sell when hand empty")

	var hand: Array = hand_manager.get_hand()
	assert_eq(hand.size(), HandManager.MAX_HAND_SIZE, "Hand array has max size slots")
	for slot in hand:
		assert_null(slot, "All slots initially null")

func test_buy_adds_card() -> void:
	var success: bool = hand_manager.buy(mock_card_a, 1.0, 100.0, 1)

	assert_true(success, "Buy should succeed")
	assert_eq(hand_manager.get_hand_size(), 1, "Hand size becomes 1")

	var slot: HandSlot = hand_manager.get_card_at(0)
	assert_not_null(slot, "Card placed in slot 0")
	assert_eq(slot.card, mock_card_a, "Card matches")
	assert_eq(slot.leverage, 1.0, "Leverage default 1.0")
	assert_eq(slot.buy_score, 100.0, "Buy score stored")
	assert_eq(slot.buy_round, 1, "Buy round stored")

func test_buy_fills_empty_slots_in_order() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)
	hand_manager.buy(mock_card_b, 1.0, 100.0, 2)
	hand_manager.buy(mock_card_c, 1.0, 100.0, 3)

	assert_eq(hand_manager.get_hand_size(), 3, "Three cards added")
	assert_eq(hand_manager.get_card_at(0).card, mock_card_a)
	assert_eq(hand_manager.get_card_at(1).card, mock_card_b)
	assert_eq(hand_manager.get_card_at(2).card, mock_card_c)

func test_buy_fails_when_hand_full() -> void:
	for i in range(3):
		hand_manager.buy(mock_card_a, 1.0, 100.0, i)

	var success: bool = hand_manager.buy(mock_card_b, 1.0, 100.0, 4)

	assert_false(success, "Buy fails when hand full")
	assert_eq(hand_manager.get_hand_size(), 3, "Hand size unchanged")

func test_sell_removes_card() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)
	hand_manager.buy(mock_card_b, 2.0, 150.0, 2)

	var sold_slot: HandSlot = hand_manager.sell(0)

	assert_not_null(sold_slot, "Sell returns removed slot")
	assert_eq(sold_slot.card, mock_card_a, "Returns correct card")
	assert_eq(sold_slot.leverage, 1.0, "Metadata preserved")
	assert_eq(hand_manager.get_hand_size(), 1, "Hand size decreased")
	assert_null(hand_manager.get_card_at(0), "Slot 0 becomes null")
	assert_eq(hand_manager.get_card_at(1).card, mock_card_b, "Slot 1 unchanged")

func test_sell_fails_on_invalid_slot() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)

	var sold: HandSlot = hand_manager.sell(5)
	assert_null(sold, "Invalid slot returns null")

	sold = hand_manager.sell(-1)
	assert_null(sold, "Negative slot returns null")

	assert_eq(hand_manager.get_hand_size(), 1, "Hand size unchanged")

func test_sell_fails_on_empty_slot() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)

	var sold: HandSlot = hand_manager.sell(1)  # Slot 1 is empty

	assert_null(sold, "Empty slot returns null")
	assert_eq(hand_manager.get_hand_size(), 1, "Hand size unchanged")

func test_has_leverage_cards() -> void:
	assert_false(hand_manager.has_leverage_cards(), "No leverage cards initially")

	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)
	assert_false(hand_manager.has_leverage_cards(), "Leverage 1.0 not counted")

	hand_manager.buy(mock_card_b, 2.0, 150.0, 2)
	assert_true(hand_manager.has_leverage_cards(), "Leverage 2.0 detected")

	hand_manager.sell(1)  # 卖出杠杆牌
	assert_false(hand_manager.has_leverage_cards(), "No leverage after selling")

func test_get_random_leverage_slot() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)
	hand_manager.buy(mock_card_b, 2.0, 150.0, 2)
	hand_manager.buy(mock_card_c, 3.0, 200.0, 3)

	var slot: int = hand_manager.get_random_leverage_slot()

	assert_between(slot, 0, 2, "Slot index in valid range")
	assert_not_null(hand_manager.get_card_at(slot), "Slot contains a card")
	assert_gt(hand_manager.get_card_at(slot).leverage, 1.0, "Selected card has leverage > 1.0")

func test_get_random_leverage_slot_returns_minus_one_when_none() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)

	var slot: int = hand_manager.get_random_leverage_slot()

	assert_eq(slot, -1, "Returns -1 when no leverage cards")

func test_clear_hand() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)
	hand_manager.buy(mock_card_b, 2.0, 150.0, 2)

	hand_manager.clear_hand()

	assert_eq(hand_manager.get_hand_size(), 0, "Hand size becomes 0 after clear")
	var hand: Array = hand_manager.get_hand()
	assert_eq(hand.size(), HandManager.MAX_HAND_SIZE, "Array still has max slots")
	for slot in hand:
		assert_null(slot, "All slots null after clear")

func test_signals_emit_on_buy() -> void:
	watch_signals(hand_manager)

	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)

	assert_signal_emitted(hand_manager, "hand_updated", "hand_updated emitted on buy")
	assert_signal_emitted(hand_manager, "card_bought", "card_bought emitted on buy")

	var buy_params: Array = get_signal_parameters(hand_manager, "card_bought")
	assert_eq(buy_params[0], mock_card_a, "card_bought param 1: card")
	assert_eq(buy_params[1], 0, "card_bought param 2: slot index")

func test_signals_emit_on_sell() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)
	watch_signals(hand_manager)

	hand_manager.sell(0)

	assert_signal_emitted(hand_manager, "hand_updated", "hand_updated emitted on sell")
	assert_signal_emitted(hand_manager, "card_sold", "card_sold emitted on sell")

func test_signals_emit_on_clear() -> void:
	hand_manager.buy(mock_card_a, 1.0, 100.0, 1)
	watch_signals(hand_manager)

	hand_manager.clear_hand()

	assert_signal_emitted(hand_manager, "hand_updated", "hand_updated emitted on clear")
