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

import { organizationPath } from '../../tenants/tenants.js';
import {
  getControlDraft,
  listControlDraftRevisions,
  ProgramRequestError,
  reviseControlDraft,
  type ControlContent,
} from '../controls.js';
import { ControlMappingsCard } from '../../control-mappings/mappings-card.js';
import {
  acceptedReview,
  getCurrentControlVersion,
  listControlDecisions,
  listControlVersions,
  previewControlImpact,
} from '../lifecycle.js';
import { ControlForm } from './control-form.js';
import { ControlOwnerPersonCard } from './control-owner-person.js';
import {
  ApproveForm,
  ImpactPreviewPanel,
  RetireForm,
  RetirementProposalForm,
  ReviewForm,
  SuccessorForm,
  VersionsCard,
} from './control-lifecycle.js';

const draftVersionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readReviewHandoff(search: string) {
  const query = new URLSearchParams(search);
  const revisions = query.getAll('review_revision');
  const versions = query.getAll('review_draft_version');
  if (revisions.length === 0 && versions.length === 0) return null;
  const revision = Number(revisions[0]);
  if (
    revisions.length !== 1 ||
    versions.length !== 1 ||
    !/^[1-9]\d*$/.test(revisions[0] ?? '') ||
    !Number.isSafeInteger(revision) ||
    !draftVersionPattern.test(versions[0] ?? '')
  )
    return false;
  return { revision, draftVersionId: versions[0].toLowerCase() };
}

// The approved version, its pending successor or retirement (from the impact preview), and the
// decisions that cite them. Loaded after the draft so the preview targets the exact revision.
async function loadLifecycle(
  programId: string,
  controlId: string,
  revision: number
) {
  const [current, decisions, versions] = await Promise.all([
    getCurrentControlVersion(programId, controlId),
    listControlDecisions(programId, controlId),
    listControlVersions(programId, controlId),
  ]);
  const preview =
    current && current.status !== 'retired'
      ? await previewControlImpact(programId, controlId, revision)
      : null;
  return { current, decisions, versions, preview };
}

