# 引擎切换计划：Godot 4.6 → Phaser 3 + TypeScript

## 决策依据

- **目标平台**: Web 浏览器优先
- **Agent 执行能力**: Phaser + TypeScript 支持纯终端工作流，无需 GUI
- **Context7 支持**: 19,000+ 代码示例，AI 写代码参考最丰富
- **调试能力**: 浏览器 F12 Console，Agent 可直接读日志

---

## 切换范围

### 需要重写的代码（约 3000 行 GDScript）

| 文件 | 功能 | 重写为 |
|------|------|--------|
| `src/core/data/card_data_bank.gd` | 卡牌数据加载 | `src/core/CardDataBank.ts` |
| `src/core/data/jiazi_card.gd` | 卡牌数据类 | `src/core/JiaziCard.ts` |
| `src/core/season/season_cycle.gd` | 季节循环 | `src/core/SeasonCycle.ts` |
| `src/core/qi/qi_manager.gd` | 气资源管理 | `src/core/QiManager.ts` |
| `src/core/scoring/score_manager.gd` | 计分系统 | `src/core/ScoreManager.ts` |
| `src/core/leverage/leverage_calculator.gd` | 杠杆计算 | `src/core/LeverageCalculator.ts` |
| `src/core/hand/hand_manager.gd` | 手牌管理 | `src/core/HandManager.ts` |
| `src/core/hand/hand_slot.gd` | 手牌槽位 | `src/core/HandSlot.ts` |
| `src/core/card_pool/card_pool_manager.gd` | 牌池管理 | `src/core/CardPoolManager.ts` |
| `src/core/turn/turn_manager.gd` | 回合流程 | `src/core/TurnManager.ts` |
| `src/ui/ui_manager.gd` | UI 管理器 | `src/scenes/GameScene.ts` |
| `src/ui/card_slot.gd` | 卡牌槽位 UI | `src/ui/CardSlot.ts` |

### 需要更新的规范文档

| 文件 | 修改内容 |
|------|---------|
| `CLAUDE.md` | 技术栈改为 Phaser 3 + TypeScript |
| `.claude/docs/technical-preferences.md` | 引擎/语言/命名规范 |
| `.claude/docs/directory-structure.md` | 目录结构 |
| `design/gdd/game-concept.md` | 技术方向 |
| `design/gdd/system-turn-flow.md` | TypeScript interface → Phaser 实现 |
| `design/gdd/system-ui-rendering.md` | Phaser Tween/Scale Manager |
| `docs/architecture/architecture.md` | 引擎/API 适配 |

### 可以保留的资产

| 文件 | 说明 |
|------|------|
| `assets/data/jiazi_cards.json` | 60 张卡牌数据（JSON 通用） |
| `design/gdd/*.md` | 游戏设计文档（引擎无关） |
| `tests/` | 测试用例（需要重写为 Vitest） |

---

## 新项目结构

```
jiazi-game/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts              # 入口
│   ├── core/                 # 游戏逻辑
│   │   ├── JiaziCard.ts
│   │   ├── CardDataBank.ts
│   │   ├── SeasonCycle.ts
│   │   ├── QiManager.ts
│   │   ├── ScoreManager.ts
│   │   ├── LeverageCalculator.ts
│   │   ├── HandManager.ts
│   │   ├── HandSlot.ts
│   │   ├── CardPoolManager.ts
│   │   └── TurnManager.ts
│   ├── scenes/               # Phaser Scenes
│   │   └── GameScene.ts
│   └── ui/                   # UI 组件
│       └── CardSlot.ts
├── assets/
│   └── data/
│       └── jiazi_cards.json
├── design/                   # 保留
├── docs/                     # 保留
└── tests/
    └── unit/
        └── *.test.ts
```

---

## 执行顺序

### Phase 1: 项目初始化（1 session）
1. 创建 Phaser 3 + TypeScript 项目骨架
2. 配置 Vite + TypeScript + Vitest
3. 迁移 `jiazi_cards.json` 数据
4. 实现基础 Game Scene

### Phase 2: 核心逻辑重写（2-3 sessions）
1. JiaziCard + CardDataBank（数据层）
2. SeasonCycle + QiManager + ScoreManager（基础层）
3. HandManager + CardPoolManager + LeverageCalculator（核心层）
4. TurnManager（流程层）

### Phase 3: UI 实现（1-2 sessions）
1. GameScene 场景布局
2. CardSlot UI 组件
3. 按钮交互
4. 动画效果

### Phase 4: 测试 + 调试（1 session）
1. 单元测试（Vitest）
2. 集成测试
3. 浏览器调试

### Phase 5: 清理旧文件（0.5 session）
1. 删除 Godot 相关代码：
   - `src/core/**/*.gd`（所有 GDScript 文件）
   - `src/ui/**/*.gd`（所有 GDScript 文件）
   - `src/ui/**/*.tscn`（所有 Godot 场景文件）
2. 删除 Godot 专用 agents：
   - `.claude/agents/godot-specialist.md`
   - `.claude/agents/godot-gdscript-specialist.md`
   - `.claude/agents/godot-csharp-specialist.md`
   - `.claude/agents/godot-shader-specialist.md`
   - `.claude/agents/godot-gdextension-specialist.md`
3. 更新 CLAUDE.md：
   - 移除 Godot 引用
   - 更新技术栈为 Phaser 3 + TypeScript
4. 更新 .claude/rules 中的代码示例：
   - `engine-code.md`: GDScript → TypeScript
   - `gameplay-code.md`: GDScript → TypeScript
   - `test-standards.md`: GDScript → TypeScript (Vitest)

---

## 验证方式

1. `npm run dev` 启动开发服务器
2. 浏览器打开看到游戏界面
3. 可以执行买/卖/等待操作
4. 60 回合后显示结算
5. 所有测试通过

---

## 后续任务（引擎切换完成后）

### Phase 6: PilotDeck 适配（可选，0.5 session）
1. 将 `.claude/rules/*.md` 中的关键规则嵌入到 PilotDeck Skills
2. 创建 PilotDeck 专用的 AGENTS.md 文件
3. 测试 PilotDeck 是否能正确遵循规范
