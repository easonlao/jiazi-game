extends Node

## 杠杆计算器 - 全局单例 无状态工具类
## 提供根据季节内回合数获取杠杆倍数的功能
## LQC常量从QiManager读取, 但为了方便也定义常量
## 杠杆倍数表: 季节内回合 -> 倍数

const LEVERAGE_TABLE: Array[Dictionary] = [
    {"max_round": 3, "multiplier": 1.0},
    {"max_round": 6, "multiplier": 1.5},
    {"max_round": 9, "multiplier": 2.0},
    {"max_round": 11, "multiplier": 2.5},
    {"max_round": 12, "multiplier": 3.0}
]
const LQC: float = 10.0  # 杠杆额外气耗常数


## 根据季节内回合数获取杠杆倍数
static func get_multiplier(season_round: int) -> float:
    for entry in LEVERAGE_TABLE:
        if season_round <= entry["max_round"]:
            return entry["multiplier"]
    return 3.0  # fallback


## 判断该回合是否可以使用杠杆 (季节内回合 >= 1 即可, 但是1-3倍率为1, 本质上可以用)
static func is_leverage_available(season_round: int) -> bool:
    return season_round >= 1


## 计算持仓气耗 (与QiManager.calculate_hold_qi_cost 相同, 保持一致性)
static func calculate_hold_qi_cost(card_score: float, leverage: float) -> float:
    var base: float = max(0.5, 1.5 + 0.4 * card_score)
    return base * leverage


## 获取杠杆买入可用性描述 (用于UI)
static func get_leverage_multiplier_display(season_round: int) -> String:
    var mult: float = get_multiplier(season_round)
    return "%.1fx" % mult
