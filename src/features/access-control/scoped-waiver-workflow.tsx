import { state } from '@askrjs/askr';
import { resource } from '@askrjs/askr/resources';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Page,
  PageHeader,
  Spinner,
  Stack,
} from '@askrjs/themes/components';

import {
  approveWaiver,
  getWaiver,
  listMemberOptions,
  recordWaiver,
  type ResponsibilityScope,
  type Waiver,
} from '../boundaries/responsibilities.js';

function defaultExpiry(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// Actor, rationale, exact scope, expiry, and second-administrator approval are shown together.
export function WaiverSummary({ waiver, beneficiaryLabel }: { waiver: Waiver; beneficiaryLabel: string }) {
  const expired = new Date(waiver.expiresAt).getTime() <= Date.now();
  return (
    <dl className="boundary-waiver scoped-waiver-summary">
      <dt>Status</dt>
      <dd>
        {label(waiver.status)}
        {waiver.active ? ' · active' : expired ? ' · expired' : ' · not active'}
      </dd>
      <dt>Requested by</dt>
      <dd>
        {waiver.requester} on {new Date(waiver.requestedAt).toLocaleString()}
      </dd>
      <dt>Rationale</dt>
      <dd>{waiver.rationale}</dd>
      <dt>Scope</dt>
      <dd>
        Lets {beneficiaryLabel} {waiver.scope.action} {label(waiver.scope.recordType)} revision{' '}
        {waiver.scope.revision} (version {shortId(waiver.scope.versionId)}) only
      </dd>
      <dt>Expires</dt>
      <dd>{new Date(waiver.expiresAt).toLocaleString()}</dd>
      <dt>Second-administrator approval</dt>
      <dd>
        {waiver.approver && waiver.approvedAt
          ? `${waiver.approver} on ${new Date(waiver.approvedAt).toLocaleString()}`
          : 'Awaiting approval by a different administrator'}
      </dd>
      <dt>Exception ID</dt>
      <dd>
        <code>{waiver.waiverId}</code>
      </dd>
    </dl>
  );
}

export function ScopedWaiverWorkflow({
  scope,
  description,
  scopeDescription,
  noScopeDescription,
  backPath,
  backLabel,
  exceptionPath,
  describeFailure,
  preserveApprovalDenialDetail = false,
  beneficiaryLabel = 'the selected member',
}: {
  scope: ResponsibilityScope | null;
  description: string;
  scopeDescription: string;
  noScopeDescription: string;
  backPath: string;
  backLabel: string;
  exceptionPath: string;
  describeFailure: (error: Error) => string;
  preserveApprovalDenialDetail?: boolean;
  beneficiaryLabel?: string;
}) {
  const members = resource(() => listMemberOptions(), []);
  const initialId = new URLSearchParams(window.location.search).get('exception') ?? '';
  const [lookupId, setLookupId] = state(initialId);
  const [shownId, setShownId] = state(initialId);
  const [waiverVersion, setWaiverVersion] = state(0);
  const [waiverOverride, setWaiverOverride] = state<Waiver | null>(null);
  const waiver = resource(() => (shownId() ? getWaiver(shownId()) : Promise.resolve(null)), [shownId(), waiverVersion()]);
  const [action, setAction] = state('review');
  const [beneficiary, setBeneficiary] = state('');
  const [rationale, setRationale] = state('');
  const [expires, setExpires] = state(defaultExpiry());
  const [pending, setPending] = state(false);
  const [actionError, setActionError] = state<Error | null>(null);
  const [notice, setNotice] = state<string | null>(null);

  async function run(work: () => Promise<string>) {
    setActionError(null);
    setNotice(null);
    setPending(true);
    try {
      setNotice(await work());
    } catch (failure) {
      setActionError(failure instanceof Error ? failure : new Error('The request failed.'));
    } finally {
      setPending(false);
    }
  }

  function record(event: Event) {
    event.preventDefault();
    if (!scope) return;
    void run(async () => {
      const recorded = await recordWaiver(scope, action(), beneficiary(), rationale(), new Date(`${expires()}T23:59:59Z`).toISOString());
      setWaiverOverride(recorded);
      setLookupId(recorded.waiverId);
      setShownId(recorded.waiverId);
      setWaiverVersion(waiverVersion() + 1);
      setRationale('');
      return 'Exception recorded. A different administrator must approve it before it can be used.';
    });
  }

  function approve(waiverId: string) {
    void run(async () => {
      const approved = await approveWaiver(waiverId, { preserveForbiddenDetail: preserveApprovalDenialDetail });
      setWaiverOverride(approved);
      setWaiverVersion(waiverVersion() + 1);
      return 'Exception approved.';
    });
  }

  const error = actionError();
  const shown = waiver.value;
  const membersReady = !members.pending || members.value !== undefined;

  return (
    <Page>
      <PageHeader title="Separation-of-duties exceptions" description={description} />
      <Stack gap="md">
        <a href={backPath}>{backLabel}</a>
        {error ? <p role="alert">{describeFailure(error)}</p> : null}
        {notice() ? <p role="status">{notice()}</p> : null}
        <Card>
          <CardHeader>
            <CardTitle>Record an exception</CardTitle>
            <CardDescription>{scope ? scopeDescription : noScopeDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {scope ? (
              membersReady && !members.error ? (
                <form onSubmit={(event: Event) => record(event)}>
                  <Stack gap="sm">
                    <label className="registration-field">
                      <span>Member who needs the exception</span>
                      <select value={beneficiary()} onChange={(event: Event) => setBeneficiary((event.target as HTMLSelectElement).value)} required>
                        <option value="" selected={beneficiary() === ''}>
                          Choose a member
                        </option>
                        {(members.value ?? []).map((member) => (
                          <option value={member.userId} selected={member.userId === beneficiary()}>
                            {member.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="registration-field">
                      <span>Decision allowed</span>
                      <select value={action()} onChange={(event: Event) => setAction((event.target as HTMLSelectElement).value)}>
                        <option value="review" selected={action() === 'review'}>
                          Review
                        </option>
                        <option value="approve" selected={action() === 'approve'}>
                          Approve
                        </option>
                      </select>
                    </label>
                    <label className="registration-field">
                      <span>Rationale</span>
                      <textarea rows={3} value={rationale()} onInput={(event: Event) => setRationale((event.target as HTMLTextAreaElement).value)} required />
                    </label>
                    <label className="registration-field">
                      <span>Expires at the end of</span>
                      <input type="date" value={expires()} onInput={(event: Event) => setExpires((event.target as HTMLInputElement).value)} required />
                    </label>
                    <Button variant="primary" type="submit" disabled={pending()}>
                      Record exception
                    </Button>
                  </Stack>
                </form>
              ) : members.error ? (
                <Stack gap="sm">
                  <p role="alert">{members.error.message}</p>
                  <Button variant="secondary" onPress={() => members.refresh()}>
                    Try again
                  </Button>
                </Stack>
              ) : (
                <Spinner label="Loading members" />
              )
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Review an exception</CardTitle>
            <CardDescription>Open an exception by ID to see who requested it and approve it as a second administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap="sm">
              <form
                onSubmit={(event: Event) => {
                  event.preventDefault();
                  setWaiverOverride(null);
                  setShownId(lookupId().trim());
                }}
              >
                <Stack gap="sm">
                  <label className="registration-field">
                    <span>Exception ID</span>
                    <input type="text" value={lookupId()} onInput={(event: Event) => setLookupId((event.target as HTMLInputElement).value)} required />
                  </label>
                  <Button variant="secondary" type="submit">
                    Open exception
                  </Button>
                </Stack>
              </form>
              {!shownId() ? null : waiver.pending && !shown ? (
                <Spinner label="Loading exception" />
              ) : waiver.error ? (
                <Stack gap="sm">
                  <p role="alert">{describeFailure(waiver.error)}</p>
                  <Button variant="secondary" onPress={() => waiver.refresh()}>
                    Try again
                  </Button>
                </Stack>
              ) : shown ? (
                <Stack gap="sm">
                  <WaiverSummary
                    waiver={waiverOverride() ?? shown}
                    beneficiaryLabel={beneficiaryLabel}
                  />
                  <p>
                    Share this link with a second administrator:{' '}
                    <a href={`${exceptionPath}?exception=${encodeURIComponent((waiverOverride() ?? shown).waiverId)}`}>
                      exception {shortId((waiverOverride() ?? shown).waiverId)}
                    </a>
                  </p>
                  {(waiverOverride() ?? shown).approvedAt ? null : (
                    <Button variant="primary" disabled={pending()} onPress={() => approve((waiverOverride() ?? shown).waiverId)}>
                      Approve as second administrator
                    </Button>
                  )}
                </Stack>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Page>
  );
}
