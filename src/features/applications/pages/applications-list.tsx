import { state } from '@askrjs/askr';
import { resource } from '@askrjs/askr/resources';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Page,
  PageHeader,
  Spinner,
  Stack,
} from '@askrjs/themes/components';

import { currentTenant, organizationPath } from '../../tenants/tenants.js';
import {
  ApplicationRequestError,
  codeLabel,
  declareApplication,
  listApplications,
  type ApplicationDeclarationContent,
} from '../applications.js';
import { ApplicationFields, cleanDeclaration, declarationProblem, emptyContent } from '../components/application-fields.js';

export function ApplicationsPage() {
  const [content, setContent] = state<ApplicationDeclarationContent>({ ...emptyContent, applicationKind: '', criticality: '' });
  const [attempt] = state({ tenantId: currentTenant()?.tenantId ?? '', declarationKey: crypto.randomUUID() });
  const [pending, setPending] = state(false);
  const [actionError, setActionError] = state<string | null>(null);
  const applications = resource(() => listApplications(), []);

  async function declare(event: Event) {
    event.preventDefault();
    if (pending()) return;
    setActionError(null);
    const problem = declarationProblem(content());
    if (problem) {
      setActionError(problem);
      return;
    }
    if (currentTenant()?.tenantId !== attempt().tenantId) {
      setActionError('Return to the original organization to record this application.');
      return;
    }
    setPending(true);
    try {
      const applicationId = await declareApplication(cleanDeclaration(content()), attempt());
      if (currentTenant()?.tenantId !== attempt().tenantId) {
        throw new Error('Return to the original organization to reopen this application.');
      }
      window.location.assign(organizationPath(`/applications/${applicationId}`));
    } catch (failure) {
      setActionError(failure instanceof Error ? failure.message : 'Unable to record the application.');
      setPending(false);
    }
  }

  if (applications.error instanceof ApplicationRequestError && applications.error.status === 403) {
    return (
      <Page>
        <EmptyState
          title="Applications are not available to you"
          titleAs="h1"
          description="Ask a Compliance Lead or Org Admin for access to this organization's application inventory."
        />
      </Page>
    );
  }

  const items = applications.value ?? [];

  return (
    <Page>
      <PageHeader
        title="Applications"
        description="Applications and the reviewed systems that run them. Unresolved owners and classifications stay visible until someone resolves them."
      />
      <Stack gap="md">
        <Card>
          <CardHeader>
            <CardTitle>Record an application</CardTitle>
            <CardDescription>Record its purpose, classification, kind, criticality and both workforce owners. Owner attribution is optional.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event: Event) => void declare(event)}>
              <Stack gap="sm">
                <ApplicationFields content={content()} onChange={setContent} mode="declaration" />
                {actionError() ? <p role="alert">{actionError()}</p> : null}
                <Button variant="primary" type="submit" disabled={pending()}>
                  {pending() ? 'Recording…' : 'Record application'}
                </Button>
              </Stack>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Application inventory</CardTitle>
          </CardHeader>
          <CardContent>
            {applications.pending && !applications.value ? (
              <Spinner label="Loading applications" />
            ) : applications.error ? (
              <Stack gap="sm">
                <p role="alert">{applications.error.message}</p>
                <Button variant="secondary" onPress={() => applications.refresh()}>
                  Try again
                </Button>
              </Stack>
            ) : items.length === 0 ? (
              <p>No applications yet. Record the first one to start scoping access reviews.</p>
            ) : (
              <ul className="plain-list application-list">
                {items.map((application) => (
                  <li>
                    <a href={organizationPath(`/applications/${application.applicationId}`)}>{application.name}</a>
                    {application.lifecycle === 'retired' ? <span className="application-tag"> Retired</span> : null}
                    <span> · {application.purpose}</span>
                    <span> · Owner: {application.ownerReference ?? 'unresolved'}</span>
                    {application.classification ? <span> · {application.classification}</span> : null}
                    <span> · Kind: {application.applicationKind ?? 'Application kind missing'}</span>
                    <span> · Criticality: {application.criticality ?? 'Criticality missing'}</span>
                    <span> · Source: {application.sourceKind ?? 'Unknown'}{application.sourceIdentifier ? ` (${application.sourceIdentifier})` : ''}</span>
                    <span> · Lifecycle: {application.lifecycle}</span>
                    {application.hasSystemInstances ? null : <span> · No reviewed systems yet</span>}
                    {application.unresolved.length > 0 ? (
                      <ul className="application-unresolved" aria-label={`Unresolved for ${application.name}`}>
                        {application.unresolved.map((code) => (
                          <li>{codeLabel(code)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Page>
  );
}
