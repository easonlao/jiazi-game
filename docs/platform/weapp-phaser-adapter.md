# Phaser 微信小游戏适配指南

本文档记录 Phaser 3 游戏适配微信小游戏的技术方案和代码规范。

---

## 一、适配方案选择

### 官方适配器

微信官方提供了 Phaser 小游戏适配库：

```bash
# 安装适配器
npm install phaser-miniprogram-adapter --save
```

### 适配器原理

```
Web 环境                          微信小游戏环境
─────────                        ─────────────────
document.createElement()    →    wx.createCanvas()
window.requestAnimationFrame →    wx.requestAnimationFrame()
AudioContext                →    wx.createInnerAudioContext()
localStorage                →    wx.setStorageSync()
fetch()                     →    wx.request()
WebSocket                   →    wx.connectSocket()
```

---

## 二、项目配置

### 2.1 入口文件改造

```javascript
// game.js - 微信小游戏入口
const adapter = require('phaser-miniprogram-adapter');
const Phaser = require('phaser');

// 注入适配器
adapter.injectGlobals();

// 导入游戏代码
require('./src/main.js');
```

### 2.2 Phaser 配置调整

```typescript
// src/main.ts
import Phaser from 'phaser';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  
  // 微信小游戏使用微信提供的 canvas
  canvas: wx.createCanvas(),
  
  // 响应式尺寸
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 750,   // 设计宽度
    height: 1334  // 设计高度
  },
  
  // 渲染配置
  render: {
    pixelArt: false,
    antialias: true,
    roundPixels: true
  },
  
  // 输入配置
  input: {
    activePointers: 3,  // 支持多点触控
    touch: {
      target: undefined  // 使用适配器处理
    }
  },
  
  // 音频配置
  audio: {
    disableWebAudio: true  // 使用微信音频 API
  },
  
  // 场景
  scene: [GameScene]
};

new Phaser.Game(config);
```

---

## 三、资源加载适配

### 3.1 本地资源

```typescript
// 小游戏内本地资源
this.load.image('logo', 'assets/images/logo.png');
this.load.audio('bgm', 'assets/audio/bgm.mp3');
```

### 3.2 远程资源（CDN）

```typescript
// 必须使用 HTTPS 域名白名单
const CDN_BASE = 'https://cdn.your-domain.com/jiazi-game/';

// 加载远程资源
this.load.image('card-bg', CDN_BASE + 'assets/images/card-bg.png');
this.load.audio('bgm', CDN_BASE + 'assets/audio/bgm.mp3');

// 批量加载
this.load.atlas('cards', 
  CDN_BASE + 'assets/images/cards.png',
  CDN_BASE + 'assets/data/cards.json'
);
```

### 3.3 资源预加载

```typescript
// 预加载场景
class PreloadScene extends Phaser.Scene {
  preload() {
    // 显示加载进度
    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    
    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(250, 500, 300 * value, 30);
      
      // 显示百分比
      this.progressText.setText(Math.floor(value * 100) + '%');
    });
    
    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      this.scene.start('GameScene');
    });
    
    // 加载资源
    this.loadResources();
  }
  
  private loadResources() {
    const CDN = 'https://cdn.your-domain.com/jiazi-game/';
    
    // 卡牌资源
    this.load.atlas('cards', CDN + 'cards.png', CDN + 'cards.json');
    
    // 音频资源
    this.load.audio('buy', CDN + 'audio/buy.mp3');
    this.load.audio('sell', CDN + 'audio/sell.mp3');
    this.load.audio('season', CDN + 'audio/season.mp3');
  }
}
```

---

## 四、触摸事件处理

### 4.1 基本触摸

```typescript
// Phaser 统一使用 pointerdown/pointerup/pointermove
sprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
  // pointer 包含触摸信息
  console.log('触摸位置:', pointer.x, pointer.y);
  console.log('触摸ID:', pointer.id);  // 多点触控时区分
});

sprite.on('pointerup', () => {
  console.log('触摸结束');
});

sprite.on('pointermove', (pointer: Phaser.Input.Pointer) => {
  console.log('移动中');
});
```

### 4.2 多点触控

```typescript
// 配置输入
const config = {
  input: {
    activePointers: 3  // 支持最多 3 个触控点
  }
};

// 处理多点触控
this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
  if (pointer.id === 0) {
    // 第一个触控点
  } else if (pointer.id === 1) {
    // 第二个触控点（如缩放）
  }
});

// 双指缩放示例
let pointer1: Phaser.Input.Pointer | null = null;
let pointer2: Phaser.Input.Pointer | null = null;

this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
  if (pointer1 === null) {
    pointer1 = pointer;
  } else if (pointer2 === null) {
    pointer2 = pointer;
    startPinchZoom();
  }
});

this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
  if (pointer === pointer1) pointer1 = null;
  if (pointer === pointer2) pointer2 = null;
});
```

