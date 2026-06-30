import type { ScrapedProduct } from '../types.js';
import {
    extractJsonLdProducts,
    getMetaContent,
    parsePrice,
    parseRating,
    truncateText,
    availabilityToInStock,
} from '../utils.js';
import type { HtmlSelector, ParseContext } from './types.js';

export function createEmptyProduct(
    url: string,
    platform: ScrapedProduct['platform'],
    source: ScrapedProduct['source'] = 'direct_url',
    searchKeyword: string | null = null,
): ScrapedProduct {
    return {
        url,
        platform,
        source,
        searchKeyword,
        title: null,
        currentPrice: null,
        currency: null,
        inStock: null,
        originalPrice: null,
        discountPercent: null,
        productId: null,
        brand: null,
        seller: null,
        imageUrl: null,
        imageUrls: [],
        description: null,
        category: null,
        sku: null,
        condition: null,
        rating: null,
        reviewCount: null,
        availabilityText: null,
        shippingInfo: null,
        highlights: [],
        priceUnavailableReason: null,
    };
}

export function applyJsonLdEnrichment(ctx: ParseContext, product: ScrapedProduct): void {
    const items = extractJsonLdProducts(ctx.html);
    const ld = items[0];
    if (!ld) return;

    if (!product.title && ld.name) product.title = ld.name;
    if (!product.brand) {
        product.brand = typeof ld.brand === 'string' ? ld.brand : ld.brand?.name ?? null;
    }
    if (!product.description && ld.description) {
        product.description = truncateText(ld.description, 500);
    }
    if (!product.sku && ld.sku) product.sku = String(ld.sku);
    if (!product.productId && ld.productID) product.productId = String(ld.productID);

    if (!product.imageUrl) {
        if (typeof ld.image === 'string') product.imageUrl = ld.image;
        else if (Array.isArray(ld.image) && ld.image[0]) product.imageUrl = ld.image[0];
    }
    if (product.imageUrls.length === 0) {
        if (typeof ld.image === 'string') product.imageUrls = [ld.image];
        else if (Array.isArray(ld.image)) product.imageUrls = ld.image.filter((i) => typeof i === 'string');
        if (product.imageUrl && !product.imageUrls.includes(product.imageUrl)) {
            product.imageUrls.unshift(product.imageUrl);
        }
    }

    if (product.rating == null && ld.aggregateRating?.ratingValue != null) {
        product.rating = parseRating(String(ld.aggregateRating.ratingValue));
    }
    if (product.reviewCount == null) {
        const count = ld.aggregateRating?.reviewCount ?? ld.aggregateRating?.ratingCount;
        if (count != null) product.reviewCount = Number.parseInt(String(count).replace(/[^\d]/g, ''), 10) || null;
    }

    const offers = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
    if (product.currentPrice == null && offers) {
        product.currentPrice = parsePrice(String(offers.price ?? offers.lowPrice ?? ''));
    }
    if (!product.currency && offers?.priceCurrency) product.currency = offers.priceCurrency;
    if (!product.seller && offers?.seller?.name) product.seller = offers.seller.name;
    if (product.inStock == null && offers?.availability) {
        product.inStock = availabilityToInStock(String(offers.availability));
    }
}

export function applyMetaEnrichment(html: string, product: ScrapedProduct): void {
    if (!product.title) product.title = getMetaContent(html, 'og:title');
    if (!product.imageUrl) product.imageUrl = getMetaContent(html, 'og:image');
    if (!product.description) {
        product.description = truncateText(getMetaContent(html, 'og:description') ?? getMetaContent(html, 'description'), 500);
    }
    if (product.currentPrice == null) {
        product.currentPrice =
            parsePrice(getMetaContent(html, 'og:price:amount')) ??
            parsePrice(getMetaContent(html, 'product:price:amount'));
    }
    if (!product.currency) {
        product.currency =
            getMetaContent(html, 'og:price:currency') ??
            getMetaContent(html, 'product:price:currency');
    }
}

export function dedupeTitle(title: string | null): string | null {
    if (!title) return null;
    const half = title.slice(0, Math.floor(title.length / 2));
    if (half.length > 10 && title === half + half) return half;
    return title.trim() || null;
}

