# 盈亏结算系统

> 状态：Draft
> 层级：Core
> 优先级：MVP

## 概述

每回合自动计算玩家的分数变化，是游戏经济的结算引擎。将季节×五行的转化效率转化为具体数值，累计总分。持仓收益是持续性的，卖出收益是一次性的，两者共享同一套盈亏关系表。

## 玩家体验

玩家每回合开始时看到分数变动——涨了还是跌了，涨跌多少，一目了然。好的玩家能从分数跳动中感受到季节的力量：春天来了，木牌开始涨分；秋天来了，木牌开始扣分。这就是"时机"的直观反馈。

## 详细规则

### 结算时机

```
每回合流程中的位置：

1. 游戏结束检查
2. 季节检查（季节结束则切换）
3. ★ 盈亏结算（持仓收益）+ 持仓气耗扣除 + 爆仓检查
4. 刷牌（公共牌池展示）
5. 气回复
6. 玩家操作（买入/卖出/等待）
   └── 如果卖出：即时触发卖出结算 + 回复 8 气
```

> 持仓结算在季节切换之后、玩家操作之前执行，确保玩家看到的是当前季节的盈亏。卖出结算在玩家操作阶段即时触发，同时回复 8 气。

### 持仓结算（每回合自动执行）

```
对所有手牌：
  卡牌评分 = calcCardScore(卡牌, 当前季节)
    评分 = 天干五行基础分 + CANG_GAN_WEIGHT(0.5) × Σ(藏干权重 × 藏干五行基础分)

  本回合盈亏 = HOLD_BONUS(1.2) × 卡牌评分 × 杠杆倍数
  如牌使用杠杆：盈亏 × 杠杆倍数
  总分 += 本回合盈亏
  本回合盈亏明细 = [{ 牌名, 属性, 评分, 得分, 杠杆倍率 }, ...]
```

> 卡牌评分采用"天干+藏干"加权模型，评分范围约 [-6.0, +6.0]。持仓倍率 HOLD_BONUS = 1.2 是固定乘数。

### 卖出结算（玩家主动触发时执行）

```
卖出评分 = calcCardScore(卡牌, 当前季节)    // 当前季节的卡牌评分
卖出得分 = (SELL_BASE(8) + (卖出评分 - 买入评分) × SPREAD_MULTIPLIER(4)) × 杠杆倍数
总分 += 卖出得分
即时回复 CS(8) 气
```

> 设计意图：买入时评分低（非当季），卖出时评分高（当季），差价为正则赚分。差价交易模型替代了原来的固定倍率表，让分数变化更平滑、更有层次感。

### 五行×季节评分表（四档制）

卡牌评分由天干五行基础分 + 藏干加权分计算得出。天干五行基础分（评分范围 -3 到 +4）：

| | 春(木) | 夏(火) | 秋(金) | 冬(水) |
|---|--------|--------|--------|--------|
| **木** | +4 ⭐⭐⭐ | +2 ⭐⭐ | -3 ❌❌ | -1 ⚠️ |
| **火** | +2 ⭐⭐ | +4 ⭐⭐⭐ | -1 ⚠️ | -3 ❌❌ |
| **金** | -3 ❌❌ | -1 ⚠️ | +4 ⭐⭐⭐ | +2 ⭐⭐ |
| **水** | -1 ⚠️ | -3 ❌❌ | +2 ⭐⭐ | +4 ⭐⭐⭐ |
| **土** | +0.5 🟡 | +0.5 🟡 | +0.5 🟡 | +0.5 🟡 |

藏干权重 CANG_GAN_WEIGHT = 0.5，藏干评分按同样五行×季节表计算。

**评分规则**：
- 圆盘模型：木火一组，金水一组；对立 = 木↔金、火↔水；跨组 = 木↔水、火↔金
- 当季 = +4，同组 = +2，跨组 = -1，对立 = -3，土稳定 = +0.5
- 最终评分 = 天干分 + 0.5 × Σ(藏干权重 × 藏干分)
- 评分范围约 [-6.0, +6.0]

