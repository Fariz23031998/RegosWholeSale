 1. VITE_DEPLOY_TARGET=nginx VITE_API_BASE_URL=https://regosoptom.uz npm run build
 2. sudo nginx -t && sudo systemctl reload nginx
 3. sudo systemctl daemon-reload
 4. sudo systemctl restart regos-backend