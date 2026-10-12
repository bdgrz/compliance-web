// @vitest-environment jsdom
import { state } from '@askrjs/askr';
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';
import { ApplicationDetailPage } from './pages/application-detail.js';
import { ApplicationsPage } from './pages/applications-list.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const applicationId = '0190a1b2-0000-7000-8000-0000000000a1';
const instanceId = '0190a1b2-0000-7000-8000-0000000000c1';
const base = `/api/v1/tenants/${tenantId}`;
const app = `${base}/applications/${applicationId}`;
const instancePath = `${app}/system-instances/${instanceId}`;
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function mount(component: () => unknown): HTMLElement {
  const result = render(component as never);
  mounted.push(result);
  return result.container;
}

function problem(status: number, detail: string, transient = false) {
  return { type: 'about:blank', title: 'Problem', status, detail, instance: '/', transient };
}

function applicationBody(revision = 2, extra: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId,
    application_id: applicationId,
    revision,
    name: 'Payroll',
    purpose: 'Runs payroll',
    owner_reference: null,
    source_kind: 'manual',
    source_identifier: 'manual',
    has_system_instances: true,
    unresolved: ['owner_missing', 'classification_unresolved', 'system_owner_missing', 'access_owner_missing', 'application_kind_missing', 'criticality_missing', 'scope_boundary_review_pending'],
    application_kind: null,
    criticality: null,
    last_changed_by_member_id: 'm',
    last_changed_by_display: 'Casey Lead',
    last_changed_at: '2026-09-20T00:00:00Z',
    classification: null,
    lifecycle: 'active',
    retirement: null,
    ...extra,
  };
}

const instance = {
  tenant_id: tenantId,
  application_id: applicationId,
  system_instance_id: instanceId,
  name: 'Payroll production',
  kind: 'production tenant',
  access_boundary_reference: null,
  source_kind: 'manual',
  source_identifier: null,
  unresolved: [],
  declared_by_member_id: 'm2',
  declared_by_display: 'Riley Admin',
  declared_at: '2026-09-21T00:00:00Z',
  revision: 1,
  lifecycle: 'active',
  retirement: null,
};

function detailAnswers(revision = 2) {
  api.reply(`GET ${app}`, 200, applicationBody(revision));
  api.reply(`GET ${base}/applications`, 200, { items: [applicationBody()], next_cursor: null });
  api.reply(`GET ${app}/relationships`, 200, { relationship_revision: 0, items: [], next_cursor: null });
  api.reply(`${app}/system-instances`, 200, { items: [instance], next_cursor: null });
  api.reply(`${app}/revisions`, 200, {
    items: [
      { ...applicationBody(1), change_kind: 'declared', system_instance_id: null, system_instance: null },
      { ...applicationBody(2), change_kind: 'system_instance_declared', system_instance_id: instanceId, system_instance: instance },
    ],
    next_cursor: null,
  });
}

const decision = {
  tenant_id: tenantId,
  application_id: applicationId,
  system_instance_id: instanceId,
  system_instance_revision: 1,
  decision_id: 'd1',
  sequence: 1,
  decision: 'included',
  reason: 'Holds payroll data',
  effective_from: '2026-09-22T00:00:00Z',
  review_by: null,
  approved_by: { kind: 'member', id: 'm3', display: 'Casey Lead' },
  decided_at: '2026-09-22T00:00:00Z',
  separation_of_duties_waiver_id: null,
};

function preview(kind: 'revise' | 'retire') {
  return {
    tenant_id: tenantId,
    application_id: applicationId,
    application_revision: 2,
    change_kind: kind,
    changes: kind === 'revise' ? [{ field: 'owner_reference', before: null, after: 'Finance' }] : [],
    boundary_references: [
      {
        tenant_id: tenantId, subject_type: 'application', governed_record_id: applicationId, boundary_id: 'b', program_id: 'p',
        version_id: 'v', entry_id: 'e1', revision: 1, status: 'approved', effective_from: null, kind: 'in_scope',
        subject: 'Payroll', owner_reference: 'x', rationale: 'Processes customer data.',
      },
    ],
    pending_contexts: ['vendors'],
    complete: false,
    system_instance_references: [instance],
  };
}

async function openScope(container: HTMLElement) {
  await vi.waitFor(() => expect(container.textContent).toContain('Payroll production'));
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Access-review scope for'))!;
  button.click();
  await vi.waitFor(() => expect(container.querySelector('form[aria-label="Decide access-review scope"]')).not.toBeNull());
}

function submit(container: HTMLElement, label: string) {
  container.querySelector(`form[aria-label="${label}"]`)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function typeInto(container: HTMLElement, label: string, value: string) {
  const input = [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))!
    .querySelector('input') as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const personId = '0190a1b2-0000-7000-8000-0000000000f1';
const draft = {
  'Application name': ' Payroll ',
  Purpose: ' Runs payroll ',
  Owner: ' Finance ',
  'Data classification': ' confidential ',
  'Application kind': ' business system ',
  Criticality: ' important ',
  'System owner': personId,
  'Access owner': personId,
};

function field(
  container: Element,
  label: string
): HTMLInputElement | HTMLSelectElement {
  return [...container.querySelectorAll('label')]
    .find((element) => element.textContent?.startsWith(label))!
    .querySelector('input, select')!;
}

function setField(container: Element, label: string, value: string) {
  const element = field(container, label);
  element.value = value;
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
      bubbles: true,
    })
  );
}

async function completeDeclaration() {
  api.reply(`GET ${base}/applications`, 200, { items: [], next_cursor: null });
  api.reply(`GET ${base}/people`, 200, {
    items: [
      {
        tenant_id: tenantId,
        person_id: personId,
        revision: 1,
        display_name: 'Alex Rivera',
        work_email: null,
        source_kind: 'manual',
        last_changed_by: { kind: 'member', id: 'm', display: 'Casey Lead' },
        last_changed_at: '2026-10-11T12:00:00Z',
      },
    ],
    next_cursor: null,
  });
  const container = mount(ApplicationsPage);
  await vi.waitFor(() =>
    expect(
      field(container, 'System owner').querySelectorAll('option')
    ).toHaveLength(2)
  );
  for (const [label, value] of Object.entries(draft))
    setField(container, label, value);
  return container;
}