### 分数类型

| 类型 | 触发方式 | 频率 | 特点 |
|------|---------|------|------|
| 持仓收益 | 每回合自动 | 高频小额 | 稳定积累，长线策略核心 |
| 卖出收益 | 主动卖出 | 低频大额 | 集中爆发，短线策略核心 |

### 分数显示

| 显示项 | 说明 |
|------|------|
| 总分 | 累计得分，游戏核心指标 |
| 本回合盈亏 | 本回合持仓收益总和，带正负号 |
| 本回合明细 | 每张牌各自的盈亏 |
| 卖出得分 | 卖出时弹出的额外得分 |

### 分数规则补充

| 规则 | 说明 |
|------|------|
| 分数可以为负 | 持有对立牌或跨组牌会持续扣分 |
| 总分可以为负 | 不会重置为 0，负分就是负分 |
| 分数没有上限 | 理论上可以无限累积 |
| 游戏结束时最终总分 | 60 回合结束后，最后一回合正常结算持仓收益 |

## 公式

### 卡牌评分

```typescript
function calcCardScore(card: JiaziCard, season: Season): number {
  const tianGanScore = ELEMENT_SEASON_SCORE[card.tianGanElement][season];

  let cangGanScore = 0;
  const zhiCang = CANG_GAN[card.diZhi];
  if (zhiCang) {
    for (const [gan, weight] of Object.entries(zhiCang)) {
      cangGanScore += weight * ELEMENT_SEASON_SCORE[TG_ELEMENT[gan]][season];
    }
  }

  return tianGanScore + CANG_GAN_WEIGHT * cangGanScore;
  // CANG_GAN_WEIGHT = 0.5
  // 评分范围约 [-6.0, +6.0]
}
```

### 持仓总盈亏

```typescript
function settleHoldScore(hand: (HandSlot | null)[], season: Season): SettlementResult {
  let roundScore = 0;
  const details: CardScoreDetail[] = [];

  for (const slot of hand) {
    if (!slot) continue;
    const { card, leverage } = slot;
    const score = calcCardScore(card, season);
    const earned = HOLD_BONUS(1.2) * score * leverage;
    roundScore += earned;
    details.push({
      cardName: card.name,
      element: card.mainElement,
      season,
      multiplier: HOLD_BONUS,
      score: earned,
      leverage,
    });
  }

  return { roundScore, details };
}
```

### 卖出得分

```typescript
function settleSellScore(card: HandSlot, season: Season): SellResult {
  const sellScore = calcCardScore(card.card, season);
  const score = (SELL_BASE(8) + (sellScore - card.buyScore) * SPREAD_MULTIPLIER(4)) * card.leverage;
  return { cardName: card.card.name, multiplier: SPREAD_MULTIPLIER, score, leverage: card.leverage };
}
```

### 爆仓强制卖出（使用相同卖出公式，不打折）

```typescript
function settleForcedSell(card: HandSlot, season: Season): SellResult {
  return settleSellScore(card, season);
}
```

### 单局总分模型（调参参考）

```
假设场景：玩家持有 1 张当季木牌（评分约 4-6），持续整个当季

  当季平均长度 = 7.5 回合
  持仓收益 = HOLD_BONUS(1.2) × 评分(约5) × 7.5 = 45 分

  如果当季末卖出（买入评分约 5，卖出评分约 5，差价约 0）：
  卖出收益 ≈ SELL_BASE(8) + 0 × SPREAD_MULTIPLIER(4) = 8 分

  单次完整操作总收益 ≈ 45 + 8 = 53 分

对比：非当季抄底买入（买入评分约 -2，等到当季卖出评分约 5）
  买入消耗 = CB(12) × (1 + 0.05 × (-2)) = 12 × 0.9 = 10.8 气
  持有跨组亏损 ≈ 1.2 × (-1) × 等待回合数
  等到当季持仓收益 ≈ 1.2 × 5 × 当季回合数
  卖出收益 = (8 + (5-(-2)) × 4) = 8 + 28 = 36 分

  效率取决于等待成本，风险更高但气消耗低，卖出爆发力更强
```

