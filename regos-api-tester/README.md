# Regos API Tester

Standalone React + TypeScript tool for sending freeform requests to the Regos integration API and for simulating incoming Regos webhooks.

No backend and no application authentication. Request bodies, headers, methods, and URLs are never validated or restricted.

## Run

```bash
cd regos-api-tester
npm install
npm run dev
```

Open the printed URL (default [http://localhost:5175](http://localhost:5175)).

## API Request tab

Builds URLs in the same shape as the main backend:

```
POST https://integration.regos.uz/gateway/out/{token}/v1/{endpoint}
Content-Type: application/json;charset=utf-8
Authorization: Bearer {access_token}   # optional
```

All fields are editable. The optional OAuth helper calls `https://auth.regos.uz/oauth/token` with client credentials and fills the Bearer header.

Settings (token, body, headers, etc.) are stored in `localStorage` for convenience only.

## Webhook Tester tab

Sends webhook payloads to a URL you control (for example the local backend):

```
http://localhost:8000/api/v1/regos/webhook
```

Event templates match the actions handled in `backend/app/services/regos_webhook.py`. Templates only insert JSON into the body editor; you can edit or replace anything before sending.

## CORS / Vite proxy

Browsers block direct calls to `integration.regos.uz` and `auth.regos.uz`. With **Use Vite proxy** enabled (default in dev), requests are rewritten:

| Browser path | Target |
|---|---|
| `/regos-proxy/...` | `https://integration.regos.uz/...` |
| `/oauth-proxy/...` | `https://auth.regos.uz/...` |

Webhook targets (local or remote receivers) are always called directly, not through the Regos proxy.

Turn the proxy off if you are in an environment where CORS is not an issue.
