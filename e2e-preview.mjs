import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test'],
  {
    env: { ...process.env, E2E_TARGET: 'preview' },
    stdio: 'inherit',
    shell: false,
  },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