export function extractEmbeddedPrice(html: string): number | null {
    const retailMatch = html.match(/"current_retail"\s*:\s*(\d+)/i);
    if (retailMatch) {
        const cents = Number.parseInt(retailMatch[1], 10);
        if (cents > 0) return cents / 100;
    }

    const patterns = [
        /"currentRetail"\s*:\s*(\d+(?:\.\d+)?)/,
        /"salePrice"\s*:\s*(\d+(?:\.\d+)?)/,
        /"formatted_current_price"\s*:\s*"\$?([\d,.]+)"/,
        /"price"\s*:\s*(\d+\.\d{2})/,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
            const price = parsePrice(match[1]);
            if (price != null && price > 0 && price < 1_000_000) return price;
        }
    }

    return null;
}

export function extractEmbeddedRating(html: string): { rating: number | null; reviewCount: number | null } {
    const ratingMatch =
        html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/) ??
        html.match(/"averageRating"\s*:\s*([\d.]+)/) ??
        html.match(/"rating"\s*:\s*([\d.]+)/);

    const countMatch =
        html.match(/"reviewCount"\s*:\s*"?([\d,]+)"?/) ??
        html.match(/"ratingCount"\s*:\s*"?([\d,]+)"?/) ??
        html.match(/"totalReviewCount"\s*:\s*([\d,]+)/);

    return {
        rating: ratingMatch ? parseRating(ratingMatch[1]) : null,
        reviewCount: countMatch ? Number.parseInt(countMatch[1].replace(/,/g, ''), 10) || null : null,
    };
}

export function parseReviewCount(text: string | null | undefined): number | null {
    if (!text) return null;
    const match = text.replace(/,/g, '').match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
}

export function isExtractionSuccessful(product: ScrapedProduct): boolean {
    if (!product.title) return false;
    if (product.platform === 'target') {
        if (product.currentPrice != null) return true;
        const explicitReasons: Array<NonNullable<ScrapedProduct['priceUnavailableReason']>> = [
            'see_price_in_cart',
            'map_pricing',
            'out_of_stock',
        ];
        return (
            product.priceUnavailableReason != null &&
            explicitReasons.includes(product.priceUnavailableReason)
        );
    }
    if (product.currentPrice != null) return true;
    if (product.inStock != null) return true;
    if (product.rating != null || product.reviewCount != null) return true;
    return false;
}

export function isBotPage(html: string, pageTitle: string): boolean {
    const titleLower = pageTitle.toLowerCase().trim();
    const lower = html.toLowerCase();

    if (titleLower.includes('error page')) return true;
    if (titleLower.includes('attention required')) return true;
    if (titleLower.includes('access denied')) return true;
    if (titleLower === 'amazon.com') return true;
    if (titleLower.includes('robot check')) return true;

    const hardSignals = [
        'type the characters you see in this image',
        'enter the characters you see below',
        'sorry, we just need to confirm you',
        'automated access to amazon data',
        'to discuss automated access to amazon',
    ];

    return hardSignals.some((signal) => lower.includes(signal));
}

export function mergePartial(base: ScrapedProduct, partial: Partial<ScrapedProduct>): ScrapedProduct {
    const merged = { ...base, ...partial };
    merged.highlights = partial.highlights?.length ? partial.highlights : base.highlights;
    merged.imageUrls = partial.imageUrls?.length ? partial.imageUrls : base.imageUrls;
    if (partial.imageUrl) merged.imageUrl = partial.imageUrl;
    else if (!merged.imageUrl && merged.imageUrls[0]) merged.imageUrl = merged.imageUrls[0];
    merged.title = dedupeTitle(merged.title);
    return merged;
}

/** Like mergePartial, but ignores null/undefined/empty partial fields so API fallbacks do not wipe HTML data. */
export function mergeDefinedPartial(base: ScrapedProduct, partial: Partial<ScrapedProduct>): ScrapedProduct {
    const defined: Partial<ScrapedProduct> = {};
    for (const [key, value] of Object.entries(partial) as [keyof ScrapedProduct, ScrapedProduct[keyof ScrapedProduct]][]) {
        if (value == null) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        (defined as Record<string, unknown>)[key as string] = value;
    }
    return mergePartial(base, defined);
}

export function pickText($: HtmlSelector, selectors: string[]): string | null {
    for (const selector of selectors) {
        const text = $(selector).first().text().trim();
        if (text) return text;
    }
    return null;
}
