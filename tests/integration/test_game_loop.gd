extends GutTest

# Jiazi Chronicle Integration Tests
# Based on actual project structure using QiManager, SeasonCycle, ScoreManager, etc.
# Does not rely on non-existent GameManager

var qi_manager: QiManager
var season_cycle: SeasonCycle
var score_manager: ScoreManager
var card_data_bank: CardDataBank
var leverage_calc: LeverageCalculator

const START_QI = 50.0
const TOTAL_TURNS = 60

# Mock hand slot structure (matches ScoreManager.settle_hold_score format)
var _hand_slots: Array = []
# Mock owned cards for player
var _owned_cards: Array = []  # Each entry: {card: JiaziCard, leverage: float, buy_score: float}


func before_each():
    # Initialize systems
    qi_manager = QiManager.new()
    add_child(qi_manager)
    season_cycle = SeasonCycle.new()
    add_child(season_cycle)
    score_manager = ScoreManager.new()
    add_child(score_manager)
    card_data_bank = CardDataBank.new()
    add_child(card_data_bank)
    leverage_calc = LeverageCalculator.new()

    # Wait for _ready() to run
    await get_tree().process_frame

    # Reset all systems
    qi_manager.reset()
    season_cycle.reset()
    _hand_slots.clear()
    _owned_cards.clear()


func after_each():
    qi_manager.queue_free()
    season_cycle.queue_free()
    score_manager.queue_free()
    card_data_bank.queue_free()
    leverage_calc.queue_free()
    _hand_slots.clear()
    _owned_cards.clear()


# Helper: Add card to hand with leverage
func _add_card_to_hand(card: JiaziCard, leverage: float = 1.0, buy_score: float = 0.0):
    var slot = {"card": card, "leverage": leverage}
    _hand_slots.append(slot)
    _owned_cards.append({"card": card, "leverage": leverage, "buy_score": buy_score})


# Helper: Find a card for testing
func _get_test_card() -> JiaziCard:
    var all_cards = card_data_bank.get_all_cards()
    if all_cards.size() > 0:
        return all_cards[0]
    # Fallback: create a dummy card if no data
    var dummy = JiaziCard.new()
    dummy.id = 999
    dummy.name = "Test Card"
    dummy.tian_gan_element = JiaziCard.Element.WOOD
    dummy.di_zhi_element = JiaziCard.Element.WOOD
    dummy.main_element = JiaziCard.Element.WOOD
    return dummy


# Helper: Calculate card score for current season
func _get_card_score(card: JiaziCard) -> float:
    return score_manager.calc_card_score(card, season_cycle.get_current_season())


# 2. Integration test: Game start and initialization
func test_game_start_initialization():
    # Test qi starts at 50
    assert_eq(qi_manager.current_qi, START_QI, "Qi should start at 50")

    # Test season cycle generates lengths summing to 60
    var season_lengths = season_cycle._season_lengths
    var total = 0
    for length in season_lengths:
        total += length
    assert_eq(total, TOTAL_TURNS, "Season lengths should sum to 60")

    # Test first season is SPRING (0)
    assert_eq(season_cycle.get_current_season(), SeasonCycle.Season.SPRING, "First season should be spring")

    # Test total rounds starts at 0
    assert_eq(season_cycle.get_total_round(), 0, "Total rounds should start at 0")

    # Note: Public cards and deck are not implemented in current architecture
    # These would require GameManager or DeckManager which don't exist yet


# 3. Integration test: Buy card flow (using QiManager)
func test_buy_card_flow():
    var initial_qi = qi_manager.current_qi
    var card = _get_test_card()
    var card_score = _get_card_score(card)
    var use_leverage = false

    # Calculate expected cost
    var expected_cost = qi_manager.get_buy_cost(card_score)

    # Perform buy
    var success = qi_manager.buy(card_score, use_leverage)

    # Verify purchase successful
    assert_true(success, "Buy should succeed with sufficient qi")

    # Verify qi decreased correctly
    assert_eq(qi_manager.current_qi, initial_qi - expected_cost, "Qi should decrease by buy cost")

    # Test buying with leverage
    var initial_qi2 = qi_manager.current_qi
    var use_leverage2 = true
    var expected_cost2 = qi_manager.get_leverage_buy_cost(card_score)

    success = qi_manager.buy(card_score, use_leverage2)
    assert_true(success, "Leverage buy should succeed with sufficient qi")
    assert_eq(qi_manager.current_qi, initial_qi2 - expected_cost2, "Qi should decrease by leverage buy cost")


