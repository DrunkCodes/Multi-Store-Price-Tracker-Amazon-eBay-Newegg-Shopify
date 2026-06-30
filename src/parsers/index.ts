import type { ScrapedProduct } from '../types.js';
import {
    calcDiscountPercent,
    getMetaContent,
    parsePrice,
    parseRating,
    truncateText,
} from '../utils.js';
import {
    applyJsonLdEnrichment,
    applyMetaEnrichment,
    createEmptyProduct,
    extractEmbeddedPrice,
    extractEmbeddedRating,
    mergePartial,
    parseReviewCount,
    pickText,
} from './enrichment.js';
import { extractAmazonImages, parseTargetEmbeddedData } from './media.js';
import { parseBestBuyEmbeddedData } from '../platforms/bestBuyData.js';
import { parseWalmartNextData } from '../platforms/walmartData.js';
import { extractEbayEmbeddedData, parseEbayRich } from '../platforms/ebayHelpers.js';
import type { ParseContext } from './types.js';

export type { HtmlSelector, ParseContext } from './types.js';

export function parseProduct(ctx: ParseContext): ScrapedProduct {
    const base = createEmptyProduct(
        ctx.url,
        ctx.platform,
        ctx.source ?? 'direct_url',
        ctx.searchKeyword ?? null,
    );

    let partial: Partial<ScrapedProduct>;
    switch (ctx.platform) {
        case 'amazon':
            partial = parseAmazon(ctx);
            break;
        case 'walmart':
            partial = parseWalmart(ctx);
            break;
        case 'ebay':
            partial = parseEbay(ctx);
            break;
        case 'target':
            partial = parseTarget(ctx);
            break;
        case 'bestbuy':
            partial = parseBestBuy(ctx);
            break;
        case 'homedepot':
            partial = parseHomeDepot(ctx);
            break;
        case 'costco':
            partial = parseCostco(ctx);
            break;
        case 'etsy':
            partial = parseEtsy(ctx);
            break;
        case 'wayfair':
            partial = parseWayfair(ctx);
            break;
        case 'newegg':
            partial = parseNewegg(ctx);
            break;
        case 'kohls':
            partial = parseKohls(ctx);
            break;
        case 'shopify':
            partial = parseShopify(ctx);
            break;
        default:
            partial = parseGeneric(ctx);
    }

    const product = mergePartial(base, partial);
    applyJsonLdEnrichment(ctx, product);
    applyMetaEnrichment(ctx.html, product);

    if (product.currentPrice == null) {
        product.currentPrice = extractEmbeddedPrice(ctx.html);
    }
    if (product.rating == null || product.reviewCount == null) {
        const embedded = extractEmbeddedRating(ctx.html);
        if (product.rating == null) product.rating = embedded.rating;
        if (product.reviewCount == null) product.reviewCount = embedded.reviewCount;
    }

    if (product.currentPrice != null && product.originalPrice != null && product.discountPercent == null) {
        product.discountPercent = calcDiscountPercent(product.currentPrice, product.originalPrice);
    }

    if (!product.imageUrl && product.imageUrls[0]) product.imageUrl = product.imageUrls[0];

    return product;
}

function parseAmazon(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const asinMatch = ctx.url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);

    const title =
        pickText($, ['#productTitle', 'h1#title span', 'h1#title']) ??
        getMetaContent(html, 'og:title');

    let currentPrice = parsePrice($('.a-price:not(.a-text-price) span.a-offscreen').first().text());
    if (currentPrice == null) {
        const whole = $('.a-price .a-price-whole').first().text().replace(/[^\d]/g, '');
        const fraction = $('.a-price .a-price-fraction').first().text().replace(/[^\d]/g, '');
        if (whole && fraction) currentPrice = parsePrice(`${whole}.${fraction}`);
    }

    const originalPrice =
        parsePrice($('.a-price.a-text-price span.a-offscreen').first().text()) ??
        parsePrice($('.basisPrice .a-offscreen').first().text());

    const availabilityText = pickText($, ['#availability span', '#outOfStock']);
    let inStock: boolean | null = null;
    if (availabilityText) {
        const lower = availabilityText.toLowerCase();
        if (lower.includes('in stock')) inStock = true;
        else if (lower.includes('out of stock') || lower.includes('unavailable')) inStock = false;
    }
    if (inStock == null && ($('#add-to-cart-button, #buy-now-button').length > 0)) inStock = true;

    const ratingText = pickText($, ['span[data-hook="rating-out-of-text"]', '#acrPopover span.a-icon-alt']);
    const reviewText = pickText($, ['#acrCustomerReviewText', 'span[data-hook="total-review-count"]']);

    const brandRaw = pickText($, ['#bylineInfo', 'tr.po-brand td.a-span9 span']);
    const brand = brandRaw?.replace(/^Visit the |^Brand:\s*| Store$/gi, '').trim() || null;

    const highlights: string[] = [];
    const bulletsBlock = html.match(/id="feature-bullets"[\s\S]*?<\/ul>/i);
    if (bulletsBlock) {
        for (const match of bulletsBlock[0].matchAll(/<span class="a-list-item">([^<]{4,300})/gi)) {
            if (highlights.length >= 8) break;
            const text = match[1].trim();
            if (text) highlights.push(text);
        }
    }

    const imageUrls = extractAmazonImages(html);
    const imageUrl = imageUrls[0] ?? getMetaContent(html, 'og:image') ?? $('img#landingImage').attr('src') ?? null;

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock,
        originalPrice,
        discountPercent: currentPrice && originalPrice ? calcDiscountPercent(currentPrice, originalPrice) : null,
        productId: asinMatch?.[1]?.toUpperCase() ?? null,
        brand,
        seller: pickText($, ['#sellerProfileTriggerId', '#merchant-info']),
        imageUrl,
        imageUrls,
        description: truncateText(pickText($, ['#productDescription p', '#featurebullets_feature_div']), 500),
        rating: parseRating(ratingText),
        reviewCount: parseReviewCount(reviewText),
        availabilityText,
        shippingInfo: pickText($, ['#mir-layout-DELIVERY_BLOCK', '#deliveryBlockMessage']),
        highlights,
    };
}

