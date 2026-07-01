import { Actor, log } from 'apify';
import { checkMemoryForInput } from './memoryTier.js';
import type { ActorInput } from './types.js';
import { runMonitor } from './runner.js';

await Actor.init();

const input = (await Actor.getInput<ActorInput>()) ?? { startUrls: [], searches: [] };

const memoryCheck = checkMemoryForInput(input);
log.info(
    `Memory: ${memoryCheck.allocatedMbytes} MB allocated, ${memoryCheck.recommendedMbytes} MB recommended ` +
        `(~${memoryCheck.estimatedProducts} product page(s), Node heap cap ${memoryCheck.nodeHeapMbytes} MB)`,
);
if (memoryCheck.message) {
    if (memoryCheck.underProvisioned) {
        log.warning(memoryCheck.message);
        await Actor.setStatusMessage(`⚠️ Low memory — use ${memoryCheck.recommendedMbytes} MB for this input`);
    } else {
        log.info(memoryCheck.message);
    }
}
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
