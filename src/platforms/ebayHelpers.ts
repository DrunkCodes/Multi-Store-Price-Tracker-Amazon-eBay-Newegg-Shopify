import type { LaunchOptions, Page } from 'playwright';

import type { ScrapedProduct } from '../types.js';

import {

    availabilityToInStock,

    extractJsonLdProducts,

    getMetaContent,

    parsePrice,

    parseRating,

} from '../utils.js';

import { parseReviewCount } from '../parsers/enrichment.js';



/** eBay bot/challenge page titles and body markers (Akamai splash UI). */

export function isEbayBlocked(html: string, pageTitle: string): boolean {

    const title = pageTitle.toLowerCase().trim();

    const lower = html.toLowerCase();



    const hasProductSignals =

        lower.includes('application/ld+json') ||

        lower.includes('x-item-title') ||

        lower.includes('og:title') ||

        /\/itm\/\d+/.test(lower);



    // Valid listing pages use "| eBay" in the title — do not treat Akamai CDN refs as blocks.

    if (hasProductSignals && title.includes('| ebay')) return false;



    const titleSignals = [

        'error page',

        '403 forbidden',

        'access denied',

        'pardon our interruption',

        'security measure',

        'please verify yourself',

        'verify yourself to continue',

        'robot check',

    ];



    if (titleSignals.some((s) => title.includes(s))) return true;



    const bodySignals = [

        'pardon our interruption',

        'checking your browser before you access ebay',

        'something went wrong on our end',

        'splashui/challenge',

        'challenge-container',

        '/pages/invalid/',

        'please verify yourself to continue',

    ];



    if (bodySignals.some((s) => lower.includes(s))) return true;



    if (html.length < 8_000 && !hasProductSignals && title.includes('ebay')) return true;



    return false;

}



/** Exponential backoff with jitter for eBay retries (ms). */

export function ebayRetryDelayMs(retryCount: number): number {

    const base = 2_000 * 2 ** Math.min(retryCount, 4);

    return base + Math.floor(Math.random() * 1_500);

}



/**

 * Warm eBay session — visit homepage first to seed Akamai cookies, then product page.

 * Community pattern from Apify eBay actors + residential proxy sticky sessions.

 */

function ebayHumanDelay(minMs: number, maxMs: number): Promise<void> {

    const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));

    return new Promise((resolve) => setTimeout(resolve, ms));

}



export async function warmEbaySession(page: Page, productUrl: string): Promise<void> {

    await page.setViewportSize({ width: 1366, height: 768 });

    await page.setExtraHTTPHeaders({

        'Accept-Language': 'en-US,en;q=0.9',

        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',

    });



    await page.goto('https://www.ebay.com/', {

        waitUntil: 'domcontentloaded',

        timeout: 45_000,

    });

    await ebayHumanDelay(1_500, 3_500);

    await page.mouse.move(300 + Math.random() * 200, 250 + Math.random() * 150);

    await page.mouse.wheel(0, 150 + Math.floor(Math.random() * 200));

    await ebayHumanDelay(600, 1_200);



    await page.goto(productUrl, {

        waitUntil: 'domcontentloaded',

        timeout: 60_000,

        referer: 'https://www.ebay.com/',

    });



    await page.waitForLoadState('networkidle', { timeout: 18_000 }).catch(() => undefined);

    await page

        .waitForSelector(

            'h1, meta[property="og:title"], .x-price-primary, script[type="application/ld+json"]',

            { timeout: 25_000 },

        )

        .catch(() => undefined);

    await page.mouse.wheel(0, 200 + Math.floor(Math.random() * 150));

    await ebayHumanDelay(400, 1_000);

}



function pickBestJsonLdProduct(html: string) {

    const products = extractJsonLdProducts(html);

    return (

        products.find((p) => p.name && p.offers) ??

        products.find((p) => p.name) ??

        products.find((p) => p.offers) ??

        products[0]

    );

}



/** Parse inline eBay bootstrap / module state when JSON-LD is incomplete. */

