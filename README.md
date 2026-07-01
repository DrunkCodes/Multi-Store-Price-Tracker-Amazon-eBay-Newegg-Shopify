# Amazon, eBay, Newegg & Shopify Price & Stock Monitor

**Never miss a price drop or restock again.**

Track products across **Amazon**, **eBay**, **Newegg**, and **Shopify** in one place. Paste product links (or search by keyword), run on a schedule, and get clear alerts when prices fall or items come back in stock.

Perfect for **deal hunters**, **online sellers**, **dropshippers**, and **market researchers** who want hands-off monitoring — not checking sites manually every day.

---

## What this Actor does

- **Checks current price and stock** on each product you add  
- **Compares every run to the last one** so you see exactly what changed  
- **Builds price history** — lowest, highest, and average price over time  
- **Sends clear alerts** for price drops, restocks, and stock-outs  
- **Exports ready-to-use data** for Slack, email, Google Sheets, or Zapier  

Add **direct product links** or **search by keyword** on Amazon, eBay, and Newegg. For Shopify, paste any store’s product page link.

---

## Supported stores

| Store | Product link | Search by keyword |
|-------|:------------:|:-----------------:|
| **Amazon** | ✅ | ✅ |
| **eBay** | ✅ | ✅ |
| **Newegg** | ✅ | ✅ |
| **Shopify** | ✅ | — |

**What you get per product:** title, current price, original/was price, discount %, in-stock status, seller, star rating, review count, product images, and more (varies by store).

---

## Get started in 5 minutes

1. Go to **Input** and paste your **product URLs** (one per line).  
2. Enable **Apify Proxy** → **Residential**, country **United States** (best for Amazon and eBay).  
3. Click **Start**. The first run saves today’s prices (baseline).  
4. Run again tomorrow — or **Schedule** daily/hourly runs — to detect changes.  
5. Open **Dataset** and look for rows where **Alert** is true — those are your deals and restocks.

**Tip:** Run at least twice before expecting alerts. The first run never alerts because there’s nothing to compare against yet.

---

## Input settings explained

| Setting | What it does | Recommended |
|---------|--------------|-------------|
| **Product URLs** | Pages you want to monitor | Your Amazon, eBay, Newegg, or Shopify links |
| **Keyword searches** | Find products by search term, then track them | e.g. “wireless mouse” on Amazon |
| **Track price history** | Remember prices between runs | ✅ On |
| **Alert on price drop** | Notify when price goes down | ✅ On |
| **Price drop threshold (%)** | Minimum drop to trigger an alert | **5** = alert on 5%+ drop |
| **Alert on stock change** | Notify when item goes in/out of stock | ✅ On |
| **Alert when back in stock** | Notify when a sold-out item returns | ✅ On |
| **Proxy** | Reduces blocks on major retailers | **US Residential** |

---

## What you get in the results

Every product appears as one row with:

- Product **title**, **price**, **was price**, **currency**  
- **In stock** — yes or no  
- **Price changed?** and **change %**  
- **Stock changed?**  
- **Alert** flag and **reason** (e.g. “Price dropped 12%”)  
- **Price history** — min, max, average  
- **Seller**, **rating**, **reviews**, **images** when available  

Use **webhooks** to send only alert rows to Slack, Discord, email, or your own app.

---

## Popular use cases

| Goal | How to set it up |
|------|------------------|
| Catch Amazon deals | Add product URLs, 5% drop threshold, schedule daily |
| Watch competitor prices on eBay | Add their listing URLs, turn on “any price change” |
| Track Newegg PC parts | Add part URLs or search “RTX 4070” |
| Monitor a Shopify brand | Add that store’s `/products/…` links |
| Slack notifications | Webhook → filter items where alert is true |

---

## Tips for reliable results

- Use **US residential proxy** for Amazon and eBay (default in input).  
- Start with **5–10 URLs**, check results, then add more.  
- **Schedule** the Actor — once or twice per day works well for most products.  
- If a listing shows a captcha rarely, add **`TWOCAPTCHA_API_KEY`** under Actor **Settings → Secrets** (optional; not in Input).

---

## Keyword search

Search instead of pasting URLs:

- **Amazon** — “airpods pro”, “gaming chair”, …  
- **eBay** — “vintage camera”, “limited edition”, …  
- **Newegg** — “Samsung SSD”, “RTX 4070”, …  

Choose how many top search results to track per keyword (default 10, up to 50).

---

## Frequently asked questions

**Why didn’t I get an alert on the first run?**  
The first run only records starting prices. Alerts begin on the second run and every run after.

**Can I monitor any Shopify store?**  
Yes — use the public product page URL from that store.

**Do I need to buy separate proxies?**  
No. Apify Proxy (US residential) works out of the box. Enable it in the Input tab.

**Is monitoring product prices allowed?**  
This tool reads publicly visible product information. You are responsible for following each store’s rules and local laws.

---

## Questions or feedback?

Open an issue on our [GitHub repository](https://github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify) — we’re happy to help.
