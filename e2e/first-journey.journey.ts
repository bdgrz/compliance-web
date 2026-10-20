import net from 'node:net';

import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';
import type {
  CreateBoundaryResponse200,
  CreateProgramResponse200,
  GetMemberAccessResponse200,
  GrantAccessBody,
  ListRolesResponse200,
  ListTenantMembersResponse200,
  RegisterTenantResponse200,
} from '../src/api-client/operations.js';
import {
  createOrganizationReadinessTimingTracker,
  createJourneyProgressEvent,
  snapshotTenantReadinessEvents,
  type JourneyParticipant,
  type JourneyReadinessApiEvent,
  type JourneyProgressDiagnostics,
  type JourneyReadinessApiRequestState,
  type JourneyStepName,
  summarizeTenantReadinessEndpoint,
  summarizeTenantProvisioningState,
} from '../src/test-support/first-journey-progress.js';
import { createMailboxConsumeRequest } from '../src/test-support/first-journey-mailbox.js';

type MemberRosterPage = NonNullable<ListTenantMembersResponse200>;
type TenantResponse = NonNullable<RegisterTenantResponse200>;
type ProgramResponse = NonNullable<CreateProgramResponse200>;
type BoundaryResponse = NonNullable<CreateBoundaryResponse200>;
type MemberAccessResponse = NonNullable<GetMemberAccessResponse200>;
type RoleCatalog = NonNullable<ListRolesResponse200>;
type AccessGrantProposal = NonNullable<GrantAccessBody['proposal']>;
type MailboxReply = { status: string; token?: string };

const mailboxSocket = process.env.COMPLIANCE_E2E_MAILBOX_SOCKET;
const orgName = 'First Journey Example';
const programName = 'First Journey SOC 2';
let journeyStartedAt: number | undefined;
let organizationReadinessTiming = createOrganizationReadinessTimingTracker();

function pathOf(response: Response): string {
  return new URL(response.url()).pathname;
}

function apiResponse(
  method: string,
  path: RegExp
): (response: Response) => boolean {
  return (response) =>
    response.request().method() === method && path.test(pathOf(response));
}

async function checkpoint(
  page: Page,
  step: JourneyStepName,
  diagnostics?: JourneyProgressDiagnostics
): Promise<void> {
  let candidates: string[] = [];
  try {
    candidates = await page
      .locator(
        'h1:visible, h2:visible, a:visible, button:visible, [role="status"]:visible, [role="alert"]:visible'
      )
      .allTextContents();
  } catch {
    // A checkpoint must not replace the actual page or journey failure.
  }
  const event = createJourneyProgressEvent(step, page.url(), candidates, {
    ...diagnostics,
    ...(journeyStartedAt === undefined
      ? {}
      : { elapsedMs: Math.max(0, Date.now() - journeyStartedAt) }),
    ...(organizationReadinessTiming.registrationToFirstSlugResolutionMs() ===
    undefined
      ? {}
      : {
          registrationToFirstSlugResolutionMs:
            organizationReadinessTiming.registrationToFirstSlugResolutionMs(),
        }),
  });
  process.stderr.write(`[first-journey-progress] ${JSON.stringify(event)}\n`);
}

function observeTenantReadinessRequests(page: Page): {
  snapshot: () => Promise<JourneyReadinessApiRequestState[]>;
  dispose: () => void;
} {
  const observed: JourneyReadinessApiEvent[] = [];
  const pendingBodyReads = new Set<Promise<void>>();
  const append = (
    request: Request,
    kind: 'started' | 'response' | 'finished' | 'failed',
    status?: number
  ) => {
    if (request.method() !== 'GET' || observed.length >= 240) return;
    const endpoint = summarizeTenantReadinessEndpoint(request.url());
    if (!endpoint) return;
    observed.push(
      kind === 'response'
        ? { endpoint, kind, status: status ?? 0 }
        : { endpoint, kind }
    );
  };
  const onRequest = (request: Request) => append(request, 'started');
  const onResponse = (response: Response) => {
    const request = response.request();
    const requestPath = new URL(request.url()).pathname;
    if (request.method() === 'POST' && requestPath === '/api/v1/tenants') {
      organizationReadinessTiming.recordRegistrationResponse(response.status());
    }
    if (
      request.method() === 'GET' &&
      summarizeTenantReadinessEndpoint(request.url()) ===
        'tenant-slug-resolution'
    ) {
      organizationReadinessTiming.recordSlugResolutionResponse(
        response.status()
      );
    }
    append(request, 'response', response.status());
    if (
      request.method() !== 'GET' ||
      summarizeTenantReadinessEndpoint(request.url()) !==
        'tenant-provisioning-status' ||
      observed.length >= 240
    ) {
      return;
    }

    const appendProvisioningState = (payload: unknown) => {
      if (observed.length >= 240) return;
      observed.push({
        endpoint: 'tenant-provisioning-status',
        kind: 'provisioning-state',
        state: summarizeTenantProvisioningState(payload),
      });
    };
    let pendingBodyRead: Promise<void>;
    pendingBodyRead = Promise.resolve()
      .then(() => response.json())
      .then(appendProvisioningState, () => appendProvisioningState(undefined))
      .finally(() => pendingBodyReads.delete(pendingBodyRead));
    pendingBodyReads.add(pendingBodyRead);
  };
  const onRequestFinished = (request: Request) => append(request, 'finished');
  const onRequestFailed = (request: Request) => append(request, 'failed');
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFailed);
  return {
    snapshot: () => snapshotTenantReadinessEvents(observed, pendingBodyReads),
    dispose: () => {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfinished', onRequestFinished);
      page.off('requestfailed', onRequestFailed);
    },
  };
}

