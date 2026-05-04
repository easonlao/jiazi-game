class_name CardSlot
extends Control

## 卡牌槽位UI组件 - 显示单张卡牌信息
## 支持买入/卖出模式，根据五行配色，可高亮选中

signal clicked()

# 卡牌数据
var card: JiaziCard = null
var card_score: float = 0.0
var is_hand_slot: bool = false   # 手牌模式 vs 公共牌模式
var is_leverage: bool = false    # 是否杠杆牌（双层边框）
var profit: float = 0.0          # 盈亏差价（仅手牌模式）

# UI控件引用（通过场景树查找或动态创建）
var panel: Panel
var name_label: Label
var element_label: Label
var score_label: Label
var cost_label: Label
var profit_label: Label
var leverage_icon: Label

# 五行配色映射
static var ELEMENT_COLORS: Dictionary = {
    JiaziCard.Element.WOOD: {"main": Color("#4CAF50"), "light": Color("#E8F5E9"), "dark": Color("#2E7D32")},
    JiaziCard.Element.FIRE: {"main": Color("#FF5722"), "light": Color("#FBE9E7"), "dark": Color("#D84315")},
    JiaziCard.Element.EARTH: {"main": Color("#FFC107"), "light": Color("#FFF8E1"), "dark": Color("#F57F17")},
    JiaziCard.Element.METAL: {"main": Color("#FFD700"), "light": Color("#FFFDE7"), "dark": Color("#F9A825")},
    JiaziCard.Element.WATER: {"main": Color("#2196F3"), "light": Color("#E3F2FD"), "dark": Color("#1565C0")}
}


func _ready() -> void:
    _build_ui()


func _build_ui() -> void:
    # 创建基本结构
    panel = Panel.new()
    panel.size = Vector2(120, 150)
    panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    add_child(panel)

    # 标题名称
    name_label = Label.new()
    name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    name_label.add_theme_font_size_override("font_size", 18)
    name_label.position = Vector2(10, 10)
    name_label.size = Vector2(100, 30)
    panel.add_child(name_label)

    # 阴阳/元素文字
    element_label = Label.new()
    element_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    element_label.add_theme_font_size_override("font_size", 12)
    element_label.position = Vector2(10, 45)
    element_label.size = Vector2(100, 20)
    panel.add_child(element_label)

    # 评分
    score_label = Label.new()
    score_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    score_label.add_theme_font_size_override("font_size", 16)
    score_label.position = Vector2(10, 70)
    score_label.size = Vector2(100, 25)
    panel.add_child(score_label)

    # 消耗或盈亏
    cost_label = Label.new()
    cost_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    cost_label.add_theme_font_size_override("font_size", 12)
    cost_label.position = Vector2(10, 100)
    cost_label.size = Vector2(100, 20)
    panel.add_child(cost_label)

    # 收益标签（手牌模式）
    profit_label = Label.new()
    profit_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    profit_label.add_theme_font_size_override("font_size", 10)
    profit_label.position = Vector2(10, 120)
    profit_label.size = Vector2(100, 20)
    panel.add_child(profit_label)

    # 杠杆标识
    leverage_icon = Label.new()
    leverage_icon.text = "⚡"
    leverage_icon.add_theme_color_override("font_color", Color.ORANGE)
    leverage_icon.position = Vector2(90, 5)
    leverage_icon.size = Vector2(20, 20)
    leverage_icon.visible = false
    panel.add_child(leverage_icon)


func setup(p_card: JiaziCard, p_score: float, p_is_hand: bool, p_is_leverage: bool) -> void:
    card = p_card
    card_score = p_score
    is_hand_slot = p_is_hand
    is_leverage = p_is_leverage

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
        # 手牌模式：显示卖出行气消耗
        cost_label.text = "卖出 -3气"
        cost_label.add_theme_color_override("font_color", Color.ORANGE)
    else:
        # 公共牌模式：显示买入消耗（动态更新，先留空）
        cost_label.text = "消耗: ?"
        cost_label.add_theme_color_override("font_color", Color.BLUE)

    # 五行配色
    var element = card.main_element
    var colors = ELEMENT_COLORS.get(element, ELEMENT_COLORS[JiaziCard.Element.WOOD])
    panel.add_theme_stylebox_override("panel", StyleBoxFlat.new())
    var style = panel.get_theme_stylebox("panel") as StyleBoxFlat
    style.bg_color = colors["light"]
    style.border_width_bottom = 2
    style.border_color = colors["main"]

    # 杠杆牌特殊边框
    if is_leverage:
        var outer_style = StyleBoxFlat.new()
        outer_style.bg_color = Color.TRANSPARENT
        outer_style.border_width_all = 2
        outer_style.border_color = Color.ORANGE
        panel.add_theme_stylebox_override("panel", outer_style)
        leverage_icon.visible = true
        # 添加倍率标签
        var mult_label = Label.new()
        mult_label.text = "%.1fx" % (card_score / 10.0)  # 示意，实际应从leverage传入
        # 简化处理，不在UI层计算倍率
    else:
        leverage_icon.visible = false

    # 阴阳显示
    var yy_text: String = "阳" if card.yin_yang == JiaziCard.YinYang.YANG else "阴"
    element_label.text += " (%s)" % yy_text


func highlight(enable: bool) -> void:
    if enable:
        var style = StyleBoxFlat.new()
        style.bg_color = panel.get_theme_stylebox("panel").bg_color
        style.border_width_all = 3
        style.border_color = Color("#FF6F00")  # 橙色高亮
        panel.add_theme_stylebox_override("panel", style)
    else:
        _update_appearance()  # 恢复原样


func _input_event(event: InputEvent) -> void:
    if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
        clicked.emit()


func set_buy_cost(cost: float, is_leverage_buy: bool) -> void:
    if not is_hand_slot:
        if is_leverage_buy:
            cost_label.text = "消耗: %.1f(杠)" % cost
        else:
            cost_label.text = "消耗: %.1f" % cost


func update_hand_profit(current_score: float, buy_score: float, leverage: float) -> void:
    var new_profit: float = (current_score - buy_score) * leverage
    set_profit(new_profit)