function parseWalmart(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const fromNext = parseWalmartNextData(html);
    const idMatch = ctx.url.match(/\/ip\/(?:[^/]+\/)?(\d+)/i);

    const title =
        fromNext.title ??
        pickText($, ['h1[itemprop="name"]', '[data-automation="product-title"]', 'h1']) ??
        getMetaContent(html, 'og:title');

    const currentPrice =
        fromNext.currentPrice ??
        parsePrice($('[itemprop="price"]').attr('content')) ??
        parsePrice($('[data-automation="buybox-price"]').text()) ??
        parsePrice($('span[data-automation="product-price"]').text()) ??
        parsePrice($('[data-testid="price-wrap"]').text()) ??
        parsePrice($('span[data-seo-id="hero-price"]').text()) ??
        parsePrice($('[data-automation-id="product-price"]').text());

    const originalPrice =
        fromNext.originalPrice ?? parsePrice($('[data-automation="list-price"]').text());

    let inStock = fromNext.inStock;
    if (inStock == null) {
        const oosText = pickText($, ['span[data-automation="out-of-stock"]']);
        if (oosText?.toLowerCase().includes('out of stock')) inStock = false;
        else if ($('[data-automation="add-to-cart"], [data-testid="add-to-cart-button"]').length > 0) inStock = true;
    }

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock,
        originalPrice,
        discountPercent:
            currentPrice && originalPrice ? calcDiscountPercent(currentPrice, originalPrice) : fromNext.discountPercent,
        productId: fromNext.productId ?? idMatch?.[1] ?? null,
        brand: fromNext.brand ?? pickText($, ['[data-automation="product-brand"]', 'a[data-automation="product-brand-link"]']),
        imageUrl: fromNext.imageUrl ?? getMetaContent(html, 'og:image'),
        imageUrls: fromNext.imageUrls ?? (fromNext.imageUrl ? [fromNext.imageUrl] : []),
        rating: fromNext.rating,
        reviewCount: fromNext.reviewCount,
        description: fromNext.description,
        availabilityText: pickText($, ['span[data-automation="out-of-stock"]']),
    };
}

function parseEbay(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const fromJson = parseEbayRich(html);
    const embedded = extractEbayEmbeddedData(html);

    const title =
        fromJson.title ??
        embedded.title ??
        pickText($, ['h1.x-item-title__mainTitle', '#itemTitle', 'h1.it-ttl', 'h1']) ??
        getMetaContent(html, 'og:title')?.replace(/\s*\|\s*eBay\s*$/i, '').trim() ??
        null;

    const currentPrice =
        fromJson.currentPrice ??
        embedded.currentPrice ??
        parsePrice($('.x-price-primary span').text()) ??
        parsePrice($('#prcIsum').text()) ??
        parsePrice($('.display-price').text()) ??
        parsePrice($('[itemprop="price"]').attr('content'));

    const condition = fromJson.condition ?? pickText($, ['.x-item-condition-text', '.u-flL.condText']);

    const seller =
        fromJson.seller ??
        embedded.seller ??
        pickText($, [
            '.x-sellercard-atf__info__about-seller a',
            '.ux-seller-section__seller-name a',
            '.x-sellercard-atf__info__about-seller button',
            '[data-testid="x-sellercard-atf__about-seller"] a',
        ]);

    return {
        title,
        currentPrice,
        currency: fromJson.currency ?? 'USD',
        inStock: fromJson.inStock ?? embedded.inStock ?? ($('.x-out-of-stock').length === 0 && currentPrice != null),
        productId: fromJson.productId ?? embedded.productId,
        seller,
        imageUrl: fromJson.imageUrl ?? getMetaContent(html, 'og:image'),
        imageUrls: fromJson.imageUrls ?? [],
        description: fromJson.description,
        condition,
        rating: fromJson.rating ?? parseRating(pickText($, ['.x-star-rating span.clipped'])),
        reviewCount: fromJson.reviewCount ?? parseReviewCount(pickText($, ['.ux-seller-section__seller-rating'])),
        shippingInfo: pickText($, ['.ux-labels-values--shipping .ux-textspans', '#fshippingCost']),
    };
}

