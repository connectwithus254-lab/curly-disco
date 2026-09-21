/**
 * Minimal HTTP test client for Fastify's inject(), handling the cookie + CSRF dance the same
 * way a browser would. Keeps integration tests readable and honest about the real protocol.
 */
import type { FastifyInstance } from 'fastify';

export interface InjectResult<T = any> {
  status: number;
  body: T;
  cookies: Record<string, string>;
}

function parseCookies(setCookie: string | string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const value of values) {
    const [pair] = value.split(';');
    const index = pair!.indexOf('=');
    if (index > 0) result[pair!.slice(0, index).trim()] = decodeURIComponent(pair!.slice(index + 1));
  }
  return result;
}

export class TestClient {
  cookies: Record<string, string> = {};

  constructor(private readonly app: FastifyInstance) {}

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async request<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<InjectResult<T>> {
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (payload !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.bs_csrf) headers['x-csrf-token'] = this.cookies.bs_csrf;

    const response = await this.app.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers,
    });

    const setCookies = parseCookies(response.headers['set-cookie'] as string | string[] | undefined);
    this.cookies = { ...this.cookies, ...setCookies };

    let body: unknown = {};
    try {
      body = response.body ? JSON.parse(response.body) : {};
    } catch {
      body = response.body;
    }
    return { status: response.statusCode, body: body as T, cookies: setCookies };
  }

  get = <T = any>(url: string) => this.request<T>('GET', url);
  post = <T = any>(url: string, payload?: unknown) => this.request<T>('POST', url, payload);
  patch = <T = any>(url: string, payload?: unknown) => this.request<T>('PATCH', url, payload);
  del = <T = any>(url: string) => this.request<T>('DELETE', url);

  /** Mirrors what the SPA does on boot: fetch a public endpoint to receive the CSRF cookie. */
  async bootstrap(): Promise<void> {
    await this.get('/api/v1/meta');
  }
}