async function performCheckpointedAction(
  page: Page,
  started: JourneyStepName,
  completed: JourneyStepName,
  failed: JourneyStepName,
  action: () => Promise<void>
): Promise<void> {
  await checkpoint(page, started);
  try {
    await action();
  } catch {
    await checkpoint(page, failed);
    throw new Error('The organization form field interaction failed.');
  }
  await checkpoint(page, completed);
}

async function consumeMailboxCode(
  delivery: 'email_verification' | 'tenant_invitation',
  email: string,
  scopeId: string,
  signal: AbortSignal
): Promise<string> {
  if (!mailboxSocket) {
    throw new Error('The private E2E mailbox socket is not configured.');
  }

  const request =
    delivery === 'tenant_invitation'
      ? createMailboxConsumeRequest({
          delivery,
          email,
          tenantId: scopeId,
        })
      : createMailboxConsumeRequest({
          delivery,
          email,
          userId: scopeId,
        });

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(mailboxSocket);
    let buffered = '';
    let settled = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      fail(new Error(`Timed out waiting for ${delivery} delivery.`));
    }, 35_000);

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      action();
    };

    const fail = (error: Error) => finish(() => reject(error));
    const abort = () => {
      socket.destroy();
      fail(new Error('Mailbox wait cancelled.'));
    };

    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      const newline = buffered.indexOf('\n');
      if (newline < 0) return;

      let reply: MailboxReply;
      try {
        reply = JSON.parse(buffered.slice(0, newline)) as MailboxReply;
      } catch {
        fail(
          new Error('The private E2E mailbox returned an invalid response.')
        );
        return;
      }

      if (reply.status !== 'ok' || typeof reply.token !== 'string') {
        fail(new Error(`Mailbox delivery ended with status ${reply.status}.`));
        return;
      }

      finish(() => resolve(reply.token!));
      socket.end();
    });
    socket.on('error', () =>
      fail(new Error('The private E2E mailbox connection failed.'))
    );
    socket.on('close', () => {
      if (!settled) fail(new Error('The private E2E mailbox closed early.'));
    });
  });
}

async function performWhileConsuming(
  page: Page,
  delivery: 'email_verification' | 'tenant_invitation',
  email: string,
  scopeId: string,
  waitingStep: JourneyStepName,
  deliveredStep: JourneyStepName,
  action: () => Promise<void>
): Promise<string> {
  const controller = new AbortController();
  const code = consumeMailboxCode(delivery, email, scopeId, controller.signal);
  try {
    await action();
    await checkpoint(page, waitingStep);
    const deliveredCode = await code;
    await checkpoint(page, deliveredStep);
    return deliveredCode;
  } catch (error) {
    controller.abort();
    await code.catch(() => undefined);
    throw error;
  } finally {
    controller.abort();
  }
}

