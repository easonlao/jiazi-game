class_name CardSlot
extends Control

signal clicked(index: int)

var card: JiaziCard = null
var slot_index: int = 0
var is_highlighted: bool = false

# Visual elements
var bg_panel: Panel
var name_label: Label
var score_label: Label
var profit_label: Label

func _ready() -> void:
    setup_visuals()

func setup_visuals() -> void:
    custom_minimum_size = Vector2(120, 150)
    bg_panel = Panel.new()
    bg_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    bg_panel.add_theme_color_override("panel", Color(0.2, 0.2, 0.25, 0.9))
    add_child(bg_panel)

    name_label = Label.new()
    name_label.position = Vector2(10, 10)
    name_label.size = Vector2(100, 30)
    name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    add_child(name_label)

    score_label = Label.new()
    score_label.position = Vector2(10, 50)
    score_label.size = Vector2(100, 30)
    score_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    add_child(score_label)

    profit_label = Label.new()
    profit_label.position = Vector2(10, 90)
    profit_label.size = Vector2(100, 30)
    profit_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
    add_child(profit_label)

func setup(p_card: JiaziCard, p_score: float, is_hand: bool, is_leverage: bool) -> void:
    card = p_card
    name_label.text = card.name
    score_label.text = "Score: %.1f" % p_score
    profit_label.text = ""
    if is_leverage:
        name_label.add_theme_color_override("font_color", Color(1, 0.5, 0, 1))

func set_profit(profit: float) -> void:
    profit_label.text = "Profit: %.1f" % profit
    if profit > 0:
        profit_label.add_theme_color_override("font_color", Color(0.3, 0.8, 0.3, 1))
    elif profit < 0:
        profit_label.add_theme_color_override("font_color", Color(0.9, 0.2, 0.2, 1))
    else:
        profit_label.add_theme_color_override("font_color", Color(0.8, 0.8, 0.8, 1))

func set_buy_cost(cost: float, is_leverage: bool) -> void:
    score_label.text = "Cost: %.1f" % cost

func highlight(enable: bool) -> void:
    is_highlighted = enable
    if enable:
        bg_panel.add_theme_color_override("panel", Color(0.4, 0.4, 0.5, 0.9))
    else:
        bg_panel.add_theme_color_override("panel", Color(0.2, 0.2, 0.25, 0.9))

func _input_event(viewport: Viewport, event: InputEvent, shape_idx: int) -> void:
    if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
        clicked.emit(slot_index)
