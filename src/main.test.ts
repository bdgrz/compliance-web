// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.doUnmock('@askrjs/auth/oidc');
  vi.doUnmock('@askrjs/askr/boot');
  vi.doUnmock('./pages/_routes.js');
  vi.resetModules();
});

it('ShouldWaitToStartTheSpaGivenAPendingOidcContinuation', async () => {
  // Arrange
  vi.resetModules();
  window.sessionStorage.clear();
  window.history.replaceState(
    null,
    '',
    '/auth/callback?code=returned-code&state=saved-state'
  );
  const returnPath = '/controls?state=open#current';
  window.sessionStorage.setItem(
    'bdgrz.compliance.auth.request',
    JSON.stringify({
      request: {
        state: 'saved-state',
        nonce: 'saved-nonce',
        codeVerifier: 'saved-pkce-verifier',
      },
      returnPath,
    })
  );
  const pageRegistry = { test: 'page registry' };
  let locationAtStartup: string | undefined;
  const createSPA = vi.fn(async () => {
    locationAtStartup =
      window.location.pathname + window.location.search + window.location.hash;
  });
  vi.doMock('@askrjs/askr/boot', () => ({ createSPA }));
  vi.doMock('./pages/_routes.js', () => ({ pageRegistry }));
  vi.doMock('@askrjs/auth/oidc', () => ({
    createOidcClient: () => ({
      exchangeCode: async () => ({
        tokens: { access_token: 'exchanged-access-token', expires_in: 300 },
        principal: { id: 'provider-user', subject: 'provider-subject' },
      }),
    }),
  }));
  let acceptContinuation!: (response: Response) => void;
  const continuation = new Promise<Response>((resolve) => {
    acceptContinuation = resolve;
  });
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        enabled: true,
        developer_identity_enabled: false,
        issuer: 'https://provider.example.test',
        client_id: 'configured-web-client',
        scopes: ['openid', 'email'],
        authorization_audience: 'https://compliance-api.example.test',
      })
    )
    .mockReturnValueOnce(continuation);
  vi.stubGlobal('fetch', fetchMock);

  // Act: load the real entry point while its real callback awaits the backend.
  const startup = import('./main.js');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  // Assert: acquiring the provider token alone cannot start the SPA.
  expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/oidc-user-sessions');
  expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
  expect(
    new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')
  ).toBe('Bearer exchanged-access-token');
  expect(window.location.pathname).toBe('/auth/callback');
  expect(createSPA).not.toHaveBeenCalled();

  // Act
  acceptContinuation(Response.json({}));
  await startup;

  // Assert: startup observes the completed continuation and restored app path.
  expect(createSPA).toHaveBeenCalledExactlyOnceWith({
    root: '#app',
    registry: pageRegistry,
  });
  expect(locationAtStartup).toBe(returnPath);
});
