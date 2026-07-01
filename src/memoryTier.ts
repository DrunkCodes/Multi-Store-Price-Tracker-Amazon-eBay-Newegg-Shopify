import type { ActorInput } from './types.js';

const DEFAULT_SEARCH_MAX = 10;
const MAX_SEARCH_RESULTS = 50;

/** Rough upper bound on product pages this run may open. */
export function estimateProductCount(input: ActorInput): number {
    const urlCount = input.startUrls?.length ?? 0;
    const fromSearch = (input.searches ?? []).reduce((sum, search) => {
        const max = search.maxResults ?? DEFAULT_SEARCH_MAX;
        return sum + Math.min(MAX_SEARCH_RESULTS, Math.max(1, max));
    }, 0);
    return urlCount + fromSearch;
}

/** Suggested Apify container memory (MB) for this input. */
export function recommendMemoryMbytes(input: ActorInput): number {
    const products = estimateProductCount(input);
    if (products <= 5) return 1024;
    if (products <= 25) return 2048;
    if (products <= 50) return 2048;
    return 4096;
}

/** Suggested run timeout (seconds) scaled to workload. */
export function recommendTimeoutSecs(input: ActorInput): number {
    const products = estimateProductCount(input);
    if (products <= 5) return 600;
    if (products <= 25) return 900;
    return 1200;
}

/** Node heap cap (MB) for a given Apify container size — leaves headroom for Chromium. */
export function nodeHeapMbytesForContainer(containerMemoryMbytes: number): number {
    const mb = Number.isFinite(containerMemoryMbytes) && containerMemoryMbytes > 0 ? containerMemoryMbytes : 2048;
    // ~62% to Node, rest for browser + OS within the container
    return Math.max(384, Math.floor(mb * 0.62));
}

export function getAllocatedMemoryMbytes(): number {
    const raw = process.env.APIFY_MEMORY_MBYTES;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 2048;
}

export interface MemoryCheckResult {
    allocatedMbytes: number;
    recommendedMbytes: number;
    estimatedProducts: number;
    nodeHeapMbytes: number;
    underProvisioned: boolean;
    overProvisioned: boolean;
    message: string | null;
}

export function checkMemoryForInput(input: ActorInput): MemoryCheckResult {
    const allocatedMbytes = getAllocatedMemoryMbytes();
    const recommendedMbytes = recommendMemoryMbytes(input);
    const estimatedProducts = estimateProductCount(input);
    const nodeHeapMbytes = nodeHeapMbytesForContainer(allocatedMbytes);
    const underProvisioned = allocatedMbytes < recommendedMbytes;
    const overProvisioned = allocatedMbytes >= 2048 && recommendedMbytes <= 1024;

    let message: string | null = null;
    if (underProvisioned) {
        message =
            `This run may need ${recommendedMbytes} MB (~${estimatedProducts} product page(s) estimated) but only ${allocatedMbytes} MB is allocated. ` +
            `Increase memory in Run options to avoid out-of-memory failures.`;
    } else if (overProvisioned) {
        message =
            `Cost tip: ~${estimatedProducts} product page(s) usually fits in 1024 MB. ` +
            `Future runs can use 1024 MB memory to save roughly half the compute cost.`;
    }

    return {
        allocatedMbytes,
        recommendedMbytes,
        estimatedProducts,
        nodeHeapMbytes,
        underProvisioned,
        overProvisioned,
        message,
    };
}
