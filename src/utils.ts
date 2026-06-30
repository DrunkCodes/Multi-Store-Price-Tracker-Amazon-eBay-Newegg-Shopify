import type { Platform } from './types.js';

const PLATFORM_PATTERNS: Array<{ platform: Platform; patterns: RegExp[] }> = [
    { platform: 'amazon', patterns: [/amazon\.(com|ca|co\.uk|de|fr|it|es|in|co\.jp)/i] },
    { platform: 'walmart', patterns: [/walmart\.com/i] },
    { platform: 'ebay', patterns: [/ebay\.(com|co\.uk|de|ca|com\.au)/i] },
    { platform: 'target', patterns: [/target\.com/i] },
    { platform: 'bestbuy', patterns: [/bestbuy\.com/i] },
    { platform: 'homedepot', patterns: [/homedepot\.com/i] },
    { platform: 'costco', patterns: [/costco\.com/i] },
    { platform: 'etsy', patterns: [/etsy\.com/i] },
    { platform: 'wayfair', patterns: [/wayfair\.com/i] },
    { platform: 'newegg', patterns: [/newegg\.com/i] },
    { platform: 'kohls', patterns: [/kohls\.com/i] },
    { platform: 'shopify', patterns: [/\.myshopify\.com/i] },
];

export function detectPlatform(url: string): Platform {
    for (const { platform, patterns } of PLATFORM_PATTERNS) {
        if (patterns.some((p) => p.test(url))) {
            return platform;
        }
    }

    if (/\/products\/[^/?#]+/i.test(url) && !/amazon|walmart|target|ebay|bestbuy|etsy|wayfair|newegg|kohls|costco|homedepot/i.test(url)) {
        return 'shopify';
    }

    return 'generic';
}

export function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url.trim());
        parsed.hash = '';
        parsed.searchParams.delete('ref');
        parsed.searchParams.delete('ref_');
        parsed.searchParams.delete('tag');
        parsed.searchParams.delete('psc');
        parsed.searchParams.delete('th');

        if (/amazon\./i.test(parsed.hostname)) {
            const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
            if (asinMatch) {
                return `https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`;
            }
        }

        if (/walmart\.com/i.test(parsed.hostname)) {
            const idMatch = parsed.pathname.match(/\/ip\/(?:[^/]+\/)?(\d+)/i);
            if (idMatch) {
                parsed.pathname = parsed.pathname.replace(/\?.*$/, '');
                return parsed.toString().replace(/\/$/, '');
            }
        }

        return parsed.toString().replace(/\/$/, '');
    } catch {
        return url.trim();
    }
}

export function historyKey(normalizedUrl: string): string {
    return `history_${Buffer.from(normalizedUrl).toString('base64url').slice(0, 120)}`;
}

export function parsePrice(text: string | null | undefined): number | null {
    if (!text) return null;
    const cleaned = text.replace(/[^\d.,]/g, '').replace(/,/g, '');
    const value = parseFloat(cleaned);
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
    return value;
}

export function parseRating(text: string | null | undefined): number | null {
    if (!text) return null;
    const match = text.match(/([\d.]+)/);
    if (!match) return null;
    const value = parseFloat(match[1]);
    if (!Number.isFinite(value) || value <= 0 || value > 5) return null;
    return round2(value);
}

export function truncateText(text: string | null | undefined, maxLength: number): string | null {
    if (!text) return null;
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) return null;
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

export function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export function calcDiscountPercent(current: number, original: number): number | null {
    if (original <= 0 || current >= original) return null;
    return round2(((original - current) / original) * 100);
}

export function calcPriceChangePercent(current: number | null, previous: number | null): number | null {
    if (current == null || previous == null || previous === 0) return null;
    return round2(((current - previous) / previous) * 100);
}

export interface JsonLdProduct {
    name?: string;
    description?: string;
    brand?: string | { name?: string };
    image?: string | string[];
    sku?: string;
    productID?: string;
    category?: string;
    aggregateRating?: {
        ratingValue?: string | number;
        reviewCount?: string | number;
        ratingCount?: string | number;
    };
    offers?: JsonLdOffer | JsonLdOffer[];
}

export interface JsonLdOffer {
    price?: string | number;
    priceCurrency?: string;
    availability?: string;
    highPrice?: string | number;
    lowPrice?: string | number;
    seller?: { name?: string };
    itemCondition?: string;
}

export function extractJsonLdProducts(html: string): JsonLdProduct[] {
    const products: JsonLdProduct[] = [];
    const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim());
            collectJsonLdProducts(parsed, products);
        } catch {
            // ignore malformed JSON-LD blocks
        }
    }

    return products;
}

function collectJsonLdProducts(node: unknown, products: JsonLdProduct[]): void {
    if (!node) return;

    if (Array.isArray(node)) {
        node.forEach((item) => collectJsonLdProducts(item, products));
        return;
    }

    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    const type = obj['@type'];
    const types = Array.isArray(type) ? type : [type];

    if (types.some((t) => typeof t === 'string' && /Product/i.test(t))) {
        products.push(obj as JsonLdProduct);
    }

    if (obj['@graph']) {
        collectJsonLdProducts(obj['@graph'], products);
    }
}

export function availabilityToInStock(availability: string | undefined): boolean | null {
    if (!availability) return null;
    const lower = availability.toLowerCase();
    if (lower.includes('instock') || lower.includes('in stock')) return true;
    if (lower.includes('outofstock') || lower.includes('out of stock') || lower.includes('soldout')) return false;
    return null;
}

export function getMetaContent(html: string, property: string): string | null {
    const ogRegex = new RegExp(
        `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
        'i',
    );
    const ogMatch = html.match(ogRegex);
    if (ogMatch) return ogMatch[1];

    const reverseRegex = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
        'i',
    );
    const reverseMatch = html.match(reverseRegex);
    return reverseMatch?.[1] ?? null;
}
