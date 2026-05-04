extends Node

## 气资源管理器 - 全局单例
## 管理玩家的气资源: 上限80, 初始50
## 每回合自然回复7点, 若上回合执行等待则额外回复10点
## 买入/卖出消耗气, 持仓每回合消耗气

# 调参常量
const MAX_QI: float = 80.0
const START_QI: float = 50.0
const BASE_RECOVERY: float = 7.0          # QR
const WAIT_BONUS_RECOVERY: float = 10.0   # WR
const BUY_BASE_COST: float = 12.0         # CB
const SELL_COST: float = 3.0
const SELL_RECOVERY: float = 8.0          # CS
const LEVERAGE_EXTRA_COST: float = 10.0   # LQC
const HOLD_BASE_MIN: float = 0.5
const HOLD_BASE_A: float = 1.5
const HOLD_BASE_B: float = 0.4

# 状态
var current_qi: float = START_QI
var last_action_was_wait: bool = false

# 信号
signal qi_changed(new_qi: float, old_qi: float)
signal qi_depleted()


func _ready() -> void:
    current_qi = clamp(START_QI, 0.0, MAX_QI)


## 每回合开始调用, 回复气
func apply_recovery(waited_last_turn: bool) -> void:
    var old_qi: float = current_qi
    var recovery: float = BASE_RECOVERY
    if waited_last_turn:
        recovery += WAIT_BONUS_RECOVERY
    current_qi = min(MAX_QI, current_qi + recovery)
    if not is_equal_approx(current_qi, old_qi):
        qi_changed.emit(current_qi, old_qi)
    # 更新等待标记供后续使用
    last_action_was_wait = waited_last_turn


## 尝试消耗气, 成功返回true, 否则false
func spend(amount: float) -> bool:
    if amount < 0:
        return false
    if current_qi < amount:
        return false
    var old_qi: float = current_qi
    current_qi -= amount
    qi_changed.emit(current_qi, old_qi)
    if current_qi <= 0.0 and old_qi > 0.0:
        qi_depleted.emit()
    return true


## 直接回复气(如卖出时立即回复)
func recover(amount: float) -> void:
    if amount <= 0:
        return
    var old_qi: float = current_qi
    current_qi = min(MAX_QI, current_qi + amount)
    if not is_equal_approx(current_qi, old_qi):
        qi_changed.emit(current_qi, old_qi)


## 检查是否有足够气
func can_afford(amount: float) -> bool:
    return current_qi >= amount


## 计算买入所需气量(无杠杆)
func get_buy_cost(card_score: float) -> float:
    var base: float = BUY_BASE_COST * (1.0 + 0.05 * card_score)
    return base


## 计算带杠杆的买入气量
func get_leverage_buy_cost(card_score: float) -> float:
    var base: float = get_buy_cost(card_score)
    return base + LEVERAGE_EXTRA_COST


## 计算单张牌的持仓气耗
static func calculate_hold_qi_cost(card_score: float, leverage: float) -> float:
    var base: float = max(HOLD_BASE_MIN, HOLD_BASE_A + HOLD_BASE_B * card_score)
    return base * leverage


## 买入操作, 返回是否成功
func buy(card_score: float, use_leverage: bool) -> bool:
    var cost: float = get_leverage_buy_cost(card_score) if use_leverage else get_buy_cost(card_score)
    return spend(cost)


## 卖出操作, 消耗固定气并立即回复
func sell() -> bool:
    if not spend(SELL_COST):
        return false
    recover(SELL_RECOVERY)
    return true


## 重置状态(新游戏)
func reset() -> void:
    var old_qi: float = current_qi
    current_qi = START_QI
    last_action_was_wait = false
    qi_changed.emit(current_qi, old_qi)
