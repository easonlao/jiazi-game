# Web H5 平台适配指南

本文档记录 Web H5 平台（移动端浏览器、微信 H5）的技术要求和配置规范。

---

## 一、移动端浏览器适配

### 1.1 视口配置

```html
<!-- index.html -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

**参数说明**：
- `width=device-width`：宽度等于设备宽度
- `initial-scale=1.0`：初始缩放比例
- `maximum-scale=1.0`：禁止缩放（游戏类推荐）
- `user-scalable=no`：禁止用户缩放
- `viewport-fit=cover`：适配 iPhone X 刘海屏

### 1.2 全屏适配

```css
/* 禁止选中文本 */
* {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

/* 禁止长按菜单 */
* {
  -webkit-touch-callout: none;
}

/* 全屏布局 */
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #1a1a2e;
}

#game-container {
  width: 100%;
  height: 100%;
}
```

### 1.3 安全区域适配

```css
/* iPhone X 及以上机型安全区域 */
.safe-area-top {
  padding-top: env(safe-area-inset-top);
}

.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}

/* 横屏模式 */
@media (orientation: landscape) {
  .safe-area-left {
    padding-left: env(safe-area-inset-left);
  }
  .safe-area-right {
    padding-right: env(safe-area-inset-right);
  }
}
```

---

## 二、Phaser 缩放配置

### 2.1 响应式缩放

```typescript
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  scale: {
    mode: Phaser.Scale.FIT,        // 保持宽高比，适配屏幕
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 428,                     // 设计宽度
    height: 760                     // 设计高度
  }
};
```

### 2.2 缩放模式对比

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `FIT` | 保持比例，可能有黑边 | ✅ 推荐：卡牌游戏 |
| `ENVELOP` | 填满屏幕，可能裁剪 | 全屏游戏 |
| `WIDTH_CONTROLS_HEIGHT` | 宽度固定，高度自适应 | 竖屏游戏 |
| `HEIGHT_CONTROLS_WIDTH` | 高度固定，宽度自适应 | 横屏游戏 |
| `RESIZE` | 动态调整游戏尺寸 | 复杂响应式需求 |

### 2.3 屏幕方向锁定

```typescript
// 强制横屏
Phaser.Display.MotionLock.lock('landscape');

// 强制竖屏
Phaser.Display.MotionLock.lock('portrait');

// 或使用 CSS
/* 仅竖屏 */
@media (orientation: landscape) {
  body {
    transform: rotate(90deg);
    transform-origin: left top;
    width: 100vh;
    height: 100vw;
    overflow: hidden;
    position: absolute;
    top: 100%;
    left: 0;
  }
}
```

### 2.4 横屏提示

```typescript
// 检测屏幕方向
class OrientationManager {
  private static createPortraitWarning(scene: Phaser.Scene) {
    const warning = scene.add.text(
      scene.cameras.main.centerX,
      scene.cameras.main.centerY,
      '请旋转设备以获得最佳体验',
      { fontSize: '24px', color: '#ffffff' }
    );
    warning.setScrollFactor(0);
    warning.setDepth(1000);
    return warning;
  }
  
  static checkOrientation(scene: Phaser.Scene) {
    const showWarning = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      if (isPortrait) {
        // 显示提示
        this.createPortraitWarning(scene);
      }
    };
    
    window.addEventListener('resize', showWarning);
    showWarning();
  }
}
```

---

## 三、触摸事件适配

### 3.1 禁用默认行为

```typescript
// 禁止页面滚动
document.body.style.overflow = 'hidden';

// 禁止默认触摸行为
document.addEventListener('touchstart', (e) => {
  e.preventDefault();
}, { passive: false });

// 禁止双击缩放
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) {
    e.preventDefault();
  }
  lastTouchEnd = now;
}, false);
```

### 3.2 触摸区域大小

**最小触摸目标：44x44 像素**

```typescript
// 确保按钮足够大
class Button extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, text: string) {
    super(scene, x, y);
    
    // 背景最小 44x44
    const bg = scene.add.rectangle(0, 0, Math.max(44, 100), 44, 0x6666ff);
    bg.setInteractive();
    this.add(bg);
    