function parseTarget(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const fromNext = parseTargetNextData(html);
    const fromScripts = parseTargetEmbeddedData(html);

    const title =
        fromNext.title ??
        fromScripts.title ??
        pickText($, ['[data-test="product-title"]', 'h1']) ??
        getMetaContent(html, 'og:title');

    let currentPrice =
        fromNext.currentPrice ??
        fromScripts.currentPrice ??
        parsePrice(pickText($, ['[data-test="product-price"]', '[data-test="current-price"]', 'span[data-test="product-price"]']));
    if (currentPrice == null) {
        currentPrice = extractEmbeddedPrice(html);
    }

    let originalPrice = fromNext.originalPrice ?? fromScripts.originalPrice;
    let inStock = fromNext.inStock ?? fromScripts.inStock;
    if (inStock == null) {
        inStock = $('[data-test="shipItButton"], [data-test="orderPickupButton"]').length > 0;
    }

    const availabilityText = pickText($, ['[data-test="fulfillment-cell"]', '[data-test="productStockBadge"]']);

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock,
        originalPrice,
        discountPercent:
            currentPrice && originalPrice
                ? calcDiscountPercent(currentPrice, originalPrice)
                : null,
        productId: fromNext.productId ?? fromScripts.productId,
        brand: fromNext.brand ?? fromScripts.brand,
        imageUrl: fromScripts.imageUrl ?? getMetaContent(html, 'og:image'),
        imageUrls: fromScripts.imageUrl ? [fromScripts.imageUrl] : [],
        description: fromScripts.description,
        category: fromScripts.category,
        rating: fromNext.rating ?? fromScripts.rating,
        reviewCount: fromNext.reviewCount ?? fromScripts.reviewCount,
        availabilityText,
    };
}

function parseTargetNextData(html: string): Partial<ScrapedProduct> {
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return {};

    try {
        const data = JSON.parse(match[1]) as Record<string, unknown>;
        const product = findTargetProductNode(data);
        if (!product) return {};

        const title = typeof product.title === 'string' ? product.title : null;
        const priceNode = product.price as Record<string, unknown> | undefined;
        const currentPrice =
            parseTargetRetailCents(priceNode?.current_retail ?? product.current_retail) ??
            parsePrice(String(priceNode?.formatted_current_price ?? ''));

        const originalPrice =
            parseTargetRetailCents(priceNode?.reg_retail) ??
            parsePrice(String(priceNode?.formatted_comparison_price ?? ''));
        const availability = String(product.availability_status ?? product.available_to_purchase ?? '').toLowerCase();
        let inStock: boolean | null = null;
        if (availability.includes('in_stock') || availability === 'true') inStock = true;
        else if (availability.includes('out_of_stock') || availability === 'false') inStock = false;

        const ratings = product.ratings_and_reviews as Record<string, unknown> | undefined;
        const stats = ratings?.statistics as Record<string, unknown> | undefined;
        const ratingNode = stats?.rating as Record<string, unknown> | undefined;
        const rating = parseRating(String(ratingNode?.average ?? stats?.average_rating ?? ''));
        const reviewCount = parseReviewCount(String(stats?.review_count ?? stats?.total_review_count ?? ''));

        return {
            title,
            currentPrice,
            inStock,
            originalPrice: originalPrice && currentPrice && originalPrice > currentPrice ? originalPrice : null,
            productId: product.tcin != null ? String(product.tcin) : null,
            brand:
                (product.brand as { name?: string } | undefined)?.name ??
                (typeof product.brand === 'string' ? product.brand : null),
            rating,
            reviewCount,
        };
    } catch {
        return {};
    }
}

function parseTargetRetailCents(value: unknown): number | null {
    if (typeof value === 'number' && value > 0) return Math.round(value) / 100;
    return null;
}

