// @vitest-environment jsdom
import { render } from '@askrjs/askr/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { beginSignIn } from '../auth.js';
import { LoginPage } from './login.js';

vi.mock('../auth.js', () => ({
  beginSignIn: vi.fn().mockResolvedValue(undefined),
  readAuthenticationError: () => null,
}));

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
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
