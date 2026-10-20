// @vitest-environment jsdom
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';
import { ControlExceptionsPage } from './pages/control-exceptions.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const programId = '0190a1b2-0000-7000-8000-0000000000b1';
const controlId = '0190a1b2-0000-7000-8000-0000000000c1';
const draftVersionId = '0190a1b2-0000-7000-8000-0000000000d1';
const memberUserId = '0190a1b2-0000-7000-8000-0000000000e1';
const waiverId = '0190a1b2-0000-7000-8000-0000000000f1';
const base = `/api/v1/tenants/${tenantId}`;
const control = `${base}/programs/${programId}/controls/${controlId}`;
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function mount(component: () => unknown): HTMLElement {
  const result = render(component as never);
  mounted.push(result);
  return result.container;
}

function draftBody(revision = 2) {
  return {
    tenant_id: tenantId,
    program_id: programId,
    control_id: controlId,
    draft_version_id: draftVersionId,
    identifier: 'AC-01',
    revision,
    status: 'draft',
    owner_resolution: 'unresolved',
    applicability_resolution: 'unresolved',
    content: {
      title: 'Access reviews',
      objective: 'Access stays appropriate.',
      description: 'Quarterly access review.',
      implementation_narrative: 'The platform lead reviews access quarterly.',
      expected_evidence_descriptions: ['Signed review'],
      owner_reference: 'Platform lead',
      applicability: [],
    },
    last_changed_by_member_id: 'admin',
    last_changed_by_display: 'Alex Admin',
    last_changed_at: '2026-09-20T00:00:00Z',
  };
}

function waiverBody(approved = false) {
  return {
    tenant_id: tenantId,
    waiver_id: waiverId,
    scope: {
      record_type: 'control',
      record_id: controlId,
      version_id: draftVersionId,
      revision: 2,
      action: 'review',
    },
    beneficiary_member_id: 'member-reviewer',
    requester_member_id: 'member-admin',
    requester_display: 'Alex Admin',
    rationale: 'Only one qualified reviewer this week.',
    requested_at: '2026-09-20T00:00:00Z',
    expires_at: '2099-09-29T23:59:59Z',
    approver_member_id: approved ? 'member-second-admin' : null,
    approver_display: approved ? 'Sam Second' : null,
    approved_at: approved ? '2026-09-21T00:00:00Z' : null,
    status: approved ? 'active' : 'pending',
    active: approved,
  };
}

function memberDirectory() {
  api.reply(`GET ${base}/members`, 200, {
    items: [{ user_id: memberUserId, tenant_id: tenantId, verified_email_address: 'reviewer@example.test', affiliation: 'client_personnel', is_suspended: false }],
    next_cursor: null,
  });
}

function field(container: HTMLElement, label: string) {
  return [...container.querySelectorAll('label')]
    .find((item) => item.querySelector('span')?.textContent === label)!
    .querySelector('input, textarea, select') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
}

