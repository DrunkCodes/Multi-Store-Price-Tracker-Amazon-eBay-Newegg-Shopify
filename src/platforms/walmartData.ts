import type { ScrapedProduct } from '../types.js';
import { calcDiscountPercent, parsePrice, parseRating } from '../utils.js';
import { parseReviewCount } from '../parsers/enrichment.js';

/** Walmart embeds product JSON in __NEXT_DATA__ (used by Apify walmart scrapers). */
export function parseWalmartNextData(html: string): Partial<ScrapedProduct> {
    const nextMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextMatch) {
        try {
            const data = JSON.parse(nextMatch[1]) as Record<string, unknown>;
            const canonical = parseWalmartCanonicalProduct(data);
            if (canonical) return mapWalmartProduct(canonical);

            const fromTree = parseWalmartProductNode(data);
            if (fromTree) return fromTree;
        } catch {
            /* fall through to preloaded / APP_DATA */
        }
    }

    const appMatch = html.match(/<script[^>]*id=["']__APP_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (appMatch) {
        try {
            const data = JSON.parse(appMatch[1]) as Record<string, unknown>;
            const fromTree = parseWalmartProductNode(data);
            if (fromTree) return fromTree;
        } catch {
            /* fall through */
        }
    }

    return parseWalmartPreloaded(html);
}

/** Canonical path: props.pageProps.initialData.data.product */
function parseWalmartCanonicalProduct(data: Record<string, unknown>): Record<string, unknown> | null {
    const props = data.props as Record<string, unknown> | undefined;
    const pageProps = props?.pageProps as Record<string, unknown> | undefined;
    const initialData = pageProps?.initialData as Record<string, unknown> | undefined;
    const initialDataData = initialData?.data as Record<string, unknown> | undefined;
    const product = initialDataData?.product;
    return product && typeof product === 'object' ? (product as Record<string, unknown>) : null;
}

function parseWalmartPreloaded(html: string): Partial<ScrapedProduct> {
    const result: Partial<ScrapedProduct> = {};

    const priceMatch =
        html.match(/"currentPrice"\s*:\s*\{\s*"price"\s*:\s*([\d.]+)/i) ??
        html.match(/"priceInfo"\s*:\s*\{[^}]*"currentPrice"\s*:\s*\{\s*"price"\s*:\s*([\d.]+)/i);

    if (priceMatch) result.currentPrice = parsePrice(priceMatch[1]);

    const wasMatch = html.match(/"wasPrice"\s*:\s*([\d.]+)/i) ?? html.match(/"listPrice"\s*:\s*([\d.]+)/i);
    if (wasMatch) result.originalPrice = parsePrice(wasMatch[1]);

    const nameMatch = html.match(/"name"\s*:\s*"((?:\\.|[^"\\])+)"/i);
    if (nameMatch) result.title = nameMatch[1].replace(/\\"/g, '"');

    const usItemId = html.match(/"usItemId"\s*:\s*"(\d+)"/i)?.[1];
    if (usItemId) result.productId = usItemId;

    const brandMatch = html.match(/"brand"\s*:\s*"([^"]+)"/i);
    if (brandMatch) result.brand = brandMatch[1];

    const avgRating = html.match(/"averageRating"\s*:\s*([\d.]+)/i)?.[1];
    if (avgRating) result.rating = parseRating(avgRating);

    const reviewCount = html.match(/"numberOfReviews"\s*:\s*(\d+)/i)?.[1];
    if (reviewCount) result.reviewCount = parseReviewCount(reviewCount);

    const availability =
        html.match(/"availabilityStatus"\s*:\s*"([^"]+)"/i)?.[1]?.toLowerCase() ??
        html.match(/"availabilityStatusV2"\s*:\s*\{[^}]*"value"\s*:\s*"([^"]+)"/i)?.[1]?.toLowerCase();
    if (availability?.includes('in_stock')) result.inStock = true;
    else if (availability?.includes('out_of_stock')) result.inStock = false;

    if (result.currentPrice != null && result.originalPrice != null) {
        result.discountPercent = calcDiscountPercent(result.currentPrice, result.originalPrice);
    }

    result.currency = 'USD';
    return result;
}

function parseWalmartProductNode(node: unknown): Partial<ScrapedProduct> | null {
    const product = findWalmartProductNode(node);
    if (!product) return null;
    return mapWalmartProduct(product);
}

function mapWalmartProduct(product: Record<string, unknown>): Partial<ScrapedProduct> {
    const priceInfo = product.priceInfo as Record<string, unknown> | undefined;
    const currentPriceNode = priceInfo?.currentPrice as Record<string, unknown> | undefined;
    const wasPriceNode = priceInfo?.wasPrice as Record<string, unknown> | undefined;
    const listPriceNode = priceInfo?.listPrice as Record<string, unknown> | undefined;

    const currentPrice =
        parsePrice(String(currentPriceNode?.price ?? currentPriceNode?.priceString ?? '')) ??
        parsePrice(String(product.price ?? ''));

    const originalPrice =
        parsePrice(String(wasPriceNode?.price ?? wasPriceNode?.priceString ?? '')) ??
        parsePrice(String(listPriceNode?.price ?? listPriceNode?.priceString ?? '')) ??
        parsePrice(String(product.listPrice ?? ''));

    const availV2 = product.availabilityStatusV2 as Record<string, unknown> | undefined;
    const availability = String(
        availV2?.value ?? product.availabilityStatus ?? product.availability ?? '',
    ).toLowerCase();
    let inStock: boolean | null = null;
    if (availability.includes('in_stock') || availability === 'available') inStock = true;
    else if (availability.includes('out_of_stock') || availability === 'out of stock') inStock = false;

    const imageInfo = product.imageInfo as Record<string, unknown> | undefined;
    const imageUrl = typeof imageInfo?.thumbnailUrl === 'string' ? imageInfo.thumbnailUrl : null;

    const productId = product.usItemId ?? product.id;
    const brand = typeof product.brand === 'string' ? product.brand : null;

    return {
        title: typeof product.name === 'string' ? product.name : null,
        currentPrice,
        originalPrice: originalPrice && currentPrice && originalPrice > currentPrice ? originalPrice : null,
        discountPercent: currentPrice && originalPrice ? calcDiscountPercent(currentPrice, originalPrice) : null,
        inStock,
        productId: productId != null ? String(productId) : null,
        brand,
        seller: typeof product.sellerName === 'string' ? product.sellerName : null,
        imageUrl,
        imageUrls: imageUrl ? [imageUrl] : [],
        rating: parseRating(String(product.averageRating ?? '')),
        reviewCount: parseReviewCount(String(product.numberOfReviews ?? product.reviewCount ?? '')),
        description: typeof product.shortDescription === 'string' ? product.shortDescription.slice(0, 500) : null,
        availabilityText:
            typeof availV2?.display === 'string'
                ? availV2.display
                : typeof product.availabilityStatus === 'string'
                  ? product.availabilityStatus
                  : null,
        currency: 'USD',
    };
}

function findWalmartProductNode(node: unknown): Record<string, unknown> | null {
    if (!node || typeof node !== 'object') return null;

    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findWalmartProductNode(item);
            if (found) return found;
        }
        return null;
    }

    const obj = node as Record<string, unknown>;
    if (
        (obj.usItemId != null || obj.id != null) &&
        (obj.priceInfo != null || obj.name != null || obj.price != null)
    ) {
        return obj;
    }

    for (const value of Object.values(obj)) {
        const found = findWalmartProductNode(value);
        if (found) return found;
    }

    return null;
}
