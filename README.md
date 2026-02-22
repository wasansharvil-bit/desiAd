# DesiAd AI – Regional Business Ad Generator

Generate WhatsApp and Instagram-ready promotional content for Indian small businesses using Sarvam AI, with a free static frontend (GitHub Pages) and a serverless backend (Cloudflare Worker). API keys stay on the backend.

## Folder structure
- frontend/ — static site (HTML/CSS/JS) for GitHub Pages
- backend/worker.js — Cloudflare Worker proxy to Sarvam AI
- wrangler.toml — Worker config
- .env.example — env template for local dev / secrets

## Prerequisites
- Sarvam AI API key (free tier) from https://platform.sarvam.ai/
- Node.js 18+ (for Wrangler CLI)
- Cloudflare account with Workers enabled (free)

## Backend: Cloudflare Worker
1. Copy `.env.example` to `.env` (optional for local dev) and set `SARVAM_API_KEY`.
2. Install Wrangler: `npm install -g wrangler`
3. Dev test: `wrangler dev` (binds vars from `.env` automatically)
4. Publish: `wrangler publish`

The Worker exposes `POST /generate-ad` and forwards to Sarvam AI with model `sarvam-m`, enforcing JSON-only output. CORS is allowed from `ALLOWED_ORIGIN` (comma-separated; `*` for any).

## Frontend: GitHub Pages
1. Point `frontend/script.js` `API_BASE` to your Worker URL (e.g., `https://desiad-ai.yourname.workers.dev`).
2. Commit and push the repo to GitHub.
3. In GitHub repo settings → Pages, select branch `main` (or default) and folder `/frontend`.
4. Wait for Pages to deploy; the site will load from `https://<user>.github.io/<repo>/`.
5. Set `ALLOWED_ORIGIN` in the Worker to that Pages URL and republish.

## API contract
`POST /generate-ad`
```json
{
  "businessName": "Rani's Boutique",
  "businessType": "Clothing Store",
  "city": "Pune",
  "offer": "Festive sale – up to 30% off",
  "language": "Hindi",
  "tone": "Festive"
}
```
Response (from Worker):
```json
{
  "whatsapp": "...",
  "instagram": "...",
  "poster_headline": "...",
  "hashtags": "..."
}
```

## Sample curl (after `wrangler dev`)
```bash
curl -X POST http://127.0.0.1:8787/generate-ad \
  -H "Content-Type: application/json" \
  -d '{"businessName":"Rani Boutique","businessType":"Clothing Store","city":"Pune","offer":"Festive sale – up to 30% off","language":"Hindi","tone":"Festive"}'
```

## Notes
- API key is only read by the Worker via env binding `SARVAM_API_KEY` and never sent to the browser.
- CORS: set `ALLOWED_ORIGIN` to your Pages origin for production. Use `*` only if you accept any origin.
- Model: `sarvam-m` (multilingual). Temperature/top_p are modest for concise ads.

## Troubleshooting
- 401/403 from Sarvam: verify `SARVAM_API_KEY`.
- CORS errors in browser: ensure `ALLOWED_ORIGIN` matches the exact Pages origin and republish the Worker.
- Broken layout on mobile: ensure CDN is serving latest `styles.css` and cache is cleared.
