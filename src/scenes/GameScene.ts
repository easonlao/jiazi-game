import Phaser from 'phaser';
import { TurnManager, GameState, JiaziCard, HandSlot, SettlementDetail, MarginCallDetail } from '../core';
import { SoundManager } from '../ui/SoundManager';

/**
 * 游戏主场景 (Phaser Presentation Layer)
 * 
 * 游戏唯一的场景控制器。负责渲染全部 UI 状态，并配合 `SoundManager` 合成音效和 `tweens` 表现层动画。
 * 全面优化了手牌悬停、买入飞入、卖出飞出、分数跳动弹射、古风换季诗句等视觉体验。
 * 
 * @see {@link design/gdd/system-ui-rendering.md} UI渲染设计文档
 */
export class GameScene extends Phaser.Scene {
  private turnManager!: TurnManager;
  private soundManager!: SoundManager;

  // UI 元素
  private seasonLabel!: Phaser.GameObjects.Text;
  private scoreLabel!: Phaser.GameObjects.Text;
  private qiBar!: Phaser.GameObjects.Graphics;
  private qiLabel!: Phaser.GameObjects.Text;
  private qiMaintenanceLabel!: Phaser.GameObjects.Text;
  private publicCardsContainer!: Phaser.GameObjects.Container;
  private handContainer!: Phaser.GameObjects.Container;
  private buyButton!: Phaser.GameObjects.Container;
  private sellButton!: Phaser.GameObjects.Container;
  private waitButton!: Phaser.GameObjects.Container;
  private leverageButton!: Phaser.GameObjects.Container;
  private bottomInfo!: Phaser.GameObjects.Text;
  private decisionInfo!: Phaser.GameObjects.Text;

  // 交互状态
  private selectedPublicCard: number = -1;
  private selectedHandCard: number = -1;
  private leverageEnabled: boolean = false;

  // 动画状态锁与数据记录
  private isAnimating: boolean = false;
  private lastSeason: string = '';
  private lastScore: number = 0;
  private previousQi: number = 50;
  private previousScore: number = 0;
  private lastSettlementRoundShown: number = 0;
  private isShowingSettlement: boolean = false;
  private shownGuidance = {
    roundOne: false,
    selectedPublic: false,
    leverage: false,
    lowQi: false,
  };

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.turnManager = new TurnManager();
    this.soundManager = new SoundManager();

    // 创建游戏界面 UI
    this.createBackground();
    this.createTopPanel();
    this.createQiBar();
    this.createPublicCardsArea();
    this.createHandArea();
    this.createDecisionInfo();
    this.createButtonArea();
    this.createBottomInfo();

    // 设置状态流转监听回调
    this.turnManager.setOnStateChange((state: GameState) => {
      this.updateUI();
    });

    this.turnManager.setOnTurnStart((round: number) => {
      this.updateUI();
    });

    this.turnManager.setOnGameEnd((finalScore: number) => {
      this.showGameOver(finalScore);
    });

