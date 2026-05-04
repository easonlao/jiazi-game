extends GutTest

var qi_manager: QiManager

func before_each() -> void:
    qi_manager = QiManager.new()
    add_child(qi_manager)
    qi_manager.reset()


func after_each() -> void:
    qi_manager.queue_free()


func test_initial_qi() -> void:
    assert_eq(qi_manager.current_qi, QiManager.START_QI)


func test_recovery_no_wait() -> void:
    qi_manager.current_qi = 50.0
    qi_manager.apply_recovery(false)
    assert_eq(qi_manager.current_qi, 57.0)  # 50 + 7


func test_recovery_with_wait() -> void:
    qi_manager.current_qi = 50.0
    qi_manager.apply_recovery(true)
    assert_eq(qi_manager.current_qi, 67.0)  # 50 + 7 + 10


func test_recovery_cap() -> void:
    qi_manager.current_qi = 75.0
    qi_manager.apply_recovery(true)
    assert_eq(qi_manager.current_qi, QiManager.MAX_QI)


func test_spend_success() -> void:
    assert_true(qi_manager.spend(10.0))
    assert_eq(qi_manager.current_qi, 40.0)


func test_spend_insufficient() -> void:
    assert_false(qi_manager.spend(100.0))
    assert_eq(qi_manager.current_qi, 50.0)


func test_spend_negative_amount() -> void:
    assert_false(qi_manager.spend(-5.0))
    assert_eq(qi_manager.current_qi, 50.0)


func test_recover() -> void:
    qi_manager.current_qi = 30.0
    qi_manager.recover(15.0)
    assert_eq(qi_manager.current_qi, 45.0)


func test_recover_cap() -> void:
    qi_manager.current_qi = 75.0
    qi_manager.recover(10.0)
    assert_eq(qi_manager.current_qi, QiManager.MAX_QI)


func test_can_afford() -> void:
    assert_true(qi_manager.can_afford(50.0))
    assert_false(qi_manager.can_afford(51.0))


func test_buy_cost_formula() -> void:
    var score: float = 4.0
    var expected: float = 12.0 * (1.0 + 0.05 * 4.0)  # 14.4
    assert_eq(qi_manager.get_buy_cost(score), expected)


func test_leverage_buy_cost() -> void:
    var score: float = 2.0
    var base: float = 12.0 * (1.0 + 0.05 * 2.0)  # 13.2
    var expected: float = base + QiManager.LEVERAGE_EXTRA_COST  # 23.2
    assert_eq(qi_manager.get_leverage_buy_cost(score), expected)


func test_hold_qi_cost_static() -> void:
    var score: float = 3.0
    var leverage: float = 2.0
    var base: float = max(0.5, 1.5 + 0.4 * 3.0)  # 2.7
    var expected: float = base * leverage  # 5.4
    assert_eq(QiManager.calculate_hold_qi_cost(score, leverage), expected)


func test_hold_qi_cost_min() -> void:
    var score: float = -10.0  # 评分可能为负
    var base: float = max(0.5, 1.5 + 0.4 * score)
    assert_eq(base, 0.5)


func test_buy_operation() -> void:
    var score: float = 0.0
    assert_true(qi_manager.buy(score, false))
    assert_eq(qi_manager.current_qi, 50.0 - 12.0)  # 38


func test_buy_leverage_insufficient() -> void:
    qi_manager.current_qi = 20.0
    var score: float = 10.0  # 高评分导致高成本
    assert_false(qi_manager.buy(score, true))


func test_sell_operation() -> void:
    qi_manager.current_qi = 10.0
    assert_true(qi_manager.sell())
    # 卖出消耗3, 回复8 => net +5
    assert_eq(qi_manager.current_qi, 15.0)


func test_sell_insufficient() -> void:
    qi_manager.current_qi = 2.0
    assert_false(qi_manager.sell())
    assert_eq(qi_manager.current_qi, 2.0)


func test_qi_depleted_signal() -> void:
    var triggered: bool = false
    qi_manager.qi_depleted.connect(func(): triggered = true)
    qi_manager.current_qi = 5.0
    qi_manager.spend(5.0)
    assert_true(triggered)


func test_qi_changed_signal() -> void:
    var new_val: float = 0.0
    var old_val: float = 0.0
    qi_manager.qi_changed.connect(func(n, o): new_val = n; old_val = o)
    qi_manager.spend(10.0)
    assert_eq(new_val, 40.0)
    assert_eq(old_val, 50.0)
