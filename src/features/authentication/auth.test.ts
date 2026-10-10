// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
