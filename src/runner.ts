import { Dataset, log, PlaywrightCrawler, type ProxyConfiguration } from 'crawlee';
import type { BrowserType, LaunchOptions, Page } from 'playwright';
import { chromium, firefox } from 'playwright';
import { buildMonitorResult } from './alerts.js';
import { computeHistoryStats, loadHistory, openHistoryStore, saveHistory } from './history.js';
import { loadHtmlSelector } from './htmlUtils.js';
import { createEmptyProduct, isBotPage, isExtractionSuccessful, mergeDefinedPartial } from './parsers/enrichment.js';
import { parseProduct } from './parsers/index.js';
import {
    BESTBUY_USER_AGENT,
    bestBuyRetryDelayMs,
    getBestBuyLaunchOptions,
    isBestBuyBlocked,
    loadBestBuyProduct,
} from './platforms/bestBuyHelpers.js';
import {
    EBAY_USER_AGENT,
    ebayStickyProxyOnRetry,
    getEbayLaunchOptions,
    ebayRetryDelayMs,
    isEbayBlocked,
    resolveEbayBrowserMode,
    warmEbaySession,
} from './platforms/ebayHelpers.js';
import { isWalmartBlocked, getWalmartLaunchOptions, loadWalmartProduct, WALMART_USER_AGENT, walmartRetryDelayMs } from './platforms/walmartHelpers.js';
import { attachTargetRedskyListener, applyTargetLocation, extractTargetDomPrice, extractTargetDomPriceUnavailableReason, fetchTargetRedsky, isTargetBlocked, type TargetLocationConfig } from './platforms/targetRedsky.js';
import { discoverProductsFromSearches } from './search/runSearch.js';
import type { ActorInput, AlertConfig, MonitorResult, Platform, ProductRequest, ProductSource } from './types.js';
import { detectPlatform, normalizeUrl } from './utils.js';

export interface MonitorRunOptions {
    input: ActorInput;
    proxyConfiguration?: ProxyConfiguration;
    headless?: boolean;
}

const PLATFORM_WAIT_SELECTORS: Partial<Record<Platform, string>> = {
    amazon: '#productTitle, #title, meta[property="og:title"]',
    walmart: 'h1[itemprop="name"], [data-automation="product-title"], h1',
    ebay: 'h1.x-item-title__mainTitle, .x-price-primary, meta[property="og:title"]',
    target: '[data-test="product-title"], script#__NEXT_DATA__, h1',
    bestbuy: 'script#product-schema, [data-testid="customer-price"], .sku-title h1, h1, meta[property="og:title"]',
    homedepot: 'h1, [data-testid="price-simple"], meta[property="og:title"]',
    costco: 'h1, .value, meta[property="og:title"]',
    etsy: 'h1, [data-buy-box-region], meta[property="og:title"]',
    wayfair: 'h1, [data-test-id="PriceDisplay"], meta[property="og:title"]',
    newegg: 'h1.product-title, .price-current, meta[property="og:title"]',
    kohls: 'h1.pdp-product-title, .prod_price_amount, meta[property="og:title"]',
    shopify: 'h1, .product__title, script[data-product-json], script#ProductJSON, meta[property="og:title"]',
    generic: 'h1, meta[property="og:title"], meta[property="og:price:amount"]',
};

function buildProductRequests(input: ActorInput): ProductRequest[] {
    const map = new Map<string, ProductRequest>();

    for (const { url } of input.startUrls ?? []) {
        const normalized = normalizeUrl(url);
        const platform = detectPlatform(normalized);
        map.set(normalized, {
            url: normalized,
            platform,
            source: 'direct_url',
            searchKeyword: null,
        });
    }

    return [...map.values()];
}

async function dismissCookieBanners(page: Page, platform: Platform): Promise<void> {
    if (platform !== 'target' && platform !== 'generic') return;
    for (const selector of ['button:has-text("Accept")', 'button:has-text("Accept All")', '#onetrust-accept-btn-handler']) {
        await page.locator(selector).first().click({ timeout: 2_000 }).catch(() => undefined);
    }
}

