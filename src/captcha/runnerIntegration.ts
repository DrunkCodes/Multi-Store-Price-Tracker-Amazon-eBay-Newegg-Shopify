import type { Page } from 'playwright';
import type { Log } from 'crawlee';
import { isBestBuyBlocked, loadBestBuyProduct } from '../platforms/bestBuyHelpers.js';
import { isEbayBlocked, warmEbaySession } from '../platforms/ebayHelpers.js';
import { isWalmartBlocked, loadWalmartProduct } from '../platforms/walmartHelpers.js';
import { isBotPage } from '../parsers/enrichment.js';
import type { Platform } from '../types.js';
import { detectCaptchaOnPage, isCaptchaOrBotChallenge } from './detect.js';
import { isTwoCaptchaConfigured, solveCaptchaOnPage } from './twoCaptcha.js';

export interface PageSnapshot {
    html: string;
    pageTitle: string;
    pageUrl: string;
}

export function isPlatformBlocked(
    platform: Platform,
    html: string,
    pageTitle: string,
    pageUrl: string,
): boolean {
    return (
        isBotPage(html, pageTitle) ||
        (platform === 'ebay' && isEbayBlocked(html, pageTitle)) ||
        (platform === 'walmart' && isWalmartBlocked(html, pageTitle, pageUrl)) ||
        (platform === 'bestbuy' && isBestBuyBlocked(html, pageTitle, pageUrl))
    );
}

async function reloadPageAfterCaptcha(
    page: Page,
    platform: Platform,
    normalizedUrl: string,
): Promise<PageSnapshot> {
    if (platform === 'walmart') {
        const loaded = await loadWalmartProduct(page, normalizedUrl);
        return { html: loaded.html, pageTitle: loaded.pageTitle, pageUrl: loaded.pageUrl };
    }
    if (platform === 'bestbuy') {
        const loaded = await loadBestBuyProduct(page, normalizedUrl);
        return { html: loaded.html, pageTitle: loaded.pageTitle, pageUrl: loaded.pageUrl };
    }
    if (platform === 'ebay') {
        await warmEbaySession(page, normalizedUrl);
    } else {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
        await page.waitForTimeout(2_000);
    }

    return {
        html: await page.content(),
        pageTitle: await page.title(),
        pageUrl: page.url(),
    };
}

/**
 * When a bot page or captcha is detected and 2Captcha is configured, attempt token solve and reload content.
 * Returns updated snapshot; caller re-checks isPlatformBlocked before continuing.
 */
export async function maybeSolveCaptchaAndReload(
    page: Page,
    platform: Platform,
    normalizedUrl: string,
    snapshot: PageSnapshot,
    twoCaptchaApiKey: string | null | undefined,
    reqLog: Log,
): Promise<PageSnapshot> {
    const detected = await detectCaptchaOnPage(page, {
        html: snapshot.html,
        pageTitle: snapshot.pageTitle,
    });

    const challengePresent =
        isPlatformBlocked(platform, snapshot.html, snapshot.pageTitle, snapshot.pageUrl) ||
        isCaptchaOrBotChallenge(snapshot.html, snapshot.pageTitle, detected);

    if (!challengePresent) return snapshot;

    if (!isTwoCaptchaConfigured(twoCaptchaApiKey)) {
        reqLog.info('[2captcha] skipped — no API key (set TWOCAPTCHA_API_KEY or Actor secret)');
        return snapshot;
    }

    if (detected && !detected.solvable) {
        reqLog.info(`[2captcha] skipped ${detected.type}: ${detected.reason ?? 'not solvable'}`);
        return snapshot;
    }

    reqLog.info(`[2captcha] bot/captcha detected — attempting solve (${detected?.type ?? 'auto-detect'})`);

    const solved = await solveCaptchaOnPage(page, {
        apiKey: twoCaptchaApiKey ?? undefined,
        pageUrl: snapshot.pageUrl,
        log: (message: string) => reqLog.info(message),
    });

    if (!solved) {
        reqLog.warning('[2captcha] solve did not complete — falling back to proxy retry');
        return snapshot;
    }

    reqLog.info('[2captcha] token injected — reloading page content');
    return reloadPageAfterCaptcha(page, platform, normalizedUrl);
}