export function ControlDetailPage({
  programId,
  controlId,
}: {
  programId: string;
  controlId: string;
}) {
  const [version, setVersion] = state(0);
  const [ownerVersion, setOwnerVersion] = state(0);
  const [written, setWritten] = state<number | undefined>(undefined);
  const control = resource(
    () => getControlDraft(programId, controlId, written()),
    [programId, controlId, version()]
  );
  const history = resource(
    () => listControlDraftRevisions(programId, controlId),
    [programId, controlId, version()]
  );
  const revision = control.value?.revision;
  const lifecycle = resource(
    () =>
      revision === undefined
        ? Promise.resolve(null)
        : loadLifecycle(programId, controlId, revision),
    [programId, controlId, revision, version()]
  );
  const changed = () => {
    setOwnerVersion(ownerVersion() + 1);
    setVersion(version() + 1);
  };
  const back = (
    <a href={organizationPath(`/programs/${programId}/controls`)}>
      Back to controls
    </a>
  );

  if (control.pending && !control.value) {
    return (
      <Page>
        <Spinner label="Loading control" />
      </Page>
    );
  }

  if (control.error) {
    const error = control.error;
    const status = error instanceof ProgramRequestError ? error.status : null;
    return (
      <Page>
        <EmptyState
          title={
            status === 403
              ? 'This control is not available to you'
              : status === 404
                ? 'Control not found'
                : 'Control could not be loaded'
          }
          titleAs="h1"
          description={error.message}
          action={
            status === 403 || status === 404 ? (
              back
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

  const current = control.value!;

  async function save(_identifier: string, content: ControlContent) {
    await reviseControlDraft(programId, controlId, current.revision, content);
    setWritten(current.revision + 1);
    changed();
    return 'Control draft saved.';
  }

  const applicabilityCard = (
    <Card>
      <CardHeader>
        <CardTitle>Applicability</CardTitle>
        <CardDescription>
          Owner {current.ownerResolution.replaceAll('_', ' ')} · applicability{' '}
          {current.applicabilityResolution.replaceAll('_', ' ')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {current.content.applicability.length === 0 ? (
          <p>No applicability references yet.</p>
        ) : (
          <ul className="plain-list control-applicability">
            {current.content.applicability.map((reference) => (
              <li>
                <strong>{reference.subject}</strong> (
                {reference.subject_type.replaceAll('_', ' ')}
                {reference.unresolved
                  ? ', not yet linked to a governed record'
                  : ''}
                ): {reference.rationale}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  const editCard = (
    <Card>
      <CardHeader>
        <CardTitle>Edit draft</CardTitle>
        <CardDescription>
          Saving checks that nobody else changed revision {current.revision}{' '}
          since you opened it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ControlForm
          initial={current.content}
          withIdentifier={false}
          submitLabel="Save draft"
          onSubmit={save}
        />
      </CardContent>
    </Card>
  );

  let lifecycleBody: unknown;
  if (lifecycle.pending && !lifecycle.value) {
    lifecycleBody = (
      <>
        {editCard}
        {applicabilityCard}
        <Spinner label="Loading approval status" />
      </>
    );
  } else if (lifecycle.error || !lifecycle.value) {
    lifecycleBody = (
      <>
        {editCard}
        {applicabilityCard}
        <Stack gap="sm">
          <p role="alert">
            {lifecycle.error?.message ?? 'Approval status could not be loaded.'}
          </p>
          <Button variant="secondary" onPress={() => lifecycle.refresh()}>
            Try again
          </Button>
        </Stack>
      </>
    );
  } else {
    const { current: approved, decisions, versions, preview } = lifecycle.value;
    const retired = approved?.status === 'retired';
    const openDraft = approved === null || preview?.kind === 'successor';
    const pendingRetirement = preview?.kind === 'retirement';
    const readsReady = !control.pending && !lifecycle.pending;
    const draftReady =
      openDraft &&
      !retired &&
      current.status === 'draft' &&
      draftVersionPattern.test(current.draftVersionId ?? '') &&
      Number.isSafeInteger(current.revision) &&
      current.revision > 0;
    const shareableDraft = draftReady && approved === null;
    const handoff = readReviewHandoff(window.location.search);
    const handoffWarning =
      handoff === false
        ? 'This review link is incomplete or invalid. Ask the author for a new link.'
        : handoff && !shareableDraft
          ? 'This draft is no longer available for review. Ask the author for a new link.'
          : handoff &&
              (handoff.revision !== current.revision ||
                handoff.draftVersionId !==
                  current.draftVersionId?.toLowerCase())
            ? 'This review link is for a different draft or revision. Ask the author for a new link.'
            : null;
    const shareUrl = new URL(
      organizationPath(`/programs/${programId}/controls/${controlId}`),
      window.location.origin
    );
    shareUrl.searchParams.set('review_revision', String(current.revision));
    shareUrl.searchParams.set(
      'review_draft_version',
      current.draftVersionId ?? ''
    );
    shareUrl.hash = 'control-review-heading';
    const review = acceptedReview(
      decisions,
      current.revision,
      preview?.targetId ?? null
    );
    const subject = pendingRetirement
      ? 'retirement proposal'
      : approved
        ? 'successor draft'
        : 'draft';
    lifecycleBody = (
      <>
        {!readsReady ? <Spinner label="Loading approval status" /> : null}
        {handoffWarning ? <p role="alert">{handoffWarning}</p> : null}
        <p className="control-lifecycle-state" role="status">
          {retired
            ? `Retired${approved?.effectiveUntil ? ` effective ${approved.effectiveUntil}` : ''}. History is kept.`
            : pendingRetirement
              ? 'A retirement is proposed and awaits review and approval.'
              : approved === null
                ? 'Draft awaiting review and approval. It is not in effect yet.'
                : openDraft
                  ? `Revision ${approved.revision} is in effect; a successor draft awaits review and approval.`
                  : `Revision ${approved.revision} is approved and effective from ${approved.effectiveFrom}.`}
        </p>
        {openDraft ? editCard : null}
        {applicabilityCard}
        {preview ? (
          <ImpactPreviewPanel
            preview={preview}
            onRefresh={() => lifecycle.refresh()}
          />
        ) : null}
        {openDraft || pendingRetirement ? (
          <Card>
            <CardHeader>
              <CardTitle>Review and approval</CardTitle>
              <CardDescription>
                Reviews and approvals are recorded only by a signed-in person
                here, never by an agent. Each cites this exact revision, and the
                author cannot decide their own proposal without a scoped waiver.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="md">
                <section aria-labelledby="control-review-heading">
                  <h3 id="control-review-heading">Review the {subject}</h3>
                  {shareableDraft && readsReady && !handoffWarning ? (
                    <p>
                      <a href={shareUrl.href}>
                        Share revision {current.revision} for review
                      </a>
                      . Share this link with a reviewer who already has access.
                      After editing the draft, share a new link.
                    </p>
                  ) : null}
                  {handoff && readsReady && !handoffWarning ? (
                    <p>
                      This link is for revision {handoff.revision} of this
                      draft.
                    </p>
                  ) : null}
                  {draftReady ? (
                    <p>
                      If a reviewer or approver needs an exception for this
                      exact draft, <a href={organizationPath(`/programs/${programId}/controls/${controlId}/exceptions`)}>record or review a scoped exception</a> and have a different administrator approve it.
                    </p>
                  ) : null}
                  {(draftReady || pendingRetirement) && !handoffWarning ? (
                    <ReviewForm
                      programId={programId}
                      controlId={controlId}
                      revision={handoff ? handoff.revision : current.revision}
                      subject={subject}
                      disabled={!readsReady}
                      onDecided={changed}
                    />
                  ) : null}
                </section>
                <section aria-labelledby="control-decide-heading">
                  <h3 id="control-decide-heading">
                    {pendingRetirement ? 'Approve retirement' : 'Approve'}
                  </h3>
                  {pendingRetirement && preview ? (
                    <RetireForm
                      programId={programId}
                      controlId={controlId}
                      revision={current.revision}
                      review={review}
                      preview={preview}
                      onDecided={changed}
                    />
                  ) : (
                    <ApproveForm
                      programId={programId}
                      controlId={controlId}
                      revision={current.revision}
                      ownerResolution={current.ownerResolution}
                      review={review}
                      preview={preview}
                      onDecided={changed}
                    />
                  )}
                </section>
              </Stack>
            </CardContent>
          </Card>
        ) : null}
        {approved && !retired && !preview ? (
          <Card>
            <CardHeader>
              <CardTitle>Change or retire this control</CardTitle>
              <CardDescription>
                Approved versions never change. Propose a successor to revise
                it, or propose retirement to end future use.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="md">
                <section aria-labelledby="control-successor-heading">
                  <h3 id="control-successor-heading">Propose a successor</h3>
                  <SuccessorForm
                    programId={programId}
                    controlId={controlId}
                    current={approved}
                    onProposed={changed}
                  />
                </section>
                <section aria-labelledby="control-retirement-heading">
                  <h3 id="control-retirement-heading">Propose retirement</h3>
                  <RetirementProposalForm
                    programId={programId}
                    controlId={controlId}
                    current={approved}
                    onProposed={changed}
                  />
                </section>
              </Stack>
            </CardContent>
          </Card>
        ) : null}
        <VersionsCard
          programId={programId}
          controlId={controlId}
          versions={versions}
          decisions={decisions}
        />
        <ControlMappingsCard
          programId={programId}
          controlId={controlId}
          currentVersionId={retired ? null : (approved?.versionId ?? null)}
        />
      </>
    );
  }

  return (
    <Page>
      <PageHeader
        title={`${current.identifier} ${current.content.title}`}
        description={`Status: ${current.status.replaceAll('_', ' ')} · revision ${current.revision} · last changed by ${current.lastChangedBy} on ${new Date(current.lastChangedAt).toLocaleDateString()}`}
      />
      <Stack gap="md">
        {back}
        {lifecycleBody}
        <ControlOwnerPersonCard
          programId={programId}
          controlId={controlId}
          revision={current.revision}
          draftVersionId={current.draftVersionId}
          refreshVersion={ownerVersion()}
          detailPending={control.pending}
          onSaved={() => setVersion(version() + 1)}
          onReload={changed}
        />
        <Card>
          <CardHeader>
            <CardTitle>Draft history</CardTitle>
          </CardHeader>
          <CardContent>
            {history.pending && !history.value ? (
              <Spinner label="Loading history" />
            ) : history.error ? (
              <Stack gap="sm">
                <p role="alert">{history.error.message}</p>
                <Button variant="secondary" onPress={() => history.refresh()}>
                  Try again
                </Button>
              </Stack>
            ) : (
              <ol className="plain-list control-history">
                {(history.value ?? []).map((revision) => (
                  <li>
                    <strong>Revision {revision.revision}</strong> by{' '}
                    {revision.actor} on{' '}
                    {new Date(revision.changedAt).toLocaleDateString()} ·{' '}
                    {revision.content.title} ·{' '}
                    {revision.content.expectedEvidence.length} expected evidence
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Page>
  );
}
