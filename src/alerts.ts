import type { AlertConfig, MonitorResult, ScrapedProduct, StoredHistory } from './types.js';
import { calcPriceChangePercent } from './utils.js';

export function buildMonitorResult(
    scraped: ScrapedProduct,
    previous: StoredHistory | null,
    historyStats: { min: number | null; max: number | null; avg: number | null; dataPoints: number } | null,
    alertConfig: AlertConfig,
    trackHistory: boolean,
): MonitorResult {
    const isFirstRun = previous == null;
    const previousPrice = previous?.lastPrice ?? null;
    const previousInStock = previous?.lastInStock ?? null;

    const priceChanged =
        !isFirstRun &&
        scraped.currentPrice != null &&
        previousPrice != null &&
        scraped.currentPrice !== previousPrice;

    const priceChangePercent = calcPriceChangePercent(scraped.currentPrice, previousPrice);

    const stockChanged =
        !isFirstRun &&
        scraped.inStock != null &&
        previousInStock != null &&
        scraped.inStock !== previousInStock;

    const alertReasons = evaluateAlerts({
        isFirstRun,
        currentPrice: scraped.currentPrice,
        previousPrice,
        priceChangePercent,
        priceChanged,
        inStock: scraped.inStock,
        previousInStock,
        stockChanged,
        config: alertConfig,
    });

    return {
        ...scraped,
        priceChanged,
        priceChangePercent,
        stockChanged,
        previousPrice,
        previousInStock,
        priceHistory: trackHistory && historyStats ? historyStats : null,
        alert: alertReasons.length > 0,
        alertReason: alertReasons.length > 0 ? alertReasons.join('; ') : null,
        alertReasons,
        scrapedAt: new Date().toISOString(),
        isFirstRun,
    };
}

interface AlertContext {
    isFirstRun: boolean;
    currentPrice: number | null;
    previousPrice: number | null;
    priceChangePercent: number | null;
    priceChanged: boolean;
    inStock: boolean | null;
    previousInStock: boolean | null;
    stockChanged: boolean;
    config: AlertConfig;
}

function evaluateAlerts(ctx: AlertContext): string[] {
    if (ctx.isFirstRun) return [];

    const reasons: string[] = [];

    if (ctx.config.alertOnPriceDrop && ctx.priceChangePercent != null && ctx.priceChangePercent < 0) {
        const drop = Math.abs(ctx.priceChangePercent);
        if (drop >= ctx.config.priceDropThresholdPercent) {
            reasons.push(`Price dropped ${drop}% (threshold: ${ctx.config.priceDropThresholdPercent}%)`);
        }
    }

    if (ctx.config.alertOnAnyPriceChange && ctx.priceChanged) {
        const direction = (ctx.priceChangePercent ?? 0) >= 0 ? 'increased' : 'decreased';
        reasons.push(`Price ${direction} by ${Math.abs(ctx.priceChangePercent ?? 0)}%`);
    }

    if (ctx.config.alertOnStockChange && ctx.stockChanged) {
        if (ctx.inStock) {
            reasons.push('Item is now in stock');
        } else {
            reasons.push('Item is now out of stock');
        }
    }

    if (
        ctx.config.alertOnBackInStock &&
        ctx.previousInStock === false &&
        ctx.inStock === true &&
        !reasons.some((r) => r.includes('in stock'))
    ) {
        reasons.push('Back in stock');
    }

    return [...new Set(reasons)];
}
