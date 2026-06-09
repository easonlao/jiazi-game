# 变更日志

> 记录项目版本变更历史

---

## [0.2.0] - 2026-06-07

### 新增

#### 文档体系
- `docs/rules/behavior.md` - AI 行为规范
- `docs/rules/file-access.md` - 文件访问权限矩阵
- `docs/rules/collaboration.md` - 人机协作协议
- `production/session-state/active.md` - 会话状态文件
- `production/decision-log/decisions.md` - 决策日志
- `docs/CHANGELOG.md` - 变更日志

#### 平台适配
- `docs/platform/mini-program.md` - 微信小游戏硬性要求
- `docs/platform/weapp-phaser-adapter.md` - Phaser 微信适配
- `docs/platform/web-h5.md` - Web H5 平台适配

### 变更

- 重构 AGENTS.md 为四层架构入口
- 更新 CLAUDE.md/PILOTDECK.md 为重定向文件

---

## [0.1.0] - 2026-06-04

### 新增

#### 核心玩法
- 60张甲子牌数据系统
- 季节循环系统（春/夏/秋/冬）
- 气资源管理（max=80, start=50）
- 杠杆系统（1.0x-3.0x）
- 爆仓强平机制

#### 游戏系统
- `TurnManager` - 回合管理
- `SeasonCycle` - 季节循环
- `QiManager` - 气资源管理
- `ScoreManager` - 分数结算
- `HandManager` - 手牌管理
- `CardPoolManager` - 公共牌池
- `LeverageCalculator` - 杠杆计算
- `CardDataBank` - 卡牌数据

#### UI系统
- `GameScene` - 主游戏场景
- `SoundManager` - 音效管理器
- Toast 提示系统
- 卡牌飞行动画
- 分数弹跳动画

#### 测试
- 单元测试框架（Vitest）
- QiManager 测试用例
- TurnManager 测试用例
- SeasonCycle 测试用例
- ScoreManager 测试用例

#### CI/CD
- GitHub Actions 工作流
- 自动构建和测试

### 技术栈

- Phaser 3.90.0
- TypeScript 5.9.3
- Vite 6.4.3
- Vitest

---

## 版本规划

### [0.3.0] - Alpha

- 空亡牌系统
- 天干地支联动
- 微信小游戏适配
- 移动端优化

### [1.0.0] - Release

- 完整教程系统
- 成就系统
- 排行榜
- 多平台发布