function findTargetProductNode(node: unknown): Record<string, unknown> | null {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findTargetProductNode(item);
            if (found) return found;
        }
        return null;
    }

    const obj = node as Record<string, unknown>;
    if (typeof obj.title === 'string' && (obj.tcin != null || obj.price != null || obj.current_retail != null)) {
        return obj;
    }

    for (const value of Object.values(obj)) {
        const found = findTargetProductNode(value);
        if (found) return found;
    }
    return null;
}

function parseBestBuy(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const skuMatch = ctx.url.match(/\/(\d{5,})(?:\.p|\/|\?|$)/i);
    const fromEmbedded = parseBestBuyEmbeddedData(html);

    const title =
        fromEmbedded.title ??
        pickText($, ['.sku-title h1', '[data-testid="product-title"]', 'h1']) ??
        getMetaContent(html, 'og:title')?.replace(/\s*-\s*Best Buy\s*$/i, '').trim() ??
        null;

    const currentPrice =
        fromEmbedded.currentPrice ??
        parsePrice($('[data-testid="customer-price"] span').first().text()) ??
        parsePrice($('.priceView-customer-price span').first().text()) ??
        parsePrice($('[class*="priceView-customer-price"] span').first().text()) ??
        parsePrice($('[data-testid="price-block-customer-price"]').text());

    const originalPrice =
        fromEmbedded.originalPrice ??
        parsePrice($('[data-testid="regular-price"] span').text()) ??
        parsePrice($('.pricing-price__regular-price').text());

    let inStock = fromEmbedded.inStock;
    if (inStock == null) {
        const buttonState =
            $('[data-button-state]').first().attr('data-button-state') ??
            $('[data-testid="add-to-cart-button"]').attr('data-button-state');
        if (buttonState === 'ADD_TO_CART' || buttonState === 'BUY_NOW') inStock = true;
        else if (buttonState === 'SOLD_OUT' || buttonState === 'NOT_AVAILABLE') inStock = false;
        else if ($('.add-to-cart-button, [data-testid="add-to-cart-button"]').length > 0) inStock = true;
        else if ($('[data-button-state="SOLD_OUT"], .sold-out, [data-testid="sold-out"]').length > 0) inStock = false;
    }

    const availabilityText =
        fromEmbedded.availabilityText ??
        pickText($, ['[data-testid="fulfillment-shipping-text"]', '.fulfillment-fulfillment-summary', '.availability-message']);

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock,
        originalPrice,
        discountPercent:
            currentPrice && originalPrice ? calcDiscountPercent(currentPrice, originalPrice) : null,
        productId: fromEmbedded.productId ?? skuMatch?.[1] ?? null,
        brand: fromEmbedded.brand ?? pickText($, ['.product-brand img[alt]', '.product-brand', '[data-testid="product-brand"]']),
        imageUrl: fromEmbedded.imageUrl ?? getMetaContent(html, 'og:image'),
        rating:
            fromEmbedded.rating ??
            parseRating(pickText($, ['.c-reviews .c-reviews-v4 .visually-hidden', '[data-testid="customer-rating"]'])),
        reviewCount:
            fromEmbedded.reviewCount ??
            parseReviewCount(pickText($, ['.c-reviews-v4 .c-reviews-v4__reviews', '[data-testid="customer-review-count"]'])),
        availabilityText,
        sku: fromEmbedded.sku ?? fromEmbedded.productId ?? skuMatch?.[1] ?? null,
    };
}

function parseHomeDepot(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const title = pickText($, ['h1.sui-h4-bold', 'h1.product-details__title', 'h1']) ?? getMetaContent(html, 'og:title');
    const currentPrice =
        parsePrice($('[data-testid="price-simple"]').text()) ??
        parsePrice($('.price-format__large').text()) ??
        parsePrice($('[data-component="price:Price:"]').text());

    let inStock: boolean | null = null;
    if ($('[data-testid="add-to-cart-button"]').length > 0) inStock = true;
    else if ($('[data-testid="out-of-stock"], [data-testid="product-out-of-stock"]').length > 0) inStock = false;

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock,
        brand: pickText($, ['[data-testid="product-brand"]', '.product-brand']),
        imageUrl: getMetaContent(html, 'og:image'),
        rating: parseRating(pickText($, ['[data-testid="product-rating"]', '.stars__avg-rating'])),
        reviewCount: parseReviewCount(pickText($, ['[data-testid="product-review-count"]', '.stars__reviews'])),
        sku: pickText($, ['[data-testid="product-model"]', '.product-info-bar__model']),
    };
}