    // 扩大点击区域
    bg.input.hitArea = new Phaser.Geom.Rectangle(-50, -22, 100, 44);
  }
}
```

### 3.3 触摸反馈

```typescript
// 触摸按下时缩小
button.on('pointerdown', () => {
  button.setScale(0.95);
});

button.on('pointerup', () => {
  button.setScale(1);
});

button.on('pointerout', () => {
  button.setScale(1);
});
```

---

## 四、音频适配

### 4.1 自动播放限制

现代浏览器**禁止**无用户交互的音频自动播放。

```typescript
// ✅ 正确：用户点击后播放
startButton.on('pointerdown', () => {
  this.sound.play('bgm', { loop: true });
  this.scene.start('GameScene');
});

// ❌ 错误：直接播放
this.sound.play('bgm');  // 可能被阻止
```

### 4.2 音频解锁

```typescript
// 首次用户交互时解锁音频
class AudioUnlocker {
  private static unlocked = false;
  
  static unlock(scene: Phaser.Scene) {
    if (this.unlocked) return;
    
    // 播放一个静音音频来解锁
    if (scene.sound.locked) {
      scene.sound.unlock();
    }
    
    this.unlocked = true;
  }
}

// 在首次点击时调用
document.addEventListener('click', () => AudioUnlocker.unlock(scene), { once: true });
document.addEventListener('touchstart', () => AudioUnlocker.unlock(scene), { once: true });
```

### 4.3 音频格式兼容

```typescript
// 优先使用 MP3，兼容性最好
this.load.audio('bgm', [
  'assets/audio/bgm.mp3',
  'assets/audio/bgm.ogg',
  'assets/audio/bgm.m4a'
]);

// 检测音频支持
const audio = document.createElement('audio');
const canPlayMP3 = audio.canPlayType('audio/mpeg') !== '';
const canPlayOGG = audio.canPlayType('audio/ogg') !== '';
const canPlayM4A = audio.canPlayType('audio/mp4') !== '';
```

---

## 五、性能优化

### 5.1 资源压缩

```typescript
// 使用压缩纹理
this.load.image('card', 'assets/images/card.webp');

// 或使用纹理图集
this.load.atlas('cards', 'assets/cards.webp', 'assets/cards.json');
```

### 5.2 懒加载

```typescript
// 分场景加载资源
class PreloadScene extends Phaser.Scene {
  preload() {
    // 只加载首屏需要的资源
    this.load.image('logo', 'logo.png');
    this.load.image('start-btn', 'start-btn.png');
  }
  
  create() {
    this.scene.start('MenuScene');
  }
}

class GameScene extends Phaser.Scene {
  preload() {
    // 游戏场景资源
    this.load.atlas('cards', 'cards.webp', 'cards.json');
  }
}
```

### 5.3 对象池

```typescript
// 复用游戏对象，避免频繁创建/销毁
class CardPool {
  private pool: Phaser.GameObjects.Sprite[] = [];
  
  get(x: number, y: number, texture: string): Phaser.GameObjects.Sprite {
    let card = this.pool.pop();
    if (card) {
      card.setTexture(texture);
      card.setPosition(x, y);
      card.setActive(true);
      card.setVisible(true);
    } else {
      card = this.scene.add.sprite(x, y, texture);
    }
    return card;
  }
  
  release(card: Phaser.GameObjects.Sprite) {
    card.setActive(false);
    card.setVisible(false);
    this.pool.push(card);
  }
}
```

### 5.4 降低渲染压力

```typescript
// 关闭不必要的渲染
gameObject.setRenderFlags(0);  // 完全不渲染

// 减少渲染分辨率（低端设备）
this.game.config.renderPixelRatio = 0.5;

// 限制最大纹理尺寸
const maxTextureSize = this.game.renderer.getMaxTextureSize();
if (maxTextureSize < 2048) {
  // 使用更小的纹理
}
```

---

## 六、微信 H5 特殊处理

### 6.1 JSSDK 配置

```html
<!-- 引入微信 JSSDK -->
<script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
```

```javascript
// 配置 JSSDK
wx.config({
  debug: false,
  appId: 'wx1234567890abcdef',
  timestamp: 1234567890,
  nonceStr: 'randomstring',
  signature: 'signature',
  jsApiList: [
    'updateAppMessageShareData',
    'updateTimelineShareData',
    'hideMenuItems'
  ]
});

