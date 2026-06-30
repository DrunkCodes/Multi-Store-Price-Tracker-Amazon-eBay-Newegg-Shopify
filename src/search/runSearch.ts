import { log, PlaywrightCrawler, type ProxyConfiguration } from 'crawlee';
import type { Page } from 'playwright';
import type { Platform, SearchQuery } from '../types.js';
import {
    buildSearchUrl,
    extractSearchResultUrls,
    isSearchablePlatform,
    SEARCH_WAIT_SELECTORS,
} from './index.js';

export interface DiscoveredProduct {
    url: string;
    platform: Platform;
    searchKeyword: string;
}

async function waitForSearchResults(page: Page, platform: Platform): Promise<void> {
    await page.waitForLoadState('domcontentloaded', { timeout: 45_000 });
    await page.locator('button:has-text("Accept")').first().click({ timeout: 2_000 }).catch(() => undefined);

    const selector = SEARCH_WAIT_SELECTORS[platform];
    if (selector) {
        await page.waitForSelector(selector, { timeout: 30_000 }).catch(() => undefined);
    }

    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
}

export async function discoverProductsFromSearches(
    searches: SearchQuery[],
    proxyConfiguration: ProxyConfiguration | undefined,
    headless: boolean,
): Promise<DiscoveredProduct[]> {
    const discovered = new Map<string, DiscoveredProduct>();

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxConcurrency: 1,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 90,
        sessionPoolOptions: { blockedStatusCodes: [], maxPoolSize: 20 },
        launchContext: { launchOptions: { headless }, useIncognitoPages: true },
        preNavigationHooks: [
            async ({ page }) => {
                page.setDefaultNavigationTimeout(60_000);
                await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
            },
        ],
        requestHandler: async ({ page, request, log: reqLog }) => {
            const { platform, keyword, maxResults } = request.userData as {
                platform: Platform;
                keyword: string;
                maxResults: number;
            };

            reqLog.info(`Searching ${platform} for "${keyword}" (max ${maxResults})`);
            await waitForSearchResults(page, platform);

            const html = await page.content();
            const urls = extractSearchResultUrls(platform, html, maxResults);

            reqLog.info(`Found ${urls.length} product URL(s) for "${keyword}" on ${platform}`);
            for (const url of urls) {
                discovered.set(url, { url, platform, searchKeyword: keyword });
            }
        },
    });

    const requests = searches
        .filter((s) => {
            if (!isSearchablePlatform(s.platform)) {
                log.warning(`Skipping unsupported search platform: ${s.platform}`);
                return false;
            }
            return s.keyword.trim().length > 0;
        })
        .map((search) => ({
            url: buildSearchUrl(search.platform, search.keyword),
            uniqueKey: `search:${search.platform}:${search.keyword}`,
            userData: {
                platform: search.platform,
                keyword: search.keyword.trim(),
                maxResults: search.maxResults ?? 10,
            },
        }));

    if (requests.length) {
        await crawler.run(requests);
    }

    return [...discovered.values()];
}
