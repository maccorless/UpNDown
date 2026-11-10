# Common sign-in errors and their fixes

Entra shows the code on its error page and in the `error_description` sent back to the
redirect URI. Log that description (never a token or secret) in the callback handler.

## AADSTS codes

| Code | What it means | Fix |
| --- | --- | --- |
| AADSTS50011 | The redirect URI sent does not match any registered for the app. | Compare the URI in the error with the registration: scheme, host, path, trailing slash, case. Set `ENTRA_REDIRECT_URI` to the registered one and stop the library deriving it from the request. |
| AADSTS500113 | No redirect URI is registered. | `set_entra_redirect_uris` with the Skiff callback URL. |
| AADSTS700016 | No app with this client ID in the tenant. | Wrong `ENTRA_CLIENT_ID`, or the authority uses a different tenant. Check both against the registration's Overview page. |
| AADSTS7000215 | Invalid client secret. | The app is not using the secret Skiff holds. Check `ENTRA_CLIENT_SECRET` comes from the connection, not a copy, then redeploy; `rotate_entra_secret` if in doubt. |
| AADSTS7000222 | The client secret has expired. | `rotate_entra_secret`: Skiff issues a new one and restarts the connected components. |
| AADSTS9002325 | PKCE required for cross-origin redemption. | The redirect URI is registered as SPA. Register it as Web for a server-side app. |
| AADSTS700054 | `id_token` is not enabled for the app. | Use the code flow (`response_type=code`), not implicit. |
| AADSTS50105 | The user is not assigned to the app. | Entra refuses anyone not assigned to the registration's enterprise app. `add_entra_allowed_user` (email or object ID) or `set_entra_allowed_groups` (a group they are a direct member of) lets them in at their next sign-in; no redeploy. A new registration lets in only its creator. |
| AADSTS65001 | The user or admin has not consented. | Ask an admin to grant consent for the requested permissions, or request only `openid profile email`. |
| AADSTS50020 | The user's account is not in this tenant. | A guest or personal account on a single-tenant app. Invite them as a guest, or ask whether the app should allow other tenants. |
| AADSTS53003 | Blocked by Conditional Access. | A tenant policy, not an app bug. The user goes to their IT admin. |
| AADSTS90102 | The `redirect_uri` is not a valid absolute URI. | `ENTRA_REDIRECT_URI` is empty or relative. Set the full URL. |

## Errors that are not AADSTS codes

- **State mismatch, nonce mismatch, "checks.state argument is missing"**: the session from
  `/auth/login` was not there at `/auth/callback`. Causes: sessions in process memory with
  several replicas; the login started on one host and the callback landed on another; and,
  the one that hides best, **no cookie was ever sent**. Skiff's route ends TLS, so the pod
  sees plain http, and some session libraries (Express `cookie-session`) will not send a `Secure` cookie on a request
  that does not look like https skip it without an error. Check: open the browser's network
  tab on `/auth/login` and look for `Set-Cookie`; none means this cause. Fix: treat the
  request as https when `ENTRA_REDIRECT_URI` is https (in Express: `app.set("trust proxy",
  true)` and set `req.headers["x-forwarded-proto"] = "https"` in a middleware before the
  session), and keep `Secure` off only for a `http://localhost` redirect URI.
- **Invalid audience**: the code validates against something other than the client ID, or
  checks an access token meant for Microsoft Graph as if it were the app's. Validate the ID
  token for sign-in.
- **Invalid issuer**: the code expects the v1 issuer (`https://sts.windows.net/<tenant>/`)
  but gets v2 tokens, or the reverse. Use the v2 endpoints throughout.
- **No `groups` claim**: the registration has no groups claim, or the user is in too many
  groups (`hasgroups` or `_claim_names` appears instead). Add the claim, or use app roles. A person let in by
  `add_entra_allowed_user` has no group, so a page that needs a group refuses them.
- **Redirects back to http after signing in on https**: the app built a URL from the
  request. Build every absolute URL from config.
- **Entra rejects an http redirect URI**: only `http://localhost` may be http. If the Skiff
  URL is http, the app cannot use it for Entra sign-in until it is served over https; tell
  the user rather than working around it.

## Checking the redirect URI the app sends

Open `/auth/login` with redirects not followed (`curl -sI https://<app>/auth/login`) and
read the `redirect_uri` parameter in the `Location` header. It must equal a registered URI
character for character.
