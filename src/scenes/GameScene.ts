import Phaser from 'phaser';
import { TurnManager, GameState } from '../core/TurnManager';
import { JiaziCard } from '../core/JiaziCard';
import { HandSlot } from '../core/HandSlot';

/** 游戏主场景 */
export class GameScene extends Phaser.Scene {
  private turnManager!: TurnManager;

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

  // 状态
  private selectedPublicCard: number = -1;
  private selectedHandCard: number = -1;
  private leverageEnabled: boolean = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.turnManager = new TurnManager();

    // 创建 UI
    this.createBackground();
    this.createTopPanel();
    this.createQiBar();
    this.createPublicCardsArea();
    this.createHandArea();
    this.createButtonArea();
    this.createBottomInfo();

    // 设置回调
    this.turnManager.setOnStateChange((state: GameState) => {
      this.updateUI();
    });

    this.turnManager.setOnTurnStart((round: number) => {
      this.updateUI();
    });

    this.turnManager.setOnGameEnd((finalScore: number) => {
      this.showGameOver(finalScore);
    });

    // 初始化游戏
    this.initializeGame();
  }

  private async initializeGame(): Promise<void> {
    await this.turnManager.initialize();
    this.turnManager.startGame();
    this.updateUI();
  }

  /** 创建背景 */
  private createBackground(): void {
    this.add.rectangle(214, 380, 428, 760, 0xf5f0e8);
  }

  /** 创建顶部面板 */
  private createTopPanel(): void {
    // 顶部背景
    const topBg = this.add.rectangle(214, 40, 428, 80, 0xf5f0e8);
    topBg.setStrokeStyle(1, 0xd7ccc8);

    // 季节标签
    this.seasonLabel = this.add.text(214, 40, '春 (第1回合)', {
      fontSize: '20px',
      color: '#3E2723',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 分数标签
    this.scoreLabel = this.add.text(214, 70, '总分: 0', {
      fontSize: '16px',
      color: '#3E2723',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
  }

  /** 创建气条 */
  private createQiBar(): void {
    // 气条背景
    const qiBg = this.add.rectangle(214, 110, 400, 30, 0xe0e0e0);
    qiBg.setStrokeStyle(1, 0xbdbdbd);

    // 气条
    this.qiBar = this.add.graphics();
    this.updateQiBar(50, 80);

    // 气标签
    this.qiLabel = this.add.text(214, 110, '气: 50/80', {
      fontSize: '14px',
      color: '#3E2723',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
  }

  /** 更新气条 */
  private updateQiBar(qi: number, maxQi: number): void {
    this.qiBar.clear();

    // 背景
    this.qiBar.fillStyle(0xe0e0e0, 1);
    this.qiBar.fillRect(14, 95, 400, 30);

    // 填充
    const width = (qi / maxQi) * 400;
    let color = 0x4CAF50; // 绿色
    if (qi / maxQi < 0.3) {
      color = 0xE53935; // 红色
    } else if (qi / maxQi < 0.6) {
      color = 0xFFC107; // 黄色
    }

    this.qiBar.fillStyle(color, 1);
    this.qiBar.fillRect(14, 95, width, 30);
  }

  /** 创建公共牌区域 */
  private createPublicCardsArea(): void {
    // 区域背景
    const areaBg = this.add.rectangle(214, 260, 428, 240, 0xf5f0e8);
    areaBg.setStrokeStyle(1, 0xd7ccc8);

    // 标题
    this.add.text(214, 150, '公共牌池', {
      fontSize: '16px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 卡牌容器
    this.publicCardsContainer = this.add.container(214, 260);
  }

  /** 创建手牌区域 */
  private createHandArea(): void {
    // 区域背景
    const areaBg = this.add.rectangle(214, 490, 428, 220, 0xf5f0e8);
    areaBg.setStrokeStyle(1, 0xd7ccc8);

    // 标题
    this.add.text(214, 380, '我的手牌', {
      fontSize: '16px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 手牌容器
    this.handContainer = this.add.container(214, 490);
  }

  /** 创建按钮区域 */
  private createButtonArea(): void {
    // 买入按钮
    this.buyButton = this.createButton(107, 640, '买入', 0x2196F3, () => {
      this.onBuyClick();
    });

    // 杠杆按钮
    this.leverageButton = this.createButton(321, 640, '杠杆 1.0x', 0x9E9E9E, () => {
      this.onLeverageClick();
    });

    // 卖出按钮
    this.sellButton = this.createButton(107, 700, '卖出', 0xFF9800, () => {
      this.onSellClick();
    });

    // 等待按钮
    this.waitButton = this.createButton(321, 700, '等待', 0x4CAF50, () => {
      this.onWaitClick();
    });
  }

  /** 创建按钮 */
  private createButton(x: number, y: number, text: string, color: number, callback: () => void): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0, 0, 180, 40, color);
    bg.setStrokeStyle(2, 0xffffff);

    const label = this.add.text(0, 0, text, {
      fontSize: '16px',
      color: '#ffffff',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, label]);
    container.setSize(180, 40);
    container.setInteractive();

    container.on('pointerdown', callback);

    return container;
  }

  /** 创建底部信息 */
  private createBottomInfo(): void {
    this.bottomInfo = this.add.text(214, 745, '牌堆剩余: 60张 | 杠杆: 1.0x', {
      fontSize: '12px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);
  }

  /** 更新 UI */
  private updateUI(): void {
    const season = this.turnManager.getCurrentSeason();
    const round = this.turnManager.getCurrentRound();
    const qi = this.turnManager.getQi();
    const score = this.turnManager.getScore();
    const deckSize = this.turnManager.getDeckSize();
    const leverage = this.turnManager.getLeverageMultiplier();

    // 更新季节标签
    const seasonNames: Record<string, string> = {
      spring: '🌸 春',
      summer: '☀️ 夏',
      autumn: '🍂 秋',
      winter: '❄️ 冬',
    };
    this.seasonLabel.setText(`${seasonNames[season]} (第${round}回合)`);

    // 更新分数
    this.scoreLabel.setText(`总分: ${score.toFixed(1)}`);

    // 更新气条
    this.updateQiBar(qi, 80);
    this.qiLabel.setText(`气: ${qi}/80`);

    // 更新底部信息
    this.bottomInfo.setText(`牌堆剩余: ${deckSize}张 | 杠杆: ${leverage}x`);

    // 更新公共牌
    this.updatePublicCards();

    // 更新手牌
    this.updateHandCards();

    // 更新按钮状态
    this.updateButtons();
  }

  /** 更新公共牌显示 */
  private updatePublicCards(): void {
    this.publicCardsContainer.removeAll(true);

    const publicCards = this.turnManager.getPublicCards();
    const cardWidth = 160;
    const cardHeight = 200;
    const spacing = 20;
    const startX = -((publicCards.length - 1) * (cardWidth + spacing)) / 2;

    publicCards.forEach((card, index) => {
      const x = startX + index * (cardWidth + spacing);
      const cardSprite = this.createCardSprite(card, x, 0, cardWidth, cardHeight, false);

      cardSprite.setInteractive();
      cardSprite.on('pointerdown', () => {
        this.selectedPublicCard = index;
        this.updateUI();
      });

      if (this.selectedPublicCard === index) {
        // 高亮选中
        const highlight = this.add.rectangle(x, 0, cardWidth, cardHeight);
        highlight.setStrokeStyle(3, 0xFF6F00);
        this.publicCardsContainer.add(highlight);
      }

      this.publicCardsContainer.add(cardSprite);
    });
  }

  /** 更新手牌显示 */
  private updateHandCards(): void {
    this.handContainer.removeAll(true);

    const hand = this.turnManager.getHand();
    const cardWidth = 120;
    const cardHeight = 160;
    const spacing = 10;
    const startX = -((hand.length - 1) * (cardWidth + spacing)) / 2;

    hand.forEach((slot, index) => {
      const x = startX + index * (cardWidth + spacing);

      if (slot) {
        const cardSprite = this.createCardSprite(slot.card, x, 0, cardWidth, cardHeight, true);

        cardSprite.setInteractive();
        cardSprite.on('pointerdown', () => {
          this.selectedHandCard = index;
          this.updateUI();
        });

        if (this.selectedHandCard === index) {
          // 高亮选中
          const highlight = this.add.rectangle(x, 0, cardWidth, cardHeight);
          highlight.setStrokeStyle(3, 0xFF6F00);
          this.handContainer.add(highlight);
        }

        this.handContainer.add(cardSprite);
      } else {
        // 空位
        const emptySlot = this.add.rectangle(x, 0, cardWidth, cardHeight);
        emptySlot.setStrokeStyle(2, 0xbdbdbd, 0.5);
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

  /** 创建卡牌精灵 */
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

    // 背景
    const bg = this.add.rectangle(x, y, width, height, bgColor);
    bg.setStrokeStyle(2, 0xd7ccc8);

    // 卡牌名
    const nameLabel = this.add.text(x, y - 60, card.name, {
      fontSize: '18px',
      color: '#3E2723',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 元素
    const elementNames: Record<string, string> = {
      wood: '木',
      fire: '火',
      earth: '土',
      metal: '金',
      water: '水',
    };
    const elementLabel = this.add.text(x, y - 30, elementNames[card.mainElement], {
      fontSize: '14px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 评分
    const score = card.getSeasonScore(this.turnManager.getCurrentSeason());
    const scoreLabel = this.add.text(x, y, `${score.toFixed(1)}`, {
      fontSize: '16px',
      color: score >= 0 ? '#4CAF50' : '#E53935',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [bg, nameLabel, elementLabel, scoreLabel]);
    container.setPosition(x, y);

    return container;
  }

  /** 更新按钮状态 */
  private updateButtons(): void {
    const state = this.turnManager.getState();
    const canBuy = state === 'player_action' && this.turnManager.getHand().length < 3;
    const canSell = state === 'player_action' && this.turnManager.getHand().some(slot => slot !== null);

    // 买入按钮
    this.buyButton.setAlpha(canBuy ? 1 : 0.5);

    // 卖出按钮
    this.sellButton.setAlpha(canSell ? 1 : 0.5);

    // 杠杆按钮
    const leverage = this.turnManager.getLeverageMultiplier();
    const leverageButton = this.leverageButton.getAt(0) as Phaser.GameObjects.Rectangle;
    const leverageLabel = this.leverageButton.getAt(1) as Phaser.GameObjects.Text;

    if (leverage > 1) {
      leverageLabel.setText(`杠杆 ${leverage}x`);
      leverageButton.setFillStyle(this.leverageEnabled ? 0xFF6F00 : 0x9E9E9E);
    } else {
      leverageLabel.setText('杠杆 1.0x');
      leverageButton.setFillStyle(0x9E9E9E);
    }
  }

  /** 买入按钮点击 */
  private onBuyClick(): void {
    if (this.selectedPublicCard === -1) return;

    const success = this.turnManager.executeBuy(this.selectedPublicCard, this.leverageEnabled);
    if (success) {
      this.selectedPublicCard = -1;
      this.leverageEnabled = false;
      this.updateUI();
    }
  }

  /** 杠杆按钮点击 */
  private onLeverageClick(): void {
    const leverage = this.turnManager.getLeverageMultiplier();
    if (leverage > 1) {
      this.leverageEnabled = !this.leverageEnabled;
      this.updateUI();
    }
  }

  /** 卖出按钮点击 */
  private onSellClick(): void {
    if (this.selectedHandCard === -1) return;

    const success = this.turnManager.executeSell(this.selectedHandCard);
    if (success) {
      this.selectedHandCard = -1;
      this.updateUI();
    }
  }

  /** 等待按钮点击 */
  private onWaitClick(): void {
    this.turnManager.executeWait();
    this.selectedPublicCard = -1;
    this.selectedHandCard = -1;
    this.leverageEnabled = false;
    this.updateUI();
  }

  /** 显示游戏结束 */
  private showGameOver(finalScore: number): void {
    // 创建遮罩
    const mask = this.add.rectangle(214, 380, 428, 760, 0x000000, 0.7);
    mask.setInteractive();

    // 游戏结束面板
    const panelBg = this.add.rectangle(214, 380, 350, 400, 0xffffff);
    panelBg.setStrokeStyle(3, 0x3E2723);

    // 标题
    this.add.text(214, 220, '🏆 游戏结束 🏆', {
      fontSize: '28px',
      color: '#3E2723',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 最终得分
    this.add.text(214, 280, `最终得分: ${finalScore.toFixed(1)}`, {
      fontSize: '24px',
      color: finalScore >= 0 ? '#4CAF50' : '#E53935',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 得分构成
    this.add.text(214, 340, `持仓收益: ${this.turnManager.getScore().toFixed(1)}`, {
      fontSize: '16px',
      color: '#795548',
      fontFamily: 'Arial',
    }).setOrigin(0.5);

    // 再来一局按钮
    const restartButton = this.createButton(214, 450, '再来一局', 0x4CAF50, () => {
      this.turnManager.reset();
      this.selectedPublicCard = -1;
      this.selectedHandCard = -1;
      this.leverageEnabled = false;
      this.updateUI();
      mask.destroy();
      panelBg.destroy();
      this.scene.restart();
    });
  }
}
