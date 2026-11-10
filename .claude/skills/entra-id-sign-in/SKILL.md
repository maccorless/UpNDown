---
name: Sign in with Microsoft Entra ID
description: Use when the user's app on Skiff should sign people in with their Microsoft work account, limit pages or routes to Entra ID groups, or sign-in fails with an AADSTS error.
summary: Adds company single sign-on to your app, and lets only the Entra ID groups you choose into each page.
version: 1.6.0
tags:
  - auth
  - entra-id
  - sso
  - oidc
  - security
targets:
  - claude
  - codex
  - cursor
  - generic
author: Platform team
category: data-and-security
why: >
  Most internal apps need to know who is using them. Sign-in built by hand is
  easy to get subtly wrong: a redirect address that only works on a laptop,
  tokens nobody checks, an admin page anyone can open. This skill gives your
  agent the standard, safe way to do it for an app running on Skiff, with the
  client secret kept out of the code.
outcomes:
  - Add an Entra-ID App Registration to your project, with the redirect address on its Skiff URL, so nobody registers the app by hand
  - Add the sign-in flow with your framework's standard library, such as MSAL, Passport or Authlib
  - Check every token's issuer, audience, expiry and signature
  - Let only the people and groups you choose sign in, refused by Entra before the app sees them
  - Let only the Entra ID groups you choose into each page and API route
  - Keep the client secret with Skiff, never in your code or repository, and rotate it without downtime
  - Test sign-in on your laptop and again on Skiff
asks:
  - Add Microsoft sign-in to this app
  - Only let the Finance group open the admin pages
  - Why does sign-in fail with AADSTS50011?
prerequisites:
  - A Skiff admin has connected Microsoft Entra ID under Admin, Integrations
  - The emails of the people, and the names or object IDs of the Entra ID groups, that should get in
  - The app deployed on Skiff with a public address
---

# Sign in with Microsoft Entra ID

Use this skill when the user's app on Skiff should sign people in with their Microsoft work
account, limit pages or API routes to Entra ID groups, or sign-in fails with an `AADSTS`
error. It is for the user's own app running on Skiff. It is not about signing in to Skiff
itself; Skiff has no helper for this, so the app does the OpenID Connect flow itself.

## Work in this order

1. **Get the app's address.** `get_project` lists the component's URL. If it has none, give
   it one with `add_domain` (`projectId`, `component`). The redirect URI is that URL plus a callback
   path, such as `https://orders-api-orders.apps.example.com/auth/callback`.
2. **Check the scheme.** Entra accepts `https` redirect URIs, and `http` only for
   `localhost`. If the URL `get_project` reports starts with `http://`, stop: tell the user
   Entra will not accept it, and that the Skiff operator must serve the app over https
   first. Do not register an http redirect URI and do not switch to an implicit flow.
