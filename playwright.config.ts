import { defineConfig } from '@playwright/test';

// ---------------------------------------------------------------------------
// E2E 目标构建切换（2026-08-04 新增）
//
// 默认：dev 构建（vite dev server, 端口 5173）——本地开发快速验证，改一行即刷。
// 设 E2E_TARGET=preview：打生产构建（app/dist）并起 preview 服务（端口 4173）
//   ——这是发布前的「生产版验证闸门」，确保线上实际跑的那份代码被真机玩过。
//
// 设计原则：dev / prod 行为必须一致，唯一允许的环境差异走配置/数据驱动，
// 严禁在功能逻辑里写 `if (import.meta.env.DEV)` 这类分支（见 AGENTS.md）。
// ---------------------------------------------------------------------------
const isPreview = process.env.E2E_TARGET === 'preview';

const webServer = isPreview
  ? {
      command: 'corepack pnpm run build && corepack pnpm exec vite preview --port 4173 --host',
      url: 'http://localhost:4173',
      baseURL: 'http://localhost:4173',
      timeout: 120_000,
    }
  : {
      command: 'corepack pnpm exec vite --port 5173 --host',
      url: 'http://localhost:5173',
      baseURL: 'http://localhost:5173',
      timeout: 120_000,
    };

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: webServer.baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: webServer.command,
    cwd: './app',
    url: webServer.url,
    reuseExistingServer: true,
    timeout: webServer.timeout,
  },
});
