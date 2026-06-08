# 微信小游戏平台适配指南

本文档记录微信小游戏的硬性技术要求和配置规范，所有 Agent 在开发时必须遵守。

---

## 一、包体大小限制

### 主包限制

| 限制项 | 限制值 | 说明 |
|--------|--------|------|
| **主包大小** | ≤ 4 MB | 首包下载，包含代码和必要资源 |
| **单个分包** | ≤ 2 MB | 每个分包的最大体积 |
| **所有分包总和** | ≤ 20 MB | 整个小游戏包体上限 |

### 应对策略

```
项目结构建议：
├── game.js              # 入口文件（最小化）
├── game.json            # 配置文件
├── project.config.json  # 项目配置
├── common/              # 公共代码（主包）
│   └── phaser.min.js    # Phaser 核心库
├── pages/               # 分包目录
│   ├── main/            # 主界面分包
│   └── game/            # 游戏场景分包
└── assets/              # 资源（CDN 托管）
    └── [远程加载]
```

### 资源 CDN 托管

**必须将大体积资源托管到 CDN**：

```javascript
// 使用远程资源加载
const CDN_BASE = 'https://your-cdn.domain.com/jiazi-game/';

// Phaser 加载配置
this.load.image('card-bg', CDN_BASE + 'assets/images/card-bg.png');
this.load.audio('bgm', CDN_BASE + 'assets/audio/bgm.mp3');
```

### 代码分包配置

```json
// game.json
{
  "deviceOrientation": "landscape",
  "showStatusBar": false,
  "networkTimeout": {
    "request": 30000,
    "downloadFile": 60000
  },
  "subpackages": [
    {
      "name": "game",
      "root": "pages/game/"
    },
    {
      "name": "ui",
      "root": "pages/ui/"
    }
  ]
}
```

---

## 二、域名与网络配置

### 域名白名单

**必须在微信公众平台配置以下域名类型**：

| 域名类型 | 用途 | 配置数量上限 |
|----------|------|--------------|
| **request 合法域名** | API 请求、资源下载 | 20 个 |
| **downloadFile 合法域名** | 文件下载 | 20 个 |
| **uploadFile 合法域名** | 文件上传 | 20 个 |
| **udp 合法域名** | UDP 通信 | 20 个 |
| **tcp 合法域名** | TCP 通信 | 20 个 |

### 配置步骤

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 开发管理 → 开发设置 → 服务器域名
3. 按类型添加域名

### HTTPS 强制要求

```javascript
// ✅ 正确：使用 HTTPS
const API_URL = 'https://api.example.com/v1/';

// ❌ 错误：HTTP 会被拒绝
const API_URL = 'http://api.example.com/v1/';  // 生产环境不可用
```

### 本地调试例外

```json
// project.config.json
{
  "setting": {
    "urlCheck": false  // 开发环境关闭域名校验，生产环境必须开启
  }
}
```

---

## 三、API 限制与替代方案

### 3.1 DOM API 不可用

微信小游戏没有 DOM 环境，以下 API 不可用：

| 禁用 API | 替代方案 |
|----------|----------|
| `document.getElementById()` | 使用 Phaser 游戏对象 |
| `document.createElement()` | 使用 Phaser 容器或渲染纹理 |
| `window.innerWidth/innerHeight` | `wx.getSystemInfoSync().windowWidth/Height` |
| `localStorage` | `wx.setStorageSync()` / `wx.getStorageSync()` |
| `fetch()` | `wx.request()` |
| `WebSocket` | `wx.connectSocket()` |
| `Audio` / `AudioContext` | `wx.createInnerAudioContext()` |

### 3.2 Canvas 与 WebGL 限制

```javascript
// 微信小游戏 Canvas 获取方式
const canvas = wx.createCanvas();
const ctx = canvas.getContext('webgl');  // 或 '2d'

// Phaser 适配器会自动处理
// 确保使用 phaser-miniprogram 或官方适配库
```

### 3.3 音频自动播放限制

微信小游戏**禁止**自动播放音频，必须用户交互后才能播放：

```javascript
// ❌ 错误：页面加载后直接播放
bgm.play();

// ✅ 正确：用户点击后播放
startButton.on('pointerdown', () => {
  bgm.play();
});
```

### 3.4 触摸事件适配

```javascript
// 微信小游戏使用触摸事件，无鼠标事件
// Phaser 适配器会转换，但需注意：

// ✅ 正确：使用 pointerdown（兼容触摸和鼠标）
sprite.on('pointerdown', callback);

// ❌ 避免：仅鼠标事件
sprite.on('mousedown', callback);  // 移动端无响应
```

---

## 四、存储限制

### 本地存储

| 存储类型 | 限制 | 说明 |
|----------|------|------|
| `wx.setStorageSync` | 单个 key 最大 1 MB | 同步存储 |
| `wx.setStorage` | 单个 key 最大 1 MB | 异步存储 |
| **总存储空间** | 10 MB | 所有数据总和 |

### 存储最佳实践

