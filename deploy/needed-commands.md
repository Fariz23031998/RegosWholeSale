# Deploy commands

## PostgreSQL 18 (VPS host via apt)

Install on the same Ubuntu host as the backend (localhost only). Use PGDG on Ubuntu 22.04/24.04; Ubuntu 26.04 may ship PG 18 in the default archive.

```bash
sudo apt install -y postgresql-common ca-certificates
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt install -y postgresql-18 postgresql-client-18

sudo -u postgres psql -c "CREATE USER regos WITH PASSWORD 'CHANGE_ME';"
sudo -u postgres psql -c "CREATE DATABASE regos OWNER regos;"
```

Backend `.env` (production):

```env
DATABASE_URL=postgresql+asyncpg://regos:CHANGE_ME@127.0.0.1:5432/regos
```

### SQLite → PostgreSQL data cutover

1. Backup SQLite: copy `backend/data/regos.db` (and `-wal`/`-shm` if present) off-box.
2. Deploy code with `asyncpg`, update `.env` `DATABASE_URL` to Postgres.
3. Create empty schema: `cd /srv/RegosWholeSale/backend && .venv/bin/alembic upgrade head`
4. Stop writes: `sudo systemctl stop regos-backend`
5. Final SQLite backup, then copy data:

```bash
cd /srv/RegosWholeSale/backend
.venv/bin/python -m scripts.migrate_sqlite_to_postgres \
  --sqlite-path ./data/regos.db \
  --postgres-url "postgresql+asyncpg://regos:CHANGE_ME@127.0.0.1:5432/regos" \
  --force
```

`--force` truncates destination data tables first. Required after `alembic upgrade head` because migration 009 seeds permission rows.

6. Spot-check login / company count, then `sudo systemctl start regos-backend`
7. Keep the SQLite backup for a rollback window. Rollback: point `DATABASE_URL` back to the SQLite file and restart.

## Tenant frontend (regosoptom.uz + regosoptom.shop)
Shared static build — both domains serve `frontend/dist/client`.

Build (omit `VITE_API_BASE_URL` so each domain uses its own origin for `/api/`):
1. `cd frontend && VITE_DEPLOY_TARGET=nginx npm run build`
2. `sudo nginx -t && sudo systemctl reload nginx`
3. `sudo systemctl daemon-reload`
4. `sudo systemctl restart regos-backend`
5. `cd backend && alembic upgrade head`

Backend CORS (both domains):
- `CORS_ORIGINS=https://regosoptom.uz,https://www.regosoptom.uz,https://regosoptom.shop,https://www.regosoptom.shop,https://admin.regosoptom.uz`

### regosoptom.uz (direct / no Cloudflare)
1. `sudo cp deploy/regosoptom.uz.conf /etc/nginx/sites-available/regosoptom.uz.conf`
2. `sudo ln -sf /etc/nginx/sites-available/regosoptom.uz.conf /etc/nginx/sites-enabled/`

First-time SSL: use `deploy/regosoptom.uz.conf.bootstrap` → certbot → `regosoptom.uz.conf`.

### regosoptom.shop (Cloudflare proxy)
1. Cloudflare DNS: A/AAAA for `@` and `www` → server IP, **proxied** (orange cloud)
2. `sudo cp deploy/cloudflare-real-ip.conf /etc/nginx/snippets/cloudflare-real-ip.conf`
3. First-time SSL: `deploy/regosoptom.shop.conf.bootstrap` → certbot → `regosoptom.shop.conf`
4. `sudo ln -sf /etc/nginx/sites-available/regosoptom.shop.conf /etc/nginx/sites-enabled/`
5. Cloudflare SSL/TLS → **Full (strict)** after origin cert exists
6. `sudo nginx -t && sudo systemctl reload nginx`

## Platform admin (admin.regosoptom.uz)

### First-time SSL (cert does not exist yet)
Do **not** install `admin.regosoptom.uz.conf` first — nginx will fail because cert paths are missing.

1. `sudo cp deploy/admin.regosoptom.uz.conf.bootstrap /etc/nginx/sites-available/admin.regosoptom.uz.conf`
2. `sudo ln -sf /etc/nginx/sites-available/admin.regosoptom.uz.conf /etc/nginx/sites-enabled/`
3. `sudo mkdir -p /var/www/certbot/.well-known/acme-challenge && sudo chown -R www-data:www-data /var/www/certbot`
4. `sudo nginx -t && sudo systemctl reload nginx`
5. `sudo certbot certonly --webroot -w /var/www/certbot -d admin.regosoptom.uz --email you@example.com --agree-tos --no-eff-email`
6. `sudo cp deploy/admin.regosoptom.uz.conf /etc/nginx/sites-available/admin.regosoptom.uz.conf`
7. `sudo nginx -t && sudo systemctl reload nginx`

### Routine deploy (cert already exists)
1. `cd admin && npm ci && VITE_API_BASE_URL=https://regosoptom.uz npm run build`
2. `sudo nginx -t && sudo systemctl reload nginx` (only if nginx config changed)

## Backend env (first platform admin bootstrap)
Set in `backend/.env` before first deploy (only used when no platform admins exist):
- `PLATFORM_ADMIN_EMAIL=you@example.com`
- `PLATFORM_ADMIN_PASSWORD=your-secure-password`

Add admin subdomain to CORS:
- `CORS_ORIGINS=https://regosoptom.uz,https://www.regosoptom.uz,https://admin.regosoptom.uz`

## aserver.tech (Telegram webhooks + ScrapRegosUserBot payments + public shared documents)
1. `sudo cp deploy/aserver.tech /etc/nginx/sites-available/aserver.tech`
2. `sudo ln -sf /etc/nginx/sites-available/aserver.tech /etc/nginx/sites-enabled/`
3. `sudo nginx -t && sudo systemctl reload nginx`

Backend `backend/.env`:
- `PUBLIC_APP_BASE_URL=https://aserver.tech`
- Add `https://aserver.tech` to `CORS_ORIGINS`

ScrapRegosUserBot `.env` on server:
- `PUBLIC_BASE_URL=https://aserver.tech`
- `CLICK_RETURN_URL=https://aserver.tech/{order-uuid}` (example)
- CLICK merchant cabinet: `https://aserver.tech/click/prepare` and `/click/complete`

After moving payment routes off `no-thing.uz`, reload Partner Bot nginx:
- `sudo cp no-thing.uz.conf /etc/nginx/sites-available/no-thing.uz.conf && sudo nginx -t && sudo systemctl reload nginx`

python scripts\migrate_sqlite_to_postgres.py --sqlite-path .\data\regos.db --postgres-url postgresql+asyncpg://postgres:masterkey@127.0.0.1:5432/regos_wholesale