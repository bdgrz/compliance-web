import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { childExit, hasExited, stop } from './child-process.mjs';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const hostProject = resolveHostProject();
const viteUrl = 'http://127.0.0.1:5173';

let host;
let vite;
let playwright;
let nugetPackages;

function resolveHostProject() {
  const configured = process.env.COMPLIANCE_E2E_HOST_PROJECT;
  const candidates = configured
    ? [path.resolve(projectRoot, configured)]
    : [
        path.resolve(
          projectRoot,
          '../compliance-core/tools/Compliance.BrowserE2EHost/Compliance.BrowserE2EHost.csproj'
        ),
        path.resolve(
          projectRoot,
          '../compliance-core-browser-e2e-bridge/tools/Compliance.BrowserE2EHost/Compliance.BrowserE2EHost.csproj'
        ),
      ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Browser E2E host not found. Set COMPLIANCE_E2E_HOST_PROJECT to its project file.'
    );
  }
  return found;
}

async function startBackendHost() {
  nugetPackages = await mkdtemp(
    path.join(os.tmpdir(), 'bdgrz-first-journey-nuget-')
  );
  const hostEnvironment = {
    ...process.env,
    NUGET_PACKAGES: nugetPackages,
  };
  const restore = spawn(
    'dotnet',
    ['restore', hostProject, '--locked-mode', '--packages', nugetPackages],
    {
      cwd: path.dirname(hostProject),
      env: hostEnvironment,
      stdio: 'inherit',
    }
  );
  const restoreExitCode = await new Promise((resolve, reject) => {
    restore.once('error', reject);
    childExit(restore).then(resolve);
  });
  if (restoreExitCode !== 0) {
    throw new Error(
      `The browser E2E host locked restore failed (${restoreExitCode}).`
    );
  }

  host = spawn(
    'dotnet',
    ['run', '--project', hostProject, '--no-launch-profile', '--no-restore'],
    {
      cwd: path.dirname(hostProject),
      env: hostEnvironment,
      stdio: ['pipe', 'pipe', 'inherit'],
    }
  );

  const ready = new Promise((resolve, reject) => {
    const startupOutput = [];
    const lines = createInterface({ input: host.stdout });
    const timer = setTimeout(
      () => {
        reject(
          new Error(
            'Timed out waiting for the browser E2E host readiness message.'
          )
        );
      },
      10 * 60 * 1000
    );

    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        startupOutput.push(line);
        return;
      }
      if (message.type !== 'ready') {
        startupOutput.push(line);
        return;
      }

      clearTimeout(timer);
      lines.close();
      try {
        const api = new URL(message.apiBaseUri);
        if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1') {
          throw new Error(
            'The browser E2E host must expose an IPv4 loopback HTTP API.'
          );
        }
        if (
          message.mailbox?.transport !== 'unix' ||
          typeof message.mailbox?.path !== 'string' ||
          !path.isAbsolute(message.mailbox.path)
        ) {
          throw new Error(
            'The browser E2E host did not provide a private Unix mailbox.'
          );
        }
        resolve({
          apiBaseUri: api.toString().replace(/\/$/, ''),
          mailboxSocket: message.mailbox.path,
        });
      } catch (error) {
        reject(error);
      }
    });

    host.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    host.once('exit', (code, signal) => {
      clearTimeout(timer);
      const output =
        startupOutput.length > 0
          ? `\nHost output before readiness:\n${startupOutput.join('\n')}`
          : '';
      reject(
        new Error(
          `The browser E2E host exited before readiness (${code ?? signal ?? 'unknown'}).${output}`
        )
      );
    });
  });

  return ready;
}

async function waitForVite() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (hasExited(vite)) {
      throw new Error(
        `Vite exited before becoming ready (${vite.exitCode ?? vite.signalCode}).`
      );
    }
    try {
      const response = await fetch(`${viteUrl}/developer-login`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for Vite at http://127.0.0.1:5173.');
}

let exitCode = 1;
try {
  const ready = await startBackendHost();
  const viteCli = path.join(
    projectRoot,
    'node_modules/vite/dist/vite/node/cli.js'
  );
  if (!existsSync(viteCli)) {
    throw new Error('Vite CLI is not installed in the web workspace.');
  }
  vite = spawn(
    process.execPath,
    [viteCli, 'dev', '--host', '127.0.0.1', '--strictPort'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        COMPLIANCE_API_PROXY_TARGET: ready.apiBaseUri,
      },
      stdio: 'inherit',
    }
  );
  await waitForVite();

  const playwrightCli = path.join(
    projectRoot,
    'node_modules/@playwright/test/cli.js'
  );
  if (!existsSync(playwrightCli)) {
    throw new Error(
      'Playwright is not installed. Install the web workspace dependencies first.'
    );
  }

  playwright = spawn(
    process.execPath,
    [
      playwrightCli,
      'test',
      '--config=playwright.config.ts',
      ...process.argv.slice(2),
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        COMPLIANCE_API_PROXY_TARGET: ready.apiBaseUri,
        COMPLIANCE_E2E_MAILBOX_SOCKET: ready.mailboxSocket,
      },
      stdio: 'inherit',
    }
  );
  exitCode = await childExit(playwright);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'First-journey runner failed.'}\n`
  );
  exitCode = 1;
} finally {
  await stop(playwright);
  await stop(vite);
  await stop(host, { command: 'shutdown' });
  if (nugetPackages) {
    await rm(nugetPackages, { recursive: true, force: true });
  }
}

process.exitCode = exitCode;
