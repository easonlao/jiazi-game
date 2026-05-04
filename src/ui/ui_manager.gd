extends CanvasLayer
class_name UIManager

## UI管理器
## 连接游戏各个子系统，更新UI显示，处理玩家操作输入

signal action_selected(action: String, data: Dictionary)

# 子系统引用
var turn_manager: TurnManager
var hand_manager: HandManager
var card_pool: CardPoolManager
var qi_manager: QiManager
var score_manager: ScoreManager
var season_cycle: SeasonCycle

# UI节点引用
@onready var season_label: Label = $TopPanel/TopMargin/HBoxContainer/SeasonLabel
@onready var score_label: Label = $TopPanel/TopMargin/HBoxContainer/ScoreLabel
@onready var qi_bar: ProgressBar = $QiPanel/MarginContainer/VBoxContainer/QiBar
@onready var qi_label: Label = $QiPanel/MarginContainer/VBoxContainer/QiLabel
@onready var hold_cost_label: Label = $QiPanel/MarginContainer/VBoxContainer/HoldCostLabel
@onready var public_container: HBoxContainer = $PublicCardsPanel/MarginContainer/PublicCardContainer
@onready var hand_container: HBoxContainer = $HandPanel/MarginContainer/HandContainer
@onready var buy_button: Button = $ButtonPanel/MarginContainer/GridContainer/BuyButton
@onready var leverage_button: Button = $ButtonPanel/MarginContainer/GridContainer/LeverageButton
@onready var sell_button: Button = $ButtonPanel/MarginContainer/GridContainer/SellButton
@onready var wait_button: Button = $ButtonPanel/MarginContainer/GridContainer/WaitButton
@onready var bottom_info: Label = $BottomInfo

# 状态
var current_public_cards: Array = []      # 当前公共牌池的JiaziCard列表
var current_hand_cards: Array = []        # 当前手牌的HandSlotData列表
var selected_public_index: int = -1
var selected_hand_index: int = -1
var leverage_enabled: bool = false        # 杠杆开关状态
var current_leverage_multiplier: float = 1.0

# 常量
const CB: float = 12.0      # 买入基础消耗
const LQC: float = 10.0     # 杠杆额外消耗


func _ready() -> void:
    # 获取子系统引用（假设它们在场景树根节点或作为autoload）
    turn_manager = get_node_or_null("/root/TurnManager")
    hand_manager = get_node_or_null("/root/HandManager")
    card_pool = get_node_or_null("/root/CardPoolManager")
    qi_manager = get_node_or_null("/root/QiManager")
    score_manager = get_node_or_null("/root/ScoreManager")
    season_cycle = get_node_or_null("/root/SeasonCycle")

    _connect_signals()
    _setup_containers()
    _refresh_ui()


func _connect_signals() -> void:
    if turn_manager:
        turn_manager.turn_started.connect(_on_turn_started)
        turn_manager.player_action_required.connect(_on_player_action_required)
    if hand_manager:
        hand_manager.hand_updated.connect(_on_hand_updated)
    if card_pool:
        card_pool.cards_drawn.connect(_on_cards_drawn)
    if qi_manager:
        qi_manager.qi_changed.connect(_on_qi_changed)
    if score_manager:
        score_manager.score_changed.connect(_on_score_changed)
    if season_cycle:
        season_cycle.season_changed.connect(_on_season_changed)
        season_cycle.turn_changed.connect(_on_turn_changed)
        season_cycle.leverage_multiplier_changed.connect(_on_leverage_multiplier_changed)

    # 按钮信号
    buy_button.pressed.connect(_on_buy_pressed)
    sell_button.pressed.connect(_on_sell_pressed)
    wait_button.pressed.connect(_on_wait_pressed)
    leverage_button.pressed.connect(_on_leverage_pressed)


func _setup_containers() -> void:
    # 清空容器，动态创建槽位
    for child in public_container.get_children():
        child.queue_free()
    for child in hand_container.get_children():
        child.queue_free()

    # 创建公共牌槽位（固定2个）
    for i in range(2):
        var slot = load("res://src/ui/card_slot.tscn").instantiate()
        slot.clicked.connect(_on_public_card_clicked.bind(i))
        public_container.add_child(slot)

    # 创建手牌槽位（固定3个）
    for i in range(3):
        var slot = load("res://src/ui/card_slot.tscn").instantiate()
        slot.clicked.connect(_on_hand_card_clicked.bind(i))
        hand_container.add_child(slot)


func _refresh_ui() -> void:
    _refresh_public_display()
    _refresh_hand_display()
    _update_qi_display()
    _update_score_display()
    _update_season_display()
    _update_button_states()


