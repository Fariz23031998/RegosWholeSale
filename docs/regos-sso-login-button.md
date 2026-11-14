# Login with REGOS account (SSO button)

**Status: implemented** on the Wholesale login screen.

Official SDK docs: [Кнопка авторизации (SSO Button)](https://docs.regos.uz/en/sso/sso-button)

---

## What this is (and what it is not)

| Mechanism | Purpose in this repo |
| --- | --- |
| **RegosOAuthSDK + `POST /api/v1/auth/regos-sso`** | End-user login via REGOS account (authorization code + PKCE in the browser) |
| `backend/app/core/regos_oauth.py` client_credentials | Server token for calling Regos Integration APIs |
| `POST /api/v1/auth/regos-integration` | Catalog / integration-token login (webhook callback), unchanged |

The SDK never needs a `client_secret` in the browser. Only `clientId` and a registered `redirectUri` are required for the widget.

SSO login on the backend validates the REGOS user token with **`GET /oauth/userinfo` only** (Bearer). It does **not** require `REGOS_CLIENT_ID` / `REGOS_CLIENT_SECRET`. Those remain optional for Integration Catalog / client_credentials API calls.

---

## Required configuration

### Frontend ([`frontend/.env.example`](../frontend/.env.example)) — required for the button

```env
VITE_REGOS_SSO_CLIENT_ID=your_client_id
VITE_REGOS_SSO_REDIRECT_URI=http://localhost:8080/oauth/redirect.html
```

Production redirect example: `https://<your-domain>/oauth/redirect.html`

Register that exact `redirectUri` for the OAuth client in REGOS. Use HTTPS in production. Do not put `REGOS_CLIENT_SECRET` in frontend env.

### Backend ([`backend/.env.example`](../backend/.env.example))

```env
REGOS_OAUTH_USERINFO_URL=https://auth.regos.uz/oauth/userinfo
# Optional — not required for SSO; used by Integration Catalog / Regos API:
# REGOS_CLIENT_ID=...
# REGOS_CLIENT_SECRET=...
# REGOS_OAUTH_TOKEN_URL=https://auth.regos.uz/oauth/token
# REGOS_OAUTH_INTROSPECT_URL=https://auth.regos.uz/oauth/introspect
```

Run Alembic so `users.regos_sub` exists (migration `038_user_regos_sub`).

---

## How it works in this app

1. User opens `/login`. If SSO env vars are set, [`LoginScreen`](../frontend/src/components/Auth/LoginScreen.tsx) loads RegosOAuthSDK and mounts `#regos-login`.
2. User clicks the REGOS button. SDK opens REGOS auth (popup / redirect).
3. REGOS returns to [`frontend/public/oauth/redirect.html`](../frontend/public/oauth/redirect.html) (`regos-redirect.js`).
4. SDK calls `onData(user, accessToken)`.
5. Frontend posts the REGOS access token to `POST /api/v1/auth/regos-sso`.
6. Backend loads `/oauth/userinfo` with that Bearer token, then:
   - finds `User` by `regos_sub`, or
   - finds by email and backfills `regos_sub`, or
   - creates a trial company + owner (`must_set_password=True`) with `regos_sub`.
7. Backend returns Wholesale `AuthResponse` (JWT). Frontend sets session; if password setup is required, shows [`SetInitialPasswordForm`](../frontend/src/components/Auth/SetInitialPasswordForm.tsx); otherwise navigates to `/` or `/billing` via `userNeedsBilling`.

---

## Key files

| Area | Path |
| --- | --- |
| Login UI | `frontend/src/components/Auth/LoginScreen.tsx` |
| SDK loader | `frontend/src/lib/regos-oauth-sdk.ts` |
| Auth API client | `frontend/src/lib/auth-api.ts` → `loginWithRegosSso` |
| Redirect page | `frontend/public/oauth/redirect.html` |
| Route | `POST /api/v1/auth/regos-sso` in `backend/app/api/v1/auth.py` |
| Service | `login_with_regos_sso` in `backend/app/services/auth.py` |
| Introspect / userinfo | `backend/app/core/regos_oauth.py` |
| Tests | `backend/tests/test_regos_sso_auth.py` |

---

## SDK options used on login

```js
RegosOAuthSDK.initialize({
  clientId: VITE_REGOS_SSO_CLIENT_ID,
  redirectUri: VITE_REGOS_SSO_REDIRECT_URI,
  containerId: "regos-login",
  language: /* mapped from app locale: ru | en | uz */,
  buttonSize: "m",
  buttonTheme: "light",
  buttonType: "icon-text",
  buttonTextType: "full",
  flow: "auto",
  silent: false,
  onData: (user, accessToken) => { /* POST /auth/regos-sso */ },
  onError: (error) => { /* show on login form */ },
});
```

Silent auth is intentionally off.

---

## Security checklist

- [x] Redirect page is static and only loads REGOS `regos-redirect.js`
- [x] No `client_secret` in frontend
- [x] Backend validates REGOS token via userinfo (no client secret required for SSO)
- [x] Profile comes from userinfo (`sub` stored on `users.regos_sub`)
- [ ] Register production redirect URI in REGOS and set env on deploy

---

## Out of scope (unchanged)

- Integration catalog webhook + `POST /auth/regos-integration` + `/integration/callback/$token`
- Storing REGOS refresh tokens on the server (Wholesale JWT is the app session)
