# Algerian Vegetables Data Forecast

Full-stack price forecasting app:
- `frontend/`: React + Vite dashboard (Cloudflare Pages-ready)
- `backend/`: FastAPI API (optional if you want API mode)

## Repository Layout

- `frontend/`: UI, static data build script, Cloudflare config
- `backend/main.py`: API endpoints (`/api/products`, `/api/data/{product}`, `/api/chat`)
- `extracted_prices.csv`: historical monthly data
- `predictions_2026.csv`: prediction data

## Quick Start (Local)

### 1) Backend (FastAPI)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
# copy backend/.env.example to backend/.env and fill keys
python main.py
```

Backend runs on `http://localhost:8000`.

### 2) Frontend (Vite)

```bash
cd frontend
npm install
# set VITE_API_BASE_URL if backend is not localhost:8000
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Cloudflare Pages Deployment (Frontend)

In Cloudflare Pages project settings:
1. Root directory: `frontend`
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Environment variable: `NODE_VERSION=22.16.0` (or Node `>=20.19.0`)
5. Build system: prefer `v3`

Important:
- Cloudflare Pages deploys the static frontend only.
- The backend API must be deployed separately (for example on Render/Railway/Fly/VM) if you need live API endpoints.

Fallback if Pages is configured to build from repository root:
- Build command: `npm run build`
- Build output directory: `frontend/dist`
- This repository includes a root `package.json` and `wrangler.toml` so root builds work.

## Backend Data Path Configuration

`backend/main.py` reads CSV paths from env vars if provided:
- `HISTORICAL_FILE` (default: `./extracted_prices.csv`)
- `PREDICTIONS_FILE` (default: `./predictions_2026.csv`)

You can set relative or absolute paths.

## AI Chatbot Configuration

The chatbot is integrated into the dashboard next to the chart and uses:
- Local CSV price history and predictions (always included in reasoning)
- OpenRouter for answer generation
- Firecrawl for fresh web factors (weather, policy, market signals)

Backend environment variables:
- `OPENROUTER_API_KEY` (required for LLM responses)
- `FIRECRAWL_API_KEY` (optional but recommended for web context)
- `OPENROUTER_MODEL` (default: `stepfun/step-3.5-flash:free`)
- `OPENROUTER_FALLBACK_MODELS` (default: `openrouter/free`)
- `AI_HTTP_TIMEOUT_SECONDS` (default: `30`)

Frontend environment variable:
- `VITE_API_BASE_URL` (default: `http://localhost:8000`)

Important for Cloudflare Pages:
- If you use Cloudflare Pages Functions (`frontend/functions/api/chat.js`), leave `VITE_API_BASE_URL` empty so frontend uses same-origin `/api/chat`.
- If you use an external backend, set `VITE_API_BASE_URL` to that backend URL (for example `https://your-backend.example.com`).
- Never use `localhost` for hosted deployments, or each visitor browser will try their own machine.

## Cloudflare Pages Chat Env Vars

For Pages-hosted chat (`/api/chat` function), set these as Cloudflare Pages environment variables:
- `OPENROUTER_API_KEY`
- `FIRECRAWL_API_KEY`
- `OPENROUTER_MODEL` (optional, default: `stepfun/step-3.5-flash:free`)
- `OPENROUTER_FALLBACK_MODELS` (optional, default: `openrouter/free`)

Cloudflare project routing checks:
- If Pages Root directory is `frontend`, function path is `frontend/functions/api/chat.js`.
- If Pages Root directory is repository root, function path is `functions/api/chat.js` (wrapper file included in this repo).
- Ensure `_redirects` keeps API routes before SPA fallback:
  - `/api/* /api/:splat 200`
  - `/* /index.html 200`
