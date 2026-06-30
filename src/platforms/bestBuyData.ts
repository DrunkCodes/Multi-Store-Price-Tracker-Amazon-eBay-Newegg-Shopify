import type { ScrapedProduct } from '../types.js';
import { parsePrice, parseRating } from '../utils.js';
import { parseReviewCount } from '../parsers/enrichment.js';

/** Best Buy embeds Apollo SSR cache + product-schema JSON-LD in the initial HTML. */
export function parseBestBuyEmbeddedData(html: string): Partial<ScrapedProduct> {
    const fromSchema = parseBestBuyProductSchema(html);
    const fromApollo = parseBestBuyApolloCache(html);

    return {
        title: fromApollo.title ?? fromSchema.title ?? null,
        currentPrice: fromApollo.currentPrice ?? fromSchema.currentPrice ?? null,
        originalPrice: fromApollo.originalPrice ?? fromSchema.originalPrice ?? null,
        inStock: fromApollo.inStock ?? fromSchema.inStock ?? null,
        productId: fromApollo.productId ?? fromSchema.productId ?? null,
        brand: fromApollo.brand ?? fromSchema.brand ?? null,
        imageUrl: fromApollo.imageUrl ?? fromSchema.imageUrl ?? null,
        rating: fromApollo.rating ?? fromSchema.rating ?? null,
        reviewCount: fromApollo.reviewCount ?? fromSchema.reviewCount ?? null,
        availabilityText: fromApollo.availabilityText ?? fromSchema.availabilityText ?? null,
        sku: fromSchema.sku ?? fromApollo.productId ?? null,
    };
}

function parseBestBuyProductSchema(html: string): Partial<ScrapedProduct> {
    const match =
        html.match(/<script[^>]*id=["']product-schema["'][^>]*>([\s\S]*?)<\/script>/i) ??
        html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return {};

    try {
        const data = JSON.parse(match[1].trim()) as Record<string, unknown>;
        const product = data['@type'] === 'Product' ? data : findProductJsonLd(data);
        if (!product) return {};

        const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        const offer = offers as Record<string, unknown> | undefined;
        const brand = product.brand as string | { name?: string } | undefined;
        const rating = product.aggregateRating as Record<string, unknown> | undefined;

        let inStock: boolean | null = null;
        const availability = String(offer?.availability ?? '');
        if (/instock/i.test(availability)) inStock = true;
        else if (/outofstock|soldout/i.test(availability)) inStock = false;

        const image = product.image;
        let imageUrl: string | null = null;
        if (typeof image === 'string') imageUrl = image;
        else if (Array.isArray(image) && typeof image[0] === 'string') imageUrl = image[0];

        return {
            title: typeof product.name === 'string' ? product.name : null,
            currentPrice: parsePrice(String(offer?.price ?? offer?.lowPrice ?? '')),
            originalPrice: parsePrice(String(offer?.highPrice ?? '')),
            inStock,
            productId: product.sku != null ? String(product.sku) : product.productID != null ? String(product.productID) : null,
            brand: typeof brand === 'string' ? brand : brand?.name ?? null,
            imageUrl,
            rating: rating?.ratingValue != null ? parseRating(String(rating.ratingValue)) : null,
            reviewCount:
                rating?.reviewCount != null
                    ? parseReviewCount(String(rating.reviewCount))
                    : rating?.ratingCount != null
                      ? parseReviewCount(String(rating.ratingCount))
                      : null,
            sku: product.sku != null ? String(product.sku) : null,
        };
    } catch {
        return {};
    }
}

function findProductJsonLd(node: unknown): Record<string, unknown> | null {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findProductJsonLd(item);
            if (found) return found;
        }
        return null;
    }

    const obj = node as Record<string, unknown>;
    if (obj['@type'] === 'Product' || (typeof obj.name === 'string' && (obj.sku != null || obj.offers != null))) {
        return obj;
    }

    if (obj['@graph'] && Array.isArray(obj['@graph'])) {
        return findProductJsonLd(obj['@graph']);
    }

    for (const value of Object.values(obj)) {
        const found = findProductJsonLd(value);
        if (found) return found;
    }
    return null;
}