function submitDeclaration(container: HTMLElement) {
  container
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function expectDraft(container: Element, changes: Record<string, string> = {}) {
  for (const [label, value] of Object.entries({ ...draft, ...changes }))
    expect(field(container, label).value).toBe(value);
}

function declarationPosts() {
  return api.bodies.filter(
    (request) =>
      request.method === 'POST' && request.path === `${base}/applications`
  );
}

beforeEach(async () => {
  clearActiveTenant();
  api = stubApi();
  api.reply(`${app}/access-review-scopes`, 200, { items: [], next_cursor: null });
  api.reply('/api/v1/tenant-slugs/acme/mine', 200, { tenant_id: tenantId, current_slug: 'acme', redirect: false });
  api.reply('/api/v1/tenants/mine', 200, { items: [{ tenant_id: tenantId, name: 'Acme Corp', slug: 'acme' }], next_cursor: null });
  await resolveTenantRoute('acme', { pathname: '/acme/applications', search: '', hash: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('applications and reviewed systems (R1-10a frontend #212)', () => {
  it('ShouldListApplicationsWithUnresolvedStates', async () => {
    // Arrange
    api.reply(`${base}/applications`, 200, { items: [applicationBody()], next_cursor: null });

    // Act
    const container = mount(ApplicationsPage);
    await vi.waitFor(() => expect(container.textContent).toContain('Payroll'));

    // Assert
    expect(container.querySelector(`a[href="/acme/applications/${applicationId}"]`)).not.toBeNull();
    expect(container.textContent).toContain('Owner missing');
    expect(container.textContent).toContain('Classification unresolved');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldInviteRecordingGivenNoApplications', async () => {
    // Arrange
    api.reply(`${base}/applications`, 200, { items: [], next_cursor: null });

    // Act
    const container = mount(ApplicationsPage);
    await vi.waitFor(() => expect(container.textContent).toContain('No applications yet'));

    // Assert
    expect(container.querySelector('form input')).not.toBeNull();
  });

  it('ShouldShowForbiddenGivenTheViewerCannotReadApplications', async () => {
    // Arrange
    api.reply(`${base}/applications`, 403, problem(403, 'Forbidden'));

    // Act
    const container = mount(ApplicationsPage);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Applications are not available to you'));

    // Assert
    expect(container.querySelector('form')).toBeNull();
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldOfferRetryGivenTheListFails', async () => {
    // Arrange
    api.reply(`${base}/applications`, 500, problem(500, 'Boom'));

    // Act
    const container = mount(ApplicationsPage);
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());

    // Assert
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(true);
  });

  it('ShouldDeclareAnApplicationWithOwnersAndClassification', async () => {
    // Arrange
    api.reply(
      `POST ${base}/applications`,
      400,
      problem(400, 'The name is required.')
    );
    const container = await completeDeclaration();
    typeInto(container, 'Application name', ' Payroll ');
    typeInto(container, 'Purpose', 'Runs payroll');
    typeInto(container, 'Data classification', 'confidential');

    // Act
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    );

    // Assert
    const sent = api.bodies.find(
      (b) => b.method === 'POST' && b.path === `${base}/applications`
    )?.body as Record<string, unknown>;
    expect(sent).toEqual({
      name: 'Payroll',
      purpose: 'Runs payroll',
      owner_reference: 'Finance',
      classification: 'confidential',
      application_kind: 'business system',
      criticality: 'important',
      system_owner_person_id: personId,
      access_owner_person_id: personId,
      declaration_key: expect.any(String),
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'The name is required.'
    );
  });

  it.each([
    ...[
      'Application name',
      'Purpose',
      'Data classification',
      'Application kind',
      'Criticality',
    ].flatMap((label) => ['', '   '].map((value) => ({ label, value }))),
    { label: 'System owner', value: '' },
    { label: 'Access owner', value: '' },
  ])(
    'ShouldRetainDraftWithoutDispatchGivenRequired$labelIsBlank$value',
    async ({ label, value }) => {
      // Arrange
      const assign = vi.fn();
      vi.stubGlobal('window', { location: { assign } });
      const container = await completeDeclaration();
      setField(container, label, value);

      // Act: dispatch directly so native form validation cannot hide a missing guard.
      submitDeclaration(container);

      // Assert
      await vi.waitFor(() =>
        expect(
          container.querySelector('[role="alert"]')?.textContent?.toLowerCase()
        ).toContain(label.toLowerCase())
      );
      expect(declarationPosts()).toEqual([]);
      expect(assign).not.toHaveBeenCalled();
      expectDraft(container, { [label]: value });
    }
  );

  it.each([
    ['Application name', 200],
    ['Data classification', 200],
    ['Application kind', 200],
    ['Criticality', 200],
    ['Purpose', 2000],
    ['Owner', 2000],
  ] as const)(
    'ShouldRetainDraftWithoutDispatchGiven%sExceedsItsBound',
    async (label, limit) => {
      // Arrange
      const container = await completeDeclaration();
      const value = 'x'.repeat(limit + 1);
      setField(container, label, value);

      // Act
      submitDeclaration(container);

      // Assert
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
          `${label} must be ${limit} characters or fewer.`
        )
      );
      expect(declarationPosts()).toEqual([]);
      expectDraft(container, { [label]: value });
    }
  );

  it.each([
    {
      status: 400,
      detail: 'The classification is invalid.',
      transient: false,
      message: 'The classification is invalid.',
    },
    {
      status: 403,
      detail: 'Internal permission detail',
      transient: false,
      message: 'You do not have permission to record the application.',
    },
    {
      status: 409,
      detail: 'The application already exists.',
      transient: false,
      message: 'The application already exists.',
    },
    {
      status: 409,
      detail: 'Projection behind',
      transient: true,
      message:
        'The latest changes are still being processed. Try again in a moment.',
    },
  ])(
    'ShouldRetainCompleteDraftGivenRefusedDeclaration$statusTransient$transient',
    async ({ status, detail, transient, message }) => {
      // Arrange
      const assign = vi.fn();
      vi.stubGlobal('window', { location: { assign } });
      const container = await completeDeclaration();
      api.reply(
        `POST ${base}/applications`,
        status,
        problem(status, detail, transient)
      );

      // Act
      submitDeclaration(container);

      // Assert
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
          message
        )
      );
      expect(declarationPosts()).toHaveLength(1);
      expectDraft(container);
      expect(assign).not.toHaveBeenCalled();
    }
  );

  it('ShouldReuseDeclarationIdentityGivenCommittedButLostResponseAndIdenticalRetry', async () => {
    // Arrange: the transport receives a successful server answer, then loses it before the client sees it.
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const container = await completeDeclaration();
    const savedId = '0190a1b2-0000-7000-8000-0000000000a9';
    api.reply(`POST ${base}/applications`, 200, { application_id: savedId });
    const transport = globalThis.fetch;
    let loseFirstAnswer = true;
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await transport(input, init);
        if (
          input instanceof Request &&
          input.method === 'POST' &&
          loseFirstAnswer
        ) {
          loseFirstAnswer = false;
          throw new TypeError('The connection was lost after commit.');
        }
        return response;
      }
    );

    // Act
    submitDeclaration(container);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Unable to record the application.'
      )
    );
    expectDraft(container);
    expect(assign).not.toHaveBeenCalled();
    submitDeclaration(container);
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/acme/applications/${savedId}`)
    );

    // Assert: this proves client key/payload reuse, while backend #958 proves deduplication without append.
    const posts = declarationPosts();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0].body).toMatchObject({
      declaration_key: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
      system_owner_person_id: personId,
      access_owner_person_id: personId,
    });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('ShouldKeepDeclarationIdentityAndChangedDraftGivenContentCollisionAfterUncertainSave', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const container = await completeDeclaration();
    const transport = globalThis.fetch;
    let loseFirstAnswer = true;
    api.reply(`POST ${base}/applications`, 200, {
      application_id: applicationId,
    });
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await transport(input, init);
        if (
          input instanceof Request &&
          input.method === 'POST' &&
          loseFirstAnswer
        ) {
          loseFirstAnswer = false;
          throw new TypeError('Lost response');
        }
        return response;
      }
    );
    submitDeclaration(container);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
    );
    const detail =
      'The declaration key has already been used for different application content.';
    api.reply(`POST ${base}/applications`, 409, problem(409, detail));
    setField(container, 'Criticality', ' changed criticality ');

    // Act
    submitDeclaration(container);
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        detail
      )
    );
    submitDeclaration(container);
    await vi.waitFor(() => expect(declarationPosts()).toHaveLength(3));

    // Assert
    const bodies = declarationPosts().map(
      (post) => post.body as Record<string, unknown>
    );
    expect(new Set(bodies.map((body) => body.declaration_key)).size).toBe(1);
    expect(bodies[1].criticality).toBe('changed criticality');
    expect(bodies[2]).toEqual(bodies[1]);
    expectDraft(container, { Criticality: ' changed criticality ' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('ShouldSuppressDuplicateDeclarationGivenSubmissionPending', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const container = await completeDeclaration();
    api.reply(`POST ${base}/applications`, 200, {
      application_id: applicationId,
    });
    const transport = globalThis.fetch;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await transport(input, init);
        if (input instanceof Request && input.method === 'POST') await pending;
        return response;
      }
    );

    // Act
    submitDeclaration(container);
    submitDeclaration(container);
    await vi.waitFor(() => expect(declarationPosts()).toHaveLength(1));
    submitDeclaration(container);
    release();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));

    // Assert
    expect(declarationPosts()).toHaveLength(1);
  });

  it('ShouldAvoidNavigationGivenTenantClearsWhileDeclarationIsPending', async () => {
    // Arrange
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const container = await completeDeclaration();
    api.reply(`POST ${base}/applications`, 200, {
      application_id: applicationId,
    });
    const transport = globalThis.fetch;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await transport(input, init);
        if (input instanceof Request && input.method === 'POST') await pending;
        return response;
      }
    );

    // Act
    submitDeclaration(container);
    await vi.waitFor(() => expect(declarationPosts()).toHaveLength(1));
    clearActiveTenant();
    release();

    // Assert
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Return to the original organization to reopen this application.'
      )
    );
    expectDraft(container);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(['cleared', 'different'] as const)(
    'ShouldKeepDraftInOriginalTenantGivenContextIs%s',
    async (context) => {
      // Arrange
      const assign = vi.fn();
      vi.stubGlobal('window', { location: { assign } });
      const container = await completeDeclaration();
      api.reply(
        `POST ${base}/applications`,
        409,
        problem(409, 'Try the same declaration again.')
      );
      submitDeclaration(container);
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')).not.toBeNull()
      );
      clearActiveTenant();
      if (context === 'different') {
        const otherId = '0190a1b2-0000-7000-8000-000000000002';
        api.reply('/api/v1/tenant-slugs/other/mine', 200, {
          tenant_id: otherId,
          current_slug: 'other',
          redirect: false,
        });
        api.reply('/api/v1/tenants/mine', 200, {
          items: [{ tenant_id: otherId, name: 'Other Corp', slug: 'other' }],
          next_cursor: null,
        });
        await resolveTenantRoute('other', {
          pathname: '/other/applications',
          search: '',
          hash: '',
        });
      }

      // Act
      submitDeclaration(container);

      // Assert
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
          'Return to the original organization to record this application.'
        )
      );
      expect(
        api.bodies.filter((request) => request.method === 'POST')
      ).toHaveLength(1);
      expectDraft(container);
      expect(assign).not.toHaveBeenCalled();
    }
  );

  it('ShouldRejectFabricatedOwnerGivenUnavailableRoster', async () => {
    // Arrange
    api.reply(`GET ${base}/applications`, 200, {
      items: [],
      next_cursor: null,
    });
    api.reply(`GET ${base}/people`, 503, problem(503, 'Roster unavailable'));
    const container = mount(ApplicationsPage);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'The workforce roster could not be loaded'
      )
    );
    for (const [label, value] of Object.entries(draft).filter(
      ([label]) => !label.endsWith('owner')
    ))
      setField(container, label, value);
    const owner = field(container, 'System owner') as HTMLSelectElement;
    const fabricated = document.createElement('option');
    fabricated.value = personId;
    owner.append(fabricated);
    setField(container, 'System owner', personId);

    // Act
    submitDeclaration(container);

    // Assert
    await vi.waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        'Choose a system owner from the workforce roster.'
      )
    );
    expect(declarationPosts()).toEqual([]);
    expect(owner.disabled).toBe(true);
  });

  it.each(['omitted', 'null'] as const)(
    'ShouldShowSnapshotFactsAndActualGapsGivenLegacyAdditionsAre%s',
    async (shape) => {
      // Arrange
      const current = applicationBody(3, {
        lifecycle: 'retired',
        has_system_instances: false,
        unresolved: [
          'classification_unresolved',
          'system_owner_missing',
          'access_owner_missing',
          'application_kind_missing',
          'criticality_missing',
          'system_instances_missing',
        ],
      });
      if (shape === 'omitted') {
        delete (current as Record<string, unknown>).application_kind;
        delete (current as Record<string, unknown>).criticality;
      }
      api.reply(`GET ${base}/applications`, 200, {
        items: [current],
        next_cursor: null,
      });
      const inventory = mount(ApplicationsPage);
      await vi.waitFor(() =>
        expect(
          inventory.querySelector('.application-list')?.textContent
        ).toContain('Application kind missing')
      );
      expect(
        inventory.querySelector('.application-list')?.textContent
      ).toContain('Criticality missing');
      expect(
        inventory.querySelector('.application-list')?.textContent
      ).toContain('Lifecycle: retired');
      mounted.pop()!.cleanup();
      api.reply(`GET ${app}`, 200, current);
      api.reply(`GET ${base}/people`, 200, { items: [], next_cursor: null });
      api.reply(`GET ${app}/system-instances`, 200, {
        items: [],
        next_cursor: null,
      });
      api.reply(`GET ${app}/revisions`, 200, {
        items: [
          {
            ...current,
            revision: 1,
            lifecycle: 'active',
            source_identifier: 'original source',
            unresolved: [
              'owner_missing',
              'application_kind_missing',
              'criticality_missing',
              'scope_boundary_review_pending',
            ],
            change_kind: 'declared',
            system_instance: null,
            system_instance_id: null,
          },
        ],
        next_cursor: null,
      });

      // Act
      const container = mount(() => (
        <ApplicationDetailPage applicationId={applicationId} />
      ));
      await vi.waitFor(() =>
        expect(
          container.querySelector('.application-history')?.textContent
        ).toContain('original source')
      );

      // Assert
      const facts = container.querySelector('.application-facts')!;
      const history = container.querySelector('.application-history')!;
      expect(facts.textContent).toContain('Application kind missing');
      expect(facts.textContent).toContain('Criticality missing');
      expect(facts.textContent).toContain('retired');
      expect(history.textContent).toContain('active');
      expect(history.textContent).not.toContain('retired');
      expect(history.textContent).toContain('Application kind missing');
      expect(history.textContent).toContain('Criticality missing');
      expect(history.textContent).toContain('Owner missing');
      expect(history.textContent).not.toContain('Classification unresolved');
      for (const gap of current.unresolved)
        expect(
          container.querySelector('.application-unresolved')?.textContent
        ).toContain(
          gap.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase())
        );
      expect(container.textContent).not.toContain('draft state');
    }
  );

  it('ShouldReopenPopulatedManualApplicationGivenSuccessfulSaveAndFreshMount', async () => {
    // Arrange
    const savedId = '0190a1b2-0000-7000-8000-0000000000a9';
    const savedPath = `${base}/applications/${savedId}`;
    const systemOwnerId = '0190a1b2-0000-7000-8000-0000000000f1';
    const accessOwnerId = '0190a1b2-0000-7000-8000-0000000000f2';
    const people = [
      { personId: systemOwnerId, name: 'Alex Rivera' },
      { personId: accessOwnerId, name: 'Blair Chen' },
    ].map(({ personId, name }) => ({
      tenant_id: tenantId,
      person_id: personId,
      revision: 1,
      display_name: name,
      work_email: null,
      source_kind: 'manual',
      last_changed_by: { kind: 'member', id: 'm', display: 'Casey Lead' },
      last_changed_at: '2026-10-11T12:00:00Z',
    }));
    const assign = vi.fn();
    // Capture navigation intent; this unit test does not execute browser navigation.
    vi.stubGlobal('window', { location: { assign } });
    api.reply(`GET ${base}/applications`, 200, {
      items: [],
      next_cursor: null,
    });
    api.reply(`GET ${base}/people`, 200, { items: people, next_cursor: null });
    api.reply(`POST ${base}/applications`, 200, { application_id: savedId });
    const container = mount(ApplicationsPage);
    await vi.waitFor(() =>
      expect(container.querySelectorAll('select option')).toHaveLength(6)
    );
    typeInto(container, 'Application name', ' People Operations Portal ');
    typeInto(container, 'Purpose', ' Coordinates staff onboarding ');
    typeInto(container, 'Owner', ' People Operations ');
    typeInto(container, 'Data classification', ' confidential ');
    expect(
      [...container.querySelectorAll('label')].some(
        (label) =>
          label.textContent?.startsWith('Application kind') &&
          label.querySelector('input') !== null
      )
    ).toBe(true);
    expect(
      [...container.querySelectorAll('label')].some(
        (label) =>
          label.textContent?.startsWith('Criticality') &&
          label.querySelector('input') !== null
      )
    ).toBe(true);
    typeInto(container, 'Application kind', ' staff portal ');
    typeInto(container, 'Criticality', ' business critical ');
    for (const [label, personId] of [
      ['System owner', systemOwnerId],
      ['Access owner', accessOwnerId],
    ]) {
      const select = [...container.querySelectorAll('label')]
        .find((l) => l.textContent?.startsWith(label))!
        .querySelector('select')!;
      select.value = personId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Act
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/acme/applications/${savedId}`)
    );

    // Assert
    expect(assign).toHaveBeenCalledTimes(1);
    expect(api.bodies.filter((request) => request.method === 'POST')).toEqual([
      {
        method: 'POST',
        path: `${base}/applications`,
        body: {
          name: 'People Operations Portal',
          purpose: 'Coordinates staff onboarding',
          owner_reference: 'People Operations',
          classification: 'confidential',
          application_kind: 'staff portal',
          criticality: 'business critical',
          declaration_key: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          ),
          system_owner_person_id: systemOwnerId,
          access_owner_person_id: accessOwnerId,
        },
      },
    ]);

    // Dispose the draft. Reopened values must come from new server reads.
    mounted.pop()!.cleanup();
    const saved = applicationBody(2, {
      application_id: savedId,
      name: 'People Operations Portal',
      purpose: 'Coordinates staff onboarding',
      owner_reference: 'People Operations',
      classification: 'confidential',
      application_kind: 'staff portal',
      criticality: 'business critical',
      system_owner_person_id: systemOwnerId,
      access_owner_person_id: accessOwnerId,
      has_system_instances: false,
      unresolved: [
        'owner_unverified',
        'classification_unverified',
        'system_instances_missing',
      ],
      last_changed_by_member_id: 'recorder',
      last_changed_by_display: 'Jordan Recorder',
      last_changed_at: '2026-10-11T14:30:00Z',
    });
    const gapLabels = [
      'Owner not verified',
      'Classification not verified',
      'System instances missing',
    ];
    api.reply(`GET ${base}/applications`, 200, {
      items: [saved],
      next_cursor: null,
    });
    const readsBeforeInventory = api.bodies.length;
    const inventory = mount(ApplicationsPage);
    await vi.waitFor(() =>
      expect(
        inventory.querySelector(`a[href="/acme/applications/${savedId}"]`)
          ?.textContent
      ).toBe('People Operations Portal')
    );
    expect(api.bodies.slice(readsBeforeInventory)).toContainEqual({
      method: 'GET',
      path: `${base}/applications`,
      body: undefined,
    });
    expect(inventory.querySelector('.application-list')?.textContent).toContain(
      'Coordinates staff onboarding'
    );
    expect(inventory.querySelector('.application-list')?.textContent).toContain(
      'confidential'
    );
    for (const fact of [
      'staff portal',
      'business critical',
      'Source: manual',
      'Lifecycle: active',
    ]) {
      expect(
        inventory.querySelector('.application-list')?.textContent
      ).toContain(fact);
    }
    expect(inventory.querySelector('.application-list')?.textContent).toContain(
      'No reviewed systems yet'
    );
    for (const label of gapLabels)
      expect(
        inventory.querySelector('.application-unresolved')?.textContent
      ).toContain(label);
    mounted.pop()!.cleanup();

    api.reply(`GET ${savedPath}`, 200, saved);
    api.reply(`GET ${savedPath}/system-instances`, 200, {
      items: [],
      next_cursor: null,
    });
    const original = {
      ...saved,
      revision: 1,
      application_kind: 'original portal',
      criticality: 'important',
      classification: 'internal',
      lifecycle: 'active',
      source_identifier: 'manual declaration',
      change_kind: 'declared',
      system_instance: null,
      system_instance_id: null,
      has_system_instances: true,
      unresolved: [
        'owner_unverified',
        'classification_unverified',
        'scope_boundary_review_pending',
      ],
      actor: {
        kind: 'member',
        id: 'original-recorder',
        display: 'Original Recorder',
      },
    };
    api.reply(`GET ${savedPath}/revisions`, 200, {
      items: [
        {
          ...saved,
          change_kind: 'revised',
          system_instance: null,
          system_instance_id: null,
        },
      ],
      next_cursor: 'older',
    });
    const transport = globalThis.fetch;
    const historyCursors: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          'http://app.test'
        );
        if (url.pathname === `${savedPath}/revisions`) {
          historyCursors.push(url.searchParams.get('cursor'));
          if (url.searchParams.get('cursor') === 'older')
            api.reply(`GET ${savedPath}/revisions`, 200, {
              items: [original],
              next_cursor: null,
            });
        }
        return transport(input, init);
      }
    );
    const readsBeforeDetail = api.bodies.length;
    const detail = mount(() => (
      <ApplicationDetailPage applicationId={savedId} />
    ));
    await vi.waitFor(() =>
      expect(
        detail.querySelector(
          `a[href="/acme/workforce/people/${accessOwnerId}"]`
        )?.textContent
      ).toBe('Blair Chen')
    );
    expect(api.bodies.slice(readsBeforeDetail)).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: savedPath, body: undefined },
        {
          method: 'GET',
          path: `${savedPath}/system-instances`,
          body: undefined,
        },
        { method: 'GET', path: `${base}/people`, body: undefined },
      ])
    );
    expect(detail.querySelector('h1')?.textContent).toBe(
      'People Operations Portal'
    );
    expect(detail.textContent).toContain('Coordinates staff onboarding');
    expect(detail.querySelector('.application-facts')?.textContent).toContain(
      'confidential'
    );
    for (const fact of [
      'staff portal',
      'business critical',
      'Source',
      'manual',
      'Lifecycle',
      'active',
    ]) {
      expect(detail.querySelector('.application-facts')?.textContent).toContain(
        fact
      );
    }
    await vi.waitFor(() =>
      expect(
        detail.querySelector('.application-history')?.textContent
      ).toContain('original portal')
    );
    expect(historyCursors).toEqual([null, 'older']);
    const history = detail.querySelector('.application-history')!;
    for (const fact of [
      'important',
      'internal',
      'Original Recorder',
      'manual declaration',
      'active',
      'Scope boundary review pending',
    ]) {
      expect(history.textContent).toContain(fact);
    }
    expect(
      history.querySelector(`a[href="/acme/workforce/people/${systemOwnerId}"]`)
        ?.textContent
    ).toBe('Alex Rivera');
    expect(
      detail.querySelector(`a[href="/acme/workforce/people/${systemOwnerId}"]`)
        ?.textContent
    ).toBe('Alex Rivera');
    expect(detail.textContent).toContain(
      `Revision 2, last changed by Jordan Recorder on ${new Date(saved.last_changed_at).toLocaleDateString()}`
    );
    await vi.waitFor(() =>
      expect(detail.textContent).toContain('No reviewed systems yet.')
    );
    for (const label of gapLabels)
      expect(
        detail.querySelector('.application-unresolved')?.textContent
      ).toContain(label);
    // No instance exists to scope, and saving the Application makes no scope decision.
    expect(
      detail.querySelector('form[aria-label="Decide access-review scope"]')
    ).toBeNull();
    expect(detail.textContent).not.toContain('Included in access reviews');
    expect(
      api.bodies
        .filter((request) => request.method !== 'GET')
        .map((request) => `${request.method} ${request.path}`)
    ).toEqual([`POST ${base}/applications`]);
  });

  it('ShouldShowApplicationSystemsAndHistory', async () => {
    // Arrange
    detailAnswers();

    // Act
    const container = mount(() => (
      <ApplicationDetailPage applicationId={applicationId} />
    ));
    await vi.waitFor(() =>
      expect(
        container.querySelectorAll('.application-history > li')
      ).toHaveLength(2)
    );

    // Assert
    expect(container.querySelector('h1')?.textContent).toBe('Payroll');
    expect(container.textContent).toContain('Payroll production');
    expect(
      container.querySelector('.application-history li')?.textContent
    ).toContain('Revision 2');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldDeclareASystemInstanceAgainstTheApplicationRevision', async () => {
    // Arrange
    detailAnswers(2);
    api.reply(`POST ${app}/system-instances`, 200, { system_instance_id: instanceId });
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Record a reviewed system"]')).not.toBeNull());
    typeInto(container, 'System name', 'Payroll staging');
    typeInto(container, 'Kind', 'staging tenant');

    // Act
    submit(container, 'Record a reviewed system');
    await vi.waitFor(() => expect(api.bodies.some((b) => b.method === 'POST' && b.path === `${app}/system-instances`)).toBe(true));

    // Assert
    const sent = api.bodies.find((b) => b.method === 'POST' && b.path === `${app}/system-instances`)?.body as Record<string, unknown>;
    expect(sent).toEqual({ expected_application_revision: 2, name: 'Payroll staging', kind: 'staging tenant', access_boundary_reference: null });
  });

  it('ShouldExplainProjectionLagGivenATransientConflict', async () => {
    // Arrange
    api.reply(`GET ${app}`, 409, problem(409, 'Projection is behind.', true));

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.querySelector('h1')).not.toBeNull());

    // Assert
    expect(container.textContent).toContain('still being processed');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(true);
  });

  it('ShouldShowNotFoundGivenAnUnknownApplication', async () => {
    // Arrange
    api.reply(`GET ${app}`, 404, problem(404, 'The application was not found.'));

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Application not found'));

    // Assert
    expect(container.querySelector('a[href="/acme/applications"]')).not.toBeNull();
  });
});

