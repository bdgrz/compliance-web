import { describe, expect, it } from 'vitest';

import {
  createJourneyBreadcrumb,
  type JourneyStepName,
} from './first-journey-breadcrumbs.js';

describe('first-journey breadcrumbs', () => {
  it('ShouldKeepOnlyPathAndAllowlistedVisibleText', () => {
    const breadcrumb = createJourneyBreadcrumb(
      'founder email verification accepted',
      'http://127.0.0.1:5173/organizations?code=secret-code#verification',
      [
        'Your email address is verified.',
        'Create a new organization',
        'founder-private@example.com',
        'secret-code',
      ]
    );

    expect(breadcrumb).toEqual({
      step: 'founder email verification accepted',
      path: '/organizations',
      visibleText: [
        'Your email address is verified.',
        'Create a new organization',
      ],
    });
    expect(JSON.stringify(breadcrumb)).not.toContain('secret-code');
    expect(JSON.stringify(breadcrumb)).not.toContain(
      'founder-private@example.com'
    );
  });

  it('ShouldRejectAnUnapprovedStepLabel', () => {
    expect(() =>
      createJourneyBreadcrumb(
        'founder-private@example.com secret-code' as JourneyStepName,
        'http://127.0.0.1:5173/organizations',
        []
      )
    ).toThrow('The first-journey step name is not approved for logging.');
  });
});
