// @vitest-environment jsdom
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { CreateTenantPage } from './pages/create-tenant.js';
import { SelectTenantPage } from './pages/select-tenant.js';
import { clearActiveTenant, currentTenant, readRememberedSlug } from './tenants.js';

const userId = '0190a1b2-0000-7000-8000-0000000000a1';
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function mount(component: () => unknown): HTMLElement {
  const result = render(component as never);
  mounted.push(result);
  return result.container;
}

function setField(container: Element, label: string, value: string) {
  const input = [...container.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))!
    .querySelector('input') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function noMemberships() {
  api.reply('/api/v1/tenants/mine', 200, { items: [], next_cursor: null });
}

function emails(verified: boolean) {
  api.reply(`/api/v1/users/${userId}/email-addresses`, 200, {
    items: [{ user_id: userId, email_address: 'casey@acme.test', verified }],
    next_cursor: null,
  });
}

beforeEach(() => {
  clearActiveTenant();
  api = stubApi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('no-access state (R1-15 frontend #176)', () => {
  it('ShouldOfferCreationGivenAVerifiedEmail', async () => {
    // Arrange
    noMemberships();
    emails(true);

    // Act
    const container = mount(() => <SelectTenantPage userId={userId} />);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Your email address is verified')
    );

    // Assert
    expect(
      container.querySelector('a[href="/organizations/new"]')
    ).not.toBeNull();
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldExplainVerificationAndHideCreationGivenNoVerifiedEmail', async () => {
    // Arrange
    noMemberships();
    emails(false);

    // Act
    const container = mount(() => <SelectTenantPage userId={userId} />);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('verify an email address you own')
    );

    // Assert
    expect(container.querySelector('a[href="/organizations/new"]')).toBeNull();
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldOfferOrganizationCreationGivenCompletedEmailProof', async () => {
    // Arrange
    noMemberships();
    emails(false);
    const path = `/api/v1/users/${userId}/email-addresses/casey%40acme.test`;
    api.reply(`POST ${path}`, 204);
    api.reply(`POST ${path}/challenges`, 204);
    api.reply(`${path}/challenges/status`, 200, {
      delivery_status: 'delivered',
      expires_at: '2026-10-02T00:15:00Z',
    });
    api.reply(`POST ${path}/verifications`, 204);
    const container = mount(() => <SelectTenantPage userId={userId} />);
    await vi.waitFor(() =>
      expect(container.querySelector('input[type="email"]')).not.toBeNull()
    );

    // Act
    setField(container, 'Email address', 'casey@acme.test');
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Verification code')
    );
    setField(container, 'Verification code', 'proof-from-mailbox');
    emails(true);
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Assert
    await vi.waitFor(() =>
      expect(
        container.querySelector('a[href="/organizations/new"]')
      ).not.toBeNull()
    );
    expect(
      api.bodies.find((b) => b.path === `${path}/verifications`)?.body
    ).toEqual({ token: 'proof-from-mailbox' });
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldKeepCreationUnavailableGivenFailedEmailDeliveryAndAllowRetry', async () => {
    // Arrange
    noMemberships();
    emails(false);
    const path = `/api/v1/users/${userId}/email-addresses/casey%40acme.test`;
    api.reply(`POST ${path}`, 204);
    api.reply(`POST ${path}/challenges`, 204);
    api.reply(`${path}/challenges/status`, 200, {
      delivery_status: 'failed',
      expires_at: null,
    });
    const container = mount(() => <SelectTenantPage userId={userId} />);
    await vi.waitFor(() =>
      expect(container.querySelector('input[type="email"]')).not.toBeNull()
    );
    setField(container, 'Email address', 'casey@acme.test');

    // Act
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('could not be delivered')
    );
    api.reply(`${path}/challenges/status`, 200, {
      delivery_status: 'delivered',
      expires_at: null,
    });
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Send a new code')!
      .click();

    // Assert
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Check your email')
    );
    expect(
      api.bodies.filter(
        (b) => b.method === 'POST' && b.path === `${path}/challenges`
      )
    ).toHaveLength(2);
    expect(container.querySelector('a[href="/organizations/new"]')).toBeNull();
  });

  it('ShouldRetainProofFormGivenInvalidCodeAndRefreshAccessGivenProjectionLag', async () => {
    // Arrange
    noMemberships();
    emails(false);
    const path = `/api/v1/users/${userId}/email-addresses/casey%40acme.test`;
    api.reply(`POST ${path}`, 204);
    api.reply(`POST ${path}/challenges`, 204);
    api.reply(`${path}/challenges/status`, 200, {
      delivery_status: 'delivered',
      expires_at: null,
    });
    api.reply(`POST ${path}/verifications`, 400, {
      detail: 'The verification code is invalid or expired.',
    });
    const container = mount(() => <SelectTenantPage userId={userId} />);
    await vi.waitFor(() =>
      expect(container.querySelector('input[type="email"]')).not.toBeNull()
    );
    setField(container, 'Email address', 'casey@acme.test');
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Verification code')
    );

    // Act
    setField(container, 'Verification code', 'invalid');
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'invalid or expired'
      )
    );
    expect(container.querySelector('a[href="/organizations/new"]')).toBeNull();
    api.reply(`POST ${path}/verifications`, 204);
    setField(container, 'Verification code', 'mailbox-proof');
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'Organization access may take a moment'
      )
    );
    emails(true);
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Refresh organization access')!
      .click();

    // Assert
    await vi.waitFor(() =>
      expect(
        container.querySelector('a[href="/organizations/new"]')
      ).not.toBeNull()
    );
    expect(
      container.querySelector('input[autocomplete="one-time-code"]')
    ).toBeNull();
  });
});

