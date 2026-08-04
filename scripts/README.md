# scripts/

本目录按「仓库边界原则」（repo = 缺了必出问题；本地 = 开发过程）**已清空**。

此前唯一的 `three_strategy_mix.py`（Python 调参引擎）已随 2026-08-04 的调参工具重构退役：
- 调参现在统一用 **`tune.mts`（真引擎直接模拟）**，不再需要 Python 复刻引擎
- parity 测试（simulator_parity）同步删除——它验证"Python 引擎 = 真游戏"，引擎退役后失去存在意义

## 调参入口（docs/analysis/tools/，本地，不进 git）

| 工具 | 用途 | 运行方式（在 repo/ 目录） |
|---|---|---|
| `tune.mts` | **唯一调参入口**：多策略 × 配置对比模拟 / 评分表 / `--set` 试参 | `npx tsx ../docs/analysis/tools/tune.mts [--games N] [--set key=value] [--scores]` |
| `screenshot-mobile.mjs` / `screenshot-scroll.mjs` | UI 截图（手机/滚动） | `node ../docs/analysis/tools/screenshot-mobile.mjs` |

> 调参 = 改 `src/core/BalanceConfig.ts` 后跑 `tune.mts`；不想改源码就 `--set` 临时覆盖。
