// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubApi } from '../../test-support/api-stub.js';
import {
  normalizeReturnPath,
  parseAuthenticationConfiguration,
} from './auth.js';

describe('authentication foundation', () => {
  it('accepts same-origin return paths', () => {
    expect(
      normalizeReturnPath(
        '/controls?state=open#current',
        'https://example.test'
      )
    ).toBe('/controls?state=open#current');
  });

  it('rejects external and callback return paths', () => {
    expect(
      normalizeReturnPath('https://attacker.test/', 'https://example.test')
    ).toBe('/');
    expect(
      normalizeReturnPath('/auth/callback?code=secret', 'https://example.test')
    ).toBe('/');
  });

  it('rejects incomplete external provider configuration', () => {
    expect(() =>
      parseAuthenticationConfiguration({
        enabled: true,
        developer_identity_enabled: false,
        scopes: [],
      })
    ).toThrow(/incomplete/);
  });

  it('accepts explicit development registration configuration', () => {
    expect(
      parseAuthenticationConfiguration({
        enabled: false,
        developer_identity_enabled: true,
      })
    ).toEqual({
      enabled: false,
      developer_identity_enabled: true,
      issuer: null,
      client_id: null,
      scopes: [],
      authorization_audience: null,
    });
  });
});

describe('confirmed sign-out', () => {
  const sessionKey = 'bdgrz.compliance.auth.session';
  const providerSession = JSON.stringify({
    accessToken: 'provider-token',
    expiresAt: Date.now() + 60_000,
    principal: { id: 'provider-user', roles: ['provider-admin'] },
    scopes: ['provider-admin'],
  });
  const tenant = { tenantId: 'tenant-acme', slug: 'acme', name: 'Acme' };
  let auth: typeof import('./auth.js');
  let tenants: typeof import('../tenants/tenants.js');
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    window.sessionStorage.clear();
    window.localStorage.clear();
    const api = stubApi();
    api.reply('/api/v1/tenant-slugs/acme/mine', 200, {
      tenant_id: tenant.tenantId,
      current_slug: tenant.slug,
      redirect: false,
    });
    api.reply('/api/v1/tenants/mine', 200, {
      items: [{ tenant_id: tenant.tenantId, slug: tenant.slug, name: tenant.name }],
      next_cursor: null,
    });
    auth = await import('./auth.js');
    tenants = await import('../tenants/tenants.js');
    await expect(
      tenants.resolveTenantRoute('acme', { pathname: '/acme', search: '', hash: '' })
    ).resolves.toEqual({ kind: 'ready', tenant });
    window.sessionStorage.setItem(sessionKey, providerSession);
    assign = vi.fn();
    vi.stubGlobal('window', {
      sessionStorage: window.sessionStorage,
      localStorage: window.localStorage,
      location: { assign },
    });
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    tenants.clearActiveTenant();
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function expectSessionPreserved() {
    expect(window.sessionStorage.getItem(sessionKey)).toBe(providerSession);
    expect(tenants.currentTenant()).toEqual(tenant);
    expect(tenants.readRememberedSlug()).toBe('acme');
    expect(assign).not.toHaveBeenCalled();
  }

  it.each([400, 401, 403, 500, 503])(
    'ShouldPreserveSessionAndRejectGivenLogoutHttpFailure%s',
    async (status) => {
      // Arrange
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));

      // Act
      const logout = auth.signOut();

      // Assert
      await expect(logout).rejects.toThrow(/sign.out/i);
      expectSessionPreserved();
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/auth/logout', { method: 'POST' });
    }
  );

  it('ShouldPreserveSessionAndRejectGivenLogoutNetworkFailure', async () => {
    // Arrange
    const failure = new TypeError('Network unavailable');
    fetchMock.mockRejectedValueOnce(failure);

    // Act
    const logout = auth.signOut();

    // Assert
    await expect(logout).rejects.toBe(failure);
    expectSessionPreserved();
  });

  it('ShouldWaitForServerConfirmationBeforeClearingSessionAndNavigating', async () => {
    // Arrange
    let confirm!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { confirm = resolve; }));

    // Act
    const logout = auth.signOut();

    // Assert: a pending request cannot claim success or erase retry state.
    expectSessionPreserved();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/auth/logout', { method: 'POST' });

    // Act
    confirm(new Response(null, { status: 204 }));
    await logout;

    // Assert
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull();
    expect(tenants.currentTenant()).toBeNull();
    expect(tenants.readRememberedSlug()).toBeNull();
    expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
  });
});

