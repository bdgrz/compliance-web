export type MailboxConsumeRequestInput =
  | {
      delivery: 'tenant_invitation';
      email: string;
      tenantId: string;
    }
  | {
      delivery: 'email_verification' | 'email_recovery';
      email: string;
      userId: string;
    };

export type MailboxConsumeRequest =
  | {
      op: 'consume';
      delivery: 'tenant_invitation';
      email: string;
      tenant_id: string;
      timeout_ms: 30_000;
    }
  | {
      op: 'consume';
      delivery: 'email_verification' | 'email_recovery';
      email: string;
      user_id: string;
      timeout_ms: 30_000;
    };

export function createMailboxConsumeRequest(
  input: MailboxConsumeRequestInput
): MailboxConsumeRequest {
  const scopeId =
    input.delivery === 'tenant_invitation' ? input.tenantId : input.userId;
  if (!scopeId.trim()) {
    throw new Error('Mailbox consume scope is required.');
  }

  if (input.delivery === 'tenant_invitation') {
    return {
      op: 'consume',
      delivery: input.delivery,
      email: input.email,
      tenant_id: input.tenantId,
      timeout_ms: 30_000,
    };
  }

  return {
    op: 'consume',
    delivery: input.delivery,
    email: input.email,
    user_id: input.userId,
    timeout_ms: 30_000,
  };
}