export function extractEbayEmbeddedData(html: string): Partial<ScrapedProduct> {

    const partial: Partial<ScrapedProduct> = {};



    const titleMatch =

        html.match(/"itemTitle"\s*:\s*"((?:\\.|[^"\\])*)"/) ??

        html.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"itemId"/);

    if (titleMatch) {

        try {

            partial.title = JSON.parse(`"${titleMatch[1]}"`);

        } catch {

            partial.title = titleMatch[1].replace(/\\"/g, '"');

        }

    }



    const priceMatch =

        html.match(/"displayPrice"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/) ??

        html.match(/"binPrice"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/) ??

        html.match(/"currentPrice"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/) ??

        html.match(/"price"\s*:\s*\{[^}]*"value"\s*:\s*([\d.]+)/) ??

        html.match(/"convertedFromValue"\s*:\s*([\d.]+)/);



    if (priceMatch) partial.currentPrice = parsePrice(priceMatch[1]);



    const sellerMatch =

        html.match(/"sellerUserName"\s*:\s*"([^"]+)"/) ??

        html.match(/"sellerName"\s*:\s*"([^"]+)"/) ??

        html.match(/"username"\s*:\s*"([^"]+)"[^}]*"feedbackScore"/);



    if (sellerMatch) partial.seller = sellerMatch[1];



    const itemIdMatch = html.match(/"itemId"\s*:\s*"(\d+)"/) ?? html.match(/"legacyItemId"\s*:\s*"(\d+)"/);

    if (itemIdMatch) partial.productId = itemIdMatch[1];



    const oosMatch = html.match(/"outOfStock"\s*:\s*(true)/i);

    if (oosMatch) partial.inStock = false;



    return partial;

}



export function parseEbayRich(html: string): Partial<ScrapedProduct> {

    const ld = pickBestJsonLdProduct(html);

    const embedded = extractEbayEmbeddedData(html);

    const offers = ld?.offers ? (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers) : undefined;



    const title =

        ld?.name ??

        embedded.title ??

        getMetaContent(html, 'og:title')?.replace(/\s*\|\s*eBay\s*$/i, '').trim() ??

        null;



    const currentPrice =

        parsePrice(String(offers?.price ?? offers?.lowPrice ?? '')) ??

        embedded.currentPrice ??

        parsePrice(getMetaContent(html, 'og:price:amount')) ??

        parsePrice(getMetaContent(html, 'product:price:amount'));



    const itemMatch = html.match(/\/itm\/(\d+)/i);



    const imageUrl =

        (typeof ld?.image === 'string' ? ld.image : Array.isArray(ld?.image) ? ld.image[0] : null) ??

        getMetaContent(html, 'og:image');



    const condition = offers?.itemCondition?.replace(/https?:\/\/schema.org\//i, '') ?? null;



    const ratingMatch = html.match(/"averageStarRating"\s*:\s*([\d.]+)/i);

    const reviewMatch = html.match(/"reviewCount"\s*:\s*(\d+)/i);



    const availabilityStock = availabilityToInStock(offers?.availability);

    let inStock = availabilityStock ?? embedded.inStock;

    if (inStock == null && currentPrice != null) {

        inStock = !html.toLowerCase().includes('out of stock');

    }



    return {

        title,

        currentPrice,

        currency: offers?.priceCurrency ?? getMetaContent(html, 'og:price:currency') ?? 'USD',

        inStock,

        productId: itemMatch?.[1] ?? embedded.productId ?? ld?.sku ?? null,

        seller: offers?.seller?.name ?? embedded.seller ?? null,

        imageUrl,

        imageUrls: imageUrl ? [imageUrl] : [],

        condition,

        rating: parseRating(ratingMatch?.[1]),

        reviewCount: parseReviewCount(reviewMatch?.[1]),

        description: ld?.description?.slice(0, 500) ?? getMetaContent(html, 'og:description'),

    };

}



/** Realistic Chrome UA — reduces headless fingerprint mismatches on eBay Akamai. */

export const EBAY_USER_AGENT =

    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';



/** Chromium flags that reduce automation signals without breaking Apify containers. */

export const EBAY_CHROMIUM_ARGS = [

    '--disable-blink-features=AutomationControlled',

    '--disable-dev-shm-usage',

    '--no-sandbox',

    '--window-size=1366,768',

    '--disable-infobars',

    '--disable-extensions',

];



export function getEbayLaunchOptions(headless: boolean): LaunchOptions {

    return {

        headless,

        args: EBAY_CHROMIUM_ARGS,

    };

}



export type EbayBrowserMode = 'chromium' | 'firefox' | 'auto';



/** EBAY_BROWSER env: chromium (default), firefox, or auto (Chromium first, Firefox fallback). */

export function resolveEbayBrowserMode(): EbayBrowserMode {

    const raw = process.env.EBAY_BROWSER?.trim().toLowerCase();

    if (raw === 'firefox') return 'firefox';

    if (raw === 'auto') return 'auto';

    return 'chromium';

}



/** @deprecated Use resolveEbayBrowserMode() === 'firefox' */

export const EBAY_USE_FIREFOX = resolveEbayBrowserMode() === 'firefox';



/** Keep the same proxy session on eBay bot retries (DataImpulse __sessid). Default on unless EBAY_STICKY_PROXY=0. */

export function ebayStickyProxyOnRetry(): boolean {

    return process.env.EBAY_STICKY_PROXY !== '0' && process.env.EBAY_STICKY_PROXY !== 'false';

}