    // 初始化并开启首局
    this.initializeGame();
  }

  private async initializeGame(): Promise<void> {
    await this.turnManager.initialize();
    this.turnManager.startGame();
    
    // 初始化状态基准，防止首轮出现换季音效或分数弹跳
    this.lastSeason = this.turnManager.getCurrentSeason();
    this.lastScore = this.turnManager.getScore();
    
    this.updateUI();
  }

  /** 创建古色宣纸纹理背景 */
  private createBackground(): void {
    // 基础古朴宣纸色
    this.add.rectangle(214, 380, 428, 760, 0xf5f0e8);
  }

  /** 创建顶部控制面板，并嵌入一键存读档快捷键 */
  private createTopPanel(): void {
    // 顶部背景
    const topBg = this.add.rectangle(214, 40, 428, 80, 0xf5f0e8);
    topBg.setStrokeStyle(1, 0xd7ccc8);

    // 季节标签
    this.seasonLabel = this.add.text(214, 35, '春 (第1回合)', {
      fontSize: '20px',
      color: '#3E2723',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // 分数标签
    this.scoreLabel = this.add.text(214, 65, '总分: 0.0', {
      fontSize: '16px',
      color: '#5D4037',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // 快捷存档按钮
    this.createMiniButton(45, 40, '存', 0x795548, () => {
      this.soundManager.playClick();
      const success = this.turnManager.saveGame();
      if (success) {
        this.showToast('进度已存入本地');
      }
    });

    // 快捷读档按钮
    this.createMiniButton(383, 40, '读', 0x795548, () => {
      this.soundManager.playClick();
      if (!this.turnManager.hasSave()) {
        this.showToast('无有效存档');
        return;
      }
      const success = this.turnManager.loadGame();
      if (success) {
        this.showToast('进度加载成功');
        this.selectedPublicCard = -1;
        this.selectedHandCard = -1;
        this.leverageEnabled = false;
        // 强制重设防止误播放换季
        this.lastSeason = this.turnManager.getCurrentSeason();
        this.lastScore = this.turnManager.getScore();
        this.updateUI();
      } else {
        this.showToast('存档已损坏，请重新开始');
      }
    });
  }

  /** 创建能量气血资源条 */
  private createQiBar(): void {
    // 气条背景线框
    const qiBg = this.add.rectangle(214, 110, 400, 30, 0xe0e0e0);
    qiBg.setStrokeStyle(1, 0xbdbdbd);

    // 动态图形组件
    this.qiBar = this.add.graphics();
    this.updateQiBar(50, 80);

    // 气数值标签文字
    this.qiLabel = this.add.text(214, 110, '气: 50/80', {
      fontSize: '14px',
      color: '#3E2723',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // 持仓维持气耗预告
    this.qiMaintenanceLabel = this.add.text(214, 134, '持仓维持: 0.0气/回合', {
      fontSize: '11px',
      color: '#795548',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);
  }

  /** 动态渐变重绘气血条 */
  private updateQiBar(qi: number, maxQi: number): void {
    this.qiBar.clear();

    // 槽底色
    this.qiBar.fillStyle(0xe0e0e0, 1);
    this.qiBar.fillRect(14, 95, 400, 30);

    // 限制气在 [0, maxQi] 之间
    const clampedQi = Math.max(0, Math.min(qi, maxQi));

    // 填充色逻辑 (爆仓警告临界)
    const width = (clampedQi / maxQi) * 400;
    let color = 0x4CAF50; // 丰盈常绿
    if (clampedQi / maxQi < 0.3) {
      color = 0xE53935; // 枯绝赤红
    } else if (clampedQi / maxQi < 0.6) {
      color = 0xFFC107; // 警告萎黄
    }

    this.qiBar.fillStyle(color, 1);
    this.qiBar.fillRect(14, 95, width, 30);
  }

  /** 创建公共池卡牌展示区 */
  private createPublicCardsArea(): void {
    const areaBg = this.add.rectangle(214, 260, 428, 240, 0xf5f0e8);
    areaBg.setStrokeStyle(1, 0xd7ccc8);

    this.add.text(214, 150, '公共牌池', {
      fontSize: '16px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    this.publicCardsContainer = this.add.container(214, 260);
  }

  /** 创建玩家手牌区 */
  private createHandArea(): void {
    const areaBg = this.add.rectangle(214, 490, 428, 220, 0xf5f0e8);
    areaBg.setStrokeStyle(1, 0xd7ccc8);

    this.add.text(214, 380, '我的手牌', {
      fontSize: '16px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    this.handContainer = this.add.container(214, 490);
  }

  /** 创建底部控制面板操作区域 */
  private createButtonArea(): void {
    // 买入按钮
    this.buyButton = this.createButton(107, 645, '买入', 0x2196F3, () => {
      this.onBuyClick();
    });

    // 杠杆倍速切换按钮
    this.leverageButton = this.createButton(321, 645, '杠杆 1.0x', 0x9E9E9E, () => {
      this.onLeverageClick();
    });

    // 卖出卡牌结算按钮
    this.sellButton = this.createButton(107, 705, '卖出', 0xFF9800, () => {
      this.onSellClick();
    });

    // 等待推进回合按钮
    this.waitButton = this.createButton(321, 705, '等待', 0x4CAF50, () => {
      this.onWaitClick();
    });
  }

  /** 创建动作选项按钮封装 */
  private createButton(x: number, y: number, text: string, color: number, callback: () => void): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, 180, 40, color);
    bg.setStrokeStyle(2, 0xffffff);

    const label = this.add.text(0, 0, text, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, label]);
    container.setSize(180, 40);
    container.setInteractive();

    container.on('pointerdown', callback);

    return container;
  }

  /** 创建顶部小号存读档按钮 */
  private createMiniButton(x: number, y: number, text: string, color: number, callback: () => void): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, 44, 26, color);
    bg.setStrokeStyle(1, 0xffffff);
    bg.setAlpha(0.85);

    const label = this.add.text(0, 0, text, {
      fontSize: '12px',
      color: '#ffffff',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, label]);
    container.setSize(44, 26);
    container.setInteractive();
    container.on('pointerdown', callback);

    return container;
  }

  /** 创建底部剩余说明信息 */
  private createBottomInfo(): void {
    this.bottomInfo = this.add.text(214, 745, '牌堆剩余: 60张 | 杠杆: 1.0x', {
      fontSize: '12px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
  }

  private createDecisionInfo(): void {
    const bg = this.add.rectangle(214, 590, 400, 48, 0xfffdf5);
    bg.setStrokeStyle(1, 0xd7ccc8);

    this.decisionInfo = this.add.text(214, 590, '选择公共牌买入，或选择手牌卖出', {
      fontSize: '12px',
      color: '#5D4037',
      fontFamily: 'Arial',
      align: 'center',
      wordWrap: { width: 380 },
    }).setOrigin(0.5);
  }

  /** 显示临时小 Toast 文字提醒 */
  private showToast(message: string): void {
    const toast = this.add.text(214, 380, message, {
      fontSize: '15px',
      color: '#ffffff',
      fontFamily: 'Arial',
      backgroundColor: '#4E342E',
      padding: { x: 12, y: 6 }
    }).setOrigin(0.5);
    toast.setDepth(300);

    this.tweens.add({
      targets: toast,
      y: 340,
      alpha: 0,
      delay: 750,
      duration: 350,
      onComplete: () => toast.destroy()
    });
  }

  private getBuyCost(card: JiaziCard, useLeverage: boolean): number {
    return this.turnManager.previewBuyCost(card, useLeverage);
  }

  private getHoldEarning(cardScore: number, leverage: number): number {
    return this.turnManager.previewHoldEarning(cardScore, leverage);
  }

  private getHoldQiCost(cardScore: number, leverage: number): number {
    return this.turnManager.previewHoldQiCost(cardScore, leverage);
  }

  private getSellScore(slot: HandSlot): number {
    return this.turnManager.previewSellScore(slot);
  }

  private formatSigned(value: number, digits: number = 1): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
  }

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

  private setButtonLabel(button: Phaser.GameObjects.Container, text: string): void {
    const label = button.getAt(1) as Phaser.GameObjects.Text;
    label.setText(text);
  }

  private showRoundDeltaFeedback(): void {
    if (this.isShowingSettlement) return;

    const qi = this.turnManager.getQi();
    const score = this.turnManager.getScore();
    const qiDelta = qi - this.previousQi;
    const scoreDelta = score - this.previousScore;

    // 转换为 1 位小数精度的浮点数，用以判定有效变动
    const displayScore = parseFloat(scoreDelta.toFixed(1));
    const displayQi = parseFloat(qiDelta.toFixed(1));

    // 如果两者的有效变动都小于 0.1，则无需提示
    if (Math.abs(displayQi) < 0.1 && Math.abs(displayScore) < 0.1) return;

    const parts: string[] = [];
    if (Math.abs(displayScore) >= 0.1) {
      parts.push(`分数 ${this.formatSigned(displayScore, 1)}`);
    }
    if (Math.abs(displayQi) >= 0.1) {
      parts.push(`气 ${this.formatSigned(displayQi, 1)}`);
    }
    if (this.turnManager.getMarginCallCount() > 0 && qi <= 0) {
      parts.push('杠杆强平风险');
    }

    if (parts.length > 0) {
      this.showToast(parts.join(' ｜ '));
    }
  }

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

  /** 全局状态刷新与动效处理 */
  private updateUI(): void {
    const season = this.turnManager.getCurrentSeason();
    const round = this.turnManager.getCurrentRound();

    // 检测是否展示结算面板 (幂等性判断)
    if (round !== this.lastSettlementRoundShown && round > 1 && !this.isShowingSettlement) {
      const settlement = this.turnManager.getLastSettlementDetail();
      if (settlement && settlement.round === round) {
        this.showRoundSettlementPanel(settlement);
        return;
      }
    }

    const qi = this.turnManager.getQi();
    const score = this.turnManager.getScore();
    const deckSize = this.turnManager.getDeckSize();
    const leverage = this.turnManager.getLeverageMultiplier();

    // 1. 监测换季，并触发宏大换季诗句动效与声乐
    if (this.lastSeason && this.lastSeason !== season) {
      this.soundManager.playSeasonChange();
      this.showSeasonTransitionEffect(season);
    }
    this.lastSeason = season;

    // 2. 更新季节标签
    const seasonNames: Record<string, string> = {
      spring: '🌸 春',
      summer: '☀️ 夏',
      autumn: '🍂 秋',
      winter: '❄️ 冬',
    };
    this.seasonLabel.setText(`${seasonNames[season]} (第${round}回合)`);

    // 3. 更新分数标签并进行数值变动浮动数字弹跳
    this.scoreLabel.setText(`总分: ${score.toFixed(1)}`);
    if (score !== this.lastScore) {
      const diff = score - this.lastScore;
      this.tweens.add({
        targets: this.scoreLabel,
        scaleX: 1.25,
        scaleY: 1.25,
        duration: 120,
        yoyo: true,
        ease: 'Quad.easeOut'
      });

      // 数值浮空浮现
      const diffText = this.add.text(
        this.scoreLabel.x + 85,
        this.scoreLabel.y,
        diff >= 0 ? `+${diff.toFixed(1)} ▲` : `${diff.toFixed(1)} ▼`,
        {
          fontSize: '14px',
          color: diff >= 0 ? '#4CAF50' : '#E53935',
          fontFamily: 'Arial',
          fontStyle: 'bold'
        }
      ).setOrigin(0, 0.5);

      this.tweens.add({
        targets: diffText,
        y: diffText.y - 30,
        alpha: 0,
        duration: 900,
        ease: 'Cubic.easeIn',
        onComplete: () => diffText.destroy()
      });
    }
    this.lastScore = score;

    // 4. 更新气状态
    this.updateQiBar(qi, 80);
    this.qiLabel.setText(`气: ${qi.toFixed(1)}/80`);

    // 计算当前持仓总气耗并更新预告
    let totalQiCost = 0;
    const hand = this.turnManager.getHand();
    hand.forEach(slot => {
      if (slot) {
        totalQiCost += this.getHoldQiCost(slot.card.getSeasonScore(season), slot.leverage);
      }
    });
    this.qiMaintenanceLabel.setText(`持仓维持: -${totalQiCost.toFixed(1)}气/回合`);

    // 5. 更新底部状态
    this.bottomInfo.setText(`牌堆剩余: ${deckSize}张 | 杠杆: ${leverage}x`);

    // 6. 更新区域卡牌重绘
    this.updatePublicCards();
    this.updateHandCards();

    // 7. 更新决策按钮状态限制
    this.updateDecisionInfo();
    this.updateButtons();
    this.updateGuidance();
  }

  /** 呈现回合结算面板 */
  private showRoundSettlementPanel(settlement: SettlementDetail): void {
    this.isShowingSettlement = true;

    // 1. 半透明黑色背景遮罩，阻止背景点击
    const mask = this.add.rectangle(214, 380, 428, 760, 0x000000, 0.65);
    mask.setInteractive();
    mask.setDepth(210);

    // 2. 结算面板背景卷轴
    const panelBg = this.add.rectangle(214, 380, 360, 440, 0xfffdf5);
    panelBg.setStrokeStyle(3, 0x3E2723);
    panelBg.setDepth(211);

    // 3. 装饰框线（让视觉更精致）
    const innerFrame = this.add.rectangle(214, 380, 340, 420);
    innerFrame.setStrokeStyle(1, 0xd7ccc8);
    innerFrame.setDepth(212);

    const elements: Phaser.GameObjects.GameObject[] = [mask, panelBg, innerFrame];

    // 4. 面板标题
    const titleText = this.add.text(214, 200, `第 ${settlement.round - 1} 回合 结算`, {
      fontSize: '22px',
      color: '#3E2723',
      fontFamily: 'Georgia, Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(213);
    elements.push(titleText);

    // 5. 季节指示器
    const seasonNames: Record<string, string> = {
      spring: '🌸 阳春',
      summer: '☀️ 朱明',
      autumn: '🍂 金秋',
      winter: '❄️ 玄冬',
    };
    const seasonText = this.add.text(214, 235, `天时: ${seasonNames[settlement.season] || settlement.season}`, {
      fontSize: '14px',
      color: '#795548',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(213);
    elements.push(seasonText);

    // 6. 核心数据报告
    // 持仓收益
    const holdEarningsText = this.add.text(80, 270, `持仓收益:`, {
      fontSize: '14px',
      color: '#5D4037',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setDepth(213);
    const holdEarningsVal = this.add.text(348, 270, `${settlement.holdEarnings >= 0 ? '+' : ''}${settlement.holdEarnings.toFixed(1)} 分`, {
      fontSize: '14px',
      color: settlement.holdEarnings >= 0 ? '#2E7D32' : '#C62828',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(1, 0).setDepth(213);
    elements.push(holdEarningsText, holdEarningsVal);

    // 维持气耗
    const holdQiText = this.add.text(80, 300, `维持气耗:`, {
      fontSize: '14px',
      color: '#5D4037',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setDepth(213);
    const holdQiVal = this.add.text(348, 300, `-${settlement.holdQiCost.toFixed(1)} 气`, {
      fontSize: '14px',
      color: settlement.holdQiCost > 0 ? '#C62828' : '#795548',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(1, 0).setDepth(213);
    elements.push(holdQiText, holdQiVal);

    // 气回复拆解
    const qiRecoverText = this.add.text(80, 330, `回复气量:`, {
      fontSize: '14px',
      color: '#5D4037',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setDepth(213);
    
    let recoverDetail = `自然 +${settlement.baseQiRecover.toFixed(0)}`;
    if (settlement.waitQiRecover > 0) {
      recoverDetail += ` ｜ 等待 +${settlement.waitQiRecover.toFixed(0)}`;
    }
    const qiRecoverVal = this.add.text(348, 330, recoverDetail, {
      fontSize: '13px',
      color: '#2E7D32',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(1, 0).setDepth(213);
    elements.push(qiRecoverText, qiRecoverVal);

    // 分隔线
    const line = this.add.line(214, 365, 0, 0, 270, 0, 0xd7ccc8).setDepth(213);
    elements.push(line);

    // 7. 结算后最终状态报告
    const stateText = this.add.text(214, 380, `结算气: ${settlement.finalQi.toFixed(1)}/80 ｜ 当前总分: ${settlement.finalScore.toFixed(1)}`, {
      fontSize: '13px',
      color: '#3E2723',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(213);
    elements.push(stateText);

    // 8. 爆仓强平报告显示
    if (settlement.marginCallTriggered && settlement.marginCallDetails.length > 0) {
      // 爆仓警告标志
      const marginCallWarnText = this.add.text(214, 410, `⚠️ 气归零，发生爆仓强平！`, {
        fontSize: '13px',
        color: '#E53935',
        fontFamily: 'Arial',
        fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(213);
      elements.push(marginCallWarnText);

      // 显示被强平的第一张牌名称（最多只展示一行）
      const detail = settlement.marginCallDetails[0];
      const marginCallDetailText = this.add.text(214, 430, `杠杆牌【${detail.cardName}】被平仓 结算得分: ${detail.sellScore.toFixed(1)}`, {
        fontSize: '11px',
        color: '#E53935',
        fontFamily: 'Arial',
        align: 'center'
      }).setOrigin(0.5).setDepth(213);
      elements.push(marginCallDetailText);
    }

    // 9. “继续”按钮
    const continueBtn = this.createButton(214, 500, '继续', 0x2196F3, () => {
      this.soundManager.playClick();
      // 销毁全部结算界面元素
      elements.forEach(el => el.destroy());
      continueBtn.destroy();
      
      this.isShowingSettlement = false;
      this.lastSettlementRoundShown = settlement.round;
      
      // 重绘刷新主界面卡牌与公共池
      this.updateUI();
    });
    continueBtn.setDepth(213);
  }

  /** 展示换季诗词特效与滤镜闪动 */
  private showSeasonTransitionEffect(season: string): void {
    const poetryMap: Record<string, string> = {
      spring: '🌸 阳春回泰，五行相生 🌸',
      summer: '☀️ 朱明盛夏，烈火燃空 ☀️',
      autumn: '🍂 白露凝秋，金风肃杀 🍂',
      winter: '❄️ 玄英岁暮，北水冰封 ❄️',
    };
    const transitionText = poetryMap[season] || '季节流转';

    // 屏幕半透明闪烁模拟太极之光
    const flash = this.add.rectangle(214, 380, 428, 760, 0xffffff, 0.35);
    flash.setDepth(200);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 600,
      onComplete: () => flash.destroy()
    });

    // 换季提示诗大字
    const txt = this.add.text(214, 330, transitionText, {
      fontSize: '22px',
      color: '#3E2723',
      fontFamily: 'Georgia, Arial',
      backgroundColor: '#f5f0e8',
      padding: { x: 16, y: 12 }
    }).setOrigin(0.5);
    txt.setStroke('#d7ccc8', 2);
    txt.setDepth(201);
    txt.setAlpha(0);

    // 缓动飞入并慢速淡出
    this.tweens.add({
      targets: txt,
      alpha: 1,
      y: 290,
      duration: 650,
      ease: 'Back.easeOut',
      completeDelay: 1000,
      onComplete: () => {
        this.tweens.add({
          targets: txt,
          alpha: 0,
          y: 250,
          duration: 550,
          onComplete: () => txt.destroy()
        });
      }
    });
  }

  /** 更新公共池卡牌排布及悬停动效 */
  private updatePublicCards(): void {
    this.publicCardsContainer.removeAll(true);

    const publicCards = this.turnManager.getPublicCards();
    const cardWidth = 160;
    const cardHeight = 200;
    const spacing = 20;
    const startX = -((publicCards.length - 1) * (cardWidth + spacing)) / 2;

    publicCards.forEach((card, index) => {
      const isSelected = this.selectedPublicCard === index;
      const x = startX + index * (cardWidth + spacing);
      
      // 选中上悬，未选中居平
      const targetY = isSelected ? -12 : 0; 
      const cardSprite = this.createCardSprite(card, x, targetY, cardWidth, cardHeight, null);

      cardSprite.setInteractive();
      cardSprite.on('pointerdown', () => {
        if (this.isAnimating) return;
        this.soundManager.playClick();
        this.selectedPublicCard = isSelected ? -1 : index;
        this.updateUI();
      });

      if (isSelected) {
        // 描金发光选中线圈
        const highlight = this.add.rectangle(x, targetY, cardWidth, cardHeight);
        highlight.setStrokeStyle(3, 0xFF6F00);
        this.publicCardsContainer.add(highlight);
      }

      this.publicCardsContainer.add(cardSprite);
    });
  }

  /** 更新手牌排布与悬浮交互 */
  private updateHandCards(): void {
    this.handContainer.removeAll(true);

    const hand = this.turnManager.getHand();
    const cardWidth = 120;
    const cardHeight = 160;
    const spacing = 10;
    const startX = -((hand.length - 1) * (cardWidth + spacing)) / 2;

    hand.forEach((slot, index) => {
      const x = startX + index * (cardWidth + spacing);
      const isSelected = this.selectedHandCard === index;

      if (slot) {
        // 选中悬停抬起
        const targetY = isSelected ? -12 : 0;
        const cardSprite = this.createCardSprite(slot.card, x, targetY, cardWidth, cardHeight, slot);

        cardSprite.setInteractive();
        cardSprite.on('pointerdown', () => {
          if (this.isAnimating) return;
          this.soundManager.playClick();
          this.selectedHandCard = isSelected ? -1 : index;
          this.updateUI();
        });

        if (isSelected) {
          // 描橙线框
          const highlight = this.add.rectangle(x, targetY, cardWidth, cardHeight);
          highlight.setStrokeStyle(3, 0xFF6F00);
          this.handContainer.add(highlight);
        }

        this.handContainer.add(cardSprite);
      } else {
        // 虚线占位符空槽位
        const emptySlot = this.add.rectangle(x, 0, cardWidth, cardHeight);
        emptySlot.setStrokeStyle(2, 0xbdbdbd, 0.45);
        this.handContainer.add(emptySlot);

        const emptyLabel = this.add.text(x, 0, '空位', {
          fontSize: '14px',
          color: '#9E9E9E',
          fontFamily: 'Arial',
        }).setOrigin(0.5);
        this.handContainer.add(emptyLabel);
      }
    });
  }

  /** 产生一个用于飞行动画的虚拟克隆卡牌，动画完成后会被自动清除 */
  private playBuyFlightAnimation(cardIndex: number, emptySlotIndex: number, onComplete: () => void): void {
    const publicCards = this.turnManager.getPublicCards();
    const card = publicCards[cardIndex];
    if (!card) {
      onComplete();
      return;
    }

    // 公共牌世界坐标
    const pubWidth = 160;
    const pubSpacing = 20;
    const pubStartX = -((publicCards.length - 1) * (pubWidth + pubSpacing)) / 2;
    const originX = 214 + (pubStartX + cardIndex * (pubWidth + pubSpacing));
    const originY = 260 - 12; // 计入上浮偏移量

    // 目标手牌空槽世界坐标
    const handWidth = 120;
    const handSpacing = 10;
    const handStartX = -((3 - 1) * (handWidth + handSpacing)) / 2;
    const targetX = 214 + (handStartX + emptySlotIndex * (handWidth + handSpacing));
    const targetY = 490;

    // 克隆产生的卡牌 Container
    const flightObj = this.createCardSprite(card, originX, originY, 120, 160, null);
    flightObj.setDepth(150);

    // 缓动飞行平移
    this.tweens.add({
      targets: flightObj,
      x: targetX,
      y: targetY,
      scaleX: 0.75, // 公共牌比手牌大，飞行过程中顺滑缩小
      scaleY: 0.75,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        flightObj.destroy();
        onComplete();
      }
    });
  }

  /** 播放手牌强平或卖出时的“向上高抛飞逸淡出”动画 */
  private playSellFlightAnimation(slotIndex: number, onComplete: () => void): void {
    const hand = this.turnManager.getHand();
    const slot = hand[slotIndex];
    if (!slot) {
      onComplete();
      return;
    }

    // 手牌在场景中的世界坐标
    const cardWidth = 120;
    const spacing = 10;
    const startX = -((hand.length - 1) * (cardWidth + spacing)) / 2;
    const originX = 214 + (startX + slotIndex * (cardWidth + spacing));
    const originY = 490 - 12; // 计入选中浮起

    const flightObj = this.createCardSprite(slot.card, originX, originY, 120, 160, slot);
    flightObj.setDepth(150);

    // 高抛加速飞出屏幕顶部并渐隐
    this.tweens.add({
      targets: flightObj,
      y: -120,
      alpha: 0,
      scale: 0.5,
      duration: 450,
      ease: 'Quart.easeIn',
      onComplete: () => {
        flightObj.destroy();
        onComplete();
      }
    });
  }

  /** 产生卡牌 Container */
  private createCardSprite(
    card: JiaziCard,
    x: number,
    y: number,
    width: number,
    height: number,
    slot?: HandSlot | null
  ): Phaser.GameObjects.Container {
    const elementColors: Record<string, number> = {
      wood: 0xE8F5E9,
      fire: 0xFBE9E7,
      earth: 0xFFF8E1,
      metal: 0xFFFDE7,
      water: 0xE3F2FD,
    };

    const bgColor = elementColors[card.mainElement] || 0xffffff;

    // 宣纸色卡片底
    const bg = this.add.rectangle(0, 0, width, height, bgColor);
    bg.setStrokeStyle(2, 0xd7ccc8);

    // 天干地支卡牌命名
    const nameLabel = this.add.text(0, -height / 2 + 32, card.name, {
      fontSize: width > 130 ? '22px' : '17px',
      color: '#3E2723',
      fontFamily: 'Georgia, Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    // 五行字样
    const elementNames: Record<string, string> = {
      wood: '木',
      fire: '火',
      earth: '土',
      metal: '金',
      water: '水',
    };
    const elementLabel = this.add.text(0, -height / 2 + 60, elementNames[card.mainElement], {
      fontSize: '13px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    const yinYangNames: Record<string, string> = {
      yin: '阴',
      yang: '阳',
    };

    const metaLabel = this.add.text(0, -height / 2 + 78, `${yinYangNames[card.yinYang]}${elementNames[card.mainElement]}`, {
      fontSize: '12px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 当季评分得分
    const score = card.getSeasonScore(this.turnManager.getCurrentSeason());
    const scoreLabel = this.add.text(0, height / 2 - 38, `${score >= 0 ? '+' : ''}${score.toFixed(1)}`, {
      fontSize: width > 130 ? '20px' : '15px',
      color: score >= 0 ? '#2E7D32' : '#C62828',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

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
    container.setSize(width, height);

    return container;
  }

  /** 状态驱动更新按钮状态与遮罩显示 */
  private updateButtons(): void {
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
    const buyLabelText = this.buyButton.getAt(1) as Phaser.GameObjects.Text;
    buyLabelText.setFontSize('16px');
    this.setButtonLabel(this.buyButton, buyLabel);
    this.buyButton.setAlpha(canBuy && !this.isShowingSettlement && !this.isAnimating ? 1 : 0.5);

    const leverage = this.turnManager.getLeverageMultiplier();
    const leverageButton = this.leverageButton.getAt(0) as Phaser.GameObjects.Rectangle;
    if (leverage > 1 && selectedPublic) {
      this.setButtonLabel(this.leverageButton, `杠杆 ${leverage}x ${this.leverageEnabled ? '开' : '关'}`);
      leverageButton.setFillStyle(this.leverageEnabled ? 0xE65100 : 0x9E9E9E);
      this.leverageButton.setAlpha(!this.isShowingSettlement && !this.isAnimating ? 1 : 0.5);
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
    const sellLabelText = this.sellButton.getAt(1) as Phaser.GameObjects.Text;
    sellLabelText.setFontSize('16px');
    this.setButtonLabel(this.sellButton, sellLabel);
    this.sellButton.setAlpha(canSell && !this.isShowingSettlement && !this.isAnimating ? 1 : 0.5);

    const waitLabelText = this.waitButton.getAt(1) as Phaser.GameObjects.Text;
    waitLabelText.setFontSize('13px');
    this.setButtonLabel(this.waitButton, '等待 (下回合+17气)');
    const canWait = state === 'player_action' && !this.isShowingSettlement && !this.isAnimating;
    this.waitButton.setAlpha(canWait ? 1 : 0.5);
  }

  /** 执行卡牌购买及飞入槽位动画 */
  private onBuyClick(): void {
    if (this.isShowingSettlement || this.isAnimating) return;

    if (this.selectedPublicCard === -1) {
      this.showToast('请先选择公共牌');
      return;
    }

    const emptySlotIndex = this.turnManager.getHand().findIndex(slot => slot === null);
    if (emptySlotIndex === -1) {
      this.showToast('手牌已满');
      return;
    }

    const publicCards = this.turnManager.getPublicCards();
    const card = publicCards[this.selectedPublicCard];
    if (!card) return;

    const buyCost = this.getBuyCost(card, this.leverageEnabled);
    if (this.turnManager.getQi() < buyCost) {
      this.showToast('气不足无法买入');
      return;
    }

    this.previousQi = this.turnManager.getQi();
    this.previousScore = this.turnManager.getScore();

    // 状态加锁阻断重复点击
    this.isAnimating = true;

    // 先播放飞行动画，动画完结后再结算
    this.playBuyFlightAnimation(this.selectedPublicCard, emptySlotIndex, () => {
      const success = this.turnManager.executeBuy(this.selectedPublicCard, this.leverageEnabled);
      this.isAnimating = false;

      if (success) {
        this.soundManager.playBuy();
        this.selectedPublicCard = -1;
        this.leverageEnabled = false;
        this.updateUI();
        this.showRoundDeltaFeedback();
      } else {
        this.showToast('购买失败，气不足');
        this.updateUI();
      }
    });
  }

  /** 选择杠杆 */
  private onLeverageClick(): void {
    if (this.isShowingSettlement || this.isAnimating) return;

    if (this.selectedPublicCard === -1) {
      this.showToast('请先选择公共牌');
      return;
    }
    const leverage = this.turnManager.getLeverageMultiplier();
    if (leverage > 1) {
      this.soundManager.playClick();
      this.leverageEnabled = !this.leverageEnabled;
      this.updateUI();
    } else {
      this.showToast('当前无杠杆加成');
    }
  }

  /** 卖出手牌及高抛飞逸动画 */
  private onSellClick(): void {
    if (this.isShowingSettlement || this.isAnimating) return;

    if (this.selectedHandCard === -1) {
      this.showToast('请先选择手牌');
      return;
    }

    if (this.turnManager.getQi() < 3) {
      this.showToast('气不足无法卖出');
      return;
    }

    this.previousQi = this.turnManager.getQi();
    this.previousScore = this.turnManager.getScore();

    this.isAnimating = true;

    // 先高抛飞出，再扣气结算移除
    this.playSellFlightAnimation(this.selectedHandCard, () => {
      const success = this.turnManager.executeSell(this.selectedHandCard);
      this.isAnimating = false;

      if (success) {
        this.soundManager.playSell();
        this.selectedHandCard = -1;
        this.updateUI();
        this.showRoundDeltaFeedback();
      } else {
        this.showToast('卖出失败，气不足');
        this.updateUI();
      }
    });
  }

  /** 等待动作 */
  private onWaitClick(): void {
    if (this.isShowingSettlement || this.isAnimating) return;
    this.soundManager.playClick();
    
    this.previousQi = this.turnManager.getQi();
    this.previousScore = this.turnManager.getScore();

    this.turnManager.executeWait();
    this.selectedPublicCard = -1;
    this.selectedHandCard = -1;
    this.leverageEnabled = false;
    this.updateUI();
    this.showRoundDeltaFeedback();
  }

  /** 呈现终局统计界面 */
  private showGameOver(finalScore: number): void {
    // 黑色半透明背景
    const mask = this.add.rectangle(214, 380, 428, 760, 0x000000, 0.75);
    mask.setInteractive();
    mask.setDepth(250);

    // 结算卷轴面板
    const panelBg = this.add.rectangle(214, 380, 350, 420, 0xffffff);
    panelBg.setStrokeStyle(3, 0x3E2723);
    panelBg.setDepth(251);

    // 终局标题
    const gameOverTitle = this.add.text(214, 210, '🏆 终局结算 🏆', {
      fontSize: '26px',
      color: '#3E2723',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(252);

    // 得分文字
    const finalScoreLabel = this.add.text(214, 275, `最终得分: ${finalScore.toFixed(1)}`, {
      fontSize: '24px',
      color: finalScore >= 0 ? '#2E7D32' : '#C62828',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(252);

    // 构成描述
    const descText = this.add.text(214, 345, 
      `持仓收益: ${this.turnManager.getTotalHoldEarnings().toFixed(1)} ｜ 卖出收益: ${this.turnManager.getTotalSellEarnings().toFixed(1)}\n` + 
      `买入次数: ${this.turnManager.getTotalBuys()} 次 (杠杆 ${this.turnManager.getTotalLeverageBuys()} 次)\n` + 
      `卖出次数: ${this.turnManager.getTotalSells()} 次 ｜ 等待次数: ${this.turnManager.getTotalWaits()} 次\n` + 
      `爆仓次数: ${this.turnManager.getMarginCallCount()} 次\n\n` + 
      `六十天时已满，本局结束。`, {
      fontSize: '13px',
      color: '#5D4037',
      fontFamily: 'Arial',
      align: 'center',
      lineSpacing: 4
    }).setOrigin(0.5).setDepth(252);

    // 按钮 Container
    const restartButton = this.createButton(214, 460, '再来一局', 0x4CAF50, () => {
      this.soundManager.playClick();
      
      this.turnManager.reset();
      this.selectedPublicCard = -1;
      this.selectedHandCard = -1;
      this.leverageEnabled = false;
      this.lastSettlementRoundShown = 0;
      this.isShowingSettlement = false;
      
      // 重置对比参数
      this.lastSeason = 'spring';
      this.lastScore = 0;
      
      this.updateUI();

      mask.destroy();
      panelBg.destroy();
      gameOverTitle.destroy();
      finalScoreLabel.destroy();
      descText.destroy();
      restartButton.destroy();

      this.scene.restart();
    });
    restartButton.setDepth(252);
  }
}