function parseCostco(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const title = pickText($, ['h1[itemprop="name"]', 'h1.product-title', 'h1']) ?? getMetaContent(html, 'og:title');
    const currentPrice = parsePrice($('.value[automation-id="productPriceOutput"]').text()) ?? parsePrice($('[itemprop="price"]').attr('content'));

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock: html.toLowerCase().includes('add to cart') && !html.toLowerCase().includes('out of stock'),
        imageUrl: getMetaContent(html, 'og:image'),
        brand: pickText($, ['.brand-name', '[itemprop="brand"]']),
        rating: parseRating(pickText($, ['.rating-number', '[itemprop="ratingValue"]'])),
        reviewCount: parseReviewCount(pickText($, ['.rating-count', '[itemprop="reviewCount"]'])),
    };
}

function parseEtsy(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const listingMatch = ctx.url.match(/\/listing\/(\d+)/i);

    const title = pickText($, ['h1[data-buy-box-listing-title]', 'h1']) ?? getMetaContent(html, 'og:title');
    const currentPrice =
        parsePrice($('[data-buy-box-region] .currency-value').text()) ??
        parsePrice($('.wt-text-title-larger .currency-value').text());

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock: !$('[data-buy-box-region]').text().toLowerCase().includes('sold out'),
        productId: listingMatch?.[1] ?? null,
        seller: pickText($, ['[data-shop-name]', '.wt-text-caption a']),
        imageUrl: getMetaContent(html, 'og:image'),
        rating: parseRating(pickText($, ['[data-star-rating]', '.wt-text-title-small'])),
        reviewCount: parseReviewCount(pickText($, ['[data-reviews-count]', '.wt-text-caption'])),
    };
}

function parseWayfair(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const title = pickText($, ['h1[data-hb-id="Heading"]', 'h1']) ?? getMetaContent(html, 'og:title');
    const currentPrice =
        parsePrice($('[data-test-id="PriceDisplay"]').text()) ??
        parsePrice($('[data-enzyme-id="price"]').text());

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock: !$('[data-test-id="OutOfStock"]').length,
        brand: pickText($, ['[data-test-id="ManufacturerName"]', '.ProductDetailInfoBlock-manufacturer']),
        imageUrl: getMetaContent(html, 'og:image'),
        rating: parseRating(pickText($, ['[data-test-id="RatingScore"]'])),
        reviewCount: parseReviewCount(pickText($, ['[data-test-id="RatingCount"]'])),
    };
}

function parseNeweggPriceFromDom($: ParseContext['$']): number | null {
    const strong = $('.price-current strong').first().text().replace(/[^\d.]/g, '');
    const sup = $('.price-current sup').first().text().replace(/[^\d]/g, '');
    return (
        parsePrice($('.price-current').first().text()) ??
        (strong && sup ? parsePrice(sup.length === 2 ? `${strong}.${sup}` : `${strong}${sup}`) : null) ??
        parsePrice($('[itemprop="price"]').attr('content'))
    );
}

function parseNeweggListPrice($: ParseContext['$']): number | null {
    return (
        parsePrice($('.price-was .price-was-data, .price-was-data').first().text()) ??
        parsePrice($('.price-was').first().text()) ??
        parsePrice($('.product-price .price-map').first().text())
    );
}

function parseNeweggEmbeddedData(html: string): Partial<ScrapedProduct> {
    const result: Partial<ScrapedProduct> = {};

    const itemMatch = html.match(/"Item"\s*:\s*"([^"]+)"/i);
    if (itemMatch) result.productId = itemMatch[1];

    const priceMatch =
        html.match(/"FinalPrice"\s*:\s*([\d.]+)/i) ??
        html.match(/"UnitCost"\s*:\s*([\d.]+)/i) ??
        html.match(/"InstantRebateAmount"\s*:\s*([\d.]+)/i);
    if (priceMatch) result.currentPrice = parsePrice(priceMatch[1]);

    const mapMatch = html.match(/"MAPPrice"\s*:\s*([\d.]+)/i);
    const listMatch = html.match(/"OriginalUnitPrice"\s*:\s*([\d.]+)/i);
    const original = parsePrice(listMatch?.[1] ?? mapMatch?.[1] ?? '');
    if (original) result.originalPrice = original;

    const stockMatch = html.match(/"Instock"\s*:\s*(true|false)/i) ?? html.match(/"InStock"\s*:\s*(true|false)/i);
    if (stockMatch) result.inStock = stockMatch[1].toLowerCase() === 'true';

    return result;
}

