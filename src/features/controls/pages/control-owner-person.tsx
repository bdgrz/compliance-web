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
import { listPeople, type Person } from '../../workforce/workforce.js';
import {
  designateControlOwnerPerson,
  getControlDraftOwnerPerson,
  type ControlDraftOwnerPerson,
} from '../controls.js';

function OwnerPersonForm({
  programId,
  controlId,
  owner,
  people,
  disabled,
  onSaved,
}: {
  programId: string;
  controlId: string;
  owner: ControlDraftOwnerPerson;
  people: Person[];
  disabled: boolean;
  onSaved: () => void;
}) {
  const [personId, setPersonId] = state(owner.designation?.personId ?? '');
  const [rationale, setRationale] = state('');
  const [pending, setPending] = state(false);
  const [error, setError] = state<string | null>(null);
  const [notice, setNotice] = state<string | null>(null);
  const missingPerson =
    personId() && !people.some((person) => person.personId === personId());

  async function submit(event: Event) {
    event.preventDefault();
    if (
      pending() ||
      disabled ||
      !rationale().trim() ||
      rationale().length > 4000
    )
      return;
    if (personId() && !people.some((person) => person.personId === personId()))
      return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await designateControlOwnerPerson(
        programId,
        controlId,
        owner.revision,
        personId() || null,
        rationale()
      );
      setRationale('');
      setNotice('Designation saved. Reloading the authoritative owner.');
      onSaved();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to save the accountable person.'
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-label="Designate accountable person" onSubmit={submit}>
      <Stack gap="sm">
        <fieldset disabled={disabled || pending()}>
          <legend>Designate a workforce person</legend>
          <label className="registration-field">
            <span>Accountable person</span>
            <select
              value={personId()}
              onChange={(event: Event) =>
                setPersonId((event.target as HTMLSelectElement).value)
              }
            >
              <option value="">Unassigned</option>
              {missingPerson ? (
                <option value={personId()}>
                  Person {personId()} (outside the current roster)
                </option>
              ) : null}
              {people.map((person) => (
                <option value={person.personId}>
                  {person.displayName}
                  {person.workEmail ? ` (${person.workEmail})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="registration-field">
            <span>Designation rationale</span>
            <textarea
              rows={3}
              value={rationale()}
              maxLength={4000}
              required
              onInput={(event: Event) =>
                setRationale((event.target as HTMLTextAreaElement).value)
              }
            />
            <small>
              Explain this designation or why ownership is being cleared.
              Maximum 4,000 characters.
            </small>
          </label>
          <Button
            type="submit"
            variant="primary"
            disabled={
              disabled ||
              pending() ||
              !rationale().trim() ||
              rationale().length > 4000 ||
              Boolean(missingPerson)
            }
          >
            {pending() ? 'Saving person…' : 'Save accountable person'}
          </Button>
        </fieldset>
        {error() ? <p role="alert">{error()}</p> : null}
        {notice() ? <p role="status">{notice()}</p> : null}
      </Stack>
    </form>
  );
}

export function ControlOwnerPersonCard({
  programId,
  controlId,
  revision,
  draftVersionId,
  refreshVersion,
  detailPending,
  onSaved,
  onReload,
}: {
  programId: string;
  controlId: string;
  revision: number;
  draftVersionId: string | null;
  refreshVersion: number;
  detailPending: boolean;
  onSaved: () => void;
  onReload: () => void;
}) {
  const owner = resource(
    async () => ({
      value: await getControlDraftOwnerPerson(programId, controlId),
      refreshVersion,
    }),
    [programId, controlId, revision, draftVersionId, refreshVersion]
  );
  const people = resource(() => listPeople(), [programId, controlId]);
  // A content/lifecycle transition invalidates prior local designations, even before its GET completes.
  const current =
    owner.value?.refreshVersion === refreshVersion ? owner.value.value : null;
  const saved = current?.designation;
  const roster = people.error
    ? []
    : [...(people.value ?? [])].sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      );
  const savedPerson = roster.find(
    (person) => person.personId === saved?.personId
  );
  const mismatch =
    current &&
    current.draftVersionId !== null &&
    (current.revision !== revision ||
      current.draftVersionId !== draftVersionId);
  const disabled =
    detailPending ||
    owner.pending ||
    Boolean(owner.error) ||
    people.pending ||
    Boolean(people.error) ||
    Boolean(mismatch);

  return (
    <section aria-label="Accountable person">
      <Card>
        <CardHeader>
          <CardTitle>Accountable person</CardTitle>
          <CardDescription>
            Designate a recorded workforce person, including a person without a
            sign-in account. This does not invite them or grant access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap="sm">
            {current ? (
              saved ? (
                <div aria-label="Saved accountable person">
                  <p>
                    <strong>
                      {savedPerson?.displayName ?? `Person ${saved.personId}`}
                    </strong>
                  </p>
                  <p>
                    Recorded by {saved.actor.display} on{' '}
                    <time dateTime={saved.designatedAt}>
                      {new Date(saved.designatedAt).toLocaleString()}
                    </time>
                    .
                  </p>
                  <p>{saved.rationale}</p>
                </div>
              ) : (
                <p>No accountable person designated.</p>
              )
            ) : null}
            {owner.pending ? (
              <Spinner label="Loading accountable person" />
            ) : null}
            {owner.error ? (
              <div>
                <p role="alert">{owner.error.message}</p>
                <Button variant="secondary" onPress={() => owner.refresh()}>
                  Retry owner read
                </Button>
              </div>
            ) : null}
            {current?.draftVersionId === null ? (
              <p>No open draft. Person designation is unavailable.</p>
            ) : null}
            {mismatch ? (
              <div>
                <p role="alert">
                  The owner readback and draft differ. Reload before changing
                  ownership.
                </p>
                <Button variant="secondary" onPress={onReload}>
                  Reload control and owner
                </Button>
              </div>
            ) : null}
            {people.pending ? (
              <Spinner label="Loading workforce people" />
            ) : people.error ? (
              <div>
                <p role="alert">{people.error.message}</p>
                <Button variant="secondary" onPress={() => people.refresh()}>
                  Retry workforce roster
                </Button>
              </div>
            ) : roster.length === 0 ? (
              <p>No people are recorded in the workforce roster yet.</p>
            ) : null}
            <a href={organizationPath('/workforce')}>
              Record or review workforce people
            </a>
            {current?.draftVersionId ? (
              <OwnerPersonForm
                key={`${current.draftVersionId}:${current.revision}:${saved?.designationId ?? 'unassigned'}`}
                programId={programId}
                controlId={controlId}
                owner={current}
                people={roster}
                disabled={disabled}
                onSaved={() => {
                  owner.refresh();
                  onSaved();
                }}
              />
            ) : null}
          </Stack>
        </CardContent>
      </Card>
    </section>
  );
}
