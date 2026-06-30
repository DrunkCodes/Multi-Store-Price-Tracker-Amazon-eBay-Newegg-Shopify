import type { Page, Response } from 'playwright';
import type { PriceUnavailableReason, ScrapedProduct } from '../types.js';
import { parsePrice, parseRating } from '../utils.js';
import { parseReviewCount } from '../parsers/enrichment.js';

const DEFAULT_REDSKY_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e966';
const FALLBACK_REDSKY_KEYS = [
    DEFAULT_REDSKY_KEY,
    'ff457966e64d5e877fdbad070f276d18ecec4a01',
];
export const DEFAULT_TARGET_ZIP = '10001';
export const DEFAULT_TARGET_STORE_ID = '1154';
export const DEFAULT_TARGET_STATE = 'NY';

const REDSKY_REQUEST_TIMEOUT_MS = 10_000;
const REDSKY_LISTENER_DRAIN_MS = 1_500;

const PDP_ENDPOINT = 'https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1';
const FULFILLMENT_ENDPOINT =
    'https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1';
const PRODUCT_FULFILLMENT_ENDPOINT =
    'https://redsky.target.com/redsky_aggregations/v1/web_platform/product_fulfillment_v1';

export interface TargetLocationConfig {
    zip?: string;
    storeId?: string;
    state?: string;
}

/** Resolve store/zip/state for RedSky and location cookies. */
export function resolveTargetLocation(input: TargetLocationConfig = {}): Required<TargetLocationConfig> {
    const zip = (input.zip ?? DEFAULT_TARGET_ZIP).replace(/\D/g, '').slice(0, 5) || DEFAULT_TARGET_ZIP;
    const storeId = (input.storeId ?? DEFAULT_TARGET_STORE_ID).replace(/\D/g, '') || DEFAULT_TARGET_STORE_ID;
    const state = (input.state ?? zipToStateAbbreviation(zip) ?? DEFAULT_TARGET_STATE).toUpperCase();
    return { zip, storeId, state };
}

/** Set Target guest-location cookies before navigation (community pattern for store-aware pricing). */
export async function applyTargetLocation(page: Page, input: TargetLocationConfig = {}): Promise<void> {
    const { zip, storeId, state } = resolveTargetLocation(input);
    const coords = zipToCoordinates(zip);

    const guestLocation = `${zip}|${coords.latitude}|${coords.longitude}|${state}|US`;

    await page.context().addCookies([
        {
            name: 'GuestLocation',
            value: guestLocation,
            domain: '.target.com',
            path: '/',
        },
        {
            name: 'sddStore',
            value: storeId,
            domain: '.target.com',
            path: '/',
        },
    ]);
}