// 自定义分享
wx.ready(function() {
  wx.updateAppMessageShareData({
    title: '甲子纪 - 传统文化策略卡牌',
    desc: '在六十甲子的世界中，体验独特的交易与策略',
    link: 'https://your-domain.com/jiazi-game/',
    imgUrl: 'https://your-domain.com/jiazi-game/share.png',
    success: function() {}
  });
});
```

### 6.2 隐藏菜单项

```javascript
wx.hideMenuItems({
  menuList: [
    'menuItem:copyUrl',
    'menuItem:openWithQQ',
    'menuItem:openWithSafari'
  ]
});
```

### 6.3 微信支付

```javascript
// 调用微信 H5 支付（需要商户配置）
function wechatPay(orderId: string) {
  fetch('/api/pay/create', {
    method: 'POST',
    body: JSON.stringify({ orderId })
  })
  .then(res => res.json())
  .then(data => {
    // 跳转到微信支付页面
    window.location.href = data.mweb_url;
  });
}
```

---

## 七、浏览器兼容性

### 7.1 特性检测

```typescript
// WebGL 支持
const hasWebGL = (() => {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (e) {
    return false;
  }
})();

// Web Audio 支持
const hasWebAudio = 'AudioContext' in window || 'webkitAudioContext' in window;

// 如果不支持 WebGL，回退到 Canvas
const config = {
  type: hasWebGL ? Phaser.AUTO : Phaser.CANVAS
};
```

### 7.2 Polyfills

```html
<!-- 兼容旧浏览器 -->
<script src="https://polyfill.io/v3/polyfill.min.js?features=es6,Object.assign,Array.prototype.includes"></script>
```

### 7.3 iOS 特殊处理

```typescript
// iOS 音频上下文解锁
function unlockAudioContext(audioContext: AudioContext) {
  if (audioContext.state === 'suspended') {
    const unlock = () => {
      audioContext.resume().then(() => {
        document.body.removeEventListener('touchstart', unlock);
        document.body.removeEventListener('touchend', unlock);
      });
    };
    document.body.addEventListener('touchstart', unlock, false);
    document.body.addEventListener('touchend', unlock, false);
  }
}
```

---

## 八、调试工具

### 8.1 移动端调试

```html
<!-- vConsole 调试工具 -->
<script src="https://unpkg.com/vconsole/dist/vconsole.min.js"></script>
<script>
  if (location.hostname !== 'your-production-domain.com') {
    new VConsole();
  }
</script>
```

### 8.2 性能监控

```typescript
// Phaser 内置 FPS 显示
this.game.showDebugHeader = true;  // 或在 config 中设置

// 自定义性能监控
class PerformanceMonitor {
  private fps: number = 0;
  private memory: number = 0;
  
  update() {
    this.fps = Math.round(this.game.loop.actualFps);
    
    // Chrome 内存 API（仅 Chrome）
    if ('memory' in performance) {
      this.memory = (performance as any).memory.usedJSHeapSize / 1024 / 1024;
    }
  }
  
  render(graphics: Phaser.GameObjects.Graphics) {
    graphics.clear();
    graphics.fillStyle(0x000000, 0.7);
    graphics.fillRect(10, 10, 150, 50);
    
    graphics.fillStyle(0xffffff);
    graphics.fillText(`FPS: ${this.fps}`, 20, 30);
    graphics.fillText(`Memory: ${this.memory.toFixed(1)} MB`, 20, 50);
  }
}
```

---

## 九、发布检查清单

- [ ] 视口配置正确
- [ ] 全屏布局无滚动
- [ ] 安全区域已适配
- [ ] 触摸事件测试通过
- [ ] 音频自动播放已处理
- [ ] 横竖屏提示已添加
- [ ] 微信分享已配置（如需要）
- [ ] iOS 特殊处理已完成
- [ ] 低端设备测试通过
- [ ] 真机调试完成

---

## 十、相关文档

- [微信小游戏平台适配](./mini-program.md)
- [Phaser 微信小游戏适配](./weapp-phaser-adapter.md)