function parseNeweggStock($: ParseContext['$'], html: string, embeddedInStock: boolean | null | undefined): boolean | null {
    const addToCartText = pickText($, ['.btn-primary', '#ProductBuy .btn-primary', '.product-buy-box .btn-primary']);
    if (addToCartText?.toLowerCase().includes('add to cart')) return true;

    const oosText = pickText($, ['.product-flag.type-out', '.message-box-outofstock', '.product-inventory']);
    if (oosText?.toLowerCase().includes('out of stock')) return false;

    if ($('.btn-primary[disabled], .btn-primary.is-disabled').length > 0) {
        const btnText = $('.btn-primary').first().text().toLowerCase();
        if (btnText.includes('out of stock') || btnText.includes('notify me')) return false;
    }

    if (/out of stock/i.test(html) && !/add to cart/i.test(html)) return false;
    return embeddedInStock ?? null;
}

function parseNewegg(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html, url } = ctx;
    const fromEmbedded = parseNeweggEmbeddedData(html);
    const idMatch = url.match(/\/p\/([^/?#]+)/i);

    const title = pickText($, ['h1.product-title', 'h1']) ?? getMetaContent(html, 'og:title');
    const currentPrice = parseNeweggPriceFromDom($) ?? fromEmbedded.currentPrice ?? null;
    const originalPrice = parseNeweggListPrice($) ?? fromEmbedded.originalPrice ?? null;
    const inStock = parseNeweggStock($, html, fromEmbedded.inStock);

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock,
        originalPrice: originalPrice && currentPrice && originalPrice > currentPrice ? originalPrice : null,
        discountPercent:
            currentPrice && originalPrice && originalPrice > currentPrice
                ? calcDiscountPercent(currentPrice, originalPrice)
                : null,
        productId: idMatch?.[1] ?? fromEmbedded.productId ?? null,
        brand: pickText($, ['.product-brand img', '.product-breadcrumb-brand']),
        imageUrl: getMetaContent(html, 'og:image'),
        rating: parseRating(pickText($, ['.item-rating-num'])),
        reviewCount: parseReviewCount(pickText($, ['.item-rating-num + span'])),
        shippingInfo: pickText($, ['.product-shipping']),
        availabilityText: pickText($, ['.product-flag', '.message-box-outofstock']),
    };
}

function parseKohls(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const title = pickText($, ['h1.pdp-product-title', 'h1']) ?? getMetaContent(html, 'og:title');
    const currentPrice =
        parsePrice($('.prod_price_amount').text()) ??
        parsePrice($('[data-testid="product-price"]').text());

    return {
        title,
        currentPrice,
        currency: 'USD',
        inStock: $('[data-testid="addToCartButton"]').length > 0,
        brand: pickText($, ['.sub-product-title', '.pdp-brand-name']),
        imageUrl: getMetaContent(html, 'og:image'),
        rating: parseRating(pickText($, ['.rating-number', '.pdp-ratings'])),
        reviewCount: parseReviewCount(pickText($, ['.ratings-count', '.pdp-ratings-count'])),
    };
}

interface ShopifyVariant {
    price?: number | string;
    compare_at_price?: number | string | null;
    available?: boolean;
    featured_image?: { src?: string } | null;
}

function shopifyCentsToPrice(raw: unknown, compareAt?: unknown): number | null {
    if (raw == null) return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (!Number.isInteger(raw)) return raw;
        if (raw < 100) return raw;
        if (raw >= 1000) return raw / 100;
        const compare = typeof compareAt === 'number' && Number.isInteger(compareAt) ? compareAt : null;
        if (compare != null && compare > raw) return raw / 100;
        return raw;
    }
    const str = String(raw).trim();
    if (str.includes('.')) return parsePrice(str);
    const parsed = parsePrice(str);
    if (parsed == null) return null;
    if (parsed < 100) return parsed;
    if (parsed >= 1000) return parsed / 100;
    return parsed;
}

function parseShopifyVariants(variants: unknown): {
    currentPrice: number | null;
    originalPrice: number | null;
    inStock: boolean | null;
} {
    if (!Array.isArray(variants) || variants.length === 0) {
        return { currentPrice: null, originalPrice: null, inStock: null };
    }

    const typed = variants as ShopifyVariant[];
    const available = typed.filter((v) => v.available === true);
    const pick = available[0] ?? typed[0];
    const currentPrice = shopifyCentsToPrice(pick?.price, pick?.compare_at_price);
    const compareAt = shopifyCentsToPrice(pick?.compare_at_price, pick?.price);
    const originalPrice =
        compareAt != null && currentPrice != null && compareAt > currentPrice ? compareAt : null;
    const inStock = typed.some((v) => v.available === true)
        ? true
        : typed.every((v) => v.available === false)
          ? false
          : null;

    return { currentPrice, originalPrice, inStock };
}

