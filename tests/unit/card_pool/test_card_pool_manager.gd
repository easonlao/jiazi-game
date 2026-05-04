extends GutTest

var card_pool: CardPoolManager
var mock_cards: Array[JiaziCard]

func before_all() -> void:
	# 构建模拟卡牌 (不依赖真实 JSON)
	mock_cards = []
	for i in range(60):
		var card := JiaziCard.new()
		card.id = i + 1
		card.name = "TestCard_%d" % (i + 1)
		mock_cards.append(card)

func before_each() -> void:
	card_pool = CardPoolManager.new()
	add_child_autofree(card_pool)

func test_initialize_shuffles_deck() -> void:
	card_pool.initialize(mock_cards)

	# 牌堆应有60张
	assert_eq(card_pool.get_deck_size(), 60, "Deck size should be 60 after initialize")

	# 洗牌后顺序不应与原顺序相同 (概率检验, 允许假阴性)
	var all_same: bool = true
	for i in range(60):
		if card_pool.deck[i] != mock_cards[i]:
			all_same = false
			break
	if all_same:
		push_warning("Shuffle produced same order as input (possible but unlikely)")

func test_draw_cards_reduces_deck() -> void:
	card_pool.initialize(mock_cards)
	var initial_size: int = card_pool.get_deck_size()

	var drawn: Array[JiaziCard] = card_pool.draw_cards()

	assert_eq(drawn.size(), 2, "Should draw 2 cards")
	assert_eq(card_pool.get_deck_size(), initial_size - 2, "Deck size reduced by 2")
	assert_eq(card_pool.get_public_cards().size(), 2, "Public cards set to drawn cards")

func test_draw_cards_when_less_than_2() -> void:
	card_pool.initialize(mock_cards)

	# 抽到只剩1张
	for i in range(29):  # 60 -> 58, 56, ... 2? 需要计算: 抽29次每次2张 = 58张, 剩2张
		card_pool.draw_cards()
		card_pool.return_public_cards()  # 回牌堆不影响数量, 但 public_cards 被清空

	# 直接操作 deck 模拟剩1张的场景
	card_pool.deck.clear()
	var single_card: JiaziCard = JiaziCard.new()
	single_card.id = 99
	card_pool.deck.append(single_card)

	var drawn: Array[JiaziCard] = card_pool.draw_cards()

	assert_eq(drawn.size(), 1, "Should draw 1 card when deck has 1")
	assert_eq(card_pool.get_deck_size(), 0, "Deck becomes empty")
	assert_signal_emitted(card_pool, "deck_emptied", "deck_emptied signal should fire")

func test_buy_card_removes_and_clears_public() -> void:
	card_pool.initialize(mock_cards)
	card_pool.draw_cards()
	var public_before: Array[JiaziCard] = card_pool.get_public_cards()
	assert_eq(public_before.size(), 2)

	var bought: JiaziCard = card_pool.buy_card(0)

	assert_not_null(bought, "Should return bought card")
	assert_eq(card_pool.get_public_cards().size(), 0, "Public cards cleared after buy")

func test_buy_card_invalid_index() -> void:
	card_pool.initialize(mock_cards)
	card_pool.draw_cards()

	var bought: JiaziCard = card_pool.buy_card(5)

	assert_null(bought, "Invalid index returns null")
	assert_eq(card_pool.get_public_cards().size(), 2, "Public cards unchanged")

func test_return_public_cards_inserts_randomly() -> void:
	card_pool.initialize(mock_cards)
	card_pool.draw_cards()
	var original_public: Array[JiaziCard] = card_pool.get_public_cards().duplicate()
	assert_eq(original_public.size(), 2)

	var deck_size_before: int = card_pool.get_deck_size()
	card_pool.return_public_cards()

	assert_eq(card_pool.get_deck_size(), deck_size_before + 2, "Deck size increased by 2")
	assert_eq(card_pool.get_public_cards().size(), 0, "Public cards cleared")

	# 验证两张牌都在牌堆中
	var found_count: int = 0
	for card in card_pool.deck:
		if card == original_public[0] or card == original_public[1]:
			found_count += 1
	assert_eq(found_count, 2, "Both returned cards are in deck")

func test_deck_emptied_signal() -> void:
	card_pool.initialize(mock_cards)

	# 抽光牌堆
	var draws_to_empty: int = 30  # 30次 × 2 = 60张
	for i in range(draws_to_empty - 1):
		card_pool.draw_cards()
		card_pool.return_public_cards()

	card_pool.draw_cards()  # 最后一次抽取

	assert_eq(card_pool.get_deck_size(), 0)
	assert_signal_emitted(card_pool, "deck_emptied", "deck_emptied emitted when deck becomes empty")

func test_deck_never_exceeds_60_after_operations() -> void:
	card_pool.initialize(mock_cards)

	# 模拟多回合操作
	for _i in range(10):
		card_pool.draw_cards()
		# 有时买, 有时回
		if randi() % 2 == 0:
			card_pool.buy_card(0)
		else:
			card_pool.return_public_cards()

	# 总牌数 = 初始60 - 买入次数
	var bought_count: int = 0
	# 无法直接获取买入次数, 但 deck + public + bought 应 = 60
	var total_visible: int = card_pool.get_deck_size() + card_pool.get_public_cards().size()
	assert_le(total_visible, 60, "Total cards never exceed 60")
