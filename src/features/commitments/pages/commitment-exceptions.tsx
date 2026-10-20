import { resource } from '@askrjs/askr/resources';
import { Button, EmptyState, Page, Spinner } from '@askrjs/themes/components';

import { ScopedWaiverWorkflow } from '../../access-control/scoped-waiver-workflow.js';
import { getCommitmentDraft, kindTitle, ProgramRequestError, describeCommitmentFailure } from '../commitments.js';
import { organizationPath } from '../../tenants/tenants.js';
import type { ResponsibilityScope } from '../../boundaries/responsibilities.js';

export function CommitmentExceptionsPage({ programId, draftId }: { programId: string; draftId: string }) {
  const draft = resource(() => getCommitmentDraft(programId, draftId), [programId, draftId]);
  const detailPath = organizationPath(`/programs/${programId}/commitments/${draftId}`);
  const exceptionPath = `${detailPath}/exceptions`;

  if (draft.pending && !draft.value) {
    return (
      <Page>
        <Spinner label="Loading commitment" />
      </Page>
    );
  }

  if (draft.error) {
    const status = draft.error instanceof ProgramRequestError ? draft.error.status : null;
    return (
      <Page>
        <EmptyState
          title={status === 403 ? 'Exceptions are not available to you' : status === 404 ? 'Commitment not found' : 'Commitment could not be loaded'}
          titleAs="h1"
          description={draft.error.message}
          action={
            status === 403 || status === 404 ? (
              <a href={detailPath}>Back to commitment</a>
            ) : (
              <Button variant="primary" onPress={() => draft.refresh()}>
                Try again
              </Button>
            )
          }
        />
      </Page>
    );
  }

  const current = draft.value!;
  const scope: ResponsibilityScope | null = current.status === 'effective'
    ? null
    : { recordType: 'commitment', recordId: draftId, versionId: draftId, revision: current.revision };

  return (
    <ScopedWaiverWorkflow
      scope={scope}
      description={`Exceptions for ${kindTitle(current.kind)} ${current.identifier}, revision ${current.revision}.`}
      scopeDescription={`Applies only to revision ${current.revision}; a revised draft needs a new exception.`}
      noScopeDescription="This revision is already effective, so there is nothing to except."
      backPath={detailPath}
      backLabel="Back to commitment"
      exceptionPath={exceptionPath}
      describeFailure={(error) => describeCommitmentFailure(error, 'this exception')}
      beneficiaryLabel="the selected member"
    />
  );
}
