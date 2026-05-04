# 更新日志

本文档记录 Jiazi Chronicle (甲子纪) 的主要版本变更。

---

## v0.0.1 (2026-05-04)

### 内部更新日志 — 首次可玩版本

**首次可玩版本** — 核心循环已实现，所有基础系统就位。

#### 新增系统

| 系统 | 文件 | 说明 |
|------|------|------|
| 季节循环 | `src/core/season/season_cycle.gd` | 四季顺序(春/夏/秋/冬)，每季3-12回合随机，总计60回合 |
| 气资源管理 | `src/core/qi/qi_manager.gd` | 上限80，初始50，每回合回复7点(等待额外+10)，买入/卖出/持仓消耗 |
| 回合流程 | `src/core/turn/turn_manager.gd` | 玩家回合→结算→游戏结束状态机，7步序列(抽牌→展示→等待输入) |
| 手牌管理 | `src/core/hand/hand_manager.gd` | 3槽位，买入/卖出操作，杠杆追踪用于强制平仓 |
| 牌池管理 | `src/core/card_pool/card_pool_manager.gd` | 60张甲子牌洗牌，每回合抽2张展示，未选牌随机插回，买入永久移除 |
| 计分系统 | `src/core/scoring/score_manager.gd` | 持仓积分/卖出积分计算，元素/阴阳加成，差价乘数4倍 |
| 杠杆计算 | `src/core/leverage/leverage_calculator.gd` | 赛季内回合→倍数(1.0/1.5/2.0/2.5/3.0) |
| 卡牌数据 | `src/core/data/card_data_bank.gd` | JSON加载60张甲子牌(天干/地支/元素/阴阳) |
| UI系统 | `src/ui/ui_manager.gd` | 分数/季节/回合显示，手牌区/公共区，买入/卖出/等待按钮 |

#### 测试覆盖

- `tests/unit/test_season_cycle.gd`
- `tests/unit/test_qi_manager.gd`
- `tests/unit/test_leverage_calculator.gd`
- `tests/integration/test_game_loop.gd`
- `tests/unit/data/test_card_data_bank.gd`
- `tests/unit/card_pool/test_card_pool_manager.gd`
- `tests/unit/scoring/test_score_manager.gd`
- `tests/unit/hand/test_hand_manager.gd`

#### 已知限制

- 无存档/读档功能
- 无音效/音乐
- UI为占位布局(无动画)
- 无强制平仓逻辑实现(仅预留接口)
- 无新手引导

#### 指标

- 总提交: 本次会话实现的代码行数约 3000+（含测试）
- 变更文件: 30+
- 无任务引用的提交: 不适用（首次实现）

---

### 面向玩家更新日志 — v0.0.1

#### 新内容

- **四季轮回**：春、夏、秋、冬循环，每季持续3-12个回合，季节影响卡牌分数（元素相生加成）。
- **气资源**：管理你的“气”（上限80，初始50）。买入消耗气，卖出消耗少量气。每回合自动回复7点，选择“等待”可额外获得10点。
- **卡牌买卖**：60张独特的甲子牌，每张有天干、地支、元素、阴阳属性。每回合公共区展示2张牌可供买入，手牌最多同时持有3张。持有卡牌每回合产生积分，卖出赚取差价（乘数最高4倍）。
- **杠杆系统**：赛季越深入，可用杠杆倍数越高（最高3倍）。杠杆放大收益，也增加持仓风险（消耗更多气）。
- **胜利条件**：坚持60回合，成为分数最高的交易者。

#### 改进

- 首个可玩版本，核心循环完整。

#### 已知问题

- 无存档功能，游戏无法保存进度。
- 无音效/音乐。
- UI为简单布局，动画待完善。
