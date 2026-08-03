/**
 * 导出平衡配置的 node 包装器（不依赖 npm PATH 里的 esbuild 二进制）。
 * 用法：node scripts/export-config.mjs
 * 作用：esbuild 打包 export-balance-config.ts 并执行，输出 balance_config.json。
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(__dirname, '.export-config.tmp.mjs');

await build({
  entryPoints: [resolve(__dirname, 'export-balance-config.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
});

try {
  execSync(`node "${outfile}"`, { stdio: 'inherit' });
} finally {
  rmSync(outfile, { force: true });
}
