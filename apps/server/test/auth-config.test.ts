import { describe, expect, it } from 'vitest';
import { resolveAuthSettings } from '../src/auth/config.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@db.internal:5432/app',
  PUBLIC_BASE_URL: 'https://upndown.cloud',
  AUTH_STATE_SECRET: 'x'.repeat(32),
  GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-secret'
};

// Skiff and an unconfigured Railway must stay guest-only. A half-set config must fail closed, never half-enable login.
describe('resolveAuthSettings', () => {
  it('is off with nothing set (Skiff, local dev)', () => {
    expect(resolveAuthSettings({})).toEqual({ configured: false, reason: 'not configured' });
  });

  it('is off and names each missing variable when only some are set', () => {
    expect(resolveAuthSettings({ ...valid, GOOGLE_CLIENT_SECRET: undefined })).toEqual({ configured: false, reason: 'missing GOOGLE_CLIENT_SECRET' });
  });

  it('treats blank values as missing', () => {
    const result = resolveAuthSettings({ ...valid, GOOGLE_CLIENT_ID: '   ' });
    expect(result).toEqual({ configured: false, reason: 'missing GOOGLE_CLIENT_ID' });
  });

  it('is on when everything is valid, and LEGACY_HOST falls back to Railway\'s domain', () => {
    const result = resolveAuthSettings({ ...valid, RAILWAY_PUBLIC_DOMAIN: 'app.up.railway.app' });
    expect(result).toMatchObject({ configured: true, settings: { legacyHost: 'app.up.railway.app' } });
    const explicit = resolveAuthSettings({ ...valid, LEGACY_HOST: 'old.example', RAILWAY_PUBLIC_DOMAIN: 'app.up.railway.app' });
    expect(explicit).toMatchObject({ configured: true, settings: { legacyHost: 'old.example' } });
  });

  it.each([
    ['a path (it is concatenated with request paths)', 'https://upndown.cloud/app'],
    ['a trailing slash (OAuth needs an exact redirect URI)', 'https://upndown.cloud/'],
    ['plain http on a real host', 'http://upndown.cloud'],
    ['not a URL', 'upndown.cloud']
  ])('rejects PUBLIC_BASE_URL with %s', (_why, publicBaseUrl) => {
    expect(resolveAuthSettings({ ...valid, PUBLIC_BASE_URL: publicBaseUrl })).toEqual({ configured: false, reason: 'invalid PUBLIC_BASE_URL' });
  });

  it('allows http for localhost development', () => {
    expect(resolveAuthSettings({ ...valid, PUBLIC_BASE_URL: 'http://localhost:5173' }).configured).toBe(true);
  });

  it('rejects a short AUTH_STATE_SECRET', () => {
    const result = resolveAuthSettings({ ...valid, AUTH_STATE_SECRET: 'short' });
    expect(result.configured).toBe(false);
  });

  it('never puts a secret value in the reason, because the reason is logged', () => {
    const result = resolveAuthSettings({ ...valid, AUTH_STATE_SECRET: 'tiny-secret-value', PUBLIC_BASE_URL: 'nope' });
    const reason = JSON.stringify(result);
    for (const secret of ['tiny-secret-value', valid.GOOGLE_CLIENT_SECRET, valid.DATABASE_URL, 'nope']) {
      expect(reason).not.toContain(secret);
    }
  });
});
