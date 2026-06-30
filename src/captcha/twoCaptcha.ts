import type { Page } from 'playwright';
import { detectCaptchaOnPage, type DetectedCaptcha } from './detect.js';

const API_BASE = 'https://api.2captcha.com';
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface TwoCaptchaSolveOptions {
    apiKey?: string;
    pageUrl?: string;
    minScore?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
    log?: (message: string) => void;
}

interface CreateTaskResponse {
    errorId: number;
    errorCode?: string;
    errorDescription?: string;
    taskId?: number;
}

interface GetTaskResultResponse {
    errorId: number;
    errorCode?: string;
    errorDescription?: string;
    status?: 'processing' | 'ready';
    solution?: {
        gRecaptchaResponse?: string;
        token?: string;
        captcha_voucher?: string;
        userAgent?: string;
    };
    cost?: string;
}

/** Read API key from env (TWOCAPTCHA_API_KEY or CAPTCHA_API_KEY alias) or optional override. */
export function getTwoCaptchaApiKey(override?: string | null): string | null {
    const key = override?.trim() || process.env.TWOCAPTCHA_API_KEY?.trim() || process.env.CAPTCHA_API_KEY?.trim();
    return key || null;
}

export function isTwoCaptchaConfigured(override?: string | null): boolean {
    return Boolean(getTwoCaptchaApiKey(override));
}

function logMessage(log: TwoCaptchaSolveOptions['log'], message: string): void {
    log?.(`[2captcha] ${message}`);
}

