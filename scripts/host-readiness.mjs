import { createInterface } from 'node:readline';

export function createHostReadinessReader(stdout) {
  const startupOutput = [];
  const lines = createInterface({ input: stdout });
  let readyReceived = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  lines.on('line', (line) => {
    if (readyReceived) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      startupOutput.push(line);
      return;
    }
    if (message.type === 'ready') {
      readyReceived = true;
      resolveReady(message);
      return;
    }
    startupOutput.push(line);
  });

  return { ready, startupOutput, close: () => lines.close() };
}
