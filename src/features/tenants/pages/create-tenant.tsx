import { state } from '@askrjs/askr';
import {
  Block,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Page,
  PageHeader,
  Stack,
} from '@askrjs/themes/components';

import {
  checkRegisteredTenantReadiness,
  registerTenant,
  type RegisteredTenant,
  slugPattern,
  TenantRequestError,
} from '../tenants.js';

export function CreateTenantPage() {
  const [name, setName] = state('');
  const [legalName, setLegalName] = state('');
  const [slug, setSlug] = state('');
  const [error, setError] = state<string | null>(null);
  const [phase, setPhase] = state<
    | 'form'
    | 'creating'
    | 'checking'
    | 'pending'
    | 'failed'
    | 'rejected'
    | 'opening'
  >('form');
  const [accepted, setAccepted] = state(false);
  // Keep the response and synchronous action guard stable across component rerenders.
  const [registration] = state<{
    tenant: RegisteredTenant | null;
    busy: boolean;
  }>({ tenant: null, busy: false });

  async function confirmReadiness() {
    setError(null);
    setPhase('checking');
    const tenant = registration().tenant;
    const readiness = tenant
      ? await checkRegisteredTenantReadiness(tenant)
      : {
          kind: 'failed' as const,
          message:
            'Your organization has been created, but we could not confirm its address. Please contact support.',
        };
    if (readiness.kind === 'ready' && tenant) {
      setPhase('opening');
      window.location.assign(`/${tenant.slug}`);
    } else if (readiness.kind === 'rejected') {
      setPhase('rejected');
      setError(readiness.message);
    } else {
      setPhase(readiness.kind === 'pending' ? 'pending' : 'failed');
      if (readiness.kind === 'failed') setError(readiness.message);
    }
  }

  async function checkStatus() {
    if (
      registration().busy ||
      !accepted() ||
      phase() === 'opening' ||
      phase() === 'rejected'
    )
      return;
    registration().busy = true;
    try {
      await confirmReadiness();
    } finally {
      registration().busy = false;
    }
  }

  async function submit(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    if (registration().busy || accepted()) return;
    setError(null);

    if (!slugPattern.test(slug())) {
      setError(
        'The slug must be 4-63 characters, start with a letter, and contain only lowercase letters, digits, and single hyphens.'
      );
      return;
    }

    registration().busy = true;
    setPhase('creating');
    try {
      registration().tenant = await registerTenant(name(), slug(), legalName());
      setAccepted(true);
      await confirmReadiness();
    } catch (failure) {
      setError(
        failure instanceof TenantRequestError && failure.status === 403
          ? `${failure.message} Creating an organization requires a verified email address you own.`
          : failure instanceof Error
            ? failure.message
            : 'Unable to create the organization.'
      );
      setPhase(accepted() ? 'failed' : 'form');
    } finally {
      registration().busy = false;
    }
  }

  return (
    <Page background="muted" center>
      <Block as="section" align="center" justify="center" grow>
        <Block width="full" maxWidth="sm" direction="column" gap="lg">
          <PageHeader
            title="Create your organization"
            description="Every SOC 2 program lives inside its own organization."
          />
          <Card variant="raised">
            <CardHeader>
              <CardTitle>Organization details</CardTitle>
              <CardDescription>
                You'll become the organization's first Org Admin when it is
                ready, and can invite more administrators from its Members page.
                We'll confirm it is ready before opening your workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void submit(event)}>
                <Stack gap="md">
                  <label className="registration-field">
                    <span>Name</span>
                    <input
                      type="text"
                      value={name()}
                      onInput={(event: Event) =>
                        setName((event.target as HTMLInputElement).value)
                      }
                      required
                      disabled={accepted() || phase() === 'creating'}
                    />
                  </label>
                  <label className="registration-field">
                    <span>Legal name</span>
                    <input
                      type="text"
                      value={legalName()}
                      onInput={(event: Event) =>
                        setLegalName((event.target as HTMLInputElement).value)
                      }
                      required
                      disabled={accepted() || phase() === 'creating'}
                    />
                  </label>
                  <label className="registration-field">
                    <span>Slug</span>
                    <input
                      type="text"
                      value={slug()}
                      onInput={(event: Event) =>
                        setSlug((event.target as HTMLInputElement).value)
                      }
                      required
                      disabled={accepted() || phase() === 'creating'}
                    />
                    <small>Used in your organization's web address.</small>
                  </label>
                  {phase() === 'creating' || accepted() ? (
                    <p role="status">
                      {phase() === 'creating'
                        ? 'Creating your organization…'
                        : phase() === 'checking'
                          ? 'Your organization has been created. Checking that your workspace is ready…'
                          : phase() === 'opening'
                            ? 'Your organization is ready. Opening your workspace…'
                            : phase() === 'pending'
                              ? 'Your organization has been created and is still getting ready. Check status in a moment.'
                              : phase() === 'rejected'
                                ? 'Your organization address could not be reserved.'
                                : 'Your organization has been created. Your workspace readiness still needs confirmation.'}
                    </p>
                  ) : null}
                  {error() ? <p role="alert">{error()}</p> : null}
                  {accepted() ? (
                    phase() === 'rejected' ? null : (
                      <Button
                        variant="primary"
                        width="full"
                        type="button"
                        onPress={() => void checkStatus()}
                        disabled={phase() === 'checking' || phase() === 'opening'}
                      >
                        {phase() === 'checking'
                          ? 'Checking status…'
                          : 'Check status'}
                      </Button>
                    )
                  ) : (
                    <Button
                      variant="primary"
                      width="full"
                      type="submit"
                      disabled={phase() === 'creating'}
                    >
                      {phase() === 'creating'
                        ? 'Creating…'
                        : 'Create organization'}
                    </Button>
                  )}
                </Stack>
              </form>
            </CardContent>
          </Card>
        </Block>
      </Block>
    </Page>
  );
}
