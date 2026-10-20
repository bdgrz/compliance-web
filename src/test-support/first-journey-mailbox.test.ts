import { describe, expect, it } from 'vitest';

import { createMailboxConsumeRequest } from './first-journey-mailbox.js';

describe('first-journey mailbox contract', () => {
  it('ShouldSendOnlyTheScopeFieldMatchingTheDelivery', () => {
    expect(
      createMailboxConsumeRequest({
        delivery: 'tenant_invitation',
        email: 'invitee@example.test',
        tenantId: '5d299961-8938-4128-82e4-d3cb7c3c57b2',
      })
    ).toEqual({
      op: 'consume',
      delivery: 'tenant_invitation',
      email: 'invitee@example.test',
      tenant_id: '5d299961-8938-4128-82e4-d3cb7c3c57b2',
      timeout_ms: 30_000,
    });

    expect(
      createMailboxConsumeRequest({
        delivery: 'email_verification',
        email: 'founder@example.test',
        userId: '4ab3ff14-d547-4d60-9614-2d74b20dd422',
      })
    ).toEqual({
      op: 'consume',
      delivery: 'email_verification',
      email: 'founder@example.test',
      user_id: '4ab3ff14-d547-4d60-9614-2d74b20dd422',
      timeout_ms: 30_000,
    });

    expect(
      createMailboxConsumeRequest({
        delivery: 'email_recovery',
        email: 'member@example.test',
        userId: '9d6c0b2e-a741-49f9-8d3b-012d725c3d3e',
      })
    ).toEqual({
      op: 'consume',
      delivery: 'email_recovery',
      email: 'member@example.test',
      user_id: '9d6c0b2e-a741-49f9-8d3b-012d725c3d3e',
      timeout_ms: 30_000,
    });
  });
});
