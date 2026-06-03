# 项目文件整理计划

## 整理原则

1. **保留项目核心文件**：src/、assets/、design/、配置文件
2. **归档有用文档**：Agent 框架中对项目有用的内容移入 `docs/`
3. **Skills 全部保留**：不删除任何 skills，后续开发和上线可能需要
4. **删除无关文件**：Godot/Unity/Unreal 文档、CCGS 框架、生产管理文件

---

## 第一步：清理引擎参考文档

**删除**：
- `docs/engine-reference/godot/` (12 个文件)
- `docs/engine-reference/unity/` (14 个文件)
- `docs/engine-reference/unreal/` (14 个文件)

**保留**：
- `docs/engine-reference/phaser/` (4 个文件)
- `docs/engine-reference/README.md`

---

## 第二步：分析 .claude/ 目录

### 2.1 有用的文档（移入 docs/）

| 文件 | 用途 | 操作 |
|------|------|------|
| `.claude/docs/coding-standards.md` | 编码规范 | → `docs/coding-standards.md` |
| `.claude/docs/technical-preferences.md` | 技术偏好 | → `docs/technical-preferences.md` |
| `.claude/docs/coordination-rules.md` | 协作规则 | → `docs/coordination-rules.md` |
| `.claude/docs/directory-structure.md` | 目录结构 | → `docs/directory-structure.md` |
| `.claude/docs/context-management.md` | 上下文管理 | → `docs/context-management.md` |
| `.claude/rules/engine-code.md` | 引擎代码规则 | → `docs/rules/engine-code.md` |
| `.claude/rules/gameplay-code.md` | 游戏逻辑规则 | → `docs/rules/gameplay-code.md` |
| `.claude/rules/test-standards.md` | 测试规范 | → `docs/rules/test-standards.md` |
| `.claude/rules/ui-code.md` | UI 代码规则 | → `docs/rules/ui-code.md` |
| `.claude/rules/data-files.md` | 数据文件规则 | → `docs/rules/data-files.md` |
| `.claude/rules/design-docs.md` | 设计文档规则 | → `docs/rules/design-docs.md` |

### 2.2 Skills（全部保留）

所有 skills 暂时不删除，后续开发和上线可能需要。Skills 目录保持原样。

### 2.3 Hooks（保留有用的）

| Hook | 用途 | 操作 |
|------|------|------|
| `validate-commit.sh` | 提交前验证 | 保留 |
| `validate-assets.sh` | 资源文件验证 | 保留 |
| `validate-push.sh` | 推送前验证 | 保留 |
| `detect-gaps.sh` | 文档缺口检测 | 保留 |
| 其他 hooks | 会话管理 | 删除 |

### 2.4 Agents（全部保留）

所有 agents 暂时不删除，后续开发和上线可能需要。Agents 目录保持原样。

### 2.5 其他 .claude 文件

**删除**：
- `.claude/agent-memory/` - Agent 记忆
- `.claude/settings.json` - Claude 设置（不需要）
- `.claude/settings.local.json` - 本地设置（不需要）
- `.claude/statusline.sh` - 状态栏脚本（不需要）
- `.claude/workflow-catalog.yaml` - 工作流目录（不需要）
- `.claude/docs/CLAUDE-local-template.md` - 本地模板（不需要）
- `.claude/docs/settings-local-template.md` - 设置模板（不需要）
- `.claude/docs/quick-start.md` - 快速开始（不需要）
- `.claude/docs/setup-requirements.md` - 设置要求（不需要）
- `.claude/docs/skills-reference.md` - 技能参考（不需要）
- `.claude/docs/rules-reference.md` - 规则参考（不需要）
- `.claude/docs/hooks-reference.md` - Hooks 参考（不需要）
- `.claude/docs/hooks-reference/` - Hooks 详细参考（不需要）
- `.claude/docs/director-gates.md` - 导演门控（不需要）
- `.claude/docs/agent-coordination-map.md` - Agent 协调地图（不需要）
- `.claude/docs/agent-roster.md` - Agent 名册（不需要）
- `.claude/docs/review-workflow.md` - 审查工作流（不需要）
- `.claude/docs/templates/` - 所有模板（不需要）

---

## 第三步：清理 CCGS Skill Testing Framework

**删除整个目录**：
- `CCGS Skill Testing Framework/` (100+ 文件)

---

## 第四步：清理其他文件

**删除**：
- `UPGRADING.md` - 升级指南（不需要）
- `design/CLAUDE.md` - 设计目录配置（不需要）
- `docs/CLAUDE.md` - 文档目录配置（不需要）
- `src/CLAUDE.md` - 源码目录配置（不需要）
- `docs/examples/` - 会话示例（不需要）
- `docs/patch-notes/` - 补丁说明（不需要）
- `docs/registry/` - 注册表（不需要）
- `production/` - 生产管理（不需要）
- `.github/` - GitHub 模板（不需要）

---

## 第五步：整理后的目录结构

```
jiazi-game/
├── src/                          # TypeScript 源码
│   ├── main.ts
│   ├── core/                     # 游戏逻辑
│   └── scenes/                   # Phaser 场景
├── assets/
│   └── data/
│       └── jiazi_cards.json      # 卡牌数据
├── design/
│   └── gdd/                      # 游戏设计文档
├── docs/
│   ├── architecture/             # 架构决策记录
│   ├── engine-reference/phaser/  # Phaser 参考
│   ├── coding-standards.md       # 编码规范
│   ├── technical-preferences.md  # 技术偏好
│   ├── rules/                    # 代码规则
│   └── CHANGELOG.md              # 变更日志
├── .claude/
│   ├── agents/                   # 所有 agents（保留）
│   ├── hooks/                    # 有用的 hooks
│   ├── skills/                   # 所有 skills（保留）
│   └── settings.json             # Claude 设置
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── LICENSE
└── README.md
```

---

## 执行顺序

1. 删除引擎参考文档（Godot/Unity/Unreal）
2. 删除 CCGS Skill Testing Framework
3. 删除其他无关文件
4. 移动 .claude/docs 到 docs/
5. 移动 .claude/rules 到 docs/rules/
6. 清理 .claude/ 目录（保留 agents/hooks/skills）
7. 更新 CLAUDE.md 引用
8. 提交并推送
