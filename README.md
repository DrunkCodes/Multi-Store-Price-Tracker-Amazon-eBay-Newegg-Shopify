# Amazon, eBay, Newegg & Shopify Price & Stock Monitor

**Never miss a price drop or restock again.**

Track products across **Amazon**, **eBay**, **Newegg**, and **Shopify** stores in one place. Paste product links (or search by keyword), run on a schedule, and get clear alerts when prices fall or items come back in stock.

Ideal for **deal hunters**, **online sellers**, **dropshippers**, and **market researchers** who need reliable, hands-off monitoring — not manual checking every day.

---

## What this Actor does

- **Checks current price and stock** on each product URL you provide  
- **Compares every run to the last one** so you see what changed  
- **Builds price history** (lowest, highest, average over time)  
- **Flags important events** — price drops, restocks, and stock-outs  
- **Exports structured data** you can send to Slack, email, Google Sheets, or Zapier  

Works with **direct product links** or **keyword search** on Amazon, eBay, and Newegg. For Shopify, paste any store’s `/products/…` link.

---

## Supported stores

| Store | Paste product URL | Search by keyword |
|-------|:-----------------:|:-----------------:|
| **Amazon** | ✅ | ✅ |
| **eBay** | ✅ | ✅ |
| **Newegg** | ✅ | ✅ |
| **Shopify** | ✅ (any Shopify store) | — |

**Data you get:** product title, current price, was/original price, discount %, in-stock status, seller, ratings, reviews, images, and more — depending on the store.

---

## How to get started (5 minutes)

1. Open the **Input** tab and add your **product URLs** (one link per row).  
2. Turn on **Apify Proxy** → choose **Residential** and country **United States** (recommended for Amazon and eBay).  
3. Click **Start** — the first run saves a baseline (no alerts yet).  
4. Run again later (or **Schedule** daily/hourly) — the second run detects changes.  
5. Open the **Dataset** tab — filter rows where **Alert** is `true` for deals and restocks.

**Tip:** Schedule the Actor to run once or twice per day. Price history and alerts improve over time.

---

## Input settings (plain English)

| Setting | What it means | Suggested value |
|---------|----------------|-----------------|
| **Product URLs** | Links to product pages you want to watch | Your Amazon/eBay/Newegg/Shopify URLs |
| **Keyword searches** | Search a store and monitor top results | e.g. “wireless mouse” on Amazon |
| **Track price history** | Remember past prices between runs | On |
| **Alert on price drop** | Notify when price falls | On |
| **Price drop threshold (%)** | How big a drop counts as an alert | `5` = alert on 5%+ drop |
| **Alert on stock change** | Notify when availability changes | On |
| **Alert when back in stock** | Notify when an OOS item returns | On |
| **Max concurrent requests** | How many pages at once | `1–2` for large lists |
| **Proxy configuration** | Helps avoid blocks on big retailers | US Residential |

---

## What you receive (output)

Each product becomes one row in your dataset, including:

- **Title**, **price**, **was price**, **currency**  
- **In stock** (yes/no)  
- **Price changed?** and **how much** (%)  
- **Stock changed?**  
- **Alert** and **alert reason** (e.g. “Price dropped 12%”)  
- **Price history** stats (min / max / average)  
- **Seller**, **rating**, **review count**, **images** (when available)  

Connect **webhooks** in Apify to push only alert rows to Slack, Discord, email, or your own system.

---

## Example use cases

| You want to… | How to use this Actor |
|--------------|------------------------|
| Catch Amazon deals | Add `/dp/…` URLs, set 5% drop threshold, schedule daily |
| Track competitor eBay prices | Add competitor listing URLs, enable “any price change” |
| Monitor Newegg PC parts | Add part URLs or search “RTX 4070”, max 10 results |
| Watch a Shopify brand | Add `/products/…` URLs from that store |
| Get Slack notifications | Webhook on dataset items where `alert` is true |

---

## Recommended setup for best results

- **Use US residential proxy** for Amazon and eBay (enabled by default in input).  
- **Start with a small list** (5–10 URLs), confirm results, then scale up.  
- **Run at least twice** before expecting alerts — the first run only establishes baseline prices.  
- **Optional:** add a **2Captcha** API key in Actor **Secrets** if you hit captcha pages on heavily protected listings (advanced; not required for most runs).

---

## Keyword search mode

Instead of pasting URLs, you can search:

- **Amazon** — e.g. “airpods pro”  
- **eBay** — e.g. “vintage camera”  
- **Newegg** — e.g. “Samsung SSD”  

Set **max products per keyword** to control how many search results are scraped (default 10, max 50).

---

## FAQ

**Why no alert on the first run?**  
There’s nothing to compare yet. Alerts start from the second run onward.

**Does it work on any Shopify store?**  
Yes — paste the public product URL (`https://store.com/products/…`).

**Do I need my own proxies?**  
Apify Proxy (US residential) is recommended and works out of the box. Power users can configure custom proxies in input.

**Is this legal?**  
The Actor reads publicly visible product page information. You are responsible for following each store’s terms and applicable laws.

---

## Open source

This Actor is [open source on GitHub](https://github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify). Contributions and stars are welcome.

Developers: see [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, architecture, and contribution guide.

---

## License

[ISC](LICENSE) — free to use and modify. Use responsibly.
