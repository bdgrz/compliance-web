import net from 'node:net';

import { expect, test, type Page, type Response } from '@playwright/test';
import type {
  CreateBoundaryResponse200,
  CreateProgramResponse200,
  GetMemberAccessResponse200,
  GrantAccessBody,
  ListRolesResponse200,
  ListTenantMembersResponse200,
  RegisterTenantResponse200,
} from '../src/api-client/operations.js';

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

async function consumeMailboxCode(
  delivery: 'email_verification' | 'tenant_invitation',
  email: string,
  signal: AbortSignal
): Promise<string> {
  if (!mailboxSocket) {
    throw new Error('The private E2E mailbox socket is not configured.');
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(mailboxSocket);
    let buffered = '';
    let settled = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      fail(new Error(`Timed out waiting for ${delivery} delivery.`));
    }, 65_000);

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
      socket.write(
        `${JSON.stringify({
          op: 'consume',
          delivery,
          email,
          timeout_ms: 60_000,
        })}\n`
      );
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
  delivery: 'email_verification' | 'tenant_invitation',
  email: string,
  action: () => Promise<void>
): Promise<string> {
  const controller = new AbortController();
  const code = consumeMailboxCode(delivery, email, controller.signal);
  try {
    await action();
    return await code;
  } catch (error) {
    controller.abort();
    await code.catch(() => undefined);
    throw error;
  } finally {
    controller.abort();
  }
}

async function verifyEmail(page: Page, email: string): Promise<void> {
  await expect(
    page.getByRole('button', { name: 'Send verification code' })
  ).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  const code = await performWhileConsuming(
    'email_verification',
    email,
    async () => {
      const issue = page.waitForResponse(
        apiResponse(
          'POST',
          /\/api\/v1\/users\/[^/]+\/email-addresses\/[^/]+\/challenges$/
        )
      );
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
  await page.getByRole('button', { name: 'Verify email address' }).click();
  expect((await verification).status()).toBe(204);
  await expect(
    page.getByRole('status').filter({
      hasText: 'Your email address is verified.',
    })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh organization access' })
    .click();
}

async function signInAndVerify(page: Page, email: string): Promise<void> {
  await page.goto('/developer-login?returnUrl=%2Forganizations');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  const continued = page.waitForResponse(
    apiResponse('POST', /\/api\/v1\/developer-user-sessions$/)
  );
  await page.getByRole('button', { name: 'Continue' }).click();
  expect((await continued).status()).toBe(200);
  await page.waitForURL('**/organizations');
  await expect(
    page.getByRole('heading', { name: 'No organization access yet' })
  ).toBeVisible();
  await verifyEmail(page, email);
  await expect(
    page.getByRole('link', { name: 'Create a new organization' })
  ).toBeVisible();
}

async function waitForOrganizationReady(
  page: Page,
  slug: string
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (new URL(page.url()).pathname === `/${slug}`) return;
    const checkStatus = page.getByRole('button', { name: 'Check status' });
    if (await checkStatus.isVisible().catch(() => false)) {
      await checkStatus.click();
    }
    await page.waitForTimeout(500);
  }
  await page.waitForURL(`**/${slug}`);
}

async function findMemberUserId(
  page: Page,
  slug: string,
  email: string
): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const roster = page.waitForResponse(
      apiResponse('GET', /\/api\/v1\/tenants\/[^/]+\/members$/)
    );
    await page.goto(`/${slug}/members`);
    const response = await roster;
    expect(response.ok()).toBeTruthy();
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
  roleName: string
): Promise<string> {
  const access = page.waitForResponse(
    apiResponse(
      'GET',
      new RegExp(`/api/v1/tenants/[^/]+/members/${userId}/access$`)
    )
  );
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
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  const memberRow = page.getByRole('listitem').filter({ hasText: email });
  await expect(memberRow.getByRole('link')).toBeVisible();

  const roleCatalogRequest = page.waitForResponse(
    apiResponse('GET', /\/api\/v1\/tenants\/[^/]+\/roles$/)
  );
  await memberRow.getByRole('link').click();
  await page.waitForURL(`**/${slug}/members/${userId}`);
  const roleCatalogResponse = await roleCatalogRequest;
  expect(roleCatalogResponse.ok()).toBeTruthy();
  const roleCatalog = (await roleCatalogResponse.json()) as RoleCatalog;
  const organizationAdminRole = (roleCatalog.items ?? []).find(
    (role) => role?.name === 'Org Admin'
  );
  expect(organizationAdminRole?.role_id).toBeTruthy();

  await page
    .getByLabel('Role', { exact: true })
    .selectOption({ label: 'Org Admin' });
  await page
    .getByLabel('Scope', { exact: true })
    .selectOption({ label: 'Whole organization' });

  const grantResponsePromise = page.waitForResponse(
    apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/access-grants\/[^/]+$/)
  );
  await page.getByRole('button', { name: 'Grant access' }).click();
  const grantResponse = await grantResponsePromise;
  expect(grantResponse.status()).toBe(204);

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
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('The organization-wide Org Admin grant was not projected.');
}

