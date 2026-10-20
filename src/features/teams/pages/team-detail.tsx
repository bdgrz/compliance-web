import { state } from '@askrjs/askr';
import { resource } from '@askrjs/askr/resources';
import {
  Block,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Page,
  PageHeader,
  EmptyState,
  Spinner,
} from '@askrjs/themes/components';

import {
  getMemberAccess,
  listMembers,
  type MemberSummary,
} from '../../members/members.js';
import {
  assignTeamMember,
  getTeam,
  listTeamMembers,
  removeTeamMember,
  TeamRequestError,
} from '../teams.js';
import { organizationPath } from '../../tenants/tenants.js';
import { TeamRolesPanel } from './team-roles-panel.js';

export function TeamDetailPage({ teamId }: { teamId: string }) {
  const [actionError, setError] = state<string | null>(null);
  const [version, setVersion] = state(0);

  const teamResource = resource(() => getTeam(teamId), [teamId, version()]);
  const team = () => (teamResource.pending ? null : teamResource.value);
  const membersResource = resource(
    () => listTeamMembers(teamId),
    [teamId, version()]
  );
  const members = () =>
    membersResource.pending ? null : membersResource.value;
  const error = () =>
    actionError() ??
    teamResource.error?.message ??
    membersResource.error?.message ??
    null;

  function reload() {
    setVersion(version() + 1);
  }

  async function remove(targetMemberId: string) {
    setError(null);
    try {
      await removeTeamMember(teamId, targetMemberId);
      reload();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to remove that member.'
      );
    }
  }

  if (teamResource.pending || membersResource.pending) {
    return (
      <Page>
        <Spinner label="Loading team members" />
      </Page>
    );
  }
  const loadError = teamResource.error ?? membersResource.error;
  if (loadError || !team()) {
    const status =
      loadError instanceof TeamRequestError ? loadError.status : null;
    return (
      <Page>
        <EmptyState
          title={
            status === 403
              ? 'Team members are not available to you'
              : status === 404 || (!team() && !loadError)
                ? 'Team not found'
                : 'Team members could not be loaded'
          }
          titleAs="h1"
          description={loadError?.message ?? 'This team could not be found.'}
          action={
            status === 403 || status === 404 || !loadError ? (
              <a href={organizationPath('/teams')}>Back to teams</a>
            ) : (
              <Button onPress={reload}>Try again</Button>
            )
          }
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={team()?.name ?? 'Team'}
        description="Manage who belongs to this team."
      />
      <TeamRolesPanel teamId={teamId} />
      <TeamMemberAssignment teamId={teamId} onAssigned={reload} />
      {error() ? <p role="alert">{error()}</p> : null}
      {members() === null && !error() ? <p>Loading…</p> : null}
      {members()?.length === 0 ? (
        <p>No members belong to this team yet.</p>
      ) : null}
      <Block direction="column" gap="md">
        {(members() ?? []).map((member) => (
          <Card key={member.memberId}>
            <CardContent>
              <Block direction="row" gap="md" align="center" justify="between">
                <Block direction="column" gap="sm">
                  {member.userId ? (
                    <a href={organizationPath(`/members/${member.userId}`)}>
                      {member.displayName ??
                        member.emailAddress ??
                        member.memberId}
                    </a>
                  ) : (
                    <span>
                      {member.displayName ??
                        member.emailAddress ??
                        member.memberId}
                    </span>
                  )}
                  {member.emailAddress &&
                  member.emailAddress !== member.displayName ? (
                    <span>{member.emailAddress}</span>
                  ) : null}
                </Block>
                <Button
                  variant="destructive"
                  aria-label={`Remove ${member.displayName ?? member.emailAddress ?? member.memberId} from this team`}
                  onPress={() => void remove(member.memberId)}
                >
                  Remove
                </Button>
              </Block>
            </CardContent>
          </Card>
        ))}
      </Block>
      <Button asChild variant="ghost">
        <a href={organizationPath('/teams')}>Back to teams</a>
      </Button>
    </Page>
  );
}

function TeamMemberAssignment({
  teamId,
  onAssigned,
}: {
  teamId: string;
  onAssigned: () => void;
}) {
  const [userId, setUserId] = state('');
  const [version, setVersion] = state(0);
  const [error, setError] = state<string | null>(null);
  const [submitting, setSubmitting] = state(false);
  const roster = resource(() => listMembers(), [version()]);
  const members = () =>
    roster.pending
      ? null
      : (roster.value ?? []).filter(
          (member) => !member.suspended && member.affiliation !== 'firm_staff'
        );

  async function add(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    const selectedUserId = userId();
    if (!selectedUserId) return;
    setError(null);
    setSubmitting(true);
    try {
      const access = await getMemberAccess(selectedUserId);
      await assignTeamMember(teamId, access.member_id);
      setUserId('');
      onAssigned();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to add that member.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a member</CardTitle>
      </CardHeader>
      <CardContent>
        {roster.pending ? (
          <Spinner label="Loading members" />
        ) : roster.error ? (
          <Block direction="column" gap="sm">
            <p role="alert">{roster.error.message}</p>
            <Button
              variant="secondary"
              onPress={() => setVersion(version() + 1)}
            >
              Try again
            </Button>
          </Block>
        ) : members()?.length === 0 ? (
          <p>No active members are available to add.</p>
        ) : (
          <form onSubmit={(event) => void add(event)}>
            <Block direction="row" gap="md" align="end">
              <label className="registration-field">
                <span>Member</span>
                <select
                  aria-label="Member"
                  value={userId()}
                  onChange={(event: Event) =>
                    setUserId((event.target as HTMLSelectElement).value)
                  }
                  required
                >
                  <option value="">Choose a member</option>
                  {(members() ?? []).map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {memberOptionLabel(member)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="primary"
                type="submit"
                disabled={submitting() || !userId()}
              >
                {submitting() ? 'Adding…' : 'Add member'}
              </Button>
            </Block>
          </form>
        )}
        {error() ? <p role="alert">{error()}</p> : null}
      </CardContent>
    </Card>
  );
}

function memberOptionLabel(member: MemberSummary): string {
  const name = member.displayName?.trim();
  const email = member.emailAddress?.trim();
  if (name && email && name.toLocaleLowerCase() !== email.toLocaleLowerCase()) {
    return `${name} — ${email}`;
  }
  return name || email || 'Organization member';
}
