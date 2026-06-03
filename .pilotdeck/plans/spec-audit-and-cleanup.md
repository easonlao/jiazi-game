# 甲子纪项目规范梳理与已知问题修复计划

## 项目现状总结

### 入口链路
```
project.godot → src/ui/game_scene.tscn → ui_manager.gd + turn_manager.gd(autoload)
```

### 核心架构
- **引擎**: Godot 4.6 / GDScript
- **8个 Autoload 单例**: CardDataBank → SeasonCycle → QiManager → ScoreManager → LeverageCalculator → HandManager → CardPoolManager → TurnManager
- **主场景**: game_scene.tscn (CanvasLayer)
- **通信方式**: Signal 驱动

---

## 问题清单

### 🔴 严重：Spec 与实际代码不一致

| 文件 | 问题 | 当前内容 | 应改为 |
|------|------|---------|--------|
| `CLAUDE.md` | 引擎/语言完全错误 | Phaser 3.90.0 + TypeScript | Godot 4.6 + GDScript |
| `.claude/docs/technical-preferences.md` | 引擎/语言完全错误 | Phaser 3.90.0 + TypeScript | Godot 4.6 + GDScript |
| `design/gdd/game-concept.md` | 技术方向错误 | Phaser 3 + TypeScript | Godot 4.6 + GDScript |
| `design/gdd/system-turn-flow.md` | 数据结构用了 TypeScript | `interface GameState {...}` | GDScript class |
| `design/gdd/system-ui-rendering.md` | 动画实现引用了 Phaser API | `Phaser Tweens`, `Phaser Scale Manager` | Godot Tween, Godot Control |

**根因**: 项目最初用 Phaser 规划，中途切换到 Godot，但规范文档没有同步更新。

### 🟡 中等：代码重复

| 问题 | 说明 |
|------|------|
| `src/ui/card_slot.gd` vs `src/ui/cards/card_slot.gd` | 两个版本，都声明了 `class_name CardSlot`，会冲突 |
| 主场景引用的是 `src/ui/card_slot.tscn` | `src/ui/cards/` 下的是旧版本（纯代码构建 UI） |

### 🟡 中等：CardPoolManager 未初始化

`project.godot` 的 autoload 中 `CardPoolManager` 没有调用 `initialize()`，需要在 `TurnManager._ready()` 或某个初始化流程中调用。

### 🟢 低优先级

| 问题 | 说明 |
|------|------|
| 无存档/读档 | MVP 不需要，已知 |
| 无音效/音乐 | MVP 不需要，已知 |
| 无强制平仓逻辑 | 只预留了接口 |
| UI 是占位布局 | 无动画 |
| ADR 文档存在但 architecture.md 说"未找到" | 文档不同步 |

---

## 修复计划

### Step 1: 修正 CLAUDE.md（项目根配置）
- 将引擎从 Phaser 3 改为 Godot 4.6
- 将语言从 TypeScript 改为 GDScript
- 更新技术栈描述
- 保留工作流和协作协议（这些与引擎无关）

### Step 2: 修正 technical-preferences.md
- 引擎/语言改为 Godot 4.6 / GDScript
- 渲染改为 GL Compatibility
- 输入方式保留（Touch + Mouse/Keyboard）
- 更新命名规范为 GDScript 风格（snake_case）
- 更新引擎专家路由（phaser-specialist → godot-specialist）
- 更新文件扩展名路由（.gd → godot-specialist）

### Step 3: 修正 game-concept.md
- 技术方向改为 Godot 4.6 + GDScript
- 平台路线调整（Web → H5 仍可行，Godot 支持 Web 导出）

### Step 4: 修正 system-turn-flow.md
- 将 TypeScript `interface GameState` 改为 GDScript class 定义
- 将 `interface HandSlot` 改为 GDScript class 定义

### Step 5: 修正 system-ui-rendering.md
- 将 Phaser Tween 引用改为 Godot Tween
- 将 Phaser Scale Manager 改为 Godot viewport 屏幕适配
- 保留 UI 布局和交互设计（这些是引擎无关的）

### Step 6: 删除重复的 card_slot 文件
- 删除 `src/ui/cards/` 目录（旧版本）
- 保留 `src/ui/card_slot.gd` + `src/ui/card_slot.tscn`（主场景引用的版本）

### Step 7: 修复 CardPoolManager 初始化
- 在 `turn_manager.gd` 的 `_ready()` 或 `start_game()` 中调用 `CardPoolManager.initialize()`

### Step 8: 更新 architecture.md 中的 ADR 引用
- 将 "No ADRs found" 改为实际存在的 ADR 列表

---

## 验证方式

1. 所有文档中的引擎/语言引用一致（grep 搜索 "Phaser"、"TypeScript" 应返回 0 结果）
2. 无重复的 `class_name CardSlot` 声明
3. `CardPoolManager.initialize()` 在启动流程中被调用
4. 主场景能正常运行（Godot 编辑器打开无报错）
