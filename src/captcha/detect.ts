import type { Page } from 'playwright';

export type CaptchaType =
    | 'recaptcha_v2'
    | 'recaptcha_v3'
    | 'hcaptcha'
    | 'turnstile'
    | 'amazon_waf'
    | 'perimeterx'
    | 'akamai'
    | 'image'
    | 'unknown';

export interface DetectedCaptcha {
    type: CaptchaType;
    siteKey?: string;
    pageAction?: string;
    /** Whether 2Captcha supports solving this challenge type. */
    solvable: boolean;
    reason?: string;
}

export interface DetectCaptchaOptions {
    html?: string;
    pageTitle?: string;
}

/** DOM + HTML heuristics for common e-commerce bot challenges. */
export async function detectCaptchaOnPage(
    page: Page,
    options: DetectCaptchaOptions = {},
): Promise<DetectedCaptcha | null> {
    const html = options.html ?? (await page.content());
    const pageTitle = options.pageTitle ?? (await page.title());
    const lower = html.toLowerCase();
    const titleLower = pageTitle.toLowerCase();

    const dom = await page.evaluate(() => {
        const pickSiteKey = (selectors: string[]): string | undefined => {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                const key = el?.getAttribute('data-sitekey') ?? el?.getAttribute('data-site-key');
                if (key) return key;
            }
            return undefined;
        };

        const recaptchaV2Key =
            pickSiteKey(['.g-recaptcha', '[data-sitekey]']) ??
            document.querySelector('iframe[src*="google.com/recaptcha"]')?.getAttribute('src')?.match(/[?&]k=([^&]+)/)?.[1];

        const hcaptchaKey =
            pickSiteKey(['.h-captcha', '[data-hcaptcha-widget-id]']) ??
            document.querySelector('iframe[src*="hcaptcha.com"]')?.getAttribute('src')?.match(/[?&]sitekey=([^&]+)/i)?.[1];

        const turnstileKey = pickSiteKey(['.cf-turnstile', '[data-turnstile-sitekey]']);

        const recaptchaV3Script = [...document.scripts].some((s) => s.src.includes('recaptcha/api.js') && s.src.includes('render='));
        const recaptchaV3Key = recaptchaV3Script
            ? document.querySelector('script[src*="recaptcha/api.js"]')?.getAttribute('src')?.match(/render=([^&]+)/)?.[1]
            : undefined;

        return {
            recaptchaV2Key,
            hcaptchaKey,
            turnstileKey,
            recaptchaV3Key,
            hasRecaptchaIframe: Boolean(document.querySelector('iframe[src*="google.com/recaptcha"]')),
            hasHcaptchaIframe: Boolean(document.querySelector('iframe[src*="hcaptcha.com"]')),
            hasTurnstile: Boolean(document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]')),
        };
    });

    if (dom.turnstileKey || dom.hasTurnstile) {
        return {
            type: 'turnstile',
            siteKey: dom.turnstileKey,
            solvable: Boolean(dom.turnstileKey),
            reason: dom.turnstileKey ? undefined : 'Turnstile detected but sitekey not found in DOM',
        };
    }

    if (dom.hcaptchaKey || dom.hasHcaptchaIframe) {
        return {
            type: 'hcaptcha',
            siteKey: dom.hcaptchaKey,
            solvable: Boolean(dom.hcaptchaKey),
            reason: dom.hcaptchaKey ? undefined : 'hCaptcha detected but sitekey not found in DOM',
        };
    }

    if (dom.recaptchaV2Key || dom.hasRecaptchaIframe) {
        return {
            type: 'recaptcha_v2',
            siteKey: dom.recaptchaV2Key,
            solvable: Boolean(dom.recaptchaV2Key),
            reason: dom.recaptchaV2Key ? undefined : 'reCAPTCHA detected but sitekey not found in DOM',
        };
    }

    if (dom.recaptchaV3Key && dom.recaptchaV3Key !== 'explicit') {
        return {
            type: 'recaptcha_v3',
            siteKey: dom.recaptchaV3Key,
            pageAction: extractRecaptchaV3Action(html),
            solvable: true,
        };
    }

    const perimeterxSignals = [
        'robot or human',
        'activate and hold the button',
        'press & hold',
        'perimeterx',
        'px-captcha',
        'human security',
    ];
    if (perimeterxSignals.some((s) => lower.includes(s) || titleLower.includes(s))) {
        return {
            type: 'perimeterx',
            solvable: false,
            reason: 'PerimeterX hold-button challenges are behavioral and not supported by 2Captcha',
        };
    }

    const akamaiSignals = [
        'checking your browser before you access',
        'splashui/challenge',
        'challenge-container',
        'akamai',
        '_abck',
    ];
    if (akamaiSignals.some((s) => lower.includes(s))) {
        return {
            type: 'akamai',
            solvable: false,
            reason: 'Akamai JS challenges require cookie/session bypass, not token injection',
        };
    }

    const amazonSignals = [
        'type the characters you see in this image',
        'enter the characters you see below',
        'automated access to amazon data',
        'api-services-support@amazon.com',
    ];
    if (amazonSignals.some((s) => lower.includes(s)) || titleLower.includes('robot check')) {
        if (lower.includes('type the characters') || lower.includes('enter the characters')) {
            return {
                type: 'image',
                solvable: false,
                reason: 'Amazon image captcha requires ImageToText flow (not implemented)',
            };
        }
        const siteKey = extractAmazonWafSiteKey(html);
        return {
            type: 'amazon_waf',
            siteKey,
            solvable: false,
            reason: 'Amazon WAF requires iv/captchaScript extraction (not fully implemented)',
        };
    }

    return null;
}

function extractRecaptchaV3Action(html: string): string | undefined {
    const match =
        html.match(/grecaptcha\.execute\([^,]+,\s*\{\s*action:\s*['"]([^'"]+)['"]/i) ??
        html.match(/"action"\s*:\s*"([^"]+)"/i);
    return match?.[1];
}

function extractAmazonWafSiteKey(html: string): string | undefined {
    const patterns = [
        /data-sitekey=["']([^"']+)["']/i,
        /"sitekey"\s*:\s*"([^"]+)"/i,
        /gokuProps\s*=\s*\{[^}]*"key"\s*:\s*"([^"]+)"/i,
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return match[1];
    }
    return undefined;
}

/** True when page shows a solvable captcha or known unsolvable bot UI worth logging. */
export function isCaptchaOrBotChallenge(
    html: string,
    pageTitle: string,
    detected: DetectedCaptcha | null,
): boolean {
    if (detected) return true;

    const titleLower = pageTitle.toLowerCase();
    const lower = html.toLowerCase();
    const genericSignals = [
        'robot check',
        'attention required',
        'verify you are human',
        'pardon our interruption',
        'access denied',
    ];
    return genericSignals.some((s) => titleLower.includes(s) || lower.includes(s));
}
