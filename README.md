# 甲子纪 (Jiazi Chronicle)

<p align="center">
  <strong>一款以六十甲子为主题的回合制策略卡牌经营游戏</strong><br>
  在季节轮回中洞察天机，低吸高抛，积累天命分数。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/engine-Godot%204.6-478CBF?logo=godotengine&logoColor=white" alt="Godot 4.6">
  <img src="https://img.shields.io/badge/language-GDScript-6abf6b" alt="GDScript">
  <img src="https://img.shields.io/badge/version-0.0.1-brightgreen" alt="Version 0.0.1">
</p>

## 游戏简介

在《甲子纪》中，你将扮演一位通晓天机五行运转的**命师**。在六十甲子的轮回中洞察季节更替的规律，通过买卖“干支牌”来积累天命分数。

每一张牌都是一次判断——**什么时候进场，什么时候离场，什么时候按兵不动**。

## 核心玩法

- **四季轮回**：春 → 夏 → 秋 → 冬 顺序循环，每季持续 3-12 回合。季节影响卡牌价值（相生元素涨价，相克元素跌价）。
- **气资源**：“气”是交易筹码。买入消耗气，卖出消耗少量气，每回合自动回复。选择“等待”可额外回复。
- **卡牌买卖**：60 张独特的甲子牌，每张有天干、地支、五行元素和阴阳属性。每回合公共区展示 2 张牌，手牌最多持有 3 张。
- **杠杆系统**：季节越深杠杆倍数越高（最高 3x）。杠杆放大收益，但持仓气耗也相应增加。气归零时触发强制平仓。
- **胜利条件**：坚持 60 回合，积累最高分数。

## 运行游戏

### 前置要求

- [Godot 4.6](https://godotengine.org/download/archive/4.6-stable/) (下载 Windows 64-bit 标准版)
- Git（可选，用于克隆仓库）

### 步骤

1. **克隆仓库**：
   ```bash
   git clone https://github.com/easonlao/jiazi-game.git
   cd jiazi-game
   ```

2. **使用 Godot 4.6 打开项目**：
   - 运行 `Godot_v4.6-stable_win64.exe`
   - 点击“导入”，选择项目根目录下的 `project.godot` 文件
   - 点击“打开”

3. **运行游戏**：
   - 在编辑器顶部右侧点击“运行当前场景”按钮（或按 **F5**）

> **注意**：游戏主场景已配置为 `src/ui/game_scene.tscn`，无需额外设置。

## 项目结构

```
jiazi-game/
├── project.godot              # Godot 项目文件
├── src/                       # 游戏源代码
│   ├── core/                  # 核心系统（卡牌、季节、气、回合、评分、杠杆、牌池、手牌）
│   ├── ui/                    # UI 界面
│   ├── data/                  # 数据文件
│   └── main.gd                # 入口脚本
├── assets/                    # 游戏资源（卡牌图片、音效等）
├── design/                    # 游戏设计文档
│   ├── gdd/                   # 系统设计文档（GDD）
│   ├── ux/                    # UX 设计文档
│   └── registry/              # 实体注册表
├── docs/                      # 技术文档和架构决策记录（ADR）
├── tests/                     # 单元测试和集成测试
├── production/                # 生产管理（冲刺计划、里程碑、发布）
└── CLAUDE.md                  # Claude Code 配置（供 AI 辅助开发）
```

## 技术栈

| 项目 | 选择 |
|------|------|
| 引擎 | Godot 4.6 |
| 语言 | GDScript |
| 渲染 | 2D（CanvasItem / Viewport） |
| 目标平台 | Web (HTML5) / PC (Windows, Linux, macOS) |
| 输入 | 鼠标/键盘 + 触摸（移动端友好） |

## 开发状态

**当前版本**: v0.0.1 — 首个可玩版本

已完成：
- [x] 60 张甲子牌卡牌数据
- [x] 四季循环系统（随机长度，总计 60 回合）
- [x] 气资源管理（买入/卖出/持仓消耗）
- [x] 手牌管理（3 槽位）
- [x] 公共牌池（每回合抽 2 张）
- [x] 评分系统（持仓收益 + 卖出收益）
- [x] 杠杆系统（季节内倍数 + 平仓）
- [x] UI 基础界面

待完善：
- [ ] 卡牌飞行动画
- [ ] 音效与音乐
- [ ] 存档/读档功能
- [ ] 新手引导
- [ ] 移动端适配优化

## 贡献

目前为个人项目，暂不接受外部贡献。如有建议或问题，请通过 [GitHub Issues](https://github.com/easonlao/jiazi-game/issues) 反馈。

## 许可证

MIT License. 详见 [LICENSE](LICENSE)。
