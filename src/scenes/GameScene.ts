import Phaser from 'phaser';
import { TurnManager, GameState, JiaziCard, HandSlot } from '../core';
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

  // 交互状态
  private selectedPublicCard: number = -1;
  private selectedHandCard: number = -1;
  private leverageEnabled: boolean = false;

  // 动画状态锁与数据记录
  private isAnimating: boolean = false;
  private lastSeason: string = '';
  private lastScore: number = 0;

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
        this.showToast('无有效存档');
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
  }

  /** 动态渐变重绘气血条 */
  private updateQiBar(qi: number, maxQi: number): void {
    this.qiBar.clear();

    // 槽底色
    this.qiBar.fillStyle(0xe0e0e0, 1);
    this.qiBar.fillRect(14, 95, 400, 30);

    // 填充色逻辑 (爆仓警告临界)
    const width = (qi / maxQi) * 400;
    let color = 0x4CAF50; // 丰盈常绿
    if (qi / maxQi < 0.3) {
      color = 0xE53935; // 枯绝赤红
    } else if (qi / maxQi < 0.6) {
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
    this.buyButton = this.createButton(107, 640, '买入', 0x2196F3, () => {
      this.onBuyClick();
    });

    // 杠杆倍速切换按钮
    this.leverageButton = this.createButton(321, 640, '杠杆 1.0x', 0x9E9E9E, () => {
      this.onLeverageClick();
    });

    // 卖出卡牌结算按钮
    this.sellButton = this.createButton(107, 700, '卖出', 0xFF9800, () => {
      this.onSellClick();
    });

    // 等待推进回合按钮
    this.waitButton = this.createButton(321, 700, '等待', 0x4CAF50, () => {
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

  /** 全局状态刷新与动效处理 */
  private updateUI(): void {
    const season = this.turnManager.getCurrentSeason();
    const round = this.turnManager.getCurrentRound();
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
    this.qiLabel.setText(`气: ${qi}/80`);

    // 5. 更新底部状态
    this.bottomInfo.setText(`牌堆剩余: ${deckSize}张 | 杠杆: ${leverage}x`);

    // 6. 更新区域卡牌重绘
    this.updatePublicCards();
    this.updateHandCards();

    // 7. 更新决策按钮状态限制
    this.updateButtons();
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
      const cardSprite = this.createCardSprite(card, x, targetY, cardWidth, cardHeight, false);

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
        const cardSprite = this.createCardSprite(slot.card, x, targetY, cardWidth, cardHeight, true);

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
    const flightObj = this.createCardSprite(card, originX, originY, 120, 160, false);
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

    const flightObj = this.createCardSprite(slot.card, originX, originY, 120, 160, true);
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
    showProfit: boolean
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

    // 当季评分得分
    const score = card.getSeasonScore(this.turnManager.getCurrentSeason());
    const scoreLabel = this.add.text(0, height / 2 - 38, `${score >= 0 ? '+' : ''}${score.toFixed(1)}`, {
      fontSize: width > 130 ? '20px' : '15px',
      color: score >= 0 ? '#2E7D32' : '#C62828',
      fontFamily: 'Arial',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, nameLabel, elementLabel, scoreLabel]);
    container.setSize(width, height);

    return container;
  }

  /** 状态驱动更新按钮状态与遮罩显示 */
  private updateButtons(): void {
    const state = this.turnManager.getState();
    const canBuy = state === 'player_action' && this.turnManager.getHand().some(slot => slot === null);
    const canSell = state === 'player_action' && this.turnManager.getHand().some(slot => slot !== null);

    // 买入按钮遮罩
    this.buyButton.setAlpha(canBuy ? 1 : 0.5);

    // 卖出按钮遮罩
    this.sellButton.setAlpha(canSell ? 1 : 0.5);

    // 杠杆数值显示与颜色
    const leverage = this.turnManager.getLeverageMultiplier();
    const leverageButton = this.leverageButton.getAt(0) as Phaser.GameObjects.Rectangle;
    const leverageLabel = this.leverageButton.getAt(1) as Phaser.GameObjects.Text;

    if (leverage > 1) {
      leverageLabel.setText(`杠杆 ${leverage}x`);
      leverageButton.setFillStyle(this.leverageEnabled ? 0xE65100 : 0x9E9E9E);
    } else {
      leverageLabel.setText('杠杆 1.0x');
      leverageButton.setFillStyle(0x9E9E9E);
    }
  }

  /** 执行卡牌购买及飞入槽位动画 */
  private onBuyClick(): void {
    if (this.selectedPublicCard === -1) return;
    if (this.isAnimating) return;

    const emptySlotIndex = this.turnManager.getHand().findIndex(slot => slot === null);
    if (emptySlotIndex === -1) {
      this.showToast('手牌已满');
      return;
    }

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
      } else {
        this.showToast('购买失败，气不足');
        this.updateUI();
      }
    });
  }

  /** 选择杠杆 */
  private onLeverageClick(): void {
    if (this.isAnimating) return;
    const leverage = this.turnManager.getLeverageMultiplier();
    if (leverage > 1) {
      this.soundManager.playClick();
      this.leverageEnabled = !this.leverageEnabled;
      this.updateUI();
    }
  }

  /** 卖出手牌及高抛飞逸动画 */
  private onSellClick(): void {
    if (this.selectedHandCard === -1) return;
    if (this.isAnimating) return;

    this.isAnimating = true;

    // 先高抛飞出，再扣气结算移除
    this.playSellFlightAnimation(this.selectedHandCard, () => {
      const success = this.turnManager.executeSell(this.selectedHandCard);
      this.isAnimating = false;

      if (success) {
        this.soundManager.playSell();
        this.selectedHandCard = -1;
        this.updateUI();
      } else {
        this.showToast('卖出失败，气不足');
        this.updateUI();
      }
    });
  }

  /** 等待动作 */
  private onWaitClick(): void {
    if (this.isAnimating) return;
    this.soundManager.playClick();
    
    this.turnManager.executeWait();
    this.selectedPublicCard = -1;
    this.selectedHandCard = -1;
    this.leverageEnabled = false;
    this.updateUI();
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
      `持仓总收益: ${this.turnManager.getScore().toFixed(1)}\n\n` + 
      `牌堆已抽空，本局结束。\n` + 
      `修身养气，周而复始。`, {
      fontSize: '15px',
      color: '#5D4037',
      fontFamily: 'Arial',
      align: 'center'
    }).setOrigin(0.5).setDepth(252);

    // 按钮 Container
    const restartButton = this.createButton(214, 460, '再来一局', 0x4CAF50, () => {
      this.soundManager.playClick();
      
      this.turnManager.reset();
      this.selectedPublicCard = -1;
      this.selectedHandCard = -1;
      this.leverageEnabled = false;
      
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
