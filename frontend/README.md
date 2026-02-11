# VeggieForecast Frontend

This frontend is prepared for static deployment on Cloudflare Pages.

## Local Development

```bash
npm install
npm run dev
```

## Build

The build now generates static dashboard data from the CSV files in the workspace root:

```bash
npm run build
```

What `npm run build` does:
1. Runs `npm run generate:data` to create `public/data/dashboard-data.json`.
2. Runs `vite build` to produce `dist/`.

## Cloudflare Pages Deployment

### Option 1: Cloudflare Dashboard
1. Connect your repo in Cloudflare Pages.
2. Set the project root directory to `frontend`.
3. Set build command to:
   - `npm run build`
4. Set build output directory to:
   - `dist`
5. Set environment variable:
   - `NODE_VERSION=22.16.0` (or any Node `>=20.19.0`)
6. If Cloudflare asks for a build system version:
   - Prefer `v3` (default Node 22), or keep `NODE_VERSION` pinned when using `v2`.

### Option 2: Wrangler CLI
```bash
npm install
npm run build
npx wrangler pages deploy dist
```

`wrangler.toml` is included with `pages_build_output_dir = "./dist"`.

## Notes

- The app no longer depends on the Python backend for runtime API calls.
- SPA navigation is supported via `public/_redirects`.
- Cache and security headers are configured in `public/_headers`.
- Vite `7.x` requires Node `^20.19.0 || >=22.12.0`.
