extends GutTest

func test_leverage_multiplier_correct() -> void:
    # 回合1-3: 1.0
    assert_eq(LeverageCalculator.get_multiplier(1), 1.0)
    assert_eq(LeverageCalculator.get_multiplier(3), 1.0)
    # 4-6: 1.5
    assert_eq(LeverageCalculator.get_multiplier(4), 1.5)
    assert_eq(LeverageCalculator.get_multiplier(6), 1.5)
    # 7-9: 2.0
    assert_eq(LeverageCalculator.get_multiplier(7), 2.0)
    assert_eq(LeverageCalculator.get_multiplier(9), 2.0)
    # 10-11: 2.5
    assert_eq(LeverageCalculator.get_multiplier(10), 2.5)
    assert_eq(LeverageCalculator.get_multiplier(11), 2.5)
    # 12: 3.0
    assert_eq(LeverageCalculator.get_multiplier(12), 3.0)
    # beyond 12: return 3.0 (fallback)
    assert_eq(LeverageCalculator.get_multiplier(15), 3.0)


func test_is_leverage_available() -> void:
    assert_true(LeverageCalculator.is_leverage_available(1))
    assert_true(LeverageCalculator.is_leverage_available(10))
    # 理论上任何正回合都可以用, 但倍率可能为1


func test_calculate_hold_qi_cost() -> void:
    var score: float = 2.0
    var leverage: float = 1.5
    var base: float = max(0.5, 1.5 + 0.4 * score)  # 2.3
    var expected: float = base * leverage  # 3.45
    assert_eq(LeverageCalculator.calculate_hold_qi_cost(score, leverage), expected)


func test_calculate_hold_qi_cost_min() -> void:
    var score: float = -3.0
    var base: float = max(0.5, 1.5 + 0.4 * score)  # 0.5
    assert_eq(LeverageCalculator.calculate_hold_qi_cost(score, 1.0), base)


func test_get_leverage_multiplier_display() -> void:
    assert_eq(LeverageCalculator.get_leverage_multiplier_display(2), "1.0x")
    assert_eq(LeverageCalculator.get_leverage_multiplier_display(5), "1.5x")
    assert_eq(LeverageCalculator.get_leverage_multiplier_display(12), "3.0x")


func test_lqc_constant() -> void:
    assert_eq(LeverageCalculator.LQC, 10.0)
