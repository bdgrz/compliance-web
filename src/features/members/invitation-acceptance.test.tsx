// @vitest-environment jsdom
import { resolveRouteRequest } from '@askrjs/askr/router';
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { pageRegistry } from '../../pages/_routes.js';
import { stubApi } from '../../test-support/api-stub.js';
import { OrganizationLayout } from '../tenants/organization-layout.js';
import {
  clearActiveTenant,
  currentTenant,
  readEmailVerification,
  resolveTenantRoute,
} from '../tenants/tenants.js';
import { AcceptInvitationPage } from './pages/accept-invitation.js';

const path = '/organizations/invitations/accept';
const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const unrelatedTenantId = '0190a1b2-0000-7000-8000-000000000002';
const userId = '0190a1b2-0000-7000-8000-0000000000a1';
const acceptance = `/api/v1/tenants/${tenantId}/invitations/acceptance`;
const invitedEmail = 'invited@example.test';
const invitationCode = 'secret-invitation-code';
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function mount(component: () => unknown): HTMLElement {
  const result = render(component as never);
  mounted.push(result);
  return result.container;
}

function field(container: Element, label: string): HTMLInputElement {
  return [...container.querySelectorAll('label')]
    .find((element) => element.querySelector('span')?.textContent === label)!
    .querySelector('input')!;
}