### 4.3 手势识别

```typescript
// 滑动检测
class SwipeDetector {
  private startX: number = 0;
  private startY: number = 0;
  private threshold: number = 50;
  
  constructor(private scene: Phaser.Scene, private onSwipe: (direction: string) => void) {
    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointerup', this.onPointerUp, this);
  }
  
  private onPointerDown(pointer: Phaser.Input.Pointer) {
    this.startX = pointer.x;
    this.startY = pointer.y;
  }
  
  private onPointerUp(pointer: Phaser.Input.Pointer) {
    const dx = pointer.x - this.startX;
    const dy = pointer.y - this.startY;
    
    if (Math.abs(dx) > this.threshold || Math.abs(dy) > this.threshold) {
      if (Math.abs(dx) > Math.abs(dy)) {
        this.onSwipe(dx > 0 ? 'right' : 'left');
      } else {
        this.onSwipe(dy > 0 ? 'down' : 'up');
      }
    }
  }
}
```

---

## 五、音频适配

### 5.1 微信音频 API

```typescript
// 创建音频实例
const bgm = wx.createInnerAudioContext();
bgm.src = 'https://cdn.your-domain.com/audio/bgm.mp3';
bgm.loop = true;
bgm.volume = 0.5;

// 播放控制
bgm.play();
bgm.pause();
bgm.stop();

// 监听事件
bgm.onPlay(() => console.log('开始播放'));
bgm.onEnded(() => console.log('播放结束'));
bgm.onError((err: any) => console.error('播放错误', err));

// 释放资源
bgm.destroy();
```

### 5.2 音效管理器

```typescript
class SoundManager {
  private sounds: Map<string, WechatMiniprogram.InnerAudioContext> = new Map();
  private musicEnabled: boolean = true;
  private sfxEnabled: boolean = true;
  
  load(name: string, url: string) {
    const audio = wx.createInnerAudioContext();
    audio.src = url;
    this.sounds.set(name, audio);
  }
  
  playMusic(name: string, loop: boolean = true) {
    if (!this.musicEnabled) return;
    
    const audio = this.sounds.get(name);
    if (audio) {
      audio.loop = loop;
      audio.play();
    }
  }
  
  playSfx(name: string) {
    if (!this.sfxEnabled) return;
    
    const audio = this.sounds.get(name);
    if (audio) {
      audio.stop();
      audio.play();
    }
  }
  
  setMusicEnabled(enabled: boolean) {
    this.musicEnabled = enabled;
    if (!enabled) {
      this.sounds.forEach(audio => {
        if (audio.loop) audio.pause();
      });
    }
  }
  
  destroy() {
    this.sounds.forEach(audio => audio.destroy());
    this.sounds.clear();
  }
}
```

### 5.3 用户交互后播放

```typescript
// 首次点击开始界面后播放背景音乐
startButton.on('pointerdown', () => {
  // 用户交互后才能播放音频
  soundManager.playMusic('bgm', true);
  
  // 进入游戏
  this.scene.start('GameScene');
});
```

---

## 六、存储适配

### 6.1 存档系统

```typescript
class SaveManager {
  private static STORAGE_KEY = 'jiazi_save';
  
  static save(data: GameSaveData): boolean {
    try {
      // 微信同步存储
      wx.setStorageSync(this.STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('存档失败:', e);
      return false;
    }
  }
  
  static load(): GameSaveData | null {
    try {
      const data = wx.getStorageSync(this.STORAGE_KEY);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.error('读档失败:', e);
      return null;
    }
  }
  
  static delete(): boolean {
    try {
      wx.removeStorageSync(this.STORAGE_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }
  
  static getStorageInfo() {
    const info = wx.getStorageInfoSync();
    return {
      keys: info.keys,
      currentSize: info.currentSize,
      limitSize: info.limitSize,
      remaining: info.limitSize - info.currentSize
    };
  }
}
```

### 6.2 云存档

```typescript
// 使用微信云开发
class CloudSaveManager {
  static async saveToCloud(data: GameSaveData): Promise<boolean> {
    try {
      await wx.cloud.init();
      const db = wx.cloud.database();
      await db.collection('saves').doc('user_save').set({
        data: {
          ...data,
          updateTime: db.serverDate()
        }
      });
      return true;
    } catch (e) {
      console.error('云存档失败:', e);
      return false;
    }
  }
  
  static async loadFromCloud(): Promise<GameSaveData | null> {
    try {
      await wx.cloud.init();
      const db = wx.cloud.database();
      const res = await db.collection('saves').doc('user_save').get();
      return res.data as GameSaveData;
    } catch (e) {
      console.error('云读档失败:', e);
      return null;
    }
  }
}
```

---

## 七、网络请求适配

### 7.1 HTTP 请求

