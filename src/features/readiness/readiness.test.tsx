// @vitest-environment jsdom
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';
import { ProgramReadinessPage } from './pages/program-readiness.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const programId = '0190a1b2-0000-7000-8000-0000000000b1';
const assessmentId = '0190a1b2-0000-7000-8000-0000000000d1';
const olderAssessmentId = '0190a1b2-0000-7000-8000-0000000000d2';
const mappedGap = '0190a1b2-0000-7000-8000-0000000000e1';
const inputGap = '0190a1b2-0000-7000-8000-0000000000e2';
const memberUser = '0190a1b2-0000-7000-8000-0000000000f1';
const memberId = '0190a1b2-0000-7000-8000-0000000000f2';
const includedSystemId = '0190a1b2-0000-7000-8000-000000000101';
const excludedSystemId = '0190a1b2-0000-7000-8000-000000000102';
const unresolvedSystemId = '0190a1b2-0000-7000-8000-000000000103';
const olderSystemId = '0190a1b2-0000-7000-8000-000000000104';
const base = `/api/v1/tenants/${tenantId}`;
const readiness = `${base}/programs/${programId}/readiness`;
const assessmentPath = `${readiness}/assessments/${assessmentId}`;
const actor = { kind: 'member', id: 'm', display: 'Casey Lead' };
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

function plan(gapId: string) {
  return { gap_id: gapId, owner_member_id: memberId, target_date: '2027-01-15', action: 'Map CC6.1', planned_by: actor, planned_at: '2026-09-20T00:00:00Z' };
}

function accessReviewDecision(
  systemInstanceId: string,
  options: { decision?: string; approvedBy?: string; reason?: string; reviewBy?: string | null; waiverId?: string | null } = {}
) {
  return {
    tenant_id: tenantId,
    application_id: '0190a1b2-0000-7000-8000-000000000201',
    system_instance_id: systemInstanceId,
    system_instance_revision: 3,
    decision_id: '0190a1b2-0000-7000-8000-000000000202',
    sequence: 2,
    decision: options.decision ?? 'included',
    reason: options.reason ?? 'Approved for the finance team.',
    effective_from: '2026-09-20T00:00:00Z',
    review_by: options.reviewBy === undefined ? '2026-10-20T00:00:00Z' : options.reviewBy,
    approved_by: { kind: 'member', id: memberId, display: options.approvedBy ?? 'Morgan Approver' },
    decided_at: '2026-09-20T00:00:00Z',
    separation_of_duties_waiver_id:
      options.waiverId === undefined ? '0190a1b2-0000-7000-8000-000000000203' : options.waiverId,
  };
}

function accessReviewScope(
  systemInstanceId: string,
  status: string,
  reviewOverdue: boolean,
  effectiveDecision: ReturnType<typeof accessReviewDecision> | null
) {
  return {
    system_instance_id: systemInstanceId,
    status,
    review_overdue: reviewOverdue,
    effective_decision: effectiveDecision,
  };
}

function gaps(planned: boolean) {
  return [
    {
      gap_id: mappedGap,
      kind: 'unmapped_criterion',
      subject: 'CC6.1',
      rule_id: 'criterion_has_accepted_mapping',
      explanation: 'No accepted mapping covers CC6.1.',
      sources: [],
      plan: planned ? plan(mappedGap) : null,
    },
    {
      gap_id: inputGap,
      kind: 'input_not_assessed',
      subject: 'evidence',
      rule_id: 'source_family_assessed',
      explanation: 'Readiness rules do not yet assess evidence.',
      sources: [],
      plan: planned ? plan(inputGap) : null,
    },
  ];
}

