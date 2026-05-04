class_name JiaziCard
extends RefCounted

enum Element { WOOD, FIRE, EARTH, METAL, WATER }
enum YinYang { YANG, YIN }

var id: String = ""
var name: String = ""
var tian_gan: String = ""
var di_zhi: String = ""
var tian_gan_element: Element = Element.WOOD
var di_zhi_element: Element = Element.WOOD
var main_element: Element = Element.WOOD
var yin_yang: YinYang = YinYang.YANG

func _init(p_id: String = "", p_name: String = "", p_tian_gan: String = "", p_di_zhi: String = "",
           p_tian_gan_element: Element = Element.WOOD, p_di_zhi_element: Element = Element.WOOD,
           p_main_element: Element = Element.WOOD, p_yin_yang: YinYang = YinYang.YANG) -> void:
    id = p_id
    name = p_name
    tian_gan = p_tian_gan
    di_zhi = p_di_zhi
    tian_gan_element = p_tian_gan_element
    di_zhi_element = p_di_zhi_element
    main_element = p_main_element
    yin_yang = p_yin_yang

func get_element_string(element: Element) -> String:
    match element:
        Element.WOOD: return "wood"
        Element.FIRE: return "fire"
        Element.EARTH: return "earth"
        Element.METAL: return "metal"
        Element.WATER: return "water"
        _: return ""

func get_yin_yang_string() -> String:
    match yin_yang:
        YinYang.YANG: return "yang"
        YinYang.YIN: return "yin"
        _: return ""

func to_dict() -> Dictionary:
    return {
        "id": id,
        "name": name,
        "tianGan": tian_gan,
        "diZhi": di_zhi,
        "tianGanElement": get_element_string(tian_gan_element),
        "diZhiElement": get_element_string(di_zhi_element),
        "mainElement": get_element_string(main_element),
        "yinYang": get_yin_yang_string()
    }