function parseBestBuyApolloCache(html: string): Partial<ScrapedProduct> {
    const productId =
        extractFirstMatch(html, /"productBySkuId"\s*:\s*\{[\s\S]{0,800}?"skuId"\s*:\s*"?(\d{5,})"?/i) ??
        extractFirstMatch(html, /"skuId"\s*:\s*"?(\d{5,})"?/i);

    const title =
        extractJsonStringField(html, /"name"\s*:\s*\{[\s\S]{0,200}?"short"\s*:\s*"([^"\\]+)"/i) ??
        extractJsonStringField(html, /"short"\s*:\s*"([^"\\]{8,})"/i);

    const brand =
        extractJsonStringField(html, /"productBySkuId"\s*:\s*\{[\s\S]{0,600}?"brand"\s*:\s*"([^"\\]+)"/i) ??
        extractJsonStringField(html, /"brand"\s*:\s*"([^"\\]+)"/i);

    const currentPrice =
        parseEmbeddedPrice(html, 'customerPrice') ??
        parseEmbeddedPrice(html, 'currentPrice') ??
        parseEmbeddedPrice(html, 'salePrice');

    const originalPrice =
        parseEmbeddedPrice(html, 'regularPrice') ??
        parseEmbeddedPrice(html, 'wasPrice');

    const buttonState = extractFirstMatch(html, /"buttonState"\s*:\s*"([A-Z_]+)"/i);
    const inStock = buttonStateToInStock(buttonState);

    const imageHref = extractJsonStringField(html, /"primaryImage"\s*:\s*\{[\s\S]{0,300}?"piscesHref"\s*:\s*"([^"\\]+)"/i);
    const imageUrl = imageHref ? (imageHref.startsWith('http') ? imageHref : `https:${imageHref}`) : null;

    const ratingValue = extractFirstMatch(html, /"aggregateRating"\s*:\s*\{[\s\S]{0,200}?"ratingValue"\s*:\s*"?([\d.]+)"?/i);
    const reviewCountRaw = extractFirstMatch(html, /"aggregateRating"\s*:\s*\{[\s\S]{0,300}?"reviewCount"\s*:\s*"?([\d,]+)"?/i);

    const shippingEligible = extractFirstMatch(html, /"shippingEligible"\s*:\s*(true|false)/i);
    const availabilityText = buttonState ? mapButtonStateLabel(buttonState) : null;

    let resolvedInStock = inStock;
    if (resolvedInStock == null && shippingEligible === 'true') resolvedInStock = true;
    if (resolvedInStock == null && shippingEligible === 'false' && buttonState === 'SOLD_OUT') resolvedInStock = false;

    return {
        title,
        currentPrice,
        originalPrice: originalPrice && currentPrice && originalPrice > currentPrice ? originalPrice : null,
        inStock: resolvedInStock,
        productId,
        brand,
        imageUrl,
        rating: ratingValue ? parseRating(ratingValue) : null,
        reviewCount: reviewCountRaw ? parseReviewCount(reviewCountRaw) : null,
        availabilityText,
    };
}

function extractFirstMatch(html: string, pattern: RegExp): string | null {
    const match = html.match(pattern);
    return match?.[1] ?? null;
}

function extractJsonStringField(html: string, pattern: RegExp): string | null {
    const match = html.match(pattern);
    if (!match?.[1]) return null;
    return match[1].replace(/\\u0026/g, '&').replace(/\\"/g, '"').trim() || null;
}

function parseEmbeddedPrice(html: string, field: string): number | null {
    const objectMatch = html.match(new RegExp(`"${field}"\\s*:\\s*\\{[^}]*"amount"\\s*:\\s*([\\d.]+)`, 'i'));
    if (objectMatch) {
        const price = parsePrice(objectMatch[1]);
        if (price != null && price > 0) return price;
    }

    const scalarMatch = html.match(new RegExp(`"${field}"\\s*:\\s*([\\d.]+)`, 'i'));
    if (scalarMatch) {
        const raw = Number.parseFloat(scalarMatch[1]);
        if (Number.isFinite(raw) && raw > 0) {
            // Apollo sometimes stores cents for integer values > 100 without decimal
            return raw >= 1000 && !scalarMatch[1].includes('.') ? raw / 100 : raw;
        }
    }

    return null;
}

function buttonStateToInStock(buttonState: string | null): boolean | null {
    if (!buttonState) return null;
    switch (buttonState.toUpperCase()) {
        case 'ADD_TO_CART':
        case 'BUY_NOW':
            return true;
        case 'SOLD_OUT':
        case 'NOT_AVAILABLE':
        case 'COMING_SOON':
            return false;
        case 'CHECK_STORES':
            return null;
        default:
            return null;
    }
}

function mapButtonStateLabel(buttonState: string): string {
    switch (buttonState.toUpperCase()) {
        case 'ADD_TO_CART':
        case 'BUY_NOW':
            return 'In Stock';
        case 'SOLD_OUT':
            return 'Sold Out';
        case 'COMING_SOON':
            return 'Coming Soon';
        case 'NOT_AVAILABLE':
            return 'Currently Unavailable';
        case 'CHECK_STORES':
            return 'Check Stores';
        default:
            return buttonState;
    }
}
