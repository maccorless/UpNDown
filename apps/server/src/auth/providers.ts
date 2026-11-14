import { z } from 'zod';

export interface ProviderProfile {
  id: string;
  name: string | null;
}

export interface Provider {
  readonly id: 'google';
  startUrl(params: { redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCode(params: { code: string; redirectUri: string; codeVerifier: string }): Promise<{ accessToken: string }>;
  fetchProfile(accessToken: string): Promise<ProviderProfile>;
}

// Endpoints from https://accounts.google.com/.well-known/openid-configuration. Scope is `openid profile`: no email.
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const TIMEOUT_MS = 10_000;

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });
const userInfoSchema = z.object({ sub: z.string().min(1), name: z.string().optional() });

// Errors carry the status only: the response body can echo a code or token, and these messages are logged.
export function createGoogleProvider(clientId: string, clientSecret: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    id: 'google',
    startUrl({ redirectUri, state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'openid profile',
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      });
      return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const response = await fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`google token exchange failed: ${response.status}`);
      return { accessToken: tokenResponseSchema.parse(await response.json()).access_token };
    },
    async fetchProfile(accessToken) {
      const response = await fetchImpl(USERINFO_ENDPOINT, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!response.ok) throw new Error(`google userinfo failed: ${response.status}`);
      const info = userInfoSchema.parse(await response.json());
      return { id: info.sub, name: info.name ?? null };
    }
  };
}
