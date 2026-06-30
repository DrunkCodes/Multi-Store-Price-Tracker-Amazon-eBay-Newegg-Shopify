import type { LaunchOptions } from 'playwright';
import type { Page } from 'playwright';

/**
 * Best Buy (Akamai) via residential proxy often triggers ERR_HTTP2_PROTOCOL_ERROR in Chromium.
 * Disabling HTTP/2 and using domcontentloaded navigation is the standard workaround.
 * Residential US proxy (.env PROXY_*) is required for reliable access on Apify/local runs.
 */
export const BESTBUY_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const BESTBUY_CHROMIUM_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--disable-http2',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--window-size=1920,1080',
    '--disable-infobars',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
];

export function getBestBuyLaunchOptions(headless: boolean): LaunchOptions {
    return {
        headless,
        args: BESTBUY_CHROMIUM_ARGS,
    };
}

/** Preserve slug URLs; append skuId query param when missing. */
export function bestBuyProductUrl(productUrl: string): string {
    const skuMatch = productUrl.match(/\/(\d{5,})(?:\.p|\/|\?|$)/i);
    if (!skuMatch) return productUrl;

    const sku = skuMatch[1];
    if (/skuId=/i.test(productUrl)) return productUrl;
    if (/\.p(?:\/|\?|$)/i.test(productUrl)) {
        const joiner = productUrl.includes('?') ? '&' : '?';
        return `${productUrl}${joiner}skuId=${sku}`;
    }
    return productUrl;
}

export function bestBuyRetryDelayMs(retryCount: number): number {
    return 4_000 + retryCount * 3_000 + Math.floor(Math.random() * 2_000);
}

/** Akamai / bot interstitial markers — avoid generic terms that appear on real PDPs. */
export function isBestBuyBlocked(html: string, pageTitle: string, pageUrl?: string): boolean {
    const title = pageTitle.toLowerCase().trim();
    const lower = html.toLowerCase();
    const url = (pageUrl ?? '').toLowerCase();

    if (html.length < 2_000 && title.includes('access denied')) return true;
    if (title.includes('access denied') && !html.includes('product-schema')) return true;
    if (title.includes('attention required')) return true;
    if (title.includes('error page') && !html.includes('product-schema')) return true;
    if (url.includes('/identity/signin') && html.length < 5_000) return true;
    if (lower.includes('please verify you are a human')) return true;
    if (lower.includes('unusual traffic from your computer network')) return true;

    return false;
}

function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function prepareBestBuyPage(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        Referer: 'https://www.bestbuy.com/',
    });
    await page.addInitScript(() => {
        const nativeFetch = window.fetch.bind(window);
        (window as unknown as { __nativeFetch?: typeof fetch }).__nativeFetch = nativeFetch;

        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        (window as unknown as { chrome?: { runtime?: Record<string, unknown> } }).chrome = { runtime: {} };
    });
}

async function dismissBestBuyCookieBanner(page: Page): Promise<void> {
    for (const selector of [
        '#onetrust-accept-btn-handler',
        'button:has-text("Accept")',
        'button:has-text("Accept All")',
        '[data-testid="accept-cookies"]',
    ]) {
        await page.locator(selector).first().click({ timeout: 2_000 }).catch(() => undefined);
    }
}

async function ensureBestBuyUsStore(page: Page): Promise<void> {
    const title = (await page.title()).toLowerCase();
    if (title.includes('select your country') || title.includes('international')) {
        const usLink = page.locator('a:has-text("United States"), a[href*="bestbuy.com/?intl=nosplash"]').first();
        if (await usLink.count()) {
            await usLink.click({ timeout: 8_000 }).catch(() => undefined);
            await page.waitForLoadState('domcontentloaded', { timeout: 20_000 }).catch(() => undefined);
            await humanDelay(1_000, 2_000);
        }
    }

    await page.context().addCookies([
        { name: 'intl', value: 'nosplash', domain: '.bestbuy.com', path: '/' },
        { name: 'lmd', value: '0', domain: '.bestbuy.com', path: '/' },
    ]).catch(() => undefined);
}