async function waitForProductContent(page: Page, platform: Platform): Promise<void> {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
    await dismissCookieBanners(page, platform);

    if (platform === 'target') {
        await page
            .waitForSelector('[data-test="product-price"], [data-test="product-title"]', {
                timeout: 15_000,
            })
            .catch(() => undefined);
        await page.locator('[data-test="product-price"], [data-test="product-title"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
        await page.waitForTimeout(800);
        return;
    }

    if (platform === 'walmart') {
        await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
        await page
            .waitForSelector('script#__NEXT_DATA__, [data-automation="product-title"], h1[itemprop="name"]', {
                timeout: 30_000,
            })
            .catch(() => undefined);
        await page.locator('h1, [data-automation="product-title"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
        await page.waitForTimeout(1_000);
        return;
    }

    if (platform === 'bestbuy') {
        await page
            .waitForSelector(
                'script#product-schema, [data-testid="customer-price"], .priceView-customer-price, .sku-title h1, h1',
                { timeout: 30_000 },
            )
            .catch(() => undefined);
        await page.locator('.sku-title h1, h1, [data-testid="customer-price"]').first().scrollIntoViewIfNeeded().catch(() => undefined);
        await page.waitForTimeout(1_500);
        return;
    }

    if (platform === 'shopify') {
        await page
            .waitForSelector(
                'script[data-product-json], script#ProductJSON, script[id*="ProductJson"], .price, .product__price, h1',
                { timeout: 20_000 },
            )
            .catch(() => undefined);
        await page.waitForTimeout(600);
    }

    if (platform === 'newegg') {
        await page
            .waitForSelector('.price-current, [itemprop="price"], h1.product-title', { timeout: 20_000 })
            .catch(() => undefined);
        await page.locator('.price-current, h1.product-title').first().scrollIntoViewIfNeeded().catch(() => undefined);
        await page.waitForTimeout(500);
    }

    const selector = PLATFORM_WAIT_SELECTORS[platform] ?? PLATFORM_WAIT_SELECTORS.generic!;
    try {
        await page.waitForSelector(selector, { timeout: 25_000 });
    } catch {
        await page.waitForTimeout(2_000);
    }
}

function buildFailedResult(
    url: string,
    platform: Platform,
    source: ProductSource,
    searchKeyword: string | null,
    error: string,
): MonitorResult {
    return {
        ...createEmptyProduct(url, platform, source, searchKeyword),
        priceChanged: false,
        priceChangePercent: null,
        stockChanged: false,
        previousPrice: null,
        previousInStock: null,
        priceHistory: null,
        alert: false,
        alertReason: null,
        alertReasons: [],
        scrapedAt: new Date().toISOString(),
        isFirstRun: false,
        error,
    };
}

async function getFailedProductUrls(urls: string[]): Promise<string[]> {
    const dataset = await Dataset.open();
    const { items } = await dataset.getData();
    const urlSet = new Set(urls);
    return items
        .filter((item) => urlSet.has(String(item.url)) && (item.error || !item.title))
        .map((item) => String(item.url));
}

interface EbayCrawlerOptions {
    sharedCtx: {
        alertConfig: AlertConfig;
        trackHistory: boolean;
        historyStore: Awaited<ReturnType<typeof openHistoryStore>>;
        proxyConfiguration?: ProxyConfiguration;
        headless: boolean;
        maxRequestRetries: number;
        targetLocation: TargetLocationConfig;
    };
    ebayProducts: ProductRequest[];
    maxConcurrency: number;
    headless: boolean;
    launcher: BrowserType;
    label: string;
}

async function runEbayCrawler({ sharedCtx, ebayProducts, maxConcurrency, headless, launcher, label }: EbayCrawlerOptions): Promise<void> {
    const isChromium = launcher.name() === 'chromium';
    await runProductCrawler({
        ...sharedCtx,
        products: ebayProducts,
        maxConcurrency: Math.min(maxConcurrency, 2),
        launcher,
        label,
        stickyProxyOnRetry: ebayStickyProxyOnRetry(),
        ...(isChromium
            ? {
                  launchOptions: getEbayLaunchOptions(headless),
                  userAgent: EBAY_USER_AGENT,
              }
            : {}),
    });
}

interface CrawlerRunContext {
    products: ProductRequest[];
    alertConfig: AlertConfig;
    trackHistory: boolean;
    historyStore: Awaited<ReturnType<typeof openHistoryStore>>;
    proxyConfiguration?: ProxyConfiguration;
    headless: boolean;
    maxConcurrency: number;
    maxRequestRetries: number;
    launcher: BrowserType;
    label: string;
    targetLocation: TargetLocationConfig;
    /** Keep the same proxy session on bot retries (Walmart sticky __sessid). */
    stickyProxyOnRetry?: boolean;
    /** Override default Chromium launch options (Walmart stealth). */
    launchOptions?: LaunchOptions;
    userAgent?: string;
    /** Skip Crawlee page.goto — handler performs its own navigation (Best Buy HTTP/2 workaround). */
    skipNavigation?: boolean;
}

async function runProductCrawler(ctx: CrawlerRunContext): Promise<void> {
    const {
        products,
        alertConfig,
        trackHistory,
        historyStore,
        proxyConfiguration,
        headless,
        maxConcurrency,
        maxRequestRetries,
        launcher,
        label,
        targetLocation,
        stickyProxyOnRetry = false,
        launchOptions,
        userAgent,
        skipNavigation = false,
    } = ctx;

    if (!products.length) return;

    log.info(`Scraping ${products.length} ${label} product(s) with ${launcher.name()}`);

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency,
        maxRequestRetries,
        requestHandlerTimeoutSecs: label.includes('Best Buy') ? 180 : 180,
        sessionPoolOptions: { blockedStatusCodes: [], maxPoolSize: 20 },
        launchContext: {
            launcher,
            launchOptions: launchOptions ?? {
                headless,
                args: ['--disable-blink-features=AutomationControlled'],
            },
            useIncognitoPages: true,
            ...(userAgent ? { userAgent } : {}),
        },
        preNavigationHooks: [
            async ({ page, request }, gotoOptions) => {
                page.setDefaultNavigationTimeout(45_000);
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                });
                request.userData.normalizedUrl = normalizeUrl(request.url);

                const product = request.userData.product as ProductRequest | undefined;
                if (product?.platform === 'target') {
                    request.userData.targetRedskyListener = attachTargetRedskyListener(page);
                    await applyTargetLocation(page, targetLocation);
                }

                if (product?.platform === 'bestbuy') {
                    gotoOptions.waitUntil = 'domcontentloaded';
                    gotoOptions.timeout = 60_000;
                }
            },
        ],
        requestHandler: async ({ page, request, log: reqLog, session }) => {
            const product = request.userData.product as ProductRequest;
            const normalizedUrl = product.url;
            const platform = product.platform;

            reqLog.info(`Scraping ${platform}: ${normalizedUrl}${product.searchKeyword ? ` (search: "${product.searchKeyword}")` : ''}`);

            const targetRedskyListener =
                platform === 'target'
                    ? ((request.userData.targetRedskyListener as ReturnType<typeof attachTargetRedskyListener> | undefined) ??
                      attachTargetRedskyListener(page))
                    : null;

            let html: string;
            let pageTitle: string;
            let pageUrl: string;

            if (platform === 'ebay') {
                await warmEbaySession(page, normalizedUrl);
                html = await page.content();
                pageTitle = await page.title();
                pageUrl = page.url();
            } else if (platform === 'walmart') {
                ({ html, pageTitle, pageUrl } = await loadWalmartProduct(page, normalizedUrl));
            } else if (platform === 'bestbuy') {
                ({ html, pageTitle, pageUrl } = await loadBestBuyProduct(page, normalizedUrl));
            } else if (platform === 'target') {
                await waitForProductContent(page, platform);
                html = await page.content();
                pageTitle = await page.title();
                pageUrl = page.url();
            } else {
                await waitForProductContent(page, platform);
                html = await page.content();
                pageTitle = await page.title();
                pageUrl = page.url();
            }

            if (platform === 'target') {
                await page.waitForTimeout(500);
            }

            const capturedRedsky = (await targetRedskyListener?.stop()) ?? {};

            if (
                isBotPage(html, pageTitle) ||
                (platform === 'ebay' && isEbayBlocked(html, pageTitle)) ||
                (platform === 'walmart' && isWalmartBlocked(html, pageTitle, pageUrl)) ||
                (platform === 'bestbuy' && isBestBuyBlocked(html, pageTitle, pageUrl))
            ) {
                if (!stickyProxyOnRetry) session?.markBad();
                const delay =
                    platform === 'ebay'
                        ? ebayRetryDelayMs(request.retryCount ?? 0)
                        : platform === 'walmart'
                          ? walmartRetryDelayMs(request.retryCount ?? 0)
                          : platform === 'bestbuy'
                            ? bestBuyRetryDelayMs(request.retryCount ?? 0)
                            : 3_000 * ((request.retryCount ?? 0) + 1);
                await page.waitForTimeout(delay);
                const rotateMsg = stickyProxyOnRetry ? 'retrying with same proxy session' : 'rotating proxy session';
                throw new Error(`Bot challenge detected (${pageTitle}) — ${rotateMsg}`);
            }

            const $ = loadHtmlSelector(html);
            const previous = await loadHistory(historyStore, normalizedUrl);
            let scraped = parseProduct({
                url: normalizedUrl,
                platform,
                html,
                $,
                source: product.source,
                searchKeyword: product.searchKeyword,
            });

            if (platform === 'target') {
                scraped = mergeDefinedPartial(scraped, capturedRedsky);

                if (scraped.currentPrice == null) {
                    scraped.currentPrice = await extractTargetDomPrice(page);
                }

                if (scraped.currentPrice == null && scraped.priceUnavailableReason == null) {
                    scraped.priceUnavailableReason = await extractTargetDomPriceUnavailableReason(page);
                }

                if (scraped.currentPrice == null && scraped.priceUnavailableReason == null && scraped.inStock !== false) {
                    const redsky = await fetchTargetRedsky(
                        page,
                        normalizedUrl,
                        html,
                        scraped.productId,
                        capturedRedsky,
                        targetLocation,
                    );
                    scraped = mergeDefinedPartial(scraped, redsky);
                }

                if (
                    scraped.currentPrice == null &&
                    scraped.inStock === false &&
                    scraped.priceUnavailableReason == null
                ) {
                    scraped.priceUnavailableReason = 'out_of_stock';
                }

                if (isTargetBlocked(html, pageTitle, scraped.title) && !isExtractionSuccessful(scraped)) {
                    if (!stickyProxyOnRetry) session?.markBad();
                    await page.waitForTimeout(2_000 * ((request.retryCount ?? 0) + 1));
                    throw new Error(`Target bot page (title=${scraped.title ?? pageTitle}) — retrying`);
                }
            }

            if (!isExtractionSuccessful(scraped)) {
                if (!stickyProxyOnRetry || (platform !== 'walmart' && platform !== 'bestbuy')) session?.markBad();
                const delay =
                    platform === 'ebay'
                        ? ebayRetryDelayMs(request.retryCount ?? 0)
                        : platform === 'walmart'
                          ? walmartRetryDelayMs(request.retryCount ?? 0)
                          : platform === 'bestbuy'
                            ? bestBuyRetryDelayMs(request.retryCount ?? 0)
                            : 2_000 * ((request.retryCount ?? 0) + 1);
                await page.waitForTimeout(delay);
                throw new Error(
                    `Incomplete extraction (title=${Boolean(scraped.title)}, price=${scraped.currentPrice}, priceReason=${scraped.priceUnavailableReason ?? 'none'}) — retrying`,
                );
            }

            const updatedHistory = await saveHistory(historyStore, normalizedUrl, {
                platform: scraped.platform,
                title: scraped.title,
                currentPrice: scraped.currentPrice,
                inStock: scraped.inStock,
                productId: scraped.productId,
                trackHistory,
                previous,
            });

            const historyStats = trackHistory ? computeHistoryStats(updatedHistory.prices) : null;
            const result = buildMonitorResult(scraped, previous, historyStats, alertConfig, trackHistory);

            if (result.alert) {
                reqLog.warning(`ALERT: ${result.title ?? normalizedUrl} — ${result.alertReason}`);
            }

            reqLog.info(
                `Extracted: ${result.title?.slice(0, 50) ?? 'N/A'} | $${result.currentPrice ?? '?'} | ` +
                    `seller=${result.seller ?? '-'} | ` +
                    `${result.rating ?? '-'}★ (${result.reviewCount ?? 0}) | ` +
                    `${result.imageUrls.length || (result.imageUrl ? 1 : 0)} img | stock=${result.inStock}`,
            );

            await Dataset.pushData(result);
        },
        failedRequestHandler: async ({ request, log: reqLog }, error) => {
            const product = request.userData.product as ProductRequest;
            reqLog.error(`Failed to scrape ${product.url}: ${(error as Error).message}`);
            await Dataset.pushData(
                buildFailedResult(product.url, product.platform, product.source, product.searchKeyword, (error as Error).message),
            );
        },
    });

    await crawler.run(
        products.map((product) => ({
            url: product.url,
            uniqueKey: product.url,
            userData: { product },
            ...(skipNavigation ? { skipNavigation: true } : {}),
        })),
    );
}