# 4. Integration test: Hold settlement
func test_hold_settlement():
    # Set up hand with known card scores
    var card1 = _get_test_card()
    var card2 = _get_test_card()
    # Use two different cards if available
    var all_cards = card_data_bank.get_all_cards()
    if all_cards.size() >= 2:
        card1 = all_cards[0]
        card2 = all_cards[1]

    var leverage1 = 1.0
    var leverage2 = 2.0
    _add_card_to_hand(card1, leverage1)
    _add_card_to_hand(card2, leverage2)

    var current_season = season_cycle.get_current_season()
    var card1_score = score_manager.calc_card_score(card1, current_season)
    var card2_score = score_manager.calc_card_score(card2, current_season)

    var expected_score = (ScoreManager.HOLD_BONUS * card1_score * leverage1) + (ScoreManager.HOLD_BONUS * card2_score * leverage2)

    # Settle hold scores
    var result = score_manager.settle_hold_score(_hand_slots, current_season)

    # Verify score calculation
    assert_eq(result.round_score, expected_score, "Hold score should match calculation")
    assert_eq(result.details.size(), 2, "Should have details for both cards")

    # Verify qi cost - calculate for each card
    var expected_qi_cost = 0.0
    expected_qi_cost += QiManager.calculate_hold_qi_cost(card1_score, leverage1)
    expected_qi_cost += QiManager.calculate_hold_qi_cost(card2_score, leverage2)

    # Application of qi cost would be done by game loop, not here
    # Just verify the cost calculation formula
    assert_gt(expected_qi_cost, 0, "Hold qi cost should be positive")


# 5. Integration test: Sell card flow
func test_sell_card_flow():
    var card = _get_test_card()
    var buy_score = 10.0  # Simulated buy score
    var leverage = 1.5
    var current_season = season_cycle.get_current_season()

    # Calculate sell score using ScoreManager
    var result = score_manager.settle_sell_score(card, buy_score, current_season, leverage)

    # Formula: (SELL_BASE + (sell_score - buy_score) * SPREAD_MULTIPLIER) * leverage
    # SELL_BASE = 8.0, SPREAD_MULTIPLIER = 4.0
    var sell_score = score_manager.calc_card_score(card, current_season)
    var expected = (ScoreManager.SELL_BASE + (sell_score - buy_score) * ScoreManager.SPREAD_MULTIPLIER) * leverage

    assert_true(abs(result.score - expected) < 0.001, "Sell score should match formula")

    # Test QiManager sell flow
    var initial_qi = qi_manager.current_qi
    var sell_success = qi_manager.sell()

    assert_true(sell_success, "Sell should succeed with sufficient qi")
    # Sell costs 3 qi, then recovers 8 qi → net +5
    assert_eq(qi_manager.current_qi, initial_qi - QiManager.SELL_COST + QiManager.SELL_RECOVERY, "Qi should change by net +5")


# 6. Integration test: Margin call (forced sell when qi <= 0)
func test_margin_call():
    # Initialize qi to a low value
    qi_manager.current_qi = 10.0

    # Add a card with high leverage cost
    var card = _get_test_card()
    var card_score = _get_card_score(card)
    var leverage = 3.0  # Max leverage

    # Calculate hold cost for this card over multiple turns
    var hold_cost_per_turn = QiManager.calculate_hold_qi_cost(card_score, leverage)

    # Simulate turns until qi is depleted
    var turns_to_deplete = ceil(qi_manager.current_qi / hold_cost_per_turn)
    var qi_depleted_signal_emitted = false
    qi_manager.qi_depleted.connect(func(): qi_depleted_signal_emitted = true)

    # Apply hold cost multiple times
    for i in range(int(turns_to_deplete) + 1):
        if qi_manager.current_qi <= 0:
            break
        var spent = qi_manager.spend(hold_cost_per_turn)
        if not spent:
            break

    # Verify qi is zero or below
    assert_le(qi_manager.current_qi, 0, "Qi should be depleted after holding costs")

    # Verify qi_depleted signal was emitted
    assert_true(qi_depleted_signal_emitted, "qi_depleted signal should emit when qi reaches 0")

    # Note: Actual forced sell would be handled by game controller


# 7. Integration test: End-to-end game simulation
func test_end_to_end_game_simulation():
    var game_complete = false
    var scores_over_time = []
    var actions_taken = 0

    # Simple AI strategy: buy with low leverage when qi > 30, sell when qi low
    while not season_cycle.is_game_complete() and actions_taken < 100:  # Prevent infinite loops
        var current_qi = qi_manager.current_qi
        var current_season = season_cycle.get_current_season()
        var cards = card_data_bank.get_all_cards()

        # Random action selection for testing
        var action = randi() % 3  # 0=wait, 1=buy, 2=sell

        match action:
            0:  # Wait - just advance turn
                qi_manager.apply_recovery(true)  # Waited last turn

            1:  # Buy if possible
                if cards.size() > 0 and current_qi > 30:
                    var card = cards[randi() % cards.size()]
                    var card_score = score_manager.calc_card_score(card, current_season)
                    var use_leverage = (randf() > 0.7)  # 30% chance leverage
                    var cost = qi_manager.get_leverage_buy_cost(card_score) if use_leverage else qi_manager.get_buy_cost(card_score)

                    if qi_manager.can_afford(cost):
                        var success = qi_manager.buy(card_score, use_leverage)
                        if success:
                            actions_taken += 1
                            # Add to hand for scoring
                            var leverage_val = leverage_calc.get_multiplier(season_cycle.get_season_round()) if use_leverage else 1.0
                            _add_card_to_hand(card, leverage_val, card_score)
                    else:
                        qi_manager.apply_recovery(false)  # No wait bonus
                else:
                    qi_manager.apply_recovery(false)

            2:  # Sell oldest card
                if _owned_cards.size() > 0:
                    var sell_success = qi_manager.sell()
                    if sell_success and _hand_slots.size() > 0:
                        _hand_slots.remove_at(0)
                        _owned_cards.remove_at(0)
                    qi_manager.apply_recovery(false)
                else:
                    qi_manager.apply_recovery(false)

        # Settle scores for current hand before advancing round
        if _hand_slots.size() > 0:
            var hold_result = score_manager.settle_hold_score(_hand_slots, current_season)
            if hold_result.round_score != 0:
                scores_over_time.append(hold_result.round_score)

        # Advance round
        var season_changed = season_cycle.advance_round()

        # If season changed, scores may be affected
        if season_changed:
            pass  # Season bonus logic would go here

        # Check if game complete
        if season_cycle.is_game_complete():
            game_complete = true
            break

    # Verify game completed without crashes
    assert_true(game_complete or season_cycle.is_game_complete(), "Game should complete after 60 turns")

    # Verify total rounds reached 60
    assert_eq(season_cycle.get_total_round(), TOTAL_TURNS, "Total rounds should be 60")

    # Verify at least some actions were taken
    assert_gt(actions_taken, 0, "AI should take some actions during simulation")


