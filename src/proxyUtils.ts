/** Proxy helpers shared by local and Apify entry points. */

export interface PlaywrightProxyConfig {
    server: string;
    username?: string;
    password?: string;
}

export interface ProxyEnvConfig {
    host: string;
    port: string;
    username?: string;
    password?: string;
    country?: string;
    poolSize?: number;
}

const DEFAULT_COUNTRY = 'us';

export function readProxyEnv(): ProxyEnvConfig | null {
    const host = process.env.PROXY_HOST?.trim();
    const port = process.env.PROXY_PORT?.trim();
    if (!host || !port) return null;

    return {
        host,
        port,
        username: process.env.PROXY_USERNAME?.trim(),
        password: process.env.PROXY_PASSWORD?.trim(),
        country: process.env.PROXY_COUNTRY?.trim().toLowerCase() || DEFAULT_COUNTRY,
        poolSize: Number.parseInt(process.env.PROXY_POOL_SIZE ?? '8', 10) || 8,
    };
}

/** DataImpulse country routing: username__cr.us */
export function withCountryRouting(username: string, country = DEFAULT_COUNTRY): string {
    const suffix = `__cr.${country.toLowerCase()}`;
    if (username.includes('__cr.')) return username;
    return `${username}${suffix}`;
}

/** DataImpulse session rotation: username__sessid.<id> */
export function withSessionId(username: string, sessionId: string): string {
    const base = username.replace(/__sessid\.[^_]+$/, '');
    return `${base}__sessid.${sessionId}`;
}

export function buildProxyUrl(config: ProxyEnvConfig, sessionId?: string): string {
    let username = config.username;
    const password = config.password;

    if (username && config.country) {
        username = withCountryRouting(username, config.country);
    }
    if (username && sessionId) {
        username = withSessionId(username, sessionId);
    }

    if (username && password) {
        return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${config.host}:${config.port}`;
    }

    return `http://${config.host}:${config.port}`;
}

export function buildRotatingProxyUrls(config: ProxyEnvConfig): string[] {
    const poolSize = config.poolSize ?? 8;
    return Array.from({ length: poolSize }, (_, index) =>
        buildProxyUrl(config, `${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`),
    );
}

/** Log-friendly summary of DataImpulse US routing (__cr.us) and optional sticky __sessid. */
export function describeProxyRouting(config: ProxyEnvConfig, sampleProductUrl?: string, sessionPrefix = 'wm'): string {
    const country = (config.country ?? DEFAULT_COUNTRY).toLowerCase();
    const baseUser = config.username ?? '(none)';
    const routedUser = config.username ? withCountryRouting(config.username, country) : baseUser;
    const hasCountrySuffix = routedUser.includes(`__cr.${country}`);
    const lines = [
        `PROXY_COUNTRY=${country}`,
        `country routing __cr.${country}: ${hasCountrySuffix ? 'yes' : 'no'}`,
        `proxy endpoint: ${config.host}:${config.port}`,
    ];
    if (config.username) {
        lines.push(`username (masked): ${baseUser.slice(0, 4)}***${hasCountrySuffix ? `__cr.${country}` : ''}`);
    }
    if (sampleProductUrl && config.username) {
        const stickyUser = withSessionId(routedUser, stickySessionIdForUrl(sampleProductUrl, sessionPrefix));
        lines.push(`sample sticky __sessid: ${stickySessionIdForUrl(sampleProductUrl, sessionPrefix)}`);
        lines.push(`sample routed username: ${stickyUser.slice(0, 4)}***__cr.${country}__sessid.${stickySessionIdForUrl(sampleProductUrl, sessionPrefix)}`);
    }
    return lines.join(' | ');
}

/** Stable session id from a product URL — same URL keeps the same DataImpulse __sessid across retries. */
export function stickySessionIdForUrl(url: string, prefix = 'wm'): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        hash = (Math.imul(31, hash) + url.charCodeAt(i)) | 0;
    }
    return `${prefix}_${Math.abs(hash).toString(36)}`;
}

/** One sticky proxy URL per product URL (no mid-item rotation). */
export function buildStickyProxyUrlsForProducts(
    config: ProxyEnvConfig,
    productUrls: string[],
    sessionPrefix = 'wm',
): Map<string, string> {
    const map = new Map<string, string>();
    for (const url of productUrls) {
        map.set(url, buildProxyUrl(config, stickySessionIdForUrl(url, sessionPrefix)));
    }
    return map;
}

export function buildProxyUrlFromEnv(): string | null {
    const config = readProxyEnv();
    if (!config) return null;
    return buildProxyUrl(config);
}

export function toPlaywrightProxy(proxyUrl: string): PlaywrightProxyConfig {
    const parsed = new URL(proxyUrl);
    const result: PlaywrightProxyConfig = {
        server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
    };

    if (parsed.username) result.username = decodeURIComponent(parsed.username);
    if (parsed.password) result.password = decodeURIComponent(parsed.password);

    return result;
}