function seed(
  options: { planned?: boolean; decision?: unknown; accessReviewScopes?: unknown[]; sourceTruncated?: boolean } = {}
) {
  const gapList = gaps(options.planned ?? false);
  if (options.sourceTruncated) {
    gapList.push({
      gap_id: '0190a1b2-0000-7000-8000-0000000000e3',
      kind: 'source_truncated',
      subject: 'applications_access_review_scope',
      rule_id: 'source_family_within_limit',
      explanation: 'The bounded access-review source was truncated.',
      sources: [],
      plan: null,
    });
  }
  api.reply(`GET ${readiness}/assessments`, 200, {
    items: [
      {
        assessment_id: assessmentId,
        rule_version: 'readiness-rules/1',
        as_of: '2026-09-25T00:00:00Z',
        rule_met_count: 1,
        gap_count: 2,
        run_by: actor,
        run_at: '2026-09-25T00:00:00Z',
        decision_outcome: null,
      },
    ],
    next_cursor: null,
  });
  api.reply(`GET ${assessmentPath}`, 200, {
    tenant_id: tenantId,
    program_id: programId,
    assessment_id: assessmentId,
    revision: 4,
    rule_version: 'readiness-rules/1',
    as_of: '2026-09-25T00:00:00Z',
    edition_id: null,
    input_fingerprint: 'sha256:abc',
    inputs: [
      { family: 'criteria_catalog', status: 'assessed', record_count: 2, explanation: 'Two criteria recorded.' },
      { family: 'evidence', status: 'not_assessed', record_count: 0, explanation: 'Not assessed by this rule version.' },
    ],
    findings: [
      {
        criterion_identifier: 'CC1.1',
        category: 'security',
        summary: 'Integrity and ethics',
        rule_id: 'criterion_has_accepted_mapping',
        outcome: 'rule_met',
        explanation: 'An accepted mapping covers CC1.1.',
        sources: [],
        gap_id: null,
      },
      {
        criterion_identifier: 'CC6.1',
        category: 'security',
        summary: 'Logical access',
        rule_id: 'criterion_has_accepted_mapping',
        outcome: 'gap',
        explanation: 'No accepted mapping covers CC6.1.',
        sources: [],
        gap_id: mappedGap,
      },
    ],
    gaps: gapList,
    access_review_scopes: options.accessReviewScopes,
    rule_met_count: 1,
    gap_count: 2,
    run_by: actor,
    run_at: '2026-09-25T00:00:00Z',
    decision: options.decision ?? null,
  });
  api.reply(`GET ${assessmentPath}/gaps`, 200, { items: gapList, next_cursor: null });
  api.reply(`GET ${base}/members`, 200, {
    items: [{ user_id: memberUser, tenant_id: tenantId, verified_email_address: 'riley@acme.test' }],
    next_cursor: null,
  });
  api.reply(`GET ${base}/members/${memberUser}/access`, 200, { tenant_id: tenantId, user_id: memberUser, member_id: memberId, paths: [] });
}

function savedAssessmentDetail(id: string, asOf: string, accessReviewScopes: unknown[]) {
  return {
    tenant_id: tenantId,
    program_id: programId,
    assessment_id: id,
    revision: 3,
    rule_version: 'readiness-rules/1',
    as_of: asOf,
    edition_id: null,
    input_fingerprint: 'sha256:older',
    inputs: [],
    findings: [],
    gaps: [],
    rule_met_count: 0,
    gap_count: 0,
    run_by: actor,
    run_at: asOf,
    decision: null,
    access_review_scopes: accessReviewScopes,
  };
}