describe('canonical browser authentication', () => {
  const sessionKey = 'bdgrz.compliance.auth.session';
  const canonicalSession = {
    id: 'canonical-user',
    email_address: 'canonical@example.test',
    email_address_verified: true,
  };
  const providerPrincipal = {
    id: 'provider-user',
    subject: 'provider-subject',
    email: 'provider@example.test',
    roles: ['provider-admin'],
  };
  let auth: typeof import('./auth.js');
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    vi.resetModules();
    window.sessionStorage.clear();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    auth = await import('./auth.js');
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  function configureAuthentication(enabled = true) {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        enabled
          ? {
              enabled: true,
              developer_identity_enabled: false,
              issuer: 'https://provider.example.test',
              client_id: 'compliance-web',
              scopes: ['openid', 'provider-admin'],
              authorization_audience: null,
            }
          : { enabled: false, developer_identity_enabled: true }
      )
    );
  }

  function cacheProviderSession(expiresAt = Date.now() + 60_000) {
    window.sessionStorage.setItem(
      sessionKey,
      JSON.stringify({
        accessToken: 'provider-token',
        expiresAt,
        principal: providerPrincipal,
        scopes: ['provider-admin'],
      })
    );
  }

  it('ShouldUseCanonicalIdentityGivenADifferentCachedProviderPrincipal', async () => {
    // Arrange
    configureAuthentication();
    cacheProviderSession();
    fetchMock.mockResolvedValueOnce(Response.json(canonicalSession));

    // Act
    const context = await auth.resolveBrowserAuthentication();

    // Assert
    expect(context).toEqual({
      authenticated: true,
      principal: {
        id: canonicalSession.id,
        subject: canonicalSession.id,
        email: canonicalSession.email_address,
      },
      session: null,
      tenant: null,
      scopes: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/auth/session', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
  });

  it('ShouldAuthenticateGivenAValidCookieWithoutProviderStorage', async () => {
    // Arrange
    configureAuthentication();
    fetchMock.mockResolvedValueOnce(
      Response.json({ ...canonicalSession, email_address: null })
    );

    // Act
    const context = await auth.resolveBrowserAuthentication();

    // Assert
    expect(context.authenticated).toBe(true);
    expect(context.principal).toEqual({
      id: canonicalSession.id,
      subject: canonicalSession.id,
      email: null,
    });
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull();
  });

  it('ShouldDiscardExpiredBearerGivenAValidAppCookie', async () => {
    // Arrange
    configureAuthentication();
    cacheProviderSession(Date.now() - 1);
    fetchMock.mockResolvedValueOnce(Response.json(canonicalSession));
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));

    // Act
    const context = await auth.resolveBrowserAuthentication();
    await auth.authorizedFetch('/api/v1/tenants/mine');

    // Assert
    expect(context.authenticated).toBe(true);
    expect(context.principal?.id).toBe(canonicalSession.id);
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull();
    const request = fetchMock.mock.calls[2];
    expect(request?.[0]).toBe('/api/v1/tenants/mine');
    expect(new Headers(request?.[1]?.headers).has('Authorization')).toBe(false);
  });

  it('ShouldClearProviderStateGivenAnUnauthorizedAppSession', async () => {
    // Arrange
    configureAuthentication();
    cacheProviderSession();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    // Act
    const context = await auth.resolveBrowserAuthentication();

    // Assert
    expect(context).toEqual({
      authenticated: false,
      principal: null,
      session: null,
      tenant: null,
      scopes: [],
    });
    expect(window.sessionStorage.getItem(sessionKey)).toBeNull();
  });

  it.each([403, 500])(
    'ShouldRejectGivenAppSessionHttpFailure%s',
    async (status) => {
      // Arrange
      configureAuthentication();
      cacheProviderSession();
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));

      // Act
      const resolution = auth.resolveBrowserAuthentication();

      // Assert
      await expect(resolution).rejects.toThrow(/session is unavailable/);
    }
  );

  it('ShouldRejectGivenAnAppSessionNetworkFailure', async () => {
    // Arrange
    configureAuthentication();
    cacheProviderSession();
    const failure = new TypeError('Network unavailable');
    fetchMock.mockRejectedValueOnce(failure);

    // Act
    const resolution = auth.resolveBrowserAuthentication();

    // Assert
    await expect(resolution).rejects.toBe(failure);
  });

  it.each([null, {}, { id: 42 }, { id: '' }, { id: '   ' }])(
    'ShouldRejectGivenAMalformedCanonicalIdentity%j',
    async (session) => {
      // Arrange
      configureAuthentication();
      cacheProviderSession();
      fetchMock.mockResolvedValueOnce(Response.json(session));

      // Act
      const resolution = auth.resolveBrowserAuthentication();

      // Assert
      await expect(resolution).rejects.toThrow(/session.*invalid/);
    }
  );

  it('ShouldResolveCanonicalIdentityGivenDevelopmentAuthentication', async () => {
    // Arrange
    configureAuthentication(false);
    fetchMock.mockResolvedValueOnce(Response.json(canonicalSession));

    // Act
    const context = await auth.resolveBrowserAuthentication();

    // Assert
    expect(context).toEqual({
      authenticated: true,
      principal: {
        id: canonicalSession.id,
        subject: canonicalSession.id,
        email: canonicalSession.email_address,
      },
      session: null,
      tenant: null,
      scopes: [],
    });
  });

  it('ShouldRejectBeforeSessionResolutionGivenInvalidConfiguration', async () => {
    // Arrange
    cacheProviderSession();
    fetchMock.mockResolvedValueOnce(Response.json({ enabled: true }));

    // Act
    const resolution = auth.resolveBrowserAuthentication();

    // Assert
    await expect(resolution).rejects.toThrow(/incomplete/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/auth/config');
  });
});

