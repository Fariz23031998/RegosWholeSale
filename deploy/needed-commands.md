# Deploy commands

## Tenant frontend (regosoptom.uz)
1. `cd frontend && VITE_DEPLOY_TARGET=nginx VITE_API_BASE_URL=https://regosoptom.uz npm run build`
2. `sudo nginx -t && sudo systemctl reload nginx`
3. `sudo systemctl daemon-reload`
4. `sudo systemctl restart regos-backend`
5. `cd backend && alembic upgrade head`

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
