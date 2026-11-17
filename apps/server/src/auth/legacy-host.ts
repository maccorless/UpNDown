import type { RequestHandler } from 'express';

// Page loads on the old Railway address go to the one host login works on, so invite links keep working.
// The target is built by concatenation with the configured origin, so the request can never pick the host.
// 302 with no-store: a wrong rule must never be pinned in a browser the way a 301 would be.
export function legacyHostRedirect(
  target: () => { legacyHost: string; publicBaseUrl: string } | null
): RequestHandler {
  return (req, res, next) => {
    const current = target();
    if (!current || (req.method !== 'GET' && req.method !== 'HEAD')) {
      next();
      return;
    }
    const host = (req.headers.host ?? '').toLowerCase();
    const wantsPage = (req.headers.accept ?? '').includes('text/html');
    const path = req.originalUrl;
    // The canonical host never redirects to itself, even if PUBLIC_BASE_URL was set to the legacy address.
    if (!wantsPage || host !== current.legacyHost.toLowerCase() || host === new URL(current.publicBaseUrl).host.toLowerCase()
      || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) {
      next();
      return;
    }
    res.set({ 'Cache-Control': 'no-store', Vary: 'Host, Accept' });
    res.redirect(302, `${current.publicBaseUrl}${path}`);
  };
}
