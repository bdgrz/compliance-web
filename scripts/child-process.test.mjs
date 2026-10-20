import { spawn } from 'node:child_process';

import { expect, it } from 'vitest';

import { childExit, hasExited, stop } from './child-process.mjs';

it('recognizes a child that exited from a signal during cleanup', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });

  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));

  expect(child.signalCode).toBe('SIGTERM');
  expect(hasExited(child)).toBe(true);
  await expect(childExit(child)).resolves.toBe(128);
  await expect(stop(child, { command: 'shutdown' })).resolves.toBeUndefined();
});