async function verifyEmail(
  page: Page,
  email: string,
  participant: JourneyParticipant
): Promise<void> {
  const session = await page.evaluate(async () => {
    const response = await fetch('/auth/session', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const body = response.ok
      ? ((await response.json()) as { id?: unknown } | null)
      : null;
    return { status: response.status, id: body?.id };
  });
  expect(session.status).toBe(200);
  if (typeof session.id !== 'string' || session.id.trim().length === 0) {
    throw new Error('The current browser session has no user identifier.');
  }

  await checkpoint(page, `${participant} verification form requested`);
  await expect(
    page.getByRole('button', { name: 'Send verification code' })
  ).toBeVisible();
  await checkpoint(page, `${participant} verification form opened`);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  const code = await performWhileConsuming(
    page,
    'email_verification',
    email,
    session.id,
    `${participant} verification challenge accepted; waiting for delivery`,
    `${participant} verification challenge delivered`,
    async () => {
      const issue = page.waitForResponse(
        apiResponse(
          'POST',
          /\/api\/v1\/users\/[^/]+\/email-addresses\/[^/]+\/challenges$/
        )
      );
      await checkpoint(page, `${participant} verification challenge submitted`);
      await page
        .getByRole('button', { name: 'Send verification code' })
        .click();
      const response = await issue;
      expect(response.status()).toBe(204);
    }
  );

  await page.getByLabel('Verification code').fill(code);
  const verification = page.waitForResponse(
    apiResponse(
      'POST',
      /\/api\/v1\/users\/[^/]+\/email-addresses\/[^/]+\/verifications$/
    )
  );
  await checkpoint(page, `${participant} email verification submitted`);
  await page.getByRole('button', { name: 'Verify email address' }).click();
  expect((await verification).status()).toBe(204);
  await expect(
    page.getByRole('status').filter({
      hasText: 'Your email address is verified.',
    })
  ).toBeVisible();
  await checkpoint(page, `${participant} email verification accepted`);
  await checkpoint(
    page,
    `${participant} organization access refresh submitted`
  );
  await page
    .getByRole('button', { name: 'Refresh organization access' })
    .click();
}

async function signInAndVerify(
  page: Page,
  email: string,
  participant: JourneyParticipant
): Promise<void> {
  await checkpoint(page, `${participant} login page requested`);
  await page.goto('/developer-login?returnUrl=%2Forganizations');
  await checkpoint(page, `${participant} login page opened`);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  const continued = page.waitForResponse(
    apiResponse('POST', /\/api\/v1\/developer-user-sessions$/)
  );
  await checkpoint(page, `${participant} login submitted`);
  await page.getByRole('button', { name: 'Continue' }).click();
  expect((await continued).status()).toBe(200);
  await page.waitForURL('**/organizations');
  await expect(
    page.getByRole('heading', { name: 'No organization access yet' })
  ).toBeVisible();
  await checkpoint(page, `${participant} login accepted`);
  await verifyEmail(page, email, participant);
  await expect(
    page.getByRole('link', { name: 'Create a new organization' })
  ).toBeVisible();
  await checkpoint(page, `${participant} organization selector refreshed`);
}

async function waitForOrganizationReady(
  page: Page,
  slug: string,
  readinessRequests: () => Promise<JourneyReadinessApiRequestState[]>
): Promise<void> {
  const timeoutMs = 60_000;
  const checkStatusIntervalMs = 2_000;
  const pollIntervalMs = 250;
  const progressIntervalMs = 5_000;
  const deadline = Date.now() + timeoutMs;
  let nextStatusCheckAt = 0;
  let nextProgressAt = 0;

  while (Date.now() < deadline) {
    if (new URL(page.url()).pathname === `/${slug}`) {
      await checkpoint(page, 'founder organization page opened', {
        readinessRequests: await readinessRequests(),
      });
      return;
    }

    const checkingStatus = page.getByRole('button', {
      name: 'Checking status…',
      exact: true,
    });
    const checkStatus = page.getByRole('button', { name: 'Check status' });
    const checking = await checkingStatus.isVisible().catch(() => false);
    if (!checking && Date.now() >= nextStatusCheckAt) {
      const visible = await checkStatus.isVisible().catch(() => false);
      const enabled =
        visible && (await checkStatus.isEnabled().catch(() => false));
      if (enabled) {
        try {
          await checkStatus.click({ timeout: 1_000 });
        } catch {
          // The page can move into its disabled checking state between inspection and click.
        }
        nextStatusCheckAt = Date.now() + checkStatusIntervalMs;
      }
    }

    await page.waitForTimeout(
      Math.max(0, Math.min(pollIntervalMs, deadline - Date.now()))
    );
    if (Date.now() >= nextProgressAt) {
      await checkpoint(
        page,
        'founder organization provisioning status checked',
        { readinessRequests: await readinessRequests() }
      );
      nextProgressAt = Date.now() + progressIntervalMs;
    }
  }
  await checkpoint(page, 'founder organization provisioning status checked', {
    readinessRequests: await readinessRequests(),
  });
  throw new Error(
    'The organization workspace did not open after readiness checks.'
  );
}

async function findMemberUserId(
  page: Page,
  slug: string,
  email: string
): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await checkpoint(page, 'founder member roster requested');
    const roster = page.waitForResponse(
      apiResponse('GET', /\/api\/v1\/tenants\/[^/]+\/members$/)
    );
    await page.goto(`/${slug}/members`);
    const response = await roster;
    expect(response.ok()).toBeTruthy();
    await checkpoint(page, 'founder member roster refreshed');
    const body = (await response.json()) as MemberRosterPage;
    const member = (body.items ?? []).find(
      (item) =>
        item?.verified_email_address?.toLocaleLowerCase() ===
        email.toLocaleLowerCase()
    );
    if (member?.user_id) return member.user_id;
    await page.waitForTimeout(300);
  }
  throw new Error(`The authorized member roster did not show ${email}.`);
}