function setField(container: Element, label: string, value: string) {
  const input = field(container, label);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function fillInvitation(container: Element) {
  setField(container, 'Organization ID', tenantId);
  setField(container, 'Invited email address', invitedEmail);
  setField(container, 'Invitation code', invitationCode);
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  clearActiveTenant();
  api = stubApi();
});

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.cleanup();
  clearActiveTenant();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('personal invitation acceptance (web #18)', () => {
  it('ShouldRequireSignInAndPreserveTheReturnPathGivenAnAnonymousRecipient', async () => {
    // Arrange
    const authContext = {
      authenticated: false,
      principal: null,
      session: null,
      tenant: null,
      scopes: [],
    };

    // Act
    const result = await resolveRouteRequest(path, {
      registry: pageRegistry,
      authContext,
    });

    // Assert
    expect(result).toMatchObject({
      kind: 'redirect',
      to: `/login?next=${encodeURIComponent(path)}`,
    });
    expect(api.requested).toEqual([]);
  });

  it('ShouldReachAcceptanceOutsideTheOrganizationLayoutGivenNoMemberships', async () => {
    // Arrange
    const authContext = {
      authenticated: true,
      principal: { id: userId, subject: userId },
      session: null,
      tenant: null,
      scopes: [],
    };
    api.reply('/api/v1/tenants/mine', 200, { items: [], next_cursor: null });

    // Act
    const result = await resolveRouteRequest(path, {
      registry: pageRegistry,
      authContext,
    });
    expect(result?.kind).toBe('render');
    if (result?.kind !== 'render')
      throw new Error('Expected the invitation page.');
    const container = mount(() => result.handler(result.params));
    await vi.waitFor(() =>
      expect(container.querySelector('h1')?.textContent).toBe(
        'Accept an organization invitation'
      )
    );

    // Assert
    expect(result.record?.path).toBe(path);
    expect(
      result.record?.layoutChain.map((layout) => layout.component)
    ).not.toContain(OrganizationLayout);
    expect(field(container, 'Organization ID')).not.toBeNull();
    expect(container.textContent).toContain('Verify the invited email address');
    expect(currentTenant()).toBeNull();
    expect(api.requested).not.toContain('/api/v1/tenants/mine');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldPostExactlyTheEnteredInvitationGivenAnUnrelatedActiveOrganization', async () => {
    // Arrange
    api.reply('/api/v1/tenant-slugs/other/mine', 200, {
      tenant_id: unrelatedTenantId,
      current_slug: 'other',
      redirect: false,
    });
    api.reply('/api/v1/tenants/mine', 200, {
      items: [
        {
          tenant_id: unrelatedTenantId,
          name: 'Other organization',
          slug: 'other',
        },
      ],
      next_cursor: null,
    });
    await resolveTenantRoute('other', {
      pathname: '/other',
      search: '',
      hash: '',
    });
    api.reply(`POST ${acceptance}`, 204);
    const container = mount(() => <AcceptInvitationPage userId={userId} />);
    fillInvitation(container);
    const requestedBeforeSubmit = api.requested.length;

    // Act
    submit(container.querySelector('form')!);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'Your invitation acceptance was received'
      )
    );

    // Assert
    expect(api.bodies.filter((request) => request.method === 'POST')).toEqual([
      {
        method: 'POST',
        path: acceptance,
        body: { email_address: invitedEmail, token: invitationCode },
      },
    ]);
    expect(api.requested.slice(requestedBeforeSubmit)).toEqual([acceptance]);
    expect(currentTenant()?.tenantId).toBe(unrelatedTenantId);
    expect(container.textContent).not.toContain('Org Admin');
    expect(container.querySelector('a[href="/organizations"]')).not.toBeNull();
  });

  it('ShouldClearTheSecretAndShowOnlyAReceiptGivenAcceptedCommandWithoutMemberships', async () => {
    // Arrange
    api.reply(`POST ${acceptance}`, 204);
    const localWrites = vi.spyOn(window.localStorage, 'setItem');
    const sessionWrites = vi.spyOn(window.sessionStorage, 'setItem');
    const originalHref = window.location.href;
    const container = mount(() => <AcceptInvitationPage userId={userId} />);
    fillInvitation(container);

    // Act
    submit(container.querySelector('form')!);
    await vi.waitFor(() =>
      expect(field(container, 'Invitation code').value).toBe('')
    );

    // Assert
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Your invitation acceptance was received'
    );
    expect(container.textContent).toContain(
      'Organization access may take a moment to update'
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      container.querySelector('a[href="/organizations"]')?.textContent
    ).toBe('Check your organizations');
    expect(
      [...container.querySelectorAll('a')].map((link) =>
        link.getAttribute('href')
      )
    ).toEqual(['/organizations']);
    expect(field(container, 'Invitation code').disabled).toBe(true);
    expect(currentTenant()).toBeNull();
    expect(window.location.href).toBe(originalHref);
    expect(localWrites).not.toHaveBeenCalled();
    expect(sessionWrites).not.toHaveBeenCalled();
    expect(api.requested).toEqual([acceptance]);
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it.each([
    [400, 'Check the organization ID'],
    [403, 'Verify the invited email address on this signed-in account'],
    [409, 'It may have expired or been replaced'],
    [503, 'The invitation request could not be completed'],
  ])(
    'ShouldKeepTheFormUsableAndAllowRetryGivenServerStatus%s',
    async (status, message) => {
      // Arrange
      api.reply(`POST ${acceptance}`, status, {
        detail: `Do not echo ${invitationCode}`,
      });
      const container = mount(() => <AcceptInvitationPage userId={userId} />);
      fillInvitation(container);

      // Act
      submit(container.querySelector('form')!);
      await vi.waitFor(() =>
        expect(
          container.querySelector('[role="alert"]')?.textContent
        ).toContain(message)
      );

      // Assert
      expect(container.textContent).not.toContain(
        'Your invitation acceptance was received'
      );
      expect(container.textContent).not.toContain(invitationCode);
      expect(field(container, 'Invitation code').value).toBe(invitationCode);
      expect(field(container, 'Organization ID').disabled).toBe(false);
      expect(
        container.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled
      ).toBe(false);
      expect(currentTenant()).toBeNull();

      // Act
      api.reply(`POST ${acceptance}`, 204);
      setField(container, 'Invitation code', 'current-invitation-code');
      submit(container.querySelector('form')!);
      await vi.waitFor(() =>
        expect(container.textContent).toContain(
          'Your invitation acceptance was received'
        )
      );

      // Assert
      expect(
        api.bodies.filter((request) => request.path === acceptance)
      ).toHaveLength(2);
      expect(api.bodies.at(-1)?.body).toEqual({
        email_address: invitedEmail,
        token: 'current-invitation-code',
      });
      expect(field(container, 'Invitation code').value).toBe('');
      expect(container.querySelector('[role="alert"]')).toBeNull();
    }
  );

  it('ShouldAllowRetryGivenATransportFailure', async () => {
    // Arrange
    api.reply(`POST ${acceptance}`, 204);
    const transport = globalThis.fetch;
    const requests = vi
      .fn(transport)
      .mockRejectedValueOnce(new TypeError('Network unavailable'));
    vi.stubGlobal('fetch', requests);
    const container = mount(() => <AcceptInvitationPage userId={userId} />);
    fillInvitation(container);

    // Act
    submit(container.querySelector('form')!);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'Try again'
      )
    );

    // Assert
    expect(field(container, 'Invitation code').disabled).toBe(false);
    expect(container.textContent).not.toContain(
      'Your invitation acceptance was received'
    );

    // Act
    submit(container.querySelector('form')!);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'Your invitation acceptance was received'
      )
    );

    // Assert
    expect(requests).toHaveBeenCalledTimes(2);
    expect(field(container, 'Invitation code').value).toBe('');
  });

  it('ShouldSendOnlyOneRequestGivenDuplicateSubmissionsWhilePendingOrAccepted', async () => {
    // Arrange
    let finish!: (response: Response) => void;
    const completion = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const requests = vi.fn<typeof fetch>(() => completion);
    vi.stubGlobal('fetch', requests);
    const container = mount(() => <AcceptInvitationPage userId={userId} />);
    fillInvitation(container);
    const form = container.querySelector('form')!;

    // Act
    submit(form);
    submit(form);
    await vi.waitFor(() =>
      expect(field(container, 'Invitation code').disabled).toBe(true)
    );

    // Assert
    expect(requests).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Accepting…');
    expect(new URL((requests.mock.calls[0]![0] as Request).url).search).toBe(
      ''
    );

    // Act
    finish(new Response(null, { status: 204 }));
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'Your invitation acceptance was received'
      )
    );
    submit(form);

    // Assert
    expect(requests).toHaveBeenCalledTimes(1);
    expect(field(container, 'Invitation code').value).toBe('');
  });

  it('ShouldNotRestoreInvitationSecretsGivenANewPageMount', () => {
    // Arrange
    const localWrites = vi.spyOn(window.localStorage, 'setItem');
    const sessionWrites = vi.spyOn(window.sessionStorage, 'setItem');
    const container = mount(() => <AcceptInvitationPage userId={userId} />);
    fillInvitation(container);

    // Act
    mounted.pop()?.cleanup();
    const nextPage = mount(() => <AcceptInvitationPage userId={userId} />);

    // Assert
    expect(field(nextPage, 'Invitation code').value).toBe('');
    expect(
      field(nextPage, 'Invitation code').getAttribute('autocomplete')
    ).toBe('off');
    expect(nextPage.querySelector('form')?.method).toBe('post');
    expect(field(nextPage, 'Organization ID').value).toBe('');
    expect(localWrites).not.toHaveBeenCalled();
    expect(sessionWrites).not.toHaveBeenCalled();
    expect(api.requested).toEqual([]);
  });

  it('ShouldReuseEmailVerificationForTheInvitedAddressGivenAnotherVerifiedAddress', async () => {
    // Arrange
    api.reply(`/api/v1/users/${userId}/email-addresses`, 200, {
      items: [
        {
          user_id: userId,
          email_address: 'other@example.test',
          verified: true,
        },
      ],
      next_cursor: null,
    });
    expect(await readEmailVerification(userId)).toBe('verified');
    const emailPath = `/api/v1/users/${userId}/email-addresses/invited%40example.test`;
    api.reply(`POST ${emailPath}`, 204);
    api.reply(`POST ${emailPath}/challenges`, 204);
    api.reply(`${emailPath}/challenges/status`, 200, {
      delivery_status: 'delivered',
    });
    api.reply(`POST ${emailPath}/verifications`, 204);
    api.reply(`POST ${acceptance}`, 204);
    const container = mount(() => <AcceptInvitationPage userId={userId} />);
    fillInvitation(container);
    const verificationForm = container.querySelectorAll('form')[1]!;

    // Act
    setField(verificationForm, 'Email address', invitedEmail);
    submit(verificationForm);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Verification code')
    );
    setField(verificationForm, 'Verification code', 'mailbox-proof');
    submit(verificationForm);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Your email address is verified')
    );

    // Assert
    expect(
      api.bodies.find(
        (request) => request.path === `${emailPath}/verifications`
      )?.body
    ).toEqual({ token: 'mailbox-proof' });
    expect(api.requested).not.toContain(acceptance);
    expect(field(container, 'Invitation code').value).toBe(invitationCode);

    // Act
    submit(container.querySelector('form')!);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'Your invitation acceptance was received'
      )
    );

    // Assert
    expect(
      api.bodies.find((request) => request.path === acceptance)?.body
    ).toEqual({ email_address: invitedEmail, token: invitationCode });
    expect(currentTenant()).toBeNull();
  });
});
