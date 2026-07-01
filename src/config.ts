/** Internal scraper tuning — not exposed in Actor input. */
export const SCRAPER_MAX_CONCURRENCY = 1;
export const SCRAPER_MAX_REQUEST_RETRIES = 3;
export const SCRAPER_REQUEST_HANDLER_TIMEOUT_SECS = 120;
export const SCRAPER_NAVIGATION_TIMEOUT_MS = 45_000;
export const SCRAPER_SESSION_POOL_MAX = 5;

export function resolveCaptchaApiKey(): string | null {
    return process.env.TWOCAPTCHA_API_KEY?.trim() || process.env.CAPTCHA_API_KEY?.trim() || null;
}
