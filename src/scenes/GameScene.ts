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

    // 展示开始菜单
    this.showStartScreen();

    // 全局点击空白取消选择 (防止事件穿透，限玩家操作回合)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, currentlyOver: Phaser.GameObjects.GameObject[]) => {
      if (this.isShowingSettlement || this.isAnimating) return;
      if (this.turnManager && this.turnManager.getState() === 'player_action') {
        if (currentlyOver.length === 0) {
          this.selectedPublicCard = -1;
          this.selectedHandCard = -1;
          this.updateUI();
        }
      }
    });
  }

  private showStartScreen(): void {
    const elements: Phaser.GameObjects.GameObject[] = [];

    // 1. 开始背景遮罩（宣纸颜色）
    const startBg = this.add.rectangle(214, 380, 428, 760, 0xf5f0e8);
    startBg.setInteractive(); // 阻断点击
    startBg.setDepth(400);
    elements.push(startBg);

    // 精致内边框
    const innerFrame = this.add.rectangle(214, 380, 398, 720);
    innerFrame.setStrokeStyle(2, 0xd7ccc8);
    innerFrame.setDepth(401);
    elements.push(innerFrame);

    // 2. 主标题
    const titleText = this.add.text(214, 210, '甲 子 纪', {
      fontSize: '46px',
      color: '#3E2723',
      fontFamily: 'Georgia, Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(402);
    elements.push(titleText);

    // 副标题
    const subTitleText = this.add.text(214, 265, 'Jiazi Chronicle', {
      fontSize: '18px',
      color: '#795548',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(402);
    elements.push(subTitleText);

    // 玩法核心概念两行字
    const descText = this.add.text(214, 335, '以六十甲子为主题\n回合制策略卡牌经营', {
      fontSize: '15px',
      color: '#5D4037',
      fontFamily: 'Arial',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5).setDepth(402);
    elements.push(descText);

    // 3. 开始游戏按钮
    const startButton = this.createButton(214, 460, '开始游戏', 0x4CAF50, () => {
      this.soundManager.playClick();
      // 销毁所有开始界面元素
      elements.forEach(el => el.destroy());
      startButton.destroy();
      helpButton.destroy();
      aboutLink.destroy();
      // 正式启动游戏
      this.initializeGame();
    });
    startButton.setDepth(402);

    // 4. 玩法说明大按钮
    const helpButton = this.createButton(214, 520, '玩法说明', 0x2196F3, () => {
      this.soundManager.playClick();
      this.showHelpPopup();
    });
    helpButton.setDepth(402);

    // 5. 关于（小字）
    const aboutLink = this.add.text(214, 715, '关于 ｜ v0.1.0', {
      fontSize: '11px',
      color: '#9E9E9E',
      fontFamily: 'Arial',
    }).setOrigin(0.5).setDepth(402);
  }

  private showHelpPopup(): void {
    const helpElements: Phaser.GameObjects.GameObject[] = [];

    // 玩法弹窗遮罩（半透明黑）
    const helpMask = this.add.rectangle(214, 380, 428, 760, 0x000000, 0.65);
    helpMask.setInteractive();
    helpMask.setDepth(410);
    helpElements.push(helpMask);

    // 古风卷轴弹窗背景
    const helpBg = this.add.rectangle(214, 380, 360, 490, 0xfffdf5);
    helpBg.setStrokeStyle(3, 0x3E2723);
    helpBg.setDepth(411);
    helpElements.push(helpBg);

    // 内边框
    const innerFrame = this.add.rectangle(214, 380, 340, 470);
    innerFrame.setStrokeStyle(1, 0xd7ccc8);
    innerFrame.setDepth(412);
    helpElements.push(innerFrame);

    // 规则标题
    const ruleTitle = this.add.text(214, 185, '💡 玩法指南 💡', {
      fontSize: '20px',
      color: '#3E2723',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(413);
    helpElements.push(ruleTitle);

    // 规则正文
    const rules = [
      '1. 【低吸高抛】从公共池买入卡牌，适时在手牌区卖出卡牌以获取天时差价积分。',
      '2. 【可用流动性】“气”是交易的唯一筹码与流动性。当可用气归零且持有杠杆牌时必触发爆仓。这是流动性管理失败的恶果，而非随机惩罚。',
      '3. 【保证金锁定】买入卡牌（特别是杠杆买入）需要向仓位锁定对应保证金（占用气），这会直接压低您的可用气上限；卖出卡牌时，保证金将全数退回。',
      '4. 【平仓自救】当流动性紧张时，卖出卡牌不仅是止盈或止损，更是退回保证金、降低每回合维持气耗以渡过难关的唯一自救平仓手段。'
    ];
    const ruleContent = this.add.text(214, 355, rules.join('\n\n'), {
      fontSize: '12px',
      color: '#5D4037',
      fontFamily: 'Arial',
      align: 'left',
      wordWrap: {
        callback: (text, textObject) => this.wrapChineseText(text, 300, textObject)
      },
      lineSpacing: 2
    }).setOrigin(0.5).setDepth(413);
    helpElements.push(ruleContent);

    // “我知道了”按钮
    const confirmBtn = this.createButton(214, 575, '我知道了', 0x4CAF50, () => {
      this.soundManager.playClick();
      // 销毁所有帮助界面元素
      helpElements.forEach(el => el.destroy());
      confirmBtn.destroy();
    });
    confirmBtn.setDepth(413);
  }

  /** 中文文本自动换行辅助函数 */
  private wrapChineseText(text: string, wrapWidth: number, textObject: Phaser.GameObjects.Text): string {
    const context = textObject.canvas.getContext('2d');
    if (!context) return text;

    const originalFont = context.font;
    context.font = (textObject.style as any)._font || '12px Arial';

    const paragraphs = text.split('\n');
    const wrappedParagraphs = paragraphs.map(para => {
      if (!para) return '';
      const chars = para.split('');
      let currentLine = '';
      const lines: string[] = [];

      for (let i = 0; i < chars.length; i++) {
        const testLine = currentLine + chars[i];
        const width = context.measureText(testLine).width;
        if (width > wrapWidth && i > 0) {
          lines.push(currentLine);
          currentLine = chars[i];
        } else {
          currentLine = testLine;
        }
      }
      lines.push(currentLine);
      return lines.join('\n');
    });

    context.font = originalFont;
    return wrappedParagraphs.join('\n');
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

    // 气数值与持仓气耗合并展示标签文字
    this.qiLabel = this.add.text(214, 110, '气: 50.0/80 (持仓维持: -0.0气/回合)', {
      fontSize: '13px',
      color: '#3E2723',
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

    const width = maxQi > 0 ? (clampedQi / maxQi) * 400 : 0;
    
    let totalQiCost = 0;
    const hand = this.turnManager.getHand();
    const season = this.turnManager.getCurrentSeason();
    hand.forEach(slot => {
      if (slot) {
        totalQiCost += this.getHoldQiCost(slot.card.getSeasonScore(season), slot.leverage);
      }
    });

    let color = 0x4CAF50; // 丰盈常绿
    const turnsToLive = totalQiCost > 0 ? qi / totalQiCost : 99;
    
    if (qi - totalQiCost <= 0 && hand.some(slot => slot && slot.leverage > 1)) {
      color = 0xE53935; // 枯绝赤红 (必遭强平)
    } else if (turnsToLive <= 2.0 && hand.some(slot => slot && slot.leverage > 1)) {
      color = 0xFF9800; // 警示橙色
    } else if (clampedQi / maxQi < 0.3) {
      color = 0xFFC107; // 警告黄
    }

    this.qiBar.fillStyle(color, 1);
    this.qiBar.fillRect(14, 95, width, 30);
  }

  /** 创建公共池卡牌展示区 */
  private createPublicCardsArea(): void {
    const areaBg = this.add.rectangle(214, 266, 428, 228, 0xf5f0e8);
    areaBg.setStrokeStyle(1, 0xd7ccc8);

    this.add.text(214, 150, '公共牌池', {
      fontSize: '16px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    this.publicCardsContainer = this.add.container(214, 266);
  }

  /** 创建玩家手牌区 */
  private createHandArea(): void {
    const areaBg = this.add.rectangle(214, 480, 428, 200, 0xf5f0e8);
    areaBg.setStrokeStyle(1, 0xd7ccc8);

    this.add.text(214, 384, '我的手牌', {
      fontSize: '16px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    this.handContainer = this.add.container(214, 480);
  }

  /** 创建底部控制面板操作区域 */
  private createButtonArea(): void {
    // 买入按钮
    this.buyButton = this.createButton(107, 648, '买入', 0x2196F3, () => {
      this.onBuyClick();
    });

    // 杠杆倍速切换按钮
    this.leverageButton = this.createButton(321, 648, '杠杆 1.0x', 0x9E9E9E, () => {
      this.onLeverageClick();
    });

    // 卖出卡牌结算按钮
    this.sellButton = this.createButton(107, 708, '卖出', 0xFF9800, () => {
      this.onSellClick();
    });

    // 等待推进回合按钮
    this.waitButton = this.createButton(321, 708, '等待', 0x4CAF50, () => {
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
    const bg = this.add.rectangle(214, 592, 400, 62, 0xfffdf5);
    bg.setStrokeStyle(1, 0xd7ccc8);

    this.decisionInfo = this.add.text(214, 592, '选择公共牌买入，或选择手牌卖出', {
      fontSize: '12px',
      color: '#5D4037',
      fontFamily: 'Arial',
      align: 'center',
      lineSpacing: 4,
      wordWrap: {
        callback: (text, textObject) => this.wrapChineseText(text, 380, textObject)
      },
    }).setOrigin(0.5);
  }

  /** 显示临时小 Toast 文字提醒 */
  private showToast(message: string): void {
    const toast = this.add.text(214, 142, message, {
      fontSize: '15px',
      color: '#ffffff',
      fontFamily: 'Arial',
      backgroundColor: '#4E342E',
      padding: { x: 12, y: 6 }
    }).setOrigin(0.5);
    toast.setDepth(300);

    this.tweens.add({
      targets: toast,
      y: 128,
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

  private getSeasonScorePreview(card: JiaziCard): string {
    const spring = card.getSeasonScore('spring');
    const summer = card.getSeasonScore('summer');
    const autumn = card.getSeasonScore('autumn');
    const winter = card.getSeasonScore('winter');
    return `🌸春 ${this.formatSigned(spring, 0)} ｜ ☀️夏 ${this.formatSigned(summer, 0)} ｜ 🍂秋 ${this.formatSigned(autumn, 0)} ｜ ❄️冬 ${this.formatSigned(winter, 0)}`;
  }

  private updateDecisionInfo(): void {
    const season = this.turnManager.getCurrentSeason();
    const publicCards = this.turnManager.getPublicCards();
    const hand = this.turnManager.getHand();
    const leverage = this.turnManager.getLeverageMultiplier();
    const qi = this.turnManager.getQi();

    if (this.selectedPublicCard !== -1) {
      const card = publicCards[this.selectedPublicCard];
      if (card) {
        const cardScore = card.getSeasonScore(season);
        const activeLeverage = this.leverageEnabled ? leverage : 1;
        const buyCost = this.getBuyCost(card, this.leverageEnabled);
        const holdGain = this.getHoldEarning(cardScore, activeLeverage);
        const holdCost = this.getHoldQiCost(cardScore, activeLeverage);
        const leverageText = this.leverageEnabled ? `（杠杆 ${leverage}x）` : '';
        const lockedQi = buyCost - 2;
        this.decisionInfo.setText(
          `【${card.name}】${leverageText} ｜ 当季评分 ${this.formatSigned(cardScore)} ｜ 维持气耗 -${holdCost.toFixed(1)}气/T\n` +
          `买入成本: -${buyCost}气 (手续费 2气 + 锁保证金 ${lockedQi}气) ｜ 预计收益: +${holdGain.toFixed(1)}分/T\n` +
          `天时预览: ${this.getSeasonScorePreview(card)} ｜ 💡 再次点击或点击空白取消选择`
        );
        return;
      }
    }

    if (this.selectedHandCard !== -1) {
      const slot = hand[this.selectedHandCard];
      if (slot) {
        const currentScore = slot.card.getSeasonScore(season);
        const sellScore = this.getSellScore(slot);
        
        const lockedQi = slot.lockedQi;
        const sellCost = 4;
        const sellQiReturn = lockedQi + Math.max(-8, Math.min(8, sellScore * 0.2)) - sellCost;
        const holdQiCost = this.getHoldQiCost(currentScore, slot.leverage);

        let selfRescueText = `💡 自救预览：退保证金 +${lockedQi}气 ｜ 预计净回气 +${sellQiReturn.toFixed(1)}气 ｜ 降气耗 -${holdQiCost.toFixed(1)}气/T`;
        if (sellQiReturn < 0) {
          selfRescueText = `⚠️ 割肉平仓将产生净耗气 -${Math.abs(sellQiReturn).toFixed(1)}气，请确保气量充足`;
        }

        const riskText = qi < 24 && slot.leverage > 1 ? ' ｜ ⚠️ 爆仓风险' : '';
        const sellScoreText = sellScore >= 0 ? `预计盈亏: +${sellScore.toFixed(1)}分` : `预计盈亏: ${sellScore.toFixed(1)}分`;
        this.decisionInfo.setText(
          `【${slot.card.name}】（持仓第${slot.buyRound}回合，杠杆 ${slot.leverage}x）${riskText}\n` +
          `${sellScoreText} ｜ ${selfRescueText}\n` +
          `天时预览: ${this.getSeasonScorePreview(slot.card)} ｜ 💡 再次点击或点击空白取消选择`
        );
        return;
      }
    }

    // 默认无选择状态，检测是否下回合即将结算爆仓
    let totalQiCost = 0;
    hand.forEach(slot => {
      if (slot) {
        totalQiCost += this.getHoldQiCost(slot.card.getSeasonScore(season), slot.leverage);
      }
    });
    const hasLeverage = hand.some(slot => slot && slot.leverage > 1);

    if (hasLeverage && qi - totalQiCost <= 0) {
      this.decisionInfo.setText(
        '⚠️ 【爆仓警报】当前可用气不足！本回合结束将立刻爆仓强平！\n' +
        '💡 请立刻点击下方手牌并进行卖出以释放保证金自救！'
      );
    } else {
      this.decisionInfo.setText('选择公共牌买入，或选择手牌卖出。再次点击卡牌或点击空白取消选择。');
    }
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

    // 4. 更新气状态与持仓维持消耗显示
    const totalLockedQi = this.turnManager.getTotalLockedQi();
    const currentMaxQi = 80 - totalLockedQi;
    this.updateQiBar(qi, currentMaxQi);

    // 计算当前持仓总气耗并合并更新标签展示
    let totalQiCost = 0;
    const hand = this.turnManager.getHand();
    hand.forEach(slot => {
      if (slot) {
        totalQiCost += this.getHoldQiCost(slot.card.getSeasonScore(season), slot.leverage);
      }
    });

    const turnsToLive = totalQiCost > 0 ? qi / totalQiCost : 99;
    const hasLeverage = hand.some(slot => slot && slot.leverage > 1);

    let warningText = '';
    if (hasLeverage) {
      if (qi - totalQiCost <= 0) {
        warningText = ' ⚠️[危] 下回合必爆仓！';
        this.qiLabel.setColor('#E53935'); // 红色
      } else if (turnsToLive <= 2.0) {
        warningText = ` ⚠️[警] ${Math.ceil(turnsToLive)}回合后爆仓`;
        this.qiLabel.setColor('#FF9800'); // 橙色
      } else {
        this.qiLabel.setColor('#3E2723'); // 默认颜色
      }
    } else {
      this.qiLabel.setColor('#3E2723');
    }

    this.qiLabel.setText(`气: ${qi.toFixed(1)}/${currentMaxQi}${warningText} (锁定保证金: ${totalLockedQi}气 ｜ 持仓维持: -${totalQiCost.toFixed(1)}气/回合)`);

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
      const targetY = isSelected ? -6 : 0; 
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
        const targetY = isSelected ? -6 : 0;
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
    const originY = 266 - 6; // 计入上浮偏移量

    // 目标手牌空槽世界坐标
    const handWidth = 120;
    const handSpacing = 10;
    const handStartX = -((3 - 1) * (handWidth + handSpacing)) / 2;
    const targetX = 214 + (handStartX + emptySlotIndex * (handWidth + handSpacing));
    const targetY = 480;

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
    const originY = 480 - 6; // 计入选中浮起

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
    let strokeColor = 0xd7ccc8;
    let strokeWidth = 2;
    if (slot && slot.leverage > 1) {
      let tempRiskStr = '无';
      let totalHoldCostForStroke = 0;
      this.turnManager.getHand().forEach(s => {
        if (s) {
          totalHoldCostForStroke += this.turnManager.previewHoldQiCost(s.card.getSeasonScore(this.turnManager.getCurrentSeason()), s.leverage);
        }
      });
      if (totalHoldCostForStroke > 0) {
        const tempTurnsToLive = this.turnManager.getQi() / totalHoldCostForStroke;
        if (tempTurnsToLive < 2) {
          tempRiskStr = '极高';
        } else if (tempTurnsToLive < 4) {
          tempRiskStr = '高';
        } else if (tempTurnsToLive < 7) {
          tempRiskStr = '中';
        }
      }
      if (tempRiskStr === '极高') {
        strokeColor = 0xD50000;
        strokeWidth = 3;
      } else if (tempRiskStr === '高') {
        strokeColor = 0xE65100;
        strokeWidth = 3;
      } else if (tempRiskStr === '中') {
        strokeColor = 0xF57C00;
        strokeWidth = 2.5;
      }
    }
    bg.setStrokeStyle(strokeWidth, strokeColor);

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

    const children: Phaser.GameObjects.GameObject[] = [bg, nameLabel, elementLabel, metaLabel];

    if (slot) {
      const profit = slot.getProfit(this.turnManager.getCurrentSeason());
      const holdQiCost = this.turnManager.previewHoldQiCost(card.getSeasonScore(this.turnManager.getCurrentSeason()), slot.leverage);
      const isLeverage = slot.leverage > 1;

      let totalHoldCost = 0;
      this.turnManager.getHand().forEach(s => {
        if (s) {
          totalHoldCost += this.turnManager.previewHoldQiCost(s.card.getSeasonScore(this.turnManager.getCurrentSeason()), s.leverage);
        }
      });

      let riskStr = '无';
      let riskColor = '#757575';
      if (isLeverage) {
        if (totalHoldCost <= 0) {
          riskStr = '低';
          riskColor = '#2E7D32';
        } else {
          const turnsToLive = this.turnManager.getQi() / totalHoldCost;
          if (turnsToLive < 2) {
            riskStr = '极高';
            riskColor = '#D50000';
          } else if (turnsToLive < 4) {
            riskStr = '高';
            riskColor = '#E65100';
          } else if (turnsToLive < 7) {
            riskStr = '中';
            riskColor = '#F57C00';
          } else {
            riskStr = '低';
            riskColor = '#2E7D32';
          }
        }
      }

      const sellScore = this.turnManager.previewSellScore(slot);
      const sellScoreSign = sellScore >= 0 ? `+${sellScore.toFixed(0)}` : `${sellScore.toFixed(0)}`;

      const line1 = `押:${slot.lockedQi}气 ｜ 耗:-${holdQiCost.toFixed(1)}/T`;
      const label1 = this.add.text(0, height / 2 - 42, line1, {
        fontSize: '10px',
        color: '#5D4037',
        fontFamily: 'Arial',
        fontStyle: 'bold'
      }).setOrigin(0.5);

      const label2 = this.add.text(-22, height / 2 - 20, `盈:${sellScoreSign}`, {
        fontSize: '10px',
        color: sellScore >= 0 ? '#2E7D32' : '#C62828',
        fontFamily: 'Arial',
        fontStyle: 'bold'
      }).setOrigin(0.5);

      const label3 = this.add.text(28, height / 2 - 20, `险:${riskStr}`, {
        fontSize: '10px',
        color: riskColor,
        fontFamily: 'Arial',
        fontStyle: 'bold'
      }).setOrigin(0.5);

      children.push(label1, label2, label3);
    } else {
      const score = card.getSeasonScore(this.turnManager.getCurrentSeason());
      const scoreLabel = this.add.text(0, height / 2 - 38, `${score >= 0 ? '+' : ''}${score.toFixed(1)}`, {
        fontSize: width > 130 ? '20px' : '15px',
        color: score >= 0 ? '#2E7D32' : '#C62828',
        fontFamily: 'Arial',
        fontStyle: 'bold'
      }).setOrigin(0.5);

      const detailText = `买入 -${this.getBuyCost(card, this.leverageEnabled)}气`;
      const detailLabel = this.add.text(0, height / 2 - 18, detailText, {
        fontSize: width > 130 ? '13px' : '11px',
        color: '#795548',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      }).setOrigin(0.5);

      children.push(scoreLabel, detailLabel);
    }

    if (slot && slot.leverage > 1) {
      const badgeBg = this.add.rectangle(width / 2 - 22, -height / 2 + 12, 38, 16, 0xff6f00);
      const badgeText = this.add.text(width / 2 - 22, -height / 2 + 12, `${slot.leverage}x`, {
        fontSize: '10px',
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
    let canSell = false;
    if (!hasHandCard) {
      sellLabel = '无牌可卖';
    } else if (selectedSlot) {
      const qiChange = this.turnManager.previewSellQiChange(selectedSlot);
      const sellScore = this.getSellScore(selectedSlot);
      if (qiChange < 0) {
        const cost = Math.abs(qiChange);
        canSell = state === 'player_action' && qi >= cost;
        sellLabel = qi >= cost ? `卖出 ${this.formatSigned(sellScore, 0)}分` : '气不足';
      } else {
        canSell = state === 'player_action';
        sellLabel = `卖出 ${this.formatSigned(sellScore, 0)}分`;
      }
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

    const state = this.turnManager.getState();
    if (state !== 'player_action') {
      this.showToast('当前非玩家操作回合');
      return;
    }

    if (this.selectedPublicCard === -1) {
      this.showToast('请先在上方卡池中选择卡牌');
      return;
    }

    const emptySlotIndex = this.turnManager.getHand().findIndex(slot => slot === null);
    if (emptySlotIndex === -1) {
      this.showToast('手牌已满 3 张，请先卖出部分持仓');
      return;
    }

    const publicCards = this.turnManager.getPublicCards();
    const card = publicCards[this.selectedPublicCard];
    if (!card) return;

    const buyCost = this.getBuyCost(card, this.leverageEnabled);
    if (this.turnManager.getQi() < buyCost) {
      this.showToast('可用气不足，无法支付买入费用与保证金');
      return;
    }

    // 二次确认：1. 杠杆买入确认
    if (this.leverageEnabled) {
      const confirm = window.confirm('【杠杆买入确认】开启杠杆买入将锁定保证金，并且会成倍增加后续每回合的持仓维持气耗，且无法取消。确定要开启杠杆买入吗？');
      if (!confirm) return;
    }

    // 二次确认：2. 流动性危急买入确认
    const qi = this.turnManager.getQi();
    const season = this.turnManager.getCurrentSeason();
    let currentTotalHoldCost = 0;
    this.turnManager.getHand().forEach(s => {
      if (s) {
        currentTotalHoldCost += this.getHoldQiCost(s.card.getSeasonScore(season), s.leverage);
      }
    });
    const newCardScore = card.getSeasonScore(season);
    const newCardHoldCost = this.getHoldQiCost(newCardScore, this.leverageEnabled ? this.turnManager.getLeverageMultiplier() : 1);
    const nextHoldCost = currentTotalHoldCost + newCardHoldCost;
    const nextQi = qi - buyCost;
    const nextTurnsToLive = nextHoldCost > 0 ? nextQi / nextHoldCost : 99;
    const isLowQiBuy = qi < 20 || (nextQi < nextHoldCost) || (nextTurnsToLive <= 1.0);

    if (isLowQiBuy) {
      const confirm = window.confirm('【流动性危急买入】当前可用气较低，或买入后可用气无法支撑下一回合维持气耗（预计存活回合数将为 0/1），极易导致爆仓。确定要继续买入吗？');
      if (!confirm) return;
    }

    this.previousQi = qi;
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

    const state = this.turnManager.getState();
    if (state !== 'player_action') {
      this.showToast('当前非玩家操作回合');
      return;
    }

    if (this.selectedPublicCard === -1) {
      this.showToast('请先在上方卡池中选择卡牌以开启杠杆');
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

    const state = this.turnManager.getState();
    if (state !== 'player_action') {
      this.showToast('当前非玩家操作回合');
      return;
    }

    const hand = this.turnManager.getHand();
    const selectedSlot = this.selectedHandCard !== -1 ? hand[this.selectedHandCard] : null;
    if (!selectedSlot) {
      this.showToast('请先在下方手牌中选择要卖出的卡牌');
      return;
    }

    const qiChange = this.turnManager.previewSellQiChange(selectedSlot);
    if (qiChange < 0 && this.turnManager.getQi() < Math.abs(qiChange)) {
      this.showToast('可用气不足以支付卖出的气量消耗');
      return;
    }

    // 二次确认：仅大额且非自救割肉确认
    const sellScore = this.getSellScore(selectedSlot);
    const qi = this.turnManager.getQi();
    const season = this.turnManager.getCurrentSeason();
    let currentTotalHoldCost = 0;
    hand.forEach(s => {
      if (s) {
        currentTotalHoldCost += this.getHoldQiCost(s.card.getSeasonScore(season), s.leverage);
      }
    });
    const turnsToLive = currentTotalHoldCost > 0 ? qi / currentTotalHoldCost : 99;
    const inDanger = (qi < 20) || (turnsToLive <= 2.0);

    if (sellScore <= -5 && !inDanger) {
      const confirm = window.confirm('【大额亏损平仓确认】此卡牌当前亏损严重，且您当前流动性安全，确定要在这时割肉卖出吗？');
      if (!confirm) return;
    }

    this.previousQi = qi;
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

    const state = this.turnManager.getState();
    if (state !== 'player_action') {
      this.showToast('当前非玩家操作回合');
      return;
    }

    const qi = this.turnManager.getQi();
    const hand = this.turnManager.getHand();
    const season = this.turnManager.getCurrentSeason();
    let currentTotalHoldCost = 0;
    hand.forEach(s => {
      if (s) {
        currentTotalHoldCost += this.getHoldQiCost(s.card.getSeasonScore(season), s.leverage);
      }
    });
    const hasLeverage = hand.some(slot => slot && slot.leverage > 1);
    const willMarginCallNextTurn = hasLeverage && (qi - currentTotalHoldCost <= 0);

    if (willMarginCallNextTurn) {
      const confirm = window.confirm('⚠️【警告：下回合必爆仓！】检测到当前持仓在下一回合结束后会扣干您的全部可用气触发强制平仓！确定要死扛不平仓、直接等待推进吗？');
      if (!confirm) return;
    }

    this.soundManager.playClick();
    
    this.previousQi = qi;
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
    const finalScoreLabel = this.add.text(214, 260, `最终得分: ${finalScore.toFixed(1)}`, {
      fontSize: '24px',
      color: finalScore >= 0 ? '#2E7D32' : '#C62828',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(252);

    // 终局策略画像判定
    const totalBuys = this.turnManager.getTotalBuys();
    const totalSells = this.turnManager.getTotalSells();
    const totalWaits = this.turnManager.getTotalWaits();
    const totalLeverageBuys = this.turnManager.getTotalLeverageBuys();
    const marginCallCount = this.turnManager.getMarginCallCount();

    let profileName = '顺应自然型';
    let profileDesc = '因时而动，顺应乾坤。不强求杠杆暴利，亦不抱残守缺，在进退有度间体悟着五行流转、周而复始的自然商律。';

    if (marginCallCount >= 3) {
      profileName = '死扛爆仓型';
      profileDesc = '执念太深，疏于风控。因不愿及时平仓止损以致流动性几度断裂爆仓，最终在一声声强制平仓的警报中折戟天时。';
    } else if (totalLeverageBuys / Math.max(1, totalBuys) >= 0.7 && marginCallCount <= 2) {
      profileName = '高杠杆冒险型';
      profileDesc = '大开大合，气势如虹。深谙杠杆爆发之力，在惊涛骇浪中搏击高分，虽数度处于累卵之危，仍凭胆识攫得泼天富贵。';
    } else if (marginCallCount === 0 && totalLeverageBuys === 0 && totalBuys >= 12) {
      profileName = '稳健换仓型';
      profileDesc = '稳扎稳打，独善其身。坚守“不加杠杆”的绝对安全底线，通过高频普通牌周转来套取低风险微利，在商海中长青不倒。';
    } else if (totalBuys >= 15 && totalSells >= 15 && totalLeverageBuys > 0 && marginCallCount <= 1) {
      profileName = '顺势短打型';
      profileDesc = '见好就收，灵活调度。巧妙将杠杆的瞬间爆发力与快进快出的敏捷换仓相结合，在天时流转间敏锐腾挪。';
    } else if (totalWaits >= 25) {
      profileName = '蛰伏等待型';
      profileDesc = '静水流深，蛰伏待机。能忍人所不能忍之寒冬气耗，在无休止的打坐等待中蓄养精气，只为等待天时轮转时的致命一击。';
    }

    // 策略画像大字
    const profileTitle = this.add.text(214, 305, `【 策略画像：${profileName} 】`, {
      fontSize: '15px',
      color: '#8D6E63',
      fontFamily: 'Georgia, Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(252);

    // 画像评语，支持换行
    const profileDescLabel = this.add.text(214, 355, profileDesc, {
      fontSize: '12px',
      color: '#5D4037',
      fontFamily: 'Arial',
      align: 'center',
      wordWrap: { width: 300, useAdvancedWrap: true },
      lineSpacing: 4
    }).setOrigin(0.5).setDepth(252);

    // 构成描述 (位置下移并调整字号)
    const descText = this.add.text(214, 435, 
      `持仓收益: ${this.turnManager.getTotalHoldEarnings().toFixed(1)} ｜ 卖出收益: ${this.turnManager.getTotalSellEarnings().toFixed(1)}\n` + 
      `买入次数: ${this.turnManager.getTotalBuys()} 次 (杠杆 ${this.turnManager.getTotalLeverageBuys()} 次)\n` + 
      `卖出次数: ${this.turnManager.getTotalSells()} 次 ｜ 等待次数: ${this.turnManager.getTotalWaits()} 次\n` + 
      `爆仓次数: ${this.turnManager.getMarginCallCount()} 次\n\n` + 
      `六十天时已满，本局结束。`, {
      fontSize: '11px',
      color: '#8D6E63',
      fontFamily: 'Arial',
      align: 'center',
      lineSpacing: 4
    }).setOrigin(0.5).setDepth(252);

    // 按钮 Container
    const restartButton = this.createButton(214, 520, '再来一局', 0x4CAF50, () => {
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
      profileTitle.destroy();
      profileDescLabel.destroy();
      descText.destroy();
      restartButton.destroy();

      this.scene.restart();
    });
    restartButton.setDepth(252);
  }
}
