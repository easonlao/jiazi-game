# 甲子纪 | Jiazi Chronicle

<p align="center">
  <strong>一款以六十甲子为主题的回合制策略卡牌游戏</strong><br>
  在季节轮回中洞察天机，低吸高抛，积累天命分数。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/version-0.2.0-brightgreen" alt="Version 0.2.0">
  <img src="https://img.shields.io/badge/platform-Web-orange" alt="Web Platform">
</p>

> 当前代码事实、精确数值、回合顺序和已知文档漂移见 [`docs/implementation-reference.md`](docs/implementation-reference.md)。本 README 保持为面向玩家的简介，不作为运行时规则真源。

---

## 游戏简介

在《甲子纪》中，你将扮演一位通晓天机五行运转的**命师**。

在六十甲子的轮回中，洞察季节更替的规律，通过买卖"干支牌"来积累天命分数。

**每一张牌都是一次判断——什么时候进场，什么时候离场，什么时候按兵不动。**

---

## 核心玩法

### 🌸 四季轮回

春 → 夏 → 秋 → 冬 顺序循环，每季持续 3-12 回合（随机）。

**季节影响卡牌价值**：
- 🌿 木属性：春天最值钱
- 🔥 火属性：夏天最值钱  
- 🪙 金属性：秋天最值钱
- 💧 水属性：冬天最值钱
- 🪨 土属性：稳定型，所有季节都有小幅收益

### 💨 气资源

"气"是你唯一的交易筹码。

| 操作 | 气消耗 | 说明 |
|------|--------|------|
| 买入 | 动态 | 取决于卡牌评分；买入会暂时占用部分气，杠杆会额外占用气 |
| 卖出 | 固定 -4 气 | 先释放该牌占用气（受 80 气上限截断），再扣退出费 |
| 等待 | 0 气 | 下回合自然回复 10 气，并额外回复 10 气 |
| 持仓 | 每回合扣 | 评分越高，持仓成本越高 |

### 🃏 卡牌系统

**60 张独特的甲子牌**，每张都有：
- 天干（甲乙丙丁戊己庚辛壬癸）
- 地支（子丑寅卯辰巳午未申酉戌亥）
- 五行属性（木火土金水）
- 阴阳属性

**每回合公共区展示 2 张牌，手牌最多持有 3 张。**

### 📈 杠杆系统

季节越深入，杠杆倍数越高；每季换季时重置。杠杆是可选项，买入时选择后，该仓位会跟随后续季内档位变化：

| 季节内回合 | 杠杆倍数 |
|------------|----------|
| 1-2 回合 | 1.0x |
| 3-5 回合 | 2.0x |
| 6-8 回合 | 2.5x |
| 9-11 回合 | 3.0x |
| 12 回合 | 3.5x |

点击杠杆即使当前为 1.0x 也会建立杠杆仓位；后续倍率按当前季内回合数升档。换季后杠杆仓位回到 1.0x，再随新季进度升档。杠杆放大收益，也增加持仓成本；气归零时触发强制平仓！

### 🏆 胜利条件

**坚持 60 回合，积累最高分数！**

分数来源：
- **持仓收益**：每回合根据卡牌评分自动结算
- **卖出收益**：低买高卖的评分差价 × 4 × 杠杆倍数；买卖评分相同时为 0 分

---

## 如何游玩

### 在线游玩（推荐）

**即将上线！** 敬请期待...

### 本地运行

**前置要求**：
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 9（与 CI 一致；`pnpm-lock.yaml` 是唯一 lockfile）

**步骤**：

```bash
# 1. 克隆仓库
git clone https://github.com/easonlao/jiazi-game.git
cd jiazi-game

# 2. 安装依赖
pnpm install

# 3. 启动开发服务器
pnpm dev

# 4. 打开浏览器访问
# http://127.0.0.1:5173
```

**测试与模拟器**：

```bash
pnpm test              # 全量单测（Vitest）
pnpm test:simulator    # 模拟器规则对照测试
pnpm export:config     # 从 TS 源码导出 balance_config.json（改参数后执行）
pnpm sync:simulator    # 同步模拟器引擎到 repo/scripts（改 docs 版引擎后执行）
```

---

## 游戏界面

界面入口位于 `app/`，根目录的 `npm run dev`、`npm run build` 和 `npm run preview` 均统一使用该 React 应用。核心规则位于 `src/core/`。

---

## 策略提示

1. **观察季节**：在春天买入木属性牌，夏天买入火属性牌，收益更高
2. **合理使用杠杆**：杠杆放大收益但也增加成本，气不足时谨慎使用
3. **学会等待**：有时等待回复气比强行买卖更划算
4. **注意持仓成本**：评分越高的牌，持仓成本也越高
5. **把握时机**：不要贪心，该卖就卖

---

## 反馈与支持

如有问题或建议，请通过 [GitHub Issues](https://github.com/easonlao/jiazi-game/issues) 反馈。

---

## 许可证

MIT License. 详见 [LICENSE](LICENSE)。
