export type Platform =
    | 'amazon'
    | 'walmart'
    | 'ebay'
    | 'target'
    | 'bestbuy'
    | 'homedepot'
    | 'costco'
    | 'etsy'
    | 'wayfair'
    | 'newegg'
    | 'kohls'
    | 'shopify'
    | 'generic';

export type ProductSource = 'direct_url' | 'keyword_search';

export type PriceUnavailableReason =
    | 'see_price_in_cart'
    | 'map_pricing'
    | 'out_of_stock'
    | 'price_not_returned';

export interface SearchQuery {
    keyword: string;
    platform: Platform;
    maxResults?: number;
}

export interface ActorInput {
    startUrls?: Array<{ url: string }>;
    searches?: SearchQuery[];
    trackHistory?: boolean;
    alertOnPriceDrop?: boolean;
    priceDropThresholdPercent?: number;
    alertOnAnyPriceChange?: boolean;
    alertOnStockChange?: boolean;
    alertOnBackInStock?: boolean;
    maxConcurrency?: number;
    maxRequestRetries?: number;
    /** Target.com store ZIP (e.g. 10001). Used for RedSky pricing/fulfillment and location cookies. */
    targetZip?: string;
    /** Target.com store ID (e.g. 1154). Overrides the store resolved from targetZip when set. */
    targetStoreId?: string;
    /**
     * Optional 2Captcha API key for solving reCAPTCHA/hCaptcha/Turnstile on bot pages.
     * Prefer TWOCAPTCHA_API_KEY env / Apify secret in production — do not commit real keys.
     */
    twoCaptchaApiKey?: string;
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxyCountry?: string;
        proxyUrls?: string[];
    };
}

export interface ScrapedProduct {
    url: string;
    platform: Platform;
    source: ProductSource;
    searchKeyword: string | null;
    title: string | null;
    currentPrice: number | null;
    currency: string | null;
    inStock: boolean | null;
    originalPrice: number | null;
    discountPercent: number | null;
    productId: string | null;
    brand: string | null;
    seller: string | null;
    imageUrl: string | null;
    imageUrls: string[];
    description: string | null;
    category: string | null;
    sku: string | null;
    condition: string | null;
    rating: number | null;
    reviewCount: number | null;
    availabilityText: string | null;
    shippingInfo: string | null;
    highlights: string[];
    /** Set when Target (or similar) withholds a numeric price — e.g. MAP, see-price-in-cart, OOS. */
    priceUnavailableReason: PriceUnavailableReason | null;
}

export interface PriceHistoryStats {
    min: number | null;
    max: number | null;
    avg: number | null;
    dataPoints: number;
}

export interface StoredHistory {
    url: string;
    platform: Platform;
    title: string | null;
    prices: number[];
    lastPrice: number | null;
    lastInStock: boolean | null;
    lastScrapedAt: string | null;
    productId: string | null;
}

export interface MonitorResult extends ScrapedProduct {
    priceChanged: boolean;
    priceChangePercent: number | null;
    stockChanged: boolean;
    previousPrice: number | null;
    previousInStock: boolean | null;
    priceHistory: PriceHistoryStats | null;
    alert: boolean;
    alertReason: string | null;
    alertReasons: string[];
    scrapedAt: string;
    isFirstRun: boolean;
    error?: string;
}

export interface AlertConfig {
    alertOnPriceDrop: boolean;
    priceDropThresholdPercent: number;
    alertOnAnyPriceChange: boolean;
    alertOnStockChange: boolean;
    alertOnBackInStock: boolean;
}

export interface ProductRequest {
    url: string;
    platform: Platform;
    source: ProductSource;
    searchKeyword: string | null;
}