describe('revision-bound Application editing (#50)', () => {
  async function openRevision(extra: Record<string, unknown> = {}, component = () => <ApplicationDetailPage applicationId={applicationId} />) {
    detailAnswers();
    api.reply(`GET ${app}`, 200, applicationBody(2, extra));
    api.reply(`GET ${base}/applications`, 200, { items: [applicationBody()], next_cursor: null });
    api.reply(`GET ${base}/people`, 200, {
      items: [{
        tenant_id: tenantId, person_id: personId, revision: 1, display_name: 'Alex Rivera', work_email: null,
        source_kind: 'manual', last_changed_by: { kind: 'member', id: 'm', display: 'Casey Lead' },
        last_changed_at: '2026-10-11T12:00:00Z',
      }],
      next_cursor: null,
    });
    const container = mount(component);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Revise application"]')).not.toBeNull());
    const form = container.querySelector('form[aria-label="Revise application"]')!;
    await vi.waitFor(() => expect(field(form, 'System owner').querySelector(`option[value="${personId}"]`)).not.toBeNull());
    return { container, form };
  }

  async function completeRevision() {
    const result = await openRevision();
    for (const [label, value] of Object.entries(draft)) setField(result.form, label, value);
    return result;
  }

  function saveButton(container: HTMLElement) {
    return [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save revision');
  }

  async function matchingPreview(container: HTMLElement) {
    api.reply(`POST ${app}/change-previews`, 200, preview('revise'));
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(saveButton(container)).toBeDefined());
  }

  function delayPreviews() {
    const release: (() => void)[] = [];
    const transport = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await transport(input, init);
      if (input instanceof Request && new URL(input.url).pathname.endsWith('/change-previews')) {
        await new Promise<void>((resolve) => release.push(resolve));
      }
      return response;
    });
    return release;
  }

  async function switchOrganization() {
    const otherTenantId = '0190a1b2-0000-7000-8000-000000000002';
    api.reply('/api/v1/tenant-slugs/other/mine', 200, { tenant_id: otherTenantId, current_slug: 'other', redirect: false });
    api.reply('/api/v1/tenants/mine', 200, { items: [{ tenant_id: otherTenantId, name: 'Other Corp', slug: 'other' }], next_cursor: null });
    clearActiveTenant();
    await resolveTenantRoute('other', { pathname: '/other/applications', search: '', hash: '' });
  }

  it('ShouldCompleteLegacyMetadataAndSaveExactPreviewGivenRenderedApplicationRevision', async () => {
    // Arrange
    const { container, form } = await openRevision();
    expect([...form.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Application kind'))).toBeDefined();
    expect(field(form, 'Application name').value).toBe('Payroll');
    expect(field(form, 'Purpose').value).toBe('Runs payroll');
    for (const label of ['Data classification', 'Application kind', 'Criticality', 'System owner', 'Access owner']) {
      expect(field(form, label).value).toBe('');
    }
    for (const [label, value] of Object.entries(draft)) setField(form, label, value);
    api.reply(`POST ${app}/change-previews`, 200, preview('revise'));
    api.reply(`PUT ${app}`, 204);

    // Act
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(container.querySelector('.change-preview')).not.toBeNull());
    const content = {
      name: 'Payroll', purpose: 'Runs payroll', owner_reference: 'Finance', classification: 'confidential',
      system_owner_person_id: personId, access_owner_person_id: personId,
      application_kind: 'business system', criticality: 'important',
    };
    expect(api.bodies.find((request) => request.path === `${app}/change-previews`)?.body).toEqual({
      expected_application_revision: 2, change_kind: 'revise', ...content,
    });
    expect(container.textContent).toContain('This preview is not complete');
    api.reply(`GET ${app}`, 200, applicationBody(3, content));
    api.reply(`GET ${app}/revisions`, 200, { items: [{
      ...applicationBody(3, content), change_kind: 'revised', system_instance_id: null, system_instance: null,
    }], next_cursor: null });
    [...container.querySelectorAll('button')].find((button) => button.textContent === 'Save revision')!.click();

    // Assert
    await vi.waitFor(() => expect(container.querySelector('.application-history')?.textContent).toContain('Revision 3'));
    expect(api.bodies.find((request) => request.method === 'PUT')?.body).toEqual({ expected_revision: 2, ...content });
    expect(api.bodies.filter((request) => request.method === 'GET' && request.path === app)).toHaveLength(2);
    expect(container.textContent).toContain('Revision 3, last changed by Casey Lead');
    expect(field(container.querySelector('form[aria-label="Revise application"]')!, 'Application kind').value).toBe('business system');
    expect(saveButton(container)).toBeUndefined();
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldPrefillRecordedMetadataAndRetainUnknownOwnerGivenOptionalAttribution', async () => {
    // Arrange
    const unknownOwner = '0190a1b2-0000-7000-8000-0000000000ff';
    const { container, form } = await openRevision({
      classification: 'confidential', application_kind: 'business system', criticality: 'important',
      system_owner_person_id: unknownOwner, access_owner_person_id: personId,
    });

    // Act
    setField(form, 'Purpose', ' Revised purpose ');
    await matchingPreview(container);

    // Assert
    expect(field(form, 'Application kind').value).toBe('business system');
    expect(field(form, 'Criticality').value).toBe('important');
    expect(field(form, 'Data classification').value).toBe('confidential');
    expect(field(form, 'System owner').value).toBe(unknownOwner);
    expect(field(form, 'System owner').textContent).toContain('Person not on the roster');
    expect(field(form, 'Owner').value).toBe('');
    expect(field(form, 'Owner').required).toBe(false);
    expect(api.bodies.find((request) => request.path === `${app}/change-previews`)?.body).toMatchObject({
      expected_application_revision: 2, owner_reference: null, system_owner_person_id: unknownOwner,
      access_owner_person_id: personId, purpose: 'Revised purpose',
    });
  });

  it.each([
    ['Application name', '', 'Application name is required.'],
    ['Purpose', ' ', 'Purpose is required.'],
    ['Data classification', ' ', 'Data classification is required.'],
    ['Application kind', '', 'Application kind is required.'],
    ['Criticality', '', 'Criticality is required.'],
    ['System owner', '', 'Choose a system owner from the workforce roster.'],
    ['Access owner', '', 'Choose an access owner from the workforce roster.'],
    ['Owner', 'x'.repeat(2001), 'Owner must be 2000 characters or fewer.'],
  ])('ShouldRetainDraftGivenInvalidRevisionField%s', async (label, value, message) => {
    // Arrange
    const { container, form } = await completeRevision();
    setField(form, label, value);

    // Act
    submit(container, 'Revise application');

    // Assert
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toBe(message));
    expectDraft(form, { [label]: value });
    expect(api.bodies.filter((request) => request.method !== 'GET')).toEqual([]);
    expect(saveButton(container)).toBeUndefined();
  });

  it.each(Object.keys(draft))('ShouldInvalidatePreviewGivenAnEditTo%s', async (label) => {
    // Arrange
    const { container, form } = await completeRevision();
    await matchingPreview(container);
    const staleSave = saveButton(container)!;
    const changed = label.endsWith('owner') ? '' : 'Changed value';

    // Act
    setField(form, label, changed);
    staleSave.click();

    // Assert
    await vi.waitFor(() => expect(saveButton(container)).toBeUndefined());
    expect(container.querySelector('.change-preview')).toBeNull();
    expect(field(form, label).value).toBe(changed);
    expect(api.bodies.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('ShouldIgnoreLatePreviewGivenDraftChangedWhileRequestWasPending', async () => {
    // Arrange
    const { container, form } = await completeRevision();
    const release = delayPreviews();
    api.reply(`POST ${app}/change-previews`, 200, preview('revise'));
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(release).toHaveLength(1));

    // Act
    setField(form, 'Purpose', 'Changed while previewing');
    release[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(container.querySelector('.change-preview')).toBeNull();
    expect(saveButton(container)).toBeUndefined();
    expect(field(form, 'Purpose').value).toBe('Changed while previewing');
    expect(api.bodies.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('ShouldKeepNewestPreviewGivenResponsesArriveOutOfOrder', async () => {
    // Arrange
    const { container, form } = await completeRevision();
    const release = delayPreviews();
    api.reply(`POST ${app}/change-previews`, 200, { ...preview('revise'), changes: [{ field: 'purpose', before: 'Runs payroll', after: 'Earlier draft' }] });
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(release).toHaveLength(1));
    setField(form, 'Purpose', 'Newest draft');
    api.reply(`POST ${app}/change-previews`, 200, { ...preview('revise'), changes: [{ field: 'purpose', before: 'Runs payroll', after: 'Newest draft' }] });
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(release).toHaveLength(2));

    // Act
    release[1]();
    await vi.waitFor(() => expect(container.querySelector('.change-preview')?.textContent).toContain('Newest draft'));
    release[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    api.reply(`PUT ${app}`, 204);
    saveButton(container)!.click();

    // Assert
    await vi.waitFor(() => expect(api.bodies.find((request) => request.method === 'PUT')?.body).toMatchObject({ expected_revision: 2, purpose: 'Newest draft' }));
    expect(field(form, 'Purpose').value).toBe('Newest draft');
  });

  it.each([
    { application_revision: 3 }, { application_id: 'different-application' },
    { tenant_id: 'different-tenant' }, { change_kind: 'retire' },
  ])('ShouldRejectMismatchedPreviewGivenResponse%s', async (mismatch) => {
    // Arrange
    const { container, form } = await completeRevision();
    api.reply(`POST ${app}/change-previews`, 200, { ...preview('revise'), ...mismatch });

    // Act
    submit(container, 'Revise application');

    // Assert
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toContain('The preview did not match this application revision'));
    expectDraft(form);
    expect(saveButton(container)).toBeUndefined();
    expect(api.bodies.some((request) => request.method === 'PUT')).toBe(false);
    expect(form.textContent).toContain('Preview change');
  });

  it.each([400, 403, 409])('ShouldRetainDraftAndDiscardOldSuccessGivenFailedRepreview%d', async (status) => {
    // Arrange
    const { container, form } = await completeRevision();
    await matchingPreview(container);
    const staleSave = saveButton(container)!;
    const release = delayPreviews();
    api.reply(`POST ${app}/change-previews`, status, problem(status, 'Revision request refused.'));

    // Act
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(release).toHaveLength(1));
    expect(saveButton(container)).toBeUndefined();
    staleSave.click();
    release[0]();

    // Assert
    const message = status === 403 ? 'You do not have permission to preview the change.' : status === 409 ? 'Someone else changed this application' : 'Revision request refused.';
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toContain(message));
    expectDraft(form);
    expect(saveButton(container)).toBeUndefined();
    expect(api.bodies.some((request) => request.method === 'PUT')).toBe(false);
    expect(api.bodies.filter((request) => request.path === `${app}/change-previews`).map((request) => (request.body as Record<string, unknown>).expected_application_revision)).toEqual([2, 2]);
  });

  it.each([400, 403, 409])('ShouldRetainDraftAndRequireNewPreviewGivenFailedSave%d', async (status) => {
    // Arrange
    const { container, form } = await completeRevision();
    await matchingPreview(container);
    api.reply(`PUT ${app}`, status, problem(status, 'Revision request refused.'));

    // Act
    saveButton(container)!.click();

    // Assert
    const message = status === 403 ? 'You do not have permission to save the application.' : status === 409 ? 'Someone else changed this application' : 'Revision request refused.';
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toContain(message));
    expectDraft(form);
    expect(saveButton(container)).toBeUndefined();
    expect(api.bodies.filter((request) => request.method === 'GET' && request.path === app)).toHaveLength(1);
    await matchingPreview(container);
    expect(api.bodies.filter((request) => request.path === `${app}/change-previews`).map((request) => (request.body as Record<string, unknown>).expected_application_revision)).toEqual([2, 2]);
    expect(api.bodies.find((request) => request.method === 'PUT')?.body).toMatchObject({ expected_revision: 2 });
  });

  it('ShouldRefuseSaveGivenOrganizationChangedAfterPreview', async () => {
    // Arrange
    const { container, form } = await completeRevision();
    await matchingPreview(container);

    // Act
    await switchOrganization();
    saveButton(container)!.click();

    // Assert
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toContain('Preview the change again in the original organization'));
    expect(saveButton(container)).toBeUndefined();
    expectDraft(form);
    expect(api.bodies.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('ShouldIgnorePendingPreviewGivenOrganizationChanged', async () => {
    // Arrange
    const { container, form } = await completeRevision();
    const release = delayPreviews();
    api.reply(`POST ${app}/change-previews`, 200, preview('revise'));
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(release).toHaveLength(1));

    // Act
    await switchOrganization();
    release[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(saveButton(container)).toBeUndefined();
    expectDraft(form);
    expect(api.bodies.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('ShouldKeepDraftWithoutReloadingGivenOrganizationChangedDuringSave', async () => {
    // Arrange
    const { container, form } = await completeRevision();
    await matchingPreview(container);
    api.reply(`PUT ${app}`, 204);
    const transport = globalThis.fetch;
    let release: (() => void) | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await transport(input, init);
      if (input instanceof Request && input.method === 'PUT') {
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return response;
    });

    // Act
    saveButton(container)!.click();
    await vi.waitFor(() => expect(release).toBeDefined());
    expect([...form.querySelectorAll('input, select')].every((element) => (element as HTMLInputElement).disabled)).toBe(true);
    expect(form.textContent).toContain('Saving…');
    submit(container, 'Revise application');
    await switchOrganization();
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expectDraft(form);
    expect(saveButton(container)).toBeUndefined();
    expect(api.bodies.filter((request) => request.method === 'PUT')).toHaveLength(1);
    expect(api.bodies.filter((request) => request.method === 'GET' && request.path === app)).toHaveLength(1);
    expect(api.bodies.filter((request) => request.path === `${app}/change-previews`)).toHaveLength(1);
  });

  it('ShouldKeepNewApplicationDraftWithoutReloadGivenPreviousApplicationSaveCompletesLate', async () => {
    // Arrange
    const otherId = '0190a1b2-0000-7000-8000-0000000000aa';
    const otherPath = `${base}/applications/${otherId}`;
    let changeApplication: (id: string) => void = () => {};
    const { container, form } = await openRevision({}, () => {
      const [id, setId] = state(applicationId);
      changeApplication = setId;
      return <ApplicationDetailPage applicationId={id()} />;
    });
    for (const [label, value] of Object.entries(draft)) setField(form, label, value);
    await matchingPreview(container);
    api.reply(`PUT ${app}`, 204);
    api.reply(`GET ${otherPath}`, 200, applicationBody(1, { application_id: otherId, name: 'Other application' }));
    api.reply(`GET ${otherPath}/system-instances`, 200, { items: [], next_cursor: null });
    api.reply(`GET ${otherPath}/revisions`, 200, { items: [], next_cursor: null });
    const transport = globalThis.fetch;
    const otherReads: URL[] = [];
    let release: (() => void) | undefined;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await transport(input, init);
      if (input instanceof Request) {
        const url = new URL(input.url);
        if (input.method === 'PUT' && url.pathname === app) {
          await new Promise<void>((resolve) => { release = resolve; });
        }
        if (input.method === 'GET' && url.pathname === otherPath) {
          otherReads.push(url);
          if (Number(url.searchParams.get('minimum_revision')) > 1) {
            return new Response(JSON.stringify(problem(409, 'Other application projection is below the requested minimum.', true)), {
              status: 409, headers: { 'Content-Type': 'application/problem+json' },
            });
          }
        }
      }
      return response;
    });

    // Act
    saveButton(container)!.click();
    await vi.waitFor(() => expect(release).toBeDefined());
    changeApplication(otherId);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Other application'));
    const otherForm = container.querySelector('form[aria-label="Revise application"]')!;
    const changed = { 'Application name': ' B unsaved name ', Purpose: ' B unsaved purpose ' };
    for (const [label, value] of Object.entries({ ...draft, ...changed })) setField(otherForm, label, value);
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(otherReads.map((url) => url.searchParams.get('minimum_revision'))).toEqual([null]);
    expect(api.bodies.filter((request) => request.method === 'PUT')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('Other application');
    expect(container.querySelector('form[aria-label="Revise application"]')).toBe(otherForm);
    expectDraft(otherForm, changed);
    expect(saveButton(container)).toBeUndefined();
  });

  it('ShouldDiscardPendingPreviewGivenApplicationContextChanged', async () => {
    // Arrange
    const otherId = '0190a1b2-0000-7000-8000-0000000000aa';
    let changeApplication: (id: string) => void = () => {};
    const { container, form } = await openRevision({}, () => {
      const [id, setId] = state(applicationId);
      changeApplication = setId;
      return <ApplicationDetailPage applicationId={id()} />;
    });
    for (const [label, value] of Object.entries(draft)) setField(form, label, value);
    const release = delayPreviews();
    api.reply(`POST ${app}/change-previews`, 200, preview('revise'));
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(release).toHaveLength(1));
    api.reply(`GET ${base}/applications/${otherId}`, 200, applicationBody(4, { application_id: otherId, name: 'Other application' }));
    api.reply(`GET ${base}/applications/${otherId}/system-instances`, 200, { items: [], next_cursor: null });
    api.reply(`GET ${base}/applications/${otherId}/revisions`, 200, { items: [], next_cursor: null });

    // Act
    changeApplication(otherId);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Other application'));
    release[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Assert
    expect(saveButton(container)).toBeUndefined();
    expect(container.querySelector('.change-preview')).toBeNull();
    expect(field(container.querySelector('form[aria-label="Revise application"]')!, 'Application name').value).toBe('Other application');
    expect(api.bodies.some((request) => request.method === 'PUT')).toBe(false);
  });
});

describe('application change and retirement (R1-10d frontend #218)', () => {
  it('ShouldPreviewImpactBeforeSavingARevision', async () => {
    // Arrange
    detailAnswers(2);
    api.reply(`GET ${app}`, 200, applicationBody(2, {
      classification: 'confidential', application_kind: 'business system', criticality: 'important',
      system_owner_person_id: personId, access_owner_person_id: personId,
    }));
    api.reply(`POST ${app}/change-previews`, 200, preview('revise'));
    api.reply(`PUT ${app}`, 204);
    const container = mount(() => (
      <ApplicationDetailPage applicationId={applicationId} />
    ));
    await vi.waitFor(() =>
      expect(
        container.querySelector('form[aria-label="Revise application"]')
      ).not.toBeNull()
    );
    typeInto(container, 'Owner', 'Finance');

    // Act
    submit(container, 'Revise application');
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Change impact')
    );
    expect(api.bodies.some((b) => b.method === 'PUT')).toBe(false);
    expect(container.textContent).toContain('Owner: not set → Finance');
    expect(container.textContent).toContain('Processes customer data.');
    expect(container.textContent).toContain('This preview is not complete');
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Save revision')!
      .click();
    await vi.waitFor(() =>
      expect(api.bodies.some((b) => b.method === 'PUT')).toBe(true)
    );

    // Assert
    const sent = api.bodies.find((b) => b.method === 'PUT')?.body as Record<
      string,
      unknown
    >;
    expect(sent.expected_revision).toBe(2);
    expect(sent.owner_reference).toBe('Finance');
    expect(sent.application_kind).toBe('business system');
    expect(sent.criticality).toBe('important');
    expect(sent).not.toHaveProperty('declaration_key');
    const previewBody = api.bodies.find(
      (request) => request.path === `${app}/change-previews`
    )!.body;
    expect(previewBody).toEqual({
      expected_application_revision: 2,
      change_kind: 'revise',
      name: 'Payroll',
      purpose: 'Runs payroll',
      owner_reference: 'Finance',
      classification: 'confidential',
      application_kind: 'business system',
      criticality: 'important',
      system_owner_person_id: personId,
      access_owner_person_id: personId,
    });
    const revisionForm = container.querySelector(
      'form[aria-label="Revise application"]'
    )!;
    expect(
      [...revisionForm.querySelectorAll('label')].some(
        (label) =>
          label.textContent?.startsWith('Application kind') ||
          label.textContent?.startsWith('Criticality')
      )
    ).toBe(true);
    expect(field(revisionForm, 'Data classification').required).toBe(true);
    expect(field(revisionForm, 'System owner').required).toBe(true);
    expect(field(revisionForm, 'Access owner').required).toBe(true);
    await vi.waitFor(() =>
      expect(api.requested.filter((p) => p === app).length).toBeGreaterThan(1)
    );
  });

  it('ShouldAskToReloadGivenAStaleRevisionConflict', async () => {
    // Arrange
    detailAnswers(2);
    api.reply(`GET ${app}`, 200, applicationBody(2, {
      classification: 'confidential', application_kind: 'business system', criticality: 'important',
      system_owner_person_id: personId, access_owner_person_id: personId,
    }));
    api.reply(`POST ${app}/change-previews`, 409, problem(409, 'The application revision is stale; current revision is 3.'));
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Revise application"]')).not.toBeNull());

    // Act
    submit(container, 'Revise application');
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());

    // Assert
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Someone else changed this application');
  });

  it('ShouldPreviewThenRetireWithReasonAndEffectiveDate', async () => {
    // Arrange
    detailAnswers(2);
    api.reply(`POST ${app}/change-previews`, 200, preview('retire'));
    api.reply(`POST ${app}/retirements`, 204);
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Retire application"]')).not.toBeNull());
    typeInto(container, 'Reason for retirement', 'Replaced by Workday');
    typeInto(container, 'Effective date', '2026-10-01');

    // Act
    submit(container, 'Retire application');
    await vi.waitFor(() => expect(container.textContent).toContain('Retirement impact'));
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retire application')!.click();
    await vi.waitFor(() => expect(api.bodies.some((b) => b.path === `${app}/retirements`)).toBe(true));

    // Assert
    expect(api.bodies.find((b) => b.path === `${app}/change-previews`)?.body).toEqual({
      expected_application_revision: 2,
      change_kind: 'retire',
    });
    expect(api.bodies.find((b) => b.path === `${app}/retirements`)?.body).toEqual({
      expected_revision: 2,
      effective_at: '2026-10-01T00:00:00Z',
      reason: 'Replaced by Workday',
    });
  });

  it('ShouldShowRetirementAndHideEditsGivenARetiredApplication', async () => {
    // Arrange
    detailAnswers(3);
    api.reply(`GET ${app}`, 200, applicationBody(3, {
      lifecycle: 'retired',
      retirement: { effective_at: '2026-10-01T00:00:00Z', reason: 'Replaced by Workday', merged_into_application_id: null },
    }));

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Replaced by Workday'));

    // Assert
    expect(container.querySelector('form[aria-label="Revise application"]')).toBeNull();
    expect(container.querySelector('form[aria-label="Retire application"]')).toBeNull();
  });
});

