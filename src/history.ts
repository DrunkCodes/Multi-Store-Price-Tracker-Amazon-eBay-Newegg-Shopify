import { KeyValueStore } from 'apify';
import type { Platform, PriceHistoryStats, StoredHistory } from './types.js';
import { historyKey, round2 } from './utils.js';

const HISTORY_STORE_NAME = 'price-history';

export async function openHistoryStore(): Promise<KeyValueStore> {
    return KeyValueStore.open(HISTORY_STORE_NAME);
}

export async function loadHistory(store: KeyValueStore, normalizedUrl: string): Promise<StoredHistory | null> {
    const record = await store.getValue<StoredHistory>(historyKey(normalizedUrl));
    return record ?? null;
}

export async function saveHistory(
    store: KeyValueStore,
    normalizedUrl: string,
    data: {
        platform: Platform;
        title: string | null;
        currentPrice: number | null;
        inStock: boolean | null;
        productId: string | null;
        trackHistory: boolean;
        previous: StoredHistory | null;
    },
): Promise<StoredHistory> {
    const scrapedAt = new Date().toISOString();
    const prices = [...(data.previous?.prices ?? [])];

    if (data.trackHistory && data.currentPrice != null) {
        prices.push(data.currentPrice);
    }

    const record: StoredHistory = {
        url: normalizedUrl,
        platform: data.platform,
        title: data.title ?? data.previous?.title ?? null,
        prices,
        lastPrice: data.currentPrice,
        lastInStock: data.inStock,
        lastScrapedAt: scrapedAt,
        productId: data.productId ?? data.previous?.productId ?? null,
    };

    await store.setValue(historyKey(normalizedUrl), record);
    return record;
}

export function computeHistoryStats(prices: number[]): PriceHistoryStats {
    if (prices.length === 0) {
        return { min: null, max: null, avg: null, dataPoints: 0 };
    }

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = round2(prices.reduce((sum, p) => sum + p, 0) / prices.length);

    return { min: round2(min), max: round2(max), avg, dataPoints: prices.length };
}
