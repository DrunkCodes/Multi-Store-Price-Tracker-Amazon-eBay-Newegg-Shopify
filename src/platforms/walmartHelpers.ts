import type { LaunchOptions } from 'playwright';
import type { Page } from 'playwright';

/** Realistic Chrome UA — reduces headless fingerprint mismatches on Walmart. */
export const WALMART_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Chromium flags that reduce automation signals for PerimeterX. */
export const WALMART_CHROMIUM_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-infobars',
    '--window-size=1920,1080',
    '--start-maximized',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
];

export function getWalmartLaunchOptions(headless: boolean): LaunchOptions {
    return {
        headless,
        args: WALMART_CHROMIUM_ARGS,
    };
}

export type WalmartLoadStrategy = 'zenrows' | 'in_page_fetch' | 'category_navigation' | 'direct_navigation';

/**
 * Walmart bot/challenge markers (Akamai + HUMAN Security).
 * Avoid generic terms like "perimeterx" — Walmart CSP lists those domains on real PDPs.
 */
export function isWalmartBlocked(html: string, pageTitle: string, pageUrl?: string): boolean {
    const title = pageTitle.toLowerCase();
    const lower = html.toLowerCase();
    const url = (pageUrl ?? '').toLowerCase();

    if (url.includes('/blocked')) return true;
    if (title.includes('robot or human')) return true;
    if (lower.includes('activate and hold the button')) return true;
    if (lower.includes('verify you are human')) return true;
    if (title.includes('access denied') && url.includes('walmart.com')) return true;

    return false;
}

export function walmartProductUrl(productUrl: string): string {
    const itemId = productUrl.match(/\/(\d+)(?:\?|$|\/)/)?.[1];
    return itemId ? `https://www.walmart.com/ip/${itemId}` : productUrl;
}

export function walmartRetryDelayMs(retryCount: number): number {
    return 6_000 + retryCount * 4_000 + Math.floor(Math.random() * 3_000);
}

function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Apply browser fingerprint tweaks before navigating to Walmart. */
export async function prepareWalmartPage(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        Referer: 'https://www.walmart.com/',
    });
}

