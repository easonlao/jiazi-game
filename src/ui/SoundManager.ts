/**
 * 国风音效合成器 (Web Audio API)
 * 
 * 纯代码音频合成方案，利用浏览器自带的 Web Audio API 合成具有东方神韵的传统五声乐器音色：
 * - 碧玉撞击声 (点击/选中卡牌)
 * - 琴瑟弦乐上扬声 (买入卡牌)
 * - 金石编钟回音 (卖出卡牌/得分)
 * - 鼙鼓低鸣声 (爆仓警告)
 * - 古笙长泛音 (季节更替)
 * 
 * 完美免去外部大体积音频资源的依赖，做到无延迟加载且在 Node/测试环境下自动静音安全运行。
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private isSupported: boolean;

  constructor() {
    // 兼容 Node.js 等无 DOM 浏览器环境（防测试报错）
    this.isSupported = typeof window !== 'undefined' && 
      (window.AudioContext !== undefined || (window as any).webkitAudioContext !== undefined);
  }

  /**
   * 初始化音频上下文
   */
  private initContext(): void {
    if (!this.isSupported) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * 播放清脆的“碧玉敲击”声（用于界面点击与卡牌选中）
   */
  playClick(): void {
    if (!this.isSupported) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine'; // 纯净的正弦波
      osc.frequency.setValueAtTime(880, now); // 高音 A5，宛如古琴玉撞击
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.04); // 极速上抛泛音

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.12);
    } catch (e) {
      console.warn('[SoundManager] click sound failed:', e);
    }
  }

  /**
   * 播放丝竹琴音上扬的“买入卡牌”声（琴音）
   */
  playBuy(): void {
    if (!this.isSupported) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle'; // 三角波音色柔和，模拟琴瑟弹拨
      osc.frequency.setValueAtTime(440, now); // 起音 A4
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.25); // 滑音上扬至 A5

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn('[SoundManager] buy sound failed:', e);
    }
  }

  /**
   * 播放双音和声“金石编钟”声（用于卖出结算与金钱变动）
   */
  playSell(): void {
    if (!this.isSupported) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      // 融合国风五声中的“羽”与“宫”（E5 与 G5），产生钟磬双音共振回响
      const chimeFreqs = [659.25, 783.99];

      chimeFreqs.forEach(freq => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6); // 较长的钟鸣余音

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(now);
        osc.stop(now + 0.6);
      });
    } catch (e) {
      console.warn('[SoundManager] sell sound failed:', e);
    }
  }

  /**
   * 播放低沉沉闷的“鼙鼓预警”声（用于气归零爆仓强平）
   */
  playMarginCall(): void {
    if (!this.isSupported) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth'; // 锯齿波高频饱满，模拟鼓面沉重拍击
      osc.frequency.setValueAtTime(98, now); // 低音 G2
      osc.frequency.linearRampToValueAtTime(49, now + 0.4); // 快速下滑衰减

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {
      console.warn('[SoundManager] warning sound failed:', e);
    }
  }

  /**
   * 播放悠扬绵延的“古笙琶音”声（用于春去夏来等季节交替提示）
   */
  playSeasonChange(): void {
    if (!this.isSupported) return;
    try {
      this.initContext();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      // 国风五声音阶上行琶音: 宫(C5) -> 商(D5) -> 角(E5) -> 徵(G5) -> 羽(A5)
      const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.00];

      pentatonic.forEach((freq, index) => {
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();

        // 正弦波带轻微的泛音包络，类似竹管乐器笙笛
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + index * 0.08); // 依次琶音弹奏

        gain.gain.setValueAtTime(0, now + index * 0.08);
        gain.gain.linearRampToValueAtTime(0.08, now + index * 0.08 + 0.05); // 渐入
        gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.08 + 0.5); // 渐出

        osc.connect(gain);
        gain.connect(this.ctx!.destination);

        osc.start(now + index * 0.08);
        osc.stop(now + index * 0.08 + 0.5);
      });
    } catch (e) {
      console.warn('[SoundManager] season sound failed:', e);
    }
  }
}
