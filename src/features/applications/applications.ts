import { createApiClient } from '../../api-client/index.js';
import type {
  AddApplicationRelationshipResponse200,
  ListApplicationRelationshipsResponse200,
  RemoveApplicationRelationshipResponse200,
} from '../../api-client/operations.js';
import { requireActiveTenantId } from '../tenants/tenants.js';

const client = createApiClient();

export interface Retirement {
  effectiveAt: string;
  reason: string;
  mergedIntoApplicationId: string | null;
}

export interface ApplicationSummary {
  applicationId: string;
  revision: number;
  name: string;
  purpose: string;
  ownerReference: string | null;
  classification: string | null;
  applicationKind: string | null;
  criticality: string | null;
  sourceKind: string | null;
  sourceIdentifier: string | null;
  hasSystemInstances: boolean;
  unresolved: string[];
  lifecycle: string;
  retirement: Retirement | null;
}

export interface Application extends ApplicationSummary {
  systemOwnerPersonId: string | null;
  accessOwnerPersonId: string | null;
  lastChangedBy: string;
  lastChangedAt: string;
}

export interface ApplicationRevision extends ApplicationSummary {
  systemOwnerPersonId: string | null;
  accessOwnerPersonId: string | null;
  changeKind: string;
  actor: string;
  changedAt: string;
}

export interface SystemInstance {
  systemInstanceId: string;
  revision: number;
  name: string;
  kind: string;
  accessBoundaryReference: string | null;
  sourceIdentifier: string | null;
  unresolved: string[];
  declaredBy: string;
  declaredAt: string;
  lifecycle: string;
  retirement: Retirement | null;
}

export type ApplicationRelationshipType = 'depends_on' | 'replaces';

export interface ApplicationRelationship {
  relationshipId: string;
  targetApplicationId: string;
  relationshipType: string;
  actorMemberId: string;
  actorDisplay: string;
  changedAt: string;
}

export interface ApplicationRelationshipPage {
  relationshipRevision: number;
  items: ApplicationRelationship[];
}

export interface ApplicationRelationshipChange {
  relationshipId: string;
  relationshipRevision: number;
  state: string;
}

export interface ApplicationContent {
  name: string;
  purpose: string;
  ownerReference: string | null;
  classification: string | null;
  systemOwnerPersonId: string | null;
  accessOwnerPersonId: string | null;
}

export interface ApplicationDeclarationContent extends ApplicationContent {
  applicationKind: string;
  criticality: string;
}

export interface ApplicationRevisionContent extends ApplicationContent {
  applicationKind: string;
  criticality: string;
}

export interface ApplicationDeclarationAttempt {
  tenantId: string;
  declarationKey: string;
}

export interface ChangePreview {
  tenantId: string;
  applicationId: string;
  applicationRevision: number;
  changeKind: string;
  changes: { field: string; before: string | null; after: string | null }[];
  boundaryReferences: { key: string; subject: string; status: string; rationale: string }[];
  controlDraftReferences: { key: string; identifier: string; subject: string; rationale: string }[];
  systemInstanceReferences: { key: string; name: string; kind: string }[];
  pendingContexts: string[];
  complete: boolean;
}

export interface ScopeDecision {
  decisionId: string;
  sequence: number;
  decision: string;
  reason: string;
  effectiveFrom: string;
  reviewBy: string | null;
  approvedBy: string;
  decidedAt: string;
  waiverId: string | null;
}

export interface AccessReviewScope {
  asOf: string;
  status: string;
  effective: ScopeDecision | null;
  decisions: ScopeDecision[];
}

export interface ScopeDecisionInput {
  expectedSystemInstanceRevision: number;
  expectedDecisionCount: number;
  decision: 'included' | 'excluded';
  reason: string;
  effectiveFrom: string;
  reviewBy: string | null;
  waiverId: string | null;
}

// Keeps the HTTP status and the server's transient flag so pages can tell forbidden, not found,
// a stale revision (409), and projection lag (a transient 409) apart. `separationOfDuties` marks a
// 403 that exists because the viewer registered the record they are approving.

export class ApplicationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly transient: boolean,
    readonly separationOfDuties = false
  ) {
    super(message);
  }
}

const codeLabels: Record<string, string> = {
  owner_missing: 'Owner missing',
  owner_unverified: 'Owner not verified',
  classification_unresolved: 'Classification unresolved',
  classification_unverified: 'Classification not verified',
};