describe('configured sign-in return', () => {
  const requestKey = 'bdgrz.compliance.auth.request';
  const sessionKey = 'bdgrz.compliance.auth.session';

  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.doUnmock('@askrjs/auth/oidc');
    vi.resetModules();
  });

  it.each([
    { condition: 'ASuccessfulConfiguredSignIn', confirmedLogout: false },
    { condition: 'ConfirmedLogoutAndConfiguredReSignIn', confirmedLogout: true },
  ])('ShouldReturnTheCanonicalUserGiven$condition', async ({ confirmedLogout }) => {
    // Arrange
    vi.resetModules();
    window.sessionStorage.clear();
    const storage = window.sessionStorage;
    const origin = 'https://compliance.example.test';
    let location = new URL('/login', origin);
    let requestAtNavigation: unknown;
    const assign = vi.fn((url: string) => {
      requestAtNavigation = JSON.parse(storage.getItem(requestKey) ?? 'null');
      location = new URL(url, origin);
    });
    const replaceState = vi.fn(
      (_data: unknown, _unused: string, url: string) => {
        location = new URL(url, origin);
      }
    );
    vi.stubGlobal('window', {
      location: {
        get origin() {
          return location.origin;
        },
        get pathname() {
          return location.pathname;
        },
        get search() {
          return location.search;
        },
        assign,
      },
      sessionStorage: storage,
      history: { replaceState },
    });
    const configuration = {
      enabled: true,
      developer_identity_enabled: false,
      issuer: 'https://provider.example.test',
      client_id: 'configured-web-client',
      scopes: ['openid', 'email', 'provider-admin'],
      authorization_audience: 'https://compliance-api.example.test',
    };
    const savedRequest = {
      state: 'generated-state',
      nonce: 'generated-nonce',
      codeVerifier: 'generated-pkce-verifier',
    };
    const authorizationUrl =
      'https://provider.example.test/authorize?response_type=code' +
      '&client_id=configured-web-client&scope=openid+email+provider-admin' +
      '&redirect_uri=https%3A%2F%2Fcompliance.example.test%2Fauth%2Fcallback' +
      '&state=generated-state&nonce=generated-nonce' +
      '&code_challenge=generated-pkce-challenge&code_challenge_method=S256';
    const providerPrincipal = {
      id: 'provider-user',
      subject: 'provider-subject',
      email: 'provider@example.test',
      roles: ['provider-admin'],
      tenant: { id: 'provider-tenant' },
    };
    const createAuthorizationRequest = vi.fn().mockResolvedValue({
      ...savedRequest,
      url: authorizationUrl,
    });
    const exchangeCode = vi.fn().mockResolvedValue({
      tokens: { access_token: 'exchanged-access-token', expires_in: 300 },
      principal: providerPrincipal,
    });
    const createOidcClient = vi.fn(() => ({
      createAuthorizationRequest,
      exchangeCode,
    }));
    vi.doMock('@askrjs/auth/oidc', () => ({ createOidcClient }));
    let acceptContinuation!: (response: Response) => void;
    const continuation = new Promise<Response>((resolve) => {
      acceptContinuation = resolve;
    });
    const canonicalSession = {
      id: 'canonical-user',
      email_address: 'canonical@example.test',
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(configuration));
    if (confirmedLogout) {
      storage.setItem(sessionKey, JSON.stringify({
        accessToken: 'previous-provider-token',
        expiresAt: Date.now() + 60_000,
        principal: { id: 'previous-provider-user', roles: ['provider-admin'] },
        scopes: ['provider-admin'],
      }));
      fetchMock
        .mockResolvedValueOnce(Response.json({ id: 'previous-canonical-user', email_address: null }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
    }
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockReturnValueOnce(continuation)
      .mockResolvedValueOnce(Response.json(canonicalSession));
    vi.stubGlobal('fetch', fetchMock);
    const auth = await import('./auth.js');
    const returnPath = '/controls?state=open#current';
    const logoutOffset = confirmedLogout ? 2 : 0;

    if (confirmedLogout) {
      // Act: end an existing canonical app session before starting a fresh sign-in.
      const previous = await auth.resolveBrowserAuthentication();
      await auth.signOut();

      // Assert: server confirmation removes provider state and returns to login.
      expect(previous.principal?.id).toBe('previous-canonical-user');
      expect(storage.getItem(sessionKey)).toBeNull();
      expect(assign).toHaveBeenCalledExactlyOnceWith('/login');
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/auth/logout', { method: 'POST' });
    }

    // Act: start signed out and leave for the configured provider.
    const signedOut = await auth.resolveBrowserAuthentication();
    await auth.beginSignIn(`${origin}${returnPath}`);

    // Assert: the complete handoff is already saved when navigation happens.
    expect(signedOut).toEqual({
      authenticated: false,
      principal: null,
      session: null,
      tenant: null,
      scopes: [],
    });
    expect(storage.getItem(sessionKey)).toBeNull();
    expect(createAuthorizationRequest).toHaveBeenCalledExactlyOnceWith();
    expect(createOidcClient).toHaveBeenCalledExactlyOnceWith({
      issuer: configuration.issuer,
      clientId: configuration.client_id,
      redirectUri: `${origin}/auth/callback`,
      scopes: configuration.scopes,
    });
    expect(requestAtNavigation).toEqual({ request: savedRequest, returnPath });
    const expectedAuthorizationUrl = new URL(authorizationUrl);
    expectedAuthorizationUrl.searchParams.set(
      'audience',
      configuration.authorization_audience
    );
    expect(assign).toHaveBeenCalledTimes(confirmedLogout ? 2 : 1);
    expect(assign).toHaveBeenLastCalledWith(
      expectedAuthorizationUrl.toString()
    );

    // Act: return from the provider, keeping the app continuation pending.
    location = new URL(
      '/auth/callback?code=returned-code&state=generated-state',
      origin
    );
    const callback = auth.completeOidcCallbackIfPresent();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3 + logoutOffset));

    // Assert: exchange the exact saved correlation and PKCE values, then continue
    // with the exchanged bearer before restoring the requested app location.
    expect(exchangeCode).toHaveBeenCalledExactlyOnceWith({
      code: 'returned-code',
      state: savedRequest.state,
      request: savedRequest,
    });
    expect(createOidcClient).toHaveBeenNthCalledWith(2, {
      issuer: configuration.issuer,
      clientId: configuration.client_id,
      redirectUri: `${origin}/auth/callback`,
      scopes: configuration.scopes,
    });
    expect(storage.getItem(requestKey)).toBeNull();
    const [continuationPath, continuationInit] = fetchMock.mock.calls[2 + logoutOffset]!;
    expect(continuationPath).toBe('/api/v1/oidc-user-sessions');
    expect(continuationInit?.method).toBe('POST');
    expect(continuationInit?.body).toBe('{}');
    expect(Object.fromEntries(new Headers(continuationInit?.headers))).toEqual({
      accept: 'application/json',
      authorization: 'Bearer exchanged-access-token',
      'content-type': 'application/json',
    });
    expect(replaceState).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/auth/callback');

    // Act: accept the continuation and resolve the app's cookie identity.
    acceptContinuation(Response.json({}));
    await callback;
    const context = await auth.resolveBrowserAuthentication();

    // Assert: the return path survives, and provider identity grants no app authority.
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', returnPath);
    expect(`${location.pathname}${location.search}${location.hash}`).toBe(
      returnPath
    );
    expect(context).toEqual({
      authenticated: true,
      principal: {
        id: canonicalSession.id,
        subject: canonicalSession.id,
        email: canonicalSession.email_address,
      },
      session: null,
      tenant: null,
      scopes: [],
    });
    expect(context.principal?.id).not.toBe(providerPrincipal.id);
    expect(fetchMock).toHaveBeenCalledTimes(4 + logoutOffset);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/auth/config', {
      headers: { Accept: 'application/json' },
    });
    for (const call of [2 + logoutOffset, 4 + logoutOffset]) {
      expect(fetchMock).toHaveBeenNthCalledWith(call, '/auth/session', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
    }
  });
});

