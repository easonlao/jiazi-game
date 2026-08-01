/**
 * 可注入随机源
 *
 * 默认使用 Math.random（行为与现状一致）；
 * 测试/模拟器可注入 SeededRandomSource 获得确定性序列（mulberry32）。
 * CardPoolManager / SeasonCycle 共用同一个实例，保证固定 seed 下对局可复现。
 */
export interface RandomSource {
  /** 返回 [0, 1) 均匀随机数 */
  next(): number;
  /** 返回 [min, maxExclusive) 整数 */
  int(min: number, maxExclusive: number): number;
}

/** 默认随机源：包装 Math.random */
export class MathRandomSource implements RandomSource {
  next(): number {
    return Math.random();
  }
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(Math.random() * (maxExclusive - min));
  }
}

/** 确定性随机源：mulberry32 */
export class SeededRandomSource implements RandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.next() * (maxExclusive - min));
  }
}
