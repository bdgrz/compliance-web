import { vi } from 'vitest';

type Reply = { status: number; body?: unknown };

const NativeRequest = globalThis.Request;
// The typed client builds requests from same-origin paths, which browsers resolve against the
// page and Node's Request does not; resolve them against a test origin.
class SameOriginRequest extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === 'string' ? new URL(input, 'http://app.test') : input, init);
  }
}

// Stubs the browser API for the typed client: replies by path, 404 otherwise, and records every
// requested path so tests can assert what reached the server.
export function stubApi() {
  const replies = new Map<string, Reply>();
  const requested: string[] = [];
  const requestUrls: { method: string; url: string }[] = [];
  const bodies: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal('Request', SameOriginRequest);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), 'http://app.test');
    const method = (request?.method ?? init?.method ?? 'GET').toUpperCase();
    requested.push(url.pathname);
    requestUrls.push({ method, url: url.toString() });
    const text = request ? await request.clone().text() : typeof init?.body === 'string' ? init.body : '';
    bodies.push({ method, path: url.pathname, body: text ? JSON.parse(text) : undefined });
    const prefix = [...replies.entries()].find(
      ([key]) => key.endsWith('*') && `${method} ${url.pathname}`.startsWith(key.slice(0, -1))
    )?.[1];
    const queryReply = [...replies.entries()].find(([key]) => {
      const separator = key.indexOf(' ');
      if (separator < 0 || key.slice(0, separator) !== method) return false;
      const expected = key.slice(separator + 1);
      if (!expected.includes('?') || expected.endsWith('*')) return false;
      const expectedUrl = new URL(expected, 'http://app.test');
      return expectedUrl.pathname === url.pathname &&
        [...expectedUrl.searchParams].every(([name, value]) => url.searchParams.get(name) === value);
    })?.[1];
    const match =
      queryReply ?? replies.get(`${method} ${url.pathname}`) ?? replies.get(url.pathname) ?? prefix ?? { status: 404 };
    return new Response(match.body === undefined ? null : JSON.stringify(match.body), {
      status: match.status,
      headers: {
        'Content-Type': match.status < 300 ? 'application/json' : 'application/problem+json',
      },
    });
  });

  return {
    requested,
    requestUrls,
    bodies,
    // `path` may include a method and query, e.g. 'GET /api/v1/...?...', to answer one request;
    // a method-prefixed key ending in '*' answers every path that starts with it.
    reply(path: string, status: number, body?: unknown) {
      replies.set(path, { status, body });
    },
  };
}
