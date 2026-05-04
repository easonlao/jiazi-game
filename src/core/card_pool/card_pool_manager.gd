## CardPoolManager - 管理牌堆和公共展示区
##
## 实现 design/gdd/system-card-pool.md 规范:
## - 60张甲子牌初始洗牌
## - 每回合抽2张牌展示
## - 未选牌随机插回牌堆
## - 买入牌永久移除
## - 牌堆耗尽处理
##
## ADR-0006: 作为场景节点 (非 Autoload), 状态与会话绑定

extends Node

## 牌堆 (剩余牌, 顺序重要)
var deck: Array[JiaziCard] = []

## 公共展示区 (0-2张牌)
var public_cards: Array[JiaziCard] = []

## 信号: 抽牌完成, 参数为展示的牌数组
signal cards_drawn(public_cards: Array[JiaziCard])

## 信号: 牌堆已空 (无牌可抽)
signal deck_emptied()

## 初始化牌池
## @param all_cards: 全部60张甲子牌 (来自 CardDataBank)
func initialize(all_cards: Array[JiaziCard]) -> void:
	deck = all_cards.duplicate()
	shuffle_deck()
	public_cards.clear()

## Fisher-Yates 洗牌
func shuffle_deck() -> void:
	for i in range(deck.size() - 1, 0, -1):
		var j: int = randi() % (i + 1)
		var temp: JiaziCard = deck[i]
		deck[i] = deck[j]
		deck[j] = temp

## 抽牌: 从牌堆头部抽取最多2张牌放入公共展示区
## @return 抽到的牌数组 (可能少于2张, 牌堆不足时)
func draw_cards() -> Array[JiaziCard]:
	var drawn: Array[JiaziCard] = []
	var count: int = mini(2, deck.size())

	for i in range(count):
		drawn.append(deck.pop_front())

	public_cards = drawn
	cards_drawn.emit(public_cards)

	if deck.is_empty():
		deck_emptied.emit()

	return drawn

## 买入: 移除公共展示区中指定索引的牌
## @param index: 0 或 1 (public_cards 中的位置)
## @return 被买入的牌, 若索引无效返回 null
func buy_card(index: int) -> JiaziCard:
	if index < 0 or index >= public_cards.size():
		return null

	var card: JiaziCard = public_cards[index]
	public_cards.clear()
	return card

## 未选牌回堆: 将公共展示区所有牌随机插入牌堆
## 插入位置范围: 0 到 deck.size() (均匀分布)
func return_public_cards() -> void:
	for card in public_cards:
		var pos: int = randi() % (deck.size() + 1)
		deck.insert(pos, card)
	public_cards.clear()

## 获取公共展示区牌 (副本, 避免外部修改)
func get_public_cards() -> Array[JiaziCard]:
	return public_cards.duplicate()

## 获取牌堆剩余数量
func get_deck_size() -> int:
	return deck.size()
