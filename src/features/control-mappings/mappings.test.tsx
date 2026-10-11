// @vitest-environment jsdom
import { state } from '@askrjs/askr';
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import type { Program } from '../programs/programs.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';
import { CoverageCard } from './coverage-card.js';
import { ControlMappingsCard } from './mappings-card.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const programId = '0190a1b2-0000-7000-8000-0000000000b1';
const controlId = '0190a1b2-0000-7000-8000-0000000000c1';
const versionId = '0190a1b2-0000-7000-8000-0000000000d1';
const editionId = '0f3c5a52-9d8e-5b4a-8f21-20172022a0f1';
const mappingId = '0190a1b2-0000-7000-8000-0000000000a1';
const memberId = '0190a1b2-0000-7000-8000-0000000000f1';
const reviewId = '0190a1b2-0000-7000-8000-0000000000f2';
const criterionSummaries = {
  'CC6.1':
    'Systems and data are protected by access controls, network boundaries, and encryption.',
  'CC6.2':
    'Accounts are created only after approval and disabled when no longer needed.',
};
const base = `/api/v1/tenants/${tenantId}`;
const programPath = `${base}/programs/${programId}`;
const mappings = `${programPath}/control-mappings`;
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function mount(component: () => unknown): HTMLElement {
  const result = render(component as never);
  mounted.push(result);
  return result.container;
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

const program: Program = {
  programId,
  name: 'SOC 2 2026',
  stage: 'readiness',
  nextStage: 'type_i',
  revision: 3,
  plan: {
    target_readiness_date: null,
    target_type_i_as_of_date: null,
    target_type_ii_start_date: null,
    target_type_ii_end_date: null,
    readiness_advisor: null,
    audit_firm: null,
  },
  stagePlan: [],
  lastChangedBy: 'Casey Lead',
  lastChangedAt: '2026-09-20T00:00:00Z',
  criteriaEditionId: editionId,
};

const person = (display: string) => ({ kind: 'member', id: memberId, display });

function mappingVersion(versionNumber: number, status: string) {
  return {
    version_number: versionNumber,
    control_version_id: versionId,
    status,
    rationale: 'Quarterly reviews restrict access.',
    applicability_explanation: 'Production systems in the boundary.',
    proposed_by: person('Casey Lead'),
    proposed_at: '2026-09-20T00:00:00Z',
    review_decision_id: status === 'pending' ? null : reviewId,
    reviewed_by: person('Riley Reviewer'),
    review_rationale: status === 'pending' ? null : 'Agreed.',
    reviewed_at: status === 'pending' ? null : '2026-09-21T00:00:00Z',
    separation_of_duties_waiver_id: null,
    retired_by: person(''),
    retirement_rationale: null,
    retired_at: null,
  };
}

function mapping(status: string, versions: unknown[], active: number | null) {
  return {
    tenant_id: tenantId,
    program_id: programId,
    mapping_id: mappingId,
    control_id: controlId,
    edition_id: editionId,
    criterion_identifier: 'CC6.1',
    criterion_kind: 'criterion',
    revision: 4,
    status,
    active_version_number: active,
    active_control_version_id: active === null ? null : versionId,
    versions,
  };
}

function answers(items: unknown[]) {
  api.reply(`GET ${programPath}`, 200, {
    tenant_id: tenantId,
    program_id: programId,
    name: 'SOC 2 2026',
    stage: 'readiness',
    next_stage: 'type_i',
    revision: 3,
    plan: program.plan,
    last_changed_by_member_id: memberId,
    last_changed_by_display: 'Casey Lead',
    last_changed_at: '2026-09-20T00:00:00Z',
    stage_plan: [],
    criteria_edition_id: editionId,
  });
  api.reply(`GET ${mappings}`, 200, { items, next_cursor: null });
  api.reply(`GET ${base}/criteria-editions/${editionId}/entries`, 200, {
    items: [
      {
        edition_id: editionId,
        identifier: 'CC6.1',
        source_identifier: 'CC6.1',
        category: 'security',
        kind: 'criterion',
        parent_identifier: null,
        summary: criterionSummaries['CC6.1'],
      },
      {
        edition_id: editionId,
        identifier: 'CC6.2',
        source_identifier: 'CC6.2',
        category: 'security',
        kind: 'criterion',
        parent_identifier: null,
        summary: criterionSummaries['CC6.2'],
      },
    ],
    next_cursor: null,
  });
}

function form(container: HTMLElement, name: string) {
  return container.querySelector(
    `form[aria-label="${name}"]`
  ) as HTMLFormElement;
}

function field(root: HTMLElement, label: string) {
  return [...root.querySelectorAll('label')]
    .find((l) => l.querySelector('span')?.textContent === label)!
    .querySelector('input, textarea, select') as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement;
}

function type(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
) {
  element.value = value;
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {
      bubbles: true,
    })
  );
}

