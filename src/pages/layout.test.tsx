// @vitest-environment jsdom
import { render } from '@askrjs/askr/testing';
import { afterEach, expect, it, vi } from 'vitest';

import { accessibilityViolations } from '../accessibility/axe.js';
import { signOut } from '../features/authentication/auth.js';
import { PageLayout } from './_layout.js';

vi.mock('../features/authentication/auth.js', () => ({
  signOut: vi.fn(),
}));

vi.mock('@askrjs/askr/router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  currentRoute: () => ({ path: '/organizations' }),
  currentAuth: () => ({ authenticated: true }),
}));

afterEach(() => {
  vi.resetAllMocks();
});

it('ShouldNameSignOutGivenHiddenNarrowViewportText', async () => {
  // Arrange
  const result = render(() => (
    <PageLayout>
      <main>Choose an organization</main>
    </PageLayout>
  ));
  try {
    const button = [...result.container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Sign out')
    )!;
    const text = button.querySelector('span')!;

    // Act: reproduce the narrow viewport's hidden label without relying on jsdom media queries.
    text.style.display = 'none';

    // Assert
    expect(await accessibilityViolations(button)).toEqual([]);
  } finally {
    result.cleanup();
  }
});

it.each([
  new Error('The app could not confirm sign-out.'),
  new TypeError('Network unavailable'),
])('ShouldOfferAccessibleRetryWithoutDuplicateRequestsGivenLogoutFailure%j', async (failure) => {
  // Arrange
  let reject!: (failure: Error) => void;
  let confirm!: () => void;
  const signOutMock = vi.mocked(signOut)
    .mockReturnValueOnce(new Promise<void>((_resolve, rejectRequest) => { reject = rejectRequest; }))
    .mockReturnValueOnce(new Promise<void>((resolve) => { confirm = resolve; }));
  const result = render(() => (
    <PageLayout>
      <main>Your workspace</main>
    </PageLayout>
  ));
  const button = () => result.container.querySelector<HTMLButtonElement>('button[aria-label="Sign out"]')!;
  try {
    // Act: two presses in the same turn must still start only one request.
    button().click();
    button().click();

    // Assert
    expect(signOutMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(button().disabled).toBe(true));
    expect(result.container.querySelector('[role="alert"]')).toBeNull();

    // Act
    reject(failure);

    // Assert: failure is announced and the same action can be retried.
    await vi.waitFor(() => expect(button().disabled).toBe(false));
    const error = result.container.querySelector('[role="alert"]');
    expect(error?.textContent).toMatch(/could not.*sign.out.*try again/i);
    expect(await accessibilityViolations(result.container)).toEqual([]);

    // Act
    button().click();
    button().click();

    // Assert
    expect(signOutMock).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(button().disabled).toBe(true));
    expect(result.container.querySelector('[role="alert"]')).toBeNull();

    // Act
    confirm();

    // Assert: successful retry leaves no error and completes the action.
    await vi.waitFor(() => expect(button().disabled).toBe(false));
    expect(result.container.querySelector('[role="alert"]')).toBeNull();
    expect(signOutMock).toHaveBeenCalledTimes(2);
  } finally {
    result.cleanup();
  }
});
