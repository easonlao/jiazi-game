extends CanvasLayer
class_name UIManager

signal action_selected(action: String, data: Dictionary)

var turn_manager: TurnManager
var hand_manager: HandManager
var card_pool: CardPoolManager
var qi_manager: QiManager
var score_manager: ScoreManager
var season_cycle: SeasonCycle
var leverage_calc: LeverageCalculator

var main_container: Control
var score_label: Label
var season_label: Label
var turn_label: Label
var hand_panel: Panel
var buy_button: Button
var sell_button: Button
var wait_button: Button

var hand_slots: Array[CardSlot] = []
var current_public_cards: Array[JiaziCard] = []
var selected_public_index: int = -1
var selected_hand_index: int = -1

func _ready() -> void:
    turn_manager = get_node("/root/TurnManager")
    hand_manager = get_node("/root/HandManager")
    card_pool = get_node("/root/CardPoolManager")
    qi_manager = get_node("/root/QiManager")
    score_manager = get_node("/root/ScoreManager")
    season_cycle = get_node("/root/SeasonCycle")
    leverage_calc = get_node("/root/LeverageCalculator")

    build_ui()
    connect_signals()

func build_ui() -> void:
    main_container = Control.new()
    main_container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
    add_child(main_container)

    score_label = Label.new()
    score_label.text = "Score: 0"
    score_label.position = Vector2(20, 20)
    main_container.add_child(score_label)

    season_label = Label.new()
    season_label.text = "Season: Spring"
    season_label.position = Vector2(20, 50)
    main_container.add_child(season_label)

    turn_label = Label.new()
    turn_label.text = "Turn: 0"
    turn_label.position = Vector2(20, 80)
    main_container.add_child(turn_label)

    hand_panel = Panel.new()
    hand_panel.position = Vector2(20, 150)
    hand_panel.size = Vector2(388, 300)
    main_container.add_child(hand_panel)

    var button_panel = Panel.new()
    button_panel.position = Vector2(20, 680)
    button_panel.size = Vector2(388, 60)
    main_container.add_child(button_panel)

    buy_button = Button.new()
    buy_button.text = "Buy"
    buy_button.position = Vector2(10, 10)
    buy_button.size = Vector2(100, 40)
    button_panel.add_child(buy_button)

    sell_button = Button.new()
    sell_button.text = "Sell"
    sell_button.position = Vector2(120, 10)
    sell_button.size = Vector2(100, 40)
    button_panel.add_child(sell_button)

    wait_button = Button.new()
    wait_button.text = "Wait"
    wait_button.position = Vector2(230, 10)
    wait_button.size = Vector2(100, 40)
    button_panel.add_child(wait_button)

    buy_button.pressed.connect(_on_buy_pressed)
    sell_button.pressed.connect(_on_sell_pressed)
    wait_button.pressed.connect(_on_wait_pressed)

func connect_signals() -> void:
    if score_manager:
        score_manager.score_changed.connect(_on_score_changed)
    if turn_manager:
        turn_manager.turn_started.connect(_on_turn_started)
        turn_manager.player_action_required.connect(_on_player_action_required)
        turn_manager.season_changed.connect(_on_season_changed)
    if season_cycle:
        season_cycle.season_changed.connect(_on_season_changed)
    if hand_manager:
        hand_manager.hand_updated.connect(_on_hand_updated)
    if card_pool:
        card_pool.cards_drawn.connect(_on_cards_drawn)

func _on_score_changed(new_score: float, _delta: float) -> void:
    if score_label:
        score_label.text = "Score: " + str(round(new_score))

func _on_turn_started(turn_number: int) -> void:
    if turn_label:
        turn_label.text = "Turn: " + str(turn_number)

func _on_season_changed(season_name: String, season_element: String) -> void:
    if season_label:
        season_label.text = "Season: " + season_name + " (" + season_element + ")"

func _on_player_action_required(_available_actions: Array) -> void:
    buy_button.disabled = false
    sell_button.disabled = false
    wait_button.disabled = false

func _on_hand_updated() -> void:
    _refresh_hand_display()

func _on_cards_drawn(public_cards: Array) -> void:
    current_public_cards = public_cards
    _refresh_public_display()

func _refresh_public_display() -> void:
    for child in hand_panel.get_children():
        if child is CardSlot:
            child.queue_free()
    var x_offset = 10
    var y_offset = 10
    var card_width = 80
    var card_height = 120
    for i in range(current_public_cards.size()):
        var card = current_public_cards[i]
        var slot = CardSlot.new()
        slot.slot_index = i
        slot.setup(card, 0, false, false)
        slot.position = Vector2(x_offset + i * (card_width + 10), y_offset)
        slot.size = Vector2(card_width, card_height)
        slot.clicked.connect(_on_public_card_clicked)
        hand_panel.add_child(slot)

func _refresh_hand_display() -> void:
    for child in hand_panel.get_children():
        if child is CardSlot and child not in hand_slots:
            child.queue_free()
    var slots = hand_manager.get_all_slots() if hand_manager else []
    hand_slots.clear()
    var x_offset = 10
    var y_offset = 10
    var card_width = 80
    var card_height = 120
    for i in range(slots.size()):
        var slot_data = slots[i]
        if slot_data.is_empty():
            continue
        var card_slot = CardSlot.new()
        card_slot.slot_index = i
        card_slot.setup(slot_data.card, 0, true, slot_data.leverage > 1.0)
        card_slot.position = Vector2(x_offset + i * (card_width + 10), y_offset)
        card_slot.size = Vector2(card_width, card_height)
        card_slot.clicked.connect(_on_hand_card_clicked)
        hand_panel.add_child(card_slot)
        hand_slots.append(card_slot)

func _on_public_card_clicked(index: int) -> void:
    selected_public_index = index
    for slot in hand_panel.get_children():
        if slot is CardSlot and slot.slot_index == index:
            slot.highlight(true)
        elif slot is CardSlot:
            slot.highlight(false)

func _on_hand_card_clicked(index: int) -> void:
    selected_hand_index = index
    for slot in hand_slots:
        if slot.slot_index == index:
            slot.highlight(true)
        else:
            slot.highlight(false)

func _on_buy_pressed() -> void:
    if selected_public_index < 0 or selected_public_index >= current_public_cards.size():
        return
    var card = current_public_cards[selected_public_index]
    action_selected.emit("buy", {"card_id": card.id, "leverage": 1.0})
    _disable_buttons()
    selected_public_index = -1

func _on_sell_pressed() -> void:
    if selected_hand_index < 0:
        return
    action_selected.emit("sell", {"slot_index": selected_hand_index})
    _disable_buttons()
    selected_hand_index = -1

func _on_wait_pressed() -> void:
    action_selected.emit("wait", {})
    _disable_buttons()

func _disable_buttons() -> void:
    buy_button.disabled = true
    sell_button.disabled = true
    wait_button.disabled = true