export async function runMonitor({ input, proxyConfiguration, headless = true }: MonitorRunOptions): Promise<void> {
    const {
        startUrls = [],
        searches = [],
        trackHistory = true,
        alertOnPriceDrop = true,
        priceDropThresholdPercent = 5,
        alertOnAnyPriceChange = false,
        alertOnStockChange = true,
        alertOnBackInStock = true,
        maxConcurrency = 3,
        maxRequestRetries = 4,
        targetZip,
        targetStoreId,
    } = input;

    if (!startUrls.length && !searches.length) {
        throw new Error('Provide at least one product URL in startUrls and/or a keyword search in searches.');
    }

    const alertConfig: AlertConfig = {
        alertOnPriceDrop,
        priceDropThresholdPercent,
        alertOnAnyPriceChange,
        alertOnStockChange,
        alertOnBackInStock,
    };

    const historyStore = await openHistoryStore();
    const directProducts = buildProductRequests(input);

    let searchProducts: ProductRequest[] = [];
    if (searches.length) {
        log.info(`Running ${searches.length} keyword search(es)...`);
        const discovered = await discoverProductsFromSearches(searches, proxyConfiguration, headless);
        searchProducts = discovered.map((item) => ({
            url: normalizeUrl(item.url),
            platform: item.platform,
            source: 'keyword_search' as const,
            searchKeyword: item.searchKeyword,
        }));
        log.info(`Discovered ${searchProducts.length} product URL(s) from search results`);
    }

    const productMap = new Map<string, ProductRequest>();
    for (const product of [...directProducts, ...searchProducts]) {
        if (!productMap.has(product.url)) productMap.set(product.url, product);
    }
    const products = [...productMap.values()];

    log.info(`Scraping ${products.length} product(s) (${directProducts.length} URLs, ${searchProducts.length} from search)`);

    const ebayProducts = products.filter((p) => p.platform === 'ebay');
    const walmartProducts = products.filter((p) => p.platform === 'walmart');
    const bestbuyProducts = products.filter((p) => p.platform === 'bestbuy');
    const otherProducts = products.filter(
        (p) => p.platform !== 'ebay' && p.platform !== 'walmart' && p.platform !== 'bestbuy',
    );

    const targetLocation: TargetLocationConfig = {
        zip: targetZip,
        storeId: targetStoreId,
    };

    const sharedCtx = {
        alertConfig,
        trackHistory,
        historyStore,
        proxyConfiguration,
        headless,
        maxRequestRetries,
        targetLocation,
    };

    if (ebayProducts.length) {
        const ebayBrowser = resolveEbayBrowserMode();
        const ebayUrls = ebayProducts.map((p) => p.url);

        if (ebayBrowser === 'firefox') {
            log.info('eBay URLs use Firefox (EBAY_BROWSER=firefox)');
            await runEbayCrawler({
                sharedCtx,
                ebayProducts,
                maxConcurrency,
                headless,
                launcher: firefox,
                label: 'eBay (Firefox)',
            });
        } else {
            log.info(
                `eBay URLs use Chromium (EBAY_BROWSER=${ebayBrowser})` +
                    (ebayStickyProxyOnRetry() ? ', sticky proxy sessions on retry' : ''),
            );
            await runEbayCrawler({
                sharedCtx,
                ebayProducts,
                maxConcurrency,
                headless,
                launcher: chromium,
                label: 'eBay (Chromium)',
            });

            if (ebayBrowser === 'auto') {
                const failedUrls = await getFailedProductUrls(ebayUrls);
                if (failedUrls.length) {
                    const retryProducts = ebayProducts.filter((p) => failedUrls.includes(p.url));
                    log.warning(`Chromium failed on ${failedUrls.length} eBay URL(s) — retrying with Firefox`);
                    await runEbayCrawler({
                        sharedCtx,
                        ebayProducts: retryProducts,
                        maxConcurrency,
                        headless,
                        launcher: firefox,
                        label: 'eBay (Firefox fallback)',
                    });
                }
            }
        }
    }

    if (walmartProducts.length) {
        log.info('Walmart URLs use sticky proxy sessions, stealth Chromium args, maxConcurrency=1');
        await runProductCrawler({
            ...sharedCtx,
            products: walmartProducts,
            maxConcurrency: 1,
            launcher: chromium,
            label: 'Walmart',
            stickyProxyOnRetry: true,
            launchOptions: getWalmartLaunchOptions(headless),
            userAgent: WALMART_USER_AGENT,
        });
    }

    if (bestbuyProducts.length) {
        log.info('Best Buy URLs use --disable-http2, domcontentloaded, maxConcurrency=1');
        await runProductCrawler({
            ...sharedCtx,
            products: bestbuyProducts,
            maxConcurrency: 1,
            launcher: chromium,
            label: 'Best Buy',
            stickyProxyOnRetry: true,
            skipNavigation: true,
            launchOptions: getBestBuyLaunchOptions(headless),
            userAgent: BESTBUY_USER_AGENT,
        });
    }

    if (otherProducts.length) {
        await runProductCrawler({
            ...sharedCtx,
            products: otherProducts,
            maxConcurrency,
            launcher: chromium,
            label: 'non-eBay',
        });
    }

    const dataset = await Dataset.open();
    const { items } = await dataset.getData();
    const alertCount = items.filter((item) => item.alert).length;
    const successCount = items.filter((item) => !item.error && item.title).length;

    log.info(`Done. ${successCount}/${items.length} succeeded, ${alertCount} alert(s).`);
}