/** Warm Target session (homepage visit + cookies) before PDP navigation. */
export async function warmTargetSession(page: Page, location: TargetLocationConfig = {}): Promise<void> {
    await applyTargetLocation(page, location);
    await page.goto('https://www.target.com/', { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => undefined);
    for (const selector of ['button:has-text("Accept")', 'button:has-text("Accept All")', '#onetrust-accept-btn-handler']) {
        await page.locator(selector).first().click({ timeout: 2_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(500);
}

/** Navigate to PDP after warming session (Crawlee calls this instead of default goto for Target). */
export async function loadTargetProduct(page: Page, productUrl: string, location: TargetLocationConfig = {}): Promise<void> {
    await warmTargetSession(page, location);
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    await page
        .waitForSelector('[data-test="product-price"], [data-test="product-title"]', { timeout: 15_000 })
        .catch(() => undefined);
    await page.locator('[data-test="product-price"], [data-test="product-title"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(800);
}

/** Capture RedSky JSON responses the PDP loads in-browser (most reliable auth/key). */
export function attachTargetRedskyListener(page: Page): { stop: () => Promise<Partial<ScrapedProduct>> } {
    let captured: Partial<ScrapedProduct> = {};
    const pending = new Set<Promise<void>>();

    const handler = (response: Response) => {
        const url = response.url();
        if (!url.includes('redsky.target.com') || response.status() !== 200) return;
        if (
            !url.includes('pdp_client') &&
            !url.includes('pdp_variation') &&
            !url.includes('product_summary') &&
            !url.includes('product_fulfillment')
        ) {
            return;
        }

        const contentType = response.headers()['content-type'] ?? '';
        if (!contentType.includes('json')) return;

        const task = response
            .json()
            .then((data) => {
                if (!data || typeof data !== 'object') return;
                const parsed = parseRedskyPayload(data as Record<string, unknown>);
                captured = mergeRedskyPartials(captured, parsed);
            })
            .catch(() => undefined)
            .finally(() => {
                pending.delete(task);
            });
        pending.add(task);
    };

    page.on('response', handler);
    return {
        stop: async () => {
            page.off('response', handler);
            if (pending.size) {
                await Promise.race([
                    Promise.allSettled([...pending]),
                    page.waitForTimeout(REDSKY_LISTENER_DRAIN_MS),
                ]);
            }
            return captured;
        },
    };
}

export async function extractTargetDomPrice(page: Page): Promise<number | null> {
    const selectors = [
        '[data-test="product-price"]',
        '[data-test="current-price"]',
        '[data-test="@web/Price/PriceFull"]',
        '[data-test="@web/Price/Price"]',
        'span[data-test="product-price"]',
    ];

    for (const selector of selectors) {
        const text = await page.locator(selector).first().textContent({ timeout: 3_000 }).catch(() => null);
        const price = parsePrice(text);
        if (price != null) return price;
    }

    return null;
}

export async function extractTargetDomPriceUnavailableReason(page: Page): Promise<PriceUnavailableReason | null> {
    const selectors = [
        '[data-test="product-price"]',
        '[data-test="current-price"]',
        '[data-test="@web/Price/PriceFull"]',
        '[data-test="@web/Price/Price"]',
        'span[data-test="product-price"]',
    ];

    for (const selector of selectors) {
        const text = (await page.locator(selector).first().textContent({ timeout: 3_000 }).catch(() => null)) ?? '';
        const reason = detectPriceUnavailableFromText(text);
        if (reason) return reason;
    }

    return null;
}

/** Target RedSky API — used by Target.com frontend (see Stack Overflow / ScrapingBee guides). */
export async function fetchTargetRedsky(
    page: Page,
    productUrl: string,
    html: string,
    tcin: string | null,
    seed: Partial<ScrapedProduct> = {},
    location: TargetLocationConfig = {},
): Promise<Partial<ScrapedProduct>> {
    let best = { ...seed };

    const resolvedTcin =
        tcin ??
        productUrl.match(/\/A-(\d+)/i)?.[1] ??
        html.match(/"tcin"\s*:\s*"?(\d{6,})"?/i)?.[1] ??
        null;

    if (!resolvedTcin) return best;
    if (best.currentPrice != null && best.priceUnavailableReason == null && best.inStock != null) return best;

    const apiKeys = collectRedskyKeys(html);
    const productPath = new URL(productUrl).pathname;
    const resolvedLocation = resolveTargetLocation(location);

    if (best.currentPrice == null) {
        const apiKey = apiKeys[0];
        const [pdpParsed, fulfillmentParsed] = await Promise.all([
            requestRedskyUrl(
                page,
                buildRedskyPdpUrl(PDP_ENDPOINT, apiKey, resolvedTcin, productPath, resolvedLocation),
                productUrl,
            ),
            best.inStock == null || best.currentPrice == null
                ? requestRedskyUrl(
                      page,
                      buildFulfillmentUrl(FULFILLMENT_ENDPOINT, apiKey, resolvedTcin, productPath, resolvedLocation),
                      productUrl,
                  )
                : Promise.resolve(null),
        ]);
        if (pdpParsed) best = mergeRedskyPartials(best, pdpParsed);
        if (fulfillmentParsed) best = mergeRedskyPartials(best, fulfillmentParsed);
    }

    if (best.inStock == null) {
        for (const apiKey of apiKeys.slice(0, 1)) {
            const url = buildProductFulfillmentUrl(
                PRODUCT_FULFILLMENT_ENDPOINT,
                apiKey,
                resolvedTcin,
                resolvedLocation,
            );
            const parsed = await requestRedskyUrl(page, url, productUrl);
            if (!parsed) continue;
            best = mergeRedskyPartials(best, parsed);
            if (best.inStock != null) break;
        }
    }

    return best;
}

function mergeRedskyPartials(
    base: Partial<ScrapedProduct>,
    partial: Partial<ScrapedProduct>,
): Partial<ScrapedProduct> {
    const merged = { ...base };
    for (const [key, value] of Object.entries(partial) as [keyof ScrapedProduct, ScrapedProduct[keyof ScrapedProduct]][]) {
        if (value == null) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        (merged as Record<string, unknown>)[key as string] = value;
    }
    return merged;
}

function collectRedskyKeys(html: string): string[] {
    const keys = new Set<string>(FALLBACK_REDSKY_KEYS);

    for (const match of html.matchAll(/"apiKey"\s*:\s*"([a-f0-9]{32,})"/gi)) {
        keys.add(match[1]);
    }
    for (const match of html.matchAll(/redsky[^"']*key=([a-f0-9]{32,})/gi)) {
        keys.add(match[1]);
    }

    return [...keys];
}

async function requestRedskyUrl(
    page: Page,
    url: string,
    productUrl: string,
): Promise<Partial<ScrapedProduct> | null> {
    try {
        const response = await page.request.get(url, {
            headers: {
                Accept: 'application/json',
                Referer: productUrl,
                Origin: 'https://www.target.com',
            },
            timeout: REDSKY_REQUEST_TIMEOUT_MS,
        });

        if (!response.ok()) return null;

        const data = (await response.json()) as Record<string, unknown>;
        const parsed = parseRedskyPayload(data);
        return Object.keys(parsed).length > 0 ? parsed : null;
    } catch {
        return null;
    }
}

function buildRedskyPdpUrl(
    endpoint: string,
    apiKey: string,
    tcin: string,
    productPath: string,
    location: Required<TargetLocationConfig>,
): string {
    const coords = zipToCoordinates(location.zip);
    const url = new URL(endpoint);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('tcin', tcin);
    url.searchParams.set('pricing_store_id', location.storeId);
    url.searchParams.set('store_id', location.storeId);
    url.searchParams.set('scheduled_delivery_store_id', location.storeId);
    url.searchParams.set('has_pricing_store_id', 'true');
    url.searchParams.set('has_required_store_id', 'true');
    url.searchParams.set('channel', 'WEB');
    url.searchParams.set('page', productPath);
    url.searchParams.set('is_bot', 'false');
    url.searchParams.set('skip_variation_hierarchy', 'true');
    url.searchParams.set('zip', location.zip);
    url.searchParams.set('state', location.state);
    url.searchParams.set('latitude', String(coords.latitude));
    url.searchParams.set('longitude', String(coords.longitude));
    return url.toString();
}

function buildFulfillmentUrl(
    endpoint: string,
    apiKey: string,
    tcin: string,
    productPath: string,
    location: Required<TargetLocationConfig>,
): string {
    const coords = zipToCoordinates(location.zip);
    const url = new URL(endpoint);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('tcins', tcin);
    url.searchParams.set('store_id', location.storeId);
    url.searchParams.set('pricing_store_id', location.storeId);
    url.searchParams.set('scheduled_delivery_store_id', location.storeId);
    url.searchParams.set('zip', location.zip);
    url.searchParams.set('state', location.state);
    url.searchParams.set('latitude', String(coords.latitude));
    url.searchParams.set('longitude', String(coords.longitude));
    url.searchParams.set('channel', 'WEB');
    url.searchParams.set('page', productPath);
    url.searchParams.set('is_bot', 'false');
    return url.toString();
}

function buildProductFulfillmentUrl(
    endpoint: string,
    apiKey: string,
    tcin: string,
    location: Required<TargetLocationConfig>,
): string {
    const coords = zipToCoordinates(location.zip);
    const url = new URL(endpoint);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('tcin', tcin);
    url.searchParams.set('store_id', location.storeId);
    url.searchParams.set('scheduled_delivery_store_id', location.storeId);
    url.searchParams.set('required_store_id', location.storeId);
    url.searchParams.set('has_required_store_id', 'true');
    url.searchParams.set('zip', location.zip);
    url.searchParams.set('state', location.state);
    url.searchParams.set('latitude', String(coords.latitude));
    url.searchParams.set('longitude', String(coords.longitude));
    url.searchParams.set('is_bot', 'false');
    return url.toString();
}

function parseRedskyPayload(data: Record<string, unknown>): Partial<ScrapedProduct> {
    const product = extractRedskyProduct(data);
    if (!product) return {};

    const item = (product.item ?? product) as Record<string, unknown>;
    const description = item.product_description as Record<string, unknown> | undefined;
    const price = extractRedskyPrice(product) ?? findRedskyPriceNode(data);
    const brand = item.primary_brand as Record<string, unknown> | undefined;
    const ratings = product.ratings_and_reviews as Record<string, unknown> | undefined;
    const stats = ratings?.statistics as Record<string, unknown> | undefined;
    const ratingNode = stats?.rating as Record<string, unknown> | undefined;
    const enrichment = item.enrichment as Record<string, unknown> | undefined;

    const currentPrice = parseTargetRetailPrice(
        price?.current_retail ??
            price?.current_retail_min ??
            price?.formatted_current_price ??
            price?.formatted_min_advertised_price,
    );
    const originalPrice = parseTargetRetailPrice(
        price?.reg_retail ?? price?.formatted_comparison_price,
    );

    const inStock = parseRedskyStock(product, price);
    const priceUnavailableReason = detectPriceUnavailableReason(price, product, currentPrice, inStock);

    const imageUrl =
        (enrichment?.images as { primary_image_url?: string } | undefined)?.primary_image_url ??
        (enrichment?.image_info as { primary_image?: { url?: string } } | undefined)?.primary_image?.url ??
        null;

    const partial: Partial<ScrapedProduct> = {};

    const title = typeof description?.title === 'string' ? description.title : null;
    if (title) partial.title = title;
    if (currentPrice != null) partial.currentPrice = currentPrice;
    if (originalPrice != null && currentPrice != null && originalPrice > currentPrice) {
        partial.originalPrice = originalPrice;
    }
    if (inStock != null) partial.inStock = inStock;
    if (priceUnavailableReason) partial.priceUnavailableReason = priceUnavailableReason;
    else if (currentPrice == null && inStock === false) partial.priceUnavailableReason = 'out_of_stock';
    if (product.tcin != null) partial.productId = String(product.tcin);
    if (typeof brand?.name === 'string') partial.brand = brand.name;
    if (imageUrl) {
        partial.imageUrl = imageUrl;
        partial.imageUrls = [imageUrl];
    }
    if (typeof description?.downstream_description === 'string') {
        partial.description = description.downstream_description.slice(0, 500);
    }
    const rating = parseRating(String(ratingNode?.average ?? stats?.average_rating ?? ''));
    if (rating != null) partial.rating = rating;
    const reviewCount = parseReviewCount(String(ratingNode?.count ?? stats?.review_count ?? stats?.total_review_count ?? ''));
    if (reviewCount != null) partial.reviewCount = reviewCount;
    if (currentPrice != null || title) partial.currency = 'USD';

    return partial;
}

function extractRedskyProduct(data: Record<string, unknown>): Record<string, unknown> | null {
    const root = data.data as Record<string, unknown> | undefined;
    if (root?.product && typeof root.product === 'object') {
        return root.product as Record<string, unknown>;
    }

    const summaries = root?.product_summaries;
    if (Array.isArray(summaries) && summaries[0] && typeof summaries[0] === 'object') {
        return summaries[0] as Record<string, unknown>;
    }

    return findRedskyProductNode(data);
}

function extractRedskyPrice(product: Record<string, unknown>): Record<string, unknown> | undefined {
    const direct = (product.price ?? (product.item as Record<string, unknown> | undefined)?.price) as
        | Record<string, unknown>
        | undefined;
    if (hasRedskyPrice(direct)) return direct;

    const children = product.children;
    if (Array.isArray(children)) {
        for (const child of children) {
            if (!child || typeof child !== 'object') continue;
            const childPrice = (child as Record<string, unknown>).price as Record<string, unknown> | undefined;
            if (hasRedskyPrice(childPrice)) return childPrice;
        }
    }

    return direct;
}

function hasRedskyPrice(price: Record<string, unknown> | undefined): boolean {
    if (!price) return false;
    return (
        price.current_retail != null ||
        price.current_retail_min != null ||
        price.formatted_current_price != null ||
        price.formatted_min_advertised_price != null
    );
}

function findRedskyPriceNode(node: unknown): Record<string, unknown> | undefined {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findRedskyPriceNode(item);
            if (found) return found;
        }
        return undefined;
    }

    const obj = node as Record<string, unknown>;
    if (hasRedskyPrice(obj)) return obj;

    for (const value of Object.values(obj)) {
        const found = findRedskyPriceNode(value);
        if (found) return found;
    }

    return undefined;
}

function parseTargetRetailPrice(value: unknown): number | null {
    if (typeof value === 'number' && value > 0) {
        return Math.round(value) / 100;
    }
    const text = String(value ?? '').trim();
    if (!text || /see price in cart/i.test(text)) return null;
    return parsePrice(text);
}

function detectPriceUnavailableFromText(text: string): PriceUnavailableReason | null {
    if (/see price in cart/i.test(text)) return 'see_price_in_cart';
    if (/map pricing|minimum advertised/i.test(text)) return 'map_pricing';
    return null;
}

function detectPriceUnavailableReason(
    price: Record<string, unknown> | undefined,
    product: Record<string, unknown>,
    currentPrice: number | null,
    inStock: boolean | null,
): PriceUnavailableReason | null {
    if (currentPrice != null) return null;

    const formatted = String(
        price?.formatted_current_price ?? price?.formatted_min_advertised_price ?? price?.formatted_comparison_price ?? '',
    );
    const reasonFromText = detectPriceUnavailableFromText(formatted);
    if (reasonFromText) return reasonFromText;

    if (price?.min_advertised_price != null && price?.current_retail == null) {
        return 'map_pricing';
    }

    const priceDisplay = String(price?.price_display_condition ?? price?.price_type ?? '').toLowerCase();
    if (priceDisplay.includes('map') || priceDisplay.includes('cart')) {
        return priceDisplay.includes('cart') ? 'see_price_in_cart' : 'map_pricing';
    }

    if (inStock === false && !formatted.trim()) return 'out_of_stock';

    const availability = String(product.availability_status ?? '').toLowerCase();
    if (availability.includes('out_of_stock')) return 'out_of_stock';

    return null;
}

function parseRedskyStock(
    product: Record<string, unknown>,
    price: Record<string, unknown> | undefined,
): boolean | null {
    const fulfillment = product.fulfillment as Record<string, unknown> | undefined;
    const shipping = fulfillment?.shipping_options as Record<string, unknown> | undefined;
    const shipStatus = String(shipping?.availability_status ?? '').toUpperCase();
    if (shipStatus === 'IN_STOCK') return true;
    if (shipStatus === 'OUT_OF_STOCK') return false;

    const storeOptions = fulfillment?.store_options;
    if (Array.isArray(storeOptions)) {
        for (const option of storeOptions) {
            if (!option || typeof option !== 'object') continue;
            const store = option as Record<string, unknown>;
            const pickup = store.order_pickup as Record<string, unknown> | undefined;
            const pickupStatus = String(pickup?.availability_status ?? '').toUpperCase();
            if (pickupStatus === 'IN_STOCK') return true;

            const inStore = store.in_store_only as Record<string, unknown> | undefined;
            const inStoreStatus = String(inStore?.availability_status ?? '').toUpperCase();
            if (inStoreStatus === 'IN_STOCK') return true;
        }
    }

    const availability = String(
        product.availability_status ?? price?.availability_status ?? fulfillment?.is_out_of_stock_in_all_store_locations ?? '',
    ).toLowerCase();

    if (availability.includes('in_stock') || availability === 'true') return true;
    if (availability.includes('out_of_stock') || availability === 'false') return false;
    if (String(fulfillment?.is_out_of_stock_in_all_store_locations).toLowerCase() === 'true') return false;

    return null;
}

function findRedskyProductNode(node: unknown): Record<string, unknown> | null {
    if (!node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findRedskyProductNode(item);
            if (found) return found;
        }
        return null;
    }

    const obj = node as Record<string, unknown>;
    if (obj.tcin != null && (obj.price != null || obj.item != null || obj.children != null)) return obj;

    if (obj.product && typeof obj.product === 'object') {
        const nested = findRedskyProductNode(obj.product);
        if (nested) return nested;
    }

    for (const value of Object.values(obj)) {
        const found = findRedskyProductNode(value);
        if (found) return found;
    }

    return null;
}

function zipToStateAbbreviation(zip: string): string | null {
    const prefix = zip.slice(0, 3);
    const map: Record<string, string> = {
        '100': 'NY',
        '101': 'NY',
        '102': 'NY',
        '103': 'NY',
        '104': 'NY',
        '112': 'NY',
        '900': 'CA',
        '901': 'CA',
        '902': 'CA',
        '606': 'IL',
        '752': 'TX',
        '770': 'TX',
        '331': 'FL',
        '981': 'WA',
        '021': 'MA',
        '191': 'PA',
        '303': 'GA',
        '850': 'AZ',
    };
    return map[prefix] ?? null;
}

function zipToCoordinates(zip: string): { latitude: number; longitude: number } {
    const known: Record<string, { latitude: number; longitude: number }> = {
        '10001': { latitude: 40.7506, longitude: -73.9971 },
        '90210': { latitude: 34.103, longitude: -118.4105 },
        '60601': { latitude: 41.8853, longitude: -87.6217 },
        '75201': { latitude: 32.7875, longitude: -96.7989 },
        '98101': { latitude: 47.6114, longitude: -122.3345 },
    };
    return known[zip] ?? { latitude: 40.7128, longitude: -74.006 };
}

export function extractTcinFromTargetUrl(url: string): string | null {
    return url.match(/\/A-(\d+)/i)?.[1] ?? null;
}

/** Detect Target bot/challenge pages that return shell HTML without PDP content. */
export function isTargetBlocked(html: string, pageTitle: string, productTitle?: string | null): boolean {
    if (!html || html.length < 200) return false;

    const title = pageTitle.toLowerCase().trim();
    const itemTitle = productTitle?.toLowerCase().trim() ?? '';
    if (title.includes('global navigation') || itemTitle.includes('global navigation')) return true;
    if (title === 'target : expect more. pay less.') return true;

    const lower = html.toLowerCase();
    if (lower.includes('access denied') && lower.includes('target')) return true;
    if (lower.includes('please verify you are a human')) return true;
    if (/global navigation/i.test(html) && !html.includes('data-test="product-title"')) return true;

    if (html.includes('data-test="product-title"') || html.includes('pdp_client_v1')) {
        return false;
    }

    if (title.includes('target') || lower.includes('target.com')) return true;

    return false;
}
