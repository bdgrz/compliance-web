import { setTimeout as delay } from 'node:timers/promises';

export function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export function childExit(child) {
  return new Promise((resolve) => {
    if (hasExited(child)) {
      resolve(child.exitCode ?? 128);
      return;
    }
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal === 'SIGINT' ? 130 : 128));
    });
  });
}

export async function stop(
  child,
  shutdownMessage,
  gracefulTimeoutMs = shutdownMessage ? 90_000 : 10_000,
  forcedTimeoutMs = 15_000
) {
  if (!child || hasExited(child)) return;

  if (shutdownMessage && child.stdin?.writable) {
    child.stdin.write(`${JSON.stringify(shutdownMessage)}\n`);
  }

  const exited = childExit(child);
  const completed = await Promise.race([
    exited.then(() => true),
    delay(gracefulTimeoutMs).then(() => false),
  ]);
  if (completed || hasExited(child)) return;

  child.kill('SIGTERM');
  await Promise.race([exited, delay(forcedTimeoutMs)]);
  if (!hasExited(child)) child.kill('SIGKILL');
}
