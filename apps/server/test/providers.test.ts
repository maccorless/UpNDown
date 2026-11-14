import { describe, expect, it } from 'vitest';
import { createGoogleProvider } from '../src/auth/providers.js';

const redirectUri = 'https://upndown.cloud/auth/google/callback';

describe('Google provider', () => {
  it('asks for openid profile only, with PKCE S256 and the exact redirect URI', () => {
    const url = new URL(createGoogleProvider('cid', 'csecret').startUrl({ redirectUri, state: 'st', codeChallenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid', response_type: 'code', scope: 'openid profile', redirect_uri: redirectUri,
      state: 'st', code_challenge: 'ch', code_challenge_method: 'S256'
    });
    expect(url.search).not.toContain('csecret');
  });

  it('exchanges the code with the verifier, and sends the secret only in the POST body', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchStub = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ access_token: 'at', id_token: 'ignored' }));
    }) as unknown as typeof fetch;
    const result = await createGoogleProvider('cid', 'csecret', fetchStub).exchangeCode({ code: 'c0de', redirectUri, codeVerifier: 'verif' });
    expect(result).toEqual({ accessToken: 'at' });
    expect(seen?.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(seen?.init.body as URLSearchParams)).toEqual({
      code: 'c0de', client_id: 'cid', client_secret: 'csecret', redirect_uri: redirectUri,
      grant_type: 'authorization_code', code_verifier: 'verif'
    });
  });

  it('reads the Google account id and name from userinfo using the bearer token', async () => {
    let auth = '';
    const fetchStub = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).authorization ?? '';
      return new Response(JSON.stringify({ sub: '1234', name: 'Pat Q' }));
    }) as unknown as typeof fetch;
    expect(await createGoogleProvider('cid', 'cs', fetchStub).fetchProfile('tok')).toEqual({ id: '1234', name: 'Pat Q' });
    expect(auth).toBe('Bearer tok');
  });

  it('tolerates a missing name but not a missing account id', async () => {
    const make = (body: unknown) => createGoogleProvider('c', 's', (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch);
    expect(await make({ sub: '9' }).fetchProfile('t')).toEqual({ id: '9', name: null });
    await expect(make({ name: 'x' }).fetchProfile('t')).rejects.toThrow();
  });

  // Error text is logged. A provider error body can echo the code, so only the status may appear.
  it('keeps the response body out of error messages', async () => {
    const fetchStub = (async () => new Response('{"error":"invalid_grant","code":"SECRET-CODE"}', { status: 400 })) as unknown as typeof fetch;
    const error = await createGoogleProvider('c', 's', fetchStub).exchangeCode({ code: 'SECRET-CODE', redirectUri, codeVerifier: 'v' }).catch((e: Error) => e);
    expect((error as Error).message).toBe('google token exchange failed: 400');
  });
});
