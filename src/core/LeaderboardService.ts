/**
 * 本地排行榜服务。
 *
 * 将游戏完成记录存入持久化存储，按分数降序排列，最多保留 MAX_ENTRIES 条。
 * 与 GameSaveService 一样只负责序列化持久化，不关心游戏状态机。
 * 存储介质通过构造注入 StorageProvider（平台无关），未注入时回退浏览器 localStorage。
 */

import type { StorageProvider } from './StorageProvider.ts';

export interface LeaderboardEntry {
  score: number;
  date: string; // ISO 日期字符串
  /** 分数所属规则版本；旧记录缺失时保留但不混入任何新版榜单。 */
  rulesVersion?: number;
  /** 分数所属平衡档案；支持按平衡档案严格隔离。 */
  balanceProfileId?: string;
}

const LEADERBOARD_KEY = 'jiazi_leaderboard';
const MAX_ENTRIES = 10;

export class LeaderboardService {
  private readonly storage: StorageProvider;
  private readonly rulesVersion: number;
  private readonly balanceProfileId?: string;

  /**
   * @param provider 存储实现；省略时回退浏览器 localStorage（web 平台）
   * @param rulesVersion 规则版本号
   * @param balanceProfileId 可选平衡档案 ID（若指定则仅筛选和记录该档案榜单）
   */
  constructor(provider?: StorageProvider, rulesVersion: number = 1, balanceProfileId?: string) {
    this.storage = provider ?? (globalThis as { localStorage?: StorageProvider }).localStorage!;
    this.rulesVersion = rulesVersion;
    this.balanceProfileId = balanceProfileId;
  }

  private readAll(): LeaderboardEntry[] {
    const raw = this.storage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is LeaderboardEntry => (
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as LeaderboardEntry).score === 'number' &&
      Number.isFinite((entry as LeaderboardEntry).score) &&
      typeof (entry as LeaderboardEntry).date === 'string' &&
      ((entry as LeaderboardEntry).rulesVersion === undefined ||
        Number.isInteger((entry as LeaderboardEntry).rulesVersion)) &&
      ((entry as LeaderboardEntry).balanceProfileId === undefined ||
        typeof (entry as LeaderboardEntry).balanceProfileId === 'string')
    ));
  }

  /**
   * 读取排行榜记录，按分数降序排列（隔离 rulesVersion 和 balanceProfileId）。
   */
  getEntries(): LeaderboardEntry[] {
    try {
      return this.readAll()
        .filter((entry) => {
          if (entry.rulesVersion !== this.rulesVersion) return false;
          if (this.balanceProfileId !== undefined) {
            return entry.balanceProfileId === this.balanceProfileId;
          }
          return true;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ENTRIES);
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
      const entries = this.readAll();
      entries.push({
        score: Math.round(score * 10) / 10,
        date: new Date().toISOString().slice(0, 10),
        rulesVersion: this.rulesVersion,
        balanceProfileId: this.balanceProfileId,
      });
      const groups = new Map<string, LeaderboardEntry[]>();
      for (const entry of entries) {
        const key = `${entry.rulesVersion ?? 'legacy'}_${entry.balanceProfileId ?? 'default'}`;
        const group = groups.get(key) ?? [];
        group.push(entry);
        groups.set(key, group);
      }
      const retained = [...groups.values()].flatMap((group) =>
        group.sort((a, b) => b.score - a.score).slice(0, MAX_ENTRIES),
      );
      this.storage.setItem(LEADERBOARD_KEY, JSON.stringify(retained));
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