describe('application access-review scope status (R1-10c web #59)', () => {
  const otherInstanceId = '0190a1b2-0000-7000-8000-0000000000c2';
  const retiredInstanceId = '0190a1b2-0000-7000-8000-0000000000c3';

  function scopeStatus(systemInstanceId: string, status: string, lifecycle = 'active') {
    return {
      tenant_id: tenantId,
      application_id: applicationId,
      system_instance_id: systemInstanceId,
      instance_lifecycle: lifecycle,
      as_of: '2026-10-12T00:00:00Z',
      status,
      review_overdue: false,
      decision_count: 0,
      effective: null,
      upcoming: null,
    };
  }

  it('ShouldShowServerReportedStatusForEveryActiveSystemAndOmitRetiredSystems', async () => {
    // Arrange
    detailAnswers();
    const second = { ...instance, system_instance_id: otherInstanceId, name: 'Payroll archive' };
    const retired = {
      ...instance,
      system_instance_id: retiredInstanceId,
      name: 'Retired payroll server',
      lifecycle: 'retired',
    };
    api.reply(`${app}/system-instances`, 200, { items: [instance, second, retired], next_cursor: null });
    api.reply(`${app}/access-review-scopes`, 200, {
      items: [
        scopeStatus(instanceId, 'included'),
        scopeStatus(otherInstanceId, 'excluded'),
        scopeStatus(retiredInstanceId, 'unresolved', 'retired'),
      ],
      next_cursor: null,
    });

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Access-review scope: Excluded'));

    // Assert
    expect(container.querySelector('[aria-label="Access-review scope status for Payroll production"]')?.textContent)
      .toContain('Included');
    expect(container.querySelector('[aria-label="Access-review scope status for Payroll archive"]')?.textContent)
      .toContain('Excluded');
    expect(container.querySelector('[aria-label="Access-review scope status for Retired payroll server"]')).toBeNull();
    expect(container.querySelector('button[aria-pressed="false"]')?.textContent).toBe('Access-review scope for Payroll production');
  });

  it('ShouldLoadEveryPageOfAccessReviewScopeStatuses', async () => {
    // Arrange
    detailAnswers();
    const second = { ...instance, system_instance_id: otherInstanceId, name: 'Payroll archive' };
    api.reply(`${app}/system-instances`, 200, { items: [instance, second], next_cursor: null });
    api.reply(`${app}/access-review-scopes`, 200, {
      items: [scopeStatus(instanceId, 'included')],
      next_cursor: 'next-page',
    });
    api.reply(`GET ${app}/access-review-scopes?cursor=next-page`, 200, {
      items: [scopeStatus(otherInstanceId, 'unresolved')],
      next_cursor: null,
    });

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Access-review scope: Unresolved'));

    // Assert
    expect(api.requestUrls.some(({ url }) => new URL(url).searchParams.get('cursor') === 'next-page')).toBe(true);
    expect(container.querySelector('[aria-label="Access-review scope status for Payroll archive"]')?.textContent)
      .toContain('Unresolved');
  });

  it('ShouldShowLoadingStateForAccessReviewScopeStatuses', async () => {
    // Arrange
    detailAnswers();
    const transport = globalThis.fetch;
    let releaseScopeResponse: (response: Response) => void = () => {
      throw new Error('The access-review scope request has not started.');
    };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), 'http://app.test');
      if (url.pathname === `${app}/access-review-scopes`) {
        return await new Promise<Response>((resolve) => {
          releaseScopeResponse = resolve;
        });
      }
      return transport(input, init);
    });

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Payroll'));
    expect(container.querySelector('[aria-label="Loading access-review scope statuses"]')).not.toBeNull();
    releaseScopeResponse(new Response(JSON.stringify({ items: [scopeStatus(instanceId, 'unresolved')], next_cursor: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await vi.waitFor(() => expect(container.textContent).toContain('Access-review scope: Unresolved'));

    // Assert
    expect(container.querySelector('[aria-label="Access-review scope status for Payroll production"]')?.textContent)
      .toContain('Unresolved');
  });

  it('ShouldShowEmptyStateWhenNoActiveSystemsHaveScopeStatus', async () => {
    // Arrange
    detailAnswers();
    api.reply(`${app}/system-instances`, 200, { items: [], next_cursor: null });

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('No active systems to show access-review scope status for.'));

    // Assert
    expect(container.querySelector('[aria-label="Access-review scope status for Payroll production"]')).toBeNull();
  });

  it('ShouldOfferRetryWhenAccessReviewScopeStatusesFailToLoad', async () => {
    // Arrange
    detailAnswers();
    api.reply(`${app}/access-review-scopes`, 500, problem(500, 'Temporary failure'));
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);

    // Act
    await vi.waitFor(() => expect(container.textContent).toContain('Access-review scope status could not be loaded'));
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Try again');
    retry?.click();
    await vi.waitFor(() => expect(api.requested.filter((path) => path === `${app}/access-review-scopes`)).toHaveLength(2));

    // Assert
    expect(retry).not.toBeUndefined();
    expect(container.querySelector('[aria-label="Access-review scope status for Payroll production"]')).toBeNull();
  });

  it('ShouldExplainForbiddenAccessReviewScopeStatuses', async () => {
    // Arrange
    detailAnswers();
    api.reply(`${app}/access-review-scopes`, 403, problem(403, 'Forbidden'));

    // Act
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('You do not have permission to view access-review scope status for these systems.'));

    // Assert
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Try again')).toBe(false);
  });
});

