## HandManager - 玩家手牌管理
##
## 实现 design/gdd/system-hand-cards.md 规范:
## - 手牌上限3张
## - 买入/卖出操作
## - 杠杆牌追踪 (用于强制平仓)
##
## ADR-0007: 作为场景节点 (非 Autoload), 状态与会话绑定

class_name HandManager
extends Node

## 手牌上限 (GDD 规范)
const MAX_HAND_SIZE: int = 3

## 信号: 手牌更新 (任何买入/卖出/清空后触发)
## 参数: 当前手牌数组 (HandSlot 或 null 的数组)
signal hand_updated(hand: Array)

## 信号: 卡牌买入
## 参数: 买入的卡牌, 槽位索引
signal card_bought(card: JiaziCard, slot: int)

## 信号: 卡牌卖出
## 参数: 卖出的卡牌, 槽位索引, 收益分数 (由调用方计算)
signal card_sold(card: JiaziCard, slot: int, profit: float)

## 手牌数组 (固定大小 MAX_HAND_SIZE, null 表示空槽位)
var _hand: Array[HandSlot] = []

func _ready() -> void:
	clear_hand()

## 清空手牌 (重置游戏时调用)
func clear_hand() -> void:
	_hand.clear()
	_hand.resize(MAX_HAND_SIZE)
	for i in range(MAX_HAND_SIZE):
		_hand[i] = null
	hand_updated.emit(get_hand())

## 获取手牌数组 (副本, 避免外部修改)
func get_hand() -> Array:
	return _hand.duplicate()

## 获取当前手牌数量 (非空槽位数)
func get_hand_size() -> int:
	var count: int = 0
	for slot in _hand:
		if slot != null:
			count += 1
	return count

## 是否可买入 (有空位)
func can_buy() -> bool:
	return get_hand_size() < MAX_HAND_SIZE

## 是否可卖出 (至少有一张牌)
func can_sell() -> bool:
	return get_hand_size() > 0

## 买入卡牌
## @param card: 要买入的卡牌
## @param leverage: 杠杆倍数 (1.0 = 无杠杆)
## @param buy_score: 买入时的评分 (用于卖出收益计算)
## @param turn: 当前回合数
## @return 是否成功 (手牌满时返回 false)
func buy(card: JiaziCard, leverage: float, buy_score: float, turn: int) -> bool:
	if not can_buy():
		return false

	var slot: HandSlot = HandSlot.new(card, buy_score, leverage, turn)

	# 放入第一个空槽位
	for i in range(MAX_HAND_SIZE):
		if _hand[i] == null:
			_hand[i] = slot
			hand_updated.emit(get_hand())
			card_bought.emit(card, i)
			return true

	return false

## 卖出卡牌
## @param slot_index: 槽位索引 (0 ~ MAX_HAND_SIZE-1)
## @return 被卖出的 HandSlot, 若槽位无效或为空返回 null
func sell(slot_index: int) -> HandSlot:
	if slot_index < 0 or slot_index >= MAX_HAND_SIZE:
		return null

	var slot: HandSlot = _hand[slot_index]
	if slot == null:
		return null

	_hand[slot_index] = null
	hand_updated.emit(get_hand())
	card_sold.emit(slot.card, slot_index, 0.0)  # profit 由调用方计算后通过 emit 覆盖
	return slot

## 获取指定槽位的 HandSlot (可能为 null)
func get_card_at(slot_index: int) -> HandSlot:
	if slot_index < 0 or slot_index >= MAX_HAND_SIZE:
		return null
	return _hand[slot_index]

## 随机获取一个杠杆牌槽位索引 (用于强制平仓)
## @return 槽位索引, 若无杠杆牌返回 -1
func get_random_leverage_slot() -> int:
	var leverage_slots: Array[int] = []
	for i in range(MAX_HAND_SIZE):
		var slot: HandSlot = _hand[i]
		if slot != null and slot.leverage > 1.0:
			leverage_slots.append(i)

	if leverage_slots.is_empty():
		return -1

	return leverage_slots[randi() % leverage_slots.size()]

## 是否持有杠杆牌 (用于强制平仓判定)
func has_leverage_cards() -> bool:
	for slot in _hand:
		if slot != null and slot.leverage > 1.0:
			return true
	return false