```javascript
// ✅ 正确：分离存储，避免单 key 过大
const saveGame = (data) => {
  wx.setStorageSync('jiazi_progress', data.progress);
  wx.setStorageSync('jiazi_settings', data.settings);
  wx.setStorageSync('jiazi_stats', data.stats);
};

// ❌ 避免：单个 key 存储所有数据
wx.setStorageSync('jiazi_all', JSON.stringify(allData));  // 可能超限
};

// 使用云存储
wx.cloud.init();
wx.cloud.database().collection('saves').add({
  data: { userId: 'xxx', progress: gameData }
});
```

---

## 五、性能要求

### 运行时性能指标

| 指标 | 要求 | 说明 |
|------|------|------|
| **帧率** | ≥ 30 FPS | 低端设备最低要求 |
| **目标帧率** | 60 FPS | 推荐目标 |
| **内存占用** | ≤ 300 MB | 安全区，避免闪退 |
| **首屏加载** | ≤ 3 秒 | 包含资源加载 |
| **CPU 占用** | ≤ 50% | 避免发热耗电 |

### 内存优化建议

```javascript
// 1. 及时销毁不用的纹理
this.textures.remove('unused-texture');

// 2. 使用纹理图集
this.load.atlas('cards', 'cards.png', 'cards.json');

// 3. 对象池复用
const pool = this.add.group({
  classType: Phaser.GameObjects.Sprite,
  maxSize: 50
});

// 4. 控制同时显示的对象数量
// 避免同时显示过多精灵
```

### 分帧加载

```javascript
// 分帧加载资源，避免卡顿
const loadQueue = ['asset1.png', 'asset2.png', 'asset3.png'];
let currentIndex = 0;

const loadNext = () => {
  if (currentIndex >= loadQueue.length) return;
  this.load.image(loadQueue[currentIndex], loadQueue[currentIndex]);
  this.load.once('complete', () => {
    currentIndex++;
    setTimeout(loadNext, 16);  // 下一帧继续
  });
  this.load.start();
};
```

---

## 六、审核要求

### 6.1 版号要求

| 情况 | 要求 |
|------|------|
| **内购付费** | 必须有游戏版号 |
| **广告变现** | 可无版号，但需备案 |
| **纯免费** | 可无版号，建议备案 |

### 6.2 内容合规

**禁止内容**：
- 涉政、涉黄、涉暴内容
- 真实货币赌博机制
- 用户生成内容（UGC）未审核
- 未授权的 IP 内容

**本游戏注意**：
- 甲子纪卡牌使用传统文化元素，无版权风险
- 确保无赌博相关术语（如"赌"、"下注"等）
- 分数系统使用"收益"而非"奖金"

### 6.3 隐私协议

**必须配置**：

1. 在 `game.json` 中声明：
```json
{
  "permission": {
    "scope.userLocation": {
      "desc": "您的位置信息将用于..."
    }
  }
}
```

2. 首次启动显示隐私协议弹窗

3. 收集用户数据前获得授权

### 6.4 实名认证

**涉及以下功能需要实名认证**：
- 内购支付
- 社交功能
- 排行榜

```javascript
// 调用微信实名认证
wx.getPhoneNumber({
  success: (res) => {
    // 获取加密手机号，发送到服务器解密
  }
});
```

---

## 七、发布流程

### 7.1 上传代码

```bash
# 使用微信开发者工具
# 或命令行工具

# 安装 miniprogram-ci
npm install miniprogram-ci --save-dev

# 上传代码
npx miniprogram-ci upload \
  --pp ./dist \
  --pkp ./private.key \
  --appid wx1234567890abcdef \
  -r 1 \
  --uv 1.0.0 \
  -c "首次发布"
```

### 7.2 配置文件清单

| 文件 | 必须 | 说明 |
|------|------|------|
| `game.json` | ✅ | 游戏配置 |
| `project.config.json` | ✅ | 项目配置 |
| `sitemap.json` | ✅ | 索引配置 |
| `game.js` | ✅ | 入口文件 |
| `private.key` | ✅ | 上传密钥（不提交到 Git） |

### 7.3 发布检查清单

- [ ] 包体大小 ≤ 4 MB（主包）
- [ ] 域名已配置白名单
- [ ] HTTPS 已启用
- [ ] 隐私协议已配置
- [ ] 实名认证已集成（如需要）
- [ ] 广告组件已配置（如需要）
- [ ] 测试账号已添加

---

## 八、调试技巧

### 开发者工具

```bash
# 下载微信开发者工具
# https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
```

### 真机调试

```javascript
// 开启调试模式
wx.setEnableDebug({
  enableDebug: true
});

// 查看性能面板
// 开发者工具 → 调试 → 性能监控
```

### 日志输出

```javascript
// 使用微信日志 API
wx.getLogManager().log('游戏日志信息');
wx.getLogManager().warn('警告信息');
wx.getLogManager().error('错误信息');
```

---

## 九、相关文档

- [微信小游戏官方文档](https://developers.weixin.qq.com/minigame/dev/guide/)
- [Phaser 微信小游戏适配](./weapp-phaser-adapter.md)
- [Web H5 平台适配](./web-h5.md)
