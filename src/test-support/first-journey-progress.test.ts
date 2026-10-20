import { describe, expect, it } from 'vitest';

import {
  createOrganizationReadinessTimingTracker,
  createJourneyProgressEvent,
  snapshotTenantReadinessEvents,
  summarizeTenantProvisioningState,
  summarizeTenantReadinessEvents,
  summarizeTenantReadinessResponse,
  type JourneyReadinessApiEvent,
  type JourneyStepName,
} from './first-journey-progress.js';

describe('first-journey progress diagnostics', () => {
  it('ShouldKeepOnlyPathAndApprovedVisibleText', () => {
    const event = createJourneyProgressEvent(
      'founder email verification accepted',
      'http://127.0.0.1:5173/organizations?code=secret-code#verification',
      [
        'Your email address is verified.',
        'Create a new organization',
        'founder-private@example.com',
        'secret-code',
      ]
    );

    expect(event).toEqual({
      step: 'founder email verification accepted',
      path: '/organizations',
      visibleText: [
        'Your email address is verified.',
        'Create a new organization',
      ],
    });
    expect(JSON.stringify(event)).not.toContain('secret-code');
    expect(JSON.stringify(event)).not.toContain('founder-private@example.com');
  });

  it('ShouldRejectAnUnapprovedStepLabel', () => {
    expect(() =>
      createJourneyProgressEvent(
        'founder-private@example.com secret-code' as JourneyStepName,
        'http://127.0.0.1:5173/organizations',
        []
      )
    ).toThrow('The first-journey step name is not approved for logging.');
  });

  it('ShouldLogOnlySafeFormAndRegistrationStatus', () => {
    const formEvent = createJourneyProgressEvent(
      'founder organization creation form opened',
      'http://127.0.0.1:5173/organizations/new?secret=query',
      ['Create organization', 'unapproved form value'],
      {
        formValid: false,
        createButtonEnabled: false,
        createButtonType: 'submit',
      }
    );
    expect(formEvent).toEqual({
      step: 'founder organization creation form opened',
      path: '/organizations/new',
      visibleText: ['Create organization'],
      formValid: false,
      createButtonEnabled: false,
      createButtonType: 'submit',
    });

    const registrationEvent = createJourneyProgressEvent(
      'founder organization creation submitted',
      'http://127.0.0.1:5173/organizations/new',
      [],
      { registrationRouteFired: true, registrationStatus: 200 }
    );
    expect(registrationEvent).toEqual({
      step: 'founder organization creation submitted',
      path: '/organizations/new',
      visibleText: [],
      registrationRouteFired: true,
      registrationStatus: 200,
    });
    expect(JSON.stringify([formEvent, registrationEvent])).not.toContain(
      'unapproved form value'
    );
  });

  it('ShouldLogOnlyAllowlistedJourneyTimingsAndGrantCatalogState', () => {
    const event = createJourneyProgressEvent(
      'founder member grant catalog responses received',
      'http://127.0.0.1:5173/acme/members/user-id?private=query',
      ['Loading access grant options', 'private@example.com', 'one-time-code'],
      {
        elapsedMs: 12_345,
        registrationToFirstSlugResolutionMs: 1_234,
        roleCatalogStatus: 200,
        programCatalogStatus: 403,
        grantOptionsLoading: false,
        roleSelectorVisible: true,
        scopeSelectorVisible: true,
        grantOptionsRetryVisible: false,
      }
    );

    expect(event).toEqual({
      step: 'founder member grant catalog responses received',
      path: '/acme/members/user-id',
      visibleText: [],
      elapsedMs: 12_345,
      registrationToFirstSlugResolutionMs: 1_234,
      roleCatalogStatus: 200,
      programCatalogStatus: 403,
      grantOptionsLoading: false,
      roleSelectorVisible: true,
      scopeSelectorVisible: true,
      grantOptionsRetryVisible: false,
    });
    expect(JSON.stringify(event)).not.toMatch(
      /private-query|private@example\.com|one-time-code/
    );

    const invalidValues = createJourneyProgressEvent(
      'founder member grant catalog responses received',
      'http://127.0.0.1:5173/acme/members',
      [],
      {
        elapsedMs: -1,
        registrationToFirstSlugResolutionMs:
          'private-value' as unknown as number,
        roleCatalogStatus: 700,
        programCatalogStatus: 'private-id' as unknown as number,
        grantOptionsLoading: 'private-value' as unknown as boolean,
        roleSelectorVisible: true,
        scopeSelectorVisible: false,
        grantOptionsRetryVisible: false,
      }
    );
    expect(invalidValues).toEqual({
      step: 'founder member grant catalog responses received',
      path: '/acme/members',
      visibleText: [],
      roleSelectorVisible: true,
      scopeSelectorVisible: false,
      grantOptionsRetryVisible: false,
    });
    expect(JSON.stringify(invalidValues)).not.toContain('private');
  });

  it('ShouldMeasureFirstSuccessfulSlugResolutionFromRegistrationResponse', () => {
    let now = 100;
    const timing = createOrganizationReadinessTimingTracker(() => now);

    timing.recordSlugResolutionResponse(200);
    now = 200;
    timing.recordRegistrationResponse(500);
    expect(timing.registrationToFirstSlugResolutionMs()).toBeUndefined();
    now = 300;
    timing.recordRegistrationResponse(200);
    now = 450;
    timing.recordSlugResolutionResponse(404);
    expect(timing.registrationToFirstSlugResolutionMs()).toBeUndefined();
    now = 1_550;
    timing.recordSlugResolutionResponse(200);
    now = 2_000;
    timing.recordSlugResolutionResponse(200);

    expect(timing.registrationToFirstSlugResolutionMs()).toBe(1_250);
  });

  it('ShouldSummarizeReadinessResponsesWithoutKeepingRequestIdentifiers', () => {
    const resolution = summarizeTenantReadinessResponse(
      'http://127.0.0.1:5173/api/v1/tenant-slugs/private-slug/mine?code=secret',
      404
    );
    const provisioning = summarizeTenantReadinessResponse(
      'http://127.0.0.1:5173/api/v1/tenants/private-tenant-id/provisioning-status?token=secret',
      200
    );

    expect(resolution).toEqual({
      endpoint: 'tenant-slug-resolution',
      status: 404,
    });
    expect(provisioning).toEqual({
      endpoint: 'tenant-provisioning-status',
      status: 200,
    });
    expect(
      summarizeTenantReadinessResponse(
        'http://127.0.0.1:5173/api/v1/private/resource',
        200
      )
    ).toBeNull();

    const requestState = summarizeTenantReadinessEvents([
      {
        endpoint: resolution!.endpoint,
        kind: 'started',
      },
      {
        endpoint: resolution!.endpoint,
        kind: 'response',
        status: resolution!.status,
      },
      {
        endpoint: resolution!.endpoint,
        kind: 'finished',
      },
      {
        endpoint: provisioning!.endpoint,
        kind: 'started',
      },
      {
        endpoint: provisioning!.endpoint,
        kind: 'response',
        status: provisioning!.status,
      },
    ]);
    const event = createJourneyProgressEvent(
      'founder organization provisioning status checked',
      'http://127.0.0.1:5173/organizations/new',
      [
        'Your organization has been created and is still getting ready. Check status in a moment.',
      ],
      { readinessRequests: requestState }
    );
    expect(event).toEqual({
      step: 'founder organization provisioning status checked',
      path: '/organizations/new',
      visibleText: [
        'Your organization has been created and is still getting ready. Check status in a moment.',
      ],
      readinessRequests: [
        {
          endpoint: 'tenant-slug-resolution',
          started: 1,
          responseStatuses: [404],
          finished: 1,
          failed: 0,
          inFlight: 0,
        },
        {
          endpoint: 'tenant-provisioning-status',
          started: 1,
          responseStatuses: [200],
          finished: 0,
          failed: 0,
          inFlight: 1,
        },
      ],
    });
    expect(JSON.stringify(event)).not.toMatch(
      /private-slug|private-tenant-id|secret/
    );
  });

  it('ShouldDistinguishAnInFlightProvisioningRequestFromNoResponse', () => {
    expect(summarizeTenantReadinessEvents([])).toEqual([]);

    const events: JourneyReadinessApiEvent[] = [
      { endpoint: 'tenant-provisioning-status', kind: 'started' },
    ];

    expect(summarizeTenantReadinessEvents(events)).toEqual([
      {
        endpoint: 'tenant-provisioning-status',
        started: 1,
        responseStatuses: [],
        finished: 0,
        failed: 0,
        inFlight: 1,
      },
    ]);

    events.push({
      endpoint: 'tenant-provisioning-status',
      kind: 'failed',
    });
    expect(summarizeTenantReadinessEvents(events)).toEqual([
      {
        endpoint: 'tenant-provisioning-status',
        started: 1,
        responseStatuses: [],
        finished: 0,
        failed: 1,
        inFlight: 0,
      },
    ]);

    const responded = summarizeTenantReadinessEvents([
      { endpoint: 'tenant-provisioning-status', kind: 'started' },
      {
        endpoint: 'tenant-provisioning-status',
        kind: 'response',
        status: 404,
      },
      { endpoint: 'tenant-provisioning-status', kind: 'finished' },
    ]);
    expect(responded).toEqual([
      {
        endpoint: 'tenant-provisioning-status',
        started: 1,
        responseStatuses: [404],
        finished: 1,
        failed: 0,
        inFlight: 0,
      },
    ]);
  });

  it('ShouldSummarizeOnlyTheProvisioningResponseEnum', () => {
    const events = [
      { endpoint: 'tenant-provisioning-status', kind: 'started' },
      { endpoint: 'tenant-provisioning-status', kind: 'response', status: 200 },
      {
        endpoint: 'tenant-provisioning-status',
        kind: 'provisioning-state',
        state: 'completed',
      },
      { endpoint: 'tenant-provisioning-status', kind: 'finished' },
    ] satisfies JourneyReadinessApiEvent[];

    expect(summarizeTenantReadinessEvents(events)).toEqual([
      {
        endpoint: 'tenant-provisioning-status',
        started: 1,
        responseStatuses: [200],
        provisioningStates: ['completed'],
        finished: 1,
        failed: 0,
        inFlight: 0,
      },
    ]);
  });

  it('ShouldKeepOnlyTheAllowlistedProvisioningEnumFromResponseJson', () => {
    const states = [
      summarizeTenantProvisioningState({
        tenant_id: 'private-tenant-id',
        status: 'provisioning',
        failure_code: 'private-failure-code',
      }),
      summarizeTenantProvisioningState({
        tenant_id: 'private-tenant-id',
        status: 'completed',
        failure_code: null,
      }),
      summarizeTenantProvisioningState({
        tenant_id: 'private-tenant-id',
        status: 'rejected',
        failure_code: 'private-failure-code',
      }),
      summarizeTenantProvisioningState({
        tenant_id: 'private-tenant-id',
        status: 'pending',
        failure_code: 'private-failure-code',
      }),
      summarizeTenantProvisioningState(null),
      summarizeTenantProvisioningState('completed'),
    ];

    expect(states).toEqual([
      'provisioning',
      'completed',
      'rejected',
      'unknown',
      'unknown',
      'unknown',
    ]);
    expect(JSON.stringify(states)).not.toMatch(
      /private-tenant-id|private-failure-code/
    );
  });

  it('ShouldAwaitPendingResponseBodyReadsBeforeTakingAReadinessSnapshot', async () => {
    const events: JourneyReadinessApiEvent[] = [
      { endpoint: 'tenant-provisioning-status', kind: 'started' },
      { endpoint: 'tenant-provisioning-status', kind: 'response', status: 200 },
    ];
    const pendingBodyReads = new Set<Promise<void>>();
    let finishBodyRead!: () => void;
    let pendingBodyRead: Promise<void>;
    pendingBodyRead = new Promise<void>((resolve) => {
      finishBodyRead = resolve;
    })
      .then(() => {
        events.push({
          endpoint: 'tenant-provisioning-status',
          kind: 'provisioning-state',
          state: 'completed',
        });
      })
      .finally(() => pendingBodyReads.delete(pendingBodyRead));
    pendingBodyReads.add(pendingBodyRead);

    const snapshot = snapshotTenantReadinessEvents(events, pendingBodyReads);
    let settled = false;
    void snapshot.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishBodyRead();
    await expect(snapshot).resolves.toEqual([
      {
        endpoint: 'tenant-provisioning-status',
        started: 1,
        responseStatuses: [200],
        provisioningStates: ['completed'],
        finished: 0,
        failed: 0,
        inFlight: 1,
      },
    ]);
  });
});
