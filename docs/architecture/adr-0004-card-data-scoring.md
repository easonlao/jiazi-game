# ADR-0004: 卡片数据结构和评分公式实现

## Status
Proposed

## Date
2026-05-04

## Engine Compatibility

| Field | Value |
|-------|-------|
| **Engine** | Godot 4.6 |
| **Domain** | Core / Data |
| **Knowledge Risk** | LOW (data structures, no post-cutoff APIs) |
| **References Consulted** | `docs/engine-reference/godot/current-best-practices.md` (static typing, preload) |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Ensure JSON loading handles missing fields gracefully |

## ADR Dependencies

| Field | Value |
|-------|-------|
| **Depends On** | ADR-0002 (Singleton vs Node design) |
| **Enables** | All scoring, card pool, hand management implementation |
| **Blocks** | None |
| **Ordering Note** | ADR-0004 should be Accepted before implementing any card-related logic |

## Context

### Problem Statement
甲子纪 requires data definitions for all 60 Jiazi cards, including their names, elements, and scoring rules per season. The scoring formula combines tian gan (heavenly stem) base scores with cang gan (hidden stem) contributions. We need a data structure that is easy to author, load, and query at runtime.

### Constraints
- Card data must be editable without recompiling the game (designers may tweak values)
- Performance: card data lookups must be O(1) (no linear searches)
- Memory: 60 cards × ~200 bytes = ~12KB — trivial
- Must support seasonal scoring queries efficiently

### Requirements
- Define all 60 Jiazi cards (id, name, tian_gan, di_zhi, elements)
- Provide lookup by ID
- Calculate card score for a given season (tian gan base + cang gan weighted sum)
- Support future extensions (combination bonuses, yin-yang modifiers)

## Decision

### Data Storage Format

**JSON resource file** (`res://data/cards/jiazi_cards.json`):

```json
{
  "version": 1,
  "cards": [
    {
      "id": 1,
      "name": "甲子",
      "tian_gan": "甲",
      "di_zhi": "子",
      "tian_gan_element": "wood",
      "di_zhi_element": "water",
      "main_element": "wood",
      "yin_yang": "yang"
    },
    ...
  ]
}
```

### Data Class Definition (GDScript)

```gdscript
# CardDataBank.gd (Autoload)
extends Node

class JiaziCard:
    var id: int
    var name: String
    var tian_gan: String
    var di_zhi: String
    var tian_gan_element: String
    var di_zhi_element: String
    var main_element: String
    var yin_yang: String  # "yang" or "yin"

# Cang gan mapping (di_zhi → array of [gan, weight])
const CANG_GAN_DICT: Dictionary = {
    "子": [["癸", 1.0]],
    "丑": [["己", 0.6], ["癸", 0.2], ["辛", 0.2]],
    "寅": [["甲", 0.6], ["丙", 0.3], ["戊", 0.1]],
    "卯": [["乙", 1.0]],
    "辰": [["戊", 0.6], ["乙", 0.3], ["癸", 0.1]],
    "巳": [["丙", 0.6], ["庚", 0.3], ["戊", 0.1]],
    "午": [["丁", 0.7], ["己", 0.3]],
    "未": [["己", 0.6], ["丁", 0.2], ["乙", 0.2]],
    "申": [["庚", 0.6], ["壬", 0.3], ["戊", 0.1]],
    "酉": [["辛", 1.0]],
    "戌": [["戊", 0.6], ["辛", 0.3], ["丁", 0.1]],
    "亥": [["壬", 0.7], ["甲", 0.3]]
}

# Element to season score mapping (season values: -3, -1, +2, +4)
const ELEMENT_SEASON_SCORE: Dictionary = {
    "wood": {"spring": 4, "summer": 2, "autumn": -3, "winter": -1},
    "fire": {"spring": 2, "summer": 4, "autumn": -1, "winter": -3},
    "earth": {"spring": 1, "summer": 1, "autumn": 1, "winter": 1},
    "metal": {"spring": -3, "summer": -1, "autumn": 4, "winter": 2},
    "water": {"spring": -1, "summer": -3, "autumn": 2, "winter": 4}
}

const CANG_GAN_WEIGHT: float = 0.5

var _cards: Array[JiaziCard] = []
var _cards_by_id: Dictionary = {}

func _ready() -> void:
    load_cards_from_json()

func load_cards_from_json() -> void:
    var file = FileAccess.open("res://data/cards/jiazi_cards.json", FileAccess.READ)
    var json = JSON.parse_string(file.get_as_text())
    for card_data in json["cards"]:
        var card = JiaziCard.new()
        card.id = card_data["id"]
        card.name = card_data["name"]
        card.tian_gan = card_data["tian_gan"]
        card.di_zhi = card_data["di_zhi"]
        card.tian_gan_element = card_data["tian_gan_element"]
        card.di_zhi_element = card_data["di_zhi_element"]
        card.main_element = card_data["main_element"]
        card.yin_yang = card_data.get("yin_yang", "")
        _cards.append(card)
        _cards_by_id[card.id] = card

func get_card(id: int) -> JiaziCard:
    return _cards_by_id.get(id)

func get_all_cards() -> Array[JiaziCard]:
    return _cards.duplicate()
```

