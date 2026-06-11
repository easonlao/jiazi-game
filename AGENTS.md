# 甲子纪 — AI 协作指南

> 本文档是 AI 进入项目的**唯一入口**，采用四层架构设计。

---

## 一、快速入口（必读）

### 1.1 会话状态

@production/session-state/active.md

> **AI 进入项目后首先读取此文件，了解当前任务和进度**

### 1.2 行为边界

@docs/rules/behavior.md

> **明确 AI 该做什么、不该做什么**

### 1.3 文件权限

@docs/rules/file-access.md

> **定义各目录的访问权限：可读/可写/禁止**

---

## 二、项目状态

| 属性 | 值 |
|------|------|
| **项目名称** | 甲子纪 |
| **当前版本** | 0.2.0 |
| **项目阶段** | MVP |
| **活跃任务** | 文档体系完善 |

### 最近变更

@docs/CHANGELOG.md

### 用户决策

@production/decision-log/decisions.md

---

## 三、技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| **引擎** | Phaser 3.90.0 | Web 端 2D 游戏框架 |
| **语言** | TypeScript 5.9 | 类型安全 |
| **构建** | Vite 6.4 | 快速构建和热更新 |
| **测试** | Vitest | 单元测试框架 |

### 技术偏好详情

@docs/technical-preferences.md

### 引擎版本参考

@docs/engine-reference/phaser/VERSION.md

---

## 四、规范索引

### 4.1 行为规范

| 文档 | 用途 |
|------|------|
| @docs/rules/behavior.md | AI 行为边界 |
| @docs/rules/file-access.md | 文件访问权限 |
| @docs/rules/collaboration.md | 人机协作协议 |

### 4.2 代码规范

| 文档 | 适用范围 |
|------|----------|
| @docs/coding-standards.md | 通用编码规范 |
| @docs/rules/gameplay-code.md | src/gameplay/** |
| @docs/rules/ui-code.md | src/ui/** |
| @docs/rules/ai-code.md | src/ai/** |
| @docs/rules/test-standards.md | tests/** |

### 4.3 协作规范

| 文档 | 用途 |
|------|------|
| @docs/coordination-rules.md | Agent 协调规则 |
| @docs/context-management.md | 上下文管理策略 |

---

## 五、设计文档索引

### 5.1 游戏设计文档 (GDD)

@design/gdd/systems-index.md

### 5.2 架构决策记录 (ADR)

@docs/architecture/architecture.md

### 5.3 项目结构

@docs/directory-structure.md

---

## 六、平台适配

本项目目标平台为 **Web H5 → 微信小游戏 → App**。

### 平台开发优先级

| 阶段 | 平台 | 说明 |
|------|------|------|
| **MVP** | Web H5 | 快速验证核心玩法 |
| **Alpha** | Web H5 + 微信小游戏 | 扩大用户群 |
| **Beta** | 全平台 | App 打包 |

### 平台适配文档

| 文档 | 用途 |
|------|------|
| @docs/platform/mini-program.md | 微信小游戏硬性要求 |
| @docs/platform/weapp-phaser-adapter.md | Phaser 微信适配 |
| @docs/platform/web-h5.md | Web H5 平台适配 |

### 跨平台开发原则

1. **API 抽象**：存储、音频、网络等使用统一封装
2. **资源 CDN**：大体积资源托管 CDN，避免包体超限
3. **触摸优先**：UI 以触摸交互为主，鼠标作为增强
4. **无 DOM 依赖**：核心逻辑不依赖 DOM API

---

## 七、日志体系

| 日志 | 用途 | 更新时机 |
|------|------|----------|
| @production/session-state/active.md | 会话状态 | 每次操作后 |
| @production/decision-log/decisions.md | 用户决策 | 用户决策时 |
| @production/session-logs/session-log.md | 操作审计 | 每次操作时 |
| @docs/CHANGELOG.md | 版本变更 | 版本发布时 |

---

## 八、首次进入指引

### 新 AI 会话步骤

```
1. 读取 production/session-state/active.md
2. 确认当前任务状态
3. 读取 docs/rules/behavior.md 了解行为边界
4. 读取 docs/rules/file-access.md 了解文件权限
5. 向用户汇报状态，等待指令
```

### 新项目启动

如果项目没有配置引擎或游戏概念：

```
运行 /start 开始引导式入门流程
```

---

## 九、协作协议

**用户驱动协作，而非自主执行。**

每个任务遵循：**提问 → 选项 → 决策 → 草稿 → 批准**

- AI 在使用 Write/Edit 工具前必须询问："我可以写入这个文件吗？[文件路径]"
- AI 在请求批准前必须展示草稿或摘要
- 多文件更改需要明确批准整个变更集
- 没有用户指令不得提交代码

详见 @docs/rules/collaboration.md
