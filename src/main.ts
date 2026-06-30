import { Actor } from 'apify';
import type { ActorInput } from './types.js';
import { runMonitor } from './runner.js';

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? { startUrls: [], searches: [] };
const proxyConfiguration = await Actor.createProxyConfiguration(
    input.proxyConfiguration ?? {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
        apifyProxyCountry: 'US',
    },
);

await runMonitor({
    input,
    proxyConfiguration: proxyConfiguration ?? undefined,
    headless: process.env.APIFY_HEADLESS !== '0',
});

await Actor.exit();
