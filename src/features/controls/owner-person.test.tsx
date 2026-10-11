// @vitest-environment jsdom
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';
import { ControlDetailPage } from './pages/control-detail.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const programId = '0190a1b2-0000-7000-8000-0000000000b1';
const controlId = '0190a1b2-0000-7000-8000-0000000000c1';
const versionId = '0190a1b2-0000-7000-8000-0000000000d1';
const personId = '0190a1b2-0000-7000-8000-0000000000e1';
const otherPersonId = '0190a1b2-0000-7000-8000-0000000000e2';
const designationId = '0190a1b2-0000-7000-8000-0000000000f1';
const base = `/api/v1/tenants/${tenantId}`;
const control = `${base}/programs/${programId}/controls/${controlId}`;
const ownerPath = `${control}/draft/owner-person`;
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

const content = {
  title: 'Access reviews',
  objective: 'Appropriate access',
  description: 'Review access',
  implementation_narrative: 'Quarterly review',
  expected_evidence_descriptions: ['Signed review'],
  owner_reference: 'Platform lead',
  applicability: [],
};

function person(id = personId, name = 'Alex Workforce') {
  return {
    tenant_id: tenantId,
    person_id: id,
    revision: 1,
    display_name: name,
    work_email: null,
    source_kind: 'manual',
    correlated_user_id: null,
    last_changed_by: { kind: 'member', id: 'm', display: 'Casey Lead' },
    last_changed_at: '2026-10-11T12:00:00Z',
  };
}

function designation(id = personId) {
  return {
    person_id: id,
    designation_id: designationId,
    rationale: 'Owns the quarterly review',
    actor: { kind: 'member', id: 'm', display: 'Casey Lead' },
    designated_at: '2026-10-11T12:00:00Z',
  };
}

function ownerBody(
  saved: ReturnType<typeof designation> | null = null,
  revision = 2,
  draftVersionId: string | null = versionId
) {
  return {
    tenant_id: tenantId,
    program_id: programId,
    control_id: controlId,
    draft_version_id: draftVersionId,
    revision,
    designation: saved,
  };
}

function answers(
  saved: ReturnType<typeof designation> | null = null,
  revision = 2
) {
  api.reply(`GET ${control}/draft`, 200, {
    tenant_id: tenantId,
    program_id: programId,
    control_id: controlId,
    draft_version_id: versionId,
    identifier: 'AC-01',
    revision,
    status: 'draft',
    owner_resolution: 'unresolved',
    applicability_resolution: 'unresolved',
    content,
    last_changed_by_member_id: 'm',
    last_changed_by_display: 'Casey Lead',
    last_changed_at: '2026-10-11T12:00:00Z',
  });
  api.reply(`GET ${ownerPath}`, 200, ownerBody(saved, revision));
  api.reply(`GET ${base}/people`, 200, {
    items: [person(), person(otherPersonId, 'Blair Workforce')],
    next_cursor: null,
  });
  api.reply(`GET ${control}/draft/revisions`, 200, {
    items: [],
    next_cursor: null,
  });
  api.reply(`GET ${control}/current-version`, 404);
  api.reply(`GET ${control}/decisions`, 200, { items: [], next_cursor: null });
  api.reply(`GET ${control}/versions`, 200, { items: [], next_cursor: null });
  api.reply(`GET ${base}/programs/${programId}`, 200, {
    program_id: programId,
    name: 'SOC 2',
    stage: 'readiness',
    next_stage: 'type_i',
    revision: 1,
    plan: {},
    stage_plan: [],
    criteria_edition_id: null,
    last_changed_by_display: 'Casey Lead',
    last_changed_at: '2026-10-11T12:00:00Z',
  });
}

function mount() {
  const result = render(() => (
    <ControlDetailPage programId={programId} controlId={controlId} />
  ));
  mounted.push(result);
  return result.container;
}

