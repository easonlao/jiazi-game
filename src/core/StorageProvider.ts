/**
 * 平台无关的键值持久化接口。
 *
 * core 层不应直接依赖浏览器 localStorage（微信小游戏等平台没有该 API）。
 * 需要持久化的服务（GameSaveService / LeaderboardService）通过构造函数注入
 * StorageProvider；app 平台传入 LocalStorage 实现（见 app/src/platform/）。
 */
export interface StorageProvider {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
