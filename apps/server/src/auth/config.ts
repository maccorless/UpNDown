import { z } from 'zod';

export interface AuthSettings {
  databaseUrl: string;
  publicBaseUrl: string;
  stateSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  legacyHost: string | undefined;
}

export type AuthSettingsResult =
  | { configured: true; settings: AuthSettings }
  | { configured: false; reason: string };

const REQUIRED = ['DATABASE_URL', 'PUBLIC_BASE_URL', 'AUTH_STATE_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

// Origin only: it is concatenated with request paths later, and OAuth redirect URIs need an exact host.
const publicBaseUrlSchema = z.string().refine((value) => {
  try {
    const url = new URL(value);
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.origin === value && (url.protocol === 'https:' || (url.protocol === 'http:' && localhost));
  } catch {
    return false;
  }
}, 'must be an origin such as https://upndown.cloud (https, or http for localhost), with no path');

// The reason names variables only, never values: it is logged.
export function resolveAuthSettings(env: Record<string, string | undefined>): AuthSettingsResult {
  const value = (name: string): string | undefined => (env[name]?.trim() ? env[name]?.trim() : undefined);
  const missing = REQUIRED.filter((name) => !value(name));
  if (missing.length === REQUIRED.length) {
    return { configured: false, reason: 'not configured' };
  }
  if (missing.length > 0) {
    return { configured: false, reason: `missing ${missing.join(', ')}` };
  }
  const invalid: string[] = [];
  if (!publicBaseUrlSchema.safeParse(value('PUBLIC_BASE_URL')).success) invalid.push('PUBLIC_BASE_URL');
  if ((value('AUTH_STATE_SECRET') ?? '').length < 32) invalid.push('AUTH_STATE_SECRET (needs 32+ characters)');
  if (invalid.length > 0) {
    return { configured: false, reason: `invalid ${invalid.join(', ')}` };
  }
  return {
    configured: true,
    settings: {
      databaseUrl: value('DATABASE_URL') as string,
      publicBaseUrl: value('PUBLIC_BASE_URL') as string,
      stateSecret: value('AUTH_STATE_SECRET') as string,
      googleClientId: value('GOOGLE_CLIENT_ID') as string,
      googleClientSecret: value('GOOGLE_CLIENT_SECRET') as string,
      legacyHost: value('LEGACY_HOST') ?? value('RAILWAY_PUBLIC_DOMAIN')
    }
  };
}