function submit(element: HTMLFormElement) {
  element.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true })
  );
}

function sent(method: string, path: string) {
  return api.bodies.find((b) => b.method === method && b.path === path)
    ?.body as Record<string, unknown> | undefined;
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
    items: [{ tenant_id: tenantId, name: 'Acme Corp', slug: 'acme' }],
    next_cursor: null,
  });
  await resolveTenantRoute('acme', {
    pathname: '/acme/programs',
    search: '',
    hash: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('control criteria mappings (R1-06 frontend #205)', () => {
  it('ShouldKeepRetainedSourceIdentitiesGivenTheCurrentApprovedVersionChanges', async () => {
    // Arrange: the second retained source is a synthetic test version, not a successor workflow.
    const secondSourceId = '0190a1b2-0000-7000-8000-0000000000d2';
    const currentSourceId = '0190a1b2-0000-7000-8000-0000000000d3';
    answers([
      mapping(
        'accepted',
        [
          mappingVersion(1, 'accepted'),
          {
            ...mappingVersion(2, 'rejected'),
            control_version_id: secondSourceId,
            rationale: 'Service-account reviews restrict access.',
            applicability_explanation: 'Production service accounts only.',
          },
        ],
        1
      ),
    ]);
    let changeCurrentVersion!: (value: string) => void;
    const container = mount(() => {
      const [currentVersion, setCurrentVersion] = state(versionId);
      changeCurrentVersion = setCurrentVersion;
      return (
        <ControlMappingsCard
          programId={programId}
          controlId={controlId}
          currentVersionId={currentVersion()}
        />
      );
    });
    await vi.waitFor(() =>
      expect(
        container.querySelectorAll('.control-mapping-history > li')
      ).toHaveLength(2)
    );

    // Act
    changeCurrentVersion(currentSourceId);
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'The reviewed mapping cites an earlier approved control version.'
      )
    );

    // Assert
    const item = container.querySelector('.control-mapping')!;
    expect(item.textContent).toContain('CC6.1 (criterion)');
    expect(item.textContent).toContain(`Catalog edition: ${editionId}`);
    const history = item.querySelectorAll('.control-mapping-history > li');
    expect(history[0].textContent).toContain('Version 2 · rejected');
    expect(history[0].textContent).toContain(
      `Approved control version: ${secondSourceId}`
    );
    expect(history[0].textContent).toContain(
      'Rationale: Service-account reviews restrict access.'
    );
    expect(history[0].textContent).toContain(
      'Applies to: Production service accounts only.'
    );
    expect(history[1].textContent).toContain('Version 1 · accepted');
    expect(history[1].textContent).toContain(
      `Approved control version: ${versionId}`
    );
    expect(history[1].textContent).toContain(
      'Rationale: Quarterly reviews restrict access.'
    );
    expect(history[1].textContent).toContain(
      'Applies to: Production systems in the boundary.'
    );
    expect(history[0].textContent).not.toContain(versionId);
    expect(history[1].textContent).not.toContain(secondSourceId);
    expect(item.textContent).not.toContain(currentSourceId);
  });

  it('ShouldReopenTheSavedMappingGivenAProposalToTheSelectedEdition', async () => {
    // Arrange
    answers([]);
    const rationale = 'Access requests are approved.';
    const applicability = 'Workforce accounts in production.';
    const saved = {
      ...mapping(
        'pending',
        [
          {
            ...mappingVersion(1, 'pending'),
            rationale,
            applicability_explanation: applicability,
            reviewed_by: null,
            retired_by: null,
          },
        ],
        null
      ),
      criterion_identifier: 'CC6.2',
      revision: 1,
    };
    api.reply(`POST ${mappings}`, 200, {
      mapping_id: mappingId,
      revision: 1,
      version_number: 1,
    });
    const container = mount(() => (
      <ControlMappingsCard
        programId={programId}
        controlId={controlId}
        currentVersionId={versionId}
      />
    ));
    await vi.waitFor(() =>
      expect(form(container, 'Propose criteria mapping')).not.toBeNull()
    );
    await vi.waitFor(() =>
      expect(container.querySelectorAll('option')).toHaveLength(3)
    );
    expect(container.textContent).toContain('not mapped to any criteria yet');
    expect(
      api.bodies.filter((b) => b.method === 'GET' && b.path === mappings)
    ).toHaveLength(1);
    const propose = form(container, 'Propose criteria mapping');
    type(field(propose, 'Criterion'), 'CC6.2');
    type(field(propose, 'Why this control addresses it'), rationale);
    type(field(propose, 'Applicability explanation'), applicability);
    api.reply(`GET ${mappings}`, 200, {
      items: [saved],
      next_cursor: null,
    });

    // Act
    submit(propose);
    await vi.waitFor(() =>
      expect(container.querySelector('.control-mapping')).not.toBeNull()
    );

    // Assert
    expect(sent('POST', mappings)).toEqual({
      control_id: controlId,
      control_version_id: versionId,
      edition_id: editionId,
      criterion_identifier: 'CC6.2',
      expected_revision: 0,
      rationale,
      applicability_explanation: applicability,
    });
    expect(
      api.bodies.filter((b) => b.method === 'GET' && b.path === mappings)
    ).toHaveLength(2);
    function expectSavedMapping(root: HTMLElement) {
      const item = root.querySelector('.control-mapping')!;
      expect(item.textContent).toContain(
        'CC6.2 (criterion) · pending · no reviewed version'
      );
      expect(item.textContent).toContain(`Catalog edition: ${editionId}`);
      const history = item.querySelectorAll('.control-mapping-history > li');
      expect(history).toHaveLength(1);
      expect(history[0].textContent).toContain('Version 1 · pending');
      expect(history[0].textContent).toContain('proposed by Casey Lead');
      expect(history[0].textContent).toContain(
        `Approved control version: ${versionId}`
      );
      expect(history[0].textContent).toContain(`Rationale: ${rationale}`);
      expect(history[0].textContent).toContain(`Applies to: ${applicability}`);
      expect(history[0].textContent).not.toContain('Reviewed by');
      expect(root.textContent).not.toContain('not mapped to any criteria yet');
    }
    expectSavedMapping(container);

    // Act: dispose the original component; reopening must load the saved server reads.
    mounted.pop()!.cleanup();
    expect(container.isConnected).toBe(false);
    const readPaths = [
      programPath,
      mappings,
      `${base}/criteria-editions/${editionId}/entries`,
    ];
    const readsBeforeReopen = readPaths.map(
      (path) =>
        api.bodies.filter((b) => b.method === 'GET' && b.path === path).length
    );
    const reopened = mount(() => (
      <ControlMappingsCard
        programId={programId}
        controlId={controlId}
        currentVersionId={versionId}
      />
    ));
    await vi.waitFor(() =>
      expect(reopened.querySelector('.control-mapping')).not.toBeNull()
    );
    await vi.waitFor(() =>
      expect(reopened.querySelectorAll('option')).toHaveLength(3)
    );

    // Assert
    readPaths.forEach((path, index) => {
      expect(
        api.bodies.filter((b) => b.method === 'GET' && b.path === path)
      ).toHaveLength(readsBeforeReopen[index] + 1);
    });
    expectSavedMapping(reopened);
    expect(reopened.querySelector('[role="status"]')).toBeNull();
    expect(await accessibilityViolations(reopened)).toEqual([]);
  });

  it.each([
    {
      refusal: 'AnInvalidCriterion',
      status: 400,
      detail: 'The criterion or point of focus is not in the selected edition.',
    },
    {
      refusal: 'ADuplicateMapping',
      status: 409,
      detail:
        'An accepted mapping with the same control version and explanation already exists.',
    },
    {
      refusal: 'AStaleMappingRevision',
      status: 409,
      detail:
        'The control criterion mapping changed. Current revision: 5. Reload it and retry.',
      feedback:
        'Someone else changed this mapping since you opened it. Reload to see their changes, then try again.',
    },
    {
      refusal: 'DeniedProgramManagement',
      status: 403,
      detail: 'The actor may not manage this program.',
      feedback: 'You do not have permission to propose the criteria mapping.',
    },
    {
      refusal: 'AForeignOrMissingProgram',
      status: 404,
      detail: 'The program was not found.',
    },
  ])(
    'ShouldKeepTheProposalAndHistoryGiven$refusal',
    async ({ status, detail, feedback }) => {
      // Arrange: these stub responses prove client feedback, not server authorization.
      answers([mapping('accepted', [mappingVersion(1, 'accepted')], 1)]);
      api.reply(`POST ${mappings}`, status, problem(status, detail));
      const container = mount(() => (
        <ControlMappingsCard
          programId={programId}
          controlId={controlId}
          currentVersionId={versionId}
        />
      ));
      await vi.waitFor(() =>
        expect(container.querySelectorAll('option')).toHaveLength(3)
      );
      const propose = form(container, 'Propose criteria mapping');
      type(field(propose, 'Criterion'), 'CC6.1');
      type(
        field(propose, 'Why this control addresses it'),
        'Access reviews cover production.'
      );
      type(
        field(propose, 'Applicability explanation'),
        'Production workforce accounts.'
      );
      const history = container.querySelector('.control-mapping-history')!;
      const historyBefore = history.textContent;
      const readsBefore = api.bodies.filter((b) => b.method === 'GET').length;

      // Act
      submit(propose);
      await vi.waitFor(() =>
        expect(propose.querySelector('[role="alert"]')?.textContent).toBe(
          feedback ?? detail
        )
      );

      // Assert
      expect(form(container, 'Propose criteria mapping')).toBe(propose);
      expect(field(propose, 'Criterion').value).toBe('CC6.1');
      expect(field(propose, 'Why this control addresses it').value).toBe(
        'Access reviews cover production.'
      );
      expect(field(propose, 'Applicability explanation').value).toBe(
        'Production workforce accounts.'
      );
      expect(propose.querySelector('button')?.disabled).toBe(false);
      expect(container.querySelector('.control-mapping-history')).toBe(history);
      expect(history.textContent).toBe(historyBefore);
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(container.textContent).not.toContain('Proposed mapping to');
      expect(api.bodies.filter((b) => b.method === 'GET')).toHaveLength(
        readsBefore
      );
      expect(
        api.bodies.filter((b) => b.method === 'POST' && b.path === mappings)
      ).toHaveLength(1);
      expect(sent('POST', mappings)?.expected_revision).toBe(4);
    }
  );

  it('ShouldReviewAPendingMappingProposal', async () => {
    // Arrange
    answers([mapping('pending', [mappingVersion(1, 'pending')], null)]);
    api.reply(`POST ${mappings}/${mappingId}/reviews`, 204);
    const container = mount(() => (
      <ControlMappingsCard
        programId={programId}
        controlId={controlId}
        currentVersionId={versionId}
      />
    ));
    await vi.waitFor(() =>
      expect(form(container, 'Review mapping to CC6.1')).not.toBeNull()
    );
    const review = form(container, 'Review mapping to CC6.1');
    (
      review.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement
    ).click();
    type(field(review, 'Review rationale'), 'Does not address registration.');

    // Act
    submit(review);
    await vi.waitFor(() =>
      expect(sent('POST', `${mappings}/${mappingId}/reviews`)).toBeDefined()
    );

    // Assert
    expect(sent('POST', `${mappings}/${mappingId}/reviews`)).toEqual({
      expected_revision: 4,
      outcome: 'reject',
      rationale: 'Does not address registration.',
    });
    expect(container.textContent).toContain('no reviewed version');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldRetireAnAcceptedMappingAndKeepItsHistory', async () => {
    // Arrange
    answers([mapping('accepted', [mappingVersion(1, 'accepted')], 1)]);
    api.reply(`POST ${mappings}/${mappingId}/retirements`, 204);
    const container = mount(() => (
      <ControlMappingsCard
        programId={programId}
        controlId={controlId}
        currentVersionId={versionId}
      />
    ));
    await vi.waitFor(() =>
      expect(form(container, 'Retire mapping to CC6.1')).not.toBeNull()
    );
    const retire = form(container, 'Retire mapping to CC6.1');
    type(field(retire, 'Retirement rationale'), 'Moved to CC6.2.');

    // Act
    submit(retire);
    await vi.waitFor(() =>
      expect(sent('POST', `${mappings}/${mappingId}/retirements`)).toBeDefined()
    );

    // Assert
    expect(sent('POST', `${mappings}/${mappingId}/retirements`)).toEqual({
      expected_revision: 4,
      rationale: 'Moved to CC6.2.',
    });
    expect(
      container.querySelector('.control-mapping-history li')?.textContent
    ).toContain('Reviewed by Riley Reviewer');
  });

  it('ShouldAskToReloadGivenAStaleMappingRevision', async () => {
    // Arrange
    answers([mapping('accepted', [mappingVersion(1, 'accepted')], 1)]);
    api.reply(
      `POST ${mappings}/${mappingId}/retirements`,
      409,
      problem(
        409,
        'The control criterion mapping changed. Current revision: 5. Reload it and retry.'
      )
    );
    const container = mount(() => (
      <ControlMappingsCard
        programId={programId}
        controlId={controlId}
        currentVersionId={versionId}
      />
    ));
    await vi.waitFor(() =>
      expect(form(container, 'Retire mapping to CC6.1')).not.toBeNull()
    );
    const retire = form(container, 'Retire mapping to CC6.1');
    type(field(retire, 'Retirement rationale'), 'Moved.');

    // Act
    submit(retire);
    await vi.waitFor(() =>
      expect(retire.querySelector('[role="alert"]')).not.toBeNull()
    );

    // Assert
    expect(retire.querySelector('[role="alert"]')?.textContent).toContain(
      'Someone else changed this mapping'
    );
  });

  it('ShouldRequireAnApprovedVersionBeforeProposing', async () => {
    // Arrange
    answers([]);

    // Act
    const container = mount(() => (
      <ControlMappingsCard
        programId={programId}
        controlId={controlId}
        currentVersionId={null}
      />
    ));
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'Approve this control before proposing mappings'
      )
    );

    // Assert
    expect(form(container, 'Propose criteria mapping')).toBeNull();
  });

  it('ShouldShowForbiddenGivenTheViewerCannotReadMappings', async () => {
    // Arrange
    answers([]);
    api.reply(`GET ${mappings}`, 403, problem(403, 'Forbidden'));

    // Act
    const container = mount(() => (
      <ControlMappingsCard
        programId={programId}
        controlId={controlId}
        currentVersionId={versionId}
      />
    ));

    // Assert
    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        'You do not have permission to view criteria mappings.'
      )
    );
  });
});

