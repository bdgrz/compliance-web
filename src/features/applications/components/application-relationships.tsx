import { state } from '@askrjs/askr';
import { resource } from '@askrjs/askr/resources';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  Stack,
} from '@askrjs/themes/components';

import { organizationPath } from '../../tenants/tenants.js';
import {
  addApplicationRelationship,
  ApplicationRequestError,
  listApplicationRelationships,
  removeApplicationRelationship,
  type ApplicationRelationship,
  type ApplicationRelationshipType,
  type ApplicationSummary,
} from '../applications.js';

interface RelationshipAttempt {
  relationshipId: string;
  targetApplicationId: string;
  relationshipType: ApplicationRelationshipType;
  expectedRelationshipRevision: number;
}

const relationshipLabels: Record<ApplicationRelationshipType, string> = {
  depends_on: 'Depends on',
  replaces: 'Replaces',
};

function relationshipLabel(type: string): string {
  return type in relationshipLabels
    ? relationshipLabels[type as ApplicationRelationshipType]
    : type.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
}

function isForbidden(error: Error | null | undefined): boolean {
  return error instanceof ApplicationRequestError && error.status === 403;
}

function isConflict(error: Error | null | undefined): boolean {
  return error instanceof ApplicationRequestError && error.status === 409;
}

export function ApplicationRelationshipsCard({
  applicationId,
  applications,
  canManage,
}: {
  applicationId: string;
  applications: ApplicationSummary[];
  canManage: boolean;
}) {
  const [version, setVersion] = state(0);
  const [minimumRevision, setMinimumRevision] = state<number | undefined>(undefined);
  const [targetApplicationId, setTargetApplicationId] = state('');
  const [relationshipType, setRelationshipType] = state<ApplicationRelationshipType>('depends_on');
  const [pending, setPending] = state(false);
  const [actionError, setActionError] = state<Error | null>(null);
  const [notice, setNotice] = state<string | null>(null);
  const [attempt, setAttempt] = state<RelationshipAttempt | null>(null);
  const relationships = resource(
    () => listApplicationRelationships(applicationId, minimumRevision()),
    [applicationId, minimumRevision(), version()]
  );
  const page = relationships.value;
  const candidates = applications.filter(
    (application) => application.applicationId !== applicationId && application.lifecycle === 'active'
  );
  const names = new Map(applications.map((application) => [application.applicationId, application.name]));
  const denied = isForbidden(relationships.error) || isForbidden(actionError());

  function refresh(minimum?: number) {
    if (minimum !== undefined) setMinimumRevision(minimum);
    setAttempt(null);
    setActionError(null);
    setVersion(version() + 1);
  }

  function setTarget(value: string) {
    setTargetApplicationId(value);
    setAttempt(null);
    setActionError(null);
  }

  function setType(value: ApplicationRelationshipType) {
    setRelationshipType(value);
    setAttempt(null);
    setActionError(null);
  }

  async function executeAdd(request: RelationshipAttempt) {
    setPending(true);
    setActionError(null);
    setNotice(null);
    setAttempt(request);
    try {
      const change = await addApplicationRelationship(
        applicationId,
        request.relationshipId,
        request.expectedRelationshipRevision,
        request.targetApplicationId,
        request.relationshipType
      );
      setTargetApplicationId('');
      setAttempt(null);
      setNotice(`${relationshipLabel(request.relationshipType)} relationship added.`);
      refresh(change.relationshipRevision);
    } catch (failure) {
      const error = failure instanceof Error ? failure : new Error('Unable to add the application relationship.');
      setActionError(error);
      if (isForbidden(error) || isConflict(error)) setAttempt(null);
    } finally {
      setPending(false);
    }
  }

  async function add(event: Event) {
    event.preventDefault();
    if (pending() || !page || denied) return;
    if (!targetApplicationId()) {
      setActionError(new Error('Choose an application for this relationship.'));
      return;
    }
    const previous = attempt();
    const request = previous && previous.targetApplicationId === targetApplicationId() &&
      previous.relationshipType === relationshipType() && previous.expectedRelationshipRevision === page.relationshipRevision
      ? previous
      : {
          relationshipId: crypto.randomUUID(),
          targetApplicationId: targetApplicationId(),
          relationshipType: relationshipType(),
          expectedRelationshipRevision: page.relationshipRevision,
        };
    await executeAdd(request);
  }

  async function remove(relationship: ApplicationRelationship) {
    if (pending() || !page || denied) return;
    setPending(true);
    setActionError(null);
    setNotice(null);
    try {
      const change = await removeApplicationRelationship(
        applicationId,
        relationship.relationshipId,
        page.relationshipRevision
      );
      setNotice(`${relationshipLabel(relationship.relationshipType)} relationship removed.`);
      refresh(change.relationshipRevision);
    } catch (failure) {
      const error = failure instanceof Error ? failure : new Error('Unable to remove the application relationship.');
      setActionError(error);
    } finally {
      setPending(false);
    }
  }

  const error = actionError();
  const listError = relationships.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application relationships</CardTitle>
        <CardDescription>Outgoing dependencies and replacements recorded for this application.</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="sm">
          {notice() ? <p role="status">{notice()}</p> : null}
          {denied ? (
            <p role="note">You do not have permission to view or change application relationships.</p>
          ) : relationships.pending && !page ? (
            <Spinner label="Loading application relationships" />
          ) : listError ? (
            <Stack gap="sm">
              <p role="alert">
                {isConflict(listError)
                  ? 'The relationship list changed. Refresh it before continuing.'
                  : listError.message}
              </p>
              <Button variant="secondary" onPress={() => refresh()}>
                Try again
              </Button>
            </Stack>
          ) : (
            <>
              {page?.items.length ? (
                <ul className="plain-list application-relationships">
                  {page.items.map((relationship) => {
                    const targetName = names.get(relationship.targetApplicationId) ?? 'Application not on the current list';
                    return (
                      <li>
                        <strong>{relationshipLabel(relationship.relationshipType)}</strong>{' '}
                        <a href={organizationPath(`/applications/${relationship.targetApplicationId}`)}>{targetName}</a>
                        <p>
                          Recorded by {relationship.actorDisplay} on {new Date(relationship.changedAt).toLocaleDateString()}.
                        </p>
                        {canManage ? (
                          <Button
                            variant="secondary"
                            onPress={() => void remove(relationship)}
                            disabled={pending()}
                            aria-label={`Remove relationship to ${targetName}`}
                          >
                            Remove relationship
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>No application relationships have been recorded.</p>
              )}
              {canManage && candidates.length === 0 ? (
                <p>No other active applications are available to link.</p>
              ) : null}
              {canManage ? (
                <form aria-label="Add application relationship" onSubmit={(event: Event) => void add(event)}>
                  <Stack gap="sm">
                    <label className="registration-field">
                      <span>Related application</span>
                      <select
                        aria-label="Related application"
                        value={targetApplicationId()}
                        onChange={(event: Event) => setTarget((event.target as HTMLSelectElement).value)}
                        disabled={pending() || candidates.length === 0}
                      >
                        <option value="">Choose an application</option>
                        {candidates.map((application) => (
                          <option value={application.applicationId}>{application.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="registration-field">
                      <span>Relationship type</span>
                      <select
                        aria-label="Relationship type"
                        value={relationshipType()}
                        onChange={(event: Event) => setType((event.target as HTMLSelectElement).value as ApplicationRelationshipType)}
                        disabled={pending()}
                      >
                        <option value="depends_on">Depends on</option>
                        <option value="replaces">Replaces</option>
                      </select>
                    </label>
                    {error ? (
                      <p role="alert">
                        {isConflict(error)
                          ? 'Someone else changed these relationships. Refresh the list before trying again.'
                          : error.message}
                      </p>
                    ) : null}
                    {error && attempt() && !isConflict(error) && !isForbidden(error) ? (
                      <Button variant="secondary" onPress={() => void executeAdd(attempt()!)} disabled={pending()}>
                        Retry add
                      </Button>
                    ) : null}
                    {error && isConflict(error) ? (
                      <Button variant="secondary" onPress={() => refresh()} disabled={pending()}>
                        Refresh relationships
                      </Button>
                    ) : null}
                    <Button variant="primary" type="submit" disabled={pending() || candidates.length === 0 || !page}>
                      {pending() ? 'Adding relationship…' : 'Add relationship'}
                    </Button>
                  </Stack>
                </form>
              ) : null}
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