function parseShopifyVariantData(html: string): Partial<ScrapedProduct> {
    const blockMatch = html.match(/"variants"\s*:\s*(\[[\s\S]*?\])\s*,\s*"(?:images|media|options|description)/i);
    if (blockMatch) {
        try {
            const variants = JSON.parse(blockMatch[1]) as unknown;
            const parsed = parseShopifyVariants(variants);
            return parsed;
        } catch {
            // fall through to regex
        }
    }

    const variantMatch =
        html.match(/"variants"\s*:\s*\[[\s\S]*?"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i) ??
        html.match(/variant\s*:\s*\[[\s\S]*?"price"\s*:\s*"?(\d+(?:\.\d+)?)"?/i);
    if (!variantMatch) return {};

    const raw = Number.parseFloat(variantMatch[1]);
    const currentPrice = raw >= 1000 ? raw / 100 : raw;

    const inStockMatch =
        html.match(/"inStock"\s*:\s*(true|false)/i) ??
        html.match(/"available"\s*:\s*(true|false)/i);

    return {
        currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
        inStock: inStockMatch ? inStockMatch[1].toLowerCase() === 'true' : null,
    };
}

function extractShopifyImages(data: Record<string, unknown>): string[] {
    const urls: string[] = [];
    const push = (value: unknown) => {
        if (typeof value === 'string' && value.startsWith('http')) urls.push(value);
    };

    if (Array.isArray(data.images)) {
        for (const img of data.images) {
            if (typeof img === 'string') push(img);
            else if (img && typeof img === 'object') {
                const obj = img as { src?: string; preview_image?: { src?: string } };
                push(obj.src ?? obj.preview_image?.src);
            }
        }
    }

    if (Array.isArray(data.media)) {
        for (const item of data.media) {
            if (item && typeof item === 'object') {
                const obj = item as { src?: string; preview_image?: { src?: string } };
                push(obj.src ?? obj.preview_image?.src);
            }
        }
    }

    return [...new Set(urls)];
}

function parseShopifyProductJson(html: string): Partial<ScrapedProduct> {
    const patterns = [
        /<script[^>]*type=["']application\/json["'][^>]*data-product-json[^>]*>([\s\S]*?)<\/script>/i,
        /<script[^>]*id=["']ProductJSON[^"']*["'][^>]*>([\s\S]*?)<\/script>/i,
        /<script[^>]*type=["']application\/json["'][^>]*id=["']ProductJson[^"']*["'][^>]*>([\s\S]*?)<\/script>/i,
        /<script[^>]*type=["']application\/json["'][^>]*id=["']product-json[^"']*["'][^>]*>([\s\S]*?)<\/script>/i,
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (!match) continue;
        try {
            const parsed = parseShopifyProductRecord(JSON.parse(match[1].trim()) as Record<string, unknown>);
            if (parsed.title || parsed.currentPrice != null) return parsed;
        } catch {
            // try next pattern
        }
    }

    const jsonScriptRegex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonMatch: RegExpExecArray | null;
    while ((jsonMatch = jsonScriptRegex.exec(html)) !== null) {
        try {
            const data = JSON.parse(jsonMatch[1].trim()) as Record<string, unknown>;
            if (!data.variants && !data.title && !data.price) continue;
            const parsed = parseShopifyProductRecord(data);
            if (parsed.title || parsed.currentPrice != null) return parsed;
        } catch {
            // try next script block
        }
    }

    return {};
}

function parseShopifyProductRecord(data: Record<string, unknown>): Partial<ScrapedProduct> {
    const fromVariants = parseShopifyVariants(data.variants);
    const compareAtRaw = data.compare_at_price;
    const priceRaw = data.price;
    const currentPrice =
        fromVariants.currentPrice ??
        shopifyCentsToPrice(priceRaw, compareAtRaw) ??
        shopifyCentsToPrice(compareAtRaw, priceRaw);

    const compareAt = shopifyCentsToPrice(compareAtRaw, priceRaw);
    const originalPrice =
        fromVariants.originalPrice ??
        (compareAt != null && currentPrice != null && compareAt > currentPrice ? compareAt : null);

    const available = data.available;
    const inStock =
        fromVariants.inStock ?? (typeof available === 'boolean' ? available : null);

    const imageUrls = extractShopifyImages(data);
    const currency =
        typeof data.currency === 'string'
            ? data.currency
            : typeof data.price_currency === 'string'
              ? data.price_currency
              : null;

    return {
        title: typeof data.title === 'string' ? data.title : null,
        currentPrice,
        originalPrice,
        discountPercent:
            currentPrice && originalPrice ? calcDiscountPercent(currentPrice, originalPrice) : null,
        inStock,
        productId: data.id != null ? String(data.id) : null,
        brand: typeof data.vendor === 'string' ? data.vendor : null,
        imageUrls,
        imageUrl: imageUrls[0] ?? null,
        currency,
    };
}

function parseShopifyMetaProduct(html: string): Partial<ScrapedProduct> {
    const metaMatch = html.match(/var\s+meta\s*=\s*(\{[\s\S]*?\});\s*(?:<\/script>|var\s)/i);
    if (!metaMatch) return {};

    try {
        const meta = JSON.parse(metaMatch[1]) as { product?: Record<string, unknown> };
        const product = meta.product;
        if (!product) return {};

        const variants = product.variants as unknown;
        const fromVariants = parseShopifyVariants(variants);
        return {
            currentPrice: fromVariants.currentPrice ?? shopifyCentsToPrice(product.price, product.compare_at_price),
            originalPrice: fromVariants.originalPrice,
            inStock: fromVariants.inStock,
            productId: product.id != null ? String(product.id) : null,
        };
    } catch {
        return {};
    }
}

function parseShopify(ctx: ParseContext): Partial<ScrapedProduct> {
    const { $, html } = ctx;
    const fromJson = {
        ...parseShopifyVariantData(html),
        ...parseShopifyMetaProduct(html),
        ...parseShopifyProductJson(html),
    };

    const title =
        fromJson.title ??
        pickText($, ['.product-single__title', '.product__title', '.product-title', 'h1']) ??
        getMetaContent(html, 'og:title');

    const currentPrice =
        fromJson.currentPrice ??
        parsePrice($('.price-item--sale, .price__sale .price-item--regular, .price-item--regular, .product__price, .price').first().text()) ??
        parsePrice(getMetaContent(html, 'og:price:amount')) ??
        parsePrice(getMetaContent(html, 'product:price:amount'));

    let resolvedPrice = currentPrice;
    if (
        resolvedPrice != null &&
        resolvedPrice >= 100 &&
        fromJson.currentPrice === resolvedPrice
    ) {
        const domPrice =
            parsePrice($('.price-item--sale, .price__sale .price-item--regular, .price-item--regular, .product__price, .price').first().text()) ??
            parsePrice(getMetaContent(html, 'og:price:amount'));
        if (domPrice != null && domPrice < resolvedPrice / 5) {
            resolvedPrice = domPrice;
        }
    }

    const originalPrice =
        fromJson.originalPrice ??
        parsePrice($('.price-item--regular s, .price__compare, .compare-at-price, .was-price').first().text());

    let inStock = fromJson.inStock;
    if (inStock == null) {
        const soldOut = $(
            '.product-form__sold-out, .sold-out-message, .product__sold-out, [data-sold-out-message], button[disabled][name="add"]',
        ).length;
        const addToCart = $(
            'button[name="add"]:not([disabled]), [data-add-to-cart]:not([disabled]), .product-form__submit:not([disabled]), .shopify-payment-button',
        ).length;
        if (addToCart > 0) inStock = true;
        else if (soldOut > 0) inStock = false;
        else if (/sold out/i.test(pickText($, ['.product-form', '.product__info']) ?? '')) inStock = false;
    }

    const imageUrls = fromJson.imageUrls?.length ? fromJson.imageUrls : [];
    const imageUrl = fromJson.imageUrl ?? getMetaContent(html, 'og:image');

    return {
        title,
        currentPrice: resolvedPrice,
        originalPrice: originalPrice && resolvedPrice && originalPrice > resolvedPrice ? originalPrice : null,
        discountPercent:
            resolvedPrice && originalPrice && originalPrice > resolvedPrice
                ? calcDiscountPercent(resolvedPrice, originalPrice)
                : fromJson.discountPercent ?? null,
        currency:
            fromJson.currency ??
            getMetaContent(html, 'og:price:currency') ??
            getMetaContent(html, 'product:price:currency') ??
            'USD',
        inStock,
        productId: fromJson.productId ?? null,
        brand: fromJson.brand ?? pickText($, ['.product__vendor', '.product-single__vendor']),
        imageUrl,
        imageUrls: imageUrls.length ? imageUrls : imageUrl ? [imageUrl] : [],
        description: truncateText(pickText($, ['.product__description', '.product-single__description']), 500),
    };
}

function parseGeneric(ctx: ParseContext): Partial<ScrapedProduct> {
    const { html } = ctx;
    return {
        title: getMetaContent(html, 'og:title'),
        currentPrice:
            parsePrice(getMetaContent(html, 'og:price:amount')) ??
            parsePrice(getMetaContent(html, 'product:price:amount')),
        currency:
            getMetaContent(html, 'og:price:currency') ??
            getMetaContent(html, 'product:price:currency'),
        imageUrl: getMetaContent(html, 'og:image'),
        description: truncateText(getMetaContent(html, 'og:description'), 500),
    };
}
