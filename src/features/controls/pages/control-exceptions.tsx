import { resource } from '@askrjs/askr/resources';
import { Button, EmptyState, Page, Spinner } from '@askrjs/themes/components';

import { ScopedWaiverWorkflow } from '../../access-control/scoped-waiver-workflow.js';
import { organizationPath } from '../../tenants/tenants.js';
import { getControlDraft } from '../controls.js';
import { ProgramRequestError } from '../../programs/programs.js';
import type { ResponsibilityScope } from '../../boundaries/responsibilities.js';

const draftVersionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ControlExceptionsPage({ programId, controlId }: { programId: string; controlId: string }) {
  const control = resource(() => getControlDraft(programId, controlId), [programId, controlId]);
  const detailPath = organizationPath(`/programs/${programId}/controls/${controlId}`);
  const exceptionPath = `${detailPath}/exceptions`;

  if (control.pending && !control.value) {
    return (
      <Page>
        <Spinner label="Loading control" />
      </Page>
    );
  }

  if (control.error || !control.value) {
    const error = control.error;
    const status = error instanceof ProgramRequestError ? error.status : null;
    return (
      <Page>
        <EmptyState
          title={status === 403 ? 'Exceptions are not available to you' : status === 404 ? 'Control not found' : 'Control could not be loaded'}
          titleAs="h1"
          description={error?.message ?? 'This control was not found.'}
          action={
            status === 403 || status === 404 ? (
              <a href={detailPath}>Back to control</a>
            ) : (
              <Button variant="primary" onPress={() => control.refresh()}>
                Try again
              </Button>
            )
          }
        />
      </Page>
    );
  }

  const current = control.value;
  const scope: ResponsibilityScope | null =
    current.status === 'draft' &&
    current.draftVersionId !== null &&
    draftVersionPattern.test(current.draftVersionId) &&
    Number.isSafeInteger(current.revision) &&
    current.revision > 0
      ? {
          recordType: 'control',
          recordId: current.controlId,
          versionId: current.draftVersionId,
          revision: current.revision,
        }
      : null;

  return (
    <ScopedWaiverWorkflow
      scope={scope}
      description={`Exceptions for control ${current.identifier}, revision ${current.revision}.`}
      scopeDescription={`Applies only to control ${current.identifier} revision ${current.revision}; a revised draft needs a new exception.`}
      noScopeDescription="This control has no open draft with a current version, so there is nothing to except. You can still look up an existing exception."
      backPath={detailPath}
      backLabel="Back to control"
      exceptionPath={exceptionPath}
      describeFailure={(error) => error.message}
      preserveApprovalDenialDetail
      beneficiaryLabel="the selected member"
    />
  );
}
