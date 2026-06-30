# Multi-Store Price Tracker — Amazon, eBay, Newegg & Shopify

[![Apify Actor](https://img.shields.io/badge/Apify-Actor-00D4AA?style=flat-square&logo=apify&logoColor=white)](https://apify.com/actors)
[![Playwright](https://img.shields.io/badge/Playwright-Browser%20Automation-45ba4b?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue?style=flat-square)](LICENSE)

**Open-source Apify Actor** for monitoring product **prices** and **stock** across four major retail platforms. Schedule runs, build price history, and get alerts when prices drop or items restock.

> Built with [Playwright](https://playwright.dev/) + [Crawlee](https://crawlee.dev/). Production-tested on **Amazon**, **eBay**, **Newegg**, and **Shopify**.

---

## Table of contents

- [Features](#features)
- [Supported platforms](#supported-platforms)
- [Quick start](#quick-start)
- [Input & output](#input--output)
- [Alerts & scheduling](#alerts--scheduling)
- [Local development](#local-development)
- [Deploy to Apify](#deploy-to-apify)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Features

| Capability | Description |
|------------|-------------|
| **Multi-store monitoring** | One Actor, four platforms — paste URLs or search by keyword |
| **Change detection** | Compares each run to the previous scrape (Apify Key-Value Store) |
| **Price history** | Min, max, average, and data-point count over time |
| **Smart alerts** | Price drop %, any price change, stock change, back-in-stock |
| **Rich product data** | Title, brand, seller, ratings, images, description, and more |
| **Keyword search** | Amazon, eBay, or Newegg → scrape full details from SERP results |
| **Proxy-ready** | US residential proxy recommended; works with Apify Proxy or custom providers |

---

## Supported platforms

| Platform | URLs | Keyword search | Extracted data |
|----------|:----:|:--------------:|----------------|
| **Amazon** | ✅ | ✅ | Price, stock, seller, ratings, reviews, brand, images, shipping |
| **eBay** | ✅ | ✅ | Price, stock, seller, condition, ratings, shipping |
| **Newegg** | ✅ | ✅ | Price, sale/was price, stock, product ID, ratings |
| **Shopify** | ✅ | — | Price, compare-at, variants, stock, images (`/products/` URLs) |

**Shopify:** Works on any public Shopify store product URL — classic and headless themes.

**Proxy tip:** Use **US residential** proxy for Amazon and eBay. Newegg and Shopify often work with lighter proxy settings.

---

## Quick start

### Run on Apify (recommended)

1. Import or create this Actor in [Apify Console](https://console.apify.com/actors)
2. Add product URLs in **Input**
3. Enable **Apify Proxy** → Residential, country **US**
4. **Run** — first run sets baseline; later runs detect changes
5. **Schedule** (e.g. daily) and connect **webhooks** for `alert: true` rows

### Clone & run locally

```bash
git clone https://github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify.git
cd Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify
npm install
cp .env.example .env          # add YOUR proxy credentials — never commit .env
npm run start:local           # uses local.input.json
```

Results are saved to `output/local_results.json` (gitignored).

---

## Input & output

### Example input

```json
{
  "startUrls": [
    { "url": "https://www.amazon.com/dp/B004YAVF8I" },
    { "url": "https://www.ebay.com/itm/146322838621" },
    { "url": "https://www.newegg.com/samsung-990-pro-2tb/p/N82E16820147796" },
    { "url": "https://www.gymshark.com/products/gymshark-crest-joggers-black-ss22" }
  ],
  "searches": [
    { "keyword": "wireless mouse", "platform": "amazon", "maxResults": 5 }
  ],
  "trackHistory": true,
  "alertOnPriceDrop": true,
  "priceDropThresholdPercent": 5,
  "maxConcurrency": 2,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "US"
  }
}
```

### Example output (abbreviated)

```json
{
  "url": "https://www.amazon.com/dp/B004YAVF8I",
  "platform": "amazon",
  "title": "Product Name",
  "currentPrice": 29.99,
  "originalPrice": 39.99,
  "currency": "USD",
  "inStock": true,
  "priceChanged": true,
  "priceChangePercent": -25.0,
  "alert": true,
  "alertReason": "Price dropped 25% (threshold: 5%)",
  "scrapedAt": "2026-06-30T12:00:00.000Z"
}
```

See [`.actor/input_schema.json`](.actor/input_schema.json) for all input fields and [`.actor/dataset_schema.json`](.actor/dataset_schema.json) for dataset views.

---

## Alerts & scheduling

1. Each URL is normalized (e.g. Amazon ASIN) for consistent storage keys
2. Previous scrape loads from the `price-history` Key-Value Store
3. Current scrape is parsed and compared
4. Alerts fire based on your thresholds (first run = baseline only, no alerts)

Connect **Apify webhooks** to Slack, email, Zapier, or any HTTP endpoint — filter rows where `alert === true`.

---

## Local development

| File | Purpose |
|------|---------|
| `local.input.json` | Product URLs and monitor settings |
| `.env` | Proxy credentials (**gitignored** — copy from `.env.example`) |
| `LOCAL_INPUT` | Optional env var to use a different input file |

```powershell
# Windows PowerShell
$env:LOCAL_INPUT = 'local.input.json'
npm run start:local
```

Optional env vars (see `.env.example`):

- `EBAY_BROWSER` — `chromium` (default), `firefox`, or `auto`
- `PROXY_HOST`, `PROXY_USERNAME`, `PROXY_PASSWORD`, `PROXY_COUNTRY=us`
- `TWOCAPTCHA_API_KEY` (or `CAPTCHA_API_KEY`) — optional 2Captcha client key for bot/captcha pages

---

## Deploy to Apify

```bash
npm run build
apify login
apify push
```

Uses Docker image `apify/actor-node-playwright:22` (Chromium + Firefox for optional eBay fallback).

**Suggested Apify Store title:** *Amazon, eBay, Newegg & Shopify Price & Stock Monitor*

---

## Security

- **Never commit `.env`** — it is listed in `.gitignore`
- Use `.env.example` as a template with placeholder values only
- No API keys or proxy passwords are stored in this repository
- If you fork this project, rotate any credentials you accidentally exposed
- Store **2Captcha** and **proxy** credentials in Apify **Secrets** or local `.env` only — never in git or public input fields when avoidable

### 2Captcha (optional, production bot bypass)

When retail sites serve **reCAPTCHA v2/v3**, **hCaptcha**, or **Cloudflare Turnstile**, the scraper can request a token from [2Captcha](https://2captcha.com) and inject it into the page before retrying extraction.

**Local setup**

```bash
# .env (copy from .env.example)
TWOCAPTCHA_API_KEY=your_2captcha_api_key
```

`CAPTCHA_API_KEY` is accepted as an alias. If the key is **not** set, behavior is unchanged — the Actor retries with proxy rotation as before.

**Apify setup (recommended)**

1. Apify Console → Actor → **Settings** → **Environment variables**
2. Add secret `TWOCAPTCHA_API_KEY` with your 2Captcha client key
3. Do **not** paste the key into public run input when secrets are available

Optional Actor input field `twoCaptchaApiKey` exists for ad-hoc runs; prefer secrets for scheduled production jobs.

**Supported captcha types**

| Type | 2Captcha support | Notes |
|------|------------------|-------|
| reCAPTCHA v2 | ✅ | Sitekey + page URL |
| reCAPTCHA v3 | ✅ | Sitekey, page URL, action |
| hCaptcha | ✅ | Sitekey + page URL |
| Cloudflare Turnstile | ✅ | When widget/sitekey is in DOM |
| Amazon image captcha | ❌ | Not implemented (ImageToText) |
| Amazon WAF | ❌ | Requires extra page params |
| PerimeterX (Walmart hold button) | ❌ | Behavioral — use proxy + navigation strategies |
| Akamai JS challenge (eBay/Best Buy) | ❌ | Cookie/session bypass, not token injection |

Logs prefix `[2captcha]` when solving is attempted, skipped (no key), or falls back to proxy retry.

---

## Contributing

Contributions are welcome — this repo is **public** as a way to give back to the community.

1. **Fork** the [repository](https://github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify)
2. **Create a branch** for your change
3. **Test locally** with `npm run build` and `npm run start:local`
4. **Open a pull request** with a clear description

Ideas that help:

- Parser improvements for the four supported platforms
- Better bot-detection handling
- Documentation and examples
- Bug fixes with reproducible test URLs

Please do **not** include real credentials, proxy URLs with passwords, or scraped personal data in PRs.

---

## Project structure

```
.actor/           Apify config, input schema, dataset views
src/
  main.ts         Apify entry point
  localMain.ts    Local runner (.env + local.input.json)
  runner.ts       Playwright crawler orchestration
  captcha/        2Captcha detection + solve integration
  parsers/        Platform HTML/JSON parsers
  search/         Keyword search builders
  platforms/      Platform-specific helpers
Dockerfile        apify/actor-node-playwright:22
local.input.json  Example input for local testing
```

---

## Legal & responsible use

This project collects **publicly available product page data** for legitimate monitoring and research. You are responsible for complying with each retailer's terms of service and applicable laws. Use reasonable request rates.

---

## License

[ISC](LICENSE) — free to use, modify, and distribute. Attribution appreciated.

---

**Repository:** [github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify](https://github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify)

If this project helped you, consider **starring the repo** so others can find it.
