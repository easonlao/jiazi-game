import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  test: {
    // 只跑 jiazi-game 自己的测试，避免扫描到其他项目的配置文件/测试
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