3. **Add the app registration.** Never ask the user to register the app in the Entra admin
   center and never ask for a tenant ID, client ID or secret: Skiff does it. `list_catalog`
   (kind `addons`) must show `entra-app` as available; if it says Entra is not connected,
   tell the user an admin must connect Microsoft Entra ID under Admin > Integrations, and
   stop. Then `add_component` with kind `addon`, addon `entra-app`, `addonVersion` `v1.0`,
   a `name` such as `sign-in`, `entra.redirectUris` and `connectTo` (the app's component).
   One redirect URI per domain the app is served on: its generated domain, each custom
   domain, plus `http://localhost:<port>/auth/callback` for local testing. Add more later
   with `set_entra_redirect_uris`, which replaces the whole list; a refusal names the URI and
   the rule (https only, no wildcard, an admin may limit the domains).
4. **Connect it and set who gets in.** If `connectTo` was not used, `list_connection_values`
   on the registration, then `connect_components` from the app: it gets `ENTRA_TENANT_ID`,
   `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_AUTHORITY`, `ENTRA_REDIRECT_URI` (the
   first redirect URI, the full Skiff callback URL), `ENTRA_ALLOWED_GROUPS` and
   `ENTRA_GROUP_ROLES`. The client
   secret is never shown to you or the user: Skiff hands it to the pod at deploy, so do not
   put it in `set_variables`, `set_secrets`, code or chat. A new registration lets in only the
   person who made it: Entra refuses everyone else until they are assigned. Let people in
   with `add_entra_allowed_user` (an email is enough, or an object ID), and groups with
   `set_entra_allowed_groups` (group object IDs; `search_entra_groups` finds them by name, or
   the user pastes the IDs when it says search is unavailable; a group Entra will not assign
   comes back as the error). If there is no group yet,
   make one with `create_entra_group` (`allow: true` lets it in at once), add people with
   `add_entra_group_member` (an email is enough), and put its ID in
   `set_entra_allowed_groups`; those tools exist only while an admin has granted Skiff's
   Entra app group management, so when they are missing ask the user to paste IDs.
   Better, when the app has roles, create them with the registration: `entra.groups` on
   `add_component`, one group per role (a `user` group when there are none), never more
   groups than roles. Skiff names each `GRP-Skiff-{project}-{environment}-{component}-{name}`,
   lets it in, and adds the creator to `admin`. Set only a `SESSION_SECRET`
   for the session cookie yourself (`set_secrets`, `shape: "value"`, read `get_project`
   first since it replaces the list; the `settings-and-secrets` skill covers the details).
   `get_entra_registration` shows the values, drift and when the secret ends.
5. **Add the flow with a standard library.** Authorization code flow with PKCE, from
   `reference/node.md` or `reference/python.md`. Set the redirect URI from
   `ENTRA_REDIRECT_URI`. Do not let the library build it from the incoming request: Skiff's
   route does not set `X-Forwarded-Proto` or `X-Forwarded-Host` that the app can rely on, so
   a derived URI comes out with the wrong scheme or host.
6. **Validate every token.** Check the signature against the tenant's published keys, the
   issuer (`https://login.microsoftonline.com/<tenant>/v2.0`), the audience (the client
   ID), expiry and not-before, and the `nonce` for ID tokens. Libraries do this when you
   give them the tenant and client ID; do not decode a token without verifying it.
7. **Who gets in, and who gets which page.** Entra refuses unassigned people before the app
   sees them, so assign the users and groups with the tools in step 4; the app needs no check
   for that, and `ENTRA_ALLOWED_GROUPS` is only the assigned groups. An empty one means no
   extra groups, never everyone: do not treat empty as open. Keep an app-side check only for
   roles: test the `groups` claim against `ENTRA_ALLOWED_GROUPS` on each page or API route
   that only some of the signed-in people may open, on the server, with group object IDs,
   not names. If the token has `_claim_names` or `hasgroups` instead of `groups`, the user
   is in too many groups for the token: use app roles (`roles` claim).
   For roles made with the registration, read `ENTRA_GROUP_ROLES`, a JSON object of group
   name to group object ID: on sign-in map the token's `groups` claim through it to role
   names, as in the references. Empty or missing means no role groups, so no roles, never
   everyone.
8. **Keep sessions working on several replicas.** Store the session in a signed cookie or
   in Postgres, not in process memory, or sign-in breaks with a state mismatch when the
   callback lands on another replica. Mark the cookie `Secure`, `HttpOnly`,
   `SameSite=Lax`. **The pod sees plain http**: Skiff's route ends TLS before the app, and
   some session libraries (Express `cookie-session` does, with no error) refuse to send a
   `Secure` cookie on a request that does not look like https. The cookie from `/auth/login`
   is then never issued, and the callback fails with a state mismatch while Microsoft's side
   looked fine. Make the library treat the request as https whenever `ENTRA_REDIRECT_URI`
   starts with `https://` (`reference/node.md` shows how), and check `Set-Cookie` on
   `/auth/login` before blaming Entra.
9. **Test locally, then on Skiff.** Run the app on `http://localhost:<port>` with the
   localhost redirect URI and sign in. Then deploy with mode `deploy`, poll `get_project`,
   `verify_deployment`, and ask the user to sign in at the Skiff URL.

## Done when

- `verify_deployment` says `reachable`.
- The user signs in at the Skiff URL and lands back in the app.
- A protected page answers 401 or redirects to sign-in without a session, and 403 for a
  signed-in user outside the groups that page needs.
- A person who is not assigned is turned away by Entra at sign-in.
- No client secret is in the code, the image or the repository.
- `get_entra_registration` shows `status` `active`, the redirect URIs the app sends and no drift.

## When it goes wrong

Read `reference/errors.md` for `AADSTS` codes. The common ones:

- `AADSTS50011`: the redirect URI sent does not match a registered one exactly (scheme,
  host, path, trailing slash). Log the URI the app sends and fix it with
  `set_entra_redirect_uris` or the app's use of `ENTRA_REDIRECT_URI`.
- `AADSTS7000215`: wrong client secret. Redeploy the app so it takes the current one, or
  `rotate_entra_secret` if it is in doubt.
- `AADSTS7000222`: the client secret expired. `get_entra_registration` shows its status;
  `rotate_entra_secret` issues a new one and restarts the connected components one at a
  time (`graceHours` 24 keeps the old secret a day; a `held` rotation needs
  `retry_entra_rotation` or `roll_back_entra_rotation`).
- Skiff rotates the secret itself every month and restarts the app when it does, so read
  `ENTRA_CLIENT_SECRET` from the environment at start and never cache it for good or copy
  it anywhere else.
- `AADSTS50105`: the user is not assigned to the app, so Entra refuses them before the app
  runs. `add_entra_allowed_user` with their email or object ID lets them in, or
  `set_entra_allowed_groups` with a group they belong to (direct members only); it applies at
  their next sign-in, with no redeploy. Do not loosen the app's own check instead.
- "Need admin approval" (`AADSTS90094`): the tenant does not let users approve apps, and Skiff's
  Entra app lacks `DelegatedPermissionGrant.ReadWrite.All` or has not been Verified since it
  was granted. Tell the user to ask a tenant admin to grant admin consent on the registration's
  enterprise app (Entra > Enterprise applications > Permissions); new registrations are
  consented by Skiff once the permission is granted. It is not an access refusal.
- `AADSTS50011` after someone edited the registration in the Entra portal:
  `get_entra_registration` shows `drift`; `restore_entra_drift` puts Skiff's settings back.
- State or nonce mismatch after sign-in: sessions kept in memory across replicas, or no
  session cookie was ever issued because the app saw plain http and the library would not
  send a `Secure` cookie (the log shows `checks.state argument is missing` and the browser
  has no session cookie on the callback). Treat the request as https, as step 8 says.
