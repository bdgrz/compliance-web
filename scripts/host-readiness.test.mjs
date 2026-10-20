import { PassThrough } from 'node:stream';

import { expect, it } from 'vitest';

import { createHostReadinessReader } from './host-readiness.mjs';

it('keeps draining and discarding host stdout after readiness', async () => {
  const stdout = new PassThrough({ highWaterMark: 16 });
  const readiness = createHostReadinessReader(stdout);
  const readyMessage = {
    type: 'ready',
    apiBaseUri: 'http://127.0.0.1:50123',
    mailbox: { transport: 'unix', path: '/tmp/mailbox.sock' },
  };

  stdout.write('startup log line\n');
  stdout.write(`${JSON.stringify(readyMessage)}\n`);

  await expect(readiness.ready).resolves.toEqual(readyMessage);
  expect(readiness.startupOutput).toEqual(['startup log line']);

  for (let line = 0; line < 100; line += 1) {
    stdout.write(`request log ${line}\n`);
  }
  await new Promise((resolve) => setImmediate(resolve));

  expect(stdout.readableLength).toBe(0);
  expect(readiness.startupOutput).toEqual(['startup log line']);

  readiness.close();
  stdout.destroy();
});