describe('unsuccessful configured sign-in', () => {
  const requestKey = 'bdgrz.compliance.auth.request';
  const sessionKey = 'bdgrz.compliance.auth.session';

  afterEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.doUnmock('@askrjs/auth/oidc');
    vi.resetModules();
  });

  it.each([
    {
      condition: 'ProviderCancellation',
      failure: 'cancellation',
      search: '?error=access_denied&error_description=Sign-in+was+cancelled.',
      message: 'Sign-in was cancelled.',
    },
    {
      condition: 'RejectedCodeExchange',
      failure: 'exchange',
      search: '?code=returned-code&state=failed-state',
      message: 'The identity provider could not complete sign-in. Please retry.',
    },
    {
      condition: 'UnsuccessfulAppContinuation',
      failure: 'continuation',
      search: '?code=returned-code&state=failed-state',
      message: 'The authenticated identity could not be continued.',
    },
  ])(
    'ShouldReturnAnAnonymousRetryPathGiven$condition',
    async ({ failure, search, message }) => {
      // Arrange
      vi.resetModules();
      window.sessionStorage.clear();
      const storage = window.sessionStorage;
      const origin = 'https://compliance.example.test';
      let location = new URL('/login', origin);
      const requestsAtNavigation: unknown[] = [];
      const assign = vi.fn((url: string) => {
        requestsAtNavigation.push(
          JSON.parse(storage.getItem(requestKey) ?? 'null')
        );
        location = new URL(url);
      });
      const replaceState = vi.fn(
        (_data: unknown, _unused: string, url: string) => {
          location = new URL(url, origin);
        }
      );
      vi.stubGlobal('window', {
        location: {
          get origin() {
            return location.origin;
          },
          get pathname() {
            return location.pathname;
          },
          get search() {
            return location.search;
          },
          assign,
        },
        sessionStorage: storage,
        history: { replaceState },
      });
      const configuration = {
        enabled: true,
        developer_identity_enabled: false,
        issuer: 'https://provider.example.test',
        client_id: 'configured-web-client',
        scopes: ['openid', 'email'],
        authorization_audience: 'https://compliance-api.example.test',
      };
      const failedRequest = {
        state: 'failed-state',
        nonce: 'failed-nonce',
        codeVerifier: 'failed-pkce-verifier',
      };
      const retryRequest = {
        state: 'retry-state',
        nonce: 'retry-nonce',
        codeVerifier: 'retry-pkce-verifier',
      };
      function authorizationUrl(request: typeof failedRequest, challenge: string) {
        const url = new URL('/authorize', configuration.issuer);
        url.search = new URLSearchParams({
          response_type: 'code',
          client_id: configuration.client_id,
          redirect_uri: `${origin}/auth/callback`,
          scope: configuration.scopes.join(' '),
          state: request.state,
          nonce: request.nonce,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString();
        return url.toString();
      }
      const createAuthorizationRequest = vi
        .fn()
        .mockResolvedValueOnce({
          ...failedRequest,
          url: authorizationUrl(failedRequest, 'failed-pkce-challenge'),
        })
        .mockResolvedValueOnce({
          ...retryRequest,
          url: authorizationUrl(retryRequest, 'retry-pkce-challenge'),
        });
      const exchangeCode = vi.fn();
      if (failure === 'exchange') {
        exchangeCode.mockRejectedValueOnce(new Error(message));
      } else if (failure === 'continuation') {
        exchangeCode.mockResolvedValueOnce({
          tokens: { access_token: 'failed-provider-token', expires_in: 300 },
          principal: { id: 'provider-user', subject: 'provider-subject' },
        });
      }
      const createOidcClient = vi.fn(() => ({
        createAuthorizationRequest,
        exchangeCode,
      }));
      vi.doMock('@askrjs/auth/oidc', () => ({ createOidcClient }));
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(configuration))
        .mockResolvedValueOnce(new Response(null, { status: 401 }));
      let sessionAtContinuation: unknown;
      if (failure === 'continuation') {
        fetchMock.mockImplementationOnce(async () => {
          sessionAtContinuation = JSON.parse(storage.getItem(sessionKey) ?? 'null');
          return new Response(null, { status: 503 });
        });
      }
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
      vi.stubGlobal('fetch', fetchMock);
      const auth = await import('./auth.js');
      const anonymous = {
        authenticated: false,
        principal: null,
        session: null,
        tenant: null,
        scopes: [],
      };

      // Act: start signed out, then return from an unsuccessful provider attempt.
      const beforeSignIn = await auth.resolveBrowserAuthentication();
      await auth.beginSignIn('/controls');
      location = new URL(`/auth/callback${search}`, origin);
      await auth.completeOidcCallbackIfPresent();

      // Assert: every failure returns a useful login error without app authority.
      expect(beforeSignIn).toEqual(anonymous);
      expect(requestsAtNavigation[0]).toEqual({
        request: failedRequest,
        returnPath: '/controls',
      });
      expect(replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/login');
      expect(location.pathname).toBe('/login');
      expect(location.search).toBe('');
      expect(auth.readAuthenticationError()).toBe(message);
      expect(storage.getItem(sessionKey)).toBeNull();
      if (failure === 'cancellation') {
        expect(exchangeCode).not.toHaveBeenCalled();
      } else {
        expect(exchangeCode).toHaveBeenCalledExactlyOnceWith({
          code: 'returned-code',
          state: failedRequest.state,
          request: failedRequest,
        });
      }
      if (failure === 'continuation') {
        expect(sessionAtContinuation).toMatchObject({
          accessToken: 'failed-provider-token',
          principal: { id: 'provider-user' },
        });
        const [path, init] = fetchMock.mock.calls[2]!;
        expect(path).toBe('/api/v1/oidc-user-sessions');
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('Authorization')).toBe(
          'Bearer failed-provider-token'
        );
      }

      // Act: resolve the canonical session again, then retry from login.
      const afterFailure = await auth.resolveBrowserAuthentication();
      await auth.beginSignIn('/');

      // Assert: a canonical 401 stays anonymous, with no provider fallback or
      // continuation for cancellation/exchange rejection, and retry replaces PKCE.
      expect(afterFailure).toEqual(anonymous);
      expect(storage.getItem(sessionKey)).toBeNull();
      expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
        '/auth/config',
        '/auth/session',
        ...(failure === 'continuation' ? ['/api/v1/oidc-user-sessions'] : []),
        '/auth/session',
      ]);
      expect(fetchMock).toHaveBeenLastCalledWith('/auth/session', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      expect(createAuthorizationRequest).toHaveBeenCalledTimes(2);
      expect(requestsAtNavigation[1]).toEqual({
        request: retryRequest,
        returnPath: '/',
      });
      const storedRetry = JSON.parse(storage.getItem(requestKey) ?? 'null') as {
        request: typeof retryRequest;
        returnPath: string;
      };
      expect(storedRetry).toEqual(requestsAtNavigation[1]);
      for (const key of ['state', 'nonce', 'codeVerifier'] as const) {
        expect(storedRetry.request[key]).not.toBe(failedRequest[key]);
      }
      expect(createOidcClient).toHaveBeenLastCalledWith({
        issuer: configuration.issuer,
        clientId: configuration.client_id,
        redirectUri: `${origin}/auth/callback`,
        scopes: configuration.scopes,
      });
      const expectedRetryUrl = new URL(
        authorizationUrl(retryRequest, 'retry-pkce-challenge')
      );
      expectedRetryUrl.searchParams.set(
        'audience',
        configuration.authorization_audience
      );
      expect(assign).toHaveBeenCalledTimes(2);
      expect(assign).toHaveBeenLastCalledWith(expectedRetryUrl.toString());
    }
  );
});