async function inviteMember(
  page: Page,
  slug: string,
  email: string,
  role: 'compliance_participation' | 'tenant_administration'
): Promise<string> {
  await page.goto(`/${slug}/members`);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  if (role === 'tenant_administration') {
    await page.getByRole('radio', { name: /Org Admin/ }).check();
  }
  const invitationCode = await performWhileConsuming(
    'tenant_invitation',
    email,
    async () => {
      const invited = page.waitForResponse(
        apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/member-invitations$/)
      );
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
  slug: string
): Promise<void> {
  await signInAndVerify(page, email);
  await page.goto('/organizations/invitations/accept');
  await page.getByLabel('Organization ID').fill(tenantId);
  await page.getByLabel('Invited email address').fill(email);
  await page.getByLabel('Invitation code').fill(invitationCode);
  const accepted = page.waitForResponse(
    apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/invitations\/acceptance$/)
  );
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  const response = await accepted;
  expect(response.status()).toBe(204);
  await expect(
    page.getByRole('status').filter({
      hasText: 'Your invitation acceptance was received.',
    })
  ).toBeVisible();
  await page.getByRole('link', { name: 'Check your organizations' }).click();
  await expect(
    page.getByRole('link', { name: orgName, exact: true })
  ).toBeVisible();
  await page.getByRole('link', { name: orgName, exact: true }).click();
  await page.waitForURL(`**/${slug}`);
  await expect(page.getByText(orgName, { exact: true })).toBeVisible();
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
}

async function createBoundary(
  page: Page,
  slug: string,
  programId: string
): Promise<string> {
  await page.goto(`/${slug}/programs/${programId}/boundaries`);
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
  await page.getByRole('button', { name: 'Create draft' }).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as BoundaryResponse;
  expect(body.boundary_id).toBeTruthy();
  expect(body.draft_version_id).toBeTruthy();
  await page.waitForURL(
    `**/${slug}/programs/${programId}/boundaries/${body.boundary_id}`
  );
  return body.boundary_id;
}

