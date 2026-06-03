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
