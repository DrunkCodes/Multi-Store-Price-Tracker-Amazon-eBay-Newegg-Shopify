import { getMetaContent } from '../utils.js';

/** Extract Amazon product images from dynamic image data and gallery scripts. */
export function extractAmazonImages(html: string): string[] {
    const images = new Set<string>();

    const og = getMetaContent(html, 'og:image');
    if (og) images.add(cleanAmazonImageUrl(og));

    const oldHires = html.match(/data-old-hires="([^"]+)"/i)?.[1];
    if (oldHires) images.add(cleanAmazonImageUrl(oldHires));

    const landingSrc = html.match(/id="landingImage"[^>]+src="([^"]+)"/i)?.[1];
    if (landingSrc) images.add(cleanAmazonImageUrl(landingSrc));

    const dynamicAttr = html.match(/data-a-dynamic-image="(\{[^"]+\})"/i)?.[1];
    if (dynamicAttr) {
        try {
            const json = dynamicAttr.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            const parsed = JSON.parse(json) as Record<string, unknown>;
            for (const key of Object.keys(parsed)) {
                images.add(cleanAmazonImageUrl(key));
            }
        } catch {
            // ignore malformed dynamic image JSON
        }
    }

    for (const match of html.matchAll(/"hiRes"\s*:\s*"([^"]+)"/gi)) {
        images.add(cleanAmazonImageUrl(match[1]));
    }
    for (const match of html.matchAll(/"large"\s*:\s*"([^"]+)"/gi)) {
        images.add(cleanAmazonImageUrl(match[1]));
    }
    for (const match of html.matchAll(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9+._-]+\._AC_[A-Z0-9_]+_\.jpg/gi)) {
        images.add(cleanAmazonImageUrl(match[0]));
    }

    return dedupeAmazonImages([...images]).slice(0, 20);
}

/** Keep one best-resolution URL per Amazon image ID. */
function dedupeAmazonImages(images: string[]): string[] {
    const best = new Map<string, { url: string; score: number }>();

    for (const url of images) {
        const idMatch = url.match(/\/I\/([A-Za-z0-9+]+)\./);
        if (!idMatch) continue;

        const id = idMatch[1];
        let score = 0;
        if (url.includes('SL1500')) score = 100;
        else if (url.includes('SX679')) score = 80;
        else if (url.includes('SX569')) score = 70;
        else if (url.includes('SY450')) score = 60;
        else if (url.includes('_AC_.')) score = 10;
        else score = 40;

        const existing = best.get(id);
        if (!existing || score > existing.score) best.set(id, { url, score });
    }

    return [...best.values()].sort((a, b) => b.score - a.score).map((v) => v.url);
}

function cleanAmazonImageUrl(url: string): string {
    return url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&').trim();
}

/** Parse Target product data from any embedded JSON script blocks. */
export function parseTargetEmbeddedData(html: string): {
    title: string | null;
    currentPrice: number | null;
    originalPrice: number | null;
    inStock: boolean | null;
    productId: string | null;
    brand: string | null;
    rating: number | null;
    reviewCount: number | null;
    imageUrl: string | null;
    description: string | null;
    category: string | null;
} {
    const result = {
        title: null as string | null,
        currentPrice: null as number | null,
        originalPrice: null as number | null,
        inStock: null as boolean | null,
        productId: null as string | null,
        brand: null as string | null,
        rating: null as number | null,
        reviewCount: null as number | null,
        imageUrl: null as string | null,
        description: null as string | null,
        category: null as string | null,
    };

    const tcin = html.match(/"tcin"\s*:\s*"?(\d{6,})"?/i)?.[1] ?? null;
    if (tcin) result.productId = tcin;

    const titleMatch = html.match(/"title"\s*:\s*"((?:\\.|[^"\\])+)"/i);
    if (titleMatch) result.title = unescapeJsonString(titleMatch[1]);

    const retailMatch = html.match(/"current_retail"\s*:\s*(\d+)/i);
    if (retailMatch) {
        const cents = Number.parseInt(retailMatch[1], 10);
        if (cents > 0) result.currentPrice = cents / 100;
    }

    const formattedPrice = html.match(/"formatted_current_price"\s*:\s*"\$?([\d,.]+)"/i);
    if (!result.currentPrice && formattedPrice) {
        result.currentPrice = Number.parseFloat(formattedPrice[1].replace(/,/g, '')) || null;
    }

    const regRetail = html.match(/"reg_retail"\s*:\s*(\d+)/i);
    if (regRetail) {
        const cents = Number.parseInt(regRetail[1], 10) / 100;
        if (result.currentPrice && cents > result.currentPrice) result.originalPrice = cents;
    }

    const availability = html.match(/"availability_status"\s*:\s*"([^"]+)"/i)?.[1]?.toLowerCase();
    if (availability?.includes('in_stock')) result.inStock = true;
    else if (availability?.includes('out_of_stock')) result.inStock = false;

    const avgRating = html.match(/"average"\s*:\s*([\d.]+)/i)?.[1];
    if (avgRating) result.rating = Number.parseFloat(avgRating) || null;

    const reviewCount = html.match(/"review_count"\s*:\s*(\d+)/i)?.[1];
    if (reviewCount) result.reviewCount = Number.parseInt(reviewCount, 10) || null;

    const brandMatch = html.match(/"brand"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i);
    if (brandMatch) result.brand = brandMatch[1];

    const imageMatch =
        html.match(/"primary_image_url"\s*:\s*"([^"]+)"/i) ??
        html.match(/"image_url"\s*:\s*"([^"]+)"/i);
    if (imageMatch) result.imageUrl = imageMatch[1].replace(/\\u0026/g, '&');

    const descMatch = html.match(/"downstream_description"\s*:\s*"((?:\\.|[^"\\])+)"/i);
    if (descMatch) result.description = unescapeJsonString(descMatch[1]).slice(0, 500);

    const categoryMatch = html.match(/"merchandise_type"\s*:\s*"([^"]+)"/i);
    if (categoryMatch) result.category = categoryMatch[1];

    return result;
}

function unescapeJsonString(value: string): string {
    return value.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\u0026/g, '&').trim();
}
