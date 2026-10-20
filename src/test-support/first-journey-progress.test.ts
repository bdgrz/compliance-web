import { describe, expect, it } from 'vitest';

import {
  createJourneyProgressEvent,
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
});
