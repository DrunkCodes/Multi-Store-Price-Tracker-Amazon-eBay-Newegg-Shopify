import type { Platform } from '../types.js';

/** Platforms that support keyword search mode. */
export const SEARCHABLE_PLATFORMS: Platform[] = [
    'amazon',
    'walmart',
    'ebay',
    'target',
    'bestbuy',
    'homedepot',
    'newegg',
    'kohls',
    'etsy',
    'wayfair',
];

export function isSearchablePlatform(platform: string): platform is Platform {
    return SEARCHABLE_PLATFORMS.includes(platform as Platform);
}

export function buildSearchUrl(platform: Platform, keyword: string): string {
    const q = encodeURIComponent(keyword.trim());
    switch (platform) {
        case 'amazon':
            return `https://www.amazon.com/s?k=${q}`;
        case 'walmart':
            return `https://www.walmart.com/search?q=${q}`;
        case 'ebay':
            return `https://www.ebay.com/sch/i.html?_nkw=${q}`;
        case 'target':
            return `https://www.target.com/s?searchTerm=${q}`;
        case 'bestbuy':
            return `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`;
        case 'homedepot':
            return `https://www.homedepot.com/s/${q}`;
        case 'newegg':
            return `https://www.newegg.com/p/pl?d=${q}`;
        case 'kohls':
            return `https://www.kohls.com/search.jsp?search=${q}`;
        case 'etsy':
            return `https://www.etsy.com/search?q=${q}`;
        case 'wayfair':
            return `https://www.wayfair.com/keyword.php?keyword=${q}`;
        default:
            throw new Error(`Keyword search is not supported for platform: ${platform}`);
    }
}

const URL_PATTERNS: Partial<Record<Platform, RegExp>> = {
    amazon: /\/dp\/([A-Z0-9]{10})/i,
    walmart: /\/ip\/(?:[^/]+\/)?(\d+)/i,
    ebay: /\/itm\/(\d+)/i,
    target: /\/p\/[^/]+\/-\/A-(\d+)/i,
    bestbuy: /\/(\d{7,})\.p(?:\/|$|\?)/i,
    homedepot: /\/p\/[^/]+\/(\d+)/i,
    newegg: /\/p\/[^/]+\/([A-Z0-9-]+)/i,
    kohls: /\/product\/prd-(\d+)/i,
    etsy: /\/listing\/(\d+)/i,
    wayfair: /\/[^/]+\/[^/]+-(\w+)\.html/i,
};

function normalizeSearchResultUrl(platform: Platform, href: string): string | null {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;

    const bases: Partial<Record<Platform, string>> = {
        amazon: 'https://www.amazon.com',
        walmart: 'https://www.walmart.com',
        ebay: 'https://www.ebay.com',
        target: 'https://www.target.com',
        bestbuy: 'https://www.bestbuy.com',
        homedepot: 'https://www.homedepot.com',
        newegg: 'https://www.newegg.com',
        kohls: 'https://www.kohls.com',
        etsy: 'https://www.etsy.com',
        wayfair: 'https://www.wayfair.com',
    };

    try {
        let absolute = href.startsWith('http') ? href : `${bases[platform] ?? ''}${href.startsWith('/') ? href : `/${href}`}`;

        if (platform === 'amazon') {
            const asin = absolute.match(/\/dp\/([A-Z0-9]{10})/i)?.[1];
            return asin ? `https://www.amazon.com/dp/${asin.toUpperCase()}` : null;
        }
        if (platform === 'target') {
            const match = absolute.match(/target\.com(\/p\/[^?#]+)/i);
            return match ? `https://www.target.com${match[1]}` : null;
        }
        if (platform === 'walmart') {
            const match = absolute.match(/walmart\.com(\/ip\/[^?#]+)/i);
            return match ? `https://www.walmart.com${match[1]}` : null;
        }
        if (platform === 'ebay') {
            const match = absolute.match(/ebay\.com(\/itm\/\d+)/i);
            return match ? `https://www.ebay.com${match[1]}` : null;
        }

        absolute = absolute.split('?')[0].split('#')[0];
        const pattern = URL_PATTERNS[platform];
        return pattern?.test(absolute) ? absolute : null;
    } catch {
        return null;
    }
}

export function extractSearchResultUrls(platform: Platform, html: string, maxResults: number): string[] {
    const found = new Set<string>();
    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html)) !== null && found.size < maxResults) {
        const normalized = normalizeSearchResultUrl(platform, match[1]);
        if (normalized) found.add(normalized);
    }

    // Platform-specific fallbacks from embedded JSON / data attributes
    if (platform === 'amazon') {
        for (const asinMatch of html.matchAll(/data-asin=["']([A-Z0-9]{10})["']/gi)) {
            if (asinMatch[1] && asinMatch[1] !== '0000000000') {
                found.add(`https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`);
                if (found.size >= maxResults) break;
            }
        }
        if (found.size < maxResults) {
            for (const asinMatch of html.matchAll(/\/dp\/([A-Z0-9]{10})/gi)) {
                found.add(`https://www.amazon.com/dp/${asinMatch[1].toUpperCase()}`);
                if (found.size >= maxResults) break;
            }
        }
    }

    if (platform === 'target' && found.size < maxResults) {
        for (const tMatch of html.matchAll(/\/p\/[^"'\s]+\/-\/A-(\d+)/gi)) {
            const path = tMatch[0].startsWith('http') ? tMatch[0] : `https://www.target.com${tMatch[0]}`;
            found.add(path.split('?')[0]);
            if (found.size >= maxResults) break;
        }
    }

    return [...found].slice(0, maxResults);
}

export const SEARCH_WAIT_SELECTORS: Partial<Record<Platform, string>> = {
    amazon: '[data-component-type="s-search-result"], .s-result-item',
    walmart: '[data-item-id], [data-testid="list-view"]',
    ebay: '.s-item, .srp-results',
    target: '[data-test="product-card"], [data-test="@web/ProductCard"]',
    bestbuy: '.sku-item, .product-list',
    homedepot: '[data-testid="product-pod"], .browse-search__pod',
    newegg: '.item-cell, .item-container',
    kohls: '.prod_item_block, .products',
    etsy: '[data-listing-id], .v2-listing-card',
    wayfair: '[data-test-id="ListingCard"], .ProductCard',
};