function card(container: HTMLElement) {
  return container.querySelector(
    '[aria-label="Accountable person"]'
  ) as HTMLElement;
}

function selectPerson(container: HTMLElement, id = personId) {
  const select = card(container).querySelector('select')!;
  select.value = id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  const rationale = card(container).querySelector('textarea')!;
  rationale.value = 'Owns the quarterly review';
  rationale.dispatchEvent(new Event('input', { bubbles: true }));
}

function submit(container: HTMLElement) {
  card(container)
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function savedName(container: HTMLElement) {
  return card(container).querySelector(
    '[aria-label="Saved accountable person"] strong'
  )?.textContent;
}

function problem(status: number, detail: string, transient = false) {
  return {
    type: 'about:blank',
    title: 'Problem',
    status,
    detail,
    instance: '/',
    transient,
  };
}

function button(container: HTMLElement, label: string) {
  return [...card(container).querySelectorAll('button')].find(
    (entry) => entry.textContent === label
  )!;
}

async function ready(container: HTMLElement) {
  await vi.waitFor(() =>
    expect(card(container)?.querySelector('fieldset')?.disabled).toBe(false)
  );
}

beforeEach(async () => {
  clearActiveTenant();
  api = stubApi();
  api.reply('/api/v1/tenant-slugs/acme/mine', 200, {
    tenant_id: tenantId,
    current_slug: 'acme',
    redirect: false,
  });
  api.reply('/api/v1/tenants/mine', 200, {
    items: [{ tenant_id: tenantId, name: 'Acme', slug: 'acme' }],
    next_cursor: null,
  });
  await resolveTenantRoute('acme', {
    pathname: '/acme/programs',
    search: '',
    hash: '',
  });
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.cleanup();
  vi.unstubAllGlobals();
});

describe('control accountable person (#29)', () => {
  it('ShouldSaveAndReloadExactPersonDesignationGivenAnOpenDraftAndPersonWithoutAccount', async () => {
    // Arrange
    answers();
    api.reply(`PUT ${ownerPath}`, 204);
    const container = mount();
    await ready(container);
    selectPerson(container);
    api.reply(`GET ${ownerPath}`, 200, ownerBody(designation()));

    // Act
    submit(container);
    await vi.waitFor(() =>
      expect(card(container).textContent).toContain('Recorded by Casey Lead')
    );

    // Assert
    expect(api.bodies.filter((b) => b.method === 'PUT')).toEqual([
      {
        method: 'PUT',
        path: ownerPath,
        body: {
          expected_revision: 2,
          person_id: personId,
          rationale: 'Owns the quarterly review',
        },
      },
    ]);
    expect(
      api.bodies.filter((b) => b.method === 'GET' && b.path === ownerPath)
        .length
    ).toBeGreaterThan(1);
    expect(
      api.bodies.filter(
        (b) => b.method === 'GET' && b.path === `${control}/draft`
      ).length
    ).toBeGreaterThan(1);
    mounted.pop()?.cleanup();
    const reloaded = mount();
    await vi.waitFor(() =>
      expect(card(reloaded)?.textContent).toContain('Recorded by Casey Lead')
    );
    expect(card(reloaded).textContent).toContain('Alex Workforce');
    expect(card(reloaded).textContent).toContain('Owns the quarterly review');
    expect(card(reloaded).querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-10-11T12:00:00Z'
    );
    expect(card(reloaded).textContent).not.toContain(designationId);
    expect(card(reloaded).textContent).not.toContain(versionId);
    expect(reloaded.querySelector('a[href="/acme/workforce"]')).not.toBeNull();
    expect(api.requested.some((path) => /invitations|grants/.test(path))).toBe(
      false
    );
    expect(await accessibilityViolations(reloaded)).toEqual([]);
  });

  it('ShouldChangeAndClearTheSavedPersonGivenAnOpenDraft', async () => {
    // Arrange
    answers(designation());
    api.reply(`PUT ${ownerPath}`, 204);
    const container = mount();
    await ready(container);
    selectPerson(container, otherPersonId);
    api.reply(`GET ${ownerPath}`, 200, ownerBody(designation(otherPersonId)));

    // Act
    submit(container);
    await vi.waitFor(() =>
      expect(savedName(container)).toBe('Blair Workforce')
    );
    await ready(container);
    selectPerson(container, '');
    api.reply(`GET ${ownerPath}`, 200, ownerBody());
    submit(container);

    // Assert
    await vi.waitFor(() =>
      expect(card(container).textContent).toContain(
        'No accountable person designated.'
      )
    );
    expect(
      api.bodies.filter((b) => b.method === 'PUT').map((b) => b.body)
    ).toEqual([
      {
        expected_revision: 2,
        person_id: otherPersonId,
        rationale: 'Owns the quarterly review',
      },
      { expected_revision: 2, rationale: 'Owns the quarterly review' },
    ]);
  });

  it('ShouldPreventDuplicateAndOptimisticWritesGivenAPendingDesignation', async () => {
    // Arrange
    answers(designation());
    api.reply(`PUT ${ownerPath}`, 204);
    const container = mount();
    await ready(container);
    selectPerson(container, otherPersonId);
    const fetch = globalThis.fetch;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await fetch(input, init);
        if (
          input instanceof Request &&
          input.method === 'PUT' &&
          new URL(input.url).pathname === ownerPath
        )
          await pending;
        return response;
      }
    );

    // Act
    submit(container);
    submit(container);
    await vi.waitFor(() =>
      expect(button(container, 'Saving person…')?.disabled).toBe(true)
    );

    // Assert
    await vi.waitFor(() =>
      expect(api.bodies.filter((b) => b.method === 'PUT')).toHaveLength(1)
    );
    expect(savedName(container)).toBe('Alex Workforce');
    api.reply(`GET ${ownerPath}`, 200, ownerBody(designation(otherPersonId)));
    finish();
    await vi.waitFor(() =>
      expect(savedName(container)).toBe('Blair Workforce')
    );
  });

  it('ShouldLimitRationaleGivenMoreThanFourThousandCharacters', async () => {
    // Arrange
    answers();
    const container = mount();
    await ready(container);
    selectPerson(container);
    const rationale = card(container).querySelector('textarea')!;

    // Act
    rationale.value = 'x'.repeat(4001);
    rationale.dispatchEvent(new Event('input', { bubbles: true }));
    submit(container);

    // Assert
    expect(rationale.maxLength).toBe(4000);
    expect(button(container, 'Save accountable person').disabled).toBe(true);
    expect(api.bodies.filter((b) => b.method === 'PUT')).toHaveLength(0);
  });

  it.each([
    [400, 'The person must belong to this organization.', false],
    [401, 'Sign in again to save the accountable person.', false],
    [403, 'Only compliance leads may designate this owner.', false],
    [404, 'The selected workforce person was not found.', false],
    [409, 'Control lifecycle is disabled.', false],
    [409, 'There is no open control draft.', false],
    [409, 'The control draft revision is stale; current revision is 3.', false],
    [409, 'Owner read model is catching up. Retry later.', true],
  ])(
    'ShouldRetainSavedOwnerAndServerDetailsGivenWriteFailure%s%s',
    async (status, detail, transient) => {
      // Arrange
      answers(designation());
      api.reply(
        `PUT ${ownerPath}`,
        status,
        status === 401 ? undefined : problem(status, detail, transient)
      );
      const container = mount();
      await ready(container);
      selectPerson(container, otherPersonId);

      // Act
      submit(container);

      // Assert
      await vi.waitFor(() =>
        expect(
          card(container).querySelector('[role="alert"]')?.textContent
        ).toBe(detail)
      );
      expect(savedName(container)).toBe('Alex Workforce');
      expect(card(container).querySelector('textarea')?.value).toBe(
        'Owns the quarterly review'
      );
      expect(api.bodies.filter((b) => b.method === 'PUT')).toHaveLength(1);
      expect(
        api.bodies.filter((b) => b.method === 'GET' && b.path === ownerPath)
      ).toHaveLength(1);
    }
  );

  it('ShouldRetainSavedOwnerGivenANetworkFailure', async () => {
    // Arrange
    answers(designation());
    const container = mount();
    await ready(container);
    selectPerson(container, otherPersonId);
    const fetch = globalThis.fetch;
    let writes = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (
        input instanceof Request &&
        input.method === 'PUT' &&
        new URL(input.url).pathname === ownerPath
      ) {
        writes += 1;
        throw new Error('Network connection lost while saving the owner.');
      }
      return fetch(input, init);
    });

    // Act
    submit(container);

    // Assert
    await vi.waitFor(() =>
      expect(
        card(container).querySelector('[role="alert"]')?.textContent
      ).toContain('Network connection lost')
    );
    expect(savedName(container)).toBe('Alex Workforce');
    expect(writes).toBe(1);
  });

  it('ShouldKeepSavedIdentityGivenAnEmptyRoster', async () => {
    // Arrange
    answers(designation());
    api.reply(`GET ${base}/people`, 200, { items: [], next_cursor: null });

    // Act
    const container = mount();
    await ready(container);

    // Assert
    expect(savedName(container)).toBe(`Person ${personId}`);
    expect(card(container).textContent).toContain('No people are recorded');
    expect(card(container).querySelector('select')?.value).toBe(personId);
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldKeepSavedIdentityAndRetryGivenAFailedRoster', async () => {
    // Arrange
    answers(designation());
    api.reply(`GET ${base}/people`, 500, problem(500, 'Roster unavailable.'));
    const container = mount();
    await vi.waitFor(() =>
      expect(card(container)?.textContent).toContain('Roster unavailable.')
    );

    // Act
    api.reply(`GET ${base}/people`, 200, {
      items: [person()],
      next_cursor: null,
    });
    button(container, 'Retry workforce roster').click();

    // Assert
    expect(savedName(container)).toBe(`Person ${personId}`);
    await ready(container);
    expect(savedName(container)).toBe('Alex Workforce');
  });

  it('ShouldOfferExplicitRetryGivenAFailedOwnerRead', async () => {
    // Arrange
    answers();
    api.reply(
      `GET ${ownerPath}`,
      409,
      problem(409, 'Owner projection is catching up.', true)
    );
    const container = mount();
    await vi.waitFor(() =>
      expect(card(container)?.textContent).toContain(
        'Owner projection is catching up.'
      )
    );

    // Act
    api.reply(`GET ${ownerPath}`, 200, ownerBody(designation()));
    button(container, 'Retry owner read').click();

    // Assert
    expect(card(container).querySelector('form')).toBeNull();
    await ready(container);
    expect(savedName(container)).toBe('Alex Workforce');
  });

  it('ShouldKeepTheLastAuthoritativeOwnerGivenAFailedReadAfterSaving', async () => {
    // Arrange
    answers(designation());
    api.reply(`PUT ${ownerPath}`, 204);
    const container = mount();
    await ready(container);
    selectPerson(container, otherPersonId);
    api.reply(
      `GET ${ownerPath}`,
      500,
      problem(500, 'Owner readback unavailable.')
    );

    // Act
    submit(container);

    // Assert
    await vi.waitFor(() =>
      expect(card(container).textContent).toContain(
        'Owner readback unavailable.'
      )
    );
    expect(savedName(container)).toBe('Alex Workforce');
    expect(card(container).querySelector('fieldset')?.disabled).toBe(true);
    expect(api.bodies.filter((b) => b.method === 'PUT')).toHaveLength(1);
    api.reply(`GET ${ownerPath}`, 200, ownerBody(designation(otherPersonId)));
    button(container, 'Retry owner read').click();
    await vi.waitFor(() =>
      expect(savedName(container)).toBe('Blair Workforce')
    );
  });

  it('ShouldDisableDesignationGivenNoOpenDraft', async () => {
    // Arrange
    answers();
    api.reply(`GET ${ownerPath}`, 200, ownerBody(null, 2, null));

    // Act
    const container = mount();

    // Assert
    await vi.waitFor(() =>
      expect(card(container)?.textContent).toContain('No open draft.')
    );
    expect(card(container).querySelector('form')).toBeNull();
    expect(api.bodies.filter((b) => b.method === 'PUT')).toHaveLength(0);
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it.each([
    [3, versionId],
    [2, '0190a1b2-0000-7000-8000-0000000000d2'],
  ])(
    'ShouldDisableDesignationGivenARevisionOrVersionMismatch%s%s',
    async (revision, draftVersionId) => {
      // Arrange
      answers(designation());
      api.reply(
        `GET ${ownerPath}`,
        200,
        ownerBody(designation(), revision, draftVersionId)
      );
      const container = mount();
      await vi.waitFor(() =>
        expect(card(container)?.textContent).toContain(
          'The owner readback and draft differ.'
        )
      );
      selectPerson(container, otherPersonId);

      // Act
      submit(container);

      // Assert
      expect(card(container).querySelector('fieldset')?.disabled).toBe(true);
      expect(api.bodies.filter((b) => b.method === 'PUT')).toHaveLength(0);
      api.reply(`GET ${ownerPath}`, 200, ownerBody(designation()));
      button(container, 'Reload control and owner').click();
      await ready(container);
    }
  );

  it('ShouldDisableDesignationGivenPendingOwnerAndRosterReads', async () => {
    // Arrange
    answers();
    const fetch = globalThis.fetch;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (
          input instanceof Request &&
          [ownerPath, `${base}/people`].includes(new URL(input.url).pathname)
        )
          await pending;
        return fetch(input, init);
      }
    );

    // Act
    const container = mount();

    // Assert
    await vi.waitFor(() =>
      expect(
        card(container)?.querySelector(
          '[aria-label="Loading accountable person"]'
        )
      ).toBeInstanceOf(HTMLElement)
    );
    expect(card(container).querySelector('form')).toBeNull();
    expect(
      card(container).querySelector('[aria-label="Loading workforce people"]')
    ).not.toBeNull();
    finish();
    await ready(container);
    expect(card(container).textContent).toContain(
      'No accountable person designated.'
    );
  });

  it.each(['content', 'lifecycle'])(
    'ShouldRefreshOwnerWithoutCarryingOldDesignationGivenA%sChange',
    async (change) => {
      // Arrange
      answers(designation());
      api.reply(`PUT ${control}/draft`, 204);
      api.reply(`POST ${control}/draft/reviews`, 204);
      const container = mount();
      await ready(container);
      const fetch = globalThis.fetch;
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      vi.stubGlobal(
        'fetch',
        async (input: RequestInfo | URL, init?: RequestInit) => {
          if (
            input instanceof Request &&
            input.method === 'GET' &&
            new URL(input.url).pathname === ownerPath
          )
            await pending;
          return fetch(input, init);
        }
      );
      answers(null, change === 'content' ? 3 : 2);

      // Act
      const form =
        change === 'content'
          ? container.querySelector('form')!
          : container.querySelector('form[aria-label="Review draft"]')!;
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true })
      );

      // Assert
      await vi.waitFor(() =>
        expect(
          card(container).querySelector(
            '[aria-label="Saved accountable person"]'
          )
        ).toBeNull()
      );
      expect(card(container).querySelector('form')).toBeNull();
      finish();
      await ready(container);
      expect(card(container).textContent).toContain(
        'No accountable person designated.'
      );
      expect(
        api.bodies.filter((b) => b.method === 'GET' && b.path === ownerPath)
          .length
      ).toBeGreaterThan(1);
    }
  );
});