```typescript
// 封装微信请求
class HttpClient {
  private static baseUrl = 'https://api.your-domain.com/v1/';
  
  static async get<T>(path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      wx.request({
        url: this.baseUrl + path,
        method: 'GET',
        success: (res) => resolve(res.data as T),
        fail: (err) => reject(err)
      });
    });
  }
  
  static async post<T>(path: string, data: any): Promise<T> {
    return new Promise((resolve, reject) => {
      wx.request({
        url: this.baseUrl + path,
        method: 'POST',
        data: data,
        header: {
          'content-type': 'application/json'
        },
        success: (res) => resolve(res.data as T),
        fail: (err) => reject(err)
      });
    });
  }
}
```

### 7.2 WebSocket

```typescript
// 微信 WebSocket
class SocketManager {
  private socket: WechatMiniprogram.SocketTask | null = null;
  
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = wx.connectSocket({
        url: url,
        protocols: []
      });
      
      this.socket.onOpen(() => {
        console.log('WebSocket 连接成功');
        resolve();
      });
      
      this.socket.onMessage((res) => {
        const data = JSON.parse(res.data as string);
        this.onMessage(data);
      });
      
      this.socket.onError((err) => {
        console.error('WebSocket 错误:', err);
        reject(err);
      });
      
      this.socket.onClose(() => {
        console.log('WebSocket 关闭');
      });
    });
  }
  
  send(data: any) {
    if (this.socket) {
      this.socket.send({
        data: JSON.stringify(data)
      });
    }
  }
  
  close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
  
  private onMessage(data: any) {
    // 处理消息
  }
}
```

---

## 八、平台差异处理

### 8.1 运行环境检测

```typescript
class Platform {
  static isWechatMiniProgram(): boolean {
    return typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function';
  }
  
  static isWeb(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }
  
  static getInfo() {
    if (this.isWechatMiniProgram()) {
      const info = wx.getSystemInfoSync();
      return {
        platform: 'wechat',
        model: info.model,
        pixelRatio: info.pixelRatio,
        windowWidth: info.windowWidth,
        windowHeight: info.windowHeight,
        system: info.system
      };
    }
    return {
      platform: 'web',
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight
    };
  }
}
```

### 8.2 条件加载

```typescript
// 根据平台加载不同资源
const CDN = Platform.isWechatMiniProgram() 
  ? 'https://cdn-for-wechat.com/'
  : 'https://cdn-for-web.com/';

this.load.image('card', CDN + 'card.png');
```

### 8.3 API 封装

```typescript
// 统一存储接口
class Storage {
  static set(key: string, value: any): void {
    if (Platform.isWechatMiniProgram()) {
      wx.setStorageSync(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }
  
  static get<T>(key: string): T | null {
    if (Platform.isWechatMiniProgram()) {
      return wx.getStorageSync(key) || null;
    }
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  }
  
  static remove(key: string): void {
    if (Platform.isWechatMiniProgram()) {
      wx.removeStorageSync(key);
    } else {
      localStorage.removeItem(key);
    }
  }
}
```

---

## 九、调试与性能

### 9.1 开发调试

```typescript
// 开发模式下开启调试
if (process.env.NODE_ENV === 'development') {
  wx.setEnableDebug({ enableDebug: true });
}

// 性能监控
const performance = wx.getPerformance();
const observer = performance.observe((entryList) => {
  console.log('性能指标:', entryList.getEntries());
});
```

### 9.2 内存监控

```typescript
// 获取内存信息
const memory = wx.getPerformance().memory;
console.log('已用内存:', memory.usedJSHeapSize);
console.log('内存限制:', memory.totalJSHeapSize);

// 内存警告
wx.onMemoryWarning((res) => {
  console.warn('内存警告:', res.level);
  // 清理缓存
  this.textures.removeUnused();
});
```

### 9.3 帧率监控

```typescript
class FPSMonitor {
  private fps: number = 0;
  private frames: number = 0;
  private lastTime: number = 0;
  
  update(time: number) {
    this.frames++;
    if (time - this.lastTime >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.lastTime = time;
      
      if (this.fps < 30) {
        console.warn('帧率过低:', this.fps);
      }
    }
  }
  
  getFPS(): number {
    return this.fps;
  }
}
```

---

## 十、发布检查清单

- [ ] 已安装 `phaser-miniprogram-adapter`
- [ ] 入口文件已改造为 `game.js`
- [ ] 资源已上传 CDN
- [ ] 域名已配置白名单
- [ ] 音频已适配微信 API
- [ ] 存储已使用微信 API
- [ ] 网络请求已使用 `wx.request`
- [ ] 触摸事件测试通过
- [ ] 内存占用 ≤ 300MB
- [ ] 帧率 ≥ 30FPS
- [ ] 真机测试通过

---

## 十一、相关文档

- [微信小游戏平台适配](./mini-program.md)
- [Web H5 平台适配](./web-h5.md)
- [微信小游戏官方文档](https://developers.weixin.qq.com/minigame/dev/guide/)
