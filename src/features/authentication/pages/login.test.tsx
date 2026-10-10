// @vitest-environment jsdom
import { render } from '@askrjs/askr/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { beginSignIn, completeOidcCallbackIfPresent } from '../auth.js';
import { LoginPage } from './login.js';

vi.mock('../auth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth.js')>()),
  beginSignIn: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

it('ShouldDisplayTheFailureAndAllowRetryGivenACancelledSignIn', async () => {
  // Arrange
  window.history.replaceState(
    null,
    '',
    '/auth/callback?error=access_denied&error_description=Sign-in+was+cancelled.'
  );
  await completeOidcCallbackIfPresent();

  // Act
  const result = render(LoginPage);
  try {
    // Assert: the page reads the real callback error and consumes it from storage.
    expect(window.location.pathname).toBe('/login');
    expect(result.container.querySelector('[role="alert"]')?.textContent).toBe(
      'Sign-in was cancelled.'
    );
    expect(window.sessionStorage.getItem('bdgrz.compliance.auth.error')).toBeNull();
    const action = [...result.container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Continue to sign in')
    );
    expect(action).toBeDefined();
    expect(action!.disabled).toBe(false);
    expect(beginSignIn).not.toHaveBeenCalled();

    // Act
    action!.click();

    // Assert
    expect(beginSignIn).toHaveBeenCalledExactlyOnceWith('/');
  } finally {
    result.cleanup();
  }
});

it('ShouldStartSignInWithTheRequestedReturnPathGivenTheLoginAction', () => {
  // Arrange
  const next = '/controls?state=open#current';
  window.history.replaceState(
    null,
    '',
    `/login?${new URLSearchParams({ next })}`
  );
  const result = render(LoginPage);
  try {
    const action = [...result.container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('Continue to sign in')
    );
    expect(action).toBeDefined();
    expect(beginSignIn).not.toHaveBeenCalled();

    // Act
    action!.click();

    // Assert
    expect(beginSignIn).toHaveBeenCalledExactlyOnceWith(next);
  } finally {
    result.cleanup();
  }
});
