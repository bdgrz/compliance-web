import { describe, expect, it } from 'vitest';

import { playwrightConfig } from '../../playwright.config.js';

describe('first-journey browser artifact policy', () => {
  it('ShouldDisableArtifactsThatCouldPersistOneTimeEmailCodes', () => {
    expect(playwrightConfig.use?.screenshot).toBe('off');
    expect(playwrightConfig.use?.video).toBe('off');
    expect(playwrightConfig.use?.trace).toBe('off');
    expect(playwrightConfig.preserveOutput).toBe('never');
  });
});
