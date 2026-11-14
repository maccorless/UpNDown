import type { Provider } from '../../src/auth/providers.js';

// Drives the callback route without the network. Lives under test/ and is only injected by tests.
export function createFakeProvider(behavior: { profileId?: string; name?: string | null; failAt?: 'exchange' | 'profile' } = {}): Provider & {
  exchangeCalls: Array<{ code: string; redirectUri: string; codeVerifier: string }>;
} {
  const exchangeCalls: Array<{ code: string; redirectUri: string; codeVerifier: string }> = [];
  return {
    id: 'google',
    exchangeCalls,
    startUrl: ({ redirectUri, state, codeChallenge }) =>
      `https://provider.test/authorize?${new URLSearchParams({ redirect_uri: redirectUri, state, code_challenge: codeChallenge })}`,
    async exchangeCode(params) {
      exchangeCalls.push(params);
      if (behavior.failAt === 'exchange') throw new Error('exchange failed');
      return { accessToken: 'access-token-value' };
    },
    async fetchProfile() {
      if (behavior.failAt === 'profile') throw new Error('profile failed');
      return { id: behavior.profileId ?? 'google-user-1', name: behavior.name ?? 'Test Person' };
    }
  };
}
