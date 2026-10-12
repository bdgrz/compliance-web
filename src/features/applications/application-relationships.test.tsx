// @vitest-environment jsdom
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';
import { ApplicationDetailPage } from './pages/application-detail.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const applicationId = '0190a1b2-0000-7000-8000-0000000000a1';
const targetId = '0190a1b2-0000-7000-8000-0000000000a2';
const relationshipId = '0190a1b2-0000-7000-8000-0000000000b1';
const base = `/api/v1/tenants/${tenantId}`;
const applicationPath = `${base}/applications/${applicationId}`;
const relationshipsPath = `${applicationPath}/relationships`;
const relationshipPath = `${relationshipsPath}/`;
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function mount(): HTMLElement {
  const result = render(() => <ApplicationDetailPage applicationId={applicationId} />);
  mounted.push(result);
  return result.container;
}

function problem(status: number, detail: string, transient = false) {
  return { type: 'about:blank', title: 'Problem', status, detail, instance: '/', transient };
}

function application(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId,
    application_id: id,
    revision: 3,
    name,
    purpose: `Runs ${name}`,
    owner_reference: 'Finance',
    source_kind: 'manual',
    source_identifier: 'manual',
    has_system_instances: false,
    unresolved: [],
    application_kind: 'business system',
    criticality: 'important',
    last_changed_by_member_id: 'm1',
    last_changed_by_display: 'Casey Lead',
    last_changed_at: '2026-10-11T12:00:00Z',
    classification: 'confidential',
    system_owner_person_id: null,
    access_owner_person_id: null,
    lifecycle: 'active',
    retirement: null,
    ...overrides,
  };
}

function relationshipPage(items: unknown[] = [], relationshipRevision = 7) {
  return { relationship_revision: relationshipRevision, items, next_cursor: null };
}

function relationship(overrides: Record<string, unknown> = {}) {
  return {
    relationship_id: relationshipId,
    target_application_id: targetId,
    relationship_type: 'depends_on',
    actor_member_id: 'm2',
    actor_display: 'Riley Admin',
    changed_at: '2026-10-11T14:00:00Z',
    ...overrides,
  };
}

function answerApplicationDetail() {
  api.reply(`GET ${applicationPath}`, 200, application(applicationId, 'Payroll'));
  api.reply(`GET ${applicationPath}/system-instances`, 200, { items: [], next_cursor: null });
  api.reply(`GET ${applicationPath}/revisions`, 200, { items: [], next_cursor: null });
  api.reply(`GET ${base}/applications`, 200, {
    items: [application(applicationId, 'Payroll'), application(targetId, 'Workday')],
    next_cursor: null,
  });
}