describe('self-service organization creation (R1-15 frontend #176)', () => {
  const tenant = { tenant_id: 't1', slug: 'acme' };
  const resolutionPath = '/api/v1/tenant-slugs/acme/mine';
  const workspacePath = '/api/v1/tenants/t1';

  function creationForm() {
    const container = mount(CreateTenantPage);
    setField(container, 'Name', 'Acme');
    setField(container, 'Legal name', ' Acme Corporation Inc. ');
    setField(container, 'Slug', 'acme');
    return container;
  }

  function submit(container: Element) {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }

  function statusButton(container: Element) {
    return [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('status')
    )!;
  }

  function ready() {
    api.reply(resolutionPath, 200, {
      tenant_id: tenant.tenant_id,
      current_slug: tenant.slug,
      redirect: false,
    });
    api.reply('/api/v1/tenants/mine', 200, {
      items: [{ ...tenant, name: 'Acme' }],
      next_cursor: null,
    });
    api.reply(workspacePath, 200, { ...tenant, name: 'Acme' });
  }

  function registrations() {
    return api.bodies.filter(
      (body) => body.method === 'POST' && body.path === '/api/v1/tenants'
    );
  }

  function holdResponse(path: string) {
    const fetch = globalThis.fetch;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = vi.fn();
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const response = await fetch(input, init);
        if (
          new URL(request.url).pathname === path &&
          held.mock.calls.length === 0
        ) {
          held(request);
          await gate;
        }
        return response;
      }
    );
    return { held, release };
  }

  it('ShouldKeepTheAcceptedOrganizationPendingGivenItsSlugIsNotReady', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, { tenant_id: 't1', slug: 'acme' });
    api.reply('/api/v1/tenant-slugs/acme/mine', 404);
    const container = mount(CreateTenantPage);
    setField(container, 'Name', 'Acme');
    setField(container, 'Legal name', 'Acme Corporation Inc.');
    setField(container, 'Slug', 'acme');

    // Act
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        'still getting ready'
      )
    );

    // Assert
    expect(assign).not.toHaveBeenCalled();
    expect(api.requested).toEqual(['/api/v1/tenants', resolutionPath]);
    expect(registrations()).toHaveLength(1);
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldRegisterWithALegalNameAndOpenTheOrganization', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, { tenant_id: 't1', slug: 'acme' });
    ready();
    const container = mount(CreateTenantPage);
    setField(container, 'Name', 'Acme');
    setField(container, 'Legal name', ' Acme Corporation Inc. ');
    setField(container, 'Slug', 'acme');

    // Act
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/acme'));

    // Assert
    expect(api.bodies.find((b) => b.path === '/api/v1/tenants')?.body).toEqual({
      name: 'Acme',
      slug: 'acme',
      legal_name: 'Acme Corporation Inc.',
    });
    expect(container.textContent).toContain('first Org Admin');
    expect(api.requested).toEqual([
      '/api/v1/tenants',
      resolutionPath,
      '/api/v1/tenants/mine',
      workspacePath,
    ]);
    expect(currentTenant()).toBeNull();
    expect(readRememberedSlug()).toBeNull();
  });

  it('ShouldRetainTheReturnedIdentityGivenStatusRetriesAndEditedFields', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, {
      tenant_id: 'registered-id',
      slug: 'registered-acme',
    });
    const container = creationForm();
    submit(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('still getting ready')
    );
    api.reply('/api/v1/tenant-slugs/registered-acme/mine', 200, {
      tenant_id: 'registered-id',
      current_slug: 'registered-acme',
      redirect: false,
    });
    api.reply('/api/v1/tenants/mine', 200, {
      items: [
        { tenant_id: 'registered-id', slug: 'registered-acme', name: 'Acme' },
      ],
      next_cursor: null,
    });
    api.reply('/api/v1/tenants/registered-id', 200, {
      tenant_id: 'registered-id',
      slug: 'registered-acme',
      name: 'Acme',
    });

    // Act
    setField(container, 'Slug', 'changed-slug');
    submit(container);
    statusButton(container).click();

    // Assert
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith('/registered-acme')
    );
    expect(registrations()).toHaveLength(1);
    expect(api.requested).not.toContain(
      '/api/v1/tenant-slugs/changed-slug/mine'
    );
    expect(currentTenant()).toBeNull();
    expect(readRememberedSlug()).toBeNull();
  });

  it('ShouldWaitForSelectableMembershipGivenTheSlugIsReady', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, tenant);
    ready();
    noMemberships();
    const container = creationForm();

    // Act
    submit(container);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('still getting ready')
    );

    // Assert
    expect(assign).not.toHaveBeenCalled();
    expect(api.requested).not.toContain(workspacePath);
    expect(currentTenant()).toBeNull();
    ready();
    statusButton(container).click();
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith('/acme')
    );
    expect(registrations()).toHaveLength(1);
  });

  it.each([
    { tenant_id: 'other-id', current_slug: 'acme', redirect: false },
    { tenant_id: 't1', current_slug: 'other-slug', redirect: false },
    { tenant_id: 't1', current_slug: 'acme', redirect: true },
  ])(
    'ShouldRejectResolutionGivenAMismatchedRegisteredIdentity %j',
    async (resolution) => {
      // Arrange
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign });
      api.reply('POST /api/v1/tenants', 200, tenant);
      ready();
      api.reply(resolutionPath, 200, resolution);
      const container = creationForm();

      // Act
      submit(container);
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')).not.toBeNull()
      );

      // Assert
      expect(assign).not.toHaveBeenCalled();
      expect(api.requested).not.toContain('/api/v1/tenants/mine');
      expect(statusButton(container).disabled).toBe(false);
      expect(currentTenant()).toBeNull();
      expect(readRememberedSlug()).toBeNull();
    }
  );

  it('ShouldRejectReadinessGivenAMembershipForADifferentSlug', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, tenant);
    ready();
    api.reply('/api/v1/tenants/mine', 200, {
      items: [{ ...tenant, name: 'Acme', slug: 'other-slug' }],
      next_cursor: null,
    });
    const container = creationForm();

    // Act
    submit(container);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    );

    // Assert
    expect(assign).not.toHaveBeenCalled();
    expect(api.requested).not.toContain(workspacePath);
  });

  it.each([403, 404, 503])(
    'ShouldAllowReadOnlyRetryGivenPrivateReadFailure %s',
    async (status) => {
      // Arrange
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign });
      api.reply('POST /api/v1/tenants', 200, tenant);
      ready();
      api.reply(workspacePath, status);
      const container = creationForm();

      // Act
      submit(container);
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')).not.toBeNull()
      );

      // Assert
      expect(assign).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'could not confirm it is ready yet'
      );
      expect(await accessibilityViolations(container)).toEqual([]);
      ready();
      statusButton(container).click();
      await vi.waitFor(() =>
        expect(assign).toHaveBeenCalledExactlyOnceWith('/acme')
      );
      expect(registrations()).toHaveLength(1);
    }
  );

  it.each([
    { tenant_id: 'other-id', slug: 'acme', name: 'Other' },
    { tenant_id: 't1', slug: 'other-slug', name: 'Other' },
    null,
  ])(
    'ShouldRejectReadinessGivenAnUnexpectedPrivateTenant %j',
    async (workspace) => {
      // Arrange
      const assign = vi.fn();
      vi.stubGlobal('location', { ...window.location, assign });
      api.reply('POST /api/v1/tenants', 200, tenant);
      ready();
      api.reply(workspacePath, 200, workspace);
      const container = creationForm();

      // Act
      submit(container);
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')).not.toBeNull()
      );

      // Assert
      expect(assign).not.toHaveBeenCalled();
      expect(currentTenant()).toBeNull();
      expect(readRememberedSlug()).toBeNull();
    }
  );

  it('ShouldPreserveCreationAndRetryGivenATransportFailure', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, tenant);
    ready();
    const fetch = globalThis.fetch;
    let failed = false;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname === resolutionPath && !failed) {
        failed = true;
        return Promise.reject(new TypeError('Network unavailable'));
      }
      return fetch(input, init);
    });
    const container = creationForm();

    // Act
    submit(container);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    );

    // Assert
    expect(assign).not.toHaveBeenCalled();
    statusButton(container).click();
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith('/acme')
    );
    expect(registrations()).toHaveLength(1);
  });

  it('ShouldBlockDuplicateActionsGivenRegistrationAndStatusChecksInFlight', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, tenant);
    const registration = holdResponse('/api/v1/tenants');
    const container = creationForm();

    // Act
    submit(container);
    submit(container);
    await vi.waitFor(() => expect(registration.held).toHaveBeenCalledOnce());
    expect(registrations()).toHaveLength(1);
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Creating'
    );
    registration.release();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('still getting ready')
    );
    const check = holdResponse(resolutionPath);
    const button = statusButton(container);
    button.dispatchEvent(new Event('click', { bubbles: true }));
    button.dispatchEvent(new Event('click', { bubbles: true }));
    submit(container);
    await vi.waitFor(() => expect(check.held).toHaveBeenCalledOnce());

    // Assert
    expect(
      api.requested.filter((path) => path === resolutionPath)
    ).toHaveLength(2);
    expect(registrations()).toHaveLength(1);
    expect(statusButton(container).disabled).toBe(true);
    check.release();
    await vi.waitFor(() =>
      expect(container.textContent).toContain('still getting ready')
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('ShouldBoundTheWholeCheckAndIgnoreLateSuccessGivenTheDeadlineExpires', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.reply('POST /api/v1/tenants', 200, tenant);
    ready();
    const resolution = holdResponse(resolutionPath);
    const workspace = holdResponse(workspacePath);
    vi.useFakeTimers();
    const container = creationForm();

    // Act
    submit(container);
    await vi.waitFor(() => expect(resolution.held).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(6_000);
    resolution.release();
    await vi.waitFor(() => expect(workspace.held).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    );
    vi.useRealTimers();

    // Assert
    expect(assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'could not confirm it is ready yet'
    );
    expect(container.textContent).not.toContain('provisioning failed');
    expect((workspace.held.mock.calls[0]![0] as Request).signal.aborted).toBe(
      true
    );
    workspace.release();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(assign).not.toHaveBeenCalled();
    expect(currentTenant()).toBeNull();
    expect(readRememberedSlug()).toBeNull();
    statusButton(container).click();
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledExactlyOnceWith('/acme')
    );
    expect(registrations()).toHaveLength(1);
  });

  it('ShouldKeepRequiredFieldsAndRejectMalformedSlugsGivenInvalidInput', () => {
    // Arrange
    const container = creationForm();
    setField(container, 'Slug', 'Invalid_Slug');

    // Act
    submit(container);

    // Assert
    expect(container.querySelectorAll('input[required]')).toHaveLength(3);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'slug must be 4-63 characters'
    );
    expect(api.requested).toEqual([]);
  });

  it('ShouldExplainTheVerifiedEmailRequirementGivenForbidden', async () => {
    // Arrange
    api.reply('POST /api/v1/tenants', 403, {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail:
        'Verify an email address you own before creating an organization.',
      instance: '/',
    });
    const container = mount(CreateTenantPage);
    setField(container, 'Name', 'Acme');
    setField(container, 'Legal name', 'Acme Corporation Inc.');
    setField(container, 'Slug', 'acme');

    // Act
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    );

    // Assert
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Verify an email address you own'
    );
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldShowTheServerValidationReason', async () => {
    // Arrange
    api.reply('POST /api/v1/tenants', 409, {
      type: 'about:blank',
      title: 'Conflict',
      status: 409,
      detail: 'The slug is already taken.',
      instance: '/',
    });
    const container = mount(CreateTenantPage);
    setField(container, 'Name', 'Acme');
    setField(container, 'Legal name', 'Acme Corporation Inc.');
    setField(container, 'Slug', 'acme');

    // Act
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    );

    // Assert
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'The slug is already taken.'
    );
  });
});
