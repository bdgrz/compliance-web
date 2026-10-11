import { state } from '@askrjs/askr';
import { currentAuth } from '@askrjs/askr/router';
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

import { createApiClient } from '../../../api-client/index.js';
import { EmailVerificationForm } from '../../authentication/email-verification.js';

const client = createApiClient();
const unavailable = 'The invitation request could not be completed. Try again.';

export function AcceptInvitationPage({
  userId,
}: { userId?: string | null } = {}) {
  const viewer =
    userId === undefined ? (currentAuth().principal?.id ?? null) : userId;
  const [tenantId, setTenantId] = state('');
  const [email, setEmail] = state('');
  const [code, setCode] = state('');
  const [busy, setBusy] = state(false);
  const [accepted, setAccepted] = state(false);
  const [error, setError] = state<string | null>(null);
  // Guard synchronously, including duplicate submit events before the disabled button renders.
  const [submission] = state({ busy: false });

  async function submit(event: Event) {
    event.preventDefault();
    if (submission().busy || accepted()) return;
    submission().busy = true;
    setBusy(true);
    setError(null);
    try {
      const result = await client.acceptTenantInvitation({
        params: { tenant_id: tenantId().trim() },
        body: { email_address: email().trim(), token: code().trim() },
      });
      if (result.ok) {
        setCode('');
        setAccepted(true);
      } else {
        setError(
          result.status === 403
            ? 'Verify the invited email address on this signed-in account, then try again.'
            : result.status === 400
              ? 'Check the organization ID, invited email address, and invitation code, then try again.'
              : result.status === 404 || result.status === 409
                ? 'This invitation could not be accepted. It may have expired or been replaced. Ask the inviter for the current invitation, then try again.'
                : unavailable
        );
      }
    } catch {
      setError(unavailable);
    } finally {
      submission().busy = false;
      setBusy(false);
    }
  }

  return (
    <Page background="muted" center>
      <Block as="section" align="center" justify="center" grow>
        <Block width="full" maxWidth="sm" direction="column" gap="lg">
          <PageHeader
            title="Accept an organization invitation"
            description="Use the organization ID, email address, and invitation code from your invitation."
          />
          <Card variant="raised">
            <CardHeader>
              <CardTitle>Invitation details</CardTitle>
              <CardDescription>
                The invited email address must be verified on your signed-in
                account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                method="post"
                autoComplete="off"
                onSubmit={(event: Event) => void submit(event)}
              >
                <Stack gap="md">
                  <label className="registration-field">
                    <span>Organization ID</span>
                    <input
                      type="text"
                      name="tenant_id"
                      required
                      title="Enter the organization UUID from your invitation."
                      value={tenantId()}
                      disabled={busy() || accepted()}
                      onInput={(event: Event) =>
                        setTenantId((event.target as HTMLInputElement).value)
                      }
                    />
                  </label>
                  <label className="registration-field">
                    <span>Invited email address</span>
                    <input
                      type="email"
                      name="email_address"
                      required
                      value={email()}
                      disabled={busy() || accepted()}
                      onInput={(event: Event) =>
                        setEmail((event.target as HTMLInputElement).value)
                      }
                    />
                  </label>
                  <label className="registration-field">
                    <span>Invitation code</span>
                    <input
                      type="password"
                      name="token"
                      required
                      autoComplete="off"
                      value={code()}
                      disabled={busy() || accepted()}
                      aria-describedby={
                        error() ? 'invitation-acceptance-error' : undefined
                      }
                      onInput={(event: Event) =>
                        setCode((event.target as HTMLInputElement).value)
                      }
                    />
                  </label>
                  {error() ? (
                    <p id="invitation-acceptance-error" role="alert">
                      {error()}
                    </p>
                  ) : null}
                  {accepted() ? (
                    <p role="status">
                      Your invitation acceptance was received. Organization
                      access may take a moment to update. Check your
                      organizations for current access.
                    </p>
                  ) : (
                    <Button type="submit" disabled={busy()}>
                      {busy() ? 'Accepting…' : 'Accept invitation'}
                    </Button>
                  )}
                  <Button asChild variant="secondary" width="full">
                    <a href="/organizations">Check your organizations</a>
                  </Button>
                </Stack>
              </form>
            </CardContent>
          </Card>
          {!accepted() && viewer ? (
            <Card>
              <CardHeader>
                <CardTitle>Verify the invited email address</CardTitle>
                <CardDescription>
                  If you have not verified this address yet, verify it here,
                  then accept the invitation above. You can verify it even if
                  another address is already verified.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <EmailVerificationForm
                  userId={viewer}
                  onVerified={() => setError(null)}
                />
              </CardContent>
            </Card>
          ) : null}
        </Block>
      </Block>
    </Page>
  );
}