beforeEach(async () => {
  clearActiveTenant();
  api = stubApi();
  api.reply('/api/v1/tenant-slugs/acme/mine', 200, { tenant_id: tenantId, current_slug: 'acme', redirect: false });
  api.reply('/api/v1/tenants/mine', 200, { items: [{ tenant_id: tenantId, name: 'Acme Corp', slug: 'acme' }], next_cursor: null });
  await resolveTenantRoute('acme', { pathname: '/acme/applications', search: '', hash: '' });
  answerApplicationDetail();
  api.reply(`GET ${base}/people`, 200, { items: [], next_cursor: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('application relationships (#27)', () => {
  it('ShouldListOutgoingRelationshipsGivenAnApplicationHasRelationships', async () => {
    // Arrange
    api.reply(`GET ${relationshipsPath}`, 200, relationshipPage([relationship()]));

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Riley Admin'));

    // Assert
    expect(container.textContent).toContain('Application relationships');
    expect(container.textContent).toContain('Depends on');
    expect(container.textContent).toContain('Riley Admin');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldAddRelationshipAgainstObservedRevisionGivenAnAuthorizedMember', async () => {
    // Arrange
    api.reply(`GET ${relationshipsPath}`, 200, relationshipPage([], 0));
    const refreshed = relationshipPage([relationship({ relationship_type: 'replaces' })], 1);
    api.reply(`GET ${relationshipsPath}?minimum_revision=1`, 200, refreshed);
    api.reply(`GET ${base}/applications`, 200, {
      items: [application(applicationId, 'Payroll'), application(targetId, 'Workday', { lifecycle: 'retired' })],
      next_cursor: null,
    });
    api.reply(`POST ${relationshipsPath}/*`, 200, {
      relationship_id: relationshipId,
      relationship_revision: 1,
      state: 'active',
    });

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Application relationships'));
    expect(container.textContent).toContain('No application relationships have been recorded.');
    await vi.waitFor(() => expect(container.querySelector(`select[aria-label="Related application"] option[value="${targetId}"]`)).not.toBeNull());
    const target = container.querySelector('select[aria-label="Related application"]') as HTMLSelectElement;
    target.value = targetId;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    const type = container.querySelector('select[aria-label="Relationship type"]') as HTMLSelectElement;
    type.value = 'replaces';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    container.querySelector('form[aria-label="Add application relationship"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(api.bodies.some((request) => request.method === 'POST' && request.path.startsWith(relationshipPath))).toBe(true));

    // Assert
    expect(api.bodies.find((request) => request.method === 'POST' && request.path.startsWith(relationshipPath))?.body)
      .toEqual({ expected_relationship_revision: 0, target_application_id: targetId, relationship_type: 'replaces' });
    await vi.waitFor(() => expect(container.textContent).toContain('Riley Admin'));
    const refreshRequest = api.requestUrls.find((request) => {
      if (request.method !== 'GET' || new URL(request.url).pathname !== relationshipsPath) return false;
      return new URL(request.url).searchParams.get('minimum_revision') === '1';
    });
    expect(refreshRequest).toBeDefined();
    expect(refreshed.relationship_revision).toBeGreaterThanOrEqual(1);
  });

  it('ShouldRemoveRelationshipAgainstObservedRevisionGivenAnAuthorizedMember', async () => {
    // Arrange
    api.reply(`GET ${relationshipsPath}`, 200, relationshipPage([relationship()]));
    const refreshed = relationshipPage([], 8);
    api.reply(`GET ${relationshipsPath}?minimum_revision=8`, 200, refreshed);
    api.reply(`DELETE ${relationshipsPath}/${relationshipId}`, 200, {
      relationship_id: relationshipId,
      relationship_revision: 8,
      state: 'removed',
    });

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Riley Admin'));
    const remove = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Remove relationship'))!;
    remove.click();
    await vi.waitFor(() => expect(api.bodies.some((request) => request.method === 'DELETE' && request.path === `${relationshipsPath}/${relationshipId}`)).toBe(true));

    // Assert
    const removeRequest = api.requestUrls.find((request) => request.method === 'DELETE' && request.url.startsWith(`http://app.test${relationshipsPath}/${relationshipId}?`));
    expect(removeRequest).toBeDefined();
    expect(new URL(removeRequest!.url).searchParams.get('expected_relationship_revision')).toBe('7');
    expect(api.bodies.find((request) => request.method === 'DELETE' && request.path === `${relationshipsPath}/${relationshipId}`)?.body).toBeUndefined();
    await vi.waitFor(() => expect(container.textContent).toContain('No application relationships have been recorded.'));
    const refreshRequest = api.requestUrls.find((request) => {
      if (request.method !== 'GET' || new URL(request.url).pathname !== relationshipsPath) return false;
      return new URL(request.url).searchParams.get('minimum_revision') === '8';
    });
    expect(refreshRequest).toBeDefined();
    expect(refreshed.relationship_revision).toBeGreaterThanOrEqual(8);
  });

  it('ShouldExplainForbiddenGivenTheMemberCannotManageRelationships', async () => {
    // Arrange
    api.reply(`GET ${relationshipsPath}`, 403, problem(403, 'Application relationships are not available to you.'));

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.textContent).toContain('You do not have permission'));

    // Assert
    expect(container.textContent).toContain('do not have permission');
    expect(container.querySelector('form[aria-label="Add application relationship"]')).toBeNull();
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldRetryRelatedApplicationLoadingGivenTheCandidateListFails', async () => {
    // Arrange
    api.reply(`GET ${relationshipsPath}`, 200, relationshipPage([relationship()]));
    api.reply(`GET ${base}/applications`, 500, problem(500, 'The application list is temporarily unavailable.'));

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Related applications could not be loaded.'));
    expect(container.textContent).toContain('Riley Admin');
    expect(container.textContent).not.toContain('No other visible applications are available to link.');
    expect(container.querySelector('form[aria-label="Add application relationship"]')).toBeNull();
    api.reply(`GET ${base}/applications`, 200, {
      items: [application(applicationId, 'Payroll'), application(targetId, 'Workday', { lifecycle: 'retired' })],
      next_cursor: null,
    });
    [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry related applications')!.click();
    await vi.waitFor(() => expect(container.querySelector(`select[aria-label="Related application"] option[value="${targetId}"]`)).not.toBeNull());

    // Assert
    expect(container.querySelector('form[aria-label="Add application relationship"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Related applications could not be loaded.');
  });

  it('ShouldKeepRelationshipsReadOnlyGivenTheSourceApplicationIsRetired', async () => {
    // Arrange
    api.reply(`GET ${applicationPath}`, 200, application(applicationId, 'Payroll', { lifecycle: 'retired' }));
    api.reply(`GET ${relationshipsPath}`, 200, relationshipPage([relationship()]));

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.textContent).toContain('Riley Admin'));

    // Assert
    expect(container.querySelector('form[aria-label="Add application relationship"]')).toBeNull();
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Remove relationship')).toBe(false);
  });

  it('ShouldOfferRefreshGivenAddingAgainstAStaleRelationshipRevision', async () => {
    // Arrange
    api.reply(`GET ${relationshipsPath}`, 200, relationshipPage([], 0));
    api.reply(`POST ${relationshipsPath}/*`, 409, problem(409, 'The application relationship revision is stale.'));

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.querySelector(`select[aria-label="Related application"] option[value="${targetId}"]`)).not.toBeNull());
    const target = container.querySelector('select[aria-label="Related application"]') as HTMLSelectElement;
    target.value = targetId;
    target.dispatchEvent(new Event('change', { bubbles: true }));
    container.querySelector('form[aria-label="Add application relationship"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(container.textContent).toContain('Someone else changed these relationships'));

    // Assert
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Refresh relationships')).toBe(true);
  });

  it('ShouldOfferRefreshGivenTheRelationshipSnapshotIsStale', async () => {
    // Arrange
    api.reply(`GET ${relationshipsPath}`, 409, problem(409, 'The application relationships changed; restart paging.'));

    // Act
    const container = mount();
    await vi.waitFor(() => expect(container.textContent).toContain('The relationship list changed'));

    // Assert
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Try again')).toBe(true);
  });
});
