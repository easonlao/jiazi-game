class_name CardSlot
extends Control

## 卡牌槽位UI组件
## 显示单张卡牌信息，支持买入/卖出模式，五行配色，高亮选中

signal clicked(slot_index: int)

# 卡牌数据
var card: JiaziCard = null
var card_score: float = 0.0
var is_hand_slot: bool = false      # 手牌模式 vs 公共牌模式
var is_leverage: bool = false       # 是否杠杆牌（双层边框）
var profit: float = 0.0             # 盈亏差价（仅手牌模式）
var slot_index: int = 0

# 五行配色映射
static var ELEMENT_COLORS: Dictionary = {
    JiaziCard.Element.WOOD: {"main": Color("#4CAF50"), "light": Color("#E8F5E9"), "dark": Color("#2E7D32")},
    JiaziCard.Element.FIRE: {"main": Color("#FF5722"), "light": Color("#FBE9E7"), "dark": Color("#D84315")},
    JiaziCard.Element.EARTH: {"main": Color("#FFC107"), "light": Color("#FFF8E1"), "dark": Color("#F57F17")},
    JiaziCard.Element.METAL: {"main": Color("#FFD700"), "light": Color("#FFFDE7"), "dark": Color("#F9A825")},
    JiaziCard.Element.WATER: {"main": Color("#2196F3"), "light": Color("#E3F2FD"), "dark": Color("#1565C0")}
}

# UI控件引用
@onready var panel: Panel = $Panel
@onready var name_label: Label = $Panel/MarginContainer/VBoxContainer/NameLabel
@onready var element_label: Label = $Panel/MarginContainer/VBoxContainer/ElementLabel
@onready var score_label: Label = $Panel/MarginContainer/VBoxContainer/ScoreLabel
@onready var cost_label: Label = $Panel/MarginContainer/VBoxContainer/CostLabel
@onready var profit_label: Label = $Panel/MarginContainer/VBoxContainer/ProfitLabel
@onready var leverage_icon: Label = $Panel/LeverageIcon


func setup(p_card: JiaziCard, p_score: float, p_is_hand: bool, p_is_leverage: bool, p_index: int = 0) -> void:
    card = p_card
    card_score = p_score
    is_hand_slot = p_is_hand
    is_leverage = p_is_leverage
    slot_index = p_index
    _update_appearance()


func set_profit(p_profit: float) -> void:
    profit = p_profit
    if is_hand_slot:
        if profit > 0:
            profit_label.text = "盈 +%.1f" % profit
            profit_label.add_theme_color_override("font_color", Color.GREEN)
        elif profit < 0:
            profit_label.text = "亏 %.1f" % profit
            profit_label.add_theme_color_override("font_color", Color.RED)
        else:
            profit_label.text = "持平"
            profit_label.add_theme_color_override("font_color", Color.GRAY)
        profit_label.visible = true
    else:
        profit_label.visible = false


func set_buy_cost(cost: float, is_leverage_buy: bool) -> void:
    if not is_hand_slot:
        if is_leverage_buy:
            cost_label.text = "消耗: %.0f(杠)" % cost
        else:
            cost_label.text = "消耗: %.0f" % cost


func update_hand_profit(current_score: float, buy_score: float, leverage: float) -> void:
    var new_profit: float = (current_score - buy_score) * leverage
    set_profit(new_profit)


func highlight(enable: bool) -> void:
    if enable:
        var style = StyleBoxFlat.new()
        style.bg_color = panel.get_theme_stylebox("panel").bg_color
        style.border_width_all = 3
        style.border_color = Color("#FF6F00")  # 橙色高亮
        panel.add_theme_stylebox_override("panel", style)
    else:
        _update_appearance()


func _update_appearance() -> void:
    if not card:
        return

    # 设置文字
    name_label.text = card.name
    var element_str: String = card.get_element_string(card.main_element)
    element_label.text = element_str.capitalize()

    # 格式化评分（保留一位小数）
    score_label.text = "%.1f" % card_score
    if card_score >= 0:
        score_label.add_theme_color_override("font_color", Color.GREEN)
    else:
        score_label.add_theme_color_override("font_color", Color.RED)

    # 根据模式设置底部文字
    if is_hand_slot:
        cost_label.text = "卖出 -3气"
        cost_label.add_theme_color_override("font_color", Color.ORANGE)
    else:
        cost_label.text = "消耗: ?"
        cost_label.add_theme_color_override("font_color", Color.BLUE)

    # 五行配色
    var element = card.main_element
    var colors = ELEMENT_COLORS.get(element, ELEMENT_COLORS[JiaziCard.Element.WOOD])
    var style = StyleBoxFlat.new()
    style.bg_color = colors["light"]
    style.border_width_bottom = 2
    style.border_color = colors["main"]
    panel.add_theme_stylebox_override("panel", style)

    # 杠杆牌特殊边框
    if is_leverage:
        var outer_style = StyleBoxFlat.new()
        outer_style.bg_color = Color.TRANSPARENT
        outer_style.border_width_all = 2
        outer_style.border_color = Color.ORANGE
        panel.add_theme_stylebox_override("panel", outer_style)
        leverage_icon.visible = true
    else:
        leverage_icon.visible = false

    # 阴阳显示
    var yy_text: String = "阳" if card.yin_yang == JiaziCard.YinYang.YANG else "阴"
    element_label.text += " (%s)" % yy_text


func _input_event(viewport: Viewport, event: InputEvent, shape_idx: int) -> void:
    if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
        clicked.emit(slot_index)
