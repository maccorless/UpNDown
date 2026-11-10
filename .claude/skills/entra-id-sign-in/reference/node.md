# Node.js: Express and Next.js

All examples read `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`,
`ENTRA_REDIRECT_URI`, `ENTRA_ALLOWED_GROUPS`, `ENTRA_GROUP_ROLES` and `SESSION_SECRET` from the environment.
The redirect URI always comes from `ENTRA_REDIRECT_URI`, never from the request.

## Express with openid-client (v5 API)

`openid-client` validates the ID token's signature, issuer, audience, expiry and nonce.

```js
import express from "express";
import session from "cookie-session";
import { Issuer, generators } from "openid-client";

const tenant = process.env.ENTRA_TENANT_ID;
const allowed = new Set((process.env.ENTRA_ALLOWED_GROUPS ?? "").split(",").filter(Boolean));
// ENTRA_GROUP_ROLES: JSON of role name to group object ID, e.g. {"admin":"<id>","user":"<id>"}.
const roleGroups = JSON.parse(process.env.ENTRA_GROUP_ROLES || "{}");
const rolesOf = (groups) => Object.keys(roleGroups).filter((role) => groups.includes(roleGroups[role]));
const issuer = await Issuer.discover(`https://login.microsoftonline.com/${tenant}/v2.0`);
const client = new issuer.Client({
  client_id: process.env.ENTRA_CLIENT_ID,
  client_secret: process.env.ENTRA_CLIENT_SECRET,
  redirect_uris: [process.env.ENTRA_REDIRECT_URI],
  response_types: ["code"],
});

const app = express();
const secure = process.env.ENTRA_REDIRECT_URI.startsWith("https://");
// The pod sees plain http behind Skiff's route. cookie-session sends no Secure cookie on such
// a request (no error, no Set-Cookie), so sign-in dies at the callback with "checks.state
// argument is missing". Tell Express the request was https.
if (secure) {
  app.set("trust proxy", true);
  app.use((req, _res, next) => { req.headers["x-forwarded-proto"] = "https"; next(); });
}
app.use(session({
  secret: process.env.SESSION_SECRET,
  secure,
  httpOnly: true,
  sameSite: "lax",
}));

app.get("/auth/login", (req, res) => {
  const verifier = generators.codeVerifier();
  const nonce = generators.nonce();
  const state = generators.state();
  req.session.auth = { verifier, nonce, state };
  res.redirect(client.authorizationUrl({
    scope: "openid profile email",
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: "S256",
    nonce, state,
  }));
});

app.get("/auth/callback", async (req, res) => {
  const { verifier, nonce, state } = req.session.auth ?? {};
  const params = client.callbackParams(req);
  const tokens = await client.callback(process.env.ENTRA_REDIRECT_URI, params,
    { code_verifier: verifier, nonce, state });
  const claims = tokens.claims();
  req.session.auth = undefined;
  const groups = claims.groups ?? [];
  req.session.user = { oid: claims.oid, name: claims.name, groups, roles: rolesOf(groups) };
  res.redirect("/");
});

function requireGroup(req, res, next) {
  const user = req.session.user;
  if (!user) return res.redirect("/auth/login");
  if (!user.groups.some((g) => allowed.has(g))) return res.status(403).send("Forbidden");
  next();
}

// Role check: no role groups (empty map) means no roles, never everyone.
function requireRole(role) {
  return (req, res, next) => {
    const user = req.session.user;
    if (!user) return res.redirect("/auth/login");
    if (!user.roles.includes(role)) return res.status(403).send("Forbidden");
    next();
  };
}

app.use("/admin", requireGroup);
```

A cookie session keeps sign-in working across replicas. Keep it small: store the user's
`oid`, name and groups, not the tokens.

## Express with passport-azure-ad

`passport-azure-ad` is deprecated by Microsoft. Keep it only where it is already in use; set
`redirectUrl` from `ENTRA_REDIRECT_URI`, `validateIssuer: true`, `responseType: "code"`, and
`useCookieInsteadOfSession: false` with a shared session store. Prefer `openid-client` or
MSAL Node for new code.

## MSAL Node (`@azure/msal-node`)

Use `ConfidentialClientApplication` with
`authority: https://login.microsoftonline.com/${tenant}`, `getAuthCodeUrl` with
`redirectUri: process.env.ENTRA_REDIRECT_URI` and PKCE, then `acquireTokenByCode` with the
same `redirectUri`. MSAL handles the token request; still check `idTokenClaims.groups`
against the allowed set on every protected route. Use MSAL when the app also calls
Microsoft Graph or another API on the user's behalf.

## Next.js with Auth.js (NextAuth)

```ts
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const { handlers, auth } = NextAuth({
  providers: [MicrosoftEntraID({
    clientId: process.env.ENTRA_CLIENT_ID,
    clientSecret: process.env.ENTRA_CLIENT_SECRET,
    issuer: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
  })],
  callbacks: {
    jwt({ token, profile }) { if (profile) token.groups = profile.groups ?? []; return token; },
  },
});
```

Set `AUTH_URL` to the app's Skiff URL and `AUTH_SECRET` (a secret) so Auth.js builds the
callback (`/api/auth/callback/microsoft-entra-id`) from config, not from request headers.
Register that exact path in Entra. Check groups in middleware and in each route handler.