func _refresh_public_display() -> void:
    var slot_count = public_container.get_child_count()
    for i in range(slot_count):
        var slot = public_container.get_child(i)
        if i < current_public_cards.size() and current_public_cards[i] != null:
            var card = current_public_cards[i]
            var score = _calc_card_score(card)
            slot.setup(card, score, false, false, i)
            # 更新消耗显示
            var cost = _calc_buy_cost(score, leverage_enabled)
            slot.set_buy_cost(cost, leverage_enabled)
            slot.visible = true
        else:
            slot.visible = false
            slot.card = null


func _refresh_hand_display() -> void:
    var slot_count = hand_container.get_child_count()
    for i in range(slot_count):
        var slot = hand_container.get_child(i)
        if i < current_hand_cards.size() and current_hand_cards[i] != null:
            var slot_data = current_hand_cards[i]
            var card = slot_data.card
            var current_score = _calc_card_score(card)
            var is_leverage_card = slot_data.leverage > 1.0
            slot.setup(card, current_score, true, is_leverage_card, i)
            var profit = (current_score - slot_data.buy_score) * slot_data.leverage
            slot.set_profit(profit)
            slot.visible = true
        else:
            slot.visible = false
            slot.card = null


func _update_qi_display() -> void:
    if qi_manager:
        var current_qi = qi_manager.current_qi
        var max_qi = qi_manager.max_qi
        qi_bar.value = current_qi
        qi_bar.max = max_qi
        qi_label.text = "气: %d/%d" % [current_qi, max_qi]
        # 气条颜色
        var color = Color.GREEN
        var ratio = float(current_qi) / max_qi
        if ratio < 0.3:
            color = Color.RED
        elif ratio < 0.6:
            color = Color.YELLOW
        qi_bar.add_theme_color_override("fill", color)

        # 显示持仓气耗
        var hold_cost = _calc_total_hold_qi_cost()
        if hold_cost > 0:
            hold_cost_label.text = "持仓维持: -%.1f气/回合" % hold_cost
            hold_cost_label.visible = true
        else:
            hold_cost_label.visible = false
    else:
        qi_label.text = "气: ?/?"


func _calc_total_hold_qi_cost() -> float:
    var total = 0.0
    for slot_data in current_hand_cards:
        if slot_data != null:
            var current_score = _calc_card_score(slot_data.card)
            var base = max(0.5, 1.5 + 0.4 * current_score)
            total += base * slot_data.leverage
    return total


func _update_score_display() -> void:
    if score_manager:
        score_label.text = "总分: %d" % int(score_manager.total_score)


func _update_season_display() -> void:
    if season_cycle:
        var season_name = season_cycle.current_season_name
        var turn_in_season = season_cycle.current_turn_in_season
        season_label.text = "%s (第%d回合)" % [season_name, turn_in_season]


func _update_button_states() -> void:
    # 买入按钮：有选中的公共牌 + 手牌未满 + 气足够 + 牌堆非空
    var can_buy = selected_public_index >= 0 and selected_public_index < current_public_cards.size()
    if can_buy and hand_manager:
        can_buy = hand_manager.get_empty_slot_count() > 0
    if can_buy and card_pool:
        can_buy = card_pool.get_remaining_count() > 0
    if can_buy and qi_manager and selected_public_index >= 0:
        var card = current_public_cards[selected_public_index]
        var score = _calc_card_score(card)
        var cost = _calc_buy_cost(score, leverage_enabled)
        can_buy = qi_manager.current_qi >= cost
    buy_button.disabled = not can_buy

    # 卖出按钮：有选中的手牌 + 气足够
    var can_sell = selected_hand_index >= 0 and selected_hand_index < current_hand_cards.size() and current_hand_cards[selected_hand_index] != null
    if can_sell and qi_manager:
        can_sell = qi_manager.current_qi >= 3
    sell_button.disabled = not can_sell

    # 等待按钮始终可用
    wait_button.disabled = false

    # 杠杆按钮：有选中的公共牌且当前杠杆倍数>1.0
    var leverage_available = selected_public_index >= 0 and current_leverage_multiplier > 1.0
    leverage_button.disabled = not leverage_available
    if leverage_available:
        if leverage_enabled:
            leverage_button.text = "杠杆 %.1fx 开" % current_leverage_multiplier
            leverage_button.add_theme_color_override("font_color", Color.ORANGE)
        else:
            leverage_button.text = "杠杆 %.1fx 关" % current_leverage_multiplier
            leverage_button.add_theme_color_override("font_color", Color.GRAY)
    else:
        if current_leverage_multiplier <= 1.0:
            leverage_button.text = "杠杆 1.0x"
        else:
            leverage_button.text = "杠杆 %.1fx" % current_leverage_multiplier
        leverage_button.add_theme_color_override("font_color", Color.GRAY)

    # 更新选中牌的消耗显示
    if selected_public_index >= 0:
        var slot = public_container.get_child(selected_public_index) if selected_public_index < public_container.get_child_count() else null
        if slot and slot.card:
            var score = _calc_card_score(slot.card)
            var cost = _calc_buy_cost(score, leverage_enabled)
            slot.set_buy_cost(cost, leverage_enabled)


