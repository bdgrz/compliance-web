// @vitest-environment jsdom
import { render, type RenderResult } from '@askrjs/askr/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../../accessibility/axe.js';
import { stubApi } from '../../test-support/api-stub.js';
import { ProgramDetailPage } from '../programs/pages/program-detail.js';
import { clearActiveTenant, resolveTenantRoute } from '../tenants/tenants.js';

const tenantId = '0190a1b2-0000-7000-8000-000000000001';
const programId = '0190a1b2-0000-7000-8000-0000000000b1';
const editionId = '0f3c5a52-9d8e-5b4a-8f21-20172022a0f1';
const base = `/api/v1/tenants/${tenantId}`;
const program = `${base}/programs/${programId}`;
let api: ReturnType<typeof stubApi>;
const mounted: RenderResult[] = [];

function mount(component: () => unknown): RenderResult {
  const result = render(component as never);
  mounted.push(result);
  return result;
}

function problem(status: number, detail: string, transient = false) {
  return { type: 'about:blank', title: 'Problem', status, detail, instance: '/', transient };
}

const partialFocusNote = 'Only selected points of focus are mapped, under local bdgrz:focus identifiers; the source does not number them.';
const privacyLifecycleNote = 'Privacy criteria may be mapped to controls, but personal-information lifecycle support is not yet available (#349).';
const criterionSummary = 'Systems and data are protected by access controls, network boundaries, and encryption.';
const focusSummary = 'An up-to-date list of hardware, software, and data stores shows what needs protection.';
const focusId = 'bdgrz:focus:cc6-1:asset-inventory';

// Representative wire data from the shipped identifiers/original-summary platform catalog.
const edition = {
  edition_id: editionId,
  framework: 'tsc',
  edition_label: '2017_tsc_2022_pof',
  published_at: '2026-09-24T00:00:00+00:00',
  is_complete: true,
  coverage_note: 'All 61 numbered 2017 criteria with original summaries. Points of focus are partially mapped.',
  source_url: 'https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022',
  content_rights: 'identifiers_and_original_summaries',
  support_gaps: [
    ...['security', 'availability', 'processing_integrity', 'confidentiality', 'privacy'].map((category) => ({
      category, code: 'points_of_focus_partial', note: partialFocusNote,
    })),
    { category: 'privacy', code: 'privacy_lifecycle_unsupported', note: privacyLifecycleNote },
  ],
};

const incompleteEdition = {
  ...edition,
  edition_id: '0190a1b2-0000-7000-8000-0000000000e1',
  is_complete: false,
};

function programAnswers(criteriaEditionId: string | null = null, revision = 3) {
  api.reply(`GET ${program}`, 200, {
    tenant_id: tenantId,
    program_id: programId,
    name: 'SOC 2 2026',
    stage: 'readiness',
    next_stage: 'type_i',
    revision,
    plan: {
      target_readiness_date: null,
      target_type_i_as_of_date: null,
      target_type_ii_start_date: null,
      target_type_ii_end_date: null,
      readiness_advisor: null,
      audit_firm: null,
    },
    last_changed_by_member_id: 'm',
    last_changed_by_display: 'Casey Lead',
    last_changed_at: '2026-09-20T00:00:00Z',
    stage_plan: [],
    criteria_edition_id: criteriaEditionId,
  });
  api.reply(`${program}/setup-work`, 200, { tenant_id: tenantId, program_id: programId, program_revision: revision, items: [], next_boundary_cursor: null });
  api.reply(`${program}/revisions`, 200, { items: [], next_cursor: null });
  api.reply(`GET ${base}/criteria-editions/${editionId}/entries`, 200, {
    items: [
      { edition_id: editionId, identifier: 'CC6.1', source_identifier: 'CC6.1', category: 'security', kind: 'criterion', parent_identifier: null, summary: criterionSummary, licensed_text: null, overlay: null },
      { edition_id: editionId, identifier: focusId, source_identifier: null, category: 'security', kind: 'point_of_focus', parent_identifier: 'CC6.1', summary: focusSummary, licensed_text: null, overlay: null },
    ],
    next_cursor: null,
  });
}

function criteriaForm(container: HTMLElement) {
  return [...container.querySelectorAll('form')].find((form) => form.textContent?.includes('Use this edition'))!;
}

