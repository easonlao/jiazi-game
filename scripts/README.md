# scripts/

本目录只保留**产品构建 / CI 链路必需的脚本**（原则：缺了它，CI 或调参闭环必然出问题）。

## 唯一脚本

| 文件 | 身份 | 谁依赖 |
|---|---|---|
| `three_strategy_mix.py` | Python 调参模拟器的 **CI 引擎副本** | `tests/integration/simulator_parity.test.ts`（CI 用 `execFileSync` 直接执行） |

> **真源在 `docs/analysis/three_strategy_mix.py`（不进 git）**。改真源后运行 `pnpm sync:simulator`（工具在 `docs/analysis/tools/sync-simulator.py`）同步副本，再提交。

## 已迁移到本地的工具（docs/analysis/tools/，不进 git）

这些是**开发/调参工具**，与产品构建无关，按仓库边界原则放在本地：

| 工具 | 用途 | 运行方式 |
|---|---|---|
| `export-balance-config.ts` + `export-config.mjs` | 从 `BalanceConfig.ts` 导出参数 → `repo/assets/data/balance_config.json` | `pnpm export:config` |
| `sync-simulator.py` | docs 真源 ↔ repo 副本同步 / `--check` 校验 | `pnpm sync:simulator` |
| `qi_balance_simulation.mts` | 多局气平衡模拟（对比配置方案） | `cd repo && npx tsx ../docs/analysis/tools/qi_balance_simulation.mts` |
| `score_table.py` | 输出 60 张牌四季评分表 | `python ../docs/analysis/tools/score_table.py` |
| `analyze_economy.py` | 单牌期望收益 / 经济周期分析 | `python ../docs/analysis/tools/analyze_economy.py` |
| `screenshot-mobile.mjs` / `screenshot-scroll.mjs` | UI 截图（手机/滚动） | `node ../docs/analysis/tools/screenshot-mobile.mjs` |

## 边界原则

- **repo/ 只保留"缺了必出问题"的内容**：产品代码、产品测试、CI 执行链、被 CI 或运行时直接读取的产物。
- **生成产物的工具与分析调试脚本一律放 `docs/analysis/tools/`（本地，不进 git）**。
- 判断方法：`git grep` 确认谁在调用它——只有 CI/运行时引用才留 repo；只有开发流程引用就应迁本地。