func _calc_card_score(card: JiaziCard) -> float:
    if season_cycle:
        return season_cycle.calc_card_score(card)
    return 0.0


func _calc_buy_cost(card_score: float, leverage: bool) -> float:
    var base = CB * (1 + 0.05 * card_score)
    if leverage:
        return base + LQC
    return base


# 信号处理
func _on_turn_started(turn_number: int) -> void:
    _refresh_ui()


func _on_player_action_required(available_actions: Array) -> void:
    _refresh_ui()


func _on_hand_updated() -> void:
    if hand_manager:
        current_hand_cards = hand_manager.get_all_slots()
    _refresh_hand_display()
    _update_button_states()


func _on_cards_drawn(public_cards: Array) -> void:
    current_public_cards = public_cards
    _refresh_public_display()
    _update_button_states()


func _on_qi_changed(new_qi: int, _delta: int) -> void:
    _update_qi_display()
    _update_button_states()


func _on_score_changed(new_score: float, _delta: float) -> void:
    _update_score_display()


func _on_season_changed(season_name: String, _season_element: String) -> void:
    _update_season_display()
    _refresh_public_display()
    _refresh_hand_display()
    _update_button_states()


func _on_turn_changed(turn_number: int, turn_in_season: int) -> void:
    _update_season_display()


func _on_leverage_multiplier_changed(multiplier: float) -> void:
    current_leverage_multiplier = multiplier
    if current_leverage_multiplier <= 1.0:
        leverage_enabled = false
    _update_button_states()


# 按钮点击处理
func _on_buy_pressed() -> void:
    if selected_public_index < 0 or selected_public_index >= current_public_cards.size():
        return
    var card = current_public_cards[selected_public_index]
    var card_score = _calc_card_score(card)
    var cost = _calc_buy_cost(card_score, leverage_enabled)

    # 检查条件
    if qi_manager and qi_manager.current_qi < cost:
        return
    if hand_manager and hand_manager.get_empty_slot_count() <= 0:
        return
    if card_pool and card_pool.get_remaining_count() <= 0:
        return

    var leverage_mult = current_leverage_multiplier if leverage_enabled else 1.0
    action_selected.emit("buy", {
        "card_id": card.id,
        "slot_index": selected_public_index,
        "leverage": leverage_mult,
        "cost": cost
    })
    _disable_buttons()
    selected_public_index = -1
    leverage_enabled = false
    _update_button_states()


func _on_sell_pressed() -> void:
    if selected_hand_index < 0 or selected_hand_index >= current_hand_cards.size():
        return
    var slot_data = current_hand_cards[selected_hand_index]
    if slot_data == null:
        return

    # 检查气
    if qi_manager and qi_manager.current_qi < 3:
        return

    action_selected.emit("sell", {
        "slot_index": selected_hand_index,
        "card_id": slot_data.card.id
    })
    _disable_buttons()
    selected_hand_index = -1
    _update_button_states()


func _on_wait_pressed() -> void:
    action_selected.emit("wait", {})
    _disable_buttons()


func _on_leverage_pressed() -> void:
    if current_leverage_multiplier > 1.0:
        leverage_enabled = not leverage_enabled
        _update_button_states()


func _on_public_card_clicked(index: int) -> void:
    if selected_public_index == index:
        selected_public_index = -1
        # 取消高亮
        for i in range(public_container.get_child_count()):
            var slot = public_container.get_child(i)
            slot.highlight(false)
    else:
        selected_public_index = index
        selected_hand_index = -1
        # 高亮选中的公共牌，取消手牌高亮
        for i in range(public_container.get_child_count()):
            var slot = public_container.get_child(i)
            slot.highlight(i == index)
        for i in range(hand_container.get_child_count()):
            var slot = hand_container.get_child(i)
            slot.highlight(false)
    _update_button_states()


func _on_hand_card_clicked(index: int) -> void:
    if selected_hand_index == index:
        selected_hand_index = -1
        for i in range(hand_container.get_child_count()):
            var slot = hand_container.get_child(i)
            slot.highlight(false)
    else:
        selected_hand_index = index
        selected_public_index = -1
        # 高亮选中的手牌，取消公共牌高亮
        for i in range(hand_container.get_child_count()):
            var slot = hand_container.get_child(i)
            slot.highlight(i == index)
        for i in range(public_container.get_child_count()):
            var slot = public_container.get_child(i)
            slot.highlight(false)
    _update_button_states()


func _disable_buttons() -> void:
    buy_button.disabled = true
    sell_button.disabled = true
    wait_button.disabled = true
    leverage_button.disabled = true


func _enable_buttons() -> void:
    _update_button_states()
