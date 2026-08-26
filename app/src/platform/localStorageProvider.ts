/**
 * 浏览器 localStorage 的 StorageProvider 实现（web 平台）。
 *
 * 微信小游戏等平台没有 localStorage，接入时在此目录提供对应实现并注入。
 */
import type { StorageProvider } from '@core/index';

function getLocalStorage(): StorageProvider {
  const storage = (globalThis as { localStorage?: StorageProvider }).localStorage;
  if (!storage) {
    throw new Error('localStorage is not available');
  }
  return storage;
}

export const localStorageProvider: StorageProvider = {
  getItem: (key) => getLocalStorage().getItem(key),
  setItem: (key, value) => getLocalStorage().setItem(key, value),
  removeItem: (key) => getLocalStorage().removeItem(key),
};