test('first organization admin provisions a scoped team journey and reassignment', async ({
  browser,
}) => {
  test.setTimeout(15 * 60 * 1000);
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
    await signInAndVerify(founder, founderEmail);
    await founder.goto('/organizations/new');
    await founder.getByLabel('Name', { exact: true }).fill(orgName);
    await founder
      .getByLabel('Legal name', { exact: true })
      .fill('First Journey Example LLC');
    await founder.getByLabel('Slug', { exact: true }).fill(slug);
    const registered = founder.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants$/)
    );
    await founder.getByRole('button', { name: 'Create organization' }).click();
    const registerResponse = await registered;
    expect(registerResponse.status()).toBe(200);
    const tenant = (await registerResponse.json()) as TenantResponse;
    expect(tenant.tenant_id).toBeTruthy();
    expect(tenant.slug).toBe(slug);
    await waitForOrganizationReady(founder, slug);
    await expect(founder.getByText(orgName, { exact: true })).toBeVisible();

    const founderUserId = await findMemberUserId(founder, slug, founderEmail);
    const founderMemberId = await showMemberAccess(
      founder,
      slug,
      founderUserId,
      'Administrators',
      'Org Admin'
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
      slug,
      adminEmail,
      'tenant_administration'
    );
    await acceptInvitation(
      admin,
      adminEmail,
      adminInvitation,
      tenant.tenant_id,
      slug
    );
    const adminUserId = await findMemberUserId(founder, slug, adminEmail);
    await showMemberAccess(
      founder,
      slug,
      founderUserId,
      'Administrators',
      'Org Admin'
    );
    await showMemberAccess(
      admin,
      slug,
      adminUserId,
      'Administrators',
      'Org Admin'
    );

    const contributorInvitation = await inviteMember(
      founder,
      slug,
      contributorEmail,
      'compliance_participation'
    );
    await acceptInvitation(
      contributor,
      contributorEmail,
      contributorInvitation,
      tenant.tenant_id,
      slug
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
      'Contributor'
    );

    await founder.goto(`/${slug}/programs`);
    await founder.getByLabel('Program name', { exact: true }).fill(programName);
    const programCreated = founder.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/programs$/)
    );
    await founder.getByRole('button', { name: 'Start program' }).click();
    const programResponse = await programCreated;
    expect(programResponse.status()).toBe(200);
    const program = (await programResponse.json()) as ProgramResponse;
    expect(program.program_id).toBeTruthy();
    await founder.waitForURL(`**/${slug}/programs/${program.program_id}`);

    await contributor.goto(`/${slug}/programs`);
    await expect(
      contributor.getByRole('heading', {
        name: 'Programs are not available to you',
      })
    ).toBeVisible();

    await grantProgramRole(founder, slug, contributorUserId);
    await grantProgramRole(founder, slug, adminUserId);
    await contributor.goto(`/${slug}/programs/${program.program_id}`);
    await expect(
      contributor.getByRole('heading', { name: programName })
    ).toBeVisible();

    const boundaryId = await createBoundary(founder, slug, program.program_id);
    await founder
      .getByLabel('Member', { exact: true })
      .selectOption({ label: founderEmail });
    await founder
      .getByLabel('Responsibility', { exact: true })
      .selectOption('control_owner');
    await founder.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(
      founder.getByRole('status').filter({
        hasText: 'No separation-of-duties conflicts for this assignment.',
      })
    ).toBeVisible();
    const founderAssignment = founder.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/responsibilities$/)
    );
    await founder
      .getByRole('button', { name: 'Assign responsibility' })
      .click();
    expect((await founderAssignment).status()).toBe(204);
    await expect(
      founder
        .getByRole('status')
        .filter({ hasText: 'Responsibility assigned.' })
    ).toBeVisible();

    await founder
      .getByLabel('Responsibility', { exact: true })
      .selectOption('assigned_reviewer');
    await founder.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(founder.getByRole('alert')).toContainText(
      'Separation-of-duties conflict'
    );
    await expect(founder.getByRole('alert')).toContainText('control owner');
    await expect(founder.getByRole('alert')).toContainText('assigned reviewer');
    const deniedAssignment = founder.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/responsibilities$/)
    );
    await founder
      .getByRole('button', { name: 'Assign responsibility' })
      .click();
    const deniedResponse = await deniedAssignment;
    expect(deniedResponse.status()).toBe(409);
    await expect(founder.getByRole('alert')).toBeVisible();

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

    await founder.goto(`/${slug}/programs/${program.program_id}`);
    await expect(
      founder.getByRole('heading', { name: 'Organization unavailable' })
    ).toBeVisible();
    await expect(
      founder.getByRole('heading', { name: programName })
    ).toHaveCount(0);

    await admin.goto(`/${slug}`);
    await expect(admin.getByText(orgName, { exact: true })).toBeVisible();
    await admin.goto(
      `/${slug}/programs/${program.program_id}/boundaries/${boundaryId}`
    );
    await expect(
      admin.getByRole('heading', { name: /Responsibilities on draft revision/ })
    ).toBeVisible();
    await admin
      .getByLabel('Member', { exact: true })
      .selectOption({ label: adminEmail });
    await admin
      .getByLabel('Responsibility', { exact: true })
      .selectOption('control_owner');
    await admin.getByRole('button', { name: 'Check for conflicts' }).click();
    await expect(
      admin.getByRole('status').filter({
        hasText: 'No separation-of-duties conflicts for this assignment.',
      })
    ).toBeVisible();
    const reassigned = admin.waitForResponse(
      apiResponse('POST', /\/api\/v1\/tenants\/[^/]+\/responsibilities$/)
    );
    await admin.getByRole('button', { name: 'Assign responsibility' }).click();
    expect((await reassigned).status()).toBe(204);
    await expect(
      admin.getByRole('status').filter({ hasText: 'Responsibility assigned.' })
    ).toBeVisible();

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
    await founderAssignmentButton.click();
    expect((await revokedAssignment).status()).toBe(204);
    await expect(
      admin.getByRole('status').filter({ hasText: 'Responsibility revoked.' })
    ).toBeVisible();

    await admin.goto(`/${slug}/members/${founderUserId}`);
    await expect(
      admin.getByText('No open responsibilities.', { exact: true })
    ).toBeVisible();
    await admin.goto(`/${slug}/members/${adminUserId}`);
    await expect(
      admin.getByText('Control owner', { exact: false })
    ).toBeVisible();
  } finally {
    await Promise.all([
      founderContext.close(),
      adminContext.close(),
      contributorContext.close(),
    ]);
  }
});
