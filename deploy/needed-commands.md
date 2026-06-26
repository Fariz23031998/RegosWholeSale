# Deploy commands

## Tenant frontend (regosoptom.uz)
1. `cd frontend && VITE_DEPLOY_TARGET=nginx VITE_API_BASE_URL=https://regosoptom.uz npm run build`
2. `sudo nginx -t && sudo systemctl reload nginx`
3. `sudo systemctl daemon-reload`
4. `sudo systemctl restart regos-backend`
5. `cd backend && alembic upgrade head`

## Platform admin (admin.regosoptom.uz)
1. `cd admin && npm ci && VITE_API_BASE_URL=https://regosoptom.uz npm run build`
2. Copy `deploy/admin.regosoptom.uz.conf` to nginx sites-enabled
3. `sudo certbot certonly --nginx -d admin.regosoptom.uz` (first time only)
4. `sudo nginx -t && sudo systemctl reload nginx`

## Backend env (first platform admin bootstrap)
Set in `backend/.env` before first deploy (only used when no platform admins exist):
- `PLATFORM_ADMIN_EMAIL=you@example.com`
- `PLATFORM_ADMIN_PASSWORD=your-secure-password`

Add admin subdomain to CORS:
- `CORS_ORIGINS=https://regosoptom.uz,https://www.regosoptom.uz,https://admin.regosoptom.uz`
