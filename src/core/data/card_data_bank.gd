extends Node

func _ready() -> void:
    load_cards()

func load_cards() -> void:
    var path: String = "res://assets/data/jiazi_cards.json"
    if not FileAccess.file_exists(path):
        printerr("CardDataBank: JSON file not found at ", path)
        return

    var file: FileAccess = FileAccess.open(path, FileAccess.READ)
    if file == null:
        printerr("CardDataBank: Failed to open ", path)
        return

    var content: String = file.get_as_text()
    var json: Variant = JSON.parse_string(content)
    if json == null or typeof(json) != TYPE_ARRAY:
        printerr("CardDataBank: Invalid JSON format")
        return

    _cards.clear()
    _all_cards.clear()

    for card_data in json:
        var card: JiaziCard = _parse_card(card_data)
        if card:
            _cards[card.id] = card
            _all_cards.append(card)

    print("CardDataBank: Loaded ", _cards.size(), " cards.")

func _parse_card(data: Dictionary) -> JiaziCard:
    if not data.has_all(["id", "name", "tianGan", "diZhi", "tianGanElement", "diZhiElement", "mainElement", "yinYang"]):
        return null

    var card := JiaziCard.new()
    card.id = str(data["id"])
    card.name = data["name"]
    card.tian_gan = data["tianGan"]
    card.di_zhi = data["diZhi"]
    card.tian_gan_element = _string_to_element(data["tianGanElement"])
    card.di_zhi_element = _string_to_element(data["diZhiElement"])
    card.main_element = _string_to_element(data["mainElement"])
    card.yin_yang = _string_to_yin_yang(data["yinYang"])
    return card

func _string_to_element(element_str: String) -> JiaziCard.Element:
    match element_str.to_lower():
        "wood": return JiaziCard.Element.WOOD
        "fire": return JiaziCard.Element.FIRE
        "earth": return JiaziCard.Element.EARTH
        "metal": return JiaziCard.Element.METAL
        "water": return JiaziCard.Element.WATER
        _: return JiaziCard.Element.WOOD

func _string_to_yin_yang(yy_str: String) -> JiaziCard.YinYang:
    match yy_str.to_lower():
        "yang": return JiaziCard.YinYang.YANG
        "yin": return JiaziCard.YinYang.YIN
        _: return JiaziCard.YinYang.YANG

func get_card(id: String) -> JiaziCard:
    return _cards.get(id, null)

func get_all_cards() -> Array[JiaziCard]:
    return _all_cards.duplicate()

func get_random_card() -> JiaziCard:
    if _all_cards.is_empty():
        return null
    return _all_cards[randi() % _all_cards.size()]

func get_card_count() -> int:
    return _all_cards.size()
