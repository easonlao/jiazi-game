# UI Decision Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MVP UI explain the game logic through visible costs, rewards, risks, and short contextual guidance.

**Architecture:** Keep changes scoped to Phaser presentation code first. Reuse existing core data from `TurnManager`, `HandSlot`, `JiaziCard`, `QiManager`, and `ScoreManager`; avoid changing core gameplay rules unless absolutely necessary.

**Tech Stack:** Phaser 3.90.0, TypeScript, Vite, Vitest.

---

## Target Files

- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`
  - Add decision detail panel.
  - Add dynamic action button labels.
  - Add card-level cost/reward/risk text.
  - Add round feedback toast/panel.
  - Improve game-over stats display where existing getters allow.
- Optional Modify: `D:/works/jiazi-game/src/core/TurnManager.ts`
  - Only if UI cannot access needed data cleanly.
  - Add read-only helper getters, no gameplay rule changes.
- Optional Test: `D:/works/jiazi-game/tests/*`
  - Add calculation helper tests if new pure helper functions are extracted.

---

## Task 1: Add UI Calculation Helpers

**Purpose:** Centralize UI-only calculations so `GameScene` can display costs and predictions consistently.

**Files:**
- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`

- [ ] **Step 1: Add helper methods inside `GameScene`**

Add these private helpers near the other UI helper methods:

```ts
private getBuyCost(card: JiaziCard, useLeverage: boolean): number {
  const score = card.getSeasonScore(this.turnManager.getCurrentSeason());
  const leverageCost = useLeverage ? 10 : 0;
  return Math.ceil(11 * (1 + 0.05 * score) + leverageCost);
}

private getHoldEarning(cardScore: number, leverage: number): number {
  return 1.2 * cardScore * leverage;
}

private getHoldQiCost(cardScore: number, leverage: number): number {
  return Math.max(0.5, 1.5 + 0.4 * cardScore) * leverage;
}

private getSellScore(slot: HandSlot): number {
  const currentScore = slot.card.getSeasonScore(this.turnManager.getCurrentSeason());
  return (8 + (currentScore - slot.buyScore) * 4) * slot.leverage;
}

private formatSigned(value: number, digits: number = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}
```

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: TypeScript compiles without errors.

**Acceptance Criteria:**
- Public card UI can display buy cost.
- Hand card UI can display expected sell score.
- No core formulas are changed.

---

## Task 2: Add Decision Detail Panel

**Purpose:** When a player selects a card, show a one-glance explanation of what the choice means.

**Files:**
- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`

- [ ] **Step 1: Add a new field**

Add with other UI elements:

```ts
private decisionInfo!: Phaser.GameObjects.Text;
```

- [ ] **Step 2: Create the panel**

Add this method:

```ts
private createDecisionInfo(): void {
  const bg = this.add.rectangle(214, 602, 400, 42, 0xfffdf5);
  bg.setStrokeStyle(1, 0xd7ccc8);

  this.decisionInfo = this.add.text(214, 602, '选择公共牌买入，或选择手牌卖出', {
    fontSize: '12px',
    color: '#5D4037',
    fontFamily: 'Arial',
    align: 'center',
    wordWrap: { width: 380 },
  }).setOrigin(0.5);
}
```

Call it in `create()` after `createHandArea()` and before `createButtonArea()`.

- [ ] **Step 3: Add updater**

```ts
private updateDecisionInfo(): void {
  const season = this.turnManager.getCurrentSeason();
  const publicCards = this.turnManager.getPublicCards();
  const hand = this.turnManager.getHand();
  const leverage = this.turnManager.getLeverageMultiplier();

  if (this.selectedPublicCard !== -1) {
    const card = publicCards[this.selectedPublicCard];
    if (card) {
      const cardScore = card.getSeasonScore(season);
      const activeLeverage = this.leverageEnabled ? leverage : 1;
      const buyCost = this.getBuyCost(card, this.leverageEnabled);
      const holdGain = this.getHoldEarning(cardScore, activeLeverage);
      const holdCost = this.getHoldQiCost(cardScore, activeLeverage);
      const leverageText = this.leverageEnabled ? `｜杠杆 ${leverage}x` : '';
      this.decisionInfo.setText(
        `${card.name}${leverageText}｜评分 ${this.formatSigned(cardScore)}｜买入 -${buyCost}气｜持仓 ${this.formatSigned(holdGain)}分/回合｜耗气 -${holdCost.toFixed(1)}`
      );
      return;
    }
  }

  if (this.selectedHandCard !== -1) {
    const slot = hand[this.selectedHandCard];
    if (slot) {
      const currentScore = slot.card.getSeasonScore(season);
      const sellScore = this.getSellScore(slot);
      const riskText = this.turnManager.getQi() < 24 && slot.leverage > 1 ? '｜爆仓风险' : '';
      this.decisionInfo.setText(
        `${slot.card.name}｜买入 ${this.formatSigned(slot.buyScore)} 当前 ${this.formatSigned(currentScore)}｜卖出 ${this.formatSigned(sellScore)}分｜累计 ${this.formatSigned(slot.holdEarnings)}${riskText}`
      );
      return;
    }
  }

  this.decisionInfo.setText('选择公共牌买入，或选择手牌卖出');
}
```

- [ ] **Step 4: Wire into `updateUI()`**

Call `this.updateDecisionInfo();` before `this.updateButtons();`.

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: Build passes.

**Acceptance Criteria:**
- Selecting/deselecting public cards updates panel immediately.
- Selecting/deselecting hand cards updates panel immediately.
- Panel does not overlap buttons or cards at 428x760.

---

## Task 3: Upgrade Card Face Information

**Purpose:** Cards should explain why they are good or bad now.

**Files:**
- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`

- [ ] **Step 1: Change `createCardSprite` signature**

Replace:

```ts
showProfit: boolean
```

With:

```ts
slot?: HandSlot | null
```

Update all callers:

```ts
this.createCardSprite(card, x, targetY, cardWidth, cardHeight, null);
this.createCardSprite(slot.card, x, targetY, cardWidth, cardHeight, slot);
```

- [ ] **Step 2: Add public card information**

Inside `createCardSprite`, add:

```ts
const yinYangNames: Record<string, string> = {
  yin: '阴',
  yang: '阳',
};

const metaLabel = this.add.text(0, -height / 2 + 78, `${yinYangNames[card.yinYang]}${elementNames[card.mainElement]}`, {
  fontSize: '12px',
  color: '#795548',
  fontFamily: 'Arial',
}).setOrigin(0.5);
```

- [ ] **Step 3: Add cost/profit line**

Use this logic before creating the container:

```ts
let detailText = '';
let detailColor = '#795548';

if (slot) {
  const profit = slot.getProfit(this.turnManager.getCurrentSeason());
  detailText = `差价 ${this.formatSigned(profit)}`;
  detailColor = profit >= 0 ? '#2E7D32' : '#C62828';
} else {
  detailText = `买入 -${this.getBuyCost(card, this.leverageEnabled)}气`;
}

const detailLabel = this.add.text(0, height / 2 - 18, detailText, {
  fontSize: width > 130 ? '13px' : '11px',
  color: detailColor,
  fontFamily: 'Arial',
  fontStyle: 'bold',
}).setOrigin(0.5);
```

- [ ] **Step 4: Add leverage badge for hand cards**

```ts
const children: Phaser.GameObjects.GameObject[] = [bg, nameLabel, elementLabel, metaLabel, scoreLabel, detailLabel];

if (slot && slot.leverage > 1) {
  const badgeBg = this.add.rectangle(width / 2 - 25, height / 2 - 18, 42, 20, 0xff6f00);
  const badgeText = this.add.text(width / 2 - 25, height / 2 - 18, `${slot.leverage}x`, {
    fontSize: '11px',
    color: '#ffffff',
    fontFamily: 'Arial',
    fontStyle: 'bold',
  }).setOrigin(0.5);
  children.push(badgeBg, badgeText);
}

const container = this.add.container(x, y, children);
```

- [ ] **Step 5: Run build**

Run: `npm run build`

Expected: Build passes.

**Acceptance Criteria:**
- Player can tell which public card is cheaper.
- Player can tell whether a hand card is profitable to sell.
- Leveraged cards are visually distinct without relying only on color.

---

## Task 4: Dynamic Button Labels and Disabled Reasons

**Purpose:** Buttons should communicate action consequences directly.

**Files:**
- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`

- [ ] **Step 1: Add label helper**

```ts
private setButtonLabel(button: Phaser.GameObjects.Container, text: string): void {
  const label = button.getAt(1) as Phaser.GameObjects.Text;
  label.setText(text);
}
```

- [ ] **Step 2: Update `updateButtons()` labels**

Replace simple alpha-only button state with labels:

```ts
const qi = this.turnManager.getQi();
const state = this.turnManager.getState();
const publicCards = this.turnManager.getPublicCards();
const hand = this.turnManager.getHand();
const selectedPublic = this.selectedPublicCard !== -1 ? publicCards[this.selectedPublicCard] : null;
const selectedSlot = this.selectedHandCard !== -1 ? hand[this.selectedHandCard] : null;
const hasEmptySlot = hand.some(slot => slot === null);
const hasHandCard = hand.some(slot => slot !== null);

let buyLabel = '买入';
let canBuy = state === 'player_action' && !!selectedPublic && hasEmptySlot;
if (!hasEmptySlot) {
  buyLabel = '手牌已满';
  canBuy = false;
} else if (selectedPublic) {
  const buyCost = this.getBuyCost(selectedPublic, this.leverageEnabled);
  buyLabel = qi >= buyCost ? `买入 -${buyCost}气` : '气不足';
  canBuy = canBuy && qi >= buyCost;
}
this.setButtonLabel(this.buyButton, buyLabel);
this.buyButton.setAlpha(canBuy ? 1 : 0.5);

const leverage = this.turnManager.getLeverageMultiplier();
const leverageButton = this.leverageButton.getAt(0) as Phaser.GameObjects.Rectangle;
if (leverage > 1 && selectedPublic) {
  this.setButtonLabel(this.leverageButton, `杠杆 ${leverage}x ${this.leverageEnabled ? '开' : '关'}`);
  leverageButton.setFillStyle(this.leverageEnabled ? 0xE65100 : 0x9E9E9E);
  this.leverageButton.setAlpha(1);
} else {
  this.setButtonLabel(this.leverageButton, `杠杆 ${leverage}x`);
  leverageButton.setFillStyle(0x9E9E9E);
  this.leverageButton.setAlpha(0.5);
}

let sellLabel = '卖出';
let canSell = state === 'player_action' && !!selectedSlot && qi >= 3;
if (!hasHandCard) {
  sellLabel = '无牌可卖';
} else if (selectedSlot) {
  sellLabel = qi >= 3 ? `卖出 ${this.formatSigned(this.getSellScore(selectedSlot), 0)}分` : '气不足';
}
this.setButtonLabel(this.sellButton, sellLabel);
this.sellButton.setAlpha(canSell ? 1 : 0.5);

this.setButtonLabel(this.waitButton, '等待 +17气');
this.waitButton.setAlpha(state === 'player_action' ? 1 : 0.5);
```

- [ ] **Step 3: Add unavailable action toasts**

In `onBuyClick()`, before returning for no selected card:

```ts
if (this.selectedPublicCard === -1) {
  this.showToast('请先选择公共牌');
  return;
}
```

In `onSellClick()`, before returning for no selected card:

```ts
if (this.selectedHandCard === -1) {
  this.showToast('请先选择手牌');
  return;
}
```

In `onLeverageClick()`, if no public card selected:

```ts
if (this.selectedPublicCard === -1) {
  this.showToast('先选公共牌，再开杠杆');
  return;
}
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: Build passes.

**Acceptance Criteria:**
- Buttons update after every selection and after leverage toggle.
- Disabled-looking buttons match actual action availability.
- Clicking unavailable actions shows a short toast explaining why.

---

## Task 5: Add Round Feedback Summary

**Purpose:** After each action advances the turn, explain what just happened.

**Files:**
- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`

- [ ] **Step 1: Add snapshot fields**

```ts
private previousQi: number = 50;
private previousScore: number = 0;
```

- [ ] **Step 2: Add feedback method**

```ts
private showRoundDeltaFeedback(): void {
  const qi = this.turnManager.getQi();
  const score = this.turnManager.getScore();
  const qiDelta = qi - this.previousQi;
  const scoreDelta = score - this.previousScore;

  if (Math.abs(qiDelta) < 0.01 && Math.abs(scoreDelta) < 0.01) return;

  const parts: string[] = [];
  if (Math.abs(scoreDelta) >= 0.01) {
    parts.push(`分数 ${this.formatSigned(scoreDelta)}`);
  }
  if (Math.abs(qiDelta) >= 0.01) {
    parts.push(`气 ${this.formatSigned(qiDelta)}`);
  }
  if (this.turnManager.getMarginCallCount() > 0 && qi <= 0) {
    parts.push('杠杆强平风险');
  }

  this.showToast(parts.join('｜'));
}
```

- [ ] **Step 3: Capture before actions**

At the start of successful action handlers, before executing `executeBuy`, `executeSell`, or `executeWait`, set:

```ts
this.previousQi = this.turnManager.getQi();
this.previousScore = this.turnManager.getScore();
```

After successful action and `updateUI()`, call:

```ts
this.showRoundDeltaFeedback();
```

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: Build passes.

**Acceptance Criteria:**
- Player understands why score and qi changed.
- Feedback auto-dismisses.
- Feedback does not block the next decision for more than about 1 second.

---

## Task 6: Add First-Run Micro Guidance

**Purpose:** Help new players understand the first few turns without a long tutorial.

**Files:**
- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`

- [ ] **Step 1: Add one-time flags**

```ts
private shownGuidance = {
  roundOne: false,
  selectedPublic: false,
  leverage: false,
  lowQi: false,
};
```

- [ ] **Step 2: Add guidance method**

```ts
private updateGuidance(): void {
  const round = this.turnManager.getCurrentRound();
  const qi = this.turnManager.getQi();
  const hand = this.turnManager.getHand();

  if (round === 1 && !this.shownGuidance.roundOne) {
    this.shownGuidance.roundOne = true;
    this.showToast('当前是春季，木牌收益最高');
    return;
  }

  if (this.selectedPublicCard !== -1 && !this.shownGuidance.selectedPublic) {
    this.shownGuidance.selectedPublic = true;
    this.showToast('评分越高，持仓分越高，也会消耗更多气');
    return;
  }

  if (this.leverageEnabled && !this.shownGuidance.leverage) {
    this.shownGuidance.leverage = true;
    this.showToast('杠杆会放大收益，也会放大持仓耗气');
    return;
  }

  if (qi < 24 && hand.some(slot => slot && slot.leverage > 1) && !this.shownGuidance.lowQi) {
    this.shownGuidance.lowQi = true;
    this.showToast('气过低时，杠杆牌可能被强制平仓');
  }
}
```

- [ ] **Step 3: Wire into `updateUI()`**

Call `this.updateGuidance();` after `this.updateButtons();`.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: Build passes.

**Acceptance Criteria:**
- Guidance appears only once per session for each trigger.
- Guidance is short and non-blocking.
- Touch/mouse users both receive the same information.

---

## Task 7: Improve Game Over Summary

**Purpose:** End screen should teach the player how they scored.

**Files:**
- Modify: `D:/works/jiazi-game/src/scenes/GameScene.ts`
- Optional Modify: `D:/works/jiazi-game/src/core/TurnManager.ts`

- [ ] **Step 1: Add read-only getters if needed**

If `GameScene` cannot access total hold/sell earnings, add to `TurnManager`:

```ts
getTotalHoldEarnings(): number {
  return this.scoreManager.getTotalHoldEarnings();
}

getTotalSellEarnings(): number {
  return this.scoreManager.getTotalSellEarnings();
}
```

- [ ] **Step 2: Update `showGameOver()` description**

Show:

```ts
`持仓收益: ${this.turnManager.getTotalHoldEarnings().toFixed(1)}\n` +
`卖出收益: ${this.turnManager.getTotalSellEarnings().toFixed(1)}\n` +
`爆仓次数: ${this.turnManager.getMarginCallCount()}\n\n` +
`牌堆已抽空，本局结束。`
```

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: Build passes.

**Acceptance Criteria:**
- End screen shows at least score composition and margin call count.
- Existing restart behavior still works.

---

## Verification

Run:

```bash
npm run build
```

Manual QA:

- [ ] Start game with `npm run dev`.
- [ ] Select public card and confirm panel plus buy button update.
- [ ] Toggle leverage and confirm costs and risks update.
- [ ] Buy a card and confirm hand card shows delta, cumulative earnings, and leverage badge.
- [ ] Select hand card and confirm sell score appears.
- [ ] Wait and confirm recovery feedback appears.
- [ ] Force low qi or leverage state and confirm risk messaging.
- [ ] Finish, restart, or simulate game over and confirm summary layout.

---

## Implementation Order

1. Helpers and detail panel.
2. Dynamic button labels.
3. Card face information.
4. Round feedback summary.
5. Micro guidance.
6. Game over summary.
7. Build and manual QA.

---

## Non-Goals

- Do not change scoring, qi, leverage, season, or card draw rules.
- Do not add new dependencies.
- Do not redesign the whole visual style.
- Do not implement a full tutorial scene yet.
