import { resource } from '@askrjs/askr/resources';
import { Button, EmptyState, Page, Spinner } from '@askrjs/themes/components';

import { ScopedWaiverWorkflow, WaiverSummary } from '../../access-control/scoped-waiver-workflow.js';
import { organizationPath } from '../../tenants/tenants.js';
import { getBoundary, ProgramRequestError } from '../boundaries.js';
import { describeBoundaryFailure } from '../components/boundary-form.js';
import type { ResponsibilityScope } from '../responsibilities.js';

export { WaiverSummary };

export function BoundaryExceptionsPage({ programId, boundaryId }: { programId: string; boundaryId: string }) {
  const boundary = resource(() => getBoundary(boundaryId), [boundaryId]);
  const detailPath = organizationPath(`/programs/${programId}/boundaries/${boundaryId}`);
  const exceptionPath = `${detailPath}/exceptions`;

  if (boundary.pending && !boundary.value) {
    return (
      <Page>
        <Spinner label="Loading boundary" />
      </Page>
    );
  }

  if (boundary.error) {
    const status = boundary.error instanceof ProgramRequestError ? boundary.error.status : null;
    return (
      <Page>
        <EmptyState
          title={status === 403 ? 'Exceptions are not available to you' : status === 404 ? 'Boundary not found' : 'Boundary could not be loaded'}
          titleAs="h1"
          description={boundary.error.message}
          action={
            status === 403 || status === 404 ? (
              <a href={detailPath}>Back to boundary</a>
            ) : (
              <Button variant="primary" onPress={() => boundary.refresh()}>
                Try again
              </Button>
            )
          }
        />
      </Page>
    );
  }

  const draft = boundary.value!.draft;
  const scope: ResponsibilityScope | null = draft
    ? { recordType: 'boundary', recordId: boundaryId, versionId: draft.versionId, revision: draft.revision }
    : null;

  return (
    <ScopedWaiverWorkflow
      scope={scope}
      description="Record a narrowly scoped, expiring exception for one member and one decision on this boundary's current draft revision."
      scopeDescription={`Applies only to draft revision ${scope?.revision}; a revised draft needs a new exception.`}
      noScopeDescription="This boundary has no open draft, so there is nothing to except."
      backPath={detailPath}
      backLabel="Back to boundary"
      exceptionPath={exceptionPath}
      describeFailure={(error) => describeBoundaryFailure(error, 'this exception')}
      beneficiaryLabel="the selected member"
    />
  );
}