async function createTask(clientKey: string, task: Record<string, unknown>): Promise<number> {
    const response = await fetch(`${API_BASE}/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey, task }),
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        throw new Error(`createTask HTTP ${response.status}`);
    }

    const body = (await response.json()) as CreateTaskResponse;
    if (body.errorId !== 0 || !body.taskId) {
        throw new Error(body.errorDescription ?? body.errorCode ?? 'createTask failed');
    }

    return body.taskId;
}

async function pollTaskResult(
    clientKey: string,
    taskId: number,
    pollIntervalMs: number,
    timeoutMs: number,
): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

        const response = await fetch(`${API_BASE}/getTaskResult`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientKey, taskId }),
            signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
            throw new Error(`getTaskResult HTTP ${response.status}`);
        }

        const body = (await response.json()) as GetTaskResultResponse;
        if (body.errorId !== 0) {
            throw new Error(body.errorDescription ?? body.errorCode ?? 'getTaskResult failed');
        }

        if (body.status === 'ready') {
            const token =
                body.solution?.gRecaptchaResponse ??
                body.solution?.token ??
                body.solution?.captcha_voucher;
            if (!token) throw new Error('2Captcha returned ready status without a token');
            return token;
        }
    }

    throw new Error(`2Captcha task ${taskId} timed out after ${timeoutMs}ms`);
}

function buildTask(detected: DetectedCaptcha, pageUrl: string, minScore: number): Record<string, unknown> | null {
    const websiteURL = pageUrl;
    const websiteKey = detected.siteKey;

    switch (detected.type) {
        case 'recaptcha_v2':
            if (!websiteKey) return null;
            return { type: 'RecaptchaV2TaskProxyless', websiteURL, websiteKey };
        case 'recaptcha_v3':
            if (!websiteKey) return null;
            return {
                type: 'RecaptchaV3TaskProxyless',
                websiteURL,
                websiteKey,
                minScore,
                pageAction: detected.pageAction ?? 'verify',
            };
        case 'hcaptcha':
            if (!websiteKey) return null;
            return { type: 'HCaptchaTaskProxyless', websiteURL, websiteKey };
        case 'turnstile':
            if (!websiteKey) return null;
            return { type: 'TurnstileTaskProxyless', websiteURL, websiteKey };
        default:
            return null;
    }
}

export async function solveCaptchaToken(
    detected: DetectedCaptcha,
    options: TwoCaptchaSolveOptions = {},
): Promise<string | null> {
    const apiKey = getTwoCaptchaApiKey(options.apiKey);
    if (!apiKey) return null;

    if (!detected.solvable) {
        logMessage(options.log, `skipped ${detected.type}: ${detected.reason ?? 'not solvable'}`);
        return null;
    }

    const pageUrl = options.pageUrl ?? '';
    const task = buildTask(detected, pageUrl, options.minScore ?? 0.3);
    if (!task) {
        logMessage(options.log, `skipped ${detected.type}: missing sitekey or unsupported task`);
        return null;
    }

    logMessage(options.log, `creating ${detected.type} task for ${pageUrl}`);
    const taskId = await createTask(apiKey, task);
    logMessage(options.log, `task ${taskId} created — polling for result`);

    const token = await pollTaskResult(
        apiKey,
        taskId,
        options.pollIntervalMs ?? DEFAULT_POLL_MS,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    logMessage(options.log, `task ${taskId} solved`);
    return token;
}

/** Inject solved token and trigger common captcha callbacks. */
export async function injectCaptchaToken(page: Page, detected: DetectedCaptcha, token: string): Promise<void> {
    await page.evaluate(
        ({ captchaType, captchaToken }) => {
            const setTextarea = (selector: string) => {
                const el = document.querySelector<HTMLTextAreaElement>(selector);
                if (el) {
                    el.value = captchaToken;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            };

            switch (captchaType) {
                case 'recaptcha_v2':
                case 'recaptcha_v3':
                case 'amazon_waf':
                    setTextarea('#g-recaptcha-response');
                    setTextarea('textarea[name="g-recaptcha-response"]');
                    break;
                case 'hcaptcha':
                    setTextarea('[name="h-captcha-response"]');
                    setTextarea('textarea[name="h-captcha-response"]');
                    break;
                case 'turnstile':
                    setTextarea('[name="cf-turnstile-response"]');
                    setTextarea('input[name="cf-turnstile-response"]');
                    break;
                default:
                    break;
            }

            const win = window as Window & {
                grecaptcha?: {
                    getResponse?: () => string;
                    execute?: (...args: unknown[]) => void;
                };
                ___grecaptcha_cfg?: {
                    clients?: Record<string, { callback?: (...args: unknown[]) => void }>;
                };
                hcaptcha?: { setResponse?: (widgetId: string, response: string) => void };
                turnstile?: { render?: (...args: unknown[]) => void };
            };

            if (captchaType === 'recaptcha_v2' || captchaType === 'amazon_waf') {
                const cfg = win.___grecaptcha_cfg?.clients;
                if (cfg) {
                    for (const client of Object.values(cfg)) {
                        client.callback?.(captchaToken);
                    }
                }
            }

            if (captchaType === 'recaptcha_v3') {
                const cfg = win.___grecaptcha_cfg?.clients;
                if (cfg) {
                    for (const client of Object.values(cfg)) {
                        client.callback?.(captchaToken);
                    }
                }
            }

            const submitBtn = document.querySelector<HTMLButtonElement>(
                'button[type="submit"], input[type="submit"], #captchacharacters + button, form button',
            );
            submitBtn?.click();
        },
        { captchaType: detected.type, captchaToken: token },
    );
}

/**
 * Detect captcha on page, solve via 2Captcha when configured, inject token, and wait for navigation.
 * Returns true when a token was injected (caller should re-fetch page content).
 */
export async function solveCaptchaOnPage(page: Page, options: TwoCaptchaSolveOptions = {}): Promise<boolean> {
    const apiKey = getTwoCaptchaApiKey(options.apiKey);
    if (!apiKey) {
        logMessage(options.log, 'skipped — no API key (set TWOCAPTCHA_API_KEY or CAPTCHA_API_KEY)');
        return false;
    }

    const pageUrl = options.pageUrl ?? page.url();
    const html = await page.content();
    const pageTitle = await page.title();
    const detected = await detectCaptchaOnPage(page, { html, pageTitle });

    if (!detected) {
        logMessage(options.log, 'skipped — no captcha detected on page');
        return false;
    }

    if (!detected.solvable) {
        logMessage(options.log, `skipped ${detected.type}: ${detected.reason ?? 'not solvable via 2Captcha'}`);
        return false;
    }

    const token = await solveCaptchaToken(detected, { ...options, pageUrl, apiKey });
    if (!token) return false;

    await injectCaptchaToken(page, detected, token);

    await Promise.race([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined),
        page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined),
        page.waitForTimeout(5_000),
    ]);

    return true;
}
