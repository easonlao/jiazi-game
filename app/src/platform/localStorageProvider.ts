/**
 * 浏览器 localStorage 的 StorageProvider 实现（web 平台）。
 *
 * 微信小游戏等平台没有 localStorage，接入时在此目录提供对应实现并注入。
 */
import type { StorageProvider } from '@core/index';

export const localStorageProvider: StorageProvider = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
};