export function codeLabel(code: string): string {
  const label = codeLabels[code] ?? code.replaceAll('_', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Item<T> = T | null;

type RawRetirement = { effective_at: string; reason: string; merged_into_application_id: string | null } | null | undefined;

function retirementOf(raw: RawRetirement): Retirement | null {
  return raw ? { effectiveAt: raw.effective_at, reason: raw.reason, mergedIntoApplicationId: raw.merged_into_application_id } : null;
}

function present<T>(items: Item<T>[] | null | undefined): T[] {
  return (items ?? []).filter((item): item is T => item !== null);
}

type RawApplication = {
  application_id: string;
  revision: number | string;
  name: string;
  purpose: string;
  owner_reference: string | null;
  has_system_instances: boolean;
  unresolved: (string | null)[];
  classification?: string | null;
  application_kind?: string | null;
  criticality?: string | null;
  source_kind?: string;
  source_identifier?: string | null;
  lifecycle?: string;
  retirement?: RawRetirement;
};

function summaryOf(item: RawApplication): ApplicationSummary {
  return {
    applicationId: item.application_id,
    revision: Number(item.revision),
    name: item.name,
    purpose: item.purpose,
    ownerReference: item.owner_reference,
    classification: item.classification ?? null,
    applicationKind: item.application_kind ?? null,
    criticality: item.criticality ?? null,
    sourceKind: item.source_kind ?? null,
    sourceIdentifier: item.source_identifier ?? null,
    hasSystemInstances: item.has_system_instances,
    unresolved: present(item.unresolved),
    lifecycle: item.lifecycle ?? 'unknown',
    retirement: retirementOf(item.retirement),
  };
}

type RawInstance = {
  system_instance_id: string;
  name: string;
  kind: string;
  access_boundary_reference: string | null;
  source_identifier: string | null;
  unresolved: (string | null)[];
  declared_by_display: string;
  declared_at: string;
  declared_by?: { display: string };
  revision?: number | string;
  lifecycle?: string;
  retirement?: RawRetirement;
};

function instanceOf(item: RawInstance): SystemInstance {
  return {
    systemInstanceId: item.system_instance_id,
    revision: Number(item.revision ?? 1),
    name: item.name,
    kind: item.kind,
    accessBoundaryReference: item.access_boundary_reference,
    sourceIdentifier: item.source_identifier,
    unresolved: present(item.unresolved),
    declaredBy: item.declared_by?.display ?? item.declared_by_display,
    declaredAt: item.declared_at,
    lifecycle: item.lifecycle ?? 'active',
    retirement: retirementOf(item.retirement),
  };
}

export async function listApplications(): Promise<ApplicationSummary[]> {
  const tenantId = requireActiveTenantId();
  const applications: ApplicationSummary[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.listApplications({ params: { tenant_id: tenantId }, query: { cursor } });
    if (!result.ok) throw failure(result, 'load the applications');
    applications.push(...present(result.data?.items).map(summaryOf));
    cursor = result.data?.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return applications;
}

export async function getApplication(applicationId: string, minimumRevision?: number): Promise<Application> {
  const tenantId = requireActiveTenantId();
  const result = await client.getApplication({
    params: { tenant_id: tenantId, application_id: applicationId },
    query: { minimum_revision: minimumRevision },
  });
  if (!result.ok) throw failure(result, 'load this application');
  const data = result.data;
  if (!data) throw new ApplicationRequestError('This application was not found.', 404, false);
  return {
    ...summaryOf(data),
    systemOwnerPersonId: data.system_owner_person_id ?? null,
    accessOwnerPersonId: data.access_owner_person_id ?? null,
    lastChangedBy: data.last_changed_by?.display ?? data.last_changed_by_display,
    lastChangedAt: data.last_changed_at,
  };
}

function contentBody(content: ApplicationContent) {
  return {
    name: content.name,
    purpose: content.purpose,
    owner_reference: content.ownerReference,
    classification: content.classification,
    ...(content.systemOwnerPersonId ? { system_owner_person_id: content.systemOwnerPersonId } : {}),
    ...(content.accessOwnerPersonId ? { access_owner_person_id: content.accessOwnerPersonId } : {}),
  };
}

export async function declareApplication(content: ApplicationDeclarationContent,
  attempt: ApplicationDeclarationAttempt
): Promise<string> {
  const tenantId = requireActiveTenantId();
  if (tenantId !== attempt.tenantId) {
    throw new ApplicationRequestError(
      'Return to the original organization to record this application.',
      null,
      false
    );
  }
  const result = await client.declareApplication({ params: { tenant_id: tenantId }, body: {
      ...contentBody(content),
      application_kind: content.applicationKind,
      criticality: content.criticality,
      declaration_key: attempt.declarationKey,
    },
  });
  if (!result.ok) throw failure(result, 'record the application');
  if (!result.data) throw new ApplicationRequestError('The application was not recorded.', null, false);
  return result.data.application_id;
}

function revisionContentBody(content: ApplicationRevisionContent) {
  return {
    ...contentBody(content),
    application_kind: content.applicationKind,
    criticality: content.criticality,
  };
}

export async function reviseApplication(
  applicationId: string,
  expectedRevision: number,
  content: ApplicationRevisionContent
): Promise<void> {
  const tenantId = requireActiveTenantId();
  const result = await client.reviseApplication({
    params: { tenant_id: tenantId, application_id: applicationId },
    body: { expected_revision: expectedRevision, ...revisionContentBody(content) },
  });
  if (!result.ok) throw failure(result, 'save the application');
}

export async function previewApplicationChange(
  applicationId: string,
  expectedRevision: number,
  change: { kind: 'revise'; content: ApplicationRevisionContent } | { kind: 'retire' }
): Promise<ChangePreview> {
  const tenantId = requireActiveTenantId();
  const body =
    change.kind === 'revise'
      ? {
          expected_application_revision: expectedRevision,
          change_kind: 'revise',
          ...revisionContentBody(change.content),
        }
      : { expected_application_revision: expectedRevision, change_kind: 'retire' };
  const result = await client.previewApplicationChange({
    params: { tenant_id: tenantId, application_id: applicationId },
    body,
  });
  if (!result.ok) throw failure(result, 'preview the change');
  const data = result.data;
  if (!data) throw new ApplicationRequestError('The change preview was empty.', null, false);
  return {
    tenantId: data.tenant_id,
    applicationId: data.application_id,
    applicationRevision: Number(data.application_revision),
    changeKind: data.change_kind,
    changes: present(data.changes),
    boundaryReferences: present(data.boundary_references).map((r) => ({
      key: r.entry_id,
      subject: r.subject,
      status: r.status,
      rationale: r.rationale,
    })),
    controlDraftReferences: present(data.control_draft_references).map((r) => ({
      key: r.entry_id,
      identifier: r.identifier,
      subject: r.subject,
      rationale: r.rationale,
    })),
    systemInstanceReferences: present(data.system_instance_references).map((r) => ({
      key: r.system_instance_id,
      name: r.name,
      kind: r.kind,
    })),
    pendingContexts: present(data.pending_contexts),
    complete: data.complete,
  };
}

export async function retireApplication(
  applicationId: string,
  expectedRevision: number,
  effectiveAt: string,
  reason: string,
  mergedIntoApplicationId: string | null = null
): Promise<void> {
  const tenantId = requireActiveTenantId();
  const result = await client.retireApplication({
    params: { tenant_id: tenantId, application_id: applicationId },
    body: {
      expected_revision: expectedRevision,
      effective_at: effectiveAt,
      reason,
      ...(mergedIntoApplicationId ? { merged_into_application_id: mergedIntoApplicationId } : {}),
    },
  });
  if (!result.ok) throw failure(result, 'retire the application');
}

export async function listApplicationRevisions(applicationId: string): Promise<ApplicationRevision[]> {
  const tenantId = requireActiveTenantId();
  const revisions: ApplicationRevision[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.listApplicationRevisions({
      params: { tenant_id: tenantId, application_id: applicationId },
      query: { cursor },
    });
    if (!result.ok) throw failure(result, 'load the application history');
    for (const item of present(result.data?.items)) {
      revisions.push({
        ...summaryOf(item),
        systemOwnerPersonId: item.system_owner_person_id ?? null,
        accessOwnerPersonId: item.access_owner_person_id ?? null,
        changeKind: item.change_kind,
        actor: item.actor?.display ?? item.last_changed_by_display,
        changedAt: item.last_changed_at,
      });
    }
    cursor = result.data?.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return revisions.sort((a, b) => b.revision - a.revision);
}

export async function listSystemInstances(applicationId: string): Promise<SystemInstance[]> {
  const tenantId = requireActiveTenantId();
  const instances: SystemInstance[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.listSystemInstances({
      params: { tenant_id: tenantId, application_id: applicationId },
      query: { cursor },
    });
    if (!result.ok) throw failure(result, 'load the system instances');
    instances.push(...present(result.data?.items).map(instanceOf));
    cursor = result.data?.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return instances;
}

export async function listApplicationRelationships(
  applicationId: string,
  minimumRevision?: number
): Promise<ApplicationRelationshipPage> {
  const tenantId = requireActiveTenantId();
  const items: ApplicationRelationship[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let relationshipRevision: number | undefined;
  do {
    const result = await client.listApplicationRelationships({
      params: { tenant_id: tenantId, application_id: applicationId },
      query: { limit: 200, cursor, minimum_revision: minimumRevision },
    });
    if (!result.ok) throw failure(result, 'load application relationships');
    const data = result.data as ListApplicationRelationshipsResponse200 | null;
    if (!data) throw new ApplicationRequestError('Application relationships could not be loaded.', null, false);
    const pageRevision = Number(data.relationship_revision);
    if (relationshipRevision !== undefined && relationshipRevision !== pageRevision) {
      throw new ApplicationRequestError(
        'Application relationships changed while loading. Refresh the list and try again.',
        409,
        true
      );
    }
    items.push(...present(data.items).map((item) => ({
      relationshipId: item.relationship_id,
      targetApplicationId: item.target_application_id,
      relationshipType: item.relationship_type,
      actorMemberId: item.actor_member_id,
      actorDisplay: item.actor_display,
      changedAt: item.changed_at,
    })));
    relationshipRevision = pageRevision;
    cursor = data.next_cursor ?? undefined;
    if (cursor && seenCursors.has(cursor)) {
      throw new ApplicationRequestError('The application relationship list could not be paged.', null, false);
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor !== undefined);
  return { relationshipRevision: relationshipRevision ?? 0, items };
}

export async function addApplicationRelationship(
  applicationId: string,
  relationshipId: string,
  expectedRelationshipRevision: number,
  targetApplicationId: string,
  relationshipType: ApplicationRelationshipType
): Promise<ApplicationRelationshipChange> {
  const tenantId = requireActiveTenantId();
  const result = await client.addApplicationRelationship({
    params: { tenant_id: tenantId, application_id: applicationId, relationship_id: relationshipId },
    body: {
      expected_relationship_revision: expectedRelationshipRevision,
      target_application_id: targetApplicationId,
      relationship_type: relationshipType,
    },
  });
  if (!result.ok) throw failure(result, 'add application relationships');
  const data = result.data as AddApplicationRelationshipResponse200 | null;
  if (!data) throw new ApplicationRequestError('The application relationship was not added.', null, false);
  return {
    relationshipId: data.relationship_id,
    relationshipRevision: Number(data.relationship_revision),
    state: data.state,
  };
}

export async function removeApplicationRelationship(
  applicationId: string,
  relationshipId: string,
  expectedRelationshipRevision: number
): Promise<ApplicationRelationshipChange> {
  const tenantId = requireActiveTenantId();
  const result = await client.removeApplicationRelationship({
    params: { tenant_id: tenantId, application_id: applicationId, relationship_id: relationshipId },
    query: { expected_relationship_revision: expectedRelationshipRevision },
  });
  if (!result.ok) throw failure(result, 'remove application relationships');
  const data = result.data as RemoveApplicationRelationshipResponse200 | null;
  if (!data) throw new ApplicationRequestError('The application relationship was not removed.', null, false);
  return {
    relationshipId: data.relationship_id,
    relationshipRevision: Number(data.relationship_revision),
    state: data.state,
  };
}

export async function declareSystemInstance(
  applicationId: string,
  expectedApplicationRevision: number,
  input: { name: string; kind: string; accessBoundaryReference: string | null }
): Promise<string> {
  const tenantId = requireActiveTenantId();
  const result = await client.declareSystemInstance({
    params: { tenant_id: tenantId, application_id: applicationId },
    body: {
      expected_application_revision: expectedApplicationRevision,
      name: input.name,
      kind: input.kind,
      access_boundary_reference: input.accessBoundaryReference,
    },
  });
  if (!result.ok) throw failure(result, 'record the system instance');
  if (!result.data) throw new ApplicationRequestError('The system instance was not recorded.', null, false);
  return result.data.system_instance_id;
}

export async function retireSystemInstance(
  applicationId: string,
  instance: SystemInstance,
  effectiveAt: string,
  reason: string
): Promise<void> {
  const tenantId = requireActiveTenantId();
  const result = await client.retireSystemInstance({
    params: { tenant_id: tenantId, application_id: applicationId, system_instance_id: instance.systemInstanceId },
    body: { expected_revision: instance.revision, effective_at: effectiveAt, reason },
  });
  if (!result.ok) throw failure(result, 'retire the system instance');
}

export interface InstanceBoundaryReference {
  boundaryId: string;
  programId: string;
  status: string;
  kind: string;
  subject: string;
  rationale: string;
}

// The impact of retiring a system instance: every boundary entry that still names it.

export async function listInstanceBoundaryReferences(
  applicationId: string,
  systemInstanceId: string
): Promise<InstanceBoundaryReference[]> {
  const tenantId = requireActiveTenantId();
  const references: InstanceBoundaryReference[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.listSystemInstanceBoundaryReferences({
      params: { tenant_id: tenantId, application_id: applicationId, system_instance_id: systemInstanceId },
      query: { cursor },
    });
    if (!result.ok) throw failure(result, 'preview the retirement');
    for (const item of result.data?.items ?? []) {
      if (item) {
        references.push({
          boundaryId: item.boundary_id,
          programId: item.program_id,
          status: item.status,
          kind: item.kind,
          subject: item.subject,
          rationale: item.rationale,
        });
      }
    }
    cursor = result.data?.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return references;
}

type RawDecision = {
  decision_id: string;
  sequence: number | string;
  decision: string;
  reason: string;
  effective_from: string;
  review_by: string | null;
  approved_by: { display: string };
  decided_at: string;
  separation_of_duties_waiver_id: string | null;
};

function decisionOf(raw: RawDecision): ScopeDecision {
  return {
    decisionId: raw.decision_id,
    sequence: Number(raw.sequence),
    decision: raw.decision,
    reason: raw.reason,
    effectiveFrom: raw.effective_from,
    reviewBy: raw.review_by,
    approvedBy: raw.approved_by.display,
    decidedAt: raw.decided_at,
    waiverId: raw.separation_of_duties_waiver_id,
  };
}

export async function getAccessReviewScope(
  applicationId: string,
  systemInstanceId: string,
  asOf: string | null
): Promise<AccessReviewScope> {
  const tenantId = requireActiveTenantId();
  const result = await client.getAccessReviewScope({
    params: { tenant_id: tenantId, application_id: applicationId, system_instance_id: systemInstanceId },
    query: { as_of: asOf ?? undefined },
  });
  if (!result.ok) throw failure(result, 'load the access-review scope');
  const data = result.data;
  if (!data) throw new ApplicationRequestError('This system instance was not found.', 404, false);
  return {
    asOf: data.as_of,
    status: data.status,
    effective: data.effective ? decisionOf(data.effective) : null,
    decisions: present(data.decisions)
      .map(decisionOf)
      .sort((a, b) => b.sequence - a.sequence),
  };
}

export async function decideAccessReviewScope(
  applicationId: string,
  systemInstanceId: string,
  input: ScopeDecisionInput
): Promise<void> {
  const tenantId = requireActiveTenantId();
  const result = await client.decideAccessReviewScope({
    params: { tenant_id: tenantId, application_id: applicationId, system_instance_id: systemInstanceId },
    body: {
      expected_system_instance_revision: input.expectedSystemInstanceRevision,
      expected_decision_count: input.expectedDecisionCount,
      decision: input.decision,
      reason: input.reason,
      effective_from: input.effectiveFrom,
      ...(input.reviewBy ? { review_by: input.reviewBy } : {}),
      ...(input.waiverId ? { separation_of_duties_waiver_id: input.waiverId } : {}),
    },
  });
  if (!result.ok) throw failure(result, 'record the scope decision');
}

function failure(result: { ok: false; kind: string; status: number; error?: unknown }, action: string) {
  const problem =
    result.kind === 'http' && typeof result.error === 'object' && result.error !== null
      ? (result.error as { detail?: unknown; transient?: unknown })
      : {};
  const detail = typeof problem.detail === 'string' ? problem.detail : '';
  if (result.status === 403) {
    if (/separation-of-duties|registered the system instance/i.test(detail)) {
      return new ApplicationRequestError(detail, 403, false, true);
    }
    return new ApplicationRequestError(`You do not have permission to ${action}.`, 403, false);
  }
  if (problem.transient === true) {
    return new ApplicationRequestError(
      'The latest changes are still being processed. Try again in a moment.',
      result.status,
      true
    );
  }
  return new ApplicationRequestError(
    detail.length > 0 ? detail : `Unable to ${action}.`,
    result.kind === 'http' ? result.status : null,
    false
  );
}
