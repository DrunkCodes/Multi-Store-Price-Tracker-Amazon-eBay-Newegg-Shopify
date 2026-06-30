# Development guide

Technical documentation for contributors and local testing.  
The [README.md](README.md) is written for Apify Store users; this file is for developers.

## Requirements

- Node.js 22+
- npm
- Proxy credentials for local testing (optional but recommended for Amazon/eBay)

## Local setup

```bash
git clone https://github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify.git
cd Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify
npm install
cp .env.example .env   # add proxy credentials — never commit .env
npm run start:local    # reads local.input.json
```

Results: `output/local_results.json` (gitignored).

```powershell
$env:LOCAL_INPUT = 'local.input.json'
npm run start:local
```

## Build & deploy

```bash
npm run build
npm run start:prod     # production entry (dist/main.js)
```

Apify builds from GitHub using the root `Dockerfile` (`apify/actor-node-playwright:22`).  
Push to `main` → Apify rebuilds. Actor docs are extracted from `README.md`.

## Environment variables (`.env`)

| Variable | Purpose |
|----------|---------|
| `PROXY_HOST`, `PROXY_PORT`, `PROXY_USERNAME`, `PROXY_PASSWORD` | Local proxy |
| `PROXY_COUNTRY=us` | US routing (`__cr.us` for DataImpulse) |
| `EBAY_BROWSER` | `chromium` (default), `firefox`, or `auto` |
| `TWOCAPTCHA_API_KEY` | Optional captcha solving |

On Apify, set secrets in Console → Actor → Settings → Environment variables.

## Project structure

```
.actor/              Actor config, input/dataset schemas
src/
  main.ts            Apify entry point
  localMain.ts       Local runner
  runner.ts          Playwright + Crawlee orchestration
  captcha/           2Captcha detection and injection
  parsers/           Platform HTML/JSON parsers
  search/            Keyword SERP builders
  platforms/         eBay, Walmart, Target, Best Buy helpers
Dockerfile           Apify container build
```

## Supported platforms (code vs production)

**Production-marketed:** Amazon, eBay, Newegg, Shopify  

**In codebase (experimental):** Walmart, Target, Best Buy, Home Depot, Costco, Etsy, Wayfair, Kohl's, generic

## 2Captcha integration

When `TWOCAPTCHA_API_KEY` is set, the runner attempts to solve reCAPTCHA v2/v3, hCaptcha, and Turnstile before proxy retry. PerimeterX and Akamai behavioral challenges are not solvable via 2Captcha.

## Contributing

1. Fork the repo  
2. Branch → change → `npm run build` → test locally  
3. Open a PR — no credentials or scraped personal data  

## License

ISC — see [LICENSE](LICENSE).