function programReads() {
  return api.bodies.filter((request) => request.method === 'GET' && request.path === program).length;
}

function mutations() {
  return api.bodies.filter((request) => request.method !== 'GET');
}

function expectRejectedSelection(container: HTMLElement, selectedEditionId: string, readsBefore: number) {
  const form = criteriaForm(container);
  expect(container.textContent).not.toContain('Criteria catalog selected.');
  expect(container.textContent).toContain('No criteria catalog is selected for this program yet.');
  expect(form.querySelector('select')?.value).toBe(selectedEditionId);
  expect(form.querySelector('button')?.disabled).toBe(false);
  expect(programReads()).toBe(readsBefore);
  expect(mutations()).toEqual([
    { method: 'PUT', path: `${program}/criteria-edition`, body: { expected_revision: 3, edition_id: selectedEditionId } },
  ]);
}

beforeEach(async () => {
  clearActiveTenant();
  api = stubApi();
  api.reply('/api/v1/tenant-slugs/acme/mine', 200, { tenant_id: tenantId, current_slug: 'acme', redirect: false });
  api.reply('/api/v1/tenants/mine', 200, { items: [{ tenant_id: tenantId, name: 'Acme Corp', slug: 'acme' }], next_cursor: null });
  await resolveTenantRoute('acme', { pathname: '/acme/programs', search: '', hash: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (mounted.length > 0) mounted.pop()?.cleanup();
});

describe('criteria catalog selection (R1-03 frontend #210)', () => {
  it('ShouldShowProvenanceGapsAndCriteriaGivenAnUnselectedProgram', async () => {
    // Arrange
    programAnswers(null);
    api.reply(`GET ${base}/criteria-editions`, 200, [edition]);

    // Act
    const { container } = mount(() => <ProgramDetailPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain(criterionSummary));

    // Assert
    expect(container.textContent).toContain('No criteria catalog is selected');
    expect(container.textContent).toContain('Complete catalog.');
    expect(container.textContent).toContain(edition.coverage_note);
    expect(container.querySelector(`a[href="${edition.source_url}"]`)).not.toBeNull();
    expect(container.textContent).toContain('Security (required in every boundary)');
    expect(container.textContent).toContain(privacyLifecycleNote);
    expect(container.textContent).toContain('Point of focus for CC6.1');
    expect(container.querySelector(`a[href="/acme/programs/${programId}/controls"]`)).not.toBeNull();
    expect(await accessibilityViolations(container)).toEqual([]);
  });

  it('ShouldFilterCriteriaByCategory', async () => {
    // Arrange
    programAnswers(editionId);
    api.reply(`GET ${base}/criteria-editions`, 200, [edition]);
    const { container } = mount(() => <ProgramDetailPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain(criterionSummary));
    const select = [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Category'))!
      .querySelector('select') as HTMLSelectElement;
    const entriesPath = `${base}/criteria-editions/${editionId}/entries`;
    const before = api.requested.filter((path) => path === entriesPath).length;

    // Act
    select.value = 'availability';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    // Assert
    await vi.waitFor(() => expect(api.requested.filter((path) => path === entriesPath).length).toBe(before + 1));
    expect(select.value).toBe('availability');
    expect(container.textContent).toContain('This program traces to tsc · 2017_tsc_2022_pof.');
  });

  it('ShouldRefreshRevisionAndRetainTheSelectedPlatformCatalogGivenReopeningTheProgram', async () => {
    // Arrange
    programAnswers(null);
    api.reply(`GET ${base}/criteria-editions`, 200, [edition]);
    api.reply(`PUT ${program}/criteria-edition`, 204);
    const page = mount(() => <ProgramDetailPage programId={programId} />);
    const { container } = page;
    await vi.waitFor(() => expect(container.textContent).toContain('Use this edition'));
    const readsBefore = programReads();
    expect(container.textContent).toContain('No criteria catalog is selected for this program yet.');
    programAnswers(editionId, 4);

    // Act
    criteriaForm(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Assert
    await vi.waitFor(() => {
      expect(programReads()).toBe(readsBefore + 1);
      expect(container.textContent).toContain('This program traces to tsc · 2017_tsc_2022_pof.');
      expect(criteriaForm(container).querySelector('button')?.disabled).toBe(true);
    });
    expect(criteriaForm(container).querySelector('select')?.value).toBe(editionId);
    expect(container.textContent).toContain('Criteria catalog selected.');
    expect(mutations()).toEqual([
      { method: 'PUT', path: `${program}/criteria-edition`, body: { expected_revision: 3, edition_id: editionId } },
    ]);

    // Act: programmatic unit retry of the same edition, bypassing the disabled button.
    criteriaForm(container).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Assert: the refreshed production page supplied revision 4 to the selection card.
    await vi.waitFor(() => expect(programReads()).toBe(readsBefore + 2));
    expect(mutations()).toEqual([
      { method: 'PUT', path: `${program}/criteria-edition`, body: { expected_revision: 3, edition_id: editionId } },
      { method: 'PUT', path: `${program}/criteria-edition`, body: { expected_revision: 4, edition_id: editionId } },
    ]);

    // Act: destroy the first page and mount a fresh production page against saved reads.
    page.cleanup();
    mounted.pop();
    const readsBeforeReopen = api.bodies.filter((request) => request.method === 'GET').length;
    const programReadsBeforeReopen = programReads();
    const { container: reopened } = mount(() => <ProgramDetailPage programId={programId} />);

    // Assert: retained identity and content come from fresh reads, without a success notice.
    await vi.waitFor(() => {
      expect(programReads()).toBe(programReadsBeforeReopen + 1);
      expect(reopened.textContent).toContain(criterionSummary);
      expect(reopened.textContent).toContain(focusSummary);
    });
    expect(api.bodies.filter((request) => request.method === 'GET').slice(readsBeforeReopen)).toEqual(expect.arrayContaining([
      { method: 'GET', path: program, body: undefined },
      { method: 'GET', path: `${base}/criteria-editions`, body: undefined },
      { method: 'GET', path: `${base}/criteria-editions/${editionId}/entries`, body: undefined },
    ]));
    expect(reopened.textContent).toContain('This program traces to tsc · 2017_tsc_2022_pof.');
    expect(criteriaForm(reopened).querySelector('select')?.value).toBe(editionId);
    expect(criteriaForm(reopened).querySelector('button')?.disabled).toBe(true);
    expect(reopened.textContent).not.toContain('Criteria catalog selected.');
    expect(reopened.querySelector(`a[href="${edition.source_url}"]`)?.textContent).toBe('Source publication');
    expect(reopened.textContent).toContain('identifiers_and_original_summaries');
    expect(reopened.textContent).toContain('Complete catalog. All 61 numbered 2017 criteria with original summaries. Points of focus are partially mapped.');
    const entries = [...reopened.querySelectorAll('.criteria-entries li')];
    expect(entries.map((entry) => entry.querySelector('strong')?.textContent)).toEqual(['CC6.1', focusId]);
    expect(entries[0]?.querySelector('.criteria-meta')?.textContent).toContain('Security · Criterion · source CC6.1');
    expect(entries[0]?.querySelector('p')?.textContent).toBe(criterionSummary);
    expect(entries[1]?.querySelector('.criteria-meta')?.textContent).toContain('Security · Point of focus for CC6.1');
    expect(entries[1]?.querySelector('.criteria-meta')?.textContent).not.toContain('source');
    expect(entries[1]?.querySelector('p')?.textContent).toBe(focusSummary);
    expect([...reopened.querySelectorAll('.criteria-categories li')].map((category) => category.textContent)).toEqual([
      'Security (required in every boundary) · has support gaps',
      'Availability (optional) · has support gaps',
      'Processing integrity (optional) · has support gaps',
      'Confidentiality (optional) · has support gaps',
      'Privacy (optional) · has support gaps',
    ]);
    const gaps = [...reopened.querySelectorAll('.criteria-gaps li')].map((gap) => gap.textContent);
    expect(gaps).toEqual([
      `Security: ${partialFocusNote}`,
      `Availability: ${partialFocusNote}`,
      `Processing integrity: ${partialFocusNote}`,
      `Confidentiality: ${partialFocusNote}`,
      `Privacy: ${partialFocusNote}`,
      `Privacy: ${privacyLifecycleNote}`,
    ]);
    expect(mutations()).toEqual([
      { method: 'PUT', path: `${program}/criteria-edition`, body: { expected_revision: 3, edition_id: editionId } },
      { method: 'PUT', path: `${program}/criteria-edition`, body: { expected_revision: 4, edition_id: editionId } },
    ]);
  });

  it.each([
    { condition: 'AnInvalidEdition', status: 400, detail: 'The criteria edition identifier is invalid.', expected: 'The criteria edition identifier is invalid.', transient: false },
    { condition: 'ADeniedSelection', status: 403, detail: 'Forbidden', expected: 'You do not have permission to change the criteria catalog.', transient: false },
    { condition: 'AMissingOrCrossOrganizationProgram', status: 404, detail: 'The program was not found.', expected: 'The program was not found.', transient: false },
    { condition: 'AStaleProgramRevision', status: 409, detail: 'The program changed. Current revision: 4. Reload it and retry.', expected: 'The program changed. Current revision: 4. Reload it and retry.', transient: false },
    { condition: 'ATransientSelectionConflict', status: 409, detail: 'Projection is behind.', expected: 'The latest changes are still being processed. Try again in a moment.', transient: true },
  ])('ShouldRetainSelectionWithoutRefreshGiven$condition', async ({ status, detail, expected, transient }) => {
    // Arrange
    programAnswers(null);
    api.reply(`GET ${base}/criteria-editions`, 200, [edition]);
    api.reply(`PUT ${program}/criteria-edition`, status, problem(status, detail, transient));
    const { container } = mount(() => <ProgramDetailPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Use this edition'));
    const form = criteriaForm(container);
    const readsBefore = programReads();

    // Act
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')).not.toBeNull());

    // Assert
    expect(form.querySelector('[role="alert"]')?.textContent).toBe(expected);
    expectRejectedSelection(container, editionId, readsBefore);
  });

  it('ShouldExplainIncompleteEditionGivenSelectionConflict', async () => {
    // Arrange
    const detail = 'The criteria edition is incomplete and cannot be selected.';
    programAnswers(null);
    api.reply(`GET ${base}/criteria-editions`, 200, [incompleteEdition]);
    api.reply(`GET ${base}/criteria-editions/${incompleteEdition.edition_id}/entries`, 200, { items: [], next_cursor: null });
    api.reply(`PUT ${program}/criteria-edition`, 409, problem(409, detail));
    const { container } = mount(() => <ProgramDetailPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('Use this edition'));
    const form = criteriaForm(container);
    const readsBefore = programReads();

    // Act
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(form.querySelector('[role="alert"]')).not.toBeNull());

    // Assert
    expect(form.querySelector('[role="alert"]')?.textContent).toBe(detail);
    expect(container.textContent).not.toContain('Someone else changed this program');
    expectRejectedSelection(container, incompleteEdition.edition_id, readsBefore);
  });

  it('ShouldOfferRetryGivenTheCatalogFailsToLoad', async () => {
    // Arrange
    programAnswers(null);
    api.reply(`GET ${base}/criteria-editions`, 409, problem(409, 'Projection is behind.', true));

    // Act
    const { container } = mount(() => <ProgramDetailPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('still being processed'));

    // Assert
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(true);
  });

  it('ShouldExplainForbiddenGivenTheViewerCannotReadTheCatalog', async () => {
    // Arrange
    programAnswers(null);
    api.reply(`GET ${base}/criteria-editions`, 403, problem(403, 'Forbidden'));

    // Act
    const { container } = mount(() => <ProgramDetailPage programId={programId} />);
    await vi.waitFor(() => expect(container.textContent).toContain('permission to view the criteria catalogs'));

    // Assert
    expect(container.textContent).not.toContain('Use this edition');
  });

  it('ShouldExplainGivenNoCatalogsExist', async () => {
    // Arrange
    programAnswers(null);
    api.reply(`GET ${base}/criteria-editions`, 200, []);

    // Act
    const { container } = mount(() => <ProgramDetailPage programId={programId} />);

    // Assert
    await vi.waitFor(() => expect(container.textContent).toContain('No criteria catalogs are available yet.'));
  });
});
