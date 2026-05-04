# 系统索引：甲子纪

## 系统总览

| # | 系统 | 分类 | 层级 | 优先级 | 状态 | GDD 文件 | 依赖 |
|---|------|------|------|--------|------|---------|------|
| 1 | 干支卡牌数据 | 数据 | Foundation | MVP | ✅ Draft | [system-jiazi-cards.md](system-jiazi-cards.md) | 无 |
| 2 | 季节循环 | 核心机制 | Foundation | MVP | ✅ Draft | [system-season.md](system-season.md) | 无 |
| 3 | 气资源 | 核心机制 | Foundation | MVP | ✅ Draft | [system-qi-resource.md](system-qi-resource.md) | #1, #2 |
| 4 | 公共牌池 | 玩法 | Core | MVP | ✅ Draft | [system-card-pool.md](system-card-pool.md) | #1 |
| 5 | 手牌管理 | 玩法 | Core | MVP | ✅ Draft | [system-hand-cards.md](system-hand-cards.md) | #1, #2, #3 |
| 6 | 盈亏结算 | 玩法 | Core | MVP | ✅ Draft | [system-scoring.md](system-scoring.md) | #1, #2, #5 |
| 7 | 回合流程 | 引擎 | Core | MVP | ✅ Draft | [system-turn-flow.md](system-turn-flow.md) | 全部 |
| 8 | 杠杆系统 | 核心机制 | Core | MVP | ✅ Draft | [system-leverage.md](system-leverage.md) | #2, #3 |
| 9 | UI 渲染 | 表现 | Presentation | MVP | ✅ Draft | [system-ui-rendering.md](system-ui-rendering.md) | 全部 |

## 依赖关系图

```
Foundation 层（无依赖）:
  #1 干支卡牌数据
  #2 季节循环

Core 层:
  #3 气资源 ──依赖──→ #1, #2
  #4 公共牌池 ──依赖──→ #1
  #5 手牌管理 ──依赖──→ #1, #2, #3
  #6 盈亏结算 ──依赖──→ #1, #2, #5
  #7 回合流程 ──依赖──→ #1~#6

Presentation 层:
  #9 UI 渲染 ──依赖──→ #1~#8
```

## 推荐实现顺序

| 顺序 | 系统 | 理由 |
|------|------|------|
| 1 | 干支卡牌数据 | 所有系统的基础数据 |
| 2 | 季节循环 | 核心经济驱动 |
| 3 | 气资源 | 交易筹码系统 |
| 4 | 公共牌池 | 牌的获取途径 |
| 5 | 手牌管理 | 玩家持仓与操作 |
| 6 | 盈亏结算 | 分数计算引擎 |
| 7 | 回合流程 | 串联所有系统 |
| 8 | 杠杆系统 | 追涨杀跌天花板扩展 |
| 9 | UI 渲染 | 界面呈现（可与 #7/#8 并行迭代） |

## Alpha 阶段新增系统（MVP 后）

| # | 系统 | 说明 |
|---|------|------|
| 10 | 空亡牌（特殊牌） | 6 张空亡牌，没收单回合操作权，正常计算持仓的同时，季节瞬间加速推进 3-6 回合 |
| 11 | 天干地支配合联动 | CombinationBonus 配置表生效 |
| 12 | 阴阳差异 | YinYangModifier 配置表生效 |
| 13 | 牌局历史记录 | 已出现牌的查看功能 |