async function warmWalmartHomepage(page: Page): Promise<void> {
    await prepareWalmartPage(page);
    await page.goto('https://www.walmart.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await humanDelay(2_500, 4_500);
    await page.mouse.move(400 + Math.random() * 200, 300 + Math.random() * 100);
    await page.mouse.wheel(0, 250 + Math.floor(Math.random() * 200));
    await humanDelay(1_000, 2_000);
}

/**
 * Fetch product HTML via in-page fetch() from walmart.com origin (cookies included).
 * PerimeterX often blocks CDP page.goto to product URLs but allows same-origin fetch.
 */
export async function fetchWalmartProductHtml(page: Page, productUrl: string): Promise<string | null> {
    const url = walmartProductUrl(productUrl);

    await warmWalmartHomepage(page);

    const html = await page.evaluate(async (fetchUrl) => {
        const response = await fetch(fetchUrl, {
            credentials: 'include',
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        if (!response.ok) return null;
        return response.text();
    }, url);

    return html;
}

/** Browse homepage → electronics category → product (mimics natural shopper path). */
export async function navigateWalmartViaCategory(page: Page, productUrl: string): Promise<void> {
    await warmWalmartHomepage(page);

    await page.goto('https://www.walmart.com/browse/electronics/computers/3944_3951_132959', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
    });
    await humanDelay(2_000, 3_500);
    await page.mouse.wheel(0, 400);
    await humanDelay(800, 1_500);

    const url = walmartProductUrl(productUrl);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForWalmartProductShell(page);
}

/**
 * Navigate directly to the product page (single navigation).
 * PerimeterX often blocks a second full page.goto after homepage warm-up in CDP browsers.
 */
export async function navigateWalmartProduct(page: Page, productUrl: string): Promise<void> {
    await prepareWalmartPage(page);

    const url = walmartProductUrl(productUrl);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForWalmartProductShell(page);
}

async function waitForWalmartProductShell(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
    await page
        .waitForSelector('script#__NEXT_DATA__, h1[itemprop="name"], [data-automation="product-title"], h1', {
            timeout: 30_000,
        })
        .catch(() => undefined);

    await page.mouse.wheel(0, 400);
    await page.locator('h1, [data-automation="product-title"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await humanDelay(1_500, 2_500);
}

/** Optional ZenRows API fallback — set ZENROWS_API_KEY in .env to enable. */
export async function fetchWalmartViaZenRows(productUrl: string): Promise<string | null> {
    const apiKey = process.env.ZENROWS_API_KEY?.trim();
    if (!apiKey) return null;

    const url = walmartProductUrl(productUrl);
    const zenrowsUrl = new URL('https://api.zenrows.com/v1/');
    zenrowsUrl.searchParams.set('apikey', apiKey);
    zenrowsUrl.searchParams.set('url', url);
    zenrowsUrl.searchParams.set('js_render', 'true');
    zenrowsUrl.searchParams.set('premium_proxy', 'true');
    zenrowsUrl.searchParams.set('proxy_country', 'us');

    try {
        const response = await fetch(zenrowsUrl.toString(), { signal: AbortSignal.timeout(90_000) });
        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}

function extractTitleFromHtml(html: string): string {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() ?? '';
}

function resultFromHtml(html: string, productPageUrl: string, strategy: WalmartLoadStrategy) {
    return {
        html,
        pageTitle: extractTitleFromHtml(html),
        pageUrl: productPageUrl,
        strategy,
    };
}

/**
 * Load Walmart product page — tries multiple PerimeterX bypass strategies in order.
 * 1. ZenRows API (if ZENROWS_API_KEY set)
 * 2. In-page fetch after homepage warm-up
 * 3. Homepage → category browse → product
 * 4. Direct PDP navigation
 */
export async function loadWalmartProduct(
    page: Page,
    productUrl: string,
): Promise<{ html: string; pageUrl: string; pageTitle: string; strategy: WalmartLoadStrategy }> {
    const productPageUrl = walmartProductUrl(productUrl);

    const zenrowsHtml = await fetchWalmartViaZenRows(productUrl);
    if (zenrowsHtml && !isWalmartBlocked(zenrowsHtml, extractTitleFromHtml(zenrowsHtml), productPageUrl)) {
        console.log(`[walmart] strategy=zenrows ok ${productPageUrl}`);
        return resultFromHtml(zenrowsHtml, productPageUrl, 'zenrows');
    }

    const fetched = await fetchWalmartProductHtml(page, productUrl);
    if (fetched && !isWalmartBlocked(fetched, extractTitleFromHtml(fetched), productPageUrl)) {
        console.log(`[walmart] strategy=in_page_fetch ok ${productPageUrl}`);
        return resultFromHtml(fetched, productPageUrl, 'in_page_fetch');
    }
    if (fetched) {
        console.log(`[walmart] strategy=in_page_fetch blocked ${productPageUrl}`);
    } else {
        console.log(`[walmart] strategy=in_page_fetch failed (null/non-200) ${productPageUrl}`);
    }

    await navigateWalmartViaCategory(page, productUrl);
    let html = await page.content();
    let pageTitle = await page.title();
    let pageUrl = page.url();

    if (!isWalmartBlocked(html, pageTitle, pageUrl)) {
        console.log(`[walmart] strategy=category_navigation ok ${productPageUrl}`);
        return { html, pageTitle, pageUrl, strategy: 'category_navigation' };
    }
    console.log(`[walmart] strategy=category_navigation blocked ${productPageUrl}`);

    await navigateWalmartProduct(page, productUrl);
    html = await page.content();
    pageTitle = await page.title();
    pageUrl = page.url();

    console.log(`[walmart] strategy=direct_navigation ${isWalmartBlocked(html, pageTitle, pageUrl) ? 'blocked' : 'ok'} ${productPageUrl}`);
    return { html, pageTitle, pageUrl, strategy: 'direct_navigation' };
}