function button(container: HTMLElement, label: string) {
  return [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
}

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(async () => {
  clearActiveTenant();
  api = stubApi();
  api.reply('/api/v1/tenant-slugs/acme/mine', 200, { tenant_id: tenantId, current_slug: 'acme', redirect: false });
  api.reply('/api/v1/tenants/mine', 200, { items: [{ tenant_id: tenantId, name: 'Acme Corp', slug: 'acme' }], next_cursor: null });
  await resolveTenantRoute('acme', {
    pathname: `/acme/programs/${programId}/controls/${controlId}/exceptions`,
    search: '',
    hash: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('control draft separation-of-duties exceptions (#28)', () => {
  it('ShouldRecordAnExceptionAgainstTheExactControlDraftRevision', async () => {
    // Arrange
    api.reply(`GET ${control}/draft`, 200, draftBody());
    memberDirectory();
    api.reply(`POST ${base}/separation-of-duties-waivers`, 200, waiverBody());
    api.reply(`GET ${base}/separation-of-duties-waivers/${waiverId}`, 200, waiverBody());
    const container = mount(() => <ControlExceptionsPage programId={programId} controlId={controlId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Applies only to control AC-01 revision 2'));
    expect([...container.querySelectorAll('label')].some((item) => item.textContent?.includes('Member who needs the exception'))).toBe(true);
    const member = field(container, 'Member who needs the exception') as HTMLSelectElement;
    member.value = memberUserId;
    member.dispatchEvent(new Event('change', { bubbles: true }));
    type(field(container, 'Rationale') as HTMLTextAreaElement, 'Only one qualified reviewer this week.');
    type(field(container, 'Expires at the end of') as HTMLInputElement, '2099-09-29');

    // Act
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(container.querySelector('.boundary-waiver')).not.toBeNull());

    // Assert
    const sent = api.bodies.find((body) => body.method === 'POST' && body.path === `${base}/separation-of-duties-waivers`)
      ?.body as { scope: Record<string, unknown>; beneficiary_user_id: string };
    expect(sent.scope).toEqual({
      record_type: 'control',
      record_id: controlId,
      version_id: draftVersionId,
      revision: 2,
      action: 'review',
    });
    expect(sent.beneficiary_user_id).toBe(memberUserId);
    expect(container.querySelector('.boundary-waiver')?.textContent).toContain('control revision 2');
    expect(container.querySelector('.boundary-waiver')?.textContent).toContain('the selected member');
    expect(container.querySelector('.boundary-waiver')?.textContent).not.toContain('member-reviewer');
    expect(api.requested).not.toContain(`${base}/members/${memberUserId}/access`);
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldApproveTheControlExceptionThroughTheTypedEndpoint', async () => {
    // Arrange
    window.history.replaceState(null, '', `/acme/programs/${programId}/controls/${controlId}/exceptions?exception=${waiverId}`);
    api.reply(`GET ${control}/draft`, 200, draftBody());
    memberDirectory();
    api.reply(`GET ${base}/separation-of-duties-waivers/${waiverId}`, 200, waiverBody());
    api.reply(`POST ${base}/separation-of-duties-waivers/${waiverId}/approvals`, 200, waiverBody(true));
    const container = mount(() => <ControlExceptionsPage programId={programId} controlId={controlId} />);
    await vi.waitFor(() => expect(button(container, 'Approve as second administrator')).toBeDefined());

    // Act
    button(container, 'Approve as second administrator')!.click();

    // Assert
    await vi.waitFor(() => expect(container.querySelector('.boundary-waiver')?.textContent).toContain('Sam Second'));
    expect(api.bodies.some((body) => body.method === 'POST' && body.path === `${base}/separation-of-duties-waivers/${waiverId}/approvals`)).toBe(true);
    expect(container.querySelector('.boundary-waiver')?.textContent).toContain('active');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldPreserveTheBackendSeparationOfDutiesDenialOnControlExceptionApproval', async () => {
    // Arrange
    window.history.replaceState(null, '', `/acme/programs/${programId}/controls/${controlId}/exceptions?exception=${waiverId}`);
    api.reply(`GET ${control}/draft`, 200, draftBody());
    memberDirectory();
    api.reply(`GET ${base}/separation-of-duties-waivers/${waiverId}`, 200, waiverBody());
    api.reply(`POST ${base}/separation-of-duties-waivers/${waiverId}/approvals`, 403, {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'A waiver must be approved by a different Org Admin who is not its beneficiary.',
      instance: '/',
    });
    const container = mount(() => <ControlExceptionsPage programId={programId} controlId={controlId} />);
    await vi.waitFor(() => expect(button(container, 'Approve as second administrator')).toBeDefined());

    // Act
    button(container, 'Approve as second administrator')!.click();

    // Assert
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('A waiver must be approved by a different Org Admin'));
    expect(api.bodies.some((body) => body.method === 'POST' && body.path === `${base}/separation-of-duties-waivers/${waiverId}/approvals`)).toBe(true);
  });
});
