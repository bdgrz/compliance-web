import { describe, expect, it } from 'vitest';

import {
  createJourneyProgressEvent,
  summarizeTenantReadinessResponse,
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

    const event = createJourneyProgressEvent(
      'founder organization provisioning status checked',
      'http://127.0.0.1:5173/organizations/new',
      [
        'Your organization has been created and is still getting ready. Check status in a moment.',
      ],
      { readinessResponses: [resolution!, provisioning!] }
    );
    expect(event).toEqual({
      step: 'founder organization provisioning status checked',
      path: '/organizations/new',
      visibleText: [
        'Your organization has been created and is still getting ready. Check status in a moment.',
      ],
      readinessResponses: [resolution, provisioning],
    });
    expect(JSON.stringify(event)).not.toMatch(
      /private-slug|private-tenant-id|secret/
    );
  });
});
