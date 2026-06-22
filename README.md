# Regos Wholesale

Wholesale POS application with a React frontend and FastAPI backend.

## Frontend

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

Set `VITE_API_BASE_URL=http://localhost:8000` in `frontend/.env` so auth pages talk to the backend.

Auth routes: `/login`, `/register`, `/reset-password` (owner email + password; employees use company slug + login on the login page).

## Backend

Requirements: Python 3.11+

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
# source .venv/bin/activate

pip install -e ".[dev]"
copy .env.example .env

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### First-time setup

1. Send a verification code (requires [Resend](https://resend.com) API key in `.env`):

```http
POST /api/v1/auth/send-verification-code
{
  "email": "owner@example.com",
  "type": "register"
}
```

2. Register the first company and owner with the code from email:

```http
POST /api/v1/auth/register
{
  "email": "owner@example.com",
  "password": "secure-password",
  "display_name": "Jane Owner",
  "company_name": "Regos Wholesale",
  "verification_code": "123456"
}
```

Reset password (after `send-verification-code` with `"type": "reset_password"`):

```http
POST /api/v1/auth/reset-password
{
  "email": "owner@example.com",
  "verification_code": "123456",
  "new_password": "new-secure-password"
}
```

Add an employee (requires owner token and `users.manage` permission):

```http
POST /api/v1/users
Authorization: Bearer <token>
{
  "login": "alice",
  "password": "temp-password",
  "display_name": "Alice Chen",
  "role": "employee",
  "permission_codes": ["pos.access", "sales.read"],
  "schedules": [
    { "day_of_week": 0, "start_time": "09:00", "end_time": "17:00" }
  ]
}
```

Employee login:

```http
POST /api/v1/auth/login
{
  "login": "alice",
  "password": "temp-password"
}
```

### Regos integration

Configure OAuth in `.env` when using a **replicable** integration token (required for `is_replicable: true`):

```
REGOS_OAUTH_TOKEN_URL=https://auth.regos.uz/oauth/token
REGOS_CLIENT_ID=your-client-id
REGOS_CLIENT_SECRET=your-client-secret
```

Save the company's 32-character Regos integration token (owner/admin, `settings.manage`):

```http
PUT /api/v1/regos/tokens
Authorization: Bearer <token>
{
  "token": "01234567890123456789012345678901",
  "is_replicable": false
}
```

Check status: `GET /api/v1/regos/tokens/status`

Proxy any Regos API call (requires `pos.access`):

```http
POST /api/v1/regos/proxy/Item/Get
Authorization: Bearer <token>
{}
```

The proxy forwards the JSON body to `https://integration.regos.uz/gateway/out/{integration_token}/v1/{endpoint}`.

### Tests

```bash
cd backend
pytest
```