async function showMemberAccess(
  page: Page,
  slug: string,
  userId: string,
  teamName: string,
  roleName: string,
  participant: JourneyParticipant
): Promise<string> {
  const access = page.waitForResponse(
    apiResponse(
      'GET',
      new RegExp(`/api/v1/tenants/[^/]+/members/${userId}/access$`)
    )
  );
  await checkpoint(page, `${participant} member access page requested`);
  await page.goto(`/${slug}/members/${userId}`);
  const response = await access;
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as MemberAccessResponse;
  expect(body.member_id).toBeTruthy();
  await expect(
    page.getByRole('heading', { name: 'Effective permissions' })
  ).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Team ${teamName} has role ${roleName}`))
  ).toBeVisible();
  await checkpoint(page, `${participant} member access loaded`);
  return body.member_id;
}

async function grantOrganizationAdmin(
  page: Page,
  slug: string,
  tenantId: string,
  email: string,
  userId: string,
  memberId: string
): Promise<void> {
  await page.goto(`/${slug}/programs`);
  await expect(
    page.getByRole('heading', { name: 'Programs are not available to you' })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Members', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Members', exact: true })
  ).toBeVisible();
  const memberRow = page.getByRole('listitem').filter({ hasText: email });
  await expect(memberRow.getByRole('link')).toBeVisible();

  const roleCatalogRequest = page
    .waitForResponse(apiResponse('GET', /\/api\/v1\/tenants\/[^/]+\/roles$/), {
      timeout: 10_000,
    })
    .catch(() => null);
  const programCatalogRequest = page
    .waitForResponse(
      apiResponse('GET', /\/api\/v1\/tenants\/[^/]+\/programs$/),
      { timeout: 10_000 }
    )
    .catch(() => null);
  await memberRow.getByRole('link').click();
  await page.waitForURL(`**/${slug}/members/${userId}`, { timeout: 10_000 });
  const [roleCatalogResponse, programCatalogResponse] = await Promise.all([
    roleCatalogRequest,
    programCatalogRequest,
  ]);
  const roleSelector = page.getByLabel('Role', { exact: true });
  const scopeSelector = page.getByLabel('Scope', { exact: true });
  const grantOptionsState = async () => ({
    grantOptionsLoading: await page
      .getByLabel('Loading access grant options')
      .isVisible()
      .catch(() => false),
    grantOptionsErrorVisible:
      (await page.locator('[role="alert"]:visible').count()) > 0,
    roleSelectorVisible:
      (await roleSelector.count()) > 0 &&
      (await roleSelector.isVisible().catch(() => false)),
    scopeSelectorVisible:
      (await scopeSelector.count()) > 0 &&
      (await scopeSelector.isVisible().catch(() => false)),
    grantOptionsRetryVisible:
      (await page.getByRole('button', { name: 'Try again' }).count()) > 0 &&
      (await page
        .getByRole('button', { name: 'Try again' })
        .first()
        .isVisible()
        .catch(() => false)),
  });
  const initialGrantOptionsState = await grantOptionsState();
  await checkpoint(page, 'founder member grant catalog responses received', {
    roleCatalogStatus: roleCatalogResponse?.status() ?? null,
    programCatalogStatus: programCatalogResponse?.status() ?? null,
    ...initialGrantOptionsState,
  });
  if (!roleCatalogResponse || !programCatalogResponse) {
    throw new Error('One or more access grant catalogs did not respond.');
  }
  expect(roleCatalogResponse.ok()).toBeTruthy();
  const roleCatalog = (await roleCatalogResponse.json()) as RoleCatalog;
  const organizationAdminRole = (roleCatalog.items ?? []).find(
    (role) => role?.name === 'Org Admin'
  );
  expect(organizationAdminRole?.role_id).toBeTruthy();

  const selectorWaits = await Promise.allSettled([
    roleSelector.waitFor({ state: 'visible', timeout: 10_000 }),
    scopeSelector.waitFor({ state: 'visible', timeout: 10_000 }),
  ]);
  if (selectorWaits.some((wait) => wait.status === 'rejected')) {
    await checkpoint(page, 'founder member grant selector wait failed', {
      roleCatalogStatus: roleCatalogResponse.status(),
      programCatalogStatus: programCatalogResponse.status(),
      ...(await grantOptionsState()),
    });
    throw new Error('The organization access grant selectors did not load.');
  }
  await checkpoint(page, 'founder member grant selectors ready', {
    roleCatalogStatus: roleCatalogResponse.status(),
    programCatalogStatus: programCatalogResponse.status(),
    ...(await grantOptionsState()),
  });

  await roleSelector.selectOption({ label: 'Org Admin' });
  await scopeSelector.selectOption({ label: 'Whole organization' });

  const grantResponsePromise = page.waitForResponse(
    apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/access-grants\/[^/]+$/)
  );
  await checkpoint(page, 'founder organization administrator grant submitted');
  await page.getByRole('button', { name: 'Grant access' }).click();
  const grantResponse = await grantResponsePromise;
  expect(grantResponse.status()).toBe(204);
  await checkpoint(page, 'founder organization administrator grant accepted');

  const grantId = pathOf(grantResponse).match(/\/access-grants\/([^/]+)$/)?.[1];
  expect(grantId).toBeTruthy();
  const proposal = (grantResponse.request().postDataJSON() as GrantAccessBody)
    .proposal as AccessGrantProposal;
  expect(proposal.principal).toEqual({ kind: 'member', id: memberId });
  expect(proposal.role_id).toBe(organizationAdminRole!.role_id);
  expect(proposal.scope).toEqual({ kind: 'organization', id: tenantId });
  expect(proposal.source).toEqual({ kind: 'manual', id: grantId });
  expect(proposal.effective_until).toBeNull();
  expect(Date.parse(proposal.effective_from)).not.toBeNaN();
  await expect(
    page.getByRole('status').filter({
      hasText: 'Granted Org Admin on Whole organization.',
    })
  ).toBeVisible();

  // The grant command is accepted before its authorization projection is guaranteed to be
  // visible. Refresh through the real access page until the server reports the effective grant.
  await checkpoint(
    page,
    'founder organization administrator grant projection refresh started'
  );
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const accessRequest = page.waitForResponse(
      apiResponse(
        'GET',
        new RegExp(`/api/v1/tenants/[^/]+/members/${userId}/access$`)
      )
    );
    await page.goto(`/${slug}/members/${userId}`);
    const accessResponse = await accessRequest;
    expect(accessResponse.ok()).toBeTruthy();
    const access = (await accessResponse.json()) as MemberAccessResponse;
    const effectiveGrant = access.grant_paths.some(
      (path) =>
        path?.is_effective &&
        path.role_name === 'Org Admin' &&
        path.grant.terms.principal.kind === 'member' &&
        path.grant.terms.principal.id === memberId &&
        path.grant.terms.scope.kind === 'organization' &&
        path.grant.terms.scope.id === tenantId
    );
    if (effectiveGrant) {
      await expect(
        page.getByText('Org Admin on Whole organization', { exact: false })
      ).toBeVisible();
      await checkpoint(
        page,
        'founder organization administrator grant projected'
      );
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('The organization-wide Org Admin grant was not projected.');
}

async function inviteMember(
  page: Page,
  tenantId: string,
  slug: string,
  email: string,
  role: 'compliance_participation' | 'tenant_administration',
  participant: Extract<
    JourneyParticipant,
    'second administrator' | 'contributor'
  >
): Promise<string> {
  await page.goto(`/${slug}/members`);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  if (role === 'tenant_administration') {
    await page.getByRole('radio', { name: /Org Admin/ }).check();
  }
  const invitationCode = await performWhileConsuming(
    page,
    'tenant_invitation',
    email,
    tenantId,
    `${participant} invitation accepted; waiting for delivery`,
    `${participant} invitation delivered`,
    async () => {
      const invited = page.waitForResponse(
        apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/member-invitations$/)
      );
      await checkpoint(page, `${participant} invitation submitted`);
      await page.getByRole('button', { name: 'Send invitation' }).click();
      const response = await invited;
      expect(response.status()).toBe(204);
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: `Invitation sent to ${email}` })
      ).toBeVisible();
    }
  );
  return invitationCode;
}

async function acceptInvitation(
  page: Page,
  email: string,
  invitationCode: string,
  tenantId: string,
  slug: string,
  participant: Extract<
    JourneyParticipant,
    'second administrator' | 'contributor'
  >
): Promise<void> {
  await signInAndVerify(page, email, participant);
  await checkpoint(page, `${participant} invitation acceptance form requested`);
  await page.goto('/organizations/invitations/accept');
  await expect(
    page.getByRole('button', { name: 'Accept invitation' })
  ).toBeVisible();
  await checkpoint(page, `${participant} invitation acceptance form opened`);
  await page.getByLabel('Organization ID').fill(tenantId);
  await page.getByLabel('Invited email address').fill(email);
  await page.getByLabel('Invitation code').fill(invitationCode);
  const accepted = page.waitForResponse(
    apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/invitations\/acceptance$/)
  );
  await checkpoint(page, `${participant} invitation acceptance submitted`);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  const response = await accepted;
  expect(response.status()).toBe(204);
  await expect(
    page.getByRole('status').filter({
      hasText: 'Your invitation acceptance was received.',
    })
  ).toBeVisible();
  await checkpoint(page, `${participant} invitation acceptance received`);
  await page.getByRole('link', { name: 'Check your organizations' }).click();
  await expect(
    page.getByRole('link', { name: orgName, exact: true })
  ).toBeVisible();
  await page.getByRole('link', { name: orgName, exact: true }).click();
  await page.waitForURL(`**/${slug}`);
  await expect(page.getByText(orgName, { exact: true })).toBeVisible();
  await checkpoint(page, `${participant} organization opened`);
}

async function grantProgramRole(
  page: Page,
  slug: string,
  userId: string
): Promise<void> {
  await page.goto(`/${slug}/members/${userId}`);
  await expect(
    page.getByLabel('Scope', { exact: true }).locator('option', {
      hasText: `Program: ${programName}`,
    })
  ).toBeAttached();
  await page
    .getByLabel('Role', { exact: true })
    .selectOption({ label: 'Compliance Lead' });
  await page
    .getByLabel('Scope', { exact: true })
    .selectOption({ label: `Program: ${programName}` });
  const granted = page.waitForResponse(
    apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/access-grants\/[^/]+$/)
  );
  await checkpoint(page, 'program role grant submitted');
  await page.getByRole('button', { name: 'Grant access' }).click();
  const response = await granted;
  expect(response.status()).toBe(204);
  await expect(
    page.getByRole('status').filter({
      hasText: `Granted Compliance Lead on Program: ${programName}.`,
    })
  ).toBeVisible();
  await expect(
    page.getByText(`Compliance Lead on Program: ${programName}`)
  ).toBeVisible();
  await checkpoint(page, 'program role grant accepted');
}

async function createBoundary(
  page: Page,
  slug: string,
  programId: string
): Promise<string> {
  await checkpoint(page, 'boundary draft form requested');
  await page.goto(`/${slug}/programs/${programId}/boundaries`);
  await checkpoint(page, 'boundary draft form opened');
  await page
    .getByLabel('System description statement')
    .fill(
      'The first journey example application processes customer account requests.'
    );
  await page.getByRole('button', { name: 'Add scope entry' }).click();
  await page
    .getByLabel('Subject', { exact: true })
    .fill('Customer account service');
  await page
    .getByLabel('Owner', { exact: true })
    .fill('First journey application team');
  await page
    .getByLabel('Rationale')
    .fill('Included because it processes customer account requests.');

  const created = page.waitForResponse(
    apiResponse(
      'POST',
      new RegExp(`/api/v1/tenants/[^/]+/programs/${programId}/boundaries$`)
    )
  );
  await checkpoint(page, 'boundary draft creation submitted');
  await page.getByRole('button', { name: 'Create draft' }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as BoundaryResponse;
  expect(body.boundary_id).toBeTruthy();
  expect(body.draft_version_id).toBeTruthy();
  await page.waitForURL(
    `**/${slug}/programs/${programId}/boundaries/${body.boundary_id}`
  );
  await checkpoint(page, 'boundary draft created');
  return body.boundary_id;
}

test('first organization admin provisions a scoped team journey and reassignment', async ({
  browser,
}) => {
  test.setTimeout(15 * 60 * 1000);
  journeyStartedAt = Date.now();
  organizationReadinessTiming = createOrganizationReadinessTimingTracker();
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const slug = `e2e-${runId}`;
  const founderEmail = `founder-${runId}@example.com`;
  const adminEmail = `admin-${runId}@example.com`;
  const contributorEmail = `contributor-${runId}@example.com`;

  const founderContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const contributorContext = await browser.newContext();
  const founder = await founderContext.newPage();
  const admin = await adminContext.newPage();
  const contributor = await contributorContext.newPage();

  try {
    await signInAndVerify(founder, founderEmail, 'founder');
    await checkpoint(founder, 'founder organization creation form requested');
    await founder.goto('/organizations/new');
    await checkpoint(founder, 'founder organization creation form opened');
    await performCheckpointedAction(
      founder,
      'founder organization name fill started',
      'founder organization name fill completed',
      'founder organization name fill failed',
      async () => {
        await founder
          .getByLabel('Name', { exact: true })
          .fill(orgName, { timeout: 30_000 });
      }
    );
    await performCheckpointedAction(
      founder,
      'founder organization legal name fill started',
      'founder organization legal name fill completed',
      'founder organization legal name fill failed',
      async () => {
        await founder
          .getByLabel('Legal name', { exact: true })
          .fill('First Journey Example LLC', { timeout: 30_000 });
      }
    );
    await performCheckpointedAction(
      founder,
      'founder organization slug fill started',
      'founder organization slug fill completed',
      'founder organization slug fill failed',
      async () => {
        await founder.getByLabel('Slug').fill(slug, { timeout: 30_000 });
      }
    );

    await checkpoint(founder, 'founder organization form state check started');
    let formValid: boolean;
    let createButtonEnabled: boolean;
    let createButtonType: 'submit' | 'button' | 'reset' | 'other';
    const createButton = founder.getByRole('button', {
      name: 'Create organization',
    });
    try {
      formValid = await founder
        .locator('form')
        .evaluate(
          (form) => (form as HTMLFormElement).checkValidity(),
          undefined,
          { timeout: 30_000 }
        );
      createButtonEnabled = await createButton.isEnabled({ timeout: 30_000 });
      const type = await createButton.getAttribute('type', {
        timeout: 30_000,
      });
      createButtonType =
        type === 'submit' || type === 'button' || type === 'reset'
          ? type
          : 'other';
    } catch {
      await checkpoint(founder, 'founder organization form state check failed');
      throw new Error('The organization form state could not be read.');
    }
    await checkpoint(founder, 'founder organization form state checked', {
      formValid,
      createButtonEnabled,
      createButtonType,
    });
    expect(formValid).toBe(true);
    expect(createButtonEnabled).toBe(true);
    expect(createButtonType).toBe('submit');

    const readinessObserver = observeTenantReadinessRequests(founder);
    const registered = founder
      .waitForResponse(apiResponse('POST', /\/api\/v1\/tenants$/), {
        timeout: 30_000,
      })
      .then(
        (response) => response,
        () => null
      );
    await checkpoint(
      founder,
      'founder organization creation button click started'
    );
    try {
      await createButton.click({ timeout: 30_000 });
    } catch {
      await checkpoint(
        founder,
        'founder organization creation button click failed'
      );
      throw new Error('The organization creation button click failed.');
    }
    await checkpoint(founder, 'founder organization creation submitted');
    const registerResponse = await registered;
    if (!registerResponse) {
      await checkpoint(
        founder,
        'founder organization registration response timed out',
        { registrationRouteFired: false, registrationStatus: null }
      );
      throw new Error('The organization registration response timed out.');
    }
    await checkpoint(
      founder,
      'founder organization registration response received',
      {
        registrationRouteFired: true,
        registrationStatus: registerResponse.status(),
      }
    );
    expect(registerResponse.status()).toBe(200);
    await checkpoint(founder, 'founder organization created');
    const tenant = (await registerResponse.json()) as TenantResponse;
    expect(tenant.tenant_id).toBeTruthy();
    expect(tenant.slug).toBe(slug);
    await checkpoint(
      founder,
      'founder organization provisioning check started'
    );
    try {
      await waitForOrganizationReady(founder, slug, readinessObserver.snapshot);
    } finally {
      readinessObserver.dispose();
    }
    await expect(founder.getByText(orgName, { exact: true })).toBeVisible();
    await checkpoint(founder, 'founder organization page opened');

    const founderUserId = await findMemberUserId(founder, slug, founderEmail);
    const founderMemberId = await showMemberAccess(
      founder,
      slug,
      founderUserId,
      'Administrators',
      'Org Admin',
      'founder'
    );

    // The built-in Administrators team alone cannot create programs. Grant Org Admin
    // organization-wide from the member access screen before starting the first program.
    await grantOrganizationAdmin(
      founder,
      slug,
      tenant.tenant_id,
      founderEmail,
      founderUserId,
      founderMemberId
    );

    const adminInvitation = await inviteMember(
      founder,
      tenant.tenant_id,
      slug,
      adminEmail,
      'tenant_administration',
      'second administrator'
    );
    await acceptInvitation(
      admin,
      adminEmail,
      adminInvitation,
      tenant.tenant_id,
      slug,
      'second administrator'
    );
    const adminUserId = await findMemberUserId(founder, slug, adminEmail);
    await showMemberAccess(
      founder,
      slug,
      founderUserId,
      'Administrators',
      'Org Admin',
      'founder'
    );
    await showMemberAccess(
      admin,
      slug,
      adminUserId,
      'Administrators',
      'Org Admin',
      'second administrator'
    );

    const contributorInvitation = await inviteMember(
      founder,
      tenant.tenant_id,
      slug,
      contributorEmail,
      'compliance_participation',
      'contributor'
    );
    await acceptInvitation(
      contributor,
      contributorEmail,
      contributorInvitation,
      tenant.tenant_id,
      slug,
      'contributor'
    );
    const contributorUserId = await findMemberUserId(
      founder,
      slug,
      contributorEmail
    );
    await showMemberAccess(
      founder,
      slug,
      contributorUserId,
      'Standard Users',
      'Contributor',
      'founder'
    );

    await checkpoint(founder, 'program creation form requested');
    await founder.goto(`/${slug}/programs`);
    await checkpoint(founder, 'program creation form opened');
    await founder.getByLabel('Program name', { exact: true }).fill(programName);
    const programCreated = founder.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/programs$/)
    );
    await checkpoint(founder, 'program creation submitted');
    await founder.getByRole('button', { name: 'Start program' }).click();
    const programResponse = await programCreated;
    expect(programResponse.status()).toBe(200);
    const program = (await programResponse.json()) as ProgramResponse;
    expect(program.program_id).toBeTruthy();
    await founder.waitForURL(`**/${slug}/programs/${program.program_id}`);
    await checkpoint(founder, 'program created');

    await contributor.goto(`/${slug}/programs`);
    await expect(
      contributor.getByRole('heading', {
        name: 'Programs are not available to you',
      })
    ).toBeVisible();
    await checkpoint(contributor, 'contributor pregrant access checked');

    await grantProgramRole(founder, slug, contributorUserId);
    await grantProgramRole(founder, slug, adminUserId);
    await contributor.goto(`/${slug}/programs/${program.program_id}`);
    await expect(
      contributor.getByRole('heading', { name: programName })
    ).toBeVisible();
    await checkpoint(contributor, 'contributor program access checked');

    const boundaryId = await createBoundary(founder, slug, program.program_id);
    await founder
      .getByLabel('Member', { exact: true })
      .selectOption({ label: founderEmail });
    await founder
      .getByLabel('Responsibility', { exact: true })
      .selectOption('control_owner');
    await checkpoint(
      founder,
      'founder responsibility conflict check submitted'
    );
    await founder.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(
      founder.getByRole('status').filter({
        hasText: 'No separation-of-duties conflicts for this assignment.',
      })
    ).toBeVisible();
    await checkpoint(founder, 'founder responsibility conflict check accepted');
    const founderAssignment = founder.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/responsibilities$/)
    );
    await checkpoint(founder, 'founder responsibility assignment submitted');
    await founder
      .getByRole('button', { name: 'Assign responsibility' })
      .click();
    expect((await founderAssignment).status()).toBe(204);
    await expect(
      founder
        .getByRole('status')
        .filter({ hasText: 'Responsibility assigned.' })
    ).toBeVisible();
    await checkpoint(founder, 'founder responsibility assignment accepted');

    await founder
      .getByLabel('Responsibility', { exact: true })
      .selectOption('assigned_reviewer');
    await checkpoint(founder, 'founder separation of duties check submitted');
    await founder.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(founder.getByRole('alert')).toContainText(
      'Separation-of-duties conflict'
    );
    await expect(founder.getByRole('alert')).toContainText('control owner');
    await expect(founder.getByRole('alert')).toContainText('assigned reviewer');
    await checkpoint(founder, 'separation of duties denial observed');
    const deniedAssignment = founder.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/responsibilities$/)
    );
    await checkpoint(founder, 'founder responsibility assignment submitted');
    await founder
      .getByRole('button', { name: 'Assign responsibility' })
      .click();
    const deniedResponse = await deniedAssignment;
    expect(deniedResponse.status()).toBe(409);
    await expect(founder.getByRole('alert')).toBeVisible();
    await checkpoint(founder, 'separation of duties denial observed');

    await checkpoint(admin, 'founder member suspension page requested');
    const founderAccess = admin.waitForResponse(
      apiResponse(
        'GET',
        new RegExp(`/api/v1/tenants/[^/]+/members/${founderUserId}/access$`)
      )
    );
    await admin.goto(`/${slug}/members/${founderUserId}`);
    const founderAccessResponse = await founderAccess;
    expect(founderAccessResponse.ok()).toBeTruthy();
    const founderAccessBody =
      (await founderAccessResponse.json()) as MemberAccessResponse;
    expect(founderAccessBody.member_id).toBe(founderMemberId);
    const suspension = admin.waitForResponse(
      apiResponse(
        'POST',
        new RegExp(
          `/api/v1/tenants/[^/]+/members/${founderUserId}/suspensions$`
        )
      )
    );
    await checkpoint(admin, 'founder suspension submitted');
    await admin
      .getByLabel('Reason for suspension')
      .fill('First journey reassignment exercise.');
    await admin.getByRole('button', { name: 'Suspend member' }).click();
    expect((await suspension).status()).toBe(204);
    await expect(
      admin
        .getByRole('status')
        .filter({ hasText: 'Member suspended. Their access has ended.' })
    ).toBeVisible();
    await expect(
      admin.getByRole('heading', { name: 'Open work needing reassignment' })
    ).toBeVisible();
    await expect(
      admin.getByText('Control owner', { exact: false })
    ).toBeVisible();
    await checkpoint(admin, 'founder suspension accepted');
    await checkpoint(admin, 'orphaned work displayed');

    await checkpoint(founder, 'suspended founder program page requested');
    await founder.goto(`/${slug}/programs/${program.program_id}`);
    await expect(
      founder.getByRole('heading', { name: 'Organization unavailable' })
    ).toBeVisible();
    await expect(
      founder.getByRole('heading', { name: programName })
    ).toHaveCount(0);
    await checkpoint(
      founder,
      'founder program access checked after suspension'
    );

    await checkpoint(admin, 'second administrator organization page requested');
    await admin.goto(`/${slug}`);
    await expect(admin.getByText(orgName, { exact: true })).toBeVisible();
    await checkpoint(admin, 'second administrator organization access checked');
    await checkpoint(admin, 'reassignment draft page requested');
    await admin.goto(
      `/${slug}/programs/${program.program_id}/boundaries/${boundaryId}`
    );
    await expect(
      admin.getByRole('heading', { name: /Responsibilities on draft revision/ })
    ).toBeVisible();
    await checkpoint(admin, 'reassignment draft opened');
    await admin
      .getByLabel('Member', { exact: true })
      .selectOption({ label: adminEmail });
    await admin
      .getByLabel('Responsibility', { exact: true })
      .selectOption('control_owner');
    await checkpoint(
      admin,
      'second administrator responsibility conflict check submitted'
    );
    await admin.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(
      admin.getByRole('status').filter({
        hasText: 'No separation-of-duties conflicts for this assignment.',
      })
    ).toBeVisible();
    await checkpoint(
      admin,
      'second administrator responsibility conflict check accepted'
    );
    const reassigned = admin.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/responsibilities$/)
    );
    await checkpoint(admin, 'responsibility reassignment submitted');
    await admin.getByRole('button', { name: 'Assign responsibility' }).click();
    expect((await reassigned).status()).toBe(204);
    await expect(
      admin.getByRole('status').filter({ hasText: 'Responsibility assigned.' })
    ).toBeVisible();
    await checkpoint(admin, 'responsibility reassignment accepted');

    const founderAssignmentButton = admin.getByRole('button', {
      name: new RegExp(`Revoke control owner ${founderMemberId.slice(0, 8)}`),
    });
    await expect(founderAssignmentButton).toBeVisible();
    const revokedAssignment = admin.waitForResponse(
      apiResponse(
        'POST',
        /\/api\/v1\/tenants\/[^/]+\/responsibilities\/[^/]+\/revocation$/
      )
    );
    await checkpoint(admin, 'founder responsibility revocation submitted');
    await founderAssignmentButton.click();
    expect((await revokedAssignment).status()).toBe(204);
    await expect(
      admin.getByRole('status').filter({ hasText: 'Responsibility revoked.' })
    ).toBeVisible();
    await checkpoint(admin, 'founder responsibility revocation accepted');

    await admin.goto(`/${slug}/members/${founderUserId}`);
    await expect(
      admin.getByText('No open responsibilities.', { exact: true })
    ).toBeVisible();
    await checkpoint(admin, 'founder open responsibilities checked');
    await admin.goto(`/${slug}/members/${adminUserId}`);
    await expect(
      admin.getByText('Control owner', { exact: false })
    ).toBeVisible();
    await checkpoint(admin, 'second administrator responsibility checked');
  } finally {
    await Promise.all([
      founderContext.close(),
      adminContext.close(),
      contributorContext.close(),
    ]);
  }
});