describe('access-review scope (R1-10c frontend #216)', () => {
  it('ShouldShowUnresolvedScopeAndDecideAgainstExpectedCounts', async () => {
    // Arrange
    detailAnswers();
    api.reply(`GET ${instancePath}/access-review-scope`, 200, {
      tenant_id: tenantId, application_id: applicationId, system_instance_id: instanceId,
      as_of: '2026-09-30T00:00:00Z', status: 'unresolved', effective: null, decisions: [],
    });
    api.reply(`POST ${instancePath}/access-review-scope-decisions`, 200, decision);
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await openScope(container);
    expect(container.textContent).toContain('Unresolved: no scope decision applies');
    typeInto(container, 'Rationale', 'Holds payroll data');
    typeInto(container, 'Effective from', '2026-10-01');

    // Act
    submit(container, 'Decide access-review scope');
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')).not.toBeNull());

    // Assert
    expect(api.bodies.find((b) => b.path === `${instancePath}/access-review-scope-decisions`)?.body).toEqual({
      expected_system_instance_revision: 1,
      expected_decision_count: 0,
      decision: 'included',
      reason: 'Holds payroll data',
      effective_from: '2026-10-01T00:00:00Z',
    });
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldShowCurrentDecisionAndHistoryAsOfADate', async () => {
    // Arrange
    detailAnswers();
    api.reply(`GET ${instancePath}/access-review-scope`, 200, {
      tenant_id: tenantId, application_id: applicationId, system_instance_id: instanceId,
      as_of: '2026-09-30T00:00:00Z', status: 'included', effective: decision, decisions: [decision],
    });
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await openScope(container);

    // Act
    typeInto(container, 'Show decision as of', '2026-09-25');
    await vi.waitFor(() => expect(api.requested.filter((p) => p === `${instancePath}/access-review-scope`)).toHaveLength(2));

    // Assert
    expect(container.textContent).toContain('Included in access reviews');
    expect(container.querySelectorAll('.scope-history li')).toHaveLength(1);
    expect(container.querySelector('.scope-history li')?.textContent).toContain('Casey Lead');
  });

  it('ShouldExplainSeparationOfDutiesGivenTheRegistrarDecides', async () => {
    // Arrange
    detailAnswers();
    api.reply(`GET ${instancePath}/access-review-scope`, 200, {
      tenant_id: tenantId, application_id: applicationId, system_instance_id: instanceId,
      as_of: '2026-09-30T00:00:00Z', status: 'unresolved', effective: null, decisions: [],
    });
    api.reply(
      `POST ${instancePath}/access-review-scope-decisions`,
      403,
      problem(403, 'The member who registered the system instance cannot approve its access-review scope without an active exact-scope waiver.')
    );
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await openScope(container);
    typeInto(container, 'Rationale', 'Holds payroll data');

    // Act
    submit(container, 'Decide access-review scope');
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());

    // Assert
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Separation of duties');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('waiver');
  });

  it('ShouldShowForbiddenGivenTheViewerCannotDecideScope', async () => {
    // Arrange
    detailAnswers();
    api.reply(`GET ${instancePath}/access-review-scope`, 403, problem(403, 'Forbidden'));
    const container = mount(() => <ApplicationDetailPage applicationId={applicationId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Payroll production'));

    // Act
    [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Access-review scope for'))!.click();
    await vi.waitFor(() => expect(container.textContent).toContain('You do not have permission to view this access-review scope'));

    // Assert
    expect(container.querySelector('form[aria-label="Decide access-review scope"]')).toBeNull();
  });
});