describe('criteria coverage (R1-06 frontend #205)', () => {
  function coverageRow(
    identifier: keyof typeof criterionSummaries,
    state: 'mapped' | 'unmapped',
    pending: number
  ) {
    return {
      edition_id: editionId,
      identifier,
      kind: 'criterion',
      category: 'security',
      parent_identifier: null,
      summary: criterionSummaries[identifier],
      coverage_state: state,
      mapped_controls:
        state === 'mapped'
          ? [
              {
                mapping_id: mappingId,
                control_id: controlId,
                control_version_id: versionId,
                version_number: 1,
                applicability_explanation: 'Production.',
              },
            ]
          : [],
      pending_proposal_count: pending,
    };
  }

  it('ShouldShowMappedAndUnmappedCriteriaWithoutClaimingSatisfaction', async () => {
    // Arrange
    api.reply(`GET ${programPath}/criteria-coverage`, 200, {
      items: [
        coverageRow('CC6.1', 'mapped', 0),
        coverageRow('CC6.2', 'unmapped', 1),
      ],
      next_cursor: null,
    });
    api.reply(`GET ${programPath}/controls`, 200, {
      items: [
        {
          tenant_id: tenantId,
          program_id: programId,
          control_id: controlId,
          identifier: 'AC-01',
          revision: 2,
          status: 'draft',
          owner_resolution: 'unresolved',
          applicability_resolution: 'unresolved',
          content: {
            title: 'Access reviews',
            objective: 'o',
            description: 'd',
            implementation_narrative: 'n',
            expected_evidence_descriptions: ['e'],
          },
          last_changed_by_member_id: 'm',
          last_changed_by_display: 'Casey Lead',
          last_changed_at: '2026-09-20T00:00:00Z',
        },
      ],
      next_cursor: null,
    });

    // Act
    const container = mount(() => <CoverageCard program={program} />);
    await vi.waitFor(() =>
      expect(
        container.querySelectorAll('.criteria-coverage > li')
      ).toHaveLength(2)
    );

    // Assert
    expect(container.textContent).toContain(
      '1 of 2 shown have a reviewed mapping; 1 are unmapped gaps.'
    );
    expect(container.textContent).toContain(
      '1 proposal awaiting review (not counted)'
    );
    expect(
      container.querySelector(
        `a[href="/acme/programs/${programId}/controls/${controlId}"]`
      )?.textContent
    ).toBe('AC-01');
    expect(
      container.querySelector('.criteria-coverage')?.textContent
    ).not.toMatch(/satisf/i);
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldFilterToUnmappedGaps', async () => {
    // Arrange
    api.reply(`GET ${programPath}/criteria-coverage`, 200, {
      items: [coverageRow('CC6.2', 'unmapped', 0)],
      next_cursor: null,
    });
    api.reply(`GET ${programPath}/controls`, 200, {
      items: [],
      next_cursor: null,
    });
    const container = mount(() => <CoverageCard program={program} />);
    await vi.waitFor(() =>
      expect(container.querySelector('select')).not.toBeNull()
    );

    // Act
    type(container.querySelector('select')!, 'unmapped');
    await vi.waitFor(() =>
      expect(
        api.requested.filter((path) => path.endsWith('/criteria-coverage'))
          .length
      ).toBeGreaterThan(1)
    );

    // Assert
    const urls = api.bodies.filter((b) =>
      b.path.endsWith('/criteria-coverage')
    );
    expect(urls.length).toBeGreaterThan(1);
  });

  it('ShouldExplainProjectionLagWithRetry', async () => {
    // Arrange
    api.reply(
      `GET ${programPath}/criteria-coverage`,
      409,
      problem(409, 'Projection is behind.', true)
    );
    api.reply(`GET ${programPath}/controls`, 200, {
      items: [],
      next_cursor: null,
    });

    // Act
    const container = mount(() => <CoverageCard program={program} />);
    await vi.waitFor(() =>
      expect(container.textContent).toContain('still being processed')
    );

    // Assert
    expect(
      [...container.querySelectorAll('button')].some(
        (b) => b.textContent === 'Try again'
      )
    ).toBe(true);
  });

  it('ShouldAskForACatalogGivenNoEditionSelected', async () => {
    // Arrange
    const withoutEdition = { ...program, criteriaEditionId: null };

    // Act
    const container = mount(() => <CoverageCard program={withoutEdition} />);

    // Assert
    await vi.waitFor(() =>
      expect(container.textContent).toContain('Select a criteria catalog')
    );
  });
});