async function warmBestBuyHomepage(page: Page): Promise<boolean> {
    await prepareBestBuyPage(page);
    try {
        await page.goto('https://www.bestbuy.com/?intl=nosplash', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (error) {
        console.log(`[bestbuy] homepage warm failed: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
    await ensureBestBuyUsStore(page);
    await dismissBestBuyCookieBanner(page);
    await humanDelay(1_500, 2_500);
    await page.mouse.move(300 + Math.random() * 200, 250 + Math.random() * 100);
    await page.mouse.wheel(0, 200 + Math.floor(Math.random() * 300));
    await humanDelay(800, 1_500);
    return true;
}

async function waitForBestBuyProductShell(page: Page): Promise<void> {
    await page
        .waitForSelector(
            'script#product-schema, [data-testid="customer-price"], .priceView-customer-price, .sku-title h1, h1',
            { timeout: 15_000 },
        )
        .catch(() => undefined);
    await page.locator('.sku-title h1, h1, [data-testid="customer-price"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await humanDelay(600, 1_200);
}

function extractTitleFromHtml(html: string): string {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() ?? '';
}

function hasBestBuyProductSignals(html: string): boolean {
    return (
        html.includes('product-schema') ||
        html.includes('productBySkuId') ||
        html.includes('customerPrice') ||
        html.includes('sku-title')
    );
}

async function navigateBestBuyProductViaJs(page: Page, url: string): Promise<{ html: string; pageTitle: string; pageUrl: string } | null> {
    try {
        await page.evaluate((target) => {
            window.location.href = target;
        }, url);
        await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
        await dismissBestBuyCookieBanner(page);
        await waitForBestBuyProductShell(page);
        const html = await page.content();
        const pageTitle = await page.title();
        const pageUrl = page.url();
        if (hasBestBuyProductSignals(html) && !isBestBuyBlocked(html, pageTitle, pageUrl)) {
            return { html, pageTitle, pageUrl };
        }
    } catch {
        // try next strategy
    }
    return null;
}

async function navigateBestBuyProductDirect(page: Page, url: string): Promise<{ html: string; pageTitle: string; pageUrl: string } | null> {
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await dismissBestBuyCookieBanner(page);
        await waitForBestBuyProductShell(page);
        const html = await page.content();
        const pageTitle = await page.title();
        const pageUrl = page.url();
        if (hasBestBuyProductSignals(html) && !isBestBuyBlocked(html, pageTitle, pageUrl)) {
            return { html, pageTitle, pageUrl };
        }
    } catch {
        // try next strategy
    }
    return null;
}

/** Optional ZenRows API fallback — set ZENROWS_API_KEY in .env to enable. */
export async function fetchBestBuyViaZenRows(productUrl: string): Promise<string | null> {
    const apiKey = process.env.ZENROWS_API_KEY?.trim();
    if (!apiKey) return null;

    const url = bestBuyProductUrl(productUrl);
    const zenrowsUrl = new URL('https://api.zenrows.com/v1/');
    zenrowsUrl.searchParams.set('apikey', apiKey);
    zenrowsUrl.searchParams.set('url', url);
    zenrowsUrl.searchParams.set('js_render', 'true');
    zenrowsUrl.searchParams.set('premium_proxy', 'true');
    zenrowsUrl.searchParams.set('proxy_country', 'us');
    zenrowsUrl.searchParams.set('wait', '5000');

    try {
        const response = await fetch(zenrowsUrl.toString(), { signal: AbortSignal.timeout(90_000) });
        if (!response.ok) return null;
        return await response.text();
    } catch {
        return null;
    }
}

function resultFromHtml(
    html: string,
    productPageUrl: string,
    strategy: BestBuyLoadStrategy,
): { html: string; pageTitle: string; pageUrl: string; strategy: BestBuyLoadStrategy } {
    return {
        html,
        pageTitle: extractTitleFromHtml(html),
        pageUrl: productPageUrl,
        strategy,
    };
}

/** XHR fallback when Best Buy hijacks window.fetch via tag-manager scripts. */
async function fetchBestBuyProductHtml(page: Page, productUrl: string): Promise<string | null> {
    const url = bestBuyProductUrl(productUrl);

    return page.evaluate(async (fetchUrl) => {
        const win = window as Window & { __nativeFetch?: typeof fetch };
        const nativeFetch = win.__nativeFetch;

        if (nativeFetch) {
            const text = await Promise.race([
                nativeFetch(fetchUrl, {
                    credentials: 'include',
                    headers: {
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                    },
                }).then((r) => (r.ok ? r.text() : null)),
                new Promise<string | null>((resolve) => {
                    setTimeout(() => resolve(null), 25000);
                }),
            ]);
            if (text) return text;
        }

        return Promise.race([
            new Promise<string | null>((resolve) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', fetchUrl, true);
                xhr.withCredentials = true;
                xhr.setRequestHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
                xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300 ? xhr.responseText : null);
                xhr.onerror = () => resolve(null);
                xhr.ontimeout = () => resolve(null);
                xhr.timeout = 25000;
                xhr.send();
            }),
            new Promise<string | null>((resolve) => {
                setTimeout(() => resolve(null), 26000);
            }),
        ]);
    }, url);
}

export type BestBuyLoadStrategy = 'zenrows' | 'in_page_fetch' | 'direct_navigation' | 'js_navigation';

export async function loadBestBuyProduct(
    page: Page,
    productUrl: string,
): Promise<{ html: string; pageUrl: string; pageTitle: string; strategy: BestBuyLoadStrategy }> {
    const productPageUrl = bestBuyProductUrl(productUrl);

    const zenrowsHtml = await fetchBestBuyViaZenRows(productUrl);
    if (zenrowsHtml && hasBestBuyProductSignals(zenrowsHtml) && !isBestBuyBlocked(zenrowsHtml, extractTitleFromHtml(zenrowsHtml), productPageUrl)) {
        console.log(`[bestbuy] strategy=zenrows ok ${productPageUrl}`);
        return resultFromHtml(zenrowsHtml, productPageUrl, 'zenrows');
    }

    await warmBestBuyHomepage(page);

    const fetched = await fetchBestBuyProductHtml(page, productUrl);
    if (fetched && hasBestBuyProductSignals(fetched) && !isBestBuyBlocked(fetched, extractTitleFromHtml(fetched), productPageUrl)) {
        console.log(`[bestbuy] strategy=in_page_fetch ok ${productPageUrl}`);
        return resultFromHtml(fetched, productPageUrl, 'in_page_fetch');
    }
    if (fetched && hasBestBuyProductSignals(fetched)) {
        console.log(`[bestbuy] strategy=in_page_fetch partial (blocked title) ${productPageUrl}`);
    } else {
        console.log(`[bestbuy] strategy=in_page_fetch failed ${productPageUrl}`);
    }

    const direct = await navigateBestBuyProductDirect(page, productPageUrl);
    if (direct) {
        console.log(`[bestbuy] strategy=direct_navigation ok ${productPageUrl}`);
        return { ...direct, strategy: 'direct_navigation' };
    }
    console.log(`[bestbuy] strategy=direct_navigation failed ${productPageUrl}`);

    const jsNav = await navigateBestBuyProductViaJs(page, productPageUrl);
    if (jsNav) {
        console.log(`[bestbuy] strategy=js_navigation ok ${productPageUrl}`);
        return { ...jsNav, strategy: 'js_navigation' };
    }
    console.log(`[bestbuy] strategy=js_navigation failed ${productPageUrl}`);

    if (fetched && hasBestBuyProductSignals(fetched)) {
        return resultFromHtml(fetched, productPageUrl, 'in_page_fetch');
    }

    throw new Error(`Failed to load Best Buy product page: ${productPageUrl}`);
}