### Scoring Calculation

```gdscript
# ScoreManager.gd (Autoload)
extends Node

signal score_changed(new_score: float, delta: float)

var total_score: float = 0.0
const HOLD_BONUS: float = 1.2
const SELL_BASE: float = 8.0
const SPREAD_MULTIPLIER: float = 4.0

func calculate_card_score(card: JiaziCard, season: String) -> float:
    var tian_gan_score = CardDataBank.ELEMENT_SEASON_SCORE[card.tian_gan_element][season]
    
    var cang_gan_score_sum: float = 0.0
    var cang_list = CardDataBank.CANG_GAN_DICT.get(card.di_zhi, [])
    for entry in cang_list:
        var gan = entry[0]
        var weight = entry[1]
        # Map gan to element (simplified: use tian_gan of the gan)
        var gan_element = _get_element_from_gan(gan)
        var gan_season_score = CardDataBank.ELEMENT_SEASON_SCORE[gan_element][season]
        cang_gan_score_sum += weight * gan_season_score
    
    return tian_gan_score + CardDataBank.CANG_GAN_WEIGHT * cang_gan_score_sum

func calculate_hold_score(hand: Array, season: String) -> float:
    var total: float = 0.0
    for slot in hand:
        if slot == null or slot.card == null:
            continue
        var card_score = calculate_card_score(slot.card, season)
        total += HOLD_BONUS * card_score * slot.leverage
    return total

func calculate_sell_score(card: JiaziCard, buy_score: float, season: String, leverage: float) -> float:
    var sell_score = calculate_card_score(card, season)
    return (SELL_BASE + (sell_score - buy_score) * SPREAD_MULTIPLIER) * leverage

func add_score(value: float) -> void:
    total_score += value
    score_changed.emit(total_score, value)
```

### Extension Points

预留扩展接口，MVP 阶段不实现但结构已就位：
- **Combination bonuses**: 天干地支配合 (如甲寅双木加成)
- **Yin-Yang modifiers**: 阳干/阴干的收益差异
- 通过配置表注入，不改核心代码

## Alternatives Considered

### Alternative 1: 硬编码卡牌数据

- **Description**: 直接在 GDScript 中定义 60 个常量。
- **Pros**: 简单，无需文件 I/O。
- **Cons**: 修改需要重编译；不便于设计迭代。
- **Rejection Reason**: 违反数据驱动原则，不利于调参。

### Alternative 2: 使用 Godot Resource (.tres)

- **Description**: 每张卡牌定义为单独的 Resource 文件。
- **Pros**: Godot 原生支持，可视化编辑。
- **Cons**: 60 个文件难以管理；跨卡牌查询需要在场景中加载所有资源。
- **Rejection Reason**: JSON 单文件更简洁，适合批量数据。

## Consequences

### Positive
- 卡牌数据与代码分离，设计者可直接编辑 JSON。
- 评分公式集中管理，易于调参。
- 藏干数据独立于卡牌，减少数据冗余。

### Negative
- JSON 加载需要错误处理（文件缺失、格式错误）。
- 藏干到五行的映射需要手动维护（约 12 条规则）。

### Risks
- **JSON 加载失败风险**: 文件路径错误或格式错误会导致游戏无法启动。缓解：提供默认回退数据；在 `_ready()` 中捕获错误并打印日志。
- **藏干映射不完整风险**: 某些地支的藏干规则可能遗漏。缓解：与 GDD 核对；单元测试覆盖所有 60 张牌的评分。

## GDD Requirements Addressed

| GDD System | Requirement | How This ADR Addresses It |
|------------|-------------|--------------------------|
| system-jiazi-cards.md | 60 甲子牌数据完整 | JSON 包含所有卡牌的完整定义 |
| system-jiazi-cards.md | 每张牌的天干、地支、五行属性 | 数据结构包含所有字段 |
| system-scoring.md | 卡牌评分公式 (天干 + 藏干加权) | score = tian_gan_score + 0.5 × Σ(藏干分) |
| system-scoring.md | 持仓收益计算公式 | `HOLD_BONUS(1.2) × 卡牌评分 × 杠杆` |
| system-scoring.md | 卖出收益计算公式 | `SELL_BASE(8) + (卖出-买入评分)×4 × 杠杆` |

## Performance Implications
- **CPU**: 每次评分计算 O(1) — 最多遍历 3 个藏干，可忽略。
- **Memory**: 所有卡牌数据约 50KB，可忽略。
- **Load Time**: JSON 加载发生在启动时，约 10-20ms。

## Migration Plan
Not applicable (first implementation).

## Validation Criteria
- [ ] JSON 文件包含 60 张完整卡牌，每张卡牌字段完整。
- [ ] 所有卡牌可以通过 ID 查询返回正确数据。
- [ ] 评分公式对每个季节返回预期值（单元测试验证）。
- [ ] 藏干权重正确影响评分。
- [ ] 持仓收益和卖出收益计算正确。

## Related Decisions
- ADR-0002: 单例与节点式模块设计 (CardDataBank as Autoload)
- ADR-0003: 信号驱动的模块间通信 (ScoreManager emits score_changed)