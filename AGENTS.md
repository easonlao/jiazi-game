# 甲子纪 — Agent 协作指南

本项目是独立游戏开发，由多个 AI Agent 协作完成。每个 Agent 负责特定领域，确保分工明确、质量可控。

---

## 技术栈

- **引擎**: Phaser 3.90.0
- **语言**: TypeScript
- **版本控制**: Git（主干开发）
- **构建工具**: Vite
- **资源加载**: Phaser Loader + Vite 资源导入

> 本项目使用 Phaser 3 — Web 端优先的 2D 游戏框架。

---

## 项目结构

@docs/directory-structure.md

---

## 引擎版本参考

@docs/engine-reference/phaser/VERSION.md

---

## 技术偏好

@docs/technical-preferences.md

---

## 协作规则

@docs/coordination-rules.md

---

## 协作协议

**用户驱动协作，而非自主执行。**

每个任务遵循：**提问 → 选项 → 决策 → 草稿 → 批准**

- Agent 在使用 Write/Edit 工具前必须询问："我可以写入这个文件吗？[文件路径]"
- Agent 在请求批准前必须展示草稿或摘要
- 多文件更改需要明确批准整个变更集
- 没有用户指令不得提交代码

详见 `docs/COLLABORATIVE-DESIGN-PRINCIPLE.md`

> **首次使用？** 如果项目没有配置引擎或游戏概念，运行 `/start` 开始引导式入门流程。

---

## 编码规范

@docs/coding-standards.md

---

## 上下文管理

@docs/context-management.md

---

## 平台适配

本项目目标平台为 **Web H5 → 微信小游戏 → App**，开发时需同时考虑多平台兼容性。

@docs/platform/mini-program.md

@docs/platform/weapp-phaser-adapter.md

@docs/platform/web-h5.md

### 平台开发优先级

| 阶段 | 平台 | 说明 |
|------|------|------|
| **MVP** | Web H5 | 快速验证核心玩法 |
| **Alpha** | Web H5 + 微信小游戏 | 扩大用户群 |
| **Beta** | 全平台 | App 打包 |

### 跨平台开发原则

1. **API 抽象**：存储、音频、网络等 API 使用统一封装，根据平台自动切换实现
2. **资源 CDN**：大体积资源统一托管 CDN，避免小游戏包体超限
3. **触摸优先**：UI 设计以触摸交互为主，鼠标作为增强
4. **无 DOM 依赖**：核心逻辑不依赖 DOM API，确保小游戏兼容