## 边界情况

| 场景 | 处理方式 |
|------|----------|
| 手牌为空 | 持仓结算结果为 0，本回合盈亏显示 0 |
| 手牌全部是对立牌 | 每回合持续大额扣分 |
| 手牌全部是高杠杆对立牌 | 每回合大额扣分且持仓气耗极高，快速爆仓风险 |
| 季节切换回合的结算 | 按新季节计算（季节检查在结算之前） |
| 最后一回合（第 60 回合） | 正常结算持仓收益，游戏结束 |
| 卖出得分为负（对立季节卖出） | 正常扣分，总分减少 |
| 总分为负时卖出正收益牌 | 总分回升，但仍是负分 |
| 多张牌同时持仓 | 各自独立计算，汇总后加到总分 |

## 依赖关系

| 系统 | 方向 | 性质 |
|------|------|------|
| 干支卡牌数据 | 依赖 | 读取牌的主属性 |
| 季节循环 | 依赖 | 读取当前季节 |
| 手牌管理 | 依赖 | 读取手牌列表进行结算 |
| 回合流程 | 被依赖 | 每回合调用结算 |
| UI 渲染 | 被依赖 | 展示分数变化、盈亏明细 |

## 调参旋钮

> ⚠️ 以下数值为当前代码实现值，所有参数定义在 `src/data/constants.ts`。

| 参数 | 当前值 | 安全范围 | 影响 |
|------|--------|----------|------|
| HOLD_BONUS（持仓倍率） | 1.2 | 0.8 ~ 2.0 | 持仓收益整体放大系数 |
| SELL_BASE（卖出基础分） | 8 | 5 ~ 15 | 卖出得分的基础部分 |
| SPREAD_MULTIPLIER（差价乘数） | 4 | 2 ~ 8 | 买卖评分差价的放大系数 |
| CANG_GAN_WEIGHT（藏干权重） | 0.5 | 0.3 ~ 0.8 | 藏干对评分的贡献度 |
| BASE_SCORE | 1 | 1（固定基数） | 所有计算的乘数基数 |

### 五行×季节评分表参数

| 位置关系 | 评分 | 说明 |
|---------|------|------|
| 当季 | +4 | 评分最高 |
| 同组 | +2 | 正收益 |
| 跨组 | -1 | 轻度亏损 |
| 对立 | -3 | 重度亏损 |
| 土（任意季节） | +0.5 | 稳定正收益 |

### 调参约束

| 约束 | 说明 |
|------|------|
| SELL_MAX > HOLD_MAX × 3 | 保证短线卖出有价值 |
| HOLD_MAJOR < -HOLD_MAX × 0.8 | 对立亏损要足够痛 |
| HOLD_STABLE > 0 | 土牌永远正收益 |
| SELL_MAX + SELL_MID > |S_HOLD_MAJOR + |S_HOLD_MINOR| | 同组买卖总收益 > 跨组买卖总亏损 |

## 验收标准

- [ ] 每回合自动结算持仓收益
- [ ] 卖出时正确计算一次性得分（差价模型）
- [ ] 五行×季节评分表正确对应四档制关系
- [ ] 同组内评分永远为正
- [ ] 跨组有亏损，对立亏损最大
- [ ] 土牌在任意季节稳定正收益
- [ ] 总分可以为负
- [ ] 分数变动有明细展示
- [ ] 季节切换按新季节计算
- [ ] 所有倍率参数在 constants.ts 中可调
- [ ] 藏干权重 CANG_GAN_WEIGHT 正确影响评分
