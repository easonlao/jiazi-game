/**
 * 本地排行榜服务。
 *
 * 将游戏完成记录存入持久化存储，按分数降序排列，最多保留 MAX_ENTRIES 条。
 * 与 GameSaveService 一样只负责序列化持久化，不关心游戏状态机。
 * 存储介质通过构造注入 StorageProvider（平台无关），未注入时回退浏览器 localStorage。
 */

import type { StorageProvider } from './StorageProvider';

export interface LeaderboardEntry {
  score: number;
  date: string; // ISO 日期字符串
}

const LEADERBOARD_KEY = 'jiazi_leaderboard';
const MAX_ENTRIES = 10;

export class LeaderboardService {
  private readonly storage: StorageProvider;

  /**
   * @param provider 存储实现；省略时回退浏览器 localStorage（web 平台）
   */
  constructor(provider?: StorageProvider) {
    this.storage = provider ?? (globalThis as { localStorage?: StorageProvider }).localStorage!;
  }

  /**
   * 读取所有排行榜记录，按分数降序排列。
   */
  getEntries(): LeaderboardEntry[] {
    try {
      const raw = this.storage.getItem(LEADERBOARD_KEY);
      if (!raw) return [];
      const entries = JSON.parse(raw) as LeaderboardEntry[];
      return entries.sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES);
    } catch {
      console.warn('[LeaderboardService] 读取排行榜失败');
      return [];
    }
  }

  /**
   * 添加一条新记录，自动排序并截断。
   */
  addEntry(score: number): void {
    try {
      const entries = this.getEntries();
      entries.push({
        score: Math.round(score * 10) / 10,
        date: new Date().toISOString().slice(0, 10),
      });
      entries.sort((a, b) => b.score - a.score);
      this.storage.setItem(LEADERBOARD_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch (e) {
      console.warn('[LeaderboardService] 写入排行榜失败:', e);
    }
  }

  /**
   * 清除所有排行榜记录。
   */
  clear(): void {
    this.storage.removeItem(LEADERBOARD_KEY);
  }
}