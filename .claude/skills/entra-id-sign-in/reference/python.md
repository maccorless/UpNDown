# Python: FastAPI, Flask, Django

All examples read `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`,
`ENTRA_REDIRECT_URI`, `ENTRA_ALLOWED_GROUPS`, `ENTRA_GROUP_ROLES` and `SESSION_SECRET` from the environment.
The redirect URI always comes from `ENTRA_REDIRECT_URI`. Never use `url_for(...,
_external=True)` or `request.url_for` for it: behind Skiff's route they can produce the
wrong scheme or host.

## FastAPI with Authlib

Authlib validates the ID token's signature, issuer, audience, expiry and nonce.

```python
import json
import os
from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware

TENANT = os.environ["ENTRA_TENANT_ID"]
REDIRECT_URI = os.environ["ENTRA_REDIRECT_URI"]
ALLOWED = {g for g in os.environ.get("ENTRA_ALLOWED_GROUPS", "").split(",") if g}
# ENTRA_GROUP_ROLES: JSON of role name to group object ID, e.g. {"admin": "<id>", "user": "<id>"}.
ROLE_GROUPS = json.loads(os.environ.get("ENTRA_GROUP_ROLES") or "{}")

def roles_of(groups: list[str]) -> list[str]:
    return [role for role, gid in ROLE_GROUPS.items() if gid in groups]

app = FastAPI()
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ["SESSION_SECRET"],
    same_site="lax",
    https_only=REDIRECT_URI.startswith("https://"),
)

oauth = OAuth()
oauth.register(
    "entra",
    client_id=os.environ["ENTRA_CLIENT_ID"],
    client_secret=os.environ["ENTRA_CLIENT_SECRET"],
    server_metadata_url=f"https://login.microsoftonline.com/{TENANT}/v2.0/.well-known/openid-configuration",
    client_kwargs={"scope": "openid profile email", "code_challenge_method": "S256"},
)

@app.get("/auth/login")
async def login(request: Request):
    return await oauth.entra.authorize_redirect(request, REDIRECT_URI)

@app.get("/auth/callback")
async def callback(request: Request):
    token = await oauth.entra.authorize_access_token(request)
    claims = token["userinfo"]
    request.session["user"] = {
        "oid": claims["oid"], "name": claims.get("name"), "groups": claims.get("groups", []), "roles": roles_of(claims.get("groups", [])),
    }
    return RedirectResponse("/")

def require_group(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401)
    if not ALLOWED.intersection(user["groups"]):
        raise HTTPException(status_code=403)
    return user

def require_role(role: str):
    # No role groups (empty map) means no roles, never everyone.
    def check(user: dict = Depends(require_group)) -> dict:
        if role not in user["roles"]:
            raise HTTPException(status_code=403)
        return user
    return check
```

Use `Depends(require_group)` on every protected route. Starlette's session is a signed
cookie, so it works across replicas.

## Flask with Authlib

Same shape with `authlib.integrations.flask_client.OAuth`: `register` with the same
`server_metadata_url`, `authorize_redirect(REDIRECT_URI)`, then `authorize_access_token()`.
Set `app.secret_key = os.environ["SESSION_SECRET"]`, `SESSION_COOKIE_SAMESITE="Lax"`, and
`SESSION_COOKIE_SECURE` when the redirect URI is https.

## Django

Use `mozilla-django-oidc` or `django-allauth` (Microsoft provider). With
`mozilla-django-oidc`, set the endpoints from
`https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration`,
`OIDC_RP_SIGN_ALGO = "RS256"` and `OIDC_OP_JWKS_ENDPOINT`, and check groups in a custom
`OIDCAuthenticationBackend.verify_claims`. Set the callback from config with
`OIDC_AUTHENTICATION_CALLBACK_URL` and keep sessions in the database, not in local memory.

## MSAL Python

Use `msal.ConfidentialClientApplication` with
`authority=f"https://login.microsoftonline.com/{TENANT}"`. Start with
`initiate_auth_code_flow(scopes=[], redirect_uri=REDIRECT_URI)`, keep the returned flow in
the session, and finish with `acquire_token_by_auth_code_flow(flow, request.args)`. MSAL
validates the ID token; check `id_token_claims["groups"]` yourself. Use MSAL when the app
also calls Microsoft Graph for the user.

## Local testing

Register `http://localhost:8000/auth/callback` too, and run with
`ENTRA_REDIRECT_URI=http://localhost:8000/auth/callback`. Keep the local client secret in
an untracked `.env`.
