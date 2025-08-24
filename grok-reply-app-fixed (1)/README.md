# Grok Reply App

Zero-code friendly app to draft and post smart replies on X (Twitter) using Grok‑4.
Single Docker image (Express serves the React build). Ready for Railway.

## Quick Deploy (Railway)
1) Push this folder to a GitHub repo named **grok-reply-app**.
2) In Railway: New Project → Deploy from GitHub → select your repo.
3) Add variables (exact names):
   - PORT=8080
   - SESSION_SECRET=(Generate)
   - X_CLIENT_ID=...
   - X_CLIENT_SECRET=...
   - X_REDIRECT_URI=https://YOUR-APP.up.railway.app/auth/x/callback
   - X_SCOPES=tweet.read users.read tweet.write offline.access
   - XAI_API_KEY=...
   - XAI_BASE_URL=https://api.x.ai/v1
   - XAI_MODEL=grok-4-0709
   - XAI_TOKEN_BUDGET_DAILY=1000000
   - WEB_ORIGIN=https://YOUR-APP.up.railway.app
4) In X Dev Portal: set Callback to https://YOUR-APP.up.railway.app/auth/x/callback; Website URL same.
5) Open your Railway URL → Connect X → paste 20–50 handles/tags → Generate → Post.

## Local Dev
- Requires Node 20+
- Build and run:
  ```bash
  cd web && npm i && npm run build
  cd ../server && npm i && npm run dev
  # Open http://localhost:8080
  ```
- Or Docker:
  ```bash
  docker build -t grok-reply-app .
  docker run --rm -p 8080:8080 --env-file .env grok-reply-app
  ```