function submit(container: HTMLElement, label: string) {
  container.querySelector(`form[aria-label="${label}"]`)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function fill(form: Element, labelStart: string, value: string) {
  const field = [...form.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(labelStart))!
    .querySelector('input, textarea, select') as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

beforeEach(async () => {
  clearActiveTenant();
  api = stubApi();
  api.reply('/api/v1/tenant-slugs/acme/mine', 200, { tenant_id: tenantId, current_slug: 'acme', redirect: false });
  api.reply('/api/v1/tenants/mine', 200, { items: [{ tenant_id: tenantId, name: 'Acme Corp', slug: 'acme' }], next_cursor: null });
  await resolveTenantRoute('acme', { pathname: `/acme/programs/${programId}/readiness`, search: '', hash: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('readiness assessment and gap plan (R1-08 frontend #207)', () => {
  it('ShouldShowFindingsInputGapsAndManagementNoticeGivenAnAssessment', async () => {
    // Arrange
    seed();

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('.readiness-gap')).not.toBeNull());

    // Assert
    expect(container.querySelector('h1')?.textContent).toBe('Readiness');
    expect(container.textContent).toContain('never an auditor opinion');
    expect(container.textContent).toContain('Inputs not assessed: evidence');
    expect(container.textContent).toContain('Input not assessed: evidence');
    expect(container.textContent).toContain('CC6.1');
    expect(container.textContent).toContain('Rule met');
    expect(container.textContent.toLowerCase()).not.toContain('satisfied');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldRunAnAssessmentAtTheLedgerRevisionGivenAnAsOfTime', async () => {
    // Arrange
    seed();
    api.reply(`POST ${readiness}/assessments`, 200, { assessment_id: assessmentId, revision: 5 });
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Input fingerprint'));
    fill(container.querySelector('form[aria-label="Run readiness assessment"]')!, 'As of', '2026-09-29T12:00');

    // Act
    submit(container, 'Run readiness assessment');
    await vi.waitFor(() => expect(api.bodies.some((b) => b.method === 'POST')).toBe(true));

    // Assert
    expect(api.bodies.find((b) => b.method === 'POST')?.body).toEqual({ expected_revision: 4, as_of: '2026-09-29T12:00:00.000Z' });
  });

  it('ShouldRunTheFirstAssessmentAtRevisionZeroGivenNone', async () => {
    // Arrange
    api.reply(`GET ${readiness}/assessments`, 200, { items: [], next_cursor: null });
    api.reply(`POST ${readiness}/assessments`, 200, { assessment_id: assessmentId, revision: 1 });
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('No readiness assessments yet'));

    // Act
    submit(container, 'Run readiness assessment');
    await vi.waitFor(() => expect(api.bodies.some((b) => b.method === 'POST')).toBe(true));

    // Assert
    expect(api.bodies.find((b) => b.method === 'POST')?.body).toEqual({ expected_revision: 0 });
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldSaveAGapPlanWithOwnerTargetDateAndAction', async () => {
    // Arrange
    seed();
    api.reply(`PUT ${readiness}/gaps/${mappedGap}/plan`, 200, plan(mappedGap));
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Plan gap CC6.1"]')).not.toBeNull());
    const form = container.querySelector('form[aria-label="Plan gap CC6.1"]')!;
    fill(form, 'Target date', '2027-01-15');
    fill(form, 'Action', 'Map CC6.1');

    // Act
    submit(container, 'Plan gap CC6.1');
    await vi.waitFor(() => expect(api.bodies.some((b) => b.method === 'PUT')).toBe(true));

    // Assert
    expect(api.bodies.find((b) => b.method === 'PUT')?.body).toEqual({
      expected_revision: 4,
      owner_member_id: memberId,
      target_date: '2027-01-15',
      action: 'Map CC6.1',
    });
  });

  it('ShouldFilterGapsByPlanState', async () => {
    // Arrange
    seed();
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('.readiness-gap')).not.toBeNull());
    const filter = [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Show gaps'))!.parentElement!;

    // Act
    fill(filter, 'Show gaps', 'unplanned');
    await vi.waitFor(() => expect(api.requested.filter((p) => p === `${assessmentPath}/gaps`).length).toBeGreaterThan(1));

    // Assert
    expect(api.requested.filter((p) => p === `${assessmentPath}/gaps`).length).toBeGreaterThan(1);
  });

  it('ShouldBlockProceedGivenUnplannedGaps', async () => {
    // Arrange
    seed();
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Record readiness decision"]')).not.toBeNull());
    const form = container.querySelector('form[aria-label="Record readiness decision"]')!;
    const proceed = form.querySelector('input[value="proceed"]') as HTMLInputElement;

    // Act
    proceed.checked = true;
    proceed.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(form.textContent).toContain('Plan every gap before deciding to proceed'));

    // Assert
    expect(form.textContent).toContain('cannot decide it unless an approved separation-of-duties');
    expect((form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ShouldExplainSeparationOfDutiesGivenTheRunnerDecides', async () => {
    // Arrange
    seed({ planned: true });
    api.reply(`POST ${assessmentPath}/decision`, 403, problem(403, 'The member who ran an assessment cannot decide it.'));
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Record readiness decision"]')).not.toBeNull());
    const form = container.querySelector('form[aria-label="Record readiness decision"]')!;
    const proceed = form.querySelector('input[value="proceed"]') as HTMLInputElement;
    proceed.checked = true;
    proceed.dispatchEvent(new Event('change', { bubbles: true }));
    fill(form, 'Rationale', 'All gaps owned.');

    // Act
    submit(container, 'Record readiness decision');
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')).not.toBeNull());

    // Assert
    expect(form.querySelector('[role="alert"]')?.textContent).toContain('without an approved separation-of-duties waiver');
    expect(api.bodies.find((b) => b.method === 'POST')?.body).toEqual({ expected_revision: 4, outcome: 'proceed', rationale: 'All gaps owned.' });
  });

  it('ShouldShowARecordedDecision', async () => {
    // Arrange
    seed({
      planned: true,
      decision: {
        decision_id: 'd',
        assessment_id: assessmentId,
        outcome: 'do_not_proceed',
        rationale: 'Evidence not ready.',
        decider_member_id: memberId,
        decided_by: { kind: 'member', id: 'x', display: 'Morgan Exec' },
        decided_at: '2026-09-26T00:00:00Z',
        separation_of_duties_waiver_id: null,
      },
    });

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('decided by Morgan Exec'));

    // Assert
    expect(container.textContent).toContain('Do not proceed');
    expect(container.querySelector('form[aria-label="Record readiness decision"]')).toBeNull();
  });

  it('ShouldAskToReloadGivenAStaleRevision', async () => {
    // Arrange
    seed();
    api.reply(`PUT ${readiness}/gaps/${mappedGap}/plan`, 409, problem(409, 'The readiness ledger revision is stale.'));
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('form[aria-label="Plan gap CC6.1"]')).not.toBeNull());
    const form = container.querySelector('form[aria-label="Plan gap CC6.1"]')!;
    fill(form, 'Target date', '2027-01-15');
    fill(form, 'Action', 'Map it');

    // Act
    submit(container, 'Plan gap CC6.1');
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')).not.toBeNull());

    // Assert
    expect(form.querySelector('[role="alert"]')?.textContent).toContain('Someone else changed');
  });

  it('ShouldOfferRetryGivenProjectionLag', async () => {
    // Arrange
    api.reply(`GET ${readiness}/assessments`, 409, problem(409, 'Projection is behind.', true));

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('still being processed'));

    // Assert
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(true);
  });

  it('ShouldShowForbiddenGivenTheViewerCannotManageTheProgram', async () => {
    // Arrange
    api.reply(`GET ${readiness}/assessments`, 403, problem(403, 'Forbidden'));

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Readiness is not available to you'));

    // Assert
    expect(container.querySelector('form')).toBeNull();
  });

  it('ShouldShowNotFoundGivenAMissingProgram', async () => {
    // Arrange
    api.reply(`GET ${readiness}/assessments`, 404, problem(404, 'Not found'));

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.querySelector('h1')?.textContent).toBe('Program not found'));

    // Assert
    expect(container.querySelector('form')).toBeNull();
  });

  it('ShouldShowSavedIncludedExcludedAndUnresolvedScopeWithDecisionEvidence', async () => {
    // Arrange
    seed({
      accessReviewScopes: [
        accessReviewScope(includedSystemId, 'included', true, accessReviewDecision(includedSystemId)),
        accessReviewScope(
          excludedSystemId,
          'excluded',
          false,
          accessReviewDecision(excludedSystemId, {
            decision: 'excluded',
            approvedBy: 'Riley Approver',
            reason: 'This system is outside the reviewed user population.',
            reviewBy: null,
            waiverId: null,
          })
        ),
        accessReviewScope(unresolvedSystemId, 'unresolved', false, null),
      ],
    });

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain(unresolvedSystemId));

    // Assert
    const table = [...container.querySelectorAll('table')].find((item) =>
      item.querySelector('caption')?.textContent?.includes('Per-system access-review scope')
    )!;
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(table.querySelector('caption')?.textContent).toContain('saved in this assessment');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(`${includedSystemId}IncludedOverdue`),
      expect.stringContaining(`${excludedSystemId}ExcludedNot overdue`),
      expect.stringContaining(`${unresolvedSystemId}UnresolvedNot overdue`),
    ]);
    expect(rows[0]?.textContent).toContain('Morgan Approver');
    expect(rows[0]?.textContent).toContain('Approved for the finance team.');
    expect(rows[0]?.textContent).toContain('Effective from');
    expect(rows[0]?.textContent).toContain(
      new Date('2026-09-20T00:00:00Z').toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' })
    );
    expect(rows[0]?.textContent).toContain('Review by');
    expect(rows[0]?.textContent).toContain(
      new Date('2026-10-20T00:00:00Z').toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' })
    );
    expect(rows[0]?.textContent).toContain('Separation-of-duties waiver recorded');
    expect(rows[1]?.textContent).toContain('Riley Approver');
    expect(rows[1]?.textContent).toContain('This system is outside the reviewed user population.');
    expect(rows[1]?.textContent).not.toContain('Review by');
    expect(rows[1]?.textContent).not.toContain('waiver recorded');
    expect(rows[2]?.textContent).toContain('No decision was effective at the assessment time.');
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldShowAnEmptyScopeStateGivenAnEmptySavedArray', async () => {
    // Arrange
    seed({ accessReviewScopes: [] });

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('No per-system access-review scope rows were recorded'));

    // Assert
    expect(container.querySelector('table caption')?.textContent).not.toContain('Per-system access-review scope');
  });

  it('ShouldTreatAnOlderAssessmentWithoutTheScopePropertyAsEmpty', async () => {
    // Arrange
    seed();

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('No per-system access-review scope rows were recorded'));

    // Assert
    expect(container.textContent).not.toContain('Per-system access-review scope saved in this assessment');
  });

  it('ShouldExplainThatTruncatedScopeEvidenceIsPartial', async () => {
    // Arrange
    seed({
      accessReviewScopes: [accessReviewScope(includedSystemId, 'included', false, accessReviewDecision(includedSystemId))],
      sourceTruncated: true,
    });

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('This list is partial because the source was truncated'));

    // Assert
    expect(container.textContent).toContain('only the rows captured in this assessment');
    expect(container.textContent).toContain('does not represent the full system population');
    expect(container.textContent).toContain(includedSystemId);
  });

  it('ShouldShowTheSelectedAssessmentsOwnSavedScopeRows', async () => {
    // Arrange
    const firstScope = accessReviewScope(includedSystemId, 'included', false, accessReviewDecision(includedSystemId));
    const olderScope = accessReviewScope(olderSystemId, 'excluded', false, accessReviewDecision(olderSystemId, { decision: 'excluded' }));
    seed({ accessReviewScopes: [firstScope] });
    api.reply(`GET ${readiness}/assessments`, 200, {
      items: [
        {
          assessment_id: assessmentId,
          rule_version: 'readiness-rules/1',
          as_of: '2026-09-25T00:00:00Z',
          rule_met_count: 1,
          gap_count: 2,
          run_by: actor,
          run_at: '2026-09-25T00:00:00Z',
          decision_outcome: null,
        },
        {
          assessment_id: olderAssessmentId,
          rule_version: 'readiness-rules/1',
          as_of: '2026-09-24T00:00:00Z',
          rule_met_count: 0,
          gap_count: 0,
          run_by: actor,
          run_at: '2026-09-24T00:00:00Z',
          decision_outcome: null,
        },
      ],
      next_cursor: null,
    });
    const olderPath = `${readiness}/assessments/${olderAssessmentId}`;
    api.reply(`GET ${olderPath}`, 200, savedAssessmentDetail(olderAssessmentId, '2026-09-24T00:00:00Z', [olderScope]));
    api.reply(`GET ${olderPath}/gaps`, 200, { items: [], next_cursor: null });

    // Act
    const container = mount(() => <ProgramReadinessPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain(includedSystemId));
    const assessmentTable = [...container.querySelectorAll('table')].find((item) =>
      item.querySelector('caption')?.textContent?.startsWith('Assessments')
    )!;
    ([...assessmentTable.querySelectorAll('tbody button')][1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(container.textContent).toContain(olderSystemId));

    // Assert
    expect(container.textContent).not.toContain(includedSystemId);
    expect(api.requestUrls).toContainEqual(expect.objectContaining({ method: 'GET', url: expect.stringContaining(olderPath) }));
    expect(api.requested.some((path) => path.includes('/access-review-scope'))).toBe(false);
    expect(await accessibilityViolations(container)).toEqual([]);
  });
});