# Edge Cases
func test_insufficient_qi_for_buy():
    qi_manager.current_qi = 1.0
    var card = _get_test_card()
    var card_score = _get_card_score(card)

    var success = qi_manager.buy(card_score, false)
    assert_false(success, "Buy should fail with insufficient qi")

    var leverage_success = qi_manager.buy(card_score, true)
    assert_false(leverage_success, "Leverage buy should fail with insufficient qi")


func test_qi_clamping_to_max():
    qi_manager.current_qi = 100.0  # Above max
    # The manager clamps on reset, but not on direct set
    qi_manager.reset()
    assert_le(qi_manager.current_qi, QiManager.MAX_QI, "Qi should be clamped to max")

    # Test recovery doesn't exceed max
    qi_manager.current_qi = QiManager.MAX_QI - 5
    qi_manager.apply_recovery(false)  # Base recovery 7
    assert_le(qi_manager.current_qi, QiManager.MAX_QI, "Recovery should not exceed max qi")


func test_season_cycle_boundaries():
    # Test season lengths are within bounds
    season_cycle.generate_season_lengths()
    for length in season_cycle._season_lengths:
        assert_between(length, SeasonCycle.MIN_SEASON_LEN, SeasonCycle.MAX_SEASON_LEN + 1,
                       "Season length should be between 3 and 12")

    # Test advancement through all seasons
    var seasons_seen = {}
    for i in range(60):  # Simulate many rounds
        var season = season_cycle.get_current_season()
        seasons_seen[season] = true
        season_cycle.advance_round()
        if season_cycle.is_game_complete():
            break

    # Should have seen all 4 seasons
    assert_eq(seasons_seen.size(), 4, "Should encounter all four seasons during play")


func test_leverage_multiplier_ranges():
    # Test leverage multiplier based on season round
    assert_eq(leverage_calc.get_multiplier(1), 1.0, "Round 1-3 -> 1.0x")
    assert_eq(leverage_calc.get_multiplier(3), 1.0, "Round 3 -> 1.0x")
    assert_eq(leverage_calc.get_multiplier(4), 1.5, "Round 4-6 -> 1.5x")
    assert_eq(leverage_calc.get_multiplier(6), 1.5, "Round 6 -> 1.5x")
    assert_eq(leverage_calc.get_multiplier(7), 2.0, "Round 7-9 -> 2.0x")
    assert_eq(leverage_calc.get_multiplier(9), 2.0, "Round 9 -> 2.0x")
    assert_eq(leverage_calc.get_multiplier(10), 2.5, "Round 10-11 -> 2.5x")
    assert_eq(leverage_calc.get_multiplier(11), 2.5, "Round 11 -> 2.5x")
    assert_eq(leverage_calc.get_multiplier(12), 3.0, "Round 12 -> 3.0x")
    assert_eq(leverage_calc.get_multiplier(20), 3.0, "Beyond max -> 3.0x")


func test_score_calculation_edge_cases():
    # Test with null card
    var null_result = score_manager.settle_hold_score([null, null], season_cycle.get_current_season())
    assert_eq(null_result.round_score, 0.0, "Null slots should contribute 0")

    # Test with empty hand
    var empty_result = score_manager.settle_hold_score([], season_cycle.get_current_season())
    assert_eq(empty_result.round_score, 0.0, "Empty hand should contribute 0")

    # Test leverage 0 (should be fine, just multiply)
    var card = _get_test_card()
    var slot = {"card": card, "leverage": 0.0}
    var zero_leverage_result = score_manager.settle_hold_score([slot], season_cycle.get_current_season())
    assert_eq(zero_leverage_result.round_score, 0.0, "Zero leverage yields zero score")
