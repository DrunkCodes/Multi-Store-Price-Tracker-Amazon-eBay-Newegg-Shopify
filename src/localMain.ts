/**
 * Local testing entry point.
 *
 * Run from project root:
 *   npm run start:local
 *
 * Configuration:
 *   - local.input.json  product URLs and monitor settings
 *   - .env              proxy credentials (copy from .env.example)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dataset, ProxyConfiguration } from 'crawlee';
import type { ActorInput } from './types.js';
import {
    buildRotatingProxyUrls,
    buildStickyProxyUrlsForProducts,
    describeProxyRouting,
    readProxyEnv,
} from './proxyUtils.js';
import { runMonitor } from './runner.js';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_INPUT = resolve(PROJECT_ROOT, 'local.input.json');

function loadDotenv(): void {
    const envPath = resolve(PROJECT_ROOT, '.env');
    if (!existsSync(envPath)) return;

    for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const eqIndex = trimmed.indexOf('=');
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        process.env[key] ??= value;
    }
}

function loadInput(path: string): ActorInput & {
    useProxy?: boolean;
    headless?: boolean;
    outputFile?: string;
    stickyProxySessions?: boolean;
} {
    if (!existsSync(path)) {
        throw new Error(`Missing ${path}. Copy local.input.json.example or create local.input.json.`);
    }
    return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main(): Promise<number> {
    loadDotenv();

    const inputPath = process.env.LOCAL_INPUT ?? DEFAULT_INPUT;
    const actorInput = loadInput(inputPath);
    const {
        useProxy = true,
        headless = true,
        outputFile = 'output/local_results.json',
        stickyProxySessions = false,
        startUrls = [],
        ...monitorInput
    } = actorInput;

    let proxyConfiguration: ProxyConfiguration | undefined;
    if (useProxy) {
        const config = readProxyEnv();
        if (config) {
            const productUrls = startUrls.map(({ url }) => url);
            const allBestBuy = productUrls.every((u) => /bestbuy\.com/i.test(u));
            const sessionPrefix = allBestBuy ? 'bb' : 'wm';
            const useSticky =
                stickyProxySessions ||
                productUrls.every((u) => /walmart\.com/i.test(u)) ||
                allBestBuy ||
                productUrls.every((u) => /ebay\.com/i.test(u));

            console.log(`Proxy verification: ${describeProxyRouting(config, productUrls[0], sessionPrefix)}`);

            if (useSticky && productUrls.length) {
                const stickyMap = buildStickyProxyUrlsForProducts(config, productUrls, sessionPrefix);
                console.log(
                    `Using sticky US proxy sessions: ${config.host}:${config.port} (${stickyMap.size} product(s), prefix=${sessionPrefix}, no mid-item rotation)`,
                );
                proxyConfiguration = new ProxyConfiguration({
                    newUrlFunction: async (_sessionId, opts) => {
                        const product = opts?.request?.userData?.product as { url?: string } | undefined;
                        const url = product?.url;
                        if (url && stickyMap.has(url)) return stickyMap.get(url)!;
                        return [...stickyMap.values()][0]!;
                    },
                });
            } else {
                const proxyUrls = buildRotatingProxyUrls(config);
                console.log(`Using US proxy pool: ${config.host}:${config.port} (${proxyUrls.length} rotating sessions)`);
                proxyConfiguration = new ProxyConfiguration({ proxyUrls });
            }
        } else {
            console.warn('useProxy is true but PROXY_HOST/PROXY_PORT are not set — running without proxy');
        }
    }

    await runMonitor({
        input: { ...monitorInput, startUrls },
        proxyConfiguration,
        headless,
    });

    const dataset = await Dataset.open();
    const { items } = await dataset.getData();
    const outputPath = resolve(PROJECT_ROOT, outputFile);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(items, null, 2), 'utf-8');
    console.log(`Saved ${items.length} result(s) to ${outputPath}`);

    return 0;
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
