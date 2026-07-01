# Track prices on Amazon, eBay, Newegg & Shopify

Stop refreshing product pages manually. This Actor watches your products for **price changes**, **stock changes**, and **restocks** — then saves the results and flags what matters.

Works on **Amazon**, **eBay**, **Newegg**, and **Shopify** product pages.

---

## Who is this for?

- **Deal hunters** waiting for a price drop  
- **Sellers** tracking competitors  
- **Dropshippers** monitoring source costs  
- **Researchers** building price datasets  

---

## What you get

Every run checks each product and returns:

- Current **price** and **was price**  
- **In stock** or out of stock  
- **Price changed?** and by how much (%)  
- **Alert** flag when something important happened  
- **Price history** (low / high / average) over time  
- Title, seller, ratings, reviews, and images when available  

Rows with **alert = true** are the ones worth acting on — price drops, restocks, or stock changes you configured.

---

## Alerts & webhooks

When a run finds a meaningful change, the product row gets **alert = true**. Use that to notify yourself or pipe data elsewhere:

1. Open your Actor → **Integrations** → **Add webhook**.  
2. Trigger on **Actor run succeeded**.  
3. In the payload filter or downstream step, keep only dataset items where **alert** is true.  
4. Send to **Slack**, **email**, **Google Sheets**, **Zapier**, or any HTTP endpoint.

**Tip:** Schedule daily runs so alerts compare today’s prices against yesterday’s baseline.

---

## Supported stores

| Store | Product URL | Search by keyword |
|-------|:-----------:|:-----------------:|
| Amazon | ✅ | ✅ |
| eBay | ✅ | ✅ |
| Newegg | ✅ | ✅ |
| Shopify | ✅ | — |

For Shopify, paste the product link from any store (`/products/…` in the URL).

---

## How to run it

1. **Input → Product page URLs** — paste the links you want to watch.  
2. **Optional:** add **Keyword searches** to find products on Amazon, eBay, or Newegg.  
3. **Proxy settings** — keep **Residential** + **United States** (default).  
4. Click **Start**.  
5. Run again later (or **Schedule** daily) to detect changes.  

**Important:** The **first run** only saves baseline prices — **alerts start on the second run**.

---

## Input quick guide

| Field | What to do |
|-------|------------|
| **Product page URLs** | Paste Amazon / eBay / Newegg / Shopify product links |
| **Keyword searches** | Optional — search a store and track top results |
| **Save price history** | Leave on to track min/max/avg prices |
| **Alert when price drops** | Leave on; set **Minimum price drop %** (e.g. 5) |
| **Alert when back in stock** | Leave on if you want restock notifications |
| **Proxy settings** | Use US Residential (default) |

**Recommended run settings:** **2 GB memory**, **15 min timeout** (set automatically for new runs).

---

## Example workflows

**Catch a deal on Amazon**  
Add the `/dp/…` URL → set 5% drop threshold → schedule once per day.

**Track a competitor on eBay**  
Add their listing URLs → enable “Alert on any price change”.

**Monitor PC parts on Newegg**  
Search “Samsung SSD” or paste part URLs directly.

**Watch a Shopify brand**  
Add that store’s `/products/…` links.

---

## FAQ

**Why no alert the first time?**  
Nothing to compare yet. Run it at least twice.

**Do I need my own proxies?**  
No — enable Apify Proxy (US Residential) in Input.

**Can I monitor any Shopify store?**  
Yes, with a public product URL.

---

## Tips

- Start with **5–10 products**, then scale up.  
- **Schedule** daily or twice daily for best results.  
- Filter your dataset for **alert = true** to see only changes that matter.  

---

Questions? Visit our [GitHub repo](https://github.com/DrunkCodes/Multi-Store-Price-Tracker-Amazon-eBay-Newegg-Shopify).

Use responsibly and follow each store’s terms of service.
