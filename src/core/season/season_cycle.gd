class_name SeasonCycle
extends Node

## 季节循环管理器 - 全局单例
## 管理四季顺序和长度, 每季3-12回合随机, 总计60回合
## 提供季节内回合计数和季节推进

enum Season { SPRING, SUMMER, AUTUMN, WINTER }
const SEASON_NAMES: Dictionary = {
    Season.SPRING: "spring",
    Season.SUMMER: "summer",
    Season.AUTUMN: "autumn",
    Season.WINTER: "winter"
}

# 季节长度范围
const MIN_SEASON_LEN: int = 3
const MAX_SEASON_LEN: int = 12
const TOTAL_TURNS: int = 60

# 预先生成的季节长度数组 (索引对应季节轮次)
var _season_lengths: Array[int] = []
# 当前季节索引 (0-3)
var _current_season_idx: int = Season.SPRING
# 当前季节内进行的回合数 (1-based, 从1开始)
var _season_round: int = 1
# 游戏总回合计数器
var _total_round: int = 0

signal season_changed(new_season: Season, old_season: Season)
signal round_advanced(total_round: int)


func _ready() -> void:
    generate_season_lengths()
    reset()


## 生成季节长度, 确保总和为TOTAL_TURNS
func generate_season_lengths() -> void:
    _season_lengths.clear()
    var remaining: int = TOTAL_TURNS
    var season_count: int = 0
    while remaining > 0 and season_count < 100:  # 防止无限循环
        var next_len: int
        if remaining <= MAX_SEASON_LEN:
            next_len = remaining
        else:
            # 为后续季节至少留出最小长度
            var max_allowed: int = min(MAX_SEASON_LEN, remaining - MIN_SEASON_LEN)
            if max_allowed < MIN_SEASON_LEN:
                max_allowed = remaining
            next_len = _randi_range(MIN_SEASON_LEN, max_allowed)
        _season_lengths.append(next_len)
        remaining -= next_len
        season_count += 1


## 重置到春季初始回合
func reset() -> void:
    _current_season_idx = Season.SPRING
    _season_round = 1
    _total_round = 0
    # 确保长度足够
    if _season_lengths.is_empty():
        generate_season_lengths()


## 推进到下一回合, 返回是否季节切换
func advance_round() -> bool:
    if is_game_complete():
        return false
    _total_round += 1
    _season_round += 1
    var season_length: int = _season_lengths[_current_season_idx]
    if _season_round > season_length:
        advance_season()
        return true
    round_advanced.emit(_total_round)
    return false


## 强制推进到下一个季节
func advance_season() -> void:
    var old_season: Season = _current_season_idx
    _current_season_idx = (_current_season_idx + 1) % 4
    _season_round = 1
    # 确保 seasons 数组有当前季节的长度
    while _current_season_idx >= _season_lengths.size():
        # 如果到达末尾但游戏未结束, 生成额外季节(正常情况下不会, 因为TOTAL_TURNS封闭)
        extend_season_lengths()
    season_changed.emit(_current_season_idx, old_season)
    round_advanced.emit(_total_round)


## 扩展季节长度数组(仅在意外时调用)
func extend_season_lengths() -> void:
    var extra: int = _randi_range(MIN_SEASON_LEN, MAX_SEASON_LEN)
    _season_lengths.append(extra)


## 获取当前季节
func get_current_season() -> Season:
    return _current_season_idx


## 获取当前季节内回合数 (1-based)
func get_season_round() -> int:
    return _season_round


## 判断当前季节是否结束
func is_season_end() -> bool:
    return _season_round > get_current_season_length()


## 获取当前季节总长度
func get_current_season_length() -> int:
    if _current_season_idx < _season_lengths.size():
        return _season_lengths[_current_season_idx]
    return MAX_SEASON_LEN


## 获取游戏总回合数
func get_total_round() -> int:
    return _total_round


## 游戏是否已完成所有回合
func is_game_complete() -> bool:
    return _total_round >= TOTAL_TURNS


## 随机整数 [min, max]
func _randi_range(min_val: int, max_val: int) -> int:
    return randi() % (max_val - min_val + 1) + min_val


## 获取季节名称字符串
func get_season_name(season: Season) -> String:
    return SEASON_NAMES.get(season, "")
